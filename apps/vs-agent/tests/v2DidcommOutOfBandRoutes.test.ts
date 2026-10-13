import type { INestApplication } from '@nestjs/common'

import { DidCommOutOfBandInvitation, DidCommOutOfBandInvitationV2 } from '@credo-ts/didcomm'
import { ValidationPipe, VersioningType } from '@nestjs/common'
import { HttpAdapterHost } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { ErrorEnvelopeFilter } from '../src/common'
import { V2DidcommOutOfBandController } from '../src/controllers/admin/v2/didcomm/V2DidcommOutOfBandController'
import { UrlShorteningService } from '../src/services/UrlShorteningService'
import { VsAgentService } from '../src/services/VsAgentService'

const oob = { createInvitation: vi.fn() }
const dids = { getCreatedDids: vi.fn().mockResolvedValue([]) }
const genericRecords = { save: vi.fn().mockResolvedValue({ id: 'short-1' }) }
const agent = {
  did: 'did:webvh:agent.test',
  publicApiBaseUrl: 'https://agent.test',
  dids,
  genericRecords,
  didcomm: { oob },
}
const vsAgentService = { getAgent: vi.fn().mockResolvedValue(agent) }

const outOfBandRecord = (config: { didCommVersion: 'v1' | 'v2'; goalCode?: string }) => {
  const outOfBandInvitation = new DidCommOutOfBandInvitation({
    id: 'inv-1',
    services: ['did:webvh:agent.test'],
    goalCode: config.goalCode,
  })
  if (config.didCommVersion === 'v2') {
    outOfBandInvitation.v2Invitation = new DidCommOutOfBandInvitationV2({
      id: 'inv-2',
      from: 'did:webvh:agent.test',
    })
  }
  return { id: 'oob-1', outOfBandInvitation }
}

describe('v2 didcomm out-of-band routes', () => {
  let app: INestApplication

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [V2DidcommOutOfBandController],
      providers: [
        { provide: VsAgentService, useValue: vsAgentService },
        { provide: 'VSAGENT', useValue: agent },
        UrlShorteningService,
      ],
    }).compile()

    app = moduleRef.createNestApplication()
    app.enableVersioning({ type: VersioningType.URI })
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
    app.useGlobalFilters(new ErrorEnvelopeFilter(app.get(HttpAdapterHost).httpAdapter))
    await app.init()
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    oob.createInvitation.mockImplementation(async config => outOfBandRecord(config))
  })

  const create = (body: Record<string, unknown> = {}) =>
    request(app.getHttpServer()).post('/v2/didcomm/out-of-band').send(body)

  it('mints a single-use v1 invitation by default and returns its ids and url', async () => {
    const response = await create({ goalCode: 'hologram.bind-session', goal: 'Link a web session' })

    expect(response.status).toBe(201)
    expect(response.body).toMatchObject({ outOfBandId: 'oob-1', invitationId: 'inv-1' })
    expect(response.body.url).toContain('https://agent.test?oob=')
    expect(response.body.invitation['@id']).toBe('inv-1')
    expect(response.body.shortUrl).toBeUndefined()

    const [config] = oob.createInvitation.mock.calls[0]
    expect(config).toMatchObject({
      didCommVersion: 'v1',
      multiUseInvitation: false,
      goalCode: 'hologram.bind-session',
      goal: 'Link a web session',
      invitationDid: 'did:webvh:agent.test',
    })
  })

  it('mints a v2 invitation on request and reports the v2 invitation id', async () => {
    const response = await create({ didcommVersion: 'v2', multiUse: true })

    expect(response.status).toBe(201)
    expect(response.body.invitationId).toBe('inv-2')
    expect(response.body.url).toContain('?_oob=')
    expect(oob.createInvitation.mock.calls[0][0]).toMatchObject({
      didCommVersion: 'v2',
      multiUseInvitation: true,
    })
  })

  it('mints a short url when asked', async () => {
    const response = await create({ shortUrl: true })

    expect(response.status).toBe(201)
    expect(response.body.shortUrl).toBe('https://agent.test/s?id=short-1')
    expect(genericRecords.save).toHaveBeenCalledWith(
      expect.objectContaining({ tags: { type: 'short-url', relatedFlowId: 'oob-1' } }),
    )
  })
})
