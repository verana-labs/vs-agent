import type { StorageService, TagsBase } from '@credo-ts/core'

import { BaseRecord, EventEmitter, inject, injectable, InjectionSymbols, Repository } from '@credo-ts/core'

export type DefaultStatusListEntryTags = {
  statusListId: string
  statusListIndex: string
  issuanceSessionId?: string
  revoked: boolean
}

export interface OpenId4VcStatusListEntryRecordProps {
  createdAt?: Date
  statusListId: string
  statusListIndex: number
  issuanceSessionId?: string
  expiresAt?: string
  revokedAt?: string
}

/**
 * The binding of one index of a Token Status List to a credential, [VSA-ADM-OID-CE-OFFER]. The agent
 * writes it when it creates the offer, so a later offer cannot name the same index, and keeps it
 * after the issuance session is deleted, so [VSA-ADM-OID-CR-REVOKE] still finds the index.
 *
 * `expiresAt` is the moment at which the index stops backing a credential: the `exp` of the
 * credential once it is issued, and until then the expiry of the offer, since no credential can be
 * issued after it. `revokedAt` is the `iat` of the token that published the revocation. Both are
 * ISO 8601 UTC datetimes.
 */
export class OpenId4VcStatusListEntryRecord extends BaseRecord<DefaultStatusListEntryTags, TagsBase> {
  public static readonly type = 'OpenId4VcStatusListEntryRecord'
  public readonly type = OpenId4VcStatusListEntryRecord.type

  public statusListId!: string
  public statusListIndex!: number
  public issuanceSessionId?: string
  public expiresAt?: string
  public revokedAt?: string

  public constructor(props: OpenId4VcStatusListEntryRecordProps) {
    super()

    if (props) {
      // One record per index: a second offer on the same index fails on the duplicate id.
      this.id = OpenId4VcStatusListEntryRecord.idFor(props.statusListId, props.statusListIndex)
      this.createdAt = props.createdAt ?? new Date()
      this.statusListId = props.statusListId
      this.statusListIndex = props.statusListIndex
      this.issuanceSessionId = props.issuanceSessionId
      this.expiresAt = props.expiresAt
      this.revokedAt = props.revokedAt
    }
  }

  public static idFor(statusListId: string, statusListIndex: number): string {
    return `${statusListId}#${statusListIndex}`
  }

  /**
   * [VSA-ADM-OID-SL-DELETE]: the index backs a credential that is not revoked and not expired. An
   * entry whose offer the agent could not complete has no `expiresAt`, and stays live until it is
   * revoked, so a crash never frees an index that a credential may carry.
   */
  public isLive(now: Date): boolean {
    if (this.revokedAt) return false
    if (!this.expiresAt) return true
    return new Date(this.expiresAt).getTime() > now.getTime()
  }

  public getTags(): DefaultStatusListEntryTags & TagsBase {
    return {
      ...this._tags,
      statusListId: this.statusListId,
      statusListIndex: String(this.statusListIndex),
      issuanceSessionId: this.issuanceSessionId,
      revoked: this.revokedAt !== undefined,
    }
  }
}

@injectable()
export class OpenId4VcStatusListEntryRepository extends Repository<OpenId4VcStatusListEntryRecord> {
  public constructor(
    @inject(InjectionSymbols.StorageService) storageService: StorageService<OpenId4VcStatusListEntryRecord>,
    @inject(EventEmitter) eventEmitter: EventEmitter,
  ) {
    super(OpenId4VcStatusListEntryRecord, storageService, eventEmitter)
  }
}
