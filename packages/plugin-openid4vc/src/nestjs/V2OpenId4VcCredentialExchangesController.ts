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
import { createdAtKey, mapPage, Page, paginate } from '@verana-labs/vs-agent-sdk'

import { IssuerService } from '../services/IssuerService'

import {
  OpenId4VcCredentialExchangeRecordDto,
  OpenId4VcCredentialExchangeRecordPageDto,
  OpenId4VcCreateCredentialOfferBodyDto,
  OpenId4VcCredentialOfferResponseDto,
  OpenId4VcListCredentialExchangesQueryDto,
} from './dto'
import { toCredentialExchangeDto } from './mappers'

/**
 * This controller has the credential exchanges of this agent on OpenID4VCI.
 * Refer to [VSA-ADM-OID-CE].
 *
 * `createCredentialOffer` mints a pre-authorized offer for one credential configuration. The
 * wallet redeems that offer on the issuer endpoints of the agent, and the read methods show the
 * issuance session that the agent tracks for it. The offer expires after `ttlSeconds`.
 */
@ApiTags('v2/openid4vc')
@Controller({ path: 'openid4vc', version: '2' })
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
export class V2OpenId4VcCredentialExchangesController {
  public constructor(@Inject(IssuerService) private readonly issuerService: IssuerService) {}

  @Post('credential-offer')
  @ApiOperation({
    summary: 'Create a credential offer',
    description:
      'Creates a pre-authorized OpenID4VCI credential offer for one credential configuration. The credential expires after ttlSeconds.',
  })
  @ApiBody({
    type: OpenId4VcCreateCredentialOfferBodyDto,
    examples: {
      employee: {
        summary: 'Employee credential',
        value: {
          jsonSchemaCredentialId: 'employee',
          claims: { name: 'Ada Lovelace', role: 'engineer' },
          ttlSeconds: 3600,
        },
      },
      statusList: {
        summary: 'Credential registered on a status list',
        value: {
          jsonSchemaCredentialId: 'employee',
          claims: { name: 'Ada Lovelace', role: 'engineer' },
          ttlSeconds: 7776000,
          statusListId: 'list-1',
          statusListIndex: 42,
        },
      },
    },
  })
  @ApiCreatedResponse({ description: 'The credential offer', type: OpenId4VcCredentialOfferResponseDto })
  @ApiNotFoundResponse({ description: 'The agent cannot resolve the credential type or the status list' })
  public async createCredentialOffer(
    @Body() body: OpenId4VcCreateCredentialOfferBodyDto,
  ): Promise<OpenId4VcCredentialOfferResponseDto> {
    const offer = await this.issuerService.createOffer({
      jsonSchemaCredentialId: body.jsonSchemaCredentialId,
      claims: body.claims,
      ttlSeconds: body.ttlSeconds,
      statusListId: body.statusListId,
      statusListIndex: body.statusListIndex,
    })
    return { credentialExchangeId: offer.issuanceSessionId, url: offer.credentialOffer }
  }

  @Get('credential-exchanges')
  @ApiOperation({
    summary: 'List credential exchanges',
    description: 'Returns the OpenID4VCI issuance sessions that the agent tracks.',
  })
  @ApiOkResponse({
    description: 'A page of credential exchange records',
    type: OpenId4VcCredentialExchangeRecordPageDto,
  })
  public async listCredentialExchanges(
    @Query() query: OpenId4VcListCredentialExchangesQueryDto,
  ): Promise<Page<OpenId4VcCredentialExchangeRecordDto>> {
    const filters = {
      jsonSchemaCredentialId: query.jsonSchemaCredentialId,
      statusListId: query.statusListId,
      state: query.state,
    }
    const sessions = await this.issuerService.listIssuanceSessions(filters)

    const page = paginate(
      sessions,
      query,
      { method: 'openid4vc.listCredentialExchanges', filters },
      createdAtKey,
    )

    return mapPage(page, toCredentialExchangeDto)
  }

  @Get('credential-exchanges/:credentialExchangeId')
  @ApiOperation({
    summary: 'Get a credential exchange',
    description: 'Retrieves one issuance session by identifier.',
  })
  @ApiParam({
    name: 'credentialExchangeId',
    type: String,
    description: 'Identifier of the issuance session',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  @ApiOkResponse({
    description: 'The credential exchange record',
    type: OpenId4VcCredentialExchangeRecordDto,
  })
  @ApiNotFoundResponse({ description: 'No credential exchange with the given id' })
  public async getCredentialExchange(
    @Param('credentialExchangeId') credentialExchangeId: string,
  ): Promise<OpenId4VcCredentialExchangeRecordDto> {
    return toCredentialExchangeDto(await this.issuerService.getIssuanceSession(credentialExchangeId))
  }

  @Delete('credential-exchanges/:credentialExchangeId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a credential exchange',
    description: 'Deletes an issuance session record. It does not delete a credential that a wallet holds.',
  })
  @ApiParam({
    name: 'credentialExchangeId',
    type: String,
    description: 'Identifier of the issuance session',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  @ApiNoContentResponse({ description: 'The credential exchange record is deleted' })
  @ApiNotFoundResponse({ description: 'No credential exchange with the given id' })
  public async deleteCredentialExchange(
    @Param('credentialExchangeId') credentialExchangeId: string,
  ): Promise<void> {
    await this.issuerService.deleteIssuanceSession(credentialExchangeId)
  }
}
