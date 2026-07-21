import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseFilters,
} from '@nestjs/common'
import { ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger'

import { AccessMode } from '../../../security'

import { ServiceEndpointExceptionFilter } from './ServiceEndpointExceptionFilter'
import { ServiceEndpoint, ServiceEndpointsService } from './ServiceEndpointsService'
import {
  AddServiceEndpointDto,
  ServiceEndpointDto,
  UpdateServiceEndpointDto,
} from './dto/service-endpoint.dto'

@ApiTags('service-endpoints')
@AccessMode('INTERNAL')
@Controller({ path: 'vt/service-endpoints', version: '1' })
@UseFilters(ServiceEndpointExceptionFilter)
export class ServiceEndpointsController {
  constructor(private readonly service: ServiceEndpointsService) {}

  @Get('/')
  @ApiOperation({
    summary: 'List consumable service endpoints',
    description:
      'Returns the consumable service entries of the DID Document, excluding agent-managed entries.',
  })
  @ApiOkResponse({ description: 'Consumable service entries', type: ServiceEndpointDto, isArray: true })
  public async listServiceEndpoints(): Promise<ServiceEndpoint[]> {
    return this.service.list()
  }

  @Post('/')
  @ApiOperation({ summary: 'Add a consumable service endpoint' })
  @ApiOkResponse({ description: 'The created service entry', type: ServiceEndpointDto })
  public async addServiceEndpoint(@Body() dto: AddServiceEndpointDto): Promise<ServiceEndpoint> {
    return this.service.add(dto)
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
    return this.service.update(id, dto)
  }

  @Delete('/:id')
  @ApiOperation({ summary: 'Delete a consumable service endpoint' })
  @ApiParam({ name: 'id', description: 'Percent-encoded entry id (e.g. %23mcp for #mcp)', example: '%23mcp' })
  @ApiOkResponse({ description: 'The deleted service entry', type: ServiceEndpointDto })
  public async deleteServiceEndpoint(@Param('id') id: string): Promise<ServiceEndpoint> {
    return this.service.delete(id)
  }
}
