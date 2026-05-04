import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { AuthPort } from '../../../domain/auth/port'
import type { MatchEntry } from '../../../domain/match/port'
import { UserIdSchema, type UserId } from '../../../domain/shared/types'
import type { SwipeResult } from '../../../domain/swipe-match/port'
import type { Gender, UserProfile } from '../../../domain/user/types'
import { InMemoryLoggerAdapter } from '../../outbound/logger/inMemory'
import type { GetFeedUseCase } from '../../../use-cases/getFeed'
import type { ListMatchesUseCase } from '../../../use-cases/listMatches'
import type { RecordSwipeUseCase } from '../../../use-cases/recordSwipe'
import { currentLogger } from '../../../infrastructure/observability/requestContext'
import { createServer, type HttpDeps } from './server'

const userId = (): UserId => UserIdSchema.parse(randomUUID())

const profileFor = (id: UserId): UserProfile => ({
  id,
  age: 28,
  gender: 'woman' as Gender,
  interestedIn: ['man'] as [Gender],
  ageRange: { min: 25, max: 35 },
  location: { lat: 51.5074, lng: -0.1278 },
})

const noopAuthFor = (id: UserId): AuthPort => ({
  issueToken: async () => 'noop-token',
  verifyToken: async () => id,
})

function makeDeps(principal: UserId, logger: InMemoryLoggerAdapter, overrides: Partial<HttpDeps> = {}): HttpDeps {
  return {
    getFeed: { execute: async () => [] } as unknown as GetFeedUseCase,
    recordSwipe: {
      execute: async (): Promise<SwipeResult> => ({ kind: 'recorded' }),
    } as unknown as RecordSwipeUseCase,
    listMatches: {
      execute: async (): Promise<MatchEntry[]> => [],
    } as unknown as ListMatchesUseCase,
    userRepo: {
      upsert: async () => undefined,
      findById: async (id) => profileFor(id),
    },
    authPort: noopAuthFor(principal),
    logger,
    ...overrides,
  }
}

describe('HTTP request logger', () => {
  it('emits a request log entry tagged with a generated reqId, method, and url', async () => {
    const logger = new InMemoryLoggerAdapter()
    const app = createServer(makeDeps(userId(), logger))

    const res = await app.inject({ method: 'GET', url: '/livez' })

    expect(res.statusCode).toBe(200)
    const requestLogs = logger.records.filter((r) => r.fields?.['reqId'] !== undefined)
    expect(requestLogs.length).toBeGreaterThan(0)
    const first = requestLogs[0]!
    expect(typeof first.fields?.['reqId']).toBe('string')
    expect(first.fields?.['method']).toBe('GET')
    expect(first.fields?.['url']).toBe('/livez')
  })

  it('exposes the request logger via currentLogger() inside an awaited handler', async () => {
    const logger = new InMemoryLoggerAdapter()
    const app = createServer(makeDeps(userId(), logger))

    app.get('/__test/als', async () => {
      await Promise.resolve()
      currentLogger().info('inside handler', { stage: 'awaited' })
      return { ok: true }
    })

    const res = await app.inject({
      method: 'GET',
      url: '/__test/als',
      headers: { authorization: 'Bearer noop-token' },
    })

    expect(res.statusCode).toBe(200)
    const handlerLog = logger.records.find((r) => r.message === 'inside handler')
    expect(handlerLog).toBeDefined()
    expect(typeof handlerLog?.fields?.['reqId']).toBe('string')
    expect(handlerLog?.fields?.['stage']).toBe('awaited')
    expect(handlerLog?.fields?.['url']).toBe('/__test/als')
  })

})
