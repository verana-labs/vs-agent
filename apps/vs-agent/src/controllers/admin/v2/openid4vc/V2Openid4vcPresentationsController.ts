import type { OpenId4VcVerificationSessionSummary } from '@verana-labs/vs-agent-plugin-openid4vc'

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Optional,
  Param,
  Post,
  Query,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common'
import {
  ApiBadRequestResponse,
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
  OpenId4VcVerifierRequestError,
  UnknownVerificationSessionError,
  UnknownVerifierPolicyError,
  VerifierService,
} from '@verana-labs/vs-agent-plugin-openid4vc'

import { AdminApiError, AdminApiErrorCode, createdAtKey, Page, paginate } from '../../../../common'

import {
  Openid4vcListPresentationsQueryDto,
  Openid4vcPresentationRecordDto,
  Openid4vcPresentationRecordPageDto,
  Openid4vcPresentationRequestBodyDto,
  Openid4vcPresentationRequestResponseDto,
} from './dto'
import { capabilityNotConfigured } from './errors'

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
  public constructor(
    @Optional() @Inject(VerifierService) private readonly verifierService?: VerifierService,
  ) {}

  @Post('presentation-request')
  @ApiOperation({
    summary: 'Create a presentation request',
    description: 'Creates an OpenID4VP authorization request for one verifier policy.',
  })
  @ApiBody({ type: Openid4vcPresentationRequestBodyDto })
  @ApiCreatedResponse({
    description: 'The presentation request',
    type: Openid4vcPresentationRequestResponseDto,
  })
  @ApiBadRequestResponse({ description: 'Unknown verifier policy' })
  @ApiConflictResponse({
    description:
      'The configuration defines no verifier capability, or the DID does not publish the signing key',
  })
  public async createPresentationRequest(
    @Body() body: Openid4vcPresentationRequestBodyDto,
  ): Promise<Openid4vcPresentationRequestResponseDto> {
    try {
      const request = await this.verifier().createRequest(
        body.policyId,
        body.queryLanguage,
        body.requestSigner,
      )
      return { proofExchangeId: request.verificationSessionId, url: request.authorizationRequest }
    } catch (error) {
      throw translate(error)
    }
  }

  @Get('presentations')
  @ApiOperation({
    summary: 'List presentations',
    description: 'Returns the OpenID4VP verification sessions that the agent created.',
  })
  @ApiOkResponse({ description: 'A page of presentation records', type: Openid4vcPresentationRecordPageDto })
  @ApiConflictResponse({ description: 'The configuration defines no verifier capability' })
  public async listPresentations(
    @Query() query: Openid4vcListPresentationsQueryDto,
  ): Promise<Page<Openid4vcPresentationRecordDto>> {
    const sessions = await this.verifier().listVerificationSessions()
    const filtered = sessions.filter(
      session =>
        (!query.policyId || session.policyId === query.policyId) &&
        (!query.state || session.state === query.state),
    )

    const page = paginate(
      filtered,
      query,
      { method: 'openid4vc.listPresentations', filters: { policyId: query.policyId, state: query.state } },
      createdAtKey,
    )

    return { items: page.items.map(toRecordDto), nextCursor: page.nextCursor }
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
  @ApiConflictResponse({ description: 'The configuration defines no verifier capability' })
  public async getPresentation(
    @Param('proofExchangeId') proofExchangeId: string,
  ): Promise<Openid4vcPresentationRecordDto> {
    try {
      return toRecordDto(await this.verifier().getVerificationSession(proofExchangeId))
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
  @ApiConflictResponse({ description: 'The configuration defines no verifier capability' })
  public async deletePresentation(@Param('proofExchangeId') proofExchangeId: string): Promise<void> {
    try {
      await this.verifier().deleteVerificationSession(proofExchangeId)
    } catch (error) {
      throw translate(error, proofExchangeId)
    }
  }

  private verifier(): VerifierService {
    if (!this.verifierService) throw capabilityNotConfigured('verifier')
    return this.verifierService
  }
}

function toRecordDto(session: OpenId4VcVerificationSessionSummary): Openid4vcPresentationRecordDto {
  return {
    proofExchangeId: session.id,
    policyId: session.policyId,
    state: session.state,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    errorMessage: session.errorMessage,
    cryptographicVerified: session.cryptographicVerified,
    accepted: session.accepted,
    trust: session.trust,
    credential: session.credential,
  }
}

function translate(error: unknown, proofExchangeId?: string): unknown {
  if (error instanceof UnknownVerificationSessionError) {
    return new AdminApiError(
      AdminApiErrorCode.UnknownId,
      HttpStatus.NOT_FOUND,
      `no presentation with id "${proofExchangeId}"`,
    )
  }
  if (error instanceof UnknownVerifierPolicyError) {
    return new AdminApiError(AdminApiErrorCode.UnknownPolicy, HttpStatus.BAD_REQUEST, error.message)
  }
  if (error instanceof OpenId4VcVerifierRequestError) {
    return new AdminApiError(AdminApiErrorCode.InvalidState, HttpStatus.CONFLICT, error.message)
  }
  return error
}
