import type { BaseAgent } from '@credo-ts/core'

import { AgentContext, DidDocument, VerificationMethod } from '@credo-ts/core'

import { ensureCreatedDidRecordKeyMapping } from '../services/CertificateService'
import { findEd25519VerificationMethodId, ownDidResolutionPolicy } from './keyBinding'

export const PARALLEL_WEB_SIGNING_KEY_FRAGMENT = '#openid4vc-parallel-web'

export function asParallelDidWeb(didOrUrl: string): string {
  const match = /^did:webvh:([^:]+):/.exec(didOrUrl)
  return match ? didOrUrl.replace(`did:webvh:${match[1]}`, 'did:web') : didOrUrl
}

type ParallelWebSigningAgent = Pick<BaseAgent, 'dids' | 'dependencyManager'> & { did?: string }

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

    // The boot self-heal strips foreign entries from `authentication` on every restart, so membership here is re-checked and re-added on every initialization.
    const existing = (recordDocument.verificationMethod ?? []).find(method => method.id === methodId)
    const referencedInAuthentication = (recordDocument.authentication ?? []).some(
      entry => (typeof entry === 'string' ? entry : entry.id) === methodId,
    )
    if (
      existing?.type === 'Ed25519VerificationKey2020' &&
      existing.publicKeyMultibase === sourceMethod.publicKeyMultibase &&
      referencedInAuthentication
    ) {
      return (await signerReady()) ? methodId : undefined
    }

    const didDocument = DidDocument.fromJSON(recordDocument.toJSON())
    // The method is appended, never inserted: the webvh registrar signs its log proof with the first publicKeyMultibase method, which must remain the update key.
    didDocument.verificationMethod = [
      ...(didDocument.verificationMethod ?? []).filter(method => method.id !== methodId),
      // Ed25519VerificationKey2020, not Multikey: MOSIP's key resolver only knows RsaVerificationKey2018 and Ed25519VerificationKey2018/2020, and fails a Multikey's multibase path.
      new VerificationMethod({
        id: methodId,
        type: 'Ed25519VerificationKey2020',
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
