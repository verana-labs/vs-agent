import type { AnonCredsProofRequestRestriction, AnonCredsRequestedAttribute } from '@credo-ts/anoncreds'
import type { DidCommProofExchangeRecord, DidCommProofStateChangedEvent } from '@credo-ts/didcomm'

import { AnonCredsNonRevokedInterval, AnonCredsSchema, dateToTimestamp } from '@credo-ts/anoncreds'
import { DidCommAutoAcceptProof, DidCommProofEventTypes, DidCommProofState } from '@credo-ts/didcomm'
import { RecordNotFoundError, W3cCredential } from '@credo-ts/core'
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Logger,
  Param,
  Post,
  Query,
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
import { createInvitation, fetchJson } from '@verana-labs/vs-agent-sdk'

import {
  AdminApiError,
  AdminApiErrorCode,
  createdAtKey,
  mapPageAsync,
  Page,
  paginate,
} from '../../../../common'
import { AGENT_INVITATION_BASE_URL, AGENT_INVITATION_IMAGE_URL, TERMINAL_STATES } from '../../../../config'
import { UrlShorteningService } from '../../../../services/UrlShorteningService'
import { VsAgentService } from '../../../../services/VsAgentService'
import { CredentialTypesService } from '../../credentials'

import {
  CreatePresentationRequestBodyDto,
  CreatePresentationRequestResponseDto,
  DeclineExchangeBodyDto,
  ListPresentationsQueryDto,
  PresentationRecordDto,
  PresentationRecordPageDto,
  RequestedCredentialDto,
} from './dto'
import { REQUESTED_CREDENTIALS_METADATA, toPresentationDto } from './mappers'

/**
 * Presentation flows this agent requested over DIDComm.
 *
 * `createPresentationRequest` mints the Out-of-Band invitation that starts a flow; the accept
 * methods run the protocol steps of that flow, as verifier or as prover, and the remaining
 * methods read and delete the proof exchange record that the flow leaves behind.
 */
@ApiTags('v2/didcomm')
@Controller({ path: 'didcomm', version: '2' })
export class V2DidcommPresentationsController {
  private readonly logger = new Logger(V2DidcommPresentationsController.name)

  public constructor(
    @Inject(VsAgentService) private readonly vsAgentService: VsAgentService,
    @Inject(UrlShorteningService) private readonly urlShortenerService: UrlShorteningService,
    @Inject(CredentialTypesService) private readonly credentialTypesService: CredentialTypesService,
    @Inject('PUBLIC_API_BASE_URL') private readonly publicApiBaseUrl: string,
  ) {}

  @Post('presentation-request')
  @ApiOperation({
    summary: 'Create a presentation request',
    description:
      'Creates a Presentation Request invitation. The body names the credentials, and the attributes ' +
      'of them, that the holder is asked to present. An entry that omits `attributes` asks for every ' +
      'attribute the schema defines.',
  })
  @ApiBody({
    type: CreatePresentationRequestBodyDto,
    examples: {
      byCredentialDefinition: {
        summary: 'By credentialDefinitionId',
        value: {
          requestedCredentials: [
            {
              credentialDefinitionId:
                'did:webvh:QmaZYZF4aaHUTWzaKu23TowgvsX7JWfCRgQZX488EAssPQ:dm.chatbot.demos.dev.2060.io/resources/zQmevazUUyXBhGoXJwJNNEqXgvPPQ5WrwTE8G5MdhfWsmxM',
              attributes: ['phoneNumber'],
            },
          ],
          requireNonRevocation: false,
        },
      },
      byJsonSchemaCredential: {
        summary: 'By jsonSchemaCredentialId, every attribute',
        value: {
          requestedCredentials: [
            { jsonSchemaCredentialId: 'https://dm.gov-id-tr.demos.dev.2060.io/vt/schemas-gov-id-jsc.json' },
          ],
        },
      },
    },
  })
  @ApiCreatedResponse({
    description: 'The presentation request invitation',
    type: CreatePresentationRequestResponseDto,
  })
  public async createPresentationRequest(
    @Body() body: CreatePresentationRequestBodyDto,
  ): Promise<CreatePresentationRequestResponseDto> {
    const agent = await this.vsAgentService.getAgent()

    const { requestedCredentials, useLegacyDid, didcommVersion } = body
    const requireNonRevocation = body.requireNonRevocation ?? false
    const autoAccept = body.autoAccept ?? false

    if (!requestedCredentials?.length) {
      throw invalidInput('`requestedCredentials` must name at least one credential')
    }

    // One requested-attribute group per entry, so a request may span several credentials. Groups are
    // keyed by schema name, suffixed when two entries resolve to schemas that share a name.
    const requestedAttributes: Record<string, AnonCredsRequestedAttribute> = {}
    for (const entry of requestedCredentials) {
      const { schema, restrictions } = await this.resolve(entry)
      const attributes = entry.attributes ?? schema.attrNames

      const unknown = attributes.filter(attribute => !schema.attrNames.includes(attribute))
      if (unknown.length) {
        throw invalidInput(
          `attributes [${unknown.join(', ')}] are absent from schema "${schema.name}", which defines [${schema.attrNames.join(', ')}]`,
        )
      }

      requestedAttributes[uniqueKey(requestedAttributes, schema.name)] = { names: attributes, restrictions }
    }

    let nonRevoked: AnonCredsNonRevokedInterval | undefined
    if (requireNonRevocation) {
      const now = dateToTimestamp(new Date())
      nonRevoked = { from: now, to: now }
    }

    // The specification makes the caller run the verifier steps, unless the caller sets
    // `autoAccept`. The exchange carries the policy, which the module default does not override.
    const request = await agent.didcomm.proofs.createRequest({
      protocolVersion: 'v2',
      autoAcceptProof: autoAccept ? DidCommAutoAcceptProof.ContentApproved : DidCommAutoAcceptProof.Never,
      proofFormats: {
        anoncreds: {
          name: 'proof-request',
          version: '1.0',
          requested_attributes: requestedAttributes,
          non_revoked: nonRevoked,
        },
      },
    })

    request.proofRecord.metadata.set(REQUESTED_CREDENTIALS_METADATA, requestedCredentials)
    await agent.didcomm.proofs.update(request.proofRecord)

    const { url } = await createInvitation({
      agent,
      messages: [request.message],
      useLegacyDid,
      didCommVersion: didcommVersion,
      invitationBaseUrl: AGENT_INVITATION_BASE_URL,
      imageUrl: AGENT_INVITATION_IMAGE_URL,
    })

    const shortUrlId = await this.urlShortenerService.createShortUrl({
      longUrl: url,
      relatedFlowId: request.proofRecord.id,
    })

    return {
      proofExchangeId: request.proofRecord.id,
      url,
      shortUrl: `${this.publicApiBaseUrl}/s?id=${shortUrlId}`,
    }
  }

  @Post('presentations/:proofExchangeId/accept-request')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Accept a presentation request',
    description:
      'Accepts a presentation request that a peer sent to this agent, and presents the matching ' +
      'credentials from the credential store of the agent. The agent selects the credentials.',
  })
  @ApiParam({
    name: 'proofExchangeId',
    type: String,
    description: 'Presentation flow identifier',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  @ApiOkResponse({ description: 'The updated presentation record', type: PresentationRecordDto })
  @ApiNotFoundResponse({ description: 'No presentation with the given id' })
  @ApiConflictResponse({
    description:
      'The exchange is not in state `request-received`, or no credential set satisfies the request',
  })
  public async acceptPresentationRequest(
    @Param('proofExchangeId') proofExchangeId: string,
  ): Promise<PresentationRecordDto> {
    const agent = await this.vsAgentService.getAgent()

    const record = await agent.didcomm.proofs.findById(proofExchangeId)
    if (!record) throw unknownPresentation(proofExchangeId)

    requireProofState(record, DidCommProofState.RequestReceived)

    // `getCredentialsForRequest` returns the matches of each group of the request, and an empty
    // group shows that the credential store cannot answer that group. The agent asks first
    // because `acceptRequest`, which makes the selection itself, throws on an empty group.
    const { proofFormats } = await agent.didcomm.proofs.getCredentialsForRequest({
      proofExchangeRecordId: proofExchangeId,
    })
    const candidates = proofFormats.anoncreds ?? proofFormats.indy

    if (!candidates) {
      throw noCompatibleCredentials('the request asks for a format that this agent cannot present')
    }

    const missing = [...Object.entries(candidates.attributes), ...Object.entries(candidates.predicates)]
      .filter(([, matches]) => !matches.length)
      .map(([name]) => name)

    if (missing.length) {
      throw noCompatibleCredentials(
        `the credential store holds no credential that satisfies [${missing.join(', ')}]`,
      )
    }

    // The agent selects the credentials itself, so `acceptRequest` gets no `proofFormats`.
    const updated = await agent.didcomm.proofs.acceptRequest({
      proofExchangeRecordId: proofExchangeId,
    })

    return toPresentationDto(agent, updated)
  }

  @Post('presentations/:proofExchangeId/accept-presentation')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Accept a presentation',
    description:
      'Acknowledges a received presentation as verifier, and completes the exchange. This method ' +
      'does not change the verification result: the agent verified the presentation when it ' +
      'received it, and stored the result in `verified`.',
  })
  @ApiParam({
    name: 'proofExchangeId',
    type: String,
    description: 'Presentation flow identifier',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  @ApiOkResponse({
    description: 'The updated presentation record, in state `done`',
    type: PresentationRecordDto,
  })
  @ApiNotFoundResponse({ description: 'No presentation with the given id' })
  @ApiConflictResponse({ description: 'The exchange is not in state `presentation-received`' })
  public async acceptPresentation(
    @Param('proofExchangeId') proofExchangeId: string,
  ): Promise<PresentationRecordDto> {
    const agent = await this.vsAgentService.getAgent()

    const record = await agent.didcomm.proofs.findById(proofExchangeId)
    if (!record) throw unknownPresentation(proofExchangeId)

    requireProofState(record, DidCommProofState.PresentationReceived)

    const updated = await agent.didcomm.proofs.acceptPresentation({
      proofExchangeRecordId: proofExchangeId,
    })

    return toPresentationDto(agent, updated)
  }

  @Get('presentations')
  @ApiOperation({
    summary: 'List presentations',
    description: 'Returns the presentation flows that the agent created.',
  })
  @ApiOkResponse({ description: 'A page of presentation records', type: PresentationRecordPageDto })
  public async listPresentations(
    @Query() query: ListPresentationsQueryDto,
  ): Promise<Page<PresentationRecordDto>> {
    const agent = await this.vsAgentService.getAgent()

    const records = await agent.didcomm.proofs.getAll()

    const page = paginate(records, query, { method: 'listPresentations' }, createdAtKey)

    return mapPageAsync(page, record => toPresentationDto(agent, record))
  }

  @Get('presentations/:proofExchangeId')
  @ApiOperation({
    summary: 'Get a presentation',
    description: 'Retrieves one presentation by `proofExchangeId`.',
  })
  @ApiParam({
    name: 'proofExchangeId',
    type: String,
    description: 'Presentation flow identifier',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  @ApiOkResponse({ description: 'The presentation record', type: PresentationRecordDto })
  @ApiNotFoundResponse({ description: 'No presentation with the given id' })
  public async getPresentation(
    @Param('proofExchangeId') proofExchangeId: string,
  ): Promise<PresentationRecordDto> {
    const agent = await this.vsAgentService.getAgent()

    const record = await agent.didcomm.proofs.findById(proofExchangeId)
    if (!record) throw unknownPresentation(proofExchangeId)

    return toPresentationDto(agent, record)
  }

  @Post('presentations/:proofExchangeId/decline')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Decline a presentation exchange',
    description:
      'Refuses the pending step of a presentation exchange, in either role. The agent sends a ' +
      'problem report to the peer and ends the exchange in state `declined`.',
  })
  @ApiParam({
    name: 'proofExchangeId',
    type: String,
    description: 'Presentation flow identifier',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  @ApiBody({ type: DeclineExchangeBodyDto, required: false })
  @ApiOkResponse({
    description: 'The updated presentation record, in state `declined`',
    type: PresentationRecordDto,
  })
  @ApiNotFoundResponse({ description: 'No presentation with the given id' })
  @ApiConflictResponse({ description: 'The exchange is in a terminal state' })
  public async declinePresentationExchange(
    @Param('proofExchangeId') proofExchangeId: string,
    @Body() body: DeclineExchangeBodyDto,
  ): Promise<PresentationRecordDto> {
    const agent = await this.vsAgentService.getAgent()

    const record = await agent.didcomm.proofs.findById(proofExchangeId)
    if (!record) throw unknownPresentation(proofExchangeId)

    if (TERMINAL_STATES.includes(record.state)) {
      throw new AdminApiError(
        AdminApiErrorCode.InvalidState,
        HttpStatus.CONFLICT,
        `presentation "${proofExchangeId}" is in the terminal state "${record.state}"`,
      )
    }

    const description = body.reason ?? 'Request declined'

    // Credo declines a request that the agent receives. It sends the problem report and it sets
    // the state. Credo has no equivalent method for the step of the verifier.
    if (record.state === DidCommProofState.RequestReceived) {
      const declined = await agent.didcomm.proofs.declineRequest({
        proofExchangeRecordId: proofExchangeId,
        sendProblemReport: true,
        problemReportDescription: description,
      })
      return toPresentationDto(agent, declined)
    }

    // Credo sends no problem report when the exchange has no connection. An invitation makes
    // such an exchange. The exchange ends in `declined`, because the caller refuses it, and the
    // record keeps the reason when the peer gets no report.
    let undelivered: string | undefined
    try {
      await agent.didcomm.proofs.sendProblemReport({ proofExchangeRecordId: proofExchangeId, description })
    } catch (error) {
      undelivered = `the agent declined the exchange but could not notify the peer: ${error}`
      this.logger.warn(`Presentation ${proofExchangeId}: ${undelivered}`)
    }

    // `update` writes the record but it sends no event. The agent emits the state change for
    // the Events API.
    const previousState = record.state
    record.state = DidCommProofState.Declined
    if (undelivered) record.errorMessage = undelivered
    await agent.didcomm.proofs.update(record)

    agent.events.emit<DidCommProofStateChangedEvent>(agent.context, {
      type: DidCommProofEventTypes.ProofStateChanged,
      payload: { proofRecord: record.clone(), previousState },
    })

    return toPresentationDto(agent, record)
  }

  @Delete('presentations/:proofExchangeId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a presentation',
    description: 'Deletes a presentation exchange record, along with the DIDComm messages it accumulated.',
  })
  @ApiParam({
    name: 'proofExchangeId',
    type: String,
    description: 'Presentation flow identifier',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  @ApiNoContentResponse({ description: 'The presentation record is deleted' })
  @ApiNotFoundResponse({ description: 'No presentation with the given id' })
  public async deletePresentation(@Param('proofExchangeId') proofExchangeId: string): Promise<void> {
    const agent = await this.vsAgentService.getAgent()

    try {
      await agent.didcomm.proofs.deleteById(proofExchangeId, { deleteAssociatedDidCommMessages: true })
    } catch (error) {
      if (error instanceof RecordNotFoundError) throw unknownPresentation(proofExchangeId)
      throw error
    }
  }

  /**
   * Resolves one requested-credential entry to the AnonCreds schema it asks for, and to the
   * restriction that pins a presentation to that credential.
   */
  private async resolve(
    entry: RequestedCredentialDto,
  ): Promise<{ schema: AnonCredsSchema; restrictions: AnonCredsProofRequestRestriction[] }> {
    const { credentialDefinitionId, jsonSchemaCredentialId } = entry

    if (credentialDefinitionId && jsonSchemaCredentialId) {
      throw invalidInput('specify either `credentialDefinitionId` or `jsonSchemaCredentialId`, not both')
    }

    if (jsonSchemaCredentialId) {
      const jsc = await fetchJson<W3cCredential>(jsonSchemaCredentialId)
      const issuerDid = typeof jsc.issuer === 'string' ? jsc.issuer : jsc.issuer.id

      const resolved = await this.credentialTypesService.findAnonCredsSchema({
        relatedJsonSchemaCredentialId: jsonSchemaCredentialId,
        issuerDid,
      })
      if (!resolved) {
        throw invalidInput(`no schema is known for jsonSchemaCredentialId "${jsonSchemaCredentialId}"`)
      }

      return { schema: resolved.schema, restrictions: [{ schema_id: resolved.schemaId }] }
    }

    if (!credentialDefinitionId) {
      throw invalidInput(
        'each requested credential needs a `credentialDefinitionId` or a `jsonSchemaCredentialId`',
      )
    }

    const agent = await this.vsAgentService.getAgent()

    const { credentialDefinition } =
      await agent.modules.anoncreds.getCredentialDefinition(credentialDefinitionId)
    if (!credentialDefinition) {
      throw invalidInput(`no credential definition is known for "${credentialDefinitionId}"`)
    }

    const { schema } = await agent.modules.anoncreds.getSchema(credentialDefinition.schemaId)
    if (!schema) {
      throw invalidInput(`no schema is known for "${credentialDefinition.schemaId}"`)
    }

    return { schema, restrictions: [{ cred_def_id: credentialDefinitionId }] }
  }
}

function uniqueKey(taken: Record<string, unknown>, name: string): string {
  if (!(name in taken)) return name

  let suffix = 2
  while (`${name}-${suffix}` in taken) suffix++
  return `${name}-${suffix}`
}

function invalidInput(message: string): AdminApiError {
  return new AdminApiError(AdminApiErrorCode.InvalidInput, HttpStatus.BAD_REQUEST, message)
}

/**
 * This function checks the state of an exchange before the agent runs a protocol step. Each
 * method of the specification names one state that it accepts.
 */
function requireProofState(record: DidCommProofExchangeRecord, expected: DidCommProofState): void {
  if (record.state === expected) return

  throw new AdminApiError(
    AdminApiErrorCode.InvalidState,
    HttpStatus.CONFLICT,
    `presentation "${record.id}" is in state "${record.state}", not "${expected}"`,
  )
}

function noCompatibleCredentials(message: string): AdminApiError {
  return new AdminApiError(AdminApiErrorCode.NoCompatibleCredentials, HttpStatus.CONFLICT, message)
}

function unknownPresentation(proofExchangeId: string): AdminApiError {
  return new AdminApiError(
    AdminApiErrorCode.UnknownId,
    HttpStatus.NOT_FOUND,
    `no presentation with id "${proofExchangeId}"`,
  )
}
