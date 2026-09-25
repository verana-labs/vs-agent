import type { BaseAgent, DidDocument, VerificationMethod } from '@credo-ts/core'

import { describe, expect, it, vi } from 'vitest'

import { findBoundVerificationMethodId, verifyKeyBoundToDid } from '../src/trust/keyBinding'

import { LEAF_PRIVATE_JWK, OTHER_PRIVATE_JWK } from './helpers/certificates'

const DID = 'did:web:issuer.example'
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

    await expect(verifyKeyBoundToDid(agent, DID, certificateJwk, ['assertionMethod'])).resolves.toBe('bound')
  })

  it('accepts a dereferenced assertionMethod key', async () => {
    const methodId = `${DID}#assertion`
    const agent = agentResolving(async () => ({
      didDocument: didDocument({
        assertionMethod: [methodId],
        dereferenced: { [methodId]: verificationMethod(LEAF_PUBLIC_JWK, methodId) },
      }),
    }))

    await expect(verifyKeyBoundToDid(agent, DID, LEAF_PUBLIC_JWK, ['assertionMethod'])).resolves.toBe('bound')
  })

  it('rejects a trusted DID asserted by an attacker certificate', async () => {
    const agent = agentResolving(async () => ({
      didDocument: didDocument({ assertionMethod: [verificationMethod(LEAF_PUBLIC_JWK)] }),
    }))

    await expect(verifyKeyBoundToDid(agent, DID, OTHER_PUBLIC_JWK, ['assertionMethod'])).resolves.toBe(
      'unbound',
    )
  })

  it('rejects a key present only under authentication for issuer binding', async () => {
    const agent = agentResolving(async () => ({
      didDocument: didDocument({ authentication: [verificationMethod(LEAF_PUBLIC_JWK)] }),
    }))

    await expect(verifyKeyBoundToDid(agent, DID, LEAF_PUBLIC_JWK, ['assertionMethod'])).resolves.toBe(
      'unbound',
    )
    await expect(verifyKeyBoundToDid(agent, DID, LEAF_PUBLIC_JWK, ['authentication'])).resolves.toBe('bound')
  })

  it('rejects a dangling assertionMethod reference', async () => {
    const agent = agentResolving(async () => ({
      didDocument: didDocument({ assertionMethod: [`${DID}#missing`] }),
    }))

    await expect(verifyKeyBoundToDid(agent, DID, LEAF_PUBLIC_JWK, ['assertionMethod'])).resolves.toBe(
      'unbound',
    )
  })

  it('fails closed when DID resolution throws or returns no document', async () => {
    const throwingAgent = agentResolving(async () => {
      throw new Error('resolver unavailable')
    })
    const emptyAgent = agentResolving(async () => ({ didDocument: null }))

    await expect(verifyKeyBoundToDid(throwingAgent, DID, LEAF_PUBLIC_JWK, ['assertionMethod'])).resolves.toBe(
      'unresolvable',
    )
    await expect(verifyKeyBoundToDid(emptyAgent, DID, LEAF_PUBLIC_JWK, ['assertionMethod'])).resolves.toBe(
      'unresolvable',
    )
  })

  it('fails closed for a missing DID or malformed certificate key', async () => {
    const resolve = vi.fn(async () => ({
      didDocument: didDocument({ assertionMethod: [verificationMethod(LEAF_PUBLIC_JWK)] }),
    }))
    const agent = agentResolving(resolve)

    await expect(verifyKeyBoundToDid(agent, null, LEAF_PUBLIC_JWK, ['assertionMethod'])).resolves.toBe(
      'unbound',
    )
    await expect(
      verifyKeyBoundToDid(agent, DID, { kty: 'EC', crv: 'P-256' }, ['assertionMethod']),
    ).resolves.toBe('unbound')
    expect(resolve).not.toHaveBeenCalled()
  })

  it.each([
    'did:key:z6Mktest',
    'did:web:',
  ])('rejects an unsupported or malformed DID target %s before resolution', async did => {
    const resolve = vi.fn(async () => ({
      didDocument: didDocument({ assertionMethod: [verificationMethod(LEAF_PUBLIC_JWK)] }),
    }))

    await expect(
      verifyKeyBoundToDid(agentResolving(resolve), did, LEAF_PUBLIC_JWK, ['assertionMethod']),
    ).resolves.toBe('unresolvable')
    expect(resolve).not.toHaveBeenCalled()
  })

  it.each([
    'did:web:localhost%3A3000',
    'did:web:agent.local',
    'did:web:service.internal',
    'did:web:10.1.2.3',
  ])('resolves the agent own DID %s', async did => {
    const method = verificationMethod(LEAF_PUBLIC_JWK, `${did}#assertion`)
    const resolve = vi.fn(async () => ({ didDocument: didDocument({ id: did, assertionMethod: [method] }) }))

    await expect(
      verifyKeyBoundToDid(agentResolving(resolve), did, LEAF_PUBLIC_JWK, ['assertionMethod']),
    ).resolves.toBe('bound')
    expect(resolve).toHaveBeenCalledOnce()
  })

  it('bypasses and does not persist DID resolver cache entries for key binding', async () => {
    const resolve = vi.fn(async () => ({
      didDocument: didDocument({ assertionMethod: [verificationMethod(LEAF_PUBLIC_JWK)] }),
    }))

    await expect(
      verifyKeyBoundToDid(agentResolving(resolve), DID, LEAF_PUBLIC_JWK, ['assertionMethod']),
    ).resolves.toBe('bound')

    expect(resolve).toHaveBeenCalledWith(DID, { useCache: false, persistInCache: false })
  })

  it('bounds DID resolution by a timeout', async () => {
    vi.useFakeTimers()
    const agent = agentResolving(async () => await new Promise(() => {}))

    const binding = verifyKeyBoundToDid(agent, DID, LEAF_PUBLIC_JWK, ['assertionMethod'])
    await vi.advanceTimersByTimeAsync(5_000)

    await expect(binding).resolves.toBe('unresolvable')
    vi.useRealTimers()
  })

  it('supports a did:webvh host', async () => {
    const webVhDid = 'did:webvh:QmFixtureScid:issuer.example'
    const method = verificationMethod(LEAF_PUBLIC_JWK, `${webVhDid}#assertion`)
    const agent = agentResolving(async () => ({
      didDocument: didDocument({ id: webVhDid, assertionMethod: [method] }),
    }))

    await expect(verifyKeyBoundToDid(agent, webVhDid, LEAF_PUBLIC_JWK, ['assertionMethod'])).resolves.toBe(
      'bound',
    )
  })

  it('rejects a resolved DID document whose ID differs from the requested DID', async () => {
    const agent = agentResolving(async () => ({
      didDocument: didDocument({
        id: 'did:web:attacker.example',
        assertionMethod: [verificationMethod(LEAF_PUBLIC_JWK)],
      }),
    }))

    await expect(verifyKeyBoundToDid(agent, DID, LEAF_PUBLIC_JWK, ['assertionMethod'])).resolves.toBe(
      'unresolvable',
    )
  })
})

describe('findBoundVerificationMethodId', () => {
  it('returns the id of the method under the purpose that carries the certificate key', async () => {
    const agent = agentResolving(async () => ({
      didDocument: didDocument({ authentication: [verificationMethod(LEAF_PUBLIC_JWK, `${DID}#auth`)] }),
    }))

    await expect(
      findBoundVerificationMethodId(agent, DID, LEAF_PUBLIC_JWK, ['authentication']),
    ).resolves.toBe(`${DID}#auth`)
  })

  it('returns null when no method under the purpose carries the key', async () => {
    const agent = agentResolving(async () => ({
      didDocument: didDocument({ authentication: [verificationMethod(OTHER_PUBLIC_JWK, `${DID}#auth`)] }),
    }))

    await expect(
      findBoundVerificationMethodId(agent, DID, LEAF_PUBLIC_JWK, ['authentication']),
    ).resolves.toBeNull()
  })

  it('returns null for a DID method that never resolves, without resolving', async () => {
    const resolve = vi.fn()
    const agent = agentResolving(resolve)

    await expect(
      findBoundVerificationMethodId(agent, 'did:key:z6Mktest', LEAF_PUBLIC_JWK, ['authentication']),
    ).resolves.toBeNull()
    expect(resolve).not.toHaveBeenCalled()
  })
})
