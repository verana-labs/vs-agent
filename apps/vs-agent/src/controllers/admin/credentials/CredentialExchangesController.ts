import { DidCommCredentialExchangeRecord } from '@credo-ts/didcomm'
import {
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
import { BaseAgentModules, VsAgent } from '@verana-labs/vs-agent-sdk'

import { AccessMode } from '../../../security'
import { VsAgentService } from '../../../services/VsAgentService'

import { CredentialExchangeDataDto } from './dto/credential-exchange-data.dto'

interface AnonCredsCredentialMetadata {
  credentialDefinitionId?: string
  schemaId?: string
}

@ApiTags('credential-exchanges')
@AccessMode('INTERNAL')
@Controller({
  path: 'credential-exchanges',
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
  public async getAllCredentialExchanges(): Promise<CredentialExchangeDataDto[]> {
    try {
      const agent = await this.agentService.getAgent()
      const records = await agent.didcomm.credentials.getAll()
      const results = await Promise.allSettled(
        records.map(record => this.getCredentialExchangeData(agent, record)),
      )
      return results.flatMap((result, index) => {
        if (result.status === 'fulfilled') return [result.value]
        this.logger.warn(
          `Skipping credential exchange ${records[index].id}: ${JSON.stringify(result.reason)}`,
        )
        return []
      })
    } catch (error) {
      throw new InternalServerErrorException(error)
    }
  }

  @Get('/:credentialExchangeId')
  @ApiOperation({ summary: 'Get credential exchange by id' })
  @ApiOkResponse({ description: 'Credential exchange data', type: CredentialExchangeDataDto })
  @ApiBadRequestResponse({ description: 'Invalid credentialExchangeId' })
  @ApiNotFoundResponse({ description: 'Credential exchange not found' })
  public async getCredentialExchangeById(
    @Param('credentialExchangeId') credentialExchangeId: string,
  ): Promise<CredentialExchangeDataDto> {
    const agent = await this.agentService.getAgent()
    const record = await agent.didcomm.credentials.findById(credentialExchangeId)
    if (!record) {
      throw new NotFoundException({
        reason: `credential exchange with id "${credentialExchangeId}" not found.`,
      })
    }

    try {
      return await this.getCredentialExchangeData(agent, record)
    } catch (error) {
      throw new InternalServerErrorException(error)
    }
  }

  private async getCredentialExchangeData(
    agent: VsAgent<BaseAgentModules>,
    record: DidCommCredentialExchangeRecord,
  ): Promise<CredentialExchangeDataDto> {
    const anonCredsMetadata = record.metadata.get('_internal/anonCredsCredentialDefinitionMetadata') as
      | AnonCredsCredentialMetadata
      | undefined

    let claims: Claim[] | undefined
    try {
      const formatData = await agent.didcomm.credentials.getFormatData(record.id)
      if (formatData.offerAttributes?.length) {
        claims = formatData.offerAttributes.map(
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
      claims,
      errorMessage: record.errorMessage,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt?.toISOString(),
    }
  }
}
