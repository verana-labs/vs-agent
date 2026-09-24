import { HttpStatus } from '@nestjs/common'

import { AdminApiError, AdminApiErrorCode } from '../AdminApiError'

import { decodeCursor, encodeCursor, hashScope, PageScope } from './cursor'
import { PAGE_LIMIT_DEFAULT, PAGE_LIMIT_MAX, PAGE_LIMIT_MIN, PaginationQueryDto } from './PaginationQueryDto'

/** One page of a collection. `nextCursor` is null on the last page. */
export interface Page<T> {
  items: T[]
  nextCursor: string | null
}

/**
 * Cuts a page out of a collection with a keyset cursor. `keyOf` must give a unique key that
 * does not change, for example `createdAtKey`.
 */
export function paginate<T>(
  items: readonly T[],
  query: PaginationQueryDto,
  scope: PageScope,
  keyOf: (item: T) => string,
): Page<T> {
  const limit = limitOf(query.limit)
  const scopeHash = hashScope(scope)

  // Key each record once: a comparison sort calls `keyOf` many times for each record.
  const keyed = items.map(item => ({ key: keyOf(item), item }))
  keyed.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))

  assertUniqueKeys(keyed, scope.method)

  // Scan for the first key after the anchor, so a deleted anchor still starts the page correctly.
  let start = 0
  if (query.cursor !== undefined) {
    const anchorKey = decodeCursor(query.cursor, scopeHash)
    const index = keyed.findIndex(entry => entry.key > anchorKey)
    start = index === -1 ? keyed.length : index
  }

  const page = keyed.slice(start, start + limit)
  const hasMore = start + limit < keyed.length

  return {
    items: page.map(entry => entry.item),
    nextCursor: hasMore && page.length > 0 ? encodeCursor(scopeHash, page[page.length - 1].key) : null,
  }
}

/**
 * Pagination key of a record that carries a creation timestamp and an id. The timestamp orders
 * the records, and the id keeps the key unique when two records share a timestamp.
 */
export function createdAtKey(record: { createdAt: Date; id: string }): string {
  return `${record.createdAt.toISOString()}|${record.id}`
}

/**
 * Maps the records of one page. Paginate the records first, then map, when a record costs a
 * store read to become a DTO: the method then reads one page instead of the collection.
 */
export function mapPage<T, U>(page: Page<T>, map: (item: T) => U): Page<U> {
  return { items: page.items.map(map), nextCursor: page.nextCursor }
}

/** `mapPage` for a mapping that reads the store. */
export async function mapPageAsync<T, U>(page: Page<T>, map: (item: T) => Promise<U>): Promise<Page<U>> {
  return { items: await Promise.all(page.items.map(map)), nextCursor: page.nextCursor }
}

/**
 * Refuses a repeated key. The anchor scan would step over each record after the first one that
 * holds the key, and the method would drop those records without an error.
 */
function assertUniqueKeys(keyed: readonly { key: string }[], method: string): void {
  for (let index = 1; index < keyed.length; index++) {
    if (keyed[index].key !== keyed[index - 1].key) continue

    throw new AdminApiError(
      AdminApiErrorCode.Internal,
      HttpStatus.INTERNAL_SERVER_ERROR,
      `${method} gave two records the pagination key "${keyed[index].key}"`,
    )
  }
}

/**
 * Clamps the limit. The value is `unknown` because Nest hands the handler the raw query string,
 * and because an internal caller can pass a raw object that no DTO validated.
 */
function limitOf(limit: unknown): number {
  if (limit === undefined) return PAGE_LIMIT_DEFAULT

  const value = Number(limit)
  if (!Number.isFinite(value)) return PAGE_LIMIT_DEFAULT

  return Math.min(Math.max(Math.trunc(value), PAGE_LIMIT_MIN), PAGE_LIMIT_MAX)
}
