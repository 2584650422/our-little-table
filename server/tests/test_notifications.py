import asyncio
import unittest
from unittest.mock import AsyncMock, patch

from app import main


class NotificationTests(unittest.TestCase):
    def test_created_reaches_both_members(self):
        order = {"id": 7, "title": "晚餐", "dishNames": "番茄炒蛋", "mealDate": "2026-09-27"}
        creator = {"id": 1, "openid": "openid-one"}
        target = {"id": 2, "openid": "openid-two"}
        with patch.object(main, "execute") as insert:
            result = asyncio.run(main.notify_created(creator, target, order))
        self.assertEqual(insert.call_count, 2)
        self.assertTrue(result["creator"]["sent"])
        self.assertTrue(result["target"]["sent"])

    def test_served_reaches_both_members(self):
        order = {"id": 7, "coupleId": 3, "title": "晚餐", "dishNames": "番茄炒蛋", "mealDate": "2026-09-27"}
        members = [{"id": 1, "openid": "openid-one"}, {"id": 2, "openid": "openid-two"}]
        with patch.object(main, "fetch_all", return_value=members), patch.object(main, "execute") as insert:
            notified = asyncio.run(main.notify_served(order, served_by=1))
        self.assertEqual(insert.call_count, 2)
        self.assertEqual(notified, members)

    def test_external_delivery_reaches_both_without_blocking_main_flow(self):
        order = {"id": 7, "title": "晚餐", "dishNames": "番茄炒蛋", "mealDate": "2026-09-27"}
        members = [{"id": 1, "openid": "openid-one"}, {"id": 2, "openid": "openid-two"}]
        with patch.object(main, "send_subscribe", new_callable=AsyncMock) as send:
            asyncio.run(main.deliver_wechat(members, order, "served"))
        self.assertEqual(send.call_count, 2)
        self.assertTrue(all(call.args[2] == "served" for call in send.call_args_list))


if __name__ == "__main__":
    unittest.main()
