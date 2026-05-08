import { AskarModuleConfigStoreOptions } from '@credo-ts/askar'
import { LogLevel, ParsedDid } from '@credo-ts/core'
import { agentDependencies } from '@credo-ts/node'
import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import { setupVtFlow } from '@verana-labs/credo-ts-didcomm-vt-flow'
import {
  createVsAgent,
  HttpInboundTransport,
  setupBaseDidComm,
  VeranaChainService,
  VsAgentWsInboundTransport,
} from '@verana-labs/vs-agent-sdk'
import express from 'express'
import WebSocket from 'ws'

import { ENABLE_PUBLIC_API_SWAGGER, ENABLED_PLUGINS } from '../config'
import { MessageService } from '../controllers/admin/message/MessageService'

import { TsLogger } from './logger'

export const setupAgent = async ({
  port,
  walletConfig,
  label,
  displayPictureUrl,
  endpoints,
  logLevel,
  publicApiBaseUrl,
  parsedDid,
  autoDiscloseUserProfile,
  masterListCscaLocation,
  autoUpdateStorageOnStartup,
  veranaChain,
}: {
  port: number
  walletConfig: AskarModuleConfigStoreOptions
  label: string
  displayPictureUrl?: string
  endpoints: string[]
  logLevel?: LogLevel
  publicApiBaseUrl: string
  autoDiscloseUserProfile?: boolean
  parsedDid?: ParsedDid
  masterListCscaLocation?: string
  autoUpdateStorageOnStartup?: boolean
  veranaChain?: VeranaChainService
}) => {
  const logger = new TsLogger(logLevel ?? LogLevel.Warn, 'Agent')
  const publicDid = parsedDid?.did

  if (endpoints.length === 0) {
    throw new Error('There are no DIDComm endpoints defined. Please set at least one (e.g. wss://myhost)')
  }

  const optImport = (name: string): Promise<any> => import(name).catch(() => null)
  const [chatSetup, mrtdSetup] = await Promise.all([
    ENABLED_PLUGINS.includes('chat')
      ? optImport('@verana-labs/vs-agent-plugin-chat').catch(() => null)
      : null,
    ENABLED_PLUGINS.includes('mrtd')
      ? optImport('@verana-labs/vs-agent-plugin-mrtd').catch(() => null)
      : null,
  ])

  const agent = createVsAgent({
    plugins: [
      setupBaseDidComm({ walletConfig, publicApiBaseUrl, endpoints }),
      ...(chatSetup ? [chatSetup.setupChatProtocols()] : []),
      ...(mrtdSetup ? [mrtdSetup.setupMrtdProtocol({ masterListCscaLocation })] : []),
      ...(ENABLED_PLUGINS.includes('vt-flow') ? [setupVtFlow()] : []),
    ],
    config: {
      logger,
      autoUpdateStorageOnStartup,
    },
    walletConfig,
    did: publicDid,
    autoDiscloseUserProfile,
    dependencies: agentDependencies,
    publicApiBaseUrl,
    masterListCscaLocation,
    displayPictureUrl,
    label,
    veranaChain,
  })

  const enableHttp = endpoints.find(endpoint => endpoint.startsWith('http'))
  if (enableHttp) {
    logger.info('Inbound HTTP transport enabled')
    agent.didcomm.registerInboundTransport(new HttpInboundTransport({ port }))
  }

  const enableWs = endpoints.find(endpoint => endpoint.startsWith('ws'))
  if (enableWs) {
    logger.info('Inbound WebSocket transport enabled')
    agent.didcomm.registerInboundTransport(
      new VsAgentWsInboundTransport({ server: new WebSocket.Server({ noServer: true }) }),
    )
  }

  await agent.initialize()

  return { agent }
}

export function commonAppConfig(app: INestApplication, cors?: boolean, publicApp: boolean = false) {
  // Versioning
  app.enableVersioning({
    type: VersioningType.URI,
  })

  // Swagger
  const config = new DocumentBuilder()
    .setTitle('API Documentation')
    .setDescription('API Documentation')
    .setVersion('1.0')
    .build()
  const document = SwaggerModule.createDocument(app, config)

  // Inject dynamic message examples from registered handlers
  if (!publicApp) {
    const messageService = app.get(MessageService)
    for (const pathItem of Object.values(document.paths ?? {})) {
      const postOp = (pathItem as any).post
      if (postOp?.tags?.includes('message') && postOp?.requestBody?.content?.['application/json']) {
        postOp.requestBody.content['application/json'].examples = messageService.openApiExamples
      }
    }
  }

  if (!publicApp || (publicApp && ENABLE_PUBLIC_API_SWAGGER)) SwaggerModule.setup('api', app, document)

  // Pipes
  app.useGlobalPipes(new ValidationPipe())

  // CORS
  if (cors) {
    app.enableCors({
      origin: '*',
      methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
      allowedHeaders: 'Content-Type,Authorization',
    })
  }

  app.use(express.json({ limit: '5mb' }))
  app.use(express.urlencoded({ extended: true, limit: '5mb' }))

  return app
}
