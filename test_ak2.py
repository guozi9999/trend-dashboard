import akshare as ak

tests = [
    ("Sina Index", "ak.stock_zh_index_daily(symbol='sh000300')"),
    ("Sina ETF", "ak.fund_etf_hist_sina(symbol='sh518880')"),
    ("Global Index", "ak.index_global_hist_sina(symbol='N225')"),
    ("Global Index KS11", "ak.index_global_hist_sina(symbol='KS11')"),
    ("US Stock QQQ", "ak.stock_us_hist(symbol='105.QQQ', adjust='qfq')"),
    ("US Stock SPY", "ak.stock_us_hist(symbol='107.SPY', adjust='qfq')"),
    ("US Stock QQQ alt", "ak.stock_us_hist(symbol='QQQ', adjust='qfq')"),
    ("US Stock SPY alt", "ak.stock_us_hist(symbol='SPY', adjust='qfq')"),
    ("HK Index HSTECH", "ak.stock_hk_index_daily_sina(symbol='HSTECH')"),
    ("HK Index HSTECH alt", "ak.stock_hk_hist(symbol='HSTECH')"),
    ("HK Index HSI", "ak.stock_hk_index_daily_sina(symbol='HSI')"),
]

for name, code in tests:
    print(f"--- {name} ---")
    try:
        df = eval(code)
        if df is not None:
            print(df.tail(1))
        else:
            print("Returned None")
    except Exception as e:
        print("Error:", e)
