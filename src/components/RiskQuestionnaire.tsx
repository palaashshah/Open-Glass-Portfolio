"use client"
import { useEffect, useMemo, useState } from "react"
import { questions as questionText } from "@/lib/questions"
import { buttonStyleDark, backButtonStyleLight } from "@/lib/styles"
import {
    getQuestionnaireMeta, scoreRisk, toPercent,
    ApiError,
    type QuestionnaireMeta, type RiskScoreResponse,
} from "@/lib/api"

// Backend returns {id, options, group} per question but no text; we look the
// text up from questions.ts by id. If a qid returned by the server isn't in
// questions.ts the question still renders with a fallback label — the shape
// stays driven by the server.

type Props = {
    onComplete: (answers: Record<string, number>, preview: RiskScoreResponse) => void
}

type Phase = 'loading-meta' | 'meta-error' | 'answering' | 'submitting' | 'results'

export default function RiskQuestionnaire({ onComplete }: Props) {
    const [phase, setPhase] = useState<Phase>('loading-meta')
    const [meta, setMeta] = useState<QuestionnaireMeta | null>(null)
    const [metaError, setMetaError] = useState<string>('')

    // index into meta.questions; answers map keyed by question id (as string, matching the backend payload)
    const [currentIndex, setCurrentIndex] = useState(0)
    const [answers, setAnswers] = useState<Record<string, number>>({})
    const [submitError, setSubmitError] = useState<string>('')
    const [preview, setPreview] = useState<RiskScoreResponse | null>(null)

    useEffect(() => {
        let cancelled = false
        getQuestionnaireMeta()
            .then(m => { if (!cancelled) { setMeta(m); setPhase('answering') } })
            .catch(e => {
                if (cancelled) return
                setMetaError(e instanceof ApiError ? e.message : 'Could not load the questionnaire. Is the backend running?')
                setPhase('meta-error')
            })
        return () => { cancelled = true }
    }, [])

    const textById = useMemo(() => {
        const m = new Map<number, typeof questionText[number]>()
        for (const q of questionText) m.set(q.id, q)
        return m
    }, [])

    if (phase === 'loading-meta') {
        return <CenteredMessage>Loading questionnaire…</CenteredMessage>
    }
    if (phase === 'meta-error' || !meta) {
        return <CenteredMessage tone="error">{metaError || 'Failed to load questionnaire.'}</CenteredMessage>
    }

    if (phase === 'results' && preview) {
        return <ResultsPanel preview={preview} onContinue={() => onComplete(answers, preview)} />
    }

    const serverQuestion = meta.questions[currentIndex]
    const textEntry = textById.get(serverQuestion.id)
    const selected = answers[String(serverQuestion.id)] ?? null
    const isLast = currentIndex === meta.questions.length - 1

    async function handleContinue() {
        if (selected === null) return
        const nextAnswers = { ...answers, [String(serverQuestion.id)]: selected }
        setAnswers(nextAnswers)

        if (!isLast) {
            setCurrentIndex(i => i + 1)
            return
        }

        // Last question — submit for preview scoring.
        setPhase('submitting')
        setSubmitError('')
        try {
            const result = await scoreRisk({ answers: nextAnswers })
            setPreview(result)
            setPhase('results')
        } catch (e) {
            setSubmitError(e instanceof ApiError ? e.message : 'Could not score your answers. Please try again.')
            setPhase('answering')  // let them retry by hitting Continue again
        }
    }

    return (
        <div style={{
            display: "flex", minHeight: "100%", width: "100%", flex: 1,
            backgroundColor: "var(--charcoal)"
        }}>
            {/* ── LEFT SIDEBAR ── */}
            <div style={{
                width: "280px", flexShrink: 0,
                backgroundColor: "var(--charcoal)",
                borderRight: "1px solid rgba(255,255,255,0.1)",
                padding: "48px 24px",
                display: "flex", flexDirection: "column", gap: "4px"
            }}>
                <p style={{
                    fontFamily: "var(--font-heading)", fontSize: "11px",
                    fontWeight: 700, letterSpacing: "0.15em",
                    textTransform: "uppercase", color: "rgba(255,255,255,0.4)",
                    marginBottom: "32px"
                }}>Questionnaire</p>

                {meta.questions.map((q, index) => {
                    const isDone = index < currentIndex
                    const isCurrent = index === currentIndex
                    const text = textById.get(q.id)
                    const label = text?.sidebarLabel ?? `Question ${index + 1}`
                    return (
                        <div key={q.id} style={{
                            display: "flex", alignItems: "center", gap: "12px",
                            padding: "10px 12px", borderRadius: "8px",
                            backgroundColor: isCurrent ? "rgba(255,255,255,0.08)" : "transparent",
                            opacity: index > currentIndex ? 0.35 : 1,
                            transition: "all 0.2s ease"
                        }}>
                            <div style={{
                                width: "26px", height: "26px", borderRadius: "50%", flexShrink: 0,
                                backgroundColor: isDone ? "var(--slate)" : isCurrent ? "rgba(255,255,255,0.15)" : "transparent",
                                border: `1.5px solid ${isDone ? "var(--slate)" : isCurrent ? "rgba(255,255,255,0.4)" : "rgba(255,255,255,0.2)"}`,
                                display: "flex", alignItems: "center", justifyContent: "center"
                            }}>
                                {isDone
                                    ? <span style={{ color: "var(--ivory)", fontSize: "11px" }}>✓</span>
                                    : <span style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "rgba(255,255,255,0.6)" }}>{index + 1}</span>
                                }
                            </div>
                            <span style={{
                                fontFamily: "var(--font-body)", fontSize: "13px",
                                color: isCurrent ? "var(--ivory)" : "rgba(255,255,255,0.6)",
                                fontWeight: isCurrent ? 600 : 400
                            }}>{label}</span>
                        </div>
                    )
                })}
            </div>

            {/* ── RIGHT CONTENT ── */}
            <div style={{
                flex: 1, backgroundColor: "var(--ivory)",
                padding: "56px 64px",
                display: "flex", flexDirection: "column", justifyContent: "space-between"
            }}>
                <div>
                    <p style={{
                        fontFamily: "var(--font-mono)", fontSize: "11px",
                        color: "var(--slate)", letterSpacing: "0.12em",
                        textTransform: "uppercase", marginBottom: "20px"
                    }}>
                        {serverQuestion.group === 'capacity' ? 'Risk Capacity' : 'Risk Tolerance'} ·
                        Step {currentIndex + 1} of {meta.questions.length}
                    </p>

                    <h2 style={{
                        fontFamily: "var(--font-heading)", fontSize: "28px",
                        color: "var(--charcoal)", fontWeight: 700,
                        lineHeight: 1.3, marginBottom: "40px", maxWidth: "560px"
                    }}>
                        {textEntry?.question ?? `Question ${serverQuestion.id}`}
                    </h2>

                    <div style={{ display: "flex", flexDirection: "column", gap: "12px", maxWidth: "600px" }}>
                        {Array.from({ length: serverQuestion.options }).map((_, i) => {
                            const optLabel = textEntry?.options[i]?.label ?? `Option ${i + 1}`
                            return (
                                <div
                                    key={i}
                                    onClick={() => setAnswers(a => ({ ...a, [String(serverQuestion.id)]: i }))}
                                    style={{
                                        display: "flex", alignItems: "center", gap: "16px",
                                        padding: "16px 20px", borderRadius: "10px", cursor: "pointer",
                                        border: `1.5px solid ${selected === i ? "var(--slate)" : "var(--silver)"}`,
                                        backgroundColor: selected === i ? "rgba(109,129,150,0.12)" : "transparent",
                                        transition: "all 0.15s ease"
                                    }}
                                >
                                    <div style={{
                                        width: "18px", height: "18px", borderRadius: "50%", flexShrink: 0,
                                        border: `2px solid ${selected === i ? "var(--slate)" : "var(--silver)"}`,
                                        backgroundColor: selected === i ? "var(--slate)" : "transparent",
                                        transition: "all 0.15s ease"
                                    }} />
                                    <span style={{
                                        fontFamily: "var(--font-body)", fontSize: "15px",
                                        color: "var(--charcoal)", lineHeight: 1.4
                                    }}>
                                        {optLabel}
                                    </span>
                                </div>
                            )
                        })}
                    </div>

                    {submitError && (
                        <p style={{
                            marginTop: 20, color: "#c0392b",
                            fontFamily: "var(--font-body)", fontSize: 13,
                        }}>
                            {submitError}
                        </p>
                    )}
                </div>

                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "40px" }}>
                    <button
                        onClick={() => { if (currentIndex > 0) setCurrentIndex(i => i - 1) }}
                        style={{ ...backButtonStyleLight, opacity: currentIndex === 0 ? 0 : 1 }}
                    >
                        ← Back
                    </button>

                    <button
                        onClick={handleContinue}
                        disabled={selected === null || phase === 'submitting'}
                        style={buttonStyleDark(selected === null || phase === 'submitting')}
                    >
                        {phase === 'submitting' ? 'Scoring…' : isLast ? 'See my profile' : 'Continue'}
                    </button>
                </div>
            </div>
        </div>
    )
}

// ---------- subcomponents ----------

function CenteredMessage({ children, tone = 'muted' as const }: { children: React.ReactNode; tone?: 'muted' | 'error' }) {
    return (
        <div style={{
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
            backgroundColor: 'var(--charcoal)', color: tone === 'error' ? '#F09595' : 'rgba(255,255,255,0.65)',
            fontFamily: 'var(--font-body)', fontSize: 14, padding: 40, textAlign: 'center',
        }}>
            {children}
        </div>
    )
}

function ResultsPanel({ preview, onContinue }: { preview: RiskScoreResponse; onContinue: () => void }) {
    return (
        <div style={{
            flex: 1, backgroundColor: 'var(--ivory)', padding: '56px 64px',
            display: 'flex', flexDirection: 'column', gap: 28, maxWidth: 780,
        }}>
            <div>
                <p style={{
                    fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--slate)',
                    letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 12,
                }}>Scored by the server</p>
                <h2 style={{
                    fontFamily: 'var(--font-heading)', fontSize: 28, color: 'var(--charcoal)',
                    fontWeight: 700, marginBottom: 6,
                }}>
                    Your risk profile is <span style={{ color: 'var(--slate)' }}>{titleCase(preview.bucket)}</span>
                </h2>
                <p style={{ fontFamily: 'var(--font-body)', fontSize: 14, color: 'var(--slate)' }}>
                    Horizon {preview.horizon.replace(/_/g, ' ')} · overall score {preview.score} · limited by {preview.limited_by}
                </p>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <ScoreBar label="Risk capacity" score={preview.capacity_score} highlight={preview.limited_by === 'capacity'} />
                <ScoreBar label="Risk tolerance" score={preview.tolerance_score} highlight={preview.limited_by === 'tolerance'} />
            </div>

            <div>
                <p style={{
                    fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--slate)',
                    letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 10,
                }}>Equity band</p>
                <p style={{ fontFamily: 'var(--font-body)', fontSize: 14, color: 'var(--charcoal)' }}>
                    {toPercent(preview.min_equity)}% – {toPercent(preview.max_equity)}% equity
                </p>
            </div>

            {preview.notes.length > 0 && (
                <div>
                    <p style={{
                        fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--slate)',
                        letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 10,
                    }}>Notes</p>
                    <ul style={{ paddingLeft: 18, color: 'var(--charcoal)', fontFamily: 'var(--font-body)', fontSize: 14, lineHeight: 1.6 }}>
                        {preview.notes.map((n, i) => <li key={i}>{n}</li>)}
                    </ul>
                </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
                <button onClick={onContinue} style={buttonStyleDark(false)}>
                    Continue to review →
                </button>
            </div>
        </div>
    )
}

function ScoreBar({ label, score, highlight }: { label: string; score: number; highlight: boolean }) {
    const pct = Math.max(0, Math.min(100, score))
    return (
        <div style={{
            border: `1px solid ${highlight ? 'var(--slate)' : 'var(--silver)'}`,
            borderRadius: 10, padding: '14px 16px',
            background: highlight ? 'rgba(109,129,150,0.08)' : 'transparent',
        }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
                <span style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--charcoal)' }}>{label}</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 16, color: 'var(--charcoal)', fontWeight: 600 }}>{score}</span>
            </div>
            <div style={{ height: 6, borderRadius: 3, background: 'rgba(0,0,0,0.08)', overflow: 'hidden' }}>
                <div style={{
                    width: `${pct}%`, height: '100%',
                    background: 'var(--slate)', transition: 'width 0.4s ease',
                }} />
            </div>
            {highlight && (
                <p style={{
                    marginTop: 8, fontFamily: 'var(--font-mono)', fontSize: 10,
                    color: 'var(--slate)', letterSpacing: '0.1em', textTransform: 'uppercase',
                }}>Governs the portfolio</p>
            )}
        </div>
    )
}

function titleCase(s: string): string {
    return s ? s[0].toUpperCase() + s.slice(1).toLowerCase() : s
}
