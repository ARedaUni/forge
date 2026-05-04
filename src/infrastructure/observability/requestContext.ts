import { AsyncLocalStorage } from 'node:async_hooks'
import type { Logger } from '../../core/observability/logger'

export type RequestAttrs = Record<string, unknown>

type RequestStore = {
  logger: Logger
  attrs: RequestAttrs
}

const als = new AsyncLocalStorage<RequestStore>()

export function runWithLogger<T>(logger: Logger, fn: () => T): T {
  return als.run({ logger, attrs: {} }, fn)
}

export function enterLoggerContext(logger: Logger): void {
  als.enterWith({ logger, attrs: {} })
}

export function currentLogger(): Logger {
  const store = als.getStore()
  if (!store) {
    throw new Error(
      'currentLogger() called with no logger context — wrap the call in runWithLogger or enterLoggerContext',
    )
  }
  return store.logger
}

export function enrichRequest(attrs: RequestAttrs): void {
  const store = als.getStore()
  if (!store) return
  Object.assign(store.attrs, attrs)
}

export function currentRequestAttrs(): RequestAttrs {
  return als.getStore()?.attrs ?? {}
}
