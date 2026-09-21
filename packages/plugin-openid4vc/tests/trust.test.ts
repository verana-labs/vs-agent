import type { OpenId4VcPluginOptions } from '../src/types'
import type { TrustResolution } from '../src/trust/types'
import type { BaseAgent, DidDocument, VerificationMethod, X509Certificate } from '@credo-ts/core'

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { certificateFingerprint, trustedCertificatesForVerification } from '../src/trust/CertificateTrust'
import {
  blockingBindingVerdict,
  findBoundVerificationMethodId,
  verifyKeyBoundToDid,
} from '../src/trust/keyBinding'
import { TrustClient } from '../src/trust/TrustClient'
import { computeVerdict } from '../src/trust/verdict'

import { createCertificateFixtures, LEAF_PRIVATE_JWK, OTHER_PRIVATE_JWK } from './helpers/certificates'

describe('CertificateTrust', () => {
  let fixtures: Awaited<ReturnType<typeof createCertificateFixtures>>

  beforeAll(async () => {
    fixtures = await createCertificateFixtures()
  })

  it('never returns the peer-provided chain as a trust anchor', () => {
    const options = validOptions(fixtures.root)
    const attackerChain = [fixtures.attacker]

    const anchors = trustedCertificatesForVerification(options, {
      type: 'credential',
      certificateChain: attackerChain,
    })

    expect(anchors).toEqual(options.trust?.credentialIssuerCertificates)
    expect(anchors).not.toEqual(attackerChain.map(certificate => certificate.toString('base64')))
  })

  it('returns no wallet attestation anchors when the feature is not configured', () => {
    expect(
      trustedCertificatesForVerification(validOptions(fixtures.root), {
        type: 'oauth2ClientAttestation',
        certificateChain: [fixtures.attacker],
      }),
    ).toBeUndefined()
  })

  it('returns only configured wallet attestation anchors', () => {
    const options = validOptions(fixtures.root)
    options.issuer!.walletAttestationCertificates = [fixtures.intermediate.toString('base64')]

    expect(
      trustedCertificatesForVerification(options, {
        type: 'oauth2ClientAttestation',
        certificateChain: [fixtures.attacker],
      }),
    ).toEqual(options.issuer!.walletAttestationCertificates)
  })

  it('accepts a self-signed development leaf only through its exact SHA-256 fingerprint', () => {
    const options = validOptions(fixtures.root)
    options.trust!.credentialIssuerCertificates = []
    options.trust!.developmentCertificateFingerprints = [certificateFingerprint(fixtures.attacker)]

    expect(
      trustedCertificatesForVerification(options, {
        type: 'credential',
        certificateChain: [fixtures.attacker],
      }),
    ).toEqual([fixtures.attacker.toString('base64')])
  })

  it('rejects a different self-signed development fingerprint', () => {
    const options = validOptions(fixtures.root)
    options.trust!.credentialIssuerCertificates = []
    options.trust!.developmentCertificateFingerprints = [certificateFingerprint(fixtures.root)]

    expect(
      trustedCertificatesForVerification(options, {
        type: 'credential',
        certificateChain: [fixtures.attacker],
      }),
    ).toBeUndefined()
  })

  it('uses configured credential roots before development pins', () => {
    const options = validOptions(fixtures.root)
    options.trust!.developmentCertificateFingerprints = [certificateFingerprint(fixtures.attacker)]

    expect(
      trustedCertificatesForVerification(options, {
        type: 'credential',
        certificateChain: [fixtures.attacker],
      }),
    ).toEqual(options.trust!.credentialIssuerCertificates)
  })

  it('returns no anchors for unrelated verification categories', () => {
    expect(
      trustedCertificatesForVerification(validOptions(fixtures.root), {
        type: 'oauth2SecuredAuthorizationRequest',
        certificateChain: [fixtures.attacker],
      }),
    ).toBeUndefined()
  })

  it('encodes certificate fingerprints without certificate or key material', () => {
    expect(certificateFingerprint(fixtures.leaf)).toMatch(/^SHA256:[0-9a-f]{64}$/)
  })
})

function validOptions(root: X509Certificate): OpenId4VcPluginOptions {
  return {
    publicApiBaseUrl: 'https://agent.example',
    issuer: {},
    trust: {
      resolverUrl: 'https://resolver.example',
      timeoutMs: 5_000,
      allowedDidWebHosts: ['issuer.example'],
      credentialIssuerCertificates: [root.toString('base64')],
    },
    credentialConfigurations: [],
    verifierPolicies: [],
  }
}

const options = (keyAttestationCertificates?: string[]): OpenId4VcPluginOptions => ({
  publicApiBaseUrl: 'https://agent.example',
  issuer: { ...(keyAttestationCertificates ? { keyAttestationCertificates } : {}) },
  credentialConfigurations: [],
  verifierPolicies: [],
})

describe('key attestation trust', () => {
  it('anchors a key attestation on the configured roots', () => {
    const trusted = trustedCertificatesForVerification(options(['wallet-provider-root']), {
      type: 'openId4VciKeyAttestation',
      certificateChain: [],
    })

    expect(trusted).toEqual(['wallet-provider-root'])
  })

  it('refuses a key attestation when no root is configured', () => {
    const trusted = trustedCertificatesForVerification(options(), {
      type: 'openId4VciKeyAttestation',
      certificateChain: [],
    })

    expect(trusted).toBeUndefined()
  })
})

const DID = 'did:web:issuer.example'
const DID_RESOLUTION_POLICY = { allowedWebHosts: ['issuer.example'], timeoutMs: 1_000 }
const VTJSC_ID = 'https://agent.example/vt/employee.json'
const LEAF_PUBLIC_JWK = {
  kty: LEAF_PRIVATE_JWK.kty,
  crv: LEAF_PRIVATE_JWK.crv,
  x: LEAF_PRIVATE_JWK.x,
  y: LEAF_PRIVATE_JWK.y,
}
const OTHER_PUBLIC_JWK = {
  kty: OTHER_PRIVATE_JWK.kty,
  crv: OTHER_PRIVATE_JWK.crv,
  x: OTHER_PRIVATE_JWK.x,
  y: OTHER_PRIVATE_JWK.y,
}

const verificationMethod = (
  publicKeyJwk: Record<string, unknown>,
  id = `${DID}#assertion`,
): VerificationMethod =>
  ({
    id,
    type: 'JsonWebKey2020',
    controller: DID,
    publicKeyJwk,
  }) as unknown as VerificationMethod

const didDocument = ({
  id = DID,
  assertionMethod,
  authentication,
  dereferenced = {},
}: {
  id?: string
  assertionMethod?: Array<string | VerificationMethod>
  authentication?: Array<string | VerificationMethod>
  dereferenced?: Record<string, VerificationMethod>
}): DidDocument =>
  ({
    id,
    assertionMethod,
    authentication,
    dereferenceVerificationMethod: (id: string) => {
      const method = dereferenced[id]
      if (!method) throw new Error(`dangling verification method ${id}`)
      return method
    },
  }) as unknown as DidDocument

const agentResolving = (
  resolve: (did: string) => Promise<{ didDocument: DidDocument | null }>,
): Pick<BaseAgent, 'dids'> => ({ dids: { resolve } }) as unknown as Pick<BaseAgent, 'dids'>

describe('verifyKeyBoundToDid', () => {
  it('accepts an exact embedded assertionMethod key using canonical public JWK components', async () => {
    const methodJwk = { ...LEAF_PUBLIC_JWK, alg: 'ES256', kid: 'did-key' }
    const certificateJwk = { ...LEAF_PUBLIC_JWK, use: 'sig', kid: 'certificate-key' }
    const agent = agentResolving(async () => ({
      didDocument: didDocument({ assertionMethod: [verificationMethod(methodJwk)] }),
    }))

    await expect(
      verifyKeyBoundToDid(agent, DID, certificateJwk, ['assertionMethod'], DID_RESOLUTION_POLICY),
    ).resolves.toBe('bound')
  })

  it('accepts a dereferenced assertionMethod key', async () => {
    const methodId = `${DID}#assertion`
    const agent = agentResolving(async () => ({
      didDocument: didDocument({
        assertionMethod: [methodId],
        dereferenced: { [methodId]: verificationMethod(LEAF_PUBLIC_JWK, methodId) },
      }),
    }))

    await expect(
      verifyKeyBoundToDid(agent, DID, LEAF_PUBLIC_JWK, ['assertionMethod'], DID_RESOLUTION_POLICY),
    ).resolves.toBe('bound')
  })

  it('rejects a trusted DID asserted by an attacker certificate', async () => {
    const agent = agentResolving(async () => ({
      didDocument: didDocument({ assertionMethod: [verificationMethod(LEAF_PUBLIC_JWK)] }),
    }))

    await expect(
      verifyKeyBoundToDid(agent, DID, OTHER_PUBLIC_JWK, ['assertionMethod'], DID_RESOLUTION_POLICY),
    ).resolves.toBe('unbound')
  })

  it('rejects a key present only under authentication for issuer binding', async () => {
    const agent = agentResolving(async () => ({
      didDocument: didDocument({ authentication: [verificationMethod(LEAF_PUBLIC_JWK)] }),
    }))

    await expect(
      verifyKeyBoundToDid(agent, DID, LEAF_PUBLIC_JWK, ['assertionMethod'], DID_RESOLUTION_POLICY),
    ).resolves.toBe('unbound')
    await expect(
      verifyKeyBoundToDid(agent, DID, LEAF_PUBLIC_JWK, ['authentication'], DID_RESOLUTION_POLICY),
    ).resolves.toBe('bound')
  })

  it('rejects a dangling assertionMethod reference', async () => {
    const agent = agentResolving(async () => ({
      didDocument: didDocument({ assertionMethod: [`${DID}#missing`] }),
    }))

    await expect(
      verifyKeyBoundToDid(agent, DID, LEAF_PUBLIC_JWK, ['assertionMethod'], DID_RESOLUTION_POLICY),
    ).resolves.toBe('unbound')
  })

  it('fails closed when DID resolution throws or returns no document', async () => {
    const throwingAgent = agentResolving(async () => {
      throw new Error('resolver unavailable')
    })
    const emptyAgent = agentResolving(async () => ({ didDocument: null }))

    await expect(
      verifyKeyBoundToDid(throwingAgent, DID, LEAF_PUBLIC_JWK, ['assertionMethod'], DID_RESOLUTION_POLICY),
    ).resolves.toBe('unresolvable')
    await expect(
      verifyKeyBoundToDid(emptyAgent, DID, LEAF_PUBLIC_JWK, ['assertionMethod'], DID_RESOLUTION_POLICY),
    ).resolves.toBe('unresolvable')
  })

  it('fails closed for a missing DID or malformed certificate key', async () => {
    const resolve = vi.fn(async () => ({
      didDocument: didDocument({ assertionMethod: [verificationMethod(LEAF_PUBLIC_JWK)] }),
    }))
    const agent = agentResolving(resolve)

    await expect(
      verifyKeyBoundToDid(agent, null, LEAF_PUBLIC_JWK, ['assertionMethod'], DID_RESOLUTION_POLICY),
    ).resolves.toBe('unbound')
    await expect(
      verifyKeyBoundToDid(
        agent,
        DID,
        { kty: 'EC', crv: 'P-256' },
        ['assertionMethod'],
        DID_RESOLUTION_POLICY,
      ),
    ).resolves.toBe('unbound')
    expect(resolve).not.toHaveBeenCalled()
  })

  it.each([
    ['did:key:z6Mktest', 'issuer.example'],
    ['did:web:', 'issuer.example'],
    ['did:web:localhost', 'localhost'],
    ['did:web:service.internal', 'service.internal'],
    ['did:web:127.0.0.1', '127.0.0.1'],
    ['did:web:10.1.2.3', '10.1.2.3'],
    ['did:web:169.254.169.254', '169.254.169.254'],
    ['did:web:%5B%3A%3A1%5D', '[::1]'],
    ['did:web:%5Bfe80%3A%3A1%5D', '[fe80::1]'],
  ])('rejects unsupported, malformed, or non-public DID target %s before resolution', async (did, host) => {
    const resolve = vi.fn(async () => ({
      didDocument: didDocument({ assertionMethod: [verificationMethod(LEAF_PUBLIC_JWK)] }),
    }))

    await expect(
      verifyKeyBoundToDid(agentResolving(resolve), did, LEAF_PUBLIC_JWK, ['assertionMethod'], {
        allowedWebHosts: [host],
        timeoutMs: 1_000,
      }),
    ).resolves.toBe('unresolvable')
    expect(resolve).not.toHaveBeenCalled()
  })

  it('rejects a public host outside the operator allowlist before its resolver can follow redirects', async () => {
    const resolve = vi.fn(async () => ({
      didDocument: didDocument({ assertionMethod: [verificationMethod(LEAF_PUBLIC_JWK)] }),
    }))

    await expect(
      verifyKeyBoundToDid(
        agentResolving(resolve),
        'did:web:redirector.example',
        LEAF_PUBLIC_JWK,
        ['assertionMethod'],
        DID_RESOLUTION_POLICY,
      ),
    ).resolves.toBe('unresolvable')
    expect(resolve).not.toHaveBeenCalled()
  })

  it('bypasses and does not persist DID resolver cache entries for key binding', async () => {
    const resolve = vi.fn(async () => ({
      didDocument: didDocument({ assertionMethod: [verificationMethod(LEAF_PUBLIC_JWK)] }),
    }))

    await expect(
      verifyKeyBoundToDid(
        agentResolving(resolve),
        DID,
        LEAF_PUBLIC_JWK,
        ['assertionMethod'],
        DID_RESOLUTION_POLICY,
      ),
    ).resolves.toBe('bound')

    expect(resolve).toHaveBeenCalledWith(DID, { useCache: false, persistInCache: false })
  })

  it('bounds DID resolution by the configured timeout', async () => {
    const agent = agentResolving(
      async () =>
        await new Promise(resolve => {
          setTimeout(
            () =>
              resolve({
                didDocument: didDocument({
                  assertionMethod: [verificationMethod(LEAF_PUBLIC_JWK)],
                }),
              }),
            50,
          )
        }),
    )

    await expect(
      verifyKeyBoundToDid(agent, DID, LEAF_PUBLIC_JWK, ['assertionMethod'], {
        ...DID_RESOLUTION_POLICY,
        timeoutMs: 1,
      }),
    ).resolves.toBe('unresolvable')
  })

  it('supports an explicitly allowed did:webvh host', async () => {
    const webVhDid = 'did:webvh:QmFixtureScid:issuer.example'
    const method = verificationMethod(LEAF_PUBLIC_JWK, `${webVhDid}#assertion`)
    const agent = agentResolving(async () => ({
      didDocument: didDocument({ id: webVhDid, assertionMethod: [method] }),
    }))

    await expect(
      verifyKeyBoundToDid(agent, webVhDid, LEAF_PUBLIC_JWK, ['assertionMethod'], {
        allowedWebHosts: ['issuer.example'],
        timeoutMs: 1_000,
      }),
    ).resolves.toBe('bound')
  })

  it('rejects a resolved DID document whose ID differs from the requested DID', async () => {
    const agent = agentResolving(async () => ({
      didDocument: didDocument({
        id: 'did:web:attacker.example',
        assertionMethod: [verificationMethod(LEAF_PUBLIC_JWK)],
      }),
    }))

    await expect(
      verifyKeyBoundToDid(agent, DID, LEAF_PUBLIC_JWK, ['assertionMethod'], DID_RESOLUTION_POLICY),
    ).resolves.toBe('unresolvable')
  })
})

describe('findBoundVerificationMethodId', () => {
  it('returns the id of the method under the purpose that carries the certificate key', async () => {
    const agent = agentResolving(async () => ({
      didDocument: didDocument({ authentication: [verificationMethod(LEAF_PUBLIC_JWK, `${DID}#auth`)] }),
    }))

    await expect(
      findBoundVerificationMethodId(agent, DID, LEAF_PUBLIC_JWK, ['authentication'], DID_RESOLUTION_POLICY),
    ).resolves.toBe(`${DID}#auth`)
  })

  it('returns null when no method under the purpose carries the key', async () => {
    const agent = agentResolving(async () => ({
      didDocument: didDocument({ authentication: [verificationMethod(OTHER_PUBLIC_JWK, `${DID}#auth`)] }),
    }))

    await expect(
      findBoundVerificationMethodId(agent, DID, LEAF_PUBLIC_JWK, ['authentication'], DID_RESOLUTION_POLICY),
    ).resolves.toBeNull()
  })

  it('returns null for a host outside the resolution policy without resolving', async () => {
    const resolve = vi.fn()
    const agent = agentResolving(resolve)

    await expect(
      findBoundVerificationMethodId(
        agent,
        'did:web:attacker.example',
        LEAF_PUBLIC_JWK,
        ['authentication'],
        DID_RESOLUTION_POLICY,
      ),
    ).resolves.toBeNull()
    expect(resolve).not.toHaveBeenCalled()
  })
})

describe('blockingBindingVerdict', () => {
  it('maps binding failures to fail-closed verdicts', () => {
    expect(blockingBindingVerdict(DID, VTJSC_ID, 'unresolvable')).toMatchObject({
      verdict: 'RESOLVER_UNAVAILABLE',
      evidence: { authorized: null },
    })
    expect(blockingBindingVerdict(DID, VTJSC_ID, 'unbound')).toMatchObject({
      verdict: 'UNTRUSTED',
      evidence: { authorized: null },
    })
  })

  it('does not query Verana after resolution returns a mismatched DID document', async () => {
    const fetchImplementation = vi.fn() as unknown as typeof fetch
    const trustClient = new TrustClient(
      { resolverUrl: 'https://resolver.example/v1/trust', timeoutMs: 1_000 },
      fetchImplementation,
    )
    const agent = agentResolving(async () => ({
      didDocument: didDocument({
        id: 'did:web:attacker.example',
        assertionMethod: [verificationMethod(LEAF_PUBLIC_JWK)],
      }),
    }))
    const binding = await verifyKeyBoundToDid(
      agent,
      DID,
      LEAF_PUBLIC_JWK,
      ['assertionMethod'],
      DID_RESOLUTION_POLICY,
    )

    const verdict =
      binding === 'bound'
        ? await trustClient.verdictFor('issuer', DID, VTJSC_ID)
        : blockingBindingVerdict(DID, VTJSC_ID, binding)

    expect(verdict.verdict).toBe('RESOLVER_UNAVAILABLE')
    expect(fetchImplementation).not.toHaveBeenCalled()
  })
})

const RESOLVER_URL = 'https://resolver.example/v1/trust'

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

  it.each([
    'TRUSTED',
    'PARTIAL',
    'UNTRUSTED',
  ] as const)('accepts only the declared %s trust status', async trustStatus => {
    const fetchImplementation = vi.fn(async () => response(200, { trustStatus })) as unknown as typeof fetch

    await expect(clientWith(fetchImplementation).resolve(DID)).resolves.toEqual({
      status: 'ok',
      trustStatus,
    })
  })

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

  it.each([
    'PARTIAL',
    'UNTRUSTED',
  ] as const)('does not query authorization after a %s resolution', async trustStatus => {
    const fetchImplementation = vi.fn(async () => response(200, { trustStatus })) as unknown as typeof fetch

    await expect(clientWith(fetchImplementation).verdictFor('issuer', DID, VTJSC_ID)).resolves.toMatchObject({
      verdict: 'UNTRUSTED',
    })
    expect(fetchImplementation).toHaveBeenCalledOnce()
  })

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
