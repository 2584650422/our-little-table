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

    def test_subscription_grants_are_capped_at_ten(self):
        with patch.object(main, "subscription_templates", return_value={"created": "order-template"}), \
             patch.object(main, "connection") as connection, \
             patch.object(main, "execute", side_effect=[(None, 1), (None, 1)]) as execute:
            connection.return_value.__enter__.return_value = object()
            main.record_subscription_grants(12, ["order-template"], "request-1")

        grant_sql, grant_params, _ = execute.call_args_list[1].args
        self.assertIn("LEAST(%s,available_count+1)", grant_sql)
        self.assertEqual(grant_params[-1], 10)

    def test_subscription_refunds_are_capped_at_ten(self):
        with patch.object(main, "execute") as execute:
            main.refund_subscription_credit(12, "order-template")

        sql, params = execute.call_args.args
        self.assertIn("LEAST(%s,available_count+1)", sql)
        self.assertEqual(params[0], 10)


if __name__ == "__main__":
    unittest.main()
