import { decodeCursor, encodeCursor, hashScope, PageScope } from './cursor'
import { PAGE_LIMIT_DEFAULT, PAGE_LIMIT_MAX, PAGE_LIMIT_MIN, PaginationQueryDto } from './PaginationQueryDto'

/** One page of a collection. `nextCursor` is null on the last page. */
export interface Page<T> {
  items: T[]
  nextCursor: string | null
}

/**
 * Cuts a page out of a collection with a keyset cursor. `keyOf` must give a unique key that
 * does not change, for example `${createdAt.toISOString()}|${id}`.
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
 * Clamps the limit. The DTO validates an HTTP caller, but an internal caller can pass a raw
 * object.
 */
function limitOf(limit: number | undefined): number {
  if (limit === undefined) return PAGE_LIMIT_DEFAULT

  const value = Number(limit)
  if (!Number.isFinite(value)) return PAGE_LIMIT_DEFAULT

  return Math.min(Math.max(Math.trunc(value), PAGE_LIMIT_MIN), PAGE_LIMIT_MAX)
}
