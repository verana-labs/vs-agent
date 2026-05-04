import { ApiProperty } from '@nestjs/swagger'
import { IsArray, IsNotEmpty, IsOptional, IsString } from 'class-validator'

export class ValidateFlowDto {
  @ApiProperty({
    description:
      'Identifier of the JsonSchemaCredential the issued credential should reference (per VT-CRED-W3C).',
    example: 'https://example.test/schemas/organization-credential.json',
  })
  @IsString()
  @IsNotEmpty()
  credentialSchemaCredentialId!: string

  @ApiProperty({ required: false, type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  credentialContext?: string[]

  @ApiProperty({ required: false, type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  credentialType?: string[]
}
