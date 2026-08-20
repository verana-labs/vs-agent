import { All, Controller, NotImplementedException } from '@nestjs/common'
import { ApiExcludeEndpoint, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'

import { AccessMode } from '../../../../security'

// The scope is reserved while v1 is migrated. Every method answers 501 until it is built.
@ApiTags('auth')
@AccessMode('INTERNAL')
@Controller({ path: 'auth', version: '2' })
export class AuthV2Controller {
  @All()
  @ApiOperation({ summary: 'Reserved v2 scope, not implemented yet' })
  @ApiResponse({ status: 501, description: 'The scope is reserved and serves no method yet' })
  notImplemented(): never {
    throw new NotImplementedException()
  }

  @All('*')
  @ApiExcludeEndpoint()
  notImplementedSubPath(): never {
    throw new NotImplementedException()
  }
}
