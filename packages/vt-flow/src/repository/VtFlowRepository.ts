import type { AgentContext, StorageService } from '@credo-ts/core'

import { EventEmitter, InjectionSymbols, Repository, inject, injectable } from '@credo-ts/core'

import { VtFlowRole } from '../VtFlowRole'

import { VtFlowRecord } from './VtFlowRecord'

@injectable()
export class VtFlowRepository extends Repository<VtFlowRecord> {
  public constructor(
    @inject(InjectionSymbols.StorageService) storageService: StorageService<VtFlowRecord>,
    eventEmitter: EventEmitter,
  ) {
    super(VtFlowRecord, storageService, eventEmitter)
  }

  public findByThreadId(agentContext: AgentContext, threadId: string) {
    return this.findSingleByQuery(agentContext, { threadId })
  }

  public findBySessionUuid(agentContext: AgentContext, sessionUuid: string, role?: VtFlowRole) {
    return this.findSingleByQuery(agentContext, {
      sessionUuid,
      ...(role !== undefined ? { role } : {}),
    })
  }

  public findByCredentialExchangeRecordId(agentContext: AgentContext, credentialExchangeRecordId: string) {
    return this.findSingleByQuery(agentContext, { credentialExchangeRecordId })
  }

  public findBySubprotocolThid(agentContext: AgentContext, subprotocolThid: string) {
    return this.findSingleByQuery(agentContext, { subprotocolThid })
  }

  public findByConnectionId(agentContext: AgentContext, connectionId: string) {
    return this.findByQuery(agentContext, { connectionId })
  }
}
