import type { OpenId4VcAgent } from '../src/types'
import type {
  DidCreateResult,
  DidDeactivateResult,
  DidResolutionResult,
  DidUpdateOptions,
  DidUpdateResult,
} from '@credo-ts/core'
import type { Server } from 'node:http'

import { AskarModule } from '@credo-ts/askar'
import {
  Agent,
  AgentContext,
  ConsoleLogger,
  DidDocument,
  DidDocumentRole,
  DidRecord,
  DidRepository,
  DidsModule,
  JsonTransformer,
  LogLevel,
} from '@credo-ts/core'
import { agentDependencies } from '@credo-ts/node'
import { ed25519 } from '@noble/curves/ed25519.js'
import { askar } from '@openwallet-foundation/askar-nodejs'
import { base58 } from '@scure/base'
import { CachedWebDidResolver } from '@verana-labs/vs-agent-sdk'
import express from 'express'
import { afterEach, describe, expect, it } from 'vitest'

import { setupOpenId4Vc } from '../src/sdk/setupOpenId4Vc'
import { IssuerService } from '../src/services/IssuerService'
import { VerifierService } from '../src/services/VerifierService'

import { createCertificateFixtures, OTHER_PRIVATE_JWK } from './helpers/certificates'
import {
  createVerifierCertificate,
  getAskarStoreConfig,
  testCredentialConfiguration,
} from './helpers/startTestAgent'

function clone(document: DidDocument): DidDocument {
  return JsonTransformer.fromJSON(document.toJSON(), DidDocument)
}

const WEBVH_DID = 'did:webvh:QmYwAPJzv5CZsnAzt8auVZRnGi2C9AwBypHj6yQVB5hJiJ:verifier.example'
const WEB_DID = 'did:web:verifier.example'

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
  it('signs under the agent webvh DID with its Ed25519 authentication key', async () => {
    const { service, fetchRequestJwt, ed25519MethodId } = await startWebvhVerifier()

    const request = await service.createRequest({
      jsonSchemaCredentialId: testCredentialConfiguration.id,
      requestedClaims: ['name', 'role'],
      queryLanguage: 'presentation_exchange',
      requestSigner: 'did',
    })
    const { header, payload } = await fetchRequestJwt(request.authorizationRequest)

    expect(header.alg).toBe('EdDSA')
    expect(header.kid).toBe(ed25519MethodId)

    const filter = payload.presentation_definition?.input_descriptors?.[0]?.constraints?.fields?.[0]
      ?.filter as { const?: string; pattern?: string } | undefined
    expect(filter?.const).toBe(testCredentialConfiguration.vct)
    expect(filter?.pattern).toBe(testCredentialConfiguration.vct.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    expect(payload.presentation_definition?.input_descriptors?.[0]?.constraints?.limit_disclosure).toBe(
      'preferred',
    )
    // No JARM on this rail: the wallets that need it cannot build the encrypted response.
    expect(payload.response_mode).toBe('direct_post')
    expect(payload.client_metadata?.jwks).toBeUndefined()
  })
})

async function startWebvhVerifier() {
  const certificates = await createCertificateFixtures()
  const verifierCertificate = await createVerifierCertificate(certificates.root, WEBVH_DID)

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
      signing: {
        configured: {
          certificateChain: [verifierCertificate.toString('base64'), certificates.root.toString('base64')],
          privateJwk: OTHER_PRIVATE_JWK,
        },
      },
    },
    credentialConfigurations: [testCredentialConfiguration],
  }
  let issuerService: IssuerService | undefined
  const sdkPlugin = setupOpenId4Vc(options, () => {
    if (!issuerService) throw new Error('OpenID4VC issuer service is not initialized')
    return issuerService
  })
  app.use(sdkPlugin.publicMiddleware)

  const logger = new ConsoleLogger(LogLevel.Off)
  const agent = new Agent({
    config: { logger, allowInsecureHttpUrls: true },
    dependencies: agentDependencies,
    modules: {
      askar: new AskarModule({ askar, store: getAskarStoreConfig('webvh-pe') }),
      dids: new DidsModule({
        resolvers: [new CachedWebDidResolver(), registry],
        registrars: [registry],
      }),
      ...sdkPlugin.modules,
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
  await agent.dependencyManager.resolve(DidRepository).save(agent.context, didRecord)

  const service = new VerifierService(agent as unknown as OpenId4VcAgent, options)
  await service.ensureInitialized()

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
