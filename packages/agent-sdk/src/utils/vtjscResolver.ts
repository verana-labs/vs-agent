import type { VsAgent } from '../agent/VsAgent'
import type { VeranaIndexerService } from '../blockchain/VeranaIndexerService'

import { findMetadataEntry } from './trustCredentialStore'

/**
 * Resolves the VTJSC that a credential of a given schema must name as its `credentialSchema`.
 *
 * The Ecosystem publishes the VTJSC, and it is the only party that does. An issuer that the
 * Ecosystem's Corporation assigned an ISSUER Participant entry usually belongs to another
 * Corporation: it holds no local copy and MUST NOT publish one. It reads the Ecosystem
 * controller's DID Document instead, and follows the Linked Verifiable Presentation that carries
 * the VTJSC of this schema.
 *
 * An agent that controls the Ecosystem itself already stores the same presentation, so it answers
 * from its own record and makes no network call.
 *
 * Returns the id of the JsonSchemaCredential, which is the value a credential carries in
 * `credentialSchema.id`.
 */
export async function resolveJsonSchemaCredentialId(
  agent: VsAgent,
  indexer: VeranaIndexerService,
  credentialSchemaId: string | number,
  chainId: string,
): Promise<string> {
  const schemaId = String(credentialSchemaId)
  const schemaRef = `vpr:verana:${chainId}:cs:${schemaId}`

  if (agent.did) {
    const [didRecord] = await agent.dids.getCreatedDids({ did: agent.did })
    const localId = didRecord
      ? findMetadataEntry(didRecord, '_vt/jsc', '', schemaRef)?.data?.verifiableCredential?.[0]?.id
      : undefined
    if (localId) return localId
  }

  const schema = await indexer.getCredentialSchema(schemaId)
  const ecosystem = await indexer.getEcosystem(schema.ecosystem_id)
  if (!ecosystem?.did) {
    throw new Error(`Ecosystem ${schema.ecosystem_id} of schema ${schemaId} has no DID`)
  }

  // createJsc registers the presentation under this exact service id.
  const serviceId = `${ecosystem.did}#vpr-schemas-${schemaId}-vtjsc-vp`
  const { didDocument } = await agent.dids.resolve(ecosystem.did)
  const endpoint = didDocument?.service?.find(service => service.id === serviceId)?.serviceEndpoint
  if (typeof endpoint !== 'string') {
    throw new Error(
      `Ecosystem ${ecosystem.did} publishes no VTJSC for schema ${schemaId} (no service ${serviceId})`,
    )
  }

  const response = await fetch(endpoint)
  if (!response.ok) {
    throw new Error(`Could not fetch the VTJSC of schema ${schemaId} from ${endpoint}`)
  }
  const presentation = (await response.json()) as { verifiableCredential?: Array<{ id?: string }> }
  const jsonSchemaCredentialId = presentation.verifiableCredential?.[0]?.id
  if (!jsonSchemaCredentialId) {
    throw new Error(`The VTJSC presentation at ${endpoint} carries no credential`)
  }
  return jsonSchemaCredentialId
}
