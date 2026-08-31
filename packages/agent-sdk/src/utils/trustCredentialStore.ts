import {
  DidDocumentService,
  DidRecord,
  DidRepository,
  JsonTransformer,
  W3cCredential,
  W3cJsonLdVerifiableCredential,
  W3cJsonLdVerifiablePresentation,
  utils,
} from '@credo-ts/core'
import { computeCredentialDigestJCS } from '@verana-labs/verre'

import { VsAgent } from '../agent/VsAgent'
import { applyAdminApiServiceEntry } from '../did/adminApiService'

import {
  addDigestSRI,
  createCredential,
  createJsonSchema,
  createJsonSubjectRef,
  createPresentation,
  getVerificationMethodId,
  linkedVpFragment,
  signerW3c,
} from './setupSelfTr'
import { publishSelfIssuedEcsPresentation } from './selfIssuedEcsCredential'
import { EcsClaims } from './ecsClaims'
import { getEcsSchemas } from './data'

async function getDidRecord(agent: VsAgent) {
  const [didRecord] = await agent.dids.getCreatedDids({ did: agent.did })
  return didRecord
}

async function updateDidRecord(agent: VsAgent, didRecord: DidRecord) {
  const repo = agent.context.dependencyManager.resolve(DidRepository)
  applyAdminApiServiceEntry(didRecord.didDocument!, agent.adminApiServiceEndpoint)
  await repo.update(agent.context, didRecord)
  await agent.dids.update({ did: didRecord.did, didDocument: didRecord.didDocument! })
}

export function findMetadataEntry(
  didRecord: DidRecord,
  key: '_vt/vtc' | '_vt/jsc',
  id?: string,
  jsonSchemaRef?: string,
) {
  const metadata = didRecord.metadata.get(key)
  if (!metadata) return null
  if (!id && !jsonSchemaRef) return { schemaId: '', data: metadata, didDocumentServiceId: '' }
  const entries = Object.entries(metadata)

  // the metadata key identifies one entry, so it answers before any preference between entries
  const exact = jsonSchemaRef ? entries.find(([schemaId]) => schemaId === jsonSchemaRef) : undefined
  if (exact) return { schemaId: exact[0], ...exact[1], data: exact[1].verifiablePresentation }

  const match = ([schemaId, entry]: [string, (typeof metadata)[string]]) => {
    if (entry.credential?.id === id) return { schemaId, ...entry, data: entry.credential }
    if (entry.verifiablePresentation?.id === id)
      return { schemaId, ...entry, data: entry.verifiablePresentation }
    return null
  }

  // several entries can carry the same presentation URL while a binding is replaced, so the entry
  // the DID Document announces wins over a detached leftover
  const matched = entries.map(match).filter(entry => entry !== null)
  return matched.find(entry => entry.attached !== false) ?? matched[0] ?? null
}

export async function saveMetadataEntry(
  agent: VsAgent,
  didRecord: DidRecord,
  credential: W3cJsonLdVerifiableCredential,
  verifiablePresentation: W3cJsonLdVerifiablePresentation,
  didDocumentServiceId: string,
  key: '_vt/vtc' | '_vt/jsc',
) {
  const schema = key === '_vt/vtc' ? credential.credentialSchema : credential.credentialSubject
  const ref = Array.isArray(schema) ? schema[0]?.id : schema?.id

  if (!ref) {
    throw new Error('No ID was found in credentialSubject')
  }

  const record = didRecord.metadata.get(key) ?? {}
  // Remove previous entry for this credential ID (if exists)
  const found = findMetadataEntry(didRecord, key, credential.id, ref)
  if (found) {
    if (didRecord.didDocument?.service) {
      didRecord.didDocument.service = didRecord.didDocument.service.filter(
        s => s.id !== found.didDocumentServiceId,
      )
    }
    delete record[found.schemaId]
  }
  record[ref] = {
    credential: credential.jsonCredential,
    verifiablePresentation,
    didDocumentServiceId,
  }
  didRecord.didDocument?.service?.push(
    new DidDocumentService({
      id: didDocumentServiceId,
      serviceEndpoint: verifiablePresentation.id!,
      type: 'LinkedVerifiablePresentation',
    }),
  )
  didRecord.metadata.set(key, record)
  await updateDidRecord(agent, didRecord)
}

export async function deleteMetadataEntry(
  agent: VsAgent,
  id: string,
  didRecord: DidRecord,
  key: '_vt/vtc' | '_vt/jsc',
) {
  const found = findMetadataEntry(didRecord, key, id, id)
  if (!found) return null

  const metadata = didRecord.metadata.get(key)
  if (!metadata) return null

  delete metadata[found.schemaId]
  didRecord.metadata.set(key, metadata)
  await updateDidRecord(agent, didRecord)
  return { schemaId: found.schemaId }
}

export async function createVtc(
  agent: VsAgent,
  publicApiBaseUrl: string,
  id: string,
  credential: W3cJsonLdVerifiableCredential,
) {
  const didRecord = await getDidRecord(agent)
  const schemaId = `schemas-${id}-vtc-vp.json`
  const didDocumentServiceId = `${agent.did}#vpr-${schemaId.replace('.json', '')}`
  const serviceEndpoint = `${publicApiBaseUrl}/vt/${schemaId}`
  const unsignedPresentation = createPresentation({
    id: serviceEndpoint,
    holder: agent.did,
    verifiableCredential: [credential],
  })

  const verifiablePresentation = await signerW3c(
    agent,
    unsignedPresentation,
    getVerificationMethodId(agent.config.logger, didRecord),
  )

  await saveMetadataEntry(
    agent,
    didRecord,
    credential,
    verifiablePresentation,
    didDocumentServiceId,
    '_vt/vtc',
  )
  return verifiablePresentation
}

export interface CreateJscOptions {
  schemaBaseId: string
  jsonSchemaRef: string
  precomputedDigestSRI?: string
}

export async function createJsc(
  agent: VsAgent,
  publicApiBaseUrl: string,
  ecsSchemas: Record<string, string>,
  options: CreateJscOptions,
) {
  const { schemaBaseId, jsonSchemaRef, precomputedDigestSRI } = options
  const didRecord = await getDidRecord(agent)
  const { id: subjectId, claims } = createJsonSubjectRef(jsonSchemaRef)

  const subjectClaims = precomputedDigestSRI
    ? { ...claims, digestSRI: precomputedDigestSRI }
    : await addDigestSRI(subjectId, claims, ecsSchemas)

  const credentialSubject = {
    id: subjectId,
    claims: subjectClaims,
  }
  const schemaPresentation = `schemas-${schemaBaseId}-vtjsc-vp.json`
  const schemaCredential = `schemas-${schemaBaseId}-jsc.json`
  const serviceEndpoint = `${publicApiBaseUrl}/vt/${schemaPresentation}`
  const didDocumentServiceId = `${agent.did}#vpr-schemas-${schemaBaseId}-vtjsc-vp`

  const unsignedCredential = createCredential({
    id: `${publicApiBaseUrl}/vt/${schemaCredential}`,
    type: ['VerifiableCredential', 'JsonSchemaCredential'],
    issuer: agent.did,
    credentialSubject,
  })
  unsignedCredential.credentialSchema = await addDigestSRI(createJsonSchema.id, createJsonSchema, ecsSchemas)

  const verificationMethodId = getVerificationMethodId(agent.config.logger, didRecord)
  const credential = await signerW3c(
    agent,
    JsonTransformer.fromJSON(unsignedCredential, W3cCredential),
    verificationMethodId,
  )

  const unsignedPresentation = createPresentation({
    id: serviceEndpoint,
    holder: agent.did,
    verifiableCredential: [credential],
  })
  const verifiablePresentation = await signerW3c(agent, unsignedPresentation, verificationMethodId)

  await saveMetadataEntry(
    agent,
    didRecord,
    credential,
    verifiablePresentation,
    didDocumentServiceId,
    '_vt/jsc',
  )
  return credential.jsonCredential
}

export async function removeTrustCredential(agent: VsAgent, schemaId: string, key: '_vt/jsc' | '_vt/vtc') {
  const didRecord = await getDidRecord(agent)
  // same lookup deleteMetadataEntry performs: a self-issued entry carries the agent DID as
  // credential id, so only its metadata key reaches it
  const record = findMetadataEntry(didRecord, key, schemaId, schemaId)
  // Currently, we only use one serviceEndpoint per ID.
  // In the future, if multiple serviceEndpoints exist for the same ID,
  // we should review the serviceEndpoint content and remove only the specific one.
  if (record?.didDocumentServiceId && didRecord.didDocument?.service) {
    didRecord.didDocument.service = didRecord.didDocument.service.filter(
      s => s.id !== record.didDocumentServiceId,
    )
  }
  return await deleteMetadataEntry(agent, schemaId, didRecord, key)
}

export async function removeStoredTrustCredential(
  agent: VsAgent,
  credentialExchangeRecordId: string,
): Promise<string | undefined> {
  const formatData = await agent.didcomm.credentials.getFormatData(credentialExchangeRecordId)
  const credentialId = (formatData.credential as { jsonld?: { id?: string } } | undefined)?.jsonld?.id
  if (!credentialId) return undefined

  await removeTrustCredential(agent, credentialId, '_vt/vtc')

  const stored = await agent.w3cCredentials.getAll()
  for (const storedRecord of stored) {
    if (storedRecord.getTags().givenId === credentialId) {
      await agent.w3cCredentials.deleteById(storedRecord.id)
    }
  }
  return credentialId
}

export async function migrateVtjscServiceIds(agent: VsAgent): Promise<void> {
  if (!agent.did) return
  const [didRecord] = await agent.dids.getCreatedDids({ did: agent.did })
  if (!didRecord) return
  const metadata = didRecord.metadata.get('_vt/jsc')
  if (!metadata) return

  let changed = false
  for (const entry of Object.values(metadata)) {
    const serviceId = entry.didDocumentServiceId
    if (!serviceId || !serviceId.endsWith('-jsc-vp') || serviceId.endsWith('-vtjsc-vp')) continue
    const nextId = serviceId.replace(/-jsc-vp$/, '-vtjsc-vp')
    const service = didRecord.didDocument?.service?.find(s => s.id === serviceId)
    if (service) service.id = nextId
    entry.didDocumentServiceId = nextId
    changed = true
  }
  if (!changed) return

  didRecord.metadata.set('_vt/jsc', metadata)
  await updateDidRecord(agent, didRecord)
  agent.config.logger.info('[VTJSC] migrated stored service ids to the -vtjsc-vp naming')
}

/**
 * Takes the linked VPs of the given `_vt/jsc` entries out of the DID Document, publishing it once.
 *
 * The entries stay: `SelfTrController` serves them, and issued credentials name that URL in
 * `credentialSchema.id`. Dropping one would 404 it and leave those credentials unverifiable.
 */
export async function detachVtjscPublications(
  agent: VsAgent,
  schemaRefs: readonly string[],
): Promise<string[]> {
  if (schemaRefs.length === 0) return []

  const didRecord = await getDidRecord(agent)
  if (!didRecord?.didDocument?.service) return []
  const metadata = didRecord.metadata.get('_vt/jsc')
  if (!metadata) return []

  const detached: string[] = []
  for (const schemaRef of schemaRefs) {
    const serviceId = metadata[schemaRef]?.didDocumentServiceId
    if (!serviceId || !didRecord.didDocument.service.some(s => s.id === serviceId)) continue

    didRecord.didDocument.service = didRecord.didDocument.service.filter(s => s.id !== serviceId)
    detached.push(schemaRef)
  }
  if (detached.length === 0) return []

  await updateDidRecord(agent, didRecord)
  return detached
}

/**
 * Puts a detached `_vt/jsc` entry back in the DID Document.
 *
 * The publication pass skips an entry whose digest still matches, so without this the agent would
 * keep serving a VTJSC it never announces again.
 */
export async function reattachVtjscPublication(agent: VsAgent, schemaRef: string): Promise<boolean> {
  const didRecord = await getDidRecord(agent)
  if (!didRecord?.didDocument) return false
  const entry = didRecord.metadata.get('_vt/jsc')?.[schemaRef]

  const serviceId = entry?.didDocumentServiceId
  const serviceEndpoint = entry?.verifiablePresentation?.id
  if (!serviceId || !serviceEndpoint) return false

  const services = didRecord.didDocument.service ?? []
  if (services.some(s => s.id === serviceId)) return false

  didRecord.didDocument.service = [
    ...services,
    new DidDocumentService({ id: serviceId, serviceEndpoint, type: 'LinkedVerifiablePresentation' }),
  ]
  await updateDidRecord(agent, didRecord)
  return true
}

export function getTrustMetadata(didRecord: DidRecord, key: '_vt/vtc' | '_vt/jsc', schemaId?: string) {
  return findMetadataEntry(didRecord, key, schemaId)
}

/**
 * Anchors a self-issued ECS credential, the same way as any other issuance: through
 * CreateOrUpdateParticipantSession, which stores the digest in the `di` module keeper-to-keeper.
 *
 * `issuerParticipantId` must name an active ISSUER participant of this agent for the schema, whose
 * vs_operator is this agent's account — the chain accepts the session from no other signer. The
 * caller resolves it, because it already lists the agent's participants to decide what to rebind.
 */
async function anchorCredentialDigest(
  agent: VsAgent,
  schemaId: number,
  credential: W3cJsonLdVerifiableCredential | undefined,
  issuerParticipantId: number,
): Promise<void> {
  const chain = agent.veranaChain
  if (!chain) return
  if (!credential) throw new Error(`[DigestAnchor] The presentation for schema ${schemaId} has no credential`)
  if (!agent.did) throw new Error('[DigestAnchor] The agent has no public DID')

  const schema = await chain.getCredentialSchema(schemaId)
  if (!schema) throw new Error(`[DigestAnchor] Credential schema ${schemaId} is not on chain`)

  const digest = computeCredentialDigestJCS(
    JsonTransformer.toJSON(credential) as unknown as W3cJsonLdVerifiableCredential,
    schema.digestAlgorithm,
  )
  // the same credential gives the same digest on each run, so an anchored digest needs no second transaction
  if (await chain.getDigest(digest)) return

  // A self-issued credential has no counterparty, so the session names only the issuer.
  const { txHash } = await chain.createOrUpdateParticipantSession({
    id: utils.uuid(),
    issuerParticipantId,
    agentParticipantId: 0,
    walletAgentParticipantId: 0,
    digest,
  })
  agent.config.logger.info(
    `[DigestAnchor] Anchored digest ${digest} for schema ${schemaId} against issuer participant ${issuerParticipantId} (tx ${txHash})`,
  )
}

// replaces the self-TR example JSC binding with the on-chain VTJSC so resolvers can link the credential to the VPR
/**
 * @param jsonSchemaCredentialId the VTJSC the Ecosystem published for this schema. Only the
 * Ecosystem publishes it, so an agent that issues against another Corporation's Ecosystem must
 * resolve it there — see resolveJsonSchemaCredentialId.
 * @param issuerParticipantId this agent's ISSUER participant for the schema, which anchors the
 * credential digest.
 */
export async function rebindEcsCredentialSchema(
  agent: VsAgent,
  publicApiBaseUrl: string,
  schemaId: string,
  schemaKey: string,
  ecsClaims: EcsClaims,
  jsonSchemaCredentialId: string,
  issuerParticipantId: number,
  onChainJsonSchema?: string,
): Promise<void> {
  if (schemaKey !== 'ecs-service' || !agent.did) return
  const vpUrl = `${publicApiBaseUrl}/vt/${schemaKey}-vtc-vp.json`
  const jscUrl = jsonSchemaCredentialId

  const didRecord = await getDidRecord(agent)
  const record = didRecord.metadata.get('_vt/vtc') ?? {}

  const stored = record[jscUrl]
  const storedIssuer =
    typeof stored?.credential?.issuer === 'string' ? stored.credential.issuer : stored?.credential?.issuer?.id
  if (stored?.credential && !stored.integrityData && storedIssuer !== agent.did) {
    agent.config.logger.debug(
      `[SelfTR] Keeping the ${schemaKey} credential issued by ${storedIssuer} instead of rebinding a self-issued one`,
    )
    return
  }

  let removedStale = false
  for (const [key, entry] of Object.entries(record)) {
    // findMetadataEntry serves the first entry matching the VP url, so stale bindings must go
    if (
      key !== jscUrl &&
      (entry as { verifiablePresentation?: { id?: string } }).verifiablePresentation?.id === vpUrl
    ) {
      delete record[key]
      removedStale = true
    }
  }
  if (removedStale) {
    didRecord.metadata.set('_vt/vtc', record)
    await updateDidRecord(agent, didRecord)
  }

  await publishSelfIssuedEcsPresentation(
    agent,
    vpUrl,
    { ...getEcsSchemas(publicApiBaseUrl), ...(onChainJsonSchema ? { [schemaKey]: onChainJsonSchema } : {}) },
    schemaKey,
    ['VerifiableCredential', 'VerifiableTrustCredential'],
    { id: jscUrl, type: 'JsonSchemaCredential' },
    ecsClaims,
    async verifiablePresentation =>
      await anchorCredentialDigest(
        agent,
        Number(schemaId),
        verifiablePresentation?.verifiableCredential?.[0] as W3cJsonLdVerifiableCredential | undefined,
        issuerParticipantId,
      ),
  )

  const freshRecord = await getDidRecord(agent)
  let recordChanged = false

  const vtc = freshRecord.metadata.get('_vt/vtc') ?? {}
  const entry = vtc[jscUrl]
  if (entry && (entry.issuerParticipantId !== issuerParticipantId || entry.schemaKey !== schemaKey)) {
    vtc[jscUrl] = { ...entry, issuerParticipantId, schemaKey }
    freshRecord.metadata.set('_vt/vtc', vtc)
    recordChanged = true
  }

  const doc = freshRecord.didDocument
  if (doc) {
    // resolvers match the [VT-CRED-W3C-LINKED-VP] fragment; #whois alone is not enough
    const expectedServiceId = `${agent.did}#${linkedVpFragment(schemaKey)}`
    const linked = doc.service?.some(s => s.id === expectedServiceId)
    if (!linked) {
      doc.service = doc.service ?? []
      doc.service.push(
        new DidDocumentService({
          id: expectedServiceId,
          serviceEndpoint: vpUrl,
          type: 'LinkedVerifiablePresentation',
        }),
      )
      recordChanged = true
    }
    if (recordChanged) await updateDidRecord(agent, freshRecord)
  }
  agent.config.logger.info(`[SelfTR] Rebound ${schemaKey} credential to VTJSC ${jscUrl}`)
}

/**
 * Withdraws the ECS credentials anchored against `issuerParticipantId`, and the #whois entry
 * when the Service credential is among them.
 */
export async function withdrawSelfIssuedEcsCredentials(
  agent: VsAgent,
  issuerParticipantId: number,
): Promise<string[]> {
  const didRecord = await getDidRecord(agent)
  const withdrawn: string[] = []
  let whoisWithdrawn = false

  for (const [jscUrl, value] of Object.entries(didRecord.metadata.get('_vt/vtc') ?? {})) {
    const entry = value as { issuerParticipantId?: number; schemaKey?: string }
    if (entry.issuerParticipantId !== issuerParticipantId) continue
    await removeTrustCredential(agent, jscUrl, '_vt/vtc')
    withdrawn.push(jscUrl)
    if (entry.schemaKey === 'ecs-service') whoisWithdrawn = true
  }
  if (whoisWithdrawn) {
    const record = await getDidRecord(agent)
    if (record.didDocument?.service) {
      record.didDocument.service = record.didDocument.service.filter(s => s.id !== `${agent.did}#whois`)
      await updateDidRecord(agent, record)
    }
  }
  return withdrawn
}
