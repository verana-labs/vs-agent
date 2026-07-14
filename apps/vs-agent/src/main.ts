import 'reflect-metadata'

import { parseDid, utils } from '@credo-ts/core'
import { NestFactory } from '@nestjs/core'
import { KdfMethod } from '@openwallet-foundation/askar-nodejs'
import {
  AuthorizationService,
  HttpInboundTransport,
  setupSelfTr,
  VsAgent,
  VsAgentWsInboundTransport,
  type VsAgentNestPlugin,
  VeranaChainService,
  VeranaIndexerService,
  IndexerWebSocketService,
  buildDefaultIndexerHandlerRegistry,
  registerAuthorizationHandlers,
  EcsBootstrapService,
  reconcileVtjscPublications,
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
  FALLBACK_BASE64,
  SELF_ISSUED_VTC_ORG_ADDRESS,
  SELF_ISSUED_VTC_ORG_COUNTRYCODE,
  SELF_ISSUED_VTC_ORG_REGISTRYID,
  SELF_ISSUED_VTC_ORG_REGISTRYURL,
  SELF_ISSUED_VTC_ORG_TYPE,
  SELF_ISSUED_VTC_SERVICE_DESCRIPTION,
  SELF_ISSUED_VTC_SERVICE_MINIMUMAGEREQUIRED,
  SELF_ISSUED_VTC_SERVICE_PRIVACYPOLICY,
  SELF_ISSUED_VTC_SERVICE_TERMSANDCONDITIONS,
  SELF_ISSUED_VTC_SERVICE_TYPE,
  UI_WELCOME_MESSAGE,
  AGENT_LOG_LEVEL,
  AGENT_NAME,
  AGENT_PORT,
  AGENT_PUBLIC_DID,
  AGENT_WALLET_ID,
  AGENT_WALLET_KEY,
  AGENT_WALLET_KEY_DERIVATION_METHOD,
  askarPostgresConfig,
  keyDerivationMethodMap,
  DEFAULT_AGENT_ENDPOINTS,
  ADMIN_API_AUTH_MODE,
  ADMIN_API_CORPORATION_ALLOWED_ACCOUNTS,
  ADMIN_API_EXTERNAL_PORT,
  ADMIN_API_PUBLIC_URL,
  DEFAULT_PUBLIC_API_BASE_URL,
  ENABLED_PLUGINS,
  EVENTS_BASE_URL,
  POSTGRES_HOST,
  PUBLIC_API_BASE_URL,
  USE_CORS,
  USER_PROFILE_AUTODISCLOSE,
  MASTER_LIST_CSCA_LOCATION,
  AGENT_AUTO_UPDATE_STORAGE_ON_STARTUP,
  VERANA_INDEXER_BASE_URL,
  VERANA_ACCOUNT_MNEMONIC,
  VERANA_RPC_ENDPOINT_URL,
  VERANA_CHAIN_ID,
  VERANA_INDEXER_DEFAULT_HANDLERS_OVERRIDE,
  VERANA_CORPORATION_ID,
  VERANA_INDEXER_SUBSCRIPTION_SCOPE,
  VERANA_AUTO_TRIGGER_RESOLVER,
  AGENT_MODE,
  AGENT_DELEGATED_PARENT_VS_DID,
  TRUSTED_ECS_ECOSYSTEM_DIDS,
} from './config'
import { MessagingPlugin, VtFlowNestPlugin } from './plugins'
import { PublicModule } from './public.module'
import { commonAppConfig, type ServerConfig, setupAgent, TsLogger, webhookEvent } from './utils'

export const startServers = async (agent: VsAgent, serverConfig: ServerConfig) => {
  const { port, cors, endpoints, publicApiBaseUrl, nestPlugins = [] } = serverConfig

  if (ADMIN_API_AUTH_MODE.includes('internal')) {
    const adminApp = await NestFactory.create(VsAgentModule.register(agent, publicApiBaseUrl, nestPlugins))
    commonAppConfig(adminApp, cors)
    await adminApp.listen(port)
  }

  if (ADMIN_API_AUTH_MODE.includes('corporation')) {
    const externalApp = await NestFactory.create(
      VsAgentModule.register(agent, publicApiBaseUrl, nestPlugins, {
        external: true,
        allowedAccounts: ADMIN_API_CORPORATION_ALLOWED_ACCOUNTS,
      }),
    )
    commonAppConfig(externalApp, cors, false, false)
    await externalApp.listen(ADMIN_API_EXTERNAL_PORT)
  }

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

  const webSocketServer = agent.didcomm.inboundTransports
    .find(x => x instanceof VsAgentWsInboundTransport)
    ?.getServer()
  const httpInboundTransport = agent.didcomm.inboundTransports.find(x => x instanceof HttpInboundTransport)

  if (enableHttp) {
    httpInboundTransport?.setApp(publicApp.getHttpAdapter().getInstance())
  }

  const httpServer = httpInboundTransport ? httpInboundTransport.server : await publicApp.listen(AGENT_PORT)

  return { httpServer, webSocketServer }
}

const AUTHORIZATION_SEED_RETRY_MS = 30_000

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

  const configErrors: string[] = []
  // Verana on-chain config is optional (v1.x behaviour); validate the format only when provided.
  if (VERANA_CORPORATION_ID && !/^\d+$/.test(VERANA_CORPORATION_ID)) {
    configErrors.push('VERANA_CORPORATION_ID must be a non-negative integer')
  }
  if (!['standalone', 'delegated'].includes(AGENT_MODE)) {
    configErrors.push(`AGENT_MODE must be 'standalone' or 'delegated' (got '${AGENT_MODE}')`)
  }
  if (AGENT_MODE === 'delegated' && !AGENT_DELEGATED_PARENT_VS_DID) {
    configErrors.push('AGENT_DELEGATED_PARENT_VS_DID is required when AGENT_MODE=delegated')
  }
  if (TRUSTED_ECS_ECOSYSTEM_DIDS.some(did => !did.startsWith('did:'))) {
    configErrors.push('TRUSTED_ECS_ECOSYSTEM_DIDS must be a comma-separated list of DIDs')
  }
  if (configErrors.length > 0) {
    serverLogger.error(`Invalid configuration:\n- ${configErrors.join('\n- ')}`)
    process.exit(1)
  }

  let endpoints = AGENT_ENDPOINTS
  if (!endpoints && parsedDid) endpoints = [`wss://${decodeURIComponent(parsedDid.id)}`]
  if (!endpoints) endpoints = DEFAULT_AGENT_ENDPOINTS

  let publicApiBaseUrl = PUBLIC_API_BASE_URL
  if (!publicApiBaseUrl && parsedDid) publicApiBaseUrl = `https://${decodeURIComponent(parsedDid.id)}`
  if (!publicApiBaseUrl) publicApiBaseUrl = DEFAULT_PUBLIC_API_BASE_URL

  serverLogger.info(`endpoints: ${endpoints} publicApiBaseUrl ${publicApiBaseUrl}`)

  if (ADMIN_API_AUTH_MODE.length === 0) {
    serverLogger.error('ADMIN_API_AUTH_MODE is required (comma-separated list of: internal, corporation)')
    process.exit(1)
  }
  const unknownAuthModes = ADMIN_API_AUTH_MODE.filter(mode => !['internal', 'corporation'].includes(mode))
  if (unknownAuthModes.length > 0) {
    serverLogger.error(
      `ADMIN_API_AUTH_MODE has unsupported value(s): ${unknownAuthModes.join(', ')}. Allowed: internal, corporation`,
    )
    process.exit(1)
  }
  if (ADMIN_API_PUBLIC_URL) {
    let isBareHttpsOrigin = false
    try {
      const url = new URL(ADMIN_API_PUBLIC_URL)
      isBareHttpsOrigin = url.protocol === 'https:' && url.origin === ADMIN_API_PUBLIC_URL
    } catch {
      isBareHttpsOrigin = false
    }
    if (!isBareHttpsOrigin) {
      serverLogger.error(
        'ADMIN_API_PUBLIC_URL must be a single https:// origin (scheme + host + optional port, no trailing path)',
      )
      process.exit(1)
    }
  }

  if (ADMIN_API_PUBLIC_URL && !ADMIN_API_AUTH_MODE.includes('corporation')) {
    serverLogger.error(
      'ADMIN_API_PUBLIC_URL must not be set unless ADMIN_API_AUTH_MODE includes "corporation"',
    )
    process.exit(1)
  }
  if (ADMIN_API_AUTH_MODE.includes('corporation') && !ADMIN_API_PUBLIC_URL) {
    serverLogger.error('ADMIN_API_PUBLIC_URL is required when ADMIN_API_AUTH_MODE includes "corporation"')
    process.exit(1)
  }
  const adminApiServiceEndpoint = ADMIN_API_AUTH_MODE.includes('corporation')
    ? ADMIN_API_PUBLIC_URL
    : undefined

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
    VtFlowNestPlugin,
  ]

  const indexerService = VERANA_INDEXER_BASE_URL
    ? new VeranaIndexerService({ baseUrl: VERANA_INDEXER_BASE_URL, logger: serverLogger })
    : undefined

  // Connect to Verana blockchain for on-chain transactions
  let veranaChain: VeranaChainService | undefined
  let authorizationService: AuthorizationService | undefined
  if (VERANA_RPC_ENDPOINT_URL && VERANA_ACCOUNT_MNEMONIC) {
    let corporationAddress: string | undefined
    if (VERANA_CORPORATION_ID && indexerService) {
      const corporation = await indexerService.getCorporation(VERANA_CORPORATION_ID).catch(() => undefined)
      corporationAddress = corporation?.policy_address ?? undefined
      if (!corporationAddress) {
        serverLogger.warn(
          `Corporation ${VERANA_CORPORATION_ID} not resolvable on the indexer yet; on-chain transactions will sign without a corporation`,
        )
      }
    }
    veranaChain = new VeranaChainService({
      rpcUrl: VERANA_RPC_ENDPOINT_URL,
      chainId: VERANA_CHAIN_ID,
      mnemonic: VERANA_ACCOUNT_MNEMONIC,
      corporationAddress,
      logger: serverLogger,
      autoTriggerResolver: VERANA_AUTO_TRIGGER_RESOLVER,
    })
    await veranaChain.start()

    authorizationService = new AuthorizationService({
      chain: veranaChain,
      logger: serverLogger,
      corporationId: VERANA_CORPORATION_ID ? Number(VERANA_CORPORATION_ID) : undefined,
    })
    const seedAuthorizationCache = async (): Promise<boolean> =>
      authorizationService!
        .refreshForOperator()
        .then(() => true)
        .catch(error => {
          serverLogger.error(
            `[Authorization] failed to seed the authorization cache: ${(error as Error).message}`,
          )
          return false
        })
    if (!(await seedAuthorizationCache())) {
      const retry = setInterval(async () => {
        if (await seedAuthorizationCache()) clearInterval(retry)
      }, AUTHORIZATION_SEED_RETRY_MS)
      retry.unref()
    }

    try {
      const balance = await veranaChain.getBalance()
      if (
        authorizationService.listVsOperatorAuthorizationRecords().length === 0 &&
        Number(balance.amount) === 0
      ) {
        serverLogger.warn(
          `[VeranaChain] Operator account ${veranaChain.address} has no VSOperatorAuthorization and zero ${balance.denom} balance; on-chain operations will fail until it is granted authorization or funded.`,
        )
      }
    } catch (error) {
      serverLogger.warn(
        `[VeranaChain] Could not check operator authorization/balance: ${(error as Error).message}`,
      )
    }
  } else {
    serverLogger.warn(
      'VERANA_RPC_ENDPOINT_URL or VERANA_ACCOUNT_MNEMONIC not set. Verana blockchain features will be disabled. Set these environment variables to enable on-chain capabilities.',
    )
  }

  const discoveryOptions = (() => {
    try {
      return JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'discovery.json'), 'utf-8'))
    } catch (error) {
      serverLogger.warn('Error reading discovery.json file:', error.message)
      return undefined
    }
  })()

  const { agent, indexer, verifyPeer } = await setupAgent({
    endpoints,
    discoveryOptions,
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
    veranaChain,
    authorizationService,
    adminApiServiceEndpoint,
  })

  const conf: ServerConfig = {
    port: ADMIN_PORT,
    cors: USE_CORS,
    logger: serverLogger,
    publicApiBaseUrl,
    endpoints,
    nestPlugins,
  }
  const { httpServer, webSocketServer } = await startServers(agent, conf)

  // Initialize Self-Trust Registry
  if (agent.did)
    await setupSelfTr({
      agent,
      publicApiBaseUrl,
      defaults: {
        agentLabel: AGENT_LABEL,
        agentInvitationImageUrl: AGENT_INVITATION_IMAGE_URL,
        fallbackBase64: FALLBACK_BASE64,
        serviceType: SELF_ISSUED_VTC_SERVICE_TYPE,
        serviceDescription: SELF_ISSUED_VTC_SERVICE_DESCRIPTION,
        serviceMinimumAgeRequired: SELF_ISSUED_VTC_SERVICE_MINIMUMAGEREQUIRED,
        serviceTermsAndConditions: SELF_ISSUED_VTC_SERVICE_TERMSANDCONDITIONS,
        servicePrivacyPolicy: SELF_ISSUED_VTC_SERVICE_PRIVACYPOLICY,
        orgRegistryId: SELF_ISSUED_VTC_ORG_REGISTRYID,
        orgRegistryUrl: SELF_ISSUED_VTC_ORG_REGISTRYURL,
        orgAddress: SELF_ISSUED_VTC_ORG_ADDRESS,
        orgType: SELF_ISSUED_VTC_ORG_TYPE,
        orgCountryCode: SELF_ISSUED_VTC_ORG_COUNTRYCODE,
      },
    })

  // Deliver domain events emitted on the agent bus to the configured webhook endpoint
  webhookEvent(agent, EVENTS_BASE_URL, serverLogger)

  // Register plugin events after agent is initialized
  for (const plugin of nestPlugins) {
    plugin.registerEvents?.(agent, conf.logger)
  }

  // Connect to Verana indexer for on-chain notifications
  // TODO: Once all Verana V4 features are implemented, this must be MANDATORY.
  if (VERANA_INDEXER_BASE_URL) {
    const handlerRegistry = buildDefaultIndexerHandlerRegistry()
    if (VERANA_INDEXER_DEFAULT_HANDLERS_OVERRIDE.includes('*')) {
      handlerRegistry.clear()
    } else {
      for (const msg of VERANA_INDEXER_DEFAULT_HANDLERS_OVERRIDE) handlerRegistry.unregister(msg)
    }
    if (VERANA_INDEXER_DEFAULT_HANDLERS_OVERRIDE.length) {
      serverLogger.info(
        `[IndexerWS] Default handlers disabled: ${VERANA_INDEXER_DEFAULT_HANDLERS_OVERRIDE.join(', ')}`,
      )
    }
    if (authorizationService) registerAuthorizationHandlers(handlerRegistry, authorizationService)

    const indexerCorporationId =
      VERANA_INDEXER_SUBSCRIPTION_SCOPE === 'corporation' && VERANA_CORPORATION_ID
        ? Number(VERANA_CORPORATION_ID)
        : undefined
    if (agent.did || indexerCorporationId) {
      const indexerWs = new IndexerWebSocketService({
        indexerUrl: VERANA_INDEXER_BASE_URL,
        agent,
        handlerRegistry,
        corporationId: indexerCorporationId,
      })
      await indexerWs.start()
    } else {
      serverLogger.warn(
        '[IndexerWS] subscription skipped: agent has no public DID and no VERANA_CORPORATION_ID scope',
      )
    }

    if (indexerService && VERANA_CORPORATION_ID) {
      void reconcileVtjscPublications(agent, indexerService, Number(VERANA_CORPORATION_ID)).catch(
        (error: Error) => serverLogger.error(`[VTJSC] reconciliation failed: ${error.message}`),
      )
    }
  }

  const ecsBootstrap = new EcsBootstrapService(
    agent,
    indexer,
    {
      mode: AGENT_MODE as 'standalone' | 'delegated',
      trustedEcosystemDids: TRUSTED_ECS_ECOSYSTEM_DIDS.length ? TRUSTED_ECS_ECOSYSTEM_DIDS : undefined,
      delegatedParentVsDid: AGENT_DELEGATED_PARENT_VS_DID,
      verifyPeer,
    },
    serverLogger,
  )
  void ecsBootstrap.run().catch((error: Error) => {
    serverLogger.error(`[EcsBootstrap] ${error.message}`)
    if (AGENT_MODE === 'delegated') process.exit(1)
  })

  // Accept incoming DIDComm only after the catch-up, so the agent does not act on stale chain state.
  if (webSocketServer) {
    httpServer?.on('upgrade', (request: IncomingMessage, socket: Socket, head: Buffer) => {
      webSocketServer.handleUpgrade(request, socket, head, client => {
        webSocketServer.emit('connection', client, request, utils.uuid())
      })
    })
  }

  // TODO: Once all Verana V4 features are implemented, this must be MANDATORY.
  if (!VERANA_INDEXER_BASE_URL || !VERANA_CHAIN_ID) {
    serverLogger.warn(
      'VERANA_INDEXER_BASE_URL or VERANA_CHAIN_ID not set. The VS-CONN-VS trust gate is disabled and every peer will be accepted. Set these environment variables to enforce trust resolution.',
    )
  }

  agent.config.logger.info(
    `VS Agent v${packageJson['version']} running in port ${AGENT_PORT}. Admin interface at port ${conf.port}`,
  )
}

run()
