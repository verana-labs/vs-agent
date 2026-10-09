import type { OpenId4VcCredentialConfiguration } from '../types'
import type {
  CredentialSchemaDto,
  EcosystemDto,
  IndexerSchemaReader,
  VsAgent,
} from '@verana-labs/vs-agent-sdk'

import { isReservedClaimName } from '../config'

import {
  AnonCredsTrustError,
  AnonCredsTrustErrorReason,
  getDidWebHttpsBaseUrl,
  ParticipantRole,
  ParticipantState,
  readJsonSchema,
  resolveJsonSchemaCredentialId,
  typeMetadataUrl,
} from '@verana-labs/vs-agent-sdk'

// `undefined` means the agent cannot derive the set at all, and the caller keeps the last known one.
export async function buildCredentialConfigurations(
  agent: VsAgent,
): Promise<OpenId4VcCredentialConfiguration[] | undefined> {
  const did = agent.did
  const chainId = agent.veranaChain?.getChainId
  if (!did || !chainId) return undefined

  const participants = await agent.indexer.listParticipants({
    did,
    role: ParticipantRole.Issuer,
    participantState: ParticipantState.Active,
  })

  const credentialSchemaIds = new Set((participants ?? []).map(participant => Number(participant.schema_id)))
  const reader = memoizedSchemaReader(agent.indexer)
  const configurations: OpenId4VcCredentialConfiguration[] = []
  for (const credentialSchemaId of credentialSchemaIds) {
    try {
      configurations.push(await buildCredentialConfiguration(agent, reader, credentialSchemaId, chainId))
    } catch (error) {
      agent.config.logger.warn(
        `[OpenID4VC] the CredentialSchema ${credentialSchemaId} carries no credential configuration: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }
  }

  if (configurations.length === 0) {
    agent.config.logger.info(
      `[OpenID4VC] the VPR gives ${did} no credential type to issue, so the issuer advertises none`,
    )
  }

  return configurations
}

/**
 * The credential type of one VTJSC, reached from its `jsonSchemaCredentialId` through the VTJSC
 * link: the same configuration the issuers of the type derive, for a verifier that asks for it.
 * Throws the `AnonCredsTrustError` of the link when the VTJSC cannot be read or binds to no
 * `CredentialSchema` of this chain.
 */
export async function resolveCredentialType(
  agent: VsAgent,
  jsonSchemaCredentialId: string,
): Promise<OpenId4VcCredentialConfiguration> {
  const { credentialSchemaId } =
    await agent.anonCredsTrust.resolveCredentialSchemaLink(jsonSchemaCredentialId)
  // the link names a schema of this chain, so the agent runs on one
  const chainId = agent.veranaChain?.getChainId
  if (!chainId) {
    throw new AnonCredsTrustError(
      AnonCredsTrustErrorReason.Unavailable,
      `the agent runs on no chain, so it cannot read the CredentialSchema ${credentialSchemaId}`,
    )
  }
  return await buildCredentialConfiguration(agent, agent.indexer, credentialSchemaId, chainId)
}

async function buildCredentialConfiguration(
  agent: VsAgent,
  reader: IndexerSchemaReader,
  credentialSchemaId: number,
  chainId: string,
): Promise<OpenId4VcCredentialConfiguration> {
  const schema = await reader.getCredentialSchema(credentialSchemaId)
  const ecosystem = await reader.getEcosystem(schema.ecosystem_id)
  const baseUrl = ecosystem?.did ? getDidWebHttpsBaseUrl(ecosystem.did) : undefined
  if (!baseUrl) {
    throw new Error(`the Ecosystem ${schema.ecosystem_id} maps its DID to no https base url`)
  }

  const jsonSchemaCredentialId = await resolveJsonSchemaCredentialId(
    agent,
    reader,
    credentialSchemaId,
    chainId,
  )
  const { title, description, attrNames } = readJsonSchema(schema.json_schema)
  const envelope = attrNames.filter(isEnvelopeClaim)
  if (envelope.length > 0) {
    agent.config.logger.warn(
      `[OpenID4VC] the CredentialSchema ${credentialSchemaId} declares ${envelope
        .map(claim => `'${claim}'`)
        .join(', ')}, which the credential envelope carries, so its type offers no such claim`,
    )
  }
  const claims = attrNames.filter(claim => !isEnvelopeClaim(claim))

  return {
    id: jsonSchemaCredentialId,
    format: 'dc+sd-jwt',
    vct: typeMetadataUrl(baseUrl, credentialSchemaId),
    name:
      typeof title === 'string' && title.trim() ? title : `vpr:verana:${chainId}:cs:${credentialSchemaId}`,
    // The issuer metadata carries it as the display description, which wallets show on the
    // credential. The served Type Metadata keeps it as its top-level `description` only.
    ...(typeof description === 'string' && description.trim() ? { description: description.trim() } : {}),
    vtjscId: jsonSchemaCredentialId,
    credentialSchemaId,
    jsonSchema: schema.json_schema,
    claims,
    disclosureFrame: claims,
  }
}

// `id` joins the reserved names: SD-JWT VC binds the holder through `cnf`, so an `id` the caller
// supplies would assert a subject the issuer never checked.
function isEnvelopeClaim(claim: string): boolean {
  return claim === 'id' || isReservedClaimName(claim)
}

function memoizedSchemaReader(reader: IndexerSchemaReader): IndexerSchemaReader {
  const schemas = new Map<string, Promise<CredentialSchemaDto>>()
  const ecosystems = new Map<string, Promise<EcosystemDto | undefined>>()

  const once = <T>(cache: Map<string, Promise<T>>, id: string | number, read: () => Promise<T>) => {
    const pending = cache.get(String(id)) ?? read()
    cache.set(String(id), pending)
    return pending
  }

  return {
    getCredentialSchema: id => once(schemas, id, () => reader.getCredentialSchema(id)),
    getEcosystem: id => once(ecosystems, id, () => reader.getEcosystem(id)),
  }
}
