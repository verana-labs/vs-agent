import { ApiProperty } from '@nestjs/swagger'
import { IsString, IsNotEmpty, IsNumber, IsOptional } from 'class-validator'

import { REVOCATION_REGISTRY_DEFAULT_CAPACITY } from '../../../config/constants'

export class CreateRevocationRegistryDto {
  @ApiProperty({
    description: 'credentialDefinitionId',
    example:
      'did:web:chatbot-demo.dev.2060.io?service=anoncreds&relativeRef=/credDef/8TsGLaSPVKPVMXK8APzBRcXZryxutvQuZnnTcDmbqd9p',
  })
  @IsString()
  @IsNotEmpty()
  credentialDefinitionId!: string

  @ApiProperty({
    description: 'maximumCredentialNumber',
    default: REVOCATION_REGISTRY_DEFAULT_CAPACITY,
    example: REVOCATION_REGISTRY_DEFAULT_CAPACITY,
  })
  @IsNumber()
  @IsNotEmpty()
  @IsOptional()
  maximumCredentialNumber: number = REVOCATION_REGISTRY_DEFAULT_CAPACITY
}
