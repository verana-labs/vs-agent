import { AgentContext, DidRecord, DidRepository, Kms, Logger } from '@credo-ts/core'
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

/**
 * Verifier that delegates Ed25519 verification to the agent's KMS.
 */
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

/**
 * Signer that signs with an Ed25519 key managed by the agent's KMS,
 * exposing the public key as a `did:key:` verification method id.
 */
class KmsSigner implements Signer {
  public constructor(
    private readonly agentContext: AgentContext,
    private readonly kmsKeyId: string,
    private readonly publicKeyMultibase: string,
  ) {}

  public getVerificationMethodId(): string {
    return `did:key:${this.publicKeyMultibase}`
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

export interface RebuildWebVhLogOptions {
  /** Signer using a key that matches the active `updateKeys[0]` of the rebuilt prefix. */
  signer: Signer
  /** Verifier used both for resolution checks and for the `documentStateIsValid` step inside `updateDID`. */
  verifier: Verifier
  /** Optional domain hint (matches the tag stored on the DidRecord). */
  domain?: string
}

/**
 * `resolveDIDFromLog` throws on validation failures (hash chain, signature,
 * etc.). Normalize that into a discriminated result so callers can branch on
 * the failure mode without try/catch boilerplate.
 */
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

/**
 * Pure rebuild logic, decoupled from credo / askar so it can be unit-tested.
 *
 * If `log` resolves cleanly under the current didwebvh-ts version, returns `null`
 * (nothing to do). Otherwise, if the failure is the known `<2.7.4` "hash chain
 * broken" bug, rebuilds entries 2..N (preserving entry #1, SCID, every entry's
 * `state` and `parameters`) and returns the new log. For any other resolution
 * error, returns `null` and lets the caller decide what to do.
 */
export async function rebuildWebVhLog(
  log: DIDLog,
  { signer, verifier, domain }: RebuildWebVhLogOptions,
): Promise<DIDLog | null> {
  if (!log || log.length === 0) return null

  const initial = await tryResolveLog(log, verifier)
  if (initial.ok) return null
  if (!/hash chain broken/i.test(initial.reason)) return null
  if (log.length < 2) return null

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
      // Forward witness only when it carries meaningful values. Passing an empty
      // `{}` would make `updateDID` expand it into `{ threshold: 0, witnesses: [] }`,
      // which then no longer matches the original entry's parameters.
      witness:
        oldParams.witness && (oldParams.witness.witnesses?.length || oldParams.witness.threshold)
          ? oldParams.witness
          : undefined,
      watchers: oldParams.watchers,
      updated: oldEntry.versionTime,
    })
    newLog = rebuilt
  }

  const verify = await tryResolveLog(newLog, verifier)
  if (!verify.ok) {
    throw new Error(`Rebuilt webvh log is still invalid: ${verify.reason}`)
  }
  if (newLog[0].parameters.scid !== originalScid) {
    // Should be impossible since entry #1 is unchanged, but guard anyway.
    throw new Error(`Rebuilt webvh log produced a different SCID; aborting migration`)
  }

  return newLog
}

/**
 * Detect a `did:webvh` log that became unresolvable because of the
 * `didwebvh-ts` <2.7.4 entry-hash bug (placeholder versionId used for entries
 * after the first). If so, rebuild the log preserving:
 *   - entry #1 byte-for-byte (preserving the SCID and therefore the public DID)
 *   - the `state` and `parameters` of entries 2..N (services, keys, controller, etc.)
 *
 * Only the entryHash and proof of entries 2..N are recomputed/re-signed using
 * the controller key the agent already holds in askar.
 *
 * Returns true if migration ran successfully, false if it was not needed.
 * Throws if the rebuild fails or the result is somehow invalid.
 */
export async function migrateWebVhLogIfBroken(
  agentContext: AgentContext,
  didRecord: DidRecord,
  logger: Logger,
): Promise<boolean> {
  const log = didRecord.metadata.get('log') as DIDLog | undefined
  if (!log || log.length === 0) return false

  const verifier = new KmsVerifier(agentContext)

  // Cheap pre-check so we can produce a clear log message before doing real work.
  const preCheck = await tryResolveLog(log, verifier)
  if (preCheck.ok) return false
  if (!/hash chain broken/i.test(preCheck.reason)) {
    logger.warn(
      `webvh DID log for ${didRecord.did} is invalid and not eligible for hash-chain migration: ${preCheck.reason}`,
    )
    return false
  }

  const kmsKeyId = didRecord.keys?.[0]?.kmsKeyId
  if (!kmsKeyId) {
    throw new Error(`Cannot migrate webvh log for ${didRecord.did}: no controller key on DID record`)
  }

  const domain = didRecord.getTag('domain') as string | undefined
  const activeUpdateKey = log[log.length - 1].parameters.updateKeys?.[0] ?? log[0].parameters.updateKeys?.[0]
  if (!activeUpdateKey) {
    throw new Error(`Cannot migrate webvh log for ${didRecord.did}: no updateKeys present`)
  }

  logger.warn(
    `webvh DID log for ${didRecord.did} is invalid (likely legacy didwebvh-ts <2.7.4 hash bug). ` +
      `Rebuilding entries 2..${log.length} while preserving SCID.`,
  )

  const signer = new KmsSigner(agentContext, kmsKeyId, activeUpdateKey)

  const newLog = await rebuildWebVhLog(log, { signer, verifier, domain })
  if (!newLog) return false

  didRecord.metadata.set('log', newLog)
  const didRepository = agentContext.dependencyManager.resolve(DidRepository)
  await didRepository.update(agentContext, didRecord)

  logger.info(
    `webvh DID log for ${didRecord.did} successfully migrated; ${newLog.length} entries; SCID preserved (${log[0].parameters.scid}).`,
  )

  return true
}
