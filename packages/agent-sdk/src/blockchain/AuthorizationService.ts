import { BaseLogger } from '@credo-ts/core'

import { VeranaChainService } from './VeranaChainService'
import { CachedVsOperatorAuthorizationRecord, DurationParam } from './types'

// A lapsed grant that carries a period is still valid: the chain rolls the expiration
// forward on the next check (VPR spec AUTHZ-CHECK-3 step 4, AUTHZ-CHECK-1 step 2).
function isActive(expiration?: Date, period?: DurationParam): boolean {
  return expiration === undefined || expiration.getTime() > Date.now() || period != null
}

export interface AuthorizationServiceConfig {
  chain: VeranaChainService
  logger: BaseLogger
  corporationId?: number
  minRefreshIntervalMs?: number
}

/** VS operator authorization records cached for the admin API (https://github.com/verana-labs/vs-agent/issues/472); operator authorizations are queried on demand. */
export class AuthorizationService {
  private vsoaByParticipant = new Map<number, CachedVsOperatorAuthorizationRecord>()
  private lastRefreshAt = 0
  private readonly chain: VeranaChainService
  private readonly logger: BaseLogger
  private readonly corporationId?: number
  private readonly minRefreshIntervalMs: number

  constructor(config: AuthorizationServiceConfig) {
    this.chain = config.chain
    this.logger = config.logger
    this.corporationId = config.corporationId
    this.minRefreshIntervalMs = config.minRefreshIntervalMs ?? 2_000
  }

  private inScope(corporationId: number): boolean {
    return this.corporationId === undefined || corporationId === this.corporationId
  }

  async refreshForOperator(): Promise<void> {
    // Catch-up replays hit the same current chain state, so back-to-back refreshes are skipped.
    if (Date.now() - this.lastRefreshAt < this.minRefreshIntervalMs) return
    this.lastRefreshAt = Date.now()

    const vsoas = await this.chain.listVsOperatorAuthorizations()
    const rebuilt = new Map<number, CachedVsOperatorAuthorizationRecord>()
    for (const vsoa of vsoas) {
      if (!this.inScope(vsoa.corporationId)) continue
      for (const record of vsoa.records) {
        rebuilt.set(record.participantId, {
          ...record,
          corporationId: vsoa.corporationId,
          vsOperator: vsoa.vsOperator,
        })
      }
    }
    this.vsoaByParticipant = rebuilt
    this.logger.debug(`[Authorization] cache refreshed: ${rebuilt.size} VSOA record(s)`)
  }

  invalidateParticipant(participantId: number): void {
    if (this.vsoaByParticipant.delete(participantId)) {
      this.logger.debug(`[Authorization] invalidated VSOA record for participant ${participantId}`)
    }
  }

  canSign(participantId: number, msgType: string): boolean {
    const record = this.vsoaByParticipant.get(participantId)
    return !!record && record.msgTypes.includes(msgType) && isActive(record.expiration, record.period)
  }

  getVsOperatorAuthorizationRecord(participantId: number): CachedVsOperatorAuthorizationRecord | undefined {
    return this.vsoaByParticipant.get(participantId)
  }

  listVsOperatorAuthorizationRecords(): CachedVsOperatorAuthorizationRecord[] {
    return [...this.vsoaByParticipant.values()]
  }

  hasFeegrant(participantId: number): boolean {
    const record = this.vsoaByParticipant.get(participantId)
    return !!record && record.withFeegrant && isActive(record.expiration, record.period)
  }

  async agentHoldsOperatorGrant(msgType: string): Promise<boolean> {
    return this.callerHoldsOperatorGrant(this.chain.address, msgType)
  }

  // A blank account must fail closed: the chain treats an empty filter as "any account".
  async callerHoldsOperatorGrant(account: string, msgType: string): Promise<boolean> {
    if (!account.trim()) return false
    const auths = await this.chain.listOperatorAuthorizations(account)
    return auths.some(
      a => this.inScope(a.corporationId) && a.msgTypes.includes(msgType) && isActive(a.expiration, a.period),
    )
  }

  async callerHoldsVsOperatorGrant(
    account: string,
    participantId: number,
    msgType: string,
  ): Promise<boolean> {
    if (!account.trim()) return false
    const vsoas = await this.chain.listVsOperatorAuthorizations(account)
    return vsoas.some(
      vsoa =>
        this.inScope(vsoa.corporationId) &&
        vsoa.records.some(
          r =>
            r.participantId === participantId &&
            r.msgTypes.includes(msgType) &&
            isActive(r.expiration, r.period),
        ),
    )
  }
}
