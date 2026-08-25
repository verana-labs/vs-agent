import { CanActivate, Controller, Get, INestApplication, Module } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { afterEach, describe, expect, it } from 'vitest'

import { parseTrustedNetworks, restrictDocsToTrustedPeers } from '../src/security'

class DenyExternal implements CanActivate {
  canActivate(): boolean {
    return false
  }
}

@Controller('thing')
class ThingController {
  @Get()
  get(): string {
    return 'ok'
  }
}

@Module({ controllers: [ThingController], providers: [{ provide: APP_GUARD, useClass: DenyExternal }] })
class AdminLikeModule {}

describe('the API documentation follows the trusted network rule', () => {
  let app: INestApplication | undefined

  afterEach(async () => {
    await app?.close()
    app = undefined
  })

  it('is refused for a peer outside the trusted networks', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AdminLikeModule] }).compile()
    app = moduleRef.createNestApplication()
    const trustedNetworks = parseTrustedNetworks(['10.0.0.0/8'])
    app.use(restrictDocsToTrustedPeers(trustedNetworks))
    const doc = SwaggerModule.createDocument(app, new DocumentBuilder().setTitle('t').build())
    SwaggerModule.setup('api', app, doc)
    await app.init()

    expect((await request(app.getHttpServer()).get('/api-json')).status).toBe(403)
    expect((await request(app.getHttpServer()).get('/api')).status).toBe(403)
  })

  it('is served to a trusted peer', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AdminLikeModule] }).compile()
    app = moduleRef.createNestApplication()
    const trustedNetworks = parseTrustedNetworks(['127.0.0.0/8', '::1/128'])
    app.use(restrictDocsToTrustedPeers(trustedNetworks))
    const doc = SwaggerModule.createDocument(app, new DocumentBuilder().setTitle('t').build())
    SwaggerModule.setup('api', app, doc)
    await app.init()

    expect((await request(app.getHttpServer()).get('/api-json')).status).toBe(200)
  })
})
