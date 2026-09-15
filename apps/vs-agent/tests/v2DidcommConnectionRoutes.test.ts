import type { INestApplication } from '@nestjs/common'

import { RecordNotFoundError } from '@credo-ts/core'
import { DidCommOutOfBandInvitation, DidCommOutOfBandInvitationV2 } from '@credo-ts/didcomm'
import { ValidationPipe, VersioningType } from '@nestjs/common'
import { HttpAdapterHost } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { ErrorEnvelopeFilter } from '../src/common'
import { V2DidcommConnectionsController } from '../src/controllers/admin/v2/didcomm/V2DidcommConnectionsController'
import { V2DidcommInvitationsController } from '../src/controllers/admin/v2/didcomm/V2DidcommInvitationsController'
import { ListConnectionsQueryDto, SendInvitationBodyDto } from '../src/controllers/admin/v2/didcomm/dto'
import { InvitationsService } from '../src/controllers/admin/v2/didcomm/InvitationsService'
import { VsAgentService } from '../src/services/VsAgentService'

const connection = (id: string, createdAt: string, extra: Record<string, unknown> = {}) => ({
  id,
  state: 'completed',
  role: 'responder',
  did: `did:web:agent.test:${id}`,
  theirDid: `did:web:peer.test:${id}`,
  threadId: `thread-${id}`,
  createdAt: new Date(createdAt),
  updatedAt: new Date(createdAt),
  ...extra,
})

// Deliberately out of order: the controller owes a deterministic order of its own.
const records = [
  connection('c-2', '2026-01-02T00:00:00.000Z'),
  connection('c-3', '2026-01-03T00:00:00.000Z', { mediatorId: 'med-1' }),
  connection('c-1', '2026-01-01T00:00:00.000Z'),
]

const connections = {
  findAllByQuery: vi.fn(),
  findById: vi.fn(),
  deleteById: vi.fn(),
}

const oob = { createInvitation: vi.fn() }
const basicMessages = { sendMessage: vi.fn().mockResolvedValue({ id: 'bm-1' }) }
const outOfBandRepository = { update: vi.fn() }
const messageSender = { sendMessage: vi.fn() }
const dids = { getCreatedDids: vi.fn().mockResolvedValue([]) }

const agent = {
  did: 'did:webvh:agent.test',
  publicApiBaseUrl: 'https://agent.test',
  context: { dependencyManager: { resolve: () => messageSender } },
  dependencyManager: { resolve: () => outOfBandRepository },
  dids,
  didcomm: { connections, oob, basicMessages },
}

const vsAgentService = { getAgent: vi.fn().mockResolvedValue(agent) }

const idsOf = (body: { items: { id: string }[] }) => body.items.map(item => item.id)

describe('v2 didcomm connection routes', () => {
  let app: INestApplication

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [V2DidcommConnectionsController, V2DidcommInvitationsController],
      providers: [{ provide: VsAgentService, useValue: vsAgentService }, InvitationsService],
    }).compile()

    app = moduleRef.createNestApplication()
    app.enableVersioning({ type: VersioningType.URI })
    app.useGlobalPipes(new ValidationPipe())
    app.useGlobalFilters(new ErrorEnvelopeFilter(app.get(HttpAdapterHost).httpAdapter))
    await app.init()
  })

  afterAll(async () => {
    await app?.close()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    connections.findAllByQuery.mockResolvedValue(records)
  })

  it('walks the connections with the keyset cursor and ends with a null cursor', async () => {
    const first = await request(app.getHttpServer()).get('/v2/didcomm/connections?limit=2')

    expect(first.status).toBe(200)
    expect(idsOf(first.body)).toEqual(['c-1', 'c-2'])
    expect(first.body.nextCursor).not.toBeNull()

    const second = await request(app.getHttpServer()).get(
      `/v2/didcomm/connections?limit=2&cursor=${encodeURIComponent(first.body.nextCursor)}`,
    )

    expect(second.status).toBe(200)
    expect(idsOf(second.body)).toEqual(['c-3'])
    expect(second.body.nextCursor).toBeNull()
  })

  it('refuses a cursor replayed against another filter set', async () => {
    const first = await request(app.getHttpServer()).get('/v2/didcomm/connections?limit=1')

    const replayed = await request(app.getHttpServer()).get(
      `/v2/didcomm/connections?limit=1&role=responder&cursor=${encodeURIComponent(first.body.nextCursor)}`,
    )

    expect(replayed.status).toBe(400)
    expect(replayed.body.error.code).toBe('INVALID_CURSOR')
  })

  it('passes every supplied filter to the connection repository', async () => {
    const response = await request(app.getHttpServer()).get(
      '/v2/didcomm/connections?state=completed&role=responder&theirDid=did:web:peer.test&mediatorId=med-1&didcommVersion=v2',
    )

    expect(response.status).toBe(200)
    expect(connections.findAllByQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        state: 'completed',
        role: 'responder',
        theirDid: 'did:web:peer.test',
        mediatorId: 'med-1',
        didcommVersion: 'v2',
      }),
    )
  })

  // Credo writes the didcommVersion tag only for v2 out-of-band connections and treats its
  // absence as v1, so a v1 filter has to be the negation of v2 rather than a tag match.
  it('translates a v1 version filter into the negation of v2', async () => {
    const response = await request(app.getHttpServer()).get('/v2/didcomm/connections?didcommVersion=v1')

    expect(response.status).toBe(200)
    const [query] = connections.findAllByQuery.mock.calls[0]
    expect(query.$and[1]).toEqual({ $not: { didcommVersion: 'v2' } })
    // The tag must not also be asserted as a value, or nothing would ever match.
    expect(query.$and[0]).not.toHaveProperty('didcommVersion')
  })

  it('keeps the other filters alongside the negated version', async () => {
    await request(app.getHttpServer()).get(
      '/v2/didcomm/connections?didcommVersion=v1&state=completed&role=responder',
    )

    const [query] = connections.findAllByQuery.mock.calls[0]
    expect(query.$and[0]).toMatchObject({ state: 'completed', role: 'responder' })
    expect(query.$and[1]).toEqual({ $not: { didcommVersion: 'v2' } })
  })

  it('leaves a v2 version filter as a plain tag match', async () => {
    await request(app.getHttpServer()).get('/v2/didcomm/connections?didcommVersion=v2')

    expect(connections.findAllByQuery).toHaveBeenCalledWith(expect.objectContaining({ didcommVersion: 'v2' }))
    expect(connections.findAllByQuery.mock.calls[0][0].$and).toBeUndefined()
  })

  it('keys the pagination cursor on the requested version, not on the translated query', async () => {
    const first = await request(app.getHttpServer()).get('/v2/didcomm/connections?didcommVersion=v1&limit=2')

    const second = await request(app.getHttpServer()).get(
      `/v2/didcomm/connections?didcommVersion=v1&limit=2&cursor=${encodeURIComponent(first.body.nextCursor)}`,
    )

    expect(second.status).toBe(200)
  })

  // Driven through the pipe rather than over HTTP: esbuild drops the design:paramtypes
  // metadata that the global pipe infers the DTO from, so the route cannot be made to
  // validate under vitest. `nest build` emits it, so the deployed route does validate.
  it('rejects a state outside the DID exchange state machine', async () => {
    const pipe = new ValidationPipe()
    const metadata = { type: 'query', metatype: ListConnectionsQueryDto } as const

    await expect(pipe.transform({ state: 'not-a-state' }, metadata)).rejects.toMatchObject({
      status: 400,
    })
    await expect(pipe.transform({ state: 'completed' }, metadata)).resolves.toBeDefined()
  })

  it('returns one connection in the shape the listing uses', async () => {
    connections.findById.mockResolvedValue(records[2])

    const [list, single] = await Promise.all([
      request(app.getHttpServer()).get('/v2/didcomm/connections?limit=1'),
      request(app.getHttpServer()).get('/v2/didcomm/connections/c-1'),
    ])

    expect(single.status).toBe(200)
    expect(single.body).toEqual(list.body.items[0])
  })

  it('reports an unknown connection as UNKNOWN_ID', async () => {
    connections.findById.mockResolvedValue(null)

    const response = await request(app.getHttpServer()).get('/v2/didcomm/connections/nope')

    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('UNKNOWN_ID')
  })

  it('deletes a connection and answers 204 with an empty body', async () => {
    connections.deleteById.mockResolvedValue(undefined)

    const response = await request(app.getHttpServer()).delete('/v2/didcomm/connections/c-1')

    expect(response.status).toBe(204)
    expect(response.body).toEqual({})
    expect(connections.deleteById).toHaveBeenCalledWith('c-1')
  })

  it('reports a delete of an unknown connection as UNKNOWN_ID', async () => {
    connections.deleteById.mockRejectedValue(new RecordNotFoundError('not found', { recordType: 'x' }))

    const response = await request(app.getHttpServer()).delete('/v2/didcomm/connections/nope')

    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('UNKNOWN_ID')
  })

  it('does not collapse an unexpected storage failure into UNKNOWN_ID', async () => {
    connections.deleteById.mockRejectedValue(new Error('askar rejected the write'))

    const response = await request(app.getHttpServer()).delete('/v2/didcomm/connections/c-1')

    expect(response.status).toBe(500)
    expect(response.body.error.code).toBe('INTERNAL')
  })
})

describe('v2 didcomm invitation routes', () => {
  let app: INestApplication

  const parentConnection = (didcommVersion?: 'v1' | 'v2') =>
    connection('parent', '2026-01-01T00:00:00.000Z', { didcommVersion })

  const outOfBandRecord = (config: { didCommVersion: 'v1' | 'v2' }) => {
    const outOfBandInvitation = new DidCommOutOfBandInvitation({ services: ['did:peer:4zQmFresh'] })
    if (config.didCommVersion === 'v2') {
      outOfBandInvitation.v2Invitation = new DidCommOutOfBandInvitationV2({ from: 'did:peer:4zQmFresh' })
    }
    return { id: 'oob-1', outOfBandInvitation, setTag: vi.fn() }
  }

  const sentMessage = () => messageSender.sendMessage.mock.calls[0][0].message

  const sentInvitationUrl = () => {
    const [connectionId, url] = basicMessages.sendMessage.mock.calls[0]
    expect(connectionId).toBe('parent')
    expect(url).toMatch(/^https:\/\/agent\.test\?_oob=/)
    return DidCommOutOfBandInvitationV2.fromUrl(url)
  }

  const send = (body: Record<string, unknown>) =>
    request(app.getHttpServer()).post('/v2/didcomm/invitations').send(body)

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [V2DidcommInvitationsController],
      providers: [{ provide: VsAgentService, useValue: vsAgentService }, InvitationsService],
    }).compile()

    app = moduleRef.createNestApplication()
    app.enableVersioning({ type: VersioningType.URI })
    app.useGlobalFilters(new ErrorEnvelopeFilter(app.get(HttpAdapterHost).httpAdapter))
    await app.init()
  })

  afterAll(async () => {
    await app?.close()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    dids.getCreatedDids.mockResolvedValue([])
    oob.createInvitation.mockImplementation(async config => outOfBandRecord(config))
  })

  it('sends a single-use OOB 1.1 sub-connection invitation on a v1 connection', async () => {
    connections.findById.mockResolvedValue(parentConnection())

    const response = await send({
      connectionId: 'parent',
      label: 'Support',
      imageUrl: 'https://agent.test/support.png',
      goal: 'chat',
      goalCode: 'support',
    })

    expect(response.status).toBe(201)
    expect(response.body).toEqual({ id: sentMessage().id, outOfBandId: 'oob-1' })
    expect(response.body.id).not.toBe('oob-1')

    const [config] = oob.createInvitation.mock.calls[0]
    expect(config).toMatchObject({
      didCommVersion: 'v1',
      multiUseInvitation: false,
      label: 'Support',
      imageUrl: 'https://agent.test/support.png',
      goal: 'chat',
      goalCode: 'support',
    })
    expect(config.handshakeProtocols).toHaveLength(2)
    expect(config).not.toHaveProperty('invitationDid')
    expect(config).not.toHaveProperty('ourDid')

    expect(sentMessage()).toBeInstanceOf(DidCommOutOfBandInvitation)
    expect(sentMessage().v2Invitation).toBeUndefined()
  })

  it('tags the out-of-band record with the parent connection before it sends the invitation', async () => {
    connections.findById.mockResolvedValue(parentConnection())

    await send({ connectionId: 'parent' })

    const record = await oob.createInvitation.mock.results[0].value
    expect(record.setTag).toHaveBeenCalledWith('parentConnectionId', 'parent')
    expect(outOfBandRepository.update).toHaveBeenCalledWith(agent.context, record)
    expect(outOfBandRepository.update.mock.invocationCallOrder[0]).toBeLessThan(
      messageSender.sendMessage.mock.invocationCallOrder[0],
    )
  })

  it('sends an OOB 2.0 sub-connection invitation on a v2 connection as a basic message URL, without label or imageUrl', async () => {
    connections.findById.mockResolvedValue(parentConnection('v2'))

    const response = await send({
      connectionId: 'parent',
      label: 'Support',
      imageUrl: 'https://agent.test/support.png',
      goal: 'chat',
    })

    expect(response.status).toBe(201)
    expect(response.body).toEqual({ id: 'bm-1', outOfBandId: 'oob-1' })

    const [config] = oob.createInvitation.mock.calls[0]
    expect(config).toMatchObject({ didCommVersion: 'v2', multiUseInvitation: false, goal: 'chat' })
    expect(config).not.toHaveProperty('label')
    expect(config).not.toHaveProperty('imageUrl')
    expect(config).not.toHaveProperty('ourDid')

    expect(messageSender.sendMessage).not.toHaveBeenCalled()
    expect(sentInvitationUrl().from).toBe('did:peer:4zQmFresh')
  })

  it('sends an OOB 1.1 referral whose only service is the did and creates no record', async () => {
    connections.findById.mockResolvedValue(parentConnection())

    const response = await send({
      connectionId: 'parent',
      did: 'did:webvh:verifier.test',
      label: 'Verifier',
      goalCode: 'verify',
    })

    expect(response.status).toBe(201)
    expect(response.body).toEqual({ id: sentMessage().id })
    expect(oob.createInvitation).not.toHaveBeenCalled()
    expect(outOfBandRepository.update).not.toHaveBeenCalled()

    const json = sentMessage().toJSON()
    expect(json.services).toEqual(['did:webvh:verifier.test'])
    expect(json.label).toBe('Verifier')
    expect(json.goal_code).toBe('verify')
    expect(json['~thread'].pthid).toBe('did:webvh:verifier.test')
  })

  it('sends an OOB 2.0 referral as a basic message URL with the did as from and no label, imageUrl or thread', async () => {
    connections.findById.mockResolvedValue(parentConnection('v2'))

    const response = await send({
      connectionId: 'parent',
      did: 'did:webvh:verifier.test',
      label: 'Verifier',
      imageUrl: 'https://verifier.test/logo.png',
      goal: 'verify you',
      goalCode: 'verify',
    })

    expect(response.status).toBe(201)
    expect(response.body).toEqual({ id: 'bm-1' })
    expect(oob.createInvitation).not.toHaveBeenCalled()
    expect(messageSender.sendMessage).not.toHaveBeenCalled()

    const json = sentInvitationUrl().toV2Plaintext()
    expect(json.from).toBe('did:webvh:verifier.test')
    expect(json.body).toEqual({ goal: 'verify you', goal_code: 'verify', accept: ['didcomm/v2'] })
    expect(JSON.stringify(json)).not.toMatch(/label|imageUrl|pthid/)
  })

  it('defaults the OOB 1.1 label to the name of the ECS-Service credential, and omits it otherwise', async () => {
    connections.findById.mockResolvedValue(parentConnection())
    dids.getCreatedDids.mockResolvedValue([
      {
        metadata: {
          get: () => ({
            'https://ecosystem.test/vt/ecs-service-vtjsc-vp.json': {
              credential: { credentialSubject: { name: 'Acme Support' } },
              verifiablePresentation: { id: 'https://agent.test/vt/ecs-service-vtc-vp.json' },
            },
          }),
        },
      },
    ])

    await send({ connectionId: 'parent' })
    expect(oob.createInvitation.mock.calls[0][0].label).toBe('Acme Support')

    dids.getCreatedDids.mockResolvedValue([{ metadata: { get: () => undefined } }])
    await send({ connectionId: 'parent' })
    expect(oob.createInvitation.mock.calls[1][0].label).toBeUndefined()
  })

  it('reports an unknown connection as UNKNOWN_ID and sends nothing', async () => {
    connections.findById.mockResolvedValue(null)

    const response = await send({ connectionId: 'nope' })

    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('UNKNOWN_ID')
    expect(messageSender.sendMessage).not.toHaveBeenCalled()
    expect(basicMessages.sendMessage).not.toHaveBeenCalled()
  })

  it('refuses a referral target that is not a DID', async () => {
    const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true })
    const metadata = { type: 'body', metatype: SendInvitationBodyDto } as const

    await expect(
      pipe.transform({ connectionId: 'parent', did: 'https://not-a-did' }, metadata),
    ).rejects.toMatchObject({
      status: 400,
    })
    await expect(
      pipe.transform({ connectionId: 'parent', did: 'did:web:peer.test' }, metadata),
    ).resolves.toBeDefined()
    await expect(pipe.transform({ did: 'did:web:peer.test' }, metadata)).rejects.toMatchObject({
      status: 400,
    })
  })
})
