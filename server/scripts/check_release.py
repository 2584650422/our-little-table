"""手动集成检查：仅允许一次性测试库，使用真实 MySQL 和 API 路由。

在候选镜像中运行：PYTHONPATH=/app python /checks/check_release.py。
测试库须为空，名字以 our_time_test_ 开头；不连接微信和 COS。
"""

import asyncio
import uuid
from datetime import timedelta
import httpx
from app import main
from app.life import local_today


async def check():
    if not main.settings.mysql_database.startswith("our_time_test_"):
        raise RuntimeError("只允许在独立测试库执行")
    if main.fetch_one("SELECT COUNT(*) AS count FROM users")["count"]:
        raise RuntimeError("测试库必须为空")
    couples = []
    for name in ("测试饭桌", "其他饭桌"):
        couples.append(
            main.execute(
                "INSERT INTO spaces(public_id,name) VALUES (%s,%s)", (str(uuid.uuid4()), name)
            )[0]
        )
    users = []
    for index, couple in enumerate((couples[0], couples[0], couples[1])):
        user = main.execute(
            "INSERT INTO users(openid,nickname,space_id) VALUES (%s,%s,%s)",
            (f"test-{index}", f"成员{index}", couple),
        )[0]
        main.execute("INSERT INTO space_members(space_id,user_id) VALUES (%s,%s)", (couple, user))
        users.append(user)
    category = main.execute(
        "INSERT INTO dish_categories(space_id,name) VALUES (%s,%s)", (couples[0], "家常菜")
    )[0]
    dish = main.execute(
        "INSERT INTO dishes(space_id,category_id,name) VALUES (%s,%s,%s)",
        (couples[0], category, "测试番茄炒蛋"),
    )[0]
    tokens = [main.sign({"id": user}) for user in users]
    checks = 0
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=main.app), base_url="http://test"
    ) as client:

        async def call(user, method, path, data=None, status=200):
            nonlocal checks
            response = await client.request(
                method, path, headers={"Authorization": f"Bearer {tokens[user]}"}, json=data
            )
            assert response.status_code == status, (
                method,
                path,
                response.status_code,
                response.text,
            )
            checks += 1
            return response.json().get("data", {})

        assert (await call(0, "GET", "/health"))["version"] != "unversioned"
        await call(0, "POST", f"/api/dishes/{dish}/archive", status=409)
        order = await call(0, "POST", "/api/orders", {"items": [{"dishId": dish, "quantity": 1}]})
        order_id = order["id"]
        a = await call(0, "GET", "/api/notifications")
        b = await call(1, "GET", "/api/notifications")
        assert a["unreadCount"] == b["unreadCount"] == 1
        assert all(r["status"] == "未读" for r in a["items"][0]["readers"])
        detail = await call(0, "GET", f"/api/orders/{order_id}")
        await call(
            0,
            "PUT",
            "/api/notifications/read",
            {"ids": detail["unreadNotificationIds"] + [b["items"][0]["id"]]},
        )
        b = await call(1, "GET", "/api/notifications")
        assert b["unreadCount"] == 1 and [r["status"] for r in b["items"][0]["readers"]] == [
            "已读",
            "未读",
        ]
        await call(2, "PUT", "/api/notifications/read", {"ids": [b["items"][0]["id"]]})
        assert (await call(1, "GET", "/api/notifications"))["unreadCount"] == 1
        await call(1, "PUT", "/api/notifications/read")
        assert (await call(0, "GET", "/api/notifications"))["items"][0]["readers"][1][
            "status"
        ] == "已读"
        # 合并菜单产生另一个事件，不能继承之前的阅读状态。
        await call(0, "POST", "/api/orders", {"items": [{"dishId": dish, "quantity": 1}]})
        a = await call(0, "GET", "/api/notifications")
        assert a["items"][0]["type"] == "menu_updated" and all(
            r["status"] == "未读" for r in a["items"][0]["readers"]
        )
        await call(1, "PUT", f"/api/orders/{order_id}/status", {"status": "ready"})
        assert (await call(0, "GET", "/api/notifications"))["items"][0]["type"] == "order_served"
        await call(2, "POST", f"/api/dishes/{dish}/restore", status=404)
        await call(0, "DELETE", f"/api/dishes/{dish}")
        await call(0, "POST", f"/api/dishes/{dish}/restore")
        assert (await call(0, "GET", f"/api/dishes/{dish}"))["enabled"]
        await call(0, "DELETE", f"/api/dishes/{dish}")
        main.execute("UPDATE dish_categories SET enabled=0 WHERE id=%s", (category,))
        await call(0, "POST", f"/api/dishes/{dish}/restore", status=400)
        main.execute("UPDATE dish_categories SET enabled=1 WHERE id=%s", (category,))
        await call(2, "POST", f"/api/dishes/{dish}/archive", status=404)
        await call(0, "POST", f"/api/dishes/{dish}/archive")
        assert not await call(0, "GET", "/api/dishes?includeDisabled=true")
        await call(0, "GET", f"/api/dishes/{dish}", status=404)
        await call(0, "POST", f"/api/dishes/{dish}/restore", status=404)
        detail = await call(0, "GET", f"/api/orders/{order_id}")
        assert detail["items"][0]["dishName"] == "测试番茄炒蛋"
        assert main.fetch_one("SELECT enabled,deleted_at FROM dishes WHERE id=%s", (dish,))[
            "deleted_at"
        ]
        # 新版生活空间：只修改隔离测试库，检查两张饭桌的数据边界。
        today = local_today()
        tomorrow = today + timedelta(days=1)
        home = await call(
            0,
            "PUT",
            "/api/life/home",
            {
                "name": "两个人的测试空间",
                "tagline": "慢慢吃饭，慢慢生活。",
                "anniversary": today.isoformat(),
            },
        )
        assert home["name"] == "两个人的测试空间"
        summary = await call(1, "GET", "/api/life/summary")
        assert summary["name"] == home["name"] and summary["tagline"] == home["tagline"]
        assert summary["anniversary"] == today.isoformat() and summary["togetherDays"] == 1
        assert (await call(2, "GET", "/api/life/summary"))["name"] == "其他饭桌"
        assert await call(0, "GET", f"/api/life/calendar?month={today:%Y-%m}")
        diary = await call(
            0,
            "POST",
            "/api/life/events",
            {
                "title": "去了北京",
                "content": "一起逛了故宫。",
                "eventDate": today.isoformat(),
                "kind": "diary",
            },
        )
        assert any(
            item.get("content") == "一起逛了故宫。"
            for item in await call(1, "GET", f"/api/life/calendar?month={today:%Y-%m}")
        )
        assert all(
            item["id"] != diary["id"]
            for item in (await call(0, "GET", "/api/life/summary"))["upcoming"]
        )
        assert not await call(2, "GET", "/api/life/events")
        await call(0, "DELETE", f"/api/life/events/{diary['id']}")
        lunar = await call(
            0,
            "POST",
            "/api/life/events",
            {
                "title": "农历倒数日",
                "kind": "countdown",
                "calendarType": "lunar",
                "lunarDate": {"year": 2027, "month": 1, "day": 1, "leap": False},
            },
        )
        saved = next(
            item for item in await call(1, "GET", "/api/life/events") if item["id"] == lunar["id"]
        )
        assert (
            saved["eventDate"] == "2027-02-06"
            and saved["lunarDate"]["month"] == 1
            and not saved["annual"]
        )
        await call(0, "DELETE", f"/api/life/events/{lunar['id']}")
        event = await call(
            0,
            "POST",
            "/api/life/events",
            {"title": "测试倒计时", "eventDate": tomorrow.isoformat(), "kind": "countdown"},
        )
        event_id = event["id"]
        assert any(item["id"] == event_id for item in await call(1, "GET", "/api/life/events"))
        assert not await call(2, "GET", "/api/life/events")
        assert any(
            item["id"] == event_id
            for item in await call(0, "GET", f"/api/life/calendar?month={tomorrow:%Y-%m}")
        )
        await call(
            2,
            "PUT",
            f"/api/life/events/{event_id}",
            {"title": "越权修改", "eventDate": tomorrow.isoformat()},
            status=404,
        )
        await call(0, "DELETE", f"/api/life/events/{event_id}")
        assert not await call(1, "GET", "/api/life/events")
        assert (await call(0, "GET", "/api/life/photos"))["items"] == []
        # 新设置页分开保存，不能重置另一个页面编辑的共享字段。
        await call(
            0, "PUT", "/api/couples/current/name", {"name": "新的共同空间", "coupleId": couples[1]}
        )
        after_rename = await call(1, "GET", "/api/couples/current")
        assert (
            after_rename["name"] == "新的共同空间"
            and after_rename["anniversary"] == today.isoformat()
        )
        assert after_rename["lifeTagline"] == home["tagline"]
        await call(1, "PUT", "/api/life/home", {"tagline": "只改首页的一句话"})
        after_home = await call(0, "GET", "/api/couples/current")
        assert (
            after_home["name"] == "新的共同空间" and after_home["anniversary"] == today.isoformat()
        )
        assert after_home["lifeTagline"] == "只改首页的一句话"
        assert (await call(2, "GET", "/api/couples/current"))["name"] == "其他饭桌"
        # 切换饭桌后，旧桌通知不会被列出或标记；另一成员仍可阅读。
        main.execute("UPDATE users SET space_id=%s WHERE id=%s", (couples[1], users[0]))
        assert not (await call(0, "GET", "/api/notifications"))["items"]
        await call(0, "PUT", "/api/notifications/read")
        assert (
            main.fetch_one(
                "SELECT COUNT(*) AS count FROM messages WHERE user_id=%s AND read_at IS NULL",
                (users[0],),
            )["count"]
            == 2
        )
        print(f"PASS: {checks} 次真实 MySQL/API 请求；菜单、消息、共享日历与跨饭桌权限均通过")


if __name__ == "__main__":
    asyncio.run(check())
