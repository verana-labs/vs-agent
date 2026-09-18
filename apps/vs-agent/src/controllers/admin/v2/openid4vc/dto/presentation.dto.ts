import type { TrustVerdictName, VeranaTrustStatus } from '@verana-labs/vs-agent-plugin-openid4vc'

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { OpenId4VcVerificationSessionState } from '@verana-labs/vs-agent-plugin-openid4vc'
import { IsEnum, IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator'

import { PageDto, PaginationQueryDto } from '../../../../../common'

const QUERY_LANGUAGES = ['dcql', 'presentation_exchange'] as const
const REQUEST_SIGNERS = ['x5c', 'did'] as const
const VERDICTS = [
  'TRUSTED_AUTHORIZED',
  'TRUSTED_NOT_AUTHORIZED',
  'UNTRUSTED',
  'RESOLVER_UNAVAILABLE',
] as const
const TRUST_STATUSES = ['TRUSTED', 'PARTIAL', 'UNTRUSTED'] as const

export class Openid4vcPresentationRequestBodyDto {
  @ApiProperty({
    description: 'Identifier of a verifier policy of the OpenID4VC configuration file',
    example: 'employee-check',
  })
  @IsString()
  @IsNotEmpty()
  policyId!: string

  @ApiPropertyOptional({
    enum: QUERY_LANGUAGES,
    description:
      'Query language of the request. Defaults to dcql; presentation_exchange serves a wallet that never implemented DCQL.',
  })
  @IsOptional()
  @IsIn(QUERY_LANGUAGES)
  queryLanguage?: (typeof QUERY_LANGUAGES)[number]

  @ApiPropertyOptional({
    enum: REQUEST_SIGNERS,
    description:
      'Signer of this request only. x5c yields an x509_hash client identifier for a wallet that cannot resolve a DID.',
  })
  @IsOptional()
  @IsIn(REQUEST_SIGNERS)
  requestSigner?: (typeof REQUEST_SIGNERS)[number]
}

export class Openid4vcPresentationRequestResponseDto {
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

export class Openid4vcListPresentationsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Filter by verifier policy', example: 'employee-check' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  policyId?: string

  @ApiPropertyOptional({
    enum: OpenId4VcVerificationSessionState,
    description: 'Filter by verification session state',
  })
  @IsOptional()
  @IsEnum(OpenId4VcVerificationSessionState)
  state?: OpenId4VcVerificationSessionState
}

export class Openid4vcTrustEvidenceDto {
  @ApiProperty({ type: String, nullable: true, description: 'DID of the issuer, read from the certificate' })
  did!: string | null

  @ApiProperty({ enum: TRUST_STATUSES, nullable: true, description: 'Trust status the resolver returned' })
  trustStatus!: VeranaTrustStatus | null

  @ApiProperty({ type: String, nullable: true, description: 'VTJSC of the credential configuration' })
  vtjscId!: string | null

  @ApiProperty({
    type: Boolean,
    nullable: true,
    description: 'Whether the resolver authorizes the issuer for the VTJSC',
  })
  authorized!: boolean | null

  @ApiProperty({ type: [String], description: 'Resolver queries the agent ran' })
  queries!: string[]

  @ApiPropertyOptional({ description: 'Why the verdict was not TRUSTED_AUTHORIZED' })
  note?: string
}

export class Openid4vcTrustVerdictDto {
  @ApiProperty({ enum: VERDICTS, description: 'The trust verdict' })
  verdict!: TrustVerdictName

  @ApiProperty({ type: Openid4vcTrustEvidenceDto, description: 'The basis of the verdict' })
  evidence!: Openid4vcTrustEvidenceDto
}

export class Openid4vcPresentedCredentialDto {
  @ApiProperty({
    description: 'SD-JWT VC type of the presented credential',
    example: 'https://agent.example/oid4vc/vct/employee',
  })
  vct!: string

  @ApiProperty({
    type: Object,
    description: 'The claims the wallet disclosed',
    example: { name: 'Ada Lovelace' },
  })
  disclosedClaims!: Record<string, unknown>
}

export class Openid4vcPresentationRecordDto {
  @ApiProperty({
    description: 'Identifier of the verification session',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  proofExchangeId!: string

  @ApiPropertyOptional({ description: 'Verifier policy of the request', example: 'employee-check' })
  policyId?: string

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
    type: Openid4vcTrustVerdictDto,
    description: 'The trust verdict, once the agent verified the response',
  })
  trust?: Openid4vcTrustVerdictDto

  @ApiPropertyOptional({
    type: Openid4vcPresentedCredentialDto,
    description: 'The presented credential, once verified',
  })
  credential?: Openid4vcPresentedCredentialDto
}

export const Openid4vcPresentationRecordPageDto = PageDto(Openid4vcPresentationRecordDto)
