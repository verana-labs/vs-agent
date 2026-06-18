import '@openwallet-foundation/askar-nodejs'
import { vi } from 'vitest'

import { mockResponses } from './object'

const fetchOriginal = global.fetch

vi.stubGlobal('fetch', async (input: any | URL, options?: RequestInit) => {
  const url =
    typeof input === 'string' ? input : ((input as any)?.url ?? input?.toString?.() ?? String(input))

  if (url.includes('witness')) {
    return new Response(JSON.stringify([]), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  if (mockResponses[url]) {
    const headers = new Headers()
    headers.set('content-type', 'application/ld+json')
    headers.set('access-control-allow-origin', '*')
    return {
      ok: true,
      headers,
      json: async () => mockResponses[url],
      text: async () => JSON.stringify(mockResponses[url]),
    }
  }
  return fetchOriginal(url, options)
})

vi.mock('node-fetch', async () => {
  return {
    default: vi.fn(async (url: string) => {
      if (url === 'http://localhost:5000/message-received') {
        return {
          ok: true,
          json: async () => 'ok',
          text: async () => 'ok',
          headers: new Map([['content-type', 'application/json']]),
        }
      }

      throw new Error(`Unhandled fetch to ${url}`)
    }),
  }
})
