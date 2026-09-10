import type { INestApplication } from '@nestjs/common'

import { VersioningType } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { MrtdPlugin } from '@verana-labs/vs-agent-plugin-mrtd'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { V2DidcommController } from '../src/controllers/admin/v2/didcomm/V2DidcommController'
import { VsAgentService } from '../src/services/VsAgentService'
import { DIDCOMM_MODULES } from '../src/utils/didcommModules'

const FULL_REGISTRY = [
  'https://didcomm.org/action-menu/1.0',
  'https://didcomm.org/basicmessage/1.0',
  'https://didcomm.org/basicmessage/2.0',
  'https://didcomm.org/calls/1.0',
  'https://didcomm.org/connections/1.0',
  'https://didcomm.org/coordinate-mediation/1.0',
  'https://didcomm.org/did-rotate/1.0',
  'https://didcomm.org/didexchange/1.1',
  'https://didcomm.org/discover-features/1.0',
  'https://didcomm.org/discover-features/2.0',
  'https://didcomm.org/empty/1.0',
  'https://didcomm.org/issue-credential/2.0',
  'https://didcomm.org/media-sharing/1.0',
  'https://didcomm.org/message-pickup/4.0',
  'https://didcomm.org/messagepickup/1.0',
  'https://didcomm.org/messagepickup/2.0',
  'https://didcomm.org/mrtd/1.0',
  'https://didcomm.org/out-of-band/1.1',
  'https://didcomm.org/present-proof/2.0',
  'https://didcomm.org/questionanswer/1.0',
  'https://didcomm.org/reactions/1.0',
  'https://didcomm.org/receipts/1.0',
  'https://didcomm.org/revocation_notification/1.0',
  'https://didcomm.org/revocation_notification/2.0',
  'https://didcomm.org/user-profile/1.0',
  'https://didcomm.org/vt-flow/1.0',
]

const CORE_ONLY = FULL_REGISTRY.filter(id =>
  /\/(basicmessage|connections|didexchange|issue-credential|present-proof|out-of-band|discover-features)\//.test(
    id,
  ),
)

const features = { query: vi.fn() }
const vsAgentService = { getAgent: vi.fn().mockResolvedValue({ didcomm: { features } }) }

const asFeatures = (ids: string[]) => ids.map(id => ({ id, type: 'protocol' }))

describe('v2 didcomm protocol routes', () => {
  let app: INestApplication

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [V2DidcommController],
      providers: [
        { provide: VsAgentService, useValue: vsAgentService },
        {
          provide: 'DIDCOMM_MODULES',
          useValue: [...DIDCOMM_MODULES, ...(MrtdPlugin().didcommModules ?? [])],
        },
      ],
    }).compile()

    app = moduleRef.createNestApplication()
    app.enableVersioning({ type: VersioningType.URI })
    await app.init()
  })

  afterAll(async () => {
    await app?.close()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    features.query.mockReturnValue(asFeatures(FULL_REGISTRY))
  })

  it('lists every served module with its protocols, in the order of the spec', async () => {
    const response = await request(app.getHttpServer()).get('/v2/didcomm/protocols')

    expect(response.status).toBe(200)
    expect(response.body).toEqual([
      {
        module: 'connections',
        protocols: ['https://didcomm.org/connections/1.0', 'https://didcomm.org/didexchange/1.1'],
      },
      {
        module: 'basic-messages',
        protocols: ['https://didcomm.org/basicmessage/1.0', 'https://didcomm.org/basicmessage/2.0'],
      },
      { module: 'presentations', protocols: ['https://didcomm.org/present-proof/2.0'] },
      { module: 'credential-exchanges', protocols: ['https://didcomm.org/issue-credential/2.0'] },
      { module: 'receipts', protocols: ['https://didcomm.org/receipts/1.0'] },
      { module: 'reactions', protocols: ['https://didcomm.org/reactions/1.0'] },
      { module: 'user-profile', protocols: ['https://didcomm.org/user-profile/1.0'] },
      { module: 'media-sharing', protocols: ['https://didcomm.org/media-sharing/1.0'] },
      { module: 'calls', protocols: ['https://didcomm.org/calls/1.0'] },
      { module: 'action-menu', protocols: ['https://didcomm.org/action-menu/1.0'] },
      { module: 'question-answer', protocols: ['https://didcomm.org/questionanswer/1.0'] },
      { module: 'mrtd', protocols: ['https://didcomm.org/mrtd/1.0'] },
    ])
  })

  it('answers a bare array and not a page', async () => {
    const response = await request(app.getHttpServer()).get('/v2/didcomm/protocols?limit=1&cursor=abc')

    expect(Array.isArray(response.body)).toBe(true)
    expect(response.body).toHaveLength(12)
  })

  it('leaves out a protocol that has no module under /v2/didcomm', async () => {
    const response = await request(app.getHttpServer()).get('/v2/didcomm/protocols')

    const listed = response.body.flatMap((entry: { protocols: string[] }) => entry.protocols)
    for (const stray of [
      'discover-features',
      'out-of-band',
      'vt-flow',
      'coordinate-mediation',
      'did-rotate',
    ]) {
      expect(listed.some((id: string) => id.includes(`/${stray}/`))).toBe(false)
    }
  })

  it('leaves out a module whose plugin is not loaded', async () => {
    features.query.mockReturnValue(asFeatures(CORE_ONLY))

    const response = await request(app.getHttpServer()).get('/v2/didcomm/protocols')

    expect(response.body.map((entry: { module: string }) => entry.module)).toEqual([
      'connections',
      'basic-messages',
      'presentations',
      'credential-exchanges',
    ])
  })

  it('asks the feature registry for every protocol', async () => {
    await request(app.getHttpServer()).get('/v2/didcomm/protocols')

    expect(features.query).toHaveBeenCalledTimes(1)
    expect(features.query.mock.calls[0][0]).toMatchObject({ featureType: 'protocol', match: '*' })
  })
})
