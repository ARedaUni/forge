import { describe, expect, it } from 'vitest'
import { evaluateSwipe } from './match-rule'
import { UserIdSchema, type Swipe } from './types'

const USER_A = UserIdSchema.parse('00000000-0000-4000-8000-00000000000a')
const USER_B = UserIdSchema.parse('00000000-0000-4000-8000-00000000000b')
const SWIPED_AT = new Date('2026-01-01T00:00:00Z')

const swipe = (overrides: Partial<Swipe> = {}): Swipe => ({
  swiperId: USER_A,
  targetId: USER_B,
  decision: 'yes',
  createdAt: SWIPED_AT,
  ...overrides,
})

describe('evaluateSwipe', () => {
  it('matches when both swipes are yes', () => {
    const result = evaluateSwipe(swipe({ decision: 'yes' }), 'yes')
    expect(result.kind).toBe('matched')
  })

  it.each([
    ['yes', 'no'],
    ['no', 'yes'],
    ['no', 'no'],
  ] as const)('does not match when decisions are (%s, %s)', (mine, inverse) => {
    const result = evaluateSwipe(swipe({ decision: mine }), inverse)
    expect(result).toEqual({ kind: 'recorded' })
  })

  it.each(['yes', 'no'] as const)(
    'does not match when no inverse exists (mine=%s)',
    (mine) => {
      const result = evaluateSwipe(swipe({ decision: mine }), null)
      expect(result).toEqual({ kind: 'recorded' })
    },
  )

  it('canonicalizes match user IDs by sort order regardless of swipe direction', () => {
    const aThenB = evaluateSwipe(swipe({ swiperId: USER_A, targetId: USER_B }), 'yes')
    const bThenA = evaluateSwipe(swipe({ swiperId: USER_B, targetId: USER_A }), 'yes')

    expect(aThenB.kind).toBe('matched')
    expect(bThenA.kind).toBe('matched')
    if (aThenB.kind === 'matched' && bThenA.kind === 'matched') {
      expect(aThenB.match.userAId).toBe(bThenA.match.userAId)
      expect(aThenB.match.userBId).toBe(bThenA.match.userBId)
      expect(aThenB.match.userAId < aThenB.match.userBId).toBe(true)
    }
  })

  it('uses the matching swipe createdAt as matchedAt', () => {
    const result = evaluateSwipe(swipe({ decision: 'yes', createdAt: SWIPED_AT }), 'yes')
    if (result.kind === 'matched') {
      expect(result.match.matchedAt).toBe(SWIPED_AT)
    }
  })
})
