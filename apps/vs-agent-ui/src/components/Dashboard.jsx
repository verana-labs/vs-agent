import { useState, useEffect } from 'react'
import { getDidDocument } from '../api'

export default function Dashboard() {
  const [doc, setDoc] = useState(null)
  const [cvpCount, setCvpCount] = useState(null)
  const [jscCount, setJscCount] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    getDidDocument()
      .then(d => {
        setDoc(d)
        const vprServices = (d.service ?? []).filter(s => (s.id?.split('#')[1] ?? '').startsWith('vpr'))
        setCvpCount(vprServices.filter(s => (s.id?.split('#')[1] ?? '').endsWith('-c-vp')).length)
        setJscCount(vprServices.filter(s => (s.id?.split('#')[1] ?? '').endsWith('-jsc-vp')).length)
      })
      .catch(err => setError(err.message))
  }, [])

  if (error) return <p className="error-msg">{error}</p>
  if (!doc) return <p className="loading">Loading...</p>

  const endpoints = (doc.service ?? [])
    .filter(s => s.type === 'did-communication')
    .map(s => s.serviceEndpoint)

  return (
    <div>
      <p style={{ color: '#6b7280', fontSize: 14, marginBottom: 24 }}>
        Monitor and manage your VS Agent configuration
      </p>

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 15, fontWeight: 600, color: '#111827', marginBottom: 16 }}>
          VS Agent Information
        </h2>

        <div className="agent-info-card">
          <div className="agent-info-row">
            <span className="agent-info-label">Public DID</span>
            <span className="agent-info-value agent-info-mono">
              {doc.id ?? <span style={{ color: '#9ca3af' }}>Not assigned</span>}
            </span>
          </div>

          {endpoints.length > 0 && (
            <div className="agent-info-row">
              <span className="agent-info-label">Endpoints</span>
              <span className="agent-info-value agent-info-mono">
                {endpoints.join(', ')}
              </span>
            </div>
          )}
        </div>
      </section>

      <section>
        <h2 style={{ fontSize: 15, fontWeight: 600, color: '#111827', marginBottom: 16 }}>
          Summary
        </h2>

        <div className="cards-grid">
          <div className="card">
            <div className="card-icon">🪪</div>
            <div className="card-label">Linked Credentials</div>
            <div className="card-value">{cvpCount ?? '—'}</div>
          </div>
          <div className="card">
            <div className="card-icon">📋</div>
            <div className="card-label">Schema Credentials</div>
            <div className="card-value">{jscCount ?? '—'}</div>
          </div>
        </div>
      </section>
    </div>
  )
}
