import type { AgentContext, DependencyManager, Module, StorageService } from '@credo-ts/core'
import type { DidCommConnectionRecord } from '@credo-ts/didcomm'

import { EventEmitter, inject, injectable, InjectionSymbols } from '@credo-ts/core'
import { DidCommConnectionRepository, DidCommOutOfBandRepository } from '@credo-ts/didcomm'

export const PARENT_CONNECTION_TAG = 'parentConnectionId'

/**
 * Copies the `parentConnectionId` tag from the out-of-band record before the first save.
 * Credo emits the first state change after this save, so the first event has the tag.
 */
@injectable()
export class ParentConnectionRepository extends DidCommConnectionRepository {
  public constructor(
    @inject(InjectionSymbols.StorageService) storageService: StorageService<DidCommConnectionRecord>,
    @inject(EventEmitter) eventEmitter: EventEmitter,
    @inject(DidCommOutOfBandRepository) private readonly outOfBandRepository: DidCommOutOfBandRepository,
  ) {
    super(storageService, eventEmitter)
  }

  public async save(agentContext: AgentContext, record: DidCommConnectionRecord): Promise<void> {
    if (record.outOfBandId && !record.getTag(PARENT_CONNECTION_TAG)) {
      const outOfBandRecord = await this.outOfBandRepository.findById(agentContext, record.outOfBandId)
      const parentConnectionId = outOfBandRecord?.getTag(PARENT_CONNECTION_TAG)
      if (typeof parentConnectionId === 'string') record.setTag(PARENT_CONNECTION_TAG, parentConnectionId)
    }
    await super.save(agentContext, record)
  }
}

/**
 * Put this module after `didcomm` in the module map. The container uses the last registration.
 */
export class ParentConnectionModule implements Module {
  public register(dependencyManager: DependencyManager): void {
    dependencyManager.registerSingleton(DidCommConnectionRepository, ParentConnectionRepository)
  }
}
