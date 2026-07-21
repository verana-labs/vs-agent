import type { VsAgent } from '@verana-labs/vs-agent-sdk'
import type { Request } from 'express'

import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { VtFlowApi } from '@verana-labs/credo-ts-didcomm-vt-flow'

import { AdminAuthService } from './AdminAuthService'
import { ACCESS_MODE_KEY, AccessModeMetadata } from './accessMode'

@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(AdminAuthService) private readonly authService: AdminAuthService,
    @Inject('VSAGENT') private readonly agent: VsAgent,
    @Inject('ADMIN_ALLOWED_ACCOUNTS') private readonly allowedAccounts: string[],
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const metadata = this.reflector.getAllAndOverride<AccessModeMetadata | undefined>(ACCESS_MODE_KEY, [
      context.getHandler(),
      context.getClass(),
    ])
    const mode = metadata?.mode ?? 'INTERNAL'
    if (mode === 'PUBLIC') return true

    const request = context.switchToHttp().getRequest<Request>()
    const header = request.headers.authorization ?? ''
    const token = header.startsWith('Bearer ') ? header.slice(7) : undefined
    const account = token ? this.authService.resolveAccount(token) : undefined
    if (!account) throw new UnauthorizedException('a valid bearer token is required')

    if (this.allowedAccounts.length && !this.allowedAccounts.includes(account)) {
      throw new ForbiddenException('account is not in the allowed accounts list')
    }
    if (mode === 'INTERNAL') {
      throw new ForbiddenException('this method is only available on the internal listener')
    }

    const msgTypes = metadata?.msgTypes ?? []
    const participantSessionId = request.params?.participantSessionId as string | undefined

    let results: (boolean | undefined)[]
    if (participantSessionId) {
      const participantId = await this.resolveValidatorParticipantId(participantSessionId)
      if (participantId === undefined) {
        throw new ForbiddenException('could not resolve the participant scope for this flow')
      }
      results = await Promise.all(
        msgTypes.map(msgType =>
          this.agent.authorizationService?.callerHoldsVsOperatorGrant(account, participantId, msgType),
        ),
      )
    } else {
      results = await Promise.all(
        msgTypes.map(msgType =>
          this.agent.authorizationService?.callerHoldsAnyVsOperatorGrant(account, msgType),
        ),
      )
    }
    if (!results.some(Boolean)) {
      throw new ForbiddenException('account holds no authorization covering this method')
    }
    return true
  }

  private async resolveValidatorParticipantId(participantSessionId?: string): Promise<number | undefined> {
    if (!participantSessionId || !this.agent.veranaChain) return undefined
    const vtFlowApi = this.agent.dependencyManager.resolve(VtFlowApi)
    const [record] = await vtFlowApi.findAllByQuery({ participantSessionId })
    if (!record?.participantId) return undefined
    const applicant = await this.agent.veranaChain.getParticipant(Number(record.participantId))
    const validatorId = Number(applicant?.validatorParticipantId)
    return Number.isFinite(validatorId) && validatorId > 0 ? validatorId : undefined
  }
}
