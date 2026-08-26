import type { AnonCredsProofRequestRestriction, AnonCredsRequestedAttribute } from '@credo-ts/anoncreds'
import type { DidCommProofExchangeRecord } from '@credo-ts/didcomm'

import { AnonCredsNonRevokedInterval, AnonCredsSchema, dateToTimestamp } from '@credo-ts/anoncreds'
import { RecordNotFoundError, W3cCredential } from '@credo-ts/core'
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
import { Claim, RequestedCredential } from '@verana-labs/vs-agent-model'
import { createInvitation, fetchJson } from '@verana-labs/vs-agent-sdk'

import { AdminApiError, AdminApiErrorCode, Page, paginate } from '../../../../common'
import { AGENT_INVITATION_BASE_URL, AGENT_INVITATION_IMAGE_URL } from '../../../../config'
import { AccessMode } from '../../../../security'
import { UrlShorteningService } from '../../../../services/UrlShorteningService'
import { VsAgentService } from '../../../../services/VsAgentService'
import { CredentialTypesService } from '../../credentials'

import {
  CreatePresentationRequestBodyDto,
  CreatePresentationRequestResponseDto,
  ListPresentationsQueryDto,
  PresentationRecordDto,
  PresentationRecordPageDto,
  RequestedCredentialDto,
} from './dto'

const REQUESTED_CREDENTIALS_METADATA = '_2060/requestedCredentials'
const CALLBACK_METADATA = '_2060/callbackParameters'

/**
 * Presentation flows this agent requested over DIDComm.
 *
 * `createPresentationRequest` mints the Out-of-Band invitation that starts a flow; the remaining
 * methods read and delete the proof exchange record that the flow leaves behind.
 */
@ApiTags('v2/didcomm')
@AccessMode('INTERNAL')
@Controller({ path: 'didcomm', version: '2' })
export class V2DidcommPresentationsController {
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
          ref: '1234-5678',
          callbackUrl: 'https://myhost.com/presentation_callback',
          requestedCredentials: [
            {
              credentialDefinitionId:
                'did:web:chatbot-demo.dev.2060.io?service=anoncreds&relativeRef=/credDef/8TsGLaSPVKPVMXK8APzBRcXZryxutvQuZnnTcDmbqd9p',
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

    const { requestedCredentials, ref, callbackUrl, useLegacyDid, didcommVersion } = body
    const requireNonRevocation = body.requireNonRevocation ?? false

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

    const request = await agent.didcomm.proofs.createRequest({
      protocolVersion: 'v2',
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
    request.proofRecord.metadata.set(CALLBACK_METADATA, { ref, callbackUrl })
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
    const items = await Promise.all(records.map(record => this.toPresentationDto(record)))

    return paginate(
      items,
      query,
      { method: 'listPresentations' },
      presentation => `${presentation.createdAt.toISOString()}|${presentation.proofExchangeId}`,
    )
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

    return this.toPresentationDto(record)
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

  private async toPresentationDto(record: DidCommProofExchangeRecord): Promise<PresentationRecordDto> {
    const agent = await this.vsAgentService.getAgent()
    const formatData = await agent.didcomm.proofs.getFormatData(record.id)

    const proof = formatData.presentation?.anoncreds ?? formatData.presentation?.indy
    const claims: Claim[] = []

    for (const [name, value] of Object.entries(proof?.requested_proof.revealed_attrs ?? {})) {
      claims.push(new Claim({ name, value: value.raw }))
    }

    for (const group of Object.values(proof?.requested_proof.revealed_attr_groups ?? {})) {
      for (const [name, value] of Object.entries(group?.values ?? {})) {
        claims.push(new Claim({ name, value: value.raw }))
      }
    }

    return {
      proofExchangeId: record.id,
      state: record.state,
      requestedCredentials:
        (record.metadata.get(REQUESTED_CREDENTIALS_METADATA) as RequestedCredential[] | null) ?? [],
      claims,
      verified: record.isVerified ?? false,
      threadId: record.threadId,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt ?? record.createdAt,
    }
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

function unknownPresentation(proofExchangeId: string): AdminApiError {
  return new AdminApiError(
    AdminApiErrorCode.UnknownId,
    HttpStatus.NOT_FOUND,
    `no presentation with id "${proofExchangeId}"`,
  )
}
