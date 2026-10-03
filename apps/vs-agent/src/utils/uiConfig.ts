import type { Express, Request, Response } from 'express'

import * as fs from 'fs'
import * as path from 'path'

/**
 * Runtime configuration of the dashboard UI, injected into index.html as
 * `window.__VS_AGENT__`. Everything the page shows about the service itself
 * (name, logo, operator, credentials) comes from the agent's own DID document
 * and linked presentations; this only carries what the browser cannot discover.
 */
export interface UiConfig {
  // Container build variant and release version, shown in the footer.
  build: string
  version: string
  // Header network badge text (e.g. "Testnet"); no badge when null.
  networkBadge: string | null
  // Business wallet placeholder banner.
  showPlaceholderMessage: boolean
  // The declared Verana network. The page uses this network exclusively for
  // accreditations and deep links, and never derives one from presented
  // credentials, so credentials anchored elsewhere cannot mix another network in.
  network: { chainId: string; indexerBaseUrl: string } | null
}

export interface UiConfigSources {
  build: string
  version: string
  networkBadge?: string
  showPlaceholderMessage: boolean
  chainId?: string
  indexerBaseUrl?: string
}

export const buildUiConfig = (sources: UiConfigSources): UiConfig => ({
  build: sources.build,
  version: sources.version,
  networkBadge: sources.networkBadge?.trim() || null,
  showPlaceholderMessage: sources.showPlaceholderMessage,
  network:
    sources.chainId && sources.indexerBaseUrl
      ? { chainId: sources.chainId, indexerBaseUrl: sources.indexerBaseUrl.replace(/\/+$/, '') }
      : null,
})

// `</` cannot appear inside a <script> body, whatever the surrounding JSON string.
const scriptSafeJson = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c')

export const injectUiConfig = (indexHtml: string, config: UiConfig): string =>
  indexHtml.replace('</head>', `<script>window.__VS_AGENT__=${scriptSafeJson(config)};</script></head>`)

/**
 * Serves the UI entry point with the runtime config injected. Mount it before
 * the static middleware so that `/` and `/index.html` never reach the plain file.
 */
export const serveUiIndex = (app: Pick<Express, 'get'>, publicDir: string, config: UiConfig): void => {
  const indexPath = path.join(publicDir, 'index.html')
  app.get(['/', '/index.html'], (_req: Request, res: Response) => {
    const html = injectUiConfig(fs.readFileSync(indexPath, 'utf-8'), config)
    res.type('html').send(html)
  })
}
