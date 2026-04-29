import { describe, expect, it } from 'vitest'
import type { SeenFilterPort } from '../domain/seen-filter/seen-filter-port'
import { UserIdSchema, type UserId } from '../domain/shared/types'
import type {
  SwipeMatchPort,
  SwipeResult,
} from '../domain/swipe-match/swipe-match-port'
import type { Swipe } from '../domain/swipe-match/types'
import { RecordSwipeUseCase } from './record-swipe'

const SWIPER = UserIdSchema.parse('00000000-0000-4000-8000-00000000000a')
const TARGET = UserIdSchema.parse('00000000-0000-4000-8000-00000000000b')
const SWIPED_AT = new Date('2026-04-29T00:00:00Z')

class StubSwipeMatchPort implements SwipeMatchPort {
  public received: Swipe[] = []
  constructor(private readonly result: SwipeResult) {}
  async recordSwipe(swipe: Swipe): Promise<SwipeResult> {
    this.received.push(swipe)
    return this.result
  }
}

class InMemorySeenFilter implements SeenFilterPort {
  public adds: Array<{ userId: UserId; candidateId: UserId }> = []
  async add(userId: UserId, candidateId: UserId): Promise<void> {
    this.adds.push({ userId, candidateId })
  }
  async contains(): Promise<Set<UserId>> {
    return new Set()
  }
}

const makeSwipe = (overrides: Partial<Swipe> = {}): Swipe => ({
  swiperId: SWIPER,
  targetId: TARGET,
  decision: 'yes',
  createdAt: SWIPED_AT,
  ...overrides,
})

describe('RecordSwipeUseCase', () => {
  it('forwards the swipe to SwipeMatchPort', async () => {
    const swipePort = new StubSwipeMatchPort({ kind: 'recorded' })
    const useCase = new RecordSwipeUseCase(swipePort, new InMemorySeenFilter())
    const swipe = makeSwipe()

    await useCase.execute(swipe)

    expect(swipePort.received).toEqual([swipe])
  })

  it('returns the SwipeResult from the port', async () => {
    const result: SwipeResult = {
      kind: 'matched',
      match: { userAId: SWIPER, userBId: TARGET, matchedAt: SWIPED_AT },
    }
    const useCase = new RecordSwipeUseCase(
      new StubSwipeMatchPort(result),
      new InMemorySeenFilter(),
    )

    const out = await useCase.execute(makeSwipe())

    expect(out).toEqual(result)
  })

  it("marks the target as seen by the swiper (so they won't appear in future feeds)", async () => {
    const seenFilter = new InMemorySeenFilter()
    const useCase = new RecordSwipeUseCase(
      new StubSwipeMatchPort({ kind: 'recorded' }),
      seenFilter,
    )

    await useCase.execute(makeSwipe())

    expect(seenFilter.adds).toEqual([{ userId: SWIPER, candidateId: TARGET }])
  })

  it('marks target as seen for both yes and no decisions', async () => {
    const seenFilter = new InMemorySeenFilter()
    const useCase = new RecordSwipeUseCase(
      new StubSwipeMatchPort({ kind: 'recorded' }),
      seenFilter,
    )

    await useCase.execute(makeSwipe({ decision: 'no' }))

    expect(seenFilter.adds).toEqual([{ userId: SWIPER, candidateId: TARGET }])
  })

  it('does not mark the swiper as seen by the target (one-directional)', async () => {
    const seenFilter = new InMemorySeenFilter()
    const useCase = new RecordSwipeUseCase(
      new StubSwipeMatchPort({
        kind: 'matched',
        match: { userAId: SWIPER, userBId: TARGET, matchedAt: SWIPED_AT },
      }),
      seenFilter,
    )

    await useCase.execute(makeSwipe())

    expect(seenFilter.adds).toEqual([{ userId: SWIPER, candidateId: TARGET }])
  })
})
