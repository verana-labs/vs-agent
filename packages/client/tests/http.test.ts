import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiClient, ApiError, HttpClient } from '../src'

const fetchMock = vi.fn()

function respond(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function lastRequest(): { url: string; init: RequestInit } {
  const [url, init] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1] as [string, RequestInit]
  return { url, init }
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('HttpClient', () => {
  it('prefixes /v2, strips a trailing slash and sends the accept header', async () => {
    fetchMock.mockResolvedValue(respond(200, { did: 'did:web:x', version: '1.0.0' }))
    const http = new HttpClient('http://localhost:3000/', {})

    const info = await http.request('GET', '/agent/info')

    expect(info).toEqual({ did: 'did:web:x', version: '1.0.0' })
    const { url, init } = lastRequest()
    expect(url).toBe('http://localhost:3000/v2/agent/info')
    expect(init.method).toBe('GET')
    expect(init.headers).toEqual({ Accept: 'application/json' })
    expect(init.body).toBeUndefined()
  })

  it('sends the bearer token and a JSON body', async () => {
    fetchMock.mockResolvedValue(respond(201, { id: 'm1' }))
    const http = new HttpClient('http://localhost:3000', { token: 'secret' })

    await http.request('POST', '/didcomm/basic-messages', { body: { connectionId: 'c1', content: 'hi' } })

    const { init } = lastRequest()
    expect(init.headers).toEqual({
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: 'Bearer secret',
    })
    expect(init.body).toBe(JSON.stringify({ connectionId: 'c1', content: 'hi' }))
  })

  it('serialises the query and skips undefined values', async () => {
    fetchMock.mockResolvedValue(respond(200, { items: [], nextCursor: null }))
    const http = new HttpClient('http://localhost:3000', {})

    await http.request('GET', '/didcomm/connections', {
      query: { limit: 10, state: 'completed', cursor: undefined, deleteAssociatedRevocationRegistries: true },
    })

    expect(lastRequest().url).toBe(
      'http://localhost:3000/v2/didcomm/connections?limit=10&state=completed&deleteAssociatedRevocationRegistries=true',
    )
  })

  it('resolves undefined on 204', async () => {
    fetchMock.mockResolvedValue(respond(204))
    const http = new HttpClient('http://localhost:3000', {})

    await expect(http.request('DELETE', '/didcomm/connections/c1')).resolves.toBeUndefined()
  })

  it('turns the error envelope into an ApiError', async () => {
    fetchMock.mockResolvedValue(
      respond(404, { error: { code: 'UNKNOWN_ID', message: 'no connection with id "c1"' } }),
    )
    const http = new HttpClient('http://localhost:3000', {})

    const error = await http.request('GET', '/didcomm/connections/c1').catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ code: 'UNKNOWN_ID', status: 404, message: 'no connection with id "c1"' })
  })

  it('falls back to HTTP_ERROR when the body is not an envelope', async () => {
    fetchMock.mockResolvedValue(new Response('Bad Gateway', { status: 502, statusText: 'Bad Gateway' }))
    const http = new HttpClient('http://localhost:3000', {})

    const error = await http.request('GET', '/agent/info').catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ code: 'HTTP_ERROR', status: 502, message: 'Bad Gateway' })
  })

  it('propagates transport failures unchanged', async () => {
    const failure = new TypeError('fetch failed')
    fetchMock.mockRejectedValue(failure)
    const http = new HttpClient('http://localhost:3000', {})

    await expect(http.request('GET', '/agent/info')).rejects.toBe(failure)
  })
})

describe('ApiClient', () => {
  it('encodes path parameters', async () => {
    fetchMock.mockResolvedValue(respond(200, { id: 'did:web:agent#mcp', type: 'Mcp', serviceEndpoint: 'x' }))
    const client = new ApiClient('http://localhost:3000')

    await client.vt.deleteServiceEndpoint('did:web:agent#mcp')

    const { url, init } = lastRequest()
    expect(url).toBe('http://localhost:3000/v2/vt/service-endpoints/did%3Aweb%3Aagent%23mcp')
    expect(init.method).toBe('DELETE')
  })
})
