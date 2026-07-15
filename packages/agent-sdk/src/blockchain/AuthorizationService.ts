import { BaseLogger } from '@credo-ts/core'

import { VeranaChainService } from './VeranaChainService'
import { CachedVsOperatorAuthorizationRecord, DurationParam } from './types'

// A lapsed grant that carries a period is still valid: the chain rolls the expiration
// forward on the next check (VPR spec AUTHZ-CHECK-3 step 4, AUTHZ-CHECK-1 step 2).
function renews(period?: DurationParam): boolean {
  return period != null && (period.seconds > 0 || (period.nanos ?? 0) > 0)
}

function isOperatorAuthorizationActive(expiration?: Date, period?: DurationParam): boolean {
  return expiration === undefined || expiration.getTime() > Date.now() || renews(period)
}

function isVsoaRecordActive(expiration?: Date, period?: DurationParam): boolean {
  return expiration != null && (expiration.getTime() > Date.now() || renews(period))
}

export interface AuthorizationServiceConfig {
  chain: VeranaChainService
  logger: BaseLogger
  minRefreshIntervalMs?: number
}

/** VS operator authorization records cached for the admin API (https://github.com/verana-labs/vs-agent/issues/472); operator authorizations are queried on demand. */
export class AuthorizationService {
  private vsoaByParticipant = new Map<number, CachedVsOperatorAuthorizationRecord>()
  private lastRefreshAt = 0
  private readonly chain: VeranaChainService
  private readonly logger: BaseLogger
  private readonly minRefreshIntervalMs: number

  constructor(config: AuthorizationServiceConfig) {
    this.chain = config.chain
    this.logger = config.logger
    this.minRefreshIntervalMs = config.minRefreshIntervalMs ?? 2_000
  }

  async refreshForOperator(): Promise<void> {
    // Catch-up replays hit the same current chain state, so back-to-back refreshes are skipped.
    if (Date.now() - this.lastRefreshAt < this.minRefreshIntervalMs) return

    const vsoas = await this.chain.listVsOperatorAuthorizations()
    this.lastRefreshAt = Date.now()
    const rebuilt = new Map<number, CachedVsOperatorAuthorizationRecord>()
    for (const vsoa of vsoas) {
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
    return (
      !!record && record.msgTypes.includes(msgType) && isVsoaRecordActive(record.expiration, record.period)
    )
  }

  getVsOperatorAuthorizationRecord(participantId: number): CachedVsOperatorAuthorizationRecord | undefined {
    return this.vsoaByParticipant.get(participantId)
  }

  listVsOperatorAuthorizationRecords(): CachedVsOperatorAuthorizationRecord[] {
    return [...this.vsoaByParticipant.values()]
  }

  // The feegrant mirror requires a strictly future expiration and is not renewed by the
  // lazy cycle (MOD-DE-MSG-5-5), so no period leniency here.
  hasFeegrant(participantId: number): boolean {
    const record = this.vsoaByParticipant.get(participantId)
    return (
      !!record && record.withFeegrant && record.expiration != null && record.expiration.getTime() > Date.now()
    )
  }

  async agentHoldsOperatorGrant(msgType: string): Promise<boolean> {
    return this.callerHoldsOperatorGrant(this.chain.address, msgType)
  }

  // A blank account must fail closed: the chain treats an empty filter as "any account".
  async callerHoldsOperatorGrant(account: string, msgType: string): Promise<boolean> {
    if (!account.trim()) return false
    const auths = await this.chain.listOperatorAuthorizations(account)
    return auths.some(
      a => a.msgTypes.includes(msgType) && isOperatorAuthorizationActive(a.expiration, a.period),
    )
  }

  async callerHoldsVsOperatorGrant(
    account: string,
    participantId: number,
    msgType: string,
  ): Promise<boolean> {
    if (!account.trim()) return false
    const vsoas = await this.chain.listVsOperatorAuthorizations(account)
    return vsoas.some(vsoa =>
      vsoa.records.some(
        r =>
          r.participantId === participantId &&
          r.msgTypes.includes(msgType) &&
          isVsoaRecordActive(r.expiration, r.period),
      ),
    )
  }
}
