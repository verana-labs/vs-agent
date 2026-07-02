import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsDefined, IsNotEmpty, IsOptional, IsString, ValidateIf } from 'class-validator'

import { ServiceEndpointValue } from '../ServiceEndpointsService'

export class AddServiceEndpointDto {
  @ApiProperty({
    description:
      'Consumable service type. MUST NOT be DIDCommMessaging, LinkedVerifiablePresentation or VsAgentAdminAPI.',
    example: 'MCP',
  })
  @IsString()
  @IsNotEmpty()
  type!: string

  @ApiProperty({
    description: 'Service endpoint: a URI string, an object, or an array of those (per DID-CORE).',
    example: 'https://mcp.agent.example.com',
  })
  @IsDefined()
  serviceEndpoint!: ServiceEndpointValue

  @ApiPropertyOptional({
    description: 'DID-relative fragment for the new entry (e.g. #mcp). Generated from the type when omitted.',
    example: '#mcp',
  })
  @IsString()
  @IsOptional()
  @IsNotEmpty()
  id?: string
}

export class UpdateServiceEndpointDto {
  @ApiPropertyOptional({ description: 'New consumable service type.', example: 'MCP' })
  @IsString()
  @IsOptional()
  @IsNotEmpty()
  type?: string

  @ApiPropertyOptional({
    description: 'New service endpoint: a URI string, an object, or an array of those (per DID-CORE).',
    example: 'https://mcp.agent.example.com',
  })
  @ValidateIf(o => o.serviceEndpoint !== undefined)
  @IsDefined()
  serviceEndpoint?: ServiceEndpointValue
}

export class ServiceEndpointDto {
  @ApiProperty({ example: 'did:web:agent.example.com#mcp' })
  id!: string

  @ApiProperty({ example: 'MCP' })
  type!: string

  @ApiProperty({ example: 'https://mcp.agent.example.com' })
  serviceEndpoint!: ServiceEndpointValue
}
