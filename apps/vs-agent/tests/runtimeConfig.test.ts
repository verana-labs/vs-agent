import { describe, expect, it } from 'vitest'

import { LOG_LEVEL_NAMES, parseLogLevel, validateRuntimeConfig } from '../src/config/runtimeConfig'

const base = { publicApiPort: 3001, adminApiPort: 3000, agentLogLevel: 'warn', adminApiLogLevel: 'info' }

describe('validateRuntimeConfig', () => {
  it('accepts the defaults', () => {
    expect(validateRuntimeConfig(base)).toEqual([])
  })

  it('accepts every named log level and nothing else', () => {
    for (const name of LOG_LEVEL_NAMES) expect(parseLogLevel(name)).toBeDefined()
    for (const bad of ['4', 'fatal', 'test', 'verbose', '']) expect(parseLogLevel(bad)).toBeUndefined()
  })

  it('names the variable that carries a bad level', () => {
    const errors = validateRuntimeConfig({ ...base, agentLogLevel: '4', adminApiLogLevel: 'verbose' })

    expect(errors).toHaveLength(2)
    expect(errors[0]).toContain('AGENT_LOG_LEVEL')
    expect(errors[0]).toContain("'4'")
    expect(errors[1]).toContain('ADMIN_API_LOG_LEVEL')
  })

  it('rejects equal ports', () => {
    expect(validateRuntimeConfig({ ...base, adminApiPort: 3001 })).toEqual([
      'ADMIN_API_PORT must differ from PUBLIC_API_PORT (both are 3001)',
    ])
  })
})
