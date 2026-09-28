"""将本地菜品照片补到已有菜品上，默认只预览且不覆盖已有图片。

在 server/ 目录运行：PYTHONPATH=. .venv/bin/python scripts/import_dish_photos.py
  --couple-id 1 --folder /path/to/photos --apply
不加 --apply 时只检查匹配结果，不会上传或修改数据库。
"""
import argparse
import re
import uuid
from datetime import datetime
from pathlib import Path

import httpx

from app import storage
from app.config import settings
from app.db import execute, fetch_all, fetch_one


def main():
    """校验菜品、图片名和饭桌归属，再按需上传并回写图片 key。"""
    parser = argparse.ArgumentParser(description="Upload photos only for dishes without an image")
    parser.add_argument("--couple-id", type=int, required=True)
    parser.add_argument("--folder", type=Path, required=True)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--replace-names", nargs="*", default=[], metavar="DISH_NAME",
                        help="explicitly replace these existing dish photos")
    args = parser.parse_args()
    if not args.folder.is_dir():
        parser.error("image folder does not exist")
    couple = fetch_one("SELECT public_id AS publicId FROM couples WHERE id=%s", (args.couple_id,))
    if not couple:
        parser.error("couple ID does not exist")
    dishes = fetch_all("SELECT id,name,image_key AS imageKey FROM dishes WHERE couple_id=%s AND enabled=1 ORDER BY id", (args.couple_id,))
    replacements = set(args.replace_names)
    for name in replacements:
        if sum(dish["name"] == name for dish in dishes) != 1:
            parser.error(f"replacement requires exactly one matching dish: {name}")
    photos = {}
    for path in args.folder.glob("*.jpg"):
        match = re.fullmatch(r"\d+-(.+)\.jpg", path.name)
        if match:
            if match.group(1) in photos:
                parser.error(f"duplicate photo for {match.group(1)}")
            photos[match.group(1)] = path
    # 只有缺图的菜品会默认匹配；覆盖已有照片必须通过 --replace-names 明确点名。
    pending = [(dish, photos[dish["name"]]) for dish in dishes if dish["name"] in photos and (not dish["imageKey"] or dish["name"] in replacements)]
    print(f"couple={args.couple_id} dishes={len(dishes)} missing_images={sum(not d['imageKey'] for d in dishes)} matched={len(pending)}")
    for dish, path in pending:
        if path.stat().st_size > 2 * 1024 * 1024:
            parser.error(f"photo exceeds 2MB: {path.name}")
        print(f"{'UPLOAD' if args.apply else 'WOULD UPLOAD'} id={dish['id']} {dish['name']} ({path.stat().st_size} bytes) replacing={bool(dish['imageKey'])}")
    if not args.apply:
        return
    if not storage.configured():
        parser.error("COS is not configured")
    client = storage._client()
    from app.main import delete_unreferenced_image
    succeeded = 0
    for dish, path in pending:
        old_key = dish["imageKey"]
        if old_key and not storage.is_couple_key(old_key, couple["publicId"]):
            parser.error(f"existing image is outside this couple's COS prefix: {dish['name']}")
        key = f"{storage.couple_prefix(couple['publicId'])}dish-images/{datetime.now():%Y/%m}/{uuid.uuid4()}.jpg"
        with path.open("rb") as body:
            client.put_object(Bucket=settings.cos_bucket, Key=key, Body=body, ContentType="image/jpeg")
        try:
            # 上传后先用签名 URL 回读校验，再用旧 key 条件更新，避免覆盖并发修改。
            response = httpx.get(storage.signed_url(key), timeout=10)
            if response.status_code != 200 or len(response.content) != path.stat().st_size:
                raise RuntimeError(f"uploaded image could not be read back: {dish['name']}")
            if old_key:
                _, count = execute("UPDATE dishes SET image_key=%s,image_url=NULL WHERE id=%s AND couple_id=%s AND image_key=%s", (key, dish["id"], args.couple_id, old_key))
            else:
                _, count = execute("UPDATE dishes SET image_key=%s,image_url=NULL WHERE id=%s AND couple_id=%s AND image_key IS NULL", (key, dish["id"], args.couple_id))
            if not count:
                storage.delete_keys([key])
                print(f"SKIPPED id={dish['id']} (photo added concurrently)")
                continue
            succeeded += 1
        except Exception:
            storage.delete_keys([key])
            raise
        if old_key:
            deleted = delete_unreferenced_image(old_key)
            print(f"OLD IMAGE id={dish['id']} deleted={deleted}")
    print(f"uploaded={succeeded}")


if __name__ == "__main__":
    main()
