import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { describe, expect, it, vi } from 'vitest'

import { buildUiConfig, injectUiConfig, serveUiIndex } from '../src/utils/uiConfig'

const sources = {
  build: 'vs-agent',
  version: '2.0.0',
  showPlaceholderMessage: true,
}

describe('buildUiConfig', () => {
  it('carries the build, version, badge and banner flag', () => {
    expect(buildUiConfig({ ...sources, networkBadge: 'Testnet' })).toEqual({
      build: 'vs-agent',
      version: '2.0.0',
      networkBadge: 'Testnet',
      showPlaceholderMessage: true,
      network: null,
    })
  })

  it('shows no badge when the variable is unset or blank', () => {
    expect(buildUiConfig(sources).networkBadge).toBeNull()
    expect(buildUiConfig({ ...sources, networkBadge: '  ' }).networkBadge).toBeNull()
  })

  it('declares the network only when both the chain id and the indexer are set', () => {
    expect(
      buildUiConfig({ ...sources, chainId: 'vna-devnet-1', indexerBaseUrl: 'https://idx.example/' }).network,
    ).toEqual({ chainId: 'vna-devnet-1', indexerBaseUrl: 'https://idx.example' })
    expect(buildUiConfig({ ...sources, chainId: 'vna-devnet-1' }).network).toBeNull()
    expect(buildUiConfig({ ...sources, indexerBaseUrl: 'https://idx.example' }).network).toBeNull()
    expect(buildUiConfig({ ...sources, chainId: 'vna-devnet-1', indexerBaseUrl: '' }).network).toBeNull()
  })
})

describe('injectUiConfig', () => {
  const config = buildUiConfig(sources)

  it('adds the config script at the end of the head', () => {
    const html = injectUiConfig('<html><head><title>x</title></head><body></body></html>', config)
    expect(html).toBe(
      `<html><head><title>x</title><script>window.__VS_AGENT__=${JSON.stringify(config)};</script></head><body></body></html>`,
    )
  })

  it('cannot be broken out of by a value that closes the script tag', () => {
    const html = injectUiConfig('<head></head>', { ...config, networkBadge: '</script><b>' })
    expect(html).not.toContain('</script><b>')
    expect(html).toContain('\\u003c/script>\\u003cb>')
  })
})

describe('serveUiIndex', () => {
  it('answers / and /index.html with the injected page', () => {
    const get = vi.fn()
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vsa-ui-'))
    fs.writeFileSync(path.join(dir, 'index.html'), '<head></head>')
    try {
      serveUiIndex({ get }, dir, buildUiConfig(sources))

      expect(get).toHaveBeenCalledOnce()
      const [paths, handler] = get.mock.calls[0]
      expect(paths).toEqual(['/', '/index.html'])

      const res = { type: vi.fn().mockReturnThis(), send: vi.fn() }
      handler({}, res)
      expect(res.type).toHaveBeenCalledWith('html')
      expect(res.send.mock.calls[0][0]).toContain('window.__VS_AGENT__=')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
