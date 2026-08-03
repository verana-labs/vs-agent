import { useEffect, useState } from 'react'
import { getAgentConfig } from '../api'
import logoSvg from '../assets/logo.svg'

const THEME_KEY = 'vsa-theme'

// Network status chip: a glowing LED and the badge text from
// UI_NETWORK_BADGE (e.g. "Testnet"). The LED reflects the reachability of
// the declared network's indexer: green OK, red down, gray while checking
// or when no indexer is declared.
function NetworkChip() {
  const { networkBadge, network } = getAgentConfig()
  const [indexer, setIndexer] = useState(null)

  useEffect(() => {
    if (!network?.indexerBaseUrl) return
    let alive = true
    fetch(network.indexerBaseUrl)
      .then(r => {
        if (alive) setIndexer(r.ok ? 'ok' : 'down')
      })
      .catch(() => {
        if (alive) setIndexer('down')
      })
    return () => {
      alive = false
    }
  }, [network?.indexerBaseUrl])

  if (!networkBadge) return null

  const title = [
    network?.chainId ? `Connected to ${network.chainId}` : null,
    indexer === 'down' ? 'indexer unreachable right now' : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <span className="net-chip" title={title || undefined}>
      <span aria-hidden className={`led${indexer === 'ok' ? ' led-ok' : indexer === 'down' ? ' led-down' : ''}`} />
      {networkBadge}
    </span>
  )
}

export default function Header() {
  const [theme, setTheme] = useState('dark')

  useEffect(() => {
    const current = document.documentElement.getAttribute('data-theme')
    setTheme(current === 'light' ? 'light' : 'dark')
  }, [])

  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    document.documentElement.setAttribute('data-theme', next)
    try {
      localStorage.setItem(THEME_KEY, next)
    } catch {
      /* ignore */
    }
  }

  return (
    <header className="header">
      <div className="header-logo">
        <img src={logoSvg} alt="Verana" className="header-logo-icon" />
        <span className="header-logo-name wordmark">Verana</span>
      </div>
      <div className="header-center" />
      <NetworkChip />
      <button
        type="button"
        onClick={toggleTheme}
        className="theme-toggle"
        aria-label="Switch theme"
        aria-pressed={theme === 'dark'}
      >
        {theme === 'dark' ? (
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
          </svg>
        ) : (
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
          </svg>
        )}
      </button>
    </header>
  )
}
