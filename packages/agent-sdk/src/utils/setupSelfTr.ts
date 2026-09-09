import {
  ClaimFormat,
  DidRecord,
  Logger,
  W3cCredentialSchema,
  W3cCredentialSubject,
  W3cV2Credential,
  W3cV2CredentialOptions,
  W3cV2DataIntegrityVerifiableCredential,
  W3cV2DataIntegrityVerifiablePresentation,
  W3cV2DiSignPresentationOptions,
  W3cV2Presentation,
  W3cV2PresentationOptions,
} from '@credo-ts/core'
import { DEFAULT_DATA_INTEGRITY_CRYPTOSUITE, VtFlowModuleConfig } from '@verana-labs/credo-ts-didcomm-vt-flow'
import { mapToEcosystem } from '@verana-labs/vs-agent-model'
import Ajv, { AnySchemaObject } from 'ajv/dist/2020'
import addFormats from 'ajv-formats'
import { createHash } from 'crypto'

import { VsAgent } from '../agent/VsAgent'
import { composeEcsClaims, EcsClaims } from './ecsClaims'
import { createW3cV2Credential } from './vcdm2'

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

/**
 * Builds an unsigned self trust registry credential: a VC Data Model 2.0 credential, as
 * [VT-CRED-W3C] and [VT-JSON-SCHEMA-CRED-W3C] require the `https://www.w3.org/ns/credentials/v2`
 * context, valid from now for ten years unless told otherwise.
 */
export function createCredential(options: Partial<W3cV2CredentialOptions>): W3cV2Credential {
  return createW3cV2Credential(options as W3cV2CredentialOptions)
}

/**
 * The Data Integrity cryptosuite this agent is configured with, read from the registered
 * `VtFlowModuleConfig` so the self trust registry secures its credentials and linked VPs with the
 * same suite `VtFlowApi.issueCredentialForSession` applies to the credentials it issues. Falls back
 * to the module default when the vt-flow module is not registered on the agent.
 */
export function getDataIntegrityCryptosuite(agent: Pick<VsAgent, 'context'>): string {
  const { dependencyManager } = agent.context
  return dependencyManager.isRegistered(VtFlowModuleConfig)
    ? dependencyManager.resolve(VtFlowModuleConfig).dataIntegrityCryptosuite
    : DEFAULT_DATA_INTEGRITY_CRYPTOSUITE
}

/**
 * Secures a W3C credential or presentation with a Data Integrity proof under the cryptosuite the
 * agent is configured with, using the provided verification method.
 *
 * A credential is secured for `assertionMethod` and a presentation for `authentication`, the proof
 * purposes VC Data Integrity defines for each; the presentation is published from the DID Document
 * rather than presented to a verifier, so it carries no challenge.
 *
 * @param agent - The agent instance.
 * @param obj - The credential or presentation object to be signed.
 * @param verificationMethod - The DID verification method used to generate the proof.
 * @returns The secured credential or presentation, wrapping the JSON that gets published.
 */
export async function signerW3c(
  agent: VsAgent,
  obj: W3cV2Credential,
  verificationMethod: string,
): Promise<W3cV2DataIntegrityVerifiableCredential>

export async function signerW3c(
  agent: VsAgent,
  obj: W3cV2Presentation,
  verificationMethod: string,
): Promise<W3cV2DataIntegrityVerifiablePresentation>

export async function signerW3c(
  agent: VsAgent,
  obj: W3cV2Credential | W3cV2Presentation,
  verificationMethod: string,
) {
  const cryptosuite = getDataIntegrityCryptosuite(agent)

  if (obj instanceof W3cV2Credential) {
    return await agent.w3cV2Credentials.signCredential<ClaimFormat.DiVc>({
      format: ClaimFormat.DiVc,
      credential: obj,
      cryptosuite,
      verificationMethod,
    })
  }

  // The options type requires a challenge for every presentation format, while a Data Integrity
  // proof only carries one when it is given
  return await agent.w3cV2Credentials.signPresentation<ClaimFormat.DiVp>({
    format: ClaimFormat.DiVp,
    presentation: obj,
    cryptosuite,
    verificationMethod,
  } as W3cV2DiSignPresentationOptions)
}

/** Builds an unsigned VC Data Model 2.0 presentation; the class supplies the v2 context. */
export function createPresentation(options: Partial<W3cV2PresentationOptions>): W3cV2Presentation {
  return new W3cV2Presentation({ type: ['VerifiablePresentation'], ...options })
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
      throw new Error('Cannot find a suitable Ed25519 verification method in DID Document')
    }
    return verificationMethod.id
  } catch (error) {
    logger.error(`Failed to get verification method ID.`, error)
    throw error
  }
}
