import { Controller, Logger, Post, Body, Get, Inject, Query } from '@nestjs/common'
import { ApiOperation, ApiResponse, ApiTags, ApiBody, ApiQuery } from '@nestjs/swagger'

import { AccessMode } from '../../../security'

import { TrustService } from './TrustService'
import { IssueCredentialRequestDto, RevokeCredentialRequestDto } from './dto'

@ApiTags('Verifiable Trust')
@AccessMode('INTERNAL')
@Controller({ path: 'vt', version: '1' })
export class V1TrustController {
  private readonly logger = new Logger(V1TrustController.name)

  constructor(@Inject(TrustService) private readonly trustService: TrustService) {}

  @Post('issue-credential')
  @ApiOperation({
    summary:
      'Issue a Verifiable Trust Credential, based on a JSON Schema Credential. It can be either an AnonCreds or a JSON-LD W3C credential.',
  })
  @ApiBody({
    type: IssueCredentialRequestDto,
    examples: {
      jsonld: {
        summary: 'W3c Json LD Credential Example',
        value: {
          format: 'jsonld',
          did: 'did:web:example.com',
          jsonSchemaCredentialId: 'https://example.org/vt/schemas-example-org-jsc.json',
          claims: {
            id: 'https://example.org/org/123',
            name: 'OpenAI Research',
            logoUri: 'https://example.org/logo.png',
            logoDigestSri: 'sha384-...',
            registryId: 'REG-123',
            registryUri: 'https://registry.example.org',
            address: '123 Main St, San Francisco, CA',
            countryCode: 'US',
          },
        },
      },
      anoncreds: {
        summary: 'Anoncreds Credential Example',
        value: {
          format: 'anoncreds',
          jsonSchemaCredentialId: 'https://example.org/vt/schemas-example-org-jsc.json',
          claims: {
            id: 'https://example.org/org/123',
            name: 'OpenAI Research',
            logoUri: 'https://example.org/logo.png',
            logoDigestSri: 'sha384-...',
            registryId: 'REG-123',
            registryUri: 'https://registry.example.org',
            address: '123 Main St, San Francisco, CA',
            countryCode: 'US',
          },
        },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description:
      'The response includes either the JSON-LD W3C Credential contents, directly to transmit to the recipient, or the DIDComm Invitation and Credential Exchange ID associated in case of AnonCreds for further tracking through events interface.',
  })
  async issueCredential(@Body() body: IssueCredentialRequestDto) {
    const {
      format,
      did,
      jsonSchemaCredentialId,
      claims,
      participantSessionId,
      agentParticipantId,
      walletAgentParticipantId,
    } = body
    return await this.trustService.issueCredential({
      format,
      jsonSchemaCredentialId,
      claims,
      did,
      participantSessionId,
      agentParticipantId,
      walletAgentParticipantId,
    })
  }

  @Post('revoke-credential')
  @ApiOperation({
    summary: 'Revoke a verifiable credential',
    description:
      'Revoke a verifiable credential by its format and revocation information. Currently, only AnonCreds format is supported. You must provide the revocation registry definition ID (anoncredsRevocationRegistryDefinitionId) and index (anoncredsRevocationRegistryIndex).',
  })
  @ApiBody({
    type: RevokeCredentialRequestDto,
    examples: {
      anoncreds: {
        summary: 'AnonCreds Credential Revocation',
        description:
          'Use this format to revoke AnonCreds credentials. ' +
          'Requires both the revocation registry definition ID and the credential index within that registry. ' +
          'These values are obtained when the credential is issued with revocation support enabled (supportRevocation: true).',
        value: {
          format: 'anoncreds',
          anoncredsRevocationRegistryDefinitionId:
            'did:webvh:QmQmBtfboNvDrs5SDaDDK3VmUq6ji4yUgLnYaMFo8furUe:2060.io/resources/zQmVXd5K7oTJGiXR88vzKoubQWbNxM5U8s4xBkRtCTgfmHq',
          anoncredsRevocationRegistryIndex: 1,
        },
      },
      jsonld: {
        summary: 'JSON-LD Credential Revocation',
        description: 'Revocation not currently supported for JSON-LD credentials',
        value: {
          format: 'jsonld',
        },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'Credential revoked' })
  async revokeCredential(@Body() body: RevokeCredentialRequestDto) {
    const { format, anoncredsRevocationRegistryDefinitionId, anoncredsRevocationRegistryIndex } = body
    return await this.trustService.revokeCredential({
      format,
      anoncredsRevocationRegistryDefinitionId,
      anoncredsRevocationRegistryIndex,
    })
  }

  @Get('linked-credentials')
  @ApiOperation({
    summary: 'Retrieve one or all Verifiable Trust Credentials (VTC) linked to this Agent',
    description:
      'Retrieves a Verifiable Trust Credential (VTC) based on the provided credential schema ID. ' +
      'The schema defines the structure and semantics of the verifiable credential. ' +
      'This endpoint follows the [Verifiable Trust Specification](https://verana-labs.github.io/verifiable-trust-spec/#vt-linked-vp-verifiable-trust-credential-linked-vp).',
  })
  @ApiQuery({
    name: 'schemaId',
    required: false,
    type: String,
    description:
      'The identifier of the stored credential schema. This ID specifies which Verifiable Credential schema should be used to generate or retrieve the corresponding Verifiable Trust Credential (VTC).',
    examples: {
      verifiableTrustCredential: {
        summary: 'Verifiable Trust Credential example',
        description: 'A full URL to the Verifiable Trust Credential.',
        value: 'https://myservice.verana.io/vt/ecs-service-vtc-vp.json',
      },
    },
  })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    example: 1,
    description: 'Page number (default: 1)',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    example: 10,
    description: 'Number of items per page (default: 10)',
  })
  @ApiResponse({
    status: 200,
    description: 'Returns one or all Verifiable Trust Credentials with pagination if applicable.',
  })
  async getVerifiableTrustCredential(
    @Query('schemaId') schemaId?: string,
    @Query('page') page = 1,
    @Query('limit') limit = 10,
  ) {
    return await this.trustService.getVerifiableTrustCredential(schemaId, page, limit)
  }

  @Get('json-schema-credentials')
  @ApiOperation({
    summary: 'Retrieve one or multiple Verifiable Trust Json Schema Credential (VTJSC).',
    description:
      'Retrieves a Verifiable Trust Json Schema Credential (VTJSC) associated with the given schema identifier (`schemaId`). ' +
      'A JSON Schema Credential defines the structure, types, and validation rules for a corresponding Verifiable Trust Credential (VTC). ' +
      'This endpoint follows the [Verifiable Trust Specification](https://verana-labs.github.io/verifiable-trust-spec/#json-schema-credentials).',
  })
  @ApiQuery({
    name: 'schemaId',
    required: false,
    type: String,
    description:
      'The identifier or URL of the Verifiable Trust Json Schema Credential (VTJSC) to retrieve. ' +
      'This schema describes the structure of the Verifiable Trust Credential (VTC) it governs.',
    examples: {
      jsonSchemaCredentialId: {
        summary: 'JSON Schema Credential example',
        description: 'A full URL referencing the JSON Schema Credential to be retrieved.',
        value: 'https://ecosystem/shemas-example-jsc.json',
      },
    },
  })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    example: 1,
    description: 'Page number (default: 1)',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    example: 10,
    description: 'Number of items per page (default: 10)',
  })
  @ApiResponse({
    status: 200,
    description: 'Returns one or all Verifiable Trust Credentials with pagination if applicable.',
  })
  async getJsonSchemaCredential(
    @Query('schemaId') schemaId: string,
    @Query('page') page = 1,
    @Query('limit') limit = 10,
  ) {
    return await this.trustService.getJsonSchemaCredential(schemaId, page, limit)
  }
}
