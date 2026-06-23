import sqlite3
import pandas as pd
from typing import List, Dict, Any, Optional

DB_PATH = "dashboard.sqlite3"

def get_connection():
    # 获取 SQLite 数据库连接
    return sqlite3.connect(DB_PATH)

def init_db():
    # 初始化数据库表结构
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS rotation_boards (
                trade_date TEXT PRIMARY KEY,
                board_data TEXT,
                fetched_at TEXT
            )
        """)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS market_temperature_boards (
                category TEXT,
                trade_date TEXT,
                board_data TEXT,
                fetched_at TEXT,
                PRIMARY KEY (category, trade_date)
            )
        """)
        conn.commit()

init_db()
