import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
} from '@nestjs/common'
import { ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger'
import {
  addServiceEndpoint,
  deleteServiceEndpoint,
  listServiceEndpoints,
  ServiceEndpoint,
  ServiceEndpointError,
  ServiceEndpointErrorCode,
  updateServiceEndpoint,
  VsAgent,
} from '@verana-labs/vs-agent-sdk'

import { VsAgentService } from '../../../services/VsAgentService'

import {
  AddServiceEndpointDto,
  ServiceEndpointDto,
  UpdateServiceEndpointDto,
} from './dto/service-endpoint.dto'

@ApiTags('service-endpoints')
@Controller({ path: 'vt/service-endpoints', version: '1' })
export class ServiceEndpointsController {
  constructor(private readonly agentService: VsAgentService) {}

  @Get('/')
  @ApiOperation({
    summary: 'List consumable service endpoints',
    description:
      'Returns the consumable service entries of the DID Document, excluding agent-managed entries.',
  })
  @ApiOkResponse({ description: 'Consumable service entries', type: ServiceEndpointDto, isArray: true })
  public async listServiceEndpoints(): Promise<ServiceEndpoint[]> {
    const agent = await this.requireAgentWithDid()
    try {
      return await listServiceEndpoints(agent)
    } catch (error) {
      throw this.toHttpException(error)
    }
  }

  @Post('/')
  @ApiOperation({ summary: 'Add a consumable service endpoint' })
  @ApiOkResponse({ description: 'The created service entry', type: ServiceEndpointDto })
  public async addServiceEndpoint(@Body() dto: AddServiceEndpointDto): Promise<ServiceEndpoint> {
    const agent = await this.requireAgentWithDid()
    try {
      return await addServiceEndpoint(agent, dto)
    } catch (error) {
      throw this.toHttpException(error)
    }
  }

  @Patch('/:id')
  @ApiOperation({ summary: 'Update a consumable service endpoint' })
  @ApiParam({ name: 'id', description: 'Percent-encoded entry id (e.g. %23mcp for #mcp)', example: '%23mcp' })
  @ApiOkResponse({ description: 'The updated service entry', type: ServiceEndpointDto })
  public async updateServiceEndpoint(
    @Param('id') id: string,
    @Body() dto: UpdateServiceEndpointDto,
  ): Promise<ServiceEndpoint> {
    if (dto.type === undefined && dto.serviceEndpoint === undefined) {
      throw new BadRequestException('At least one of type or serviceEndpoint must be provided')
    }
    const agent = await this.requireAgentWithDid()
    try {
      return await updateServiceEndpoint(agent, id, dto)
    } catch (error) {
      throw this.toHttpException(error)
    }
  }

  @Delete('/:id')
  @ApiOperation({ summary: 'Delete a consumable service endpoint' })
  @ApiParam({ name: 'id', description: 'Percent-encoded entry id (e.g. %23mcp for #mcp)', example: '%23mcp' })
  @ApiOkResponse({ description: 'The deleted service entry', type: ServiceEndpointDto })
  public async deleteServiceEndpoint(@Param('id') id: string): Promise<ServiceEndpoint> {
    const agent = await this.requireAgentWithDid()
    try {
      return await deleteServiceEndpoint(agent, id)
    } catch (error) {
      throw this.toHttpException(error)
    }
  }

  private async requireAgentWithDid(): Promise<VsAgent> {
    const agent = await this.agentService.getAgent()
    if (!agent.did) throw new BadRequestException('Agent has no public DID')
    return agent
  }

  private toHttpException(error: unknown): Error {
    if (!(error instanceof ServiceEndpointError)) return error as Error
    const body = { code: error.code, reason: error.message }
    switch (error.code) {
      case ServiceEndpointErrorCode.NotFound:
        return new NotFoundException(body)
      case ServiceEndpointErrorCode.DuplicateId:
        return new ConflictException(body)
      default:
        return new BadRequestException(body)
    }
  }
}
