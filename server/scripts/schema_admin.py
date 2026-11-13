"""Read-only migration verification. Prints counts/digests, never user data or secrets.

Run inside the candidate container with its normal database environment:
  PYTHONPATH=/app python /checks/schema_admin.py little_table our_time /checks/rename-map.json
"""

import argparse
import hashlib
import json
import re
from app.db import connection


def identifier(value):
    if not re.fullmatch(r"[a-z][a-z0-9_]{0,63}", value):
        raise ValueError("Invalid SQL identifier")
    return "`" + value + "`"


def snapshot(cursor, database, table, renamed=False):
    cursor.execute("SELECT * FROM " + identifier(database) + "." + identifier(table))
    rows = []
    for row in cursor.fetchall():
        if renamed:
            row = {
                {"couple_id": "space_id", "order_id": "meal_id"}.get(k, k): v
                for k, v in row.items()
            }
        rows.append(
            json.dumps(row, ensure_ascii=False, sort_keys=True, default=str, separators=(",", ":"))
        )
    rows.sort()
    digest = hashlib.sha256()
    for row in rows:
        digest.update(row.encode())
        digest.update(b"\n")
    return len(rows), digest.hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source")
    parser.add_argument("target")
    parser.add_argument("mapping")
    args = parser.parse_args()
    mapping = json.load(open(args.mapping))
    for name in ("users", "dishes", "meal_reviews"):
        mapping[name] = name
    with connection() as conn, conn.cursor() as cursor:
        for old, new in mapping.items():
            before = snapshot(cursor, args.source, old, True)
            after = snapshot(cursor, args.target, new)
            if before != after:
                raise RuntimeError(f"Data mismatch: {old} -> {new}")
            print(f"{old} -> {new}: {after[0]} rows MATCH")
        cursor.execute("SELECT table_name FROM " + identifier(args.target) + ".table_guide")
        documented = {r["table_name"] for r in cursor.fetchall()}
        cursor.execute(
            "SELECT table_name AS name FROM information_schema.tables WHERE table_schema=%s",
            (args.target,),
        )
        actual = {r["name"] for r in cursor.fetchall()}
        assert documented == actual, (documented, actual)
        cursor.execute(
            "SELECT COUNT(*) AS count FROM information_schema.key_column_usage WHERE table_schema=%s AND referenced_table_schema IS NOT NULL AND referenced_table_schema<>%s",
            (args.target, args.target),
        )
        assert cursor.fetchone()["count"] == 0, "Foreign keys still point outside the new database"
        cursor.execute(
            "SELECT table_name,column_name,referenced_table_name,referenced_column_name FROM information_schema.key_column_usage WHERE table_schema=%s AND referenced_table_name IS NOT NULL",
            (args.target,),
        )
        for fk in cursor.fetchall():
            child = identifier(args.target) + "." + identifier(fk["table_name"])
            parent = identifier(args.target) + "." + identifier(fk["referenced_table_name"])
            col = identifier(fk["column_name"])
            ref = identifier(fk["referenced_column_name"])
            cursor.execute(
                f"SELECT COUNT(*) AS count FROM {child} c LEFT JOIN {parent} p ON c.{col}=p.{ref} WHERE c.{col} IS NOT NULL AND p.{ref} IS NULL"
            )
            assert cursor.fetchone()["count"] == 0, f"Orphan reference in {fk['table_name']}"
    print(
        "PASS: all original rows match, table guide complete, foreign keys internal and no orphan references"
    )


if __name__ == "__main__":
    main()
