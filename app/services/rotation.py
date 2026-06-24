from .akshare_client import fetch_kline_data
import datetime

ROTATION_LOOKBACK_DAYS = 20

ROTATION_ASSETS = [
    {
        "code": "000300",
        "name": "沪深300",
        "symbol": "sh000300",
        "kind": "index",
        "etfCandidates": [
            {"code": "510300", "symbol": "sh510300"},
            {"code": "510310", "symbol": "sh510310"},
            {"code": "159919", "symbol": "sz159919"}
        ]
    },
    {
        "code": "399296",
        "name": "创成长",
        "symbol": "sz399296",
        "kind": "index",
        "etfCandidates": [
            {"code": "159967", "symbol": "sz159967"}
        ]
    },
    {
        "code": "932000",
        "name": "中证2000",
        "symbol": "sz399303", # 如果 932000 不可用，映射到一个有效的指数，如 sz399303 (国证2000)
        # 也可以使用 cs932000 作为腾讯接口降级时的备用代码
        "kind": "index",
        "etfCandidates": [
            {"code": "563300", "symbol": "sh563300"},
            {"code": "159531", "symbol": "sz159531"},
            {"code": "562660", "symbol": "sh562660"},
            {"code": "159532", "symbol": "sz159532"}
        ]
    },
    {
        "code": "518880",
        "name": "黄金ETF",
        "symbol": "sh518880",
        "kind": "etf",
        "etfCandidates": []
    },
    {
        "code": "513100",
        "name": "纳指ETF",
        "symbol": "sh513100",
        "kind": "etf",
        "etfCandidates": []
    }
]

def calculate_roc(df, lookback_days, offset=0):
    if df is None or len(df) < lookback_days + 1 + offset:
        return None, None, None
    latest = df.iloc[-(1 + offset)]
    base = df.iloc[-(lookback_days + 1 + offset)]
    roc = ((latest['close'] - base['close']) / base['close']) * 100
    return roc, latest, base

def build_rotation_strategy(offset=0, fetcher=fetch_kline_data):
    results = []
    for asset in ROTATION_ASSETS:
        df = fetcher(asset['symbol'], asset['kind'])
        roc, latest, base = calculate_roc(df, ROTATION_LOOKBACK_DAYS, offset)
        
        candidates = []
        if asset['kind'] == 'index':
            for c in asset['etfCandidates']:
                cdf = fetcher(c['symbol'], 'etf')
                turnover = cdf.iloc[-(1 + offset)]['volume'] if cdf is not None and not cdf.empty and len(cdf) >= 1 + offset else 0
                candidates.append({
                    "code": c["code"],
                    "name": c["code"], # 后续可优化为真实名称
                    "symbol": c["symbol"],
                    "turnover": turnover
                })
            candidates.sort(key=lambda x: x['turnover'], reverse=True)
            trade_target = candidates[0] if candidates else None
        else:
            trade_target = {"code": asset["code"], "name": asset["name"], "symbol": asset["symbol"], "turnover": latest['volume'] if latest is not None else 0}

        results.append({
            "code": asset["code"],
            "name": asset["name"],
            "roc20": round(float(roc), 2) if roc is not None else None,
            "latestClose": float(latest['close']) if latest is not None else None,
            "latestDate": str(latest['date']) if latest is not None else None,
            "baseClose": float(base['close']) if base is not None else None,
            "baseDate": str(base['date']) if base is not None else None,
            "tradeCode": trade_target["code"] if trade_target else asset["code"],
            "tradeName": trade_target["name"] if trade_target else asset["name"],
        })
    
    # 按 roc20 降序排列
    results.sort(key=lambda x: x["roc20"] if x["roc20"] is not None else float('-inf'), reverse=True)
    for idx, r in enumerate(results):
        r["rank"] = idx + 1
        
    winner = next((r for r in results if r["roc20"] is not None), None)
    action = "empty"
    if winner and winner["roc20"] > 0:
        action = "hold"
        
    return {
        "lookbackDays": ROTATION_LOOKBACK_DAYS,
        "winner": winner,
        "action": action,
        "assets": results,
        "fetchedAt": datetime.datetime.now().isoformat()
    }
