import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

describe('assertVerifiableService: verdict caching', () => {
  const fresh = vi.fn()

  function makeHook(ttl?: { positiveTtlMs?: number }) {
    return assertVerifiableService({ verifiablePublicRegistries, logger: logger as never, ...ttl })
  }

  function call(hook: ReturnType<typeof makeHook>) {
    return hook({ agentContext: {} as never, peerDid: PEER_DID, connectionId: 'conn-1' })
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    // replicates verre's cache protocol (didValidator._resolve): serve only verified===true, set after fresh
    resolveDID.mockImplementation(async (...args: unknown[]) => {
      const did = args[0] as string
      const { cache } = args[1] as {
        cache?: { get(k: string): Promise<unknown> | undefined; set(k: string, v: Promise<unknown>): void }
      }
      const cached = cache?.get(did)
      const cachedValue = (cached ? await cached : undefined) as { verified?: boolean } | undefined
      if (cachedValue?.verified === true) return cachedValue
      const result = await fresh()
      cache?.set(did, Promise.resolve(result))
      return result
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('serves a repeat positive verdict from cache within the TTL and logs the source', async () => {
    fresh.mockResolvedValue({ verified: true, outcome: 'verified' })
    const hook = makeHook({ positiveTtlMs: 60_000 })

    await expect(call(hook)).resolves.toBe(true)
    expect(fresh).toHaveBeenCalledTimes(1)
    expect(logger.debug).toHaveBeenLastCalledWith(expect.stringContaining('source=fresh'))

    await expect(call(hook)).resolves.toBe(true)
    expect(fresh).toHaveBeenCalledTimes(1)
    expect(logger.debug).toHaveBeenLastCalledWith(expect.stringContaining('source=cache'))
  })

  it('re-resolves a positive verdict after the TTL expires', async () => {
    fresh.mockResolvedValue({ verified: true, outcome: 'verified' })
    const hook = makeHook({ positiveTtlMs: 60_000 })

    await expect(call(hook)).resolves.toBe(true)
    vi.advanceTimersByTime(60_001)

    await expect(call(hook)).resolves.toBe(true)
    expect(fresh).toHaveBeenCalledTimes(2)
    expect(logger.debug).toHaveBeenLastCalledWith(expect.stringContaining('source=fresh'))
  })

  it('re-resolves a negative verdict on every attempt', async () => {
    fresh.mockResolvedValue({ verified: false, outcome: 'invalid' })
    const hook = makeHook()

    await expect(call(hook)).resolves.toBe(false)
    await expect(call(hook)).resolves.toBe(false)
    expect(fresh).toHaveBeenCalledTimes(2)
    expect(logger.warn).toHaveBeenCalledTimes(2)
    expect(logger.warn).toHaveBeenLastCalledWith(expect.stringContaining('source=fresh'))
  })

  it('recovers immediately when a verified-but-untrusted peer becomes trusted', async () => {
    fresh.mockResolvedValueOnce({ verified: true, outcome: 'verified-test' })
    fresh.mockResolvedValueOnce({ verified: true, outcome: 'verified' })
    const hook = makeHook()

    await expect(call(hook)).resolves.toBe(false)
    await expect(call(hook)).resolves.toBe(true)
    expect(fresh).toHaveBeenCalledTimes(2)
  })
})
