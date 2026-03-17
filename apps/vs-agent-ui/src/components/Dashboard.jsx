import { useState, useEffect } from 'react'
import { getAgent, getConnections, getCredentials } from '../api'

export default function Dashboard() {
  const [agent, setAgent] = useState(null)
  const [connectionCount, setConnectionCount] = useState(null)
  const [credentialCount, setCredentialCount] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    Promise.all([getAgent(), getConnections(), getCredentials()])
      .then(([agentData, conns, creds]) => {
        setAgent(agentData)
        setConnectionCount(Array.isArray(conns) ? conns.length : conns?.total ?? '—')
        setCredentialCount(Array.isArray(creds) ? creds.length : creds?.total ?? '—')
      })
      .catch(err => setError(err.message))
  }, [])

  if (error) return <p className="error-msg">{error}</p>
  if (!agent) return <p className="loading">Loading...</p>

  return (
    <div>
      <p style={{ color: '#6b7280', fontSize: 14, marginBottom: 24 }}>
        Monitor network status and manage your VS Agent interactions
      </p>

      <div className="cards-grid">
        <div className="card">
          <div className="card-icon">🤖</div>
          <div className="card-label">Agent Label</div>
          <div className="card-value" style={{ fontSize: 18 }}>{agent.label ?? '—'}</div>
        </div>

        <div className="card">
          <div className="card-icon">🔗</div>
          <div className="card-label">Connections</div>
          <div className="card-value">{connectionCount ?? '—'}</div>
        </div>

        <div className="card">
          <div className="card-icon">🪪</div>
          <div className="card-label">Credentials</div>
          <div className="card-value">{credentialCount ?? '—'}</div>
        </div>
      </div>

      {agent.did && (
        <div className="card" style={{ maxWidth: 560 }}>
          <div className="card-label">Agent DID</div>
          <div className="card-sub" style={{ fontSize: 13, color: '#374151', wordBreak: 'break-all' }}>
            {agent.did}
          </div>
        </div>
      )}
    </div>
  )
}
