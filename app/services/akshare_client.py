import akshare as ak
import pandas as pd
from typing import Optional
import requests
import json
import re

from app.db.database import get_kline_cache, save_kline_cache


GLOBAL_INDEX_NAME_MAP = {
    "KS11": "首尔综合指数",
    "TWII": "中国台湾加权指数",
    "N225": "日经225指数",
}


def normalize_kline_df(df: pd.DataFrame) -> pd.DataFrame:
    df = df.rename(columns={
        'date': 'date',
        'open': 'open',
        'high': 'high',
        'low': 'low',
        'close': 'close',
        'volume': 'volume'
    })
    return df[['date', 'open', 'high', 'low', 'close', 'volume']]


def load_kline_from_cache(code: str, kind: str) -> Optional[pd.DataFrame]:
    rows = get_kline_cache(code, kind)
    if not rows:
        return None
    return normalize_kline_df(pd.DataFrame(rows))


def save_kline_to_cache(code: str, kind: str, df: pd.DataFrame) -> pd.DataFrame:
    df = normalize_kline_df(df)
    save_kline_cache(code, kind, df.tail(120).to_dict(orient="records"))
    return df

def fetch_kline_fallback(symbol: str, days: int = 40) -> Optional[pd.DataFrame]:
    # 降级备用：使用腾讯接口
    # symbol 格式: sh000300, sz399006, 等
    try:
        url = f"https://proxy.finance.qq.com/ifzq/appstock/app/newiqkline/get?param={symbol},day,,,{days},qfq"
        resp = requests.get(url, timeout=5)
        data = resp.json()
        if data['code'] == 0:
            kline_list = data['data'][symbol]['day']
            records = []
            for item in kline_list:
                records.append({
                    'date': item[0],
                    'open': float(item[1]),
                    'close': float(item[2]),
                    'high': float(item[3]),
                    'low': float(item[4]),
                    'volume': float(item[5])
                })
            df = pd.DataFrame(records)
            return df
    except Exception as e:
        print(f"腾讯接口降级请求失败 {symbol}: {e}")
    
    # 降级备用：使用新浪接口
    try:
        url = f"https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol={symbol}&scale=240&ma=no&datalen={days}"
        resp = requests.get(url, timeout=5)
        kline_list = json.loads(resp.text)
        records = []
        for item in kline_list:
            records.append({
                'date': item['day'],
                'open': float(item['open']),
                'close': float(item['close']),
                'high': float(item['high']),
                'low': float(item['low']),
                'volume': float(item['volume'])
            })
        df = pd.DataFrame(records)
        return df
    except Exception as e:
        print(f"新浪接口降级请求失败 {symbol}: {e}")
    return None

def fetch_kline_data(code: str, kind: str, use_cache: bool = True) -> Optional[pd.DataFrame]:
    """
    使用 akshare 获取日K线数据。
    kind 支持: 'index' (指数), 'etf' (基金), 'global_index' (全球指数), 'hk_index' (港股指数)
    """
    if use_cache:
        try:
            cached_df = load_kline_from_cache(code, kind)
            if cached_df is not None and not cached_df.empty:
                return cached_df
        except Exception as e:
            print(f"MySQL 缓存读取失败 {code} ({kind}): {e}")

    try:
        if kind == 'etf':
            df = ak.fund_etf_hist_sina(symbol=code)
            if df is not None and not df.empty:
                return save_kline_to_cache(code, kind, df)
        elif kind == 'index':
            df = ak.stock_zh_index_daily(symbol=code)
            if df is not None and not df.empty:
                return save_kline_to_cache(code, kind, df)
        elif kind == 'global_index':
            if code in GLOBAL_INDEX_NAME_MAP:
                df = ak.index_global_hist_sina(symbol=GLOBAL_INDEX_NAME_MAP[code])
            else:
                df = ak.index_us_stock_sina(symbol=code)
            if df is not None and not df.empty:
                return save_kline_to_cache(code, kind, df)
        elif kind == 'hk_index':
            df = ak.stock_hk_index_daily_sina(symbol=code)
            if df is not None and not df.empty:
                return save_kline_to_cache(code, kind, df)
    except Exception as e:
        print(f"Akshare 请求失败 {code} ({kind}): {e}")
    
    # 尝试降级请求
    if kind in ('index', 'etf'):
        fallback_df = fetch_kline_fallback(code)
        if fallback_df is not None and not fallback_df.empty:
            return save_kline_to_cache(code, kind, fallback_df)
        
    return None
