import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import type { AuthPort } from '../../../domain/auth/port'
import type { FeedCandidate } from '../../../domain/feed/port'
import type { Gender, UserProfile } from '../../../domain/feed/types'
import type { MatchEntry } from '../../../domain/match/port'
import { UserIdSchema, type UserId } from '../../../domain/shared/types'
import type { SwipeResult } from '../../../domain/swipe-match/port'
import { JwtAuthAdapter } from '../../outbound/auth/jwt'
import type { GetFeedUseCase } from '../../../use-cases/getFeed'
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

const NOOP_TOKEN = 'test-token'
const noopAuth: AuthPort = {
  issueToken: async (id) => `${NOOP_TOKEN}-${id}`,
  verifyToken: async () => UserIdSchema.parse(randomUUID()),
}
const noopHeaders = { authorization: `Bearer ${NOOP_TOKEN}` }

function makeDeps(overrides: Partial<HttpDeps> = {}): HttpDeps {
  return {
    getFeed: {
      execute: async () => [],
    } as unknown as GetFeedUseCase,
    recordSwipe: {
      execute: async (): Promise<SwipeResult> => ({ kind: 'recorded' }),
    } as unknown as RecordSwipeUseCase,
    userRepo: {
      upsert: async () => undefined,
    },
    matchPort: {
      recordMatch: async () => undefined,
      listForUser: async (): Promise<MatchEntry[]> => [],
    },
    authPort: noopAuth,
    ...overrides,
  }
}

describe('HTTP server', () => {
  describe('GET /health', () => {
    it('returns ok', async () => {
      const app = createServer(makeDeps())
      const res = await app.inject({ method: 'GET', url: '/health' })
      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual({ status: 'ok' })
    })
  })

  describe('POST /profiles', () => {
    it('creates a profile and returns 201 with id', async () => {
      const id = userId()
      let upserted: UserProfile | undefined
      const app = createServer(
        makeDeps({
          userRepo: { upsert: async (p) => { upserted = p } },
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

    it('returns 400 for invalid body', async () => {
      const app = createServer(makeDeps())
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
    it('returns candidates from the use case', async () => {
      const viewerId = userId()
      const candidateId = userId()
      const candidate = makeCandidate(candidateId)
      const app = createServer(
        makeDeps({
          getFeed: {
            execute: async () => [candidate],
          } as unknown as GetFeedUseCase,
        }),
      )

      const res = await app.inject({
        method: 'POST',
        url: '/feed',
        headers: noopHeaders,
        payload: {
          viewer: makeProfile(viewerId),
          center: { lat: 51.5074, lng: -0.1278 },
          radiusKm: 10,
          limit: 20,
        },
      })

      expect(res.statusCode).toBe(200)
      expect(res.json().candidates).toHaveLength(1)
      expect(res.json().candidates[0].profile.id).toBe(candidateId)
    })

    it('returns 400 for missing required fields', async () => {
      const app = createServer(makeDeps())
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
    it('returns recorded when no match', async () => {
      const app = createServer(makeDeps())
      const res = await app.inject({
        method: 'POST',
        url: '/swipes',
        headers: noopHeaders,
        payload: {
          swiperId: userId(),
          targetId: userId(),
          decision: 'yes',
        },
      })
      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual({ kind: 'recorded' })
    })

    it('returns matched when both users liked each other', async () => {
      const a = userId()
      const b = userId()
      const matchedAt = new Date('2026-05-01T10:00:00Z')
      const app = createServer(
        makeDeps({
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
        payload: { swiperId: a, targetId: b, decision: 'yes' },
      })

      expect(res.statusCode).toBe(200)
      expect(res.json().kind).toBe('matched')
      expect(res.json().match.userAId).toBe(a)
    })

    it('returns 400 for invalid decision value', async () => {
      const app = createServer(makeDeps())
      const res = await app.inject({
        method: 'POST',
        url: '/swipes',
        headers: noopHeaders,
        payload: { swiperId: userId(), targetId: userId(), decision: 'maybe' },
      })
      expect(res.statusCode).toBe(400)
    })
  })

  describe('GET /matches', () => {
    it('returns matches for a user', async () => {
      const viewerId = userId()
      const otherId = userId()
      const matchedAt = new Date('2026-05-01T00:00:00Z')
      const app = createServer(
        makeDeps({
          matchPort: {
            recordMatch: async () => undefined,
            listForUser: async () => [{ otherUserId: otherId, matchedAt }],
          },
        }),
      )

      const res = await app.inject({
        method: 'GET',
        url: `/matches?userId=${viewerId}`,
        headers: noopHeaders,
      })

      expect(res.statusCode).toBe(200)
      expect(res.json().matches).toHaveLength(1)
      expect(res.json().matches[0].otherUserId).toBe(otherId)
    })

    it('returns 400 when userId is missing', async () => {
      const app = createServer(makeDeps())
      const res = await app.inject({ method: 'GET', url: '/matches', headers: noopHeaders })
      expect(res.statusCode).toBe(400)
    })
  })

  describe('POST /auth/token', () => {
    it('issues a token for a valid userId', async () => {
      const id = userId()
      const app = createServer(makeDeps({ authPort: realAuth }))
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
      const app = createServer(makeDeps())
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
      const app = createServer(makeDeps({ authPort: realAuth }))
      const res = await app.inject({ method: 'GET', url: '/matches?userId=' + userId() })
      expect(res.statusCode).toBe(401)
    })

    it('returns 401 on protected routes with a bad token', async () => {
      const app = createServer(makeDeps({ authPort: realAuth }))
      const res = await app.inject({
        method: 'GET',
        url: '/matches?userId=' + userId(),
        headers: { authorization: 'Bearer not.a.real.token' },
      })
      expect(res.statusCode).toBe(401)
    })

    it('allows a request with a valid token through', async () => {
      const id = userId()
      const token = await realAuth.issueToken(id)
      const app = createServer(makeDeps({ authPort: realAuth }))
      const res = await app.inject({
        method: 'GET',
        url: `/matches?userId=${id}`,
        headers: { authorization: `Bearer ${token}` },
      })
      expect(res.statusCode).toBe(200)
    })

    it('GET /health is public (no token required)', async () => {
      const app = createServer(makeDeps({ authPort: realAuth }))
      const res = await app.inject({ method: 'GET', url: '/health' })
      expect(res.statusCode).toBe(200)
    })
  })

  afterAll(async () => {
    // Fastify instances created per-test are not kept open; no teardown needed
  })
})
