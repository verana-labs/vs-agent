import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { digestOfBoundedUri, digestOfBytes, fetchBoundedBytes } from '../src/utils/boundedFetch'

const URL_UNDER_TEST = 'https://ecosystem.example/vt/vct/1'
const DOCUMENT = JSON.stringify({ vct: URL_UNDER_TEST })

let served: ReturnType<typeof vi.fn>

describe('fetchBoundedBytes', () => {
  beforeEach(() => {
    served = vi.fn(async () => new Response(DOCUMENT))
    vi.stubGlobal('fetch', served)
  })

  afterEach(() => vi.unstubAllGlobals())

  it('reads the bytes the URL served', async () => {
    await expect(fetchBoundedBytes(URL_UNDER_TEST)).resolves.toEqual(new TextEncoder().encode(DOCUMENT))
  })

  it('follows no redirect and gives up after five seconds', async () => {
    await fetchBoundedBytes(URL_UNDER_TEST)

    expect(served).toHaveBeenCalledWith(URL_UNDER_TEST, {
      redirect: 'manual',
      signal: expect.any(AbortSignal),
    })
  })

  it.each([
    'http://ecosystem.example/vt/vct/1',
    'file:///etc/passwd',
    'ftp://ecosystem.example/1',
  ])('refuses %s before it opens a connection', async url => {
    await expect(fetchBoundedBytes(url)).rejects.toThrow('does not use https')
    expect(served).not.toHaveBeenCalled()
  })

  it('refuses a URL that is not absolute', async () => {
    await expect(fetchBoundedBytes('/vt/vct/1')).rejects.toThrow('is not an absolute URL')
    expect(served).not.toHaveBeenCalled()
  })

  it.each([301, 302, 307, 308])('refuses the redirect the URL answered with (%i)', async status => {
    served.mockResolvedValue(new Response('', { status, headers: { location: 'https://elsewhere.example' } }))

    await expect(fetchBoundedBytes(URL_UNDER_TEST)).rejects.toThrow('answered with a redirect')
  })

  it('refuses an opaque redirect', async () => {
    served.mockResolvedValue({ type: 'opaqueredirect', status: 0, ok: false })

    await expect(fetchBoundedBytes(URL_UNDER_TEST)).rejects.toThrow('answered with a redirect')
  })

  it('names the status of an answer that is not ok', async () => {
    served.mockResolvedValue(new Response('', { status: 404, statusText: 'Not Found' }))

    await expect(fetchBoundedBytes(URL_UNDER_TEST)).rejects.toThrow('answered 404 Not Found')
  })

  it('digests the bytes it read, never a re-encoding of the decoded document', async () => {
    const withBom = Buffer.from(`﻿${DOCUMENT}`, 'utf8')
    served.mockImplementation(
      async () => new Response(withBom, { headers: { 'content-type': 'application/json; charset=utf-8' } }),
    )

    await expect(digestOfBoundedUri(URL_UNDER_TEST)).resolves.toBe(digestOfBytes(withBom))
  })
})
