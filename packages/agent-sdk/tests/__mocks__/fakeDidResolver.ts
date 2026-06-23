import type { ParsedDID } from 'did-resolver'

import {
  DidDocument,
  DidRepository,
  type AgentContext,
  type DidResolutionResult,
  type DidResolver,
} from '@credo-ts/core'

import { VsAgent } from '../../src/agent'

export class FakeDidResolver implements DidResolver {
  public readonly supportedMethods = ['webvh', 'web']
  public readonly allowsCaching = false
  public readonly allowsLocalDidRecord = false

  private readonly didDocuments = new Map<string, DidDocument>()

  async registerAgent(agent: VsAgent): Promise<void> {
    if (!agent.did) return
    const repo = agent.context.dependencyManager.resolve(DidRepository)
    const record = await repo.findCreatedDid(agent.context, agent.did)
    if (!record?.didDocument) {
      throw new Error(`FakeDidResolver: agent ${agent.label} has no DID document for ${agent.did}`)
    }
    this.didDocuments.set(agent.did, record.didDocument)
    const altDids = (record.getTag('alternativeDids') as string[] | undefined) ?? []
    for (const alt of altDids) this.didDocuments.set(alt, record.didDocument)
  }

  async resolve(agentContext: AgentContext, did: string, parsed: ParsedDID): Promise<DidResolutionResult> {
    const direct = this.didDocuments.get(did)
    if (direct) return { didDocument: direct, didDocumentMetadata: {}, didResolutionMetadata: {} }
    const domain = parsed.id.includes(':') ? parsed.id.split(':')[1] : parsed.id
    for (const [storedDid, doc] of this.didDocuments.entries()) {
      const storedDomain = storedDid.split(':').pop()
      if (storedDomain === domain) {
        return { didDocument: doc, didDocumentMetadata: {}, didResolutionMetadata: {} }
      }
    }
    return {
      didDocument: null,
      didDocumentMetadata: {},
      didResolutionMetadata: { error: 'notFound', message: `DID ${did} not found in FakeDidResolver` },
    }
  }
}
