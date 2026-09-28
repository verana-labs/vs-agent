import type { Server } from 'node:http'

import express from 'express'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { generateDigestSRI } from '@verana-labs/vs-agent-sdk'

import { createTypeMetadataIntegrity } from '../src/services/typeMetadataIntegrity'

const TYPE_METADATA = JSON.stringify({ vct: 'employee', name: 'Employee credential' })

const served = vi.fn()

let server: Server
let baseUrl: string
let servedBody: string | Buffer

beforeAll(async () => {
  const app = express()
  app.get('/vt/vct/1', (_request, response) => {
    served()
    response.type('application/json').send(servedBody)
  })
  server = await new Promise<Server>((resolve, reject) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening))
    listening.once('error', reject)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('the fixture server bound no TCP port')
  baseUrl = `http://127.0.0.1:${address.port}`
})

afterAll(async () => {
  server.closeAllConnections?.()
  await new Promise<void>((resolve, reject) => server.close(error => (error ? reject(error) : resolve())))
})

describe('createTypeMetadataIntegrity', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    servedBody = TYPE_METADATA
  })

  it('digests the exact bytes the Type Metadata URL served', async () => {
    const integrity = createTypeMetadataIntegrity()

    await expect(integrity(`${baseUrl}/vt/vct/1`)).resolves.toBe(generateDigestSRI(TYPE_METADATA))
  })

  it('digests a BOM as served instead of digesting the decoded document', async () => {
    servedBody = Buffer.from(`\uFEFF${TYPE_METADATA}`, 'utf8')
    const integrity = createTypeMetadataIntegrity()

    const digest = await integrity(`${baseUrl}/vt/vct/1`)

    expect(digest).toBe(generateDigestSRI(servedBody))
    expect(digest).not.toBe(generateDigestSRI(TYPE_METADATA))
  })

  it('serves a second call from the cache without a second request', async () => {
    const integrity = createTypeMetadataIntegrity()

    const first = await integrity(`${baseUrl}/vt/vct/1`)
    const second = await integrity(`${baseUrl}/vt/vct/1`)

    expect(second).toBe(first)
    expect(served).toHaveBeenCalledOnce()
  })

  it('fails on a document the URL does not serve and caches no failure', async () => {
    const integrity = createTypeMetadataIntegrity()

    await expect(integrity(`${baseUrl}/vt/vct/2`)).rejects.toThrow('404')
    await expect(integrity(`${baseUrl}/vt/vct/2`)).rejects.toThrow('404')
  })
})
