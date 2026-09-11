import type { INestApplication } from '@nestjs/common'

import { VersioningType } from '@nestjs/common'
import { HttpAdapterHost } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { ErrorEnvelopeFilter } from '../src/common'

describe('v2 openid4vc scope without OID4VC_CONFIG_FILE_LOCATION', () => {
  let app: INestApplication

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ controllers: [] }).compile()
    app = moduleRef.createNestApplication()
    app.enableVersioning({ type: VersioningType.URI })
    app.useGlobalFilters(new ErrorEnvelopeFilter(app.get(HttpAdapterHost).httpAdapter))
    await app.init()
  })

  afterAll(async () => {
    await app?.close()
  })

  it('answers 404 in the error envelope on every path of the scope', async () => {
    const requests = [
      () => request(app.getHttpServer()).post('/v2/openid4vc/credential-offer').send({}),
      () => request(app.getHttpServer()).get('/v2/openid4vc/credential-exchanges'),
      () => request(app.getHttpServer()).get('/v2/openid4vc/presentations/abc'),
      () => request(app.getHttpServer()).get('/v2/openid4vc/signing-certificates'),
    ]

    for (const send of requests) {
      const response = await send()
      expect(response.status).toBe(404)
      expect(response.body.error.code).toBe('UNKNOWN_ID')
    }
  })
})
