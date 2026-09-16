import type { OpenId4VcIssuanceSessionSummary } from '@verana-labs/vs-agent-plugin-openid4vc'

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
  IssuerService,
  OpenId4VcIssuerRequestError,
  UnknownCredentialConfigurationError,
  UnknownIssuanceSessionError,
} from '@verana-labs/vs-agent-plugin-openid4vc'

import { AdminApiError, AdminApiErrorCode, createdAtKey, Page, paginate } from '../../../../common'

import {
  Openid4vcCredentialExchangeRecordDto,
  Openid4vcCredentialExchangeRecordPageDto,
  Openid4vcCredentialOfferBodyDto,
  Openid4vcCredentialOfferResponseDto,
  Openid4vcListCredentialExchangesQueryDto,
} from './dto'
import { capabilityNotConfigured } from './errors'

const CREDENTIAL_EXCHANGE_ID = {
  name: 'credentialExchangeId',
  type: String,
  description: 'Identifier of the issuance session',
  example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
}

/** [VSA-ADM-OID-CE] Credential exchanges of the OpenID4VC issuer capability. */
@ApiTags('v2/openid4vc')
@Controller({ path: 'openid4vc', version: '2' })
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
export class V2Openid4vcCredentialExchangesController {
  public constructor(@Optional() @Inject(IssuerService) private readonly issuerService?: IssuerService) {}

  @Post('credential-offer')
  @ApiOperation({
    summary: 'Create a credential offer',
    description:
      'Creates a pre-authorized OpenID4VCI credential offer for one credential configuration. The credential expires after ttlSeconds.',
  })
  @ApiBody({ type: Openid4vcCredentialOfferBodyDto })
  @ApiCreatedResponse({ description: 'The credential offer', type: Openid4vcCredentialOfferResponseDto })
  @ApiBadRequestResponse({
    description: 'Claims that do not match the configuration, or a ttlSeconds outside its range',
  })
  @ApiNotFoundResponse({ description: 'The agent cannot resolve the credential configuration' })
  @ApiConflictResponse({ description: 'The configuration defines no issuer capability' })
  public async createCredentialOffer(
    @Body() body: Openid4vcCredentialOfferBodyDto,
  ): Promise<Openid4vcCredentialOfferResponseDto> {
    try {
      const offer = await this.issuer().createOffer(
        body.credentialConfigurationId,
        body.claims,
        body.ttlSeconds,
      )
      return { credentialExchangeId: offer.issuanceSessionId, url: offer.credentialOffer }
    } catch (error) {
      throw translate(error)
    }
  }

  @Get('credential-exchanges')
  @ApiOperation({
    summary: 'List credential exchanges',
    description: 'Returns the OpenID4VCI issuance sessions that the agent tracks.',
  })
  @ApiOkResponse({
    description: 'A page of credential exchange records',
    type: Openid4vcCredentialExchangeRecordPageDto,
  })
  @ApiConflictResponse({ description: 'The configuration defines no issuer capability' })
  public async listCredentialExchanges(
    @Query() query: Openid4vcListCredentialExchangesQueryDto,
  ): Promise<Page<Openid4vcCredentialExchangeRecordDto>> {
    const sessions = await this.issuer().listIssuanceSessions()
    const filtered = sessions.filter(
      session =>
        (!query.credentialConfigurationId ||
          session.credentialConfigurationId === query.credentialConfigurationId) &&
        (!query.state || session.state === query.state),
    )

    const page = paginate(
      filtered,
      query,
      {
        method: 'openid4vc.listCredentialExchanges',
        filters: { credentialConfigurationId: query.credentialConfigurationId, state: query.state },
      },
      createdAtKey,
    )

    return { items: page.items.map(toRecordDto), nextCursor: page.nextCursor }
  }

  @Get('credential-exchanges/:credentialExchangeId')
  @ApiOperation({
    summary: 'Get a credential exchange',
    description: 'Retrieves one issuance session by identifier.',
  })
  @ApiParam(CREDENTIAL_EXCHANGE_ID)
  @ApiOkResponse({
    description: 'The credential exchange record',
    type: Openid4vcCredentialExchangeRecordDto,
  })
  @ApiNotFoundResponse({ description: 'No credential exchange with the given id' })
  @ApiConflictResponse({ description: 'The configuration defines no issuer capability' })
  public async getCredentialExchange(
    @Param('credentialExchangeId') credentialExchangeId: string,
  ): Promise<Openid4vcCredentialExchangeRecordDto> {
    try {
      return toRecordDto(await this.issuer().getIssuanceSession(credentialExchangeId))
    } catch (error) {
      throw translate(error, credentialExchangeId)
    }
  }

  @Delete('credential-exchanges/:credentialExchangeId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a credential exchange',
    description: 'Deletes an issuance session record. It does not delete a credential that a wallet holds.',
  })
  @ApiParam(CREDENTIAL_EXCHANGE_ID)
  @ApiNoContentResponse({ description: 'The credential exchange record is deleted' })
  @ApiNotFoundResponse({ description: 'No credential exchange with the given id' })
  @ApiConflictResponse({ description: 'The configuration defines no issuer capability' })
  public async deleteCredentialExchange(
    @Param('credentialExchangeId') credentialExchangeId: string,
  ): Promise<void> {
    try {
      await this.issuer().deleteIssuanceSession(credentialExchangeId)
    } catch (error) {
      throw translate(error, credentialExchangeId)
    }
  }

  private issuer(): IssuerService {
    if (!this.issuerService) throw capabilityNotConfigured('issuer')
    return this.issuerService
  }
}

function toRecordDto(session: OpenId4VcIssuanceSessionSummary): Openid4vcCredentialExchangeRecordDto {
  return {
    credentialExchangeId: session.id,
    credentialConfigurationId: session.credentialConfigurationId,
    state: session.state,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    expiresAt: session.expiresAt,
    errorMessage: session.errorMessage,
  }
}

function translate(error: unknown, credentialExchangeId?: string): unknown {
  if (error instanceof UnknownIssuanceSessionError) {
    return new AdminApiError(
      AdminApiErrorCode.UnknownId,
      HttpStatus.NOT_FOUND,
      `no credential exchange with id "${credentialExchangeId}"`,
    )
  }
  if (error instanceof UnknownCredentialConfigurationError) {
    return new AdminApiError(AdminApiErrorCode.UnknownId, HttpStatus.NOT_FOUND, error.message)
  }
  if (error instanceof OpenId4VcIssuerRequestError) {
    return new AdminApiError(AdminApiErrorCode.InvalidInput, HttpStatus.BAD_REQUEST, error.message)
  }
  return error
}
