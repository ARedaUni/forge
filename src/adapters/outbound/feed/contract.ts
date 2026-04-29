import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { FeedPort } from '../../../domain/ports/feed-port'
import {
  UserIdSchema,
  type Location,
  type UserId,
  type UserProfile,
} from '../../../domain/types'

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

function viewer(overrides: Partial<UserProfile> = {}): UserProfile {
  return profile({
    gender: 'man',
    interestedIn: ['woman'],
    ...overrides,
  })
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
        viewer: viewer(),
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
        viewer: viewer(),
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
        viewer: viewer(),
        center: ORIGIN,
        radiusKm: 50,
        limit: 100,
      })

      expect(result.map((c) => c.profile.id)).toEqual([near.id, mid.id, far.id])
    })

    it("excludes profiles whose gender is not in viewer.interestedIn", async () => {
      const wantedGender = profile({
        gender: 'woman',
        interestedIn: ['man'],
        location: { lat: 0.01, lng: 0 },
      })
      const wrongGender = profile({
        gender: 'man',
        interestedIn: ['man'],
        location: { lat: 0.02, lng: 0 },
      })
      await seed([wantedGender, wrongGender])

      const result = await adapter.query({
        viewer: viewer({ interestedIn: ['woman'] }),
        center: ORIGIN,
        radiusKm: 10,
        limit: 100,
      })

      expect(result.map((c) => c.profile.id)).toEqual([wantedGender.id])
    })

    it("excludes profiles whose interestedIn does not include viewer's gender", async () => {
      const interestedInMen = profile({
        gender: 'woman',
        interestedIn: ['man'],
        location: { lat: 0.01, lng: 0 },
      })
      const interestedInWomenOnly = profile({
        gender: 'woman',
        interestedIn: ['woman'],
        location: { lat: 0.02, lng: 0 },
      })
      await seed([interestedInMen, interestedInWomenOnly])

      const result = await adapter.query({
        viewer: viewer(),
        center: ORIGIN,
        radiusKm: 10,
        limit: 100,
      })

      expect(result.map((c) => c.profile.id)).toEqual([interestedInMen.id])
    })

    it("excludes profiles whose age is outside viewer.ageRange", async () => {
      const inRange = profile({ age: 28, location: { lat: 0.01, lng: 0 } })
      const outOfRange = profile({ age: 50, location: { lat: 0.02, lng: 0 } })
      await seed([inRange, outOfRange])

      const result = await adapter.query({
        viewer: viewer({ ageRange: { min: 25, max: 35 } }),
        center: ORIGIN,
        radiusKm: 10,
        limit: 100,
      })

      expect(result.map((c) => c.profile.id)).toEqual([inRange.id])
    })

    it("excludes profiles whose ageRange does not include viewer.age", async () => {
      const accepts50 = profile({
        ageRange: { min: 18, max: 99 },
        location: { lat: 0.01, lng: 0 },
      })
      const rejects50 = profile({
        ageRange: { min: 25, max: 35 },
        location: { lat: 0.02, lng: 0 },
      })
      await seed([accepts50, rejects50])

      const result = await adapter.query({
        viewer: viewer({ age: 50 }),
        center: ORIGIN,
        radiusKm: 10,
        limit: 100,
      })

      expect(result.map((c) => c.profile.id)).toEqual([accepts50.id])
    })

    it('honors the limit parameter', async () => {
      const profiles = [0.01, 0.02, 0.03, 0.04, 0.05].map((lat) =>
        profile({ location: { lat, lng: 0 } }),
      )
      await seed(profiles)

      const result = await adapter.query({
        viewer: viewer(),
        center: ORIGIN,
        radiusKm: 50,
        limit: 2,
      })

      expect(result).toHaveLength(2)
    })

    it('does not return the viewer themselves', async () => {
      const v = viewer({ location: { lat: 0.01, lng: 0 } })
      const compatibleSelf = profile({
        id: v.id,
        gender: v.gender,
        interestedIn: ['man', 'woman'],
        ageRange: v.ageRange,
        age: v.age,
        location: v.location,
      })
      await seed([compatibleSelf])

      const result = await adapter.query({
        viewer: v,
        center: ORIGIN,
        radiusKm: 10,
        limit: 100,
      })

      expect(result).toEqual([])
    })

    it('reports distanceKm with reasonable accuracy', async () => {
      const target = profile({ location: { lat: 0.01, lng: 0 } })
      await seed([target])

      const result = await adapter.query({
        viewer: viewer(),
        center: ORIGIN,
        radiusKm: 10,
        limit: 100,
      })

      expect(result.map((c) => c.profile.id)).toEqual([target.id])
      expect(result.map((c) => c.distanceKm)).toEqual([expect.closeTo(1.111, 1)])
    })
  })
}
