import type { INestApplication } from '@nestjs/common'

import { HttpAdapterHost } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import { InvitationRepository } from '@verana-labs/vs-agent-sdk'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { ErrorEnvelopeFilter } from '../src/common'
import { ShortUrlController } from '../src/controllers/public/short-url'
import { UrlShorteningService } from '../src/services'

const invitation = { type: 'https://didcomm.org/out-of-band/2.0/invitation', id: 'inv-1' }

const shortUrlRecord = (tags: Record<string, unknown>) => ({
  content: { invitation },
  getTag: (name: string) => tags[name],
})

const shortUrls: Record<string, ReturnType<typeof shortUrlRecord>> = {
  abcd: shortUrlRecord({ type: 'short-url', relatedFlowId: 'proof-1' }),
  standalone: shortUrlRecord({ type: 'short-url', relatedFlowId: 'oob-1', invitationRecord: true }),
}

const genericRecords = {
  findById: vi.fn(async (id: string) => shortUrls[id] ?? null),
  findAllByQuery: vi.fn(),
  delete: vi.fn(),
}
const invitationRepository = { findById: vi.fn() }

const agent = {
  context: {},
  genericRecords,
  dependencyManager: {
    resolve: (token: unknown) => (token === InvitationRepository ? invitationRepository : undefined),
  },
}

describe('short url resolution', () => {
  let app: INestApplication

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ShortUrlController],
      providers: [UrlShorteningService, { provide: 'VSAGENT', useValue: agent }],
    }).compile()
    app = moduleRef.createNestApplication()
    await app.init()
    app.useGlobalFilters(new ErrorEnvelopeFilter(app.get(HttpAdapterHost).httpAdapter))
  })

  afterAll(async () => {
    await app?.close()
  })

  beforeEach(() => {
    invitationRepository.findById.mockReset()
  })

  it('answers the invitation as json whatever the caller accepts', async () => {
    const json = await request(app.getHttpServer()).get('/s?id=abcd')
    expect(json.status).toBe(200)
    expect(json.headers['content-type']).toContain('application/json')
    expect(json.body).toEqual(invitation)

    const html = await request(app.getHttpServer()).get('/s?id=abcd').set('Accept', 'text/html')
    expect(html.status).toBe(200)
    expect(html.body).toEqual(invitation)
  })

  it('answers 404 for an unknown or missing id', async () => {
    expect((await request(app.getHttpServer()).get('/s?id=nope')).status).toBe(404)
    expect((await request(app.getHttpServer()).get('/s')).status).toBe(404)
  })

  it('serves the short url of an invitation record while it is created', async () => {
    invitationRepository.findById.mockResolvedValue({ state: 'created', reusable: false })

    const response = await request(app.getHttpServer()).get('/s?id=standalone')

    expect(response.status).toBe(200)
    expect(response.body).toEqual(invitation)
    expect(invitationRepository.findById).toHaveBeenCalledWith(agent.context, 'oob-1')
  })

  it('answers 404 for the short url of a single-use invitation record that is accepted', async () => {
    invitationRepository.findById.mockResolvedValue({ state: 'accepted', reusable: false })

    expect((await request(app.getHttpServer()).get('/s?id=standalone')).status).toBe(404)
  })

  it('answers 404 for the short url of an invitation record that is gone', async () => {
    invitationRepository.findById.mockResolvedValue(null)

    expect((await request(app.getHttpServer()).get('/s?id=standalone')).status).toBe(404)
  })
})

describe('short url deletion', () => {
  it('deletes every short url record of a flow and waits for each delete', async () => {
    const records = [{ id: 's-1' }, { id: 's-2' }]
    const deleted: string[] = []
    genericRecords.findAllByQuery.mockResolvedValue(records)
    genericRecords.delete.mockImplementation(async function (this: unknown, record: { id: string }) {
      expect(this).toBe(genericRecords)
      await new Promise(resolve => setTimeout(resolve, 5))
      deleted.push(record.id)
    })

    await new UrlShorteningService(agent as never).deleteShortUrlByRelatedFlowId('oob-1')

    expect(genericRecords.findAllByQuery).toHaveBeenCalledWith({ relatedFlowId: 'oob-1' })
    expect(deleted).toEqual(['s-1', 's-2'])
  })
})
