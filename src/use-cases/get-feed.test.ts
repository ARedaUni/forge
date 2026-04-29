import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { FeedCandidate, FeedPort, FeedQuery } from '../domain/feed/feed-port'
import type { Location, UserProfile } from '../domain/feed/types'
import type { SeenFilterPort } from '../domain/seen-filter/seen-filter-port'
import { UserIdSchema, type UserId } from '../domain/shared/types'
import { GetFeedUseCase } from './get-feed'

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

class InMemorySeenFilter implements SeenFilterPort {
  private readonly seen = new Map<UserId, Set<UserId>>()
  public containsCallCount = 0

  async add(userId: UserId, candidateId: UserId): Promise<void> {
    let set = this.seen.get(userId)
    if (set === undefined) {
      set = new Set()
      this.seen.set(userId, set)
    }
    set.add(candidateId)
  }

  async contains(userId: UserId, candidateIds: UserId[]): Promise<Set<UserId>> {
    this.containsCallCount += 1
    const userSeen = this.seen.get(userId) ?? new Set()
    const result = new Set<UserId>()
    for (const id of candidateIds) {
      if (userSeen.has(id)) result.add(id)
    }
    return result
  }
}

describe('GetFeedUseCase', () => {
  it('returns all candidates when none are seen', async () => {
    const v = viewer()
    const c1 = candidate(1)
    const c2 = candidate(2)
    const useCase = new GetFeedUseCase(new InMemoryFeedPort([c1, c2]), new InMemorySeenFilter())

    const result = await useCase.execute({
      viewer: v,
      center: ORIGIN,
      radiusKm: 50,
      limit: 10,
    })

    expect(result.map((c) => c.profile.id)).toEqual([c1.profile.id, c2.profile.id])
  })

  it('filters out candidates the viewer has already seen', async () => {
    const v = viewer()
    const c1 = candidate(1)
    const c2 = candidate(2)
    const c3 = candidate(3)
    const seenFilter = new InMemorySeenFilter()
    await seenFilter.add(v.id, c2.profile.id)
    const useCase = new GetFeedUseCase(new InMemoryFeedPort([c1, c2, c3]), seenFilter)

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
      new InMemorySeenFilter(),
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
    const useCase = new GetFeedUseCase(new InMemoryFeedPort([]), new InMemorySeenFilter())

    const result = await useCase.execute({
      viewer: v,
      center: ORIGIN,
      radiusKm: 50,
      limit: 10,
    })

    expect(result).toEqual([])
  })

  it('does not call SeenFilterPort when FeedPort returned nothing', async () => {
    const v = viewer()
    const seenFilter = new InMemorySeenFilter()
    const useCase = new GetFeedUseCase(new InMemoryFeedPort([]), seenFilter)

    await useCase.execute({
      viewer: v,
      center: ORIGIN,
      radiusKm: 50,
      limit: 10,
    })

    expect(seenFilter.containsCallCount).toBe(0)
  })

  it('forwards the FeedQuery built from input to FeedPort', async () => {
    const v = viewer()
    const feedPort = new InMemoryFeedPort([])
    const useCase = new GetFeedUseCase(feedPort, new InMemorySeenFilter())

    await useCase.execute({
      viewer: v,
      center: { lat: 1, lng: 2 },
      radiusKm: 25,
      limit: 50,
    })

    expect(feedPort.lastQuery).toEqual({
      viewer: v,
      center: { lat: 1, lng: 2 },
      radiusKm: 25,
      limit: 50,
    })
  })
})
