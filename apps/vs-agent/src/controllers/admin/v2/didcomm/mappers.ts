import type { AnonCredsCredentialMetadata } from '@credo-ts/anoncreds'
import type {
  DidCommBasicMessageRecord,
  DidCommConnectionRecord,
  DidCommCredentialExchangeRecord,
  DidCommProofExchangeRecord,
} from '@credo-ts/didcomm'
import type {
  BaseAgentModules,
  InvitationRecord,
  PresentedCredential,
  VsAgent,
} from '@verana-labs/vs-agent-sdk'

import { AnonCredsCredentialMetadataKey } from '@credo-ts/anoncreds'
import { DidCommProofRole } from '@credo-ts/didcomm'
import { Claim, RequestedCredential } from '@verana-labs/vs-agent-model'
import {
  awaitsTrustDecision,
  INVITATION_ID_TAG,
  PARENT_CONNECTION_TAG,
  PRESENTED_CREDENTIALS_METADATA,
  REJECTED_CREDENTIALS_METADATA,
} from '@verana-labs/vs-agent-sdk'

import {
  BasicMessageRecordDto,
  ConnectionRecordDto,
  CredentialExchangeRecordDto,
  InvitationRecordDto,
  PresentationRecordDto,
  PresentedCredentialDto,
  RejectedCredentialDto,
} from './dto'

export const REQUESTED_CREDENTIALS_METADATA = '_2060/requestedCredentials'

export function toBasicMessageDto(record: DidCommBasicMessageRecord): BasicMessageRecordDto {
  return {
    id: record.id,
    connectionId: record.connectionId,
    role: record.role,
    content: record.content,
    sentTime: record.sentTime,
    createdAt: record.createdAt,
  }
}

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
    invitationId: (record.getTag(INVITATION_ID_TAG) as string | undefined) ?? null,
    parentConnectionId: (record.getTag(PARENT_CONNECTION_TAG) as string | undefined) ?? null,
    invitationDid: record.invitationDid,
    didcommVersion: record.didcommVersion,
    mediatorId: record.mediatorId,
    previousDids: record.previousDids,
    previousTheirDids: record.previousTheirDids,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt ?? record.createdAt,
  }
}

export function toInvitationDto(record: InvitationRecord): InvitationRecordDto {
  return {
    id: record.id,
    state: record.state,
    didcommVersion: record.didcommVersion,
    reusable: record.reusable,
    invitation: record.invitation,
    shortUrl: record.shortUrl,
    parentConnectionId: record.parentConnectionId,
    acceptances: record.acceptances,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt ?? record.createdAt,
  }
}

function presentedCredentialsOf(record: DidCommProofExchangeRecord): PresentedCredential[] | null {
  if (record.role !== DidCommProofRole.Verifier) return null
  return record.metadata.get(PRESENTED_CREDENTIALS_METADATA) as PresentedCredential[] | null
}

export async function toPresentationDto(
  agent: VsAgent<BaseAgentModules>,
  record: DidCommProofExchangeRecord,
): Promise<PresentationRecordDto> {
  const formatData = await agent.didcomm.proofs.getFormatData(record.id)

  const proof = formatData.presentation?.anoncreds
  const claims: Claim[] = []

  for (const [name, value] of Object.entries(proof?.requested_proof.revealed_attrs ?? {})) {
    claims.push(new Claim({ name, value: value.raw }))
  }

  for (const group of Object.values(proof?.requested_proof.revealed_attr_groups ?? {})) {
    for (const [name, value] of Object.entries(group?.values ?? {})) {
      claims.push(new Claim({ name, value: value.raw }))
    }
  }

  // The trust decision recorded the identity of each credential. The proof holds the claims, and
  // the request holds the attribute names. Thus a read resolves nothing.
  const requestedAttributes = formatData.request?.anoncreds?.requested_attributes ?? {}
  const credentials: PresentedCredentialDto[] = (presentedCredentialsOf(record) ?? []).map(
    ({ group, ...identity }) => {
      const requested = requestedAttributes[group]
      const names = requested?.names ?? (requested?.name ? [requested.name] : [])

      const revealed = new Map<string, string>()
      for (const [name, value] of Object.entries(
        proof?.requested_proof.revealed_attr_groups?.[group]?.values ?? {},
      )) {
        revealed.set(name, value.raw)
      }
      const single = proof?.requested_proof.revealed_attrs?.[group]
      if (single && requested?.name) revealed.set(requested.name, single.raw)

      return {
        ...identity,
        claims: [...revealed].map(([name, value]) => new Claim({ name, value })),
        unrevealed: names.filter(name => !revealed.has(name)),
      }
    },
  )

  return {
    proofExchangeId: record.id,
    state: record.state,
    role: record.role,
    connectionId: record.connectionId,
    requestedCredentials:
      (record.metadata.get(REQUESTED_CREDENTIALS_METADATA) as RequestedCredential[] | null) ?? [],
    claims,
    credentials,
    rejectedCredentials:
      record.role === DidCommProofRole.Verifier
        ? ((record.metadata.get(REJECTED_CREDENTIALS_METADATA) as RejectedCredentialDto[] | null) ?? [])
        : [],
    verified: (record.isVerified ?? false) && !awaitsTrustDecision(record),
    threadId: record.threadId,
    errorMessage: record.errorMessage,
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
