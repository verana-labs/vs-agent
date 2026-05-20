import { DidCommCredentialExchangeRecord } from '@credo-ts/didcomm'
import {
  BadRequestException,
  Controller,
  Get,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  Param,
} from '@nestjs/common'
import {
  ApiTags,
  ApiOperation,
  ApiOkResponse,
  ApiBadRequestResponse,
  ApiNotFoundResponse,
} from '@nestjs/swagger'
import { Claim } from '@verana-labs/vs-agent-model'

import { VsAgentService } from '../../../services/VsAgentService'

import { CredentialExchangeDataDto } from './dto/credential-exchange-data.dto'

interface AnonCredsCredentialMetadata {
  credentialDefinitionId?: string
  schemaId?: string
}

@ApiTags('credentials')
@Controller({
  path: 'credentials',
  version: '1',
})
export class CredentialExchangesController {
  private readonly logger = new Logger(CredentialExchangesController.name)

  constructor(private readonly agentService: VsAgentService) {}

  @Get('/')
  @ApiOperation({
    summary: 'List all credential exchanges',
    description:
      'Returns every credential exchange record tracked by VS Agent. Useful for inspecting the issuance pipeline during testing.',
  })
  @ApiOkResponse({
    description: 'Array of credential exchange data',
    type: CredentialExchangeDataDto,
    isArray: true,
  })
  public async getAll(): Promise<CredentialExchangeDataDto[]> {
    const agent = await this.agentService.getAgent()
    const records = await agent.didcomm.credentials.getAll()
    return Promise.all(records.map(record => this.toDto(record)))
  }

  @Get('/:credentialExchangeId')
  @ApiOperation({ summary: 'Get credential exchange by id' })
  @ApiOkResponse({ description: 'Credential exchange data', type: CredentialExchangeDataDto })
  @ApiBadRequestResponse({ description: 'Invalid credentialExchangeId' })
  @ApiNotFoundResponse({ description: 'Credential exchange not found' })
  public async getById(
    @Param('credentialExchangeId') credentialExchangeId: string,
  ): Promise<CredentialExchangeDataDto> {
    if (!credentialExchangeId) {
      throw new BadRequestException({ reason: 'credentialExchangeId is required' })
    }

    const agent = await this.agentService.getAgent()
    const record = await agent.didcomm.credentials.findById(credentialExchangeId)
    if (!record) {
      throw new NotFoundException({
        reason: `credential exchange with id "${credentialExchangeId}" not found.`,
      })
    }

    try {
      return await this.toDto(record)
    } catch (error) {
      throw new InternalServerErrorException(error)
    }
  }

  private async toDto(record: DidCommCredentialExchangeRecord): Promise<CredentialExchangeDataDto> {
    const agent = await this.agentService.getAgent()
    const anonCredsMetadata = record.metadata.get('_internal/anonCredsCredentialDefinitionMetadata') as
      | AnonCredsCredentialMetadata
      | undefined

    let offerAttributes: Claim[] | undefined
    try {
      const formatData = await agent.didcomm.credentials.getFormatData(record.id)
      if (formatData.offerAttributes?.length) {
        offerAttributes = formatData.offerAttributes.map(
          attr => new Claim({ name: attr.name, value: attr.value, mimeType: attr.mimeType }),
        )
      }
    } catch (error) {
      this.logger.debug(`Could not load format data for ${record.id}: ${JSON.stringify(error)}`)
    }

    return {
      credentialExchangeId: record.id,
      state: record.state,
      threadId: record.threadId,
      connectionId: record.connectionId,
      credentialDefinitionId: anonCredsMetadata?.credentialDefinitionId,
      schemaId: anonCredsMetadata?.schemaId,
      offerAttributes,
      errorMessage: record.errorMessage,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt?.toISOString(),
    }
  }
}
