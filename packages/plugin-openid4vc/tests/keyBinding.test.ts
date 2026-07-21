import type { BaseAgent, DidDocument, VerificationMethod } from '@credo-ts/core'

import { describe, expect, it, vi } from 'vitest'

import { TrustClient } from '../src/trust/TrustClient'
import { blockingBindingVerdict, verifyKeyBoundToDid } from '../src/trust/keyBinding'

import { LEAF_PRIVATE_JWK, OTHER_PRIVATE_JWK } from './helpers/certificates'

const DID = 'did:web:issuer.example'
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
  assertionMethod,
  authentication,
  dereferenced = {},
}: {
  assertionMethod?: Array<string | VerificationMethod>
  authentication?: Array<string | VerificationMethod>
  dereferenced?: Record<string, VerificationMethod>
}): DidDocument =>
  ({
    id: DID,
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

  it('does not query Verana after key binding has failed', async () => {
    const fetchImplementation = vi.fn() as unknown as typeof fetch
    const trustClient = new TrustClient(
      { resolverUrl: 'https://resolver.example/v1/trust', timeoutMs: 1_000 },
      fetchImplementation,
    )
    const binding = 'unbound' as const

    const verdict =
      binding === ('bound' as string)
        ? await trustClient.verdictFor('issuer', DID, VTJSC_ID)
        : blockingBindingVerdict(DID, VTJSC_ID, binding)

    expect(verdict.verdict).toBe('UNTRUSTED')
    expect(fetchImplementation).not.toHaveBeenCalled()
  })
})
