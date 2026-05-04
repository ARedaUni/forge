import { trace } from '@opentelemetry/api'
import pino, { type Logger as PinoLogger, type LoggerOptions } from 'pino'
import type { LogFields, Logger } from '../../../core/observability/logger'

function traceContextMixin(): LogFields {
  const span = trace.getActiveSpan()
  if (!span) return {}
  const ctx = span.spanContext()
  return { traceId: ctx.traceId, spanId: ctx.spanId }
}

export class PinoLoggerAdapter implements Logger {
  private readonly p: PinoLogger

  constructor(arg: PinoLogger | LoggerOptions = {}) {
    if (
      typeof (arg as PinoLogger).child === 'function' &&
      typeof (arg as PinoLogger).info === 'function'
    ) {
      this.p = arg as PinoLogger
    } else {
      const opts = arg as LoggerOptions
      this.p = pino({
        ...opts,
        mixin: opts.mixin ?? traceContextMixin,
      })
    }
  }

  debug(message: string, fields?: LogFields): void {
    if (fields) this.p.debug(fields, message)
    else this.p.debug(message)
  }
  info(message: string, fields?: LogFields): void {
    if (fields) this.p.info(fields, message)
    else this.p.info(message)
  }
  warn(message: string, fields?: LogFields): void {
    if (fields) this.p.warn(fields, message)
    else this.p.warn(message)
  }
  error(message: string, fields?: LogFields): void {
    if (fields) this.p.error(fields, message)
    else this.p.error(message)
  }

  child(fields: LogFields): Logger {
    return new PinoLoggerAdapter(this.p.child(fields))
  }
}
