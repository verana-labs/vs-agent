import { HttpClient } from '../http'
import { ChallengeRequest, ChallengeResponse, TokenRequest, TokenResponse } from '../types'

export class AuthApi {
  public constructor(private readonly http: HttpClient) {}

  public challenge(body: ChallengeRequest): Promise<ChallengeResponse> {
    return this.http.request('POST', '/auth/challenge', { body })
  }

  public token(body: TokenRequest): Promise<TokenResponse> {
    return this.http.request('POST', '/auth/token', { body })
  }
}
