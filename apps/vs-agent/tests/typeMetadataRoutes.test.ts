import { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { SelfTrController, TrustService } from '../src/controllers'
import { VsAgentService } from '../src/services/VsAgentService'

const PUBLIC_API_BASE_URL = 'https://agent.example'
const SCHEMA_REF = 'vpr:verana:vna-testnet-1:cs:144'
// stored compact, so a re-serialization by the framework would show up as different bytes
const BYTES = JSON.stringify({
  vct: `${PUBLIC_API_BASE_URL}/vt/vct/144`,
  name: 'EmployeeCredential',
  claims: [{ path: ['name'], sd: 'always' }],
  relatedJsonSchemaCredentialId: `${PUBLIC_API_BASE_URL}/vt/schemas-144-jsc.json`,
})

/** The DID record as a restarted agent reads it back: only what the store persisted. */
const didRecord = {
  metadata: { get: (key: string) => (key === '_vt/jsc' ? { [SCHEMA_REF]: { typeMetadata: BYTES } } : null) },
}
const agent = { did: 'did:web:agent.example', dids: { getCreatedDids: async () => [didRecord] } }

describe('GET /vt/vct/:credentialSchemaId', () => {
  let app: INestApplication

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [SelfTrController],
      providers: [
        TrustService,
        { provide: VsAgentService, useValue: { getAgent: async () => agent } },
        { provide: 'PUBLIC_API_BASE_URL', useValue: PUBLIC_API_BASE_URL },
      ],
    }).compile()
    app = module.createNestApplication()
    // the public listener pretty-prints JSON; the stored bytes must go out untouched anyway
    app.getHttpAdapter().getInstance().set('json spaces', 2)
    await app.init()
  })

  afterAll(async () => {
    await app.close()
  })

  it('serves the stored bytes as JSON, identical on every request', async () => {
    const first = await request(app.getHttpServer()).get('/vt/vct/144')
    const second = await request(app.getHttpServer()).get('/vt/vct/144')

    expect(first.status).toBe(200)
    expect(first.headers['content-type']).toMatch(/^application\/json/)
    expect(first.text).toBe(BYTES)
    expect(second.text).toBe(first.text)
  })

  it('answers 404 for a schema without a VTJSC', async () => {
    const response = await request(app.getHttpServer()).get('/vt/vct/7')
    expect(response.status).toBe(404)
  })
})
