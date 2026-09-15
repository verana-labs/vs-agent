import { HttpStatus } from '@nestjs/common'

import { AdminApiError, AdminApiErrorCode } from '../../../../common'

export function capabilityNotConfigured(capability: 'issuer' | 'verifier'): AdminApiError {
  return new AdminApiError(
    AdminApiErrorCode.CapabilityNotConfigured,
    HttpStatus.CONFLICT,
    `the OpenID4VC configuration defines no ${capability} capability`,
  )
}
