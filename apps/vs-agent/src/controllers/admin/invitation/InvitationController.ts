import { AnonCredsRequestedAttribute } from '@credo-ts/anoncreds'
import { Controller, Get, Post, Body, Query, Inject } from '@nestjs/common'
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger'
import {
  CreateCredentialOfferResult,
  CreatePresentationRequestResult,
  CreateInvitationResult,
} from '@verana-labs/vs-agent-model'

import { UrlShorteningService } from '../../../services/UrlShorteningService'
import { VsAgentService } from '../../../services/VsAgentService'
import { createInvitation } from '../../../utils'

import { CreateCredentialOfferDto, CreatePresentationRequestDto } from './InvitationDto'

@ApiTags('invitation')
@Controller({
  path: 'invitation',
  version: '1',
})
export class InvitationController {
  constructor(
    private readonly agentService: VsAgentService,
    private readonly urlShortenerService: UrlShorteningService,
    @Inject('PUBLIC_API_BASE_URL') private readonly publicApiBaseUrl: string,
  ) {}

  @Get('/')
  @ApiOperation({
    summary: 'Connection Invitation',
    description:
      '### Connection Invitation\n\nIt\'s a GET request to `/invitation`. It does not receive any parameter.\n\nResponse from VS Agent is a JSON object containing an URL-encoded invitation, ready to be rendered in a QR code or sent as a link for processing of an Aries-compatible DIDComm agent:\n\n```json\n{\n  "url": "string containing long form URL-encoded invitation"\n}\n```',
  })
  @ApiOkResponse({
    description: 'Out-of-band invitation payload',
    schema: {
      example: {
        url: 'https://hologram.zone/?oob=eyJ0eXAiOiJKV1QiLCJhbGci...',
      },
    },
  })
  @ApiQuery({ name: 'legacy', required: false, type: Boolean })
  public async getInvitation(@Query('legacy') useLegacyDid?: boolean): Promise<CreateInvitationResult> {
    return await createInvitation({ agent: await this.agentService.getAgent(), useLegacyDid })
  }

  @Post('/presentation-request')
  @ApiOperation({
    summary: 'Presentation Request',
    description: [
      '### Presentation Request\n\nPresentation Request invitation codes are created by specifying details of the credentials required.\n\nThis means that a single presentation request can ask for a number of attributes present in a credential a holder might possess.\nAt the moment, credential requirements are only filtered by their `credentialDefinitionId`. If no `attributes` are specified,\nthen VS Agent will ask for all attributes in the credential.\n\nIt\'s a POST to `/invitation/presentation-request` which receives a JSON object in the body\n\n```json\n{\n  "callbackUrl": "https://myhost.com/presentation_callback ",\n  "ref": "1234-5678",\n  "requestedCredentials": [\n    {\n      "credentialDefinitionId": "full credential definition identifier",\n      "attributes": ["attribute-1", "attribute-2"]\n    }\n  ]\n}\n```',
      '#### Presentation Callback API\n\nWhen the presentation flow is completed (either successfully or not), VS Agent calls its `callbackUrl` as an HTTP POST with the following body:\n\n```json\n{\n  "ref": "1234-5678",\n  "presentationRequestId": "unique identifier for the flow",\n  "status": "PresentationStatus",\n  "claims": [\n    { "name": "attribute-1", "value": "value-1" },\n    { "name": "attribute-2", "value": "value-2" }\n  ]\n}\n```',
    ].join('\n\n'),
  })
  @ApiBody({
    type: CreatePresentationRequestDto,
    examples: {
      example: {
        summary: 'Create Presentation Request',
        value: {
          ref: '1234-5678',
          callbackUrl: 'https://myhost/mycallbackurl',
          requestedCredentials: [
            {
              credentialDefinitionId:
                'did:web:chatbot-demo.dev.2060.io?service=anoncreds&relativeRef=/credDef/8TsGLaSPVKPVMXK8APzBRcXZryxutvQuZnnTcDmbqd9p',
              attributes: ['phoneNumber'],
            },
          ],
        },
      },
    },
  })
  @ApiOkResponse({
    description: 'Presentation request invitation',
    schema: {
      example: {
        proofExchangeId: '123e4567-e89b-12d3-a456-426614174000',
        url: 'didcomm://example.com/...',
        shortUrl: `https://mydomain.com/s?id=abcd1234`,
      },
    },
  })
  public async createPresentationRequest(
    @Body() options: CreatePresentationRequestDto,
  ): Promise<CreatePresentationRequestResult> {
    const agent = await this.agentService.getAgent()

    const { requestedCredentials, ref, callbackUrl, useLegacyDid } = options

    if (!requestedCredentials?.length) {
      throw Error('You must specify a least a requested credential')
    }
    const credentialDefinitionId = requestedCredentials[0].credentialDefinitionId
    let attributes = requestedCredentials[0].attributes

    if (!credentialDefinitionId) {
      throw Error('Verifiable credential request must include credentialDefinitionId')
    }

    if (attributes && !Array.isArray(attributes)) {
      throw new Error('Received attributes is not an array')
    }

    const { credentialDefinition } =
      await agent.modules.anoncreds.getCredentialDefinition(credentialDefinitionId)

    if (!credentialDefinition) {
      throw Error(`Cannot find information about credential definition ${credentialDefinitionId}.`)
    }

    // Verify that requested attributes are present in credential definition
    const { schema } = await agent.modules.anoncreds.getSchema(credentialDefinition.schemaId)

    if (!schema) {
      throw Error(`Cannot find information about schema ${credentialDefinition.schemaId}.`)
    }

    // If no attributes are specified, request all of them
    if (!attributes) {
      attributes = schema.attrNames
    }

    if (!attributes.every(item => schema.attrNames.includes(item))) {
      throw new Error(
        `Some attributes are not present in the requested credential type: Requested: ${attributes}, Present: ${schema.attrNames}`,
      )
    }

    const requestedAttributes: Record<string, AnonCredsRequestedAttribute> = {}

    requestedAttributes[schema.name] = {
      names: attributes,
      restrictions: [{ cred_def_id: credentialDefinitionId }],
    }

    const request = await agent.didcomm.proofs.createRequest({
      protocolVersion: 'v2',
      proofFormats: {
        anoncreds: { name: 'proof-request', version: '1.0', requested_attributes: requestedAttributes },
      },
    })

    request.proofRecord.metadata.set('_2060/requestedCredentials', requestedCredentials)
    request.proofRecord.metadata.set('_2060/callbackParameters', { ref, callbackUrl })
    await agent.didcomm.proofs.update(request.proofRecord)

    const { url } = await createInvitation({
      agent: await this.agentService.getAgent(),
      messages: [request.message],
      useLegacyDid,
    })

    const shortUrlId = await this.urlShortenerService.createShortUrl({
      longUrl: url,
      relatedFlowId: request.proofRecord.id,
    })
    const shortUrl = `${this.publicApiBaseUrl}/s?id=${shortUrlId}`

    return {
      proofExchangeId: request.proofRecord.id,
      url,
      shortUrl,
    }
  }

  @Post('/credential-offer')
  @ApiOperation({
    summary: 'Credential Offer',
    description:
      "### Credential Offer\n\nCredential offer invitation codes include a preview of the offered credential, meaning by that its `credentialDefinitionId` and claims.\n\nIt's a POST to `/invitation/credential-offer` which receives a JSON object in the body",
  })
  @ApiBody({
    description:
      "### Credential Offer\n\nCredential offer invitation codes include a preview of the offered credential, meaning by that its `credentialDefinitionId` and claims.\n\nIt's a POST to `/invitation/credential-offer` which receives a JSON object in the body",
    type: CreateCredentialOfferDto,
    examples: {
      example: {
        summary: 'Phone Number VC Offer',
        value: {
          credentialDefinitionId:
            'did:web:chatbot-demo.dev.2060.io?service=anoncreds&relativeRef=/credDef/8TsGLaSPVKPVMXK8APzBRcXZryxutvQuZnnTcDmbqd9p',
          claims: [{ name: 'phoneNumber', value: '+57128348520' }],
        },
      },
    },
  })
  @ApiOkResponse({
    description: 'Credential offer invitation',
    schema: {
      example: {
        credentialExchangeId: 'abcd1234-5678efgh-9012ijkl-3456mnop',
        url: 'didcomm://example.com/offer/...',
        shortUrl: `https://mydomain.com/s?id=wxyz7890`,
      },
    },
  })
  @ApiBadRequestResponse({ description: 'Invalid offer payload' })
  @ApiBody({
    type: CreateCredentialOfferDto,
    examples: {
      example: {
        summary: 'Phone Number',
        value: {
          credentialDefinitionId:
            'did:web:chatbot-demo.dev.2060.io?service=anoncreds&relativeRef=/credDef/8TsGLaSPVKPVMXK8APzBRcXZryxutvQuZnnTcDmbqd9p',
          claims: [{ name: 'phoneNumber', value: '+57128348520' }],
        },
      },
    },
  })
  public async createCredentialOffer(
    @Body() options: CreateCredentialOfferDto,
  ): Promise<CreateCredentialOfferResult> {
    const agent = await this.agentService.getAgent()

    const { claims, credentialDefinitionId, useLegacyDid } = options

    if (claims && !Array.isArray(claims)) {
      throw new Error('Received claims is not an array')
    }

    if (!claims) throw new Error('No claims are defined')

    const [credentialDefinition] = await agent.modules.anoncreds.getCreatedCredentialDefinitions({
      credentialDefinitionId,
    })

    if (!credentialDefinition) {
      throw Error(`Cannot find information about credential definition ${credentialDefinitionId}.`)
    }

    // Verify that claims are present in credential definition
    const { schema } = await agent.modules.anoncreds.getSchema(
      credentialDefinition.credentialDefinition.schemaId,
    )

    if (!schema) {
      throw Error(
        `Cannot find information about schema ${credentialDefinition.credentialDefinition.schemaId}.`,
      )
    }

    if (!claims.every(item => schema.attrNames.includes(item.name))) {
      throw new Error(
        `Some claims are not present in the requested credential type: Requested: ${claims.map(item => item.name)}, Present: ${schema.attrNames}`,
      )
    }

    const request = await agent.didcomm.credentials.createOffer({
      protocolVersion: 'v2',
      credentialFormats: {
        anoncreds: {
          credentialDefinitionId,
          attributes: claims.map(item => {
            return { name: item.name, mimeType: item.mimeType, value: item.value }
          }),
        },
      },
    })

    const { url } = await createInvitation({
      agent: await this.agentService.getAgent(),
      messages: [request.message],
      useLegacyDid,
    })

    const shortUrlId = await this.urlShortenerService.createShortUrl({
      longUrl: url,
      relatedFlowId: request.credentialExchangeRecord.id,
    })
    const shortUrl = `${this.publicApiBaseUrl}/s?id=${shortUrlId}`

    return {
      credentialExchangeId: request.credentialExchangeRecord.id,
      url,
      shortUrl,
    }
  }
}
