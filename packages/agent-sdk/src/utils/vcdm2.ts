import {
  CREDENTIALS_CONTEXT_V2_URL,
  type JsonObject,
  JsonTransformer,
  W3cV2Credential,
  type W3cV2CredentialOptions,
} from '@credo-ts/core'

/**
 * The W3C context that gives terms no other context defines an IRI under
 * `https://www.w3.org/ns/credentials/undefined-term#`, which is what schema-driven ECS claims are to
 * a JSON-LD consumer: issuer-dependent terms, not examples.
 */
export const CREDENTIALS_UNDEFINED_TERMS_V2_URL = 'https://www.w3.org/ns/credentials/undefined-terms/v2'

/**
 * JSON-LD context of the VC Data Model 2.0 credentials the agent issues: the trust credentials it
 * publishes from its DID Document and the ones it issues over DIDComm with the W3C Data Integrity
 * attachment format (Aries RFC 0809).
 *
 * The undefined-terms context supplies the `@vocab` that lets schema-driven credential subject
 * claims expand when a third party processes the credential as JSON-LD. The `eddsa-jcs-2022`
 * cryptosuite securing these credentials canonicalizes JSON and never expands the context itself.
 */
export const CREDENTIALS_V2_CONTEXT: string[] = [
  CREDENTIALS_CONTEXT_V2_URL,
  CREDENTIALS_UNDEFINED_TERMS_V2_URL,
]

const TEN_YEARS_MS = 10 * 365 * 24 * 60 * 60 * 1000

/**
 * Builds an unsigned VC Data Model 2.0 credential. Unless told otherwise it uses
 * {@link CREDENTIALS_V2_CONTEXT} and is valid from now for ten years.
 */
export function createW3cV2Credential(options: W3cV2CredentialOptions): W3cV2Credential {
  const now = Date.now()
  return new W3cV2Credential({
    ...options,
    context: options.context ?? CREDENTIALS_V2_CONTEXT,
    validFrom: options.validFrom ?? new Date(now).toISOString(),
    validUntil: options.validUntil ?? new Date(now + TEN_YEARS_MS).toISOString(),
  })
}

/** The plain JSON an RFC 0809 credential offer carries the unsigned credential as. */
export function toOfferedCredentialJson(credential: W3cV2Credential): JsonObject {
  return JsonTransformer.toJSON(credential)
}

/** Whether a credential JSON uses the VC Data Model 2.0 base context, as RFC 0809 decides the data model version. */
export function isVcdm2Credential(credential: { '@context'?: unknown }): boolean {
  const context = credential['@context']
  const base = Array.isArray(context) ? context[0] : context
  return base === CREDENTIALS_CONTEXT_V2_URL
}

/**
 * Whether a stored credential is what the agent publishes today: VC Data Model 2.0 secured with
 * Data Integrity proofs. An agent upgraded from a version that published data model 1.1 linked
 * data proofs rebuilds its trust credentials when this is false.
 */
export function isDataIntegrityVcdm2Credential(credential: unknown): boolean {
  if (!credential || typeof credential !== 'object') return false
  const { proof } = credential as { proof?: unknown }
  const proofs = Array.isArray(proof) ? proof : proof ? [proof] : []
  return (
    isVcdm2Credential(credential as { '@context'?: unknown }) &&
    proofs.length > 0 &&
    proofs.every(entry => (entry as { type?: unknown } | null)?.type === 'DataIntegrityProof')
  )
}
