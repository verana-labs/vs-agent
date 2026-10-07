import { DidCommCredentialRole, DidCommCredentialState } from '@credo-ts/didcomm'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Claim } from '@verana-labs/vs-agent-model'
import { Type } from 'class-transformer'
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator'

import { PageDto, PaginationQueryDto } from '../../../../../common'

/**
 * This class holds one attribute of the credential preview.
 */
export class ClaimDto {
  @ApiProperty({ description: 'Name of the attribute', example: 'phoneNumber' })
  @IsString()
  @IsNotEmpty()
  name!: string

  @ApiProperty({ description: 'Value of the attribute', example: '+57128348520' })
  @IsString()
  value!: string

  @ApiPropertyOptional({ description: 'MIME type of the value', example: 'image/png' })
  @IsOptional()
  @IsString()
  mimeType?: string
}

/**
 * This is the request body of [VSA-ADM-DC-CE-OFFER].
 *
 * A revocable credential definition needs the two revocation fields. Other credential definitions
 * do not need them.
 */
export class CreateCredentialOfferBodyDto {
  @ApiProperty({
    description: 'AnonCreds credential definition identifier',
    example:
      'did:webvh:QmaZYZF4aaHUTWzaKu23TowgvsX7JWfCRgQZX488EAssPQ:dm.chatbot.demos.dev.2060.io/resources/zQmevazUUyXBhGoXJwJNNEqXgvPPQ5WrwTE8G5MdhfWsmxM',
  })
  @IsString()
  @IsNotEmpty()
  credentialDefinitionId!: string

  @ApiProperty({
    type: [ClaimDto],
    description: 'Name and value pairs that preview the attributes of the credential',
  })
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => ClaimDto)
  claims!: ClaimDto[]

  @ApiPropertyOptional({
    description: 'Revocation registry that holds the status of this credential',
    example: 'did:webvh:QmaZYZ:issuer.example.com/resources/zQmRDLcQ3jZvK4PfcDcf3sbvPzV4Ww5X7Sn2pzyHqUrZp2Z',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  revocationRegistryDefinitionId?: string

  @ApiPropertyOptional({
    description: 'Index of this credential in the revocation registry',
    example: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  revocationRegistryIndex?: number

  @ApiPropertyOptional({
    description:
      'An established connection to send the offer on. The agent creates an Out-of-Band ' +
      'invitation when the caller omits it.',
    example: 'conn-1234-5678',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  connectionId?: string

  @ApiPropertyOptional({
    description:
      'Complete the issuer steps without a call: the agent issues the credential on ' +
      '`request-received`, with no `acceptCredentialRequest` call.',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  autoAccept?: boolean

  @ApiPropertyOptional({
    description:
      'Advertise the legacy did:web form when the DID of the agent is did:webvh. The agent ' +
      'ignores it when `connectionId` is present.',
  })
  @IsOptional()
  @IsBoolean()
  useLegacyDid?: boolean

  @ApiPropertyOptional({
    enum: ['v1', 'v2'],
    description:
      "DIDComm envelope version of the invitation. Defaults to 'v2' when omitted. The agent " +
      'ignores it when `connectionId` is present.',
  })
  @IsOptional()
  @IsIn(['v1', 'v2'])
  didcommVersion?: 'v1' | 'v2'
}

/**
 * This is the response of [VSA-ADM-DC-CE-OFFER] createCredentialOffer.
 */
export class CreateCredentialOfferResponseDto {
  @ApiProperty({ description: 'Flow identifier, for later tracking', example: 'cred-1234-5678' })
  credentialExchangeId!: string

  @ApiPropertyOptional({
    description:
      'The Out-of-Band invitation, in the envelope that didcommVersion selects. Absent when the ' +
      'request names a `connectionId`, because the agent sends the offer on that connection.',
    type: 'object',
    additionalProperties: true,
  })
  invitation?: Record<string, unknown>

  @ApiPropertyOptional({
    description:
      'A URL under PUBLIC_API_BASE_URL that resolves to the same invitation, for a QR code. ' +
      'Absent when the request names a `connectionId`.',
    example: 'https://mydomain.com/s?id=abcd',
  })
  shortUrl?: string
}

/**
 * This is the query of [VSA-ADM-DC-CE-LIST] listCredentialExchanges. Each filter is optional,
 * and the specification adds them to the pagination parameters.
 */
export class ListCredentialExchangesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Filter by connection' })
  @IsOptional()
  @IsString()
  connectionId?: string

  @ApiPropertyOptional({ description: 'Filter by DIDComm thread identifier' })
  @IsOptional()
  @IsString()
  threadId?: string

  @ApiPropertyOptional({
    description: 'Filter by the role of the agent in the exchange',
    enum: DidCommCredentialRole,
  })
  @IsOptional()
  @IsEnum(DidCommCredentialRole)
  role?: DidCommCredentialRole

  @ApiPropertyOptional({
    description: 'Filter by credential exchange state',
    enum: DidCommCredentialState,
  })
  @IsOptional()
  @IsEnum(DidCommCredentialState)
  state?: DidCommCredentialState
}

/**
 * This is a credential exchange record. The methods `listCredentialExchanges` and
 * `getCredentialExchange` send this record.
 */
export class CredentialExchangeRecordDto {
  @ApiProperty({ description: 'Identifier of the credential exchange', example: 'cred-1234-5678' })
  credentialExchangeId!: string

  @ApiProperty({ enum: DidCommCredentialState, description: 'Current state of the issuance flow' })
  state!: DidCommCredentialState

  @ApiProperty({ enum: DidCommCredentialRole, description: 'Role of this agent in the exchange' })
  role!: DidCommCredentialRole

  @ApiProperty({ description: 'DIDComm thread identifier', example: 'thread-8765-4321' })
  threadId!: string

  @ApiPropertyOptional({ description: 'Connection identifier', example: 'conn-1234' })
  connectionId?: string

  @ApiPropertyOptional({
    description: 'AnonCreds credential definition identifier, if the agent knows it',
    example:
      'did:webvh:QmaZYZF4aaHUTWzaKu23TowgvsX7JWfCRgQZX488EAssPQ:dm.chatbot.demos.dev.2060.io/resources/zQmevazUUyXBhGoXJwJNNEqXgvPPQ5WrwTE8G5MdhfWsmxM',
  })
  credentialDefinitionId?: string

  @ApiPropertyOptional({ description: 'AnonCreds schema identifier, if the agent knows it' })
  schemaId?: string

  @ApiProperty({
    type: [Object],
    description: 'The offered attributes. The list is empty if the agent cannot read the offer.',
    example: [{ name: 'phoneNumber', value: '+57128348520' }],
  })
  claims!: Claim[]

  @ApiPropertyOptional({
    description: 'Error message on the exchange. The agent sets it if the flow stops.',
  })
  errorMessage?: string

  @ApiProperty({ type: String, format: 'date-time', description: 'When the flow was created' })
  createdAt!: Date

  @ApiProperty({ type: String, format: 'date-time', description: 'When the flow was last updated' })
  updatedAt!: Date
}

export const CredentialExchangeRecordPageDto = PageDto(CredentialExchangeRecordDto)
