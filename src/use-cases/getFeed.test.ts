import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { InMemoryFeedExclusionAdapter } from '../adapters/outbound/feed-exclusion/inMemory'
import type { FeedCandidate, FeedPort, FeedQuery } from '../domain/feed/port'
import type { Location, UserProfile } from '../domain/user/types'
import { UserIdSchema, type UserId } from '../domain/shared/types'
import { GetFeedUseCase } from './getFeed'

const userId = (): UserId => UserIdSchema.parse(randomUUID())
const ORIGIN: Location = { lat: 0, lng: 0 }

function viewer(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    id: userId(),
    age: 30,
    gender: 'man',
    interestedIn: ['woman'],
    ageRange: { min: 18, max: 99 },
    location: ORIGIN,
    ...overrides,
  }
}

function candidate(distanceKm: number, profileOverrides: Partial<UserProfile> = {}): FeedCandidate {
  return {
    profile: {
      id: userId(),
      age: 28,
      gender: 'woman',
      interestedIn: ['man'],
      ageRange: { min: 18, max: 99 },
      location: ORIGIN,
      ...profileOverrides,
    },
    distanceKm,
  }
}

class InMemoryFeedPort implements FeedPort {
  public lastQuery?: FeedQuery
  constructor(private readonly candidates: FeedCandidate[]) {}
  async query(q: FeedQuery): Promise<FeedCandidate[]> {
    this.lastQuery = q
    return this.candidates.slice(0, q.limit)
  }
}

class CountingFeedExclusion extends InMemoryFeedExclusionAdapter {
  public excludeSeenCallCount = 0
  override async excludeSeen(viewer: UserId, candidates: UserId[]): Promise<UserId[]> {
    this.excludeSeenCallCount += 1
    return super.excludeSeen(viewer, candidates)
  }
}

describe('GetFeedUseCase', () => {
  it('returns all compatible candidates when none have been shown', async () => {
    const v = viewer()
    const c1 = candidate(1)
    const c2 = candidate(2)
    const useCase = new GetFeedUseCase(new InMemoryFeedPort([c1, c2]), new CountingFeedExclusion())

    const result = await useCase.execute({
      viewer: v,
      center: ORIGIN,
      radiusKm: 50,
      limit: 10,
    })

    expect(result.map((c) => c.profile.id)).toEqual([c1.profile.id, c2.profile.id])
  })

  it('filters out candidates the viewer has already been shown', async () => {
    const v = viewer()
    const c1 = candidate(1)
    const c2 = candidate(2)
    const c3 = candidate(3)
    const feedExclusion = new CountingFeedExclusion()
    await feedExclusion.markShown(v.id, c2.profile.id)
    const useCase = new GetFeedUseCase(new InMemoryFeedPort([c1, c2, c3]), feedExclusion)

    const result = await useCase.execute({
      viewer: v,
      center: ORIGIN,
      radiusKm: 50,
      limit: 10,
    })

    expect(result.map((c) => c.profile.id)).toEqual([c1.profile.id, c3.profile.id])
  })

  it('preserves FeedPort ordering (does not re-sort)', async () => {
    const v = viewer()
    const farFirst = candidate(9)
    const nearLast = candidate(1)
    const useCase = new GetFeedUseCase(
      new InMemoryFeedPort([farFirst, nearLast]),
      new CountingFeedExclusion(),
    )

    const result = await useCase.execute({
      viewer: v,
      center: ORIGIN,
      radiusKm: 50,
      limit: 10,
    })

    expect(result.map((c) => c.distanceKm)).toEqual([9, 1])
  })

  it('returns empty when FeedPort returns no candidates', async () => {
    const v = viewer()
    const useCase = new GetFeedUseCase(new InMemoryFeedPort([]), new CountingFeedExclusion())

    const result = await useCase.execute({
      viewer: v,
      center: ORIGIN,
      radiusKm: 50,
      limit: 10,
    })

    expect(result).toEqual([])
  })

  it('does not call FeedExclusionPort when FeedPort returned nothing', async () => {
    const v = viewer()
    const feedExclusion = new CountingFeedExclusion()
    const useCase = new GetFeedUseCase(new InMemoryFeedPort([]), feedExclusion)

    await useCase.execute({
      viewer: v,
      center: ORIGIN,
      radiusKm: 50,
      limit: 10,
    })

    expect(feedExclusion.excludeSeenCallCount).toBe(0)
  })

  it('does not call FeedExclusionPort when no candidate is compatible', async () => {
    const v = viewer({ gender: 'man', interestedIn: ['woman'] })
    const incompatible = candidate(1, { gender: 'man', interestedIn: ['man'] })
    const feedExclusion = new CountingFeedExclusion()
    const useCase = new GetFeedUseCase(new InMemoryFeedPort([incompatible]), feedExclusion)

    const result = await useCase.execute({
      viewer: v,
      center: ORIGIN,
      radiusKm: 50,
      limit: 10,
    })

    expect(result).toEqual([])
    expect(feedExclusion.excludeSeenCallCount).toBe(0)
  })

  it("drops the viewer themselves when FeedPort returns them", async () => {
    const v = viewer()
    const selfCandidate: FeedCandidate = {
      profile: { ...v },
      distanceKm: 0,
    }
    const other = candidate(1)
    const useCase = new GetFeedUseCase(
      new InMemoryFeedPort([selfCandidate, other]),
      new CountingFeedExclusion(),
    )

    const result = await useCase.execute({
      viewer: v,
      center: ORIGIN,
      radiusKm: 50,
      limit: 10,
    })

    expect(result.map((c) => c.profile.id)).toEqual([other.profile.id])
  })

  it("drops candidates whose gender is not in viewer's interestedIn", async () => {
    const v = viewer({ gender: 'man', interestedIn: ['woman'] })
    const wantedGender = candidate(1, { gender: 'woman', interestedIn: ['man'] })
    const wrongGender = candidate(2, { gender: 'man', interestedIn: ['man'] })
    const useCase = new GetFeedUseCase(
      new InMemoryFeedPort([wantedGender, wrongGender]),
      new CountingFeedExclusion(),
    )

    const result = await useCase.execute({
      viewer: v,
      center: ORIGIN,
      radiusKm: 50,
      limit: 10,
    })

    expect(result.map((c) => c.profile.id)).toEqual([wantedGender.profile.id])
  })

  it("drops candidates whose age is outside viewer's ageRange", async () => {
    const v = viewer({ ageRange: { min: 25, max: 35 } })
    const inRange = candidate(1, { age: 28 })
    const outOfRange = candidate(2, { age: 50 })
    const useCase = new GetFeedUseCase(
      new InMemoryFeedPort([inRange, outOfRange]),
      new CountingFeedExclusion(),
    )

    const result = await useCase.execute({
      viewer: v,
      center: ORIGIN,
      radiusKm: 50,
      limit: 10,
    })

    expect(result.map((c) => c.profile.id)).toEqual([inRange.profile.id])
  })

  it('caps the result at the requested limit even when many candidates pass', async () => {
    const v = viewer()
    const candidates = Array.from({ length: 10 }, (_, i) => candidate(i + 1))
    const useCase = new GetFeedUseCase(
      new InMemoryFeedPort(candidates),
      new CountingFeedExclusion(),
    )

    const result = await useCase.execute({
      viewer: v,
      center: ORIGIN,
      radiusKm: 50,
      limit: 3,
    })

    expect(result).toHaveLength(3)
    expect(result.map((c) => c.distanceKm)).toEqual([1, 2, 3])
  })

  it('over-fetches from FeedPort to compensate for post-fetch filtering', async () => {
    const v = viewer()
    const feedPort = new InMemoryFeedPort([])
    const useCase = new GetFeedUseCase(feedPort, new CountingFeedExclusion())

    await useCase.execute({
      viewer: v,
      center: { lat: 1, lng: 2 },
      radiusKm: 25,
      limit: 50,
    })

    expect(feedPort.lastQuery?.center).toEqual({ lat: 1, lng: 2 })
    expect(feedPort.lastQuery?.radiusKm).toBe(25)
    expect(feedPort.lastQuery?.limit).toBeGreaterThan(50)
  })
})
