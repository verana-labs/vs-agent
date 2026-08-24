import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common'
import { ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger'

import { Page, PaginationQueryDto, paginate } from '../../../../common'
import { AccessMode } from '../../../../security'
import { ServiceEndpoint, ServiceEndpointsService } from '../../service-endpoints/ServiceEndpointsService'
import {
  AddServiceEndpointDto,
  ServiceEndpointDto,
  ServiceEndpointPageDto,
  UpdateServiceEndpointDto,
} from '../../service-endpoints/dto/service-endpoint.dto'

@ApiTags('v2/vt')
@AccessMode('INTERNAL')
@Controller({ path: 'vt/service-endpoints', version: '2' })
export class V2VtServiceEndpointsController {
  public constructor(@Inject(ServiceEndpointsService) private readonly service: ServiceEndpointsService) {}

  @Get()
  @ApiOperation({
    summary: 'List consumable service endpoints',
    description:
      'Returns the consumable service entries of the DID Document, excluding agent-managed entries.',
  })
  @ApiOkResponse({ description: 'A page of consumable service entries', type: ServiceEndpointPageDto })
  public async listServiceEndpoints(@Query() query: PaginationQueryDto): Promise<Page<ServiceEndpoint>> {
    const entries = await this.service.list()
    return paginate(entries, query, { method: 'listServiceEndpoints' }, entry => entry.id)
  }

  @Post()
  @ApiOperation({ summary: 'Add a consumable service endpoint' })
  @ApiOkResponse({ description: 'The created service entry', type: ServiceEndpointDto })
  public async addServiceEndpoint(@Body() dto: AddServiceEndpointDto): Promise<ServiceEndpoint> {
    return this.service.add(dto)
  }

  @Patch(':serviceEndpointId')
  @ApiOperation({ summary: 'Update a consumable service endpoint' })
  @ApiParam({
    name: 'serviceEndpointId',
    description: 'Percent-encoded entry id (e.g. %23mcp for #mcp)',
    example: '%23mcp',
  })
  @ApiOkResponse({ description: 'The updated service entry', type: ServiceEndpointDto })
  public async updateServiceEndpoint(
    @Param('serviceEndpointId') serviceEndpointId: string,
    @Body() dto: UpdateServiceEndpointDto,
  ): Promise<ServiceEndpoint> {
    if (dto.type === undefined && dto.serviceEndpoint === undefined) {
      throw new BadRequestException('At least one of type or serviceEndpoint must be provided')
    }
    return this.service.update(serviceEndpointId, dto)
  }

  @Delete(':serviceEndpointId')
  @ApiOperation({ summary: 'Delete a consumable service endpoint' })
  @ApiParam({
    name: 'serviceEndpointId',
    description: 'Percent-encoded entry id (e.g. %23mcp for #mcp)',
    example: '%23mcp',
  })
  @ApiOkResponse({ description: 'The deleted service entry', type: ServiceEndpointDto })
  public async deleteServiceEndpoint(
    @Param('serviceEndpointId') serviceEndpointId: string,
  ): Promise<ServiceEndpoint> {
    return this.service.delete(serviceEndpointId)
  }
}
