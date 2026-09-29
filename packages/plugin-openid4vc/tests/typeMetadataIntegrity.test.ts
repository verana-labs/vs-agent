import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { digestOfBytes } from '@verana-labs/vs-agent-sdk'

import { createTypeMetadataIntegrity, FAILURE_CACHE_MS } from '../src/services/typeMetadataIntegrity'

const URL_ONE = 'https://ecosystem.example/vt/vct/1'
const URL_TWO = 'https://ecosystem.example/vt/vct/2'
const TYPE_METADATA = JSON.stringify({ vct: URL_ONE, name: 'Employee credential' })

let servedBody: string | Uint8Array
let served: ReturnType<typeof vi.fn>

describe('createTypeMetadataIntegrity', () => {
  beforeEach(() => {
    servedBody = TYPE_METADATA
    served = vi.fn(async (url: string) =>
      url === URL_ONE
        ? new Response(servedBody, { headers: { 'content-type': 'application/json; charset=utf-8' } })
        : new Response('', { status: 404, statusText: 'Not Found' }),
    )
    vi.stubGlobal('fetch', served)
  })

  afterEach(() => vi.unstubAllGlobals())

  it('digests the exact bytes the Type Metadata URL served', async () => {
    const integrity = createTypeMetadataIntegrity()

    await expect(integrity.digest(URL_ONE)).resolves.toBe(digestOfBytes(TYPE_METADATA))
  })

  it('digests a BOM as served instead of digesting the decoded document', async () => {
    servedBody = Buffer.from(`﻿${TYPE_METADATA}`, 'utf8')
    const integrity = createTypeMetadataIntegrity()

    const digest = await integrity.digest(URL_ONE)

    expect(digest).toBe(digestOfBytes(servedBody))
    expect(digest).not.toBe(digestOfBytes(TYPE_METADATA))
  })

  it('serves a second call from the cache without a second request', async () => {
    const integrity = createTypeMetadataIntegrity()

    const first = await integrity.digest(URL_ONE)
    const second = await integrity.digest(URL_ONE)

    expect(second).toBe(first)
    expect(served).toHaveBeenCalledOnce()
  })

  it('re-reads the document after an invalidation and yields the new digest', async () => {
    const integrity = createTypeMetadataIntegrity()
    const first = await integrity.digest(URL_ONE)
    servedBody = JSON.stringify({ vct: URL_ONE, name: 'Employee credential v2' })

    integrity.invalidate(URL_ONE)
    const second = await integrity.digest(URL_ONE)

    expect(second).toBe(digestOfBytes(servedBody))
    expect(second).not.toBe(first)
    expect(served).toHaveBeenCalledTimes(2)
  })

  it('keeps the cached digest of a document the invalidation did not name', async () => {
    const integrity = createTypeMetadataIntegrity()
    const first = await integrity.digest(URL_ONE)
    servedBody = JSON.stringify({ vct: URL_ONE, name: 'Employee credential v2' })

    integrity.invalidate(URL_TWO)

    expect(await integrity.digest(URL_ONE)).toBe(first)
    expect(served).toHaveBeenCalledOnce()
  })

  it('answers a failed read from the failure cache instead of asking again per offer', async () => {
    const integrity = createTypeMetadataIntegrity()

    await expect(integrity.digest(URL_TWO)).rejects.toThrow('404')
    await expect(integrity.digest(URL_TWO)).rejects.toThrow('404')

    expect(served).toHaveBeenCalledOnce()
  })

  it('asks again once the failure window passed', async () => {
    const integrity = createTypeMetadataIntegrity()
    await expect(integrity.digest(URL_TWO)).rejects.toThrow('404')

    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + FAILURE_CACHE_MS)
    await expect(integrity.digest(URL_TWO)).rejects.toThrow('404')

    expect(served).toHaveBeenCalledTimes(2)
  })

  it('reads a document again after an invalidation cleared its failure', async () => {
    const integrity = createTypeMetadataIntegrity()
    await expect(integrity.digest(URL_TWO)).rejects.toThrow('404')

    integrity.invalidate(URL_TWO)
    await expect(integrity.digest(URL_TWO)).rejects.toThrow('404')

    expect(served).toHaveBeenCalledTimes(2)
  })
})
