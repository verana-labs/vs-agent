import type { AnonCredsCredentialMetadata } from '@credo-ts/anoncreds'
import type { DidCommCredentialExchangeRecord, DidCommCredentialStateChangedEvent } from '@credo-ts/didcomm'
import type { BaseAgentModules, VsAgent } from '@verana-labs/vs-agent-sdk'

import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Logger,
  Param,
  Post,
  Query,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common'
import { AnonCredsCredentialMetadataKey } from '@credo-ts/anoncreds'
import {
  DidCommAutoAcceptCredential,
  DidCommCredentialEventTypes,
  DidCommCredentialState,
} from '@credo-ts/didcomm'
import {
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger'
import { Claim } from '@verana-labs/vs-agent-model'
import { createInvitation } from '@verana-labs/vs-agent-sdk'

import { AdminApiError, AdminApiErrorCode, createdAtKey, Page, paginate } from '../../../../common'
import { AGENT_INVITATION_BASE_URL, AGENT_INVITATION_IMAGE_URL, TERMINAL_STATES } from '../../../../config'
import { UrlShorteningService } from '../../../../services/UrlShorteningService'
import { VsAgentService } from '../../../../services/VsAgentService'

import {
  CreateCredentialOfferBodyDto,
  CreateCredentialOfferResponseDto,
  CredentialExchangeRecordDto,
  CredentialExchangeRecordPageDto,
  DeclineExchangeBodyDto,
  ListCredentialExchangesQueryDto,
} from './dto'

/**
 * This controller has the credential exchanges of this agent on DIDComm.
 * Refer to [VSA-ADM-DC-CE].
 *
 * `createCredentialOffer` makes the Out-of-Band invitation. The invitation starts an issuance
 * flow. The accept methods run the protocol steps of that flow, as issuer or as holder, and the
 * read methods show the credential exchange record. The AnonCreds scope has the credential
 * definition and the revocation registry.
 */
@ApiTags('v2/didcomm')
@Controller({ path: 'didcomm', version: '2' })
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
export class V2DidcommCredentialExchangesController {
  private readonly logger = new Logger(V2DidcommCredentialExchangesController.name)

  public constructor(
    @Inject(VsAgentService) private readonly vsAgentService: VsAgentService,
    @Inject(UrlShorteningService) private readonly urlShortenerService: UrlShorteningService,
    @Inject('PUBLIC_API_BASE_URL') private readonly publicApiBaseUrl: string,
  ) {}

  @Post('credential-offer')
  @ApiOperation({
    summary: 'Create a credential offer',
    description:
      'Creates an AnonCreds credential offer invitation, with a preview of the offered claims. ' +
      'A revocable credential definition also needs `revocationRegistryDefinitionId` and ' +
      '`revocationRegistryIndex`.',
  })
  @ApiBody({
    type: CreateCredentialOfferBodyDto,
    examples: {
      phoneNumber: {
        summary: 'Phone Number VC',
        value: {
          credentialDefinitionId:
            'did:webvh:QmaZYZF4aaHUTWzaKu23TowgvsX7JWfCRgQZX488EAssPQ:dm.chatbot.demos.dev.2060.io/resources/zQmevazUUyXBhGoXJwJNNEqXgvPPQ5WrwTE8G5MdhfWsmxM',
          claims: [{ name: 'phoneNumber', value: '+57128348520' }],
        },
      },
      revocable: {
        summary: 'Revocable credential',
        value: {
          credentialDefinitionId:
            'did:webvh:QmaZYZF4aaHUTWzaKu23TowgvsX7JWfCRgQZX488EAssPQ:dm.chatbot.demos.dev.2060.io/resources/zQmevazUUyXBhGoXJwJNNEqXgvPPQ5WrwTE8G5MdhfWsmxM',
          claims: [{ name: 'phoneNumber', value: '+57128348520' }],
          revocationRegistryDefinitionId:
            'did:webvh:QmaZYZF4aaHUTWzaKu23TowgvsX7JWfCRgQZX488EAssPQ:dm.chatbot.demos.dev.2060.io/resources/zQmRDLcQ3jZvK4PfcDcf3sbvPzV4Ww5X7Sn2pzyHqUrZp2Z',
          revocationRegistryIndex: 1,
        },
      },
    },
  })
  @ApiCreatedResponse({
    description: 'The credential offer invitation',
    type: CreateCredentialOfferResponseDto,
  })
  @ApiNotFoundResponse({ description: 'No credential definition with the given id' })
  public async createCredentialOffer(
    @Body() body: CreateCredentialOfferBodyDto,
  ): Promise<CreateCredentialOfferResponseDto> {
    const agent = await this.vsAgentService.getAgent()

    const {
      credentialDefinitionId,
      claims,
      revocationRegistryDefinitionId,
      revocationRegistryIndex,
      useLegacyDid,
      didcommVersion,
    } = body
    const autoAccept = body.autoAccept ?? false

    const [record] = await agent.modules.anoncreds.getCreatedCredentialDefinitions({
      credentialDefinitionId,
    })
    if (!record) {
      throw new AdminApiError(
        AdminApiErrorCode.UnknownId,
        HttpStatus.NOT_FOUND,
        `no credential definition with id "${credentialDefinitionId}"`,
      )
    }

    const { schema } = await agent.modules.anoncreds.getSchema(record.credentialDefinition.schemaId)
    if (!schema) {
      throw new AdminApiError(
        AdminApiErrorCode.Internal,
        HttpStatus.INTERNAL_SERVER_ERROR,
        `no schema is known for "${record.credentialDefinition.schemaId}"`,
      )
    }

    const unknown = claims.filter(claim => !schema.attrNames.includes(claim.name))
    if (unknown.length) {
      throw invalidInput(
        `claims [${unknown.map(claim => claim.name).join(', ')}] are absent from schema "${schema.name}", which defines [${schema.attrNames.join(', ')}]`,
      )
    }

    // The specification says that a revocable credential definition needs the two revocation
    // fields.
    const revocable = record.credentialDefinition.value?.revocation !== undefined
    if (revocable && (!revocationRegistryDefinitionId || revocationRegistryIndex === undefined)) {
      throw invalidInput(
        'a revocable credential definition needs `revocationRegistryDefinitionId` and `revocationRegistryIndex`',
      )
    }

    // The specification makes the caller run the issuer steps, unless the caller sets
    // `autoAccept`. The exchange carries the policy, which the module default does not override.
    const offer = await agent.didcomm.credentials.createOffer({
      protocolVersion: 'v2',
      autoAcceptCredential: autoAccept
        ? DidCommAutoAcceptCredential.ContentApproved
        : DidCommAutoAcceptCredential.Never,
      credentialFormats: {
        anoncreds: {
          credentialDefinitionId,
          revocationRegistryDefinitionId,
          revocationRegistryIndex,
          attributes: claims.map(claim => ({
            name: claim.name,
            value: claim.value,
            mimeType: claim.mimeType,
          })),
        },
      },
    })

    const { url } = await createInvitation({
      agent,
      messages: [offer.message],
      useLegacyDid,
      didCommVersion: didcommVersion,
      invitationBaseUrl: AGENT_INVITATION_BASE_URL,
      imageUrl: AGENT_INVITATION_IMAGE_URL,
    })

    const shortUrlId = await this.urlShortenerService.createShortUrl({
      longUrl: url,
      relatedFlowId: offer.credentialExchangeRecord.id,
    })

    return {
      credentialExchangeId: offer.credentialExchangeRecord.id,
      url,
      shortUrl: `${this.publicApiBaseUrl}/s?id=${shortUrlId}`,
    }
  }

  @Post('credential-exchanges/:credentialExchangeId/decline')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Decline a credential exchange',
    description:
      'Refuses the pending step of a credential exchange, in either role. The agent sends a ' +
      'problem report to the peer and ends the exchange in state `declined`.',
  })
  @ApiParam({
    name: 'credentialExchangeId',
    type: String,
    description: 'Exchange identifier',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  @ApiBody({ type: DeclineExchangeBodyDto, required: false })
  @ApiOkResponse({
    description: 'The updated credential exchange record, in state `declined`',
    type: CredentialExchangeRecordDto,
  })
  @ApiNotFoundResponse({ description: 'No credential exchange with the given id' })
  @ApiConflictResponse({ description: 'The exchange is in a terminal state' })
  public async declineCredentialExchange(
    @Param('credentialExchangeId') credentialExchangeId: string,
    @Body() body: DeclineExchangeBodyDto,
  ): Promise<CredentialExchangeRecordDto> {
    const agent = await this.vsAgentService.getAgent()

    const record = await agent.didcomm.credentials.findById(credentialExchangeId)
    if (!record) throw unknownCredentialExchange(credentialExchangeId)

    if (TERMINAL_STATES.includes(record.state)) {
      throw new AdminApiError(
        AdminApiErrorCode.InvalidState,
        HttpStatus.CONFLICT,
        `credential exchange "${credentialExchangeId}" is in the terminal state "${record.state}"`,
      )
    }

    const description = body.reason ?? 'Offer declined'

    // Credo declines an offer that the agent receives. It sends the problem report and it sets
    // the state. Credo has no equivalent method for the step of the issuer.
    if (record.state === DidCommCredentialState.OfferReceived) {
      const declined = await agent.didcomm.credentials.declineOffer({
        credentialExchangeRecordId: credentialExchangeId,
        sendProblemReport: true,
        problemReportDescription: description,
      })
      return this.toRecordDto(agent, declined)
    }

    // Credo sends no problem report when the exchange has no connection. An invitation makes
    // such an exchange. The exchange ends in `declined`, because the caller refuses it, and the
    // record keeps the reason when the peer gets no report.
    let undelivered: string | undefined
    try {
      await agent.didcomm.credentials.sendProblemReport({
        credentialExchangeRecordId: credentialExchangeId,
        description,
      })
    } catch (error) {
      undelivered = `the agent declined the exchange but could not notify the peer: ${error}`
      this.logger.warn(`Credential exchange ${credentialExchangeId}: ${undelivered}`)
    }

    // `update` writes the record but it sends no event. The agent emits the state change for
    // the Events API.
    const previousState = record.state
    record.state = DidCommCredentialState.Declined
    if (undelivered) record.errorMessage = undelivered
    await agent.didcomm.credentials.update(record)

    agent.events.emit<DidCommCredentialStateChangedEvent>(agent.context, {
      type: DidCommCredentialEventTypes.DidCommCredentialStateChanged,
      payload: { credentialExchangeRecord: record.clone(), previousState },
    })

    return this.toRecordDto(agent, record)
  }

  @Post('credential-exchanges/:credentialExchangeId/accept-offer')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Accept a credential offer',
    description: 'Accepts a credential offer that a peer sent to this agent, and requests the credential.',
  })
  @ApiParam({
    name: 'credentialExchangeId',
    type: String,
    description: 'Exchange identifier',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  @ApiOkResponse({ description: 'The updated credential exchange record', type: CredentialExchangeRecordDto })
  @ApiNotFoundResponse({ description: 'No credential exchange with the given id' })
  @ApiConflictResponse({ description: 'The exchange is not in state `offer-received`' })
  public async acceptCredentialOffer(
    @Param('credentialExchangeId') credentialExchangeId: string,
  ): Promise<CredentialExchangeRecordDto> {
    const agent = await this.vsAgentService.getAgent()

    const record = await agent.didcomm.credentials.findById(credentialExchangeId)
    if (!record) throw unknownCredentialExchange(credentialExchangeId)

    requireCredentialState(record, DidCommCredentialState.OfferReceived)

    // The specification makes the caller store the credential with `acceptCredential`, so the
    // exchange stops here until that call arrives.
    const updated = await agent.didcomm.credentials.acceptOffer({
      credentialExchangeRecordId: credentialExchangeId,
      autoAcceptCredential: DidCommAutoAcceptCredential.Never,
    })

    return this.toRecordDto(agent, updated)
  }

  @Post('credential-exchanges/:credentialExchangeId/accept-request')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Accept a credential request',
    description:
      'Accepts a credential request as issuer, and issues the credential. The agent issues the ' +
      'claims that the offer previewed. A caller that wants other claims declines this exchange ' +
      'and starts a new offer.',
  })
  @ApiParam({
    name: 'credentialExchangeId',
    type: String,
    description: 'Exchange identifier',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  @ApiOkResponse({ description: 'The updated credential exchange record', type: CredentialExchangeRecordDto })
  @ApiNotFoundResponse({ description: 'No credential exchange with the given id' })
  @ApiConflictResponse({ description: 'The exchange is not in state `request-received`' })
  public async acceptCredentialRequest(
    @Param('credentialExchangeId') credentialExchangeId: string,
  ): Promise<CredentialExchangeRecordDto> {
    const agent = await this.vsAgentService.getAgent()

    const record = await agent.didcomm.credentials.findById(credentialExchangeId)
    if (!record) throw unknownCredentialExchange(credentialExchangeId)

    requireCredentialState(record, DidCommCredentialState.RequestReceived)

    const updated = await agent.didcomm.credentials.acceptRequest({
      credentialExchangeRecordId: credentialExchangeId,
    })

    return this.toRecordDto(agent, updated)
  }

  @Post('credential-exchanges/:credentialExchangeId/accept-credential')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Accept a credential',
    description:
      'Accepts a received credential as holder: the agent stores the credential in its credential ' +
      'store and acknowledges it to the issuer.',
  })
  @ApiParam({
    name: 'credentialExchangeId',
    type: String,
    description: 'Exchange identifier',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  @ApiOkResponse({
    description: 'The updated credential exchange record, in state `done`',
    type: CredentialExchangeRecordDto,
  })
  @ApiNotFoundResponse({ description: 'No credential exchange with the given id' })
  @ApiConflictResponse({ description: 'The exchange is not in state `credential-received`' })
  public async acceptCredential(
    @Param('credentialExchangeId') credentialExchangeId: string,
  ): Promise<CredentialExchangeRecordDto> {
    const agent = await this.vsAgentService.getAgent()

    const record = await agent.didcomm.credentials.findById(credentialExchangeId)
    if (!record) throw unknownCredentialExchange(credentialExchangeId)

    requireCredentialState(record, DidCommCredentialState.CredentialReceived)

    const updated = await agent.didcomm.credentials.acceptCredential({
      credentialExchangeRecordId: credentialExchangeId,
    })

    return this.toRecordDto(agent, updated)
  }

  @Get('credential-exchanges')
  @ApiOperation({
    summary: 'List credential exchanges',
    description: 'Returns the credential exchange records that the agent tracks.',
  })
  @ApiOkResponse({
    description: 'A page of credential exchange records',
    type: CredentialExchangeRecordPageDto,
  })
  public async listCredentialExchanges(
    @Query() query: ListCredentialExchangesQueryDto,
  ): Promise<Page<CredentialExchangeRecordDto>> {
    const agent = await this.vsAgentService.getAgent()

    const records = await agent.didcomm.credentials.getAll()

    const page = paginate(records, query, { method: 'listCredentialExchanges' }, createdAtKey)

    const results = await Promise.allSettled(page.items.map(record => this.toRecordDto(agent, record)))

    // The agent removes a record that it cannot read, which leaves the page short of the limit.
    // The cursor still anchors on the last record of the page, so the walk stays correct.
    const items = results.flatMap((result, index) => {
      if (result.status === 'fulfilled') return [result.value]
      this.logger.warn(`The agent skips credential exchange ${page.items[index].id}: ${result.reason}`)
      return []
    })

    return { items, nextCursor: page.nextCursor }
  }

  @Get('credential-exchanges/:credentialExchangeId')
  @ApiOperation({
    summary: 'Get a credential exchange',
    description: 'Retrieves one credential exchange record by identifier.',
  })
  @ApiParam({
    name: 'credentialExchangeId',
    type: String,
    description: 'Exchange identifier',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  @ApiOkResponse({ description: 'The credential exchange record', type: CredentialExchangeRecordDto })
  @ApiNotFoundResponse({ description: 'No credential exchange with the given id' })
  public async getCredentialExchange(
    @Param('credentialExchangeId') credentialExchangeId: string,
  ): Promise<CredentialExchangeRecordDto> {
    const agent = await this.vsAgentService.getAgent()

    const record = await agent.didcomm.credentials.findById(credentialExchangeId)
    if (!record) throw unknownCredentialExchange(credentialExchangeId)

    return this.toRecordDto(agent, record)
  }

  private async toRecordDto(
    agent: VsAgent<BaseAgentModules>,
    record: DidCommCredentialExchangeRecord,
  ): Promise<CredentialExchangeRecordDto> {
    const anonCredsMetadata = record.metadata.get(AnonCredsCredentialMetadataKey) as
      | AnonCredsCredentialMetadata
      | undefined

    let claims: Claim[] = []
    try {
      const formatData = await agent.didcomm.credentials.getFormatData(record.id)
      if (formatData.offerAttributes?.length) {
        claims = formatData.offerAttributes.map(
          attribute =>
            new Claim({ name: attribute.name, value: attribute.value, mimeType: attribute.mimeType }),
        )
      }
    } catch (error) {
      this.logger.debug(`The agent cannot read the offer of ${record.id}: ${error}`)
    }

    return {
      credentialExchangeId: record.id,
      state: record.state,
      threadId: record.threadId,
      connectionId: record.connectionId,
      credentialDefinitionId: anonCredsMetadata?.credentialDefinitionId,
      schemaId: anonCredsMetadata?.schemaId,
      claims,
      errorMessage: record.errorMessage,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt ?? record.createdAt,
    }
  }
}

function invalidInput(message: string): AdminApiError {
  return new AdminApiError(AdminApiErrorCode.InvalidInput, HttpStatus.BAD_REQUEST, message)
}

function unknownCredentialExchange(credentialExchangeId: string): AdminApiError {
  return new AdminApiError(
    AdminApiErrorCode.UnknownId,
    HttpStatus.NOT_FOUND,
    `no credential exchange with id "${credentialExchangeId}"`,
  )
}

/**
 * This function checks the state of an exchange before the agent runs a protocol step. Each
 * method of the specification names one state that it accepts.
 */
function requireCredentialState(
  record: DidCommCredentialExchangeRecord,
  expected: DidCommCredentialState,
): void {
  if (record.state === expected) return

  throw new AdminApiError(
    AdminApiErrorCode.InvalidState,
    HttpStatus.CONFLICT,
    `credential exchange "${record.id}" is in state "${record.state}", not "${expected}"`,
  )
}
