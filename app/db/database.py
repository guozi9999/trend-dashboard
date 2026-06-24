import os
import re
import json
from datetime import date, datetime
from contextlib import contextmanager
from typing import Iterator, Optional

import pymysql
from dotenv import load_dotenv

load_dotenv()


DB_HOST = os.getenv("MYSQL_HOST", os.getenv("LEASE_DB_HOST", "127.0.0.1"))
DB_PORT = int(os.getenv("MYSQL_PORT", os.getenv("LEASE_DB_PORT", "3306")))
DB_USER = os.getenv("MYSQL_USER", os.getenv("LEASE_DB_USER", "root"))
DB_PASSWORD = os.getenv("MYSQL_PASSWORD", os.getenv("LEASE_DB_PASSWORD", ""))
DB_NAME = os.getenv("MYSQL_DATABASE", os.getenv("LEASE_DB_NAME", "trend_dashboard"))
DB_CHARSET = os.getenv("MYSQL_CHARSET", os.getenv("LEASE_DB_CHARSET", "utf8mb4"))
DB_CONNECT_TIMEOUT = int(os.getenv("MYSQL_CONNECT_TIMEOUT", "10"))
DB_CREATE_DATABASE = os.getenv("MYSQL_CREATE_DATABASE", "false").lower() in ("1", "true", "yes", "on")


def _validate_mysql_identifier(value: str, label: str) -> str:
    if not re.fullmatch(r"[A-Za-z0-9_]+", value):
        raise ValueError(f"{label} can only contain letters, numbers, and underscores")
    return value


DB_NAME = _validate_mysql_identifier(DB_NAME, "MYSQL_DATABASE")
DB_CHARSET = _validate_mysql_identifier(DB_CHARSET, "MYSQL_CHARSET")


def get_connection():
    # 获取 MySQL 数据库连接
    return pymysql.connect(
        host=DB_HOST,
        port=DB_PORT,
        user=DB_USER,
        password=DB_PASSWORD,
        database=DB_NAME,
        charset=DB_CHARSET,
        connect_timeout=DB_CONNECT_TIMEOUT,
        autocommit=False,
        cursorclass=pymysql.cursors.DictCursor,
    )


@contextmanager
def db_session() -> Iterator[pymysql.connections.Connection]:
    conn = get_connection()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

def init_db():
    # 初始化数据库表结构
    with db_session() as conn:
        with conn.cursor() as cursor:
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS rotation_boards (
                    trade_date VARCHAR(20) NOT NULL PRIMARY KEY,
                    board_data JSON,
                    fetched_at DATETIME
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            """)
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS market_temperature_boards (
                    category VARCHAR(50) NOT NULL,
                    trade_date VARCHAR(20) NOT NULL,
                    board_data JSON,
                    fetched_at DATETIME,
                    PRIMARY KEY (category, trade_date)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            """)
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS kline_cache (
                    cache_date DATE NOT NULL,
                    kind VARCHAR(50) NOT NULL,
                    symbol VARCHAR(50) NOT NULL,
                    kline_data JSON NOT NULL,
                    fetched_at DATETIME NOT NULL,
                    PRIMARY KEY (cache_date, kind, symbol)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            """)
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS scheduled_tasks (
                    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
                    name VARCHAR(100) NOT NULL,
                    task_type VARCHAR(50) NOT NULL,
                    run_time CHAR(5) NOT NULL,
                    enabled TINYINT(1) NOT NULL DEFAULT 1,
                    last_run_date DATE NULL,
                    last_run_at DATETIME NULL,
                    last_status VARCHAR(20) NULL,
                    last_message TEXT NULL,
                    created_at DATETIME NOT NULL,
                    updated_at DATETIME NOT NULL,
                    UNIQUE KEY uniq_task_type (task_type)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            """)
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS dashboard_page_cache (
                    cache_date DATE NOT NULL,
                    offset_days INT NOT NULL,
                    page_data JSON NOT NULL,
                    fetched_at DATETIME NOT NULL,
                    PRIMARY KEY (cache_date, offset_days)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            """)
            cursor.execute("""
                INSERT IGNORE INTO scheduled_tasks
                    (name, task_type, run_time, enabled, created_at, updated_at)
                VALUES
                    ('每日缓存行情', 'prefetch_market_data', '18:00', 1, NOW(), NOW())
            """)


def _json_default(value):
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    raise TypeError(f"Object of type {type(value).__name__} is not JSON serializable")


def get_kline_cache(symbol: str, kind: str, cache_date: Optional[date] = None):
    cache_date = cache_date or date.today()
    with db_session() as conn:
        with conn.cursor() as cursor:
            cursor.execute(
                """
                SELECT kline_data
                FROM kline_cache
                WHERE cache_date = %s AND kind = %s AND symbol = %s
                """,
                (cache_date, kind, symbol),
            )
            row = cursor.fetchone()
    if not row:
        return None
    data = row["kline_data"]
    return json.loads(data) if isinstance(data, str) else data


def save_kline_cache(symbol: str, kind: str, rows, cache_date: Optional[date] = None):
    cache_date = cache_date or date.today()
    payload = json.dumps(rows, ensure_ascii=False, default=_json_default)
    with db_session() as conn:
        with conn.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO kline_cache (cache_date, kind, symbol, kline_data, fetched_at)
                VALUES (%s, %s, %s, %s, %s)
                ON DUPLICATE KEY UPDATE
                    kline_data = VALUES(kline_data),
                    fetched_at = VALUES(fetched_at)
                """,
                (cache_date, kind, symbol, payload, datetime.now()),
            )


def get_dashboard_page_cache(offset_days: int = 0, cache_date: Optional[date] = None):
    cache_date = cache_date or date.today()
    with db_session() as conn:
        with conn.cursor() as cursor:
            cursor.execute(
                """
                SELECT page_data
                FROM dashboard_page_cache
                WHERE cache_date = %s AND offset_days = %s
                """,
                (cache_date, offset_days),
            )
            row = cursor.fetchone()
    if not row:
        return None
    data = row["page_data"]
    return json.loads(data) if isinstance(data, str) else data


def save_dashboard_page_cache(offset_days: int, page_data, cache_date: Optional[date] = None):
    cache_date = cache_date or date.today()
    payload = json.dumps(page_data, ensure_ascii=False, default=_json_default)
    with db_session() as conn:
        with conn.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO dashboard_page_cache (cache_date, offset_days, page_data, fetched_at)
                VALUES (%s, %s, %s, %s)
                ON DUPLICATE KEY UPDATE
                    page_data = VALUES(page_data),
                    fetched_at = VALUES(fetched_at)
                """,
                (cache_date, offset_days, payload, datetime.now()),
            )


def list_scheduled_tasks():
    with db_session() as conn:
        with conn.cursor() as cursor:
            cursor.execute("""
                SELECT id, name, task_type, run_time, enabled, last_run_date,
                       last_run_at, last_status, last_message, created_at, updated_at
                FROM scheduled_tasks
                ORDER BY id
            """)
            return cursor.fetchall()


def get_scheduled_task(task_id: int):
    with db_session() as conn:
        with conn.cursor() as cursor:
            cursor.execute(
                """
                SELECT id, name, task_type, run_time, enabled, last_run_date,
                       last_run_at, last_status, last_message, created_at, updated_at
                FROM scheduled_tasks
                WHERE id = %s
                """,
                (task_id,),
            )
            return cursor.fetchone()


def upsert_scheduled_task(name: str, task_type: str, run_time: str, enabled: bool = True):
    with db_session() as conn:
        with conn.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO scheduled_tasks
                    (name, task_type, run_time, enabled, created_at, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s)
                ON DUPLICATE KEY UPDATE
                    name = VALUES(name),
                    run_time = VALUES(run_time),
                    enabled = VALUES(enabled),
                    updated_at = VALUES(updated_at)
                """,
                (name, task_type, run_time, int(enabled), datetime.now(), datetime.now()),
            )


def set_scheduled_task_enabled(task_id: int, enabled: bool):
    with db_session() as conn:
        with conn.cursor() as cursor:
            cursor.execute(
                """
                UPDATE scheduled_tasks
                SET enabled = %s, updated_at = %s
                WHERE id = %s
                """,
                (int(enabled), datetime.now(), task_id),
            )


def update_scheduled_task_result(task_id: int, status: str, message: str):
    now = datetime.now()
    with db_session() as conn:
        with conn.cursor() as cursor:
            cursor.execute(
                """
                UPDATE scheduled_tasks
                SET last_run_date = %s,
                    last_run_at = %s,
                    last_status = %s,
                    last_message = %s,
                    updated_at = %s
                WHERE id = %s
                """,
                (now.date(), now, status, message[:2000], now, task_id),
            )


def ensure_database_exists():
    # MySQL 连接指定 database 前必须先保证库存在。
    conn = pymysql.connect(
        host=DB_HOST,
        port=DB_PORT,
        user=DB_USER,
        password=DB_PASSWORD,
        charset=DB_CHARSET,
        connect_timeout=DB_CONNECT_TIMEOUT,
        autocommit=True,
        cursorclass=pymysql.cursors.DictCursor,
    )
    try:
        with conn.cursor() as cursor:
            cursor.execute(
                f"CREATE DATABASE IF NOT EXISTS `{DB_NAME}` "
                f"DEFAULT CHARACTER SET {DB_CHARSET} "
                "COLLATE utf8mb4_unicode_ci"
            )
    finally:
        conn.close()


def init_mysql():
    if DB_CREATE_DATABASE:
        ensure_database_exists()
    init_db()


if __name__ == "__main__":
    init_mysql()
