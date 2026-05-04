import { describe, expect, it } from 'vitest'
import { InMemoryLoggerAdapter } from '../../adapters/outbound/logger/inMemory'
import { currentLogger, runWithLogger } from './requestContext'

describe('requestContext (AsyncLocalStorage bridge)', () => {
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
})
