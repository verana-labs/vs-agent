import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { describe, expect, it } from 'vitest'

import {
  PAGE_LIMIT_DEFAULT,
  PAGE_LIMIT_MAX,
  PAGE_LIMIT_MIN,
  Page,
  PageDto,
  PaginationQueryDto,
  mapPage,
  mapPageAsync,
  paginate,
} from '../src/common'

interface Row {
  id: string
}

const rows = (...ids: string[]): Row[] => ids.map(id => ({ id }))
const idOf = (row: Row) => row.id

const pageOf = (items: Row[], query: PaginationQueryDto, filters?: Record<string, unknown>) =>
  paginate(items, query, { method: 'listThings', filters }, idOf)

// Reads the cursor of a page that must have one, and fails the test when the page has none.
const nextCursor = (page: Page<Row>): string => {
  expect(page.nextCursor).not.toBeNull()
  return page.nextCursor as string
}

// The caller must treat a cursor as opaque. A test may read it to confirm what it holds.
const payloadOf = (cursor: string) => JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
const cursorOf = (payload: unknown) => Buffer.from(JSON.stringify(payload)).toString('base64url')

// A query string reaches the handler unconverted, so validation runs on the string form.
const validateQuery = (query: Record<string, string>) => validate(plainToInstance(PaginationQueryDto, query))

describe('pagination', () => {
  describe('limit', () => {
    it('delivers 100 records when the caller names no limit', async () => {
      const many = rows(...Array.from({ length: 150 }, (_, i) => `r-${String(i).padStart(3, '0')}`))

      expect(pageOf(many, {}).items).toHaveLength(PAGE_LIMIT_DEFAULT)
    })

    it('accepts a limit on each bound and refuses a limit outside them', async () => {
      expect(await validateQuery({ limit: String(PAGE_LIMIT_MIN) })).toHaveLength(0)
      expect(await validateQuery({ limit: String(PAGE_LIMIT_MAX) })).toHaveLength(0)

      expect(await validateQuery({ limit: String(PAGE_LIMIT_MIN - 1) })).not.toHaveLength(0)
      expect(await validateQuery({ limit: String(PAGE_LIMIT_MAX + 1) })).not.toHaveLength(0)
    })

    it('clamps a limit that reached the primitive without validation', () => {
      expect(pageOf(rows('a', 'b', 'c'), { limit: 0 }).items).toHaveLength(PAGE_LIMIT_MIN)
    })
  })

  describe('envelope', () => {
    it('returns items and nextCursor, and nothing else', () => {
      const page = pageOf(rows('a', 'b', 'c'), { limit: 2 })

      expect(Object.keys(page).sort()).toEqual(['items', 'nextCursor'])
      expect(page.items.map(idOf)).toEqual(['a', 'b'])
    })

    it('sets nextCursor to null on the last page', () => {
      const first = pageOf(rows('a', 'b', 'c'), { limit: 2 })
      expect(first.nextCursor).not.toBeNull()

      const last = pageOf(rows('a', 'b', 'c'), { limit: 2, cursor: nextCursor(first) })
      expect(last.items.map(idOf)).toEqual(['c'])
      expect(last.nextCursor).toBeNull()
    })

    it('sets nextCursor to null when one page holds the whole collection', () => {
      expect(pageOf(rows('a', 'b'), { limit: 2 }).nextCursor).toBeNull()
    })

    it('returns an empty page when every record up to the anchor is gone', () => {
      // The cursor anchors on "b", and the collection then ends on "b".
      const anchored = pageOf(rows('a', 'b', 'c'), { limit: 2 })

      const page = pageOf(rows('a', 'b'), { limit: 2, cursor: nextCursor(anchored) })

      expect(page.items).toEqual([])
      expect(page.nextCursor).toBeNull()
    })
  })

  describe('cursor', () => {
    it('holds the last key of the page and the fingerprint of the scope, and no expiry', () => {
      const cursor = nextCursor(pageOf(rows('a', 'b', 'c'), { limit: 2 }))

      expect(payloadOf(cursor)).toEqual({ v: expect.any(Number), s: expect.any(String), k: 'b' })
    })

    it('keeps no state between calls: one input always mints one cursor', () => {
      expect(pageOf(rows('a', 'b'), { limit: 1 }).nextCursor).toBe(
        pageOf(rows('a', 'b'), { limit: 1 }).nextCursor,
      )
    })
  })

  describe('iteration', () => {
    it('walks the whole collection and ends on a null cursor', () => {
      const all = rows('a', 'b', 'c', 'd', 'e')
      const seen: string[] = []

      let cursor: string | null | undefined
      do {
        const page = pageOf(all, { limit: 2, cursor: cursor ?? undefined })
        seen.push(...page.items.map(idOf))
        cursor = page.nextCursor
      } while (cursor)

      expect(seen).toEqual(['a', 'b', 'c', 'd', 'e'])
    })

    it('delivers a record inserted mid-iteration in a later page', () => {
      const first = pageOf(rows('a', 'b', 'c', 'd'), { limit: 2 })
      expect(first.items.map(idOf)).toEqual(['a', 'b'])

      // Another caller adds "b5" after the anchor while the caller holds the cursor.
      const second = pageOf(rows('a', 'b', 'b5', 'c', 'd'), { limit: 2, cursor: nextCursor(first) })

      expect(second.items.map(idOf)).toEqual(['b5', 'c'])
    })

    it('does not deliver a record inserted mid-iteration before the anchor', () => {
      const first = pageOf(rows('b', 'c', 'd'), { limit: 1 })
      expect(first.items.map(idOf)).toEqual(['b'])

      // "a" sorts before the anchor, so this iteration never reaches it. A keyset cursor walks
      // forward only.
      const second = pageOf(rows('a', 'b', 'c', 'd'), { limit: 2, cursor: nextCursor(first) })

      expect(second.items.map(idOf)).toEqual(['c', 'd'])
    })

    it('continues without an error when another caller deleted the anchor record', () => {
      const first = pageOf(rows('a', 'b', 'c', 'd'), { limit: 2 })
      expect(payloadOf(nextCursor(first)).k).toBe('b')

      // The anchor "b" is gone before the caller asks for the next page.
      const second = pageOf(rows('a', 'c', 'd'), { limit: 2, cursor: nextCursor(first) })

      expect(second.items.map(idOf)).toEqual(['c', 'd'])
      expect(second.nextCursor).toBeNull()
    })

    it('stops delivering a record that another caller deleted', () => {
      const first = pageOf(rows('a', 'b', 'c', 'd'), { limit: 2 })

      const second = pageOf(rows('a', 'b', 'd'), { limit: 2, cursor: nextCursor(first) })

      expect(second.items.map(idOf)).toEqual(['d'])
    })
  })

  describe('INVALID_CURSOR', () => {
    it('refuses a malformed cursor', () => {
      expect(() => pageOf(rows('a'), { cursor: 'zzz' })).toThrow(/malformed/)
      expect(() => pageOf(rows('a'), { cursor: cursorOf({ k: 'a' }) })).toThrow(/malformed/)
    })

    it('refuses a cursor that an earlier format minted', () => {
      const cursor = nextCursor(pageOf(rows('a', 'b'), { limit: 1 }))
      const stale = cursorOf({ ...payloadOf(cursor), v: payloadOf(cursor).v - 1 })

      expect(() => pageOf(rows('a', 'b'), { limit: 1, cursor: stale })).toThrow(/format/)
    })

    it('refuses a cursor replayed against a different filter set', () => {
      const first = pageOf(rows('a', 'b', 'c'), { limit: 1 }, { state: 'done' })

      expect(() =>
        pageOf(rows('a', 'b', 'c'), { limit: 1, cursor: nextCursor(first) }, { state: 'open' }),
      ).toThrow(/another method or filter set/)
    })

    it('refuses a cursor replayed against a different method', () => {
      const first = pageOf(rows('a', 'b', 'c'), { limit: 1 })

      expect(() =>
        paginate(
          rows('a', 'b', 'c'),
          { limit: 1, cursor: nextCursor(first) },
          { method: 'listOthers' },
          idOf,
        ),
      ).toThrow(/another method or filter set/)
    })

    it('accepts a cursor when an absent filter is spelled out, and when the filters are reordered', () => {
      const first = paginate(
        rows('a', 'b', 'c'),
        { limit: 1 },
        { method: 'listThings', filters: { state: 'done', role: undefined } },
        idOf,
      )

      const second = paginate(
        rows('a', 'b', 'c'),
        { limit: 1, cursor: nextCursor(first) },
        { method: 'listThings', filters: { state: 'done' } },
        idOf,
      )

      expect(second.items.map(idOf)).toEqual(['b'])
    })

    it('accepts a cursor whose key no longer names a record', () => {
      const first = pageOf(rows('a', 'b', 'c'), { limit: 1 })

      expect(() => pageOf(rows('b', 'c'), { limit: 1, cursor: nextCursor(first) })).not.toThrow()
    })
  })

  describe('guards', () => {
    it('refuses a repeated key instead of dropping the record it names', () => {
      expect(() => pageOf(rows('a', 'a', 'b'), {})).toThrow(/two records the pagination key "a"/)
    })

    it('refuses two record types that map to one page model', () => {
      class WidgetDto {}
      const clash = class {}
      Object.defineProperty(clash, 'name', { value: 'WidgetDto' })

      expect(PageDto(WidgetDto).name).toBe('WidgetPageDto')
      expect(PageDto(WidgetDto)).toBe(PageDto(WidgetDto))
      expect(() => PageDto(clash)).toThrow(/both map to the page model "WidgetPageDto"/)
    })
  })

  describe('mapPage', () => {
    it('maps the records of the page and keeps the cursor', async () => {
      const page = pageOf(rows('a', 'b', 'c'), { limit: 2 })

      expect(mapPage(page, idOf)).toEqual({ items: ['a', 'b'], nextCursor: page.nextCursor })
      await expect(mapPageAsync(page, async row => idOf(row))).resolves.toEqual({
        items: ['a', 'b'],
        nextCursor: page.nextCursor,
      })
    })
  })
})
