import { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import request from 'supertest'
import { afterEach, describe, expect, it } from 'vitest'

import { DidWebController } from '../src/controllers/public/didcomm/DidWebController'
import { VsAgentService } from '../src/services'

const WEB_DID = 'did:web:agent.example'
const WEBVH_DID = 'did:webvh:QmScidPlaceholder:agent.example'

function agentStub(did: string) {
  const didDocument = { id: did, service: [], verificationMethod: [] }
  const resolvedRepositories: string[] = []
  const genericRecordQueries: unknown[] = []

  const agent = {
    did,
    config: { logger: { debug: () => {} } },
    context: {},
    dependencyManager: {
      resolve: (token: { name: string }) => {
        resolvedRepositories.push(token.name)
        return {
          findBySchemaId: async () => null,
          findByCredentialDefinitionId: async () => null,
          findByRevocationRegistryDefinitionId: async () => null,
        }
      },
    },
    genericRecords: {
      findAllByQuery: async (query: unknown) => {
        genericRecordQueries.push(query)
        return [{ content: { resource: 'r-1' } }]
      },
    },
    dids: {
      getCreatedDids: async () => [{ didDocument, metadata: { get: () => [{ versionId: '1' }] } }],
    },
  }

  return { agent, resolvedRepositories, genericRecordQueries }
}

async function appFor(publicApiBaseUrl: string, agent: unknown = agentStub(WEB_DID).agent) {
  const moduleRef = await Test.createTestingModule({
    controllers: [DidWebController],
    providers: [
      { provide: VsAgentService, useValue: { getAgent: async () => agent } },
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

describe('artifact routes answer only for the method of the agent DID', () => {
  let app: INestApplication | undefined

  afterEach(async () => {
    await app?.close()
    app = undefined
  })

  it('a did:web agent resolves the AnonCreds registry routes', async () => {
    const { agent, resolvedRepositories } = agentStub(WEB_DID)
    app = await appFor('https://agent.example', agent)

    await request(app.getHttpServer()).get('/anoncreds/v1/schema/s-1')
    await request(app.getHttpServer()).get('/anoncreds/v1/credDef/cd-1')
    await request(app.getHttpServer()).get('/anoncreds/v1/revRegDef/rr-1')
    await request(app.getHttpServer()).get('/anoncreds/v1/revStatus/rr-1')

    expect(resolvedRepositories).toEqual([
      'AnonCredsSchemaRepository',
      'AnonCredsCredentialDefinitionRepository',
      'AnonCredsRevocationRegistryDefinitionRepository',
      'AnonCredsRevocationRegistryDefinitionRepository',
    ])
  })

  it('a did:webvh agent serves no AnonCreds registry route', async () => {
    const { agent, resolvedRepositories } = agentStub(WEBVH_DID)
    app = await appFor('https://agent.example', agent)

    for (const route of [
      '/anoncreds/v1/schema/s-1',
      '/anoncreds/v1/credDef/cd-1',
      '/anoncreds/v1/revRegDef/rr-1',
      '/anoncreds/v1/revStatus/rr-1',
    ]) {
      expect((await request(app.getHttpServer()).get(route)).status).toBe(404)
    }

    expect(resolvedRepositories).toEqual([])
  })

  it('a did:webvh agent resolves the attested resource routes', async () => {
    const { agent, genericRecordQueries } = agentStub(WEBVH_DID)
    app = await appFor('https://agent.example', agent)

    expect((await request(app.getHttpServer()).get('/resources?resourceType=anonCredsSchema')).status).toBe(
      200,
    )
    expect((await request(app.getHttpServer()).get('/resources/r-1')).status).toBe(200)
    expect(genericRecordQueries).toHaveLength(2)
  })

  it('a did:web agent serves no attested resource route', async () => {
    const { agent, genericRecordQueries } = agentStub(WEB_DID)
    app = await appFor('https://agent.example', agent)

    expect((await request(app.getHttpServer()).get('/resources?resourceType=anonCredsSchema')).status).toBe(
      404,
    )
    expect((await request(app.getHttpServer()).get('/resources/r-1')).status).toBe(404)
    expect(genericRecordQueries).toEqual([])
  })

  it('serves the tails file whatever the method of the agent DID is', async () => {
    const tailsDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'vs-agent-tails-'))
    fs.writeFileSync(path.join(tailsDirectory, 'tails-1'), 'tails')
    const previous = process.env.TAILS_DIRECTORY_PATH
    process.env.TAILS_DIRECTORY_PATH = tailsDirectory

    try {
      const { agent } = agentStub(WEBVH_DID)
      app = await appFor('https://agent.example', agent)

      expect((await request(app.getHttpServer()).get('/anoncreds/v1/tails/tails-1')).status).toBe(200)
    } finally {
      process.env.TAILS_DIRECTORY_PATH = previous ?? ''
      fs.rmSync(tailsDirectory, { recursive: true, force: true })
    }
  })
})
