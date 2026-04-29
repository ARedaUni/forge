import type { FeedCandidate, FeedPort } from '../domain/feed/feed-port'
import type { Location, UserProfile } from '../domain/feed/types'
import type { SeenFilterPort } from '../domain/seen-filter/seen-filter-port'

export type GetFeedInput = {
  viewer: UserProfile
  center: Location
  radiusKm: number
  limit: number
}

export class GetFeedUseCase {
  constructor(
    private readonly feedPort: FeedPort,
    private readonly seenFilter: SeenFilterPort,
  ) {}

  async execute(input: GetFeedInput): Promise<FeedCandidate[]> {
    const candidates = await this.feedPort.query(input)
    if (candidates.length === 0) return []

    const seen = await this.seenFilter.contains(
      input.viewer.id,
      candidates.map((c) => c.profile.id),
    )

    return candidates.filter((c) => !seen.has(c.profile.id))
  }
}
