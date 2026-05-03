import type { LogFields, LogRecord, Logger } from '../../../domain/observability/logger'

export class InMemoryLoggerAdapter implements Logger {
  readonly records: LogRecord[]
  private readonly bound: LogFields | undefined

  constructor(sink?: LogRecord[], bound?: LogFields) {
    this.records = sink ?? []
    this.bound = bound
  }

  debug(message: string, fields?: LogFields): void {
    this.write('debug', message, fields)
  }
  info(message: string, fields?: LogFields): void {
    this.write('info', message, fields)
  }
  warn(message: string, fields?: LogFields): void {
    this.write('warn', message, fields)
  }
  error(message: string, fields?: LogFields): void {
    this.write('error', message, fields)
  }

  child(fields: LogFields): Logger {
    const merged: LogFields = { ...(this.bound ?? {}), ...fields }
    return new InMemoryLoggerAdapter(this.records, merged)
  }

  private write(level: LogRecord['level'], message: string, fields: LogFields | undefined): void {
    const merged = this.merge(fields)
    this.records.push({ level, message, fields: merged })
  }

  private merge(fields: LogFields | undefined): LogFields | undefined {
    if (this.bound === undefined && fields === undefined) return undefined
    return { ...(this.bound ?? {}), ...(fields ?? {}) }
  }
}
