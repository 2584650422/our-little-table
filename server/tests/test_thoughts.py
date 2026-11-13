import asyncio
import unittest
from datetime import datetime
from unittest.mock import AsyncMock, patch
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient
from app import thoughts, main


class ThoughtTests(unittest.TestCase):
    def setUp(self):
        app = FastAPI()

        @app.exception_handler(main.AppError)
        async def error(_, exc):
            return JSONResponse({"message": exc.message}, status_code=exc.status)

        self.deliver = AsyncMock(return_value={"sent": True})
        thoughts.register(
            app,
            lambda: {"id": 1, "coupleId": 7, "nickname": "我"},
            main.success,
            main.AppError,
            self.deliver,
        )
        self.client = TestClient(app)

    def row(self):
        return dict(
            id=9,
            senderId=2,
            recipientId=1,
            rootId=None,
            content="想你了",
            readAt=None,
            createdAt=datetime(2026, 11, 12, 14, 32),
            wxStatus="accepted",
            senderName="对方",
        )

    def test_day_scopes_data_and_counts_both_directions(self):
        with patch.object(thoughts, "fetch_all", return_value=[self.row()]) as fetch:
            result = self.client.get("/api/thoughts/day?date=2026-11-12")
        self.assertEqual(result.json()["data"]["received"], 1)
        sql, args = fetch.call_args.args
        self.assertIn("m.space_id=%s", sql)
        self.assertEqual(args[:3], (7, 1, 1))
        self.assertEqual(args[-1], datetime(2026, 11, 13))
        self.assertEqual(self.client.get("/api/thoughts/day?date=bad").status_code, 400)

    def test_read_can_only_touch_current_recipient_and_space(self):
        with patch.object(thoughts, "execute") as execute:
            self.assertEqual(
                self.client.put("/api/thoughts/read", json={"ids": [9, 10]}).status_code, 200
            )
        sql, args = execute.call_args.args
        self.assertIn("recipient_id=%s", sql)
        self.assertEqual(args, (7, 1, 9, 10))
        self.assertEqual(
            self.client.put("/api/thoughts/read", json={"ids": [True]}).status_code, 400
        )

    def test_cannot_delete_partner_message(self):
        with (
            patch.object(thoughts, "connection"),
            patch.object(thoughts, "fetch_one", side_effect=[{"id": 7}, self.row()]),
            patch.object(thoughts, "execute") as execute,
        ):
            self.assertEqual(self.client.delete("/api/thoughts/9").status_code, 403)
            execute.assert_not_called()

    def test_retry_has_no_second_write_or_wechat_dispatch(self):
        with (
            patch.object(thoughts, "connection"),
            patch.object(
                thoughts, "fetch_one", side_effect=[{"id": 7}, {"space_id": 7}, {"id": 9}]
            ),
            patch.object(thoughts, "execute") as execute,
        ):
            result = self.client.post(
                "/api/thoughts", json={"requestId": "retry-123", "content": "重复提交"}
            )
        self.assertTrue(result.json()["data"]["duplicate"])
        execute.assert_not_called()
        self.deliver.assert_not_awaited()

    def test_cooldown_saves_message_without_wechat(self):
        with (
            patch.object(thoughts, "connection"),
            patch.object(
                thoughts,
                "fetch_one",
                side_effect=[
                    {"id": 7},
                    {"space_id": 7},
                    None,
                    {"id": 2, "openid": "partner"},
                    {"n": 0},
                    {"id": 3},
                ],
            ),
            patch.object(thoughts, "execute", return_value=(9, 1)) as execute,
        ):
            result = self.client.post(
                "/api/thoughts", json={"requestId": "send-1234", "content": ""}
            )
        self.assertEqual(result.json()["data"]["wxStatus"], "suppressed")
        self.assertEqual(execute.call_args.args[1][-2:], ("想你了", "suppressed"))
        self.deliver.assert_not_awaited()

    def test_foreign_root_rejected_before_insertion(self):
        with (
            patch.object(thoughts, "connection"),
            patch.object(
                thoughts,
                "fetch_one",
                side_effect=[
                    {"id": 7},
                    {"space_id": 7},
                    None,
                    {"id": 2, "openid": "partner"},
                    None,
                ],
            ),
            patch.object(thoughts, "execute") as execute,
        ):
            result = self.client.post(
                "/api/thoughts", json={"requestId": "send-1234", "rootId": 999, "content": "回复"}
            )
        self.assertEqual(result.status_code, 404)
        execute.assert_not_called()

    def test_disabled_preference_does_not_consume_credit(self):
        with (
            patch.object(main, "fetch_one", return_value={"enabled": 0}),
            patch.object(main, "reserve_subscription_credit") as reserve,
        ):
            result = asyncio.run(main.send_subscribe({"id": 2}, {"id": 9}, "thought"))
        self.assertFalse(result["sent"])
        reserve.assert_not_called()

    def test_new_template_is_a_separate_event(self):
        with patch.object(main, "settings") as settings:
            settings.wechat_thought_template_id = "thought-template"
            settings.wechat_thought_user_key = "thing1"
            settings.wechat_thought_message_key = "thing2"
            self.assertEqual(
                main.subscribe_template("thought"),
                ("thought-template", [("thing1", "creatorName"), ("thing2", "message")]),
            )

    def test_preferences_cannot_change_another_user(self):
        with patch.object(main, "execute") as execute:
            main.notification_preferences(
                {"event": "thought", "enabled": False, "userId": 999}, {"id": 1}
            )
        self.assertEqual(execute.call_args.args[1], (1, "thought", False))


class ThoughtCreditTests(unittest.TestCase):
    def test_old_template_credit_is_not_available_for_new_template(self):
        with (
            patch.object(main, "subscription_templates", return_value={"thought": "new-template"}),
            patch.object(
                main,
                "fetch_all",
                return_value=[
                    {"event": "thought", "templateId": "old-template", "availableCount": 9},
                    {"event": "thought", "templateId": "new-template", "availableCount": 2},
                ],
            ),
        ):
            self.assertEqual(main.subscription_balance(1), {"thought": 2})

    def test_all_three_templates_register_separately_once(self):
        with (
            patch.object(
                main,
                "subscription_templates",
                return_value={"created": "a", "served": "b", "thought": "c"},
            ),
            patch.object(main, "connection"),
            patch.object(main, "execute", return_value=(1, 1)) as execute,
        ):
            added = main.record_subscription_grants(1, ["a", "b", "c", "c"], "one-request")
        self.assertEqual(added, {"created": 1, "served": 1, "thought": 1})
        self.assertEqual(execute.call_count, 6)
