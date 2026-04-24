import { JsonObject } from '@credo-ts/core'

export interface IndexerEventsResponse {
  events: JsonObject[]
  count: number
  after_block_height: number
}
