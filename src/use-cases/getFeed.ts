import type { FeedCandidate, FeedPort } from '../domain/feed/port'
import type { FeedExclusionPort } from '../domain/feed-exclusion/port'
import type { Location, UserProfile } from '../domain/user/types'

export type GetFeedInput = {
  viewer: UserProfile
  center: Location
  radiusKm: number
  limit: number
}

export class GetFeedUseCase {
  constructor(
    private readonly feedPort: FeedPort,
    private readonly feedExclusion: FeedExclusionPort,
  ) {}

  async execute(input: GetFeedInput): Promise<FeedCandidate[]> {
    const candidates = await this.feedPort.query(input)
    if (candidates.length === 0) return []

    const unseenIds = await this.feedExclusion.excludeSeen(
      input.viewer.id,
      candidates.map((c) => c.profile.id),
    )
    const unseen = new Set(unseenIds)

    return candidates.filter((c) => unseen.has(c.profile.id))
  }
}
