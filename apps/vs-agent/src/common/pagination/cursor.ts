import { createHash } from 'crypto'

import { HttpStatus } from '@nestjs/common'

import { AdminApiError, AdminApiErrorCode } from '../AdminApiError'

/**
 * Increase it when the encoded fields change. The agent then refuses each cursor of an
 * earlier format.
 */
export const CURSOR_FORMAT_VERSION = 1

/**
 * The method and filter set that mint a cursor. Put in `filters` what the caller asked for,
 * not what the data store received: only the first one is stable between calls.
 */
export interface PageScope {
  method: string
  filters?: Record<string, unknown>
}

interface CursorPayload {
  v: number
  s: string
  k: string
}

/**
 * Fingerprints a page scope. It ignores an absent filter, and the order of the filters, so
 * two calls that ask for the same records agree.
 */
export function hashScope(scope: PageScope): string {
  const filters = Object.entries(scope.filters ?? {})
    .filter(([, value]) => value !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
  return createHash('sha256')
    .update(JSON.stringify([scope.method, filters]))
    .digest('hex')
    .slice(0, 16)
}

/**
 * Encodes the key of the last record of a page. The agent keeps no cursor state: the cursor
 * holds all that the next call needs.
 */
export function encodeCursor(scopeHash: string, key: string): string {
  const payload: CursorPayload = { v: CURSOR_FORMAT_VERSION, s: scopeHash, k: key }
  return Buffer.from(JSON.stringify(payload)).toString('base64url')
}

/**
 * Reads the key out of a cursor. It refuses the cursor in three cases only: the cursor is
 * malformed, an earlier format minted it, or the caller replayed it against another scope.
 */
export function decodeCursor(cursor: string, scopeHash: string): string {
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
  } catch {
    throw invalidCursor('the cursor is malformed')
  }

  const { v, s, k } = (parsed ?? {}) as Partial<CursorPayload>
  if (typeof v !== 'number' || typeof s !== 'string' || typeof k !== 'string') {
    throw invalidCursor('the cursor is malformed')
  }
  if (v !== CURSOR_FORMAT_VERSION) {
    throw invalidCursor('the cursor uses a cursor format that this agent no longer accepts')
  }
  if (s !== scopeHash) {
    throw invalidCursor('the cursor was minted by another method or filter set')
  }

  return k
}

function invalidCursor(message: string): AdminApiError {
  return new AdminApiError(AdminApiErrorCode.InvalidCursor, HttpStatus.BAD_REQUEST, message)
}
