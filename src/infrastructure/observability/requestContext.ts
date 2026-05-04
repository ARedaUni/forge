import { AsyncLocalStorage } from 'node:async_hooks'
import type { Logger } from '../../core/observability/logger'

const als = new AsyncLocalStorage<Logger>()

export function runWithLogger<T>(logger: Logger, fn: () => T): T {
  return als.run(logger, fn)
}

export function enterLoggerContext(logger: Logger): void {
  als.enterWith(logger)
}

export function currentLogger(): Logger {
  const logger = als.getStore()
  if (!logger) {
    throw new Error('currentLogger() called with no logger context — wrap the call in runWithLogger or enterLoggerContext')
  }
  return logger
}
