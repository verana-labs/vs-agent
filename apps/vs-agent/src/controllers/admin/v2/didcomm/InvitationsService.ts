import type { BaseAgentModules, VsAgent } from '@verana-labs/vs-agent-sdk'

import {
  DidCommConnectionRecord,
  DidCommHandshakeProtocol,
  DidCommMessageSender,
  DidCommOutboundMessageContext,
  DidCommOutOfBandInvitation,
  DidCommOutOfBandInvitationV2,
  DidCommOutOfBandRepository,
} from '@credo-ts/didcomm'
import { Inject, Injectable } from '@nestjs/common'
import { findMetadataEntry } from '@verana-labs/vs-agent-sdk'

import { unknownConnection } from '../../../../common'
import { VsAgentService } from '../../../../services/VsAgentService'

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

    const connection = await agent.didcomm.connections.findById(options.connectionId)
    if (!connection) throw unknownConnection(options.connectionId)

    const isV2 = (connection.didcommVersion ?? 'v1') === 'v2'
    const { did, imageUrl, goal, goalCode } = options

    if (did) {
      const invitation = isV2
        ? new DidCommOutOfBandInvitationV2({ from: did, body: { goal, goalCode, accept: ['didcomm/v2'] } })
        : new DidCommOutOfBandInvitation({
            label: options.label,
            imageUrl,
            goal,
            goalCode,
            services: [did],
            handshakeProtocols: ['https://didcomm.org/didexchange/1.0'],
          })
      if (!isV2) invitation.setThread({ parentThreadId: did })

      return { id: await this.send(agent, connection, invitation) }
    }

    const outOfBandRecord = await agent.didcomm.oob.createInvitation({
      didCommVersion: isV2 ? 'v2' : 'v1',
      multiUseInvitation: false,
      goal,
      goalCode,
      ...(isV2
        ? {}
        : {
            label: options.label ?? (await this.ecsServiceName(agent)),
            imageUrl,
            handshakeProtocols: [DidCommHandshakeProtocol.DidExchange, DidCommHandshakeProtocol.Connections],
          }),
    })
    outOfBandRecord.setTag('parentConnectionId', connection.id)
    await agent.dependencyManager.resolve(DidCommOutOfBandRepository).update(agent.context, outOfBandRecord)

    const invitation = outOfBandRecord.outOfBandInvitation.v2Invitation ?? outOfBandRecord.outOfBandInvitation
    return { id: await this.send(agent, connection, invitation), outOfBandId: outOfBandRecord.id }
  }

  private async send(
    agent: VsAgent<BaseAgentModules>,
    connection: DidCommConnectionRecord,
    invitation: DidCommOutOfBandInvitation | DidCommOutOfBandInvitationV2,
  ): Promise<string> {
    if (invitation instanceof DidCommOutOfBandInvitationV2) {
      const record = await agent.didcomm.basicMessages.sendMessage(
        connection.id,
        invitation.toUrl({ domain: agent.publicApiBaseUrl }),
      )
      return record.id
    }

    await agent.context.dependencyManager
      .resolve(DidCommMessageSender)
      .sendMessage(new DidCommOutboundMessageContext(invitation, { agentContext: agent.context, connection }))
    return invitation.id
  }

  private async ecsServiceName(agent: VsAgent<BaseAgentModules>): Promise<string | undefined> {
    if (!agent.did) return undefined
    const [didRecord] = await agent.dids.getCreatedDids({ did: agent.did })
    if (!didRecord) return undefined

    const entry = findMetadataEntry(
      didRecord,
      '_vt/vtc',
      `${agent.publicApiBaseUrl}/vt/ecs-service-vtc-vp.json`,
    )
    const name = entry?.credential?.credentialSubject?.name
    return typeof name === 'string' ? name : undefined
  }
}
