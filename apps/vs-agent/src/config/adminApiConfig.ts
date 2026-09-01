import { parseTrustedNetworks } from '../security/trustedNetworks'

export interface AdminApiConfig {
  authMode: string
  publicUrl?: string
  allowedAccounts: string[]
  trustedNetworks: string[]
}

export function validateAdminApiConfig(config: AdminApiConfig): string[] {
  const errors: string[] = []
  if (!['internal', 'corporation'].includes(config.authMode)) {
    errors.push(`ADMIN_API_AUTH_MODE must be 'internal' or 'corporation' (got '${config.authMode}')`)
  }
  if (config.publicUrl) {
    let isBareHttpsOrigin = false
    try {
      const url = new URL(config.publicUrl)
      isBareHttpsOrigin = url.protocol === 'https:' && url.origin === config.publicUrl
    } catch {
      isBareHttpsOrigin = false
    }
    if (!isBareHttpsOrigin) {
      errors.push(
        'ADMIN_API_PUBLIC_URL must be a single https:// origin (scheme + host + optional port, no trailing path)',
      )
    }
    if (config.authMode !== 'corporation') {
      errors.push('ADMIN_API_PUBLIC_URL must not be set unless ADMIN_API_AUTH_MODE is "corporation"')
    }
  }
  if (config.authMode === 'corporation') {
    if (!config.publicUrl) {
      errors.push('ADMIN_API_PUBLIC_URL is required when ADMIN_API_AUTH_MODE is "corporation"')
    }
    if (config.allowedAccounts.length === 0) {
      errors.push(
        'ADMIN_API_CORPORATION_ALLOWED_ACCOUNTS must be a non-empty list when ADMIN_API_AUTH_MODE is "corporation"',
      )
    }
  }
  for (const block of config.trustedNetworks) {
    try {
      parseTrustedNetworks([block])
    } catch {
      errors.push(`ADMIN_API_TRUSTED_NETWORKS contains an invalid CIDR block: '${block}'`)
    }
  }
  return errors
}
