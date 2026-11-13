import unittest
from contextlib import nullcontext
from datetime import date, timedelta
from unittest.mock import patch
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient
from app import life, main


class PhotoEditTests(unittest.TestCase):
    def setUp(self):
        app = FastAPI()
        life.register(
            app,
            lambda: {"id": 1, "coupleId": 7},
            lambda data=None: {"code": 0, "data": data},
            main.AppError,
            lambda _: "space",
            lambda _: True,
        )

        @app.exception_handler(main.AppError)
        async def error(_, exc):
            return JSONResponse({"message": str(exc)}, status_code=exc.status)

        self.client = TestClient(app)
        self.body = {
            "city": "北京",
            "latitude": 39.9,
            "longitude": 116.4,
            "takenOn": "2020-01-01",
            "caption": "更正日期",
        }

    def test_metadata_update_cannot_replace_objects_or_owner(self):
        with (
            patch.object(life, "fetch_one", return_value={"id": 3}) as fetch,
            patch.object(life, "execute") as execute,
            patch.object(life.storage, "_client") as cos,
        ):
            result = self.client.put(
                "/api/life/photos/3",
                json={**self.body, "originalKey": "other", "space_id": 99, "created_by": 99},
            )
        self.assertEqual(result.status_code, 200)
        self.assertEqual(fetch.call_args.args[1], (3, 7))
        sql, values = execute.call_args.args
        self.assertNotIn("original_key", sql)
        self.assertNotIn("created_by", sql)
        self.assertEqual(values[-2:], (3, 7))
        cos.assert_not_called()

    def test_foreign_photo_is_not_read_or_updated(self):
        with (
            patch.object(life, "fetch_one", return_value=None) as fetch,
            patch.object(life, "execute") as execute,
        ):
            self.assertEqual(self.client.get("/api/life/photos/88").status_code, 404)
            self.assertEqual(
                self.client.put("/api/life/photos/88", json=self.body).status_code, 404
            )
        self.assertEqual(fetch.call_args.args[1], (88, 7))
        execute.assert_not_called()

    def test_future_date_and_invalid_coordinates_are_rejected(self):
        for changes in [
            {"latitude": 100},
            {"takenOn": str(life.local_today() + timedelta(days=1))},
        ]:
            with (
                patch.object(life, "fetch_one", return_value={"id": 3}),
                patch.object(life, "execute") as execute,
            ):
                self.assertEqual(
                    self.client.put(
                        "/api/life/photos/3", json={**self.body, **changes}
                    ).status_code,
                    400,
                )
                execute.assert_not_called()


class SpaceRecoveryTests(unittest.TestCase):
    def test_self_recovery_uses_history_and_locks_space_before_capacity_check(self):
        with (
            patch.object(main, "connection", return_value=nullcontext("tx")),
            patch.object(
                main, "fetch_one", side_effect=[{"id": 9}, {"id": 12, "leftAt": date(2020, 1, 1)}]
            ) as fetch,
            patch.object(main, "member_count", return_value=1),
            patch.object(main, "execute") as execute,
        ):
            main.rejoin_couple(9, {"id": 3})
        self.assertIn("FOR UPDATE", fetch.call_args_list[0].args[0])
        self.assertEqual(fetch.call_args_list[1].args[1], (9, 3))
        self.assertEqual(execute.call_args.args[1], (9, 3))

    def test_no_membership_or_full_space_cannot_be_recovered(self):
        for history, count in [(None, 0), ({"id": 12, "leftAt": date(2020, 1, 1)}, 2)]:
            with (
                patch.object(main, "connection", return_value=nullcontext("tx")),
                patch.object(main, "fetch_one", side_effect=[{"id": 9}, history]),
                patch.object(main, "member_count", return_value=count),
                patch.object(main, "execute") as execute,
            ):
                with self.assertRaises(main.AppError):
                    main.rejoin_couple(9, {"id": 3})
                execute.assert_not_called()
