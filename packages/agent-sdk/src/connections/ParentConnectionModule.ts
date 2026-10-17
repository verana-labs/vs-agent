import type { AgentContext, DependencyManager, Module, StorageService } from '@credo-ts/core'
import type { DidCommConnectionRecord, DidCommOutOfBandRecord } from '@credo-ts/didcomm'

import { EventEmitter, inject, injectable, InjectionSymbols } from '@credo-ts/core'
import {
  DidCommConnectionRepository,
  DidCommOutOfBandRepository,
  DidCommOutOfBandState,
} from '@credo-ts/didcomm'

import { INVITATION_ID_TAG, INVITATION_RECORD_TAG, InvitationRepository } from './InvitationRecord'

export const PARENT_CONNECTION_TAG = 'parentConnectionId'

const savingForOutOfBand = new Map<string, Promise<void>>()

/**
 * Copies the `parentConnectionId` and `invitationId` tags from the out-of-band record before the
 * first save. Credo emits the first state change after this save, so the first event has the tags.
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
    const { outOfBandId } = record
    if (!outOfBandId) return super.save(agentContext, record)

    // Credo binds racing acceptances of a single-use invitation before it marks it done, so saves take turns and the first claims it
    const run = (savingForOutOfBand.get(outOfBandId) ?? Promise.resolve())
      .catch(() => undefined)
      .then(() => this.tagAndSave(agentContext, record, outOfBandId))
    savingForOutOfBand.set(outOfBandId, run)
    try {
      await run
    } finally {
      if (savingForOutOfBand.get(outOfBandId) === run) savingForOutOfBand.delete(outOfBandId)
    }
  }

  private async tagAndSave(
    agentContext: AgentContext,
    record: DidCommConnectionRecord,
    outOfBandId: string,
  ): Promise<void> {
    const outOfBandRecord = await this.outOfBandRepository.findById(agentContext, outOfBandId)
    if (outOfBandRecord && !(await this.isConsumed(agentContext, outOfBandRecord, record))) {
      const parentConnectionId = outOfBandRecord.getTag(PARENT_CONNECTION_TAG)
      if (typeof parentConnectionId === 'string') record.setTag(PARENT_CONNECTION_TAG, parentConnectionId)
      if (outOfBandRecord.getTag(INVITATION_RECORD_TAG) === true) {
        record.setTag(INVITATION_ID_TAG, outOfBandRecord.id)
      }
    }
    await super.save(agentContext, record)
  }

  private async isConsumed(
    agentContext: AgentContext,
    outOfBandRecord: DidCommOutOfBandRecord,
    record: DidCommConnectionRecord,
  ): Promise<boolean> {
    if (outOfBandRecord.reusable || outOfBandRecord.getTag(INVITATION_RECORD_TAG) !== true) return false
    if (outOfBandRecord.state !== DidCommOutOfBandState.Done) {
      const claimed = await this.findByQuery(agentContext, { [INVITATION_ID_TAG]: outOfBandRecord.id })
      if (!claimed.some(connection => connection.id !== record.id)) return false
    }
    agentContext.config.logger.warn(
      `[connection-repository] refused an acceptance of invitation ${outOfBandRecord.id} from ${record.theirDid}: the invitation is single-use`,
    )
    return true
  }
}

/**
 * Put this module after `didcomm` in the module map. The container uses the last registration.
 */
export class ParentConnectionModule implements Module {
  public register(dependencyManager: DependencyManager): void {
    dependencyManager.registerSingleton(DidCommConnectionRepository, ParentConnectionRepository)
    dependencyManager.registerSingleton(InvitationRepository)
  }
}
