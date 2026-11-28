import { describe, expect, it } from 'vitest'

import { applySupersededVars } from '../src/config/supersededVars'

describe('applySupersededVars', () => {
  it('carries a renamed value over and says so', () => {
    const env = { AGENT_PORT: '4001', MASTER_LIST_CSCA_LOCATION: '/opt/ml.ldif' }

    const warnings = applySupersededVars(env)

    expect(env).toMatchObject({ PUBLIC_API_PORT: '4001', MRTD_MASTER_LIST_CSCA_LOCATION: '/opt/ml.ldif' })
    expect(warnings).toContain('AGENT_PORT is now PUBLIC_API_PORT, the value was carried over')
    expect(warnings).toContain('the names above stop working in 3.0.0')
  })

  it('keeps the new name when both are set', () => {
    const env = { AGENT_PORT: '4001', PUBLIC_API_PORT: '5001' }

    const warnings = applySupersededVars(env)

    expect(env.PUBLIC_API_PORT).toBe('5001')
    expect(warnings).toContain(
      'AGENT_PORT is now PUBLIC_API_PORT, which is already set, so AGENT_PORT is ignored',
    )
  })

  it('warns about a removed variable without inventing a replacement', () => {
    const env = { AGENT_LABEL: 'Old label' }

    expect(applySupersededVars(env)).toContain('AGENT_LABEL is no longer read and has no effect, remove it')
    expect(Object.keys(env)).toEqual(['AGENT_LABEL'])
  })

  it('reports the events URL of 1.x as removed, with the hint to set the webhook URL, and does not copy it', () => {
    const env: NodeJS.ProcessEnv = { EVENTS_BASE_URL: 'http://backend:5000' }

    const warnings = applySupersededVars(env)

    expect(env.EVENTS_WEBHOOK_URL).toBeUndefined()
    expect(warnings).toContain(
      'EVENTS_BASE_URL is no longer read and has no effect, remove it; set EVENTS_WEBHOOK_URL to the full URL of the events endpoint of the controller, which receives one envelope per event',
    )
  })

  it('warns about the self-issued VTC claim variables of 1.x by their prefix', () => {
    const env = {
      SELF_ISSUED_VTC_ORG_COUNTRYCODE: 'EE',
      SELF_ISSUED_VTC_SERVICE_TYPE: 'WEB_PORTAL',
      ECS_CLAIMS_ORG_NAME: 'Acme',
    }

    const warnings = applySupersededVars(env)

    expect(warnings).toContain(
      'SELF_ISSUED_VTC_ORG_COUNTRYCODE is no longer read and has no effect, remove it; the ECS credential claims are the ECS_CLAIMS_* variables now, see the README',
    )
    expect(warnings).toContain(
      'SELF_ISSUED_VTC_SERVICE_TYPE is no longer read and has no effect, remove it; the ECS credential claims are the ECS_CLAIMS_* variables now, see the README',
    )
    expect(warnings.filter(w => w.includes('ECS_CLAIMS_ORG_NAME'))).toEqual([])
  })

  it('warns about every 1.x variable that 2.0 no longer reads', () => {
    const env = {
      REDIS_HOST: 'redis.internal',
      REDIS_PASSWORD: 'secret',
      ADMIN_API_EXTERNAL_PORT: '3010',
      AGENT_DIDCOMM_VERSIONS: 'v1,v2',
      AGENT_PUBLIC_DID: 'did:web:agent.example',
      UI_VERANA_CHAIN_ID: 'vna-testnet-1',
      UI_VERANA_INDEXER_BASE_URL: 'https://idx.example',
    }

    const warnings = applySupersededVars(env)

    for (const name of Object.keys(env)) {
      expect(warnings).toContain(`${name} is no longer read and has no effect, remove it`)
    }
  })

  it('says nothing when no superseded variable is set', () => {
    expect(applySupersededVars({ PUBLIC_API_PORT: '3001' })).toEqual([])
  })
})
