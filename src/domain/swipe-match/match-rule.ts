import type { UserId } from '../shared/types'
import type { SwipeResult } from './swipe-match-port'
import type { Swipe, SwipeDecision } from './types'

export function evaluateSwipe(
  swipe: Swipe,
  inverseDecision: SwipeDecision | null,
): SwipeResult {
  const isMutualYes = swipe.decision === 'yes' && inverseDecision === 'yes'
  if (!isMutualYes) return { kind: 'recorded' }

  let userAId: UserId
  let userBId: UserId
  if (swipe.swiperId < swipe.targetId) {
    userAId = swipe.swiperId
    userBId = swipe.targetId
  } else {
    userAId = swipe.targetId
    userBId = swipe.swiperId
  }

  return {
    kind: 'matched',
    match: { userAId, userBId, matchedAt: swipe.createdAt },
  }
}
