import unittest
from datetime import date, datetime
from unittest.mock import patch
from fastapi import FastAPI
from fastapi.testclient import TestClient
from app import life


class Error(Exception):
    def __init__(self, message, status=400):
        self.message, self.status = message, status


class LifeTests(unittest.TestCase):
    def test_leap_day_birthday_uses_february_end(self):
        event = {"eventDate": date(2000, 2, 29), "annual": True, "calendarType": "solar"}
        self.assertEqual(life.next_occurrence(event, date(2026, 2, 28)), date(2026, 2, 28))
        self.assertEqual(life.next_occurrence(event, date(2026, 3, 1)), date(2027, 2, 28))

    def test_lunar_new_year_and_leap_month_fallback(self):
        event = {"eventDate": date(2024, 2, 10), "annual": True, "calendarType": "lunar"}
        self.assertEqual(life.next_occurrence(event, date(2026, 1, 1)), date(2026, 2, 17))
        leap = {"eventDate": date(2023, 3, 22), "annual": True, "calendarType": "lunar"}
        self.assertEqual(life.occurrence(leap, 2024), date(2024, 3, 10))

    def setUp(self):
        self.app = FastAPI()
        life.register(
            self.app,
            lambda: {"id": 1, "coupleId": 7},
            lambda d=None, **kw: {"data": d},
            Error,
            lambda _: "space-seven",
            lambda _: True,
        )
        self.client = TestClient(self.app)

    def test_photo_list_is_scoped_paginated_and_coordinates_serialized(self):
        with patch.object(life, "fetch_all", return_value=[]) as fetch:
            result = self.client.get("/api/life/photos?beforeId=44")
        self.assertEqual(result.status_code, 200)
        sql, params = fetch.call_args.args
        self.assertIn("space_id=%s", sql)
        self.assertEqual(params, (7, 44, 44))
        self.assertEqual(result.json()["data"], {"items": [], "hasMore": False})

    def test_month_contains_both_anniversary_and_hundred_day(self):
        with (
            patch.object(life, "fetch_all", return_value=()),
            patch.object(life, "fetch_one", return_value={"anniversary": date(2024, 2, 14)}),
        ):
            result = self.client.get("/api/life/calendar?month=2026-11").json()["data"]
        self.assertTrue(
            any(e["nextDate"] == "2026-11-09" and e["title"] == "在一起第 1000 天" for e in result)
        )

    def test_photo_cross_space_key_rejected_before_storage(self):
        route = next(
            r for r in self.app.routes if r.path == "/api/life/photos" and "POST" in r.methods
        )
        import asyncio

        class Request:
            async def json(self):
                return {"originalKey": "other-space/image.jpg", "previewKey": "other-space/p.jpg"}

        with self.assertRaises(Error) as error:
            asyncio.run(route.endpoint(Request(), {"id": 1, "coupleId": 7}))
        self.assertEqual(error.exception.status, 403)

    def test_event_delete_cannot_delete_partner_space(self):
        with patch.object(life, "execute", return_value=(0, 0)) as execute:
            self.client.delete("/api/life/events/88")
        self.assertEqual(execute.call_args.args[1], (88, 7))

    def test_home_edit_updates_only_current_couple_and_preserves_food_copy(self):
        with patch.object(life, "execute", return_value=(0, 1)) as execute:
            response = self.client.put(
                "/api/life/home",
                json={"name": "乖乖和我", "tagline": "一起慢慢走。", "anniversary": "2024-02-14"},
            )
        self.assertEqual(response.status_code, 200)
        sql, params = execute.call_args.args
        self.assertIn("WHERE id=%s", sql)
        self.assertNotIn("home_title", sql)
        self.assertEqual(params, ("乖乖和我", "一起慢慢走。", date(2024, 2, 14), 7))

    def test_home_edit_rejects_blank_tagline(self):
        with self.assertRaises(Error):
            self.client.put(
                "/api/life/home", json={"name": "乖乖和我", "tagline": " ", "anniversary": None}
            )

    def test_lunar_countdown_converts_explicit_lunar_date_once(self):
        with patch.object(life, "execute", return_value=(12, 1)) as execute:
            response = self.client.post(
                "/api/life/events",
                json={
                    "title": "春节出发",
                    "kind": "countdown",
                    "calendarType": "lunar",
                    "lunarDate": {"year": 2027, "month": 1, "day": 1, "leap": False},
                },
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            execute.call_args.args[1][2:6], (date(2027, 2, 6), "countdown", "lunar", False)
        )

    def test_invalid_lunar_leap_month_is_rejected(self):
        with self.assertRaises(Error):
            self.client.post(
                "/api/life/events",
                json={
                    "title": "日期",
                    "kind": "countdown",
                    "calendarType": "lunar",
                    "lunarDate": {"year": 2026, "month": 1, "day": 1, "leap": True},
                },
            )

    def test_diary_stores_content_in_current_space_and_stays_out_of_countdowns(self):
        with patch.object(life, "execute", return_value=(12, 1)) as execute:
            self.client.post(
                "/api/life/events",
                json={
                    "title": "去了北京",
                    "kind": "diary",
                    "eventDate": "2026-11-01",
                    "content": "一起逛了故宫。",
                },
            )
        self.assertEqual(
            execute.call_args.args[1],
            ("去了北京", "一起逛了故宫。", date(2026, 11, 1), "diary", "solar", False, 0, 7, 1),
        )
        diary = {
            "id": 12,
            "title": "去了北京",
            "content": "一起逛了故宫。",
            "eventDate": date(2026, 11, 1),
            "kind": "diary",
            "calendarType": "solar",
            "annual": False,
            "remindDays": 0,
        }
        with (
            patch.object(life, "fetch_all", return_value=[diary]),
            patch.object(
                life,
                "fetch_one",
                side_effect=[{"name": "我们", "anniversary": None, "tagline": "一句话"}, None],
            ),
        ):
            self.assertEqual(self.client.get("/api/life/summary").json()["data"]["upcoming"], [])
        with (
            patch.object(life, "fetch_all", return_value=[diary]),
            patch.object(life, "fetch_one", return_value={"anniversary": None}),
        ):
            result = self.client.get("/api/life/calendar?month=2026-11").json()["data"]
        self.assertEqual(result[0]["content"], "一起逛了故宫。")

    def test_calendar_author_is_creator_for_both_viewers_and_keys_are_private(self):
        row = {
            "id": 12,
            "title": "去了北京",
            "content": "逛公园",
            "eventDate": date(2026, 11, 5),
            "kind": "diary",
            "calendarType": "solar",
            "annual": False,
            "remindDays": 0,
            "createdBy": 1,
            "creatorName": "小林",
            "createdAt": datetime(2026, 11, 13, 17, 24, 31),
            "creatorAvatarKey": "private/avatar.jpg",
            "creatorAvatarUrl": None,
        }
        for viewer in (1, 2):
            app = FastAPI()
            life.register(
                app,
                lambda: {"id": viewer, "coupleId": 7},
                lambda d=None, **kw: {"data": d},
                Error,
                lambda _: "space-seven",
                lambda _: True,
            )
            with (
                patch.object(life, "fetch_all", return_value=[row]) as fetch,
                patch.object(life, "fetch_one", return_value={"anniversary": None}),
                patch.object(life.storage, "signed_url", return_value="signed-avatar"),
            ):
                result = TestClient(app).get("/api/life/calendar?month=2026-11").json()["data"][0]
            self.assertEqual(result["kind"], "diary")
            self.assertEqual(result["createdBy"], 1)
            self.assertEqual(result["creatorName"], "小林")
            self.assertEqual(result["createdAt"], "2026-11-13 17:24:31")
            self.assertIn("e.created_at AS createdAt", fetch.call_args.args[0])
            self.assertEqual(result["creatorAvatarUrl"], "signed-avatar")
            self.assertNotIn("creatorAvatarKey", result)
            self.assertEqual(fetch.call_args.args[1], (7,))

    def test_convert_countdown_to_diary_keeps_original_creator(self):
        with (
            patch.object(life, "fetch_one", return_value={"id": 12}),
            patch.object(life, "execute", return_value=(0, 1)) as execute,
        ):
            response = self.client.put(
                "/api/life/events/12",
                json={
                    "title": "去了北京",
                    "kind": "diary",
                    "eventDate": "2026-11-04",
                    "content": "补记当天的事",
                },
            )
        self.assertEqual(response.status_code, 200)
        sql, params = execute.call_args.args
        self.assertNotIn("created_by", sql)
        self.assertIn("space_id=%s", sql)
        self.assertEqual(params[3], "diary")
        self.assertEqual(params[-2:], (12, 7))

    def test_home_copy_and_date_can_save_without_overwriting_space_name(self):
        with patch.object(life, "execute", return_value=(0, 1)) as execute:
            response = self.client.put(
                "/api/life/home",
                json={"tagline": "新的标语", "anniversary": "2026-04-30", "coupleId": 99},
            )
        self.assertEqual(response.status_code, 200)
        sql, params = execute.call_args.args
        self.assertNotIn("name=", sql)
        self.assertNotIn("home_title", sql)
        self.assertEqual(params, ("新的标语", date(2026, 4, 30), 7))

    def test_home_omitted_date_is_preserved_and_explicit_null_clears_it(self):
        with patch.object(life, "execute", return_value=(0, 1)) as execute:
            self.client.put("/api/life/home", json={"tagline": "只改一句话"})
        self.assertNotIn("anniversary=", execute.call_args.args[0])
        with patch.object(life, "execute", return_value=(0, 1)) as execute:
            self.client.put("/api/life/home", json={"anniversary": None})
        self.assertEqual(execute.call_args.args[1], (None, 7))

    def test_space_name_updates_only_token_space_and_no_hidden_fields(self):
        from app import main

        with patch.object(main, "execute", return_value=(0, 1)) as execute:
            result = main.update_space_name(
                {
                    "name": "新的空间",
                    "coupleId": 99,
                    "anniversary": "2000-01-01",
                    "backgroundImageKey": None,
                },
                {"coupleId": 7},
            )
        self.assertEqual(result["code"], 0)
        sql, params = execute.call_args.args
        self.assertEqual(params, ("新的空间", 7))
        self.assertNotIn("anniversary", sql)
        self.assertNotIn("background_image_key", sql)
        with self.assertRaises(main.AppError):
            main.update_space_name({"name": "   "}, {"coupleId": 7})


if __name__ == "__main__":
    unittest.main()
