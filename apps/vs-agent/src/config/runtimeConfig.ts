import { LogLevel } from '@credo-ts/core'

export const LOG_LEVEL_NAMES = ['trace', 'debug', 'info', 'warn', 'error', 'off'] as const
export type LogLevelName = (typeof LOG_LEVEL_NAMES)[number]

const LOG_LEVELS: Record<LogLevelName, LogLevel> = {
  trace: LogLevel.Trace,
  debug: LogLevel.Debug,
  info: LogLevel.Info,
  warn: LogLevel.Warn,
  error: LogLevel.Error,
  off: LogLevel.Off,
}

export function parseLogLevel(name: string): LogLevel | undefined {
  return (LOG_LEVEL_NAMES as readonly string[]).includes(name) ? LOG_LEVELS[name as LogLevelName] : undefined
}

export interface RuntimeConfig {
  publicApiPort: number
  adminApiPort: number
  agentLogLevel: string
  adminApiLogLevel: string
}

export function validateRuntimeConfig(config: RuntimeConfig): string[] {
  const errors: string[] = []
  const levels = LOG_LEVEL_NAMES.join(', ')
  if (parseLogLevel(config.agentLogLevel) === undefined) {
    errors.push(`AGENT_LOG_LEVEL must be one of ${levels} (got '${config.agentLogLevel}')`)
  }
  if (parseLogLevel(config.adminApiLogLevel) === undefined) {
    errors.push(`ADMIN_API_LOG_LEVEL must be one of ${levels} (got '${config.adminApiLogLevel}')`)
  }
  if (config.publicApiPort === config.adminApiPort) {
    errors.push(`ADMIN_API_PORT must differ from PUBLIC_API_PORT (both are ${config.adminApiPort})`)
  }
  return errors
}
