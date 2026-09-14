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

  it('says nothing when no superseded variable is set', () => {
    expect(applySupersededVars({ PUBLIC_API_PORT: '3001' })).toEqual([])
  })
})
