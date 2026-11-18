'use client'
import { useState } from "react"
import { updateInvestor, ApiError } from '@/lib/api'

type EditProfileFormProps = {
  investorId: string
  investor: {
    name: string
    total_aum?: number
    investment_horizon?: string
    risk_score?: string
  }
}

// risk_score and investment_horizon are owned by the backend's risk scorer.
// Showing them as editable here would let the manager silently overwrite the
// bucket the optimizer actually used — the result would be a screen that
// disagrees with the portfolio. This form only edits name + AUM; the other
// two are read-only labels. To change them, re-run the questionnaire.

export default function EditProfileForm({ investorId, investor }: EditProfileFormProps) {
  const [name, setName] = useState(investor.name)
  const [totalaum, setTotalAum] = useState(investor.total_aum ?? 0)
  const [isLoading, setIsLoading] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit() {
    if (!name) return
    setIsLoading(true)
    setError('')
    try {
      await updateInvestor(investorId, {
        name,
        total_aum: Number(totalaum),
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save profile changes.')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div style={{
      background: 'rgba(255,255,227,0.06)',
      border: '0.5px solid rgba(203,203,203,0.15)',
      borderRadius: '12px',
      padding: '1.25rem',
      marginBottom: '1.5rem',
    }}>
      <p style={{ fontSize: '12px', color: '#CBCBCB', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '1rem' }}>
        Edit Profile
      </p>

      <div style={{ marginBottom: '1rem' }}>
        <label style={{ fontSize: '12px', color: '#CBCBCB', display: 'block', marginBottom: '6px' }}>Name</label>
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          style={{
            width: '100%', boxSizing: 'border-box',
            background: 'rgba(255,255,227,0.05)',
            border: '0.5px solid rgba(203,203,203,0.2)',
            borderRadius: '8px', padding: '8px 12px',
            fontSize: '13px', color: '#FFFFE3', outline: 'none',
          }}
        />
      </div>

      <div style={{ marginBottom: '1rem' }}>
        <label style={{ fontSize: '12px', color: '#CBCBCB', display: 'block', marginBottom: '6px' }}>Assets Under Management (₹)</label>
        <input
          type="number"
          min={0}
          value={totalaum}
          onChange={e => setTotalAum(Number(e.target.value))}
          style={{
            width: '100%', boxSizing: 'border-box',
            background: 'rgba(255,255,227,0.05)',
            border: '0.5px solid rgba(203,203,203,0.2)',
            borderRadius: '8px', padding: '8px 12px',
            fontSize: '13px', color: '#FFFFE3', outline: 'none',
          }}
        />
      </div>

      {/* Read-only backend-computed fields. These change only when a new
          risk assessment is scored, so letting the manager edit them here
          would silently override the bucket the optimizer actually used. */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: '1.25rem' }}>
        <ReadOnlyField label="Investment Horizon" value={investor.investment_horizon} />
        <ReadOnlyField label="Risk Profile" value={investor.risk_score} />
      </div>
      <p style={{ fontSize: 11, color: '#6D8196', marginBottom: '1rem' }}>
        Horizon and risk profile come from the latest risk assessment. To change them, re-run the questionnaire from Investor Intake.
      </p>

      {error && (
        <p style={{ fontSize: 12, color: '#F09595', marginBottom: 10 }}>{error}</p>
      )}

      <button
        onClick={handleSubmit}
        disabled={isLoading || !name}
        style={{
          padding: '8px 20px', borderRadius: '8px', border: 'none',
          fontSize: '13px', fontWeight: 500,
          cursor: isLoading ? 'not-allowed' : 'pointer',
          background: saved ? '#97C459' : isLoading ? 'rgba(109,129,150,0.3)' : '#6D8196',
          color: '#FFFFE3',
          transition: 'background 0.2s',
        }}
      >
        {saved ? 'Saved ✓' : isLoading ? 'Saving...' : 'Save changes'}
      </button>
    </div>
  )
}

function ReadOnlyField({ label, value }: { label: string; value?: string }) {
  return (
    <div>
      <p style={{ fontSize: 12, color: '#CBCBCB', marginBottom: 6 }}>{label}</p>
      <p style={{
        fontSize: 13, color: '#FFFFE3', textTransform: 'capitalize' as const,
        padding: '8px 12px', borderRadius: 8,
        background: 'rgba(255,255,255,0.03)',
        border: '0.5px dashed rgba(203,203,203,0.2)',
      }}>
        {value ? value.replace(/_/g, ' ') : '—'}
      </p>
    </div>
  )
}
