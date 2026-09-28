"""Attach local JPEGs to existing meal-history records without changing comments.

Files must be named ``order-<id>-*.jpg``. The default is a read-only preview.
Run inside the API environment, for example::

    PYTHONPATH=. python scripts/import_order_photos.py \
      --couple-id 1 --folder /path/to/history-demo --apply
"""

import argparse
import re
import uuid
from datetime import datetime
from pathlib import Path

import httpx

from app import storage
from app.config import settings
from app.db import connection, execute, fetch_all, fetch_one


def main():
    parser = argparse.ArgumentParser(description="Upload photos for history orders that do not yet have one")
    parser.add_argument("--couple-id", type=int, required=True)
    parser.add_argument("--folder", type=Path, required=True)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    if not args.folder.is_dir():
        parser.error("photo folder does not exist")
    couple = fetch_one("SELECT public_id AS publicId FROM couples WHERE id=%s", (args.couple_id,))
    if not couple:
        parser.error("couple does not exist")

    photos = {}
    for path in args.folder.iterdir():
        match = re.fullmatch(r"order-(\d+)-.+\.jpg", path.name)
        if not match:
            continue
        order_id = int(match.group(1))
        if order_id in photos:
            parser.error(f"duplicate photo for order {order_id}")
        if path.stat().st_size > 2 * 1024 * 1024:
            parser.error(f"photo exceeds 2MB: {path.name}")
        photos[order_id] = path
    if not photos:
        parser.error("no order-<id>-*.jpg photos found")

    pending = []
    for order_id, path in sorted(photos.items()):
        order = fetch_one("SELECT id,couple_id AS coupleId,creator_user_id AS creatorUserId,status FROM orders WHERE id=%s", (order_id,))
        if not order or order["coupleId"] != args.couple_id or order["status"] not in ("ready", "completed"):
            parser.error(f"order {order_id} is not a completed/served record of this couple")
        existing = fetch_one("SELECT id FROM meal_reviews WHERE order_id=%s AND (image_key IS NOT NULL OR image_url IS NOT NULL) LIMIT 1", (order_id,))
        if existing:
            parser.error(f"order {order_id} already has a meal photo; refusing to replace it")
        pending.append((order, path))
        print(f"{'UPLOAD' if args.apply else 'WOULD UPLOAD'} order={order_id} user={order['creatorUserId']} file={path.name} bytes={path.stat().st_size}")
    if not args.apply:
        return
    if not storage.configured():
        parser.error("COS is not configured")

    client = storage._client()
    for order, path in pending:
        order_id = order["id"]
        key = f"{storage.couple_prefix(couple['publicId'])}meal-images/{datetime.now():%Y/%m}/{uuid.uuid4()}.jpg"
        with path.open("rb") as body:
            client.put_object(Bucket=settings.cos_bucket, Key=key, Body=body, ContentType="image/jpeg")
        try:
            response = httpx.get(storage.signed_url(key), timeout=10)
            if response.status_code != 200 or len(response.content) != path.stat().st_size:
                raise RuntimeError(f"uploaded image could not be read back: order {order_id}")
            with connection(transaction=True) as conn:
                locked = fetch_one("SELECT couple_id AS coupleId,status,creator_user_id AS creatorUserId FROM orders WHERE id=%s FOR UPDATE", (order_id,), conn)
                existing = fetch_one("SELECT id FROM meal_reviews WHERE order_id=%s AND (image_key IS NOT NULL OR image_url IS NOT NULL) LIMIT 1", (order_id,), conn)
                if not locked or locked["coupleId"] != args.couple_id or locked["status"] not in ("ready", "completed") or existing:
                    raise RuntimeError(f"order {order_id} changed during upload; no data was overwritten")
                execute("INSERT INTO meal_reviews (order_id,user_id,image_key,image_url) VALUES (%s,%s,%s,NULL) ON DUPLICATE KEY UPDATE image_key=VALUES(image_key),image_url=NULL",
                        (order_id, locked["creatorUserId"], key), conn)
            print(f"UPLOADED order={order_id} key={key}")
        except Exception:
            storage.delete_keys([key])
            raise


if __name__ == "__main__":
    main()
