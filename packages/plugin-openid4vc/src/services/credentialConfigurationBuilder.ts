import type { OpenId4VcCredentialConfiguration } from '../types'
import type { VsAgent } from '@verana-labs/vs-agent-sdk'

import {
  anonCredsSchemaFromJsonSchema,
  getDidWebHttpsBaseUrl,
  ParticipantRole,
  ParticipantState,
  resolveJsonSchemaCredentialId,
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
  const configurations: OpenId4VcCredentialConfiguration[] = []
  for (const credentialSchemaId of credentialSchemaIds) {
    try {
      configurations.push(await buildCredentialConfiguration(agent, credentialSchemaId, chainId))
    } catch (error) {
      agent.config.logger.warn(
        `[OpenID4VC] the CredentialSchema ${credentialSchemaId} carries no credential configuration: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }
  }

  return configurations
}

async function buildCredentialConfiguration(
  agent: VsAgent,
  credentialSchemaId: number,
  chainId: string,
): Promise<OpenId4VcCredentialConfiguration> {
  const schema = await agent.indexer.getCredentialSchema(credentialSchemaId)
  const ecosystem = await agent.indexer.getEcosystem(schema.ecosystem_id)
  const baseUrl = ecosystem?.did ? getDidWebHttpsBaseUrl(ecosystem.did) : undefined
  if (!baseUrl) {
    throw new Error(`the Ecosystem ${schema.ecosystem_id} maps its DID to no https base url`)
  }

  const jsonSchemaCredentialId = await resolveJsonSchemaCredentialId(
    agent,
    agent.indexer,
    credentialSchemaId,
    chainId,
  )
  const { name, attrNames } = anonCredsSchemaFromJsonSchema(schema.json_schema)

  return {
    id: jsonSchemaCredentialId,
    format: 'dc+sd-jwt',
    vct: `${baseUrl}/vt/vct/${credentialSchemaId}`,
    name,
    vtjscId: jsonSchemaCredentialId,
    credentialSchemaId,
    jsonSchema: schema.json_schema,
    claims: attrNames,
    disclosureFrame: attrNames,
  }
}
