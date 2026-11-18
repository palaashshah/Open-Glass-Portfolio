"""
Where an investor stands in the workflow.

WHY: every screen needs the same answer to "what is this investor's current
portfolio, and what is the next action?". Deciding that in one place keeps the
dashboard, the queue and the investor page from disagreeing. Pure functions:
no database access.

An investor can have two portfolios that matter at the same time:
  active  - the accepted portfolio the money is in (at most one)
  pending - a newer proposal that is still waiting for a decision (at most one)
"""
OPEN_STATUSES = ("proposed", "approved")     # still waiting for a decision

STAGE_LABELS = {
    "needs_questionnaire": "Questionnaire pending",
    "needs_optimization": "Awaiting optimizer",
    "awaiting_manager": "Proposed, awaiting manager decision",
    "awaiting_client": "Approved, awaiting client sign-off",
    "invested": "Invested",
}

# Stages in which the manager has to do something on the queue screen.
QUEUE_STAGES = ("needs_questionnaire", "needs_optimization", "awaiting_manager")


def current_portfolios(portfolios):
    """portfolios: one investor's portfolios, newest first.
    Returns (active, pending); either can be None."""
    active = next((p for p in portfolios if p.status == "accepted"), None)
    pending = next((p for p in portfolios if p.status in OPEN_STATUSES), None)
    return active, pending


def stage_for(has_assessment: bool, active, pending) -> str:
    """The investor's stage. A pending proposal comes first, because it is the
    thing waiting for someone to act."""
    if not has_assessment:
        return "needs_questionnaire"
    if pending is not None:
        return "awaiting_manager" if pending.status == "proposed" else "awaiting_client"
    if active is not None:
        return "invested"
    return "needs_optimization"