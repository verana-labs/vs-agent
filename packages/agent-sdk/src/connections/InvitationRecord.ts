import type { StorageService, TagsBase } from '@credo-ts/core'
import type { DidCommVersion } from '@credo-ts/didcomm'

import { BaseRecord, EventEmitter, inject, injectable, InjectionSymbols, Repository } from '@credo-ts/core'

/** Tag that names the invitation record which produced a connection. */
export const INVITATION_ID_TAG = 'invitationId'

/** Marks the Credo out-of-band record that an invitation record wraps. */
export const INVITATION_RECORD_TAG = 'invitationRecord'

export type InvitationState = 'created' | 'accepted'

export interface InvitationAcceptance {
  connectionId: string
  reused: boolean
  acceptedAt: string
}

export type DefaultInvitationTags = {
  state: InvitationState
  didcommVersion: DidCommVersion
  reusable: boolean
  parentConnectionId?: string
  connectionIds: string[]
}

export interface InvitationRecordProps {
  id: string
  createdAt?: Date
  state: InvitationState
  didcommVersion: DidCommVersion
  reusable: boolean
  invitation: Record<string, unknown>
  shortUrl: string | null
  parentConnectionId: string | null
  acceptances?: InvitationAcceptance[]
}

/**
 * Invitation record of [VSA-ADM-DC-INV]. Its id is the id of the Credo out-of-band record that it wraps.
 */
export class InvitationRecord extends BaseRecord<DefaultInvitationTags, TagsBase> {
  public static readonly type = 'InvitationRecord'
  public readonly type = InvitationRecord.type

  public state!: InvitationState
  public didcommVersion!: DidCommVersion
  public reusable!: boolean
  public invitation!: Record<string, unknown>
  public shortUrl!: string | null
  public parentConnectionId!: string | null
  public acceptances!: InvitationAcceptance[]

  public constructor(props: InvitationRecordProps) {
    super()

    if (props) {
      this.id = props.id
      this.createdAt = props.createdAt ?? new Date()
      this.state = props.state
      this.didcommVersion = props.didcommVersion
      this.reusable = props.reusable
      this.invitation = props.invitation
      this.shortUrl = props.shortUrl
      this.parentConnectionId = props.parentConnectionId
      this.acceptances = props.acceptances ?? []
    }
  }

  public getTags(): DefaultInvitationTags & TagsBase {
    return {
      ...this._tags,
      state: this.state,
      didcommVersion: this.didcommVersion,
      reusable: this.reusable,
      parentConnectionId: this.parentConnectionId ?? undefined,
      connectionIds: this.acceptances.map(acceptance => acceptance.connectionId),
    }
  }
}

@injectable()
export class InvitationRepository extends Repository<InvitationRecord> {
  public constructor(
    @inject(InjectionSymbols.StorageService) storageService: StorageService<InvitationRecord>,
    @inject(EventEmitter) eventEmitter: EventEmitter,
  ) {
    super(InvitationRecord, storageService, eventEmitter)
  }
}
