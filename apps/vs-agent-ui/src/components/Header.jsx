import { useState, useEffect } from 'react'
import { getHealth } from '../api'

export default function Header({ title }) {
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    getHealth()
      .then(() => setConnected(true))
      .catch(() => setConnected(false))
  }, [])

  return (
    <header className="header">
      <div className="header-logo">
        <div className="header-logo-icon">V</div>
        <span className="header-logo-name">Verana</span>
      </div>
      <div className="header-center">
        <h1>{title}</h1>
      </div>
      <div className="status-badge">
        <span className={`status-dot ${connected ? 'connected' : ''}`} />
        <span className="status-label">{connected ? 'Connected' : 'Disconnected'}</span>
      </div>
    </header>
  )
}
