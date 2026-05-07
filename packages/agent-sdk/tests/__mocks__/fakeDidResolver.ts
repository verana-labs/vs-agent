import {
  DidRepository,
  type AgentContext,
  type DidResolutionOptions,
  type DidResolutionResult,
  type DidResolver,
} from '@credo-ts/core'
import type { ParsedDID } from 'did-resolver'
import { VsAgent } from '../../src/agent'

export class FakeDidResolver implements DidResolver {
  public readonly supportedMethods = ['webvh', 'web']
  public readonly allowsCaching = false

  private readonly agents: VsAgent[] = []

  registerAgent(agent: VsAgent): void {
    this.agents.push(agent)
  }

  async resolve(
    _agentContext: AgentContext,
    did: string,
    parsed: ParsedDID,
    _options: DidResolutionOptions,
  ): Promise<DidResolutionResult> {
    const domain = parsed.id.includes(':') ? parsed.id.split(':')[1] : parsed.id

    for (const agent of this.agents) {
      const repo = agent.context.dependencyManager.resolve(DidRepository)
      const record =
        (await repo.findCreatedDid(agent.context, did)) ??
        (await repo.findSingleByQuery(agent.context, { alternativeDids: [did] })) ??
        (parsed.method === 'webvh'
          ? await repo.findSingleByQuery(agent.context, { method: 'webvh', domain })
          : undefined) ??
        (parsed.method === 'web'
          ? await repo.findSingleByQuery(agent.context, { method: 'web', domain })
          : undefined)
      if (record?.didDocument) {
        return { didDocument: record.didDocument, didDocumentMetadata: {}, didResolutionMetadata: {} }
      }
    }
    return {
      didDocument: null,
      didDocumentMetadata: {},
      didResolutionMetadata: { error: 'notFound', message: `DID ${did} not found in FakeDidResolver` },
    }
  }
}
