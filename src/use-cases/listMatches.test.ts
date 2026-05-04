import { describe, expect, it } from 'vitest'
import { InMemoryMatchAdapter } from '../adapters/outbound/match/inMemory'
import { UserIdSchema } from '../domain/shared/types'
import { ListMatchesUseCase } from './listMatches'

const VIEWER = UserIdSchema.parse('00000000-0000-4000-8000-00000000000a')
const OTHER_A = UserIdSchema.parse('00000000-0000-4000-8000-00000000000b')
const OTHER_B = UserIdSchema.parse('00000000-0000-4000-8000-00000000000c')
const OLDEST = new Date('2026-04-01T00:00:00Z')
const NEWEST = new Date('2026-04-29T00:00:00Z')

describe('ListMatchesUseCase', () => {
  it('returns the viewer\'s matches newest-first', async () => {
    const matchPort = new InMemoryMatchAdapter()
    await matchPort.recordMatch(VIEWER, OTHER_A, OLDEST)
    await matchPort.recordMatch(VIEWER, OTHER_B, NEWEST)
    const useCase = new ListMatchesUseCase(matchPort)

    const result = await useCase.execute(VIEWER)

    expect(result).toEqual([
      { otherUserId: OTHER_B, matchedAt: NEWEST },
      { otherUserId: OTHER_A, matchedAt: OLDEST },
    ])
  })

  it('returns empty when the viewer has no matches', async () => {
    const matchPort = new InMemoryMatchAdapter()
    const useCase = new ListMatchesUseCase(matchPort)

    const result = await useCase.execute(VIEWER)

    expect(result).toEqual([])
  })

  it('passes through the limit option', async () => {
    const matchPort = new InMemoryMatchAdapter()
    await matchPort.recordMatch(VIEWER, OTHER_A, OLDEST)
    await matchPort.recordMatch(VIEWER, OTHER_B, NEWEST)
    const useCase = new ListMatchesUseCase(matchPort)

    const result = await useCase.execute(VIEWER, { limit: 1 })

    expect(result).toHaveLength(1)
    expect(result[0]?.otherUserId).toBe(OTHER_B)
  })

  it('passes through the before cursor', async () => {
    const matchPort = new InMemoryMatchAdapter()
    await matchPort.recordMatch(VIEWER, OTHER_A, OLDEST)
    await matchPort.recordMatch(VIEWER, OTHER_B, NEWEST)
    const useCase = new ListMatchesUseCase(matchPort)

    const result = await useCase.execute(VIEWER, { before: NEWEST })

    expect(result).toEqual([{ otherUserId: OTHER_A, matchedAt: OLDEST }])
  })
})
