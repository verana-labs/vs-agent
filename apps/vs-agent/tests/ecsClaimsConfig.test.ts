import { describe, expect, it, vi } from 'vitest'

// mirrors the check main.ts runs at startup, so a standalone agent cannot boot with a
// Service claim the spec makes required
const REQUIRED = [
  'ECS_CLAIMS_SERVICE_NAME',
  'ECS_CLAIMS_SERVICE_TYPE',
  'ECS_CLAIMS_SERVICE_DESCRIPTION',
  'ECS_CLAIMS_SERVICE_LOGO_URI',
  'ECS_CLAIMS_SERVICE_MINIMUM_AGE_REQUIRED',
  'ECS_CLAIMS_SERVICE_TERMS_AND_CONDITIONS_URI',
  'ECS_CLAIMS_SERVICE_PRIVACY_POLICY_URI',
]

async function loadServiceClaims(env: Record<string, string | undefined>) {
  for (const k of Object.keys(process.env)) if (k.startsWith('ECS_CLAIMS_')) delete process.env[k]
  for (const [k, v] of Object.entries(env)) if (v !== undefined) process.env[k] = v
  vi.resetModules()
  const mod = await import('../src/config/constants')
  return mod.ECS_CLAIMS_SERVICE as Record<string, string | undefined>
}

describe('ECS_CLAIMS_SERVICE', () => {
  it('reads every required variable the spec names', async () => {
    const claims = await loadServiceClaims(Object.fromEntries(REQUIRED.map(v => [v, 'x'])))
    expect(Object.values(claims).filter(Boolean)).toHaveLength(REQUIRED.length)
  })

  it('leaves an unset variable undefined so startup can reject it', async () => {
    const claims = await loadServiceClaims({ ECS_CLAIMS_SERVICE_NAME: 'x' })
    expect(claims.name).toBe('x')
    expect(claims.logoUri).toBeUndefined()
  })

  it('treats a whitespace-only value as unset', async () => {
    const claims = await loadServiceClaims({ ECS_CLAIMS_SERVICE_NAME: '   ' })
    expect(claims.name).toBeUndefined()
  })
})
