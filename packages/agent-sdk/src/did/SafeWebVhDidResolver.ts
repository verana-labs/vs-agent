import type { DidResolutionResult } from '@credo-ts/core'
import type { DIDLog, Verifier } from 'didwebvh-ts'

import { AgentContext, DidDocument, Kms } from '@credo-ts/core'
import { WebVhDidResolver } from '@credo-ts/webvh'
import { resolveDIDFromLog } from 'didwebvh-ts'

class KmsWebVhVerifier implements Verifier {
  public constructor(private readonly agentContext: AgentContext) {}

  public async verify(signature: Uint8Array, message: Uint8Array, publicKey: Uint8Array): Promise<boolean> {
    try {
      const kms = this.agentContext.dependencyManager.resolve(Kms.KeyManagementApi)
      const publicJwk = Kms.PublicJwk.fromPublicKey({ kty: 'OKP', crv: 'Ed25519', publicKey })
      return (
        await kms.verify({
          key: { publicJwk: publicJwk.toJson() },
          algorithm: 'EdDSA',
          signature,
          data: message,
        })
      ).verified
    } catch (error) {
      this.agentContext.config.logger.error('KMS verification failed:', error)
      return false
    }
  }
}

export class SafeWebVhDidResolver extends WebVhDidResolver {
  public async resolve(agentContext: AgentContext, did: string): Promise<DidResolutionResult> {
    try {
      const url = didWebVhLogUrl(did)
      const response = await agentContext.config.agentDependencies.fetch(url, { redirect: 'manual' })
      if (response.status < 200 || response.status >= 300 || response.redirected || response.url !== url) {
        return unresolvedWebVh()
      }

      const scid = did.split(':')[2]
      if (!scid) return unresolvedWebVh()

      const log = parseDidWebVhLog(await response.text())
      const { doc } = await resolveDIDFromLog(log, {
        verifier: new KmsWebVhVerifier(agentContext),
        requestedDid: did,
        scid,
      })
      return {
        didDocument: DidDocument.fromJSON(doc),
        didDocumentMetadata: {},
        didResolutionMetadata: {},
      }
    } catch (error) {
      agentContext.config.logger.error(`Error resolving DID ${did}: ${error}`)
      return unresolvedWebVh()
    }
  }
}

function didWebVhLogUrl(did: string): string {
  const components = did.split(':')
  if (components.length < 4 || components[0] !== 'did' || components[1] !== 'webvh') {
    throw new Error(`Invalid did:webvh identifier '${did}'`)
  }

  const [encodedHost, ...encodedPath] = components.slice(3)
  if (!encodedHost) throw new Error(`Invalid did:webvh identifier '${did}'`)
  const host = decodeURIComponent(encodedHost)
  const path = encodedPath.map(segment => {
    const decoded = decodeURIComponent(segment)
    if (decoded === '.' || decoded === '..' || decoded.includes('/') || decoded.includes('\\')) {
      throw new Error(`Invalid did:webvh path segment '${segment}'`)
    }
    return decoded
  })
  const url = new URL(`https://${host}`)
  url.pathname = path.length === 0 ? '/.well-known/did.jsonl' : `/${path.join('/')}/did.jsonl`
  return url.href
}

function parseDidWebVhLog(serializedLog: string): DIDLog {
  const lines = serializedLog.trim().split('\n')
  if (!serializedLog.trim() || lines.some(line => !line.trim()))
    throw new Error('DID log is empty or malformed')
  return lines.map(line => JSON.parse(line)) as DIDLog
}

function unresolvedWebVh(): DidResolutionResult {
  return {
    didDocument: null,
    didDocumentMetadata: {},
    didResolutionMetadata: { error: 'notFound' },
  }
}
