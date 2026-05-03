import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import type { AuthPort } from '../../../domain/auth/port'
import type { FeedCandidate } from '../../../domain/feed/port'
import type { Gender, UserProfile } from '../../../domain/user/types'
import type { MatchEntry } from '../../../domain/match/port'
import { UserIdSchema, type UserId } from '../../../domain/shared/types'
import type { SwipeResult } from '../../../domain/swipe-match/port'
import { JwtAuthAdapter } from '../../outbound/auth/jwt'
import { InMemoryLoggerAdapter } from '../../outbound/logger/inMemory'
import type { GetFeedUseCase, GetFeedInput } from '../../../use-cases/getFeed'
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
    issueToken: async () => 'noop-token',
    verifyToken: async () => id,
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
    userRepo: {
      upsert: async () => undefined,
      findById: async (id) => makeProfile(id),
    },
    matchPort: {
      recordMatch: async () => undefined,
      listForUser: async (): Promise<MatchEntry[]> => [],
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
  })

  describe('GET /livez', () => {
    it('returns 200 with status ok and performs no dependency calls', async () => {
      let userRepoCalled = false
      let matchPortCalled = false
      const app = createServer(
        makeDeps(userId(), {
          userRepo: {
            upsert: async () => { userRepoCalled = true },
            findById: async () => { userRepoCalled = true; return null },
          },
          matchPort: {
            recordMatch: async () => { matchPortCalled = true },
            listForUser: async () => { matchPortCalled = true; return [] },
          },
        }),
      )

      const res = await app.inject({ method: 'GET', url: '/livez' })

      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual({ status: 'ok' })
      expect(userRepoCalled).toBe(false)
      expect(matchPortCalled).toBe(false)
    })
  })

  describe('POST /profiles', () => {
    it('creates a profile and returns 201 with id', async () => {
      const id = userId()
      let upserted: UserProfile | undefined
      const app = createServer(
        makeDeps(id, {
          userRepo: {
            upsert: async (p) => { upserted = p },
            findById: async () => null,
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
            upsert: async () => undefined,
            findById: async () => null,
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
          matchPort: {
            recordMatch: async () => undefined,
            listForUser: async (id) => {
              listedFor = id
              return [{ otherUserId: otherId, matchedAt }]
            },
          },
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
      const token = await realAuth.issueToken(id)
      let listedFor: UserId | undefined
      const app = createServer(
        makeDeps(userId(), {
          authPort: realAuth,
          matchPort: {
            recordMatch: async () => undefined,
            listForUser: async (uid) => {
              listedFor = uid
              return []
            },
          },
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
