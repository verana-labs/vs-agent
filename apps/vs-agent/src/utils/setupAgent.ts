import { AskarModuleConfigStoreOptions } from '@credo-ts/askar'
import { LogLevel, ParsedDid } from '@credo-ts/core'
import { agentDependencies } from '@credo-ts/node'
import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import {
  createVsAgent,
  HttpInboundTransport,
  setupBaseDidComm,
  setupChatProtocols,
  setupMrtdProtocol,
  VsAgentWsInboundTransport,
} from '@verana-labs/vs-agent-sdk'
import express from 'express'
import WebSocket from 'ws'

import { ENABLE_PUBLIC_API_SWAGGER, ENABLED_PLUGINS } from '../config'

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
}) => {
  const logger = new TsLogger(logLevel ?? LogLevel.warn, 'Agent')
  const publicDid = parsedDid?.did

  if (endpoints.length === 0) {
    throw new Error('There are no DIDComm endpoints defined. Please set at least one (e.g. wss://myhost)')
  }

  const agent = createVsAgent({
    plugins: [
      setupBaseDidComm({ walletConfig, publicApiBaseUrl, endpoints }),
      ...(ENABLED_PLUGINS.includes('messaging') ? [setupChatProtocols()] : []),
      ...(ENABLED_PLUGINS.includes('mrtd') ? [setupMrtdProtocol({ masterListCscaLocation })] : []),
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
