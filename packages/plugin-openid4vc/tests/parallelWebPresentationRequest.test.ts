import type { OpenId4VcCredentialConfiguration } from '../src/types'
import type {
  AgentContext,
  DidCreateResult,
  DidDeactivateResult,
  DidResolutionResult,
  DidUpdateOptions,
  DidUpdateResult,
} from '@credo-ts/core'
import type { Server } from 'node:http'

import { AskarModule, type AskarSqliteStorageConfig } from '@credo-ts/askar'
import {
  Agent,
  ConsoleLogger,
  DidDocument,
  DidDocumentRole,
  DidRecord,
  DidRepository,
  DidsModule,
  JsonTransformer,
  LogLevel,
  utils,
} from '@credo-ts/core'
import { agentDependencies } from '@credo-ts/node'
import { ed25519 } from '@noble/curves/ed25519.js'
import { askar } from '@openwallet-foundation/askar-nodejs'
import { base58 } from '@scure/base'
import { CachedWebDidResolver } from '@verana-labs/vs-agent-sdk'
import express from 'express'
import { afterEach, describe, expect, it } from 'vitest'

import { OpenId4VcPlugin } from '../src/nestjs/OpenId4VcPlugin'
import { VerifierService } from '../src/services/VerifierService'
import { createCertificateFixtures, OTHER_PRIVATE_JWK } from './helpers/certificates'
import { startResolverStub } from './helpers/resolverStub'
import { createVerifierCertificate } from './helpers/testAgent'

const WEBVH_DID = 'did:webvh:QmYwAPJzv5CZsnAzt8auVZRnGi2C9AwBypHj6yQVB5hJiJ:verifier.example'
const WEB_DID = 'did:web:verifier.example'
const CONFIGURATION: OpenId4VcCredentialConfiguration = {
  id: 'employee',
  format: 'dc+sd-jwt',
  vct: 'https://credentials.example/vct/employee',
  name: 'Employee credential',
  vtjscId: 'https://credentials.example/vt/employee.json',
  claims: ['name', 'role'],
  disclosureFrame: ['name', 'role'],
  ttlSeconds: 3_600,
}

class WebvhStubRegistry {
  public readonly supportedMethods = ['webvh']
  public readonly allowsCaching = false
  public readonly allowsLocalDidRecord = false

  public constructor(private readonly documents: Map<string, DidDocument>) {}

  public async resolve(_agentContext: AgentContext, did: string): Promise<DidResolutionResult> {
    const stored = this.documents.get(did)
    if (!stored) {
      return { didDocument: null, didDocumentMetadata: {}, didResolutionMetadata: { error: 'notFound' } }
    }
    return { didDocument: clone(stored), didDocumentMetadata: {}, didResolutionMetadata: {} }
  }

  public async update(agentContext: AgentContext, options: DidUpdateOptions): Promise<DidUpdateResult> {
    const didDocument = clone(options.didDocument as DidDocument)
    this.documents.set(options.did, didDocument)
    const didRepository = agentContext.dependencyManager.resolve(DidRepository)
    const didRecord = await didRepository.findCreatedDid(agentContext, options.did)
    if (didRecord) {
      didRecord.didDocument = clone(didDocument)
      await didRepository.update(agentContext, didRecord)
    }
    return {
      didState: { state: 'finished', did: options.did, didDocument },
      didDocumentMetadata: {},
      didRegistrationMetadata: {},
    }
  }

  public async create(): Promise<DidCreateResult> {
    return {
      didState: { state: 'failed', reason: 'not implemented' },
      didDocumentMetadata: {},
      didRegistrationMetadata: {},
    }
  }

  public async deactivate(): Promise<DidDeactivateResult> {
    return {
      didState: { state: 'failed', reason: 'not implemented' },
      didDocumentMetadata: {},
      didRegistrationMetadata: {},
    }
  }
}

const cleanups: Array<() => Promise<unknown>> = []

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map(stop => stop().catch(() => undefined)))
})

describe('presentation-exchange request signing for a webvh verifier', () => {
  it('signs under the published parallel did:web method when the record is reachable', async () => {
    const { service, fetchRequestJwt } = await startWebvhVerifier({ seedAlternativeDids: true })

    const request = await service.createRequest('employee-check', 'presentation_exchange')
    const { header, payload } = await fetchRequestJwt(request.authorizationRequest)

    expect(header.alg).toBe('EdDSA')
    expect(header.kid).toBe(`${WEB_DID}#openid4vc-parallel-web`)

    const filter = payload.presentation_definition?.input_descriptors?.[0]?.constraints?.fields?.[0]
      ?.filter as { const?: string; pattern?: string } | undefined
    expect(filter?.const).toBe(CONFIGURATION.vct)
    expect(filter?.pattern).toBe(CONFIGURATION.vct.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    expect(payload.presentation_definition?.input_descriptors?.[0]?.constraints?.limit_disclosure).toBe(
      'preferred',
    )
    // No JARM on this rail: the wallets that need it cannot build the encrypted response.
    expect(payload.response_mode).toBe('direct_post')
    expect(payload.client_metadata?.jwks).toBeUndefined()
  })

  it('falls back to the webvh-named key when the parallel record lookup fails', async () => {
    const { service, fetchRequestJwt, ed25519MethodId } = await startWebvhVerifier({
      seedAlternativeDids: false,
    })

    const request = await service.createRequest('employee-check', 'presentation_exchange')
    const { header } = await fetchRequestJwt(request.authorizationRequest)

    expect(header.alg).toBe('EdDSA')
    expect(header.kid).toBe(ed25519MethodId)
  })
})

async function startWebvhVerifier({ seedAlternativeDids }: { seedAlternativeDids: boolean }) {
  const certificates = await createCertificateFixtures()
  const verifierCertificate = await createVerifierCertificate(certificates.root, WEBVH_DID)
  const resolverStub = await startResolverStub({
    trusted: new Set([WEBVH_DID, WEB_DID]),
    authorized: new Set([WEBVH_DID, WEB_DID]),
  })
  cleanups.push(() => resolverStub.stop())

  const secretKey = ed25519.utils.randomSecretKey()
  const publicKey = ed25519.getPublicKey(secretKey)
  const publicKeyMultibase = `z${base58.encode(new Uint8Array([0xed, 0x01, ...publicKey]))}`
  const ed25519MethodId = `${WEBVH_DID}#${publicKeyMultibase}`
  const certMethodId = `${WEBVH_DID}#certificate`

  const didDocument = JsonTransformer.fromJSON(
    {
      id: WEBVH_DID,
      alsoKnownAs: [WEB_DID],
      verificationMethod: [
        {
          id: ed25519MethodId,
          type: 'Multikey',
          controller: WEBVH_DID,
          publicKeyMultibase,
        },
        {
          id: certMethodId,
          type: 'JsonWebKey2020',
          controller: WEBVH_DID,
          publicKeyJwk: verifierCertificate.publicJwk.toJson(),
        },
      ],
      authentication: [ed25519MethodId, certMethodId],
      assertionMethod: [ed25519MethodId],
    },
    DidDocument,
  )

  const documents = new Map<string, DidDocument>([[WEBVH_DID, clone(didDocument)]])
  const registry = new WebvhStubRegistry(documents)

  const app = express()
  const server = await new Promise<Server>((resolve, reject) => {
    const started = app.listen(0, '127.0.0.1', () => resolve(started))
    started.on('error', reject)
  })
  cleanups.push(async () => {
    server.closeAllConnections?.()
    await new Promise<void>(resolve => server.close(() => resolve()))
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('no server address')
  const publicApiBaseUrl = `http://127.0.0.1:${address.port}`

  const options = {
    publicApiBaseUrl,
    verifier: {
      id: 'verifier',
      displayName: 'Webvh Fixture Verifier',
      signing: {
        configured: {
          certificateChain: [verifierCertificate.toString('base64'), certificates.root.toString('base64')],
          privateJwk: OTHER_PRIVATE_JWK,
        },
      },
      requestSigner: 'did' as const,
    },
    trust: {
      resolverUrl: resolverStub.url,
      timeoutMs: 500,
      allowedDidWebHosts: ['verifier.example'],
      credentialIssuerCertificates: [certificates.root.toString('base64')],
    },
    credentialConfigurations: [CONFIGURATION],
    verifierPolicies: [
      {
        id: 'employee-check',
        credentialConfigurationId: CONFIGURATION.id,
        requestedClaims: ['name', 'role'],
      },
    ],
  }
  const plugin = OpenId4VcPlugin(options)
  if (!plugin.credoPlugin) throw new Error('plugin did not expose Credo modules')
  if (!plugin.publicMiddleware) throw new Error('plugin did not expose public middleware')
  app.use(plugin.publicMiddleware)

  const logger = new ConsoleLogger(LogLevel.Off)
  const agent = new Agent({
    config: { logger, allowInsecureHttpUrls: true },
    dependencies: agentDependencies,
    modules: {
      askar: new AskarModule({
        askar,
        store: {
          id: `webvh-pe-${utils.uuid()}`,
          key: 'DZ9hPqFWTPxemcGea72C1X1nusqk5wFNLq6QPjwXGqAa',
          keyDerivationMethod: 'raw',
          database: { type: 'sqlite', config: { inMemory: true } } as AskarSqliteStorageConfig,
        },
      }),
      dids: new DidsModule({
        resolvers: [new CachedWebDidResolver({ publicApiBaseUrl }), registry],
        registrars: [registry],
      }),
      ...plugin.credoPlugin.modules,
    },
  }) as Agent & { did?: string }
  agent.did = WEBVH_DID
  await agent.initialize()
  cleanups.push(() => agent.shutdown())

  const imported = await agent.kms.importKey({
    privateJwk: {
      kty: 'OKP',
      crv: 'Ed25519',
      x: Buffer.from(publicKey).toString('base64url'),
      d: Buffer.from(secretKey).toString('base64url'),
    },
  })

  const didRecord = new DidRecord({
    did: WEBVH_DID,
    role: DidDocumentRole.Created,
    didDocument: clone(didDocument),
    keys: [{ didDocumentRelativeKeyId: `#${publicKeyMultibase}`, kmsKeyId: imported.keyId }],
  })
  didRecord.setTag('domain', 'verifier.example')
  if (seedAlternativeDids) didRecord.setTag('alternativeDids', [WEB_DID])
  await agent.dependencyManager.resolve(DidRepository).save(agent.context, didRecord)

  await plugin.initialize?.(agent as never, logger as never)

  const provider = plugin.providers?.find(
    (candidate): candidate is { provide: unknown; useFactory: (agent: unknown) => unknown } =>
      typeof candidate === 'object' &&
      candidate !== null &&
      'provide' in candidate &&
      'useFactory' in candidate &&
      (candidate as { provide: unknown }).provide === VerifierService,
  )
  if (!provider) throw new Error('plugin did not register VerifierService')
  const service = provider.useFactory(agent) as VerifierService

  const fetchRequestJwt = async (authorizationRequest: string) => {
    const url = new URL(authorizationRequest.replace('openid4vp://', 'https://x/'))
    const requestUri = url.searchParams.get('request_uri')
    if (!requestUri) throw new Error(`no request_uri in ${authorizationRequest}`)
    const jwt = await (await fetch(requestUri)).text()
    const [headerPart, payloadPart] = jwt.split('.')
    return {
      header: JSON.parse(Buffer.from(headerPart, 'base64url').toString()) as {
        alg: string
        kid: string
      },
      // biome-ignore lint/suspicious/noExplicitAny: raw JWT payload probing
      payload: JSON.parse(Buffer.from(payloadPart, 'base64url').toString()) as any,
    }
  }

  return { service, fetchRequestJwt, ed25519MethodId }
}

function clone(document: DidDocument): DidDocument {
  return JsonTransformer.fromJSON(document.toJSON(), DidDocument)
}
