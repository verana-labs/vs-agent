import { LogLevel } from '@credo-ts/core'

const LOG_LEVELS: Record<string, LogLevel> = {
  trace: LogLevel.Trace,
  debug: LogLevel.Debug,
  info: LogLevel.Info,
  warn: LogLevel.Warn,
  error: LogLevel.Error,
  off: LogLevel.Off,
}

export const DEFAULT_AGENT_LOG_LEVEL = 'warn'
export const DEFAULT_ADMIN_API_LOG_LEVEL = 'info'
export const DEFAULT_PUBLIC_API_PORT = 3001
export const DEFAULT_ADMIN_API_PORT = 3000

const MAX_PORT = 65535

export const logLevelName = (value: string | undefined, fallback: string): string =>
  (value ?? '').trim().toLowerCase() || fallback

export const resolveLogLevel = (name: string, fallback: string): LogLevel =>
  LOG_LEVELS[name] ?? LOG_LEVELS[fallback]

export const parseLogLevel = (name: string): LogLevel | undefined => LOG_LEVELS[name]

export const parsePort = (value: string | undefined, fallback: number): number =>
  value?.trim() ? Number(value) : fallback

export interface RuntimeConfig {
  publicApiPort: string | undefined
  adminApiPort: string | undefined
  agentLogLevel: string
  adminApiLogLevel: string
}

function checkPort(variable: string, value: string | undefined, errors: string[]): number | undefined {
  if (!value?.trim()) return undefined
  const port = Number(value)
  if (!Number.isInteger(port) || port < 1 || port > MAX_PORT) {
    errors.push(`${variable} must be a TCP port between 1 and ${MAX_PORT} (got '${value}')`)
    return undefined
  }
  return port
}

function checkLogLevel(variable: string, name: string, errors: string[]): void {
  if (parseLogLevel(name) !== undefined) return
  errors.push(`${variable} must be one of ${Object.keys(LOG_LEVELS).join(', ')} (got '${name}')`)
}

export function validateRuntimeConfig(config: RuntimeConfig): string[] {
  const errors: string[] = []

  checkLogLevel('AGENT_LOG_LEVEL', config.agentLogLevel, errors)
  checkLogLevel('ADMIN_API_LOG_LEVEL', config.adminApiLogLevel, errors)

  const publicApiPort = checkPort('PUBLIC_API_PORT', config.publicApiPort, errors) ?? DEFAULT_PUBLIC_API_PORT
  const adminApiPort = checkPort('ADMIN_API_PORT', config.adminApiPort, errors) ?? DEFAULT_ADMIN_API_PORT
  if (publicApiPort === adminApiPort) {
    errors.push(`ADMIN_API_PORT must differ from PUBLIC_API_PORT (both are ${adminApiPort})`)
  }

  return errors
}
