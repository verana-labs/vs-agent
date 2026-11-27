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

  it('carries the events URL of 1.x over to the webhook URL', () => {
    const env: NodeJS.ProcessEnv = { EVENTS_BASE_URL: 'http://backend:5000' }

    const warnings = applySupersededVars(env)

    expect(env.EVENTS_WEBHOOK_URL).toBe('http://backend:5000')
    expect(warnings).toContain('EVENTS_BASE_URL is now EVENTS_WEBHOOK_URL, the value was carried over')
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
