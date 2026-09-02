import { createHash } from 'crypto'

import { describe, expect, it, vi } from 'vitest'

import { getEcsSchemas } from '../src/utils/data'
import { getClaims } from '../src/utils/setupSelfTr'
import { EcsClaims } from '../src/utils/ecsClaims'

vi.mock('axios', () => ({
  default: {
    get: vi.fn(async (url: string) => {
      if (url.startsWith('https://unreachable')) throw new Error('ENOTFOUND')
      return { data: Buffer.from(`bytes of ${url}`) }
    }),
  },
}))

const logger = { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() } as never

const ecsClaims: EcsClaims = {
  service: {
    name: 'Test Service',
    type: 'WEB_PORTAL',
    description: 'a test service',
    logoUri: 'https://example.com/logo.svg',
    minimumAgeRequired: '18',
    termsAndConditionsUri: 'https://example.com/terms.html',
    privacyPolicyUri: 'https://example.com/privacy.html',
  },
  org: {
    name: 'Test Org',
    logoUri: 'https://example.com/logo.svg',
    registryId: 'ID-123',
    registryUri: 'https://example.com/registry',
    address: 'Some address',
    countryCode: 'EE',
    organizationKind: 'PUBLIC',
  },
}

const schemas = getEcsSchemas('https://agent.example')
const subject = { id: 'did:web:agent.example' }

describe('ECS claim composition', () => {
  it.each(['ecs-service', 'ecs-org'])('validates against the v4 %s schema', async key => {
    const claims = await getClaims(logger, schemas, subject, key, ecsClaims)
    expect(claims.logoDigestSri).toBe(
      'sha384-' +
        createHash('sha384').update(Buffer.from('bytes of https://example.com/logo.svg')).digest('base64'),
    )
  })

  it('refuses to attest a resource it cannot read', async () => {
    await expect(
      getClaims(logger, schemas, subject, 'ecs-service', {
        ...ecsClaims,
        service: { ...ecsClaims.service, logoUri: 'https://unreachable/logo.png' },
      }),
    ).rejects.toThrow()
  })

  it('omits the claims of a schema the operator configured nothing for', async () => {
    await expect(getClaims(logger, schemas, subject, 'ecs-persona', ecsClaims)).rejects.toThrow(
      /No ECS_CLAIMS_\* variable is set/,
    )
  })
})
