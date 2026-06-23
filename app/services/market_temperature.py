from .akshare_client import fetch_kline_data
import datetime

LOOKBACK_DAYS = 20

TREND_ASSETS = [
    {"code": "KS11", "name": "韩国综合", "symbol": "KS11", "kind": "global_index"},
    {"code": "TWII", "name": "台湾加权", "symbol": "TWII", "kind": "global_index"},
    {"code": "N225", "name": "日经225", "symbol": "N225", "kind": "global_index"},
    {"code": "QQQ", "name": "纳指100", "symbol": ".IXIC", "kind": "global_index"},
    {"code": "SPY", "name": "标普500", "symbol": ".INX", "kind": "global_index"},
    {"code": "399006", "name": "创业板指", "symbol": "sz399006", "kind": "index"},
    {"code": "HS2083", "name": "恒生科技", "symbol": "HSTECH", "kind": "hk_index"},
    {"code": "399300", "name": "沪深300", "symbol": "sh000300", "kind": "index"},
    {"code": "HSI", "name": "恒生指数", "symbol": "HSI", "kind": "hk_index"},
    {"code": "000510", "name": "中证A500", "symbol": "sh000510", "kind": "index"},
    {"code": "HSCEI", "name": "国企指数", "symbol": "HSCEI", "kind": "hk_index"},
    {"code": "1B0016", "name": "上证50", "symbol": "sh000016", "kind": "index"},
    {"code": "399905", "name": "中证500", "symbol": "sh000905", "kind": "index"},
    {"code": "1B0852", "name": "中证1000", "symbol": "sh000852", "kind": "index"},
    {"code": "932000", "name": "中证2000", "symbol": "sz399303", "kind": "index"},
    {"code": "1B0688", "name": "科创50", "symbol": "sh000688", "kind": "index"},
]

SECTOR_ASSETS = [
    {"code": "399998", "name": "中证煤炭", "symbol": "sz399998", "kind": "index"},
    {"code": "000922", "name": "中证红利", "symbol": "sh000922", "kind": "index"},
    {"code": "1B0932", "name": "中证消费", "symbol": "sh000932", "kind": "index"},
    {"code": "399975", "name": "证券公司", "symbol": "sz399975", "kind": "index"},
    {"code": "000941", "name": "新能源", "symbol": "sh000941", "kind": "index"},
    {"code": "1B0819", "name": "有色金属", "symbol": "sh000819", "kind": "index"},
    {"code": "000813", "name": "细分化工", "symbol": "sh000813", "kind": "index"},
]

def calculate_ma(df, index, window):
    if index < window - 1:
        return None
    return df['close'].iloc[index - window + 1:index + 1].mean()

def process_asset(asset, offset=0):
    df = fetch_kline_data(asset['symbol'], asset['kind'])
    if df is None or len(df) < LOOKBACK_DAYS + 1 + offset:
        return None
    
    latest = df.iloc[-(1 + offset)]
    previous = df.iloc[-(2 + offset)]
    
    latest_ma20 = calculate_ma(df, len(df)-1-offset, LOOKBACK_DAYS)
    deviation_percent = round(((latest['close'] - latest_ma20) / latest_ma20) * 100, 2) if latest_ma20 else None
    
    # 状态改变日期
    state_change = None
    previous_sign = None
    for i in range(LOOKBACK_DAYS - 1, len(df) - offset):
        ma20 = calculate_ma(df, i, LOOKBACK_DAYS)
        if not ma20: continue
        sign = 1 if df.iloc[i]['close'] >= ma20 else -1
        if previous_sign is not None and sign != previous_sign:
            state_change = df.iloc[i]
        previous_sign = sign
        
    if state_change is None:
        state_change = df.iloc[LOOKBACK_DAYS - 1]
        
    interval_change_percent = round(float(((latest['close'] - state_change['close']) / state_change['close']) * 100), 2) if state_change is not None else None
    
    volume_base = df['volume'].iloc[-21:-1].mean()
    volume_ratio = round(float(latest['volume'] / volume_base), 2) if volume_base else None
    
    return {
        "code": asset['code'],
        "name": asset['name'],
        "close": round(float(latest['close']), 3),
        "changePercent": round(float(((latest['close'] - previous['close']) / previous['close']) * 100), 2) if previous['close'] > 0 else None,
        "ma20": round(float(latest_ma20), 3) if latest_ma20 else None,
        "deviationPercent": float(deviation_percent) if deviation_percent is not None else None,
        "volumeRatio": float(volume_ratio) if volume_ratio is not None else None,
        "stateChangeDate": str(state_change['date']) if state_change is not None else None,
        "intervalChangePercent": float(interval_change_percent) if interval_change_percent is not None else None,
        "rank": 0
    }

def build_board(category, title, assets, offset=0):
    rows = []
    for asset in assets:
        row = process_asset(asset, offset)
        if row:
            rows.append(row)
            
    rows.sort(key=lambda x: x["deviationPercent"] if x["deviationPercent"] is not None else float('-inf'), reverse=True)
    for idx, r in enumerate(rows):
        r["rank"] = idx + 1
        
    # 计算昨天的排名以得出排序变化
    prev_rows = []
    for asset in assets:
        prev_row = process_asset(asset, offset + 1)
        if prev_row:
            prev_rows.append(prev_row)
    prev_rows.sort(key=lambda x: x["deviationPercent"] if x["deviationPercent"] is not None else float('-inf'), reverse=True)
    prev_ranks = {r['code']: idx + 1 for idx, r in enumerate(prev_rows)}
    
    for r in rows:
        prev_rank = prev_ranks.get(r['code'])
        r['rankChange'] = (prev_rank - r['rank']) if prev_rank is not None else 0
        
    return {
        "category": category,
        "title": title,
        "rows": rows
    }

def build_market_temperature(offset=0):
    trend = build_board('trend', '趋势模型', TREND_ASSETS, offset)
    sector = build_board('sector', '板块轮动', SECTOR_ASSETS, offset)
    
    return {
        "trend": trend,
        "sector": sector,
        "fetchedAt": datetime.datetime.now().isoformat()
    }
