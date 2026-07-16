/* eslint-disable @typescript-eslint/no-explicit-any */

import { LogLevel, BaseLogger } from '@credo-ts/core'
import { ConsoleLogger, type LogLevel as NestLogLevel } from '@nestjs/common'
import util from 'util'

// Maps a credo LogLevel to the Nest log levels to enable (Nest treats the array as a threshold).
export function toNestLogLevels(level: LogLevel): NestLogLevel[] {
  switch (level) {
    case LogLevel.Test:
    case LogLevel.Trace:
    case LogLevel.Debug:
      return ['verbose']
    case LogLevel.Info:
      return ['log']
    case LogLevel.Warn:
      return ['warn']
    case LogLevel.Error:
      return ['error']
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

    // Dedicated ConsoleLogger so this level is independent of Nest's global logger.
    this.logger = new ConsoleLogger(name, { logLevels: toNestLogLevels(logLevel) })
  }

  private log(level: Exclude<LogLevel, LogLevel.Off>, message: string, data?: Record<string, any>): void {
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
