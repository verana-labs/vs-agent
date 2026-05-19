import { ApiProperty } from '@nestjs/swagger'
import { Claim } from '@verana-labs/vs-agent-model'

export class CredentialExchangeDataDto {
  @ApiProperty({ description: 'Identifier of the credential exchange', example: 'cred-1234-5678' })
  credentialExchangeId!: string

  @ApiProperty({
    description: 'Current credential-exchange state',
    example: 'done',
  })
  state!: string

  @ApiProperty({ description: 'DIDComm thread identifier', example: 'thread-8765-4321' })
  threadId!: string

  @ApiProperty({ description: 'Connection identifier', example: 'conn-1234', required: false })
  connectionId?: string

  @ApiProperty({
    description: 'AnonCreds credential definition identifier (when known)',
    example: 'did:web:issuer.example.com?service=anoncreds&relativeRef=/credDef/abc',
    required: false,
  })
  credentialDefinitionId?: string

  @ApiProperty({
    description: 'AnonCreds schema identifier (when known)',
    required: false,
  })
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
  offerAttributes?: Claim[]

  @ApiProperty({
    description: 'Error message recorded on the exchange (set when state is abandoned/declined)',
    required: false,
  })
  errorMessage?: string

  @ApiProperty({ description: 'Record creation timestamp', type: String, format: 'date-time' })
  createdAt!: string

  @ApiProperty({
    description: 'Timestamp of last update',
    type: String,
    format: 'date-time',
    required: false,
  })
  updatedAt?: string
}
