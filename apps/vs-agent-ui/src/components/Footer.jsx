import { getAgentConfig } from '../api'
import logoSvg from '../assets/logo.svg'

const TAGLINE = 'The Open Trust Infrastructure for the Verifiable Internet.'

const SOCIALS = [
  { label: 'Discord', href: 'https://discord.gg/edjaFn252q' },
  { label: 'LinkedIn', href: 'https://www.linkedin.com/company/verana-foundation/' },
  { label: 'X', href: 'https://x.com/Verana_io' },
]

const COLUMNS = [
  {
    title: 'Build on Verana',
    links: [
      { label: 'Documentation', href: 'https://docs.verana.io' },
      { label: 'Playground', href: 'https://playground.testnet.verana.network' },
      { label: 'GitHub', href: 'https://github.com/verana-labs' },
      { label: 'Verifiable Trust spec', href: 'https://verana-labs.github.io/verifiable-trust-spec/' },
      { label: 'VPR spec', href: 'https://verana-labs.github.io/verifiable-trust-vpr-spec/' },
    ],
  },
  {
    title: 'Websites',
    links: [
      { label: 'verana.io', href: 'https://verana.io' },
      { label: 'Verana Foundation', href: 'https://veranafoundation.org' },
      { label: 'Verana Council', href: 'https://veranacouncil.org' },
      { label: '2060', href: 'https://2060.io' },
    ],
  },
]

function SocialIcon({ label }) {
  const common = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'currentColor', 'aria-hidden': true }
  if (label === 'X') {
    return (
      <svg {...common}>
        <path d="M18.9 1.15h3.68l-8.04 9.19L24 22.85h-7.41l-5.8-7.58-6.64 7.58H.47l8.6-9.83L0 1.15h7.59l5.24 6.93zM17.61 20.64h2.04L6.49 3.24H4.3z" />
      </svg>
    )
  }
  if (label === 'LinkedIn') {
    return (
      <svg {...common}>
        <path d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46zM5.34 7.43a2.07 2.07 0 1 1 0-4.13 2.07 2.07 0 0 1 0 4.13zM7.12 20.45H3.55V9h3.57zM22.22 0H1.77C.79 0 0 .77 0 1.72v20.55C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.73V1.72C24 .77 23.2 0 22.22 0z" />
      </svg>
    )
  }
  return (
    <svg {...common}>
      <path d="M20.32 4.37a19.8 19.8 0 0 0-4.89-1.52.07.07 0 0 0-.08.04c-.21.38-.44.87-.6 1.25a18.3 18.3 0 0 0-5.49 0 12.6 12.6 0 0 0-.61-1.25.08.08 0 0 0-.08-.04 19.74 19.74 0 0 0-4.88 1.52.07.07 0 0 0-.04.03C.53 9.05-.32 13.58.1 18.06c0 .02.01.04.03.06a19.9 19.9 0 0 0 6 3.03.08.08 0 0 0 .08-.03c.46-.63.87-1.3 1.23-2a.08.08 0 0 0-.04-.1 13.1 13.1 0 0 1-1.87-.9.08.08 0 0 1-.01-.12c.13-.1.25-.19.37-.29a.07.07 0 0 1 .08-.01c3.93 1.79 8.18 1.79 12.06 0a.07.07 0 0 1 .08 0c.12.11.25.21.37.3a.08.08 0 0 1 0 .12 12.3 12.3 0 0 1-1.88.9.08.08 0 0 0-.04.1c.36.7.78 1.37 1.23 2a.08.08 0 0 0 .08.03 19.84 19.84 0 0 0 6.03-3.03.08.08 0 0 0 .03-.06c.5-5.18-.84-9.68-3.55-13.66a.06.06 0 0 0-.03-.03zM8.02 15.33c-1.18 0-2.16-1.08-2.16-2.42 0-1.33.96-2.42 2.16-2.42 1.21 0 2.18 1.1 2.16 2.42 0 1.34-.96 2.42-2.16 2.42zm7.97 0c-1.18 0-2.15-1.08-2.15-2.42 0-1.33.95-2.42 2.15-2.42 1.22 0 2.18 1.1 2.16 2.42 0 1.34-.94 2.42-2.16 2.42z" />
    </svg>
  )
}

export default function Footer() {
  const { build, version } = getAgentConfig()

  return (
    <footer className="footer">
      <div className="footer-inner">
        <div className="footer-grid">
          <div className="footer-brand">
            <div className="header-logo">
              <img src={logoSvg} alt="Verana" className="header-logo-icon" />
              <span className="header-logo-name wordmark">Verana</span>
            </div>
            <p className="footer-tagline">{TAGLINE}</p>
            <div className="footer-socials">
              {SOCIALS.map(s => (
                <a
                  key={s.label}
                  href={s.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={s.label}
                  className="footer-social-link"
                >
                  <SocialIcon label={s.label} />
                </a>
              ))}
            </div>
          </div>
          {COLUMNS.map(col => (
            <div key={col.title}>
              <h3 className="eyebrow footer-col-title">{col.title}</h3>
              <ul className="footer-links">
                {col.links.map(l => (
                  <li key={l.label}>
                    <a href={l.href} target="_blank" rel="noopener noreferrer">{l.label}</a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="footer-bottom">
          <span className="footer-build">
            {build ?? 'vs-agent'}
            {version ? ` · v${version}` : ''}
          </span>
          <span className="footer-legal">
            <a href="https://veranafoundation.org" target="_blank" rel="noopener noreferrer">
              © {new Date().getFullYear()} Verana Foundation
            </a>
            {' · '}
            <a href="https://www.apache.org/licenses/LICENSE-2.0" target="_blank" rel="noopener noreferrer">
              License Apache-2.0
            </a>
          </span>
        </div>
      </div>
    </footer>
  )
}
