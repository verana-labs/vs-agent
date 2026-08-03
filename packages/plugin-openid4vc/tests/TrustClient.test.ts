import type { TrustResolution } from '../src/trust/types'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { TrustClient } from '../src/trust/TrustClient'
import { computeVerdict } from '../src/trust/verdict'

const RESOLVER_URL = 'https://resolver.example/v1/trust'
const DID = 'did:web:issuer.example'
const VTJSC_ID = 'https://agent.example/vt/employee.json'

const response = (status: number, body?: unknown): Response =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    status,
  })

const clientWith = (fetchImplementation: typeof fetch, resolverUrl = RESOLVER_URL) =>
  new TrustClient({ resolverUrl, timeoutMs: 1_000 }, fetchImplementation)

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('computeVerdict', () => {
  it.each<[TrustResolution, boolean | null, string]>([
    [{ status: 'unreachable' }, null, 'RESOLVER_UNAVAILABLE'],
    [{ status: 'not_found' }, null, 'UNTRUSTED'],
    [{ status: 'ok', trustStatus: 'UNTRUSTED' }, false, 'UNTRUSTED'],
    [{ status: 'ok', trustStatus: 'PARTIAL' }, true, 'UNTRUSTED'],
    [{ status: 'ok', trustStatus: 'TRUSTED' }, null, 'RESOLVER_UNAVAILABLE'],
    [{ status: 'ok', trustStatus: 'TRUSTED' }, false, 'TRUSTED_NOT_AUTHORIZED'],
    [{ status: 'ok', trustStatus: 'TRUSTED' }, true, 'TRUSTED_AUTHORIZED'],
  ])('maps %j and authorization %j to %s', (resolution, authorized, expected) => {
    expect(computeVerdict(resolution, authorized)).toBe(expected)
  })
})

describe('TrustClient', () => {
  it('rejects resolver URL credentials before fetch or trust evidence can expose them', () => {
    const fetchImplementation = vi.fn() as unknown as typeof fetch
    const credentialedUrl = 'https://resolver-user:resolver-password@resolver.example/v1/trust'

    expect(
      () => new TrustClient({ resolverUrl: credentialedUrl, timeoutMs: 1_000 }, fetchImplementation),
    ).toThrowError('resolver URL must not contain credentials')
    expect(fetchImplementation).not.toHaveBeenCalled()
  })

  it.each(['TRUSTED', 'PARTIAL', 'UNTRUSTED'] as const)(
    'accepts only the declared %s trust status',
    async trustStatus => {
      const fetchImplementation = vi.fn(async () => response(200, { trustStatus })) as unknown as typeof fetch

      await expect(clientWith(fetchImplementation).resolve(DID)).resolves.toEqual({
        status: 'ok',
        trustStatus,
      })
    },
  )

  it.each([
    ['404', vi.fn(async () => response(404)), 'UNTRUSTED'],
    ['500', vi.fn(async () => response(500)), 'RESOLVER_UNAVAILABLE'],
    [
      'network error',
      vi.fn(async () => {
        throw new Error('ECONNREFUSED')
      }),
      'RESOLVER_UNAVAILABLE',
    ],
    ['invalid JSON', vi.fn(async () => new Response('{not-json', { status: 200 })), 'RESOLVER_UNAVAILABLE'],
    [
      'unknown trust status',
      vi.fn(async () => response(200, { trustStatus: 'UNKNOWN' })),
      'RESOLVER_UNAVAILABLE',
    ],
  ] as const)('fails closed on resolver %s', async (_case, fetchMock, expected) => {
    const fetchImplementation = fetchMock as unknown as typeof fetch

    await expect(clientWith(fetchImplementation).verdictFor('issuer', DID, VTJSC_ID)).resolves.toMatchObject({
      verdict: expected,
    })
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it.each([
    ['500', response(500)],
    ['invalid JSON', new Response('{not-json', { status: 200 })],
    ['non-boolean true string', response(200, { authorized: 'true' })],
    ['non-boolean number', response(200, { authorized: 1 })],
  ])('fails closed on authorization %s', async (_case, authorizationResponse) => {
    const fetchImplementation = vi
      .fn()
      .mockResolvedValueOnce(response(200, { trustStatus: 'TRUSTED' }))
      .mockResolvedValueOnce(authorizationResponse) as unknown as typeof fetch

    await expect(clientWith(fetchImplementation).verdictFor('issuer', DID, VTJSC_ID)).resolves.toMatchObject({
      verdict: 'RESOLVER_UNAVAILABLE',
    })
  })

  it('maps an explicit authorization 404 to trusted but not authorized', async () => {
    const fetchImplementation = vi
      .fn()
      .mockResolvedValueOnce(response(200, { trustStatus: 'TRUSTED' }))
      .mockResolvedValueOnce(response(404)) as unknown as typeof fetch

    await expect(clientWith(fetchImplementation).verdictFor('issuer', DID, VTJSC_ID)).resolves.toMatchObject({
      verdict: 'TRUSTED_NOT_AUTHORIZED',
    })
  })

  it.each(['PARTIAL', 'UNTRUSTED'] as const)(
    'does not query authorization after a %s resolution',
    async trustStatus => {
      const fetchImplementation = vi.fn(async () => response(200, { trustStatus })) as unknown as typeof fetch

      await expect(
        clientWith(fetchImplementation).verdictFor('issuer', DID, VTJSC_ID),
      ).resolves.toMatchObject({
        verdict: 'UNTRUSTED',
      })
      expect(fetchImplementation).toHaveBeenCalledOnce()
    },
  )

  it('builds unambiguous endpoint URLs and encoded query parameters', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(200, { trustStatus: 'TRUSTED' }))
      .mockResolvedValueOnce(response(200, { authorized: true }))
    const fetchImplementation = fetchMock as unknown as typeof fetch
    const did = 'did:web:issuer.example:user?version=1&active=true'
    const vtjscId = 'https://agent.example/vt/employee.json?version=1&scope=all'

    await clientWith(fetchImplementation, `${RESOLVER_URL}/?ignored=true`).verdictFor('issuer', did, vtjscId)

    const resolveUrl = new URL(String(fetchMock.mock.calls[0][0]))
    const authorizationUrl = new URL(String(fetchMock.mock.calls[1][0]))
    expect(resolveUrl.pathname).toBe('/v1/trust/resolve')
    expect(resolveUrl.searchParams.get('did')).toBe(did)
    expect(resolveUrl.searchParams.has('ignored')).toBe(false)
    expect(authorizationUrl.pathname).toBe('/v1/trust/issuer-authorization')
    expect(authorizationUrl.searchParams.get('did')).toBe(did)
    expect(authorizationUrl.searchParams.get('vtjscId')).toBe(vtjscId)
  })

  it('creates one AbortController per request and clears every timeout', async () => {
    const signals: AbortSignal[] = []
    const fetchImplementation = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      signals.push(init?.signal as AbortSignal)
      return signals.length === 1
        ? response(200, { trustStatus: 'TRUSTED' })
        : response(200, { authorized: true })
    }) as unknown as typeof fetch
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout')

    await expect(clientWith(fetchImplementation).verdictFor('issuer', DID, VTJSC_ID)).resolves.toMatchObject({
      verdict: 'TRUSTED_AUTHORIZED',
    })

    expect(signals).toHaveLength(2)
    expect(signals[0]).not.toBe(signals[1])
    expect(signals.every(signal => signal instanceof AbortSignal && !signal.aborted)).toBe(true)
    expect(clearTimeoutSpy).toHaveBeenCalledTimes(2)
  })

  it('treats an AbortError as resolver unavailable and clears its timeout', async () => {
    const fetchImplementation = vi.fn(async () => {
      throw abortError('request aborted')
    }) as unknown as typeof fetch
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout')

    await expect(clientWith(fetchImplementation).verdictFor('issuer', DID, VTJSC_ID)).resolves.toMatchObject({
      verdict: 'RESOLVER_UNAVAILABLE',
    })
    expect(clearTimeoutSpy).toHaveBeenCalledOnce()
  })

  it('aborts a pending request after the configured timeout', async () => {
    vi.useFakeTimers()
    let requestSignal: AbortSignal | undefined
    const fetchImplementation = vi.fn(
      async (_input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        requestSignal = init?.signal as AbortSignal
        return await new Promise((_resolve, reject) => {
          requestSignal?.addEventListener('abort', () => reject(abortError('timed out')))
        })
      },
    ) as unknown as typeof fetch
    const verdictPromise = clientWith(fetchImplementation).verdictFor('issuer', DID, VTJSC_ID)

    await vi.advanceTimersByTimeAsync(999)
    expect(requestSignal?.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(1)

    await expect(verdictPromise).resolves.toMatchObject({ verdict: 'RESOLVER_UNAVAILABLE' })
    expect(requestSignal?.aborted).toBe(true)
  })

  it('keeps the timeout active while parsing the response body', async () => {
    vi.useFakeTimers()
    let requestSignal: AbortSignal | undefined
    const fetchImplementation = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      requestSignal = init?.signal as AbortSignal
      return {
        ok: true,
        status: 200,
        json: async () =>
          await new Promise((_resolve, reject) => {
            requestSignal?.addEventListener('abort', () => reject(abortError('timed out')))
          }),
      } as Response
    }) as unknown as typeof fetch

    const verdictPromise = clientWith(fetchImplementation).verdictFor('issuer', DID, VTJSC_ID)
    await vi.advanceTimersByTimeAsync(1_000)

    expect(requestSignal?.aborted).toBe(true)
    await expect(verdictPromise).resolves.toMatchObject({ verdict: 'RESOLVER_UNAVAILABLE' })
  })
})

function abortError(message: string): Error {
  const error = new Error(message)
  error.name = 'AbortError'
  return error
}
