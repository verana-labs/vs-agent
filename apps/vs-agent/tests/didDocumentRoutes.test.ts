import { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { afterEach, describe, expect, it } from 'vitest'

import { DidWebController } from '../src/controllers/public/didcomm/DidWebController'
import { VsAgentService } from '../src/services'

const didDocument = { id: 'did:web:agent.example', service: [], verificationMethod: [] }

const agentStub = {
  did: 'did:web:agent.example',
  config: { logger: { debug: () => {} } },
  dids: {
    getCreatedDids: async () => [{ didDocument, metadata: { get: () => [{ versionId: '1' }] } }],
  },
}

async function appFor(publicApiBaseUrl: string): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    controllers: [DidWebController],
    providers: [
      { provide: VsAgentService, useValue: { getAgent: async () => agentStub } },
      { provide: 'PUBLIC_API_BASE_URL', useValue: publicApiBaseUrl },
    ],
  }).compile()
  const app = moduleRef.createNestApplication()
  await app.init()
  return app
}

describe('public DID document routes follow the location shape', () => {
  let app: INestApplication | undefined

  afterEach(async () => {
    await app?.close()
    app = undefined
  })

  it('a bare domain answers only under /.well-known', async () => {
    app = await appFor('https://agent.example')
    expect((await request(app.getHttpServer()).get('/did.json')).status).toBe(404)
    expect((await request(app.getHttpServer()).get('/did.jsonl')).status).toBe(404)
    expect((await request(app.getHttpServer()).get('/.well-known/did.json')).status).toBe(200)
  })

  it('a path location answers only outside /.well-known', async () => {
    app = await appFor('https://agent.example/dids/issuer')
    expect((await request(app.getHttpServer()).get('/.well-known/did.json')).status).toBe(404)
    expect((await request(app.getHttpServer()).get('/.well-known/did.jsonl')).status).toBe(404)
    expect((await request(app.getHttpServer()).get('/did.json')).status).toBe(200)
  })
})
