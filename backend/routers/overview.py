"""
Overview endpoints: one request per screen.

WHY: the dashboard, the queue and the investor page each used to ask for the
investors, then every investor's portfolios, then every valuation, one request
at a time. With a remote database that is slow, and each screen worked out
"which portfolio is current" for itself, so they could disagree. These
endpoints return everything a screen needs in one response. The lookups are
independent, so they run at the same time (database.read_together), and the
investor's stage is decided in one place (workflow/status.py).
"""
from collections import defaultdict
from typing import Optional

from fastapi import APIRouter, HTTPException

from database import read_together
from models import Interaction, Investor, Portfolio, PortfolioDecision, RiskAssessment
from routers.valuation import NOT_ACCEPTED, valuation_response, value_accepted
from schemas import InvestorDetailResponse, OverviewResponse
from valuation.prices import stored_prices
from workflow.status import QUEUE_STAGES, STAGE_LABELS, current_portfolios, stage_for

router = APIRouter(tags=["Overview"])


def load_records(investor_id: Optional[str] = None) -> dict:
    """Everything the overviews are built from, for one investor or for all,
    read at the same time."""
    def only(query, column):
        return query.filter(column == investor_id) if investor_id else query

    lookups = {
        "investors": lambda db: only(db.query(Investor), Investor.id).order_by(Investor.name).all(),
        "assessments": lambda db: (only(db.query(RiskAssessment), RiskAssessment.investor_id)
                                   .order_by(RiskAssessment.created_at.desc()).all()),
        "portfolios": lambda db: (only(db.query(Portfolio), Portfolio.investor_id)
                                  .order_by(Portfolio.created_at.desc()).all()),
        # The client's acceptance of each portfolio that is currently accepted.
        "acceptances": lambda db: (
            only(db.query(PortfolioDecision)
                 .join(Portfolio, Portfolio.id == PortfolioDecision.portfolio_id)
                 .filter(Portfolio.status == "accepted",
                         PortfolioDecision.actor == "client",
                         PortfolioDecision.decision == "accepted"), Portfolio.investor_id)
            .order_by(PortfolioDecision.timestamp).all()),
        "prices": stored_prices,
    }
    if investor_id:
        lookups["interactions"] = lambda db: (db.query(Interaction)
                                              .filter(Interaction.investor_id == investor_id)
                                              .order_by(Interaction.timestamp).all())
    return read_together(**lookups)


def build_overviews(records: dict) -> list[dict]:
    """One overview per investor, from records already read."""
    latest_assessment: dict[str, RiskAssessment] = {}
    for assessment in records["assessments"]:                   # newest first
        latest_assessment.setdefault(assessment.investor_id, assessment)

    portfolios = defaultdict(list)
    for portfolio in records["portfolios"]:                     # newest first
        portfolios[portfolio.investor_id].append(portfolio)

    accepted = {row.portfolio_id: row for row in records["acceptances"]}   # the latest one wins

    overviews = []
    for investor in records["investors"]:
        assessment = latest_assessment.get(investor.id)
        active, pending = current_portfolios(portfolios[investor.id])
        stage = stage_for(assessment is not None, active, pending)

        valuation, note = None, None
        if active is not None:
            acceptance = accepted.get(active.id)
            if acceptance is None:
                note = NOT_ACCEPTED
            else:
                try:
                    valuation = valuation_response(
                        active, value_accepted(active, acceptance, records["prices"]), False)
                except ValueError as exc:
                    note = str(exc)

        overviews.append({
            "investor": investor,
            # The label always comes from the stored assessment, never from a
            # text field that could have been typed in or left over.
            "risk_bucket": assessment.bucket if assessment else None,
            "horizon": assessment.horizon if assessment else None,
            "assessment": assessment,
            "stage": stage,
            "stage_label": STAGE_LABELS[stage],
            "in_queue": stage in QUEUE_STAGES,
            "active_portfolio": active,
            "pending_portfolio": pending,
            "valuation": valuation,
            "valuation_note": note,
        })
    return overviews


def totals_for(overviews: list[dict]) -> dict:
    valuations = [o["valuation"] for o in overviews if o["valuation"]]
    invested = sum(v["amount"] for v in valuations)
    value = sum(v["current_value"] for v in valuations)
    stage_counts = {stage: 0 for stage in STAGE_LABELS}
    for overview in overviews:
        stage_counts[overview["stage"]] += 1
    return {
        "clients": len(overviews),
        "invested_clients": len(valuations),
        "amount_invested": invested,
        "current_value": value,
        "gain": value - invested,
        "gain_pct": (value - invested) / invested if invested else 0.0,
        "as_of_date": max((v["as_of_date"] for v in valuations), default=None),
        "stage_counts": stage_counts,
    }


@router.get("/overview", response_model=OverviewResponse)
def overview():
    """Every investor with their stage, current portfolios and valuation, plus
    the totals for the dashboard. One request serves the dashboard, the
    investor list and the submission queue."""
    overviews = build_overviews(load_records())
    return {"totals": totals_for(overviews), "investors": overviews}


@router.get("/investors/{investor_id}/overview", response_model=InvestorDetailResponse)
def investor_overview(investor_id: str):
    """Everything the investor page shows, in one response."""
    records = load_records(investor_id)
    if not records["investors"]:
        raise HTTPException(status_code=404, detail="Investor not found")
    detail = build_overviews(records)[0]
    detail["interactions"] = records["interactions"]
    return detail