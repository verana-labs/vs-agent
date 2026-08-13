import { Logger } from '@credo-ts/core'
import { describe, expect, it, vi, afterEach } from 'vitest'

import { waitUntilOwnDidIsPubliclyResolvable } from '../src/utils/didReadiness'

function makeAgent(did: string) {
  return { did, publicApiBaseUrl: 'https://agent.example' } as never
}

function makeLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
  } as unknown as Logger
}

describe('waitUntilOwnDidIsPubliclyResolvable', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns immediately when the DID document is already resolvable', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)

    await waitUntilOwnDidIsPubliclyResolvable(makeAgent('did:web:agent.example'), makeLogger())

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith('https://agent.example/.well-known/did.json')
  })

  it('checks did.jsonl instead of did.json for a did:webvh agent', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)

    await waitUntilOwnDidIsPubliclyResolvable(makeAgent('did:webvh:Qm123:agent.example'), makeLogger())

    expect(fetchMock).toHaveBeenCalledWith('https://agent.example/.well-known/did.jsonl')
  })

  it('retries until the DID document becomes resolvable', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({ ok: true })
    vi.stubGlobal('fetch', fetchMock)
    const logger = makeLogger()

    await waitUntilOwnDidIsPubliclyResolvable(makeAgent('did:web:agent.example'), logger)

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('no-ops when the agent has no DID or no public API base URL', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await waitUntilOwnDidIsPubliclyResolvable({ did: undefined } as never, makeLogger())
    await waitUntilOwnDidIsPubliclyResolvable(
      { did: 'did:web:agent.example', publicApiBaseUrl: undefined } as never,
      makeLogger(),
    )

    expect(fetchMock).not.toHaveBeenCalled()
  })
})
