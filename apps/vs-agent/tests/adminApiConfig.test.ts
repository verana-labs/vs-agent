import { describe, expect, it } from 'vitest'

import { validateAdminApiConfig } from '../src/config/adminApiConfig'
import { DEFAULT_ADMIN_API_TRUSTED_NETWORKS } from '../src/security/trustedNetworks'

const base = {
  authMode: 'internal',
  publicUrl: undefined,
  allowedAccounts: [],
  trustedNetworks: DEFAULT_ADMIN_API_TRUSTED_NETWORKS,
}

describe('validateAdminApiConfig', () => {
  it('accepts the internal defaults', () => {
    expect(validateAdminApiConfig(base)).toEqual([])
  })

  it('accepts a complete corporation configuration', () => {
    expect(
      validateAdminApiConfig({
        ...base,
        authMode: 'corporation',
        publicUrl: 'https://admin.example.io',
        allowedAccounts: ['verana1abc'],
      }),
    ).toEqual([])
  })

  it('rejects a comma-separated mode list', () => {
    const errors = validateAdminApiConfig({ ...base, authMode: 'internal,corporation' })
    expect(errors).toEqual([expect.stringContaining('ADMIN_API_AUTH_MODE')])
  })

  it('rejects corporation mode with an empty allowlist', () => {
    const errors = validateAdminApiConfig({
      ...base,
      authMode: 'corporation',
      publicUrl: 'https://admin.example.io',
    })
    expect(errors).toEqual([expect.stringContaining('ADMIN_API_CORPORATION_ALLOWED_ACCOUNTS')])
  })

  it('rejects corporation mode without a public url', () => {
    const errors = validateAdminApiConfig({
      ...base,
      authMode: 'corporation',
      allowedAccounts: ['verana1abc'],
    })
    expect(errors).toEqual([expect.stringContaining('ADMIN_API_PUBLIC_URL is required')])
  })

  it('rejects a public url outside corporation mode', () => {
    const errors = validateAdminApiConfig({ ...base, publicUrl: 'https://admin.example.io' })
    expect(errors).toEqual([expect.stringContaining('must not be set')])
  })

  it('rejects a malformed trusted network block', () => {
    const errors = validateAdminApiConfig({ ...base, trustedNetworks: ['10.0.0.0/8', 'nonsense'] })
    expect(errors).toEqual([expect.stringContaining("invalid CIDR block: 'nonsense'")])
  })
})
