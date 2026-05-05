import { ApiProperty } from '@nestjs/swagger'
import { IsNotEmpty, IsString } from 'class-validator'

export class ValidateFlowDto {
  @ApiProperty({
    description:
      'Identifier of the JsonSchemaCredential the issued credential should reference (per VT-CRED-W3C).',
    example: 'https://localhost:3001/vt/schemas-organization-jsc.json',
  })
  @IsString()
  @IsNotEmpty()
  credentialSchemaCredentialId!: string
}
