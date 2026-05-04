import type { SwipeMatchPort, SwipeResult } from '../../../core/swipe-match/port'
import type { Swipe } from '../../../core/swipe-match/types'
import type { UserId } from '../../../core/shared/types'

const pairKey = (a: UserId, b: UserId): string => {
  if (a < b) return `${a}|${b}`
  return `${b}|${a}`
}

export class InMemorySwipeMatchAdapter implements SwipeMatchPort {
  private readonly yesSwipes = new Map<string, Set<UserId>>()
  private readonly matched = new Set<string>()

  async recordSwipe(swipe: Swipe): Promise<SwipeResult> {
    if (swipe.decision === 'no') {
      this.recordYes(swipe.swiperId, swipe.targetId, false)
      return { kind: 'recorded' }
    }

    const key = pairKey(swipe.swiperId, swipe.targetId)
    if (this.matched.has(key)) {
      this.recordYes(swipe.swiperId, swipe.targetId, true)
      return { kind: 'recorded' }
    }

    const inverseExists = this.yesSwipes.get(swipe.targetId)?.has(swipe.swiperId) ?? false
    this.recordYes(swipe.swiperId, swipe.targetId, true)

    if (!inverseExists) return { kind: 'recorded' }

    this.matched.add(key)
    return {
      kind: 'matched',
      match: {
        userAId: swipe.swiperId,
        userBId: swipe.targetId,
        matchedAt: swipe.createdAt,
      },
    }
  }

  private recordYes(swiper: UserId, target: UserId, isYes: boolean): void {
    if (!isYes) return
    let set = this.yesSwipes.get(swiper)
    if (set === undefined) {
      set = new Set()
      this.yesSwipes.set(swiper, set)
    }
    set.add(target)
  }

  reset(): void {
    this.yesSwipes.clear()
    this.matched.clear()
  }
}
