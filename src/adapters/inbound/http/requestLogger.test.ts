import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { AuthPort } from '../../../core/auth/port'
import type { MatchEntry } from '../../../core/match/port'
import { UserIdSchema, type UserId } from '../../../core/shared/types'
import type { SwipeResult } from '../../../core/swipe-match/port'
import type { Gender, UserProfile } from '../../../core/user/types'
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
  gender: 'woman',
  interestedIn: ['man'] as [Gender],
  ageRange: { min: 25, max: 35 },
  location: { lat: 51.5074, lng: -0.1278 },
})

const noopAuthFor = (id: UserId): AuthPort => ({
  issueCredential: async () => 'noop-token',
  verifyCredential: async () => id,
})

function makeDeps(
  principal: UserId,
  logger: InMemoryLoggerAdapter,
  overrides: Partial<HttpDeps> = {},
): HttpDeps {
  return {
    getFeed: { execute: async () => [] } as unknown as GetFeedUseCase,
    recordSwipe: {
      execute: async (): Promise<SwipeResult> => ({ kind: 'recorded' }),
    } as unknown as RecordSwipeUseCase,
    listMatches: {
      execute: async (): Promise<MatchEntry[]> => [],
    } as unknown as ListMatchesUseCase,
    userRepo: {
      save: async () => undefined,
      load: async (id) => profileFor(id),
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

  it('emits a canonical log line on response with method, route, status, durationMs, and reqId', async () => {
    const logger = new InMemoryLoggerAdapter()
    const app = createServer(makeDeps(userId(), logger))

    const res = await app.inject({ method: 'GET', url: '/livez' })

    expect(res.statusCode).toBe(200)
    const canonical = logger.records.find((r) => r.message === 'request completed')
    expect(canonical).toBeDefined()
    expect(canonical?.fields?.['method']).toBe('GET')
    expect(canonical?.fields?.['route']).toBe('/livez')
    expect(canonical?.fields?.['status']).toBe(200)
    expect(typeof canonical?.fields?.['reqId']).toBe('string')
    const durationMs = canonical?.fields?.['durationMs']
    expect(typeof durationMs).toBe('number')
    expect(durationMs as number).toBeGreaterThanOrEqual(0)
  })

  it('stamps domain attrs from the swipe use-case result onto the canonical log line', async () => {
    const logger = new InMemoryLoggerAdapter()
    const principal = userId()
    const target = userId()
    const matchedSwipe: SwipeResult = {
      kind: 'matched',
      match: { userAId: principal, userBId: target, matchedAt: new Date() },
    }
    const app = createServer(
      makeDeps(principal, logger, {
        recordSwipe: {
          execute: async () => matchedSwipe,
        } as unknown as RecordSwipeUseCase,
      }),
    )

    const res = await app.inject({
      method: 'POST',
      url: '/swipes',
      headers: { authorization: 'Bearer noop-token' },
      payload: { targetId: target, decision: 'yes' },
    })

    expect(res.statusCode).toBe(200)
    const canonical = logger.records.find((r) => r.message === 'request completed')
    expect(canonical?.fields?.['route']).toBe('/swipes')
    expect(canonical?.fields?.['swipe.decision']).toBe('yes')
    expect(canonical?.fields?.['swipe.matched']).toBe(true)
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
