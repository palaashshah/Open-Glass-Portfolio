'use client'
import { useEffect, useMemo, useState } from 'react'
import {
  ApiError, localTime, localDate, toPercent,
  getInvestors, getInteractions, getAllInteractions,
  getOverview, getInvestorOverview, getRebalancing, submitRiskAssessment, deleteInvestor,
  type InvestorResponse, type PortfolioResponse, type ValuationResponse,
  type InvestorOverview, type RiskScoreResponse,
  type RiskAssessmentResponse, type RebalancingResponse,
} from '@/lib/api'
import { ETFS } from '@/lib/etfs'

import InvestorOnboarding from '@/components/InvestorOnboarding'
import RiskQuestionnaire from '@/components/RiskQuestionnaire'
import ReviewCustomization from '@/components/manager/ReviewCustomization'
import {
  SubmissionQueue,
  RationalePanel,
  ProposalReport,
  DriftAlerts,
  AuditLog,
  InvestorPortalView,
  ClientSignOffPanel,
} from '@/components/manager/ManagerViews'

import StatCard from '@/components/dashboard/StatCard'
import AUMSplitChart from '@/components/dashboard/AUMSplitChart'
import InteractionList from '@/components/dashboard/InteractionList'
import LogInteractionForm from '@/components/dashboard/LogInteractionForm'
import EditProfileForm from '@/components/dashboard/EditProfileForm'

type Investor = {
  id: string
  name: string
  risk_score?: string
  total_aum?: number
  investment_horizon?: string
  assigned_manager_id?: string
  demographics?: Record<string, unknown>
  preferences_constraints?: Record<string, unknown>
}

type Interaction = {
  id: string
  investor_id: string
  timestamp?: string
  interaction_type?: string
  notes?: string
  manager_id?: string
}

type ViewKey =
  | 'dashboard'
  | 'onboarding'
  | 'submissions'
  | 'investors'
  | 'investor-detail'
  | 'retake-questionnaire'
  | 'review'
  | 'rationale'
  | 'proposal'
  | 'sign-off'
  | 'portal'
  | 'interactions'
  | 'drift'
  | 'audit'

type NavItem = { key: ViewKey; label: string }
type NavGroup = { title: string; items: NavItem[] }

// Sidebar groups follow the manager's workflow left-to-right in time:
// Overview → Clients (who) → Portfolio (proposal pipeline, in stage order)
// → Monitoring (after the client has signed off).
const NAV: NavGroup[] = [
  {
    title: 'Overview',
    items: [{ key: 'dashboard', label: 'Dashboard' }],
  },
  {
    title: 'Clients',
    items: [
      { key: 'onboarding', label: 'Investor Intake' },
      { key: 'investors', label: 'Investors' },
      { key: 'interactions', label: 'Interactions' },
    ],
  },
  {
    title: 'Portfolio',
    items: [
      { key: 'submissions', label: 'Submission Queue' },
      { key: 'review', label: 'Review & Customize' },
      { key: 'rationale', label: 'Rationale' },
      { key: 'proposal', label: 'Proposal (PDF)' },
      { key: 'sign-off', label: 'Client Sign-Off' },
    ],
  },
  {
    title: 'Monitoring',
    items: [
      { key: 'portal', label: 'Investor Portal' },
      { key: 'drift', label: 'Drift Alerts' },
      { key: 'audit', label: 'Audit Log' },
    ],
  },
]

export default function AppShell() {
  const [activeView, setActiveView] = useState<ViewKey>('dashboard')
  const [investors, setInvestors] = useState<Investor[]>([])
  const [investorsError, setInvestorsError] = useState('')
  const [investorsLoading, setInvestorsLoading] = useState(true)
  const [selectedInvestorId, setSelectedInvestorId] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  function refreshInvestors() {
    setInvestorsLoading(true)
    setInvestorsError('')
    getInvestors()
      .then(data => setInvestors(data))
      .catch(e => setInvestorsError(e instanceof ApiError ? e.message : 'Could not load investors.'))
      .finally(() => setInvestorsLoading(false))
  }

  // Reload the investor list every time the manager moves to another screen.
  // Loading it only once meant an investor added through Investor Intake could
  // not be opened ("No investor selected") until the browser was refreshed,
  // and a retaken questionnaire or edited profile showed the old details.
  useEffect(() => { refreshInvestors() }, [activeView])

  const selectedInvestor = useMemo(
    () => investors.find(i => i.id === selectedInvestorId) ?? null,
    [investors, selectedInvestorId]
  )

  function openInvestor(id: string) {
    setSelectedInvestorId(id)
    setActiveView('investor-detail')
  }

  function runOptimization(id: string) {
    setSelectedInvestorId(id)
    setActiveView('review')
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#4A4A4A', color: '#FFFFE3' }}>
      <aside style={{
        width: 240, minWidth: 240,
        background: '#3a3a3a',
        borderRight: '0.5px solid rgba(203,203,203,0.15)',
        padding: '1.5rem 1rem',
        display: 'flex', flexDirection: 'column', gap: '1.5rem',
        position: 'sticky', top: 0, height: '100vh', overflowY: 'auto',
      }}>
        <div>
          <p style={{ fontSize: 15, fontWeight: 500, letterSpacing: '0.04em', color: '#FFFFE3' }}>
            Open<span style={{ color: '#6D8196' }}>Glass</span>
          </p>
          <p style={{ fontSize: 10, color: '#6D8196', letterSpacing: '0.12em', textTransform: 'uppercase', marginTop: 2 }}>
            Portfolio Management
          </p>
        </div>

        {/* Selected-client indicator. Many right-pane views read from this
            selection (Review & Customize, Rationale, Proposal, Sign-Off,
            Investor Portal) — surfacing it in the sidebar makes it obvious
            which investor those screens are actually acting on. */}
        <SelectedClientCard
          investor={selectedInvestor}
          onOpen={() => selectedInvestor && openInvestor(selectedInvestor.id)}
          onClear={() => setSelectedInvestorId(null)}
          onPickInvestors={() => setActiveView('investors')}
        />

        {NAV.map(group => (
          <div key={group.title}>
            <p style={{ fontSize: 10, color: '#6D8196', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 8, paddingLeft: 8 }}>
              {group.title}
            </p>
            <nav style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {group.items.map(item => {
                const active = activeView === item.key || (item.key === 'investors' && activeView === 'investor-detail')
                return (
                  <button
                    key={item.key}
                    onClick={() => setActiveView(item.key)}
                    style={{
                      textAlign: 'left', border: 'none', cursor: 'pointer',
                      padding: '7px 10px', borderRadius: 6, fontSize: 13,
                      color: active ? '#FFFFE3' : '#CBCBCB',
                      background: active ? 'rgba(109,129,150,0.28)' : 'transparent',
                    }}
                  >
                    {item.label}
                  </button>
                )
              })}
            </nav>
          </div>
        ))}
      </aside>

      <main style={{ flex: 1, minWidth: 0, overflowY: 'auto', maxHeight: '100vh' }}>
        {investorsError && (
          <div style={{ padding: '1rem 2rem', color: '#F09595', fontSize: 13 }}>
            Could not load investors: {investorsError}
          </div>
        )}

        {activeView === 'dashboard' && (
          <DashboardView investors={investors} loading={investorsLoading} onOpen={openInvestor} />
        )}
        {activeView === 'onboarding' && <InvestorOnboarding />}
        {activeView === 'submissions' && (
          <SubmissionQueue
            investors={investors}
            onOpen={openInvestor}
            onRunOptimization={runOptimization}
          />
        )}
        {activeView === 'investors' && (
          <InvestorList investors={investors} search={search} setSearch={setSearch} onOpen={openInvestor} />
        )}
        {activeView === 'investor-detail' && selectedInvestor && (
          <InvestorDetail
            investor={selectedInvestor}
            onEditReview={() => setActiveView('review')}
            onOpenProposal={() => setActiveView('proposal')}
            onRetakeQuestionnaire={() => setActiveView('retake-questionnaire')}
            onDeleted={() => {
              setSelectedInvestorId(null)
              setActiveView('investors')
              refreshInvestors()
            }}
          />
        )}
        {activeView === 'investor-detail' && !selectedInvestor && (
          <EmptyState message="No investor selected. Open one from the Investors or Submission Queue view." />
        )}
        {activeView === 'retake-questionnaire' && selectedInvestor && (
          <RetakeQuestionnaireView
            investor={selectedInvestor}
            onDone={() => setActiveView('investor-detail')}
          />
        )}
        {activeView === 'retake-questionnaire' && !selectedInvestor && (
          <EmptyState message="No investor selected." />
        )}
        {activeView === 'review' && (
          <ReviewCustomization
            investorId={selectedInvestor?.id}
            investorName={selectedInvestor?.name}
            riskProfile={selectedInvestor?.risk_score ?? undefined}
          />
        )}
        {activeView === 'rationale' && (
          <RationalePanel
            investorId={selectedInvestor?.id}
            investorName={selectedInvestor?.name}
          />
        )}
        {activeView === 'proposal' && (
          <ProposalReport
            investorId={selectedInvestor?.id}
            investorName={selectedInvestor?.name}
          />
        )}
        {activeView === 'sign-off' && (
          <ClientSignOffPanel
            investorId={selectedInvestor?.id}
            investorName={selectedInvestor?.name}
          />
        )}
        {activeView === 'portal' && <InvestorPortalView investor={selectedInvestor} />}
        {activeView === 'interactions' && <AllInteractionsView investors={investors} />}
        {activeView === 'drift' && <DriftAlerts onOpen={openInvestor} />}
        {activeView === 'audit' && <AuditLog investors={investors} />}
      </main>
    </div>
  )
}

// ── Selected client sidebar card ─────────────────────────────────────────────

function SelectedClientCard({
  investor,
  onOpen,
  onClear,
  onPickInvestors,
}: {
  investor: Investor | null
  onOpen: () => void
  onClear: () => void
  onPickInvestors: () => void
}) {
  if (!investor) {
    return (
      <div style={{
        border: '0.5px dashed rgba(203,203,203,0.25)',
        borderRadius: 8, padding: '10px 12px',
        background: 'transparent',
      }}>
        <p style={{
          fontSize: 10, color: '#6D8196', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 4,
        }}>Selected client</p>
        <p style={{ fontSize: 12, color: '#CBCBCB', lineHeight: 1.4, marginBottom: 6 }}>
          Nothing selected.
        </p>
        <button
          onClick={onPickInvestors}
          style={{
            background: 'transparent', border: 'none',
            color: '#a0b4c4', fontSize: 11, padding: 0,
            cursor: 'pointer', textDecoration: 'underline',
          }}
        >Pick one →</button>
      </div>
    )
  }

  const initials = investor.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()

  return (
    <div style={{
      border: '0.5px solid rgba(109,129,150,0.4)',
      background: 'rgba(109,129,150,0.12)',
      borderRadius: 8, padding: '10px 12px',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
        <p style={{
          fontSize: 10, color: '#a0b4c4', textTransform: 'uppercase', letterSpacing: '0.12em',
        }}>Selected client</p>
        <button
          onClick={onClear}
          title="Clear selection"
          style={{
            background: 'transparent', border: 'none',
            color: '#6D8196', fontSize: 14, lineHeight: 1,
            padding: 0, cursor: 'pointer',
          }}
        >×</button>
      </div>

      <button
        onClick={onOpen}
        style={{
          display: 'flex', gap: 8, alignItems: 'center', width: '100%',
          background: 'transparent', border: 'none', padding: 0,
          cursor: 'pointer', textAlign: 'left',
        }}
      >
        <div style={{
          width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
          background: 'rgba(109,129,150,0.3)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 11, color: '#FFFFE3',
        }}>{initials}</div>
        <div style={{ minWidth: 0 }}>
          <p style={{
            fontSize: 13, color: '#FFFFE3', fontWeight: 500,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{investor.name}</p>
          <p style={{
            fontSize: 10, color: '#CBCBCB', textTransform: 'capitalize',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {investor.risk_score ?? '—'} · {investor.investment_horizon ?? '—'}
          </p>
        </div>
      </button>
    </div>
  )
}

// ── Dashboard ────────────────────────────────────────────────────────────────

type DashboardTotals = {
  totalInvested: number
  totalCurrentValue: number
  totalGain: number
  gainPct: number
  pendingReview: number
  acceptedCount: number
  asOf: string | null
  hasValuationData: boolean
}

type DashboardData = {
  totals: DashboardTotals
  statusCounts: Record<string, number>   // keyed by server stage (needs_questionnaire etc.)
  investorOverviews: InvestorOverview[]
  loading: boolean
  error: string
}

// Dashboard & investor list both use GET /overview — one call for everything.
// Prefer this over listPortfolios + getValuation per investor; the backend
// handles aggregation (invested_clients, amount_invested, stage_counts) and
// returns one row per investor with the same shape used elsewhere.
function useDashboardData(): DashboardData {
  const [totals, setTotals] = useState<DashboardTotals>({
    totalInvested: 0, totalCurrentValue: 0, totalGain: 0, gainPct: 0,
    pendingReview: 0, acceptedCount: 0, asOf: null, hasValuationData: false,
  })
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({})
  const [investorOverviews, setInvestorOverviews] = useState<InvestorOverview[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    getOverview()
      .then(o => {
        if (cancelled) return
        setTotals({
          totalInvested: o.totals.amount_invested,
          totalCurrentValue: o.totals.current_value,
          totalGain: o.totals.gain,
          gainPct: o.totals.gain_pct,
          pendingReview: o.totals.stage_counts.awaiting_manager ?? 0,
          acceptedCount: o.totals.invested_clients,
          asOf: o.totals.as_of_date,
          hasValuationData: o.totals.invested_clients > 0,
        })
        setStatusCounts(o.totals.stage_counts as Record<string, number>)
        setInvestorOverviews(o.investors)
      })
      .catch(e => { if (!cancelled) setError(e instanceof ApiError ? e.message : 'Could not load the dashboard.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  return { totals, statusCounts, investorOverviews, loading, error }
}

// ── charts ───────────────────────────────────────────────────────────────────

function AUMByInvestorChart({ investors, onOpen }: { investors: Investor[]; onOpen: (id: string) => void }) {
  const sorted = useMemo(
    () => [...investors].filter(i => (i.total_aum ?? 0) > 0).sort((a, b) => (b.total_aum ?? 0) - (a.total_aum ?? 0)).slice(0, 8),
    [investors]
  )
  const max = sorted.length > 0 ? (sorted[0].total_aum ?? 0) : 1

  return (
    <div style={chartPanel}>
      <p style={chartTitle}>AUM by investor <span style={chartSubtle}>· top 8</span></p>
      {sorted.length === 0 ? (
        <p style={{ fontSize: 12, color: '#CBCBCB' }}>No AUM recorded yet.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {sorted.map(inv => {
            const aum = inv.total_aum ?? 0
            const pct = (aum / max) * 100
            return (
              <button
                key={inv.id}
                onClick={() => onOpen(inv.id)}
                style={{
                  background: 'transparent', border: 'none', textAlign: 'left',
                  padding: 0, cursor: 'pointer', width: '100%',
                }}
                title={`Open ${inv.name}`}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
                  <span style={{ color: '#FFFFE3' }}>{inv.name}</span>
                  <span style={{ fontFamily: 'monospace', color: '#CBCBCB' }}>₹{aum.toLocaleString('en-IN')}</span>
                </div>
                <div style={{ height: 6, background: 'rgba(255,255,255,0.08)', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: pct + '%', background: '#6D8196', transition: 'width 0.4s ease' }} />
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function PortfolioPipelineChart({ statusCounts }: { statusCounts: Record<string, number> }) {
  // Order stages left→right by workflow; show every one that has >0.
  // The keys are the investor stages that GET /overview counts in
  // totals.stage_counts. (They used to be portfolio statuses, which that
  // endpoint does not return, so this chart always came up empty.)
  const order: Array<{ key: string; label: string; color: string }> = [
    { key: 'needs_questionnaire', label: 'Questionnaire pending', color: '#8497b5' },
    { key: 'needs_optimization',  label: 'Awaiting optimizer',    color: '#a0b4c4' },
    { key: 'awaiting_manager',    label: 'Awaiting manager',      color: '#EF9F27' },
    { key: 'awaiting_client',     label: 'Awaiting client',       color: '#97C459' },
    { key: 'invested',            label: 'Invested',              color: '#5DCAA5' },
  ]
  const present = order.filter(s => (statusCounts[s.key] ?? 0) > 0)
  const total = present.reduce((s, x) => s + (statusCounts[x.key] ?? 0), 0)

  return (
    <div style={chartPanel}>
      <p style={chartTitle}>Client pipeline <span style={chartSubtle}>· stage of each investor</span></p>
      {total === 0 ? (
        <p style={{ fontSize: 12, color: '#CBCBCB' }}>No investors yet.</p>
      ) : (
        <>
          <div style={{ display: 'flex', height: 14, borderRadius: 4, overflow: 'hidden', background: 'rgba(255,255,255,0.08)' }}>
            {present.map(s => {
              const n = statusCounts[s.key] ?? 0
              const pct = (n / total) * 100
              return <div key={s.key} title={`${s.label}: ${n}`} style={{ width: pct + '%', background: s.color }} />
            })}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 10 }}>
            {present.map(s => (
              <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#CBCBCB' }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: s.color }} />
                <span>{s.label}</span>
                <span style={{ fontFamily: 'monospace', color: '#FFFFE3' }}>{statusCounts[s.key]}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

const chartPanel = {
  background: 'rgba(255,255,227,0.06)',
  border: '0.5px solid rgba(203,203,203,0.15)',
  borderRadius: 12, padding: '1.25rem',
} as const
const chartTitle = {
  fontSize: 12, color: '#CBCBCB', textTransform: 'uppercase' as const, letterSpacing: '0.06em', marginBottom: 12,
}
const chartSubtle = { color: '#6D8196', fontSize: 10, textTransform: 'none' as const, letterSpacing: 0 }

function DashboardView({ investors, loading, onOpen }: { investors: Investor[]; loading: boolean; onOpen: (id: string) => void }) {
  const { totals, statusCounts, investorOverviews, loading: dashLoading, error: dashError } = useDashboardData()

  const gainValue = totals.hasValuationData
    ? (totals.totalGain >= 0 ? '+' : '') + '₹' + Math.round(totals.totalGain).toLocaleString('en-IN')
    : '—'
  const gainTrend = totals.hasValuationData
    ? (totals.gainPct >= 0 ? '+' : '') + toPercent(totals.gainPct).toFixed(2) + '%'
    : undefined

  // Flatten the server-side investor list to our local shape for the charts
  // and "Recent clients" tile. Normalises nulls to undefined and uses the
  // authoritative risk_bucket / horizon from the overview row, not the
  // (deprecated) overridable fields on the investor record itself.
  const investorsFromOverview: Investor[] = investorOverviews.map(o => ({
    id: o.investor.id,
    name: o.investor.name,
    assigned_manager_id: o.investor.assigned_manager_id,
    total_aum: o.investor.total_aum ?? undefined,
    demographics: o.investor.demographics ?? undefined,
    preferences_constraints: o.investor.preferences_constraints ?? undefined,
    risk_score: o.risk_bucket ?? undefined,
    investment_horizon: o.horizon ?? undefined,
  }))

  return (
    <div style={{ padding: '2rem' }}>
      <h1 style={{ fontSize: 22, fontWeight: 500, color: '#FFFFE3', marginBottom: '1.5rem' }}>Dashboard</h1>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: '1.5rem' }}>
        <StatCard label="Total clients" value={dashLoading ? '…' : String(investorOverviews.length)} /> 
        <StatCard label="Amount invested" value={dashLoading ? '…' : '₹' + Math.round(totals.totalInvested).toLocaleString('en-IN')} />
        <StatCard
          label={dashLoading ? 'Total gain · loading' : totals.hasValuationData ? `Gain on ${totals.acceptedCount} invested` : 'Total gain'}
          value={dashLoading ? '…' : gainValue}
          trend={gainTrend}
          positive={totals.totalGain >= 0}
        />
        <StatCard label="Pending review" value={dashLoading ? '…' : String(totals.pendingReview)} />
      </div>

      {totals.asOf && !dashLoading && (
        <p style={{ fontSize: 11, color: '#6D8196', marginBottom: '1rem' }}>
          Valuations as of {totals.asOf}. Prices are end-of-day snapshots from yfinance, not live quotes.
        </p>
      )}
      {dashError && (
        <p style={{ fontSize: 12, color: '#F09595', marginBottom: '1rem' }}>Could not load dashboard: {dashError}</p>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 14, marginBottom: '1.5rem' }}>
        <AUMByInvestorChart investors={investorsFromOverview.length > 0 ? investorsFromOverview : investors} onOpen={onOpen} />
        <PortfolioPipelineChart statusCounts={statusCounts} />
      </div>

      <div style={{
        background: 'rgba(255,255,227,0.06)',
        border: '0.5px solid rgba(203,203,203,0.15)',
        borderRadius: 12, padding: '1.25rem',
      }}>
        <p style={{ fontSize: 12, color: '#CBCBCB', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>Recent clients</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 }}>
          {(investorsFromOverview.length > 0 ? investorsFromOverview : investors).slice(0, 6).map(inv => (
            <button key={inv.id} onClick={() => onOpen(inv.id)} style={{
              textAlign: 'left', cursor: 'pointer', border: '0.5px solid rgba(203,203,203,0.15)',
              background: 'rgba(255,255,227,0.04)', borderRadius: 10, padding: '12px 14px', color: '#FFFFE3',
            }}>
              <p style={{ fontSize: 13, fontWeight: 500 }}>{inv.name}</p>
              <p style={{ fontSize: 11, color: '#CBCBCB', marginTop: 3, textTransform: 'capitalize' }}>
                {inv.risk_score ?? 'Questionnaire pending'} · {inv.investment_horizon ?? '—'}
              </p>
            </button>
          ))}
          {investorsFromOverview.length === 0 && !dashLoading && <p style={{ fontSize: 13, color: '#CBCBCB' }}>No investors yet.</p>}
        </div>
      </div>
    </div>
  )
}

// ── Investors List ───────────────────────────────────────────────────────────

function InvestorList({
  investors, search, setSearch, onOpen,
}: {
  investors: InvestorResponse[] | Investor[]
  search: string
  setSearch: (s: string) => void
  onOpen: (id: string) => void
}) {
  const filtered = investors.filter(inv =>
    inv.name.toLowerCase().includes(search.toLowerCase()) ||
    inv.risk_score?.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div style={{ padding: '2rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: 22, fontWeight: 500, color: '#FFFFE3' }}>Investors</h1>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search name or risk profile…"
          style={{
            background: 'rgba(255,255,227,0.07)',
            border: '0.5px solid rgba(203,203,203,0.25)',
            borderRadius: 8, padding: '8px 14px',
            fontSize: 13, color: '#FFFFE3', width: 260, outline: 'none',
          }}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 14 }}>
        {filtered.map(inv => (
          <button key={inv.id} onClick={() => onOpen(inv.id)} style={{
            textAlign: 'left', cursor: 'pointer', border: '0.5px solid rgba(203,203,203,0.15)',
            background: 'rgba(255,255,227,0.06)', borderRadius: 10, padding: '1rem', color: '#FFFFE3',
          }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <div style={{
                width: 36, height: 36, borderRadius: '50%',
                background: 'rgba(109,129,150,0.3)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 12, fontWeight: 500,
              }}>
                {inv.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
              </div>
              <div>
                <p style={{ fontSize: 13, fontWeight: 500 }}>{inv.name}</p>
                <p style={{ fontSize: 11, color: '#CBCBCB', textTransform: 'capitalize' }}>
                  {inv.risk_score ?? '—'}
                </p>
              </div>
            </div>
            <div style={{ marginTop: 12, fontSize: 11, color: '#CBCBCB' }}>
              AUM: <span style={{ fontFamily: 'monospace', color: '#FFFFE3' }}>
                {inv.total_aum ? '₹' + inv.total_aum.toLocaleString('en-IN') : '—'}
              </span>
            </div>
          </button>
        ))}
        {filtered.length === 0 && (
          <p style={{ fontSize: 13, color: '#CBCBCB' }}>No investors match your search.</p>
        )}
      </div>
    </div>
  )
}

// ── Investor Detail ──────────────────────────────────────────────────────────

function InvestorDetail({
  investor,
  onEditReview,
  onOpenProposal,
  onDeleted,
  onRetakeQuestionnaire,
}: {
  investor: Investor
  onEditReview: () => void
  onOpenProposal: () => void
  onDeleted: () => void
  onRetakeQuestionnaire: () => void
}) {
  // Single aggregated call: GET /investors/{id}/overview. Replaces the old
  // dance of listPortfolios -> pick latest -> getValuation. Backend decides
  // which portfolio is active vs pending, and whether a valuation exists.
  const [overview, setOverview] = useState<InvestorOverview | null>(null)
  const [overviewError, setOverviewError] = useState('')
  const [overviewLoading, setOverviewLoading] = useState(true)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')

  async function handleDelete() {
    const typed = window.prompt(
      `Delete investor "${investor.name}"?\n\n` +
      `The backend only allows deletion if the investor has no portfolios, ` +
      `assessments, interactions or audit entries attached. If anything is attached ` +
      `the delete will be refused with a 409 and you'll see the error here.\n\n` +
      `Type DELETE to confirm.`
    )
    if (typed !== 'DELETE') return
    setDeleting(true)
    setDeleteError('')
    try {
      await deleteInvestor(investor.id)
      onDeleted()
    } catch (e) {
      setDeleteError(e instanceof ApiError ? e.message : 'Could not delete investor.')
      setDeleting(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    setOverview(null)
    setOverviewError('')
    setOverviewLoading(true)
    getInvestorOverview(investor.id)
      .then(o => { if (!cancelled) setOverview(o) })
      .catch(e => { if (!cancelled) setOverviewError(e instanceof ApiError ? e.message : 'Could not load investor overview.') })
      .finally(() => { if (!cancelled) setOverviewLoading(false) })
    return () => { cancelled = true }
  }, [investor.id])

  const initials = investor.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)

  // Fetch the overview again without blanking the page first. Used after an
  // interaction is logged, so it shows up in the history straight away.
  function reloadOverview() {
    getInvestorOverview(investor.id).then(setOverview).catch(() => {})
  }

  // Allocation + valuation come from the overview. Active portfolio is the
  // accepted one; pending portfolio is a newer proposal still waiting.
  const active = overview?.active_portfolio ?? null
  const pending = overview?.pending_portfolio ?? null
  const valuation = overview?.valuation ?? null
  const interactions = overview?.interactions ?? []

  const allocationData = active ? ETFS.map(e => ({
    label: e.ticker,
    percentage: toPercent(active.weights[e.ticker] ?? 0),
    color: e.color,
  })) : null

  return (
    <div style={{ padding: '2rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{
            width: 52, height: 52, borderRadius: '50%',
            background: 'rgba(109,129,150,0.3)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 16, fontWeight: 500, color: '#FFFFE3',
          }}>{initials}</div>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 500, color: '#FFFFE3', marginBottom: 4 }}>{investor.name}</h1>
            <p style={{ fontSize: 13, color: '#CBCBCB', textTransform: 'capitalize' }}>
              {(overview?.risk_bucket ?? 'Questionnaire pending')} · {overview?.horizon ?? '—'} horizon · Manager: {investor.assigned_manager_id ?? '—'}
            </p>
            {overview && (
              <p style={{ fontSize: 11, color: '#6D8196', marginTop: 4 }}>
                {overview.stage_label}
              </p>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={onRetakeQuestionnaire} style={{
            padding: '8px 14px', fontSize: 12, borderRadius: 6, border: '1px solid rgba(203,203,203,0.3)',
            background: 'transparent', color: '#FFFFE3', cursor: 'pointer',
          }}>{overview?.assessment ? 'Retake questionnaire' : 'Take questionnaire'}</button>
          <button onClick={onEditReview} style={{
            padding: '8px 14px', fontSize: 12, borderRadius: 6, border: '1px solid rgba(203,203,203,0.3)',
            background: 'transparent', color: '#FFFFE3', cursor: 'pointer',
          }}>Review &amp; customize</button>
          <button onClick={onOpenProposal} style={{
            padding: '8px 14px', fontSize: 12, fontWeight: 600, borderRadius: 6, border: 'none',
            background: '#FFFFE3', color: '#4A4A4A', cursor: 'pointer',
          }}>Open proposal</button>
          <button
            onClick={handleDelete}
            disabled={deleting}
            title="Delete this investor and all related records"
            style={{
              padding: '8px 14px', fontSize: 12, borderRadius: 6,
              border: '1px solid rgba(240,149,149,0.5)',
              background: 'transparent', color: '#F09595',
              cursor: deleting ? 'not-allowed' : 'pointer',
              opacity: deleting ? 0.6 : 1,
            }}
          >{deleting ? 'Deleting…' : 'Delete investor'}</button>
        </div>
      </div>

      {deleteError && (
        <div style={{
          background: 'rgba(240,149,149,0.08)',
          border: '0.5px solid rgba(240,149,149,0.35)',
          borderRadius: 10, padding: '10px 14px', marginBottom: '1rem',
          fontSize: 13, color: '#F09595',
        }}>
          Delete failed: {deleteError}
        </div>
      )}

      {overviewError && (
        <div style={{
          background: 'rgba(240,149,149,0.08)',
          border: '0.5px solid rgba(240,149,149,0.35)',
          borderRadius: 10, padding: '10px 14px', marginBottom: '1rem',
          fontSize: 13, color: '#F09595',
        }}>
          Overview: {overviewError}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: '1.5rem' }}>
        {/* Once a portfolio is accepted, AUM is the amount actually invested
            (from the valuation), so it always agrees with Current value and Gain.
            Before that it is the figure given at intake. */}
        <StatCard
          label={valuation ? 'AUM · invested' : 'AUM'}
          value={valuation ? '₹' + Math.round(valuation.amount).toLocaleString('en-IN')
            : investor.total_aum ? '₹' + investor.total_aum.toLocaleString('en-IN') : '—'}
        />
        <StatCard
          label={valuation ? 'Current value' : overviewLoading ? 'Current value' : 'Current value · needs accepted portfolio'}
          value={valuation ? '₹' + Math.round(valuation.current_value).toLocaleString('en-IN') : '—'}
        />
        <StatCard
          label="Gain"
          value={valuation ? (valuation.gain >= 0 ? '+' : '') + '₹' + Math.round(valuation.gain).toLocaleString('en-IN') : '—'}
          trend={valuation ? (valuation.gain_pct >= 0 ? '+' : '') + toPercent(valuation.gain_pct).toFixed(2) + '%' : undefined}
          positive={!!valuation && valuation.gain >= 0}
        />
        <StatCard label="Horizon" value={overview?.horizon ?? '—'} />
      </div>

      {valuation && (
        <p style={{ fontSize: 11, color: '#6D8196', marginBottom: '1rem' }}>
          Invested {valuation.start_date}, valued {valuation.as_of_date}
          {typeof valuation.days_held === 'number' && <> ({valuation.days_held} days)</>}
          {valuation.hypothetical && ' · hypothetical (paper valuation; no trades placed)'}
        </p>
      )}
      {overview?.valuation_note && (
        <p style={{ fontSize: 12, color: '#EF9F27', marginBottom: '1rem' }}>{overview.valuation_note}</p>
      )}
      {overview && <AssessmentPanel assessment={overview.assessment} />}

      {pending && (
        <div style={{
          background: 'rgba(239,159,39,0.08)',
          border: '0.5px solid rgba(239,159,39,0.35)',
          borderRadius: 10, padding: '12px 14px', marginBottom: '1.5rem',
        }}>
          <p style={{ fontSize: 12, color: '#EF9F27', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4, fontWeight: 600 }}>
            New proposal awaiting decision
          </p>
          <p style={{ fontSize: 13, color: '#FFFFE3' }}>
            Portfolio {pending.id.slice(0, 8)}… · status <strong>{pending.status}</strong> · snapshot {localDate(pending.created_at)}
          </p>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: '1.5rem' }}>
        <AUMSplitChart
          data={allocationData ?? undefined}
          asOf={active ? localDate(active.created_at) : undefined}
        />
        <HoldingDriftPanel valuation={valuation} />
      </div>

      {/* key: a different portfolio gets a fresh panel, so old trades never linger */}
      {active && valuation && <RebalancingPanel key={active.id} portfolioId={active.id} />}
      

      <InteractionList interactions={interactions.map(i => ({
        id: i.id,
        interaction_type: i.interaction_type ?? undefined,
        notes: i.notes ?? undefined,
        timestamp: i.timestamp ?? undefined,
        manager_id: i.manager_id ?? undefined,
      }))} />

      <div style={{ marginTop: '1.5rem' }}>
        <LogInteractionForm investorId={investor.id} onLogged={reloadOverview} />
      </div>

      <div style={{ marginTop: '1.5rem' }}>
        <EditProfileForm investorId={investor.id} investor={investor} />
      </div>
    </div>
  )
}

// Replaces the fake PerformanceChart on InvestorDetail with real per-holding
// drift data from GET /portfolios/{id}/valuation. Empty state when no accepted
// portfolio exists yet.
function HoldingDriftPanel({ valuation }: { valuation: ValuationResponse | null }) {
  return (
    <div style={{
      background: 'rgba(255,255,227,0.06)',
      border: '0.5px solid rgba(203,203,203,0.15)',
      borderRadius: 12, padding: '1.25rem',
    }}>
      <p style={{ fontSize: 12, color: '#CBCBCB', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>
        Holdings drift {valuation && <span style={{ color: '#6D8196', fontSize: 10 }}>· as of {valuation.as_of_date}</span>}
      </p>
      {!valuation ? (
        <p style={{ fontSize: 12, color: '#CBCBCB' }}>Available once the client accepts a portfolio.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {valuation.holdings.map(h => {
            const driftPct = toPercent(h.drift)
            return (
              <div key={h.ticker} style={{
                display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr auto',
                gap: 8, alignItems: 'center',
                padding: '4px 0', borderBottom: '0.5px solid rgba(203,203,203,0.08)',
                fontSize: 12,
              }}>
                <span style={{ fontFamily: 'monospace', color: '#a0b4c4' }}>{h.ticker}</span>
                <span style={{ fontFamily: 'monospace', color: '#CBCBCB', textAlign: 'right' }}>
                  tgt {toPercent(h.target_weight).toFixed(1)}%
                </span>
                <span style={{ fontFamily: 'monospace', color: '#FFFFE3', textAlign: 'right' }}>
                  now {toPercent(h.current_weight).toFixed(1)}%
                </span>
                <span style={{
                  fontFamily: 'monospace', textAlign: 'right',
                  color: h.breached ? '#F09595' : driftPct === 0 ? '#CBCBCB' : '#EF9F27',
                }}>
                  {driftPct >= 0 ? '+' : ''}{driftPct.toFixed(1)}%
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// The scores behind the bucket (PRD 5.2): capacity, tolerance, the governing
// score, which of the two limited it, the equity band it sets, and any review
// notes the backend attached. All of it comes from the stored assessment.
function AssessmentPanel({ assessment }: { assessment: RiskAssessmentResponse | null }) {
  const panelStyle = {
    background: 'rgba(255,255,227,0.06)',
    border: '0.5px solid rgba(203,203,203,0.15)',
    borderRadius: 12, padding: '1.25rem', marginBottom: '1.5rem',
  } as const
  const title = { fontSize: 12, color: '#CBCBCB', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 } as const

  if (!assessment) {
    return (
      <div style={panelStyle}>
        <p style={title}>Risk assessment</p>
        <p style={{ fontSize: 12, color: '#CBCBCB' }}>
          No questionnaire on record. Use &quot;Take questionnaire&quot; above; the optimizer cannot run without one.
        </p>
      </div>
    )
  }

  const items: Array<[string, string]> = [
    ['Risk capacity', String(assessment.capacity_score)],
    ['Risk tolerance', String(assessment.tolerance_score)],
    ['Governing score', String(assessment.score)],
    ['Limited by', assessment.limited_by],
    ['Bucket', assessment.bucket],
    ['Equity band', toPercent(assessment.min_equity).toFixed(1) + '% to ' + toPercent(assessment.max_equity).toFixed(1) + '%'],
  ]
  return (
    <div style={panelStyle}>
      <p style={title}>
        Risk assessment <span style={{ color: '#6D8196', fontSize: 10 }}>· taken {localDate(assessment.created_at)}</span>
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 12 }}>
        {items.map(([label, value]) => (
          <div key={label}>
            <p style={{ fontSize: 10, color: '#CBCBCB', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>{label}</p>
            <p style={{ fontSize: 15, color: '#FFFFE3', fontFamily: 'monospace', textTransform: 'capitalize' }}>{value}</p>
          </div>
        ))}
      </div>
      {assessment.notes.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <p style={{ fontSize: 10, color: '#EF9F27', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>Review notes</p>
          {assessment.notes.map((note, i) => (
            <p key={i} style={{ fontSize: 12, color: '#FFFFE3', lineHeight: 1.6 }}>• {note}</p>
          ))}
        </div>
      )}
    </div>
  )
}

// The buys and sells that would bring each holding back to its approved
// weight (PRD 5.8), from GET /portfolios/{id}/rebalancing. A paper list only:
// the system places no trades.
function RebalancingPanel({ portfolioId }: { portfolioId: string }) {
  const [plan, setPlan] = useState<RebalancingResponse | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    getRebalancing(portfolioId)
      .then(p => { if (!cancelled) setPlan(p) })
      .catch(e => { if (!cancelled) setError(e instanceof ApiError ? e.message : 'Could not load the rebalancing trades.') })
    return () => { cancelled = true }
  }, [portfolioId])

  return (
    <div style={{
      background: 'rgba(255,255,227,0.06)',
      border: '0.5px solid rgba(203,203,203,0.15)',
      borderRadius: 12, padding: '1.25rem', marginBottom: '1.5rem',
    }}>
      <p style={{ fontSize: 12, color: '#CBCBCB', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
        Rebalancing {plan && <span style={{ color: '#6D8196', fontSize: 10 }}>· as of {plan.as_of_date}</span>}
      </p>
      {error && <p style={{ fontSize: 12, color: '#F09595' }}>{error}</p>}
      {!plan && !error && <p style={{ fontSize: 12, color: '#CBCBCB' }}>Loading…</p>}
      {plan && (
        <>
          <p style={{ fontSize: 12, color: plan.rebalancing_suggested ? '#EF9F27' : '#CBCBCB', marginBottom: 10 }}>
            {plan.rebalancing_suggested
              ? `Rebalancing is suggested: a holding has drifted more than ${toPercent(plan.drift_threshold).toFixed(0)} points from its approved weight.`
              : `No holding has drifted more than ${toPercent(plan.drift_threshold).toFixed(0)} points, so no rebalancing is needed yet. These trades would restore the approved weights exactly.`}
          </p>
          {plan.trades.length === 0 ? (
            <p style={{ fontSize: 12, color: '#CBCBCB' }}>Every holding is at its approved weight.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {plan.trades.map(t => (
                <div key={t.ticker} style={{
                  display: 'grid', gridTemplateColumns: '70px 1.2fr 1fr 1.4fr',
                  gap: 8, alignItems: 'center',
                  padding: '4px 0', borderBottom: '0.5px solid rgba(203,203,203,0.08)',
                  fontSize: 12,
                }}>
                  <span style={{ textTransform: 'uppercase', fontWeight: 600, color: t.action === 'buy' ? '#97C459' : '#F09595' }}>{t.action}</span>
                  <span style={{ fontFamily: 'monospace', color: '#a0b4c4' }}>{t.ticker}</span>
                  <span style={{ fontFamily: 'monospace', color: '#FFFFE3', textAlign: 'right' }}>
                    ₹{Math.round(t.amount).toLocaleString('en-IN')}
                  </span>
                  <span style={{ fontFamily: 'monospace', color: '#CBCBCB', textAlign: 'right' }}>
                    {toPercent(t.current_weight).toFixed(1)}% → {toPercent(t.target_weight).toFixed(1)}%
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── All interactions ─────────────────────────────────────────────────────────

function AllInteractionsView({ investors }: { investors: Investor[] }) {
  const [interactions, setInteractions] = useState<Interaction[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    getAllInteractions()
      .then(d => setInteractions(d))
      .catch(e => setError(e instanceof ApiError ? e.message : 'Could not load interactions.'))
      .finally(() => setLoading(false))
  }, [])

  function nameFor(id: string) {
    return investors.find(i => i.id === id)?.name ?? 'Unknown'
  }

  function color(type: string) {
    const m: Record<string, string> = { call: '#6D8196', email: '#97C459', meeting: '#EF9F27' }
    return m[type?.toLowerCase()] ?? '#CBCBCB'
  }

  return (
    <div style={{ padding: '2rem' }}>
      <h1 style={{ fontSize: 22, fontWeight: 500, color: '#FFFFE3', marginBottom: '1.5rem' }}>Interactions</h1>
      <div style={{
        background: 'rgba(255,255,227,0.06)',
        border: '0.5px solid rgba(203,203,203,0.15)',
        borderRadius: 12, padding: '1.25rem',
      }}>
        {loading && <p style={{ fontSize: 13, color: '#CBCBCB' }}>Loading…</p>}
        {error && <p style={{ fontSize: 13, color: '#F09595' }}>{error}</p>}
        {!loading && !error && interactions.length === 0 && (
          <p style={{ fontSize: 13, color: '#CBCBCB' }}>No interactions logged yet.</p>
        )}
        {!loading && !error && interactions.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {interactions.map(i => (
              <div key={i.id} style={{
                display: 'flex', gap: 12, alignItems: 'flex-start',
                paddingBottom: 10, borderBottom: '0.5px solid rgba(203,203,203,0.1)',
              }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: color(i.interaction_type ?? ''), marginTop: 5, flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <p style={{ fontSize: 12, color: '#6D8196', marginBottom: 2 }}>{nameFor(i.investor_id)}</p>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                    <span style={{ fontSize: 13, fontWeight: 500, color: '#FFFFE3', textTransform: 'capitalize' }}>{i.interaction_type ?? '—'}</span>
                    <span style={{ fontSize: 11, color: '#CBCBCB' }}>{localTime(i.timestamp)}</span>
                  </div>
                  <p style={{ fontSize: 13, color: '#CBCBCB', lineHeight: 1.5 }}>{i.notes ?? ''}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Empty ────────────────────────────────────────────────────────────────────

// Thin wrapper around RiskQuestionnaire for the retake flow. Reuses the
// full 10-question UI (meta-driven, backend-scored preview), then on
// "Continue to review" POSTs to /investors/{id}/risk-assessments to persist
// the new assessment — backend also bumps risk_score + investment_horizon
// on the investor row. Returns the manager to the investor detail page.
function RetakeQuestionnaireView({ investor, onDone }: { investor: Investor; onDone: () => void }) {
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [savedPreview, setSavedPreview] = useState<RiskScoreResponse | null>(null)

  async function handleComplete(answers: Record<string, number>, preview: RiskScoreResponse) {
    setSaving(true)
    setSaveError('')
    try {
      await submitRiskAssessment(investor.id, { answers })
      setSavedPreview(preview)
    } catch (e) {
      setSaveError(e instanceof ApiError ? e.message : 'Could not save the assessment.')
    } finally {
      setSaving(false)
    }
  }

  if (savedPreview) {
    return (
      <div style={{ padding: '3rem', maxWidth: 560 }}>
        <h1 style={{ fontSize: 22, fontWeight: 500, color: '#FFFFE3', marginBottom: 8 }}>
          Assessment saved for {investor.name}
        </h1>
        <p style={{ fontSize: 13, color: '#CBCBCB', marginBottom: 16 }}>
          New risk bucket: <strong>{savedPreview.bucket}</strong> · horizon: {savedPreview.horizon}
        </p>
        <button onClick={onDone} style={{
          padding: '10px 18px', fontSize: 13, fontWeight: 600, borderRadius: 6, border: 'none',
          background: '#FFFFE3', color: '#4A4A4A', cursor: 'pointer',
        }}>
          Back to {investor.name}
        </button>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      {saveError && (
        <div style={{ padding: '10px 20px', background: 'rgba(240,149,149,0.12)', color: '#F09595', fontSize: 13 }}>
          {saveError}
        </div>
      )}
      {saving && (
        <div style={{ padding: '10px 20px', background: 'rgba(109,129,150,0.12)', color: '#a0b4c4', fontSize: 13 }}>
          Saving assessment…
        </div>
      )}
      <RiskQuestionnaire onComplete={handleComplete} />
    </div>
  )
}

function EmptyState({ message }: { message: string }) {
  return (
    <div style={{ padding: '3rem', color: '#CBCBCB', fontSize: 14 }}>
      {message}
    </div>
  )
}
