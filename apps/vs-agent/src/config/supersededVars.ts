// TODO: Remove in 3.0.0, together with this file.

/** The new name of a renamed variable, `null` for a removed one, or the hint to give for a removed one */
type Superseded = string | null | { hint: string }

const SUPERSEDED_VARS: Record<string, Superseded> = {
  ADMIN_LOG_LEVEL: 'ADMIN_API_LOG_LEVEL',
  ADMIN_PORT: 'ADMIN_API_PORT',
  AGENT_PORT: 'PUBLIC_API_PORT',
  // Not a rename: 1.x posted each event to `${EVENTS_BASE_URL}/${type}`, 2.0 posts one envelope to
  // the URL itself, so the old value names a route that no controller serves
  EVENTS_BASE_URL: {
    hint: 'set EVENTS_WEBHOOK_URL to the full URL of the events endpoint of the controller, which receives one envelope per event',
  },
  MASTER_LIST_CSCA_LOCATION: 'MRTD_MASTER_LIST_CSCA_LOCATION',
  ADMIN_API_EXTERNAL_PORT: null,
  AGENT_DIDCOMM_VERSIONS: null,
  AGENT_ENDPOINT: null,
  AGENT_ENDPOINTS: null,
  AGENT_INVITATION_BASE_URL: null,
  AGENT_INVITATION_IMAGE_URL: null,
  AGENT_LABEL: null,
  AGENT_NAME: null,
  AGENT_PUBLIC_DID: null,
  REDIRECT_DEFAULT_URL_TO_INVITATION_URL: null,
  REDIS_HOST: null,
  REDIS_PASSWORD: null,
  UI_VERANA_CHAIN_ID: null,
  UI_VERANA_INDEXER_BASE_URL: null,
  UI_WELCOME_MESSAGE: null,
  USER_PROFILE_AUTODISCLOSE: null,
}

/** Families of 1.x variables that another family replaces, matched on their prefix */
const SUPERSEDED_PREFIXES: Record<string, string> = {
  SELF_ISSUED_VTC_: 'the ECS credential claims are the ECS_CLAIMS_* variables now, see the README',
}

export function applySupersededVars(env: NodeJS.ProcessEnv): string[] {
  const warnings: string[] = []

  for (const [name, replacement] of Object.entries(SUPERSEDED_VARS)) {
    const value = env[name]
    if (!value) continue

    if (!replacement) {
      warnings.push(`${name} is no longer read and has no effect, remove it`)
    } else if (typeof replacement === 'object') {
      warnings.push(`${name} is no longer read and has no effect, remove it; ${replacement.hint}`)
    } else if (env[replacement]) {
      warnings.push(`${name} is now ${replacement}, which is already set, so ${name} is ignored`)
    } else {
      env[replacement] = value
      warnings.push(`${name} is now ${replacement}, the value was carried over`)
    }
  }

  for (const [prefix, hint] of Object.entries(SUPERSEDED_PREFIXES)) {
    for (const name of Object.keys(env).filter(name => name.startsWith(prefix) && env[name])) {
      warnings.push(`${name} is no longer read and has no effect, remove it; ${hint}`)
    }
  }

  if (warnings.length > 0) warnings.push('the names above stop working in 3.0.0')
  return warnings
}
