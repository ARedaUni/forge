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
  ) {}

  async execute(swipe: Swipe): Promise<SwipeResult> {
    const result = await this.swipeMatch.recordSwipe(swipe)
    await this.seenFilter.add(swipe.swiperId, swipe.targetId)
    return result
  }
}
