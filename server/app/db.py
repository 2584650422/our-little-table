from contextlib import contextmanager
import re
import pymysql
from pymysql.cursors import DictCursor
from .config import settings

@contextmanager
def connection(transaction: bool = False):
    conn = pymysql.connect(
        host=settings.mysql_host, port=settings.mysql_port, user=settings.mysql_user,
        password=settings.mysql_password, database=settings.mysql_database,
        charset="utf8mb4", cursorclass=DictCursor, autocommit=not transaction,
        connect_timeout=settings.mysql_connect_timeout, read_timeout=settings.mysql_connect_timeout,
        write_timeout=settings.mysql_connect_timeout,
    )
    try:
        yield conn
        if transaction:
            conn.commit()
    except Exception:
        if transaction:
            conn.rollback()
        raise
    finally:
        conn.close()

def fetch_one(sql, params=(), conn=None):
    if conn:
        with conn.cursor() as cursor:
            cursor.execute(re.sub(r"(?<!%)%(?!s)", "%%", sql), params)
            return cursor.fetchone()
    with connection() as owned:
        return fetch_one(sql, params, owned)

def fetch_all(sql, params=(), conn=None):
    if conn:
        with conn.cursor() as cursor:
            cursor.execute(re.sub(r"(?<!%)%(?!s)", "%%", sql), params)
            return cursor.fetchall()
    with connection() as owned:
        return fetch_all(sql, params, owned)

def execute(sql, params=(), conn=None):
    if conn:
        with conn.cursor() as cursor:
            cursor.execute(re.sub(r"(?<!%)%(?!s)", "%%", sql), params)
            return cursor.lastrowid, cursor.rowcount
    with connection() as owned:
        return execute(sql, params, owned)
