import { createHash } from 'crypto'
import { describe, expect, it, vi } from 'vitest'
import { composeEcsClaims } from '../src/utils/ecsClaims'

vi.mock('axios', () => ({
  default: {
    get: vi.fn(async (url: string) => {
      if (url.includes('bad')) throw new Error('ENOTFOUND')
      return { data: Buffer.from(`bytes of ${url}`) }
    }),
  },
}))
const DID = 'did:web:agent.example'
const log = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } as never
const sri = (u: string) =>
  'sha384-' +
  createHash('sha384')
    .update(Buffer.from(`bytes of ${u}`))
    .digest('base64')

describe('composeEcsClaims', () => {
  it('derives id and every paired digest, and coerces minimumAgeRequired', async () => {
    const c = await composeEcsClaims(
      {
        service: {
          name: 'S',
          type: 'WEB_PORTAL',
          description: 'd',
          logoUri: 'https://x/logo.svg',
          minimumAgeRequired: '18',
          termsAndConditionsUri: 'https://x/t.html',
          privacyPolicyUri: 'https://x/p.html',
        },
      },
      'ecs-service',
      log,
    )
    expect(c!.minimumAgeRequired).toBe(18)
    expect(c!.logoDigestSri).toBe(sri('https://x/logo.svg'))
    expect(c!.termsAndConditionsDigestSri).toBe(sri('https://x/t.html'))
    expect(c!.privacyPolicyDigestSri).toBe(sri('https://x/p.html'))
  })

  it('derives avatarDigestSri for a persona', async () => {
    const c = await composeEcsClaims(
      { persona: { name: 'P', avatarUri: 'https://x/a.png' } },
      'ecs-persona',
      log,
    )
    expect(c!.avatarDigestSri).toBe(sri('https://x/a.png'))
  })

  it('returns undefined when nothing is configured, so claims is omitted', async () => {
    expect(await composeEcsClaims({}, 'ecs-service', log)).toBeUndefined()
    expect(await composeEcsClaims({ service: {} }, 'ecs-service', log)).toBeUndefined()
  })

  it('names the variable and the uri when it cannot read the resource', async () => {
    await expect(
      composeEcsClaims({ service: { name: 'S', logoUri: 'https://bad/logo.svg' } }, 'ecs-service', log),
    ).rejects.toThrow(/ECS_CLAIMS_SERVICE_LOGO_URI.*https:\/\/bad\/logo\.svg/)
  })
})
