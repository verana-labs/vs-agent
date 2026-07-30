// Must be imported before @credo-ts/askar so the native askar binding is initialised
import { askar } from '@openwallet-foundation/askar-nodejs'
import { AskarModule } from '@credo-ts/askar'
import {
  Agent,
  ClaimFormat,
  DidsModule,
  KeyDidRegistrar,
  KeyDidResolver,
  W3cCredentialsModule,
  W3cJsonLdVerifiableCredential,
  W3cJsonLdVerifiablePresentation,
} from '@credo-ts/core'
import { agentDependencies } from '@credo-ts/node'
import { beforeAll, describe, expect, it } from 'vitest'

// No type definitions available for this library
// @ts-expect-error
import { purposes } from '@digitalcredentials/jsonld-signatures'

import { defaultDocumentLoader } from '../src/did/CachedDocumentLoader'
import { createCredential, createPresentation } from '../src/utils/setupSelfTr'

const CREDENTIALS_V2 = 'https://www.w3.org/ns/credentials/v2'
const ED25519_2020_CONTEXT = 'https://w3id.org/security/suites/ed25519-2020/v1'

/**
 * Exercises the issuance path used for the agent's self-issued trust artifacts: build a credential
 * with `createCredential`, sign it as a linked data proof, and verify the result. This is what
 * catches a data model 2.0 credential that the document loader cannot expand or that the
 * underlying VC library rejects.
 *
 * Sign-and-verify roundtrips use Ed25519Signature2018 because `did:key` resolves to an
 * `Ed25519VerificationKey2018` verification method, which the Ed25519Signature2020 suite refuses to
 * verify against, independently of the data model version. Agents in production use `did:webvh`
 * documents carrying `Ed25519VerificationKey2020`; what that suite contributes to a data model 2.0
 * credential is covered by the signing-side test below.
 */
describe('setupSelfTr credential issuance', () => {
  let agent: Agent
  let verificationMethod: string
  let did: string

  beforeAll(async () => {
    agent = new Agent({
      dependencies: agentDependencies,
      config: {},
      modules: {
        askar: new AskarModule({ askar, store: { id: 'setupSelfTr-test', key: 'setupSelfTr-test-key' } }),
        dids: new DidsModule({ registrars: [new KeyDidRegistrar()], resolvers: [new KeyDidResolver()] }),
        w3cCredentials: new W3cCredentialsModule({ documentLoader: defaultDocumentLoader }),
      },
    })
    await agent.initialize()

    const key = await agent.kms.createKey({ type: { kty: 'OKP', crv: 'Ed25519' } })
    const created = await agent.dids.create({ method: 'key', options: { keyId: key.keyId } })

    did = created.didState.did as string
    // did:key is self-resolving, so the created DID record carries no DID document
    const didDocument = await agent.dids.resolveDidDocument(did)
    verificationMethod = didDocument.assertionMethod?.[0] as string
  }, 60_000)

  const signCredential = (
    credential: ReturnType<typeof createCredential>,
    proofType = 'Ed25519Signature2018',
  ): Promise<W3cJsonLdVerifiableCredential> =>
    agent.w3cCredentials.signCredential<ClaimFormat.LdpVc>({
      format: ClaimFormat.LdpVc,
      credential,
      proofType,
      verificationMethod,
    })

  const trustCredential = () =>
    createCredential({
      type: ['VerifiableCredential', 'VerifiableTrustCredential'],
      issuer: did,
      credentialSubject: { id: did, claims: { name: 'Test Service' } },
    })

  it('defaults to the data model 2.0 context with validFrom and validUntil', () => {
    const credential = createCredential({
      id: 'https://example.org/vt/schemas-example-org-jsc.json',
      type: ['VerifiableCredential', 'JsonSchemaCredential'],
      issuer: did,
      credentialSubject: { id: 'https://example.org/vt/cs/v1/js/ecs-org' },
    })

    expect(credential.context[0]).toBe(CREDENTIALS_V2)
    expect(credential.dataModelVersion).toBe('2.0')
    expect(credential.validFrom).toBeDefined()
    expect(credential.validUntil).toBeDefined()
    expect(credential.issuanceDate).toBeUndefined()
    expect(credential.expirationDate).toBeUndefined()
  })

  it('still issues a data model 1.1 credential when a caller passes the 1.1 context', () => {
    const credential = createCredential({
      context: ['https://www.w3.org/2018/credentials/v1'],
      type: ['VerifiableCredential'],
      issuer: did,
      credentialSubject: { id: did },
    })

    expect(credential.dataModelVersion).toBe('1.1')
    expect(credential.issuanceDate).toBeDefined()
    expect(credential.expirationDate).toBeDefined()
    expect(credential.validFrom).toBeUndefined()
    expect(credential.validUntil).toBeUndefined()
  })

  it('signs and verifies a data model 2.0 credential', async () => {
    const credential = createCredential({
      id: 'https://example.org/vt/schemas-example-org-jsc.json',
      type: ['VerifiableCredential', 'JsonSchemaCredential'],
      issuer: did,
      credentialSubject: {
        id: 'https://example.org/vt/cs/v1/js/ecs-org',
        claims: { type: 'JsonSchema', jsonSchema: { $ref: 'https://example.org/vt/cs/v1/js/ecs-org' } },
      },
    })

    const signed = await signCredential(credential)

    expect(signed).toBeInstanceOf(W3cJsonLdVerifiableCredential)
    expect(signed.jsonCredential).not.toHaveProperty('issuanceDate')
    expect(signed.jsonCredential.validFrom).toBe(credential.validFrom)
    expect(signed.jsonCredential.validUntil).toBe(credential.validUntil)

    const result = await agent.w3cCredentials.verifyCredential({ credential: signed })
    expect(result.isValid).toBe(true)
  }, 30_000)

  it('signs and verifies a data model 2.0 presentation embedding the credential', async () => {
    const signedCredential = await signCredential(trustCredential())

    const presentation = createPresentation({
      id: 'https://example.org/vt/schemas-example-service-c-vp.json',
      holder: did,
      verifiableCredential: [signedCredential],
    })
    expect(presentation.context[0]).toBe(CREDENTIALS_V2)

    const signedPresentation = await agent.w3cCredentials.signPresentation<ClaimFormat.LdpVp>({
      format: ClaimFormat.LdpVp,
      presentation,
      proofType: 'Ed25519Signature2018',
      proofPurpose: new purposes.AuthenticationProofPurpose({ challenge: 'test-challenge' }),
      verificationMethod,
      challenge: 'test-challenge',
    })

    expect(signedPresentation).toBeInstanceOf(W3cJsonLdVerifiablePresentation)

    const result = await agent.w3cCredentials.verifyPresentation({
      presentation: signedPresentation,
      challenge: 'test-challenge',
    })
    expect(result.isValid).toBe(true)
  }, 30_000)

  it('rejects a data model 2.0 credential whose validity was extended after signing', async () => {
    const signed = await signCredential(trustCredential())

    const tampered = W3cJsonLdVerifiableCredential.fromJson({
      ...signed.jsonCredential,
      validUntil: new Date(Date.now() + 20 * 365 * 24 * 60 * 60 * 1000).toISOString(),
    })

    const result = await agent.w3cCredentials.verifyCredential({ credential: tampered })
    expect(result.isValid).toBe(false)
  }, 30_000)

  it('adds the Ed25519Signature2020 suite context, which the data model 2.0 context does not define', async () => {
    const signed = await signCredential(trustCredential(), 'Ed25519Signature2020')

    expect(signed.context).toContain(ED25519_2020_CONTEXT)
    expect(signed.dataModelVersion).toBe('2.0')
  }, 30_000)
})
