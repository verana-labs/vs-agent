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

import { AdminAuthService } from './AdminAuthService'
import { ADMIN_AUTH_EXEMPT_KEY, AdminAuthExemption } from './adminAuthExempt'
import { isTrustedPeer, TrustedNetwork } from './trustedNetworks'

@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(AdminAuthService) private readonly authService: AdminAuthService,
    @Inject('ADMIN_AUTH_MODE') private readonly authMode: string,
    @Inject('ADMIN_TRUSTED_NETWORKS') private readonly trustedNetworks: TrustedNetwork[],
    @Inject('ADMIN_ALLOWED_ACCOUNTS') private readonly allowedAccounts: string[],
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const exemption = this.reflector.getAllAndOverride<AdminAuthExemption | undefined>(
      ADMIN_AUTH_EXEMPT_KEY,
      [context.getHandler(), context.getClass()],
    )
    if (exemption === 'always') return true
    if (exemption === 'corporation' && this.authMode === 'corporation') return true

    // Classification is on the peer TCP address only, never on X-Forwarded-For or similar headers.
    const request = context.switchToHttp().getRequest<Request>()
    if (isTrustedPeer(request.socket?.remoteAddress, this.trustedNetworks)) return true

    if (this.authMode !== 'corporation') {
      throw new ForbiddenException('external requests are not served in internal mode')
    }

    const header = request.headers.authorization ?? ''
    const token = header.startsWith('Bearer ') ? header.slice(7) : undefined
    const account = token ? this.authService.resolveAccount(token) : undefined
    if (!account) throw new UnauthorizedException('a valid bearer token is required')

    if (!this.allowedAccounts.includes(account)) {
      throw new ForbiddenException('account is not in the allowed accounts list')
    }
    return true
  }
}
