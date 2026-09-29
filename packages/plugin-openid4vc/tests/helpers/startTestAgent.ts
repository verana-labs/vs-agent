import type { OpenId4VcAgent } from '../../src/types'
import type { OpenId4VcCredentialConfiguration, OpenId4VcPluginOptions } from '../../src/types'
import type { AskarModuleConfigStoreOptions, AskarSqliteStorageConfig } from '@credo-ts/askar'
import type { BaseLogger, DidResolver, Kms, SdJwtVc, X509Certificate } from '@credo-ts/core'
import type { OpenId4VcHolderApi } from '@credo-ts/openid4vc'
import type {
  AnonCredsTrustService,
  DidTrustResolver,
  Plugin,
  VeranaChainService,
} from '@verana-labs/vs-agent-sdk'
import type { Server } from 'node:http'

import {
  Agent,
  ConsoleLogger,
  DidDocument,
  Kms as KmsApi,
  LogLevel,
  SdJwtVcRecord,
  utils,
  X509Certificate as CredoX509Certificate,
  X509Module,
} from '@credo-ts/core'
import { agentDependencies } from '@credo-ts/node'
import { OpenId4VcModule } from '@credo-ts/openid4vc'
import {
  BasicConstraintsExtension,
  KeyUsageFlags,
  KeyUsagesExtension,
  SubjectAlternativeNameExtension,
  X509CertificateGenerator,
} from '@peculiar/x509'
import {
  composeTypeMetadata,
  createVsAgent,
  ParticipantRole,
  ParticipantState,
  setupBaseDidComm,
  TrustResolutionOutcome,
  typeMetadataUrl,
  VeranaIndexerService,
} from '@verana-labs/vs-agent-sdk'
import express from 'express'
import { webcrypto } from 'node:crypto'

import { setupOpenId4Vc } from '../../src/sdk/setupOpenId4Vc'
import { IssuerService } from '../../src/services/IssuerService'
import { VerifierService } from '../../src/services/VerifierService'

import {
  INTERMEDIATE_PRIVATE_JWK,
  LEAF_PRIVATE_JWK,
  OTHER_PRIVATE_JWK,
  ROOT_PRIVATE_JWK,
  createCertificateFixtures,
} from './certificates'
import { didDocumentWithKey, didDocumentWithService, FakeDidResolver } from './fakeDidResolver'

type CertificateFixtures = Awaited<ReturnType<typeof createCertificateFixtures>>
type PluginAgentRole = 'issuer' | 'verifier'

const ASKAR_STORE_KEY = 'DZ9hPqFWTPxemcGea72C1X1nusqk5wFNLq6QPjwXGqAa'
const HOLDER_PUBLIC_API_BASE_URL = 'https://holder.example'
const UNROUTABLE_INDEXER_BASE_URL = 'http://indexer.invalid'

export const TEST_ISSUER_DID = 'did:web:issuer.example'
export const TEST_VERIFIER_DID = 'did:web:verifier.example'

export const TEST_ECOSYSTEM_DID = 'did:web:credentials.example'
const TEST_ECOSYSTEM_BASE_URL = 'https://credentials.example'
const TEST_ECOSYSTEM_ID = 10
const TEST_CHAIN_ID = 'vpr-test-1'
const TEST_CREDENTIAL_SCHEMA_ID = 1
const TEST_CREDENTIAL_SCHEMA_REF = `vpr:verana:${TEST_CHAIN_ID}:cs:${TEST_CREDENTIAL_SCHEMA_ID}`
const TEST_VTJSC_ID = `${TEST_ECOSYSTEM_BASE_URL}/vt/employee.json`
// createJsc publishes the VTJSC presentation under this service id, and the resolver reads it there
const TEST_VTJSC_SERVICE_ID = `${TEST_ECOSYSTEM_DID}#vpr-schemas-${TEST_CREDENTIAL_SCHEMA_ID}-vtjsc-vp`
const TEST_VTJSC_PRESENTATION_URL = `${TEST_ECOSYSTEM_BASE_URL}/vt/schemas-1-vtjsc-vp.json`
const TEST_JSON_SCHEMA = JSON.stringify({
  title: 'Employee credential',
  type: 'object',
  properties: {
    credentialSubject: {
      type: 'object',
      properties: { name: { type: 'string' }, role: { type: 'string' } },
      required: ['name'],
    },
  },
})

export const testCredentialConfiguration: OpenId4VcCredentialConfiguration = {
  id: TEST_VTJSC_ID,
  format: 'dc+sd-jwt',
  vct: typeMetadataUrl(TEST_ECOSYSTEM_BASE_URL, TEST_CREDENTIAL_SCHEMA_ID),
  name: 'Employee credential',
  vtjscId: TEST_VTJSC_ID,
  credentialSchemaId: TEST_CREDENTIAL_SCHEMA_ID,
  jsonSchema: TEST_JSON_SCHEMA,
  claims: ['name', 'role'],
  disclosureFrame: ['name', 'role'],
}

export const TEST_TYPE_METADATA = composeTypeMetadata({
  vct: testCredentialConfiguration.vct,
  jsonSchema: TEST_JSON_SCHEMA,
  credentialSchemaRef: TEST_CREDENTIAL_SCHEMA_REF,
  jsonSchemaCredentialId: TEST_VTJSC_ID,
})

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

export interface OpenId4VcTestAgents {
  issuer: {
    agent: OpenId4VcAgent
    service: IssuerService
    publicApiBaseUrl: string
  }
  holder: {
    agent: OpenId4VcAgent
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
    agent: OpenId4VcAgent
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

export async function startTestAgents(input: {
  certificates: CertificateFixtures
  verifierCertificate: X509Certificate
  didResolver: DidResolver
  issuerDid: string
  verifierDid: string
  credentialConfiguration: OpenId4VcCredentialConfiguration
  issuerTrust?: Partial<NonNullable<OpenId4VcPluginOptions['issuer']>>
  /** Step 7 of the trust decision for the verifier; trusts every DID when absent. */
  resolveDidTrust?: DidTrustResolver
  logger?: BaseLogger
}): Promise<OpenId4VcTestAgents> {
  const logger = input.logger ?? new ConsoleLogger(LogLevel.Off)
  const rootCertificate = input.certificates.root.toString('base64')
  const issuerCertificate = await createIssuerCertificate(input.certificates.intermediate, input.issuerDid)
  const stops: Array<() => Promise<void>> = []
  stops.push(
    serveDocuments({
      [input.credentialConfiguration.vct]: TEST_TYPE_METADATA,
      [TEST_VTJSC_PRESENTATION_URL]: JSON.stringify({ verifiableCredential: [{ id: TEST_VTJSC_ID }] }),
    }),
  )

  try {
    const issuer = await startPluginAgent({
      role: 'issuer',
      did: input.issuerDid,
      didResolver: input.didResolver,
      options: publicApiBaseUrl => ({
        publicApiBaseUrl,
        issuer: {
          signing: {
            configured: {
              certificateChain: [
                issuerCertificate.toString('base64'),
                input.certificates.intermediate.toString('base64'),
              ],
              privateJwk: LEAF_PRIVATE_JWK,
            },
          },
          ...input.issuerTrust,
        },
        credentialConfigurations: [input.credentialConfiguration],
      }),
      createService: (agent, options) => new IssuerService(agent, options, () => {}),
      indexer: issuerIndexer(input.issuerDid, input.credentialConfiguration.credentialSchemaId),
      logger,
    })
    stops.push(issuer.stop)

    const holder = await startHolderAgent(input.didResolver, rootCertificate, logger)
    stops.push(holder.stop)

    const verifier = await startPluginAgent({
      role: 'verifier',
      did: input.verifierDid,
      didResolver: input.didResolver,
      options: publicApiBaseUrl => ({
        publicApiBaseUrl,
        verifier: {
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
        credentialConfigurations: [input.credentialConfiguration],
      }),
      createService: (agent, options) =>
        new VerifierService(agent, options, input.resolveDidTrust ?? trustEveryDid),
      indexer: verifierIndexer(input.credentialConfiguration),
      veranaChain: { getChainId: TEST_CHAIN_ID },
      anonCredsTrust: verifierTrust(input.credentialConfiguration.credentialSchemaId),
      logger,
    })
    stops.push(verifier.stop)

    return {
      issuer,
      holder,
      verifier,
      rootCertificate,
      stop: async () => {
        await Promise.all(stops.map(stop => stop()))
      },
    }
  } catch (error) {
    await Promise.allSettled(stops.map(stop => stop()))
    throw error
  }
}

function createTestVsAgent(input: {
  storeName: string
  publicApiBaseUrl: string
  plugin: Plugin
  didResolver: DidResolver
  logger: BaseLogger
  did?: string
  indexer?: unknown
  veranaChain?: unknown
  anonCredsTrust?: unknown
}): OpenId4VcAgent {
  const walletConfig = getAskarStoreConfig(input.storeName)
  const agent = createVsAgent({
    plugins: [
      setupBaseDidComm({
        walletConfig,
        publicApiBaseUrl: input.publicApiBaseUrl,
        endpoints: [input.publicApiBaseUrl],
      }),
      input.plugin,
    ],
    config: { logger: input.logger, allowInsecureHttpUrls: true },
    walletConfig,
    did: input.did,
    dependencies: agentDependencies,
    publicApiBaseUrl: input.publicApiBaseUrl,
    // Unroutable on purpose: a test that reaches the VPR fails loudly instead of talking to a real indexer.
    indexer: (input.indexer ??
      new VeranaIndexerService({
        baseUrl: UNROUTABLE_INDEXER_BASE_URL,
        logger: input.logger,
      })) as VeranaIndexerService,
    veranaChain: input.veranaChain as VeranaChainService | undefined,
    anonCredsTrust: input.anonCredsTrust as AnonCredsTrustService | undefined,
  }) as unknown as OpenId4VcAgent

  // Credo resolves with the first resolver claiming the method, so the fixture has to come first.
  agent.dids.config.resolvers.unshift(input.didResolver)
  return agent
}

async function startPluginAgent<Service extends IssuerService | VerifierService>(input: {
  role: PluginAgentRole
  did: string
  didResolver: DidResolver
  options: (publicApiBaseUrl: string) => OpenId4VcPluginOptions
  createService: (agent: OpenId4VcAgent, options: OpenId4VcPluginOptions) => Service
  indexer?: unknown
  veranaChain?: unknown
  anonCredsTrust?: unknown
  logger: BaseLogger
}): Promise<{
  agent: OpenId4VcAgent
  service: Service
  publicApiBaseUrl: string
  stop: () => Promise<void>
}> {
  const app = express()
  let server: Server | undefined
  let agent: OpenId4VcAgent | undefined
  let service: Service | undefined

  try {
    server = await listen(app)
    const publicApiBaseUrl = serverUrl(server)
    const options = input.options(publicApiBaseUrl)
    const sdkPlugin = setupOpenId4Vc(options, () => {
      if (!(service instanceof IssuerService)) throw new Error('OpenID4VC issuer service is not initialized')
      return service
    })
    app.use(sdkPlugin.publicMiddleware)

    agent = createTestVsAgent({
      storeName: `openid4vc-${input.role}`,
      publicApiBaseUrl,
      plugin: sdkPlugin,
      didResolver: input.didResolver,
      logger: input.logger,
      did: input.did,
      indexer: input.indexer,
      veranaChain: input.veranaChain,
      anonCredsTrust: input.anonCredsTrust,
    })
    await agent.initialize()
    service = input.createService(agent, options)
    await service.ensureInitialized()
    return {
      agent,
      service,
      publicApiBaseUrl,
      stop: createStop(agent, server),
    }
  } catch (error) {
    await Promise.allSettled([agent?.shutdown(), server ? closeServer(server) : undefined])
    throw error
  }
}

async function startHolderAgent(
  didResolver: DidResolver,
  rootCertificate: string,
  logger: BaseLogger,
): Promise<OpenId4VcTestAgents['holder'] & { stop: () => Promise<void> }> {
  let agent: OpenId4VcAgent | undefined
  try {
    agent = createTestVsAgent({
      storeName: 'openid4vc-holder',
      publicApiBaseUrl: HOLDER_PUBLIC_API_BASE_URL,
      plugin: {
        modules: {
          openId4Vc: new OpenId4VcModule(),
          x509: new X509Module({ trustedCertificates: [rootCertificate] }),
        },
      },
      didResolver,
      logger,
    })
    await agent.initialize()
  } catch (error) {
    await Promise.allSettled([agent?.shutdown()])
    throw error
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

export function getAskarStoreConfig(name: string): AskarModuleConfigStoreOptions {
  return {
    id: `${name}-${utils.uuid()}`,
    key: ASKAR_STORE_KEY,
    keyDerivationMethod: 'raw',
    database: { type: 'sqlite', config: { inMemory: true } } as AskarSqliteStorageConfig,
  }
}

export async function createTestAgentsInput() {
  const certificates = await createCertificateFixtures()
  const verifierCertificate = await createVerifierCertificate(certificates.root, TEST_VERIFIER_DID)
  const didDocuments = new Map<string, DidDocument>([
    [
      TEST_ISSUER_DID,
      didDocumentWithKey(TEST_ISSUER_DID, certificates.leaf.publicJwk.toJson(), ['assertionMethod']),
    ],
    [
      TEST_VERIFIER_DID,
      didDocumentWithKey(TEST_VERIFIER_DID, verifierCertificate.publicJwk.toJson(), ['authentication']),
    ],
    [
      TEST_ECOSYSTEM_DID,
      didDocumentWithService(TEST_ECOSYSTEM_DID, {
        id: TEST_VTJSC_SERVICE_ID,
        type: 'LinkedVerifiablePresentation',
        serviceEndpoint: TEST_VTJSC_PRESENTATION_URL,
      }),
    ],
  ])

  return {
    certificates,
    verifierCertificate,
    didDocuments,
    didResolver: new FakeDidResolver(didDocuments),
    issuerDid: TEST_ISSUER_DID,
    verifierDid: TEST_VERIFIER_DID,
    credentialConfiguration: testCredentialConfiguration,
  }
}

// The Type Metadata document is read under the https boundary of the spec, which no fixture server can
// answer, so these Ecosystem documents are served from here and every other request reaches the
// network as before.
function serveDocuments(documents: Record<string, string>): () => Promise<void> {
  const original = globalThis.fetch
  globalThis.fetch = async (resource, init) => {
    const url =
      typeof resource === 'string' ? resource : resource instanceof URL ? resource.href : resource.url
    const document = documents[url]
    if (document === undefined) return original(resource, init)
    return new Response(document, { headers: { 'content-type': 'application/json' } })
  }
  return async () => {
    globalThis.fetch = original
  }
}

// The verifier reads the CredentialSchema and its Ecosystem to compose the type it asks for.
function verifierIndexer(configuration: OpenId4VcCredentialConfiguration) {
  return {
    getCredentialSchema: async () => ({
      id: configuration.credentialSchemaId,
      ecosystem_id: TEST_ECOSYSTEM_ID,
      json_schema: configuration.jsonSchema,
    }),
    getEcosystem: async () => ({ id: TEST_ECOSYSTEM_ID, did: TEST_ECOSYSTEM_DID }),
  }
}

// The VTJSC link and both Participant checks answer from here instead of a VPR.
function verifierTrust(credentialSchemaId: number) {
  return {
    resolveCredentialSchemaLink: async () => ({ credentialSchemaId, ecosystemDid: TEST_ECOSYSTEM_DID }),
    assertOwnAuthorization: async () => {},
    assertAuthorized: async () => {},
  }
}

const trustEveryDid: DidTrustResolver = async () => ({
  trusted: true,
  verified: true,
  outcome: TrustResolutionOutcome.VERIFIED,
  source: 'fresh',
})

function issuerIndexer(did: string, credentialSchemaId: number) {
  return {
    listParticipants: async () => [
      {
        id: 1,
        schema_id: credentialSchemaId,
        did,
        role: ParticipantRole.Issuer,
        participant_state: ParticipantState.Active,
        revoked: null,
        slashed: null,
        modified: '2026-09-01T00:00:00.000Z',
      },
    ],
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
    await Promise.all([agent.shutdown(), server ? closeServer(server) : undefined])
  }
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
