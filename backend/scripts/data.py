import sys
import os
import uuid
from datetime import datetime
import pandas as pd
import yfinance as yf
from datetime import datetime, timezone
from datetime import date, timedelta
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

# Add the parent directory ('backend/') to sys.path so we can import models & database
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from database import SessionLocal, engine, Base
from models import DataSnapshot, AssetMean, AssetCovariance, MarketData, AuditLog
from config.risk_constraints import MAX_DAILY_MOVE, MAX_MISSING_SHARE, MIN_PRICE_ROWS

UNIVERSE = [
    "NIFTYBEES.NS",     # broad-market equity
    "JUNIORBEES.NS",    # mid-cap
    "BANKBEES.NS",      # sector: banking
    "ITBEES.NS",        # sector: IT
    "PHARMABEES.NS",    # sector: pharma
    "GOLDBEES.NS",      # gold
    "SETF10GILT.NS",    # gilt/debt proxy
    "LIQUIDBEES.NS",    # liquid fund proxy
]

# for ticker in UNIVERSE:
#     data = yf.download(ticker, period="5y", auto_adjust=False)
#     print(data.head())
#     print(data.tail())
#     print(len(data))


def download_prices(tickers: list[str], period: str = "5y") -> pd.DataFrame:
    """
    Downloads price data for the given tickers and returns
    a DataFrame of closing prices only: dates as index, one column per ticker.
    """
    # threads=False: one ticker at a time. Downloading in parallel can lock yfinance's
    # own cache file on this computer ("database is locked") and lose a ticker.
    data = yf.download(tickers, period=period, auto_adjust=True, threads=False)
    return (data['Close'])

# prices = download_prices(UNIVERSE)
# print(prices.head())
# print(prices.shape)

# d = yf.download("NIFTYBEES.NS", period="5y", auto_adjust=False)
# print((d['Close'] - d['Adj Close']).describe())

def check_prices(prices: pd.DataFrame) -> tuple[list[str], list[str]]:
    """
    Checks downloaded prices. Returns (errors, warnings).
    Errors stop the run; warnings are printed and the run continues.
    """
    errors, warnings = [], []
    if len(prices) < MIN_PRICE_ROWS:
        errors.append(f"Only {len(prices)} days of prices; at least {MIN_PRICE_ROWS} are needed.")

    for ticker in prices.columns:
        series = prices[ticker]
        missing = int(series.isna().sum())
        share = missing / len(series) if len(series) else 1.0
        if share > MAX_MISSING_SHARE:
            errors.append(f"{ticker}: {missing} missing values ({share:.1%}), above the {MAX_MISSING_SHARE:.0%} limit")
        elif missing:
            warnings.append(f"{ticker}: {missing} missing values ({share:.1%})")

        moves = series.dropna().pct_change().dropna()
        for day, move in moves[moves.abs() > MAX_DAILY_MOVE].items():
            errors.append(f"{ticker}: {move:+.1%} move on {day.date()}, above the {MAX_DAILY_MOVE:.0%} limit")

    return errors, warnings

def compute_monthly_returns(prices: pd.DataFrame) -> pd.DataFrame:
    """
    Resamples daily prices to monthly (last trading day of month),
    then computes monthly percentage returns.
    """
    monthly_prices = prices.resample('ME').last()
    # print(monthly_prices.head())      # <-- should look like prices, e.g. 40-3000 range
    monthly_returns = monthly_prices.pct_change()
    # print(monthly_returns.head())     # <-- should look like small decimals, e.g. -0.05, 0.12
    return monthly_returns

def compute_mean_and_cov(monthly_returns: pd.DataFrame) -> tuple[pd.Series, pd.DataFrame]:
    """
    Computes annualized mean return vector and annualized covariance matrix
    from monthly returns.
    """
    monthly_returns = monthly_returns.dropna()  # first month is NaN from pct_change()

    monthly_mean = monthly_returns.mean()
    annual_mean = (1 + monthly_mean) ** 12 - 1

    monthly_cov = monthly_returns.cov()
    annual_cov = monthly_cov * 12

    return annual_mean, annual_cov

def save_snapshot(db: Session, mu: pd.Series, cov: pd.DataFrame) -> uuid.UUID:
    """
    Saves an annualized mean return vector and covariance matrix 
    into PostgreSQL as an immutable snapshot.
    """
    snapshot_id = uuid.uuid4()
    ticker_list = list(mu.index)
    
    # 1. Create top-level snapshot metadata record
    snapshot = DataSnapshot(
        snapshot_id=snapshot_id,
        created_at=datetime.now(timezone.utc),
        ticker_list=ticker_list
    )
    db.add(snapshot)

    # 2. Add mean return entries
    for ticker, mean_val in mu.items():
        asset_mean = AssetMean(
            snapshot_id=snapshot_id,
            ticker=ticker,
            mean_return=float(mean_val)
        )
        db.add(asset_mean)

    # 3. Flatten and add covariance matrix entries
    cov_stacked = cov.rename_axis(index='ticker_i', columns='ticker_j').stack().reset_index()
    cov_stacked.columns = ['ticker_i', 'ticker_j', 'cov_value']

    for _, row in cov_stacked.iterrows():
        asset_cov = AssetCovariance(
            snapshot_id=snapshot_id,
            ticker_i=row['ticker_i'],
            ticker_j=row['ticker_j'],
            cov_value=float(row['cov_value'])
        )
        db.add(asset_cov)

    db.commit()
    return snapshot_id

def load_snapshot(db: Session, snapshot_id: uuid.UUID) -> tuple[pd.Series, pd.DataFrame]:
    """
    Retrieves a snapshot from PostgreSQL by ID and reconstructs 
    it as a pandas Series (mean vector) and DataFrame (covariance matrix).
    """
    # 1. Fetch means
    means_query = db.query(AssetMean).filter(AssetMean.snapshot_id == snapshot_id).all()
    if not means_query:
        raise ValueError(f"Snapshot ID {snapshot_id} not found in database.")

    mu_dict = {item.ticker: item.mean_return for item in means_query}
    mu = pd.Series(mu_dict)

    # 2. Fetch covariances and pivot into symmetric matrix
    cov_query = db.query(AssetCovariance).filter(AssetCovariance.snapshot_id == snapshot_id).all()
    cov_data = [{
        'ticker_i': item.ticker_i,
        'ticker_j': item.ticker_j,
        'cov_value': item.cov_value
    } for item in cov_query]

    cov_df = pd.DataFrame(cov_data)
    cov = cov_df.pivot(index='ticker_i', columns='ticker_j', values='cov_value')

    # Enforce matrix alignment with mu index
    cov = cov.reindex(index=mu.index, columns=mu.index)

    return mu, cov

def save_prices(db: Session, prices: pd.DataFrame) -> int:
    """
    Stores daily closing prices, replacing what was stored for these tickers.
    WHY replace: adjusted prices are revised whenever a dividend is paid, so
    mixing an old download with a new one would give an inconsistent series.
    """
    tickers = list(prices.columns)
    db.query(MarketData).filter(MarketData.asset_symbol.in_(tickers)).delete(synchronize_session=False)

    rows = []
    for ticker in tickers:
        for day, price in prices[ticker].dropna().items():
            rows.append({
                "id": f"{ticker}|{day.date()}",
                "asset_symbol": ticker,
                "date": day.date(),
                "close_price": float(price),
                "data_source": "yfinance",
            })
    db.bulk_insert_mappings(MarketData, rows)
    db.commit()
    return len(rows)

# def main():
#     # 1. Ensure DB tables exist
#     Base.metadata.create_all(bind=engine)

#     prices = download_prices(UNIVERSE)
#     is_valid, issues = validate_prices(prices)
#     print(is_valid, issues)

#     monthly_returns = compute_monthly_returns(prices)
#     mu, cov = compute_mean_and_cov(monthly_returns)

#     db = SessionLocal()
#     try:
#         saved = save_prices(db, prices)
#         print(f"Saved {saved} daily prices.")
#         print("Saving snapshot to PostgreSQL...")
#         snapshot_id = save_snapshot(db, mu, cov)
#         print(f"Successfully saved snapshot! Snapshot ID: {snapshot_id}")

#         # 5. Load back to verify round-trip integrity
#         print("Verifying round-trip by loading snapshot from database...")
#         loaded_mu, loaded_cov = load_snapshot(db, snapshot_id)
        
#         print("\n--- Loaded Mean Returns ---")
#         print(loaded_mu)
#         print("\n--- Loaded Covariance Matrix Shape ---")
#         print(loaded_cov.shape)

#     finally:
#         db.close()

# -------------------------------------------------------------
# KEEPING THE STORED PRICES UP TO DATE
# -------------------------------------------------------------
# WHY add days instead of downloading everything again: the stored history is
# already checked and every valuation depends on it. Adding only the missing
# days keeps it intact, is quick enough to run each time the server starts,
# and still works when the data source no longer has a fund's full history.

# The symbols to ask Yahoo for, oldest first, when they differ from the ticker
# used in this system. NSE changed the gilt fund's symbol (circular of 26 Oct
# 2026) and Yahoo did not move its history to the new symbol, so the two are
# joined. The ticker inside this system stays SETF10GILT.NS, so stored
# portfolios, snapshots and the frontend are unaffected.
YAHOO_SYMBOLS = {
    "SETF10GILT.NS": ["SETF10GILT.NS", "SBI10YGILT.NS"],
}

INDIA_TIME = timezone(timedelta(hours=5, minutes=30))
OVERLAP_DAYS = 10               # days re-downloaded to compare with what is stored
MAX_OVERLAP_DIFFERENCE = 0.005  # stored and downloaded prices for the same day must agree within 0.5%
MAX_DAYS_BEHIND = 5             # every fund's newest price must be this close to the newest date


def last_complete_trading_day(now: datetime = None) -> date:
    """The latest weekday whose market session has finished (NSE closes at
    15:30 India time; 16:00 is used to be safe). Holidays are not known here;
    on a holiday there is simply nothing new to add."""
    now = now or datetime.now(INDIA_TIME)
    day = now.date() if now.hour >= 16 else now.date() - timedelta(days=1)
    while day.weekday() >= 5:           # Saturday, Sunday
        day -= timedelta(days=1)
    return day


def download_recent(tickers: list[str], since: date, until: date) -> pd.DataFrame:
    """Closing prices from `since` to `until`, one column per ticker."""
    symbols = sorted({symbol for ticker in tickers for symbol in YAHOO_SYMBOLS.get(ticker, [ticker])})
    data = yf.download(symbols, start=str(since), auto_adjust=True, threads=False, progress=False)
    close = data["Close"]
    close.index = pd.to_datetime(close.index).tz_localize(None)
    close = close.loc[close.index <= pd.Timestamp(until)]      # leave out a session still in progress

    recent = pd.DataFrame(index=close.index)
    for ticker in tickers:
        series = pd.Series(float("nan"), index=close.index)
        for symbol in YAHOO_SYMBOLS.get(ticker, [ticker]):     # a later symbol wins where both have a price
            if symbol in close.columns:
                series = close[symbol].combine_first(series)
        recent[ticker] = series
    return recent


def load_stored_prices(db: Session, since: date = None) -> pd.DataFrame:
    """Stored closing prices: one row per date, one column per ticker."""
    query = (db.query(MarketData.asset_symbol, MarketData.date, MarketData.close_price)
             .filter(MarketData.asset_symbol.in_(UNIVERSE)))
    if since:
        query = query.filter(MarketData.date >= since)
    frame = pd.DataFrame(query.all(), columns=["ticker", "date", "price"])
    frame["price"] = frame["price"].astype(float)
    frame["date"] = pd.to_datetime(frame["date"])
    return frame.pivot(index="date", columns="ticker", values="price").sort_index()


def update_prices(db: Session) -> dict:
    """
    Adds the trading days missing since the last stored price.
    Returns {"rows": number added, "last_date": ..., "errors": [...], "message": "..."}.
    If any check fails, nothing is saved and the failure is written to the audit log.
    """
    target = last_complete_trading_day()
    stored_last = dict(
        db.query(MarketData.asset_symbol, func.max(MarketData.date))
        .filter(MarketData.asset_symbol.in_(UNIVERSE))
        .group_by(MarketData.asset_symbol).all())
    without_history = sorted(set(UNIVERSE) - set(stored_last))
    if without_history:
        message = f"No stored prices for {without_history}. Run: python scripts/data.py --full"
        return {"rows": 0, "last_date": None, "errors": [message], "message": message}

    last = min(stored_last.values())
    if last >= target:
        return {"rows": 0, "last_date": last, "errors": [],
                "message": f"Prices are already up to date ({last})."}

    since = last - timedelta(days=OVERLAP_DAYS)
    recent = download_recent(UNIVERSE, since, target)
    stored = load_stored_prices(db, since)

    errors, rows, fresh_by_ticker = [], [], {}
    for ticker in UNIVERSE:
        new, old = recent[ticker].dropna(), stored[ticker].dropna()

        # 1. For days held in both, the download must match what is stored.
        #    A difference means the source revised its adjusted prices, and
        #    adding new days onto the old ones would give an inconsistent series.
        both = new.index.intersection(old.index)
        if len(both) and ((new[both] / old[both] - 1).abs() > MAX_OVERLAP_DIFFERENCE).any():
            errors.append(f"{ticker}: downloaded prices differ from the stored ones for the same days. "
                          "Run: python scripts/data.py --full")

        fresh = new[new.index > pd.Timestamp(stored_last[ticker])]
        fresh_by_ticker[ticker] = fresh

        # 2. No single day may move more than the limit, counting the step
        #    from the last stored price to the first new one.
        moves = pd.concat([old.iloc[-1:], fresh]).pct_change().dropna()
        for day, move in moves[moves.abs() > MAX_DAILY_MOVE].items():
            errors.append(f"{ticker}: {move:+.1%} move on {day.date()}, above the {MAX_DAILY_MOVE:.0%} limit")

        rows += [{"id": f"{ticker}|{day.date()}", "asset_symbol": ticker, "date": day.date(),
                  "close_price": float(price), "data_source": "yfinance"} for day, price in fresh.items()]

    if not rows:
        return {"rows": 0, "last_date": last, "errors": [],
                "message": f"No new prices since {last} (market holiday, or the source has not published yet)."}

    # 3. Every fund must come up to date together. One left behind would be
    #    valued at an old price while the others moved on.
    newest = max(fresh.index[-1] for fresh in fresh_by_ticker.values() if len(fresh))
    for ticker, fresh in fresh_by_ticker.items():
        if fresh.empty or (newest - fresh.index[-1]).days > MAX_DAYS_BEHIND:
            errors.append(f"{ticker}: no price close to {newest.date()} was downloaded")

    if errors:
        db.add(AuditLog(
            id=str(uuid.uuid4()), timestamp=datetime.now(timezone.utc), user_id="system",
            action="data.validation_failed", entity_type="market_data", entity_id="update",
            reason="; ".join(errors)[:1000]))
        db.commit()
        return {"rows": 0, "last_date": last, "errors": errors,
                "message": "Price check failed. Nothing was saved."}

    try:
        db.bulk_insert_mappings(MarketData, rows)
        db.add(AuditLog(
            id=str(uuid.uuid4()), timestamp=datetime.now(timezone.utc), user_id="system",
            action="data.prices_updated", entity_type="market_data", entity_id="update",
            before={"last_date": str(last)},
            after={"rows": len(rows), "last_date": str(newest.date())}))
        db.commit()
    except IntegrityError:
        # Another copy of the server added the same days a moment earlier.
        db.rollback()
        return {"rows": 0, "last_date": newest.date(), "errors": [],
                "message": "These days were just added by another running server."}
    return {"rows": len(rows), "last_date": newest.date(), "errors": [],
            "message": f"Added {len(rows)} prices: now up to {newest.date()} (was {last})."}


def full_download(db: Session, prices_only: bool):
    """Downloads five years again and replaces the stored prices. For
    first-time setup, or when update_prices reports revised prices."""
    prices = download_prices(UNIVERSE)
    errors, warnings = check_prices(prices)
    for warning in warnings:
        print(f"warning: {warning}")

    if errors:
        for error in errors:
            print(f"ERROR: {error}")
        db.add(AuditLog(
            id=str(uuid.uuid4()),
            timestamp=datetime.now(timezone.utc),
            user_id="system",
            action="data.validation_failed",
            entity_type="market_data",
            entity_id="download",
            reason="; ".join(errors)[:1000],
        ))
        db.commit()
        sys.exit("Price check failed. Nothing was saved; the optimizer keeps using the last good snapshot.")

    saved = save_prices(db, prices)
    first_day, last_day = prices.index.min().date(), prices.index.max().date()
    print(f"Saved {saved} daily prices, {first_day} to {last_day}.")

    snapshot_id = None
    if not prices_only:
        monthly_returns = compute_monthly_returns(prices)
        mu, cov = compute_mean_and_cov(monthly_returns)
        snapshot_id = save_snapshot(db, mu, cov)
        print(f"Saved snapshot {snapshot_id}")

    db.add(AuditLog(
        id=str(uuid.uuid4()),
        timestamp=datetime.now(timezone.utc),
        user_id="system",
        action="data.prices_refreshed",
        entity_type="market_data",
        entity_id="download",
        after={"rows": saved, "first_date": str(first_day), "last_date": str(last_day),
               "snapshot_id": str(snapshot_id) if snapshot_id else None},
    ))
    db.commit()


def main():
    # python scripts/data.py                 add the missing days, then save a new snapshot of estimates
    # python scripts/data.py --prices-only   add the missing days only
    # python scripts/data.py --full          download five years again and replace everything
    #
    # WHY --prices-only: valuation and drift read the stored prices, the
    # optimizer reads the newest snapshot. Updating only the prices brings
    # valuations up to date without changing what the optimizer recommends.
    prices_only = "--prices-only" in sys.argv[1:]
    Base.metadata.create_all(bind=engine)

    db = SessionLocal()
    try:
        nothing_stored = db.query(MarketData.id).first() is None
        if "--full" in sys.argv[1:] or nothing_stored:
            full_download(db, prices_only)
            return

        result = update_prices(db)
        for error in result["errors"]:
            print(f"ERROR: {error}")
        if result["errors"]:
            sys.exit("Price check failed. Nothing was saved; the stored prices are unchanged.")
        print(result["message"])
        if prices_only:
            print("Prices only: no new snapshot was saved, so the optimizer's estimates are unchanged.")
            return

        # The snapshot is computed from the stored prices, the same ones valuation uses.
        mu, cov = compute_mean_and_cov(compute_monthly_returns(load_stored_prices(db)))
        snapshot_id = save_snapshot(db, mu, cov)
        print(f"Saved snapshot {snapshot_id}")
        loaded_mu, loaded_cov = load_snapshot(db, snapshot_id)
        print("\n--- Mean returns ---")
        print(loaded_mu)
        print(f"\nCovariance matrix shape: {loaded_cov.shape}")
    finally:
        db.close()

if __name__ == "__main__":
    main()