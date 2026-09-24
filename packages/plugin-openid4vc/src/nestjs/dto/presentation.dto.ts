import type { OpenId4VcQueryLanguage } from '../../services/presentationRequest'
import type { OpenId4VcRequestSigner } from '../../services/VerifierService'
import type { TrustVerdictName, VeranaTrustStatus } from '../../trust/types'

import { OpenId4VcVerificationSessionState } from '@credo-ts/openid4vc'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { PageDto, PaginationQueryDto } from '@verana-labs/vs-agent-sdk'
import { ArrayUnique, IsArray, IsEnum, IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator'

import { OPENID4VC_QUERY_LANGUAGES } from '../../services/presentationRequest'
import { OPENID4VC_REQUEST_SIGNERS } from '../../services/VerifierService'
import { TRUST_VERDICT_NAMES, VERANA_TRUST_STATUSES } from '../../trust/types'

/** Request body of [VSA-ADM-OID-PR] createPresentationRequest. */
export class OpenId4VcCreatePresentationRequestBodyDto {
  @ApiProperty({
    description:
      'Credential type the request asks for. The agent derives no credential type yet, so every identifier answers UNKNOWN_ID.',
    example: 'employee',
  })
  @IsString()
  @IsNotEmpty()
  jsonSchemaCredentialId!: string

  @ApiPropertyOptional({
    type: [String],
    description:
      'Claim names the request asks the wallet to disclose, without a duplicate. Defaults to every claim of the type.',
    example: ['name', 'role'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @ArrayUnique()
  requestedClaims?: string[]

  @ApiPropertyOptional({
    enum: OPENID4VC_QUERY_LANGUAGES,
    description:
      'Query language of the request. Defaults to dcql; presentation_exchange serves a wallet that never implemented DCQL.',
  })
  @IsOptional()
  @IsIn(OPENID4VC_QUERY_LANGUAGES)
  queryLanguage?: OpenId4VcQueryLanguage

  @ApiPropertyOptional({
    enum: OPENID4VC_REQUEST_SIGNERS,
    description:
      'Signer of this request only. x5c yields an x509_hash client identifier for a wallet that cannot resolve a DID.',
  })
  @IsOptional()
  @IsIn(OPENID4VC_REQUEST_SIGNERS)
  requestSigner?: OpenId4VcRequestSigner
}

/** Response of [VSA-ADM-OID-PR] createPresentationRequest. */
export class OpenId4VcPresentationRequestResponseDto {
  @ApiProperty({
    description: 'Identifier of the verification session, for later tracking',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  proofExchangeId!: string

  @ApiProperty({
    description: 'Authorization request URI, ready to render as a QR code or to send as a link',
    example:
      'openid4vp://authorize?request_uri=https%3A%2F%2Fagent.example%2Foid4vp%2Fverifier%2Fauthorization-requests%2F1',
  })
  url!: string
}

/** Query of [VSA-ADM-OID-PR] listPresentations. */
export class OpenId4VcListPresentationsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Filter by credential type', example: 'employee' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  jsonSchemaCredentialId?: string

  @ApiPropertyOptional({
    enum: OpenId4VcVerificationSessionState,
    description: 'Filter by verification session state',
  })
  @IsOptional()
  @IsEnum(OpenId4VcVerificationSessionState)
  state?: OpenId4VcVerificationSessionState
}

/** What the agent read from the resolver to reach a trust verdict on a presentation. */
export class OpenId4VcTrustEvidenceDto {
  @ApiProperty({ type: String, nullable: true, description: 'DID of the issuer, read from the certificate' })
  did!: string | null

  @ApiProperty({
    enum: VERANA_TRUST_STATUSES,
    nullable: true,
    description: 'Trust status the resolver returned',
  })
  trustStatus!: VeranaTrustStatus | null

  @ApiProperty({ type: String, nullable: true, description: 'Credential type of the request' })
  jsonSchemaCredentialId!: string | null

  @ApiProperty({
    type: Boolean,
    nullable: true,
    description: 'Whether the resolver authorizes the issuer for the credential type',
  })
  authorized!: boolean | null

  @ApiProperty({ type: [String], description: 'Resolver queries the agent ran' })
  queries!: string[]

  @ApiPropertyOptional({ description: 'Why the verdict was not TRUSTED_AUTHORIZED' })
  note?: string
}

/** The trust verdict on a presentation, on the record of [VSA-ADM-OID-PR] getPresentation. */
export class OpenId4VcTrustVerdictDto {
  @ApiProperty({ enum: TRUST_VERDICT_NAMES, description: 'The trust verdict' })
  verdict!: TrustVerdictName

  @ApiProperty({ type: OpenId4VcTrustEvidenceDto, description: 'The basis of the verdict' })
  evidence!: OpenId4VcTrustEvidenceDto
}

/** The credential a wallet presented, on the record of [VSA-ADM-OID-PR] getPresentation. */
export class OpenId4VcPresentedCredentialDto {
  @ApiProperty({
    description: 'SD-JWT VC type of the presented credential',
    example: 'https://agent.example/oid4vc/vct/employee',
  })
  vct!: string

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description: 'The claims the wallet disclosed',
    example: { name: 'Ada Lovelace' },
  })
  disclosedClaims!: Record<string, unknown>
}

/** A presentation record, as returned by listPresentations and getPresentation. */
export class OpenId4VcPresentationRecordDto {
  @ApiProperty({
    description: 'Identifier of the verification session',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  proofExchangeId!: string

  @ApiPropertyOptional({ description: 'Credential type of the request', example: 'employee' })
  jsonSchemaCredentialId?: string

  @ApiPropertyOptional({
    type: [String],
    description: 'Claim names the request asked for',
    example: ['name', 'role'],
  })
  requestedClaims?: string[]

  @ApiProperty({ enum: OpenId4VcVerificationSessionState, description: 'State of the verification session' })
  state!: OpenId4VcVerificationSessionState

  @ApiProperty({ type: String, format: 'date-time', description: 'When the agent created the request' })
  createdAt!: Date

  @ApiProperty({ type: String, format: 'date-time', description: 'When the session last changed' })
  updatedAt!: Date

  @ApiPropertyOptional({ description: 'Error message on the session. The agent sets it if the flow stops.' })
  errorMessage?: string

  @ApiProperty({
    description: 'True once the agent verified the response, the holder binding, the signature and the chain',
  })
  cryptographicVerified!: boolean

  @ApiProperty({ description: 'True only for the verdict TRUSTED_AUTHORIZED' })
  accepted!: boolean

  @ApiPropertyOptional({
    type: OpenId4VcTrustVerdictDto,
    description: 'The trust verdict, once the agent verified the response',
  })
  trust?: OpenId4VcTrustVerdictDto

  @ApiPropertyOptional({
    type: OpenId4VcPresentedCredentialDto,
    description: 'The presented credential, once verified',
  })
  credential?: OpenId4VcPresentedCredentialDto
}

export const OpenId4VcPresentationRecordPageDto = PageDto(OpenId4VcPresentationRecordDto)
