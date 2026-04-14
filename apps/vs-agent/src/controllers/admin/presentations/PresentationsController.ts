import { DidCommProofExchangeRecord } from '@credo-ts/didcomm'
import {
  BadRequestException,
  Controller,
  Delete,
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
  ApiNoContentResponse,
  ApiBadRequestResponse,
  ApiNotFoundResponse,
} from '@nestjs/swagger'
import { PresentationData, RequestedCredential, Claim } from '@verana-labs/vs-agent-model'

import { VsAgentService } from '../../../services/VsAgentService'

import { PresentationDataDto } from './dto/presentation-data.dto'

@ApiTags('presentations')
@Controller({
  path: 'presentations',
  version: '1',
})
export class PresentationsController {
  private readonly logger = new Logger(PresentationsController.name)

  constructor(private readonly agentService: VsAgentService) {}

  /**
   * Get all created credential types
   *
   * @returns
   */
  @Get('/')
  @ApiOperation({
    summary: 'List all presentations',
    description:
      '## Presentations\n\nIt is possible to query all presentation flows created by VS Agent through the endpoint `/presentations`, which will respond with records using the following format:\n\n- proofExchangeId: flow identifier (the same as the one used in events and other responses)\n- state: current state of the presentation flow (e.g. `request-sent` when it was just started, `done` when finished)\n- claims: array containing the claims received within the presentation\n- verified: boolean stating if the presentation is valid (only meaningful when state is `done`)\n- threadId: DIDComm thread id (shared with the other party)\n- updatedAt: last time activity was recorded for this flow\n\nIt is possible to query for a single presentation by executing a GET to `/presentations/<proofExchangeId>`.',
  })
  @ApiOkResponse({
    description: 'Array of presentation data',
    type: PresentationDataDto,
    isArray: true,
  })
  public async getAllPresentations(): Promise<PresentationData[]> {
    const agent = await this.agentService.getAgent()

    const records = await agent.didcomm.proofs.getAll()

    return Promise.all(
      records.map(async record => {
        return await this.getPresentationData(record)
      }),
    )
  }

  /**
   * Delete a presentation exchange record
   *
   * @param proofExchangeId Proof Exchange Id
   */
  @Delete('/:proofExchangeId')
  @ApiOperation({
    summary: 'Delete a presentation exchange record',
  })
  @ApiNoContentResponse({ description: 'Presentation exchange deleted' })
  @ApiBadRequestResponse({ description: 'Invalid proofExchangeId' })
  @ApiNotFoundResponse({ description: 'Presentation exchange not found' })
  public async deleteProofExchangeById(@Param('proofExchangeId') proofExchangeId: string) {
    const agent = await this.agentService.getAgent()
    await agent.didcomm.proofs.deleteById(proofExchangeId, { deleteAssociatedDidCommMessages: true })
  }

  /**
   * Export a credential type, including its underlying cryptographic data for importing it in another instance
   *
   * @param credentialTypeId Credential Type Id
   * @returns ConnectionRecord
   */
  @Get('/:proofExchangeId')
  @ApiOperation({
    summary: 'Get presentation by proofExchangeId',
  })
  @ApiOkResponse({ description: 'Presentation data', type: PresentationDataDto })
  public async getPresentationById(@Param('proofExchangeId') proofExchangeId: string) {
    const agent = await this.agentService.getAgent()

    if (!proofExchangeId) {
      throw new BadRequestException({ reason: 'proofExchangeId is required' })
    }

    const record = await agent.didcomm.proofs.findById(proofExchangeId)

    if (!record) {
      throw new NotFoundException({ reason: `proof exchange with id "${proofExchangeId}" not found.` })
    }

    try {
      return await this.getPresentationData(record)
    } catch (error) {
      throw new InternalServerErrorException(error)
    }
  }

  private async getPresentationData(proofExchange: DidCommProofExchangeRecord): Promise<PresentationData> {
    const agent = await this.agentService.getAgent()

    const formatData = await agent.didcomm.proofs.getFormatData(proofExchange.id)

    const requestedCredentials = proofExchange.metadata.get(
      '_2060/requestedCredentials',
    ) as RequestedCredential[]

    const revealedAttributes =
      formatData.presentation?.anoncreds?.requested_proof.revealed_attrs ??
      formatData.presentation?.indy?.requested_proof.revealed_attrs

    const revealedAttributeGroups =
      formatData.presentation?.anoncreds?.requested_proof?.revealed_attr_groups ??
      formatData.presentation?.indy?.requested_proof.revealed_attr_groups

    const claims: Claim[] = []
    if (revealedAttributes) {
      for (const [name, value] of Object.entries(revealedAttributes)) {
        claims.push(new Claim({ name, value: value.raw }))
      }
    }

    if (revealedAttributeGroups) {
      for (const [, groupAttributes] of Object.entries(revealedAttributeGroups)) {
        for (const attrName in groupAttributes.values) {
          claims.push(new Claim({ name: attrName, value: groupAttributes.values[attrName].raw }))
        }
      }
    }
    return {
      requestedCredentials,
      claims,
      verified: proofExchange.isVerified ?? false,
      state: proofExchange.state,
      proofExchangeId: proofExchange.id,
      threadId: proofExchange.threadId,
      updatedAt: proofExchange.updatedAt,
    }
  }
}
