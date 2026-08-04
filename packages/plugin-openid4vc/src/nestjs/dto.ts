import type { OpenId4VcQueryLanguage } from '../services/VerifierService'

import { IsIn, IsNotEmpty, IsObject, IsOptional, IsString } from 'class-validator'

export class CreateOpenId4VcOfferDto {
  @IsString()
  @IsNotEmpty()
  credentialConfigurationId!: string

  @IsObject()
  claims!: Record<string, unknown>
}

export class CreateOpenId4VcVerificationRequestDto {
  @IsString()
  @IsNotEmpty()
  policyId!: string

  /** Defaults to DCQL; set to `presentation_exchange` for a wallet that never implemented it. */
  @IsOptional()
  @IsIn(['dcql', 'presentation_exchange'])
  queryLanguage?: OpenId4VcQueryLanguage
}
