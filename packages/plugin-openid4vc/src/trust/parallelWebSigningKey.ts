import type { BaseAgent } from '@credo-ts/core'

import { AgentContext, DidDocument, VerificationMethod } from '@credo-ts/core'

import { ensureCreatedDidRecordKeyMapping } from '../services/CertificateService'
import { findEd25519VerificationMethodId, ownDidResolutionPolicy } from './keyBinding'

export const PARALLEL_WEB_SIGNING_KEY_FRAGMENT = '#openid4vc-parallel-web'

/**
 * The parallel did:web name for a did:webvh identifier, per
 * https://identity.foundation/didwebvh/v1.0/#publishing-a-parallel-didweb-did.
 * Anything else is returned unchanged.
 */
export function asParallelDidWeb(didOrUrl: string): string {
  const match = /^did:webvh:([^:]+):/.exec(didOrUrl)
  return match ? didOrUrl.replace(`did:webvh:${match[1]}`, 'did:web') : didOrUrl
}

type ParallelWebSigningAgent = Pick<BaseAgent, 'dids' | 'dependencyManager'> & { did?: string }

/**
 * Wallets that verify authorization requests by resolving did:web but not did:webvh can only
 * check a signature whose kid lives under the agent's parallel did:web name. Publishes the
 * PE-rail Ed25519 authentication key a second time as a verification method named by that
 * parallel did:web, so the request signer can present client_id and kid a wallet can resolve
 * while the key stays on the one webvh record.
 *
 * Appended to `verificationMethod`, never inserted: the webvh registrar signs its log proof with
 * the first publicKeyMultibase method, which must remain the update key. And never register a
 * did:web DidRecord for this: `dids.import` finds the agent's webvh record through its
 * `alternativeDids` tag and overwrites the stored document in place.
 */
export async function publishParallelWebSigningKey(
  agent: ParallelWebSigningAgent,
  timeoutMs: number,
): Promise<string | undefined> {
  const did = agent.did
  if (!did?.startsWith('did:webvh:')) return undefined
  const webDid = asParallelDidWeb(did)
  if (webDid === did) return undefined
  const methodId = `${webDid}${PARALLEL_WEB_SIGNING_KEY_FRAGMENT}`
  const logger = agent.dependencyManager.resolve(AgentContext).config.logger

  try {
    const sourceDidUrl = await findEd25519VerificationMethodId(
      agent,
      did,
      ['authentication'],
      ownDidResolutionPolicy(did, timeoutMs),
    )
    if (!sourceDidUrl) return undefined

    const { didDocument: recordDocument, keys } = await agent.dids.resolveCreatedDidDocumentWithKeys(did)
    const sourceMethod = recordDocument.dereferenceKey(sourceDidUrl, ['authentication'])
    if (!sourceMethod.publicKeyMultibase) return undefined
    const kmsKeyId = keys?.find(key => sourceMethod.id.endsWith(key.didDocumentRelativeKeyId))?.kmsKeyId
    if (!kmsKeyId) return undefined

    await ensureCreatedDidRecordKeyMapping(agent, did, PARALLEL_WEB_SIGNING_KEY_FRAGMENT, kmsKeyId)

    // The sign callback dereferences the didUrl restricted to `authentication`
    // (getPublicJwkFromDid), so publishing the method alone is not enough: it must also be
    // referenced there. And the boot self-heal strips foreign entries from `authentication` on
    // every restart, so membership is re-checked and re-added each initialization, the same way
    // publishDevelopmentSigningKey survives it.
    const signerReady = async () => {
      try {
        await agent.dids.resolveVerificationMethodFromCreatedDidRecord(methodId, ['authentication'])
        return true
      } catch (error) {
        logger.warn(
          `published parallel did:web method is not reachable as ${methodId}; presentation-exchange requests keep the ${did} name: ${
            error instanceof Error ? error.message : String(error)
          }`,
        )
        return false
      }
    }

    const existing = (recordDocument.verificationMethod ?? []).find(method => method.id === methodId)
    const referencedInAuthentication = (recordDocument.authentication ?? []).some(
      entry => (typeof entry === 'string' ? entry : entry.id) === methodId,
    )
    if (existing?.publicKeyMultibase === sourceMethod.publicKeyMultibase && referencedInAuthentication) {
      return (await signerReady()) ? methodId : undefined
    }

    const didDocument = DidDocument.fromJSON(recordDocument.toJSON())
    didDocument.verificationMethod = [
      ...(didDocument.verificationMethod ?? []).filter(method => method.id !== methodId),
      new VerificationMethod({
        id: methodId,
        type: 'Multikey',
        controller: did,
        publicKeyMultibase: sourceMethod.publicKeyMultibase,
      }),
    ]
    didDocument.authentication = [
      ...(didDocument.authentication ?? []).filter(
        entry => (typeof entry === 'string' ? entry : entry.id) !== methodId,
      ),
      methodId,
    ]

    const update = await agent.dids.update({ did, didDocument })
    if (update.didState.state !== 'finished') {
      logger.warn(`parallel did:web signing key publication did not finish for ${did}`)
      return undefined
    }
    return (await signerReady()) ? methodId : undefined
  } catch (error) {
    logger.warn(
      `parallel did:web signing key publication failed for ${did}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
    return undefined
  }
}
