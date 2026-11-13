import unittest
from unittest.mock import patch
from app import main


class MenuAndReceiptTests(unittest.TestCase):
    def test_archive_requires_disabled_and_never_deletes_history(self):
        with (
            patch.object(main, "connection"),
            patch.object(main, "fetch_one", return_value={"enabled": 1}),
            patch.object(main, "execute") as execute,
        ):
            with self.assertRaises(main.AppError) as error:
                main.archive_dish(7, {"id": 1, "coupleId": 2})
            self.assertEqual(error.exception.status, 409)
            execute.assert_not_called()
        with (
            patch.object(main, "connection"),
            patch.object(main, "fetch_one", return_value={"enabled": 0}),
            patch.object(main, "execute") as execute,
        ):
            main.archive_dish(7, {"id": 1, "coupleId": 2})
            self.assertIn("deleted_at=NOW()", execute.call_args.args[0])
            self.assertEqual(execute.call_args.args[1], (7, 2))

    def test_restore_rejects_removed_category(self):
        with (
            patch.object(main, "connection"),
            patch.object(main, "fetch_one", side_effect=[{"enabled": 0, "categoryId": 3}, None]),
            patch.object(main, "execute") as execute,
        ):
            with self.assertRaises(main.AppError):
                main.restore_dish(7, {"id": 1, "coupleId": 2})
            execute.assert_not_called()

    def test_cannot_mark_other_user_or_other_table_read(self):
        with patch.object(main, "execute") as execute:
            main.read_notifications({"ids": [11, 12]}, {"id": 4, "coupleId": 2})
            sql, params = execute.call_args.args
            self.assertIn("n.user_id=%s AND o.space_id=%s", sql)
            self.assertEqual(params, [4, 2, 11, 12])
        with patch.object(main, "execute") as execute:
            main.read_notifications({"ids": []}, {"id": 4, "coupleId": 2})
            execute.assert_not_called()

    def test_invalid_ids_do_not_turn_into_mark_all(self):
        for body in ({"ids": "all"}, {"ids": [True]}, {"ids": [-1]}, {"other": "all"}):
            with patch.object(main, "execute") as execute:
                with self.assertRaises(main.AppError):
                    main.read_notifications(body, {"id": 4, "coupleId": 2})
                execute.assert_not_called()

    def test_old_client_empty_body_can_mark_all_in_current_table(self):
        with patch.object(main, "execute") as execute:
            main.read_notifications({}, {"id": 4, "coupleId": 2})
            self.assertEqual(execute.call_args.args[1], [4, 2])

    def test_legacy_message_does_not_guess_partner_read_status(self):
        with (
            patch.object(
                main,
                "fetch_all",
                side_effect=[
                    [{"id": 1, "readAt": "2026-11-03", "eventKey": None}],
                    [{"id": 4, "nickname": "甲"}, {"id": 5, "nickname": "乙"}],
                    [],
                ],
            ),
            patch.object(main, "fetch_one", return_value={"unreadCount": 0}),
        ):
            result = main.notifications({"id": 4, "coupleId": 2})
        readers = result["data"]["items"][0]["readers"]
        self.assertEqual(readers[0]["status"], "已读")
        self.assertFalse(readers[1]["known"])
        self.assertEqual(readers[1]["status"], "无阅读记录")
