import { AsyncLocalStorage } from 'node:async_hooks'
import { trace } from '@opentelemetry/api'
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
  if (store) Object.assign(store.attrs, attrs)
  const span = trace.getActiveSpan()
  if (!span) return
  for (const [key, value] of Object.entries(attrs)) {
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      span.setAttribute(key, value)
    }
  }
}

export function currentRequestAttrs(): RequestAttrs {
  return als.getStore()?.attrs ?? {}
}
