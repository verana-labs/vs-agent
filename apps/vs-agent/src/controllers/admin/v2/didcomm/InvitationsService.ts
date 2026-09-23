import type { BaseAgentModules, VsAgent } from '@verana-labs/vs-agent-sdk'
import type { JsonValue } from '@credo-ts/core'

import { DidCommShareMediaMessage, SharedMediaItem } from '@2060.io/credo-ts-didcomm-media-sharing'
import {
  DidCommConnectionRecord,
  DidCommHandshakeProtocol,
  DidCommOutOfBandInvitation,
  DidCommOutOfBandInvitationV2,
  DidCommOutOfBandRepository,
} from '@credo-ts/didcomm'
import { Inject, Injectable } from '@nestjs/common'
import { connectionOf, ecsServiceClaims, sendMessage } from '@verana-labs/vs-agent-sdk'

import { VsAgentService } from '../../../../services/VsAgentService'

const invitationMediaType = 'application/didcomm-plain+json'

export interface SendInvitationOptions {
  connectionId: string
  did?: string
  label?: string
  imageUrl?: string
  goal?: string
  goalCode?: string
}

export interface SendInvitationResult {
  id: string
  outOfBandId?: string
}

@Injectable()
export class InvitationsService {
  public constructor(@Inject(VsAgentService) private readonly vsAgentService: VsAgentService) {}

  public async sendInvitation(options: SendInvitationOptions): Promise<SendInvitationResult> {
    const agent = await this.vsAgentService.getAgent()

    const connection = await connectionOf(agent, options.connectionId)

    const isV2 = (connection.didcommVersion ?? 'v1') === 'v2'
    const { did, imageUrl, goal, goalCode } = options
    const label = did ? options.label : (options.label ?? (await ecsServiceClaims(agent))?.name)

    if (did) {
      if (isV2) {
        const invitation = new DidCommOutOfBandInvitationV2({
          from: did,
          body: { goal, goalCode, accept: ['didcomm/v2'] },
        })
        return { id: await this.shareInvitation(agent, connection, invitation, label, imageUrl) }
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

      return { id: await sendMessage(agent, connection, invitation) }
    }

    const outOfBandRecord = await agent.didcomm.oob.createInvitation({
      didCommVersion: isV2 ? 'v2' : 'v1',
      multiUseInvitation: false,
      goal,
      goalCode,
      ...(isV2 ? {} : { label, imageUrl, handshakeProtocols: [DidCommHandshakeProtocol.DidExchange] }),
    })
    outOfBandRecord.setTag('parentConnectionId', connection.id)
    await agent.dependencyManager.resolve(DidCommOutOfBandRepository).update(agent.context, outOfBandRecord)

    const { v2Invitation } = outOfBandRecord.outOfBandInvitation
    const id = v2Invitation
      ? await this.shareInvitation(agent, connection, v2Invitation, label, imageUrl)
      : await sendMessage(agent, connection, outOfBandRecord.outOfBandInvitation)

    return { id, outOfBandId: outOfBandRecord.id }
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
