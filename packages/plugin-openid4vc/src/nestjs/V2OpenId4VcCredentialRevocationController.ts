import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common'
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger'

import { StatusListService } from '../services/StatusListService'

import { OpenId4VcRevokeCredentialBodyDto, OpenId4VcRevokeCredentialResponseDto } from './dto'
import { toRevocationDto } from './mappers'

/**
 * This controller revokes the OpenID4VC credentials of this agent at list level.
 * Refer to [VSA-ADM-OID-CR].
 */
@ApiTags('v2/openid4vc')
@Controller({ path: 'openid4vc', version: '2' })
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
export class V2OpenId4VcCredentialRevocationController {
  public constructor(@Inject(StatusListService) private readonly statusListService: StatusListService) {}

  @Post('revoke-credential')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Revoke an OpenID4VC credential',
    description:
      'Sets the status of the credential at statusListIndex to INVALID and publishes the re-signed Status List Token before it answers. A second call on a revoked index succeeds and changes nothing. A caller revokes a credential whose issuance session it has deleted.',
  })
  @ApiBody({
    type: OpenId4VcRevokeCredentialBodyDto,
    examples: {
      default: {
        summary: 'Revoke by list and index',
        value: { statusListId: '3fa85f64-5717-4562-b3fc-2c963f66afa6', statusListIndex: 42 },
      },
    },
  })
  @ApiOkResponse({ description: 'The revocation record', type: OpenId4VcRevokeCredentialResponseDto })
  @ApiBadRequestResponse({ description: 'statusListIndex is out of range for the list' })
  @ApiNotFoundResponse({ description: 'No status list with the given id' })
  @ApiConflictResponse({ description: 'No offer bound statusListIndex on that list' })
  public async revokeCredential(
    @Body() body: OpenId4VcRevokeCredentialBodyDto,
  ): Promise<OpenId4VcRevokeCredentialResponseDto> {
    return toRevocationDto(
      await this.statusListService.revokeCredential({
        statusListId: body.statusListId,
        statusListIndex: body.statusListIndex,
      }),
    )
  }
}
