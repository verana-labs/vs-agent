import type { DidCommFeatureQueryOptions } from '@credo-ts/didcomm'

import { TsLogger } from './logger'

/**
 * Minimal config required by event handlers. A subset of ServerConfig,
 * defined here to avoid circular imports between utils/ and plugins/.
 */
export interface EventConfig {
  webhookUrl?: string
  logger: TsLogger
  discoveryOptions?: DidCommFeatureQueryOptions[]
}
