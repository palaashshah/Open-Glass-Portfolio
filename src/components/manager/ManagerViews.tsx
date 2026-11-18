'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ETFS, aggregateByCategory } from '@/lib/etfs'
import {
  ApiError, localDate, localTime, toPercent,
  listPortfolios, getPortfolio, getRationale, getDecisions, getValuation,
  getDriftAlerts, getAuditLog, clientDecision, getOverview,
  type PortfolioResponse, type RationaleResponse, type PortfolioDecisionResponse,
  type ValuationResponse, type AuditLogResponse,
  type InvestorOverview, type InvestorStage,
} from '@/lib/api'

type Investor = {
  id: string
  name: string
  risk_score?: string
  total_aum?: number
  investment_horizon?: string
  assigned_manager_id?: string
}

// ── Submission Queue ─────────────────────────────────────────────────────────
// Driven entirely from GET /overview — the backend decides who's in the
// queue (`in_queue`), labels each row (`stage_label`), and provides the
// current stage which maps to the right primary action.

type SubmissionQueueProps = {
  // kept for API compat; the queue no longer needs the raw list
  investors: Investor[]
  onOpen: (id: string) => void
  onRunOptimization: (id: string) => void
}

// Shared fixed grid template so header cells and row cells align — the
// previous `auto` last column let each row size its own actions differently.
const QUEUE_GRID = '2fr 1.6fr 1fr 1fr 1fr 250px'

export function SubmissionQueue({ onOpen, onRunOptimization }: SubmissionQueueProps) {
  const [rows, setRows] = useState<InvestorOverview[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    getOverview()
      .then(o => { if (!cancelled) setRows(o.investors.filter(x => x.in_queue)) })
      .catch(e => { if (!cancelled) setError(e instanceof ApiError ? e.message : 'Could not load the submission queue.') })
    return () => { cancelled = true }
  }, [])

  return (
    <div style={{ padding: '2rem', maxWidth: 1100 }}>
      <h1 style={h1}>Submission Queue</h1>
      <p style={muted}>
        Investors that need the manager&apos;s attention — stage comes from the backend.
      </p>

      {error && <ErrorView title="Submission queue" error={error} />}

      <div style={{ ...panel, padding: 0, marginTop: '1rem' }}>
        <div style={{
          display: 'grid', gridTemplateColumns: QUEUE_GRID, alignItems: 'center',
          padding: '10px 16px', gap: 12,
          borderBottom: '0.5px solid rgba(203,203,203,0.15)',
          fontSize: 11, color: '#CBCBCB', textTransform: 'uppercase', letterSpacing: '0.08em',
        }}>
          <span>Investor</span><span>Status</span><span>Risk</span><span>Horizon</span>
          <span style={{ textAlign: 'right' }}>AUM</span>
          <span />
        </div>

        {rows === null && !error && (
          <p style={{ padding: '1.5rem', fontSize: 13, color: '#CBCBCB' }}>Loading…</p>
        )}
        {rows && rows.length === 0 && (
          <p style={{ padding: '1.5rem', fontSize: 13, color: '#CBCBCB' }}>Nothing pending — every investor already has a decided portfolio.</p>
        )}

        {rows?.map(row => {
          const inv = row.investor
          const action = actionForStage(row.stage)
          return (
            <div key={inv.id} style={{
              display: 'grid', gridTemplateColumns: QUEUE_GRID, alignItems: 'center',
              padding: '12px 16px', gap: 12,
              borderBottom: '0.5px solid rgba(203,203,203,0.08)',
              fontSize: 13, color: '#FFFFE3',
            }}>
              <span onClick={() => onOpen(inv.id)} style={{ cursor: 'pointer' }}>{inv.name}</span>
              <QueueStatusChip label={row.stage_label} stage={row.stage} />
              <span style={{ color: '#a0b4c4', textTransform: 'capitalize' }}>{row.risk_bucket ?? '—'}</span>
              <span style={{ color: '#CBCBCB', textTransform: 'capitalize' }}>{row.horizon ?? '—'}</span>
              <span style={{ ...mono, textAlign: 'right' }}>{inv.total_aum ? '₹' + inv.total_aum.toLocaleString('en-IN') : '—'}</span>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button onClick={() => onOpen(inv.id)} style={btnGhost}>Open</button>
                {action && (
                  <button onClick={() => onRunOptimization(inv.id)} style={btnPrimary}>
                    {action}
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// Map backend stage → primary CTA label. "Run optimization" is only shown for
// `needs_optimization` — the backend 422s if you try it on needs_questionnaire.
function actionForStage(stage: InvestorStage): string | null {
  switch (stage) {
    case 'needs_questionnaire': return null  // backend refuses; direct the user to open the investor and take the questionnaire
    case 'needs_optimization':  return 'Run optimization'
    case 'awaiting_manager':    return 'Review'
    case 'awaiting_client':     return 'Open'
    case 'invested':            return null
  }
}

function QueueStatusChip({ label, stage }: { label: string; stage: InvestorStage }) {
  const colorForStage: Record<InvestorStage, string> = {
    needs_questionnaire: '#a0b4c4',
    needs_optimization:  '#a0b4c4',
    awaiting_manager:    '#EF9F27',
    awaiting_client:     '#5DCAA5',
    invested:            '#97C459',
  }
  const color = colorForStage[stage] ?? '#CBCBCB'
  return (
    <span style={{
      fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em',
      padding: '4px 10px', borderRadius: 4,
      background: `${color}22`, color,
      whiteSpace: 'nowrap',
      width: 'fit-content',
      fontWeight: 600,
    }}>{label}</span>
  )
}

// ── Latest-portfolio hook ────────────────────────────────────────────────────
// All manager-side portfolio views need the latest portfolio for an investor.
// This hook loads it (and surfaces loading/error states) without any
// "profile defaults" fallback — if the backend has nothing, the caller shows
// an empty state, not fake weights.

type LatestResult = {
  state: 'idle' | 'loading' | 'ready' | 'none' | 'error'
  portfolio: PortfolioResponse | null
  error: string
  refresh: () => void
}

function useLatestPortfolio(investorId: string | undefined, filter?: (p: PortfolioResponse) => boolean): LatestResult {
  const [state, setState] = useState<LatestResult['state']>('idle')
  const [portfolio, setPortfolio] = useState<PortfolioResponse | null>(null)
  const [error, setError] = useState('')
  const [tick, setTick] = useState(0)

  // Callers pass inline arrow functions for `filter`. A new function identity
  // on every render was re-triggering the effect → fetch restart → setState
  // → re-render → infinite loading. Stash the current filter in a ref and
  // keep the effect dependent only on investorId + tick.
  const filterRef = useRef(filter)
  filterRef.current = filter

  useEffect(() => {
    if (!investorId) return
    let cancelled = false
    setState('loading')
    setError('')
    listPortfolios(investorId)
      .then(list => {
        if (cancelled) return
        const f = filterRef.current
        const candidates = f ? list.filter(f) : list
        if (candidates.length === 0) {
          setPortfolio(null)
          setState('none')
          return
        }
        const latest = [...candidates].sort((a, b) => b.created_at.localeCompare(a.created_at))[0]
        setPortfolio(latest)
        setState('ready')
      })
      .catch(e => {
        if (cancelled) return
        setError(e instanceof ApiError ? e.message : 'Could not load portfolios.')
        setState('error')
      })
    return () => { cancelled = true }
  }, [investorId, tick])

  return { state, portfolio, error, refresh: () => setTick(t => t + 1) }
}

// ── Rationale Panel ──────────────────────────────────────────────────────────

type RationaleProps = {
  investorId?: string
  investorName?: string
}

export function RationalePanel({ investorId, investorName }: RationaleProps) {
  const { state, portfolio, error } = useLatestPortfolio(investorId)
  const [rationale, setRationale] = useState<RationaleResponse | null>(null)
  const [rLoading, setRLoading] = useState(false)
  const [rError, setRError] = useState('')

  useEffect(() => {
    if (!portfolio) return
    let cancelled = false
    setRLoading(true)
    setRError('')
    getRationale(portfolio.id)
      .then(r => { if (!cancelled) setRationale(r) })
      .catch(e => { if (!cancelled) setRError(e instanceof ApiError ? e.message : 'Could not load rationale.') })
      .finally(() => { if (!cancelled) setRLoading(false) })
    return () => { cancelled = true }
  }, [portfolio])

  if (!investorId) return <Empty>Select an investor to see their rationale.</Empty>
  if (state === 'loading' || state === 'idle') return <Empty>Loading…</Empty>
  if (state === 'error') return <ErrorView title="Rationale" error={error} />
  if (state === 'none' || !portfolio) return <Empty>No portfolio for {investorName ?? 'this investor'} yet.</Empty>

  return (
    <div style={{ padding: '2rem', maxWidth: 900 }}>
      <div style={rowBetween}>
        <h1 style={h1}>Rationale</h1>
        <StatusChip status={portfolio.status} />
      </div>
      <p style={muted}>
        Explanation for {investorName ?? 'the investor'} · portfolio {portfolio.id.slice(0, 8)}… ·
        snapshot {localDate(portfolio.created_at)}
      </p>

      {rLoading && <Empty>Loading rationale…</Empty>}
      {rError && <ErrorView title="Rationale" error={rError} />}
      {rationale && (
        <div style={{ ...panel, marginTop: '1.5rem' }}>
          <p style={{ fontSize: 14, color: '#FFFFE3', lineHeight: 1.7, marginBottom: 18 }}>{rationale.summary}</p>

          <Section title="Profile">
            {rationale.profile.map((p, i) => <Bullet key={i}>{p}</Bullet>)}
          </Section>

          <Section title="Rules applied">
            {rationale.rules.map((r, i) => <Bullet key={i}>{r}</Bullet>)}
          </Section>

          {rationale.binding.length > 0 && (
            <Section title="Binding constraints">
              {rationale.binding.map((b, i) => <Bullet key={i}>{b}</Bullet>)}
            </Section>
          )}

          {rationale.contributions.length > 0 && (
            <Section title="Contributions to return & risk">
              <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr 1fr 1fr', gap: 8, fontSize: 12, color: '#CBCBCB', marginBottom: 6 }}>
                <span>Ticker</span><span style={{ textAlign: 'right' }}>Weight</span><span style={{ textAlign: 'right' }}>Return share</span><span style={{ textAlign: 'right' }}>Risk share</span>
              </div>
              {rationale.contributions.map(c => (
                <div key={c.ticker} style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr 1fr 1fr', gap: 8, fontSize: 12, color: '#FFFFE3', padding: '4px 0', borderBottom: '0.5px solid rgba(203,203,203,0.08)' }}>
                  <span style={mono}>{c.ticker}</span>
                  <span style={{ ...mono, textAlign: 'right' }}>{toPercent(c.weight).toFixed(1)}%</span>
                  <span style={{ ...mono, textAlign: 'right' }}>{toPercent(c.return_contribution).toFixed(2)}%</span>
                  <span style={{ ...mono, textAlign: 'right' }}>{toPercent(c.risk_share).toFixed(1)}%</span>
                </div>
              ))}
            </Section>
          )}

          {rationale.notes.length > 0 && (
            <Section title="Notes">
              {rationale.notes.map((n, i) => <Bullet key={i}>{n}</Bullet>)}
            </Section>
          )}

          <p style={{ fontSize: 10, color: '#6D8196', marginTop: 24, fontStyle: 'italic' }}>{rationale.disclaimer}</p>
        </div>
      )}
    </div>
  )
}

// ── Proposal Report ──────────────────────────────────────────────────────────

type ProposalReportProps = {
  investorId?: string
  investorName?: string
}

// A proposal is for the client, so it exists only once the manager has
// approved the portfolio (PRD 5.9): approved, or already accepted.
const proposalFilter = (p: PortfolioResponse) => p.status === 'approved' || p.status === 'accepted'

export function ProposalReport({ investorId, investorName }: ProposalReportProps) {
  const printRef = useRef<HTMLDivElement>(null)
  const { state, portfolio, error } = useLatestPortfolio(investorId, proposalFilter)
  const [rationale, setRationale] = useState<RationaleResponse | null>(null)
  const [decisions, setDecisions] = useState<PortfolioDecisionResponse[]>([])
  const [auxError, setAuxError] = useState('')

  useEffect(() => {
    if (!portfolio) return
    let cancelled = false
    Promise.all([getRationale(portfolio.id), getDecisions(portfolio.id)])
      .then(([r, d]) => { if (!cancelled) { setRationale(r); setDecisions(d) } })
      .catch(e => { if (!cancelled) setAuxError(e instanceof ApiError ? e.message : 'Could not load proposal data.') })
    return () => { cancelled = true }
  }, [portfolio])

  function download() {
    const el = printRef.current
    if (!el) return
    const html = el.innerHTML
    const win = window.open('', '_blank', 'width=900,height=1000')
    if (!win) return
    win.document.write(`<!doctype html><html><head><title>Proposal — ${investorName ?? 'investor'}</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; padding: 40px; color: #222; }
        h1 { font-size: 22px; margin-bottom: 4px; }
        h2 { font-size: 14px; text-transform: uppercase; letter-spacing: 0.08em; color: #666; margin: 24px 0 8px; }
        table { width: 100%; border-collapse: collapse; font-size: 13px; }
        th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #eee; }
        th { color: #666; font-weight: 500; text-transform: uppercase; font-size: 11px; letter-spacing: 0.08em; }
        p { font-size: 13px; line-height: 1.6; }
        .muted { color: #666; }
      </style></head><body>${html}</body></html>`)
    win.document.close()
    win.focus()
    setTimeout(() => win.print(), 400)
  }

  if (!investorId) return <Empty>Select an investor to prepare a proposal.</Empty>
  if (state === 'loading' || state === 'idle') return <Empty>Loading…</Empty>
  if (state === 'error') return <ErrorView title="Proposal" error={error} />
  if (state === 'none' || !portfolio) return <Empty>No approved portfolio for {investorName ?? 'this investor'} yet. A proposal can be prepared once the manager approves one.</Empty>

  return (
    <div style={{ padding: '2rem', maxWidth: 900 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <h1 style={h1}>Proposal</h1>
            <StatusChip status={portfolio.status} />
          </div>
          <p style={{ ...muted, marginTop: 4 }}>
            Snapshot {localDate(portfolio.created_at)} · one-click PDF download.
          </p>
        </div>
        <button onClick={download} style={btnPrimary}>Download PDF</button>
      </div>

      {auxError && <ErrorView title="Proposal data" error={auxError} />}

      <div ref={printRef} style={{ background: '#FFFFE3', color: '#4A4A4A', borderRadius: 12, padding: '2rem' }}>
        <h1 style={{ fontSize: 22, marginBottom: 4 }}>Portfolio Proposal</h1>
        <p style={{ fontSize: 13, color: '#666' }}>
          {investorName ?? 'Investor'} · prepared {localDate(portfolio.created_at)} ·
          snapshot <span style={{ fontFamily: 'monospace' }}>{portfolio.snapshot_id.slice(0, 8)}…</span>
        </p>

        <h2 style={sectionHead}>Recommended Allocation</h2>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr>
              <th style={th}>Ticker</th>
              <th style={th}>Name</th>
              <th style={th}>Category</th>
              <th style={{ ...th, textAlign: 'right' }}>Weight</th>
            </tr>
          </thead>
          <tbody>
            {ETFS.map(e => {
              const w = toPercent(portfolio.weights[e.ticker] ?? 0)
              return (
                <tr key={e.ticker}>
                  <td style={{ ...td, fontFamily: 'monospace' }}>{e.ticker}</td>
                  <td style={td}>{e.label}</td>
                  <td style={{ ...td, color: '#666', textTransform: 'capitalize' }}>{e.category}</td>
                  <td style={{ ...td, textAlign: 'right', fontFamily: 'monospace' }}>{w.toFixed(1)}%</td>
                </tr>
              )
            })}
          </tbody>
        </table>

        <h2 style={sectionHead}>Key Metrics</h2>
        <p style={{ fontSize: 13, lineHeight: 1.6 }}>
          Expected annual return {toPercent(portfolio.expected_return).toFixed(2)}% ·
          Volatility {toPercent(portfolio.volatility).toFixed(2)}% ·
          Sharpe {portfolio.sharpe.toFixed(2)} ·
          Risk-free {toPercent(portfolio.risk_free_rate).toFixed(2)}% ·
          Objective {formatObjective(portfolio.objective_used)}.
        </p>

        {portfolio.binding.length > 0 && (
          <>
            <h2 style={sectionHead}>Binding constraints</h2>
            <p style={{ fontSize: 13, lineHeight: 1.6 }}>{portfolio.binding.join(' · ')}</p>
          </>
        )}

        {(portfolio.excluded_sectors.length > 0 || portfolio.unmatched_exclusions.length > 0) && (
          <>
            <h2 style={sectionHead}>Sector exclusions</h2>
            {portfolio.excluded_sectors.length > 0 && (
              <p style={{ fontSize: 13 }}>Applied: {portfolio.excluded_sectors.join(', ')}</p>
            )}
            {portfolio.unmatched_exclusions.length > 0 && (
              <p style={{ fontSize: 13, color: '#8a6d1a' }}>
                Unmatched (not in the 8-ETF universe): {portfolio.unmatched_exclusions.join(', ')}
              </p>
            )}
          </>
        )}

        {rationale && (
          <>
            <h2 style={sectionHead}>Rationale</h2>
            {/* The backend's rationale.text is the full narrative and already
                includes the summary line at the top; only fall back to
                rationale.summary if text is empty, otherwise we print it twice. */}
            {rationale.text ? (
              <pre style={{ fontFamily: 'inherit', whiteSpace: 'pre-wrap', fontSize: 13, lineHeight: 1.6 }}>{rationale.text}</pre>
            ) : (
              <p style={{ fontSize: 13, lineHeight: 1.6 }}>{rationale.summary}</p>
            )}
          </>
        )}

        <h2 style={sectionHead}>Audit trail</h2>
        {decisions.length === 0 ? (
          <p style={{ fontSize: 13, color: '#666' }}>No decisions recorded yet.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <tbody>
              {decisions.map(d => (
                <tr key={d.id}>
                  <td style={{ ...td, color: '#666', fontFamily: 'monospace', fontSize: 12, width: 180 }}>{localTime(d.timestamp)}</td>
                  <td style={{ ...td, width: 140 }}>{d.actor}</td>
                  <td style={td}>
                    {d.decision}
                    {d.amount != null && <> · ₹{d.amount.toLocaleString('en-IN')}</>}
                    {d.reason && <> · {d.reason}</>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* rationale.text already contains the disclaimer as its tail — no
            separate render needed, otherwise it shows up twice (once at the
            end of the rationale block, once after the audit trail). */}
      </div>
    </div>
  )
}

// ── Drift Alerts ─────────────────────────────────────────────────────────────

type DriftAlertsProps = { onOpen: (id: string) => void }

export function DriftAlerts({ onOpen }: DriftAlertsProps) {
  const [alerts, setAlerts] = useState<ValuationResponse[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    getDriftAlerts()
      .then(a => { if (!cancelled) setAlerts(a) })
      .catch(e => { if (!cancelled) setError(e instanceof ApiError ? e.message : 'Could not load drift alerts.') })
    return () => { cancelled = true }
  }, [])

  return (
    <div style={{ padding: '2rem', maxWidth: 1100 }}>
      <h1 style={h1}>Drift Alerts</h1>
      <p style={muted}>Accepted portfolios whose any-holding drift exceeds the configured threshold.</p>

      {error && <ErrorView title="Drift alerts" error={error} />}

      <div style={{ ...panel, padding: 0, marginTop: '1.5rem' }}>
        {alerts === null && !error ? (
          <p style={{ padding: '1.5rem', fontSize: 13, color: '#CBCBCB' }}>Loading…</p>
        ) : alerts && alerts.length === 0 ? (
          <p style={{ padding: '1.5rem', fontSize: 13, color: '#CBCBCB' }}>No portfolios are breaching the drift threshold.</p>
        ) : (
          <>
            <div style={{
              display: 'grid', gridTemplateColumns: '1.6fr 1fr 1fr 2fr auto',
              padding: '10px 16px', gap: 12,
              borderBottom: '0.5px solid rgba(203,203,203,0.15)',
              fontSize: 11, color: '#CBCBCB', textTransform: 'uppercase', letterSpacing: '0.08em',
            }}>
              <span>Portfolio</span><span>Value</span><span>Gain</span><span>Breached holdings</span><span />
            </div>
            {alerts?.map(v => {
              const breached = v.holdings.filter(h => h.breached)
              return (
                <div key={v.portfolio_id} style={{
                  display: 'grid', gridTemplateColumns: '1.6fr 1fr 1fr 2fr auto',
                  padding: '12px 16px', gap: 12, alignItems: 'center',
                  borderBottom: '0.5px solid rgba(203,203,203,0.08)',
                  fontSize: 13,
                }}>
                  <span style={{ color: '#FFFFE3', ...mono }}>{v.portfolio_id.slice(0, 8)}…</span>
                  <span style={{ ...mono, color: '#FFFFE3' }}>₹{v.current_value.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
                  <span style={{ ...mono, color: v.gain >= 0 ? '#97C459' : '#F09595' }}>
                    {v.gain >= 0 ? '+' : ''}{toPercent(v.gain_pct).toFixed(2)}%
                  </span>
                  <span style={{ fontSize: 12, color: '#CBCBCB' }}>
                    {breached.map(h => `${h.ticker} ${(toPercent(h.drift) >= 0 ? '+' : '')}${toPercent(h.drift).toFixed(1)}%`).join(' · ') || 'None flagged'}
                  </span>
                  <button onClick={() => onOpen(v.investor_id)} style={btnGhost}>Review</button>
                </div>
              )
            })}
          </>
        )}
      </div>
    </div>
  )
}

// ── Audit Log ────────────────────────────────────────────────────────────────

export function AuditLog({ investors }: { investors: Investor[] }) {
  const [entries, setEntries] = useState<AuditLogResponse[] | null>(null)
  const [error, setError] = useState('')
  // Portfolio → investor map so portfolio events can be labelled with the
  // investor's name instead of a raw portfolio id fragment.
  const [portfolioOwner, setPortfolioOwner] = useState<Map<string, string>>(new Map())

  useEffect(() => {
    let cancelled = false
    getAuditLog({ limit: 200 })
      .then(e => { if (!cancelled) setEntries(e) })
      .catch(e => { if (!cancelled) setError(e instanceof ApiError ? e.message : 'Could not load the audit log.') })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (investors.length === 0) return
    let cancelled = false
    Promise.all(investors.map(inv => listPortfolios(inv.id).catch(() => [] as PortfolioResponse[])))
      .then(lists => {
        if (cancelled) return
        const m = new Map<string, string>()
        investors.forEach((inv, i) => {
          for (const p of lists[i]) m.set(p.id, inv.id)
        })
        setPortfolioOwner(m)
      })
    return () => { cancelled = true }
  }, [investors])

  const investorNameById = useMemo(() => {
    const m = new Map<string, string>()
    for (const inv of investors) m.set(inv.id, inv.name)
    return m
  }, [investors])

  function describe(e: AuditLogResponse): string {
    if (e.entity_type === 'investor') {
      return investorNameById.get(e.entity_id) ?? `Investor ${e.entity_id.slice(0, 8)}…`
    }
    if (e.entity_type === 'portfolio') {
      const ownerId = portfolioOwner.get(e.entity_id)
      const ownerName = ownerId ? investorNameById.get(ownerId) : undefined
      const short = `Portfolio ${e.entity_id.slice(0, 8)}…`
      return ownerName ? `${ownerName} · ${short}` : short
    }
    return `${e.entity_type} ${e.entity_id.slice(0, 8)}…`
  }

  return (
    <div style={{ padding: '2rem', maxWidth: 1100 }}>
      <h1 style={h1}>Audit Log</h1>
      <p style={muted}>Every write to investors and portfolios — captured by the backend.</p>

      {error && <ErrorView title="Audit log" error={error} />}

      <div style={{ ...panel, padding: 0, marginTop: '1.5rem' }}>
        {entries === null && !error ? (
          <p style={{ padding: '1.5rem', fontSize: 13, color: '#CBCBCB' }}>Loading…</p>
        ) : entries && entries.length === 0 ? (
          <p style={{ padding: '1.5rem', fontSize: 13, color: '#CBCBCB' }}>No audit entries yet.</p>
        ) : (
          <>
            <div style={{
              display: 'grid', gridTemplateColumns: '180px 140px 1fr 1fr',
              padding: '10px 16px', gap: 12,
              borderBottom: '0.5px solid rgba(203,203,203,0.15)',
              fontSize: 11, color: '#CBCBCB', textTransform: 'uppercase', letterSpacing: '0.08em',
            }}>
              <span>When</span><span>By</span><span>Action</span><span>Target</span>
            </div>
            {entries?.map(e => (
              <div key={e.id} style={{
                display: 'grid', gridTemplateColumns: '180px 140px 1fr 1fr',
                padding: '10px 16px', gap: 12,
                borderBottom: '0.5px solid rgba(203,203,203,0.08)',
                fontSize: 12,
              }}>
                <span style={{ color: '#6D8196', ...mono }}>{localTime(e.timestamp)}</span>
                <span style={{ color: '#a0b4c4' }}>{e.user_id ?? 'system'}</span>
                <span style={{ color: '#FFFFE3', ...mono }}>{e.action}</span>
                <span style={{ color: '#CBCBCB' }}>{describe(e)}{e.reason && <> · {e.reason}</>}</span>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  )
}

// ── Investor Portal (accepted-only) ──────────────────────────────────────────

// Investor portal is "accepted only" per the spec: show the portfolio the
// client has signed off on, not the intermediate approved-but-unsigned one.
const acceptedFilter = (p: PortfolioResponse) => p.status === 'accepted'

export function InvestorPortalView({ investor }: { investor?: Investor | null }) {
  const { state, portfolio, error } = useLatestPortfolio(investor?.id, acceptedFilter)
  const [rationale, setRationale] = useState<RationaleResponse | null>(null)
  const [valuation, setValuation] = useState<ValuationResponse | null>(null)
  const [valuationError, setValuationError] = useState('')

  useEffect(() => {
    if (!portfolio) return
    let cancelled = false
    getRationale(portfolio.id).then(r => { if (!cancelled) setRationale(r) }).catch(() => {})
    if (portfolio.status === 'accepted') {
      getValuation(portfolio.id)
        .then(v => { if (!cancelled) setValuation(v) })
        .catch(e => { if (!cancelled) setValuationError(e instanceof ApiError ? e.message : 'Could not load valuation.') })
    }
    return () => { cancelled = true }
  }, [portfolio])

  if (!investor) return <Empty>No investor selected.</Empty>
  if (state === 'loading' || state === 'idle') return <Empty>Loading portfolio…</Empty>
  if (state === 'error') return <ErrorView title="Investor portal" error={error} />
  if (state === 'none' || !portfolio) {
    return <Empty>{investor.name} has not accepted a portfolio yet.</Empty>
  }

  return (
    <div style={{ padding: '2rem', maxWidth: 1000 }}>
      <div style={rowBetween}>
        <h1 style={h1}>Investor Portal</h1>
        <StatusChip status={portfolio.status} />
      </div>
      <p style={muted}>
        Read-only view for {investor.name}. Portfolio snapshot {localDate(portfolio.created_at)}.
      </p>

      {valuation && (
        <div style={{ ...panel, marginTop: '1.25rem', marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <p style={panelTitle}>Valuation · data as of {localDate(valuation.as_of_date)}</p>
            {valuation.hypothetical && (
              <span style={{ fontSize: 10, color: '#EF9F27', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Hypothetical</span>
            )}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
            <MetricBlock label="Amount invested" value={'₹' + valuation.amount.toLocaleString('en-IN', { maximumFractionDigits: 0 })} />
            <MetricBlock label="Current value" value={'₹' + valuation.current_value.toLocaleString('en-IN', { maximumFractionDigits: 0 })} />
            <MetricBlock
              label="Gain"
              value={(valuation.gain >= 0 ? '+' : '') + '₹' + Math.round(valuation.gain).toLocaleString('en-IN')}
              positive={valuation.gain >= 0}
            />
            <MetricBlock
              label="Gain %"
              value={(valuation.gain_pct >= 0 ? '+' : '') + toPercent(valuation.gain_pct).toFixed(2) + '%'}
              positive={valuation.gain_pct >= 0}
            />
          </div>
          {valuation.rebalancing_suggested && (
            <p style={{ marginTop: 10, fontSize: 12, color: '#EF9F27' }}>
              A holding has drifted past {toPercent(valuation.drift_threshold).toFixed(0)}% — rebalancing is suggested.
            </p>
          )}
        </div>
      )}
      {valuationError && <ErrorView title="Valuation" error={valuationError} />}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
        <div style={panel}>
          <p style={panelTitle}>Latest allocation</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {ETFS.map(a => {
              const w = toPercent(portfolio.weights[a.ticker] ?? 0)
              return (
                <div key={a.ticker}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
                    <span style={{ color: '#FFFFE3' }}>
                      <span style={{ ...mono, color: '#a0b4c4' }}>{a.ticker}</span>
                      <span style={{ color: '#CBCBCB' }}> · {a.label}</span>
                    </span>
                    <span style={{ ...mono, color: '#CBCBCB' }}>{w.toFixed(1)}%</span>
                  </div>
                  <div style={{ height: 4, background: 'rgba(255,255,255,0.08)', borderRadius: 2, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: w + '%', background: a.color }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        <div style={panel}>
          <p style={panelTitle}>Key metrics</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <MetricBlock label="Expected return" value={toPercent(portfolio.expected_return).toFixed(2) + '%'} />
            <MetricBlock label="Volatility" value={toPercent(portfolio.volatility).toFixed(2) + '%'} />
            <MetricBlock label="Sharpe" value={portfolio.sharpe.toFixed(2)} />
            <MetricBlock label="Objective" value={formatObjective(portfolio.objective_used)} />
          </div>
        </div>
      </div>

      {rationale && (
        <div style={panel}>
          <p style={panelTitle}>Why this allocation</p>
          <p style={{ fontSize: 13, color: '#FFFFE3', lineHeight: 1.7 }}>{rationale.summary}</p>
          {rationale.binding.length > 0 && (
            <p style={{ fontSize: 12, color: '#CBCBCB', marginTop: 10 }}>
              <strong style={{ color: '#a0b4c4' }}>Binding:</strong> {rationale.binding.join(' · ')}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

// ── Client Sign-Off panel ───────────────────────────────────────────────────

type ClientSignOffProps = {
  investorId?: string
  investorName?: string
  onDecided?: () => void
}

export function ClientSignOffPanel({ investorId, investorName, onDecided }: ClientSignOffProps) {
  const { state, portfolio, error, refresh } = useLatestPortfolio(
    investorId,
    (p: PortfolioResponse) => p.status === 'approved'
  )
  const [amount, setAmount] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [done, setDone] = useState<'accepted' | 'declined' | null>(null)

  async function record(decision: 'accepted' | 'declined') {
    if (!portfolio) return
    setSaving(true)
    setSaveError('')
    try {
      await clientDecision(portfolio.id, {
        decision,
        recorded_by: 'manager-001',
        notes: notes.trim() || null,
        amount: decision === 'accepted' && amount ? Number(amount) : null,
      })
      setDone(decision)
      onDecided?.()
      refresh()
    } catch (e) {
      setSaveError(e instanceof ApiError ? e.message : 'Could not save the client decision.')
    } finally {
      setSaving(false)
    }
  }

  if (!investorId) return <Empty>Select an investor.</Empty>
  if (state === 'loading' || state === 'idle') return <Empty>Loading…</Empty>
  if (state === 'error') return <ErrorView title="Client sign-off" error={error} />
  if (state === 'none' || !portfolio) {
    return <Empty>{investorName ?? 'This investor'} has no approved portfolio awaiting client sign-off.</Empty>
  }

  if (done) {
    return (
      <div style={{ padding: '2rem', maxWidth: 600 }}>
        <h1 style={h1}>Client sign-off</h1>
        <div style={{ ...panel, marginTop: 16, borderColor: done === 'accepted' ? 'rgba(151,196,89,0.35)' : 'rgba(240,149,149,0.35)' }}>
          <p style={{ fontSize: 14, color: done === 'accepted' ? '#97C459' : '#F09595', fontWeight: 600, marginBottom: 6 }}>
            Recorded: client {done}
          </p>
          <p style={muted}>Investor: {investorName ?? '—'} · portfolio {portfolio.id.slice(0, 8)}…</p>
        </div>
      </div>
    )
  }

  return (
    <div style={{ padding: '2rem', maxWidth: 720 }}>
      <div style={rowBetween}>
        <h1 style={h1}>Client sign-off</h1>
        <StatusChip status={portfolio.status} />
      </div>
      <p style={muted}>Record whether {investorName ?? 'the client'} accepts or declines the approved proposal.</p>

      <div style={{ ...panel, marginTop: 16 }}>
        <p style={panelTitle}>Approved allocation · snapshot {localDate(portfolio.created_at)}</p>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <tbody>
            {ETFS.map(a => {
              const w = toPercent(portfolio.weights[a.ticker] ?? 0)
              if (w === 0) return null
              return (
                <tr key={a.ticker}>
                  <td style={{ padding: '4px 0', ...mono, color: '#a0b4c4' }}>{a.ticker}</td>
                  <td style={{ padding: '4px 0', color: '#CBCBCB' }}>{a.label}</td>
                  <td style={{ padding: '4px 0', textAlign: 'right', ...mono, color: '#FFFFE3' }}>{w.toFixed(1)}%</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div style={{ ...panel, marginTop: 12 }}>
        <p style={panelTitle}>Decision</p>
        <label style={{ display: 'block', marginBottom: 10 }}>
          <span style={{ fontSize: 11, color: '#CBCBCB', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Amount (₹) — required to accept</span>
          <input
            type="number" min={0} inputMode="numeric"
            value={amount} onChange={e => setAmount(e.target.value)}
            placeholder="e.g. 500000"
            disabled={saving}
            style={{
              display: 'block', width: '100%', marginTop: 4,
              background: 'rgba(255,255,255,0.06)', color: '#FFFFE3',
              border: '1px solid rgba(203,203,203,0.2)', borderRadius: 6,
              padding: '8px 10px', fontSize: 13, outline: 'none',
            }}
          />
        </label>
        <label style={{ display: 'block', marginBottom: 10 }}>
          <span style={{ fontSize: 11, color: '#CBCBCB', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Notes (optional)</span>
          <textarea
            value={notes} onChange={e => setNotes(e.target.value)}
            rows={2} disabled={saving}
            placeholder="Any context from the client call…"
            style={{
              display: 'block', width: '100%', marginTop: 4, resize: 'vertical',
              background: 'rgba(255,255,255,0.06)', color: '#FFFFE3',
              border: '1px solid rgba(203,203,203,0.2)', borderRadius: 6,
              padding: '8px 10px', fontSize: 13, outline: 'none',
            }}
          />
        </label>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => record('accepted')}
            disabled={saving || !amount}
            style={btnApprove(saving || !amount)}
          >
            {saving ? 'Saving…' : 'Client accepted'}
          </button>
          <button
            onClick={() => record('declined')}
            disabled={saving}
            style={btnReject(saving)}
          >
            {saving ? 'Saving…' : 'Client declined'}
          </button>
        </div>
        {saveError && <p style={{ marginTop: 10, color: '#F09595', fontSize: 12 }}>{saveError}</p>}
      </div>
    </div>
  )
}

// Converts the backend's programmatic objective key into human prose.
function formatObjective(key: string): string {
  const map: Record<string, string> = {
    max_sharpe: 'Maximum Sharpe ratio',
    min_volatility: 'Minimum volatility',
    efficient_return: 'Target return',
    efficient_risk: 'Target risk',
  }
  return map[key] ?? key.replace(/_/g, ' ')
}

// ── shared bits ──────────────────────────────────────────────────────────────

function MetricBlock({ label, value, positive }: { label: string; value: string; positive?: boolean }) {
  return (
    <div>
      <p style={{ fontSize: 10, color: '#CBCBCB', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</p>
      <p style={{ fontSize: 20, color: positive ? '#97C459' : '#FFFFE3', fontFamily: 'monospace' }}>{value}</p>
    </div>
  )
}

function StatusChip({ status }: { status: string }) {
  const color = status === 'approved' ? '#97C459'
    : status === 'rejected' ? '#F09595'
    : status === 'accepted' ? '#6D8196'
    : status === 'declined' ? '#F09595'
    : '#EF9F27'
  return (
    <span style={{
      fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em',
      padding: '4px 8px', borderRadius: 4,
      background: `${color}22`, color,
    }}>{status}</span>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <p style={{ fontSize: 11, color: '#6D8196', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>{title}</p>
      {children}
    </div>
  )
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ fontSize: 13, color: '#FFFFE3', lineHeight: 1.6, paddingLeft: 14, position: 'relative', marginBottom: 4 }}>
      <span style={{ position: 'absolute', left: 0, color: '#6D8196' }}>•</span>
      {children}
    </p>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div style={{ padding: '3rem', color: '#CBCBCB', fontSize: 14 }}>{children}</div>
}

function ErrorView({ title, error }: { title: string; error: string }) {
  return (
    <div style={{
      background: 'rgba(240,149,149,0.08)',
      border: '0.5px solid rgba(240,149,149,0.35)',
      borderRadius: 10, padding: '14px 16px', margin: '16px 0',
      fontFamily: 'var(--font-body)',
    }}>
      <p style={{ fontSize: 11, color: '#F09595', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>{title}</p>
      <p style={{ fontSize: 13, color: '#FFFFE3' }}>{error}</p>
    </div>
  )
}

// shared aggregation export (re-export so other files only need etfs import where needed)
export { aggregateByCategory }

// ---------- styles ----------
const h1 = { fontSize: 22, fontWeight: 500, color: '#FFFFE3', marginBottom: 4 } as const
const muted = { fontSize: 13, color: '#CBCBCB' } as const
const mono = { fontFamily: 'monospace' as const }
const rowBetween = { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } as const
const panel = {
  background: 'rgba(255,255,227,0.06)',
  border: '0.5px solid rgba(203,203,203,0.15)',
  borderRadius: 12, padding: '1.25rem',
} as const
const panelTitle = {
  fontSize: 12, color: '#CBCBCB', textTransform: 'uppercase' as const,
  letterSpacing: '0.06em', marginBottom: 12,
} as const

const th = { textAlign: 'left' as const, padding: '8px 10px', borderBottom: '1px solid #ddd', color: '#666', fontSize: 11, textTransform: 'uppercase' as const, letterSpacing: '0.08em', fontWeight: 500 }
const td = { padding: '8px 10px', borderBottom: '1px solid #eee' }
const sectionHead = { fontSize: 12, textTransform: 'uppercase' as const, letterSpacing: '0.08em', color: '#666', margin: '24px 0 8px' }

const btnPrimary = {
  padding: '8px 14px', fontSize: 12, fontWeight: 600, borderRadius: 6, border: 'none',
  background: '#FFFFE3', color: '#4A4A4A', cursor: 'pointer',
} as const

const btnGhost = {
  padding: '7px 12px', fontSize: 12, borderRadius: 6,
  background: 'transparent', border: '1px solid rgba(203,203,203,0.3)',
  color: '#FFFFE3', cursor: 'pointer',
} as const

const btnApprove = (disabled: boolean) => ({
  flex: 1, padding: '10px 12px', fontSize: 12, borderRadius: 6, border: 'none',
  background: disabled ? 'rgba(255,255,255,0.1)' : '#97C459',
  color: disabled ? 'rgba(255,255,255,0.3)' : '#1c2a10',
  fontWeight: 600, cursor: disabled ? 'not-allowed' : 'pointer',
}) as const

const btnReject = (disabled: boolean) => ({
  flex: 1, padding: '10px 12px', fontSize: 12, borderRadius: 6, border: 'none',
  background: disabled ? 'rgba(255,255,255,0.1)' : '#F09595',
  color: disabled ? 'rgba(255,255,255,0.3)' : '#2a1010',
  fontWeight: 600, cursor: disabled ? 'not-allowed' : 'pointer',
}) as const
