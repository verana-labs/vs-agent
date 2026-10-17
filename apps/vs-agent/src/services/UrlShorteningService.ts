import { Inject, Injectable } from '@nestjs/common'
import { INVITATION_RECORD_TAG, InvitationRepository, VsAgent } from '@verana-labs/vs-agent-sdk'

@Injectable()
export class UrlShorteningService {
  constructor(@Inject('VSAGENT') private agent: VsAgent) {}

  async createShortUrl(options: {
    invitation: Record<string, unknown>
    relatedFlowId?: string
    invitationRecord?: boolean
  }) {
    const { invitation, relatedFlowId, invitationRecord } = options

    const record = await this.agent.genericRecords.save({
      content: { invitation },
      tags: { type: 'short-url', relatedFlowId, [INVITATION_RECORD_TAG]: invitationRecord },
    })
    return record.id
  }

  async getInvitation(id: string) {
    const record = await this.agent.genericRecords.findById(id)
    if (!record) return undefined

    // [VSA-PUB-INV-1]: an invitation record stops serving its short URL once it is gone or used up
    if (record.getTag(INVITATION_RECORD_TAG) === true) {
      const invitationRecord = await this.agent.dependencyManager
        .resolve(InvitationRepository)
        .findById(this.agent.context, record.getTag('relatedFlowId') as string)
      if (!invitationRecord || (invitationRecord.state === 'accepted' && !invitationRecord.reusable))
        return undefined
    }

    return record.content.invitation as Record<string, unknown> | undefined
  }

  // TODO: Delete short url records once flows are accomplished
  async deleteShortUrlById(id: string) {
    await this.agent.genericRecords.deleteById(id)
  }

  async deleteShortUrlByRelatedFlowId(relatedFlowId: string) {
    const records = await this.agent.genericRecords.findAllByQuery({ relatedFlowId })
    await Promise.all(records.map(record => this.agent.genericRecords.delete(record)))
  }
}
