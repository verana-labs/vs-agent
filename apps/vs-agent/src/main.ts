import 'reflect-metadata'

import { parseDid, utils } from '@credo-ts/core'
import { NestFactory } from '@nestjs/core'
import { KdfMethod } from '@openwallet-foundation/askar-nodejs'
import {
  HttpInboundTransport,
  VsAgent,
  VsAgentWsInboundTransport,
  type VsAgentNestPlugin,
  resolveVeranaMnemonic,
  VeranaChainService,
} from '@verana-labs/vs-agent-sdk'
import * as express from 'express'
import * as fs from 'fs'
import { IncomingMessage } from 'http'
import { Socket } from 'net'
import * as path from 'path'

import packageJson from '../package.json'

import { VsAgentModule } from './admin.module'
import {
  ADMIN_LOG_LEVEL,
  ADMIN_PORT,
  AGENT_ENDPOINT,
  AGENT_ENDPOINTS,
  AGENT_INVITATION_IMAGE_URL,
  AGENT_LABEL,
  UI_WELCOME_MESSAGE,
  AGENT_LOG_LEVEL,
  AGENT_NAME,
  AGENT_PORT,
  AGENT_PUBLIC_DID,
  AGENT_WALLET_ID,
  AGENT_WALLET_KEY,
  AGENT_WALLET_KEY_DERIVATION_METHOD,
  askarPostgresConfig,
  DEFAULT_AGENT_ENDPOINTS,
  DEFAULT_PUBLIC_API_BASE_URL,
  ENABLED_PLUGINS,
  EVENTS_BASE_URL,
  keyDerivationMethodMap,
  POSTGRES_HOST,
  PUBLIC_API_BASE_URL,
  USE_CORS,
  USER_PROFILE_AUTODISCLOSE,
  MASTER_LIST_CSCA_LOCATION,
  AGENT_AUTO_UPDATE_STORAGE_ON_STARTUP,
  AGENT_VERANA_MNEMONIC,
  VERANA_RPC,
} from './config'
import { connectionEvents } from './events/ConnectionEvents'
import { MessagingPlugin } from './plugins'
import { PublicModule } from './public.module'
import { commonAppConfig, type ServerConfig, setupAgent, setupSelfTr, TsLogger } from './utils'

export const startServers = async (agent: VsAgent, serverConfig: ServerConfig) => {
  const { port, cors, endpoints, publicApiBaseUrl, nestPlugins = [] } = serverConfig

  const adminApp = await NestFactory.create(VsAgentModule.register(agent, publicApiBaseUrl, nestPlugins))
  commonAppConfig(adminApp, cors)
  await adminApp.listen(port)

  // PublicModule-specific config
  const publicApp = await NestFactory.create(PublicModule.register(agent, publicApiBaseUrl))
  commonAppConfig(publicApp, cors, true)

  // Send environment to UI
  const publicDir = path.join(__dirname, '../../public')
  const indexPath = path.join(publicDir, 'index.html')
  publicApp
    .getHttpAdapter()
    .getInstance()
    .get(['/', '/index.html'], (_req: express.Request, res: express.Response) => {
      const config = { label: AGENT_LABEL, welcomeMessage: UI_WELCOME_MESSAGE }
      const script = `<script>window.__VS_AGENT__=${JSON.stringify(config)};</script>`
      const html = fs.readFileSync(indexPath, 'utf-8').replace('</head>', `${script}</head>`)
      res.type('html').send(html)
    })
  publicApp.use(express.static(publicDir))
  publicApp.getHttpAdapter().getInstance().set('json spaces', 2)

  const enableHttp = endpoints.find(endpoint => endpoint.startsWith('http'))
  const enableWs = endpoints.find(endpoint => endpoint.startsWith('ws'))

  const webSocketServer = agent.didcomm.inboundTransports
    .find(x => x instanceof VsAgentWsInboundTransport)
    ?.getServer()
  const httpInboundTransport = agent.didcomm.inboundTransports.find(x => x instanceof HttpInboundTransport)

  if (enableHttp) {
    httpInboundTransport?.setApp(publicApp.getHttpAdapter().getInstance())
  }

  const httpServer = httpInboundTransport ? httpInboundTransport.server : await publicApp.listen(AGENT_PORT)

  // Add WebSocket support if required
  if (enableWs) {
    httpServer?.on('upgrade', (request: IncomingMessage, socket: Socket, head: Buffer) => {
      webSocketServer?.handleUpgrade(request, socket as Socket, head, socketParam => {
        const socketId = utils.uuid()
        webSocketServer?.emit('connection', socketParam, request, socketId)
      })
    })
  }
}

const run = async () => {
  const serverLogger = new TsLogger(ADMIN_LOG_LEVEL, 'Server')

  if (AGENT_NAME) {
    serverLogger.error(
      'AGENT_NAME variable is defined and it is not supported anymore. Please use AGENT_WALLET_ID and AGENT_WALLET_KEY instead',
    )
    process.exit(1)
  }

  if (AGENT_ENDPOINT) {
    serverLogger.warn(
      'AGENT_ENDPOINT variable is defined and it is deprecated. Please use AGENT_ENDPOINTS instead.',
    )
  }

  const parsedDid = AGENT_PUBLIC_DID ? parseDid(AGENT_PUBLIC_DID) : null

  if (!AGENT_PUBLIC_DID) {
    serverLogger.warn('AGENT_PUBLIC_DID is not defined. You must set it in production releases')
  }

  // Check it is a supported DID method
  if (parsedDid && !['web', 'webvh'].includes(parsedDid.method)) {
    serverLogger.error('Only did:web or did:webvh method is supported')
    process.exit(1)
  }

  let endpoints = AGENT_ENDPOINTS
  if (!endpoints && parsedDid) endpoints = [`wss://${decodeURIComponent(parsedDid.id)}`]
  if (!endpoints) endpoints = DEFAULT_AGENT_ENDPOINTS

  let publicApiBaseUrl = PUBLIC_API_BASE_URL
  if (!publicApiBaseUrl && parsedDid) publicApiBaseUrl = `https://${decodeURIComponent(parsedDid.id)}`
  if (!publicApiBaseUrl) publicApiBaseUrl = DEFAULT_PUBLIC_API_BASE_URL

  serverLogger.info(`endpoints: ${endpoints} publicApiBaseUrl ${publicApiBaseUrl}`)

  // Dynamically load optional plugin packages.
  const optImport = (name: string): Promise<any> => import(name).catch(() => null)
  const [chatModule, mrtdModule] = await Promise.all([
    ENABLED_PLUGINS.includes('chat') ? optImport('@verana-labs/vs-agent-plugin-chat') : null,
    ENABLED_PLUGINS.includes('mrtd') ? optImport('@verana-labs/vs-agent-plugin-mrtd') : null,
  ])

  if (
    (ENABLED_PLUGINS.includes('chat') && !chatModule) ||
    (ENABLED_PLUGINS.includes('mrtd') && !mrtdModule)
  ) {
    serverLogger.warn('Some enabled plugins could not be loaded. Check installation.')
  }
  if (MASTER_LIST_CSCA_LOCATION && !mrtdModule)
    serverLogger.warn(
      'MASTER_LIST_CSCA_LOCATION is set but the MRTD plugin could not be loaded, eMRTD verification is disabled. Use the vs-agent-mrtd Docker image to enable it.',
    )

  // Build the list of active NestJS plugins
  const nestPlugins: VsAgentNestPlugin[] = [
    ...(ENABLED_PLUGINS.includes('messaging') ? [MessagingPlugin] : []),
    ...(chatModule ? [chatModule.ChatPlugin] : []),
    ...(mrtdModule ? [mrtdModule.MrtdPlugin({ masterListCscaLocation: MASTER_LIST_CSCA_LOCATION })] : []),
  ]

  const { agent } = await setupAgent({
    endpoints,
    port: AGENT_PORT,
    walletConfig: {
      id: AGENT_WALLET_ID || 'test-vs-agent',
      key: AGENT_WALLET_KEY || 'test-vs-agent',
      keyDerivationMethod: keyDerivationMethodMap[AGENT_WALLET_KEY_DERIVATION_METHOD ?? KdfMethod.Argon2IMod],
      database: POSTGRES_HOST ? askarPostgresConfig : undefined,
    },
    label: AGENT_LABEL || 'Test VS Agent',
    displayPictureUrl: AGENT_INVITATION_IMAGE_URL,
    parsedDid: parsedDid ?? undefined,
    logLevel: AGENT_LOG_LEVEL,
    publicApiBaseUrl,
    autoDiscloseUserProfile: USER_PROFILE_AUTODISCLOSE,
    masterListCscaLocation: MASTER_LIST_CSCA_LOCATION,
    autoUpdateStorageOnStartup: AGENT_AUTO_UPDATE_STORAGE_ON_STARTUP,
  })

  const discoveryOptions = (() => {
    try {
      return JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'discovery.json'), 'utf-8'))
    } catch (error) {
      agent.config.logger.warn('Error reading discovery.json file:', error.message)
      return undefined
    }
  })()
  const conf: ServerConfig = {
    port: ADMIN_PORT,
    cors: USE_CORS,
    logger: serverLogger,
    webhookUrl: EVENTS_BASE_URL,
    publicApiBaseUrl,
    discoveryOptions,
    endpoints,
    nestPlugins,
  }

  await startServers(agent, conf)

  // Initialize Self-Trust Registry
  if (agent.did) await setupSelfTr({ agent, publicApiBaseUrl })

  // Register base events (always active)
  connectionEvents(agent as any, conf)

  // Register plugin events after agent is initialized
  for (const plugin of nestPlugins) {
    plugin.registerEvents?.(agent, conf)
  }

  // Connect to Verana blockchain for on-chain queries
  if (VERANA_RPC) {
    const mnemonic = await resolveVeranaMnemonic(agent, AGENT_VERANA_MNEMONIC, serverLogger)
    const veranaChain = new VeranaChainService(VERANA_RPC, mnemonic, serverLogger)
    await veranaChain.start()
  }

  agent.config.logger.info(
    `VS Agent v${packageJson['version']} running in port ${AGENT_PORT}. Admin interface at port ${conf.port}`,
  )
}

run()
