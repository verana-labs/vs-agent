import type { BaseAgent, DidDocumentKey } from '@credo-ts/core'

import { AgentContext, DidRepository } from '@credo-ts/core'
import { getLegacyDidDocument } from '@verana-labs/vs-agent-sdk'

/**
 * The parallel did:web name for a did:webvh identifier, per
 * https://identity.foundation/didwebvh/v1.0/#publishing-a-parallel-didweb-did.
 * Anything else is returned unchanged.
 */
export function asParallelDidWeb(didOrUrl: string): string {
  const match = /^did:webvh:([^:]+):/.exec(didOrUrl)
  return match ? didOrUrl.replace(`did:webvh:${match[1]}`, 'did:web') : didOrUrl
}

type ParallelDidWebAgent = Pick<BaseAgent, 'dids' | 'dependencyManager'> & { did?: string }

/**
 * Register the agent's parallel did:web locally so Credo can sign under that name.
 *
 * The agent already publishes the parallel document at /.well-known/did.json, but the did:web DID
 * record is deleted when an agent is upgraded to did:webvh, so no key mapping survives under the
 * did:web name and signing with it fails before a request is ever built. Wallets that resolve
 * did:web but not did:webvh can only verify a request signed under that name, so the same key
 * mappings are imported a second time against it. Nothing published changes: this only tells the
 * local wallet which keys it owns.
 */
export async function registerParallelDidWeb(
  agent: ParallelDidWebAgent,
  publicApiBaseUrl: string,
): Promise<string | undefined> {
  const did = agent.did
  if (!did?.startsWith('did:webvh:')) return undefined

  const agentContext = agent.dependencyManager.resolve(AgentContext)
  const repository = agent.dependencyManager.resolve(DidRepository)
  const record = await repository.findCreatedDid(agentContext, did)
  if (!record?.didDocument) return undefined

  const legacyDocument = getLegacyDidDocument(record.didDocument, publicApiBaseUrl)
  if (!legacyDocument) return undefined

  // The fragments are identical either side, so mappings carry over unchanged, but `dids.import`
  // rejects the whole document if one names a verification method it does not contain. The
  // did:webvh record can hold mappings the parallel document has not caught up with, so only the
  // ones that resolve are carried, matched the way Credo matches them.
  const verificationMethods = legacyDocument.verificationMethod ?? []
  const keys: DidDocumentKey[] = (record.keys ?? []).filter(key =>
    verificationMethods.some(method => method.id.endsWith(key.didDocumentRelativeKeyId)),
  )

  await agent.dids.import({
    did: legacyDocument.id,
    didDocument: legacyDocument,
    keys,
    overwrite: true,
  })

  return legacyDocument.id
}
