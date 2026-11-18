"""
Prints where every investor stands, straight from the database, and points
out records that disagree with each other.

WHY: when a screen shows something unexpected, this answers "what is actually
stored?" without clicking through the app: each investor's label, latest
assessment, portfolios by status, stage and valuation.

Usage (from backend/):
    python scripts/check_state.py                 report only; changes nothing
    python scripts/check_state.py --fix-labels    also correct risk labels that
                                                  do not match the latest assessment
"""
import os
import sys
from collections import Counter

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from audit_trail import record_audit
from database import SessionLocal
from models import AuditLog, DataSnapshot, Investor, Portfolio, RiskAssessment
from routers.valuation import acceptances, value_accepted
from valuation.prices import stored_prices
from workflow.status import OPEN_STATUSES, STAGE_LABELS, current_portfolios, stage_for


def describe(portfolio) -> str:
    held = sorted(((w, t) for t, w in portfolio.weights.items() if w > 0), reverse=True)
    weights = ", ".join(f"{t.replace('.NS', '')} {w:.0%}" for w, t in held)
    return f"{portfolio.status}, created {portfolio.created_at.date()}, id {portfolio.id}\n        {weights}"


def main():
    fix_labels = "--fix-labels" in sys.argv[1:]
    db = SessionLocal()
    try:
        prices = stored_prices(db)
        if prices.empty:
            print("PRICES: none stored. Run: python scripts/data.py")
        else:
            print(f"PRICES: {prices.index[0].date()} to {prices.index[-1].date()} "
                  f"({len(prices)} days, {len(prices.columns)} instruments)")
        snapshot = db.query(DataSnapshot).order_by(DataSnapshot.created_at.desc()).first()
        print(f"NEWEST SNAPSHOT (what the optimizer uses): "
              f"{snapshot.created_at.date() if snapshot else 'none'}\n")

        problems = 0
        for investor in db.query(Investor).order_by(Investor.name).all():
            assessments = (db.query(RiskAssessment)
                           .filter(RiskAssessment.investor_id == investor.id)
                           .order_by(RiskAssessment.created_at.desc()).all())
            portfolios = (db.query(Portfolio)
                          .filter(Portfolio.investor_id == investor.id)
                          .order_by(Portfolio.created_at.desc()).all())
            latest = assessments[0] if assessments else None
            active, pending = current_portfolios(portfolios)
            stage = stage_for(latest is not None, active, pending)

            print(f"{investor.name}   (id {investor.id})")
            print(f"    label on the investor row : {investor.risk_score or '-'} / {investor.investment_horizon or '-'}")
            if latest:
                print(f"    latest assessment         : {latest.created_at.date()}, score {latest.score} "
                      f"(capacity {latest.capacity_score}, tolerance {latest.tolerance_score}), "
                      f"{latest.bucket} / {latest.horizon}; {len(assessments)} on record")
            else:
                recorded = (db.query(AuditLog)
                            .filter(AuditLog.entity_id == investor.id,
                                    AuditLog.action == "assessment.recorded").count())
                history = (f"the audit log shows {recorded} were recorded and have since been removed"
                           if recorded else "the audit log shows none was ever recorded")
                print(f"    latest assessment         : NONE ({history})")
            print(f"    stage                     : {STAGE_LABELS[stage]}")
            counts = Counter(p.status for p in portfolios)
            print(f"    portfolios                : "
                  + (", ".join(f"{n} {status}" for status, n in sorted(counts.items())) or "none"))
            if active:
                print(f"    active  -> {describe(active)}")
                acceptance = acceptances(db, [active.id]).get(active.id)
                if acceptance is None:
                    print("        PROBLEM: marked accepted but has no client acceptance on record.")
                    problems += 1
                else:
                    try:
                        v = value_accepted(active, acceptance, prices)
                        print(f"        invested {v.start_date}, valued {v.as_of_date} ({v.days_held} days): "
                              f"{v.amount:,.0f} -> {v.current_value:,.0f} ({v.gain_pct:+.2%})")
                    except ValueError as exc:
                        print(f"        PROBLEM: cannot be valued: {exc}")
                        problems += 1
            if pending:
                print(f"    pending -> {describe(pending)}")
            open_count = sum(counts[s] for s in OPEN_STATUSES)
            if open_count > 1:
                print(f"    PROBLEM: {open_count} portfolios are awaiting a decision; there should be at most one. "
                      "Running the optimizer again will retire the older ones.")
                problems += 1

            # The label must be exactly what the latest assessment says.
            expected = (latest.bucket, latest.horizon) if latest else (None, None)
            if (investor.risk_score, investor.investment_horizon) != expected:
                problems += 1
                print(f"    PROBLEM: the label says {investor.risk_score or '-'} / {investor.investment_horizon or '-'} "
                      f"but the latest assessment says {expected[0] or 'nothing'} / {expected[1] or 'nothing'}.")
                if fix_labels:
                    record_audit(db, "system", "investor.label_corrected", "investor", investor.id,
                                 reason="Label did not match the latest risk assessment (check_state.py)",
                                 before={"risk_score": investor.risk_score,
                                         "investment_horizon": investor.investment_horizon},
                                 after={"risk_score": expected[0], "investment_horizon": expected[1]})
                    investor.risk_score, investor.investment_horizon = expected
                    print("        corrected.")
            print()

        if fix_labels:
            db.commit()
        print(f"{problems} problem(s) found." + ("" if fix_labels or not problems
                                                  else " Labels can be corrected with --fix-labels."))
    finally:
        db.close()


if __name__ == "__main__":
    main()