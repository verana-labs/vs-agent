import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Query,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common'
import {
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger'
import { createdAtKey, mapPage, Page, paginate } from '@verana-labs/vs-agent-sdk'

import { VerifierService } from '../services/VerifierService'

import {
  Openid4vcListPresentationsQueryDto,
  Openid4vcPresentationRecordDto,
  Openid4vcPresentationRecordPageDto,
  Openid4vcPresentationRequestBodyDto,
  Openid4vcPresentationRequestResponseDto,
} from './dto'
import { toPresentationDto } from './mappers'

/**
 * This controller has the presentations of this agent on OpenID4VP.
 * Refer to [VSA-ADM-OID-PR].
 *
 * `createPresentationRequest` makes the authorization request for one credential type, and for
 * the claims of that type the caller asks the wallet to disclose. The read methods show the
 * verification session, with the trust verdict the agent reached once the wallet answered.
 */
@ApiTags('v2/openid4vc')
@Controller({ path: 'openid4vc', version: '2' })
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
export class V2Openid4vcPresentationsController {
  public constructor(@Inject(VerifierService) private readonly verifierService: VerifierService) {}

  @Post('presentation-request')
  @ApiOperation({
    summary: 'Create a presentation request',
    description:
      'Creates an OpenID4VP authorization request for one credential type, and for the claims of that type the caller asks the wallet to disclose.',
  })
  @ApiBody({
    type: Openid4vcPresentationRequestBodyDto,
    examples: {
      everyClaim: {
        summary: 'Every claim of the type',
        value: { jsonSchemaCredentialId: 'employee' },
      },
      selectedClaims: {
        summary: 'Selected claims, for a wallet without DCQL',
        value: {
          jsonSchemaCredentialId: 'employee',
          requestedClaims: ['name', 'role'],
          queryLanguage: 'presentation_exchange',
          requestSigner: 'x5c',
        },
      },
    },
  })
  @ApiCreatedResponse({
    description: 'The presentation request',
    type: Openid4vcPresentationRequestResponseDto,
  })
  @ApiNotFoundResponse({ description: 'The agent cannot resolve the credential type' })
  @ApiConflictResponse({ description: 'The DID does not publish the signing key' })
  public async createPresentationRequest(
    @Body() body: Openid4vcPresentationRequestBodyDto,
  ): Promise<Openid4vcPresentationRequestResponseDto> {
    const request = await this.verifierService.createRequest({
      jsonSchemaCredentialId: body.jsonSchemaCredentialId,
      requestedClaims: body.requestedClaims,
      queryLanguage: body.queryLanguage,
      requestSigner: body.requestSigner,
    })
    return { proofExchangeId: request.verificationSessionId, url: request.authorizationRequest }
  }

  @Get('presentations')
  @ApiOperation({
    summary: 'List presentations',
    description: 'Returns the OpenID4VP verification sessions that the agent created.',
  })
  @ApiOkResponse({ description: 'A page of presentation records', type: Openid4vcPresentationRecordPageDto })
  public async listPresentations(
    @Query() query: Openid4vcListPresentationsQueryDto,
  ): Promise<Page<Openid4vcPresentationRecordDto>> {
    const filters = { jsonSchemaCredentialId: query.jsonSchemaCredentialId, state: query.state }
    const sessions = await this.verifierService.listVerificationSessions(filters)

    const page = paginate(sessions, query, { method: 'openid4vc.listPresentations', filters }, createdAtKey)

    return mapPage(page, toPresentationDto)
  }

  @Get('presentations/:proofExchangeId')
  @ApiOperation({
    summary: 'Get a presentation',
    description:
      'Retrieves one verification session by identifier, with its trust result once the wallet answered.',
  })
  @ApiParam({
    name: 'proofExchangeId',
    type: String,
    description: 'Identifier of the verification session',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  @ApiOkResponse({ description: 'The presentation record', type: Openid4vcPresentationRecordDto })
  @ApiNotFoundResponse({ description: 'No presentation with the given id' })
  public async getPresentation(
    @Param('proofExchangeId') proofExchangeId: string,
  ): Promise<Openid4vcPresentationRecordDto> {
    return toPresentationDto(await this.verifierService.getVerificationSession(proofExchangeId))
  }

  @Delete('presentations/:proofExchangeId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a presentation', description: 'Deletes a verification session record.' })
  @ApiParam({
    name: 'proofExchangeId',
    type: String,
    description: 'Identifier of the verification session',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  @ApiNoContentResponse({ description: 'The presentation record is deleted' })
  @ApiNotFoundResponse({ description: 'No presentation with the given id' })
  public async deletePresentation(@Param('proofExchangeId') proofExchangeId: string): Promise<void> {
    await this.verifierService.deleteVerificationSession(proofExchangeId)
  }
}
