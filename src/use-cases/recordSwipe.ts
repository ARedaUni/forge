import type { MatchPort } from '../domain/match/port'
import type { SeenFilterPort } from '../domain/seen-filter/port'
import type {
  SwipeMatchPort,
  SwipeResult,
} from '../domain/swipe-match/port'
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
      const { userAId, userBId, matchedAt } = result.match
      await this.matchPort.recordMatch(userAId, userBId, matchedAt)
    }
    return result
  }
}
