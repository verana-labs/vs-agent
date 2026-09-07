import type { INestApplication } from '@nestjs/common'

import { HttpAdapterHost } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { ErrorEnvelopeFilter } from '../src/common'
import { ShortUrlController } from '../src/controllers/public/short-url'
import { UrlShorteningService } from '../src/services'

const invitation = { type: 'https://didcomm.org/out-of-band/2.0/invitation', id: 'inv-1' }

describe('short url resolution', () => {
  let app: INestApplication

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ShortUrlController],
      providers: [
        {
          provide: UrlShorteningService,
          useValue: { getInvitation: async (id: string) => (id === 'abcd' ? invitation : undefined) },
        },
      ],
    }).compile()
    app = moduleRef.createNestApplication()
    await app.init()
    app.useGlobalFilters(new ErrorEnvelopeFilter(app.get(HttpAdapterHost).httpAdapter))
  })

  afterAll(async () => {
    await app?.close()
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
})
