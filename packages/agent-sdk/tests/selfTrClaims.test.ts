import { describe, expect, it, vi } from 'vitest'

import { getEcsSchemas } from '../src/utils/data'
import { getClaims, SelfTrDefaults } from '../src/utils/setupSelfTr'

vi.mock('axios', () => ({
  default: {
    get: vi.fn(async (url: string) => {
      if (url.startsWith('https://unreachable')) throw new Error('ENOTFOUND')
      return { data: Buffer.from(`bytes of ${url}`) }
    }),
  },
}))

const logger = { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() } as never

const defaults: SelfTrDefaults = {
  agentLabel: 'Agent',
  serviceLogoUri: 'https://cdn.example/logo.png',
  serviceType: 'ECommerce',
  serviceDescription: 'demo',
  serviceMinimumAgeRequired: 18,
  serviceTermsAndConditions: 'https://cdn.example/terms',
  servicePrivacyPolicy: 'https://cdn.example/privacy',
  orgRegistryId: 'REG-1',
  orgRegistryUri: 'https://registry.example',
  orgAddress: '1 Demo Street',
  orgOrganizationKind: 'PUBLIC',
  orgCountryCode: 'US',
}

const schemas = getEcsSchemas('https://agent.example')
const subject = { id: 'did:web:agent.example' }

describe('self-TR default claims', () => {
  it.each(['ecs-service', 'ecs-org'])('validates against the v4 %s schema', async key => {
    const claims = await getClaims(logger, schemas, subject, key, defaults)
    expect(claims.logoDigestSri).toBe(
      'sha384-' +
        require('crypto')
          .createHash('sha384')
          .update(Buffer.from('bytes of https://cdn.example/logo.png'))
          .digest('base64'),
    )
  })

  it('refuses to attest a resource it cannot read', async () => {
    await expect(
      getClaims(logger, schemas, subject, 'ecs-service', {
        ...defaults,
        serviceLogoUri: 'https://unreachable/logo.png',
      }),
    ).rejects.toThrow()
  })
})
