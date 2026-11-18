from types import SimpleNamespace

from workflow.status import QUEUE_STAGES, current_portfolios, stage_for


def portfolio(status):
    return SimpleNamespace(status=status)


def stage(has_assessment, statuses):
    """statuses: the investor's portfolios, newest first."""
    active, pending = current_portfolios([portfolio(s) for s in statuses])
    return stage_for(has_assessment, active, pending)


def test_no_assessment_means_the_questionnaire_is_pending():
    assert stage(False, []) == "needs_questionnaire"


def test_assessed_investor_without_a_portfolio_awaits_the_optimizer():
    assert stage(True, []) == "needs_optimization"


def test_closed_portfolios_do_not_count():
    assert stage(True, ["rejected", "declined", "superseded"]) == "needs_optimization"


def test_proposed_awaits_the_manager_and_approved_awaits_the_client():
    assert stage(True, ["proposed"]) == "awaiting_manager"
    assert stage(True, ["approved"]) == "awaiting_client"


def test_accepted_portfolio_means_invested():
    assert stage(True, ["superseded", "accepted"]) == "invested"


def test_new_proposal_does_not_hide_the_accepted_portfolio():
    newest_first = [portfolio("proposed"), portfolio("accepted")]
    active, pending = current_portfolios(newest_first)
    assert active is newest_first[1] and pending is newest_first[0]
    assert stage_for(True, active, pending) == "awaiting_manager"


def test_queue_holds_only_stages_the_manager_acts_on():
    assert "awaiting_manager" in QUEUE_STAGES and "needs_questionnaire" in QUEUE_STAGES
    assert "invested" not in QUEUE_STAGES and "awaiting_client" not in QUEUE_STAGES