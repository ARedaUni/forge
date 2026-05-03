import { describe, expect, it } from 'vitest'
import { InMemoryLoggerAdapter } from '../../adapters/outbound/logger/inMemory'
import { currentLogger, enterLoggerContext, runWithLogger } from './requestContext'

describe('requestContext (AsyncLocalStorage bridge)', () => {
  it('currentLogger() returns the logger passed to runWithLogger', () => {
    const logger = new InMemoryLoggerAdapter()
    const seen = runWithLogger(logger, () => currentLogger())
    expect(seen).toBe(logger)
  })

  it('currentLogger() remains correct across awaits', async () => {
    const logger = new InMemoryLoggerAdapter()
    const seen = await runWithLogger(logger, async () => {
      await Promise.resolve()
      await new Promise((r) => setTimeout(r, 0))
      return currentLogger()
    })
    expect(seen).toBe(logger)
  })

  it('isolates loggers between concurrent async contexts', async () => {
    const a = new InMemoryLoggerAdapter()
    const b = new InMemoryLoggerAdapter()
    const [r1, r2] = await Promise.all([
      runWithLogger(a, async () => {
        await new Promise((r) => setTimeout(r, 5))
        return currentLogger()
      }),
      runWithLogger(b, async () => {
        await new Promise((r) => setTimeout(r, 1))
        return currentLogger()
      }),
    ])
    expect(r1).toBe(a)
    expect(r2).toBe(b)
  })

  it('enterLoggerContext binds the logger for the rest of the current async chain', async () => {
    const logger = new InMemoryLoggerAdapter()
    const seen = await (async () => {
      enterLoggerContext(logger)
      await Promise.resolve()
      return currentLogger()
    })()
    expect(seen).toBe(logger)
  })

  it('throws when currentLogger() is called outside any context', () => {
    expect(() => currentLogger()).toThrow(/no logger context/i)
  })
})
