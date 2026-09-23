import {
  AgentContext,
  DidDocument,
  DidRepository,
  DidResolutionResult,
  JsonTransformer,
  WebDidResolver,
} from '@credo-ts/core'
import { ParsedDID } from 'did-resolver'

import { getLegacyDidDocument } from './legacyDidWeb'

export class CachedWebDidResolver extends WebDidResolver {
  public async resolve(
    agentContext: AgentContext,
    did: string,
    parsed: ParsedDID,
  ): Promise<DidResolutionResult> {
    // First check within our own public dids, as there is no need to resolve it through HTTPS
    const didRepository = agentContext.dependencyManager.resolve(DidRepository)
    const didRecord = await didRepository.findSingleByQuery(agentContext, {
      did,
      method: 'web',
    })

    if (didRecord?.didDocument) {
      return {
        didDocument: didRecord.didDocument,
        didDocumentMetadata: {},
        didResolutionMetadata: {},
      }
    }

    // Find equivalent did:webvh, since this might be a legacy alias
    const webVhdDidRecord = await didRepository.findSingleByQuery(agentContext, {
      domain: parsed.id,
      method: 'webvh',
    })

    if (webVhdDidRecord?.didDocument) {
      const legacyDidDocument = getLegacyDidDocument(webVhdDidRecord.didDocument)
      if (legacyDidDocument) {
        return {
          didDocument: legacyDidDocument,
          didDocumentMetadata: {},
          didResolutionMetadata: {},
        }
      }
    }

    const url = didWebResolutionUrl(parsed)
    try {
      const response = await agentContext.config.agentDependencies.fetch(url, { redirect: 'manual' })
      // Not every fetch implementation honours `redirect: 'manual'`, so a followed redirect is caught after the fact too.
      if (response.status < 200 || response.status >= 300 || response.redirected || response.url !== url) {
        return unresolvedDidWeb()
      }

      const document = (await response.json()) as {
        id?: unknown
        publicKey?: unknown
        verificationMethod?: unknown
      }
      if (document.id !== did) return unresolvedDidWeb()
      if (!document.verificationMethod && document.publicKey) document.verificationMethod = document.publicKey

      return {
        didDocument: JsonTransformer.fromJSON(document, DidDocument),
        didDocumentMetadata: {},
        didResolutionMetadata: {},
      }
    } catch {
      return unresolvedDidWeb()
    }
  }
}

function didWebResolutionUrl(parsed: ParsedDID): string {
  const components = parsed.id.split(':')
  const path =
    components.length === 1
      ? `${decodeURIComponent(parsed.id)}/.well-known/did.json`
      : `${components.map(decodeURIComponent).join('/')}/did.json`
  return new URL(`https://${path}`).href
}

function unresolvedDidWeb(): DidResolutionResult {
  return {
    didDocument: null,
    didDocumentMetadata: {},
    didResolutionMetadata: { error: 'notFound' },
  }
}
