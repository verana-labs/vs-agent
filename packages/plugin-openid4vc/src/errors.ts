export enum OpenId4VcErrorCode {
  UnknownCredentialType = 'UNKNOWN_CREDENTIAL_TYPE',
  UnknownStatusList = 'UNKNOWN_STATUS_LIST',
  UnknownIssuanceSession = 'UNKNOWN_ISSUANCE_SESSION',
  UnknownVerificationSession = 'UNKNOWN_VERIFICATION_SESSION',
  InvalidCredentialOffer = 'INVALID_CREDENTIAL_OFFER',
  InvalidPresentationRequest = 'INVALID_PRESENTATION_REQUEST',
  RequestSigningKeyNotPublished = 'REQUEST_SIGNING_KEY_NOT_PUBLISHED',
}

export class OpenId4VcError extends Error {
  public constructor(
    public readonly code: OpenId4VcErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'OpenId4VcError'
  }
}
