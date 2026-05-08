import { VsAgent } from '../../agent'
import { IndexerActivity, VeranaSyncState } from '../types'

interface IndexerHandlerContext {
  agent: VsAgent
  block_height: number
  operatorAddress: string
  state: VeranaSyncState
  txHash: string
}

export interface IndexerEventHandler<TMsg extends string = string> {
  readonly msg: TMsg
  handle(activity: IndexerActivity, ctx: IndexerHandlerContext): Promise<void>
}

/**
 * Registry for handlers of indexer events. Handlers can be registered/unregistered at runtime
 * and are looked up by the `msg` field of indexer activities.
 */
export class IndexerHandlerRegistry {
  private handlers = new Map<string, IndexerEventHandler>()

  register(handler: IndexerEventHandler): void {
    this.handlers.set(handler.msg, handler)
  }

  unregister(msg: string): void {
    this.handlers.delete(msg)
  }

  get(msg: string): IndexerEventHandler | undefined {
    return this.handlers.get(msg)
  }

  has(msg: string): boolean {
    return this.handlers.has(msg)
  }

  async dispatch(activity: IndexerActivity, ctx: IndexerHandlerContext): Promise<void> {
    const h = this.handlers.get(activity.msg)
    if (!h) {
      ctx.agent.config.logger.debug(`[IndexerWS] No handler for msg=${activity.msg}`)
      return
    }
    await h.handle(activity, ctx)
  }
}
