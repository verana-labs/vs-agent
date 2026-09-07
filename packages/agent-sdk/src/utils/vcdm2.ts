import {
  CREDENTIALS_CONTEXT_V2_URL,
  type JsonObject,
  JsonTransformer,
  W3cV2Credential,
  type W3cV2CredentialOptions,
} from '@credo-ts/core'

/**
 * JSON-LD context of the VC Data Model 2.0 credentials the agent issues over DIDComm with the W3C
 * Data Integrity attachment format (Aries RFC 0809).
 *
 * The examples context supplies the `@vocab` that lets schema-driven credential subject claims
 * expand when a verifier processes the credential as JSON-LD. The `eddsa-jcs-2022` cryptosuite
 * securing these credentials canonicalizes JSON and never expands the context itself.
 */
export const CREDENTIALS_V2_CONTEXT: string[] = [
  CREDENTIALS_CONTEXT_V2_URL,
  'https://www.w3.org/ns/credentials/examples/v2',
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
