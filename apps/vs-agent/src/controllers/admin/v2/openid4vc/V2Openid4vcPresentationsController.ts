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
import {
  InvalidPresentationRequestError,
  OpenId4VcVerifierRequestError,
  UnknownCredentialConfigurationError,
  UnknownVerificationSessionError,
  VerifierService,
} from '@verana-labs/vs-agent-plugin-openid4vc'

import { AdminApiError, AdminApiErrorCode, createdAtKey, mapPage, Page, paginate } from '../../../../common'

import {
  Openid4vcListPresentationsQueryDto,
  Openid4vcPresentationRecordDto,
  Openid4vcPresentationRecordPageDto,
  Openid4vcPresentationRequestBodyDto,
  Openid4vcPresentationRequestResponseDto,
} from './dto'
import { toPresentationDto } from './mappers'

const PROOF_EXCHANGE_ID = {
  name: 'proofExchangeId',
  type: String,
  description: 'Identifier of the verification session',
  example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
}

/** [VSA-ADM-OID-PR] Presentations of the OpenID4VC verifier capability. */
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
  @ApiBody({ type: Openid4vcPresentationRequestBodyDto })
  @ApiCreatedResponse({
    description: 'The presentation request',
    type: Openid4vcPresentationRequestResponseDto,
  })
  @ApiNotFoundResponse({ description: 'The agent cannot resolve the credential type' })
  @ApiConflictResponse({ description: 'The DID does not publish the signing key' })
  public async createPresentationRequest(
    @Body() body: Openid4vcPresentationRequestBodyDto,
  ): Promise<Openid4vcPresentationRequestResponseDto> {
    try {
      const request = await this.verifierService.createRequest({
        jsonSchemaCredentialId: body.jsonSchemaCredentialId,
        requestedClaims: body.requestedClaims,
        queryLanguage: body.queryLanguage,
        requestSigner: body.requestSigner,
      })
      return { proofExchangeId: request.verificationSessionId, url: request.authorizationRequest }
    } catch (error) {
      throw translateRequest(error)
    }
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
    const sessions = await this.verifierService.listVerificationSessions()
    const filtered = sessions.filter(
      session =>
        (!query.jsonSchemaCredentialId || session.jsonSchemaCredentialId === query.jsonSchemaCredentialId) &&
        (!query.state || session.state === query.state),
    )

    const page = paginate(
      filtered,
      query,
      {
        method: 'openid4vc.listPresentations',
        filters: { jsonSchemaCredentialId: query.jsonSchemaCredentialId, state: query.state },
      },
      createdAtKey,
    )

    return mapPage(page, toPresentationDto)
  }

  @Get('presentations/:proofExchangeId')
  @ApiOperation({
    summary: 'Get a presentation',
    description:
      'Retrieves one verification session by identifier, with its trust result once the wallet answered.',
  })
  @ApiParam(PROOF_EXCHANGE_ID)
  @ApiOkResponse({ description: 'The presentation record', type: Openid4vcPresentationRecordDto })
  @ApiNotFoundResponse({ description: 'No presentation with the given id' })
  public async getPresentation(
    @Param('proofExchangeId') proofExchangeId: string,
  ): Promise<Openid4vcPresentationRecordDto> {
    try {
      return toPresentationDto(await this.verifierService.getVerificationSession(proofExchangeId))
    } catch (error) {
      throw translate(error, proofExchangeId)
    }
  }

  @Delete('presentations/:proofExchangeId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a presentation', description: 'Deletes a verification session record.' })
  @ApiParam(PROOF_EXCHANGE_ID)
  @ApiNoContentResponse({ description: 'The presentation record is deleted' })
  @ApiNotFoundResponse({ description: 'No presentation with the given id' })
  public async deletePresentation(@Param('proofExchangeId') proofExchangeId: string): Promise<void> {
    try {
      await this.verifierService.deleteVerificationSession(proofExchangeId)
    } catch (error) {
      throw translate(error, proofExchangeId)
    }
  }
}

function translate(error: unknown, proofExchangeId: string): unknown {
  if (error instanceof UnknownVerificationSessionError) {
    return new AdminApiError(
      AdminApiErrorCode.UnknownId,
      HttpStatus.NOT_FOUND,
      `no presentation with id "${proofExchangeId}"`,
    )
  }
  return translateRequest(error)
}

function translateRequest(error: unknown): unknown {
  if (error instanceof UnknownCredentialConfigurationError) {
    return new AdminApiError(AdminApiErrorCode.UnknownId, HttpStatus.NOT_FOUND, error.message)
  }
  if (error instanceof InvalidPresentationRequestError) {
    return new AdminApiError(AdminApiErrorCode.InvalidInput, HttpStatus.BAD_REQUEST, error.message)
  }
  if (error instanceof OpenId4VcVerifierRequestError) {
    return new AdminApiError(AdminApiErrorCode.InvalidState, HttpStatus.CONFLICT, error.message)
  }
  return error
}
