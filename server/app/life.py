"""Shared calendar and private travel albums. All access is couple scoped."""

import calendar
from datetime import date, datetime, timedelta, timezone
from fastapi import Depends, Request
from .db import execute, fetch_all, fetch_one
from . import storage


def local_today():
    return datetime.now(timezone(timedelta(hours=8))).date()


def occurrence(event, year):
    source = event["eventDate"]
    if isinstance(source, str):
        source = date.fromisoformat(source)
    if event["calendarType"] == "lunar":
        from lunardate import LunarDate

        lunar = LunarDate.fromSolarDate(source.year, source.month, source.day)
        # 闰月生日在无相同闰月的年份过普通月；小月无三十则过二十九。
        leap = bool(lunar.isLeapMonth and LunarDate.leapMonthForYear(year) == lunar.month)
        for day in (lunar.day, lunar.day - 1):
            try:
                return LunarDate(year, lunar.month, day, leap).toSolarDate()
            except ValueError:
                continue
        raise ValueError("无法换算农历日期")
    return date(year, source.month, min(source.day, calendar.monthrange(year, source.month)[1]))


def next_occurrence(event, today):
    source = event["eventDate"]
    if isinstance(source, str):
        source = date.fromisoformat(source)
    if not event["annual"]:
        return source
    for year in range(max(source.year, today.year - 1), today.year + 3):
        result = occurrence(event, year)
        if result >= today and result >= source:
            return result
    raise ValueError("日期超出支持范围")


def register(app, coupled_user, success, AppError, couple_public_id, cleanup_image):
    def parse_date(value):
        try:
            result = date.fromisoformat(str(value))
            if not 1901 <= result.year <= 2098:
                raise ValueError()
            return result
        except (ValueError, TypeError):
            raise AppError("请选择 1901—2098 年之间的有效日期")

    def event_rows(cid):
        rows = fetch_all(
            """SELECT e.id,e.title,e.content,e.event_date AS eventDate,e.kind,
            e.calendar_type AS calendarType,e.annual,e.remind_days AS remindDays,
            e.created_by AS createdBy,e.created_at AS createdAt,u.nickname AS creatorName,
            u.avatar_key AS creatorAvatarKey,u.avatar_url AS creatorAvatarUrl
            FROM calendar_entries e LEFT JOIN users u ON u.id=e.created_by
            WHERE e.space_id=%s ORDER BY e.event_date,e.id""",
            (cid,),
        )
        result = []
        for source in rows:
            row = dict(source)
            row["creatorAvatarUrl"] = storage.signed_url(
                row.pop("creatorAvatarKey", None), row.get("creatorAvatarUrl")
            )
            row["creatorName"] = row.get("creatorName") or "记录人"
            # MySQL stores these timestamps in the project's Beijing time.
            # Return a wall-clock string so clients do not reinterpret it as UTC.
            if isinstance(row.get("createdAt"), datetime):
                row["createdAt"] = row["createdAt"].strftime("%Y-%m-%d %H:%M:%S")
            result.append(row)
        return result

    def hydrate_event(row, today):
        row = dict(row)
        upcoming = next_occurrence(row, today)
        row.update(
            nextDate=upcoming.isoformat(),
            days=(upcoming - today).days,
            eventDate=str(row["eventDate"]),
            annual=bool(row["annual"]),
        )
        row["reminderActive"] = row.get("kind") != "diary" and 0 <= row["days"] <= row["remindDays"]
        if row.get("calendarType") == "lunar":
            from lunardate import LunarDate

            source = date.fromisoformat(row["eventDate"])
            lunar = LunarDate.fromSolarDate(source.year, source.month, source.day)
            row["lunarDate"] = {
                "year": lunar.year,
                "month": lunar.month,
                "day": lunar.day,
                "leap": bool(lunar.isLeapMonth),
            }
        return row

    def photo_row(row):
        row["originalUrl"] = storage.signed_url(row.pop("originalKey"))
        row["previewUrl"] = storage.signed_url(row.pop("previewKey"))
        row["latitude"] = float(row["latitude"]) if row["latitude"] is not None else None
        row["longitude"] = float(row["longitude"]) if row["longitude"] is not None else None
        row["takenOn"] = str(row["takenOn"])
        return row

    photo_select = "SELECT id,original_key AS originalKey,preview_key AS previewKey,width,height,city,latitude,longitude,taken_on AS takenOn,caption,original_bytes AS originalBytes,preview_bytes AS previewBytes FROM photos"

    @app.get("/api/life/summary")
    def summary(user=Depends(coupled_user)):
        today = local_today()
        cid = user["coupleId"]
        couple = fetch_one(
            "SELECT name,anniversary,life_tagline AS tagline FROM spaces WHERE id=%s", (cid,)
        )
        start = couple["anniversary"]
        days = (today - start).days + 1 if start and start <= today else None
        upcoming = [hydrate_event(e, today) for e in event_rows(cid) if e["kind"] != "diary"]
        if start:
            anniversary = {
                "id": "anniversary",
                "title": "我们的周年纪念日",
                "eventDate": start,
                "kind": "anniversary",
                "calendarType": "solar",
                "annual": True,
                "remindDays": 7,
            }
            upcoming.append(hydrate_event(anniversary, today))
        if days:
            target = (days // 100 + 1) * 100
            upcoming.append(
                {
                    "id": "milestone",
                    "title": f"在一起第 {target} 天",
                    "nextDate": (today + timedelta(days=target - days)).isoformat(),
                    "days": target - days,
                    "kind": "milestone",
                    "reminderActive": target - days <= 7,
                }
            )
        upcoming = sorted((e for e in upcoming if e["days"] >= 0), key=lambda e: e["nextDate"])
        recent = fetch_one(photo_select + " WHERE space_id=%s ORDER BY id DESC LIMIT 1", (cid,))
        return success(
            {
                "name": couple["name"],
                "tagline": couple["tagline"],
                "anniversary": str(start) if start else None,
                "togetherDays": days,
                "today": today.isoformat(),
                "upcoming": upcoming,
                "recentPhoto": photo_row(recent) if recent else None,
            }
        )

    @app.put("/api/life/home")
    async def update_home(request: Request, user=Depends(coupled_user)):
        body = await request.json()
        assignments, values, changed = [], [], {}
        for field, column, limit in (("name", "name", 50), ("tagline", "life_tagline", 60)):
            if field not in body:
                continue
            value = str(body[field] or "").strip()
            if not 1 <= len(value) <= limit:
                raise AppError(
                    "空间名称需要 1—50 个字" if field == "name" else "首页一句话需要 1—60 个字"
                )
            assignments.append(column + "=%s")
            values.append(value)
            changed[field] = value
        if "anniversary" in body:
            start = parse_date(body["anniversary"]) if body["anniversary"] else None
            if start and start > local_today():
                raise AppError("在一起的日期不能晚于今天")
            assignments.append("anniversary=%s")
            values.append(start)
            changed["anniversary"] = start.isoformat() if start else None
        if not assignments:
            raise AppError("请选择需要更新的首页设置")
        execute(
            "UPDATE spaces SET " + ",".join(assignments) + " WHERE id=%s",
            (*values, user["coupleId"]),
        )
        return success(changed, message="首页设置已更新")

    @app.put("/api/life/anniversary")
    async def anniversary(request: Request, user=Depends(coupled_user)):
        start = parse_date((await request.json()).get("date"))
        if start > local_today():
            raise AppError("在一起的日期不能晚于今天")
        execute("UPDATE spaces SET anniversary=%s WHERE id=%s", (start, user["coupleId"]))
        return success(message="从这一天开始，慢慢记录")

    @app.get("/api/life/calendar")
    def calendar_month(month: str, user=Depends(coupled_user)):
        try:
            first = date.fromisoformat(month + "-01")
            if not 1902 <= first.year <= 2097:
                raise ValueError()
        except ValueError:
            raise AppError("请选择 1902—2097 年之间的月份")
        last = date(first.year, first.month, calendar.monthrange(first.year, first.month)[1])
        rows = list(event_rows(user["coupleId"]))
        start = fetch_one("SELECT anniversary FROM spaces WHERE id=%s", (user["coupleId"],))[
            "anniversary"
        ]
        if start:
            rows.append(
                {
                    "id": "anniversary",
                    "title": "我们的周年纪念日",
                    "eventDate": start,
                    "calendarType": "solar",
                    "annual": True,
                    "kind": "anniversary",
                    "remindDays": 7,
                }
            )
        result = []
        for row in rows:
            dates = (
                [row["eventDate"]]
                if not row["annual"]
                else [occurrence(row, y) for y in range(first.year - 1, first.year + 2)]
            )
            for day in dates:
                if first <= day <= last and day >= row["eventDate"]:
                    item = dict(row)
                    item.update(
                        eventDate=str(row["eventDate"]),
                        nextDate=day.isoformat(),
                        days=(day - local_today()).days,
                    )
                    result.append(item)
        if start:
            n = max(100, ((first - start).days + 1 + 99) // 100 * 100)
            while start + timedelta(days=n - 1) <= last:
                day = start + timedelta(days=n - 1)
                if day >= first:
                    result.append(
                        {
                            "id": "milestone-" + str(n),
                            "title": f"在一起第 {n} 天",
                            "kind": "milestone",
                            "nextDate": day.isoformat(),
                            "days": (day - local_today()).days,
                        }
                    )
                n += 100
        return success(sorted(result, key=lambda x: x["nextDate"]))

    @app.get("/api/life/events")
    def events(user=Depends(coupled_user)):
        return success([hydrate_event(e, local_today()) for e in event_rows(user["coupleId"])])

    def payload(body):
        title = str(body.get("title") or "").strip()
        if not title or len(title) > 60:
            raise AppError("日子名称需要 1—60 个字")
        kind = body.get("kind", "countdown")
        cal = body.get("calendarType", "solar")
        if kind not in ("birthday", "anniversary", "countdown", "diary") or cal not in (
            "solar",
            "lunar",
        ):
            raise AppError("日子类型不正确")
        if kind == "diary":
            cal = "solar"
        lunar = body.get("lunarDate")
        if cal == "lunar" and lunar is not None:
            from lunardate import LunarDate

            try:
                if (
                    not isinstance(lunar, dict)
                    or any(type(lunar.get(k)) is not int for k in ("year", "month", "day"))
                    or type(lunar.get("leap", False)) is not bool
                ):
                    raise ValueError()
                if (
                    not 1901 <= lunar["year"] <= 2098
                    or not 1 <= lunar["month"] <= 12
                    or not 1 <= lunar["day"] <= 30
                ):
                    raise ValueError()
                dt = LunarDate(
                    lunar["year"], lunar["month"], lunar["day"], lunar.get("leap", False)
                ).toSolarDate()
            except (ValueError, TypeError, KeyError):
                raise AppError("农历日期不存在，请检查年月日和闰月")
        else:
            dt = parse_date(body.get("eventDate"))
        annual = kind in ("birthday", "anniversary")
        content = str(body.get("content") or "").strip() if kind == "diary" else ""
        if len(content) > 3000:
            raise AppError("当天记录不超过 3000 字")
        reminder = body.get("remindDays", 7)
        if kind == "diary":
            reminder = 0
        if type(reminder) is not int or reminder not in (0, 1, 3, 7, 14, 30):
            raise AppError("提醒天数不正确")
        try:
            next_occurrence({"eventDate": dt, "calendarType": cal, "annual": annual}, local_today())
        except ValueError:
            raise AppError("日期超出农历支持范围")
        return title, content, dt, kind, cal, annual, reminder

    @app.post("/api/life/events")
    async def create_event(request: Request, user=Depends(coupled_user)):
        values = payload(await request.json())
        eid, _ = execute(
            "INSERT INTO calendar_entries (title,content,event_date,kind,calendar_type,annual,remind_days,space_id,created_by) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)",
            (*values, user["coupleId"], user["id"]),
        )
        return success({"id": eid})

    @app.put("/api/life/events/{event_id}")
    async def edit_event(event_id: int, request: Request, user=Depends(coupled_user)):
        values = payload(await request.json())
        if not fetch_one(
            "SELECT id FROM calendar_entries WHERE id=%s AND space_id=%s",
            (event_id, user["coupleId"]),
        ):
            raise AppError("这条日子不存在", 404)
        execute(
            "UPDATE calendar_entries SET title=%s,content=%s,event_date=%s,kind=%s,calendar_type=%s,annual=%s,remind_days=%s WHERE id=%s AND space_id=%s",
            (*values, event_id, user["coupleId"]),
        )
        return success()

    @app.delete("/api/life/events/{event_id}")
    def delete_event(event_id: int, user=Depends(coupled_user)):
        execute(
            "DELETE FROM calendar_entries WHERE id=%s AND space_id=%s", (event_id, user["coupleId"])
        )
        return success()

    @app.get("/api/life/photos")
    def photos(beforeId: int = 0, user=Depends(coupled_user)):
        rows = fetch_all(
            photo_select + " WHERE space_id=%s AND (%s=0 OR id<%s) ORDER BY id DESC LIMIT 51",
            (user["coupleId"], beforeId, beforeId),
        )
        return success({"items": [photo_row(row) for row in rows[:50]], "hasMore": len(rows) > 50})

    def photo_metadata(body):
        city = str(body.get("city") or "").strip()
        caption = str(body.get("caption") or "").strip()
        if not city or len(city) > 80 or len(caption) > 200:
            raise AppError("请填写地点，描述不超过 200 字")
        raw_lat, raw_lng = body.get("latitude"), body.get("longitude")
        if raw_lat is None and raw_lng is None:
            lat = lng = None
        else:
            try:
                lat = float(raw_lat)
                lng = float(raw_lng)
                if not -90 <= lat <= 90 or not -180 <= lng <= 180:
                    raise ValueError()
            except (ValueError, TypeError):
                raise AppError("地图坐标无效，请重新选择地点")
        taken = parse_date(body.get("takenOn"))
        if taken > local_today():
            raise AppError("拍摄日期不能晚于今天")
        return city, caption, lat, lng, taken

    @app.post("/api/life/photos")
    async def create_photo(request: Request, user=Depends(coupled_user)):
        body = await request.json()
        public = couple_public_id(user["coupleId"])
        original = body.get("originalKey")
        preview = body.get("previewKey")
        for key, folder in ((original, "travel-originals/"), (preview, "travel-previews/")):
            if not isinstance(key, str) or not key.startswith(
                storage.couple_prefix(public) + folder
            ):
                raise AppError("图片不属于当前空间", 403)
        width = body.get("width")
        height = body.get("height")
        if any(type(n) is not int or not 1 <= n <= 100000 for n in (width, height)):
            raise AppError("图片尺寸无效")
        city, caption, lat, lng, taken = photo_metadata(body)
        sizes = []
        for key in (original, preview):
            meta = storage._client().head_object(Bucket=storage.settings.cos_bucket, Key=key)
            if not str(meta.get("Content-Type", "")).startswith("image/"):
                raise AppError("上传对象不是图片")
            sizes.append(int(meta["Content-Length"]))
        pid, _ = execute(
            "INSERT INTO photos (space_id,original_key,preview_key,width,height,original_bytes,preview_bytes,city,latitude,longitude,taken_on,caption,created_by) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
            (
                user["coupleId"],
                original,
                preview,
                width,
                height,
                *sizes,
                city,
                lat,
                lng,
                taken,
                caption,
                user["id"],
            ),
        )
        return success({"id": pid})

    @app.get("/api/life/photos/{photo_id}")
    def get_photo(photo_id: int, user=Depends(coupled_user)):
        row = fetch_one(photo_select + " WHERE id=%s AND space_id=%s", (photo_id, user["coupleId"]))
        if not row:
            raise AppError("这张照片不存在", 404)
        return success(photo_row(row))

    @app.put("/api/life/photos/{photo_id}")
    async def update_photo(photo_id: int, request: Request, user=Depends(coupled_user)):
        if not fetch_one(
            "SELECT id FROM photos WHERE id=%s AND space_id=%s", (photo_id, user["coupleId"])
        ):
            raise AppError("这张照片不存在", 404)
        city, caption, lat, lng, taken = photo_metadata(await request.json())
        execute(
            "UPDATE photos SET city=%s,caption=%s,latitude=%s,longitude=%s,taken_on=%s WHERE id=%s AND space_id=%s",
            (city, caption, lat, lng, taken, photo_id, user["coupleId"]),
        )
        return success({"id": photo_id})

    @app.delete("/api/life/photos/{photo_id}")
    def delete_photo(photo_id: int, user=Depends(coupled_user)):
        row = fetch_one(
            "SELECT original_key AS originalKey,preview_key AS previewKey FROM photos WHERE id=%s AND space_id=%s",
            (photo_id, user["coupleId"]),
        )
        if not row:
            raise AppError("这张照片不存在", 404)
        # 删除记录后对象清理由显式 discard/运维清理完成，避免删除共享或仍引用的原图。
        execute("DELETE FROM photos WHERE id=%s AND space_id=%s", (photo_id, user["coupleId"]))
        for key in (row["originalKey"], row["previewKey"]):
            try:
                cleanup_image(key)
            except Exception:
                import logging

                logging.getLogger("little_table").warning(
                    "travel.deleted_object_cleanup_pending photoId=%s", photo_id
                )
        return success()
