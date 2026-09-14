import { AnonCredsTrustError, AnonCredsTrustErrorReason } from '../blockchain'

const BAD_REQUEST = 400
const NOT_FOUND = 404
const CONFLICT = 409
const SERVICE_UNAVAILABLE = 503

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
  NotAuthorized = 'NOT_AUTHORIZED',
  PeerNotAuthorized = 'PEER_NOT_AUTHORIZED',
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

export function moduleNotServed(module: string): AdminApiError {
  return new AdminApiError(
    AdminApiErrorCode.UnknownId,
    NOT_FOUND,
    `this deployment does not serve the ${module} module`,
  )
}

export function unknownConnection(connectionId: string): AdminApiError {
  return new AdminApiError(AdminApiErrorCode.UnknownId, NOT_FOUND, `no connection with id "${connectionId}"`)
}

export type TrustDecisionSubject = 'agent' | 'peer'

export function trustDecisionError(
  error: unknown,
  subject: TrustDecisionSubject,
  notDerivableCode?: AdminApiErrorCode,
): unknown {
  if (!(error instanceof AnonCredsTrustError)) return error

  if (error.reason === AnonCredsTrustErrorReason.Unavailable) {
    return new AdminApiError(AdminApiErrorCode.ResolverUnavailable, SERVICE_UNAVAILABLE, error.message)
  }

  const unauthorizedCode =
    subject === 'peer' ? AdminApiErrorCode.PeerNotAuthorized : AdminApiErrorCode.NotAuthorized

  if (error.reason === AnonCredsTrustErrorReason.NotAuthorized) {
    return new AdminApiError(unauthorizedCode, CONFLICT, error.message)
  }

  const code = notDerivableCode ?? unauthorizedCode

  return new AdminApiError(
    code,
    code === AdminApiErrorCode.InvalidInput ? BAD_REQUEST : CONFLICT,
    error.message,
  )
}
