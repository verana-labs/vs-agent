import { AskarStoreManager } from '@credo-ts/askar'
import { AgentContext, DidRecord, DidRepository, Kms, Logger } from '@credo-ts/core'
import { KeyAlgorithm } from '@openwallet-foundation/askar-shared'
import {
  DIDLog,
  DIDLogEntry,
  MultibaseEncoding,
  multibaseEncode,
  prepareDataForSigning,
  resolveDIDFromLog,
  Signer,
  SigningInput,
  SigningOutput,
  updateDID,
  Verifier,
} from 'didwebvh-ts'

// didwebvh-ts >=2.8.0 enforces the spec rule that each entry's versionTime is strictly greater
// than the previous one; logs written by the old create+update-at-init flow share a second.
// Hash-chain errors are accepted too: a hash break can mask a same-second pair behind it,
// and the rebuild recomputes hashes anyway.
const REBUILDABLE_ERROR = /must be greater than previous entry time|hash chain broken/i

class KmsVerifier implements Verifier {
  public constructor(private readonly agentContext: AgentContext) {}

  public async verify(signature: Uint8Array, message: Uint8Array, publicKey: Uint8Array): Promise<boolean> {
    try {
      const kms = this.agentContext.dependencyManager.resolve(Kms.KeyManagementApi)
      const publicJwk = Kms.PublicJwk.fromPublicKey({ kty: 'OKP', crv: 'Ed25519', publicKey })
      const { verified } = await kms.verify({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        key: { publicJwk: publicJwk.toJson() as any },
        algorithm: 'EdDSA',
        signature,
        data: message,
      })
      return verified
    } catch {
      return false
    }
  }
}

class KmsSigner implements Signer {
  public constructor(
    private readonly agentContext: AgentContext,
    private readonly kmsKeyId: string,
    private readonly publicKeyMultibase: string,
  ) {}

  public getVerificationMethodId(): string {
    return `did:key:${this.publicKeyMultibase}`
  }

  public async sign(input: SigningInput): Promise<SigningOutput> {
    const kms = this.agentContext.dependencyManager.resolve(Kms.KeyManagementApi)
    const data = await prepareDataForSigning(input.document, input.proof)
    const { signature } = await kms.sign({
      keyId: this.kmsKeyId,
      algorithm: 'EdDSA',
      data,
    })
    return { proofValue: multibaseEncode(signature, MultibaseEncoding.BASE58_BTC) }
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const normalizeMethodArray = (arr: any): string[] | undefined =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  arr?.map((item: any) => (typeof item === 'string' ? item : item.id))

// Compare at second precision because the output is second-truncated.
function nextVersionTime(previous: string, desired: string): string {
  const parseSeconds = (value: string): number => Math.floor(Date.parse(value) / 1000) * 1000
  const previousMs = parseSeconds(previous)
  const desiredMs = parseSeconds(desired)
  const chosen = Number.isNaN(desiredMs) || desiredMs <= previousMs ? previousMs + 1000 : desiredMs
  return new Date(chosen).toISOString().replace(/\.\d+Z$/, 'Z')
}

async function tryResolveLog(
  log: DIDLog,
  verifier: Verifier,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    await resolveDIDFromLog(log, { verifier })
    return { ok: true }
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) }
  }
}

export interface RebuildWebVhVersionTimesOptions {
  signer: Signer
  verifier: Verifier
  domain?: string
}

export async function rebuildWebVhVersionTimes(
  log: DIDLog,
  { signer, verifier, domain }: RebuildWebVhVersionTimesOptions,
): Promise<DIDLog | null> {
  if (!log || log.length < 2) return null

  const initial = await tryResolveLog(log, verifier)
  if (initial.ok) return null
  if (!REBUILDABLE_ERROR.test(initial.reason)) return null

  const originalScid = log[0].parameters.scid
  let newLog: DIDLog = [log[0]]

  for (let i = 1; i < log.length; i++) {
    const oldEntry: DIDLogEntry = log[i]
    const oldState = oldEntry.state
    const oldParams = oldEntry.parameters
    const lastParams = newLog[newLog.length - 1].parameters

    const activeUpdateKeys = lastParams.updateKeys ?? []
    if (activeUpdateKeys.length === 0) {
      throw new Error(`Cannot rebuild webvh log: no active updateKeys at entry ${i + 1}`)
    }

    const controllerValue = Array.isArray(oldState.controller) ? oldState.controller[0] : oldState.controller

    const { log: rebuilt } = await updateDID({
      log: newLog,
      signer,
      verifier,
      domain,
      updateKeys: oldParams.updateKeys ?? activeUpdateKeys,
      verificationMethods: oldState.verificationMethod,
      services: oldState.service,
      controller: controllerValue,
      authentication: normalizeMethodArray(oldState.authentication),
      assertionMethod: normalizeMethodArray(oldState.assertionMethod),
      keyAgreement: normalizeMethodArray(oldState.keyAgreement),
      alsoKnownAs: oldState.alsoKnownAs,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      context: (oldState as any)['@context'],
      portable: oldParams.portable,
      nextKeyHashes: oldParams.nextKeyHashes,
      witness:
        oldParams.witness && (oldParams.witness.witnesses?.length || oldParams.witness.threshold)
          ? oldParams.witness
          : undefined,
      watchers: oldParams.watchers,
      updated: nextVersionTime(newLog[newLog.length - 1].versionTime, oldEntry.versionTime),
    })
    newLog = rebuilt
  }

  const verify = await tryResolveLog(newLog, verifier)
  if (!verify.ok) {
    throw new Error(`Rebuilt webvh log is still invalid: ${verify.reason}`)
  }
  if (newLog[0].parameters.scid !== originalScid) {
    throw new Error(`Rebuilt webvh log produced a different SCID; aborting migration`)
  }

  return newLog
}

async function findKmsKeyIdForFingerprint(
  agentContext: AgentContext,
  fingerprint: string,
): Promise<string | undefined> {
  try {
    const storeManager = agentContext.dependencyManager.resolve(AskarStoreManager)
    return await storeManager.withSession(agentContext, async session => {
      const entries = await session.fetchAllKeys({ algorithm: KeyAlgorithm.Ed25519 })
      for (const entry of entries) {
        const pubBytes = entry.key.publicBytes
        const computed = multibaseEncode(new Uint8Array([237, 1, ...pubBytes]), MultibaseEncoding.BASE58_BTC)
        entry.key.handle.free()
        if (computed === fingerprint) return entry.name
      }
      return undefined
    })
  } catch {
    agentContext.config.logger.warn(
      `Failed to scan Askar keys, cannot recover controller key for webvh versionTime migration`,
    )
    return undefined
  }
}

export async function migrateWebVhVersionTimeIfBroken(
  agentContext: AgentContext,
  didRecord: DidRecord,
  logger: Logger,
): Promise<boolean> {
  const log = didRecord.metadata.get('log') as DIDLog | undefined
  if (!log || log.length < 2) return false

  const verifier = new KmsVerifier(agentContext)

  const preCheck = await tryResolveLog(log, verifier)
  if (preCheck.ok) return false
  if (!REBUILDABLE_ERROR.test(preCheck.reason)) return false

  const domain = didRecord.getTag('domain') as string | undefined
  const activeUpdateKey = log[log.length - 1].parameters.updateKeys?.[0] ?? log[0].parameters.updateKeys?.[0]
  if (!activeUpdateKey) {
    throw new Error(`Cannot migrate webvh log for ${didRecord.did}: no updateKeys present`)
  }

  let kmsKeyId = didRecord.keys?.[0]?.kmsKeyId
  if (!kmsKeyId) {
    kmsKeyId = await findKmsKeyIdForFingerprint(agentContext, activeUpdateKey)
    if (!kmsKeyId) {
      throw new Error(`Cannot migrate webvh log for ${didRecord.did}: no controller key on DID record`)
    }
    logger.warn(`webvh DID ${didRecord.did}: controller key recovered from Askar scan`)
    const vm = didRecord.didDocument?.verificationMethod?.find(v => v.publicKeyMultibase === activeUpdateKey)
    const relativeKeyId = vm?.id ? `#${vm.id.split('#')[1]}` : '#key-1'
    didRecord.keys = [{ kmsKeyId, didDocumentRelativeKeyId: relativeKeyId }]
  }

  logger.warn(
    `webvh DID log for ${didRecord.did} has non-monotonic versionTimes. ` +
      `Rebuilding entries 2..${log.length} while preserving SCID.`,
  )

  const signer = new KmsSigner(agentContext, kmsKeyId, activeUpdateKey)

  const newLog = await rebuildWebVhVersionTimes(log, { signer, verifier, domain })
  if (!newLog) return false

  didRecord.metadata.set('log', newLog)
  const didRepository = agentContext.dependencyManager.resolve(DidRepository)
  await didRepository.update(agentContext, didRecord)

  logger.info(
    `webvh DID log for ${didRecord.did} versionTimes migrated; ${newLog.length} entries; SCID preserved (${log[0].parameters.scid}).`,
  )

  return true
}
