import { matchesFilters } from '../domain/feed/feedRule'
import type { FeedCandidate, FeedPort } from '../domain/feed/port'
import type { FeedExclusionPort } from '../domain/feed-exclusion/port'
import type { Location, UserProfile } from '../domain/user/types'

export type GetFeedInput = {
  viewer: UserProfile
  center: Location
  radiusKm: number
  limit: number
}

const OVER_FETCH_FACTOR = 3

export class GetFeedUseCase {
  constructor(
    private readonly feedPort: FeedPort,
    private readonly feedExclusion: FeedExclusionPort,
  ) {}

  async execute(input: GetFeedInput): Promise<FeedCandidate[]> {
    const candidates = await this.feedPort.query({
      center: input.center,
      radiusKm: input.radiusKm,
      limit: input.limit * OVER_FETCH_FACTOR,
    })
    if (candidates.length === 0) return []

    const compatible = candidates.filter(
      (c) => c.profile.id !== input.viewer.id && matchesFilters(c.profile, input.viewer),
    )
    if (compatible.length === 0) return []

    const unseenIds = await this.feedExclusion.excludeSeen(
      input.viewer.id,
      compatible.map((c) => c.profile.id),
    )
    const unseen = new Set(unseenIds)

    return compatible.filter((c) => unseen.has(c.profile.id)).slice(0, input.limit)
  }
}
