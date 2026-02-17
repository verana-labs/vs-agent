import { JsonTransformer, W3cJsonLdVerifiableCredential } from '@credo-ts/core'
import { Controller, HttpException, HttpStatus, Logger, Post, Body, Delete, Get, Query } from '@nestjs/common'
import { ApiOperation, ApiResponse, ApiTags, ApiBody, ApiQuery } from '@nestjs/swagger'

import { TrustService } from './TrustService'
import { JsonSchemaCredentialDto, W3cCredentialDto, IssueCredentialRequestDto } from './dto'

@ApiTags('Verifiable Trust')
@Controller({ path: 'vt', version: '1' })
export class TrustController {
  private readonly logger = new Logger(TrustController.name)

  constructor(private readonly trustService: TrustService) {}

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
            logo: 'https://example.com/logo.png',
            registryId: 'REG-123',
            registryUrl: 'https://registry.example.org',
            address: '123 Main St, San Francisco, CA',
            type: 'PRIVATE',
            countryCode: 'US',
          },
        },
      },
      anoncreds: {
        summary: 'Anoncreds Credential Example',
        value: {
          type: 'anoncreds',
          jsonSchemaCredentialId: 'https://example.org/vt/schemas-example-org-jsc.json',
          claims: {
            id: 'https://example.org/org/123',
            name: 'OpenAI Research',
            logo: 'https://example.com/logo.png',
            registryId: 'REG-123',
            registryUrl: 'https://registry.example.org',
            address: '123 Main St, San Francisco, CA',
            type: 'PRIVATE',
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
    const { format, did, jsonSchemaCredentialId, claims } = body
    return await this.trustService.issueCredential({ format, jsonSchemaCredentialId, claims, did })
  }

  @Post('revoke-credential')
  @ApiOperation({ summary: 'Revoke a verifiable credential' })
  @ApiBody({ schema: { example: { id: 'cred-1' } } })
  @ApiResponse({ status: 200, description: 'Credential revoked' })
  async revokeCredential() {
    throw new HttpException({ message: `This method is not implemented yet` }, HttpStatus.NOT_IMPLEMENTED)
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
        value: 'https://p2801.ovpndev.mobiera.io/vt/ecs-service-c-vp.json',
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

  @Delete('linked-credentials')
  @ApiOperation({
    summary: 'Delete a Verifiable Trust Credential (VTC)',
    description:
      'Deletes a stored Verifiable Trust Credential (VTC) associated with the specified JSON Schema credential. ' +
      'This operation removes the credential definition or cached data linked to the provided schema. ' +
      'The operation aligns with the [Verifiable Trust Specification](https://verana-labs.github.io/verifiable-trust-spec/#vt-linked-vp-verifiable-trust-credential-linked-vp).',
  })
  @ApiQuery({
    name: 'schemaId',
    required: true,
    type: String,
    description:
      'The URL of the Verifiable Trust Credential (VTC) to be deleted. ' +
      'This identifier must match an existing stored credential schema.',
    examples: {
      verifiableTrustCredential: {
        summary: 'JSON Schema Credential example',
        description: 'A full URL identifying the Verifiable Trust Credential to be deleted.',
        value: 'https://p2801.ovpndev.mobiera.io/vt/ecs-service-c-vp.json',
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'The Verifiable Trust Credential (VTC) was successfully deleted for the given schema ID.',
  })
  @ApiResponse({
    status: 404,
    description: 'No Verifiable Trust Credential (VTC) was found for the provided schema ID.',
  })
  async removeVerifiableTrustCredential(@Query('schemaId') schemaId: string) {
    return await this.trustService.removeVerifiableTrustCredential(schemaId)
  }

  @Post('linked-credentials')
  @ApiOperation({
    summary: 'Create a new Verifiable Trust Credential (VTC)',
    description:
      'The `schemaBaseId` defines the base name used to construct the resulting credential schema URL. ' +
      'This operation supports creating credentials for both organizations and services following the Verifiable Trust model.',
  })
  @ApiBody({
    type: W3cCredentialDto,
    description:
      'Defines the Verifiable Credential (VTC) to be created. ' +
      'The `schemaBaseId` determines the schema URL structure, and the `credential` field contains the W3C Verifiable Credential data.',
    examples: {
      organization: {
        summary: 'Organization Credential Example',
        description:
          'Creates a Verifiable Trust Credential (VTC) for an organization. ' +
          'The `schemaBaseId` is used to generate the schema URL (e.g., `https://p2801.ovpndev.mobiera.io/vt/schemas-organization-c-vp.json`).',
        value: {
          schemaBaseId: 'organization',
          credential: {
            '@context': ['https://www.w3.org/2018/credentials/v1'],
            id: 'https://example.org/credentials/123',
            type: ['VerifiableCredential', 'EcsOrgCredential'],
            issuer: 'did:example:issuer123',
            issuanceDate: '2025-10-13T12:00:00Z',
            credentialSubject: {
              id: 'did:example:org123',
              name: 'OpenAI Research',
              logo: 'https://example.com/logo.png',
              registryId: 'REG-123',
              registryUrl: 'https://registry.example.org',
              address: '123 Main St, San Francisco, CA',
              type: 'PRIVATE',
              countryCode: 'US',
            },
            proof: {
              type: 'Ed25519Signature2018',
              created: '2025-10-13T12:00:00Z',
              proofPurpose: 'assertionMethod',
              verificationMethod: 'did:example:issuer123#key-1',
              jws: 'eyJhbGciOiJFZERTQSJ9...',
            },
          },
        },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description:
      'The Verifiable Trust Credential (VTC) was successfully created and stored. ' +
      'The resulting schema URL is derived from the provided `schemaBaseId`.',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid credential format or missing required fields.',
  })
  async createVtc(@Body() body: W3cCredentialDto) {
    const data = await this.trustService.createVtc(
      body.schemaBaseId.toLocaleLowerCase(),
      JsonTransformer.fromJSON(body.credential, W3cJsonLdVerifiableCredential),
    )
    return { message: 'Credential created successfully', data }
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

  @Delete('json-schema-credentials')
  @ApiOperation({
    summary: 'Delete a a Verifiable Trust Json Schema Credential (VTJSC)',
    description:
      'Deletes a stored Verifiable Trust Json Schema Credential (VTJSC) associated with the specified schema identifier (`schemaId`). ' +
      'A JSON Schema Credential defines the structure and validation rules for a Verifiable Trust Credential (VTC). ' +
      'Removing a JSC also invalidates any Verifiable Trust Credentials that rely on it. ' +
      'This operation follows the [Verifiable Trust Specification](https://verana-labs.github.io/verifiable-trust-spec/#json-schema-credentials).',
  })
  @ApiQuery({
    name: 'schemaId',
    required: true,
    type: String,
    description:
      'The identifier or URL of the Verifiable Trust Json Schema Credential (VTJSC) to delete. ' +
      'This must correspond to an existing stored schema definition.',
    examples: {
      jsonSchemaCredentialId: {
        summary: 'JSON Schema Credential example',
        description: 'A full URL identifying the Verifiable Trust Json Schema Credential (VTJSC) to be deleted.',
        value: 'https://ecosystem/shemas-example-jsc.json',
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'The Verifiable Trust Json Schema Credential (VTJSC) was successfully deleted for the given schema ID.',
  })
  @ApiResponse({
    status: 404,
    description: 'No Verifiable Trust Json Schema Credential (VTJSC) was found for the provided schema ID.',
  })
  async removeJsonSchemaCredential(@Query('schemaId') schemaId: string) {
    return await this.trustService.removeJsonSchemaCredential(schemaId)
  }

  @Post('json-schema-credentials')
  @ApiOperation({
    summary: 'Create or update a Verifiable Trust Json Schema Credential (VTJSC)',
    description: `
  Creates or updates a **Verifiable Trust Json Schema Credential (VTJSC)**, used by **Trust Registries** to cryptographically sign and attest to **Credential Schemas** they have created in the Verana ledger.

  A VTJSC binds a CredentialSchema entry in the VPR to the **Ecosystem DID** that governs the Trust Registry.
  - schemaBaseId: the name you want to show in the url path of the create vtjsc. Example: organizationtest will create the VTJSC with the id: https:///vt/schemas-organizationtest-jsc.json
  - jsonSchemaRef: the URI of your schema in the Verana ledger.
  
  The **issuer DID** of the VTJSC MUST be the **same DID** as the Ecosystem DID of the Trust Registry that created the referenced CredentialSchema in the ledger.

  VTJSCs issued by any other DID will be be considered invalid by trust resolvers.
  `,
  })
  @ApiBody({
    type: JsonSchemaCredentialDto,
    description:
      'Defines the base schema identifier and the JSON Schema reference used to create or update the Verifiable Trust Json Schema Credential (VTJSC).',
    examples: {
      service: {
        summary: 'JSON Schema Credential Example',
        description:
          'Creates a Verifiable Trust Json Schema Credential (VTJSC) for an organization or service. ' +
          'The `schemaBaseId` determines the base schema name, and the `jsonSchemaRef` provides the reference to the JSON Schema definition.',
        value: {
          schemaBaseId: 'organization',
          jsonSchemaRef: 'vpr:verana:vna-testnet-1/cs/v1/js/12345678',
        },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description:
      'The Verifiable Trust Json Schema Credential (VTJSC) was successfully created or updated.',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid schema input or missing required parameters.',
  })
  async createJsc(@Body() body: JsonSchemaCredentialDto) {
    return await this.trustService.createJsc(body.schemaBaseId.toLocaleLowerCase(), body.jsonSchemaRef)
  }
}
