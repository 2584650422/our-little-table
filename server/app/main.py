"""“两个人的小饭桌”后端 HTTP API。

路由沿用小程序已经使用的 URL 和 {code, message, data} 响应结构。这个模块
集中实现登录、双人饭桌、分类/菜品、点单/饭后记录、订阅提醒和图片上传。
所有饭桌业务接口都从登录令牌取得用户，再用令牌对应的 coupleId 限定查询范围；
不能相信客户端自行提交的 userId 或 coupleId。
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
from fastapi import BackgroundTasks, Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .config import settings
from .db import connection, execute, fetch_all, fetch_one
from . import storage

logging.basicConfig(level=getattr(logging, settings.log_level, logging.INFO),
                    format="%(asctime)s %(levelname)s pid=%(process)d %(message)s")
# httpx logs full request URLs at INFO, and WeChat code2session URLs contain
# AppSecret and one-time login codes in query parameters. Never emit those URLs.
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)
logging.getLogger("qcloud_cos").setLevel(logging.WARNING)
logger = logging.getLogger("little_table")
app = FastAPI(title="两个人的小饭桌 API", docs_url=None, redoc_url=None)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=False,
                   allow_methods=["*"], allow_headers=["*"])

class AppError(Exception):
    """可预期的业务错误；由统一处理器转换成小程序可识别的 JSON 响应。"""
    def __init__(self, message: str, status: int = 400, code: Optional[int] = None):
        self.message, self.status, self.code = message, status, code or status

def success(data: Any = None, message: str = "ok") -> dict:
    """成功响应统一使用 code/message/data 信封，保持小程序请求层兼容。"""
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
    """把 JWT_EXPIRES_IN 的 7d、12h、30m 等配置换算为过期时间。"""
    match = re.fullmatch(r"(\d+)([dhm]?)", settings.jwt_expires_in.strip())
    amount, unit = (int(match.group(1)), match.group(2)) if match else (7, "d")
    return datetime.utcnow() + timedelta(days=amount) if unit == "d" else datetime.utcnow() + timedelta(hours=amount) if unit == "h" else datetime.utcnow() + timedelta(minutes=amount)

def sign(user: dict) -> str:
    return jwt.encode({"sub": str(user["id"]), "exp": expiration()}, settings.jwt_secret, algorithm="HS256")

def hydrate_image(row: dict, key_field: str = "imageKey", url_field: str = "imageUrl") -> dict:
    """Replace a stored Object Key with a fresh private COS read URL."""
    row[url_field] = storage.signed_url(row.get(key_field), row.get(url_field))
    return row

def hydrate_avatar(row: dict) -> dict:
    return hydrate_image(row, "avatarKey", "avatarUrl")

def user_from_token(request: Request) -> dict:
    """验证 Authorization Bearer 令牌，并从数据库加载最新用户资料。"""
    raw = request.headers.get("authorization", "")
    token = re.sub(r"^Bearer\s+", "", raw, flags=re.I)
    if not token:
        raise AppError("请先登录", 401)
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
    except jwt.PyJWTError:
        raise AppError("登录状态已失效", 401)
    user = fetch_one(
        "SELECT id,openid,nickname,"
        "avatar_key AS avatarKey,"
        "avatar_url AS avatarUrl,"
        "couple_id AS coupleId "
        "FROM users WHERE id=%s", (payload.get("sub"),))
    if not user:
        raise AppError("登录状态已失效", 401)
    return hydrate_avatar(user)

def current_user(request: Request) -> dict:
    return user_from_token(request)

def coupled_user(request: Request) -> dict:
    """仅允许已加入一个小饭桌的用户继续访问饭桌业务接口。"""
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
    # Avoid dumping exception strings/tracebacks from outbound HTTP clients;
    # those can contain URLs with credentials in their query parameters.
    logger.error("http.request.failed requestId=%s path=%s errorType=%s",
                 getattr(request.state, "request_id", ""), request.url.path, type(error).__name__)
    return JSONResponse(status_code=500, content={"code": 500, "message": "服务开了个小差，请稍后再试",
        "data": {"requestId": getattr(request.state, "request_id", "")}})

@app.middleware("http")
async def request_log(request: Request, call_next):
    """为每次 HTTP 请求生成关联 ID，记录耗时和状态并回传响应头。"""
    request.state.request_id = str(request.headers.get("x-request-id") or uuid.uuid4())[:80]
    started = time.perf_counter()
    response = await call_next(request)
    response.headers["X-Request-Id"] = request.state.request_id
    benign_probe = request.url.path == "/health" or (request.method == "GET" and request.url.path == "/" and response.status_code == 404)
    log = logger.error if response.status_code >= 500 else logger.debug if benign_probe else logger.warning if response.status_code >= 400 else logger.info
    log("http.request.completed requestId=%s method=%s path=%s status=%s durationMs=%.1f",
        request.state.request_id, request.method, request.url.path, response.status_code, (time.perf_counter()-started)*1000)
    return response

def ensure_menu(couple_id: int) -> None:
    """首次为饭桌复制默认分类和菜品。

    同一个 couple_id 使用 MySQL 命名锁串行初始化，防止两名成员首次同时打开
    菜单时复制出两份默认数据。初始化和复制发生在同一个事务中。
    """
    lock_name = f"little_table_menu_{couple_id}"
    with connection(transaction=True) as conn:
        lock = fetch_one("SELECT GET_LOCK(%s, 5) AS acquired", (lock_name,), conn)
        if not lock or not lock["acquired"]:
            raise AppError("初始化饭桌菜单超时，请重试", 503)
        try:
            exists = fetch_one("SELECT COUNT(*) AS count FROM categories WHERE couple_id=%s", (couple_id,), conn)
            if not exists["count"]:
                execute("INSERT INTO categories (couple_id,name,sort_order,enabled) SELECT %s,name,sort_order,enabled FROM starter_categories WHERE enabled=1", (couple_id,), conn)
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
    return hydrate_image(row)

DISH_SELECT = """SELECT d.id,d.name,d.description,d.image_key AS imageKey,d.image_url AS imageUrl,d.calorie_kcal AS calorieKcal,d.calorie_unit AS calorieUnit,d.calorie_note AS calorieNote,d.serving_note AS servingNote,d.cook_time_minutes AS cookTimeMinutes,d.difficulty,d.spicy_level AS spicyLevel,d.tags,d.enabled,d.couple_id AS coupleId,d.sort_order AS sortOrder,c.id AS categoryId,c.name AS categoryName,
EXISTS(SELECT 1 FROM favorites f WHERE f.dish_id=d.id AND f.user_id=%s) AS isFavorite,
(SELECT COUNT(DISTINCT oi.order_id) FROM order_items oi JOIN orders oo ON oo.id=oi.order_id WHERE oo.couple_id=%s AND oo.status<>'cancelled' AND (oi.dish_id=d.id OR oi.dish_name=d.name)) AS orderedCount FROM dishes d JOIN categories c ON c.id=d.category_id"""

def couple_public_id(couple_id: int, conn=None) -> str:
    row = fetch_one("SELECT public_id AS publicId FROM couples WHERE id=%s", (couple_id,), conn)
    if not row:
        raise AppError("小饭桌找不到啦", 404)
    return row["publicId"]

def owned_key_or_error(key: Optional[str], public_id: str) -> Optional[str]:
    if not key:
        return None
    if not storage.is_couple_key(key, public_id):
        raise AppError("图片不属于当前小饭桌，请重新上传", 403)
    return key

def delete_unreferenced_image(key: Optional[str]) -> bool:
    """仅当数据库中没有任何记录引用图片时才从 COS 删除对象。

    同一张图可能同时被菜品、历史点单快照、饭后记录、头像或饭桌背景引用；
    任何一个引用仍存在，都必须保留原图。
    """
    if not key:
        return False
    references=fetch_one("""SELECT
        (SELECT COUNT(*) FROM dishes WHERE image_key=%s)+
        (SELECT COUNT(*) FROM users WHERE avatar_key=%s)+
        (SELECT COUNT(*) FROM order_items WHERE dish_image_key=%s)+
        (SELECT COUNT(*) FROM meal_reviews WHERE image_key=%s)+
        (SELECT COUNT(*) FROM couples WHERE background_image_key=%s) AS count""",(key,key,key,key,key))
    if references["count"]:
        return False
    storage.delete_keys([key])
    return True

def dish_payload(body: dict, public_id: str):
    category_id = int(number(body.get("categoryId"), 0) or 0); name = text(body.get("name"), 80)
    if not category_id or not name: raise AppError("菜名和分类都要填写哦")
    calorie = number(body.get("calorieKcal")); cook_time = number(body.get("cookTimeMinutes"))
    tags = body.get("tags") if isinstance(body.get("tags"), list) else []
    spicy = number(body.get("spicyLevel"))
    image_key = owned_key_or_error(text(body.get("imageKey"), 255) or None, public_id)
    # Object URLs are intentionally not persisted: private reads are signed per response.
    return (category_id, name, text(body.get("description"),255) or None, image_key, None,
        max(0, round(calorie)) if calorie is not None else None, text(body.get("calorieUnit"),16,"份") or "份", text(body.get("calorieNote"),80,"家庭做法估算值"), text(body.get("servingNote"),80) or None,
        max(0, round(cook_time)) if cook_time is not None else None, body.get("difficulty") if body.get("difficulty") in ("easy","medium","hard") else None,
        clamp(int(spicy),0,5) if spicy is not None else None, json.dumps(tags[:8], ensure_ascii=False), int(number(body.get("sortOrder"),0) or 0))

def order_hydrate(rows: list[dict]) -> list[dict]:
    if not rows: return rows
    ids = [row["id"] for row in rows]; marks = ",".join(["%s"] * len(ids))
    items = fetch_all(f"SELECT id,order_id AS orderId,dish_id AS dishId,dish_name AS dishName,dish_image_key AS imageKey,dish_image_url AS dishImageUrl,dish_calorie_kcal AS dishCalorieKcal,dish_calorie_unit AS dishCalorieUnit,quantity,note FROM order_items WHERE order_id IN ({marks}) ORDER BY id", ids)
    reviews = fetch_all(f"SELECT r.order_id AS orderId,r.user_id AS userId,u.nickname,u.avatar_key AS avatarKey,u.avatar_url AS avatarUrl,r.comment,r.image_key AS imageKey,r.image_url AS imageUrl,DATE_FORMAT(r.created_at, '%Y-%m-%d %H:%i') AS createdAt FROM meal_reviews r JOIN users u ON u.id=r.user_id WHERE r.order_id IN ({marks}) ORDER BY r.created_at ASC", ids)
    for item in items:
        item["dishImageUrl"] = storage.signed_url(item.get("imageKey"), item.get("dishImageUrl"))
    for review in reviews:
        hydrate_image(review)
        hydrate_avatar(review)
    for row in rows:
        row_reviews = [review for review in reviews if review["orderId"] == row["id"]]
        row["items"] = [item for item in items if item["orderId"] == row["id"]]
        row["reviews"] = row_reviews
        row["servedImageUrl"] = next((review.get("imageUrl") for review in row_reviews if review.get("imageUrl")), None)
    return rows

async def code2session(code: str) -> dict:
    """用小程序临时登录 code 向微信换取 openid；AppSecret 只在服务端使用。"""
    if not settings.wechat_app_id or not settings.wechat_app_secret: raise AppError("微信登录尚未配置", 503)
    async with httpx.AsyncClient(timeout=8) as client:
        response = await client.get("https://api.weixin.qq.com/sns/jscode2session", params={"appid":settings.wechat_app_id,"secret":settings.wechat_app_secret,"js_code":code,"grant_type":"authorization_code"})
    data = response.json()
    if data.get("errcode") or not data.get("openid"): raise AppError(f"微信登录失败：{data.get('errmsg','无 openid')}", 401)
    return data

_access_token = {"value":"", "expires":0.0}
SUBSCRIPTION_CREDIT_MAX = 10

# 微信一次性订阅授权按用户、模板分别记账。created 是点菜提醒，served 是上菜完成提醒。
def subscribe_template(event: str) -> tuple[str,list[tuple[str,str]]]:
    if event == "served":
        return settings.wechat_served_template_id,[(settings.wechat_served_user_key,"reminderUser"),(settings.wechat_served_dish_name_key,"dishNames")]
    return settings.wechat_template_id,[(settings.wechat_template_user_key,"creatorName"),(settings.wechat_dish_key,"dishNames"),(settings.wechat_message_key,"message")]

def valid_subscribe_template(event: str) -> bool:
    template_id,fields=subscribe_template(event)
    return bool(template_id and settings.wechat_app_id and settings.wechat_app_secret and all(key for key,_ in fields))

def subscription_templates() -> dict[str,str]:
    return {event:subscribe_template(event)[0] for event in ("created","served") if valid_subscribe_template(event)}

def record_subscription_grants(user_id: int, template_ids: list[str], request_id: str) -> dict[str,int]:
    """记录一次微信授权，并按模板把可用机会加一，余额最多为 10。

    request_id 与模板 ID 组成去重依据；同一次授权接口重试不会重复增加机会。
    微信回报用户同意了模板，不代表未来一定送达，因此这里只登记机会，不发消息。
    """
    available=subscription_templates()
    by_id={template_id:event for event,template_id in available.items()}
    added={}
    with connection(transaction=True) as conn:
        for template_id in set(template_ids):
            event=by_id.get(template_id)
            if not event: continue
            _,changed=execute("INSERT IGNORE INTO wechat_subscription_grants (user_id,request_id,template_id,event) VALUES (%s,%s,%s,%s)",(user_id,request_id,template_id,event),conn)
            if changed:
                _,credit_changed=execute("INSERT INTO wechat_subscription_credits (user_id,template_id,event,available_count) VALUES (%s,%s,%s,1) ON DUPLICATE KEY UPDATE available_count=LEAST(%s,available_count+1)",(user_id,template_id,event,SUBSCRIPTION_CREDIT_MAX),conn)
                if credit_changed: added[event]=added.get(event,0)+1
    return added

def reserve_subscription_credit(user_id: int, template_id: str) -> bool:
    """发送前原子扣减一个提醒机会；余额不足则不调用微信发送接口。"""
    with connection(transaction=True) as conn:
        row=fetch_one("SELECT available_count FROM wechat_subscription_credits WHERE user_id=%s AND template_id=%s FOR UPDATE",(user_id,template_id),conn)
        if not row or row["available_count"]<1: return False
        execute("UPDATE wechat_subscription_credits SET available_count=available_count-1 WHERE user_id=%s AND template_id=%s",(user_id,template_id),conn)
        return True

def refund_subscription_credit(user_id: int, template_id: str) -> None:
    """微信接口异常或拒绝时退回已预扣的机会，避免无效消耗。"""
    execute("UPDATE wechat_subscription_credits SET available_count=LEAST(%s,available_count+1) WHERE user_id=%s AND template_id=%s",(SUBSCRIPTION_CREDIT_MAX,user_id,template_id))

async def send_subscribe(member: dict, order: dict, event: str = "created", page: Optional[str] = None) -> dict:
    """使用成员的一次性订阅机会发送微信模板消息。

    发送前先扣次数，成功后不退回；若微信明确表示用户已无授权(43101)，
    将余额同步为 0；其他失败会退款。返回值表示微信接口是否接受请求，
    并不等于用户已阅读消息。
    """
    template_id,fields=subscribe_template(event)
    if not valid_subscribe_template(event):
        logger.info("wechat.subscribe_skipped event=%s orderId=%s reason=not_configured",event,order["id"])
        return {"sent":False,"reason":"微信提醒暂未配置"}
    if not reserve_subscription_credit(member["id"],template_id):
        logger.info("wechat.subscribe_skipped event=%s orderId=%s userId=%s reason=no_subscription_credit",event,order["id"],member["id"])
        return {"sent":False,"reason":"对方暂时没有可用的微信提醒次数"}
    try:
        if _access_token["expires"] < time.time()+60:
            async with httpx.AsyncClient(timeout=8) as client:
                response = await client.get("https://api.weixin.qq.com/cgi-bin/token", params={"grant_type":"client_credential","appid":settings.wechat_app_id,"secret":settings.wechat_app_secret})
            token_data = response.json()
            if token_data.get("errcode") or not token_data.get("access_token"): raise RuntimeError(token_data.get("errmsg","access token unavailable"))
            _access_token.update(value=token_data["access_token"],expires=time.time()+int(token_data.get("expires_in",7200)))
        fallbacks={"creatorName":"对方","reminderUser":"对方","dishNames":"这顿饭","message":"今天想吃这些，点开看看吧"}
        payload_data={key:{"value":str(order.get(source) or fallbacks.get(source,"-"))[:20]} for key,source in fields}
        payload = {"touser":member["openid"],"template_id":template_id,"page":page or f"{settings.wechat_order_page}?id={order['id']}","data":payload_data}
        async with httpx.AsyncClient(timeout=8) as client:
            response = await client.post(f"https://api.weixin.qq.com/cgi-bin/message/subscribe/send?access_token={_access_token['value']}", json=payload)
        result=response.json()
        if result.get("errcode"):
            if result.get("errcode")==43101:
                execute("UPDATE wechat_subscription_credits SET available_count=0 WHERE user_id=%s AND template_id=%s",(member["id"],template_id))
            else:
                refund_subscription_credit(member["id"],template_id)
            logger.warning("wechat.subscribe_rejected event=%s orderId=%s userId=%s errcode=%s",event,order["id"],member["id"],result.get("errcode"))
            return {"sent":False,"reason":"微信提醒未送达，站内消息已送达","errcode":result.get("errcode")}
        return {"sent":True}
    except Exception:
        refund_subscription_credit(member["id"],template_id)
        raise

async def notify_created(creator: dict, target: Optional[dict], order: dict) -> dict:
    """写入点单成功和新点单两类站内通知，不在这里直接发送微信消息。"""
    execute("INSERT INTO notifications (user_id,type,title,content,order_id) VALUES (%s,'order_created',%s,%s,%s)", (creator["id"],"点菜成功啦",f"已提交：{order['dishNames']}",order["id"]))
    if target: execute("INSERT INTO notifications (user_id,type,title,content,order_id) VALUES (%s,'new_order',%s,%s,%s)", (target["id"],"今天想吃这些",order["dishNames"],order["id"]))
    return {"creator":{"sent":True,"channel":"in_app"},"target":{"sent":bool(target),"channel":"in_app" if target else None}}

async def deliver_wechat(recipients: list[dict], order: dict, event: str):
    """逐个发送订阅提醒并吞掉单个收件人的发送异常，避免影响点单主流程。"""
    for member in recipients:
        try: await send_subscribe(member,order,event)
        except Exception as error: logger.warning("wechat.subscribe_failed event=%s orderId=%s userId=%s errorType=%s",event,order["id"],member["id"],type(error).__name__)

async def notify_served(order: dict, served_by: int):
    """给饭桌当前成员写入上菜站内通知；调用方另行安排微信订阅消息。"""
    members=fetch_all("SELECT u.id,u.openid FROM couple_members cm JOIN users u ON u.id=cm.user_id WHERE cm.couple_id=%s AND cm.left_at IS NULL",(order["coupleId"],))
    for member in members:
        execute("INSERT INTO notifications (user_id,type,title,content,order_id) VALUES (%s,'order_served',%s,%s,%s)",(member["id"],"上菜成功啦",order["dishNames"],order["id"]))
    return members

@app.get("/health")
def health(request: Request):
    """健康检查同时探测 MySQL；数据库不可用时返回 503，便于部署平台告警。"""
    try:
        fetch_one("SELECT 1 AS connected")
        return success({"status":"ok","database":"connected","pid":os.getpid(),"requestId":request.state.request_id})
    except Exception:
        return JSONResponse(status_code=503, content={"code":503,"message":"数据库尚未连接","data":{"status":"degraded","database":"disconnected","pid":os.getpid(),"requestId":request.state.request_id}})

# 登录与个人资料：令牌的 subject 保存 users.id；用户资料每次从数据库读取。
@app.post("/api/auth/wechat")
async def auth_wechat(request: Request):
    """微信登录入口：code 换 openid，再创建/读取用户并签发业务 JWT。"""
    body=await request.json(); code=text(body.get("code"),255)
    if not code: raise AppError("缺少微信登录凭证")
    session=await code2session(code)
    execute("INSERT INTO users (openid) VALUES (%s) ON DUPLICATE KEY UPDATE updated_at=NOW()",(session["openid"],))
    user=fetch_one("SELECT id,nickname,avatar_key AS avatarKey,avatar_url AS avatarUrl,couple_id AS coupleId FROM users WHERE openid=%s",(session["openid"],))
    hydrate_avatar(user)
    return success({"token":sign(user),"user":user})

@app.post("/api/auth/dev")
async def auth_dev(request: Request):
    """仅供非生产环境本地联调的登录入口，生产环境始终拒绝访问。"""
    if not settings.dev_login_enabled or settings.environment == "production": raise AppError("开发登录未开启",404)
    body=await request.json(); identity=re.sub(r"[^a-zA-Z0-9_-]","",str(body.get("identity","one")))[:24]
    execute("INSERT INTO users (openid,nickname) VALUES (%s,%s) ON DUPLICATE KEY UPDATE updated_at=NOW()",(f"dev_{identity}", text(body.get("nickname"),30,"本地体验用户") or "本地体验用户"))
    user=fetch_one("SELECT id,nickname,avatar_key AS avatarKey,avatar_url AS avatarUrl,couple_id AS coupleId FROM users WHERE openid=%s",(f"dev_{identity}",))
    hydrate_avatar(user)
    return success({"token":sign(user),"user":user})

@app.get("/api/auth/me")
def auth_me(user: dict=Depends(current_user)): return success(user)

@app.put("/api/auth/me")
async def update_me(request: Request, user: dict=Depends(current_user)):
    """更新当前用户称呼和头像；替换头像后清理不再被引用的旧对象。"""
    body=await request.json(); nickname=text(body.get("nickname"),30)
    if not nickname: raise AppError("告诉我该怎么称呼你吧")
    public_id = couple_public_id(user["coupleId"]) if user.get("coupleId") else None
    avatar_key = body.get("avatarImageKey") if "avatarImageKey" in body else user.get("avatarKey")
    avatar_key = owned_key_or_error(text(avatar_key, 255) or None, public_id) if public_id else None
    # Legacy avatarUrl is only kept if there is no object key, so historical data still displays.
    avatar = None if avatar_key else (text(body.get("avatarUrl", user.get("avatarUrl")), 500) or None)
    with connection(transaction=True) as conn:
        current=fetch_one("SELECT avatar_key AS avatarKey FROM users WHERE id=%s FOR UPDATE",(user["id"],),conn)
        old_key=current.get("avatarKey") if current else None
        execute("UPDATE users SET nickname=%s,avatar_key=%s,avatar_url=%s WHERE id=%s",(nickname,avatar_key,avatar,user["id"]),conn)
    if old_key and old_key != avatar_key:
        try:
            deleted=delete_unreferenced_image(old_key)
            logger.info("cos.avatar_old_image_cleanup userId=%s deleted=%s key=%s",user["id"],deleted,old_key)
        except Exception:
            # The new avatar is already saved; a COS cleanup failure must not
            # make the client retry the profile update or lose the new image.
            logger.error("cos.avatar_cleanup_failed userId=%s key=%s",user["id"],old_key)
    user.update(nickname=nickname,avatarKey=avatar_key,avatarUrl=storage.signed_url(avatar_key,avatar)); return success(user,"称呼记住啦")

# 小饭桌成员与资料：每个查询都以令牌中的用户身份和当前 coupleId 做数据隔离。
@app.get("/api/couples/mine")
def couples_mine(user: dict=Depends(current_user)):
    rows=fetch_all("""SELECT c.id,c.public_id AS publicId,c.name,DATE_FORMAT(c.anniversary,'%Y-%m-%d') AS anniversary,c.home_title AS homeTitle,c.home_subtitle AS homeSubtitle,DATE_FORMAT(cm.joined_at,'%Y-%m-%d %H:%i') AS joinedAt,c.id=%s AS isCurrent,(SELECT COUNT(*) FROM couple_members m WHERE m.couple_id=c.id AND m.left_at IS NULL) AS memberCount FROM couple_members cm JOIN couples c ON c.id=cm.couple_id WHERE cm.user_id=%s AND cm.left_at IS NULL ORDER BY isCurrent DESC,cm.joined_at DESC""",(user.get("coupleId") or 0,user["id"]))
    return success(rows)

@app.post("/api/couples")
async def create_couple(request: Request, user: dict=Depends(current_user)):
    """创建仅容纳两名成员的小饭桌，并复制一份专属默认菜单。"""
    body=await request.json(); name=text(body.get("name"),50,"我们的小饭桌") or "我们的小饭桌"
    with connection(transaction=True) as conn:
        couple_id,_=execute("INSERT INTO couples (public_id,name,invite_code,invite_expire_at,home_title,home_subtitle) VALUES (%s,%s,%s,DATE_ADD(NOW(),INTERVAL 7 DAY),%s,%s)",(str(uuid.uuid4()),name,uuid.uuid4().hex[:8].upper(),"今天想吃什么？","和你一起吃饭，就是好日子"),conn)
        execute("INSERT INTO couple_members (couple_id,user_id) VALUES (%s,%s)",(couple_id,user["id"]),conn)
        execute("UPDATE users SET couple_id=%s WHERE id=%s",(couple_id,user["id"]),conn)
        execute("UPDATE couples SET created_by=%s WHERE id=%s",(user["id"],couple_id),conn)
    ensure_menu(couple_id)
    couple=fetch_one("SELECT id,public_id AS publicId,name,invite_code AS inviteCode FROM couples WHERE id=%s",(couple_id,))
    return success(couple,"小饭桌创建好啦")

@app.post("/api/couples/join")
async def join_couple(request: Request, user: dict=Depends(current_user)):
    """校验邀请码和饭桌人数后加入；成功使用后关闭邀请码，避免重复加入。"""
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
    couple=fetch_one("SELECT id,public_id AS publicId,name,invite_code AS inviteCode,DATE_FORMAT(invite_expire_at,'%Y-%m-%d %H:%i') AS inviteExpireAt,DATE_FORMAT(anniversary,'%Y-%m-%d') AS anniversary,home_title AS homeTitle,home_subtitle AS homeSubtitle,background_image_key AS backgroundImageKey,created_by AS createdBy,DATE_FORMAT(created_at,'%Y-%m-%d %H:%i') AS createdAt FROM couples WHERE id=%s",(user["coupleId"],))
    couple["backgroundImageUrl"]=storage.signed_url(couple.get("backgroundImageKey"))
    members=fetch_all("SELECT u.id,u.nickname,u.avatar_key AS avatarKey,u.avatar_url AS avatarUrl FROM couple_members cm JOIN users u ON u.id=cm.user_id WHERE cm.couple_id=%s AND cm.left_at IS NULL ORDER BY cm.joined_at,u.id",(user["coupleId"],))
    for member in members: hydrate_avatar(member)
    stats=fetch_one("""SELECT COUNT(*) AS meals,
        SUM(CASE WHEN COALESCE(ready_at,completed_at,created_at)>=DATE_FORMAT(CURDATE(),'%Y-%m-01')
                  AND COALESCE(ready_at,completed_at,created_at)<DATE_FORMAT(DATE_ADD(CURDATE(),INTERVAL 1 MONTH),'%Y-%m-01')
                 THEN 1 ELSE 0 END) AS monthlyMeals
        FROM orders WHERE couple_id=%s AND status IN ('ready','completed')""",(user["coupleId"],))
    couple.update(members=members,stats=stats); return success(couple)

@app.put("/api/couples/current")
async def update_couple(request: Request, user: dict=Depends(coupled_user)):
    """更新饭桌名称、纪念日、首页文案和背景图；两位成员共用这些资料。"""
    body=await request.json(); name=text(body.get("name"),50)
    if not name: raise AppError("小饭桌也要有个名字呀")
    anniversary=body.get("anniversary") or None; title=text(body.get("homeTitle"),80,"今天想吃什么？") or "今天想吃什么？"; subtitle=text(body.get("homeSubtitle"),120,"和你一起吃饭，就是好日子") or "和你一起吃饭，就是好日子"
    public_id=couple_public_id(user["coupleId"])
    with connection(transaction=True) as conn:
        previous=fetch_one("SELECT background_image_key AS backgroundImageKey FROM couples WHERE id=%s FOR UPDATE",(user["coupleId"],),conn)
        old_key=previous.get("backgroundImageKey")
        new_key=owned_key_or_error(text(body.get("backgroundImageKey"),255) or None,public_id) if "backgroundImageKey" in body else old_key
        execute("UPDATE couples SET name=%s,anniversary=%s,home_title=%s,home_subtitle=%s,background_image_key=%s WHERE id=%s",(name,anniversary,title,subtitle,new_key,user["coupleId"]),conn)
    if old_key and old_key!=new_key:
        try: delete_unreferenced_image(old_key)
        except Exception as error: logger.error("cos.background_cleanup_failed coupleId=%s errorType=%s",user["coupleId"],type(error).__name__)
    return success({"name":name,"anniversary":anniversary,"homeTitle":title,"homeSubtitle":subtitle,"backgroundImageKey":new_key,"backgroundImageUrl":storage.signed_url(new_key)},"小饭桌更新好啦")

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
    """仅创建者可删除空出的饭桌；先清理专属 COS 目录，再删除数据库记录。"""
    couple_id=user["coupleId"]
    with connection(transaction=True) as conn:
        couple=fetch_one("SELECT created_by AS createdBy,public_id AS publicId FROM couples WHERE id=%s FOR UPDATE",(couple_id,),conn)
        if not couple or int(couple["createdBy"] or 0)!=int(user["id"]): raise AppError("只有创建者可以删除小饭桌",403)
        if member_count(couple_id,conn)>1: raise AppError("请先让另一位成员退出，再删除小饭桌")
        # Delete only this couple's isolated prefix before removing its DB scope.
        # A COS failure leaves the table intact so the user can retry safely.
        storage.delete_prefix(storage.couple_prefix(couple["publicId"]))
        fallback=fallback_couple(user["id"],couple_id,conn)
        execute("UPDATE users SET avatar_key=NULL,avatar_url=NULL WHERE avatar_key LIKE %s", (storage.couple_prefix(couple["publicId"]) + "%",), conn)
        execute("UPDATE users SET couple_id=%s WHERE id=%s",(fallback,user["id"]),conn)
        execute("DELETE FROM couples WHERE id=%s",(couple_id,),conn)
    return success({"currentCoupleId":fallback},"小饭桌已删除")

# 分类和菜品：创建或修改时都校验 couple_id，历史订单则保存菜品快照。
@app.get("/api/categories")
def categories(user: dict=Depends(coupled_user)):
    ensure_menu(user["coupleId"]); return success(fetch_all("SELECT id,name,sort_order AS sortOrder FROM categories WHERE couple_id=%s AND enabled=1 ORDER BY sort_order,id",(user["coupleId"],)))

@app.post("/api/categories")
async def create_category(request: Request, user: dict=Depends(coupled_user)):
    body=await request.json(); name=text(body.get("name"),30)
    if not name: raise AppError("分类名称不能为空")
    try: category_id,_=execute("INSERT INTO categories (couple_id,name,sort_order,created_by) VALUES (%s,%s,%s,%s)",(user["coupleId"],name,int(number(body.get("sortOrder"),0) or 0),user["id"]))
    except Exception as error:
        if getattr(error,"args",[None])[0]==1062: raise AppError("已经有同名分类啦")
        raise
    return success({"id":category_id},"分类添加好啦")

@app.put("/api/categories/reorder")
async def reorder_categories(request: Request, user: dict=Depends(coupled_user)):
    ids=(await request.json()).get("ids")
    if not isinstance(ids,list) or len(ids)>100: raise AppError("分类顺序数据不正确")
    try: normalized=[int(item) for item in ids]
    except (TypeError,ValueError): raise AppError("分类顺序数据不正确")
    if len(set(normalized))!=len(normalized): raise AppError("分类顺序不能重复")
    existing=fetch_all("SELECT id FROM categories WHERE couple_id=%s AND enabled=1 ORDER BY id",(user["coupleId"],))
    if {row["id"] for row in existing}!={*normalized}: raise AppError("分类列表已经变化，请刷新后再试")
    with connection(transaction=True) as conn:
        for index,category_id in enumerate(normalized): execute("UPDATE categories SET sort_order=%s WHERE id=%s AND couple_id=%s",((index+1)*10,category_id,user["coupleId"]),conn)
    return success(message="分类顺序已保存")

@app.put("/api/categories/{category_id}")
async def update_category(category_id: int, request: Request, user: dict=Depends(coupled_user)):
    body=await request.json(); name=text(body.get("name"),30)
    if not name: raise AppError("分类名称不能为空")
    try: _, count=execute("UPDATE categories SET name=%s,sort_order=%s WHERE id=%s AND couple_id=%s AND enabled=1",(name,int(number(body.get("sortOrder"),0) or 0),category_id,user["coupleId"]))
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
    stats=fetch_one("SELECT COUNT(*) AS eatenCount,DATE_FORMAT(MAX(COALESCE(o.completed_at,o.ready_at)),'%Y-%m-%d %H:%i') AS lastEatenAt FROM order_items i JOIN orders o ON o.id=i.order_id WHERE i.dish_id=%s AND o.couple_id=%s AND o.status IN ('ready','completed')",(dish_id,user["coupleId"]))
    dish=normalize_dish(dish); dish.update(stats); return success(dish)

@app.post("/api/dishes")
async def create_dish(request: Request, user: dict=Depends(coupled_user)):
    payload=dish_payload(await request.json(), couple_public_id(user["coupleId"])); category=fetch_one("SELECT id FROM categories WHERE id=%s AND couple_id=%s AND enabled=1",(payload[0],user["coupleId"]))
    if not category: raise AppError("请选择当前小饭桌里的分类")
    dish_id,_=execute("""INSERT INTO dishes (couple_id,category_id,name,description,image_key,image_url,calorie_kcal,calorie_unit,calorie_note,serving_note,cook_time_minutes,difficulty,spicy_level,tags,sort_order,created_by) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",(user["coupleId"],*payload,user["id"]))
    return success({"id":dish_id},"新菜加进菜单啦")

@app.put("/api/dishes/{dish_id}")
async def update_dish(dish_id: int, request: Request, user: dict=Depends(coupled_user)):
    old=fetch_one("SELECT image_key AS imageKey FROM dishes WHERE id=%s AND couple_id=%s",(dish_id,user["coupleId"]))
    if not old: raise AppError("只能编辑自己饭桌添加的菜",403)
    payload=dish_payload(await request.json(), couple_public_id(user["coupleId"])); category=fetch_one("SELECT id FROM categories WHERE id=%s AND couple_id=%s AND enabled=1",(payload[0],user["coupleId"]))
    if not category: raise AppError("请选择当前小饭桌里的分类")
    _,count=execute("""UPDATE dishes SET category_id=%s,name=%s,description=%s,image_key=%s,image_url=%s,calorie_kcal=%s,calorie_unit=%s,calorie_note=%s,serving_note=%s,cook_time_minutes=%s,difficulty=%s,spicy_level=%s,tags=%s,sort_order=%s WHERE id=%s AND couple_id=%s""",(*payload,dish_id,user["coupleId"]))
    if not count: raise AppError("只能编辑自己饭桌添加的菜",403)
    old_key, new_key = old.get("imageKey"), payload[3]
    if old_key and old_key != new_key:
        # History snapshots keep their own key, so replacing a dish never breaks old meals.
        delete_unreferenced_image(old_key)
    return success(message="菜单更新好啦")

@app.delete("/api/dishes/{dish_id}/image")
def delete_dish_image(dish_id: int, user: dict=Depends(coupled_user)):
    dish=fetch_one("SELECT image_key AS imageKey FROM dishes WHERE id=%s AND couple_id=%s",(dish_id,user["coupleId"]))
    if not dish: raise AppError("这道菜找不到啦",404)
    old_key=dish.get("imageKey")
    if not old_key: return success({"deleted":False},"这道菜还没有图片")
    execute("UPDATE dishes SET image_key=NULL,image_url=NULL WHERE id=%s AND couple_id=%s",(dish_id,user["coupleId"]))
    deleted=delete_unreferenced_image(old_key)
    return success({"deleted":deleted},"菜品图片已删除" if deleted else "已移除菜品图片，历史记录仍保留原图")

@app.delete("/api/dishes/{dish_id}")
def disable_dish(dish_id: int, user: dict=Depends(coupled_user)):
    """下架菜品而不是物理删除，保留历史订单和饭后记录中的菜品快照。"""
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
    """按收藏、距上次吃到的天数和近期重复惩罚生成轻量随机推荐。"""
    ensure_menu(user["coupleId"]); rows=fetch_all("""SELECT d.id,d.name,d.description,d.image_key AS imageKey,d.image_url AS imageUrl,d.calorie_kcal AS calorieKcal,d.calorie_unit AS calorieUnit,c.name AS categoryName,EXISTS(SELECT 1 FROM favorites f WHERE f.dish_id=d.id AND f.user_id=%s) AS isFavorite,(SELECT MAX(COALESCE(o.completed_at,o.ready_at)) FROM order_items i JOIN orders o ON o.id=i.order_id WHERE i.dish_id=d.id AND o.couple_id=%s AND o.status IN ('ready','completed')) AS lastEatenAt FROM dishes d JOIN categories c ON c.id=d.category_id WHERE d.enabled=1 AND d.couple_id=%s""",(user["id"],user["coupleId"],user["coupleId"]))
    def score(row):
        last=row.get("lastEatenAt"); days=30
        if last:
            try: days=max(0,(datetime.now()-last).days)
            except TypeError: pass
        return random.random()*10+(3 if row["isFavorite"] else 0)+min(days,30)/10-(6 if days<=3 else 0)
    count=clamp(int(number(request.query_params.get("count"),1) or 1),1,3)
    return success([hydrate_image(row) for row in sorted(rows,key=score,reverse=True)[:count]])

@app.post("/api/orders")
async def create_order(request: Request, background_tasks: BackgroundTasks, user: dict=Depends(coupled_user)):
    """创建点单，或把新菜合并进同一饭桌同一餐次尚未完成的点单。"""
    ensure_menu(user["coupleId"]); body=await request.json(); raw=body.get("items") if isinstance(body.get("items"),list) else []
    if not raw or len(raw)>30: raise AppError("先选一道想吃的吧")
    quantities={}
    for item in raw:
        dish_id=int(number(item.get("dishId"),0) or 0)
        if dish_id: quantities[dish_id]=clamp(int(number(item.get("quantity"),1) or 1),1,20)
    ids=list(quantities)
    if not ids: raise AppError("点菜单里没有有效菜品")
    marks=",".join(["%s"]*len(ids)); dishes_rows=fetch_all(f"SELECT id,name,image_key AS imageKey,image_url AS imageUrl,calorie_kcal AS calorieKcal,calorie_unit AS calorieUnit FROM dishes WHERE enabled=1 AND couple_id=%s AND id IN ({marks})",[user["coupleId"],*ids])
    if len(dishes_rows)!=len(ids): raise AppError("有菜品已经下架，请刷新点菜单")
    meal_type=body.get("mealType") if body.get("mealType") in ("breakfast","lunch","dinner","late_night","snack","casual") else "dinner"; meal_date=body.get("mealDate") if re.fullmatch(r"\d{4}-\d{2}-\d{2}",str(body.get("mealDate",""))) else date.today().isoformat()
    total=sum((dish.get("calorieKcal") or 0)*quantities[dish["id"]] for dish in dishes_rows) or None
    target=fetch_one("SELECT u.id,u.openid FROM couple_members cm JOIN users u ON u.id=cm.user_id WHERE cm.couple_id=%s AND cm.left_at IS NULL AND u.id<>%s LIMIT 1",(user["coupleId"],user["id"]))
    merged=False
    with connection(transaction=True) as conn:
        # 锁住饭桌行，将“查找活动订单 + 创建/合并订单”作为串行操作，
        # 防止两人几乎同时提交时产生两份相同餐次的活动菜单。
        fetch_one("SELECT id FROM couples WHERE id=%s FOR UPDATE",(user["coupleId"],),conn)
        existing=fetch_one("SELECT id FROM orders WHERE couple_id=%s AND meal_type=%s AND meal_date=%s AND status IN ('pending','accepted','preparing') ORDER BY created_at DESC LIMIT 1 FOR UPDATE",(user["coupleId"],meal_type,meal_date),conn)
        if existing:
            order_id=existing["id"]; merged=True
            execute("UPDATE orders SET message=COALESCE(%s,message),total_calories=COALESCE(total_calories,0)+COALESCE(%s,0) WHERE id=%s",(text(body.get("message"),300) or None,total,order_id),conn)
            # 每个菜用行锁检查是否已在订单中：已存在则累加数量，否则写入菜品快照。
            for dish in dishes_rows:
                existing_item=fetch_one("SELECT id FROM order_items WHERE order_id=%s AND dish_id=%s ORDER BY id LIMIT 1 FOR UPDATE",(order_id,dish["id"]),conn)
                if existing_item:
                    execute("UPDATE order_items SET quantity=LEAST(quantity+%s,20) WHERE id=%s",(quantities[dish["id"]],existing_item["id"]),conn)
                else:
                    execute("INSERT INTO order_items (order_id,dish_id,dish_name,dish_image_key,dish_image_url,dish_calorie_kcal,dish_calorie_unit,quantity,note) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,NULL)",(order_id,dish["id"],dish["name"],dish.get("imageKey"),None,dish["calorieKcal"],dish["calorieUnit"],quantities[dish["id"]]),conn)
            execute("UPDATE orders SET total_calories=(SELECT SUM(COALESCE(dish_calorie_kcal,0)*quantity) FROM order_items WHERE order_id=%s) WHERE id=%s",(order_id,order_id),conn)
        else:
            order_id,_=execute("INSERT INTO orders (order_no,couple_id,creator_user_id,target_user_id,meal_type,meal_date,message,total_calories) VALUES (%s,%s,%s,%s,%s,%s,%s,%s)",(f"LT{int(time.time()*1000)}{random.randint(100,999)}",user["coupleId"],user["id"],target["id"] if target else None,meal_type,meal_date,text(body.get("message"),300) or None,total),conn)
            # order_items 保存名称、图片和热量快照；之后菜品被编辑或下架也不改历史。
            for dish in dishes_rows: execute("INSERT INTO order_items (order_id,dish_id,dish_name,dish_image_key,dish_image_url,dish_calorie_kcal,dish_calorie_unit,quantity,note) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,NULL)",(order_id,dish["id"],dish["name"],dish.get("imageKey"),None,dish["calorieKcal"],dish["calorieUnit"],quantities[dish["id"]]),conn)
    labels={"breakfast":"早餐","lunch":"午餐","dinner":"晚餐","late_night":"夜宵","snack":"零食","casual":"随便吃点"}
    if merged:
        full_dishes=fetch_all("SELECT dish_name AS dishName FROM order_items WHERE order_id=%s ORDER BY id",(order_id,))
        dish_names="、".join(dish["dishName"] for dish in full_dishes)
        summary={"id":order_id,"title":labels[meal_type],"dishNames":dish_names,"message":body.get("message"),"mealDate":meal_date,"creatorName":user["nickname"]}
        if target: execute("INSERT INTO notifications (user_id,type,title,content,order_id) VALUES (%s,'menu_updated',%s,%s,%s)",(target["id"],"菜单有更新",dish_names,order_id))
        return success({"id":order_id,"merged":True},"已加到这顿饭的菜单")
    summary={"id":order_id,"title":labels[meal_type],"dishNames":"、".join(d["name"] for d in dishes_rows),"message":body.get("message"),"mealDate":meal_date,"creatorName":user["nickname"]}
    try: notification=await notify_created(user,target,summary)
    except Exception as error:
        logger.error("notification.in_app_failed event=created orderId=%s errorType=%s",order_id,type(error).__name__)
        notification={"sent":False,"reason":"站内提醒暂时未保存"}
    if target: background_tasks.add_task(deliver_wechat,[target],summary,"created")
    return success({"id":order_id,"merged":False,"notification":notification},"点菜成功啦")

# 订单共用字段集中定义，避免列表和详情接口返回格式逐渐不一致。
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
async def update_order_status(order_id: int, request: Request, background_tasks: BackgroundTasks, user: dict=Depends(coupled_user)):
    """校验订单状态迁移；变为 ready 时写站内通知并给点单人安排微信提醒。"""
    order=fetch_one("SELECT status FROM orders WHERE id=%s AND couple_id=%s",(order_id,user["coupleId"]))
    if not order: raise AppError("订单找不到啦",404)
    next_status=(await request.json()).get("status"); transitions={"pending":["ready","cancelled"],"accepted":["ready","cancelled"],"preparing":["ready","cancelled"],"ready":["cancelled"],"completed":[],"cancelled":[]}
    if next_status not in transitions.get(order["status"],[]): raise AppError("现在还不能切换到这个状态")
    column={"ready":"ready_at","completed":"completed_at","cancelled":"cancelled_at"}.get(next_status)
    _,changed=execute(f"UPDATE orders SET status=%s,{column}=NOW() WHERE id=%s AND couple_id=%s AND status=%s",(next_status,order_id,user["coupleId"],order["status"]))
    if not changed: raise AppError("这顿饭的状态已经变化，请刷新后再试",409)
    if next_status=="ready":
        detail=fetch_one("SELECT creator_user_id AS creatorUserId,meal_type AS mealType,DATE_FORMAT(meal_date,'%Y-%m-%d') AS mealDate FROM orders WHERE id=%s",(order_id,))
        dishes=fetch_all("SELECT dish_name AS dishName FROM order_items WHERE order_id=%s",(order_id,))
        labels={"breakfast":"早餐","lunch":"午餐","dinner":"晚餐","late_night":"夜宵","snack":"零食","casual":"随便吃点"}
        summary={"id":order_id,"coupleId":user["coupleId"],"title":labels.get(detail["mealType"],"开饭"),"dishNames":"、".join(row["dishName"] for row in dishes),"mealDate":detail["mealDate"],"reminderUser":user["nickname"]}
        try:
            members=await notify_served(summary,user["id"])
            recipient=fetch_one("SELECT id,openid FROM users WHERE id=%s",(detail["creatorUserId"],)) if detail["creatorUserId"]!=user["id"] else None
            if recipient: background_tasks.add_task(deliver_wechat,[recipient],summary,"served")
        except Exception as error: logger.error("notification.in_app_failed event=served orderId=%s errorType=%s",order_id,type(error).__name__)
    return success({"status":next_status},"上菜成功啦" if next_status=="ready" else "状态更新好啦")

@app.post("/api/orders/{order_id}/serve")
async def serve_order(order_id: int, request: Request, background_tasks: BackgroundTasks, user: dict=Depends(coupled_user)):
    """一步完成上菜状态和可选照片记录，事务结束后再发送通知。"""
    body=await request.json(); public_id=couple_public_id(user["coupleId"]); image_key=owned_key_or_error(text(body.get("imageKey"),255) or None,public_id); image_url=None
    old_review_key=None
    with connection(transaction=True) as conn:
        order=fetch_one("SELECT status,couple_id AS coupleId,creator_user_id AS creatorUserId FROM orders WHERE id=%s AND couple_id=%s FOR UPDATE",(order_id,user["coupleId"]),conn)
        if not order: raise AppError("订单找不到啦",404)
        if order["status"] not in ("pending","accepted","preparing"): raise AppError("这顿饭已经上过菜啦")
        execute("UPDATE orders SET status='ready',ready_at=NOW() WHERE id=%s AND couple_id=%s",(order_id,user["coupleId"]),conn)
        if image_key:
            old_review=fetch_one("SELECT image_key AS imageKey FROM meal_reviews WHERE order_id=%s AND user_id=%s",(order_id,user["id"]),conn)
            old_review_key=(old_review or {}).get("imageKey")
            execute("INSERT INTO meal_reviews (order_id,user_id,image_key,image_url) VALUES (%s,%s,%s,%s) ON DUPLICATE KEY UPDATE image_key=VALUES(image_key),image_url=VALUES(image_url)",(order_id,user["id"],image_key,image_url),conn)
    if old_review_key and old_review_key != image_key:
        try: delete_unreferenced_image(old_review_key)
        except Exception as error: logger.error("cos.review_old_image_cleanup_failed orderId=%s errorType=%s",order_id,type(error).__name__)
    dishes_rows=fetch_all("SELECT dish_name AS dishName FROM order_items WHERE order_id=%s",(order_id,))
    detail=fetch_one("SELECT meal_type AS mealType,DATE_FORMAT(meal_date,'%Y-%m-%d') AS mealDate FROM orders WHERE id=%s",(order_id,))
    labels={"breakfast":"早餐","lunch":"午餐","dinner":"晚餐","late_night":"夜宵","snack":"零食","casual":"随便吃点"}
    summary={"id":order_id,"coupleId":order["coupleId"],"title":labels.get(detail["mealType"],"开饭"),"dishNames":"、".join(row["dishName"] for row in dishes_rows),"mealDate":detail["mealDate"],"reminderUser":user["nickname"]}
    try:
        members=await notify_served(summary,user["id"])
        recipient=fetch_one("SELECT id,openid FROM users WHERE id=%s",(order["creatorUserId"],)) if order["creatorUserId"]!=user["id"] else None
        if recipient: background_tasks.add_task(deliver_wechat,[recipient],summary,"served")
    except Exception as error: logger.error("notification.in_app_failed event=served orderId=%s errorType=%s",order_id,type(error).__name__)
    return success({"status":"ready","imageUrl":image_url},"上菜成功啦")

@app.put("/api/orders/{order_id}/review")
async def update_review(order_id: int, request: Request, user: dict=Depends(coupled_user)):
    body=await request.json(); order=fetch_one("SELECT status FROM orders WHERE id=%s AND couple_id=%s",(order_id,user["coupleId"]))
    if not order: raise AppError("记录找不到啦",404)
    if order["status"] not in ("ready","completed"): raise AppError("上菜后才能留下饭后记录")
    existing=fetch_one("SELECT comment,image_key AS imageKey,image_url AS imageUrl FROM meal_reviews WHERE order_id=%s AND user_id=%s",(order_id,user["id"]))
    comment=text(body.get("comment"),300) if "comment" in body else (existing or {}).get("comment")
    uploaded_key = "imageKey" in body
    image_key=owned_key_or_error(text(body.get("imageKey"),255) or None,couple_public_id(user["coupleId"])) if uploaded_key else (existing or {}).get("imageKey")
    image_url=None if image_key else ((existing or {}).get("imageUrl"))
    if not comment and not image_key and not image_url: raise AppError("写一句感受或上传一张照片吧")
    execute("INSERT INTO meal_reviews (order_id,user_id,comment,image_key,image_url) VALUES (%s,%s,%s,%s,%s) ON DUPLICATE KEY UPDATE comment=VALUES(comment),image_key=VALUES(image_key),image_url=VALUES(image_url),created_at=NOW()",(order_id,user["id"],comment,image_key,image_url))
    old_key=(existing or {}).get("imageKey")
    if old_key and old_key != image_key:
        try: delete_unreferenced_image(old_key)
        except Exception as error: logger.error("cos.review_old_image_cleanup_failed orderId=%s errorType=%s",order_id,type(error).__name__)
    return success(message="照片保存好啦" if uploaded_key else "评论保存好啦")

@app.delete("/api/orders/{order_id}/review")
def delete_review(order_id: int, user: dict=Depends(coupled_user)):
    order=fetch_one("SELECT status FROM orders WHERE id=%s AND couple_id=%s",(order_id,user["coupleId"]))
    if not order: raise AppError("记录找不到啦",404)
    if order["status"] not in ("ready","completed"): raise AppError("上菜后才能编辑饭后记录")
    review=fetch_one("SELECT id,comment,image_key AS imageKey,image_url AS imageUrl FROM meal_reviews WHERE order_id=%s AND user_id=%s",(order_id,user["id"]))
    if not review or not review.get("comment"): raise AppError("这条评论已经不存在啦")
    if review.get("imageKey") or review.get("imageUrl"): execute("UPDATE meal_reviews SET comment=NULL,created_at=NOW() WHERE id=%s",(review["id"],))
    else: execute("DELETE FROM meal_reviews WHERE id=%s",(review["id"],))
    return success(message="评论已删除")

@app.delete("/api/orders/{order_id}")
def delete_order(order_id: int, user: dict=Depends(coupled_user)):
    """只删除已完成/已取消订单；删除后逐一检查其快照图片是否还能被引用。"""
    order=fetch_one("SELECT status FROM orders WHERE id=%s AND couple_id=%s",(order_id,user["coupleId"]))
    if not order: raise AppError("记录找不到啦",404)
    if order["status"] not in ("ready","completed","cancelled"): raise AppError("正在等待上菜的点单不能删除")
    item_keys=fetch_all("SELECT dish_image_key AS imageKey FROM order_items WHERE order_id=%s AND dish_image_key IS NOT NULL",(order_id,))
    review_keys=fetch_all("SELECT image_key AS imageKey FROM meal_reviews WHERE order_id=%s AND image_key IS NOT NULL",(order_id,))
    execute("DELETE FROM orders WHERE id=%s AND couple_id=%s",(order_id,user["coupleId"]))
    for key in {row["imageKey"] for row in [*item_keys,*review_keys]}:
        try: delete_unreferenced_image(key)
        except Exception as error: logger.error("cos.order_image_cleanup_failed orderId=%s errorType=%s",order_id,type(error).__name__)
    return success(message="这条饭饭记录已删除")

@app.post("/api/orders/{order_id}/reorder")
def reorder(order_id: int, user: dict=Depends(coupled_user)):
    if not fetch_one("SELECT id FROM orders WHERE id=%s AND couple_id=%s",(order_id,user["coupleId"])): raise AppError("历史记录找不到啦",404)
    items=fetch_all("SELECT dish_id AS dishId,dish_name AS dishName,dish_image_key AS imageKey,dish_image_url AS imageUrl,dish_calorie_kcal AS calorieKcal,dish_calorie_unit AS calorieUnit,quantity FROM order_items WHERE order_id=%s",(order_id,))
    for item in items: hydrate_image(item)
    return success({"items":items},"已经放回今天的小菜单啦")

# 通知分两层：站内通知保存在 notifications；微信订阅消息机会单独记账并消费。
@app.get("/api/notifications")
def notifications(user: dict=Depends(coupled_user)):
    """返回当前用户最近站内通知、未读数量和订阅机会余额。"""
    items=fetch_all("SELECT id,type,title,content,order_id AS orderId,DATE_FORMAT(read_at,'%Y-%m-%d %H:%i') AS readAt,DATE_FORMAT(created_at,'%Y-%m-%d %H:%i') AS createdAt FROM notifications WHERE user_id=%s ORDER BY created_at DESC LIMIT 50",(user["id"],))
    unread=fetch_one("SELECT COUNT(*) AS unreadCount FROM notifications WHERE user_id=%s AND read_at IS NULL",(user["id"],))
    credits=fetch_all("SELECT event,available_count AS availableCount FROM wechat_subscription_credits WHERE user_id=%s",(user["id"],))
    balance={row["event"]:row["availableCount"] for row in credits}
    return success({"items":items,"unreadCount":unread["unreadCount"],"subscriptionCredits":balance})

@app.get("/api/notifications/config")
def notification_config(user: dict=Depends(coupled_user)):
    """返回可公开的模板 ID 和当前用户余额，不暴露 AppSecret 等服务端密钥。"""
    # Template IDs are public identifiers; secrets and template field mappings stay server-side.
    templates=subscription_templates()
    credits=fetch_all("SELECT event,available_count AS availableCount FROM wechat_subscription_credits WHERE user_id=%s",(user["id"],))
    balance={row["event"]:row["availableCount"] for row in credits}
    return success({"orderTemplateId":templates.get("created",""),"servedTemplateId":templates.get("served",""),"subscriptionCredits":balance,"subscriptionCreditMax":SUBSCRIPTION_CREDIT_MAX})

@app.post("/api/notifications/subscriptions")
def register_subscriptions(request: Request, body: dict, user: dict=Depends(coupled_user)):
    """接收小程序授权结果并增加相应模板的提醒次数，同时返回最新余额。"""
    request_id=text(body.get("requestId"),80)
    template_ids=body.get("templateIds") if isinstance(body.get("templateIds"),list) else []
    if not request_id: raise AppError("订阅记录编号无效")
    if len(template_ids)>2: raise AppError("一次最多记录两条提醒")
    added=record_subscription_grants(user["id"],[text(item,100) for item in template_ids],request_id)
    credits=fetch_all("SELECT event,available_count AS availableCount FROM wechat_subscription_credits WHERE user_id=%s",(user["id"],))
    return success({"subscriptionCredits":{row["event"]:row["availableCount"] for row in credits},"addedByEvent":added,"addedCount":sum(added.values())})

@app.post("/api/notifications/test-send")
async def send_notification_test(body: dict, user: dict=Depends(coupled_user)):
    """把测试模板消息发给当前登录人；使用真实订阅次数，结果附带剩余余额。"""
    event=text(body.get("event"),16)
    if event not in ("created","served"): raise AppError("测试提醒类型无效")
    sample_order={"id":0,"creatorName":"订阅测试","reminderUser":"订阅测试","dishNames":"订阅提醒测试","message":"这是一条测试消息，可以忽略"}
    result=await send_subscribe(user,sample_order,event,page="pages/notifications/notifications")
    logger.info("wechat.subscribe_test event=%s userId=%s sent=%s reason=%s",event,user["id"],result.get("sent",False),result.get("reason",""))
    credits=fetch_all("SELECT event,available_count AS availableCount FROM wechat_subscription_credits WHERE user_id=%s",(user["id"],))
    balance={row["event"]:row["availableCount"] for row in credits}
    return success({"sent":result.get("sent",False),"reason":result.get("reason"),"subscriptionCredits":balance},"微信已接受测试消息" if result.get("sent") else result.get("reason","测试消息未发送"))

@app.put("/api/notifications/read")
def read_notifications(user: dict=Depends(coupled_user)):
    """将当前用户所有未读站内通知标记为已读。"""
    execute("UPDATE notifications SET read_at=NOW() WHERE user_id=%s AND read_at IS NULL",(user["id"],)); return success()

@app.post("/api/uploads/cos-credential")
async def cos_credential(request: Request, user: dict=Depends(coupled_user)):
    """签发仅能上传单张指定图片的短期 STS 凭证，小程序随后直传 COS。"""
    body=await request.json(); mime=text(body.get("mimeType"),64); size=number(body.get("size"),0) or 0; allowed={"image/jpeg":"jpg","image/png":"png","image/webp":"webp"}
    if mime not in allowed or size<=0 or size>settings.cos_upload_max_mb*1024*1024: raise AppError(f"仅支持不超过 {settings.cos_upload_max_mb}MB 的 JPG、PNG、WEBP 图片")
    if not all([settings.cos_secret_id,settings.cos_secret_key,settings.cos_bucket,settings.cos_region]): raise AppError("图片上传暂未配置",503)
    try:
        from sts.sts import Sts
        purpose=body.get("purpose") if body.get("purpose") in ("avatar","meal","background") else "dish"; folder={"avatar":"avatars","meal":"meal-images","dish":"dish-images","background":"backgrounds"}[purpose]
        public_id=couple_public_id(user["coupleId"])
        key=f"{storage.couple_prefix(public_id)}{folder}/{datetime.now().year}/{datetime.now().month:02d}/{uuid.uuid4()}.{allowed[mime]}"
        # COS policy resources must use the complete Bucket name, including its APPID suffix.
        # Example: qcs::cos:ap-beijing:uid/1318013210:little-table-1318013210/path/to/file
        app_id=settings.cos_bucket.rsplit("-",1)[-1]
        resource=f"qcs::cos:{settings.cos_region}:uid/{app_id}:{settings.cos_bucket}/{key}"
        credential=Sts({"secret_id":settings.cos_secret_id,"secret_key":settings.cos_secret_key,"duration_seconds":900,"bucket":settings.cos_bucket,"region":settings.cos_region,"policy":{"version":"2.0","statement":[{"effect":"allow","action":["name/cos:PutObject"],"resource":[resource],"condition":{"numeric_less_than_equal":{"cos:content-length":settings.cos_upload_max_mb*1024*1024},"string_equal":{"cos:content-type":mime}}}]}}).get_credential()
    except ImportError:
        raise AppError("COS 临时凭证组件未安装，请重新安装 requirements.txt",503)
    except Exception as error:
        logger.error("cos.credential_failed requestId=%s errorType=%s",request.state.request_id,type(error).__name__); raise AppError("图片上传凭证获取失败",503)
    # This URL is for the editor's immediate preview only. It is never stored in MySQL.
    url=storage.signed_url(key)
    logger.info("cos.credential_issued requestId=%s purpose=%s key=%s size=%s", request.state.request_id, purpose, key, int(size))
    return success({"credentials":credential["credentials"],"startTime":credential["startTime"],"expiredTime":credential["expiredTime"],"bucket":settings.cos_bucket,"region":settings.cos_region,"key":key,"url":url})

@app.post("/api/uploads/cos-failure")
def report_cos_upload_failure(request: Request, body: dict, user: dict=Depends(coupled_user)):
    """Record sanitized diagnostics for client-to-COS PUT failures."""
    purpose=body.get("purpose") if body.get("purpose") in ("avatar","meal","dish","background") else "unknown"
    status=int(clamp(int(number(body.get("statusCode"),0) or 0),0,599))
    raw_request_id=text(body.get("cosRequestId"),100)
    cos_request_id=re.sub(r"[^A-Za-z0-9_.:-]","",raw_request_id)
    raw_error=text(body.get("errorCode"),80)
    error_code=re.sub(r"[^A-Za-z0-9_.:-]","_",raw_error) or "unknown"
    logger.warning("cos.client_upload_failed requestId=%s purpose=%s status=%s cosRequestId=%s errorCode=%s userId=%s",
        request.state.request_id,purpose,status,cos_request_id or "-",error_code,user["id"])
    return success(message="上传诊断已记录")

@app.post("/api/uploads/discard")
async def discard_upload(request: Request, user: dict=Depends(coupled_user)):
    """清理尚未保存到业务记录的上传对象；被任何记录引用的图片不会删除。"""
    key=owned_key_or_error(text((await request.json()).get("key"),255) or None,couple_public_id(user["coupleId"]))
    if not key: raise AppError("缺少待删除的图片")
    if not delete_unreferenced_image(key): raise AppError("这张图片已经被使用，不能直接删除")
    return success(message="未保存的图片已清理")
