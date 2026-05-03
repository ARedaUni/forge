import { describe, expect, it } from 'vitest'
import type { LogLevel, Logger, LogRecord } from '../../../domain/observability/logger'

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
        expect(records()).toEqual([
          { level, message: 'hello', fields: undefined },
        ])
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

    it('preserves call order across levels', () => {
      const { logger, records } = cfg.setup()
      logger.debug('a')
      logger.warn('b')
      logger.error('c')
      expect(records().map((r) => r.level)).toEqual(['debug', 'warn', 'error'])
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

    it('child() does not affect the parent logger', () => {
      const { logger, records } = cfg.setup()
      logger.child({ reqId: 'r-1' })
      logger.info('parent call')
      expect(records()).toEqual([
        { level: 'info', message: 'parent call', fields: undefined },
      ])
    })

    it('per-call fields override child fields on key collision', () => {
      const { logger, records } = cfg.setup()
      const child = logger.child({ route: '/old' })
      child.info('overridden', { route: '/new' })
      expect(records()).toEqual([
        { level: 'info', message: 'overridden', fields: { route: '/new' } },
      ])
    })
  })
}
