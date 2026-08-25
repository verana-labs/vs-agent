import { createHash } from 'crypto'

import { HttpStatus } from '@nestjs/common'
import { ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator'

import { AdminApiError, AdminApiErrorCode } from './AdminApiError'

export const PAGE_LIMIT_DEFAULT = 100
export const PAGE_LIMIT_MAX = 500

export class PaginationQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: PAGE_LIMIT_MAX, default: PAGE_LIMIT_DEFAULT })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(PAGE_LIMIT_MAX)
  limit?: number

  @ApiPropertyOptional({ description: 'Opaque cursor returned by the previous call.' })
  @IsOptional()
  @IsString()
  cursor?: string
}

export interface Page<T> {
  items: T[]
  nextCursor: string | null
}

export interface PageScope {
  method: string
  filters?: Record<string, unknown>
}

// Keyset pagination over a deterministically ordered collection. The cursor names the
// ordering key of the last delivered item and is bound to the method + filter set that
// minted it, so a replay against another sequence is rejected with INVALID_CURSOR.
export function paginate<T>(
  items: readonly T[],
  query: PaginationQueryDto,
  scope: PageScope,
  keyOf: (item: T) => string,
): Page<T> {
  const limit = query.limit === undefined ? PAGE_LIMIT_DEFAULT : Number(query.limit)
  const scopeHash = hashScope(scope)
  const sorted = [...items].sort((a, b) => (keyOf(a) < keyOf(b) ? -1 : keyOf(a) > keyOf(b) ? 1 : 0))

  let start = 0
  if (query.cursor !== undefined) {
    const anchorKey = decodeCursor(query.cursor, scopeHash)
    start = sorted.findIndex(item => keyOf(item) > anchorKey)
    if (start === -1) start = sorted.length
  }

  const page = sorted.slice(start, start + limit)
  const hasMore = start + limit < sorted.length
  const nextCursor = hasMore && page.length > 0 ? encodeCursor(scopeHash, keyOf(page[page.length - 1])) : null
  return { items: page, nextCursor }
}

function hashScope(scope: PageScope): string {
  const filters = Object.entries(scope.filters ?? {})
    .filter(([, value]) => value !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
  return createHash('sha256')
    .update(JSON.stringify([scope.method, filters]))
    .digest('hex')
    .slice(0, 16)
}

function encodeCursor(scopeHash: string, key: string): string {
  return Buffer.from(JSON.stringify({ s: scopeHash, k: key })).toString('base64url')
}

function decodeCursor(cursor: string, scopeHash: string): string {
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
  } catch {
    throw invalidCursor('the cursor is malformed')
  }
  const { s, k } = (parsed ?? {}) as { s?: unknown; k?: unknown }
  if (typeof s !== 'string' || typeof k !== 'string') throw invalidCursor('the cursor is malformed')
  if (s !== scopeHash) {
    throw invalidCursor('the cursor was minted by another method or filter set')
  }
  return k
}

function invalidCursor(message: string): AdminApiError {
  return new AdminApiError(AdminApiErrorCode.InvalidCursor, HttpStatus.BAD_REQUEST, message)
}
