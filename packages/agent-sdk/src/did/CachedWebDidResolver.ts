import {
  AgentContext,
  DidRepository,
  DidResolutionOptions,
  DidResolutionResult,
  WebDidResolver,
} from '@credo-ts/core'
import { ParsedDID } from 'did-resolver'

import { getLegacyDidDocument } from './legacyDidWeb'

export class CachedWebDidResolver extends WebDidResolver {
  private publicApiBaseUrl: string

  public constructor(options: { publicApiBaseUrl: string }) {
    super()
    this.publicApiBaseUrl = options.publicApiBaseUrl
  }

  public async resolve(
    agentContext: AgentContext,
    did: string,
    parsed: ParsedDID,
    didResolutionOptions: DidResolutionOptions,
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
      const legacyDidDocument = getLegacyDidDocument(webVhdDidRecord.didDocument, this.publicApiBaseUrl)
      if (legacyDidDocument) {
        return {
          didDocument: legacyDidDocument,
          didDocumentMetadata: {},
          didResolutionMetadata: {},
        }
      }
    }

    return super.resolve(agentContext, did, parsed, didResolutionOptions)
  }
}
