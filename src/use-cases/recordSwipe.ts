import type { MatchPort } from '../domain/match/port'
import type { NotificationPort } from '../domain/notification/port'
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
    private readonly notificationPort: NotificationPort,
  ) {}

  async execute(swipe: Swipe): Promise<SwipeResult> {
    const result = await this.swipeMatch.recordSwipe(swipe)
    await this.seenFilter.add(swipe.swiperId, swipe.targetId)
    if (result.kind === 'matched') {
      const { userAId, userBId, matchedAt } = result.match
      await this.matchPort.recordMatch(userAId, userBId, matchedAt)
      // Naive dual-write: two unrelated awaits, no shared transaction.
      // If either enqueue throws, the match row above is already committed.
      // Increment 14b replaces these calls with Debezium CDC on the WAL.
      await this.notificationPort.enqueue({
        type: 'match',
        userId: userAId,
        otherUserId: userBId,
        matchedAt,
      })
      await this.notificationPort.enqueue({
        type: 'match',
        userId: userBId,
        otherUserId: userAId,
        matchedAt,
      })
    }
    return result
  }
}
