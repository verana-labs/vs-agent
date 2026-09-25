import type { TrustVerdict } from '../trust/types'

import { ClaimFormat } from '@credo-ts/core'

import { isRecord } from '../utils/isRecord'

export interface OpenId4VcVerifiedCredentialResult {
  vct: string
  disclosedClaims: Record<string, unknown>
}

export type PresentationDecision = {
  cryptographicVerified: boolean
  accepted: boolean
  trust?: TrustVerdict
  credential?: OpenId4VcVerifiedCredentialResult
}

export function assertCredentialExpires(credential: unknown): void {
  if (!isRecord(credential) || credential.claimFormat !== ClaimFormat.SdJwtDc) return
  if (!isRecord(credential.payload) || typeof credential.payload.exp !== 'number') {
    throw new Error("the presented SD-JWT VC carries no numeric 'exp' claim")
  }
}
