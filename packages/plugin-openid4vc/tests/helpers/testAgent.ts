import type { OpenId4VcCredentialConfiguration, OpenId4VcPluginOptions } from '../../src/types'
import type { AskarModuleConfigStoreOptions, AskarSqliteStorageConfig } from '@credo-ts/askar'
import type { DidResolver, Kms, SdJwtVc, X509Certificate } from '@credo-ts/core'
import type { OpenId4VcHolderApi } from '@credo-ts/openid4vc'
import type { Server } from 'node:http'

import { AskarModule } from '@credo-ts/askar'
import {
  Agent,
  ConsoleLogger,
  DidsModule,
  Kms as KmsApi,
  LogLevel,
  SdJwtVcRecord,
  utils,
  X509Certificate as CredoX509Certificate,
  X509Module,
} from '@credo-ts/core'
import { agentDependencies } from '@credo-ts/node'
import { OpenId4VcModule } from '@credo-ts/openid4vc'
import { askar } from '@openwallet-foundation/askar-nodejs'
import {
  BasicConstraintsExtension,
  KeyUsageFlags,
  KeyUsagesExtension,
  SubjectAlternativeNameExtension,
  X509CertificateGenerator,
} from '@peculiar/x509'
import express from 'express'
import { webcrypto } from 'node:crypto'

import { OpenId4VcPlugin } from '../../src/nestjs/OpenId4VcPlugin'
import { IssuerService } from '../../src/services/IssuerService'
import { VerifierService } from '../../src/services/VerifierService'

import {
  INTERMEDIATE_PRIVATE_JWK,
  LEAF_PRIVATE_JWK,
  OTHER_PRIVATE_JWK,
  ROOT_PRIVATE_JWK,
  createCertificateFixtures,
} from './certificates'

type CertificateFixtures = Awaited<ReturnType<typeof createCertificateFixtures>>
type AgentRole = 'issuer' | 'holder' | 'verifier'
type PluginAgentRole = Exclude<AgentRole, 'holder'>

const ASKAR_STORE_KEY = 'DZ9hPqFWTPxemcGea72C1X1nusqk5wFNLq6QPjwXGqAa'
const LOG_LEVEL = process.env.OID4VC_TEST_LOG ? LogLevel.Debug : LogLevel.Off

interface TestAgentWithOpenId4Vc extends Agent {
  did?: string
  modules: Agent['modules'] & {
    openId4Vc: {
      holder: OpenId4VcHolderApi
    }
  }
}

export interface TestHolderCredential {
  claimFormat: string
  prettyClaims: Record<string, unknown>
}

export interface TestHolderPresentation {
  authorizationResponse: { response: string } | Record<string, unknown>
  authorizationResponsePayload: Record<string, unknown>
  serverResponse?: { status: number; body: unknown }
  ok: boolean
}

export interface TestAgentFailureHooks {
  beforeOptions?: (role: PluginAgentRole) => void | Promise<void>
  afterInitialize?: (role: AgentRole) => void | Promise<void>
  afterCleanup?: (role: AgentRole) => void | Promise<void>
}

export class OpenId4VcTestStartupError extends Error {
  public constructor(
    public readonly cause: unknown,
    public readonly cleanupErrors: unknown[],
  ) {
    super(errorMessage(cause))
    this.name = 'OpenId4VcTestStartupError'
  }
}

export interface OpenId4VcTestAgents {
  issuer: {
    agent: TestAgentWithOpenId4Vc
    service: IssuerService
    publicApiBaseUrl: string
  }
  holder: {
    agent: TestAgentWithOpenId4Vc
    acceptCredentialOffer: (credentialOffer: string) => Promise<TestHolderCredential>
    resolvePresentationRequest: (
      authorizationRequest: string,
      trustedCertificates: string[],
    ) => ReturnType<OpenId4VcHolderApi['resolveOpenId4VpAuthorizationRequest']>
    submitPresentation: (
      resolved: Awaited<ReturnType<OpenId4VcHolderApi['resolveOpenId4VpAuthorizationRequest']>>,
    ) => Promise<TestHolderPresentation>
  }
  verifier: {
    agent: TestAgentWithOpenId4Vc
    service: VerifierService
    publicApiBaseUrl: string
  }
  rootCertificate: string
  stop: () => Promise<void>
}

export async function createVerifierCertificate(
  root: X509Certificate,
  did: string,
): Promise<X509Certificate> {
  const [rootKeys, verifierKeys] = await Promise.all([
    importKeyPair(ROOT_PRIVATE_JWK),
    importKeyPair(OTHER_PRIVATE_JWK),
  ])
  const certificate = await X509CertificateGenerator.create(
    {
      serialNumber: '20',
      issuer: root.subject,
      subject: 'CN=Fixture Verifier',
      publicKey: verifierKeys.publicKey,
      signingKey: rootKeys.privateKey,
      notBefore: new Date('2025-01-01T00:00:00.000Z'),
      notAfter: new Date('2035-01-01T00:00:00.000Z'),
      extensions: [
        new BasicConstraintsExtension(false, undefined, true),
        new KeyUsagesExtension(KeyUsageFlags.digitalSignature, true),
        new SubjectAlternativeNameExtension([
          { type: 'url', value: did },
          { type: 'dns', value: 'verifier.example' },
        ]),
      ],
    },
    webcrypto,
  )

  return CredoX509Certificate.fromRawCertificate(new Uint8Array(certificate.rawData))
}

async function createIssuerCertificate(intermediate: X509Certificate, did: string): Promise<X509Certificate> {
  const [intermediateKeys, issuerKeys] = await Promise.all([
    importKeyPair(INTERMEDIATE_PRIVATE_JWK),
    importKeyPair(LEAF_PRIVATE_JWK),
  ])
  const certificate = await X509CertificateGenerator.create(
    {
      serialNumber: '21',
      issuer: intermediate.subject,
      subject: 'CN=Fixture Issuer',
      publicKey: issuerKeys.publicKey,
      signingKey: intermediateKeys.privateKey,
      notBefore: new Date('2025-01-01T00:00:00.000Z'),
      notAfter: new Date('2035-01-01T00:00:00.000Z'),
      extensions: [
        new BasicConstraintsExtension(false, undefined, true),
        new KeyUsagesExtension(KeyUsageFlags.digitalSignature, true),
        new SubjectAlternativeNameExtension([
          { type: 'url', value: did },
          { type: 'dns', value: '127.0.0.1' },
        ]),
      ],
    },
    webcrypto,
  )

  return CredoX509Certificate.fromRawCertificate(new Uint8Array(certificate.rawData))
}

export async function startOpenId4VcTestAgents(input: {
  certificates: CertificateFixtures
  verifierCertificate: X509Certificate
  didResolver: DidResolver
  resolverUrl: string
  issuerDid: string
  verifierDid: string
  credentialConfiguration: OpenId4VcCredentialConfiguration
  failureHooks?: TestAgentFailureHooks
}): Promise<OpenId4VcTestAgents> {
  const rootCertificate = input.certificates.root.toString('base64')
  const issuerCertificate = await createIssuerCertificate(input.certificates.intermediate, input.issuerDid)
  const issuer = await startPluginAgent({
    role: 'issuer',
    did: input.issuerDid,
    didResolver: input.didResolver,
    options: publicApiBaseUrl => ({
      publicApiBaseUrl,
      issuer: {
        id: 'issuer',
        displayName: 'Fixture Issuer',
        signing: {
          configured: {
            certificateChain: [
              issuerCertificate.toString('base64'),
              input.certificates.intermediate.toString('base64'),
            ],
            privateJwk: LEAF_PRIVATE_JWK,
          },
        },
      },
      trust: {
        resolverUrl: input.resolverUrl,
        timeoutMs: 500,
        credentialIssuerCertificates: [rootCertificate],
      },
      credentialConfigurations: [input.credentialConfiguration],
      verifierPolicies: [],
    }),
    serviceToken: IssuerService,
    failureHooks: input.failureHooks,
  })

  let holder: Awaited<ReturnType<typeof startHolderAgent>> | undefined
  let verifier: Awaited<ReturnType<typeof startPluginAgent<VerifierService>>> | undefined
  try {
    holder = await startHolderAgent(input.didResolver, rootCertificate, input.failureHooks)
    verifier = await startPluginAgent({
      role: 'verifier',
      did: input.verifierDid,
      didResolver: input.didResolver,
      options: publicApiBaseUrl => ({
        publicApiBaseUrl,
        verifier: {
          id: 'verifier',
          displayName: 'Fixture Verifier',
          signing: {
            configured: {
              certificateChain: [
                input.verifierCertificate.toString('base64'),
                input.certificates.root.toString('base64'),
              ],
              privateJwk: OTHER_PRIVATE_JWK,
            },
          },
        },
        trust: {
          resolverUrl: input.resolverUrl,
          timeoutMs: 500,
          credentialIssuerCertificates: [rootCertificate],
        },
        credentialConfigurations: [input.credentialConfiguration],
        verifierPolicies: [
          {
            id: 'employee-check',
            credentialConfigurationId: input.credentialConfiguration.id,
            requestedClaims: ['name', 'role'],
          },
        ],
      }),
      serviceToken: VerifierService,
      failureHooks: input.failureHooks,
    })

    return {
      issuer,
      holder,
      verifier,
      rootCertificate,
      stop: async () => {
        await settleCleanup([verifier?.stop(), holder?.stop(), issuer.stop()])
      },
    }
  } catch (error) {
    await rethrowAfterCleanup(error, [verifier?.stop(), holder?.stop(), issuer.stop()])
  }
}

async function startPluginAgent<Service>(input: {
  role: PluginAgentRole
  did: string
  didResolver: DidResolver
  options: (publicApiBaseUrl: string) => OpenId4VcPluginOptions
  serviceToken: abstract new (...args: never[]) => Service
  failureHooks?: TestAgentFailureHooks
}): Promise<{
  agent: TestAgentWithOpenId4Vc
  service: Service
  publicApiBaseUrl: string
  stop: () => Promise<void>
}> {
  const app = express()
  let server: Server | undefined
  let agent: TestAgentWithOpenId4Vc | undefined

  try {
    server = await listen(app)
    const publicApiBaseUrl = serverUrl(server)
    await input.failureHooks?.beforeOptions?.(input.role)
    const options = input.options(publicApiBaseUrl)
    const plugin = OpenId4VcPlugin(options)
    if (!plugin.credoPlugin) throw new Error('OpenID4VC plugin did not expose Credo modules')
    if (!plugin.publicMiddleware) throw new Error('OpenID4VC plugin did not expose public middleware')
    app.use(plugin.publicMiddleware)

    const logger = new ConsoleLogger(LOG_LEVEL)
    agent = new Agent({
      config: { logger, allowInsecureHttpUrls: true },
      dependencies: agentDependencies,
      modules: {
        askar: new AskarModule({ askar, store: askarStore(input.role) }),
        dids: new DidsModule({ resolvers: [input.didResolver] }),
        ...plugin.credoPlugin.modules,
      },
    }) as unknown as TestAgentWithOpenId4Vc
    agent.did = input.did
    await agent.initialize()
    await input.failureHooks?.afterInitialize?.(input.role)
    await plugin.initialize?.(agent as never, logger)
    const service = pluginService(plugin.providers, input.serviceToken, agent)
    return {
      agent,
      service,
      publicApiBaseUrl,
      stop: createStop(agent, server),
    }
  } catch (error) {
    await rethrowAfterCleanup(
      error,
      [agent?.shutdown(), server ? closeServer(server) : undefined],
      input.failureHooks?.afterCleanup ? () => input.failureHooks?.afterCleanup?.(input.role) : undefined,
    )
  }
}

async function startHolderAgent(
  didResolver: DidResolver,
  rootCertificate: string,
  failureHooks?: TestAgentFailureHooks,
): Promise<OpenId4VcTestAgents['holder'] & { stop: () => Promise<void> }> {
  let agent: TestAgentWithOpenId4Vc | undefined
  try {
    agent = new Agent({
      config: { logger: new ConsoleLogger(LOG_LEVEL), allowInsecureHttpUrls: true },
      dependencies: agentDependencies,
      modules: {
        askar: new AskarModule({ askar, store: askarStore('holder') }),
        dids: new DidsModule({ resolvers: [didResolver] }),
        openId4Vc: new OpenId4VcModule(),
        x509: new X509Module({ trustedCertificates: [rootCertificate] }),
      },
    }) as unknown as TestAgentWithOpenId4Vc
    await agent.initialize()
    await failureHooks?.afterInitialize?.('holder')
  } catch (error) {
    await rethrowAfterCleanup(
      error,
      [agent?.shutdown()],
      failureHooks?.afterCleanup ? () => failureHooks.afterCleanup?.('holder') : undefined,
    )
  }

  const holder = agent.modules.openId4Vc.holder
  return {
    agent,
    acceptCredentialOffer: async credentialOffer => {
      const resolvedCredentialOffer = await holder.resolveCredentialOffer(credentialOffer)
      const token = await holder.requestToken({ resolvedCredentialOffer })
      const response = await holder.requestCredentials({
        resolvedCredentialOffer,
        accessToken: token.accessToken,
        cNonce: token.cNonce,
        dpop: token.dpop,
        credentialBindingResolver: async () => {
          const created = await agent.kms.createKey({ type: { kty: 'EC', crv: 'P-256' } })
          const publicJwk = KmsApi.PublicJwk.fromPublicJwk(created.publicJwk)
          publicJwk.keyId = created.keyId
          return { method: 'jwk' as const, keys: [publicJwk] }
        },
      })
      const credential = response.credentials[0]
      if (!credential || !(credential.record instanceof SdJwtVcRecord)) {
        throw new Error('issuer did not return an SD-JWT VC record')
      }

      await agent.sdJwtVc.store({ record: credential.record })
      const firstCredential: SdJwtVc = credential.record.firstCredential
      return {
        claimFormat: firstCredential.claimFormat,
        prettyClaims: firstCredential.prettyClaims,
      }
    },
    resolvePresentationRequest: (authorizationRequest, trustedCertificates) =>
      holder.resolveOpenId4VpAuthorizationRequest(authorizationRequest, { trustedCertificates }),
    submitPresentation: async resolved => {
      if (!resolved.dcql) throw new Error('authorization request did not contain a DCQL query')
      const credentials = holder.selectCredentialsForDcqlRequest(resolved.dcql.queryResult)
      return (await holder.acceptOpenId4VpAuthorizationRequest({
        authorizationRequestPayload: resolved.authorizationRequestPayload,
        dcql: { credentials },
      })) as TestHolderPresentation
    },
    stop: createStop(agent),
  }
}

function pluginService<Service>(
  providers: unknown[] | undefined,
  token: abstract new (...args: never[]) => Service,
  agent: TestAgentWithOpenId4Vc,
): Service {
  const provider = providers?.find(candidate => isFactoryProvider(candidate) && candidate.provide === token)
  if (!provider || !isFactoryProvider(provider)) {
    throw new Error(`OpenID4VC plugin did not register ${token.name}`)
  }

  return provider.useFactory(agent) as Service
}

function isFactoryProvider(
  value: unknown,
): value is { provide: unknown; useFactory: (agent: TestAgentWithOpenId4Vc) => unknown } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'provide' in value &&
    'useFactory' in value &&
    typeof value.useFactory === 'function'
  )
}

function askarStore(role: AgentRole): AskarModuleConfigStoreOptions {
  return {
    id: `openid4vc-${role}-${utils.uuid()}`,
    key: ASKAR_STORE_KEY,
    keyDerivationMethod: 'raw',
    database: { type: 'sqlite', config: { inMemory: true } } as AskarSqliteStorageConfig,
  }
}

async function listen(app: express.Express): Promise<Server> {
  return await new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server))
    server.once('error', reject)
  })
}

function serverUrl(server: Server): string {
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('test server did not bind a TCP port')
  return `http://127.0.0.1:${address.port}`
}

function createStop(agent: Agent, server?: Server): () => Promise<void> {
  let stopped = false
  return async () => {
    if (stopped) return
    stopped = true
    await settleCleanup([agent.shutdown(), server ? closeServer(server) : undefined])
  }
}

async function settleCleanup(tasks: Array<Promise<unknown> | undefined>): Promise<void> {
  const errors = await cleanupErrors(tasks)
  if (errors.length > 0) throw new AggregateError(errors, 'OpenID4VC test cleanup failed')
}

async function rethrowAfterCleanup(
  primaryError: unknown,
  tasks: Array<Promise<unknown> | undefined>,
  afterCleanup?: () => void | Promise<void>,
): Promise<never> {
  const errors = await cleanupErrors(tasks)
  if (afterCleanup) {
    try {
      await afterCleanup()
    } catch (error) {
      errors.push(error)
    }
  }

  const primary = primaryError instanceof OpenId4VcTestStartupError ? primaryError.cause : primaryError
  const combinedErrors = [
    ...(primaryError instanceof OpenId4VcTestStartupError ? primaryError.cleanupErrors : []),
    ...errors,
  ]
  if (combinedErrors.length > 0) throw new OpenId4VcTestStartupError(primary, combinedErrors)
  throw primaryError
}

async function cleanupErrors(tasks: Array<Promise<unknown> | undefined>): Promise<unknown[]> {
  const results = await Promise.allSettled(tasks)
  return results.flatMap(result => (result.status === 'rejected' ? [result.reason] : []))
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'OpenID4VC test agent startup failed'
}

async function closeServer(server: Server): Promise<void> {
  server.closeAllConnections?.()
  await new Promise<void>((resolve, reject) => {
    server.close(error => {
      if (error) reject(error)
      else resolve()
    })
  })
}

async function importKeyPair(privateJwk: Kms.KmsJwkPrivateEc) {
  const algorithm = { name: 'ECDSA', namedCurve: 'P-256' }
  const privateKey = await webcrypto.subtle.importKey('jwk', privateJwk, algorithm, true, ['sign'])
  const publicKey = await webcrypto.subtle.importKey(
    'jwk',
    { kty: privateJwk.kty, crv: privateJwk.crv, x: privateJwk.x, y: privateJwk.y },
    algorithm,
    true,
    ['verify'],
  )
  return { privateKey, publicKey }
}
