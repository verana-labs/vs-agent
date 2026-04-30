import {
  DidDocumentService,
  DidRecord,
  DidRepository,
  JsonTransformer,
  W3cCredential,
  W3cJsonLdVerifiableCredential,
  W3cJsonLdVerifiablePresentation,
} from '@credo-ts/core'

import { VsAgent } from '../agent/VsAgent'

import {
  addDigestSRI,
  createCredential,
  createJsonSchema,
  createJsonSubjectRef,
  createPresentation,
  getVerificationMethodId,
  mapToSelfTr,
  presentations,
  signerW3c,
} from './setupSelfTr'

export interface TrustMetadataEntry {
  credential: any
  verifiablePresentation: any
  didDocumentServiceId: string
  attached?: boolean
}

async function getDidRecord(agent: VsAgent) {
  const [didRecord] = await agent.dids.getCreatedDids({ did: agent.did })
  return didRecord
}

async function updateDidRecord(agent: VsAgent, didRecord: DidRecord) {
  const repo = agent.context.dependencyManager.resolve(DidRepository)
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
  if (!id) return { schemaId: '', data: metadata, didDocumentServiceId: '' }
  for (const [schemaId, entry] of Object.entries(metadata)) {
    if (schemaId === jsonSchemaRef) {
      return { schemaId, ...entry, data: entry.verifiablePresentation }
    }
    const credId = entry.credential?.id
    const presId = entry.verifiablePresentation?.id

    if (credId === id) {
      return { schemaId, ...entry, data: entry.credential }
    }

    if (presId === id) {
      return { schemaId, ...entry, data: entry.verifiablePresentation }
    }
  }
  return null
}

export async function saveMetadataEntry(
  agent: VsAgent,
  didRecord: DidRecord,
  credential: W3cJsonLdVerifiableCredential,
  verifiablePresentation: W3cJsonLdVerifiablePresentation,
  didDocumentServiceId: string,
  key: '_vt/vtc' | '_vt/jsc',
  publicApiBaseUrl: string,
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

  // Update #whois with new endpoint
  const service = didRecord.didDocument?.service?.find(s => s.id === `${agent.did}#whois`)
  if (service && verifiablePresentation.id?.includes('service'))
    service.serviceEndpoint = verifiablePresentation.id!

  // When a new VTC has been added, remove the self VTCs
  updateVtcEntries(didRecord, false, publicApiBaseUrl)
  await updateDidRecord(agent, didRecord)
}

export async function deleteMetadataEntry(
  agent: VsAgent,
  id: string,
  didRecord: DidRecord,
  key: '_vt/vtc' | '_vt/jsc',
  publicApiBaseUrl: string,
) {
  const found = findMetadataEntry(didRecord, key, id)
  if (!found) return null

  const metadata = didRecord.metadata.get(key)
  if (!metadata) return null

  delete metadata[found.schemaId]
  didRecord.metadata.set(key, metadata)

  // If the last entry is removed, restore defaults
  restoreDefaultVtcEntries(didRecord, publicApiBaseUrl)
  await updateDidRecord(agent, didRecord)
  return { schemaId: found.schemaId }
}

function restoreDefaultVtcEntries(didRecord: DidRecord, publicApiBaseUrl: string) {
  const vtc = didRecord.metadata.get('_vt/vtc') ?? {}
  const jsc = didRecord.metadata.get('_vt/jsc') ?? {}
  // By default we have 2 Self-trusted VTCs
  if (Object.keys(vtc).length < 3 && Object.keys(jsc).length < 3) {
    updateVtcEntries(didRecord, true, publicApiBaseUrl)
  }
}

function updateVtcEntries(didRecord: DidRecord, attach: boolean, publicApiBaseUrl: string) {
  const record = didRecord.metadata.get('_vt/vtc') ?? {}

  presentations.forEach(p => {
    const schemaId = mapToSelfTr(p.schemaUrl, publicApiBaseUrl)
    const current = record[schemaId]
    if (current?.attached === attach) return
    record[schemaId] = {
      ...current,
      attached: attach,
    }

    const serviceId = current?.didDocumentServiceId
    const serviceEndpoint = current?.verifiablePresentation?.id
    if (!didRecord.didDocument?.service) return
    if (attach) {
      const alreadyExists = didRecord.didDocument.service.some(s => s.id === serviceId)
      if (!alreadyExists && serviceId && serviceEndpoint) {
        didRecord.didDocument.service.push(
          new DidDocumentService({
            id: serviceId,
            serviceEndpoint,
            type: 'LinkedVerifiablePresentation',
          }),
        )
      }

      // Return to self-trusted VTC in #whois endpoint
      const service = didRecord.didDocument?.service?.find(s => s.id === `${didRecord.did}#whois`)
      if (service && serviceEndpoint?.includes('service')) service.serviceEndpoint = serviceEndpoint
    } else {
      didRecord.didDocument.service = didRecord.didDocument.service.filter(s => s.id !== serviceId)
    }
  })
  didRecord.metadata.set('_vt/vtc', record)
}

export async function createVtc(
  agent: VsAgent,
  publicApiBaseUrl: string,
  id: string,
  credential: W3cJsonLdVerifiableCredential,
) {
  const didRecord = await getDidRecord(agent)
  const schemaId = `schemas-${id}-c-vp.json`
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
    publicApiBaseUrl,
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
  const schemaPresentation = `schemas-${schemaBaseId}-jsc-vp.json`
  const schemaCredential = `schemas-${schemaBaseId}-jsc.json`
  const serviceEndpoint = `${publicApiBaseUrl}/vt/${schemaPresentation}`
  const didDocumentServiceId = `${agent.did}#vpr-${schemaPresentation.replace('.json', '')}`

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
    publicApiBaseUrl,
  )
  return credential.jsonCredential
}

export async function removeTrustCredential(
  agent: VsAgent,
  publicApiBaseUrl: string,
  schemaId: string,
  key: '_vt/jsc' | '_vt/vtc',
) {
  const didRecord = await getDidRecord(agent)
  const record = findMetadataEntry(didRecord, key, schemaId)
  // Currently, we only use one serviceEndpoint per ID.
  // In the future, if multiple serviceEndpoints exist for the same ID,
  // we should review the serviceEndpoint content and remove only the specific one.
  if (record?.didDocumentServiceId && didRecord.didDocument?.service) {
    didRecord.didDocument.service = didRecord.didDocument.service.filter(
      s => s.id !== record.didDocumentServiceId,
    )
  }
  return await deleteMetadataEntry(agent, schemaId, didRecord, key, publicApiBaseUrl)
}

export function getTrustMetadata(didRecord: DidRecord, key: '_vt/vtc' | '_vt/jsc', schemaId?: string) {
  return findMetadataEntry(didRecord, key, schemaId)
}

export async function findVtcEntriesBySchemaRef(
  agent: VsAgent,
  schemaRefSubstring: string,
): Promise<Array<{ schemaId: string; entry: TrustMetadataEntry }>> {
  const didRecord = await getDidRecord(agent)
  const metadata = (didRecord.metadata.get('_vt/vtc') ?? {}) as Record<string, TrustMetadataEntry>
  const matches: Array<{ schemaId: string; entry: TrustMetadataEntry }> = []
  for (const [schemaId, entry] of Object.entries(metadata)) {
    const credSchemaId = entry.credential?.credentialSchema?.id
    if (credSchemaId && credSchemaId.includes(schemaRefSubstring)) {
      matches.push({ schemaId, entry })
    } else if (schemaId.includes(schemaRefSubstring)) {
      matches.push({ schemaId, entry })
    }
  }
  return matches
}
