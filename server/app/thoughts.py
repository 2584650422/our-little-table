"""Private two-member messages. All shared reads/writes use token-derived space IDs."""

import logging
import re
from datetime import date, datetime, timedelta
from fastapi import BackgroundTasks, Depends
from .db import connection, execute, fetch_all, fetch_one
from . import storage

logger = logging.getLogger(__name__)
FIELDS = """m.id,m.sender_id AS senderId,m.recipient_id AS recipientId,m.root_id AS rootId,
 m.content,m.read_at AS readAt,m.created_at AS createdAt,m.wx_status AS wxStatus,
 u.nickname AS senderName,u.avatar_key AS avatarKey,u.avatar_url AS avatarUrl"""
BASE = """ FROM thought_messages m JOIN users u ON u.id=m.sender_id
 LEFT JOIN thought_messages root ON root.id=m.root_id
 WHERE m.space_id=%s AND (m.sender_id=%s OR m.recipient_id=%s)
 AND m.deleted_at IS NULL AND (m.root_id IS NULL OR root.deleted_at IS NULL)"""


def public(row):
    row = dict(row)
    row["senderAvatarUrl"] = storage.signed_url(
        row.pop("avatarKey", None), row.pop("avatarUrl", None)
    )
    row["senderInitial"] = (row.get("senderName") or "我")[0]
    for key in ("createdAt", "readAt"):
        value = row.get(key)
        row[key] = value.strftime("%Y-%m-%d %H:%M:%S") if isinstance(value, datetime) else value
    return row


def register(app, coupled_user, success, AppError, send_subscribe):
    def args(user):
        return (user["coupleId"], user["id"], user["id"])

    def get_message(mid, user, conn=None):
        row = fetch_one("SELECT " + FIELDS + BASE + " AND m.id=%s", (*args(user), mid), conn)
        if not row:
            raise AppError("这条记录不存在或已被删除", 404)
        return row

    @app.get("/api/thoughts")
    def list_messages(
        beforeId: int = 0, filter: str = "all", focusId: int = 0, user: dict = Depends(coupled_user)
    ):
        where, params = "", list(args(user))
        if filter in ("sent", "received"):
            where += " AND m." + ("sender_id" if filter == "sent" else "recipient_id") + "=%s"
            params.append(user["id"])
        if beforeId:
            where += " AND m.id<%s"
            params.append(beforeId)
        if focusId:
            focused = get_message(focusId, user)
            where += " AND m.id=%s"
            params.append(focused.get("rootId") or focused["id"])
        roots = fetch_all(
            "SELECT "
            + FIELDS
            + BASE
            + " AND m.root_id IS NULL"
            + where
            + " ORDER BY m.id DESC LIMIT 21",
            params,
        )
        more = len(roots) > 20
        roots = roots[:20]
        replies = []
        if roots:
            ids = [r["id"] for r in roots]
            replies = fetch_all(
                "SELECT "
                + FIELDS
                + BASE
                + " AND m.root_id IN ("
                + ",".join(["%s"] * len(ids))
                + ") ORDER BY m.id",
                (*args(user), *ids),
            )
        result = []
        for root in roots:
            item = public(root)
            item["replies"] = [public(r) for r in replies if r["rootId"] == root["id"]]
            result.append(item)
        return success({"items": result, "hasMore": more, "userId": user["id"]})

    @app.get("/api/thoughts/unread")
    def unread(user: dict = Depends(coupled_user)):
        rows = fetch_all(
            "SELECT "
            + FIELDS
            + BASE
            + " AND m.recipient_id=%s AND m.read_at IS NULL ORDER BY m.id DESC LIMIT 20",
            (*args(user), user["id"]),
        )
        return success({"items": [public(r) for r in rows]})

    @app.get("/api/thoughts/day")
    def day(date: str, user: dict = Depends(coupled_user)):
        try:
            start = datetime.strptime(date, "%Y-%m-%d")
        except (TypeError, ValueError):
            raise AppError("日期无效")
        rows = fetch_all(
            "SELECT " + FIELDS + BASE + " AND m.created_at>=%s AND m.created_at<%s ORDER BY m.id",
            (*args(user), start, start + timedelta(days=1)),
        )
        return success(
            {
                "items": [public(r) for r in rows],
                "sent": sum(r["senderId"] == user["id"] for r in rows),
                "received": sum(r["recipientId"] == user["id"] for r in rows),
            }
        )

    @app.put("/api/thoughts/read")
    def read(body: dict, user: dict = Depends(coupled_user)):
        ids = body.get("ids")
        if (
            not isinstance(ids, list)
            or len(ids) > 200
            or any(type(i) is not int or i < 1 for i in ids)
        ):
            raise AppError("记录编号无效")
        if ids:
            execute(
                "UPDATE thought_messages SET read_at=COALESCE(read_at,NOW()) WHERE space_id=%s AND recipient_id=%s AND deleted_at IS NULL AND id IN ("
                + ",".join(["%s"] * len(ids))
                + ")",
                (user["coupleId"], user["id"], *ids),
            )
        return success()

    async def deliver(mid, member, payload):
        # Recheck membership, deletion and receiving preference before external dispatch.
        row = fetch_one(
            "SELECT m.id FROM thought_messages m JOIN users s ON s.id=m.sender_id JOIN users r ON r.id=m.recipient_id LEFT JOIN thought_messages root ON root.id=m.root_id WHERE m.id=%s AND m.space_id=%s AND s.space_id=m.space_id AND r.space_id=m.space_id AND m.deleted_at IS NULL AND (root.id IS NULL OR root.deleted_at IS NULL)",
            (mid, payload["spaceId"]),
        )
        if not row:
            execute(
                "UPDATE thought_messages SET wx_status='skipped' WHERE id=%s AND space_id=%s",
                (mid, payload["spaceId"]),
            )
            return
        try:
            result = await send_subscribe(
                member, payload, "thought", page=f"pages/thoughts/thoughts?focusId={mid}"
            )
            status = "accepted" if result.get("sent") else "unavailable"
        except Exception:
            status = "failed"
            logger.warning("thought.notify_failed id=%s", mid)
        execute(
            "UPDATE thought_messages SET wx_status=%s WHERE id=%s AND space_id=%s",
            (status, mid, payload["spaceId"]),
        )

    @app.post("/api/thoughts")
    def send(body: dict, background: BackgroundTasks, user: dict = Depends(coupled_user)):
        request_id = body.get("requestId")
        content = body.get("content", "")
        root_id = body.get("rootId") or None
        if not isinstance(request_id, str) or not re.fullmatch(r"[\w-]{8,80}", request_id):
            raise AppError("发送编号无效")
        if not isinstance(content, str) or len(content.strip()) > 100:
            raise AppError("留言最多 100 字")
        content = content.strip() or "想你了"
        if root_id is not None and (type(root_id) is not int or root_id < 1):
            raise AppError("回复编号无效")
        with connection(transaction=True) as conn:
            # Serialize duplicate submissions and reminder cooldown decisions across workers.
            fetch_one("SELECT id FROM spaces WHERE id=%s FOR UPDATE", (user["coupleId"],), conn)
            current = fetch_one("SELECT space_id FROM users WHERE id=%s", (user["id"],), conn)
            if not current or current["space_id"] != user["coupleId"]:
                raise AppError("空间状态已变化，请重新进入", 403)
            existing = fetch_one(
                "SELECT id FROM thought_messages WHERE space_id=%s AND sender_id=%s AND request_id=%s",
                (user["coupleId"], user["id"], request_id),
                conn,
            )
            if existing:
                return success({"id": existing["id"], "duplicate": True})
            member = fetch_one(
                "SELECT u.id,u.openid FROM space_members sm JOIN users u ON u.id=sm.user_id WHERE sm.space_id=%s AND sm.left_at IS NULL AND u.space_id=%s AND u.id<>%s LIMIT 1",
                (user["coupleId"], user["coupleId"], user["id"]),
                conn,
            )
            if not member:
                raise AppError("对方还没有加入当前空间")
            if root_id:
                root = get_message(root_id, user, conn)
                if {root["senderId"], root["recipientId"]} != {user["id"], member["id"]}:
                    raise AppError("原留言的另一方已不在当前空间，无法回复", 403)
                if root.get("rootId"):
                    raise AppError("请回复原始留言")
            recent = fetch_one(
                "SELECT COUNT(*) AS n FROM thought_messages WHERE space_id=%s AND sender_id=%s AND created_at>DATE_SUB(NOW(),INTERVAL 1 MINUTE)",
                (user["coupleId"], user["id"]),
                conn,
            )
            if recent["n"] >= 5:
                raise AppError("发得有点快，稍等一会再试", 429)
            cooling = fetch_one(
                "SELECT id FROM thought_messages WHERE space_id=%s AND sender_id=%s AND recipient_id=%s AND created_at>DATE_SUB(NOW(),INTERVAL 10 MINUTE) AND wx_status IN ('pending','accepted') LIMIT 1",
                (user["coupleId"], user["id"], member["id"]),
                conn,
            )
            status = "suppressed" if cooling else "pending"
            mid, _ = execute(
                "INSERT INTO thought_messages (space_id,sender_id,recipient_id,root_id,request_id,content,wx_status) VALUES (%s,%s,%s,%s,%s,%s,%s)",
                (user["coupleId"], user["id"], member["id"], root_id, request_id, content, status),
                conn,
            )
        if status == "pending":
            background.add_task(
                deliver,
                mid,
                member,
                {
                    "id": mid,
                    "spaceId": user["coupleId"],
                    "creatorName": user.get("nickname") or "对方",
                    "message": content,
                },
            )
        return success({"id": mid, "wxStatus": status}, "已发送")

    @app.delete("/api/thoughts/{mid}")
    def delete(mid: int, user: dict = Depends(coupled_user)):
        with connection(transaction=True) as conn:
            fetch_one("SELECT id FROM spaces WHERE id=%s FOR UPDATE", (user["coupleId"],), conn)
            row = get_message(mid, user, conn)
            if row["senderId"] != user["id"]:
                raise AppError("只能删除自己发出的内容", 403)
            execute(
                "UPDATE thought_messages SET deleted_at=NOW() WHERE id=%s AND space_id=%s AND sender_id=%s",
                (mid, user["coupleId"], user["id"]),
                conn,
            )
        return success()
