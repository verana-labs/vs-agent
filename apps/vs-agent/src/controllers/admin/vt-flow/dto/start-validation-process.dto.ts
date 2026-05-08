import { ApiProperty } from '@nestjs/swagger'
import { IsNotEmpty, IsObject, IsOptional, IsString } from 'class-validator'

export class StartValidationProcessDto {
  @ApiProperty({
    description: 'Validator on-chain Permission ID issuing the credential.',
    example: '42',
  })
  @IsString()
  @IsNotEmpty()
  validatorPermId!: string

  @ApiProperty({
    description: 'Claims for the credential subject. Shape depends on the schema.',
    example: { legalName: 'ACME Corp', country: 'IN' },
  })
  @IsObject()
  claims!: Record<string, unknown>

  @ApiProperty({
    description: 'Optional vt-flow session UUID. Generated if omitted.',
    required: false,
  })
  @IsOptional()
  @IsString()
  sessionUuid?: string
}
