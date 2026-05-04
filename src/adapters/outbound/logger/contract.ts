import { describe, expect, it } from 'vitest'
import type { LogLevel, Logger, LogRecord } from '../../../core/observability/logger'

export type LoggerContractSetup = {
  name: string
  setup: () => {
    logger: Logger
    records: () => readonly LogRecord[]
  }
}

export function runLoggerContract(cfg: LoggerContractSetup): void {
  describe(`Logger port contract — ${cfg.name}`, () => {
    it.each<LogLevel>(['debug', 'info', 'warn', 'error'])(
      'records a %s call with message',
      (level) => {
        const { logger, records } = cfg.setup()
        logger[level]('hello')
        expect(records()).toEqual([{ level, message: 'hello', fields: undefined }])
      },
    )

    it('records structured fields alongside the message', () => {
      const { logger, records } = cfg.setup()
      logger.info('user signed in', { userId: 'u-1', route: '/auth/token' })
      expect(records()).toEqual([
        {
          level: 'info',
          message: 'user signed in',
          fields: { userId: 'u-1', route: '/auth/token' },
        },
      ])
    })

    it('child() returns a logger that merges persistent fields into every call', () => {
      const { logger, records } = cfg.setup()
      const child = logger.child({ reqId: 'r-1' })
      child.info('first', { route: '/feed' })
      child.warn('second')
      expect(records()).toEqual([
        { level: 'info', message: 'first', fields: { reqId: 'r-1', route: '/feed' } },
        { level: 'warn', message: 'second', fields: { reqId: 'r-1' } },
      ])
    })
  })
}
