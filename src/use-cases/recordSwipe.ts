import type { FeedExclusionPort } from '../core/feed-exclusion/port'
import type { MatchPort } from '../core/match/port'
import type { SwipeMatchPort, SwipeResult } from '../core/swipe-match/port'
import type { Swipe } from '../core/swipe-match/types'
import type { Metrics } from '../infrastructure/observability/metrics'

export class RecordSwipeUseCase {
  constructor(
    private readonly swipeMatch: SwipeMatchPort,
    private readonly feedExclusion: FeedExclusionPort,
    private readonly matchPort: MatchPort,
    private readonly metrics: Metrics,
  ) {}

  async execute(swipe: Swipe): Promise<SwipeResult> {
    const result = await this.swipeMatch.recordSwipe(swipe)
    await this.feedExclusion.markShown(swipe.swiperId, swipe.targetId)
    if (result.kind === 'matched') {
      const { userAId, userBId, matchedAt } = result.match
      await this.matchPort.recordMatch(userAId, userBId, matchedAt)
    }
    this.metrics.recordSwipeOutcome({ decision: swipe.decision, result: result.kind })
    return result
  }
}
