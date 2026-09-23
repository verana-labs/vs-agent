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
  UnknownStatusListError,
} from '@verana-labs/vs-agent-plugin-openid4vc'

import { AdminApiError, AdminApiErrorCode, createdAtKey, mapPage, Page, paginate } from '../../../../common'

import {
  Openid4vcCredentialExchangeRecordDto,
  Openid4vcCredentialExchangeRecordPageDto,
  Openid4vcCredentialOfferBodyDto,
  Openid4vcCredentialOfferResponseDto,
  Openid4vcListCredentialExchangesQueryDto,
} from './dto'
import { toCredentialExchangeDto } from './mappers'

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
  public constructor(@Inject(IssuerService) private readonly issuerService: IssuerService) {}

  @Post('credential-offer')
  @ApiOperation({
    summary: 'Create a credential offer',
    description:
      'Creates a pre-authorized OpenID4VCI credential offer for one credential configuration. The credential expires after ttlSeconds.',
  })
  @ApiBody({ type: Openid4vcCredentialOfferBodyDto })
  @ApiCreatedResponse({ description: 'The credential offer', type: Openid4vcCredentialOfferResponseDto })
  @ApiNotFoundResponse({ description: 'The agent cannot resolve the credential type or the status list' })
  public async createCredentialOffer(
    @Body() body: Openid4vcCredentialOfferBodyDto,
  ): Promise<Openid4vcCredentialOfferResponseDto> {
    try {
      const offer = await this.issuerService.createOffer({
        jsonSchemaCredentialId: body.jsonSchemaCredentialId,
        claims: body.claims,
        ttlSeconds: body.ttlSeconds,
        statusListId: body.statusListId,
        statusListIndex: body.statusListIndex,
      })
      return { credentialExchangeId: offer.issuanceSessionId, url: offer.credentialOffer }
    } catch (error) {
      throw translateOffer(error)
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
  public async listCredentialExchanges(
    @Query() query: Openid4vcListCredentialExchangesQueryDto,
  ): Promise<Page<Openid4vcCredentialExchangeRecordDto>> {
    const sessions = await this.issuerService.listIssuanceSessions()
    const filtered = sessions.filter(
      session =>
        (!query.jsonSchemaCredentialId || session.jsonSchemaCredentialId === query.jsonSchemaCredentialId) &&
        (!query.statusListId || session.statusListId === query.statusListId) &&
        (!query.state || session.state === query.state),
    )

    const page = paginate(
      filtered,
      query,
      {
        method: 'openid4vc.listCredentialExchanges',
        filters: {
          jsonSchemaCredentialId: query.jsonSchemaCredentialId,
          statusListId: query.statusListId,
          state: query.state,
        },
      },
      createdAtKey,
    )

    return mapPage(page, toCredentialExchangeDto)
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
  public async getCredentialExchange(
    @Param('credentialExchangeId') credentialExchangeId: string,
  ): Promise<Openid4vcCredentialExchangeRecordDto> {
    try {
      return toCredentialExchangeDto(await this.issuerService.getIssuanceSession(credentialExchangeId))
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
  public async deleteCredentialExchange(
    @Param('credentialExchangeId') credentialExchangeId: string,
  ): Promise<void> {
    try {
      await this.issuerService.deleteIssuanceSession(credentialExchangeId)
    } catch (error) {
      throw translate(error, credentialExchangeId)
    }
  }
}

function translate(error: unknown, credentialExchangeId: string): unknown {
  if (error instanceof UnknownIssuanceSessionError) {
    return new AdminApiError(
      AdminApiErrorCode.UnknownId,
      HttpStatus.NOT_FOUND,
      `no credential exchange with id "${credentialExchangeId}"`,
    )
  }
  return translateOffer(error)
}

function translateOffer(error: unknown): unknown {
  if (error instanceof UnknownCredentialConfigurationError || error instanceof UnknownStatusListError) {
    return new AdminApiError(AdminApiErrorCode.UnknownId, HttpStatus.NOT_FOUND, error.message)
  }
  if (error instanceof OpenId4VcIssuerRequestError) {
    return new AdminApiError(AdminApiErrorCode.InvalidInput, HttpStatus.BAD_REQUEST, error.message)
  }
  return error
}
