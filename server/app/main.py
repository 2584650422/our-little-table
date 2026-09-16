"""HTTP API compatible with the original Express implementation.

The routes deliberately keep the established JSON envelope and URLs so the
native mini-program can switch runtime without changing its request layer.
"""
import json
import logging
import os
import random
import re
import time
import uuid
from datetime import date, datetime, timedelta
from typing import Any, Optional

import httpx
import jwt
from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .config import settings
from .db import connection, execute, fetch_all, fetch_one

logging.basicConfig(level=getattr(logging, settings.log_level, logging.INFO),
                    format="%(asctime)s %(levelname)s pid=%(process)d %(message)s")
logger = logging.getLogger("little_table")
app = FastAPI(title="两个人的小饭桌 API", docs_url=None, redoc_url=None)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=False,
                   allow_methods=["*"], allow_headers=["*"])

class AppError(Exception):
    def __init__(self, message: str, status: int = 400, code: Optional[int] = None):
        self.message, self.status, self.code = message, status, code or status

def success(data: Any = None, message: str = "ok") -> dict:
    return {"code": 0, "message": message, "data": {} if data is None else data}

def clamp(value, low, high):
    return max(low, min(high, value))

def text(value, length: int, default: str = "") -> str:
    return str(value if value is not None else default).strip()[:length]

def number(value, default=None):
    try:
        return float(value)
    except (TypeError, ValueError):
        return default

def expiration() -> datetime:
    match = re.fullmatch(r"(\d+)([dhm]?)", settings.jwt_expires_in.strip())
    amount, unit = (int(match.group(1)), match.group(2)) if match else (7, "d")
    return datetime.utcnow() + timedelta(days=amount) if unit == "d" else datetime.utcnow() + timedelta(hours=amount) if unit == "h" else datetime.utcnow() + timedelta(minutes=amount)

def sign(user: dict) -> str:
    return jwt.encode({"sub": str(user["id"]), "exp": expiration()}, settings.jwt_secret, algorithm="HS256")

def user_from_token(request: Request) -> dict:
    raw = request.headers.get("authorization", "")
    token = re.sub(r"^Bearer\s+", "", raw, flags=re.I)
    if not token:
        raise AppError("请先登录", 401)
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
    except jwt.PyJWTError:
        raise AppError("登录状态已失效", 401)
    user = fetch_one("SELECT id,openid,nickname,avatar_url AS avatarUrl,couple_id AS coupleId FROM users WHERE id=%s", (payload.get("sub"),))
    if not user:
        raise AppError("登录状态已失效", 401)
    return user

def current_user(request: Request) -> dict:
    return user_from_token(request)

def coupled_user(request: Request) -> dict:
    user = user_from_token(request)
    if not user.get("coupleId"):
        raise AppError("请先创建或加入小饭桌", 403)
    return user

@app.exception_handler(AppError)
async def app_error_handler(request: Request, error: AppError):
    return JSONResponse(status_code=error.status, content={"code": error.code, "message": error.message,
        "data": {"requestId": getattr(request.state, "request_id", "")}})

@app.exception_handler(Exception)
async def unhandled_error_handler(request: Request, error: Exception):
    logger.exception("http.request.failed requestId=%s path=%s", getattr(request.state, "request_id", ""), request.url.path)
    return JSONResponse(status_code=500, content={"code": 500, "message": "服务开了个小差，请稍后再试",
        "data": {"requestId": getattr(request.state, "request_id", "")}})

@app.middleware("http")
async def request_log(request: Request, call_next):
    request.state.request_id = str(request.headers.get("x-request-id") or uuid.uuid4())[:80]
    started = time.perf_counter()
    response = await call_next(request)
    response.headers["X-Request-Id"] = request.state.request_id
    logger.info("http.request.completed requestId=%s method=%s path=%s status=%s durationMs=%.1f",
                request.state.request_id, request.method, request.url.path, response.status_code, (time.perf_counter()-started)*1000)
    return response

def ensure_menu(couple_id: int) -> None:
    """Copy the starter menu exactly once, protected by MySQL's named lock."""
    lock_name = f"little_table_menu_{couple_id}"
    with connection(transaction=True) as conn:
        lock = fetch_one("SELECT GET_LOCK(%s, 5) AS acquired", (lock_name,), conn)
        if not lock or not lock["acquired"]:
            raise AppError("初始化饭桌菜单超时，请重试", 503)
        try:
            exists = fetch_one("SELECT COUNT(*) AS count FROM categories WHERE couple_id=%s", (couple_id,), conn)
            if not exists["count"]:
                execute("INSERT INTO categories (couple_id,name,icon,sort_order,enabled) SELECT %s,name,icon,sort_order,enabled FROM starter_categories WHERE enabled=1", (couple_id,), conn)
                execute("""INSERT INTO dishes (couple_id,category_id,name,description,image_key,image_url,calorie_kcal,calorie_unit,calorie_note,serving_note,cook_time_minutes,difficulty,spicy_level,tags,enabled,sort_order,created_by)
                    SELECT %s,own_category.id,d.name,d.description,d.image_key,d.image_url,d.calorie_kcal,d.calorie_unit,d.calorie_note,d.serving_note,d.cook_time_minutes,d.difficulty,d.spicy_level,d.tags,d.enabled,d.sort_order,NULL
                    FROM starter_dishes d JOIN starter_categories starter_category ON starter_category.id=d.category_id
                    JOIN categories own_category ON own_category.couple_id=%s AND own_category.name=starter_category.name WHERE d.enabled=1""", (couple_id, couple_id), conn)
        finally:
            execute("SELECT RELEASE_LOCK(%s)", (lock_name,), conn)

def member_count(couple_id: int, conn=None) -> int:
    return fetch_one("SELECT COUNT(*) AS count FROM couple_members WHERE couple_id=%s AND left_at IS NULL", (couple_id,), conn)["count"]

def fallback_couple(user_id: int, excluded_id: int, conn) -> Optional[int]:
    row = fetch_one("SELECT couple_id AS coupleId FROM couple_members WHERE user_id=%s AND left_at IS NULL AND couple_id<>%s ORDER BY joined_at DESC LIMIT 1", (user_id, excluded_id), conn)
    return row["coupleId"] if row else None

def normalize_dish(row: dict) -> dict:
    try:
        row["tags"] = json.loads(row["tags"]) if isinstance(row.get("tags"), str) else (row.get("tags") or [])
    except json.JSONDecodeError:
        row["tags"] = []
    row["isFavorite"] = bool(row.get("isFavorite")); row["enabled"] = bool(row.get("enabled"))
    return row

DISH_SELECT = """SELECT d.id,d.name,d.description,d.image_key AS imageKey,d.image_url AS imageUrl,d.calorie_kcal AS calorieKcal,d.calorie_unit AS calorieUnit,d.calorie_note AS calorieNote,d.serving_note AS servingNote,d.cook_time_minutes AS cookTimeMinutes,d.difficulty,d.spicy_level AS spicyLevel,d.tags,d.enabled,d.couple_id AS coupleId,d.sort_order AS sortOrder,c.id AS categoryId,c.name AS categoryName,c.icon AS categoryIcon,
EXISTS(SELECT 1 FROM favorites f WHERE f.dish_id=d.id AND f.user_id=%s) AS isFavorite,
(SELECT COUNT(DISTINCT oi.order_id) FROM order_items oi JOIN orders oo ON oo.id=oi.order_id WHERE oo.couple_id=%s AND oo.status<>'cancelled' AND (oi.dish_id=d.id OR oi.dish_name=d.name)) AS orderedCount FROM dishes d JOIN categories c ON c.id=d.category_id"""

def dish_payload(body: dict):
    category_id = int(number(body.get("categoryId"), 0) or 0); name = text(body.get("name"), 80)
    if not category_id or not name: raise AppError("菜名和分类都要填写哦")
    calorie = number(body.get("calorieKcal")); cook_time = number(body.get("cookTimeMinutes"))
    tags = body.get("tags") if isinstance(body.get("tags"), list) else []
    spicy = number(body.get("spicyLevel"))
    return (category_id, name, text(body.get("description"),255) or None, body.get("imageKey") or None, body.get("imageUrl") or None,
        max(0, round(calorie)) if calorie is not None else None, text(body.get("calorieUnit"),16,"份") or "份", text(body.get("calorieNote"),80,"家庭做法估算值"), text(body.get("servingNote"),80) or None,
        max(0, round(cook_time)) if cook_time is not None else None, body.get("difficulty") if body.get("difficulty") in ("easy","medium","hard") else None,
        clamp(int(spicy),0,5) if spicy is not None else None, json.dumps(tags[:8], ensure_ascii=False), int(number(body.get("sortOrder"),0) or 0))

def order_hydrate(rows: list[dict]) -> list[dict]:
    if not rows: return rows
    ids = [row["id"] for row in rows]; marks = ",".join(["%s"] * len(ids))
    items = fetch_all(f"SELECT id,order_id AS orderId,dish_id AS dishId,dish_name AS dishName,dish_image_url AS dishImageUrl,dish_calorie_kcal AS dishCalorieKcal,dish_calorie_unit AS dishCalorieUnit,quantity,note FROM order_items WHERE order_id IN ({marks}) ORDER BY id", ids)
    reviews = fetch_all(f"SELECT r.order_id AS orderId,r.user_id AS userId,u.nickname,u.avatar_url AS avatarUrl,r.comment,r.image_key AS imageKey,r.image_url AS imageUrl,DATE_FORMAT(r.created_at, '%Y-%m-%d %H:%i') AS createdAt FROM meal_reviews r JOIN users u ON u.id=r.user_id WHERE r.order_id IN ({marks}) ORDER BY r.created_at ASC", ids)
    for row in rows:
        row_reviews = [review for review in reviews if review["orderId"] == row["id"]]
        row["items"] = [item for item in items if item["orderId"] == row["id"]]
        row["reviews"] = row_reviews
        row["servedImageUrl"] = next((review.get("imageUrl") for review in row_reviews if review.get("imageUrl")), None)
    return rows

async def code2session(code: str) -> dict:
    if not settings.wechat_app_id or not settings.wechat_app_secret: raise AppError("微信登录尚未配置", 503)
    async with httpx.AsyncClient(timeout=8) as client:
        response = await client.get("https://api.weixin.qq.com/sns/jscode2session", params={"appid":settings.wechat_app_id,"secret":settings.wechat_app_secret,"js_code":code,"grant_type":"authorization_code"})
    data = response.json()
    if data.get("errcode") or not data.get("openid"): raise AppError(f"微信登录失败：{data.get('errmsg','无 openid')}", 401)
    return data

_access_token = {"value":"", "expires":0.0}
async def send_subscribe(openid: str, order: dict) -> dict:
    keys = [settings.wechat_meal_key,settings.wechat_dish_key,settings.wechat_message_key,settings.wechat_date_key]
    if not settings.wechat_template_id or not settings.wechat_app_secret or not all(keys): return {"sent":False,"reason":"微信提醒暂未配置"}
    if _access_token["expires"] < time.time()+60:
        async with httpx.AsyncClient(timeout=8) as client:
            response = await client.get("https://api.weixin.qq.com/cgi-bin/token", params={"grant_type":"client_credential","appid":settings.wechat_app_id,"secret":settings.wechat_app_secret})
        token_data = response.json()
        if token_data.get("errcode") or not token_data.get("access_token"): raise RuntimeError(token_data.get("errmsg","access token unavailable"))
        _access_token.update(value=token_data["access_token"],expires=time.time()+int(token_data.get("expires_in",7200)))
    payload = {"touser":openid,"template_id":settings.wechat_template_id,"page":f"{settings.wechat_order_page}?id={order['id']}","data":{
        settings.wechat_meal_key:{"value":order["title"][:20]},settings.wechat_dish_key:{"value":order["dishNames"][:20]},settings.wechat_message_key:{"value":(order.get("message") or "来看看今天的小菜单吧")[:20]},settings.wechat_date_key:{"value":order["mealDate"]}}}
    async with httpx.AsyncClient(timeout=8) as client:
        response = await client.post(f"https://api.weixin.qq.com/cgi-bin/message/subscribe/send?access_token={_access_token['value']}", json=payload)
    result=response.json()
    if result.get("errcode"): raise RuntimeError(result.get("errmsg","subscribe message failed"))
    return {"sent":True}

async def notify_created(creator: dict, target: Optional[dict], order: dict) -> dict:
    execute("INSERT INTO notifications (user_id,type,title,content,order_id) VALUES (%s,'order_created',%s,%s,%s)", (creator["id"],"点菜成功啦",f"已提交：{order['dishNames']}",order["id"]))
    if not target: return {"creator":{"sent":True,"channel":"in_app"},"target":{"sent":False,"reason":"另一位成员尚未加入"}}
    execute("INSERT INTO notifications (user_id,type,title,content,order_id) VALUES (%s,'new_order',%s,%s,%s)", (target["id"],"今天想吃这些",order["dishNames"],order["id"]))
    try: target_result=await send_subscribe(target["openid"],order)
    except Exception: target_result={"sent":False,"reason":"微信提醒发送失败，小程序内提醒已送达"}
    return {"creator":{"sent":True,"channel":"in_app"},"target":target_result}

async def notify_served(order: dict, served_by: int):
    members=fetch_all("SELECT user_id AS userId FROM couple_members WHERE couple_id=%s AND left_at IS NULL AND user_id<>%s",(order["coupleId"],served_by))
    for member in members: execute("INSERT INTO notifications (user_id,type,title,content,order_id) VALUES (%s,'order_served',%s,%s,%s)",(member["userId"],"上菜成功啦",order["dishNames"],order["id"]))

@app.get("/health")
def health(request: Request):
    try:
        fetch_one("SELECT 1 AS connected")
        return success({"status":"ok","database":"connected","pid":os.getpid(),"requestId":request.state.request_id})
    except Exception:
        return JSONResponse(status_code=503, content={"code":503,"message":"数据库尚未连接","data":{"status":"degraded","database":"disconnected","pid":os.getpid(),"requestId":request.state.request_id}})

@app.post("/api/auth/wechat")
async def auth_wechat(request: Request):
    body=await request.json(); code=text(body.get("code"),255)
    if not code: raise AppError("缺少微信登录凭证")
    session=await code2session(code)
    execute("INSERT INTO users (openid) VALUES (%s) ON DUPLICATE KEY UPDATE updated_at=NOW()",(session["openid"],))
    user=fetch_one("SELECT id,nickname,avatar_url AS avatarUrl,couple_id AS coupleId FROM users WHERE openid=%s",(session["openid"],))
    return success({"token":sign(user),"user":user})

@app.post("/api/auth/dev")
async def auth_dev(request: Request):
    if not settings.dev_login_enabled or settings.environment == "production": raise AppError("开发登录未开启",404)
    body=await request.json(); identity=re.sub(r"[^a-zA-Z0-9_-]","",str(body.get("identity","one")))[:24]
    execute("INSERT INTO users (openid,nickname) VALUES (%s,%s) ON DUPLICATE KEY UPDATE updated_at=NOW()",(f"dev_{identity}", text(body.get("nickname"),30,"本地体验用户") or "本地体验用户"))
    user=fetch_one("SELECT id,nickname,avatar_url AS avatarUrl,couple_id AS coupleId FROM users WHERE openid=%s",(f"dev_{identity}",))
    return success({"token":sign(user),"user":user})

@app.get("/api/auth/me")
def auth_me(user: dict=Depends(current_user)): return success(user)

@app.put("/api/auth/me")
async def update_me(request: Request, user: dict=Depends(current_user)):
    body=await request.json(); nickname=text(body.get("nickname"),30)
    if not nickname: raise AppError("告诉我该怎么称呼你吧")
    avatar=body.get("avatarUrl",user.get("avatarUrl")); avatar=text(avatar,500) or None
    execute("UPDATE users SET nickname=%s,avatar_url=%s WHERE id=%s",(nickname,avatar,user["id"]))
    user.update(nickname=nickname,avatarUrl=avatar); return success(user,"称呼记住啦")

@app.get("/api/couples/mine")
def couples_mine(user: dict=Depends(current_user)):
    rows=fetch_all("""SELECT c.id,c.public_id AS publicId,c.name,DATE_FORMAT(c.anniversary,'%Y-%m-%d') AS anniversary,c.home_title AS homeTitle,c.home_subtitle AS homeSubtitle,DATE_FORMAT(cm.joined_at,'%Y-%m-%d %H:%i') AS joinedAt,c.id=%s AS isCurrent,(SELECT COUNT(*) FROM couple_members m WHERE m.couple_id=c.id AND m.left_at IS NULL) AS memberCount FROM couple_members cm JOIN couples c ON c.id=cm.couple_id WHERE cm.user_id=%s AND cm.left_at IS NULL ORDER BY isCurrent DESC,cm.joined_at DESC""",(user.get("coupleId") or 0,user["id"]))
    return success(rows)

@app.post("/api/couples")
async def create_couple(request: Request, user: dict=Depends(current_user)):
    body=await request.json(); name=text(body.get("name"),50,"我们的小饭桌") or "我们的小饭桌"
    with connection(transaction=True) as conn:
        couple_id,_=execute("INSERT INTO couples (public_id,name,invite_code,invite_expire_at) VALUES (%s,%s,%s,DATE_ADD(NOW(),INTERVAL 7 DAY))",(str(uuid.uuid4()),name,uuid.uuid4().hex[:8].upper()),conn)
        execute("INSERT INTO couple_members (couple_id,user_id) VALUES (%s,%s)",(couple_id,user["id"]),conn)
        execute("UPDATE users SET couple_id=%s WHERE id=%s",(couple_id,user["id"]),conn)
        execute("UPDATE couples SET created_by=%s WHERE id=%s",(user["id"],couple_id),conn)
    ensure_menu(couple_id)
    couple=fetch_one("SELECT id,public_id AS publicId,name,invite_code AS inviteCode FROM couples WHERE id=%s",(couple_id,))
    return success(couple,"小饭桌创建好啦")

@app.post("/api/couples/join")
async def join_couple(request: Request, user: dict=Depends(current_user)):
    body=await request.json(); invite=text(body.get("inviteCode"),8).upper()
    with connection(transaction=True) as conn:
        couple=fetch_one("SELECT id,name,public_id AS publicId FROM couples WHERE invite_code=%s AND invite_expire_at>NOW() FOR UPDATE",(invite,),conn)
        if not couple: raise AppError("邀请码不对或已经过期")
        existing=fetch_one("SELECT id,left_at AS leftAt FROM couple_members WHERE couple_id=%s AND user_id=%s FOR UPDATE",(couple["id"],user["id"]),conn)
        if existing and existing["leftAt"]:
            execute("UPDATE couple_members SET left_at=NULL,joined_at=NOW() WHERE id=%s",(existing["id"],),conn)
        elif not existing:
            if member_count(couple["id"],conn)>=2: raise AppError("这个小饭桌已经坐满两个人啦")
            execute("INSERT INTO couple_members (couple_id,user_id) VALUES (%s,%s)",(couple["id"],user["id"]),conn)
            execute("UPDATE couples SET invite_code=NULL,invite_expire_at=NULL WHERE id=%s",(couple["id"],),conn)
        execute("UPDATE users SET couple_id=%s WHERE id=%s",(couple["id"],user["id"]),conn)
    ensure_menu(couple["id"]); return success(couple,"坐到一起啦")

@app.post("/api/couples/switch/{couple_id}")
def switch_couple(couple_id: int, user: dict=Depends(current_user)):
    if not fetch_one("SELECT couple_id FROM couple_members WHERE couple_id=%s AND user_id=%s AND left_at IS NULL",(couple_id,user["id"])): raise AppError("你还没有加入这个小饭桌")
    execute("UPDATE users SET couple_id=%s WHERE id=%s",(couple_id,user["id"]))
    ensure_menu(couple_id)
    return success(fetch_one("SELECT id,public_id AS publicId,name FROM couples WHERE id=%s",(couple_id,)),"已经切换到这个小饭桌")

@app.get("/api/couples/current")
def current_couple(user: dict=Depends(coupled_user)):
    ensure_menu(user["coupleId"])
    couple=fetch_one("SELECT id,public_id AS publicId,name,invite_code AS inviteCode,DATE_FORMAT(invite_expire_at,'%Y-%m-%d %H:%i') AS inviteExpireAt,DATE_FORMAT(anniversary,'%Y-%m-%d') AS anniversary,home_title AS homeTitle,home_subtitle AS homeSubtitle,created_by AS createdBy,DATE_FORMAT(created_at,'%Y-%m-%d %H:%i') AS createdAt FROM couples WHERE id=%s",(user["coupleId"],))
    members=fetch_all("SELECT u.id,u.nickname,u.avatar_url AS avatarUrl FROM couple_members cm JOIN users u ON u.id=cm.user_id WHERE cm.couple_id=%s AND cm.left_at IS NULL ORDER BY cm.joined_at,u.id",(user["coupleId"],))
    stats=fetch_one("SELECT COUNT(*) AS meals FROM orders WHERE couple_id=%s AND status='completed'",(user["coupleId"],))
    couple.update(members=members,stats=stats); return success(couple)

@app.put("/api/couples/current")
async def update_couple(request: Request, user: dict=Depends(coupled_user)):
    body=await request.json(); name=text(body.get("name"),50)
    if not name: raise AppError("小饭桌也要有个名字呀")
    anniversary=body.get("anniversary") or None; title=text(body.get("homeTitle"),80,"今天想吃点什么呀？") or "今天想吃点什么呀？"; subtitle=text(body.get("homeSubtitle"),120,"认真选一顿，也是在认真过日子。") or "认真选一顿，也是在认真过日子。"
    execute("UPDATE couples SET name=%s,anniversary=%s,home_title=%s,home_subtitle=%s WHERE id=%s",(name,anniversary,title,subtitle,user["coupleId"]))
    return success({"name":name,"anniversary":anniversary,"homeTitle":title,"homeSubtitle":subtitle},"小饭桌更新好啦")

@app.post("/api/couples/invite")
def create_invite(user: dict=Depends(coupled_user)):
    if member_count(user["coupleId"])>=2: raise AppError("小饭桌已经坐满两个人啦")
    invite=uuid.uuid4().hex[:8].upper(); execute("UPDATE couples SET invite_code=%s,invite_expire_at=DATE_ADD(NOW(),INTERVAL 7 DAY) WHERE id=%s",(invite,user["coupleId"]))
    return success({"inviteCode":invite},"新邀请码准备好啦")

@app.post("/api/couples/leave")
def leave_couple(user: dict=Depends(coupled_user)):
    with connection(transaction=True) as conn:
        execute("UPDATE couple_members SET left_at=NOW() WHERE couple_id=%s AND user_id=%s AND left_at IS NULL",(user["coupleId"],user["id"]),conn)
        fallback=fallback_couple(user["id"],user["coupleId"],conn)
        execute("UPDATE users SET couple_id=%s WHERE id=%s",(fallback,user["id"]),conn)
    return success({"currentCoupleId":fallback},"已经退出当前小饭桌，历史数据仍会保留")

@app.delete("/api/couples/current")
def delete_couple(user: dict=Depends(coupled_user)):
    couple_id=user["coupleId"]
    with connection(transaction=True) as conn:
        couple=fetch_one("SELECT created_by AS createdBy FROM couples WHERE id=%s FOR UPDATE",(couple_id,),conn)
        if not couple or int(couple["createdBy"] or 0)!=int(user["id"]): raise AppError("只有创建者可以删除小饭桌",403)
        if member_count(couple_id,conn)>1: raise AppError("请先让另一位成员退出，再删除小饭桌")
        fallback=fallback_couple(user["id"],couple_id,conn)
        execute("UPDATE users SET couple_id=%s WHERE id=%s",(fallback,user["id"]),conn)
        execute("DELETE FROM couples WHERE id=%s",(couple_id,),conn)
    return success({"currentCoupleId":fallback},"小饭桌已删除")

@app.get("/api/categories")
def categories(user: dict=Depends(coupled_user)):
    ensure_menu(user["coupleId"]); return success(fetch_all("SELECT id,name,icon,sort_order AS sortOrder FROM categories WHERE couple_id=%s AND enabled=1 ORDER BY sort_order,id",(user["coupleId"],)))

@app.post("/api/categories")
async def create_category(request: Request, user: dict=Depends(coupled_user)):
    body=await request.json(); name=text(body.get("name"),30); icon=text(body.get("icon"),16,"🍽️") or "🍽️"
    if not name: raise AppError("分类名称不能为空")
    try: category_id,_=execute("INSERT INTO categories (couple_id,name,icon,sort_order,created_by) VALUES (%s,%s,%s,%s,%s)",(user["coupleId"],name,icon,int(number(body.get("sortOrder"),0) or 0),user["id"]))
    except Exception as error:
        if getattr(error,"args",[None])[0]==1062: raise AppError("已经有同名分类啦")
        raise
    return success({"id":category_id},"分类添加好啦")

@app.put("/api/categories/{category_id}")
async def update_category(category_id: int, request: Request, user: dict=Depends(coupled_user)):
    body=await request.json(); name=text(body.get("name"),30); icon=text(body.get("icon"),16,"🍽️") or "🍽️"
    if not name: raise AppError("分类名称不能为空")
    try: _, count=execute("UPDATE categories SET name=%s,icon=%s,sort_order=%s WHERE id=%s AND couple_id=%s AND enabled=1",(name,icon,int(number(body.get("sortOrder"),0) or 0),category_id,user["coupleId"]))
    except Exception as error:
        if getattr(error,"args",[None])[0]==1062: raise AppError("已经有同名分类啦")
        raise
    if not count: raise AppError("分类找不到啦",404)
    return success(message="分类更新好啦")

@app.delete("/api/categories/{category_id}")
def delete_category(category_id: int, user: dict=Depends(coupled_user)):
    row=fetch_one("SELECT COUNT(*) AS dishCount FROM dishes WHERE category_id=%s AND couple_id=%s AND enabled=1",(category_id,user["coupleId"]))
    if row["dishCount"]: raise AppError(f"这个分类里还有 {row['dishCount']} 道菜，请先移动或下架")
    _,count=execute("UPDATE categories SET enabled=0 WHERE id=%s AND couple_id=%s",(category_id,user["coupleId"]))
    if not count: raise AppError("分类找不到啦",404)
    return success(message="分类已经收起来啦")

@app.get("/api/dishes")
def dishes(request: Request, user: dict=Depends(coupled_user)):
    ensure_menu(user["coupleId"]); where=["d.couple_id=%s"]; params=[user["id"],user["coupleId"],user["coupleId"]]
    query=request.query_params
    if query.get("includeDisabled")!="true": where.append("d.enabled=1")
    if query.get("categoryId"):
        where.append("d.category_id=%s"); params.append(int(number(query.get("categoryId"),0) or 0))
    if query.get("keyword"):
        where.append("(d.name LIKE %s OR d.description LIKE %s)"); needle=f"%{text(query.get('keyword'),50)}%"; params.extend([needle,needle])
    if query.get("favorite")=="true": where.append("EXISTS(SELECT 1 FROM favorites ff WHERE ff.dish_id=d.id AND ff.user_id=%s)"); params.append(user["id"])
    rows=fetch_all(f"{DISH_SELECT} WHERE {' AND '.join(where)} ORDER BY d.sort_order,d.id",params)
    return success([normalize_dish(row) for row in rows])

@app.get("/api/dishes/{dish_id}")
def dish_detail(dish_id: int, user: dict=Depends(coupled_user)):
    ensure_menu(user["coupleId"])
    dish=fetch_one(f"{DISH_SELECT} WHERE d.id=%s AND d.couple_id=%s",(user["id"],user["coupleId"],dish_id,user["coupleId"]))
    if not dish: raise AppError("这道菜找不到啦",404)
    stats=fetch_one("SELECT COUNT(*) AS eatenCount,DATE_FORMAT(MAX(o.completed_at),'%Y-%m-%d %H:%i') AS lastEatenAt FROM order_items i JOIN orders o ON o.id=i.order_id WHERE i.dish_id=%s AND o.couple_id=%s AND o.status='completed'",(dish_id,user["coupleId"]))
    dish=normalize_dish(dish); dish.update(stats); return success(dish)

@app.post("/api/dishes")
async def create_dish(request: Request, user: dict=Depends(coupled_user)):
    payload=dish_payload(await request.json()); category=fetch_one("SELECT id FROM categories WHERE id=%s AND couple_id=%s AND enabled=1",(payload[0],user["coupleId"]))
    if not category: raise AppError("请选择当前小饭桌里的分类")
    dish_id,_=execute("""INSERT INTO dishes (couple_id,category_id,name,description,image_key,image_url,calorie_kcal,calorie_unit,calorie_note,serving_note,cook_time_minutes,difficulty,spicy_level,tags,sort_order,created_by) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",(user["coupleId"],*payload,user["id"]))
    return success({"id":dish_id},"新菜加进菜单啦")

@app.put("/api/dishes/{dish_id}")
async def update_dish(dish_id: int, request: Request, user: dict=Depends(coupled_user)):
    payload=dish_payload(await request.json()); category=fetch_one("SELECT id FROM categories WHERE id=%s AND couple_id=%s AND enabled=1",(payload[0],user["coupleId"]))
    if not category: raise AppError("请选择当前小饭桌里的分类")
    _,count=execute("""UPDATE dishes SET category_id=%s,name=%s,description=%s,image_key=%s,image_url=%s,calorie_kcal=%s,calorie_unit=%s,calorie_note=%s,serving_note=%s,cook_time_minutes=%s,difficulty=%s,spicy_level=%s,tags=%s,sort_order=%s WHERE id=%s AND couple_id=%s""",(*payload,dish_id,user["coupleId"]))
    if not count: raise AppError("只能编辑自己饭桌添加的菜",403)
    return success(message="菜单更新好啦")

@app.delete("/api/dishes/{dish_id}")
def disable_dish(dish_id: int, user: dict=Depends(coupled_user)):
    _,count=execute("UPDATE dishes SET enabled=0 WHERE id=%s AND couple_id=%s",(dish_id,user["coupleId"]))
    if not count: raise AppError("只能下架当前小饭桌里的菜",403)
    return success(message="已经从菜单里收起来啦")

@app.post("/api/dishes/{dish_id}/favorite")
def favorite_dish(dish_id: int, user: dict=Depends(coupled_user)):
    if not fetch_one("SELECT id FROM dishes WHERE id=%s AND enabled=1 AND couple_id=%s",(dish_id,user["coupleId"])): raise AppError("这道菜找不到啦",404)
    execute("INSERT IGNORE INTO favorites (user_id,dish_id) VALUES (%s,%s)",(user["id"],dish_id)); return success(message="收藏好啦 ❤️")

@app.delete("/api/dishes/{dish_id}/favorite")
def unfavorite_dish(dish_id: int, user: dict=Depends(coupled_user)):
    execute("DELETE FROM favorites WHERE user_id=%s AND dish_id=%s",(user["id"],dish_id)); return success(message="已经取消收藏")

@app.get("/api/recommendations/today")
def recommendations(request: Request, user: dict=Depends(coupled_user)):
    ensure_menu(user["coupleId"]); rows=fetch_all("""SELECT d.id,d.name,d.description,d.image_url AS imageUrl,d.calorie_kcal AS calorieKcal,d.calorie_unit AS calorieUnit,c.name AS categoryName,EXISTS(SELECT 1 FROM favorites f WHERE f.dish_id=d.id AND f.user_id=%s) AS isFavorite,(SELECT MAX(o.completed_at) FROM order_items i JOIN orders o ON o.id=i.order_id WHERE i.dish_id=d.id AND o.couple_id=%s AND o.status='completed') AS lastEatenAt FROM dishes d JOIN categories c ON c.id=d.category_id WHERE d.enabled=1 AND d.couple_id=%s""",(user["id"],user["coupleId"],user["coupleId"]))
    def score(row):
        last=row.get("lastEatenAt"); days=30
        if last:
            try: days=max(0,(datetime.now()-last).days)
            except TypeError: pass
        return random.random()*10+(3 if row["isFavorite"] else 0)+min(days,30)/10-(6 if days<=3 else 0)
    count=clamp(int(number(request.query_params.get("count"),1) or 1),1,3)
    return success(sorted(rows,key=score,reverse=True)[:count])

@app.post("/api/orders")
async def create_order(request: Request, user: dict=Depends(coupled_user)):
    ensure_menu(user["coupleId"]); body=await request.json(); raw=body.get("items") if isinstance(body.get("items"),list) else []
    if not raw or len(raw)>30: raise AppError("先选一道想吃的吧")
    quantities={}
    for item in raw:
        dish_id=int(number(item.get("dishId"),0) or 0)
        if dish_id: quantities[dish_id]=clamp(int(number(item.get("quantity"),1) or 1),1,20)
    ids=list(quantities)
    if not ids: raise AppError("点菜单里没有有效菜品")
    marks=",".join(["%s"]*len(ids)); dishes_rows=fetch_all(f"SELECT id,name,image_url AS imageUrl,calorie_kcal AS calorieKcal,calorie_unit AS calorieUnit FROM dishes WHERE enabled=1 AND couple_id=%s AND id IN ({marks})",[user["coupleId"],*ids])
    if len(dishes_rows)!=len(ids): raise AppError("有菜品已经下架，请刷新点菜单")
    meal_type=body.get("mealType") if body.get("mealType") in ("breakfast","lunch","dinner","late_night","snack","casual") else "dinner"; meal_date=body.get("mealDate") if re.fullmatch(r"\d{4}-\d{2}-\d{2}",str(body.get("mealDate",""))) else date.today().isoformat()
    total=sum((dish.get("calorieKcal") or 0)*quantities[dish["id"]] for dish in dishes_rows) or None
    target=fetch_one("SELECT u.id,u.openid FROM couple_members cm JOIN users u ON u.id=cm.user_id WHERE cm.couple_id=%s AND cm.left_at IS NULL AND u.id<>%s LIMIT 1",(user["coupleId"],user["id"]))
    with connection(transaction=True) as conn:
        order_id,_=execute("INSERT INTO orders (order_no,couple_id,creator_user_id,target_user_id,meal_type,meal_date,message,total_calories) VALUES (%s,%s,%s,%s,%s,%s,%s,%s)",(f"LT{int(time.time()*1000)}{random.randint(100,999)}",user["coupleId"],user["id"],target["id"] if target else None,meal_type,meal_date,text(body.get("message"),300) or None,total),conn)
        for dish in dishes_rows: execute("INSERT INTO order_items (order_id,dish_id,dish_name,dish_image_url,dish_calorie_kcal,dish_calorie_unit,quantity,note) VALUES (%s,%s,%s,%s,%s,%s,%s,NULL)",(order_id,dish["id"],dish["name"],dish["imageUrl"],dish["calorieKcal"],dish["calorieUnit"],quantities[dish["id"]]),conn)
    labels={"breakfast":"早餐","lunch":"午餐","dinner":"晚餐","late_night":"夜宵","snack":"零食","casual":"随便吃点"}; notification=await notify_created(user,target,{"id":order_id,"title":labels[meal_type],"dishNames":"、".join(d["name"] for d in dishes_rows),"message":body.get("message"),"mealDate":meal_date})
    return success({"id":order_id,"notification":notification},"点菜成功啦")

ORDER_COLUMNS="""o.id,o.order_no AS orderNo,o.couple_id AS coupleId,o.creator_user_id AS creatorUserId,o.target_user_id AS targetUserId,o.meal_type AS mealType,DATE_FORMAT(o.meal_date,'%Y-%m-%d') AS mealDate,o.message,o.status,o.total_calories AS totalCalories,DATE_FORMAT(o.created_at,'%Y-%m-%d %H:%i') AS createdAt,DATE_FORMAT(o.ready_at,'%Y-%m-%d %H:%i') AS readyAt,u.nickname AS creatorName,t.nickname AS targetName"""

@app.get("/api/orders")
def orders(request: Request, user: dict=Depends(coupled_user)):
    where=["o.couple_id=%s"]; scope=request.query_params.get("scope")
    if scope=="history": where.append("o.status IN ('ready','completed','cancelled')")
    if scope=="active": where.append("o.status IN ('pending','accepted','preparing')")
    rows=fetch_all(f"SELECT {ORDER_COLUMNS} FROM orders o JOIN users u ON u.id=o.creator_user_id LEFT JOIN users t ON t.id=o.target_user_id WHERE {' AND '.join(where)} ORDER BY o.created_at DESC LIMIT 100",(user["coupleId"],))
    return success(order_hydrate(rows))

@app.get("/api/orders/{order_id}")
def order_detail(order_id: int, user: dict=Depends(coupled_user)):
    row=fetch_one(f"SELECT {ORDER_COLUMNS} FROM orders o JOIN users u ON u.id=o.creator_user_id LEFT JOIN users t ON t.id=o.target_user_id WHERE o.id=%s AND o.couple_id=%s",(order_id,user["coupleId"]))
    if not row: raise AppError("这次点菜记录找不到啦",404)
    return success(order_hydrate([row])[0])

@app.put("/api/orders/{order_id}/status")
async def update_order_status(order_id: int, request: Request, user: dict=Depends(coupled_user)):
    order=fetch_one("SELECT status FROM orders WHERE id=%s AND couple_id=%s",(order_id,user["coupleId"]))
    if not order: raise AppError("订单找不到啦",404)
    next_status=(await request.json()).get("status"); transitions={"pending":["ready","cancelled"],"accepted":["ready","cancelled"],"preparing":["ready","cancelled"],"ready":["cancelled"],"completed":[],"cancelled":[]}
    if next_status not in transitions.get(order["status"],[]): raise AppError("现在还不能切换到这个状态")
    column={"ready":"ready_at","completed":"completed_at","cancelled":"cancelled_at"}.get(next_status)
    execute(f"UPDATE orders SET status=%s,{column}=NOW() WHERE id=%s AND couple_id=%s",(next_status,order_id,user["coupleId"]))
    return success({"status":next_status},"上菜成功啦" if next_status=="ready" else "状态更新好啦")

@app.post("/api/orders/{order_id}/serve")
async def serve_order(order_id: int, request: Request, user: dict=Depends(coupled_user)):
    body=await request.json(); image_url=text(body.get("imageUrl"),500) or None; image_key=text(body.get("imageKey"),255) or None
    with connection(transaction=True) as conn:
        order=fetch_one("SELECT status,couple_id AS coupleId FROM orders WHERE id=%s AND couple_id=%s FOR UPDATE",(order_id,user["coupleId"]),conn)
        if not order: raise AppError("订单找不到啦",404)
        if order["status"] not in ("pending","accepted","preparing"): raise AppError("这顿饭已经上过菜啦")
        execute("UPDATE orders SET status='ready',ready_at=NOW() WHERE id=%s AND couple_id=%s",(order_id,user["coupleId"]),conn)
        if image_url: execute("INSERT INTO meal_reviews (order_id,user_id,image_key,image_url) VALUES (%s,%s,%s,%s) ON DUPLICATE KEY UPDATE image_key=VALUES(image_key),image_url=VALUES(image_url)",(order_id,user["id"],image_key,image_url),conn)
    dishes_rows=fetch_all("SELECT dish_name AS dishName FROM order_items WHERE order_id=%s",(order_id,)); await notify_served({"id":order_id,"coupleId":order["coupleId"],"dishNames":"、".join(row["dishName"] for row in dishes_rows)},user["id"])
    return success({"status":"ready","imageUrl":image_url},"上菜成功啦")

@app.put("/api/orders/{order_id}/review")
async def update_review(order_id: int, request: Request, user: dict=Depends(coupled_user)):
    body=await request.json(); order=fetch_one("SELECT status FROM orders WHERE id=%s AND couple_id=%s",(order_id,user["coupleId"]))
    if not order: raise AppError("记录找不到啦",404)
    if order["status"] not in ("ready","completed"): raise AppError("上菜后才能留下饭后记录")
    existing=fetch_one("SELECT comment,image_key AS imageKey,image_url AS imageUrl FROM meal_reviews WHERE order_id=%s AND user_id=%s",(order_id,user["id"]))
    comment=text(body.get("comment"),300) if "comment" in body else (existing or {}).get("comment")
    image_url=(text(body.get("imageUrl"),500) or None) if "imageUrl" in body else (existing or {}).get("imageUrl")
    image_key=(text(body.get("imageKey"),255) or None) if "imageUrl" in body else (existing or {}).get("imageKey")
    if not comment and not image_url: raise AppError("写一句感受或上传一张照片吧")
    execute("INSERT INTO meal_reviews (order_id,user_id,comment,image_key,image_url) VALUES (%s,%s,%s,%s,%s) ON DUPLICATE KEY UPDATE comment=VALUES(comment),image_key=VALUES(image_key),image_url=VALUES(image_url),created_at=NOW()",(order_id,user["id"],comment,image_key,image_url))
    return success(message="照片保存好啦" if "imageUrl" in body else "评论保存好啦")

@app.delete("/api/orders/{order_id}/review")
def delete_review(order_id: int, user: dict=Depends(coupled_user)):
    order=fetch_one("SELECT status FROM orders WHERE id=%s AND couple_id=%s",(order_id,user["coupleId"]))
    if not order: raise AppError("记录找不到啦",404)
    if order["status"] not in ("ready","completed"): raise AppError("上菜后才能编辑饭后记录")
    review=fetch_one("SELECT id,comment,image_url AS imageUrl FROM meal_reviews WHERE order_id=%s AND user_id=%s",(order_id,user["id"]))
    if not review or not review.get("comment"): raise AppError("这条评论已经不存在啦")
    if review.get("imageUrl"): execute("UPDATE meal_reviews SET comment=NULL,created_at=NOW() WHERE id=%s",(review["id"],))
    else: execute("DELETE FROM meal_reviews WHERE id=%s",(review["id"],))
    return success(message="评论已删除")

@app.delete("/api/orders/{order_id}")
def delete_order(order_id: int, user: dict=Depends(coupled_user)):
    order=fetch_one("SELECT status FROM orders WHERE id=%s AND couple_id=%s",(order_id,user["coupleId"]))
    if not order: raise AppError("记录找不到啦",404)
    if order["status"] not in ("ready","completed","cancelled"): raise AppError("正在等待上菜的点单不能删除")
    execute("DELETE FROM orders WHERE id=%s AND couple_id=%s",(order_id,user["coupleId"])); return success(message="这条饭饭记录已删除")

@app.post("/api/orders/{order_id}/reorder")
def reorder(order_id: int, user: dict=Depends(coupled_user)):
    if not fetch_one("SELECT id FROM orders WHERE id=%s AND couple_id=%s",(order_id,user["coupleId"])): raise AppError("历史记录找不到啦",404)
    items=fetch_all("SELECT dish_id AS dishId,dish_name AS dishName,dish_image_url AS imageUrl,dish_calorie_kcal AS calorieKcal,dish_calorie_unit AS calorieUnit,quantity FROM order_items WHERE order_id=%s",(order_id,))
    return success({"items":items},"已经放回今天的小菜单啦")

@app.get("/api/notifications")
def notifications(user: dict=Depends(coupled_user)):
    items=fetch_all("SELECT id,type,title,content,order_id AS orderId,DATE_FORMAT(read_at,'%Y-%m-%d %H:%i') AS readAt,DATE_FORMAT(created_at,'%Y-%m-%d %H:%i') AS createdAt FROM notifications WHERE user_id=%s ORDER BY created_at DESC LIMIT 50",(user["id"],))
    unread=fetch_one("SELECT COUNT(*) AS unreadCount FROM notifications WHERE user_id=%s AND read_at IS NULL",(user["id"],))
    return success({"items":items,"unreadCount":unread["unreadCount"]})

@app.put("/api/notifications/read")
def read_notifications(user: dict=Depends(coupled_user)):
    execute("UPDATE notifications SET read_at=NOW() WHERE user_id=%s AND read_at IS NULL",(user["id"],)); return success()

@app.post("/api/uploads/cos-credential")
async def cos_credential(request: Request, user: dict=Depends(coupled_user)):
    body=await request.json(); mime=text(body.get("mimeType"),64); size=number(body.get("size"),0) or 0; allowed={"image/jpeg":"jpg","image/png":"png","image/webp":"webp"}
    if mime not in allowed or size<=0 or size>settings.cos_upload_max_mb*1024*1024: raise AppError(f"仅支持不超过 {settings.cos_upload_max_mb}MB 的 JPG、PNG、WEBP 图片")
    if not all([settings.cos_secret_id,settings.cos_secret_key,settings.cos_bucket,settings.cos_region]): raise AppError("图片上传暂未配置",503)
    try:
        from sts.sts import Sts
        purpose=body.get("purpose") if body.get("purpose") in ("avatar","meal") else "dish"; folder={"avatar":"avatar-images","meal":"meal-images","dish":"dish-images"}[purpose]
        key=f"{folder}/{datetime.now().year}/{datetime.now().month:02d}/{uuid.uuid4()}.{allowed[mime]}"; short_bucket=re.sub(r"-\d+$","",settings.cos_bucket); app_id=settings.cos_bucket[len(short_bucket)+1:]
        credential=Sts({"secret_id":settings.cos_secret_id,"secret_key":settings.cos_secret_key,"duration_seconds":900,"bucket":settings.cos_bucket,"region":settings.cos_region,"policy":{"version":"2.0","statement":[{"effect":"allow","action":["name/cos:PutObject"],"resource":[f"qcs::cos:{settings.cos_region}:uid/{app_id}:{short_bucket}/{key}"],"condition":{"numeric_less_than_equal":{"cos:content-length":settings.cos_upload_max_mb*1024*1024},"string_equal":{"cos:content-type":mime}}}]}}).get_credential()
    except ImportError:
        raise AppError("COS 临时凭证组件未安装，请重新安装 requirements.txt",503)
    except Exception as error:
        logger.warning("cos.credential_failed: %s",error); raise AppError("图片上传凭证获取失败",503)
    url=f"{settings.cos_base_url}/{key}" if settings.cos_base_url else f"https://{settings.cos_bucket}.cos.{settings.cos_region}.myqcloud.com/{key}"
    return success({"credentials":credential["credentials"],"startTime":credential["startTime"],"expiredTime":credential["expiredTime"],"bucket":settings.cos_bucket,"region":settings.cos_region,"key":key,"url":url})
