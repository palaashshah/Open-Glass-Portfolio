# OpenGlass Portfolio

**Integrated Investor Relationship & Portfolio Decision Support System.** A final-year major project.

It joins a CRM module (investor profiles, risk questionnaire, interaction history) to a
quantitative portfolio optimization engine. A relationship manager selects an investor, and the
system computes a portfolio for that person's risk constraints, explains why in plain language,
takes it through manager approval and client sign-off, then values it and watches it for drift.

**It claims:** consistent, suitable, explainable, auditable recommendations.
**It does not claim:** to beat the market, predict returns or guarantee any return. Expected
return and risk figures are estimates from historical data. This is an academic project, not
investment advice.

## Status

- **Backend:** complete. Scoring, optimizer, rationale, approval workflow, saved manager edits,
  price history with a data check, paper valuation, drift alerts, rebalancing suggestion, audit
  log, and single-split and walk-forward backtests. 46 automated tests.
- **Frontend:** a Next.js app connected to the API for intake, scoring, optimization, review
  and edits, decisions, rationale, a printable proposal, valuation, drift alerts and the audit log.
- **Not built:** login and roles. One manager, `manager-001`, is hardcoded.

## How it works

1. **Questionnaire.** The investor answers ten questions. Four measure risk **capacity** (years
   until withdrawal, objective, knowledge, emergency fund) and six measure risk **tolerance**.
   The backend scores each group from 0 to 100. The lower one is the risk score.
2. **Equity target.** The score sets the share of equity: `10% + 0.8% × score`. The optimizer
   must stay within 2 percentage points either side. The investment horizon, taken from the
   withdrawal question, sets a ceiling: 30% for short, 60% for medium, none for long.
3. **Bucket limits.** The score also picks a bucket, which sets the remaining limits:

   | Score | Bucket | Max annual volatility | Min defensive (debt + gold + cash) | Objective |
   | --- | --- | --- | --- | --- |
   | 0–20 | Conservative | 8% | 60% | Minimum volatility |
   | 21–40 | Cautious | 11% | 45% | Maximum Sharpe ratio |
   | 41–60 | Moderate | 14% | 30% | Maximum Sharpe ratio |
   | 61–80 | Growth | 18% | 15% | Maximum Sharpe ratio |
   | 81–100 | Aggressive | 22% | 5% | Maximum Sharpe ratio |

4. **Limits on every portfolio.** No instrument above 35%, gold no higher than 25%, sector funds
   the investor excluded removed, weights non-negative and summing to 100%.
5. **Optimization.** A mean-variance (Markowitz) optimizer, through PyPortfolioOpt, finds the
   weights inside those limits. Weights are never looked up from a table. If the maximum-Sharpe
   result is too volatile for the bucket, it re-solves for the highest return within the limit.
   If no portfolio can satisfy the rules, it returns a readable reason and saves nothing.
6. **Rationale.** Rule-based template text explains the result in four layers: the profile, the
   rules applied, the limits the portfolio sits on, and each holding's share of the money, the
   expected return and the risk. No machine learning is involved.
7. **Review.** The manager approves the proposal, rejects it with a reason, or edits the
   weights. Edits are checked against the same rules, and an edit that breaks one is never saved.
8. **Sign-off.** The client's decision is logged. Acceptance records the amount invested.
9. **Monitoring.** An accepted portfolio is valued on later stored prices. It is flagged when
   any holding drifts more than 5 percentage points from its approved weight, and the system
   lists the trades that would restore the approved weights. No trades are placed.

Identical answers, exclusions, configuration and data snapshot always give the identical
portfolio. Every tunable number lives in `backend/config/risk_constraints.py`.

### Instrument universe

Eight Indian ETFs, fixed in the config file.

| Ticker | Asset class | Can be excluded as |
| --- | --- | --- |
| `NIFTYBEES.NS` | Equity | |
| `JUNIORBEES.NS` | Equity | |
| `BANKBEES.NS` | Equity | `banking` |
| `ITBEES.NS` | Equity | `it` |
| `PHARMABEES.NS` | Equity | `pharma` |
| `GOLDBEES.NS` | Gold | |
| `SETF10GILT.NS` | Debt | |
| `LIQUIDBEES.NS` | Cash | |

### Portfolio statuses

| Status | Meaning | Set by |
| --- | --- | --- |
| `proposed` | Fresh from the optimizer, or a saved manager edit | Optimization or adjustment |
| `approved` | The manager is ready to present it | Manager decision |
| `rejected` | The manager turned it down, with a reason | Manager decision |
| `accepted` | The client agreed; this is the moment of investing | Client decision |
| `declined` | The client said no | Client decision |
| `superseded` | Replaced by a saved edit or by a newer accepted portfolio | Automatic |

Only a proposed portfolio can be approved, rejected or adjusted. Only an approved portfolio can
be accepted or declined. An investor has at most one accepted portfolio.

## Tech stack

- **Backend:** Python, FastAPI, SQLAlchemy, Pydantic
- **Database:** PostgreSQL
- **Optimization:** PyPortfolioOpt (cvxpy), pandas, numpy
- **Market data:** yfinance (batch download of NSE tickers; no real-time feed)
- **Frontend:** Next.js 16, React 19, TypeScript
- **Tests:** pytest

## Prerequisites

- Python 3.11 or newer
- PostgreSQL, local or hosted. SQLite will not work: the tables use PostgreSQL column types.
- Node.js 20.9 or newer (for the frontend)

## Setup

### 1. Database

Create an empty PostgreSQL database, then create a file named `.env` inside `backend/`:

```
DATABASE_URL=postgresql+psycopg2://USER:PASSWORD@HOST:5432/DATABASE_NAME
```

Keep the `+psycopg2` part. `requirements.txt` installs the psycopg2 driver, and recent
SQLAlchemy releases look for a different driver when the URL starts with plain `postgresql://`.
The backend then fails at startup with `No module named 'psycopg'`.

The `.env` file is ignored by git. Never commit it. With a hosted database, a network that
blocks port 5432 stops the backend from starting.

### 2. Backend

From the repository root:

```bash
python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

Activate the virtual environment in every new terminal.

### 3. Market data

From `backend/`:

```bash
python scripts/data.py
```

This creates the tables, downloads about five years of daily prices for the eight ETFs (it needs
internet access), checks them, stores them, and saves a snapshot of annualised average returns
and covariances.

A download that fails the check saves nothing and is written to the audit log, so the optimizer
keeps using the last good snapshot. The check fails when an instrument is missing more than 5%
of its days, when any one-day move is larger than 20%, or when there are fewer than 500 days.

Run it again whenever fresher data is wanted. Stored prices are replaced in full and a new
snapshot is added. The optimizer only ever reads stored snapshots, and every portfolio records
the snapshot it used.

### 4. Seed a manager

Investors are assigned to a manager, and login is not built yet. Add one manager row once,
using any PostgreSQL client:

```sql
INSERT INTO users (id, name, role) VALUES ('manager-001', 'Demo Manager', 'manager');
```

### 5. Run the API

From `backend/`:

```bash
uvicorn main:app --reload
```

- API: http://localhost:8000
- Interactive docs, where every endpoint can be tried: http://localhost:8000/docs

### 6. Run the frontend

From the repository root, in a second terminal:

```bash
npm install
npm run dev
```

The site runs at http://localhost:3000 and expects the API at http://localhost:8000. Both
addresses are fixed in code: the API address in `src/lib/api.ts` and the allowed site address in
`backend/main.py`. `npm run build` downloads three fonts from Google Fonts, so it needs internet
access.

## Using the app

Most manager screens work on the investor you last opened. Open one from **Investors** or
**Submission Queue** first.

| Screen | What it does |
| --- | --- |
| Dashboard | Client count, total AUM, total gain on accepted portfolios, proposals awaiting review |
| Investor Intake | Profile, sector exclusions and the questionnaire. The backend scores the answers and creates the investor with a saved assessment. Also available on its own at `/investor`. |
| Submission Queue | A short list of investors with shortcuts to open one or run the optimizer |
| Investors | Searchable list. An investor's page shows valuation, allocation, holdings drift and interaction history, and has forms to log an interaction and edit the profile. |
| Review & Customize | Run the optimizer, edit weights with live metrics and rule checks from the backend, save the edit, then approve or reject |
| Rationale | The explanation for the investor's latest portfolio |
| Proposal (PDF) | A printable proposal built from the stored portfolio, rationale and decision trail. Save it as a PDF from the browser's print dialog. |
| Client Sign-Off | Record the client accepting or declining an approved portfolio, with the amount invested |
| Investor Portal | A read-only view of the accepted portfolio, its metrics and its valuation |
| Interactions | Every logged interaction |
| Drift Alerts | Accepted portfolios with a holding past the drift threshold |
| Audit Log | The most recent audit rows |

The frontend holds no scoring or optimization logic. It sends answers and weights to the API and
shows what comes back. The API returns fractions (0.35 for 35%) and UTC times; the frontend
converts both for display.

## Trying the flow from the API docs page

Answers are sent as `{question_id: option_index}`. Question ids run from 4 to 13 and options
count from 0.

1. `POST /investors/` creates an investor and their first assessment in one call:

   ```json
   {
     "name": "Test Investor",
     "total_aum": 500000,
     "assigned_manager_id": "manager-001",
     "preferences_constraints": {"excluded_sectors": ["Pharma"]},
     "risk_answers": {"4": 2, "5": 2, "6": 1, "7": 0, "8": 1, "9": 2, "10": 1, "11": 2, "12": 1, "13": 4}
   }
   ```

   These answers score 100 for capacity and 28 for tolerance, so the risk score is 28
   (Cautious). Copy the investor `id` from the response. For an existing investor, send
   `{"answers": {...}}` to `POST /investors/{id}/risk-assessments` instead.
2. `POST /optimize` with `{"investor_id": "..."}`. Copy the portfolio `id`.
3. `GET /portfolios/{portfolio_id}/rationale`.
4. Optional: `POST /optimize/metrics` to check edited weights, then
   `POST /portfolios/{portfolio_id}/adjust` to save them. The saved edit is a new portfolio with
   its own `id`, and the original becomes `superseded`.
5. `POST /portfolios/{portfolio_id}/manager-decision` with
   `{"decision": "approved", "decided_by": "manager-001"}`, then `.../client-decision` with
   `{"decision": "accepted", "recorded_by": "manager-001"}`. The amount invested defaults to the
   investor's `total_aum`.
6. `GET /portfolios/{portfolio_id}/valuation`, `.../rebalancing` and `GET /audit-log`.

The docs page pre-fills example bodies with placeholder values. Remove optional fields you
do not mean to send.

A portfolio accepted today has no price history after it, so its gain and drift are zero. To see
valuation and drift with real movement, run `scripts/seed_demo_portfolio.py` (below).

## Tests

From `backend/`, with the virtual environment active:

```bash
python -m pytest tests -q
```

The 46 tests use made-up market data and need no database or network.

## API reference

| Endpoint | Purpose |
| --- | --- |
| `POST /investors/`, `GET /investors/`, `GET`, `PUT`, `DELETE /investors/{id}` | Investor profiles. Sending `risk_answers` on create also saves the first assessment. Delete is refused once the investor has assessments, portfolios or interactions on record. |
| `POST /interactions/`, `GET /interactions/?investor_id=` | Interaction history. `GET` answers 404 when there are none. |
| `POST /risk/score` | Score questionnaire answers without saving |
| `POST /investors/{id}/risk-assessments` | Score and save an assessment |
| `GET /investors/{id}/risk-assessments` | Assessment history, newest first |
| `POST /optimize` | Optimize and save a proposed portfolio for an investor |
| `POST /optimize/metrics` | Metrics and rule checks for hand-edited weights; saves nothing |
| `GET /portfolios?investor_id=`, `GET /portfolios/{id}` | Saved portfolios |
| `GET /portfolios/{id}/rationale` | Plain-language explanation |
| `POST /portfolios/{id}/adjust` | Save manager-edited weights as a new proposed portfolio. Needs a reason; refused if any rule is broken. |
| `POST /portfolios/{id}/manager-decision` | Approve, or reject with a reason |
| `POST /portfolios/{id}/client-decision` | Record the client accepting or declining |
| `GET /portfolios/{id}/decisions` | Decision trail |
| `GET /portfolios/{id}/valuation` | Paper value, gain and drift. Add `?invested_on=YYYY-MM-DD` for a hypothetical start date. |
| `GET /portfolios/{id}/rebalancing` | Trades that would restore the approved weights |
| `GET /drift-alerts` | Accepted portfolios that need rebalancing |
| `GET /audit-log` | Audit rows, newest first. Filters: `entity_id`, `entity_type`, `user_id`, `action`, `limit`. |
| `GET /universe` | The instruments and every current limit |
| `GET /questionnaire/meta` | The questionnaire's version and shape |

## Scripts

Run from `backend/`. All of them need the database.

| Script | What it does |
| --- | --- |
| `scripts/data.py` | Downloads prices, checks and stores them, saves a new snapshot |
| `scripts/test.py` | Creates the tables and nothing else |
| `scripts/preview_buckets.py` | Prints one portfolio per risk bucket |
| `scripts/preview_scores.py` | Prints one portfolio for a range of scores |
| `scripts/demo.py` | Prints five sample investors from answers to explanation. Writes nothing. |
| `scripts/seed_demo_portfolio.py <investor_id> [days_ago]` | Creates one accepted portfolio dated in the past (90 days by default), built only from prices before that date, for trying valuation and drift. The investor needs a saved assessment and a `total_aum`. Marked as seeded in the audit log. |
| `scripts/run_backtest.py` | Single-split backtest: estimate on all but the last year, test on the last year |
| `scripts/run_walk_forward.py` | Three-year walk-forward backtest comparing gold caps of 35%, 30%, 25% and 20% |

Both backtest scripts read stored prices and overwrite the CSV files in
`backend/backtest/output/`. Their test years end at the latest stored price, so results change
after `scripts/data.py` is run again.

## Validation

Everything the optimizer reports is measured on the data it was fitted to, so the rules were
also checked out-of-sample.

- **Method.** For each test year, portfolios for five reference scores (10, 30, 50, 70, 90; long
  horizon) are built only from prices before that year, then held for the year without
  rebalancing.
- **Acceptance checks.** Realised volatility rises with the score, and each portfolio's realised
  volatility stays within its bucket limit plus 1 percentage point.
- **Walk-forward.** Three consecutive test years. The first two are for comparing rule variants;
  the last is the final check.
- **Result.** With gold allowed up to the general 35% cap, both checks failed in the final year.
  25% was the highest gold cap tested that passed both checks in all three years, so the config
  caps gold at 25%.

Realised volatility under the current rules:

| Portfolio | 2023-24 | 2024-25 | 2025-26 | Bucket limit |
| --- | --- | --- | --- | --- |
| Score 10 | 3.3% | 3.5% | 6.4% | 8% |
| Score 30 | 6.3% | 6.8% | 10.8% | 11% |
| Score 50 | 7.7% | 8.2% | 11.9% | 14% |
| Score 70 | 9.1% | 10.2% | 13.2% | 18% |
| Score 90 | 9.5% | 11.7% | 13.3% | 22% |

How to read this:

- Three test years is a small sample.
- The final year had already been seen once, in the single-split test, before the gold cap was
  chosen. It is not a fully untouched check.
- In 2025-26 realised volatility was about 4.5 points above what the estimates implied, on
  average. Estimates are not forecasts.
- On average return, an equal-weight mix of the eight ETFs did about as well as the reference
  portfolios. What the rules add is risk matched to the investor's score.

The full rows, including returns and benchmarks, are in
`backend/backtest/output/walk_forward_results.csv` and `walk_forward_benchmarks.csv`.

## Repository layout

```
backend/
  main.py, database.py, models.py, schemas.py, audit_trail.py
  config/      risk_constraints.py   every tunable number
  scoring/     questionnaire.py, scoring.py
  optimizer/   engine.py
  rationale/   generator.py
  valuation/   valuation.py
  backtest/    backtest.py, output/
  routers/     investors, interactions, risk, optimize, decisions, valuation, audit, reference
  scripts/     data.py, demo.py, preview_*.py, run_backtest.py, run_walk_forward.py,
               seed_demo_portfolio.py, test.py
  tests/
src/
  app/         pages: / (the app) and /investor (intake on its own)
  components/  AppShell, InvestorOnboarding, RiskQuestionnaire, dashboard/, manager/
  lib/         api.ts (one function per endpoint), questions.ts, etfs.ts, styles.ts
requirements.txt, package.json
```

The scoring, optimizer, rationale, valuation and backtest modules are pure functions. Only the
routers and scripts read or write the database. Python imports are relative to `backend/`, so
run the API, the scripts and the tests from there.

## Known limitations

- **Estimates.** Expected returns are five-year historical averages, so the optimizer favours
  whatever did best in that window.
- **Paper only.** Valuation and rebalancing are calculations. The system places no trades.
- **No login.** The manager is hardcoded as `manager-001` and the API has no access checks.

