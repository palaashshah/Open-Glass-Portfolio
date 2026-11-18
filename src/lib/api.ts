// Single source of truth for backend calls. One function per endpoint.
// Typed functions return the raw backend shape — weights/returns as
// decimals (0–1) and timestamps as UTC ISO strings. The UI should call
// toPercent / localTime at the display edge, never fabricate values of
// its own.
//
// Error handling: every function throws ApiError on a non-2xx response
// (detail text when the backend provides one). Back-compat shims at the
// bottom preserve the "silently return empty / null" behavior of a few
// old call sites until later steps migrate them.

const API_BASE = "http://localhost:8000"

// ---------- error type + request helper ----------

export class ApiError extends Error {
    readonly status: number
    readonly detail: unknown
    constructor(status: number, detail: unknown, message: string) {
        super(message)
        this.name = 'ApiError'
        this.status = status
        this.detail = detail
    }
}

type RequestOptions = Omit<RequestInit, 'body'> & { body?: unknown }

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { body, headers, ...rest } = options
    const res = await fetch(`${API_BASE}${path}`, {
        ...rest,
        headers: {
            ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
            ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await res.text()
    let payload: unknown = undefined
    if (text) {
        try { payload = JSON.parse(text) } catch { payload = text }
    }
    if (!res.ok) {
        const detail = (payload as { detail?: unknown } | undefined)?.detail ?? payload
        const message = typeof detail === 'string' ? detail : `HTTP ${res.status}`
        throw new ApiError(res.status, detail, message)
    }
    return payload as T
}

// ---------- display helpers (use at the UI edge, never in business logic) ----------

export function toPercent(fraction: number, digits = 2): number {
    const m = Math.pow(10, digits)
    return Math.round(fraction * 100 * m) / m
}

export function fromPercent(percent: number): number {
    return percent / 100
}

export function localTime(utcIso: string | null | undefined): string {
    if (!utcIso) return ''
    // Backend timestamps come back as naive ISO strings (e.g. "2026-11-17T10:11:53.028262").
    // Treat them as UTC when no zone is present, then format in the user's locale.
    const hasZone = /([zZ]|[+-]\d{2}:?\d{2})$/.test(utcIso)
    const d = new Date(hasZone ? utcIso : utcIso + 'Z')
    if (isNaN(d.getTime())) return utcIso
    return d.toLocaleString()
}

export function localDate(isoDate: string | null | undefined): string {
    if (!isoDate) return ''
    const d = new Date(isoDate)
    if (isNaN(d.getTime())) return isoDate
    return d.toLocaleDateString()
}

// ---------- backend schema types ----------

export type Demographics = Record<string, unknown>
export type PreferencesConstraints = Record<string, unknown>

export interface InvestorCreate {
    name: string
    assigned_manager_id: string
    demographics?: Demographics | null
    total_aum?: number | null
    investment_horizon?: string | null
    risk_score?: string | null
    preferences_constraints?: PreferencesConstraints | null
    risk_answers?: Record<string, number> | null
}

export interface InvestorUpdate {
    name?: string | null
    demographics?: Demographics | null
    total_aum?: number | null
    investment_horizon?: string | null
    risk_score?: string | null
    preferences_constraints?: PreferencesConstraints | null
    assigned_manager_id?: string | null
}

export interface InvestorResponse {
    id: string
    name: string
    assigned_manager_id: string
    demographics?: Demographics | null
    total_aum?: number | null
    investment_horizon?: string | null
    risk_score?: string | null
    preferences_constraints?: PreferencesConstraints | null
}

export interface InteractionCreate {
    investor_id: string
    manager_id: string
    interaction_type?: string | null
    notes?: string | null
    timestamp?: string | null
}

export interface InteractionResponse {
    id: string
    investor_id: string
    manager_id: string
    interaction_type?: string | null
    notes?: string | null
    timestamp?: string | null
}

export interface RiskAnswers {
    answers: Record<string, number>
}

export interface RiskScoreResponse {
    capacity_score: number
    tolerance_score: number
    score: number
    limited_by: string
    bucket: string
    horizon: string
    min_equity: number     // decimal 0–1
    max_equity: number     // decimal 0–1
    notes: string[]
    questionnaire_version: string
}

export interface RiskAssessmentResponse extends RiskScoreResponse {
    id: string
    investor_id: string
    created_at: string     // UTC ISO
    answers: Record<string, unknown>
}

export interface QuestionnaireQuestion {
    id: number
    options: number
    group: 'capacity' | 'tolerance' | string
}

export interface QuestionnaireMeta {
    version: string
    questions: QuestionnaireQuestion[]
}

export interface UniverseAsset {
    ticker: string
    asset_class: string
    sector: string | null
    cap: number           // decimal 0–1
}

export interface Universe {
    assets: UniverseAsset[]
}

export interface OptimizeRequest {
    investor_id: string
    snapshot_id?: string | null
    requested_by?: string | null
}

export interface MetricsRequest {
    investor_id: string
    weights: Record<string, number>   // decimal 0–1
    snapshot_id?: string | null
}

export interface MetricsResponse {
    expected_return: number
    volatility: number
    sharpe: number
    binding: string[]
    violations: string[]
}

export interface PortfolioResponse {
    id: string
    investor_id: string
    assessment_id: string
    snapshot_id: string
    created_at: string
    created_by?: string | null
    status: string
    constraints: Record<string, unknown>
    excluded_sectors: string[]
    unmatched_exclusions: string[]
    risk_free_rate: number
    objective_used: string
    weights: Record<string, number>   // decimal 0–1
    expected_return: number
    volatility: number
    sharpe: number
    binding: string[]
}

export interface AdjustRequest {
    weights: Record<string, number>   // decimal 0–1
    adjusted_by: string
    reason: string
}

export interface ManagerDecisionRequest {
    decision: 'approved' | 'rejected'
    decided_by: string
    reason?: string | null
}

export interface ClientDecisionRequest {
    decision: 'accepted' | 'declined'
    recorded_by: string
    notes?: string | null
    amount?: number | null
}

export interface PortfolioDecisionResponse {
    id: string
    portfolio_id: string
    timestamp: string
    actor: string
    decision: string
    recorded_by: string
    reason?: string | null
    amount?: number | null
}

export interface ContributionResponse {
    ticker: string
    asset_class: string
    weight: number
    return_contribution: number
    risk_share: number
}

export interface RationaleResponse {
    portfolio_id: string
    summary: string
    profile: string[]
    rules: string[]
    binding: string[]
    contributions: ContributionResponse[]
    notes: string[]
    disclaimer: string
    text: string
}

export interface TradeResponse {
    ticker: string
    action: string
    amount: number
    current_weight: number
    target_weight: number
}

export interface RebalancingResponse {
    portfolio_id: string
    investor_id: string
    as_of_date: string              // ISO date
    current_value: number
    drift_threshold: number
    rebalancing_suggested: boolean
    trades: TradeResponse[]
}

export interface HoldingValuationResponse {
    ticker: string
    target_weight: number
    start_price: number
    latest_price: number
    invested: number          // rupees put into this holding
    value: number             // what that is worth now
    gain: number              // value minus invested (negative for a loss)
    gain_pct: number          // decimal fraction
    current_weight: number
    drift: number
    breached: boolean
    basis: string
}

export interface ValuationResponse {
    portfolio_id: string
    investor_id: string
    hypothetical: boolean
    start_date: string              // ISO date
    as_of_date: string              // ISO date
    amount: number
    current_value: number
    gain: number
    gain_pct: number
    drift_threshold: number
    rebalancing_suggested: boolean
    cash_rate?: number | null
    days_held?: number              // added backend-side; number of days between start_date and as_of_date
    holdings: HoldingValuationResponse[]
}

// ---------- /overview + /investors/{id}/overview ----------
// New aggregating endpoints the backend added. Prefer these over fanning out
// listPortfolios()+getValuation() per investor in the UI.

export type InvestorStage =
    | 'needs_questionnaire'
    | 'needs_optimization'
    | 'awaiting_manager'
    | 'awaiting_client'
    | 'invested'

export interface OverviewTotals {
    clients: number
    invested_clients: number
    amount_invested: number
    current_value: number
    gain: number
    gain_pct: number                // decimal 0–1
    as_of_date: string              // ISO date
    stage_counts: Partial<Record<InvestorStage, number>>
}

export interface InvestorOverview {
    investor: InvestorResponse
    risk_bucket: string | null      // authoritative bucket (null if no assessment)
    horizon: string | null          // authoritative horizon (null if no assessment)
    assessment: RiskAssessmentResponse | null
    stage: InvestorStage
    stage_label: string             // human-readable, from the backend
    in_queue: boolean               // true when the manager should act on this investor
    active_portfolio: PortfolioResponse | null   // accepted portfolio, if any
    pending_portfolio: PortfolioResponse | null  // newer proposal still awaiting a decision
    valuation: ValuationResponse | null          // valuation of active_portfolio
    valuation_note: string | null
    interactions?: InteractionResponse[]         // only on the single-investor call
}

export interface OverviewResponse {
    totals: OverviewTotals
    investors: InvestorOverview[]
}

export interface AuditLogResponse {
    id: string
    timestamp: string
    action: string
    entity_type: string
    entity_id: string
    user_id?: string | null
    reason?: string | null
    before?: Record<string, unknown> | null
    after?: Record<string, unknown> | null
}

export interface AuditLogFilters {
    entity_id?: string
    entity_type?: string
    user_id?: string
    action?: string
    limit?: number
}

// ---------- endpoint functions ----------

export const getHealth = () => request<unknown>('/')

// investors
export const listInvestors = () => request<InvestorResponse[]>('/investors/')
export const createInvestorApi = (body: InvestorCreate) =>
    request<InvestorResponse>('/investors/', { method: 'POST', body })
export const getInvestorApi = (id: string) =>
    request<InvestorResponse>(`/investors/${id}`)
export const updateInvestorApi = (id: string, body: InvestorUpdate) =>
    request<InvestorResponse>(`/investors/${id}`, { method: 'PUT', body })
export const deleteInvestor = (id: string) =>
    request<void>(`/investors/${id}`, { method: 'DELETE' })

// interactions
export function listInteractions(investorId?: string) {
    const q = investorId ? `?investor_id=${encodeURIComponent(investorId)}` : ''
    return request<InteractionResponse[]>(`/interactions/${q}`)
}
export const createInteractionApi = (body: InteractionCreate) =>
    request<InteractionResponse>('/interactions/', { method: 'POST', body })

// risk
export const scoreRisk = (body: RiskAnswers) =>
    request<RiskScoreResponse>('/risk/score', { method: 'POST', body })
export const submitRiskAssessment = (investorId: string, body: RiskAnswers) =>
    request<RiskAssessmentResponse>(`/investors/${investorId}/risk-assessments`, { method: 'POST', body })
export const listRiskAssessments = (investorId: string) =>
    request<RiskAssessmentResponse[]>(`/investors/${investorId}/risk-assessments`)
export const getQuestionnaireMeta = () =>
    request<QuestionnaireMeta>('/questionnaire/meta')

// universe
export const getUniverse = () => request<Universe>('/universe')

// optimize
export const optimize = (body: OptimizeRequest) =>
    request<PortfolioResponse>('/optimize', { method: 'POST', body })
export const computeMetrics = (body: MetricsRequest) =>
    request<MetricsResponse>('/optimize/metrics', { method: 'POST', body })

// portfolios
export function listPortfolios(investorId?: string) {
    const q = investorId ? `?investor_id=${encodeURIComponent(investorId)}` : ''
    return request<PortfolioResponse[]>(`/portfolios${q}`)
}
export const getPortfolio = (id: string) =>
    request<PortfolioResponse>(`/portfolios/${id}`)
export const adjustPortfolio = (id: string, body: AdjustRequest) =>
    request<PortfolioResponse>(`/portfolios/${id}/adjust`, { method: 'POST', body })
export const managerDecision = (id: string, body: ManagerDecisionRequest) =>
    request<PortfolioResponse>(`/portfolios/${id}/manager-decision`, { method: 'POST', body })
export const clientDecision = (id: string, body: ClientDecisionRequest) =>
    request<PortfolioResponse>(`/portfolios/${id}/client-decision`, { method: 'POST', body })
export const getDecisions = (id: string) =>
    request<PortfolioDecisionResponse[]>(`/portfolios/${id}/decisions`)
export const getRationale = (id: string) =>
    request<RationaleResponse>(`/portfolios/${id}/rationale`)
export const getRebalancing = (id: string) =>
    request<RebalancingResponse>(`/portfolios/${id}/rebalancing`)
export function getValuation(id: string, investedOn?: string) {
    const q = investedOn ? `?invested_on=${encodeURIComponent(investedOn)}` : ''
    return request<ValuationResponse>(`/portfolios/${id}/valuation${q}`)
}

// overview — aggregating endpoints
export const getOverview = () => request<OverviewResponse>('/overview')
export const getInvestorOverview = (id: string) =>
    request<InvestorOverview>(`/investors/${id}/overview`)

// drift + audit
export const getDriftAlerts = () => request<ValuationResponse[]>('/drift-alerts')

export function getAuditLog(filters: AuditLogFilters = {}) {
    const sp = new URLSearchParams()
    if (filters.entity_id) sp.set('entity_id', filters.entity_id)
    if (filters.entity_type) sp.set('entity_type', filters.entity_type)
    if (filters.user_id) sp.set('user_id', filters.user_id)
    if (filters.action) sp.set('action', filters.action)
    if (filters.limit != null) sp.set('limit', String(filters.limit))
    const q = sp.toString() ? `?${sp}` : ''
    return request<AuditLogResponse[]>(`/audit-log${q}`)
}

// ---------- back-compat shims ----------
// These preserve the old signatures and "swallow errors" behavior of the
// original api.ts. Later steps migrate each caller to the typed functions
// above and delete the shim. Don't add new call sites for these.
//
// Legacy call sites model nullable fields as `string | undefined`, not
// `string | null`. The shims strip null → undefined at runtime and
// advertise that via NoNulls<T> so the existing component types compile
// unchanged. The primitive endpoint functions above keep the accurate
// `| null` shape.

type NoNulls<T> = { [K in keyof T]: Exclude<T[K], null> }

function stripNullFields<T>(obj: T): NoNulls<T> {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
        out[k] = v === null ? undefined : v
    }
    return out as NoNulls<T>
}

export async function createInvestor(data: InvestorCreate): Promise<NoNulls<InvestorResponse>> {
    return stripNullFields(await createInvestorApi(data))
}

export async function getInvestors(): Promise<NoNulls<InvestorResponse>[]> {
    return (await listInvestors()).map(stripNullFields)
}

export async function getInvestor(investorId: string): Promise<NoNulls<InvestorResponse>> {
    return stripNullFields(await getInvestorApi(investorId))
}

export async function updateInvestor(investorId: string, data: InvestorUpdate): Promise<NoNulls<InvestorResponse>> {
    return stripNullFields(await updateInvestorApi(investorId, data))
}

export async function getInteractions(investorId: string): Promise<NoNulls<InteractionResponse>[]> {
    try { return (await listInteractions(investorId)).map(stripNullFields) } catch { return [] }
}

export async function getAllInteractions(): Promise<NoNulls<InteractionResponse>[]> {
    return (await listInteractions()).map(stripNullFields)
}

export async function createInteraction(data: InteractionCreate): Promise<NoNulls<InteractionResponse>> {
    return stripNullFields(await createInteractionApi(data))
}

