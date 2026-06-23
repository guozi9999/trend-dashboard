from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
import json
import plotly.graph_objs as go
from plotly.utils import PlotlyJSONEncoder

from app.services.rotation import build_rotation_strategy
from app.services.market_temperature import build_market_temperature

app = FastAPI(title="Trend Dashboard")

app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

from app.services.akshare_client import fetch_kline_data

@app.get("/", response_class=HTMLResponse)
async def read_root(request: Request, offset: int = 0):
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

    # 轮动图表
    rot_assets = rotation_data.get("assets", [])
    rot_names = [a["name"] for a in rot_assets]
    rot_rocs = [a["roc20"] if a["roc20"] is not None else 0 for a in rot_assets]
    
    # 红色涨，绿色跌
    colors = ['#ef4444' if r > 0 else '#10b981' for r in rot_rocs]
    
    fig1 = go.Figure(data=[go.Bar(x=rot_names, y=rot_rocs, marker_color=colors)])
    fig1.update_layout(
        title="轮动资产 ROC(20)", 
        template="plotly_dark", 
        paper_bgcolor='rgba(0,0,0,0)', 
        plot_bgcolor='rgba(0,0,0,0)',
        margin=dict(l=20, r=20, t=40, b=20)
    )
    rotation_graph_json = json.dumps(fig1, cls=PlotlyJSONEncoder)

    return templates.TemplateResponse(
        request=request, 
        name="index.html", 
        context={
            "rotation_data": rotation_data,
            "market_temp": market_temp,
            "rotation_graph_json": rotation_graph_json,
            "dates_list": dates_list,
            "current_offset": offset
        }
    )
