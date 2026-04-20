import { Controller, Get, Param, Query, HttpException, HttpStatus, Logger, Inject } from '@nestjs/common'
import { ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger'
import { getEcsSchemas } from '@verana-labs/vs-agent-sdk'

import { VsAgentService } from '../../../services/VsAgentService'
import { TrustService } from '../../admin/verifiable/TrustService'

@ApiTags('Self Trust Registry')
@Controller('vt')
export class SelfTrController {
  private readonly logger = new Logger(SelfTrController.name)
  private ecsSchemas

  constructor(
    private readonly agentService: VsAgentService,
    private readonly trustService: TrustService,
    @Inject('PUBLIC_API_BASE_URL') private readonly publicApiBaseUrl: string,
  ) {
    this.ecsSchemas = getEcsSchemas(publicApiBaseUrl)
  }

  @Get(':schemaId')
  @ApiOperation({ summary: 'Get verifiable credential for service' })
  @ApiResponse({ status: 200, description: 'Verifiable Credential returned' })
  async getCredentials(@Param('schemaId') schemaId: string) {
    try {
      const baseUrl = `${this.publicApiBaseUrl}/vt/${schemaId}`
      if (schemaId.endsWith('-c-vp.json'))
        return await this.trustService.getVerifiableTrustCredential(baseUrl)
      else if (schemaId.endsWith('-jsc-vp.json') || schemaId.endsWith('-jsc.json'))
        return await this.trustService.getJsonSchemaCredential(baseUrl)
      else
        throw new HttpException(
          'Invalid schemaId: must end with -c-vp.json, -jsc-vp.json, or -jsc.json',
          HttpStatus.BAD_REQUEST,
        )
    } catch (error) {
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
    try {
      if (!schemaId) {
        throw new HttpException('Schema not found', HttpStatus.NOT_FOUND)
      }
      return this.ecsSchemas[schemaId]
    } catch (error) {
      this.logger.error(`Error loading schema file: ${error.message}`)
      throw new HttpException('Failed to load schema', HttpStatus.INTERNAL_SERVER_ERROR)
    }
  }

  @Get('perm/v1/list')
  @ApiOperation({ summary: 'Get permissions by DID and type' })
  @ApiQuery({ name: 'did', required: true, description: 'DID to query' })
  @ApiQuery({ name: 'type', required: true, description: 'Permission type' })
  @ApiQuery({ name: 'response_max_size', required: false })
  @ApiQuery({ name: 'schema_id', required: false })
  @ApiResponse({ status: 200, description: 'Permission list returned' })
  findWithDid(@Query('did') did: string, @Query('type') type: string) {
    try {
      if (!did || type !== 'ISSUER') return { permissions: [] }
      return {
        permissions: [
          {
            type: 'ISSUER',
            did,
            created: '2000-11-18T15:26:01.487Z',
          },
        ],
      }
    } catch {
      return { permissions: [] }
    }
  }
}
