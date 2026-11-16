import type { INestApplication } from '@nestjs/common'

import { ValidationPipe, VersioningType } from '@nestjs/common'
import { HttpAdapterHost } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import { MrtdPlugin } from '@verana-labs/vs-agent-plugin-mrtd'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { VsAgentModule } from '../src/admin.module'
import { ErrorEnvelopeFilter } from '../src/common'

const calls: Array<{ method: string; options: Record<string, unknown> }> = []

const agent = {
  isInitialized: true,
  context: { dependencyManager: {} },
  didcomm: {},
  modules: {
    mrtd: {
      requestMrzString: async (options: Record<string, unknown>) => {
        calls.push({ method: 'requestMrzString', options })
        return { messageId: 'mrz-message' }
      },
      requestEMrtdData: async (options: Record<string, unknown>) => {
        calls.push({ method: 'requestEMrtdData', options })
        return { messageId: 'emrtd-message' }
      },
    },
  },
}

describe('POST /v2/didcomm/mrtd/request-emrtd', () => {
  let app: INestApplication

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [VsAgentModule.register(agent as never, 'http://localhost:3001', [MrtdPlugin()])],
    }).compile()
    app = moduleRef.createNestApplication()
    app.enableVersioning({ type: VersioningType.URI })
    app.useGlobalPipes(new ValidationPipe())
    app.useGlobalFilters(new ErrorEnvelopeFilter(app.get(HttpAdapterHost).httpAdapter))
    await app.init()
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(() => {
    calls.length = 0
  })

  it('names the MRZ exchange as the parent thread of the request', async () => {
    const response = await request(app.getHttpServer())
      .post('/v2/didcomm/mrtd/request-emrtd')
      .send({ connectionId: 'conn-1', parentThreadId: 'mrz-thread-1' })

    expect(response.status).toBe(201)
    expect(response.body).toEqual({ id: 'emrtd-message' })
    expect(calls).toEqual([
      { method: 'requestEMrtdData', options: { connectionId: 'conn-1', parentThreadId: 'mrz-thread-1' } },
    ])
  })

  it('still accepts a request without a parent thread', async () => {
    const response = await request(app.getHttpServer())
      .post('/v2/didcomm/mrtd/request-emrtd')
      .send({ connectionId: 'conn-1' })

    expect(response.status).toBe(201)
    expect(calls).toEqual([
      { method: 'requestEMrtdData', options: { connectionId: 'conn-1', parentThreadId: undefined } },
    ])
  })

  it('rejects an empty parent thread', async () => {
    const response = await request(app.getHttpServer())
      .post('/v2/didcomm/mrtd/request-emrtd')
      .send({ connectionId: 'conn-1', parentThreadId: '' })

    expect(response.status).toBe(400)
    expect(calls).toEqual([])
  })

  it('keeps request-mrz without a parent thread field', async () => {
    const response = await request(app.getHttpServer())
      .post('/v2/didcomm/mrtd/request-mrz')
      .send({ connectionId: 'conn-1', parentThreadId: 'x' })

    expect(response.status).toBe(400)
    expect(calls).toEqual([])
  })
})
