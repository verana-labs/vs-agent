import { Controller, Get, Header, Param, HttpException, HttpStatus, Logger, Inject } from '@nestjs/common'
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger'
import { getEcsSchemas } from '@verana-labs/vs-agent-sdk'

import { VsAgentService } from '../../../services/VsAgentService'
import { TrustService } from './TrustService'

@ApiTags('Self Trust Registry')
@Controller('vt')
export class SelfTrController {
  private readonly logger = new Logger(SelfTrController.name)
  private ecsSchemas

  constructor(
    @Inject(VsAgentService) private readonly agentService: VsAgentService,
    @Inject(TrustService) private readonly trustService: TrustService,
    @Inject('PUBLIC_API_BASE_URL') private readonly publicApiBaseUrl: string,
  ) {
    this.ecsSchemas = getEcsSchemas(publicApiBaseUrl)
  }

  // The stored bytes go out as they are: a string bypasses the JSON serializer and its `json spaces`.
  @Get('vct/:credentialSchemaId')
  @Header('Content-Type', 'application/json')
  @ApiOperation({ summary: 'Get the SD-JWT VC Type Metadata of a credential schema' })
  @ApiParam({ name: 'credentialSchemaId', required: true, description: 'On-chain CredentialSchema id', example: '144' })
  @ApiResponse({ status: 200, description: 'Type Metadata returned' })
  @ApiResponse({ status: 404, description: 'No VTJSC of that schema' })
  async getTypeMetadata(@Param('credentialSchemaId') credentialSchemaId: string): Promise<string> {
    return await this.trustService.getTypeMetadata(credentialSchemaId)
  }

  @Get(':schemaId')
  @ApiOperation({ summary: 'Get verifiable credential for service' })
  @ApiResponse({ status: 200, description: 'Verifiable Credential returned' })
  async getCredentials(@Param('schemaId') schemaId: string) {
    try {
      const baseUrl = `${this.publicApiBaseUrl}/vt/${schemaId}`
      if (schemaId.endsWith('-vtc-vp.json'))
        return await this.trustService.getVerifiableTrustCredential(baseUrl)
      else if (schemaId.endsWith('-vtjsc-vp.json') || schemaId.endsWith('-jsc.json'))
        return await this.trustService.getJsonSchemaCredential(baseUrl)
      else
        throw new HttpException(
          'Invalid schemaId: must end with -vtc-vp.json, -vtjsc-vp.json, or -jsc.json',
          HttpStatus.BAD_REQUEST,
        )
    } catch (error) {
      if (error instanceof HttpException) throw error
      this.logger.error(`Error loading schema file: ${error.message}`)
      throw new HttpException('Failed to load schema', HttpStatus.INTERNAL_SERVER_ERROR)
    }
  }

  // GET Function to Retrieve JSON Schemas
  @Get('cs/v1/js/:schemaId')
  @ApiOperation({ summary: 'Get JSON schema by schemaId' })
  @ApiParam({ name: 'schemaId', required: true, description: 'Schema identifier', example: 'ecs-org' })
  @ApiResponse({ status: 200, description: 'JSON schema returned' })
  async getSchema(@Param('schemaId') schemaId: string) {
    const schema = this.ecsSchemas[schemaId]
    if (!schema) {
      throw new HttpException('Schema not found', HttpStatus.NOT_FOUND)
    }
    return schema
  }
}
