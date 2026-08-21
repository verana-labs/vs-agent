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
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { AdminApiError, AdminApiErrorCode } from '../src/common/AdminApiError'
import { ServiceEndpointExceptionFilter } from '../src/controllers/admin/service-endpoints/ServiceEndpointExceptionFilter'
import {
  ServiceEndpointError,
  ServiceEndpointErrorCode,
} from '../src/controllers/admin/service-endpoints/ServiceEndpointsService'
import { AccessMode, AdminAuthGuard, AdminAuthService } from '../src/security'
import { commonAppConfig } from '../src/utils/setupAgent'

class SendMessageDto {
  @IsString()
  connectionId!: string

  @IsString()
  type!: string
}

@AccessMode('PUBLIC')
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

  @AccessMode('CORPORATION')
  @Get('presentations')
  listPresentations() {
    return { items: [], nextCursor: null }
  }
}

@AccessMode('PUBLIC')
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

@AccessMode('PUBLIC')
@Controller({ path: 'connections', version: '1' })
class V1ConnectionsFixtureController {
  @Get(':connectionId')
  getConnection(): never {
    throw new NotFoundException('connection not found')
  }
}

@AccessMode('PUBLIC')
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

describe('v2 error envelope', () => {
  let app: INestApplication

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [
        V2DidcommFixtureController,
        V2ServiceEndpointsFixtureController,
        V1ConnectionsFixtureController,
        V1ServiceEndpointsFixtureController,
      ],
      providers: [
        AdminAuthService,
        { provide: 'VSAGENT', useValue: {} },
        { provide: 'ADMIN_ALLOWED_ACCOUNTS', useValue: [] },
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

  it('envelopes the 404 that the router raises on a path that no v2 method serves', async () => {
    const response = await request(app.getHttpServer()).get('/v2/didcomm/there-is-no-such-method')

    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('UNKNOWN_ID')
  })

  it('envelopes the rejection of the auth guard', async () => {
    const response = await request(app.getHttpServer()).get('/v2/didcomm/presentations')

    expect(response.status).toBe(401)
    expect(response.body).toEqual({
      error: { code: 'UNAUTHENTICATED', message: 'a valid bearer token is required' },
    })
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
