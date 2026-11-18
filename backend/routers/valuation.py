"""
Valuation, drift and rebalancing endpoints.

WHY: gives the manager the current paper value of an accepted portfolio,
raises the "rebalancing suggested" flag when a holding drifts past the
threshold, and lists the trades that would restore the approved weights.
Reads stored prices only; never downloads and never trades.
"""
from dataclasses import asdict
from datetime import date
from typing import Optional

import pandas as pd
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database import get_db
from models import Portfolio, PortfolioDecision
from schemas import RebalancingResponse, ValuationResponse
from valuation.prices import stored_prices
from valuation.valuation import Valuation, rebalancing_trades, value_portfolio

router = APIRouter(tags=["Valuation"])

NOT_ACCEPTED = "This portfolio has not been accepted by the client, so there is nothing to value."
NO_PRICES = "No stored prices. Run scripts/data.py first."


def get_portfolio_or_404(db: Session, portfolio_id: str) -> Portfolio:
    portfolio = db.query(Portfolio).filter(Portfolio.id == portfolio_id).first()
    if not portfolio:
        raise HTTPException(status_code=404, detail="Portfolio not found")
    return portfolio


def acceptances(db: Session, portfolio_ids: list[str]) -> dict[str, PortfolioDecision]:
    """The client's acceptance of each portfolio, found with one query.
    Portfolios that were never accepted are simply missing from the result."""
    if not portfolio_ids:
        return {}
    rows = (
        db.query(PortfolioDecision)
        .filter(PortfolioDecision.portfolio_id.in_(portfolio_ids),
                PortfolioDecision.actor == "client",
                PortfolioDecision.decision == "accepted")
        .order_by(PortfolioDecision.timestamp)
        .all()
    )
    return {row.portfolio_id: row for row in rows}      # the latest one wins


def value_accepted(portfolio: Portfolio, acceptance: PortfolioDecision, prices: pd.DataFrame,
                   invested_on: Optional[date] = None) -> Valuation:
    """Value one accepted portfolio. Raises ValueError with a readable reason."""
    if prices.empty:
        raise ValueError(NO_PRICES)
    if acceptance.amount is None:
        raise ValueError("The acceptance on record has no invested amount.")
    return value_portfolio(
        portfolio.weights, float(acceptance.amount), prices,
        invested_on or acceptance.timestamp.date(),
        cash_rate=portfolio.risk_free_rate)


def compute_valuation(db: Session, portfolio: Portfolio, invested_on: Optional[date]) -> Valuation:
    acceptance = acceptances(db, [portfolio.id]).get(portfolio.id)
    if acceptance is None:
        raise HTTPException(status_code=409, detail=NOT_ACCEPTED)
    try:
        return value_accepted(portfolio, acceptance, stored_prices(db), invested_on)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc))


def valuation_response(portfolio: Portfolio, valuation: Valuation, hypothetical: bool) -> dict:
    return {
        "portfolio_id": portfolio.id,
        "investor_id": portfolio.investor_id,
        "hypothetical": hypothetical,
        **asdict(valuation),
    }


@router.get("/portfolios/{portfolio_id}/valuation", response_model=ValuationResponse)
def get_valuation(portfolio_id: str, invested_on: Optional[date] = None, db: Session = Depends(get_db)):
    """Current paper value and drift. Pass invested_on (YYYY-MM-DD) to see a
    hypothetical: what it would be worth had it been invested on that date."""
    portfolio = get_portfolio_or_404(db, portfolio_id)
    valuation = compute_valuation(db, portfolio, invested_on)
    return valuation_response(portfolio, valuation, invested_on is not None)


@router.get("/portfolios/{portfolio_id}/rebalancing", response_model=RebalancingResponse)
def get_rebalancing(portfolio_id: str, db: Session = Depends(get_db)):
    """The trades that would return each holding to its approved weight."""
    portfolio = get_portfolio_or_404(db, portfolio_id)
    valuation = compute_valuation(db, portfolio, None)
    return {
        "portfolio_id": portfolio.id,
        "investor_id": portfolio.investor_id,
        "as_of_date": valuation.as_of_date,
        "current_value": valuation.current_value,
        "drift_threshold": valuation.drift_threshold,
        "rebalancing_suggested": valuation.rebalancing_suggested,
        "trades": [asdict(trade) for trade in rebalancing_trades(valuation)],
    }


@router.get("/drift-alerts", response_model=list[ValuationResponse])
def drift_alerts(db: Session = Depends(get_db)):
    """Every accepted portfolio where a holding has drifted past the threshold."""
    portfolios = db.query(Portfolio).filter(Portfolio.status == "accepted").all()
    accepted = acceptances(db, [p.id for p in portfolios])
    prices = stored_prices(db) if accepted else pd.DataFrame()

    alerts = []
    for portfolio in portfolios:
        acceptance = accepted.get(portfolio.id)
        if acceptance is None:
            continue        # no acceptance record; nothing to report
        try:
            valuation = value_accepted(portfolio, acceptance, prices)
        except ValueError:
            continue        # no prices for it; nothing to report
        if valuation.rebalancing_suggested:
            alerts.append(valuation_response(portfolio, valuation, False))
    return alerts