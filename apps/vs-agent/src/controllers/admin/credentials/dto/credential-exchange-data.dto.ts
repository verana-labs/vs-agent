import { ApiProperty } from '@nestjs/swagger'
import { Claim } from '@verana-labs/vs-agent-model'
import { IsArray, IsISO8601, IsNotEmpty, IsOptional, IsString } from 'class-validator'

export class CredentialExchangeDataDto {
  @ApiProperty({ description: 'Identifier of the credential exchange', example: 'cred-1234-5678' })
  @IsString()
  @IsNotEmpty()
  credentialExchangeId!: string

  @ApiProperty({
    description: 'Current credential-exchange state',
    example: 'done',
  })
  @IsString()
  @IsNotEmpty()
  state!: string

  @ApiProperty({ description: 'DIDComm thread identifier', example: 'thread-8765-4321' })
  @IsString()
  @IsNotEmpty()
  threadId!: string

  @ApiProperty({ description: 'Connection identifier', example: 'conn-1234', required: false })
  @IsOptional()
  @IsString()
  connectionId?: string

  @ApiProperty({
    description: 'AnonCreds credential definition identifier (when known)',
    example: 'did:web:issuer.example.com?service=anoncreds&relativeRef=/credDef/abc',
    required: false,
  })
  @IsOptional()
  @IsString()
  credentialDefinitionId?: string

  @ApiProperty({
    description: 'AnonCreds schema identifier (when known)',
    required: false,
  })
  @IsOptional()
  @IsString()
  schemaId?: string

  @ApiProperty({
    description: 'Offered credential attributes',
    type: [Object],
    required: false,
    example: [
      { name: 'firstName', value: 'Alice' },
      { name: 'age', value: '30' },
    ],
  })
  @IsOptional()
  @IsArray()
  claims?: Claim[]

  @ApiProperty({
    description: 'Error message recorded on the exchange (set when state is abandoned/declined)',
    required: false,
  })
  @IsOptional()
  @IsString()
  errorMessage?: string

  @ApiProperty({ description: 'Record creation timestamp', type: String, format: 'date-time' })
  @IsISO8601()
  createdAt!: string

  @ApiProperty({
    description: 'Timestamp of last update',
    type: String,
    format: 'date-time',
    required: false,
  })
  @IsOptional()
  @IsISO8601()
  updatedAt?: string
}
