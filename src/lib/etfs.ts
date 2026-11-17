// Frontend presentation metadata for the 8-ETF universe. Mirrors the
// tickers exposed by GET /universe but adds display-only fields the
// backend doesn't own (label, descriptive note, chart colour).
//
// All business logic — expected return, volatility, default weights by
// profile, constraint checks — is owned by the backend and reached via
// POST /optimize and POST /optimize/metrics. Nothing in here fabricates
// portfolio numbers.

export type EtfCategory = 'equity' | 'gold' | 'debt' | 'liquid'

export type Etf = {
  ticker: string
  label: string
  category: EtfCategory
  note: string
  color: string
}

export const ETFS: Etf[] = [
  { ticker: 'NIFTYBEES.NS',  label: 'Nifty 50',        category: 'equity', note: 'Broad-market equity',   color: '#6D8196' },
  { ticker: 'JUNIORBEES.NS', label: 'Nifty Next 50',   category: 'equity', note: 'Mid-cap tilt',          color: '#a0b4c4' },
  { ticker: 'BANKBEES.NS',   label: 'Bank Nifty',      category: 'equity', note: 'Banking sector',        color: '#5DCAA5' },
  { ticker: 'ITBEES.NS',     label: 'Nifty IT',        category: 'equity', note: 'IT sector',             color: '#97C459' },
  { ticker: 'PHARMABEES.NS', label: 'Nifty Pharma',    category: 'equity', note: 'Pharma sector',         color: '#c9d97a' },
  { ticker: 'GOLDBEES.NS',   label: 'Gold ETF',        category: 'gold',   note: 'Physical gold proxy',   color: '#EF9F27' },
  { ticker: 'SETF10GILT.NS', label: '10Y Gilt ETF',    category: 'debt',   note: 'Sovereign debt proxy',  color: '#8497b5' },
  { ticker: 'LIQUIDBEES.NS', label: 'Liquid Fund',     category: 'liquid', note: 'Cash proxy',            color: '#F09595' },
]

export const TICKERS = ETFS.map(e => e.ticker)

export function etf(ticker: string): Etf | undefined {
  return ETFS.find(e => e.ticker === ticker)
}

// Category rollup helper — presentation only, used by legend + donut.
// Takes decimal weights (0–1) or percentages (0–100) and returns the same
// units, grouped by category. Callers pass whatever unit they're already in.
export function aggregateByCategory(weights: Record<string, number>): Record<EtfCategory, number> {
  const agg: Record<EtfCategory, number> = { equity: 0, gold: 0, debt: 0, liquid: 0 }
  ETFS.forEach(e => { agg[e.category] += weights[e.ticker] ?? 0 })
  return agg
}
