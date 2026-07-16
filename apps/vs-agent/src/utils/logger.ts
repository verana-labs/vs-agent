/* eslint-disable @typescript-eslint/no-explicit-any */

import { LogLevel, BaseLogger } from '@credo-ts/core'
import { ConsoleLogger, type LogLevel as NestLogLevel } from '@nestjs/common'
import util from 'util'

/**
 * Maps a credo {@link LogLevel} threshold to the array of Nest log levels to enable.
 *
 * Nest treats the array as a threshold (the highest-priority entry enables itself and
 * everything more severe), so a single-element array is enough. Used both to configure
 * each {@link TsLogger}'s own {@link ConsoleLogger} and Nest's global level (for the plain
 * `@nestjs/common` `Logger` instances).
 */
export function toNestLogLevels(level: LogLevel): NestLogLevel[] {
  switch (level) {
    case LogLevel.Test:
    case LogLevel.Trace:
    case LogLevel.Debug:
      return ['verbose'] // enables verbose, debug, log, warn, error, fatal
    case LogLevel.Info:
      return ['log'] // enables log, warn, error, fatal
    case LogLevel.Warn:
      return ['warn'] // enables warn, error, fatal
    case LogLevel.Error:
      return ['error'] // enables error, fatal
    case LogLevel.Fatal:
      return ['fatal']
    case LogLevel.Off:
    default:
      return []
  }
}

export class TsLogger extends BaseLogger {
  private logger: ConsoleLogger

  // Map our log levels to tslog levels
  private tsLogLevelMap = {
    [LogLevel.Test]: 'debug',
    [LogLevel.Trace]: 'debug',
    [LogLevel.Debug]: 'debug',
    [LogLevel.Info]: 'log',
    [LogLevel.Warn]: 'warn',
    [LogLevel.Error]: 'error',
    [LogLevel.Fatal]: 'fatal',
  } as const

  public constructor(logLevel: LogLevel, name: string) {
    super(logLevel)

    // Use a dedicated ConsoleLogger instance (not the shared @nestjs/common Logger) so this
    // logger's level is fully independent of Nest's global log level and of any other
    // TsLogger. This is what keeps AGENT_LOG_LEVEL (credo agent) and ADMIN_LOG_LEVEL
    // (rest of the app) from influencing each other.
    this.logger = new ConsoleLogger(name, { logLevels: toNestLogLevels(logLevel) })
  }

  private log(level: Exclude<LogLevel, LogLevel.Off>, message: string, data?: Record<string, any>): void {
    // Gate by the configured level. credo delegates level filtering to the logger
    // implementation (see its ConsoleLogger), so without this check the configured level
    // would have no effect. Doing it here also avoids the util.inspect cost when disabled.
    if (!this.isEnabled(level)) return

    const tsLogLevel = this.tsLogLevelMap[level]

    if (data) {
      this.logger[tsLogLevel](message, util.inspect(data, { showHidden: false, depth: 3 }))
    } else {
      this.logger[tsLogLevel](message)
    }
  }

  public test(message: string, data?: Record<string, any>): void {
    this.log(LogLevel.Test, message, data)
  }

  public trace(message: string, data?: Record<string, any>): void {
    this.log(LogLevel.Trace, message, data)
  }

  public debug(message: string, data?: Record<string, any>): void {
    this.log(LogLevel.Debug, message, data)
  }

  public info(message: string, data?: Record<string, any>): void {
    this.log(LogLevel.Info, message, data)
  }

  public warn(message: string, data?: Record<string, any>): void {
    this.log(LogLevel.Warn, message, data)
  }

  public error(message: string, data?: Record<string, any>): void {
    this.log(LogLevel.Error, message, data)
  }

  public fatal(message: string, data?: Record<string, any>): void {
    this.log(LogLevel.Fatal, message, data)
  }
}
