import type { Server } from 'node:http'

import express from 'express'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { generateDigestSRI } from '@verana-labs/vs-agent-sdk'

import { createTypeMetadataIntegrity, FAILURE_CACHE_MS } from '../src/services/typeMetadataIntegrity'

const TYPE_METADATA = JSON.stringify({ vct: 'employee', name: 'Employee credential' })

const served = vi.fn()
const requested = vi.fn()

let server: Server
let baseUrl: string
let servedBody: string | Buffer

beforeAll(async () => {
  const app = express()
  app.use((_request, _response, next) => {
    requested()
    next()
  })
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
    vi.restoreAllMocks()
    vi.clearAllMocks()
    servedBody = TYPE_METADATA
  })

  it('digests the exact bytes the Type Metadata URL served', async () => {
    const integrity = createTypeMetadataIntegrity()

    await expect(integrity.digest(`${baseUrl}/vt/vct/1`)).resolves.toBe(generateDigestSRI(TYPE_METADATA))
  })

  it('digests a BOM as served instead of digesting the decoded document', async () => {
    servedBody = Buffer.from(`\uFEFF${TYPE_METADATA}`, 'utf8')
    const integrity = createTypeMetadataIntegrity()

    const digest = await integrity.digest(`${baseUrl}/vt/vct/1`)

    expect(digest).toBe(generateDigestSRI(servedBody))
    expect(digest).not.toBe(generateDigestSRI(TYPE_METADATA))
  })

  it('serves a second call from the cache without a second request', async () => {
    const integrity = createTypeMetadataIntegrity()

    const first = await integrity.digest(`${baseUrl}/vt/vct/1`)
    const second = await integrity.digest(`${baseUrl}/vt/vct/1`)

    expect(second).toBe(first)
    expect(served).toHaveBeenCalledOnce()
  })

  it('re-reads the document after an invalidation and yields the new digest', async () => {
    const integrity = createTypeMetadataIntegrity()
    const first = await integrity.digest(`${baseUrl}/vt/vct/1`)
    servedBody = JSON.stringify({ vct: 'employee', name: 'Employee credential v2' })

    integrity.invalidate()
    const second = await integrity.digest(`${baseUrl}/vt/vct/1`)

    expect(second).toBe(generateDigestSRI(servedBody))
    expect(second).not.toBe(first)
    expect(served).toHaveBeenCalledTimes(2)
  })

  it('answers a failed read from the failure cache instead of asking again per offer', async () => {
    const integrity = createTypeMetadataIntegrity()

    await expect(integrity.digest(`${baseUrl}/vt/vct/2`)).rejects.toThrow('404')
    await expect(integrity.digest(`${baseUrl}/vt/vct/2`)).rejects.toThrow('404')

    expect(requested).toHaveBeenCalledOnce()
  })

  it('asks again once the failure window passed', async () => {
    const integrity = createTypeMetadataIntegrity()
    await expect(integrity.digest(`${baseUrl}/vt/vct/2`)).rejects.toThrow('404')

    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + FAILURE_CACHE_MS)
    await expect(integrity.digest(`${baseUrl}/vt/vct/2`)).rejects.toThrow('404')

    expect(requested).toHaveBeenCalledTimes(2)
  })

  it('reads a document again after an invalidation cleared its failure', async () => {
    const integrity = createTypeMetadataIntegrity()
    await expect(integrity.digest(`${baseUrl}/vt/vct/2`)).rejects.toThrow('404')

    integrity.invalidate()
    await expect(integrity.digest(`${baseUrl}/vt/vct/2`)).rejects.toThrow('404')

    expect(requested).toHaveBeenCalledTimes(2)
  })
})
