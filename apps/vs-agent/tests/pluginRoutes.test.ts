import type { INestApplication } from '@nestjs/common'
import type { VsAgentNestPlugin } from '@verana-labs/vs-agent-sdk'

import { ValidationPipe, VersioningType } from '@nestjs/common'
import { HttpAdapterHost } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import { ChatPlugin } from '@verana-labs/vs-agent-plugin-chat'
import { MrtdPlugin } from '@verana-labs/vs-agent-plugin-mrtd'
import request from 'supertest'
import { afterEach, describe, expect, it } from 'vitest'

import { VsAgentModule } from '../src/admin.module'
import { ErrorEnvelopeFilter } from '../src/common'

const agent = { isInitialized: true, context: { dependencyManager: {} }, modules: {}, didcomm: {} }

async function appWith(plugins: VsAgentNestPlugin[]): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [VsAgentModule.register(agent as never, 'http://localhost:3001', plugins)],
  }).compile()

  const app = moduleRef.createNestApplication()
  app.enableVersioning({ type: VersioningType.URI })
  app.useGlobalPipes(new ValidationPipe())
  app.useGlobalFilters(new ErrorEnvelopeFilter(app.get(HttpAdapterHost).httpAdapter))
  await app.init()

  return app
}

const CHAT_PATHS = [
  '/v2/didcomm/receipts',
  '/v2/didcomm/reactions',
  '/v2/didcomm/user-profile/send',
  '/v2/didcomm/media-sharing',
  '/v2/didcomm/calls',
  '/v2/didcomm/action-menu',
  '/v2/didcomm/question-answer',
]
const MRTD_PATH = '/v2/didcomm/mrtd/request-mrz'

describe('extension module routes exist only when the plugin does', () => {
  let app: INestApplication | undefined

  afterEach(async () => {
    await app?.close()
    app = undefined
  })

  it('serves every chat route when the chat plugin is registered', async () => {
    app = await appWith([ChatPlugin()])

    for (const path of CHAT_PATHS) {
      const response = await request(app.getHttpServer()).post(path).send({})
      expect({ path, status: response.status }).toEqual({ path, status: 400 })
    }
  })

  it('serves the mrtd route when the mrtd plugin is registered', async () => {
    app = await appWith([MrtdPlugin()])

    const response = await request(app.getHttpServer()).post(MRTD_PATH).send({})
    expect(response.status).toBe(400)
  })

  it('answers 404 on every extension route when no plugin is registered', async () => {
    app = await appWith([])

    for (const path of [...CHAT_PATHS, MRTD_PATH]) {
      const response = await request(app.getHttpServer()).post(path).send({})
      expect({ path, status: response.status }).toEqual({ path, status: 404 })
    }
  })
})
