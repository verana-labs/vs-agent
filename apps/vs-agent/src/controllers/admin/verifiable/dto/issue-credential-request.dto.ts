import { JsonObject } from '@credo-ts/core'
import { ApiProperty } from '@nestjs/swagger'
import {
  IsInt,
  IsNotEmpty,
  IsString,
  IsUrl,
  IsUUID,
  Matches,
  Min,
  IsObject,
  IsOptional,
} from 'class-validator'

/**
 * DTO used to request the issuance of a Verifiable Credential.
 */
export class IssueCredentialRequestDto {
  @ApiProperty({
    description:
      'Format of credential to issue: json-ld (for public entities) or "anoncreds" (for best privacy, usually for end-users)',
    example: 'jsonld',
    enum: ['jsonld', 'anoncreds'],
  })
  @IsString()
  @IsNotEmpty()
  format!: 'jsonld' | 'anoncreds'

  @ApiProperty({
    description: 'DID of the credential subject (the holder)',
    example: 'did:example:holder123',
  })
  @IsString()
  @IsOptional()
  @Matches(/^did:[a-z0-9]+:[a-zA-Z0-9.\-_:/%]+$/, {
    message: 'Invalid DID format',
  })
  did?: string

  @ApiProperty({
    description: 'URL of the JSON Credential Schema that defines the credential structure',
    example: 'https://example.org/schemas/example-service.json',
  })
  @IsString()
  @IsUrl({}, { message: 'json credential schema must be a valid URL' })
  @IsNotEmpty()
  jsonSchemaCredentialId!: string

  @ApiProperty({
    description: 'Credential claims represented as flat key-value pairs',
    example: {
      serviceName: 'Example Service',
      serviceRole: 'Verifier',
      active: true,
    },
  })
  @IsObject()
  @IsNotEmpty()
  claims!: JsonObject

  @ApiProperty({
    description:
      'ParticipantSession uuid supplied by the recipient agent. Required for jsonld: the digest of the signed credential is anchored under this session before the credential is returned.',
    example: 'd7f2f4c6-9c9b-4c39-9e6a-3e1c2a3b4c5d',
    required: false,
  })
  @IsUUID()
  @IsOptional()
  participantSessionId?: string

  @ApiProperty({
    description:
      'Participant id of the agent that will receive the credential. Only when the recipient is a Verifiable User Agent.',
    required: false,
  })
  @IsInt()
  @Min(0)
  @IsOptional()
  agentParticipantId?: number

  @ApiProperty({
    description:
      'Participant id of the wallet agent that will store the credential. Only when the recipient is a Verifiable User Agent.',
    required: false,
  })
  @IsInt()
  @Min(0)
  @IsOptional()
  walletAgentParticipantId?: number
}
