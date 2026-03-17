import { useState, useEffect } from 'react'
import { getAgent, getCredentials } from '../api'

export default function Dashboard() {
  const [agent, setAgent] = useState(null)
  const [credentialCount, setCredentialCount] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    Promise.all([getAgent(), getCredentials()])
      .then(([agentData, creds]) => {
        setAgent(agentData)
        setCredentialCount(creds?.meta?.totalItems ?? (Array.isArray(creds) ? creds.length : '—'))
      })
      .catch(err => setError(err.message))
  }, [])

  if (error) return <p className="error-msg">{error}</p>
  if (!agent) return <p className="loading">Loading...</p>

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
            <span className="agent-info-label">Label</span>
            <span className="agent-info-value">{agent.label ?? '—'}</span>
          </div>

          <div className="agent-info-row">
            <span className="agent-info-label">Status</span>
            <span className="agent-info-value">
              <span className={`status-pill ${agent.isInitialized ? 'status-pill--ok' : 'status-pill--warn'}`}>
                {agent.isInitialized ? 'Initialized' : 'Not initialized'}
              </span>
            </span>
          </div>

          <div className="agent-info-row">
            <span className="agent-info-label">Public DID</span>
            <span className="agent-info-value agent-info-mono">
              {agent.publicDid ?? <span style={{ color: '#9ca3af' }}>Not assigned</span>}
            </span>
          </div>

          {agent.endpoints?.length > 0 && (
            <div className="agent-info-row">
              <span className="agent-info-label">Endpoints</span>
              <span className="agent-info-value agent-info-mono">
                {agent.endpoints.join(', ')}
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
            <div className="card-value">{credentialCount ?? '—'}</div>
          </div>
        </div>
      </section>
    </div>
  )
}
