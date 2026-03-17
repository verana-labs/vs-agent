import { useState, useEffect } from 'react'
import { getHealth } from '../api'

export default function Header({ title, onMenuToggle }) {
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
      {/* Desktop: connection status */}
      <div className="status-badge header-status-desktop">
        <span className={`status-dot ${connected ? 'connected' : ''}`} />
        <span className="status-label">{connected ? 'Connected' : 'Disconnected'}</span>
      </div>
      {/* Mobile: hamburger */}
      <button className="hamburger" onClick={onMenuToggle} aria-label="Toggle menu">
        <span />
        <span />
        <span />
      </button>
    </header>
  )
}
