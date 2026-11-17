"use client"
import { useState } from "react"
import {
    createInvestor, toPercent, ApiError,
    type RiskScoreResponse,
} from "@/lib/api"
import RiskQuestionnaire from "@/components/RiskQuestionnaire"
import { inputStyle, labelStyle, buttonStyle, backButtonStyle } from "@/lib/styles"

// Sector names shown in the UI. The three in-universe sectors (Banking, IT,
// Pharma) map to single ETFs; the backend's optimizer will honour exclusions
// on those. Other sectors are recorded in preferences_constraints but can't
// be enforced with the current 8-ETF universe — they'll surface as
// "unmatched" on the resulting portfolio.
const sectors = [
    "Banking", "IT", "Pharma",
    "Tobacco", "Weapons", "Fossil Fuels", "Gambling", "Alcohol", "Cannabis",
]

// ── SHARED HELPERS (outside component — React rule) ──────────────────────────

// progress bar at the top of each step
function ProgressBar({ step, total }: { step: number; total: number }) {
    return (
        <div style={{ display: "flex", gap: "4px", marginBottom: "48px" }}>
            {Array.from({ length: total }).map((_, i) => (
                <div key={i} style={{
                    height: "3px", flex: 1, borderRadius: "2px",
                    backgroundColor: i < step ? "var(--ivory)" : "rgba(255,255,255,0.2)",
                    transition: "background-color 0.3s ease"
                }} />
            ))}
        </div>
    )
}

// section title + subtitle
function StepHeader({ title, subtitle }: { title: string; subtitle: string }) {
    return (
        <div style={{ marginBottom: "36px" }}>
            <h1 style={{
                fontFamily: "var(--font-heading)", fontSize: "32px",
                fontWeight: 700, color: "var(--ivory)", marginBottom: "8px"
            }}>{title}</h1>
            <p style={{
                fontFamily: "var(--font-body)", fontSize: "15px",
                color: "rgba(255,255,255,0.5)"
            }}>{subtitle}</p>
        </div>
    )
}

// Inline error message shown under a field. Pass empty string to render nothing.
function FieldError({ message }: { message: string }) {
    if (!message) return null
    return (
        <p style={{
            marginTop: 6, fontSize: 12, color: "#F09595",
            fontFamily: "var(--font-body)",
        }}>{message}</p>
    )
}

// ── validators ───────────────────────────────────────────────────────────────
// Each returns an error string (empty = valid). They're pure functions so the
// Next button can derive disabled state from the same checks the UI shows.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MIN_INVESTMENT = 10_000

function validateName(v: string): string {
    const t = v.trim()
    if (!t) return "Please enter your name."
    if (t.length < 2) return "Name is too short."
    return ""
}
function validateEmail(v: string): string {
    const t = v.trim()
    if (!t) return "Email is required."
    if (!EMAIL_RE.test(t)) return "That doesn't look like a valid email."
    return ""
}
function validateMobile(v: string): string {
    if (!v) return "Mobile number is required."
    if (v.length !== 10) return "Enter a 10-digit mobile number."
    if (!/^[6-9]\d{9}$/.test(v)) return "Indian mobile numbers start with 6, 7, 8 or 9."
    return ""
}
function validateInvestment(v: string): string {
    if (!v) return "Enter an initial investment."
    const n = Number(v)
    if (!Number.isFinite(n)) return "Please enter a number."
    if (n <= 0) return "Investment must be greater than zero."
    if (n < MIN_INVESTMENT) return `Minimum initial investment is ₹${MIN_INVESTMENT.toLocaleString("en-IN")}.`
    return ""
}
function validateAge(v: string): string {
    if (!v) return "Age is required."
    const n = Number(v)
    if (!Number.isInteger(n)) return "Age must be a whole number."
    if (n < 18) return "Investor must be at least 18."
    if (n > 100) return "Please enter a realistic age."
    return ""
}

// ── MAIN COMPONENT ────────────────────────────────────────────────────────────

export default function InvestorOnboarding() {

    // step controls which screen is shown (1-6)
    const [step, setStep] = useState(1)

    // step 1 — basic info
    const [name, setName] = useState("")
    const [email, setEmail] = useState("")
    const [mobile, setMobile] = useState("")
    const [initialInvestment, setInitialInvestment] = useState("")

    // step 2 — demographics (saved as JSON in DB)
    const [age, setAge] = useState("")
    const [incomeStability, setIncomeStability] = useState("")

    // step 3 — sector exclusions (saved as JSON in DB)
    const [excludedSectors, setExcludedSectors] = useState<string[]>([])

    // from questionnaire (step 4) — the raw answers and the server's preview score
    const [riskAnswers, setRiskAnswers] = useState<Record<string, number>>({})
    const [riskPreview, setRiskPreview] = useState<RiskScoreResponse | null>(null)
    const [submitError, setSubmitError] = useState('')
    const [submitting, setSubmitting] = useState(false)

    // toggles a sector in/out of excluded list
    function toggleSector(sector: string) {
        setExcludedSectors(prev =>
            prev.includes(sector)
                ? prev.filter(s => s !== sector)  // remove if already excluded
                : [...prev, sector]                // add if not excluded
        )
    }

    // called by RiskQuestionnaire after it fetches a preview score from the backend
    function handleQuestionnaireComplete(answers: Record<string, number>, preview: RiskScoreResponse) {
        setRiskAnswers(answers)
        setRiskPreview(preview)
        setStep(5)
    }

    // final submit — sends everything including the raw risk_answers so the
    // backend creates the investor, persists a real RiskAssessment, and sets
    // risk_score and investment_horizon from its own scoring (authoritative).
    async function handleFinalSubmit() {
        if (!riskPreview) return
        setSubmitting(true)
        setSubmitError('')
        try {
            await createInvestor({
                name,
                total_aum: Number(initialInvestment),
                demographics: { age: Number(age), income_stability: incomeStability, email, mobile },
                preferences_constraints: { excluded_sectors: excludedSectors },
                risk_answers: riskAnswers,
                assigned_manager_id: "manager-001",  // hardcoded until auth is built
            })
            setStep(6)
        } catch (e) {
            setSubmitError(e instanceof ApiError ? e.message : 'Could not create the investor. Please try again.')
        } finally {
            setSubmitting(false)
        }
    }

    const screen = (children: React.ReactNode) => (
        <div style={{
            width: "100%", minHeight: "100%",
            backgroundColor: "var(--charcoal)",
            display: "flex",
            flex: 1,
        }}>
            <div style={{
                flex: 1, padding: "48px 56px",
                display: "flex", flexDirection: "column", justifyContent: "flex-start",
                maxWidth: "720px"
            }}>
                {children}
            </div>
        </div>
    )

    // ── STEP 1 — Basic Info ──────────────────────────────────────────────────
    if (step === 1) {
        const nameErr = validateName(name)
        const emailErr = validateEmail(email)
        const mobileErr = validateMobile(mobile)
        const investErr = validateInvestment(initialInvestment)
        const canNext = !nameErr && !emailErr && !mobileErr && !investErr

        return screen(
            <>
                <ProgressBar step={1} total={5} />
                <StepHeader title="Let&apos;s get started" subtitle="Tell us a bit about yourself" />

                <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
                    <div>
                        <label style={labelStyle}>Full Name</label>
                        <input
                            value={name}
                            onChange={e => setName(e.target.value)}
                            placeholder="e.g. Raj Mehta"
                            maxLength={80}
                            style={inputStyle}
                        />
                        {name && <FieldError message={nameErr} />}
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
                        <div>
                            <label style={labelStyle}>Email</label>
                            <input
                                type="email"
                                value={email}
                                onChange={e => setEmail(e.target.value)}
                                placeholder="raj@example.com"
                                maxLength={120}
                                style={inputStyle}
                            />
                            {email && <FieldError message={emailErr} />}
                        </div>
                        <div>
                            <label style={labelStyle}>Mobile</label>
                            <input
                                type="tel"
                                inputMode="numeric"
                                value={mobile}
                                onChange={e => setMobile(e.target.value.replace(/\D/g, '').slice(0, 10))}
                                placeholder="10-digit number"
                                maxLength={10}
                                style={inputStyle}
                            />
                            {mobile && <FieldError message={mobileErr} />}
                        </div>
                    </div>

                    <div>
                        <label style={labelStyle}>Initial Investment (₹)</label>
                        <input
                            type="number"
                            inputMode="numeric"
                            min={MIN_INVESTMENT}
                            step={1000}
                            value={initialInvestment}
                            onChange={e => setInitialInvestment(e.target.value)}
                            placeholder={`min ₹${MIN_INVESTMENT.toLocaleString('en-IN')}`}
                            style={inputStyle}
                        />
                        {initialInvestment && <FieldError message={investErr} />}
                    </div>
                </div>

                <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "40px" }}>
                    <button onClick={() => setStep(2)} disabled={!canNext} style={buttonStyle(!canNext)}>
                        Next →
                    </button>
                </div>
            </>
        )
    }

    // ── STEP 2 — Demographics ────────────────────────────────────────────────
    if (step === 2) {
        const ageErr = validateAge(age)
        const canNext = !ageErr && !!incomeStability

        return screen(
            <>
                <ProgressBar step={2} total={5} />
                <StepHeader title="Your background" subtitle="This helps us understand your financial situation" />

                <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
                    <div>
                        <label style={labelStyle}>Age</label>
                        <input
                            type="number"
                            inputMode="numeric"
                            min={18}
                            max={100}
                            step={1}
                            value={age}
                            onChange={e => setAge(e.target.value)}
                            placeholder="18 – 100"
                            style={inputStyle}
                        />
                        {age && <FieldError message={ageErr} />}
                    </div>
                    <div>
                        <label style={labelStyle}>Income Stability</label>
                        <select value={incomeStability} onChange={e => setIncomeStability(e.target.value)}
                            style={{ ...inputStyle, appearance: "none" as const }}>
                            <option value="">Select one...</option>
                            <option value="highly_stable">Highly Stable</option>
                            <option value="moderately_stable">Moderately Stable</option>
                            <option value="unstable">Unstable</option>
                        </select>
                    </div>
                </div>

                <div style={{ display: "flex", justifyContent: "space-between", marginTop: "40px" }}>
                    <button onClick={() => setStep(1)} style={backButtonStyle}>← Back</button>
                    <button onClick={() => setStep(3)} disabled={!canNext} style={buttonStyle(!canNext)}>
                        Next →
                    </button>
                </div>
            </>
        )
    }

    // ── STEP 3 — Sector Exclusions ───────────────────────────────────────────
    if (step === 3) return screen(
        <>
            <ProgressBar step={3} total={5} />
            <StepHeader title="Sector exclusions" subtitle="Select any sectors you'd like kept out of your portfolio" />

            {/* 2-column grid of toggle cards */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                {sectors.map(sector => {
                    const active = excludedSectors.includes(sector)
                    return (
                        <div key={sector} onClick={() => toggleSector(sector)} style={{
                            padding: "14px 16px", borderRadius: "8px", cursor: "pointer",
                            border: `1px solid ${active ? "var(--ivory)" : "rgba(255,255,255,0.15)"}`,
                            backgroundColor: active ? "rgba(255,255,227,0.08)" : "transparent",
                            display: "flex", alignItems: "center", gap: "10px",
                            transition: "all 0.15s ease"
                        }}>
                            {/* custom checkbox */}
                            <div style={{
                                width: "16px", height: "16px", borderRadius: "3px", flexShrink: 0,
                                border: `2px solid ${active ? "var(--ivory)" : "rgba(255,255,255,0.3)"}`,
                                backgroundColor: active ? "var(--ivory)" : "transparent",
                                display: "flex", alignItems: "center", justifyContent: "center"
                            }}>
                                {active && <span style={{ color: "var(--charcoal)", fontSize: "10px", fontWeight: 700 }}>✓</span>}
                            </div>
                            <span style={{
                                fontFamily: "var(--font-body)", fontSize: "13px",
                                color: active ? "var(--ivory)" : "rgba(255,255,255,0.7)"
                            }}>{sector}</span>
                        </div>
                    )
                })}
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", marginTop: "40px" }}>
                <button onClick={() => setStep(2)} style={backButtonStyle}>← Back</button>
                {/* sector exclusions optional — no disabled state */}
                <button onClick={() => setStep(4)} style={buttonStyle(false)}>Next →</button>
            </div>
        </>
    )

    // ── STEP 4 — Risk Questionnaire ──────────────────────────────────────────
    // RiskQuestionnaire is full screen itself — no wrapper needed
    if (step === 4) return (
        <RiskQuestionnaire onComplete={handleQuestionnaireComplete} />
    )

    // ── STEP 5 — Confirmation ────────────────────────────────────────────────
    if (step === 5) return screen(
        <>
            <ProgressBar step={5} total={5} />
            <StepHeader title="Review your profile" subtitle="Confirm everything looks right before submitting" />

            {/* summary rows */}
            <div style={{ display: "flex", flexDirection: "column" }}>
                {[
                    ["Name", name],
                    ["Email", email],
                    ["Mobile", mobile],
                    ["Initial Investment", `₹${Number(initialInvestment).toLocaleString()}`],
                    ["Age", age],
                    ["Income Stability", incomeStability.replace(/_/g, " ")],
                    ["Excluded Sectors", excludedSectors.join(", ") || "None"],
                    ["Risk Profile", riskPreview ? riskPreview.bucket.toUpperCase() : "—"],
                    ["Risk Capacity", riskPreview ? String(riskPreview.capacity_score) : "—"],
                    ["Risk Tolerance", riskPreview ? String(riskPreview.tolerance_score) : "—"],
                    ["Limited By", riskPreview ? riskPreview.limited_by : "—"],
                    ["Investment Horizon", riskPreview ? riskPreview.horizon.replace(/_/g, " ") : "—"],
                    ["Equity Band", riskPreview ? `${toPercent(riskPreview.min_equity)}% – ${toPercent(riskPreview.max_equity)}%` : "—"],
                ].map(([label, value]) => (
                    <div key={label} style={{
                        display: "flex", justifyContent: "space-between", alignItems: "center",
                        padding: "12px 0",
                        borderBottom: "1px solid rgba(255,255,255,0.08)"
                    }}>
                        <span style={{
                            fontFamily: "var(--font-body)", fontSize: "11px",
                            color: "rgba(255,255,255,0.4)", textTransform: "uppercase",
                            letterSpacing: "0.08em"
                        }}>{label}</span>
                        <span style={{
                            fontFamily: "var(--font-mono)", fontSize: "13px",
                            color: "var(--ivory)"
                        }}>{value}</span>
                    </div>
                ))}
            </div>

            {riskPreview && riskPreview.notes.length > 0 && (
                <div style={{ marginTop: 24 }}>
                    <p style={{
                        fontFamily: "var(--font-mono)", fontSize: 11,
                        color: "rgba(255,255,255,0.4)", textTransform: "uppercase",
                        letterSpacing: "0.08em", marginBottom: 10,
                    }}>Notes from the scorer</p>
                    <ul style={{
                        paddingLeft: 18, fontFamily: "var(--font-body)", fontSize: 13,
                        color: "rgba(255,255,255,0.75)", lineHeight: 1.7,
                    }}>
                        {riskPreview.notes.map((n, i) => <li key={i}>{n}</li>)}
                    </ul>
                </div>
            )}

            {submitError && (
                <p style={{
                    marginTop: 20, color: "#F09595",
                    fontFamily: "var(--font-body)", fontSize: 13,
                }}>
                    {submitError}
                </p>
            )}

            <div style={{ display: "flex", justifyContent: "space-between", marginTop: "32px" }}>
                <button onClick={() => setStep(4)} style={backButtonStyle} disabled={submitting}>← Back</button>
                <button onClick={handleFinalSubmit} style={buttonStyle(submitting || !riskPreview)} disabled={submitting || !riskPreview}>
                    {submitting ? 'Submitting…' : 'Confirm & Submit'}
                </button>
            </div>
        </>
    )

    // ── STEP 6 — Success ─────────────────────────────────────────────────────
    return screen(
        <div style={{ textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: "16px" }}>
            <div style={{
                width: "60px", height: "60px", borderRadius: "50%",
                border: "2px solid var(--ivory)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: "24px", color: "var(--ivory)", marginBottom: "8px"
            }}>✓</div>

            <h1 style={{
                fontFamily: "var(--font-heading)", fontSize: "28px",
                color: "var(--ivory)", fontWeight: 700
            }}>Profile created</h1>

            <p style={{
                fontFamily: "var(--font-body)", fontSize: "15px",
                color: "rgba(255,255,255,0.5)", maxWidth: "360px", lineHeight: 1.7
            }}>
                Welcome, {name}. Your risk profile is{" "}
                <span style={{ fontFamily: "var(--font-mono)", color: "var(--ivory)", fontWeight: 600 }}>
                    {riskPreview ? riskPreview.bucket.toUpperCase() : '—'}
                </span>
                . A manager will be in touch shortly.
            </p>
        </div>
    )
}