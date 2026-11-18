import type { StorageService, TagsBase } from '@credo-ts/core'

import { BaseRecord, EventEmitter, inject, injectable, InjectionSymbols, Repository } from '@credo-ts/core'

export interface OpenId4VcStatusListRecordProps {
  id: string
  createdAt?: Date
  size: number
  token: string
  tokenIssuedAt: string
  tokenExpiresAt: string
}

/**
 * One Token Status List of the issuer capability, [VSA-ADM-OID-SL]. The record keeps the signed
 * token that the agent serves at the public URL of the list ([VSA-PUB-OID-1]); `tokenIssuedAt` and
 * `tokenExpiresAt` are the `iat` and the `exp` of that token, as ISO 8601 UTC datetimes.
 */
export class OpenId4VcStatusListRecord extends BaseRecord<TagsBase, TagsBase> {
  public static readonly type = 'OpenId4VcStatusListRecord'
  public readonly type = OpenId4VcStatusListRecord.type

  public size!: number
  public token!: string
  public tokenIssuedAt!: string
  public tokenExpiresAt!: string

  public constructor(props: OpenId4VcStatusListRecordProps) {
    super()

    if (props) {
      this.id = props.id
      this.createdAt = props.createdAt ?? new Date()
      this.size = props.size
      this.token = props.token
      this.tokenIssuedAt = props.tokenIssuedAt
      this.tokenExpiresAt = props.tokenExpiresAt
    }
  }

  public getTags(): TagsBase {
    return { ...this._tags }
  }
}

@injectable()
export class OpenId4VcStatusListRepository extends Repository<OpenId4VcStatusListRecord> {
  public constructor(
    @inject(InjectionSymbols.StorageService) storageService: StorageService<OpenId4VcStatusListRecord>,
    @inject(EventEmitter) eventEmitter: EventEmitter,
  ) {
    super(OpenId4VcStatusListRecord, storageService, eventEmitter)
  }
}
