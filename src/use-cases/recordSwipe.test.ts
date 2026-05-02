import { describe, expect, it } from 'vitest'
import { InMemoryMatchAdapter } from '../adapters/outbound/match/inMemory'
import { InMemorySeenFilterAdapter } from '../adapters/outbound/seen-filter/inMemory'
import { InMemorySwipeMatchAdapter } from '../adapters/outbound/swipe-match/inMemory'
import type { NotificationPort } from '../domain/notification/port'
import type { MatchNotification } from '../domain/notification/types'
import { UserIdSchema, type UserId } from '../domain/shared/types'
import type { Swipe } from '../domain/swipe-match/types'
import { RecordSwipeUseCase } from './recordSwipe'

class RecordingNotificationPort implements NotificationPort {
  readonly events: MatchNotification[] = []
  async enqueue(event: MatchNotification): Promise<void> {
    this.events.push(event)
  }
}

const SWIPER = UserIdSchema.parse('00000000-0000-4000-8000-00000000000a')
const TARGET = UserIdSchema.parse('00000000-0000-4000-8000-00000000000b')
const SWIPED_AT = new Date('2026-04-29T00:00:00Z')

const makeSwipe = (overrides: Partial<Swipe> = {}): Swipe => ({
  swiperId: SWIPER,
  targetId: TARGET,
  decision: 'yes',
  createdAt: SWIPED_AT,
  ...overrides,
})

type Harness = {
  useCase: RecordSwipeUseCase
  swipeMatch: InMemorySwipeMatchAdapter
  seenFilter: InMemorySeenFilterAdapter
  matchPort: InMemoryMatchAdapter
  notificationPort: RecordingNotificationPort
}

const makeHarness = (): Harness => {
  const swipeMatch = new InMemorySwipeMatchAdapter()
  const seenFilter = new InMemorySeenFilterAdapter()
  const matchPort = new InMemoryMatchAdapter()
  const notificationPort = new RecordingNotificationPort()
  const useCase = new RecordSwipeUseCase(
    swipeMatch,
    seenFilter,
    matchPort,
    notificationPort,
  )
  return { useCase, swipeMatch, seenFilter, matchPort, notificationPort }
}

const reciprocate = async (h: Harness, swiper: UserId, target: UserId): Promise<void> => {
  await h.swipeMatch.recordSwipe({
    swiperId: target,
    targetId: swiper,
    decision: 'yes',
    createdAt: SWIPED_AT,
  })
}

describe('RecordSwipeUseCase', () => {
  it('returns recorded when no inverse swipe exists', async () => {
    const h = makeHarness()

    const result = await h.useCase.execute(makeSwipe())

    expect(result).toEqual({ kind: 'recorded' })
  })

  it('returns matched when an inverse yes already exists', async () => {
    const h = makeHarness()
    await reciprocate(h, SWIPER, TARGET)

    const result = await h.useCase.execute(makeSwipe())

    expect(result.kind).toBe('matched')
    if (result.kind === 'matched') {
      expect(new Set([result.match.userAId, result.match.userBId])).toEqual(
        new Set([SWIPER, TARGET]),
      )
    }
  })

  it("marks the target as seen by the swiper (so they won't appear in future feeds)", async () => {
    const h = makeHarness()

    await h.useCase.execute(makeSwipe())

    const seen = await h.seenFilter.contains(SWIPER, [TARGET])
    expect(seen).toEqual(new Set([TARGET]))
  })

  it('marks target as seen for both yes and no decisions', async () => {
    const h = makeHarness()

    await h.useCase.execute(makeSwipe({ decision: 'no' }))

    const seen = await h.seenFilter.contains(SWIPER, [TARGET])
    expect(seen).toEqual(new Set([TARGET]))
  })

  it('does not mark the swiper as seen by the target (one-directional)', async () => {
    const h = makeHarness()
    await reciprocate(h, SWIPER, TARGET)

    await h.useCase.execute(makeSwipe())

    const reverse = await h.seenFilter.contains(TARGET, [SWIPER])
    expect(reverse).toEqual(new Set())
  })

  it('records the match on MatchPort when result is matched', async () => {
    const h = makeHarness()
    await reciprocate(h, SWIPER, TARGET)

    await h.useCase.execute(makeSwipe())

    const list = await h.matchPort.listForUser(SWIPER)
    expect(list).toEqual([{ otherUserId: TARGET, matchedAt: SWIPED_AT }])
  })

  it('does not record on MatchPort when result is recorded (no match)', async () => {
    const h = makeHarness()

    await h.useCase.execute(makeSwipe())

    const list = await h.matchPort.listForUser(SWIPER)
    expect(list).toEqual([])
  })

  it('enqueues two mirrored match notifications when result is matched', async () => {
    const h = makeHarness()
    await reciprocate(h, SWIPER, TARGET)

    await h.useCase.execute(makeSwipe())

    expect(h.notificationPort.events).toHaveLength(2)
    const bySide = new Map(
      h.notificationPort.events.map((e) => [e.userId, e]),
    )
    expect(bySide.get(SWIPER)).toEqual({
      type: 'match',
      userId: SWIPER,
      otherUserId: TARGET,
      matchedAt: SWIPED_AT,
    })
    expect(bySide.get(TARGET)).toEqual({
      type: 'match',
      userId: TARGET,
      otherUserId: SWIPER,
      matchedAt: SWIPED_AT,
    })
  })

  it('does not enqueue any notification when result is recorded (no match)', async () => {
    const h = makeHarness()

    await h.useCase.execute(makeSwipe())

    expect(h.notificationPort.events).toEqual([])
  })
})
