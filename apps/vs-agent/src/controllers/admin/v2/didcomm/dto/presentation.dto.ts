import { DidCommProofState } from '@credo-ts/didcomm'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Claim, RequestedCredential } from '@verana-labs/vs-agent-model'
import { Type } from 'class-transformer'
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUrl,
  ValidateNested,
} from 'class-validator'

import { PaginationQueryDto } from '../../../../../common'

/**
 * One entry of `requestedCredentials`: the credential the holder is asked to present, and the
 * attributes asked of it. The credential is named either by `credentialDefinitionId` (AnonCreds)
 * or by `jsonSchemaCredentialId` (JSON Schema Credential) — never by both.
 */
export class RequestedCredentialDto implements RequestedCredential {
  @ApiPropertyOptional({
    description: 'AnonCreds credential definition the presentation is restricted to',
    example:
      'did:webvh:QmaZYZF4aaHUTWzaKu23TowgvsX7JWfCRgQZX488EAssPQ:dm.chatbot.demos.dev.2060.io/resources/zQmevazUUyXBhGoXJwJNNEqXgvPPQ5WrwTE8G5MdhfWsmxM',
  })
  @IsOptional()
  @IsString()
  credentialDefinitionId?: string

  @ApiPropertyOptional({
    description: 'JSON Schema Credential the presentation is restricted to',
    example: 'https://dm.gov-id-tr.demos.dev.2060.io/vt/schemas-gov-id-jsc.json',
  })
  @IsOptional()
  @IsString()
  jsonSchemaCredentialId?: string

  @ApiPropertyOptional({
    type: [String],
    description: 'Attributes asked of this credential. Every attribute of the schema when omitted.',
    example: ['firstName', 'lastName'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  attributes?: string[]
}

/**
 * Request body of [VSA-ADM-DC-PR-CREATE] createPresentationRequest
 */
export class CreatePresentationRequestBodyDto {
  @ApiProperty({
    type: [RequestedCredentialDto],
    description: 'The credentials, and the attributes of them, that the holder is asked to present',
  })
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => RequestedCredentialDto)
  requestedCredentials!: RequestedCredentialDto[]

  @ApiPropertyOptional({
    description: 'URL the agent POSTs to when the presentation flow completes',
    example: 'https://myhost.com/presentation_callback',
  })
  @IsOptional()
  @IsUrl({ require_tld: false })
  callbackUrl?: string

  @ApiPropertyOptional({
    description: 'Correlation identifier of the caller, echoed back in the callback',
    example: '1234-5678',
  })
  @IsOptional()
  @IsString()
  ref?: string

  @ApiPropertyOptional({
    description: 'Ask the holder for a non-revocation proof at verification time',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  requireNonRevocation?: boolean

  @ApiPropertyOptional({
    description: 'Advertise the legacy did:web form when the DID of the agent is did:webvh',
  })
  @IsOptional()
  @IsBoolean()
  useLegacyDid?: boolean

  @ApiPropertyOptional({
    enum: ['v1', 'v2'],
    description: "DIDComm envelope version of the invitation. Defaults to 'v2' when omitted.",
  })
  @IsOptional()
  @IsIn(['v1', 'v2'])
  didcommVersion?: 'v1' | 'v2'
}

/**
 * Response of [VSA-ADM-DC-PR-CREATE] createPresentationRequest
 */
export class CreatePresentationRequestResponseDto {
  @ApiProperty({ description: 'Flow identifier, for later tracking', example: 'proof-1234-5678' })
  proofExchangeId!: string

  @ApiProperty({ description: 'Full DIDComm invitation URL', example: 'didcomm://example.com/...' })
  url!: string

  @ApiProperty({
    description: 'Short form of the URL, for a QR code',
    example: 'https://mydomain.com/s?id=abcd',
  })
  shortUrl!: string
}

/**
 * Query of [VSA-ADM-DC-PR-LIST] listPresentations. The spec defines no filter beyond pagination.
 */
export class ListPresentationsQueryDto extends PaginationQueryDto {}

/**
 * A presentation exchange record, as returned by listPresentations and getPresentation.
 */
export class PresentationRecordDto {
  @ApiProperty({ description: 'Identifier of the proof exchange', example: 'proof-1234-5678' })
  proofExchangeId!: string

  @ApiProperty({ enum: DidCommProofState, description: 'Current state of the presentation flow' })
  state!: DidCommProofState

  @ApiProperty({
    type: [RequestedCredentialDto],
    description: 'The credentials, and attributes of them, that this flow asked for',
  })
  requestedCredentials!: RequestedCredential[]

  @ApiProperty({
    type: [Object],
    description: 'The claims revealed by the presentation. Empty until the holder answers.',
    example: [{ name: 'firstName', value: 'Alice' }],
  })
  claims!: Claim[]

  @ApiProperty({
    description: 'Whether the presentation verified. Only meaningful once `state` is `done`.',
    example: true,
  })
  verified!: boolean

  @ApiPropertyOptional({ description: 'DIDComm thread identifier', example: 'thread-8765-4321' })
  threadId?: string

  @ApiProperty({ type: String, format: 'date-time', description: 'When the flow was created' })
  createdAt!: Date

  @ApiProperty({ type: String, format: 'date-time', description: 'When the flow was last updated' })
  updatedAt!: Date
}

export class PresentationRecordPageDto {
  @ApiProperty({ type: [PresentationRecordDto] })
  items!: PresentationRecordDto[]

  @ApiProperty({ type: String, nullable: true })
  nextCursor!: string | null
}
