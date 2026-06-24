import asyncio
from datetime import date, datetime

from app.db.database import (
    get_scheduled_task,
    list_scheduled_tasks,
    save_dashboard_page_cache,
    update_scheduled_task_result,
)
from app.services.akshare_client import fetch_kline_data
from app.services.market_temperature import SECTOR_ASSETS, TREND_ASSETS, build_market_temperature
from app.services.rotation import ROTATION_ASSETS, build_rotation_strategy

PREFETCH_OFFSETS = range(5)


def get_prefetch_assets():
    assets = {}
    assets[("sh000300", "index")] = {"symbol": "sh000300", "kind": "index"}
    for asset in ROTATION_ASSETS:
        assets[(asset["symbol"], asset["kind"])] = asset
        for candidate in asset.get("etfCandidates", []):
            assets[(candidate["symbol"], "etf")] = {
                "symbol": candidate["symbol"],
                "kind": "etf",
            }
    for asset in TREND_ASSETS + SECTOR_ASSETS:
        assets[(asset["symbol"], asset["kind"])] = asset
    return list(assets.values())


def run_prefetch_market_data() -> str:
    assets = get_prefetch_assets()
    dataframes = {}
    ok_count = 0
    failed = []

    for asset in assets:
        symbol = asset["symbol"]
        kind = asset["kind"]
        try:
            df = fetch_kline_data(symbol, kind, use_cache=False)
            if df is None or df.empty:
                failed.append(f"{symbol}({kind}): empty")
                continue
            dataframes[(symbol, kind)] = df
            ok_count += 1
        except Exception as exc:
            failed.append(f"{symbol}({kind}): {exc}")

    dates_list = []
    df = dataframes.get(("sh000300", "index"))
    if df is None:
        df = fetch_kline_data("sh000300", "index", use_cache=False)
    if df is not None and len(df) >= 5:
        dates_list = df["date"].tail(5).tolist()[::-1]

    def memory_fetcher(symbol, kind):
        return dataframes.get((symbol, kind))

    cached_pages = 0
    for offset in PREFETCH_OFFSETS:
        rotation_data = build_rotation_strategy(offset, fetcher=memory_fetcher)
        market_temp = build_market_temperature(offset, fetcher=memory_fetcher)
        save_dashboard_page_cache(
            offset,
            {
                "rotation_data": rotation_data,
                "market_temp": market_temp,
                "dates_list": dates_list,
            },
        )
        cached_pages += 1

    if failed:
        return f"完成 {ok_count}/{len(assets)} 个行情缓存，生成 {cached_pages} 个页面缓存，失败 {len(failed)} 个：{'；'.join(failed[:5])}"
    return f"完成 {ok_count}/{len(assets)} 个行情缓存，生成 {cached_pages} 个页面缓存"


def run_task(task) -> tuple[str, str]:
    task_type = task["task_type"]
    if task_type == "prefetch_market_data":
        return "success", run_prefetch_market_data()
    return "error", f"未知任务类型：{task_type}"


def should_run_today(task, now: datetime) -> bool:
    if not task["enabled"]:
        return False
    run_time = str(task["run_time"])
    if len(run_time) != 5:
        return False
    if now.strftime("%H:%M") < run_time:
        return False
    last_run_date = task.get("last_run_date")
    return last_run_date != now.date()


async def scheduler_loop():
    while True:
        now = datetime.now()
        try:
            for task in list_scheduled_tasks():
                if should_run_today(task, now):
                    status, message = await asyncio.to_thread(run_task, task)
                    update_scheduled_task_result(task["id"], status, message)
        except Exception as exc:
            print(f"定时任务检查失败: {exc}")
        await asyncio.sleep(60)


async def run_task_now(task_id: int):
    task = get_scheduled_task(task_id)
    if not task:
        return "error", "任务不存在"

    status, message = await asyncio.to_thread(run_task, task)
    update_scheduled_task_result(task_id, status, message)
    return status, message
