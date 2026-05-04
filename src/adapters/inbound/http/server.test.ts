import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import type { AuthPort } from '../../../core/auth/port'
import type { FeedCandidate } from '../../../core/feed/port'
import type { Gender, UserProfile } from '../../../core/user/types'
import type { MatchEntry } from '../../../core/match/port'
import { UserIdSchema, type UserId } from '../../../core/shared/types'
import type { SwipeResult } from '../../../core/swipe-match/port'
import { JwtAuthAdapter } from '../../outbound/auth/jwt'
import { InMemoryLoggerAdapter } from '../../outbound/logger/inMemory'
import type { GetFeedUseCase, GetFeedInput } from '../../../use-cases/getFeed'
import type { ListMatchesUseCase } from '../../../use-cases/listMatches'
import type { RecordSwipeUseCase } from '../../../use-cases/recordSwipe'
import { createServer, type HttpDeps } from './server'

const userId = (): UserId => UserIdSchema.parse(randomUUID())

const makeProfile = (id: UserId): UserProfile => ({
  id,
  age: 28,
  gender: 'woman' as Gender,
  interestedIn: ['man'] as [Gender],
  ageRange: { min: 25, max: 35 },
  location: { lat: 51.5074, lng: -0.1278 },
})

const makeCandidate = (id: UserId): FeedCandidate => ({
  profile: makeProfile(id),
  distanceKm: 3.2,
})

const realAuth = new JwtAuthAdapter({ secret: 'test-secret' })

function noopAuthFor(id: UserId): AuthPort {
  return {
    issueCredential: async () => 'noop-token',
    verifyCredential: async () => id,
  }
}
const noopHeaders = { authorization: 'Bearer noop-token' }

function makeDeps(principalId: UserId, overrides: Partial<HttpDeps> = {}): HttpDeps {
  return {
    getFeed: {
      execute: async () => [],
    } as unknown as GetFeedUseCase,
    recordSwipe: {
      execute: async (): Promise<SwipeResult> => ({ kind: 'recorded' }),
    } as unknown as RecordSwipeUseCase,
    listMatches: {
      execute: async (): Promise<MatchEntry[]> => [],
    } as unknown as ListMatchesUseCase,
    userRepo: {
      save: async () => undefined,
      load: async (id) => makeProfile(id),
    },
    authPort: noopAuthFor(principalId),
    logger: new InMemoryLoggerAdapter(),
    ...overrides,
  }
}

describe('HTTP server', () => {
  describe('GET /readyz', () => {
    it('returns 200 with each check reported ok when every check resolves', async () => {
      const calls: string[] = []
      const app = createServer(
        makeDeps(userId(), {
          healthChecks: [
            { name: 'postgres', critical: true, check: async () => { calls.push('postgres') } },
            { name: 'cassandra', critical: true, check: async () => { calls.push('cassandra') } },
            { name: 'redis', critical: true, check: async () => { calls.push('redis') } },
          ],
        }),
      )

      const res = await app.inject({ method: 'GET', url: '/readyz' })

      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.status).toBe('ok')
      expect(body.checks).toEqual([
        { name: 'postgres', ok: true, critical: true },
        { name: 'cassandra', ok: true, critical: true },
        { name: 'redis', ok: true, critical: true },
      ])
      expect(calls.sort()).toEqual(['cassandra', 'postgres', 'redis'])
    })

    it('returns 503 when a critical check rejects', async () => {
      const app = createServer(
        makeDeps(userId(), {
          healthChecks: [
            { name: 'postgres', critical: true, check: async () => {} },
            {
              name: 'cassandra',
              critical: true,
              check: async () => { throw new Error('node down') },
            },
          ],
        }),
      )

      const res = await app.inject({ method: 'GET', url: '/readyz' })

      expect(res.statusCode).toBe(503)
      const body = res.json()
      expect(body.status).toBe('down')
      expect(body.checks).toEqual([
        { name: 'postgres', ok: true, critical: true },
        { name: 'cassandra', ok: false, critical: true },
      ])
    })

    it('returns 503 when a critical check exceeds the timeout', async () => {
      const app = createServer(
        makeDeps(userId(), {
          healthCheckTimeoutMs: 30,
          healthChecks: [
            { name: 'postgres', critical: true, check: async () => {} },
            {
              name: 'cassandra',
              critical: true,
              check: () => new Promise<void>((resolve) => setTimeout(resolve, 200)),
            },
          ],
        }),
      )

      const start = Date.now()
      const res = await app.inject({ method: 'GET', url: '/readyz' })
      const elapsed = Date.now() - start

      expect(res.statusCode).toBe(503)
      expect(elapsed).toBeLessThan(150)
      const body = res.json()
      expect(body.checks.find((c: { name: string }) => c.name === 'cassandra')).toMatchObject({
        ok: false,
        critical: true,
      })
    })

    it('returns 200 when only a non-critical check fails', async () => {
      const app = createServer(
        makeDeps(userId(), {
          healthChecks: [
            { name: 'postgres', critical: true, check: async () => {} },
            {
              name: 'kafka',
              critical: false,
              check: async () => { throw new Error('broker unreachable') },
            },
          ],
        }),
      )

      const res = await app.inject({ method: 'GET', url: '/readyz' })

      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.status).toBe('ok')
      expect(body.checks).toEqual([
        { name: 'postgres', ok: true, critical: true },
        { name: 'kafka', ok: false, critical: false },
      ])
    })
  })

  describe('GET /livez', () => {
    it('returns 200 with status ok and performs no dependency calls', async () => {
      let userRepoCalled = false
      let listMatchesCalled = false
      const app = createServer(
        makeDeps(userId(), {
          userRepo: {
            save: async () => { userRepoCalled = true },
            load: async () => { userRepoCalled = true; return null },
          },
          listMatches: {
            execute: async () => { listMatchesCalled = true; return [] },
          } as unknown as ListMatchesUseCase,
        }),
      )

      const res = await app.inject({ method: 'GET', url: '/livez' })

      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual({ status: 'ok' })
      expect(userRepoCalled).toBe(false)
      expect(listMatchesCalled).toBe(false)
    })
  })

  describe('POST /profiles', () => {
    it('creates a profile and returns 201 with id', async () => {
      const id = userId()
      let upserted: UserProfile | undefined
      const app = createServer(
        makeDeps(id, {
          userRepo: {
            save: async (p) => { upserted = p },
            load: async () => null,
          },
        }),
      )

      const res = await app.inject({
        method: 'POST',
        url: '/profiles',
        headers: noopHeaders,
        payload: makeProfile(id),
      })

      expect(res.statusCode).toBe(201)
      expect(res.json()).toEqual({ id })
      expect(upserted?.id).toBe(id)
    })

    it('returns 403 when the body id does not match the principal', async () => {
      const principal = userId()
      const other = userId()
      const app = createServer(makeDeps(principal))

      const res = await app.inject({
        method: 'POST',
        url: '/profiles',
        headers: noopHeaders,
        payload: makeProfile(other),
      })

      expect(res.statusCode).toBe(403)
    })

    it('returns 400 for invalid body', async () => {
      const app = createServer(makeDeps(userId()))
      const res = await app.inject({
        method: 'POST',
        url: '/profiles',
        headers: noopHeaders,
        payload: { age: 'not-a-number' },
      })
      expect(res.statusCode).toBe(400)
    })
  })

  describe('POST /feed', () => {
    it('fetches the viewer profile from the principal and returns candidates', async () => {
      const viewerId = userId()
      const candidateId = userId()
      const candidate = makeCandidate(candidateId)
      let captured: GetFeedInput | undefined
      const app = createServer(
        makeDeps(viewerId, {
          getFeed: {
            execute: async (input: GetFeedInput) => {
              captured = input
              return [candidate]
            },
          } as unknown as GetFeedUseCase,
        }),
      )

      const res = await app.inject({
        method: 'POST',
        url: '/feed',
        headers: noopHeaders,
        payload: {
          center: { lat: 51.5074, lng: -0.1278 },
          radiusKm: 10,
          limit: 20,
        },
      })

      expect(res.statusCode).toBe(200)
      expect(res.json().candidates).toHaveLength(1)
      expect(res.json().candidates[0].profile.id).toBe(candidateId)
      expect(captured?.viewer.id).toBe(viewerId)
    })

    it('returns 404 when the principal has no profile yet', async () => {
      const app = createServer(
        makeDeps(userId(), {
          userRepo: {
            save: async () => undefined,
            load: async () => null,
          },
        }),
      )

      const res = await app.inject({
        method: 'POST',
        url: '/feed',
        headers: noopHeaders,
        payload: { center: { lat: 0, lng: 0 }, radiusKm: 10, limit: 20 },
      })

      expect(res.statusCode).toBe(404)
    })

    it('returns 400 for missing required fields', async () => {
      const app = createServer(makeDeps(userId()))
      const res = await app.inject({
        method: 'POST',
        url: '/feed',
        headers: noopHeaders,
        payload: { radiusKm: 10 },
      })
      expect(res.statusCode).toBe(400)
    })
  })

  describe('POST /swipes', () => {
    it('uses the principal as swiperId, returns recorded when no match', async () => {
      const swiper = userId()
      const target = userId()
      let captured: { swiperId: UserId; targetId: UserId } | undefined
      const app = createServer(
        makeDeps(swiper, {
          recordSwipe: {
            execute: async (s: { swiperId: UserId; targetId: UserId }): Promise<SwipeResult> => {
              captured = s
              return { kind: 'recorded' }
            },
          } as unknown as RecordSwipeUseCase,
        }),
      )

      const res = await app.inject({
        method: 'POST',
        url: '/swipes',
        headers: noopHeaders,
        payload: { targetId: target, decision: 'yes' },
      })

      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual({ kind: 'recorded' })
      expect(captured?.swiperId).toBe(swiper)
      expect(captured?.targetId).toBe(target)
    })

    it('returns matched when both users liked each other', async () => {
      const a = userId()
      const b = userId()
      const matchedAt = new Date('2026-05-01T10:00:00Z')
      const app = createServer(
        makeDeps(a, {
          recordSwipe: {
            execute: async (): Promise<SwipeResult> => ({
              kind: 'matched',
              match: { userAId: a, userBId: b, matchedAt },
            }),
          } as unknown as RecordSwipeUseCase,
        }),
      )

      const res = await app.inject({
        method: 'POST',
        url: '/swipes',
        headers: noopHeaders,
        payload: { targetId: b, decision: 'yes' },
      })

      expect(res.statusCode).toBe(200)
      expect(res.json().kind).toBe('matched')
      expect(res.json().match.userAId).toBe(a)
    })

    it('returns 400 for invalid decision value', async () => {
      const app = createServer(makeDeps(userId()))
      const res = await app.inject({
        method: 'POST',
        url: '/swipes',
        headers: noopHeaders,
        payload: { targetId: userId(), decision: 'maybe' },
      })
      expect(res.statusCode).toBe(400)
    })
  })

  describe('GET /matches', () => {
    it('returns matches for the principal', async () => {
      const viewerId = userId()
      const otherId = userId()
      const matchedAt = new Date('2026-05-01T00:00:00Z')
      let listedFor: UserId | undefined
      const app = createServer(
        makeDeps(viewerId, {
          listMatches: {
            execute: async (id: UserId) => {
              listedFor = id
              return [{ otherUserId: otherId, matchedAt }]
            },
          } as unknown as ListMatchesUseCase,
        }),
      )

      const res = await app.inject({
        method: 'GET',
        url: '/matches',
        headers: noopHeaders,
      })

      expect(res.statusCode).toBe(200)
      expect(res.json().matches).toHaveLength(1)
      expect(res.json().matches[0].otherUserId).toBe(otherId)
      expect(listedFor).toBe(viewerId)
    })
  })

  describe('POST /auth/token', () => {
    it('issues a token for a valid userId', async () => {
      const id = userId()
      const app = createServer(makeDeps(userId(), { authPort: realAuth }))
      const res = await app.inject({
        method: 'POST',
        url: '/auth/token',
        payload: { userId: id },
      })
      expect(res.statusCode).toBe(200)
      expect(typeof res.json().token).toBe('string')
      expect(res.json().token.length).toBeGreaterThan(0)
    })

    it('returns 400 for a non-uuid userId', async () => {
      const app = createServer(makeDeps(userId()))
      const res = await app.inject({
        method: 'POST',
        url: '/auth/token',
        payload: { userId: 'not-a-uuid' },
      })
      expect(res.statusCode).toBe(400)
    })
  })

  describe('auth middleware', () => {
    it('returns 401 on protected routes with no token', async () => {
      const app = createServer(makeDeps(userId(), { authPort: realAuth }))
      const res = await app.inject({ method: 'GET', url: '/matches' })
      expect(res.statusCode).toBe(401)
    })

    it('returns 401 on protected routes with a bad token', async () => {
      const app = createServer(makeDeps(userId(), { authPort: realAuth }))
      const res = await app.inject({
        method: 'GET',
        url: '/matches',
        headers: { authorization: 'Bearer not.a.real.token' },
      })
      expect(res.statusCode).toBe(401)
    })

    it('allows a request with a valid token through and binds the principal', async () => {
      const id = userId()
      const token = await realAuth.issueCredential(id)
      let listedFor: UserId | undefined
      const app = createServer(
        makeDeps(userId(), {
          authPort: realAuth,
          listMatches: {
            execute: async (uid: UserId) => {
              listedFor = uid
              return []
            },
          } as unknown as ListMatchesUseCase,
        }),
      )
      const res = await app.inject({
        method: 'GET',
        url: '/matches',
        headers: { authorization: `Bearer ${token}` },
      })
      expect(res.statusCode).toBe(200)
      expect(listedFor).toBe(id)
    })

    it('GET /livez is public (no token required)', async () => {
      const app = createServer(makeDeps(userId(), { authPort: realAuth }))
      const res = await app.inject({ method: 'GET', url: '/livez' })
      expect(res.statusCode).toBe(200)
    })
  })

  afterAll(async () => {
    // Fastify instances created per-test are not kept open; no teardown needed
  })
})
