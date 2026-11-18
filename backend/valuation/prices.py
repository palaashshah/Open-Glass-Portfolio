"""
Stored prices, kept in memory between requests.

WHY: every valuation needs the price table, and reading about ten thousand
rows from a remote database on each request is what made the valuation
screens slow. Prices only change when scripts/data.py runs, so the table is
read once and reused. At most once every CHECK_SECONDS the database is asked
for a small fingerprint (row count, latest date, sum of prices); when a new
download has changed it, the table is read again. Nothing has to be restarted:
a fresh download shows up within CHECK_SECONDS.
"""
import threading
import time

import pandas as pd
from sqlalchemy import func
from sqlalchemy.orm import Session

from models import MarketData

CHECK_SECONDS = 30

_lock = threading.Lock()
_cached = {"fingerprint": None, "prices": None, "checked": 0.0}


def stored_prices(db: Session) -> pd.DataFrame:
    """Closing prices: one row per date, one column per ticker.
    An empty table if no prices are stored. Treat the result as read-only."""
    # One caller at a time. While the table is being read (slow on a remote
    # database), the others wait here and then get the same result, instead
    # of each reading it again.
    with _lock:
        if _cached["prices"] is not None and time.monotonic() - _cached["checked"] < CHECK_SECONDS:
            return _cached["prices"]

        fingerprint = tuple(db.query(
            func.count(MarketData.id), func.max(MarketData.date), func.sum(MarketData.close_price)).one())
        if _cached["prices"] is not None and _cached["fingerprint"] == fingerprint:
            _cached["checked"] = time.monotonic()
            return _cached["prices"]

        rows = db.query(MarketData.asset_symbol, MarketData.date, MarketData.close_price).all()
        if rows:
            frame = pd.DataFrame(rows, columns=["ticker", "date", "price"])
            frame["price"] = frame["price"].astype(float)
            frame["date"] = pd.to_datetime(frame["date"])
            prices = frame.pivot(index="date", columns="ticker", values="price").sort_index()
        else:
            prices = pd.DataFrame()

        _cached.update(fingerprint=fingerprint, prices=prices, checked=time.monotonic())
        return prices