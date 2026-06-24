import asyncio
import re
from datetime import date

from fastapi import FastAPI, Query, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from contextlib import asynccontextmanager
import os
from urllib.parse import quote

from app.services.rotation import build_rotation_strategy
from app.services.market_temperature import build_market_temperature
from app.db.database import (
    get_dashboard_page_cache,
    init_mysql,
    list_scheduled_tasks,
    save_dashboard_page_cache,
    set_scheduled_task_enabled,
    upsert_scheduled_task,
)
from app.services.scheduler import PREFETCH_OFFSETS, run_task_now, scheduler_loop

PAGE_CACHE = {}


def page_cache_key(offset: int):
    return (date.today().isoformat(), offset)


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_mysql()
    for offset in PREFETCH_OFFSETS:
        cached_page = get_dashboard_page_cache(offset)
        if cached_page:
            PAGE_CACHE[page_cache_key(offset)] = cached_page
    scheduler_task = asyncio.create_task(scheduler_loop())
    try:
        yield
    finally:
        scheduler_task.cancel()
        try:
            await scheduler_task
        except asyncio.CancelledError:
            pass


app = FastAPI(title="Trend Dashboard", lifespan=lifespan)

app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

from app.services.akshare_client import fetch_kline_data


def is_valid_run_time(value: str) -> bool:
    return bool(re.fullmatch(r"([01]\d|2[0-3]):[0-5]\d", value))

@app.get("/", response_class=HTMLResponse)
async def read_root(request: Request, offset: int = 0):
    cache_key = page_cache_key(offset)
    page_data = PAGE_CACHE.get(cache_key)
    if not page_data:
        page_data = get_dashboard_page_cache(offset)
        if page_data:
            PAGE_CACHE[cache_key] = page_data
    if page_data:
        rotation_data = page_data["rotation_data"]
        market_temp = page_data["market_temp"]
        dates_list = page_data["dates_list"]
    else:
        # Fetch data
        try:
            rotation_data = build_rotation_strategy(offset)
            market_temp = build_market_temperature(offset)
        except Exception as e:
            print("获取数据时出错:", e)
            rotation_data = {"assets": [], "winner": None, "action": "error"}
            market_temp = {"trend": {"rows": []}, "sector": {"rows": []}}

        # 获取过去 5 个交易日的日期
        dates_list = []
        try:
            df = fetch_kline_data('sh000300', 'index')
            if df is not None and len(df) >= 5:
                dates_list = df['date'].tail(5).tolist()[::-1] # 最新的在前面
        except Exception:
            pass

        save_dashboard_page_cache(
            offset,
            {
                "rotation_data": rotation_data,
                "market_temp": market_temp,
                "dates_list": dates_list,
            },
        )
        PAGE_CACHE[cache_key] = {
            "rotation_data": rotation_data,
            "market_temp": market_temp,
            "dates_list": dates_list,
        }

    return templates.TemplateResponse(
        request=request, 
        name="index.html", 
        context={
            "rotation_data": rotation_data,
            "market_temp": market_temp,
            "dates_list": dates_list,
            "current_offset": offset
        }
    )


@app.get("/tasks", response_class=HTMLResponse)
async def tasks_page(request: Request, message: str = ""):
    return templates.TemplateResponse(
        request=request,
        name="tasks.html",
        context={
            "tasks": list_scheduled_tasks(),
            "message": message,
        },
    )


@app.get("/tasks/save")
async def save_task(
    name: str = Query("每日缓存行情"),
    task_type: str = Query("prefetch_market_data"),
    run_time: str = Query("18:00"),
    enabled: int = Query(1),
):
    if task_type != "prefetch_market_data":
        return RedirectResponse(f"/tasks?message={quote('不支持的任务类型')}", status_code=303)
    if not is_valid_run_time(run_time):
        return RedirectResponse(f"/tasks?message={quote('时间格式必须是 HH:MM')}", status_code=303)
    upsert_scheduled_task(name, task_type, run_time, bool(enabled))
    return RedirectResponse(f"/tasks?message={quote('任务已保存')}", status_code=303)


@app.get("/tasks/toggle/{task_id}")
async def toggle_task(task_id: int, enabled: int):
    set_scheduled_task_enabled(task_id, bool(enabled))
    return RedirectResponse(f"/tasks?message={quote('任务状态已更新')}", status_code=303)


@app.get("/tasks/run/{task_id}")
async def run_task(task_id: int):
    status, message = await run_task_now(task_id)
    return RedirectResponse(f"/tasks?message={quote(f'{status}: {message}')}", status_code=303)


if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("PORT", "8765"))
    reload_enabled = os.getenv("RELOAD", "false").lower() in ("1", "true", "yes", "on")
    uvicorn.run(
        "main:app" if reload_enabled else app,
        host="0.0.0.0",
        port=port,
        reload=reload_enabled,
    )
