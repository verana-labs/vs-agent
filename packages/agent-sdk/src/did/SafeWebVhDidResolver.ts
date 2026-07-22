import type { DidResolutionOptions, DidResolutionResult, ParsedDid } from '@credo-ts/core'
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
  public async resolve(
    agentContext: AgentContext,
    did: string,
    _parsed?: ParsedDid,
    _didResolutionOptions?: DidResolutionOptions,
  ): Promise<DidResolutionResult> {
    try {
      const url = didWebVhLogUrl(this.getBaseUrl(did))
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

function didWebVhLogUrl(baseUrl: string): string {
  const url = new URL(baseUrl)
  url.pathname =
    url.pathname === '/' ? '/.well-known/did.jsonl' : `${url.pathname.replace(/\/$/, '')}/did.jsonl`
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
