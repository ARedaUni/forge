import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { UserIdSchema, type UserId } from '../../../domain/shared/types'
import type { SwipeMatchPort } from '../../../domain/swipe-match/swipe-match-port'

const userId = (): UserId => UserIdSchema.parse(randomUUID())

export type SwipeMatchContractSetup = {
  name: string
  setup: () => Promise<{
    adapter: SwipeMatchPort
    truncate: () => Promise<void>
    teardown: () => Promise<void>
  }>
  knownBroken?: { concurrency?: boolean }
}

export function runSwipeMatchContract(cfg: SwipeMatchContractSetup): void {
  describe(`SwipeMatchPort contract — ${cfg.name}`, () => {
    let adapter: SwipeMatchPort
    let truncate: () => Promise<void>
    let teardown: () => Promise<void>

    beforeAll(async () => {
      const ctx = await cfg.setup()
      adapter = ctx.adapter
      truncate = ctx.truncate
      teardown = ctx.teardown
    })

    beforeEach(async () => {
      await truncate()
    })

    afterAll(async () => {
      await teardown()
    })

    it('returns recorded when no inverse exists', async () => {
      const a = userId()
      const b = userId()

      const result = await adapter.recordSwipe({
        swiperId: a,
        targetId: b,
        decision: 'yes',
        createdAt: new Date(),
      })

      expect(result).toEqual({ kind: 'recorded' })
    })

    it('returns matched end-to-end when reciprocal yes-swipe exists', async () => {
      const a = userId()
      const b = userId()

      await adapter.recordSwipe({
        swiperId: a,
        targetId: b,
        decision: 'yes',
        createdAt: new Date(),
      })

      const second = await adapter.recordSwipe({
        swiperId: b,
        targetId: a,
        decision: 'yes',
        createdAt: new Date(),
      })

      expect(second.kind).toBe('matched')
      if (second.kind === 'matched') {
        expect(new Set([second.match.userAId, second.match.userBId])).toEqual(new Set([a, b]))
      }
    })

    const concurrencyTest = cfg.knownBroken?.concurrency ? it.fails : it
    concurrencyTest(
      'detects a match for every reciprocal pair under concurrent load',
      async () => {
        const N = 200
        const pairs = Array.from({ length: N }, () => ({ a: userId(), b: userId() }))
        const now = new Date()

        const swipes = pairs.flatMap(({ a, b }) => [
          adapter.recordSwipe({ swiperId: a, targetId: b, decision: 'yes', createdAt: now }),
          adapter.recordSwipe({ swiperId: b, targetId: a, decision: 'yes', createdAt: now }),
        ])

        const results = await Promise.all(swipes)
        const matchedPairs = new Set(
          results.flatMap((r) =>
            r.kind === 'matched' ? [`${r.match.userAId}|${r.match.userBId}`] : [],
          ),
        )

        expect(matchedPairs.size).toBe(N)
      },
    )
  })
}
