import { Expose } from 'class-transformer'
import { IsOptional, IsString } from 'class-validator'

import { Event } from './Event'
import { EventType } from './EventType'

export interface VtFlowStateUpdatedOptions {
  vtFlowRecordId: string
  state: string
  previousState?: string | null
  timestamp?: Date
}

export class VtFlowStateUpdated extends Event {
  public constructor(options: VtFlowStateUpdatedOptions) {
    super()
    if (options) {
      this.vtFlowRecordId = options.vtFlowRecordId
      this.state = options.state
      this.previousState = options.previousState ?? null
      this.timestamp = options.timestamp ?? new Date()
    }
  }

  public readonly type = VtFlowStateUpdated.type
  public static readonly type = EventType.VtFlowStateUpdated

  @Expose()
  @IsString()
  public vtFlowRecordId!: string

  @Expose()
  @IsString()
  public state!: string

  @Expose()
  @IsOptional()
  @IsString()
  public previousState!: string | null
}
