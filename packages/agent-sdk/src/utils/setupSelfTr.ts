import {
  W3cCredential,
  W3cPresentation,
  W3cCredentialSchema,
  ClaimFormat,
  W3cCredentialSubject,
  W3cJsonLdVerifiableCredential,
  W3cJsonLdVerifiablePresentation,
  W3cCredentialOptions,
  DidRecord,
  W3cPresentationOptions,
  Logger,
} from '@credo-ts/core'
// No type definitions available for this library
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
//@ts-expect-error
import { purposes } from '@digitalcredentials/jsonld-signatures'
import { mapToEcosystem } from '@verana-labs/vs-agent-model'
import Ajv, { AnySchemaObject } from 'ajv/dist/2020'
import addFormats from 'ajv-formats'
import { createHash } from 'crypto'

import { VsAgent } from '../agent/VsAgent'
import { composeEcsClaims, EcsClaims } from './ecsClaims'

const ajv = new Ajv({ strict: false, allErrors: true })
addFormats(ajv)

export const createJsonSchema: W3cCredentialSchema = {
  id: 'https://www.w3.org/ns/credentials/json-schema/v2.json',
  type: 'JsonSchema',
}

export const createJsonSubjectRef = (id: string): W3cCredentialSubject => ({
  id,
  claims: {
    type: 'JsonSchema',
    jsonSchema: {
      $ref: id,
    },
  },
})

// fragment format per [VT-CRED-W3C-LINKED-VP]
export const linkedVpFragment = (schemaKey: string): string =>
  `vpr-schemas-${schemaKey.replace(/^ecs-/, '')}-vtc-vp`

// A plain array replacer only allowlists property names, applied at every
// nesting level — nested objects like `claims` and `credentialSchema` would
// serialize to `{}` since none of their own keys appear in a top-level
// key list. Sort keys recursively instead, so the hash actually reflects
// nested content and changes to claims invalidate the cache correctly.
export const sortKeysDeep = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sortKeysDeep)
  if (value !== null && typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = sortKeysDeep((value as Record<string, unknown>)[key])
        return acc
      }, {})
  }
  return value
}
export function createCredential(options: Partial<W3cCredentialOptions>) {
  options.context ??= [
    'https://www.w3.org/2018/credentials/v1',
    'https://www.w3.org/ns/credentials/examples/v2',
  ]

  options.issuanceDate ??= new Date().toISOString()
  options.expirationDate ??= new Date(Date.now() + 10 * 365 * 24 * 60 * 60 * 1000).toISOString()

  return new W3cCredential(options as W3cCredentialOptions)
}

/**
 * Signs a W3C Verifiable Credential or Presentation using the provided agent and verification method.
 *
 * The function determines whether the input object is a `W3cCredential` or a `W3cPresentation`,
 * and applies the appropriate signing operation using Linked Data Proofs (`Ed25519Signature2020`).
 *
 * @param agent - The agent instance.
 * @param obj - The credential or presentation object to be signed.
 * @param verificationMethod - The DID verification method used to generate the proof.
 * @returns A signed W3C Verifiable Credential or Presentation in JSON-LD format.
 */
export async function signerW3c(
  agent: VsAgent,
  obj: W3cCredential,
  verificationMethod: string,
): Promise<W3cJsonLdVerifiableCredential>

export async function signerW3c(
  agent: VsAgent,
  obj: W3cPresentation,
  verificationMethod: string,
): Promise<W3cJsonLdVerifiablePresentation>

export async function signerW3c(
  agent: VsAgent,
  obj: W3cCredential | W3cPresentation,
  verificationMethod: string,
) {
  const proofPurpose = new purposes.AssertionProofPurpose()

  if (obj instanceof W3cCredential) {
    return await agent.w3cCredentials.signCredential({
      format: ClaimFormat.LdpVc,
      credential: obj,
      proofType: 'Ed25519Signature2020',
      verificationMethod,
      proofPurpose,
    })
  }

  if (obj instanceof W3cPresentation) {
    return await agent.w3cCredentials.signPresentation({
      format: ClaimFormat.LdpVp,
      presentation: obj,
      proofType: 'Ed25519Signature2020',
      verificationMethod,
      proofPurpose,
    })
  }
}
export function createPresentation(options: Partial<W3cPresentationOptions>) {
  options.context ??= [
    'https://www.w3.org/2018/credentials/v1',
    'https://www.w3.org/ns/credentials/examples/v2',
  ]
  options.type ??= ['VerifiablePresentation']
  return new W3cPresentation(options as W3cPresentationOptions)
}

/**
 * Retrieves and validates claims for a credential subject.
 * If claims are not found, builds default claims based on the schemaKey.
 * Validates claims against the ECS schema for the given schemaKey.
 *
 * @param ecsSchemas - Map of ECS schemas for validation.
 * @param subject - Credential subject, including ID.
 * @param schemaKey - Unique identifier for the credential type.
 * @returns The validated claims object.
 * @throws If claims are invalid or schema is missing.
 */
export async function getClaims(
  logger: Logger,
  ecsSchemas: Record<string, string>,
  { id }: W3cCredentialSubject,
  schemaKey: string,
  ecsClaims: EcsClaims,
) {
  const claims = await composeEcsClaims(ecsClaims, schemaKey, logger)
  if (!claims) throw new Error(`No ECS_CLAIMS_* variable is set for ${schemaKey}`)

  const ecsSchema = ecsSchemas[schemaKey]
  if (!ecsSchema) {
    throw new Error(`Schema not defined in data schemas for schemaKey: ${schemaKey}`)
  }

  validateSchema(JSON.parse(ecsSchema), { id, ...claims })

  return claims
}

/**
 * Validate a validateSchema object against the corresponding AJV schema.
 * Throws an Error if the schema is missing or validation fails.
 */
export function validateSchema(ecsSchema: AnySchemaObject, credentialSubject: Record<string, any>): void {
  const validate = ajv.compile(ecsSchema.properties?.credentialSubject)
  const isValid = validate(credentialSubject)

  if (!isValid) {
    const errorDetails = validate.errors?.map(e => ({
      message: e.message,
      path: e.instancePath,
      keyword: e.keyword,
      params: e.params,
    }))

    throw new Error(`Invalid claims for ${ecsSchema.$id}: ${JSON.stringify(errorDetails, null, 2)}`)
  }
}

async function fetchSchemaContent(id: string): Promise<{ content?: string; error?: string }> {
  try {
    const response = await fetch(mapToEcosystem(id))
    if (!response.ok) return { error: `${response.status} ${response.statusText}` }
    return { content: await response.text() }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Adds a Subresource Integrity (SRI) digest to the provided data using the schema content
 * fetched from the provided URL or from a local schema map as fallback.
 *
 * @template T - The type of the data object.
 * @param id - The URL of the schema to fetch.
 * @param data - The object to which the digest will be added.
 * @param ecsSchemas - Optional map of local schemas to use as fallback if the fetch fails.
 * @returns A new object combining the original data and a `digestSRI` property.
 * @throws Error if both the fetch and local fallback fail.
 */
export async function addDigestSRI<T extends object>(
  id?: string,
  data?: T,
  ecsSchemas?: Record<string, string>,
): Promise<T & { digestSRI: string }> {
  if (!id || !data) {
    throw new Error(`id and data has requiered`)
  }
  const fetched = await fetchSchemaContent(id)
  const key = id.split('/').pop()
  const fallbackSchema = key && ecsSchemas?.[key]

  const schemaContent = fetched.content ?? fallbackSchema

  if (!schemaContent) {
    throw new Error(`Failed to fetch schema from ${id}: ${fetched.error}, and no local fallback found.`)
  }
  assertValidSchema(schemaContent, id)

  return {
    ...data,
    digestSRI: generateDigestSRI(schemaContent),
  }
}

function assertValidSchema(schemaContent: string, id: string): void {
  try {
    if (!ajv.validateSchema(JSON.parse(schemaContent))) {
      const reason = ajv.errors?.map(e => e.message).join(', ') ?? 'Invalid schema structure'

      throw new Error(reason)
    }
  } catch (error) {
    const message =
      error instanceof SyntaxError
        ? 'Invalid JSON format'
        : error instanceof Error
          ? error.message
          : 'Unknown error'

    throw new Error(`Schema from ${id} is not valid: ${message}`)
  }
}

/**
 * Generates a SRI digest string for the given content using the specified algorithm.
 * @param content - The content to hash.
 * @param algorithm - The hash algorithm to use (default: sha256).
 * @returns The SRI digest string.
 */
export function generateDigestSRI(content: string, algorithm: string = 'sha384'): string {
  const hash = createHash(algorithm).update(content).digest('base64')
  return `${algorithm}-${hash}`
}

export function getVerificationMethodId(logger: Logger, didRecord: DidRecord): string {
  try {
    const verificationMethod = didRecord.didDocument?.verificationMethod?.find(
      method =>
        (method.type === 'Ed25519VerificationKey2020' || method.type === 'Ed25519VerificationKey2018') &&
        method.id === didRecord.didDocument?.assertionMethod?.[0],
    )
    if (!verificationMethod) {
      throw new Error('Cannot find a suitable Ed25519Signature2020 verification method in DID Document')
    }
    return verificationMethod.id
  } catch (error) {
    logger.error(`Failed to get verification method ID.`, error)
    throw error
  }
}
