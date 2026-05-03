import { describe, expect, it } from 'vitest'
import { InMemoryFeedExclusionAdapter } from '../adapters/outbound/feed-exclusion/inMemory'
import { InMemoryMatchAdapter } from '../adapters/outbound/match/inMemory'
import { InMemorySwipeMatchAdapter } from '../adapters/outbound/swipe-match/inMemory'
import { UserIdSchema, type UserId } from '../domain/shared/types'
import type { Swipe } from '../domain/swipe-match/types'
import { RecordSwipeUseCase } from './recordSwipe'

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
  feedExclusion: InMemoryFeedExclusionAdapter
  matchPort: InMemoryMatchAdapter
}

const makeHarness = (): Harness => {
  const swipeMatch = new InMemorySwipeMatchAdapter()
  const feedExclusion = new InMemoryFeedExclusionAdapter()
  const matchPort = new InMemoryMatchAdapter()
  const useCase = new RecordSwipeUseCase(swipeMatch, feedExclusion, matchPort)
  return { useCase, swipeMatch, feedExclusion, matchPort }
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

  it("marks the target as shown to the swiper (so they won't appear in future feeds)", async () => {
    const h = makeHarness()

    await h.useCase.execute(makeSwipe())

    const unseen = await h.feedExclusion.excludeSeen(SWIPER, [TARGET])
    expect(unseen).toEqual([])
  })

  it('marks target as shown for both yes and no decisions', async () => {
    const h = makeHarness()

    await h.useCase.execute(makeSwipe({ decision: 'no' }))

    const unseen = await h.feedExclusion.excludeSeen(SWIPER, [TARGET])
    expect(unseen).toEqual([])
  })

  it('does not mark the swiper as shown to the target (one-directional)', async () => {
    const h = makeHarness()
    await reciprocate(h, SWIPER, TARGET)

    await h.useCase.execute(makeSwipe())

    const unseen = await h.feedExclusion.excludeSeen(TARGET, [SWIPER])
    expect(unseen).toEqual([SWIPER])
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
})
