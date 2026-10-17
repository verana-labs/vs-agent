import type { CreateInvitationOptions, CreateInvitationResult } from '@verana-labs/vs-agent-model'
import type { BaseAgentModules, InvitationRecordProps, VsAgent } from '@verana-labs/vs-agent-sdk'
import type { JsonValue } from '@credo-ts/core'

import { DidCommShareMediaMessage, SharedMediaItem } from '@2060.io/credo-ts-didcomm-media-sharing'
import {
  DidCommConnectionRecord,
  DidCommHandshakeProtocol,
  DidCommOutOfBandInvitation,
  DidCommOutOfBandInvitationV2,
  type DidCommOutOfBandRecord,
  DidCommOutOfBandRepository,
} from '@credo-ts/didcomm'
import { HttpStatus, Inject, Injectable } from '@nestjs/common'
import {
  connectionOf,
  createInvitation,
  ecsServiceClaims,
  INVITATION_RECORD_TAG,
  InvitationRecord,
  InvitationRepository,
  PARENT_CONNECTION_TAG,
  sendMessage,
} from '@verana-labs/vs-agent-sdk'

import { AdminApiError, AdminApiErrorCode, createdAtKey, mapPage, Page, paginate } from '../../../../common'
import { UrlShorteningService } from '../../../../services/UrlShorteningService'
import { VsAgentService } from '../../../../services/VsAgentService'

import { InvitationRecordDto, ListInvitationsQueryDto } from './dto'
import { toInvitationDto } from './mappers'

const invitationMediaType = 'application/didcomm-plain+json'

@Injectable()
export class InvitationsService {
  public constructor(
    @Inject(VsAgentService) private readonly vsAgentService: VsAgentService,
    @Inject(UrlShorteningService) private readonly urlShortenerService: UrlShorteningService,
    @Inject('PUBLIC_API_BASE_URL') private readonly publicApiBaseUrl: string,
  ) {}

  public async createInvitation(options: CreateInvitationOptions): Promise<CreateInvitationResult> {
    const { connectionId, did, imageUrl, goal, goalCode } = options
    if (options.reusable && connectionId) throw invalidInput('reusable requires that connectionId is absent')
    if (did && !connectionId) throw invalidInput('did requires connectionId')

    const agent = await this.vsAgentService.getAgent()

    if (!connectionId) return this.createStandaloneInvitation(agent, options)

    const connection = await connectionOf(agent, connectionId)

    const isV2 = (connection.didcommVersion ?? 'v1') === 'v2'
    const label = did ? options.label : (options.label ?? (await ecsServiceClaims(agent))?.name)

    if (did) {
      if (isV2) {
        const invitation = new DidCommOutOfBandInvitationV2({
          from: did,
          body: { goal, goalCode, accept: ['didcomm/v2'] },
        })
        return { messageId: await this.shareInvitation(agent, connection, invitation, label, imageUrl) }
      }

      const invitation = new DidCommOutOfBandInvitation({
        label,
        imageUrl,
        goal,
        goalCode,
        services: [did],
        handshakeProtocols: ['https://didcomm.org/didexchange/1.0'],
      })
      invitation.setThread({ parentThreadId: did })

      return { messageId: await sendMessage(agent, connection, invitation) }
    }

    const outOfBandRecord = await agent.didcomm.oob.createInvitation({
      didCommVersion: isV2 ? 'v2' : 'v1',
      multiUseInvitation: false,
      goal,
      goalCode,
      ...(isV2 ? {} : { label, imageUrl, handshakeProtocols: [DidCommHandshakeProtocol.DidExchange] }),
    })
    outOfBandRecord.setTag(PARENT_CONNECTION_TAG, connection.id)

    const { outOfBandInvitation } = outOfBandRecord
    const { v2Invitation } = outOfBandInvitation
    const record = await this.saveRecord(agent, outOfBandRecord, {
      didcommVersion: v2Invitation ? 'v2' : 'v1',
      reusable: false,
      invitation: v2Invitation?.toJSON() ?? outOfBandInvitation.toJSON(),
      shortUrl: null,
      parentConnectionId: connection.id,
    })

    const messageId = v2Invitation
      ? await this.shareInvitation(agent, connection, v2Invitation, label, imageUrl)
      : await sendMessage(agent, connection, outOfBandInvitation)

    return { id: record.id, messageId }
  }

  public async listInvitations(query: ListInvitationsQueryDto): Promise<Page<InvitationRecordDto>> {
    const agent = await this.vsAgentService.getAgent()

    const records = await agent.dependencyManager.resolve(InvitationRepository).findByQuery(agent.context, {
      state: query.state,
      parentConnectionId: query.parentConnectionId,
      connectionIds: query.connectionId ? [query.connectionId] : undefined,
      reusable: query.reusable === undefined ? undefined : query.reusable === 'true',
      didcommVersion: query.didcommVersion,
    })

    const filters = {
      state: query.state,
      parentConnectionId: query.parentConnectionId,
      connectionId: query.connectionId,
      reusable: query.reusable,
      didcommVersion: query.didcommVersion,
    }
    return mapPage(
      paginate(records, query, { method: 'listInvitations', filters }, createdAtKey),
      toInvitationDto,
    )
  }

  public async getInvitation(invitationId: string): Promise<InvitationRecordDto> {
    const agent = await this.vsAgentService.getAgent()

    const record = await agent.dependencyManager
      .resolve(InvitationRepository)
      .findById(agent.context, invitationId)
    if (!record) throw unknownInvitation(invitationId)

    return toInvitationDto(record)
  }

  public async deleteInvitation(invitationId: string): Promise<void> {
    const agent = await this.vsAgentService.getAgent()
    const repository = agent.dependencyManager.resolve(InvitationRepository)

    const record = await repository.findById(agent.context, invitationId)
    if (!record) throw unknownInvitation(invitationId)

    // Credo stops accepting the invitation first, and the record goes last, so a failed step can be retried
    if (await agent.didcomm.oob.findById(record.id)) await agent.didcomm.oob.deleteById(record.id)
    await this.urlShortenerService.deleteShortUrlByRelatedFlowId(record.id)
    await repository.delete(agent.context, record)
  }

  private async createStandaloneInvitation(
    agent: VsAgent<BaseAgentModules>,
    options: CreateInvitationOptions,
  ): Promise<CreateInvitationResult> {
    const reusable = options.reusable ?? false
    const { invitation, outOfBandInvitation, outOfBandRecord } = await createInvitation({
      agent,
      useLegacyDid: options.useLegacyDid,
      didCommVersion: options.didcommVersion,
      unbranded: true,
      multiUseInvitation: reusable,
      goal: options.goal,
      goalCode: options.goalCode,
    })

    const shortUrlId = await this.urlShortenerService.createShortUrl({
      invitation,
      relatedFlowId: outOfBandRecord.id,
      invitationRecord: true,
    })
    const shortUrl = `${this.publicApiBaseUrl}/s?id=${shortUrlId}`

    const record = await this.saveRecord(agent, outOfBandRecord, {
      didcommVersion: outOfBandInvitation.v2Invitation ? 'v2' : 'v1',
      reusable,
      invitation,
      shortUrl,
      parentConnectionId: null,
    })

    return { id: record.id, invitation, shortUrl }
  }

  private async saveRecord(
    agent: VsAgent<BaseAgentModules>,
    outOfBandRecord: DidCommOutOfBandRecord,
    props: Omit<InvitationRecordProps, 'id' | 'state'>,
  ): Promise<InvitationRecord> {
    outOfBandRecord.setTag(INVITATION_RECORD_TAG, true)
    await agent.dependencyManager.resolve(DidCommOutOfBandRepository).update(agent.context, outOfBandRecord)

    const record = new InvitationRecord({ ...props, id: outOfBandRecord.id, state: 'created' })
    await agent.dependencyManager.resolve(InvitationRepository).save(agent.context, record)
    return record
  }

  private async shareInvitation(
    agent: VsAgent<BaseAgentModules>,
    connection: DidCommConnectionRecord,
    invitation: DidCommOutOfBandInvitationV2,
    label?: string,
    imageUrl?: string,
  ): Promise<string> {
    const metadata = { ...(label && { title: label }), ...(imageUrl && { icon: imageUrl }) }
    const item = new SharedMediaItem({
      json: invitation.toV2Plaintext() as unknown as JsonValue,
      mimeType: invitationMediaType,
      ...(Object.keys(metadata).length > 0 && { metadata }),
    })

    return sendMessage(agent, connection, new DidCommShareMediaMessage({ description: label, items: [item] }))
  }
}

function invalidInput(message: string): AdminApiError {
  return new AdminApiError(AdminApiErrorCode.InvalidInput, HttpStatus.BAD_REQUEST, message)
}

function unknownInvitation(invitationId: string): AdminApiError {
  return new AdminApiError(
    AdminApiErrorCode.UnknownId,
    HttpStatus.NOT_FOUND,
    `no invitation with id "${invitationId}"`,
  )
}
