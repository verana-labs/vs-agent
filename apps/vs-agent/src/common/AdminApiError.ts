import { HttpStatus } from '@nestjs/common'

export enum AdminApiErrorCode {
  InvalidInput = 'INVALID_INPUT',
  InvalidCursor = 'INVALID_CURSOR',
  Unauthenticated = 'UNAUTHENTICATED',
  Forbidden = 'FORBIDDEN',
  UnknownId = 'UNKNOWN_ID',
  InvalidState = 'INVALID_STATE',
  NoCompatibleCredentials = 'NO_COMPATIBLE_CREDENTIALS',
  InvalidPackage = 'INVALID_PACKAGE',
  UnsupportedFormat = 'UNSUPPORTED_FORMAT',
  NotReady = 'NOT_READY',
  ResolverUnavailable = 'RESOLVER_UNAVAILABLE',
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

export function unknownConnection(connectionId: string): AdminApiError {
  return new AdminApiError(
    AdminApiErrorCode.UnknownId,
    HttpStatus.NOT_FOUND,
    `no connection with id "${connectionId}"`,
  )
}
