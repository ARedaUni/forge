import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { FeedPort } from '../../../domain/feed/port'
import type { Location, UserProfile } from '../../../domain/user/types'
import { UserIdSchema, type UserId } from '../../../domain/shared/types'

const userId = (): UserId => UserIdSchema.parse(randomUUID())

const ORIGIN: Location = { lat: 0, lng: 0 }

function profile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    id: userId(),
    age: 30,
    gender: 'woman',
    interestedIn: ['man'],
    ageRange: { min: 18, max: 99 },
    location: ORIGIN,
    ...overrides,
  }
}

export type FeedContractSetup = {
  name: string
  setup: () => Promise<{
    adapter: FeedPort
    seed: (profiles: UserProfile[]) => Promise<void>
    truncate: () => Promise<void>
    teardown: () => Promise<void>
  }>
}

export function runFeedContract(cfg: FeedContractSetup): void {
  describe(`FeedPort contract — ${cfg.name}`, () => {
    let adapter: FeedPort
    let seed: (profiles: UserProfile[]) => Promise<void>
    let truncate: () => Promise<void>
    let teardown: () => Promise<void>

    beforeAll(async () => {
      const ctx = await cfg.setup()
      adapter = ctx.adapter
      seed = ctx.seed
      truncate = ctx.truncate
      teardown = ctx.teardown
    })

    beforeEach(async () => {
      await truncate()
    })

    afterAll(async () => {
      await teardown()
    })

    it('returns no candidates when none exist', async () => {
      const result = await adapter.query({
        center: ORIGIN,
        radiusKm: 10,
        limit: 100,
      })
      expect(result).toEqual([])
    })

    it('excludes profiles outside the radius', async () => {
      const near = profile({ location: { lat: 0.01, lng: 0 } })
      const far = profile({ location: { lat: 0.1, lng: 0 } })
      await seed([near, far])

      const result = await adapter.query({
        center: ORIGIN,
        radiusKm: 5,
        limit: 100,
      })

      expect(result.map((c) => c.profile.id)).toEqual([near.id])
    })

    it('orders candidates by distance ascending', async () => {
      const near = profile({ location: { lat: 0.01, lng: 0 } })
      const mid = profile({ location: { lat: 0.05, lng: 0 } })
      const far = profile({ location: { lat: 0.09, lng: 0 } })
      await seed([far, near, mid])

      const result = await adapter.query({
        center: ORIGIN,
        radiusKm: 50,
        limit: 100,
      })

      expect(result.map((c) => c.profile.id)).toEqual([near.id, mid.id, far.id])
    })

    it('honors the limit parameter', async () => {
      const profiles = [0.01, 0.02, 0.03, 0.04, 0.05].map((lat) =>
        profile({ location: { lat, lng: 0 } }),
      )
      await seed(profiles)

      const result = await adapter.query({
        center: ORIGIN,
        radiusKm: 50,
        limit: 2,
      })

      expect(result).toHaveLength(2)
    })

    it('reports distanceKm with reasonable accuracy', async () => {
      const target = profile({ location: { lat: 0.01, lng: 0 } })
      await seed([target])

      const result = await adapter.query({
        center: ORIGIN,
        radiusKm: 10,
        limit: 100,
      })

      expect(result.map((c) => c.profile.id)).toEqual([target.id])
      expect(result.map((c) => c.distanceKm)).toEqual([expect.closeTo(1.111, 1)])
    })
  })
}
