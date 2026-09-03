import type { AnonCredsCredentialMetadata } from '@credo-ts/anoncreds'
import type {
  DidCommConnectionRecord,
  DidCommCredentialExchangeRecord,
  DidCommProofExchangeRecord,
} from '@credo-ts/didcomm'
import type { BaseAgentModules, VsAgent } from '@verana-labs/vs-agent-sdk'

import { AnonCredsCredentialMetadataKey } from '@credo-ts/anoncreds'
import { Claim, RequestedCredential } from '@verana-labs/vs-agent-model'

import { ConnectionRecordDto, CredentialExchangeRecordDto, PresentationRecordDto } from './dto'

export const REQUESTED_CREDENTIALS_METADATA = '_2060/requestedCredentials'

export function toConnectionDto(record: DidCommConnectionRecord): ConnectionRecordDto {
  return {
    id: record.id,
    state: record.state,
    role: record.role,
    did: record.did,
    theirDid: record.theirDid,
    theirLabel: record.theirLabel,
    alias: record.alias,
    threadId: record.threadId,
    imageUrl: record.imageUrl,
    outOfBandId: record.outOfBandId,
    invitationDid: record.invitationDid,
    didcommVersion: record.didcommVersion,
    mediatorId: record.mediatorId,
    previousDids: record.previousDids,
    previousTheirDids: record.previousTheirDids,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt ?? record.createdAt,
  }
}

export async function toPresentationDto(
  agent: VsAgent<BaseAgentModules>,
  record: DidCommProofExchangeRecord,
): Promise<PresentationRecordDto> {
  const formatData = await agent.didcomm.proofs.getFormatData(record.id)

  const proof = formatData.presentation?.anoncreds ?? formatData.presentation?.indy
  const claims: Claim[] = []

  for (const [name, value] of Object.entries(proof?.requested_proof.revealed_attrs ?? {})) {
    claims.push(new Claim({ name, value: value.raw }))
  }

  for (const group of Object.values(proof?.requested_proof.revealed_attr_groups ?? {})) {
    for (const [name, value] of Object.entries(group?.values ?? {})) {
      claims.push(new Claim({ name, value: value.raw }))
    }
  }

  return {
    proofExchangeId: record.id,
    state: record.state,
    requestedCredentials:
      (record.metadata.get(REQUESTED_CREDENTIALS_METADATA) as RequestedCredential[] | null) ?? [],
    claims,
    verified: record.isVerified ?? false,
    threadId: record.threadId,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt ?? record.createdAt,
  }
}

export async function toCredentialExchangeDto(
  agent: VsAgent<BaseAgentModules>,
  record: DidCommCredentialExchangeRecord,
  logger: { debug: (message: string) => void },
): Promise<CredentialExchangeRecordDto> {
  const anonCredsMetadata = record.metadata.get(AnonCredsCredentialMetadataKey) as
    | AnonCredsCredentialMetadata
    | undefined

  let claims: Claim[] = []
  try {
    const formatData = await agent.didcomm.credentials.getFormatData(record.id)
    if (formatData.offerAttributes?.length) {
      claims = formatData.offerAttributes.map(
        attribute =>
          new Claim({ name: attribute.name, value: attribute.value, mimeType: attribute.mimeType }),
      )
    }
  } catch (error) {
    logger.debug(`The agent cannot read the offer of ${record.id}: ${error}`)
  }

  return {
    credentialExchangeId: record.id,
    state: record.state,
    role: record.role,
    threadId: record.threadId,
    connectionId: record.connectionId,
    credentialDefinitionId: anonCredsMetadata?.credentialDefinitionId,
    schemaId: anonCredsMetadata?.schemaId,
    claims,
    errorMessage: record.errorMessage,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt ?? record.createdAt,
  }
}
