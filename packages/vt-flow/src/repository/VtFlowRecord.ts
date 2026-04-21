import type { RecordTags, TagsBase } from '@credo-ts/core'

import { BaseRecord, CredoError, utils } from '@credo-ts/core'

import { VtFlowRole } from '../VtFlowRole'
import { VtFlowState } from '../VtFlowState'
import { VtFlowVariant } from '../VtFlowVariant'

/** Indexed storage tags. Each field here is queryable via `VtFlowRepository`. */
export type DefaultVtFlowTags = {
  threadId: string
  sessionUuid: string
  connectionId: string
  role: VtFlowRole
  flowState: VtFlowState
  flowVariant: VtFlowVariant
  /** §5.1 only. */
  permId?: string
  /** §5.2 only. */
  schemaId?: string
  credentialExchangeRecordId?: string
  subprotocolThid?: string
}

export type CustomVtFlowTags = TagsBase

export type VtFlowTags = RecordTags<VtFlowRecord>

export interface VtFlowStorageProps {
  id?: string
  createdAt?: Date

  threadId: string
  sessionUuid: string
  connectionId: string
  role: VtFlowRole
  state: VtFlowState
  variant: VtFlowVariant

  agentPermId: string
  walletAgentPermId: string

  permId?: string
  schemaId?: string
  claims?: Record<string, unknown>

  credentialExchangeRecordId?: string
  subprotocolThid?: string

  errorMessage?: string

  tags?: CustomVtFlowTags
}

/** One record per (connection, thread). Written on both sides. */
export class VtFlowRecord extends BaseRecord<DefaultVtFlowTags, CustomVtFlowTags> {
  public static readonly type = 'VtFlowRecord'
  public readonly type = VtFlowRecord.type

  public threadId!: string
  public sessionUuid!: string
  public connectionId!: string
  public role!: VtFlowRole
  public state!: VtFlowState
  public variant!: VtFlowVariant

  public agentPermId!: string
  public walletAgentPermId!: string

  /** §5.1 only. */
  public permId?: string
  /** §5.2 only. */
  public schemaId?: string

  public claims?: Record<string, unknown>

  public credentialExchangeRecordId?: string
  public subprotocolThid?: string

  public errorMessage?: string

  public constructor(props: VtFlowStorageProps) {
    super()

    if (props) {
      this.id = props.id ?? utils.uuid()
      this.createdAt = props.createdAt ?? new Date()
      this._tags = props.tags ?? {}

      this.threadId = props.threadId
      this.sessionUuid = props.sessionUuid
      this.connectionId = props.connectionId
      this.role = props.role
      this.state = props.state
      this.variant = props.variant

      this.agentPermId = props.agentPermId
      this.walletAgentPermId = props.walletAgentPermId

      this.permId = props.permId
      this.schemaId = props.schemaId
      this.claims = props.claims

      this.credentialExchangeRecordId = props.credentialExchangeRecordId
      this.subprotocolThid = props.subprotocolThid

      this.errorMessage = props.errorMessage
    }
  }

  public getTags(): DefaultVtFlowTags & CustomVtFlowTags {
    return {
      ...this._tags,
      threadId: this.threadId,
      sessionUuid: this.sessionUuid,
      connectionId: this.connectionId,
      role: this.role,
      flowState: this.state,
      flowVariant: this.variant,
      permId: this.permId,
      schemaId: this.schemaId,
      credentialExchangeRecordId: this.credentialExchangeRecordId,
      subprotocolThid: this.subprotocolThid,
    }
  }

  public assertRole(expectedRole: VtFlowRole): void {
    if (this.role !== expectedRole) {
      throw new CredoError(`VtFlow record is in role '${this.role}', expected '${expectedRole}'.`)
    }
  }

  public assertState(expectedStates: VtFlowState | VtFlowState[]): void {
    const allowed = Array.isArray(expectedStates) ? expectedStates : [expectedStates]

    if (!allowed.includes(this.state)) {
      throw new CredoError(`VtFlow record is in state '${this.state}'. Valid states: ${allowed.join(', ')}.`)
    }
  }

  public assertVariant(expectedVariant: VtFlowVariant): void {
    if (this.variant !== expectedVariant) {
      throw new CredoError(`VtFlow record is variant '${this.variant}', expected '${expectedVariant}'.`)
    }
  }
}
