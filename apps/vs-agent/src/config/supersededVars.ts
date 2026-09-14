// TODO: Remove in 3.0.0, together with this file.
const SUPERSEDED_VARS: Record<string, string | null> = {
  ADMIN_LOG_LEVEL: 'ADMIN_API_LOG_LEVEL',
  ADMIN_PORT: 'ADMIN_API_PORT',
  AGENT_PORT: 'PUBLIC_API_PORT',
  MASTER_LIST_CSCA_LOCATION: 'MRTD_MASTER_LIST_CSCA_LOCATION',
  AGENT_ENDPOINT: null,
  AGENT_ENDPOINTS: null,
  AGENT_INVITATION_BASE_URL: null,
  AGENT_INVITATION_IMAGE_URL: null,
  AGENT_LABEL: null,
  AGENT_NAME: null,
  REDIRECT_DEFAULT_URL_TO_INVITATION_URL: null,
  UI_WELCOME_MESSAGE: null,
  USER_PROFILE_AUTODISCLOSE: null,
}

export function applySupersededVars(env: NodeJS.ProcessEnv): string[] {
  const warnings: string[] = []

  for (const [name, replacement] of Object.entries(SUPERSEDED_VARS)) {
    const value = env[name]
    if (!value) continue

    if (!replacement) {
      warnings.push(`${name} is no longer read and has no effect, remove it`)
    } else if (env[replacement]) {
      warnings.push(`${name} is now ${replacement}, which is already set, so ${name} is ignored`)
    } else {
      env[replacement] = value
      warnings.push(`${name} is now ${replacement}, the value was carried over`)
    }
  }

  if (warnings.length > 0) warnings.push('the names above stop working in 3.0.0')
  return warnings
}
