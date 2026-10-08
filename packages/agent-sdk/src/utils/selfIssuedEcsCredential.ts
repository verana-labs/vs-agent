import { DidDocumentService, DidRecord, W3cCredentialSchema } from '@credo-ts/core'
import { schemaRequiresValidUntil } from '@verana-labs/vs-agent-model'

import { VsAgent } from '../agent/VsAgent'
import { EcsClaims } from './ecsClaims'
import {
  createPresentation,
  generateDigestSRI,
  getClaims,
  getVerificationMethodId,
  linkedVpFragment,
  signerW3c,
  sortKeysDeep,
} from './setupSelfTr'
import { updateDidRecord } from './publishedDidRecord'
import { createW3cV2Credential, isDataIntegrityVcdm2Credential } from './vcdm2'

const buildIntegrityData = (data: Record<string, unknown>) => {
  return generateDigestSRI(JSON.stringify(sortKeysDeep(data)))
}

interface StoredSelfIssuedCredential {
  issuer?: string | { id?: string }
  validUntil?: string
  credentialSchema?: { id?: string } | Array<{ id?: string }>
  proof?: { verificationMethod?: string } | Array<{ verificationMethod?: string }>
}

function storedCredentialIsCurrent(
  credential: StoredSelfIssuedCredential | undefined,
  credentialSchemaId: string,
  did: string,
  didRecord: DidRecord,
  validUntil: string | undefined,
): boolean {
  if (!credential) return false
  // a credential published by an older agent as data model 1.1 is rebuilt on upgrade
  if (!isDataIntegrityVcdm2Credential(credential)) return false

  const issuer = typeof credential.issuer === 'string' ? credential.issuer : credential.issuer?.id
  if (issuer !== did) return false

  const schema = Array.isArray(credential.credentialSchema)
    ? credential.credentialSchema[0]
    : credential.credentialSchema
  if (schema?.id !== credentialSchemaId) return false
  if (credential.validUntil !== validUntil) return false

  const proofs = !credential.proof
    ? []
    : Array.isArray(credential.proof)
      ? credential.proof
      : [credential.proof]
  if (proofs.length === 0) return false

  const assertionMethods = new Set(
    (didRecord.didDocument?.assertionMethod ?? []).map(entry =>
      typeof entry === 'string' ? entry : entry.id,
    ),
  )
  return proofs.every(proof => !!proof.verificationMethod && assertionMethods.has(proof.verificationMethod))
}

/** The linked presentation as published: VC Data Model 2.0 JSON secured with Data Integrity proofs */
export type SelfIssuedEcsPresentation = Record<string, unknown> & {
  verifiableCredential: Record<string, unknown>[]
}

/**
 * Issues the ECS credential to the agent itself and wraps it in the linked presentation, both
 * secured with a DataIntegrityProof by the DID Document assertion key.
 */
async function signSelfIssuedEcsCredential(
  agent: VsAgent,
  didRecord: DidRecord,
  presentationId: string,
  type: string[],
  claims: Record<string, unknown>,
  credentialSchema: W3cCredentialSchema,
  validUntil: string | undefined,
): Promise<SelfIssuedEcsPresentation> {
  const unsignedCredential = createW3cV2Credential({
    id: agent.did,
    type,
    issuer: agent.did!,
    credentialSubject: { ...claims, id: agent.did },
    credentialSchema: { id: credentialSchema.id, type: credentialSchema.type },
    validUntil,
  })
  const verificationMethodId = getVerificationMethodId(agent.config.logger, didRecord)
  const signedCredential = await signerW3c(agent, unsignedCredential, verificationMethodId)
  const presentation = createPresentation({
    id: presentationId,
    holder: agent.did,
    verifiableCredential: [signedCredential],
  })
  const signedPresentation = await signerW3c(agent, presentation, verificationMethodId)
  return signedPresentation.securedPresentation as unknown as SelfIssuedEcsPresentation
}

export async function publishSelfIssuedEcsPresentation(
  agent: VsAgent,
  id: string,
  ecsSchemas: Record<string, string>,
  schemaKey: string,
  type: string[],
  credentialSchema: W3cCredentialSchema,
  ecsClaims: EcsClaims,
  beforePublish?: (verifiablePresentation: SelfIssuedEcsPresentation) => Promise<void>,
  validUntil?: string,
): Promise<SelfIssuedEcsPresentation> {
  if (!agent.did) throw Error('The DID must be set up')
  const [didRecord] = await agent.dids.getCreatedDids({ did: agent.did })
  const didDocument = didRecord.didDocument
  if (!didDocument) throw Error('The DID Document must be set up')
  const claims = await getClaims(agent.config.logger, ecsSchemas, { id: agent.did }, schemaKey, ecsClaims)
  if (!validUntil && schemaRequiresValidUntil(ecsSchemas[schemaKey])) {
    throw new Error(
      `Not issuing the ${schemaKey} credential: its schema requires validUntil and the ISSUER participant has no effective_until`,
    )
  }
  const didDocumentServiceId = `${agent.did}#${linkedVpFragment(schemaKey)}`
  const integrityData = buildIntegrityData({ id, type, credentialSchema, claims })
  const record = didRecord.metadata.get('_vt/vtc') ?? {}
  const metadata = record[credentialSchema.id]
  const superseded = Object.entries(record).some(
    ([storedSchemaId, entry]) =>
      storedSchemaId !== credentialSchema.id &&
      entry?.verifiablePresentation?.id === id &&
      entry?.attached !== false,
  )
  const attached = (metadata?.attached ?? true) && !superseded
  if (
    metadata?.integrityData === integrityData &&
    storedCredentialIsCurrent(metadata?.credential, credentialSchema.id, agent.did, didRecord, validUntil)
  ) {
    // the presentation is already public, so a failed beforePublish step still needs a retry here
    if (attached) await beforePublish?.(metadata.verifiablePresentation)
    return metadata.verifiablePresentation
  }

  const verifiablePresentation = await signSelfIssuedEcsCredential(
    agent,
    didRecord,
    id,
    type,
    claims as Record<string, unknown>,
    credentialSchema,
    validUntil,
  )
  // nothing is persisted yet, so a failure here leaves no public presentation behind
  if (attached) await beforePublish?.(verifiablePresentation)
  // Update linked VP when the presentation has changed. Match by fragment or by the file the
  // endpoint ends with: a `contains` test also matches the host, so an agent at a host such as
  // ecs-org-issuer.example rewrote its DIDComm endpoint and every other ECS linked VP onto this one.
  const linkedVpFile = `/${schemaKey}-vtc-vp.json`
  if (attached)
    didDocument.service = didDocument.service?.map(s => {
      if (typeof s.serviceEndpoint !== 'string') return s
      if (s.type !== 'LinkedVerifiablePresentation' || s.id === `${agent.did}#whois`) return s
      if (s.id !== didDocumentServiceId && !s.serviceEndpoint.endsWith(linkedVpFile)) return s
      s.id = didDocumentServiceId
      s.serviceEndpoint = id
      return s
    })
  // Resolvers only discover the credential through the [VT-CRED-W3C-LINKED-VP] fragment, and
  // #whois does not match it. The rename above only covers documents that already carry the
  // service, so publish it here when nothing declared it yet.
  if (attached && !didDocument.service?.some(s => s.id === didDocumentServiceId)) {
    didDocument.service = [
      ...(didDocument.service ?? []),
      new DidDocumentService({
        id: didDocumentServiceId,
        serviceEndpoint: id,
        type: 'LinkedVerifiablePresentation',
      }),
    ]
  }
  const whoisId = `${agent.did}#whois`
  if (attached && schemaKey === 'ecs-service') {
    const whois = didDocument.service?.find(s => s.id === whoisId)
    if (whois) {
      whois.serviceEndpoint = id
    } else {
      didDocument.service = [
        ...(didDocument.service ?? []),
        new DidDocumentService({ id: whoisId, serviceEndpoint: id, type: 'LinkedVerifiablePresentation' }),
      ]
    }
  }
  const [credential] = verifiablePresentation.verifiableCredential
  record[credentialSchema.id] = {
    credential,
    verifiablePresentation,
    didDocumentServiceId,
    integrityData,
    attached,
  }
  didRecord.metadata.set('_vt/vtc', record)
  // the write point publishes the document when it changed, and triggers the resolver when the
  // published material did ([VSA-VT-LVP-5]): an ECS credential re-issued under the same URL changes
  // the presentation a resolver reads, without changing the entry that announces it
  await updateDidRecord(agent, didRecord)
  return verifiablePresentation
}
