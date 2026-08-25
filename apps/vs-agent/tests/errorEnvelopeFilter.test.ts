import type { INestApplication } from '@nestjs/common'

import {
  Body,
  Controller,
  Get,
  HttpStatus,
  NotFoundException,
  Post,
  UseFilters,
  ValidationPipe,
} from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import { IsString } from 'class-validator'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { AdminApiError, AdminApiErrorCode } from '../src/common/AdminApiError'
import { BOOTSTRAP_STATE, BootstrapState } from '../src/common/BootstrapState'
import { V2AgentController } from '../src/controllers/admin/v2/agent/V2AgentController'
import { ServiceEndpointExceptionFilter } from '../src/controllers/admin/service-endpoints/ServiceEndpointExceptionFilter'
import {
  ServiceEndpointError,
  ServiceEndpointErrorCode,
} from '../src/controllers/admin/service-endpoints/ServiceEndpointsService'
import { AdminAuthGuard, AdminAuthService } from '../src/security'
import { parseTrustedNetworks } from '../src/security/trustedNetworks'
import { VsAgentService } from '../src/services/VsAgentService'
import { commonAppConfig } from '../src/utils/setupAgent'

class SendMessageDto {
  @IsString()
  connectionId!: string

  @IsString()
  type!: string
}

@Controller({ path: 'didcomm', version: '2' })
class V2DidcommFixtureController {
  @Get('connections/:connectionId')
  getConnection(): never {
    throw new NotFoundException('no connection with the given id')
  }

  @Get('connections')
  listConnections(): never {
    throw new AdminApiError(
      AdminApiErrorCode.InvalidCursor,
      HttpStatus.BAD_REQUEST,
      'the cursor is malformed',
    )
  }

  // esbuild drops the design:type metadata that the global pipe infers from, so the
  // expected type is named here instead.
  @Post('send-message')
  sendMessage(@Body(new ValidationPipe({ expectedType: SendMessageDto })) body: SendMessageDto) {
    return body
  }

  @Get('boom')
  boom(): never {
    throw new Error('askar storage is corrupted at /var/lib/agent/wallet.db')
  }

  @Get('presentations')
  listPresentations() {
    return { items: [], nextCursor: null }
  }
}

@Controller({ path: 'vt/service-endpoints', version: '2' })
class V2ServiceEndpointsFixtureController {
  @Post()
  addServiceEndpoint(): never {
    throw new ServiceEndpointError(
      ServiceEndpointErrorCode.DuplicateId,
      'an entry with that id already exists',
    )
  }
}

@Controller({ path: 'connections', version: '1' })
class V1ConnectionsFixtureController {
  @Get(':connectionId')
  getConnection(): never {
    throw new NotFoundException('connection not found')
  }
}

@UseFilters(ServiceEndpointExceptionFilter)
@Controller({ path: 'vt/service-endpoints', version: '1' })
class V1ServiceEndpointsFixtureController {
  @Post()
  addServiceEndpoint(): never {
    throw new ServiceEndpointError(
      ServiceEndpointErrorCode.DuplicateId,
      'an entry with that id already exists',
    )
  }
}

const BOOTSTRAP_STEPS = ['vtjsc-service-id-migration', 'self-trust-registry', 'indexer-subscription'] as const

describe('v2 error envelope', () => {
  let app: INestApplication
  const bootstrapState = new BootstrapState()

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [
        V2DidcommFixtureController,
        V2ServiceEndpointsFixtureController,
        V1ConnectionsFixtureController,
        V1ServiceEndpointsFixtureController,
        V2AgentController,
      ],
      providers: [
        AdminAuthService,
        VsAgentService,
        { provide: 'VSAGENT', useValue: { isInitialized: true } },
        { provide: 'ADMIN_AUTH_MODE', useValue: 'internal' },
        { provide: 'ADMIN_TRUSTED_NETWORKS', useValue: parseTrustedNetworks(['127.0.0.0/8', '::1/128']) },
        { provide: 'ADMIN_ALLOWED_ACCOUNTS', useValue: [] },
        { provide: BOOTSTRAP_STATE, useValue: bootstrapState },
        { provide: APP_GUARD, useClass: AdminAuthGuard },
      ],
    }).compile()

    app = moduleRef.createNestApplication()
    commonAppConfig(app, false, true, false)
    await app.init()
  })

  afterAll(async () => {
    await app?.close()
  })

  beforeEach(() => {
    for (const step of BOOTSTRAP_STEPS) bootstrapState.complete(step)
    bootstrapState.watchIndexer(() => 'synced')
  })

  it('derives the code from the status of a nest exception', async () => {
    const response = await request(app.getHttpServer()).get('/v2/didcomm/connections/unknown-id')

    expect(response.status).toBe(404)
    expect(response.body).toEqual({
      error: { code: 'UNKNOWN_ID', message: 'no connection with the given id' },
    })
  })

  it('reports the code that the status alone cannot express', async () => {
    const response = await request(app.getHttpServer()).get('/v2/didcomm/connections?cursor=zzz')

    expect(response.status).toBe(400)
    expect(response.body).toEqual({
      error: { code: 'INVALID_CURSOR', message: 'the cursor is malformed' },
    })
  })

  it('envelopes what the validation pipe rejects', async () => {
    const response = await request(app.getHttpServer()).post('/v2/didcomm/send-message').send({})

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('INVALID_INPUT')
    expect(response.body.error.message).toContain('connectionId')
    expect(response.body.error.message).toContain('type')
    expect(Object.keys(response.body)).toEqual(['error'])
  })

  it('envelopes what the body parser rejects before any v2 method runs', async () => {
    const response = await request(app.getHttpServer())
      .post('/v2/didcomm/send-message')
      .set('Content-Type', 'application/json')
      .send('{"connectionId": ')

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('INVALID_INPUT')
  })

  it('envelopes a body that exceeds the size limit', async () => {
    const response = await request(app.getHttpServer())
      .post('/v2/didcomm/send-message')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ connectionId: 'x'.repeat(6 * 1024 * 1024) }))

    expect(response.status).toBe(413)
    expect(response.body.error.code).toBe('INVALID_INPUT')
  })

  it('envelopes the 404 that the router raises on a path that no v2 method serves', async () => {
    const response = await request(app.getHttpServer()).get('/v2/didcomm/there-is-no-such-method')

    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('UNKNOWN_ID')
  })

  it('envelopes the rejection of the auth guard for an external peer', async () => {
    const externalModuleRef = await Test.createTestingModule({
      controllers: [V2DidcommFixtureController, V2AgentController],
      providers: [
        AdminAuthService,
        VsAgentService,
        { provide: 'VSAGENT', useValue: { isInitialized: true } },
        { provide: 'ADMIN_AUTH_MODE', useValue: 'corporation' },
        { provide: 'ADMIN_TRUSTED_NETWORKS', useValue: [] },
        { provide: 'ADMIN_ALLOWED_ACCOUNTS', useValue: [] },
        { provide: BOOTSTRAP_STATE, useValue: new BootstrapState() },
        { provide: APP_GUARD, useClass: AdminAuthGuard },
      ],
    }).compile()
    const externalApp = externalModuleRef.createNestApplication()
    commonAppConfig(externalApp, false, true, false)
    await externalApp.init()

    try {
      const response = await request(externalApp.getHttpServer()).get('/v2/didcomm/presentations')
      expect(response.status).toBe(401)
      expect(response.body).toEqual({
        error: { code: 'UNAUTHENTICATED', message: 'a valid bearer token is required' },
      })

      const live = await request(externalApp.getHttpServer()).get('/v2/agent/health/live')
      expect(live.status).toBe(HttpStatus.OK)
    } finally {
      await externalApp.close()
    }
  })

  it('reports an unexpected failure as INTERNAL without leaking its detail', async () => {
    const response = await request(app.getHttpServer()).get('/v2/didcomm/boom')

    expect(response.status).toBe(500)
    expect(response.body).toEqual({
      error: { code: 'INTERNAL', message: 'the agent failed to complete the request' },
    })
    expect(JSON.stringify(response.body)).not.toContain('askar')
  })

  it('envelopes a service endpoint error on a v2 method', async () => {
    const response = await request(app.getHttpServer()).post('/v2/vt/service-endpoints').send({})

    expect(response.status).toBe(409)
    expect(response.body).toEqual({
      error: { code: 'DUPLICATE_ID', message: 'an entry with that id already exists' },
    })
  })

  it('serves both health probes without a token, and never answers 401 or 403', async () => {
    bootstrapState.require('self-trust-registry')

    const live = await request(app.getHttpServer()).get('/v2/agent/health/live')
    const ready = await request(app.getHttpServer()).get('/v2/agent/health/ready')

    expect(live.status).toBe(HttpStatus.OK)
    expect(live.body).toEqual({ status: 'live' })
    expect(ready.status).not.toBe(HttpStatus.UNAUTHORIZED)
    expect(ready.status).not.toBe(HttpStatus.FORBIDDEN)
  })

  it('envelopes the readiness probe as NOT_READY instead of collapsing it into INTERNAL', async () => {
    bootstrapState.require('self-trust-registry')

    const response = await request(app.getHttpServer()).get('/v2/agent/health/ready')

    expect(response.status).toBe(HttpStatus.SERVICE_UNAVAILABLE)
    expect(response.body).toEqual({
      error: {
        code: AdminApiErrorCode.NotReady,
        message: "bootstrap step 'self-trust-registry' has not completed",
      },
    })
  })

  it('keeps the liveness probe green while a bootstrap step is only pending', async () => {
    bootstrapState.require('vtjsc-service-id-migration')

    const response = await request(app.getHttpServer()).get('/v2/agent/health/live')

    expect(response.status).toBe(HttpStatus.OK)
    expect(response.body).toEqual({ status: 'live' })
  })

  it('fails the liveness probe once a bootstrap step is beyond recovery, so the pod can restart', async () => {
    bootstrapState.require('vtjsc-service-id-migration')
    bootstrapState.fail('vtjsc-service-id-migration', 'askar rejected the write')

    const live = await request(app.getHttpServer()).get('/v2/agent/health/live')
    const ready = await request(app.getHttpServer()).get('/v2/agent/health/ready')

    expect(live.status).toBe(HttpStatus.SERVICE_UNAVAILABLE)
    expect(live.body).toEqual({
      error: {
        code: AdminApiErrorCode.Internal,
        message: "bootstrap step 'vtjsc-service-id-migration' failed and could not be recovered",
      },
    })
    expect(ready.status).toBe(HttpStatus.SERVICE_UNAVAILABLE)
  })

  it('keeps secrets, tokens, accounts, DIDs and peers out of both probe bodies', async () => {
    const secrets = [
      'did:web:agent.test',
      'did:web:parent.test',
      'verana1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq',
      'super-secret-bearer-token',
    ]
    bootstrapState.require('self-trust-registry')
    bootstrapState.fail('self-trust-registry', `could not publish ${secrets.join(' ')}`)
    bootstrapState.recordEcsBootstrap('delegated', 'failed', `parent ${secrets[1]} refused ${secrets[2]}`)

    const bodies = [
      await request(app.getHttpServer()).get('/v2/agent/health/live'),
      await request(app.getHttpServer()).get('/v2/agent/health/ready'),
    ].map(response => JSON.stringify(response.body))

    for (const body of bodies) {
      for (const secret of secrets) expect(body).not.toContain(secret)
    }
  })

  it('answers the readiness probe once every step completed', async () => {
    bootstrapState.require('self-trust-registry')
    bootstrapState.complete('self-trust-registry')
    bootstrapState.watchIndexer(() => 'synced')

    const response = await request(app.getHttpServer()).get('/v2/agent/health/ready')

    expect(response.status).toBe(HttpStatus.OK)
    expect(response.body).toEqual({ status: 'ready' })
  })

  it('leaves the body of a v1 method untouched', async () => {
    const response = await request(app.getHttpServer()).get('/v1/connections/unknown-id')

    expect(response.status).toBe(404)
    expect(response.body).toEqual({ statusCode: 404, message: 'connection not found', error: 'Not Found' })
  })

  it('keeps the v1 service endpoint filter ahead of the envelope', async () => {
    const response = await request(app.getHttpServer()).post('/v1/vt/service-endpoints').send({})

    expect(response.status).toBe(409)
    expect(response.body).toEqual({
      code: 'DUPLICATE_ID',
      reason: 'an entry with that id already exists',
    })
  })
})
