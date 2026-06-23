import akshare as ak

print("Testing Tencent ETF fetch...")
try:
    # Tencent stock_zh_a_hist_tx? Wait, stock_zh_a_daily might work for ETFs if we prefix with sz/sh
    # Actually, stock_zh_a_hist might be eastmoney, let's try stock_zh_a_hist_tx or just index_zh_a_hist_tx
    # There is also stock_zh_a_daily for Tencent.
    # Let's try ak.stock_zh_a_daily
    df = ak.stock_zh_a_daily(symbol="sh510300")
    print(df.tail())
except Exception as e:
    print(f"Error fetching Tencent daily: {e}")

try:
    # try Sina
    df = ak.stock_zh_a_daily(symbol="sh510300", adjust="qfq") # maybe Sina doesn't support this
    print("Sina/Tencent:", df.tail())
except Exception as e:
    print(e)
