import os
import re
from contextlib import contextmanager
from typing import Iterator

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
