import type { MatchPort } from '../domain/match/match-port'
import type { SeenFilterPort } from '../domain/seen-filter/seen-filter-port'
import type {
  SwipeMatchPort,
  SwipeResult,
} from '../domain/swipe-match/swipe-match-port'
import type { Swipe } from '../domain/swipe-match/types'

export class RecordSwipeUseCase {
  constructor(
    private readonly swipeMatch: SwipeMatchPort,
    private readonly seenFilter: SeenFilterPort,
    private readonly matchPort: MatchPort,
  ) {}

  async execute(swipe: Swipe): Promise<SwipeResult> {
    const result = await this.swipeMatch.recordSwipe(swipe)
    await this.seenFilter.add(swipe.swiperId, swipe.targetId)
    if (result.kind === 'matched') {
      await this.matchPort.recordMatch(
        result.match.userAId,
        result.match.userBId,
        result.match.matchedAt,
      )
    }
    return result
  }
}
