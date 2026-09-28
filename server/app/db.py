"""MySQL 访问薄封装。

业务函数通过 fetch_one/fetch_all/execute 执行参数化 SQL。需要跨多条 SQL
保持原子性的流程使用 connection(transaction=True)，退出上下文时自动提交，
发生异常则回滚。查询结果使用字典游标，字段别名可直接作为 API 字段名。
"""
from contextlib import contextmanager
import re
import pymysql
from pymysql.cursors import DictCursor
from .config import settings

@contextmanager
def connection(transaction: bool = False):
    """打开并关闭一个数据库连接；transaction=True 时提供提交/回滚边界。"""
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
    """执行查询并返回一行；传入 conn 时复用调用方的事务连接。"""
    if conn:
        with conn.cursor() as cursor:
            cursor.execute(re.sub(r"(?<!%)%(?!s)", "%%", sql), params)
            return cursor.fetchone()
    with connection() as owned:
        return fetch_one(sql, params, owned)

def fetch_all(sql, params=(), conn=None):
    """执行查询并返回所有行；传入 conn 时复用调用方的事务连接。"""
    if conn:
        with conn.cursor() as cursor:
            cursor.execute(re.sub(r"(?<!%)%(?!s)", "%%", sql), params)
            return cursor.fetchall()
    with connection() as owned:
        return fetch_all(sql, params, owned)

def execute(sql, params=(), conn=None):
    """执行写入/更新，返回 (自增 ID, 影响行数)。"""
    if conn:
        with conn.cursor() as cursor:
            cursor.execute(re.sub(r"(?<!%)%(?!s)", "%%", sql), params)
            return cursor.lastrowid, cursor.rowcount
    with connection() as owned:
        return execute(sql, params, owned)
