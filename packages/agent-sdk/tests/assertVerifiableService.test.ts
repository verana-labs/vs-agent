import { beforeEach, describe, expect, it, vi } from 'vitest'

import { assertVerifiableService } from '../src/vtFlow/assertVerifiableService'

const resolveDID = vi.fn()

vi.mock('@verana-labs/verre', async importOriginal => ({
  ...(await importOriginal<typeof import('@verana-labs/verre')>()),
  resolveDID: (...args: unknown[]) => resolveDID(...args),
}))

const PEER_DID = 'did:web:peer.example'
const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }

const verifiablePublicRegistries = [
  { id: 'vpr:verana:test', scheme: 'vpr:verana:test', api: ['https://indexer.test'], production: true },
]

function check() {
  const hook = assertVerifiableService({ verifiablePublicRegistries, logger: logger as never })
  return hook({ agentContext: {} as never, peerDid: PEER_DID, connectionId: 'conn-1' })
}

describe('assertVerifiableService: VS-CONN-VS trust resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('admits a peer verified against a production registry', async () => {
    resolveDID.mockResolvedValue({ verified: true, outcome: 'verified' })

    await expect(check()).resolves.toBe(true)
    expect(logger.warn).not.toHaveBeenCalled()
  })

  // The hole this gate closes: a self-issued ECS credential resolves as structurally valid
  // (`verified: true`) while its trust chain reaches no registry (`not-trusted`).
  it('refuses a self-issued peer that resolves verified but not-trusted', async () => {
    resolveDID.mockResolvedValue({ verified: true, outcome: 'not-trusted' })

    await expect(check()).resolves.toBe(false)
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('not-trusted'))
  })

  it('refuses a peer whose trust chain only reaches a non-production registry', async () => {
    resolveDID.mockResolvedValue({ verified: true, outcome: 'verified-test' })

    await expect(check()).resolves.toBe(false)
  })

  it('refuses an invalid outcome even when the resolver reports verified', async () => {
    resolveDID.mockResolvedValue({ verified: true, outcome: 'invalid' })

    await expect(check()).resolves.toBe(false)
  })

  it('refuses a peer the resolver did not verify', async () => {
    resolveDID.mockResolvedValue({
      verified: false,
      outcome: 'invalid',
      metadata: { errorMessage: 'signature check failed' },
    })

    await expect(check()).resolves.toBe(false)
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('signature check failed'))
  })

  it('refuses the peer and logs when resolution throws', async () => {
    resolveDID.mockRejectedValue(new Error('registry unreachable'))

    await expect(check()).resolves.toBe(false)
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('registry unreachable'))
  })
})
