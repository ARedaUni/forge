import { describe, expect, it } from 'vitest'
import type { MatchPort } from '../domain/match/port'
import type { SeenFilterPort } from '../domain/seen-filter/port'
import { UserIdSchema, type UserId } from '../domain/shared/types'
import type {
  SwipeMatchPort,
  SwipeResult,
} from '../domain/swipe-match/port'
import type { Swipe } from '../domain/swipe-match/types'
import { RecordSwipeUseCase } from './recordSwipe'

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

class StubMatchPort implements MatchPort {
  public records: Array<{ userA: UserId; userB: UserId; matchedAt: Date }> = []
  async recordMatch(userA: UserId, userB: UserId, matchedAt: Date): Promise<void> {
    this.records.push({ userA, userB, matchedAt })
  }
  async listForUser(): Promise<never[]> {
    return []
  }
}

const makeSwipe = (overrides: Partial<Swipe> = {}): Swipe => ({
  swiperId: SWIPER,
  targetId: TARGET,
  decision: 'yes',
  createdAt: SWIPED_AT,
  ...overrides,
})

const matchedResult: SwipeResult = {
  kind: 'matched',
  match: { userAId: SWIPER, userBId: TARGET, matchedAt: SWIPED_AT },
}

describe('RecordSwipeUseCase', () => {
  it('forwards the swipe to SwipeMatchPort', async () => {
    const swipePort = new StubSwipeMatchPort({ kind: 'recorded' })
    const useCase = new RecordSwipeUseCase(
      swipePort,
      new InMemorySeenFilter(),
      new StubMatchPort(),
    )
    const swipe = makeSwipe()

    await useCase.execute(swipe)

    expect(swipePort.received).toEqual([swipe])
  })

  it('returns the SwipeResult from the port', async () => {
    const useCase = new RecordSwipeUseCase(
      new StubSwipeMatchPort(matchedResult),
      new InMemorySeenFilter(),
      new StubMatchPort(),
    )

    const out = await useCase.execute(makeSwipe())

    expect(out).toEqual(matchedResult)
  })

  it("marks the target as seen by the swiper (so they won't appear in future feeds)", async () => {
    const seenFilter = new InMemorySeenFilter()
    const useCase = new RecordSwipeUseCase(
      new StubSwipeMatchPort({ kind: 'recorded' }),
      seenFilter,
      new StubMatchPort(),
    )

    await useCase.execute(makeSwipe())

    expect(seenFilter.adds).toEqual([{ userId: SWIPER, candidateId: TARGET }])
  })

  it('marks target as seen for both yes and no decisions', async () => {
    const seenFilter = new InMemorySeenFilter()
    const useCase = new RecordSwipeUseCase(
      new StubSwipeMatchPort({ kind: 'recorded' }),
      seenFilter,
      new StubMatchPort(),
    )

    await useCase.execute(makeSwipe({ decision: 'no' }))

    expect(seenFilter.adds).toEqual([{ userId: SWIPER, candidateId: TARGET }])
  })

  it('does not mark the swiper as seen by the target (one-directional)', async () => {
    const seenFilter = new InMemorySeenFilter()
    const useCase = new RecordSwipeUseCase(
      new StubSwipeMatchPort(matchedResult),
      seenFilter,
      new StubMatchPort(),
    )

    await useCase.execute(makeSwipe())

    expect(seenFilter.adds).toEqual([{ userId: SWIPER, candidateId: TARGET }])
  })

  it('records the match on MatchPort when result is matched', async () => {
    const matchPort = new StubMatchPort()
    const useCase = new RecordSwipeUseCase(
      new StubSwipeMatchPort(matchedResult),
      new InMemorySeenFilter(),
      matchPort,
    )

    await useCase.execute(makeSwipe())

    expect(matchPort.records).toEqual([
      { userA: SWIPER, userB: TARGET, matchedAt: SWIPED_AT },
    ])
  })

  it('does not record on MatchPort when result is recorded (no match)', async () => {
    const matchPort = new StubMatchPort()
    const useCase = new RecordSwipeUseCase(
      new StubSwipeMatchPort({ kind: 'recorded' }),
      new InMemorySeenFilter(),
      matchPort,
    )

    await useCase.execute(makeSwipe())

    expect(matchPort.records).toEqual([])
  })
})
