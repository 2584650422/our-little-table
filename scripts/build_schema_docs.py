"""Generate MySQL table comments/catalog and schema-015 from a single JSON source."""

from pathlib import Path
import argparse
import json
import re

ROOT = Path(__file__).resolve().parents[1]


def build_guide(catalog):
    quote = lambda value: "'" + value.replace("'", "''") + "'"
    guide = """CREATE TABLE IF NOT EXISTS table_guide (
  table_name VARCHAR(64) PRIMARY KEY,
  module VARCHAR(30) NOT NULL,
  purpose VARCHAR(160) NOT NULL,
  contents VARCHAR(600) NOT NULL,
  privacy_note VARCHAR(600) NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='数据库表用途与维护说明';
"""
    comments = "\n".join(
        f"ALTER TABLE `{r['table']}` COMMENT={quote(r['purpose'])};" for r in catalog
    )
    values = ",\n".join(
        "("
        + ",".join(
            quote(r[k]) for k in ["table", "module", "purpose", "contents", "privacy"]
        )
        + ")"
        for r in catalog
    )
    guide += (
        "\n"
        + comments
        + "\n\nINSERT INTO table_guide (table_name,module,purpose,contents,privacy_note) VALUES\n"
        + values
        + "\nON DUPLICATE KEY UPDATE module=VALUES(module),purpose=VALUES(purpose),contents=VALUES(contents),privacy_note=VALUES(privacy_note);\n"
    )
    return guide


def generated_files():
    catalog = json.loads((ROOT / "database/catalog.json").read_text())
    mapping = json.loads((ROOT / "database/rename-map.json").read_text())
    guide = build_guide(catalog)
    migration = "-- Schema 015: run ONLY on a restored copy of the old database with API writes stopped.\n-- No USE statement: the caller must explicitly select the target database.\n-- DDL auto-commits on MySQL 5.7; rollback switches back to the preserved old database.\nRENAME TABLE\n"
    migration += ",\n".join(f"  `{a}` TO `{b}`" for a, b in mapping.items()) + ";\n\n"
    for table in [
        "users",
        "space_members",
        "dish_categories",
        "dishes",
        "meals",
        "calendar_entries",
        "photos",
    ]:
        null = "NULL" if table == "users" else "NOT NULL"
        migration += f"ALTER TABLE `{table}` CHANGE COLUMN couple_id space_id BIGINT UNSIGNED {null};\n"
    for table in ["meal_items", "meal_reviews", "messages"]:
        null = "NULL" if table == "messages" else "NOT NULL"
        migration += f"ALTER TABLE `{table}` CHANGE COLUMN order_id meal_id BIGINT UNSIGNED {null};\n"
    migration += (
        "ALTER TABLE spaces ALTER COLUMN name SET DEFAULT '我们的时光';\n\n"
        + build_guide(
            [
                r
                for r in catalog
                if r["table"] not in {"thought_messages", "notification_preferences"}
            ]
        )
    )
    doc = "# 数据库表说明\n\n当前数据库：`our_time`。本页和数据库内的 `table_guide` 由 `database/catalog.json` 同步生成。\n\n| 表名 | 模块 | 用途 | 保存内容 | 隐私与维护 |\n|---|---|---|---|---|\n"
    for r in catalog:
        doc += (
            "|"
            + "|".join(
                [
                    f"`{r['table']}`",
                    r["module"],
                    r["purpose"],
                    r["contents"],
                    r["privacy"],
                ]
            )
            + "|\n"
        )
    schema_path = ROOT / "database/schema.sql"
    schema = schema_path.read_text().split("-- BEGIN TABLE GUIDE")[0].rstrip()
    schema = schema.replace("DEFAULT '我们的小饭桌'", "DEFAULT '我们的时光'")
    return {
        "database/schema.sql": schema
        + "\n\n-- BEGIN TABLE GUIDE (generated)\n"
        + guide,
        "database/table-guide.sql": guide,
        "database/migrations/015_space_schema.sql": migration,
        "docs/database-tables.md": doc,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    for name, text in generated_files().items():
        path = ROOT / name
        if args.check:
            if not path.exists() or path.read_text() != text:
                raise SystemExit(f"Generated file out of date: {name}")
        else:
            path.write_text(text)
    print("Schema docs consistent" if args.check else "Schema docs generated")


if __name__ == "__main__":
    main()
