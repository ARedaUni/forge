import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import type { FeedCandidate } from '../../../domain/feed/port'
import type { Gender, UserProfile } from '../../../domain/feed/types'
import type { MatchEntry } from '../../../domain/match/port'
import { UserIdSchema, type UserId } from '../../../domain/shared/types'
import type { SwipeResult } from '../../../domain/swipe-match/port'
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
      })

      expect(res.statusCode).toBe(200)
      expect(res.json().matches).toHaveLength(1)
      expect(res.json().matches[0].otherUserId).toBe(otherId)
    })

    it('returns 400 when userId is missing', async () => {
      const app = createServer(makeDeps())
      const res = await app.inject({ method: 'GET', url: '/matches' })
      expect(res.statusCode).toBe(400)
    })
  })

  afterAll(async () => {
    // Fastify instances created per-test are not kept open; no teardown needed
  })
})
