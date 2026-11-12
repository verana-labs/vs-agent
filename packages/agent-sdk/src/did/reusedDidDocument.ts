import { DidDocument } from '@credo-ts/core'

const LINKED_VP_SERVICE_TYPE = 'LinkedVerifiablePresentation'
const SIGNING_VERIFICATION_METHOD_TYPES: readonly string[] = [
  'Ed25519VerificationKey2020',
  'Ed25519VerificationKey2018',
]

/**
 * The verification method the agent signs its credentials and presentations with: the first
 * `assertionMethod` entry, when it is an Ed25519 key. A did:webvh document written by v1 also types
 * the update key as `Ed25519VerificationKey2020`, so the type alone does not identify it.
 */
export function findSigningVerificationMethodId(didDocument: DidDocument): string | undefined {
  const [first] = didDocument.assertionMethod ?? []
  if (typeof first !== 'string') return undefined
  return didDocument.verificationMethod?.find(
    method => method.id === first && SIGNING_VERIFICATION_METHOD_TYPES.includes(method.type),
  )?.id
}

/**
 * Makes sure the signing key is under `authentication` and `assertionMethod`, and removes the
 * did:webvh update keys from both. A document written by v1 has the update key, and not the
 * signing key, under `authentication`, so no resolver accepts a presentation whose proof purpose
 * is `authentication`. Every other key stays: the OpenID4VC keys live under these relations too.
 * `updateKeys` are the `updateKeys` of the did:webvh log, as multibase public keys.
 * Returns whether the document changed.
 */
export function alignSigningKeyRelations(didDocument: DidDocument, updateKeys: string[] = []): boolean {
  const signingKeyId = findSigningVerificationMethodId(didDocument)
  if (!signingKeyId) return false

  const updateKeyIds = (didDocument.verificationMethod ?? [])
    .filter(
      method =>
        method.id !== signingKeyId &&
        typeof method.publicKeyMultibase === 'string' &&
        updateKeys.includes(method.publicKeyMultibase),
    )
    .map(method => method.id)

  let changed = false
  for (const relation of ['authentication', 'assertionMethod'] as const) {
    const current = didDocument[relation] ?? []
    const kept = current.filter(entry => typeof entry !== 'string' || !updateKeyIds.includes(entry))
    const aligned = kept.includes(signingKeyId) ? kept : [signingKeyId, ...kept]
    if (aligned.length === current.length && aligned.every((entry, index) => entry === current[index]))
      continue
    didDocument[relation] = aligned
    changed = true
  }
  return changed
}

/** Every key a did:webvh log has authorized to update the DID, as multibase public keys. */
export function didWebvhUpdateKeys(log: unknown): string[] {
  if (!Array.isArray(log)) return []
  const updateKeys = log.flatMap(
    entry => (entry as { parameters?: { updateKeys?: unknown } })?.parameters?.updateKeys ?? [],
  )
  return [...new Set(updateKeys.filter((key): key is string => typeof key === 'string'))]
}

type PresentationEntries = Record<string, { verifiablePresentation?: { id?: string } } | undefined>

export interface ServedLinkedVpOptions {
  publicApiBaseUrl: string
  /** The `_vt/vtc` metadata of the DID record */
  vtc?: PresentationEntries
  /** The `_vt/jsc` metadata of the DID record */
  jsc?: PresentationEntries
}

/**
 * Whether `GET /vt/:file` of the public API answers this endpoint with a presentation: the file
 * name has a suffix the route accepts, and the DID record stores a presentation under that URL.
 */
function isServedLinkedVp(endpoint: string, { publicApiBaseUrl, vtc, jsc }: ServedLinkedVpOptions): boolean {
  if (!endpoint.startsWith(`${publicApiBaseUrl}/vt/`)) return false
  const entries = endpoint.endsWith('-vtc-vp.json')
    ? vtc
    : endpoint.endsWith('-vtjsc-vp.json')
      ? jsc
      : undefined
  return Object.values(entries ?? {}).some(entry => entry?.verifiablePresentation?.id === endpoint)
}

/**
 * Removes the `LinkedVerifiablePresentation` services whose endpoint the agent does not serve, such
 * as the `/vt/schemas-*-c-vp.json` ones a v1 document carries: a resolver reports each of them as a
 * failed presentation. Returns the ids of the removed services.
 */
export function removeUnservedLinkedVpServices(
  didDocument: DidDocument,
  options: ServedLinkedVpOptions,
): string[] {
  const removed: string[] = []
  didDocument.service = (didDocument.service ?? []).filter(service => {
    if (service.type !== LINKED_VP_SERVICE_TYPE || typeof service.serviceEndpoint !== 'string') return true
    if (isServedLinkedVp(service.serviceEndpoint, options)) return true
    removed.push(service.id)
    return false
  })
  return removed
}
