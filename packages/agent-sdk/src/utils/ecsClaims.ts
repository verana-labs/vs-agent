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

// the ECS_CLAIMS_* variable a claim came from, for the error the spec asks us to log
const VARIABLE_OF: Record<string, Record<string, string>> = {
  'ecs-org': { logoUri: 'ECS_CLAIMS_ORG_LOGO_URI' },
  'ecs-persona': { avatarUri: 'ECS_CLAIMS_PERSONA_AVATAR_URI' },
  'ecs-service': {
    logoUri: 'ECS_CLAIMS_SERVICE_LOGO_URI',
    termsAndConditionsUri: 'ECS_CLAIMS_SERVICE_TERMS_AND_CONDITIONS_URI',
    privacyPolicyUri: 'ECS_CLAIMS_SERVICE_PRIVACY_POLICY_URI',
  },
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

const GROUP_OF: Record<string, keyof EcsClaims> = {
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
  subjectDid: string,
  logger?: Logger,
): Promise<Record<string, unknown> | undefined> {
  const configured = groupOf(claims, schemaKey)
  const set = Object.entries(configured ?? {}).filter(([, v]) => v !== undefined && v !== '')
  if (set.length === 0) return undefined

  const composed: Record<string, unknown> = { id: subjectDid }
  for (const [claim, value] of set) {
    composed[claim] = claim === 'minimumAgeRequired' ? Number(value) : value
  }
  for (const [digestClaim, uriClaim] of Object.entries(DIGEST_OF)) {
    const uri = composed[uriClaim]
    if (typeof uri !== 'string') continue
    const variable = VARIABLE_OF[schemaKey]?.[uriClaim] ?? uriClaim
    const local = claims.localResources?.[uri]
    composed[digestClaim] = local ? digestOf(local) : await digestOfUri(uri, variable, logger)
  }
  return composed
}
