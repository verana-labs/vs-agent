// Must be imported before @credo-ts/askar so the native askar binding is initialised
import { askar } from '@openwallet-foundation/askar-nodejs'
import { AskarModule } from '@credo-ts/askar'
import {
  Agent,
  CREDENTIALS_CONTEXT_V2_URL,
  DidsModule,
  KeyDidRegistrar,
  KeyDidResolver,
  RecordNotFoundError,
  W3cV2CredentialRecord,
  W3cV2DataIntegrityVerifiableCredential,
  W3cV2DataIntegrityVerifiablePresentation,
} from '@credo-ts/core'
import {
  type DataIntegrityCredential,
  type DataIntegrityCredentialRequest,
  DidCommCredentialExchangeRecord,
  DidCommCredentialPreviewAttribute,
  DidCommCredentialRole,
  DidCommCredentialState,
  DidCommDataIntegrityCredentialFormatService,
} from '@credo-ts/didcomm'
import { agentDependencies } from '@credo-ts/node'
import { beforeAll, describe, expect, it } from 'vitest'

import {
  createW3cV2Credential,
  isVcdm2Credential,
  signLinkedDataIntegrityPresentation,
  toOfferedCredentialJson,
} from '../src/utils'

const VC_1_1_CONTEXT = 'https://www.w3.org/2018/credentials/v1'

/**
 * Drives the patched W3C Data Integrity credential format (Aries RFC 0809, credo PR 2898) the way
 * vt-flow does, with a real agent: the validator offers the VC Data Model 2.0 credential the
 * orchestrator builds, the applicant requests it, the validator secures it with a DataIntegrityProof
 * and the applicant verifies and stores it as a W3cV2CredentialRecord. The linked VP the applicant
 * then publishes is signed the way createVtc signs it.
 *
 * The format service is exercised directly, as the credential protocol only moves attachments
 * between the two sides; one agent plays both roles.
 */
describe('VC Data Model 2.0 issuance over the Data Integrity credential format', () => {
  let agent: Agent
  let did: string
  let verificationMethodId: string
  const formatService = new DidCommDataIntegrityCredentialFormatService()

  beforeAll(async () => {
    agent = new Agent({
      dependencies: agentDependencies,
      config: {},
      modules: {
        askar: new AskarModule({
          askar,
          store: { id: 'data-integrity-issuance-test', key: 'data-integrity-issuance-test-key' },
        }),
        dids: new DidsModule({ registrars: [new KeyDidRegistrar()], resolvers: [new KeyDidResolver()] }),
      },
    })
    await agent.initialize()

    const key = await agent.kms.createKey({ type: { kty: 'OKP', crv: 'Ed25519' } })
    const created = await agent.dids.create({ method: 'key', options: { keyId: key.keyId } })
    did = created.didState.did as string
    const didDocument = await agent.dids.resolveDidDocument(did)
    verificationMethodId = didDocument.assertionMethod?.[0] as string
  }, 60_000)

  const trustCredential = () =>
    toOfferedCredentialJson(
      createW3cV2Credential({
        id: `${did}#vtc-1`,
        type: ['VerifiableCredential', 'VerifiableTrustCredential'],
        issuer: did,
        credentialSubject: { id: did, name: 'Test Service', countryCode: 'AR' },
        credentialSchema: {
          id: 'https://example.org/vt/schemas-example-service-jsc.json',
          type: 'JsonSchemaCredential',
        },
      }),
    )

  const newExchange = () =>
    new DidCommCredentialExchangeRecord({
      protocolVersion: 'v2',
      role: DidCommCredentialRole.Issuer,
      state: DidCommCredentialState.ProposalReceived,
      threadId: 'f365c1a5-2baf-4873-9432-fa83790a9c30',
    })

  /** Offer and request, the steps shared by the issuance tests */
  const offerAndRequest = async (credential = trustCredential()) => {
    const credentialExchangeRecord = newExchange()
    const { attachment: offerAttachment, previewAttributes } = await formatService.createOffer(
      agent.context,
      {
        credentialExchangeRecord,
        credentialFormats: { dataIntegrity: { credential, bindingRequired: false } },
      },
    )
    // the credential protocol takes the preview attributes onto the record
    credentialExchangeRecord.credentialAttributes = previewAttributes?.map(
      attribute => new DidCommCredentialPreviewAttribute(attribute),
    )
    await formatService.processOffer(agent.context, { credentialExchangeRecord, attachment: offerAttachment })
    const { attachment: requestAttachment } = await formatService.acceptOffer(agent.context, {
      credentialExchangeRecord,
      offerAttachment,
      credentialFormats: { dataIntegrity: {} },
    })
    return { credential, credentialExchangeRecord, offerAttachment, requestAttachment }
  }

  it('builds a data model 2.0 credential with the claims on the subject and a ten year validity', () => {
    const credential = trustCredential()

    expect((credential['@context'] as string[])[0]).toBe(CREDENTIALS_CONTEXT_V2_URL)
    expect(isVcdm2Credential(credential)).toBe(true)
    expect(credential.credentialSubject).toEqual({ id: did, name: 'Test Service', countryCode: 'AR' })
    expect(credential).not.toHaveProperty('issuanceDate')
    expect(credential.validFrom).toBeDefined()
    expect(credential.validUntil).toBeDefined()
    expect(new Date(credential.validUntil as string).getTime()).toBeGreaterThan(
      new Date(credential.validFrom as string).getTime(),
    )
  })

  it('advertises the data model of the offered credential and echoes it on the request', async () => {
    const { offerAttachment, requestAttachment, credentialExchangeRecord } = await offerAndRequest()

    expect(offerAttachment.getDataAsJson()).toMatchObject({
      data_model_versions_supported: ['2.0'],
      binding_required: false,
    })
    expect(requestAttachment.getDataAsJson<DataIntegrityCredentialRequest>().data_model_version).toBe('2.0')
    expect(credentialExchangeRecord.credentialAttributes?.map(a => a.name).sort()).toEqual(
      ['countryCode', 'id', 'name'].sort(),
    )
  })

  it('selects the first registered cryptosuite for the issuer key when none is named', async () => {
    const { credentialExchangeRecord, offerAttachment, requestAttachment } = await offerAndRequest()

    // an auto-accepted request arrives without credential formats
    const { attachment } = await formatService.acceptRequest(agent.context, {
      credentialExchangeRecord,
      offerAttachment,
      requestAttachment,
    })

    expect(attachment.getDataAsJson<DataIntegrityCredential>().credential).toMatchObject({
      proof: { type: 'DataIntegrityProof', cryptosuite: 'eddsa-jcs-2022' },
    })
  }, 30_000)

  it('rejects the anoncreds cryptosuite for a data model 2.0 credential', async () => {
    const { credentialExchangeRecord, offerAttachment, requestAttachment } = await offerAndRequest()

    await expect(
      formatService.acceptRequest(agent.context, {
        credentialExchangeRecord,
        offerAttachment,
        requestAttachment,
        credentialFormats: { dataIntegrity: { cryptosuite: 'anoncreds-2023' } },
      }),
    ).rejects.toThrow(/cannot be used to secure a VC Data Model 2.0 credential/)
  })

  it('determines the data model version from the base context only', async () => {
    const offerOf = (context: string[]) =>
      formatService.createOffer(agent.context, {
        credentialExchangeRecord: newExchange(),
        credentialFormats: {
          dataIntegrity: {
            credential: { ...trustCredential(), '@context': context },
            bindingRequired: false,
          },
        },
      })

    const { attachment } = await offerOf([CREDENTIALS_CONTEXT_V2_URL, VC_1_1_CONTEXT])
    expect(attachment.getDataAsJson()).toMatchObject({ data_model_versions_supported: ['2.0'] })

    await expect(
      offerOf(['https://www.w3.org/ns/credentials/examples/v2', CREDENTIALS_CONTEXT_V2_URL]),
    ).rejects.toThrow(/Cannot determine credential version from @context/)
  })

  it('issues the credential with a DataIntegrityProof and stores it as a W3cV2CredentialRecord', async () => {
    const { credential, credentialExchangeRecord, offerAttachment, requestAttachment } =
      await offerAndRequest()

    const { attachment: credentialAttachment } = await formatService.acceptRequest(agent.context, {
      credentialExchangeRecord,
      offerAttachment,
      requestAttachment,
      credentialFormats: { dataIntegrity: { cryptosuite: 'eddsa-jcs-2022' } },
    })

    const { credential: issued } = credentialAttachment.getDataAsJson<DataIntegrityCredential>()
    expect(issued).toMatchObject({
      '@context': credential['@context'],
      id: credential.id,
      validFrom: credential.validFrom,
      validUntil: credential.validUntil,
      credentialSubject: credential.credentialSubject,
      proof: { type: 'DataIntegrityProof', cryptosuite: 'eddsa-jcs-2022', proofPurpose: 'assertionMethod' },
    })

    await formatService.processCredential(agent.context, {
      credentialExchangeRecord,
      attachment: credentialAttachment,
      requestAttachment,
      offerAttachment,
    })

    // the exchange record keeps the format's single record type, which routes deletion back here
    expect(credentialExchangeRecord.credentials).toEqual([
      { credentialRecordType: 'w3c', credentialRecordId: expect.any(String) },
    ])
    const credentialRecordId = credentialExchangeRecord.credentials[0].credentialRecordId
    const stored = await agent.w3cV2Credentials.getById(credentialRecordId)
    expect(stored).toBeInstanceOf(W3cV2CredentialRecord)
    // removeStoredTrustCredential finds the record through this tag
    expect(stored.getTags().givenId).toBe(credential.id)
    expect(stored.firstCredential).toBeInstanceOf(W3cV2DataIntegrityVerifiableCredential)

    const verified = await agent.w3cV2Credentials.verifyCredential({
      credential: stored.firstCredential as W3cV2DataIntegrityVerifiableCredential,
    })
    expect(verified.isValid).toBe(true)

    const tampered = W3cV2DataIntegrityVerifiableCredential.fromObject({
      ...issued,
      validUntil: new Date(Date.now() + 20 * 365 * 24 * 60 * 60 * 1000).toISOString(),
    } as unknown as Parameters<typeof W3cV2DataIntegrityVerifiableCredential.fromObject>[0])
    const rejected = await agent.w3cV2Credentials.verifyCredential({ credential: tampered })
    expect(rejected.isValid).toBe(false)

    // deletion finds the data model 2.0 record in its own store
    await formatService.deleteCredentialById(agent.context, credentialRecordId)
    await expect(agent.w3cV2Credentials.getById(credentialRecordId)).rejects.toThrow(RecordNotFoundError)
    await expect(formatService.deleteCredentialById(agent.context, credentialRecordId)).rejects.toThrow(
      RecordNotFoundError,
    )
  }, 30_000)

  it('rejects a received credential that does not match the offer', async () => {
    const { credentialExchangeRecord, offerAttachment, requestAttachment } = await offerAndRequest()
    const { attachment: credentialAttachment } = await formatService.acceptRequest(agent.context, {
      credentialExchangeRecord,
      offerAttachment,
      requestAttachment,
      credentialFormats: { dataIntegrity: { cryptosuite: 'eddsa-jcs-2022' } },
    })
    const { credential: issued } = credentialAttachment.getDataAsJson<DataIntegrityCredential>()
    const forged = formatService.getFormatData(
      {
        credential: {
          ...issued,
          credentialSubject: { ...(issued.credentialSubject as object), name: 'Other' },
        },
      },
      credentialAttachment.id,
    )

    await expect(
      formatService.processCredential(agent.context, {
        credentialExchangeRecord: newExchange(),
        attachment: forged,
        requestAttachment,
        offerAttachment,
      }),
    ).rejects.toThrow(/Missing credential attributes|does not match the offered credential/)
  })

  it('publishes the received credential in a data model 2.0 linked VP secured with a DataIntegrityProof', async () => {
    const { credentialExchangeRecord, offerAttachment, requestAttachment } = await offerAndRequest()
    const { attachment } = await formatService.acceptRequest(agent.context, {
      credentialExchangeRecord,
      offerAttachment,
      requestAttachment,
      credentialFormats: { dataIntegrity: { cryptosuite: 'eddsa-jcs-2022' } },
    })
    const received = W3cV2DataIntegrityVerifiableCredential.fromObject(
      attachment.getDataAsJson<DataIntegrityCredential>().credential as Parameters<
        typeof W3cV2DataIntegrityVerifiableCredential.fromObject
      >[0],
    )

    const presentation = await signLinkedDataIntegrityPresentation(agent, {
      id: 'https://example.org/vt/schemas-example-service-vtc-vp.json',
      holder: did,
      credential: received,
      verificationMethodId,
    })

    expect(presentation).toBeInstanceOf(W3cV2DataIntegrityVerifiablePresentation)
    expect(presentation.securedPresentation).toMatchObject({
      '@context': [CREDENTIALS_CONTEXT_V2_URL],
      id: 'https://example.org/vt/schemas-example-service-vtc-vp.json',
      holder: did,
      verifiableCredential: [received.securedCredential],
      proof: { type: 'DataIntegrityProof', cryptosuite: 'eddsa-jcs-2022', proofPurpose: 'authentication' },
    })
    expect(presentation.securedPresentation.proof).not.toHaveProperty('challenge')

    const result = await agent.w3cV2Credentials.verifyPresentation({ presentation } as never)
    expect(result.isValid).toBe(true)
  }, 30_000)

  it('keeps issuing data model 1.1 credentials with a linked data proof over the same format', async () => {
    // only terms the base context defines, as a linked data proof drops undefined ones
    const credential = {
      '@context': [VC_1_1_CONTEXT],
      type: ['VerifiableCredential'],
      issuer: did,
      issuanceDate: '2024-01-01T00:00:00Z',
      credentialSubject: { id: did },
    }
    const { offerAttachment, requestAttachment, credentialExchangeRecord } = await offerAndRequest(
      credential as never,
    )
    expect(offerAttachment.getDataAsJson()).toMatchObject({ data_model_versions_supported: ['1.1'] })
    expect(isVcdm2Credential(credential)).toBe(false)

    const { attachment } = await formatService.acceptRequest(agent.context, {
      credentialExchangeRecord,
      offerAttachment,
      requestAttachment,
    })
    const issued = attachment.getDataAsJson<DataIntegrityCredential>().credential
    expect(issued).toMatchObject({ issuanceDate: '2024-01-01T00:00:00Z' })
    expect((issued.proof as { type: string }).type).toMatch(/^Ed25519Signature20(18|20)$/)
  }, 30_000)

  it('explains that the anoncreds link secret binding needs the AnonCredsModule', async () => {
    await expect(
      formatService.createOffer(agent.context, {
        credentialExchangeRecord: newExchange(),
        credentialFormats: {
          dataIntegrity: {
            credential: {
              '@context': [VC_1_1_CONTEXT],
              type: ['VerifiableCredential'],
              issuer: did,
              issuanceDate: '2024-01-01T00:00:00Z',
              credentialSubject: { name: 'John' },
            },
            bindingRequired: true,
            anonCredsLinkSecretBinding: {
              credentialDefinitionId: 'did:example:issuer/anoncreds/v0/CLAIM_DEF/1/tag',
            },
          },
        },
      }),
    ).rejects.toThrow(/Register the AnonCredsModule/)
  })

  it('rejects the anoncreds link secret binding for a data model 2.0 credential', async () => {
    await expect(
      formatService.createOffer(agent.context, {
        credentialExchangeRecord: newExchange(),
        credentialFormats: {
          dataIntegrity: {
            credential: trustCredential(),
            bindingRequired: true,
            anonCredsLinkSecretBinding: {
              credentialDefinitionId: 'did:example:issuer/anoncreds/v0/CLAIM_DEF/1/tag',
            },
          },
        },
      }),
    ).rejects.toThrow(/not supported for VC Data Model 2.0 credentials/)
  })
})
