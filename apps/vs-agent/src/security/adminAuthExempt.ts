import { CustomDecorator, SetMetadata } from '@nestjs/common'

export const ADMIN_AUTH_EXEMPT_KEY = 'adminAuthExempt'

export type AdminAuthExemption = 'always' | 'corporation'

export const AdminAuthExempt = (exemption: AdminAuthExemption = 'always'): CustomDecorator =>
  SetMetadata(ADMIN_AUTH_EXEMPT_KEY, exemption)
