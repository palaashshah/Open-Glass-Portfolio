import logging
import threading
from contextlib import asynccontextmanager

from fastapi.middleware.cors import CORSMiddleware
from fastapi import FastAPI

import models  # registers every table with Base
from database import Base, ReadSession, SessionLocal, engine, warm_pool
from routers import investors, interactions, risk, optimize, decisions, valuation, audit, reference, overview
from scripts.data import update_prices
from timing import add_timing
from valuation.prices import stored_prices

# Create any tables that do not exist yet (existing tables are left alone).
Base.metadata.create_all(bind=engine)


def prepare_prices():
    # Runs in the background each time the server starts.
    log = logging.getLogger("uvicorn.error")

    # 1. Bring the stored prices up to date, so valuations run to the latest
    #    trading day without anyone having to remember to run a script. Only
    #    prices are added; the optimizer's estimates do not change. If the
    #    download or its checks fail, the stored prices are left as they are.
    try:
        with SessionLocal() as db:
            result = update_prices(db)
        for error in result["errors"]:
            log.warning("Price update: %s", error)
        log.info("Price update: %s", result["message"])
    except Exception as error:
        log.warning("Price update skipped: %s", error)

    # 2. Reading the price table from a remote database takes several seconds.
    #    Do it once now, so the first valuation a user opens does not wait for it.
    with ReadSession() as db:
        stored_prices(db)


@asynccontextmanager
async def lifespan(app):
    warm_pool()     # open the database connections before the first request arrives
    threading.Thread(target=prepare_prices, daemon=True).start()
    yield


app = FastAPI(lifespan=lifespan)
app.include_router(investors.router)
app.include_router(interactions.router)
app.include_router(risk.router)
app.include_router(optimize.router)
app.include_router(decisions.router)
app.include_router(valuation.router)
app.include_router(audit.router)
app.include_router(reference.router)
app.include_router(overview.router)
add_timing(app)   # logs how long each request took and how many SQL statements it ran

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def root():
    return {"message": "OpenGlass Portfolio API is running"}