export enum AdminApiErrorCode {
  InvalidInput = 'INVALID_INPUT',
  InvalidCursor = 'INVALID_CURSOR',
  Unauthenticated = 'UNAUTHENTICATED',
  Forbidden = 'FORBIDDEN',
  UnknownId = 'UNKNOWN_ID',
  InvalidState = 'INVALID_STATE',
  InvalidPackage = 'INVALID_PACKAGE',
  UnsupportedFormat = 'UNSUPPORTED_FORMAT',
  NotReady = 'NOT_READY',
  Internal = 'INTERNAL',
}

export class AdminApiError extends Error {
  public constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'AdminApiError'
  }
}
