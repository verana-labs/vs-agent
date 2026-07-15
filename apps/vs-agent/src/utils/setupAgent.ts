import type { DidCommFeatureQueryOptions, DidCommVersion } from '@credo-ts/didcomm'

import { AskarModuleConfigStoreOptions } from '@credo-ts/askar'
import { LogLevel, ParsedDid } from '@credo-ts/core'
import { agentDependencies } from '@credo-ts/node'
import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import {
  assertVerifiableService,
  createVsAgent,
  HttpInboundTransport,
  migrateLegacyTailsFiles,
  setupBaseDidComm,
  VeranaChainService,
  VeranaIndexerService,
  VsAgentWsInboundTransport,
  VtFlowOrchestrator,
} from '@verana-labs/vs-agent-sdk'
import express from 'express'
import WebSocket from 'ws'

import {
  AGENT_DIDCOMM_VERSIONS,
  ENABLE_PUBLIC_API_SWAGGER,
  ENABLED_PLUGINS,
  VERANA_CHAIN_ID,
  VERANA_INDEXER_BASE_URL,
} from '../config'
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
  discoveryOptions,
  adminApiServiceEndpoint,
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
  discoveryOptions?: DidCommFeatureQueryOptions[]
  adminApiServiceEndpoint?: string
}) => {
  const logger = new TsLogger(logLevel ?? LogLevel.Warn, 'Agent')
  const publicDid = parsedDid?.did

  if (endpoints.length === 0) {
    throw new Error('There are no DIDComm endpoints defined. Please set at least one (e.g. wss://myhost)')
  }

  const allowedDidCommVersions: DidCommVersion[] = ['v1', 'v2']
  const invalidDidCommVersions = AGENT_DIDCOMM_VERSIONS.filter(
    v => !allowedDidCommVersions.includes(v as DidCommVersion),
  )
  if (invalidDidCommVersions.length > 0) {
    throw new Error(
      `Invalid AGENT_DIDCOMM_VERSIONS values: ${invalidDidCommVersions.join(', ')}. Allowed: ${allowedDidCommVersions.join(', ')}`,
    )
  }
  if (AGENT_DIDCOMM_VERSIONS.length === 0) {
    throw new Error('AGENT_DIDCOMM_VERSIONS must contain at least one of: v1, v2')
  }
  const didcommVersions = AGENT_DIDCOMM_VERSIONS as DidCommVersion[]

  const optImport = (name: string): Promise<any> => import(name).catch(() => null)
  const [chatSetup, mrtdSetup] = await Promise.all([
    ENABLED_PLUGINS.includes('chat')
      ? optImport('@verana-labs/vs-agent-plugin-chat').catch(() => null)
      : null,
    ENABLED_PLUGINS.includes('mrtd')
      ? optImport('@verana-labs/vs-agent-plugin-mrtd').catch(() => null)
      : null,
  ])

  const verifiablePublicRegistries =
    VERANA_INDEXER_BASE_URL && VERANA_CHAIN_ID
      ? [
          {
            id: `vpr:verana:${VERANA_CHAIN_ID}`,
            baseUrls: [`${VERANA_INDEXER_BASE_URL}/verana`],
            production: true,
          },
        ]
      : undefined

  const indexer = VERANA_INDEXER_BASE_URL
    ? new VeranaIndexerService({ baseUrl: VERANA_INDEXER_BASE_URL, logger })
    : undefined
  // eslint-disable-next-line prefer-const
  let orchestrator: VtFlowOrchestrator | undefined

  const agent = createVsAgent({
    plugins: [
      setupBaseDidComm({
        walletConfig,
        publicApiBaseUrl,
        endpoints,
        didcommVersions,
        vtFlow: {
          autoIssueCredentialOnRequest: true,
          autoAcceptIssuanceRequest: true,
          autoOfferCredential: true,
          buildCredentialOffer: async ({ record }) => {
            if (!orchestrator) return null
            try {
              return await orchestrator.buildDirectIssuanceOffer(record.id)
            } catch (error) {
              logger.error(`[vt-flow] direct issuance offer failed: ${(error as Error).message}`)
              return null
            }
          },
          assertVerifiableService: verifiablePublicRegistries
            ? assertVerifiableService({ verifiablePublicRegistries })
            : undefined,
          autoAcceptCredentialOffer: true,
          verifyCredential: async ({ record }) => {
            if (!orchestrator) {
              logger.warn('[vt-flow] verifyCredential skipped: orchestrator not ready')
              return false
            }
            for (let attempt = 1; attempt <= 10; attempt++) {
              try {
                await orchestrator.verifyOfferedCredential(record.id)
                return true
              } catch (error) {
                if (attempt === 10) {
                  logger.error(`[vt-flow] credential verification failed: ${(error as Error).message}`)
                } else {
                  await new Promise(resolve => setTimeout(resolve, 3000))
                }
              }
            }
            return false
          },
          onCompleted: async ({ record }) => {
            if (!orchestrator) return
            try {
              await orchestrator.onCredentialCompleted(record.id)
            } catch (error) {
              logger.error(`[vt-flow] onCompleted failed: ${(error as Error).message}`)
            }
          },
        },
      }),
      ...(chatSetup ? [chatSetup.setupChatProtocols()] : []),
      ...(mrtdSetup ? [mrtdSetup.setupMrtdProtocol({ masterListCscaLocation })] : []),
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
    discoveryOptions,
    adminApiServiceEndpoint,
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

  orchestrator = new VtFlowOrchestrator(agent, { indexer, publicApiBaseUrl })

  await agent.initialize()

  migrateLegacyTailsFiles(agent.context)

  const verifyPeer = verifiablePublicRegistries
    ? async (peerDid: string): Promise<boolean> => {
        const hook = assertVerifiableService({ verifiablePublicRegistries, logger })
        return hook({ agentContext: agent.context, peerDid, connectionId: '' })
      }
    : undefined

  return { agent, indexer, verifyPeer }
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
