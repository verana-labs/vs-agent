import { describe, expect, it } from 'vitest'

import { logLevelName, parseLogLevel, validateRuntimeConfig } from '../src/config/runtimeConfig'

const base = {
  publicApiPort: '3001',
  adminApiPort: '3000',
  agentLogLevel: 'warn',
  adminApiLogLevel: 'info',
}

describe('validateRuntimeConfig', () => {
  it('accepts the defaults, set or unset', () => {
    expect(validateRuntimeConfig(base)).toEqual([])
    expect(validateRuntimeConfig({ ...base, publicApiPort: undefined, adminApiPort: '' })).toEqual([])
  })

  it('accepts every named log level and nothing else', () => {
    for (const name of ['trace', 'debug', 'info', 'warn', 'error', 'off']) {
      expect(parseLogLevel(name)).toBeDefined()
    }
    for (const bad of ['4', 'fatal', 'test', 'verbose', '']) expect(parseLogLevel(bad)).toBeUndefined()
  })

  it('falls back to the default when the variable is unset or empty', () => {
    expect(logLevelName(undefined, 'warn')).toBe('warn')
    expect(logLevelName('', 'warn')).toBe('warn')
    expect(logLevelName(' DEBUG ', 'warn')).toBe('debug')
  })

  it('names the variable that carries a bad level', () => {
    const errors = validateRuntimeConfig({ ...base, agentLogLevel: '4', adminApiLogLevel: 'verbose' })

    expect(errors).toHaveLength(2)
    expect(errors[0]).toContain('AGENT_LOG_LEVEL')
    expect(errors[0]).toContain("'4'")
    expect(errors[1]).toContain('ADMIN_API_LOG_LEVEL')
  })

  it('rejects a port that is not a TCP port, naming the variable', () => {
    expect(validateRuntimeConfig({ ...base, publicApiPort: '30o1' })).toEqual([
      "PUBLIC_API_PORT must be a TCP port between 1 and 65535 (got '30o1')",
    ])
    expect(validateRuntimeConfig({ ...base, adminApiPort: '70000' })).toEqual([
      "ADMIN_API_PORT must be a TCP port between 1 and 65535 (got '70000')",
    ])
    expect(validateRuntimeConfig({ ...base, adminApiPort: '0' })).toEqual([
      "ADMIN_API_PORT must be a TCP port between 1 and 65535 (got '0')",
    ])
  })

  it('rejects equal ports', () => {
    expect(validateRuntimeConfig({ ...base, adminApiPort: '3001' })).toEqual([
      'ADMIN_API_PORT must differ from PUBLIC_API_PORT (both are 3001)',
    ])
  })
})
