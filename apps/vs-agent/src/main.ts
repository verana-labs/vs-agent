import 'reflect-metadata'

import { parseDid, utils } from '@credo-ts/core'
import { NestFactory } from '@nestjs/core'
import { KdfMethod } from '@openwallet-foundation/askar-nodejs'
import { configureChainIndexers } from '@verana-labs/vs-agent-model'
import {
  AuthorizationService,
  HttpInboundTransport,
  migrateVtjscServiceIds,
  VsAgent,
  VsAgentWsInboundTransport,
  type VsAgentNestPlugin,
  VeranaChainService,
  VeranaIndexerService,
  IndexerWebSocketService,
  buildDefaultIndexerHandlerRegistry,
  registerAuthorizationHandlers,
  registerSelfIssuanceAnchorHandlers,
  EcsBootstrapService,
  ECS_CLAIMS_VARIABLES,
  readEcsClaimsFromEnv,
  reconcileVtjscPublications,
} from '@verana-labs/vs-agent-sdk'
import * as express from 'express'
import * as fs from 'fs'
import { IncomingMessage, Server } from 'http'
import { Socket } from 'net'
import * as path from 'path'

import packageJson from '../package.json'

import { VsAgentModule } from './admin.module'
import { BootstrapState } from './common'
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
  AGENT_PUBLIC_DID_METHOD,
  AGENT_WALLET_ID,
  AGENT_WALLET_KEY,
  AGENT_WALLET_KEY_DERIVATION_METHOD,
  askarPostgresConfig,
  keyDerivationMethodMap,
  ADMIN_API_AUTH_MODE,
  ADMIN_API_CORPORATION_ALLOWED_ACCOUNTS,
  ADMIN_API_PUBLIC_URL,
  ADMIN_API_TRUSTED_NETWORKS,
  validateAdminApiConfig,
  ENABLED_PLUGINS,
  EVENTS_WEBHOOK_API_KEY,
  EVENTS_WEBHOOK_URL,
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
  VERANA_GAS_ADJUSTMENT,
  AGENT_MODE,
  AGENT_DELEGATED_PARENT_VS_DID,
  TRUSTED_ECS_ECOSYSTEM_DIDS,
} from './config'
import { MessagingPlugin, VtFlowNestPlugin } from './plugins'
import { PublicModule } from './public.module'
import { parseTrustedNetworks, restrictDocsToTrustedPeers } from './security'
import {
  commonAppConfig,
  derivePublicDidLocation,
  type PublicDidLocation,
  runWithRetries,
  type ServerConfig,
  setupAgent,
  toNestLogLevels,
  TsLogger,
  webhookEvent,
} from './utils'

export const startServers = async (agent: VsAgent, serverConfig: ServerConfig) => {
  const { port, cors, publicApiBaseUrl, nestPlugins = [], bootstrapState } = serverConfig

  // Nest's global level governs the plain @nestjs/common loggers (the credo agent uses AGENT_LOG_LEVEL).
  const nestLogLevels = toNestLogLevels(ADMIN_LOG_LEVEL)

  const trustedNetworks = parseTrustedNetworks(ADMIN_API_TRUSTED_NETWORKS)
  const adminApp = await NestFactory.create(
    VsAgentModule.register(agent, publicApiBaseUrl, nestPlugins, {
      authMode: ADMIN_API_AUTH_MODE,
      allowedAccounts: ADMIN_API_CORPORATION_ALLOWED_ACCOUNTS,
      trustedNetworks,
      bootstrapState,
    }),
    { logger: nestLogLevels },
  )
  adminApp.use(restrictDocsToTrustedPeers(trustedNetworks))
  commonAppConfig(adminApp, cors)
  await adminApp.listen(port)

  // PublicModule-specific config
  const publicApp = await NestFactory.create(PublicModule.register(agent, publicApiBaseUrl), {
    logger: nestLogLevels,
  })
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

  const webSocketServer = agent.didcomm.inboundTransports
    .find(x => x instanceof VsAgentWsInboundTransport)
    ?.getServer()
  const httpInboundTransport = agent.didcomm.inboundTransports.find(x => x instanceof HttpInboundTransport)

  // When HTTP inbound DIDComm is enabled, the transport listens with the public app itself,
  // so the DID document routes are servable before (never after) inbound DIDComm starts
  let publicAppServer: Server | undefined
  if (httpInboundTransport) {
    await publicApp.init()
    httpInboundTransport.setApp(publicApp.getHttpAdapter().getInstance())
  } else {
    publicAppServer = await publicApp.listen(AGENT_PORT)
  }

  for (const transport of agent.didcomm.inboundTransports) {
    await transport.start(agent.context)
  }

  const httpServer = httpInboundTransport ? httpInboundTransport.server : publicAppServer

  return { httpServer, webSocketServer }
}

const AUTHORIZATION_SEED_RETRY_MS = 30_000
const VTJSC_MIGRATION_RETRY_MS = 30_000
const VTJSC_MIGRATION_MAX_ATTEMPTS = 5

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

  const configErrors: string[] = []
  let didLocation: PublicDidLocation | undefined
  if (!PUBLIC_API_BASE_URL) {
    configErrors.push('PUBLIC_API_BASE_URL is required')
  } else {
    try {
      didLocation = derivePublicDidLocation(PUBLIC_API_BASE_URL)
    } catch (error) {
      configErrors.push((error as Error).message)
    }
  }
  if (!['webvh', 'web'].includes(AGENT_PUBLIC_DID_METHOD)) {
    configErrors.push(`AGENT_PUBLIC_DID_METHOD must be 'webvh' or 'web' (got '${AGENT_PUBLIC_DID_METHOD}')`)
  }
  if (!VERANA_CORPORATION_ID) {
    configErrors.push('VERANA_CORPORATION_ID is required')
  } else if (!/^\d+$/.test(VERANA_CORPORATION_ID)) {
    configErrors.push('VERANA_CORPORATION_ID must be a non-negative integer')
  }
  if (!VERANA_RPC_ENDPOINT_URL) {
    configErrors.push('VERANA_RPC_ENDPOINT_URL is required')
  }
  if (!VERANA_INDEXER_BASE_URL) {
    configErrors.push('VERANA_INDEXER_BASE_URL is required')
  }
  if (!VERANA_ACCOUNT_MNEMONIC) {
    configErrors.push('VERANA_ACCOUNT_MNEMONIC is required')
  }
  if (
    VERANA_GAS_ADJUSTMENT !== undefined &&
    (!Number.isFinite(VERANA_GAS_ADJUSTMENT) || VERANA_GAS_ADJUSTMENT <= 0)
  ) {
    configErrors.push('VERANA_GAS_ADJUSTMENT must be a positive number')
  }
  if (!['standalone', 'delegated'].includes(AGENT_MODE)) {
    configErrors.push(`AGENT_MODE must be 'standalone' or 'delegated' (got '${AGENT_MODE}')`)
  }
  if (AGENT_MODE === 'delegated' && !AGENT_DELEGATED_PARENT_VS_DID) {
    configErrors.push('AGENT_DELEGATED_PARENT_VS_DID is required when AGENT_MODE=delegated')
  }
  if (AGENT_MODE === 'standalone' && TRUSTED_ECS_ECOSYSTEM_DIDS.length === 0) {
    configErrors.push('TRUSTED_ECS_ECOSYSTEM_DIDS is required when AGENT_MODE=standalone')
  }
  if (TRUSTED_ECS_ECOSYSTEM_DIDS.some(did => !did.startsWith('did:'))) {
    configErrors.push('TRUSTED_ECS_ECOSYSTEM_DIDS must be a comma-separated list of DIDs')
  }
  // [VSA-VTI-CFG-ENV-ECS]: the agent issues its own Service credential in standalone mode, so no
  // validator can supply a claim it is missing
  const serviceClaims = readEcsClaimsFromEnv().service
  if (AGENT_MODE === 'standalone') {
    const requiredServiceClaims = [
      'name',
      'type',
      'description',
      'logoUri',
      'minimumAgeRequired',
      'termsAndConditionsUri',
      'privacyPolicyUri',
    ] as const
    for (const claim of requiredServiceClaims) {
      if (!serviceClaims[claim]) {
        configErrors.push(`${ECS_CLAIMS_VARIABLES.service[claim]} is required when AGENT_MODE=standalone`)
      }
    }
  }
  if (serviceClaims.minimumAgeRequired && !Number.isInteger(Number(serviceClaims.minimumAgeRequired))) {
    configErrors.push(`${ECS_CLAIMS_VARIABLES.service.minimumAgeRequired} must be an integer`)
  }
  if (configErrors.length > 0 || !didLocation) {
    serverLogger.error(`Invalid configuration:\n- ${configErrors.join('\n- ')}`)
    process.exit(1)
  }

  const parsedDid = parseDid(`did:${AGENT_PUBLIC_DID_METHOD}:${didLocation.location}`)

  let endpoints = AGENT_ENDPOINTS
  if (!endpoints) {
    const port = didLocation.port ? `:${didLocation.port}` : ''
    const path = didLocation.path ? `/${didLocation.path}` : ''
    endpoints = [`wss://${didLocation.host}${port}${path}`]
  }

  const publicApiBaseUrl = didLocation.normalizedBaseUrl

  serverLogger.info(`endpoints: ${endpoints} publicApiBaseUrl ${publicApiBaseUrl}`)

  const adminApiConfigErrors = validateAdminApiConfig({
    authMode: ADMIN_API_AUTH_MODE,
    publicUrl: ADMIN_API_PUBLIC_URL,
    allowedAccounts: ADMIN_API_CORPORATION_ALLOWED_ACCOUNTS,
    trustedNetworks: ADMIN_API_TRUSTED_NETWORKS,
  })
  if (adminApiConfigErrors.length > 0) {
    serverLogger.error(`Invalid configuration:\n- ${adminApiConfigErrors.join('\n- ')}`)
    process.exit(1)
  }
  const adminApiServiceEndpoint = ADMIN_API_AUTH_MODE === 'corporation' ? ADMIN_API_PUBLIC_URL : undefined

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

  const indexerService = new VeranaIndexerService({
    baseUrl: VERANA_INDEXER_BASE_URL,
    logger: serverLogger,
  })

  // Connect to Verana blockchain for on-chain transactions
  let veranaChain: VeranaChainService | undefined
  let authorizationService: AuthorizationService | undefined
  if (VERANA_RPC_ENDPOINT_URL && VERANA_ACCOUNT_MNEMONIC) {
    let corporationAddress: string | undefined
    if (VERANA_CORPORATION_ID) {
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
      gasAdjustment: VERANA_GAS_ADJUSTMENT,
    })
    await veranaChain.start()
    configureChainIndexers({ [veranaChain.getChainId]: VERANA_INDEXER_BASE_URL })

    authorizationService = new AuthorizationService({
      chain: veranaChain,
      logger: serverLogger,
      corporationId: VERANA_CORPORATION_ID ? Number(VERANA_CORPORATION_ID) : undefined,
    })
    await runWithRetries({
      run: () => authorizationService!.refreshForOperator(),
      intervalMs: AUTHORIZATION_SEED_RETRY_MS,
      onError: error =>
        serverLogger.error(`[Authorization] failed to seed the authorization cache: ${error.message}`),
    })

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
  }

  const discoveryOptions = (() => {
    try {
      return JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'discovery.json'), 'utf-8'))
    } catch (error) {
      serverLogger.warn('Error reading discovery.json file:', error.message)
      return undefined
    }
  })()

  const { agent, verifyPeer } = await setupAgent({
    indexer: indexerService,
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
    parsedDid,
    logLevel: AGENT_LOG_LEVEL,
    publicApiBaseUrl,
    autoDiscloseUserProfile: USER_PROFILE_AUTODISCLOSE,
    masterListCscaLocation: MASTER_LIST_CSCA_LOCATION,
    autoUpdateStorageOnStartup: AGENT_AUTO_UPDATE_STORAGE_ON_STARTUP,
    veranaChain,
    authorizationService,
    adminApiServiceEndpoint,
  })

  const bootstrapState = new BootstrapState()
  if (agent.did) {
    bootstrapState.require('vtjsc-service-id-migration')
  }
  bootstrapState.require('indexer-subscription')

  const conf: ServerConfig = {
    port: ADMIN_PORT,
    cors: USE_CORS,
    logger: serverLogger,
    publicApiBaseUrl,
    endpoints,
    nestPlugins,
    bootstrapState,
  }
  const { httpServer, webSocketServer } = await startServers(agent, conf)

  if (agent.did) {
    await runWithRetries({
      run: () => migrateVtjscServiceIds(agent),
      intervalMs: VTJSC_MIGRATION_RETRY_MS,
      maxAttempts: VTJSC_MIGRATION_MAX_ATTEMPTS,
      onSuccess: () => bootstrapState.complete('vtjsc-service-id-migration'),
      onError: (error, attempt) =>
        serverLogger.error(
          `[VTJSC] service id migration failed (attempt ${attempt}/${VTJSC_MIGRATION_MAX_ATTEMPTS}): ${error.message}`,
        ),
      onExhausted: error => bootstrapState.fail('vtjsc-service-id-migration', error.message),
    })
  }

  const ecsClaims = agent.ecsClaims ?? {}

  if (EVENTS_WEBHOOK_URL) {
    webhookEvent(agent, { url: EVENTS_WEBHOOK_URL, apiKey: EVENTS_WEBHOOK_API_KEY }, serverLogger)
  }

  // Register plugin events after agent is initialized
  for (const plugin of nestPlugins) {
    plugin.registerEvents?.(agent, conf.logger)
  }

  // Connect to Verana indexer for on-chain notifications
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
    if (VERANA_CORPORATION_ID) {
      registerSelfIssuanceAnchorHandlers(
        handlerRegistry,
        indexerService,
        Number(VERANA_CORPORATION_ID),
        ecsClaims,
      )
    }

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
        agentCorporationId: Number(VERANA_CORPORATION_ID),
      })
      bootstrapState.watchIndexer(() => indexerWs.syncStatus)
      bootstrapState.complete('indexer-subscription')
      await indexerWs.start()
    } else {
      bootstrapState.skip('indexer-subscription')
      serverLogger.warn(
        '[IndexerWS] subscription skipped: agent has no public DID and VERANA_INDEXER_SUBSCRIPTION_SCOPE is not corporation',
      )
    }

    if (VERANA_CORPORATION_ID) {
      void reconcileVtjscPublications(agent, indexerService, Number(VERANA_CORPORATION_ID), ecsClaims).catch(
        (error: Error) => serverLogger.error(`[VTJSC] reconciliation failed: ${error.message}`),
      )
    }
  }

  const ecsBootstrap = new EcsBootstrapService(
    agent,
    indexerService,
    {
      mode: AGENT_MODE as 'standalone' | 'delegated',
      trustedEcosystemDids: TRUSTED_ECS_ECOSYSTEM_DIDS.length ? TRUSTED_ECS_ECOSYSTEM_DIDS : undefined,
      delegatedParentVsDid: AGENT_DELEGATED_PARENT_VS_DID,
      verifyPeer,
    },
    serverLogger,
  )
  bootstrapState.recordEcsBootstrap(AGENT_MODE, 'pending')
  void ecsBootstrap.run().then(
    () => bootstrapState.recordEcsBootstrap(AGENT_MODE, 'completed'),
    (error: Error) => {
      bootstrapState.recordEcsBootstrap(AGENT_MODE, 'failed', error.message)
      serverLogger.error(`[EcsBootstrap] ${error.message}`)
    },
  )

  // Accept incoming DIDComm only after the catch-up, so the agent does not act on stale chain state.
  if (webSocketServer) {
    httpServer?.on('upgrade', (request: IncomingMessage, socket: Socket, head: Buffer) => {
      webSocketServer.handleUpgrade(request, socket, head, client => {
        webSocketServer.emit('connection', client, request, utils.uuid())
      })
    })
  }

  if (!VERANA_CHAIN_ID) {
    serverLogger.warn(
      'VERANA_CHAIN_ID not set. The VS-CONN-VS trust gate is disabled and every peer will be accepted. Set this environment variable to enforce trust resolution.',
    )
  }

  agent.config.logger.info(
    `VS Agent v${packageJson['version']} running in port ${AGENT_PORT}. Admin interface at port ${conf.port}`,
  )
}

run().catch((error: Error) => {
  new TsLogger(ADMIN_LOG_LEVEL, 'Server').error(`Failed to start VS Agent: ${error.message}`)
  process.exit(1)
})
