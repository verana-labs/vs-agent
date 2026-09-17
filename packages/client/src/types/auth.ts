export interface ChallengeRequest {
  account: string
}

export interface ChallengeResponse {
  nonce: string
  expiresAt: string
}

export interface TokenRequest {
  account: string
  pubKey: string
  signature: string
  nonce: string
}

export interface TokenResponse {
  token: string
  expiresAt: string
}
