import type { Logger } from '@credo-ts/core'

import { createHash } from 'crypto'

import axios from 'axios'

// [VSA-VTI-CFG-ENV-ECS]. Values come from the ECS_CLAIMS_* variables; a claim the operator
// did not set is absent, never an invented default.
export interface EcsClaims {
  // bytes the agent already serves, keyed by URI, so it never fetches its own public URL
  localResources?: Record<string, string>
  org?: Record<string, string | undefined>
  persona?: Record<string, string | undefined>
  service?: Record<string, string | undefined>
}

// the URI claim each derived digest claim is computed from
const DIGEST_OF: Record<string, string> = {
  logoDigestSri: 'logoUri',
  avatarDigestSri: 'avatarUri',
  termsAndConditionsDigestSri: 'termsAndConditionsUri',
  privacyPolicyDigestSri: 'privacyPolicyUri',
}

// [VSA-VTI-CFG-ENV-ECS] variable of each claim the agent reads
export const ECS_CLAIMS_VARIABLES = {
  org: {
    name: 'ECS_CLAIMS_ORG_NAME',
    logoUri: 'ECS_CLAIMS_ORG_LOGO_URI',
    registryId: 'ECS_CLAIMS_ORG_REGISTRY_ID',
    registryUri: 'ECS_CLAIMS_ORG_REGISTRY_URI',
    address: 'ECS_CLAIMS_ORG_ADDRESS',
    countryCode: 'ECS_CLAIMS_ORG_COUNTRY_CODE',
    legalJurisdiction: 'ECS_CLAIMS_ORG_LEGAL_JURISDICTION',
    organizationKind: 'ECS_CLAIMS_ORG_ORGANIZATION_KIND',
    lei: 'ECS_CLAIMS_ORG_LEI',
  },
  persona: {
    name: 'ECS_CLAIMS_PERSONA_NAME',
    description: 'ECS_CLAIMS_PERSONA_DESCRIPTION',
    descriptionFormat: 'ECS_CLAIMS_PERSONA_DESCRIPTION_FORMAT',
    avatarUri: 'ECS_CLAIMS_PERSONA_AVATAR_URI',
    controllerCountryCode: 'ECS_CLAIMS_PERSONA_CONTROLLER_COUNTRY_CODE',
    controllerJurisdiction: 'ECS_CLAIMS_PERSONA_CONTROLLER_JURISDICTION',
  },
  service: {
    name: 'ECS_CLAIMS_SERVICE_NAME',
    type: 'ECS_CLAIMS_SERVICE_TYPE',
    description: 'ECS_CLAIMS_SERVICE_DESCRIPTION',
    descriptionFormat: 'ECS_CLAIMS_SERVICE_DESCRIPTION_FORMAT',
    logoUri: 'ECS_CLAIMS_SERVICE_LOGO_URI',
    minimumAgeRequired: 'ECS_CLAIMS_SERVICE_MINIMUM_AGE_REQUIRED',
    termsAndConditionsUri: 'ECS_CLAIMS_SERVICE_TERMS_AND_CONDITIONS_URI',
    privacyPolicyUri: 'ECS_CLAIMS_SERVICE_PRIVACY_POLICY_URI',
  },
} as const

export function readEcsClaimsFromEnv(): Required<Pick<EcsClaims, 'org' | 'persona' | 'service'>> {
  const read = (variables: Record<string, string>): Record<string, string | undefined> =>
    Object.fromEntries(
      Object.entries(variables).map(([claim, name]) => [claim, process.env[name]?.trim() || undefined]),
    )
  return {
    org: read(ECS_CLAIMS_VARIABLES.org),
    persona: read(ECS_CLAIMS_VARIABLES.persona),
    service: read(ECS_CLAIMS_VARIABLES.service),
  }
}

const DIGEST_TIMEOUT_MS = 5000
const DIGEST_ATTEMPTS = 4
const DIGEST_BASE_DELAY_MS = 500

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

// the spec asks for a retry with an increasing delay, then a descriptive error naming the
// variable and the URI, and a stop
export function digestOf(content: string): string {
  return `sha384-${createHash('sha384').update(content).digest('base64')}`
}

export async function digestOfUri(uri: string, variable: string, logger?: Logger): Promise<string> {
  let lastError: Error | undefined
  for (let attempt = 1; attempt <= DIGEST_ATTEMPTS; attempt++) {
    try {
      const response = await axios.get(uri, { responseType: 'arraybuffer', timeout: DIGEST_TIMEOUT_MS })
      return `sha384-${createHash('sha384').update(Buffer.from(response.data)).digest('base64')}`
    } catch (error) {
      lastError = error as Error
      if (attempt < DIGEST_ATTEMPTS) await sleep(DIGEST_BASE_DELAY_MS * 2 ** (attempt - 1))
    }
  }
  const message = `cannot compute the digest of ${variable} (${uri}): ${lastError?.message}`
  logger?.error(`[ecs-claims] ${message}`)
  throw new Error(message)
}

const GROUP_OF: Record<string, 'org' | 'persona' | 'service'> = {
  'ecs-service': 'service',
  'ecs-persona': 'persona',
  'ecs-org': 'org',
}

const groupOf = (claims: EcsClaims, schemaKey: string) => {
  const group = GROUP_OF[schemaKey]
  return group ? claims[group] : undefined
}

/**
 * Compose the claims of one ECS credential from the configured variables, deriving `id` and
 * every paired `*DigestSri`. Returns undefined when the operator configured no claim, so the
 * caller can omit the `claims` field entirely.
 */
export async function composeEcsClaims(
  claims: EcsClaims,
  schemaKey: string,
  logger?: Logger,
): Promise<Record<string, unknown> | undefined> {
  const configured = groupOf(claims, schemaKey)
  const set = Object.entries(configured ?? {}).filter(([, v]) => v !== undefined && v !== '')
  if (set.length === 0) return undefined

  const composed: Record<string, unknown> = {}
  for (const [claim, value] of set) {
    composed[claim] = claim === 'minimumAgeRequired' ? Number(value) : value
  }
  for (const [digestClaim, uriClaim] of Object.entries(DIGEST_OF)) {
    const uri = composed[uriClaim]
    if (typeof uri !== 'string') continue
    const group = GROUP_OF[schemaKey]
    const variable = (group && (ECS_CLAIMS_VARIABLES[group] as Record<string, string>)[uriClaim]) || uriClaim
    const local = claims.localResources?.[uri]
    composed[digestClaim] = local ? digestOf(local) : await digestOfUri(uri, variable, logger)
  }
  return composed
}
