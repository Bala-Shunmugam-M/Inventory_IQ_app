"""
InventoryIQ Backend API
FastAPI + MongoDB backend providing optional cloud sync for the InventoryIQ inventory control system.
Client is single-user MVP — no auth. Uses a client_id (device UUID) to segment data.
"""
from fastapi import FastAPI, APIRouter, HTTPException, Query
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import math
from pathlib import Path
from pydantic import BaseModel, Field, ConfigDict
from typing import List, Optional, Dict, Any
import uuid
from datetime import datetime, timezone


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

app = FastAPI(title="InventoryIQ API", version="4.0")
api_router = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


# ========================================================================
# MODELS
# ========================================================================
class SKU(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: int
    name: str
    category: str = "General"
    demand: float = Field(..., description="Daily demand (avg units/day)")
    stddev: float = Field(..., description="Demand std dev (units/day)")
    leadtime: int = Field(..., description="Lead time (days)")
    ltstddev: float = 0.0
    cost: float
    sellprice: float
    ordercost: float = 100.0
    stock: int = 0
    moq: int = 1
    pattern: str = "stable"
    shortage: float = 0.0
    history: List[float] = Field(default_factory=list)


class SKUSyncRequest(BaseModel):
    client_id: str
    skus: List[SKU]


class DailySaleEntry(BaseModel):
    client_id: str
    sku_id: int
    units_sold: int
    date: Optional[str] = None


class CalculationRequest(BaseModel):
    demand: float
    stddev: float
    leadtime: int
    ltstddev: float = 0.0
    cost: float
    ordercost: float = 100.0
    service_level: float = 0.95
    moq: int = 1


class ForecastRequest(BaseModel):
    history: List[float]
    days: int = 30


class ImportRow(BaseModel):
    client_id: str
    rows: List[Dict[str, Any]]


# ========================================================================
# HEALTH
# ========================================================================
@api_router.get("/")
async def root():
    return {"service": "InventoryIQ API", "version": "4.0", "status": "ok"}


@api_router.get("/health")
async def health():
    try:
        await db.command("ping")
        return {"status": "healthy", "mongo": "connected"}
    except Exception as e:
        return {"status": "degraded", "error": str(e)}


# ========================================================================
# INVENTORY MATH ENGINE (server-side parity with client)
# ========================================================================
def z_score(service_level: float) -> float:
    if service_level >= 0.99: return 2.33
    if service_level >= 0.97: return 1.96
    if service_level >= 0.95: return 1.65
    return 1.28


def calc_safety_stock(demand: float, stddev: float, leadtime: int,
                       lt_stddev: float, z: float) -> int:
    demand_part = z * stddev * math.sqrt(leadtime)
    lt_part = z * lt_stddev * demand
    return math.ceil(math.sqrt(demand_part**2 + lt_part**2))


def calc_eoq(demand: float, cost: float, ordercost: float, moq: int = 1) -> int:
    D = demand * 365
    H = cost * 0.20
    if H <= 0: return moq
    raw = math.ceil(math.sqrt(2 * D * ordercost / H))
    return max(raw, moq)


def calc_rop(demand: float, leadtime: int, safety_stock: int) -> int:
    return math.ceil(demand * leadtime + safety_stock)


@api_router.post("/calculate")
async def calculate(req: CalculationRequest):
    """Server-side EOQ/ROP/SS calculator — matches client formulas."""
    z = z_score(req.service_level)
    ss = calc_safety_stock(req.demand, req.stddev, req.leadtime, req.ltstddev, z)
    eoq = calc_eoq(req.demand, req.cost, req.ordercost, req.moq)
    rop = calc_rop(req.demand, req.leadtime, ss)
    D = req.demand * 365
    H = req.cost * 0.20
    ordering_cost = (D / eoq) * req.ordercost if eoq > 0 else 0
    holding_cost = (eoq / 2 + ss) * H
    return {
        "safety_stock": ss,
        "eoq": eoq,
        "rop": rop,
        "z_score": z,
        "annual_ordering_cost": round(ordering_cost, 2),
        "annual_holding_cost": round(holding_cost, 2),
        "total_annual_cost": round(ordering_cost + holding_cost, 2),
    }


# ========================================================================
# SKU SYNC (optional cloud backup)
# ========================================================================
@api_router.post("/sync/skus")
async def sync_skus(req: SKUSyncRequest):
    """Replace all SKUs for a client. Client pushes entire state."""
    docs = [{**s.model_dump(), "client_id": req.client_id,
             "updated_at": datetime.now(timezone.utc).isoformat()} for s in req.skus]
    await db.skus.delete_many({"client_id": req.client_id})
    if docs:
        await db.skus.insert_many(docs)
    return {"synced": len(docs), "client_id": req.client_id}


@api_router.get("/sync/skus")
async def get_skus(client_id: str = Query(...)):
    cursor = db.skus.find({"client_id": client_id}, {"_id": 0})
    skus = await cursor.to_list(1000)
    return {"client_id": client_id, "count": len(skus), "skus": skus}


@api_router.delete("/sync/skus")
async def clear_skus(client_id: str = Query(...)):
    result = await db.skus.delete_many({"client_id": client_id})
    return {"deleted": result.deleted_count}


# ========================================================================
# DAILY SALES TRACKING
# ========================================================================
@api_router.post("/sales")
async def record_sale(entry: DailySaleEntry):
    doc = {
        "id": str(uuid.uuid4()),
        "client_id": entry.client_id,
        "sku_id": entry.sku_id,
        "units_sold": entry.units_sold,
        "date": entry.date or datetime.now(timezone.utc).date().isoformat(),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.sales.insert_one(doc)
    # Also append to the SKU's history
    await db.skus.update_one(
        {"client_id": entry.client_id, "id": entry.sku_id},
        {"$push": {"history": entry.units_sold}}
    )
    return {"recorded": True, "id": doc["id"]}


@api_router.get("/sales")
async def get_sales(client_id: str = Query(...), sku_id: Optional[int] = None, limit: int = 100):
    q: Dict[str, Any] = {"client_id": client_id}
    if sku_id is not None:
        q["sku_id"] = sku_id
    cursor = db.sales.find(q, {"_id": 0}).sort("created_at", -1).limit(limit)
    sales = await cursor.to_list(limit)
    return {"count": len(sales), "sales": sales}


# ========================================================================
# FORECASTING (server-side linear regression)
# ========================================================================
@api_router.post("/forecast")
async def forecast(req: ForecastRequest):
    """Simple 7-day moving average + linear trend blend."""
    h = req.history
    if len(h) < 3:
        raise HTTPException(400, "Need at least 3 historical points")
    # 7-day MA
    window = min(7, len(h))
    ma = sum(h[-window:]) / window
    # Linear trend via least squares
    n = len(h)
    xs = list(range(n))
    mx = sum(xs) / n
    my = sum(h) / n
    num = sum((xs[i] - mx) * (h[i] - my) for i in range(n))
    den = sum((xs[i] - mx) ** 2 for i in range(n))
    slope = num / den if den > 0 else 0
    intercept = my - slope * mx
    # Residual std dev for CI
    resid = [h[i] - (intercept + slope * i) for i in range(n)]
    sigma = math.sqrt(sum(r*r for r in resid) / max(1, n - 2))
    forecasts = []
    for d in range(1, req.days + 1):
        trend_val = intercept + slope * (n + d - 1)
        pred = 0.5 * ma + 0.5 * trend_val
        forecasts.append({
            "day": d,
            "predicted": round(max(0, pred), 2),
            "lower_90": round(max(0, pred - 1.65 * sigma), 2),
            "upper_90": round(pred + 1.65 * sigma, 2),
        })
    return {
        "history_size": n,
        "moving_avg": round(ma, 2),
        "trend_slope": round(slope, 4),
        "forecast": forecasts,
    }


# ========================================================================
# ABC ANALYSIS
# ========================================================================
@api_router.get("/abc/{client_id}")
async def abc_analysis(client_id: str):
    cursor = db.skus.find({"client_id": client_id}, {"_id": 0})
    skus = await cursor.to_list(1000)
    if not skus:
        return {"total_value": 0, "classifications": []}
    items = []
    for s in skus:
        annual = s.get("demand", 0) * 365 * s.get("cost", 0)
        items.append({"id": s["id"], "name": s["name"], "annual_value": round(annual, 2)})
    items.sort(key=lambda x: -x["annual_value"])
    total = sum(i["annual_value"] for i in items) or 1
    cum = 0.0
    for i in items:
        cum += i["annual_value"]
        pct = cum / total * 100
        i["cumulative_pct"] = round(pct, 2)
        i["class"] = "A" if pct <= 70 else "B" if pct <= 90 else "C"
    return {"total_value": round(total, 2), "classifications": items}


# ========================================================================
# BULK IMPORT
# ========================================================================
@api_router.post("/import")
async def bulk_import(req: ImportRow):
    docs = [{**r, "client_id": req.client_id,
             "imported_at": datetime.now(timezone.utc).isoformat()} for r in req.rows]
    if docs:
        await db.skus.insert_many(docs)
    return {"imported": len(docs)}


# ========================================================================
app.include_router(api_router)
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
