'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ETFS } from '@/lib/etfs'
import {
  ApiError, localDate, toPercent, fromPercent,
  listPortfolios, optimize, computeMetrics, adjustPortfolio, managerDecision,
  type PortfolioResponse, type MetricsResponse,
} from '@/lib/api'

type Props = {
  investorId?: string
  investorName?: string
  riskProfile?: string
  onDecision?: (portfolio: PortfolioResponse) => void
}

// All numeric weights inside this component are PERCENTAGES (0–100) for
// easier UI math. The api helpers do decimal↔percent conversion at the
// edge via toPercent / fromPercent.

export default function ReviewCustomization({
  investorId,
  investorName,
  riskProfile,
  onDecision,
}: Props) {
  const [portfolio, setPortfolio] = useState<PortfolioResponse | null>(null)
  const [weights, setWeights] = useState<Record<string, number>>({})
  const [loadError, setLoadError] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [running, setRunning] = useState(false)

  const [metrics, setMetrics] = useState<MetricsResponse | null>(null)
  const [metricsError, setMetricsError] = useState<string>('')
  const [metricsLoading, setMetricsLoading] = useState(false)

  const [savingAdjust, setSavingAdjust] = useState(false)
  const [adjustError, setAdjustError] = useState('')
  const [adjustViolations, setAdjustViolations] = useState<string[]>([])
  const [adjustReason, setAdjustReason] = useState('')
  const [deciding, setDeciding] = useState(false)
  const [decisionError, setDecisionError] = useState('')
  const [rejectReason, setRejectReason] = useState('')

  // Load the most recent portfolio for the investor on mount / id change.
  useEffect(() => {
    if (!investorId) return
    let cancelled = false
    setLoading(true)
    setLoadError('')
    setPortfolio(null)
    listPortfolios(investorId)
      .then(list => {
        if (cancelled) return
        if (list.length === 0) {
          setPortfolio(null)
          return
        }
        // backend doesn't guarantee order; take the newest by created_at
        const latest = [...list].sort((a, b) => b.created_at.localeCompare(a.created_at))[0]
        hydrate(latest)
      })
      .catch(e => { if (!cancelled) setLoadError(formatError(e, 'load portfolios')) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [investorId])

  function hydrate(p: PortfolioResponse) {
    setPortfolio(p)
    const asPct: Record<string, number> = {}
    for (const t of ETFS.map(e => e.ticker)) asPct[t] = toPercent(p.weights[t] ?? 0)
    setWeights(asPct)
    setMetrics(null)
    setMetricsError('')
    setAdjustError('')
    setAdjustViolations([])
    setAdjustReason('')
    setDecisionError('')
  }

  // Dirty detector: true when the on-screen weights differ from what the
  // backend has stored on the portfolio. Prevents Approve from applying
  // to stale saved weights while the sliders show something else.
  const dirty = useMemo(() => {
    if (!portfolio) return false
    for (const t of ETFS.map(e => e.ticker)) {
      const onScreen = Math.round((weights[t] ?? 0) * 100)
      const saved = Math.round(toPercent(portfolio.weights[t] ?? 0) * 100)
      if (onScreen !== saved) return true
    }
    return false
  }, [weights, portfolio])

  // Re-run /optimize/metrics whenever weights change (debounced 400ms).
  const runMetrics = useCallback(async (w: Record<string, number>) => {
    if (!portfolio) return
    setMetricsLoading(true)
    setMetricsError('')
    try {
      const body = {
        investor_id: portfolio.investor_id,
        snapshot_id: portfolio.snapshot_id,
        weights: Object.fromEntries(
          Object.entries(w).map(([k, v]) => [k, fromPercent(v)])
        ),
      }
      const m = await computeMetrics(body)
      setMetrics(m)
    } catch (e) {
      setMetricsError(formatError(e, 'compute metrics'))
      setMetrics(null)
    } finally {
      setMetricsLoading(false)
    }
  }, [portfolio])

  useEffect(() => {
    if (!portfolio) return
    const t = setTimeout(() => { runMetrics(weights) }, 400)
    return () => clearTimeout(t)
  }, [weights, portfolio, runMetrics])

  async function runOptimize() {
    if (!investorId) return
    setRunning(true)
    setLoadError('')
    try {
      const p = await optimize({ investor_id: investorId, requested_by: 'manager-001' })
      hydrate(p)
    } catch (e) {
      setLoadError(formatError(e, 'run optimization'))
    } finally {
      setRunning(false)
    }
  }

  async function saveAdjust() {
    if (!portfolio) return
    if (!adjustReason.trim()) {
      setAdjustError('Please provide a reason for this adjustment.')
      return
    }
    setSavingAdjust(true)
    setAdjustError('')
    setAdjustViolations([])
    try {
      const body = {
        weights: Object.fromEntries(
          Object.entries(weights).map(([k, v]) => [k, fromPercent(v)])
        ),
        adjusted_by: 'manager-001',
        reason: adjustReason.trim(),
      }
      const p = await adjustPortfolio(portfolio.id, body)
      hydrate(p)
    } catch (e) {
      // Backend rejects out-of-policy weights with 422 and a structured
      // detail: { message, violations: [...] }. Surface the violations
      // instead of a bare "HTTP 422".
      if (e instanceof ApiError && e.detail && typeof e.detail === 'object') {
        const d = e.detail as { message?: string; violations?: string[] }
        if (Array.isArray(d.violations) && d.violations.length > 0) {
          setAdjustError(d.message ?? 'Adjustment was refused by the backend.')
          setAdjustViolations(d.violations)
        } else {
          setAdjustError(formatError(e, 'save adjustment'))
        }
      } else {
        setAdjustError(formatError(e, 'save adjustment'))
      }
    } finally {
      setSavingAdjust(false)
    }
  }

  async function decide(decision: 'approved' | 'rejected') {
    if (!portfolio) return
    if (decision === 'rejected' && !rejectReason.trim()) {
      setDecisionError('Please provide a reason for rejection.')
      return
    }
    setDeciding(true)
    setDecisionError('')
    try {
      const p = await managerDecision(portfolio.id, {
        decision,
        decided_by: 'manager-001',
        reason: decision === 'rejected' ? rejectReason.trim() : null,
      })
      hydrate(p)
      onDecision?.(p)
    } catch (e) {
      setDecisionError(formatError(e, 'record decision'))
    } finally {
      setDeciding(false)
    }
  }

  const total = useMemo(
    () => ETFS.reduce((s, a) => s + (weights[a.ticker] ?? 0), 0),
    [weights]
  )
  const violations = metrics?.violations ?? []
  // Approve must only act on the weights actually persisted on the portfolio.
  // If the sliders have moved since the last save (`dirty`), force a Save
  // Adjusted Weights first — otherwise an approval would silently apply to
  // stale weights instead of what the manager sees on screen.
  const canApprove = !!portfolio && !dirty && violations.length === 0 && Math.round(total) === 100 && portfolio.status === 'proposed'

  if (!investorId) {
    return <Empty>Select an investor to review their portfolio.</Empty>
  }

  if (loading) {
    return <Empty>Loading portfolios for {investorName ?? 'this investor'}…</Empty>
  }

  if (loadError) {
    return (
      <div style={{ padding: '2rem' }}>
        <h1 style={h1}>Review &amp; Customize</h1>
        <ErrorBanner>{loadError}</ErrorBanner>
      </div>
    )
  }

  if (!portfolio) {
    return (
      <div style={{ padding: '2rem', maxWidth: 720 }}>
        <h1 style={h1}>Review &amp; Customize</h1>
        <p style={muted}>No portfolio has been generated for {investorName ?? 'this investor'} yet.</p>
        <button onClick={runOptimize} disabled={running} style={btnPrimary(running)}>
          {running ? 'Running optimizer…' : 'Run optimization'}
        </button>
      </div>
    )
  }

  const decided = portfolio.status !== 'proposed'

  return (
    <div style={{ padding: '2rem', maxWidth: 1100 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, marginBottom: '1.25rem' }}>
        <div>
          <h1 style={h1}>Review &amp; Customize</h1>
          <p style={muted}>
            Portfolio {portfolio.id.slice(0, 8)}… for
            <span style={{ color: '#FFFFE3', marginLeft: 6 }}>{investorName ?? 'investor'}</span>
            {riskProfile && <> · risk profile <span style={mono}>{riskProfile}</span></>}
            {' · '}snapshot {localDate(portfolio.created_at)}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <StatusBadge status={portfolio.status} />
          {/* Stays enabled after a decision. Once a proposal is rejected, declined
              or accepted, running the optimizer again is the only way to get a
              new proposal; disabling it left the investor stuck. */}
          <button onClick={runOptimize} disabled={running} style={btnGhost}>
            {running ? 'Running…' : decided ? 'Run new optimization' : 'Re-run optimizer'}
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 16 }}>
        {/* ── left: editable weights ── */}
        <div style={panel}>
          <p style={panelTitle}>Editable weights · 8 ETF universe</p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {ETFS.map(a => {
              const w = weights[a.ticker] ?? 0
              return (
                <div key={a.ticker}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#FFFFE3' }}>
                      <span style={{ width: 8, height: 8, borderRadius: 2, background: a.color }} />
                      <span style={{ ...mono, fontSize: 12, color: '#a0b4c4' }}>{a.ticker}</span>
                      <span style={{ color: '#CBCBCB', fontSize: 12 }}>· {a.label}</span>
                    </span>
                    <span style={{ fontSize: 12, color: '#CBCBCB', ...mono }}>{w.toFixed(1)}%</span>
                  </div>
                  <input
                    type="range" min={0} max={100} step={0.5} value={w}
                    disabled={decided || savingAdjust}
                    onChange={e => setWeights(prev => ({ ...prev, [a.ticker]: Number(e.target.value) }))}
                    style={{ width: '100%', accentColor: a.color }}
                  />
                </div>
              )
            })}
          </div>

          {!decided && (
            <div style={{ marginTop: 14 }}>
              <label style={{ fontSize: 11, color: '#CBCBCB', textTransform: 'uppercase', letterSpacing: '0.08em', display: 'block', marginBottom: 6 }}>
                Reason for adjustment
              </label>
              <input
                type="text"
                value={adjustReason}
                onChange={e => setAdjustReason(e.target.value)}
                placeholder="Required when saving — the backend records this on the audit trail"
                disabled={savingAdjust}
                style={{
                  width: '100%', padding: '8px 10px', borderRadius: 6,
                  background: 'rgba(255,255,255,0.06)', color: '#FFFFE3',
                  border: '1px solid rgba(203,203,203,0.2)', fontSize: 13,
                  outline: 'none', boxSizing: 'border-box',
                }}
              />
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <button onClick={normalize} disabled={decided} style={btnGhost}>Normalize to 100</button>
            <button
              onClick={saveAdjust}
              disabled={decided || savingAdjust || Math.round(total) !== 100 || !adjustReason.trim()}
              style={btnPrimary(savingAdjust)}
            >
              {savingAdjust ? 'Saving…' : 'Save adjusted weights'}
            </button>
          </div>
          {adjustError && <p style={errText}>{adjustError}</p>}
          {adjustViolations.length > 0 && (
            <ul style={{ marginTop: 8, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 4 }}>
              {adjustViolations.map((v, i) => (
                <li key={i} style={{ fontSize: 12, color: '#FFFFE3', paddingLeft: 12, position: 'relative' }}>
                  <span style={{ position: 'absolute', left: 0, color: '#F09595' }}>•</span>
                  {v}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* ── right: metrics, violations, decision ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={panel}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <p style={{ ...panelTitle, marginBottom: 0 }}>Live metrics</p>
              {metricsLoading && <span style={{ ...mono, fontSize: 10, color: '#6D8196' }}>computing…</span>}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
              <Metric label="Expected return" value={metrics ? `${toPercent(metrics.expected_return).toFixed(2)}%` : '—'} />
              <Metric label="Volatility" value={metrics ? `${toPercent(metrics.volatility).toFixed(2)}%` : '—'} />
              <Metric
                label="Sharpe"
                value={metrics ? metrics.sharpe.toFixed(2) : '—'}
                tone={metrics && metrics.sharpe > 0.5 ? '#97C459' : '#EF9F27'}
              />
            </div>
            <p style={{ marginTop: 10, fontSize: 11, color: '#6D8196' }}>
              Sum of weights: {total.toFixed(1)}% · metrics and violations come from POST /optimize/metrics against snapshot {portfolio.snapshot_id.slice(0, 8)}….
            </p>
            {metricsError && <p style={errText}>{metricsError}</p>}
          </div>

          <div style={{
            background: violations.length ? 'rgba(240,149,149,0.08)' : 'rgba(151,196,89,0.08)',
            border: '0.5px solid ' + (violations.length ? 'rgba(240,149,149,0.35)' : 'rgba(151,196,89,0.35)'),
            borderRadius: 12, padding: '1.25rem',
          }}>
            <p style={{ fontSize: 12, color: violations.length ? '#F09595' : '#97C459', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
              {violations.length
                ? `${violations.length} constraint violation${violations.length > 1 ? 's' : ''}`
                : metrics ? 'All constraints satisfied' : 'Awaiting metrics'}
            </p>
            {violations.length > 0 && (
              <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
                {violations.map((v, i) => (
                  <li key={i} style={{ fontSize: 12, color: '#FFFFE3', paddingLeft: 12, position: 'relative' }}>
                    <span style={{ position: 'absolute', left: 0, color: '#F09595' }}>•</span>
                    {v}
                  </li>
                ))}
              </ul>
            )}
            {metrics && metrics.binding.length > 0 && (
              <div style={{ marginTop: 10 }}>
                <p style={{ fontSize: 10, color: '#6D8196', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>
                  Binding rules
                </p>
                <p style={{ fontSize: 12, color: '#CBCBCB' }}>{metrics.binding.join(' · ')}</p>
              </div>
            )}
          </div>

          <div style={panel}>
            <p style={panelTitle}>Manager decision</p>
            {decided ? (
              <p style={{ fontSize: 13, color: '#CBCBCB' }}>
                Status <strong style={{ color: '#FFFFE3' }}>{portfolio.status}</strong> — no further decision can be recorded on this proposal.
                Use &quot;Run new optimization&quot; above to create a new proposal.
              </p>
            ) : (
              <>
                <textarea
                  value={rejectReason}
                  onChange={e => setRejectReason(e.target.value)}
                  placeholder="Reason (required to reject)…"
                  rows={2}
                  disabled={deciding}
                  style={textareaStyle}
                />
                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                  <button
                    onClick={() => decide('approved')}
                    disabled={!canApprove || deciding}
                    style={btnApprove(!canApprove || deciding)}
                  >
                    {deciding ? 'Saving…' : 'Approve'}
                  </button>
                  <button
                    onClick={() => decide('rejected')}
                    disabled={!rejectReason.trim() || deciding}
                    style={btnReject(!rejectReason.trim() || deciding)}
                  >
                    {deciding ? 'Saving…' : 'Reject'}
                  </button>
                </div>
                {decisionError && <p style={errText}>{decisionError}</p>}
                {dirty && (
                  <p style={{ fontSize: 11, color: '#EF9F27', marginTop: 8 }}>
                    You have unsaved slider changes — save them with a reason before approving, or the approval would apply to the previously-stored weights.
                  </p>
                )}
                {!dirty && !violations.length && Math.round(total) !== 100 && (
                  <p style={{ fontSize: 11, color: '#6D8196', marginTop: 8 }}>
                    Weights must sum to 100% before approval (currently {total.toFixed(1)}%).
                  </p>
                )}
              </>
            )}
          </div>

          {(portfolio.excluded_sectors.length > 0 || portfolio.unmatched_exclusions.length > 0) && (
            <div style={panel}>
              <p style={panelTitle}>Sector exclusions</p>
              {portfolio.excluded_sectors.length > 0 && (
                <p style={{ fontSize: 12, color: '#FFFFE3', marginBottom: 4 }}>
                  <span style={{ color: '#97C459' }}>Applied:</span> {portfolio.excluded_sectors.join(', ')}
                </p>
              )}
              {portfolio.unmatched_exclusions.length > 0 && (
                <p style={{ fontSize: 12, color: '#FFFFE3' }}>
                  <span style={{ color: '#EF9F27' }}>Unmatched (nothing to exclude in the universe):</span> {portfolio.unmatched_exclusions.join(', ')}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )

  function normalize() {
    const s = ETFS.reduce((sum, a) => sum + (weights[a.ticker] ?? 0), 0)
    if (s === 0) return
    const scaled: Record<string, number> = {}
    ETFS.forEach(a => { scaled[a.ticker] = Math.round(((weights[a.ticker] ?? 0) / s) * 1000) / 10 })
    setWeights(scaled)
  }
}

// ---------- small subcomponents ----------

function Metric({ label, value, tone = '#FFFFE3' }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <p style={{ fontSize: 10, color: '#CBCBCB', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</p>
      <p style={{ fontSize: 20, color: tone, fontFamily: 'monospace' }}>{value}</p>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const color = status === 'approved' ? '#97C459'
    : status === 'rejected' ? '#F09595'
    : status === 'accepted' ? '#6D8196'
    : '#EF9F27'
  return (
    <span style={{
      fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em',
      padding: '4px 8px', borderRadius: 4,
      background: `${color}22`, color,
    }}>{status}</span>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div style={{ padding: '3rem', color: '#CBCBCB', fontSize: 14 }}>{children}</div>
}

function ErrorBanner({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      background: 'rgba(240,149,149,0.08)',
      border: '0.5px solid rgba(240,149,149,0.35)',
      borderRadius: 10, padding: '14px 16px', marginTop: 16,
      color: '#F09595', fontFamily: 'var(--font-body)', fontSize: 13,
    }}>{children}</div>
  )
}

function formatError(e: unknown, action: string): string {
  if (e instanceof ApiError) return e.message
  return `Could not ${action}.`
}

// ---------- styles ----------

const h1 = { fontSize: 22, fontWeight: 500, color: '#FFFFE3', marginBottom: 4 } as const
const muted = { fontSize: 13, color: '#CBCBCB' } as const
const mono = { fontFamily: 'monospace' as const }
const panel = {
  background: 'rgba(255,255,227,0.06)',
  border: '0.5px solid rgba(203,203,203,0.15)',
  borderRadius: 12, padding: '1.25rem',
} as const
const panelTitle = {
  fontSize: 12, color: '#CBCBCB', textTransform: 'uppercase' as const,
  letterSpacing: '0.06em', marginBottom: 12,
} as const
const textareaStyle = {
  width: '100%', padding: '8px 10px', borderRadius: 6,
  background: 'rgba(255,255,255,0.06)', color: '#FFFFE3',
  border: '1px solid rgba(203,203,203,0.2)', fontSize: 12,
  outline: 'none', resize: 'vertical' as const,
} as const
const errText = { marginTop: 10, color: '#F09595', fontSize: 12 }

const btnPrimary = (disabled: boolean) => ({
  padding: '8px 14px', fontSize: 12, fontWeight: 600, borderRadius: 6, border: 'none',
  background: disabled ? 'rgba(255,255,255,0.1)' : '#FFFFE3',
  color: disabled ? 'rgba(255,255,255,0.4)' : '#4A4A4A',
  cursor: disabled ? 'not-allowed' : 'pointer',
}) as const

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
