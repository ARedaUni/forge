import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { MatchPort } from '../../../domain/match/port'
import { UserIdSchema, type UserId } from '../../../domain/shared/types'

const userId = (): UserId => UserIdSchema.parse(randomUUID())

export type MatchContractSetup = {
  name: string
  setup: () => Promise<{
    adapter: MatchPort
    truncate: () => Promise<void>
    teardown: () => Promise<void>
  }>
}

export function runMatchContract(cfg: MatchContractSetup): void {
  describe(`MatchPort contract — ${cfg.name}`, () => {
    let adapter: MatchPort
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

    it('returns empty list for a user with no matches', async () => {
      const result = await adapter.listForUser(userId())
      expect(result).toEqual([])
    })

    it('records a match visible to both users (two-sided read model)', async () => {
      const a = userId()
      const b = userId()
      const at = new Date('2026-04-29T10:00:00Z')

      await adapter.recordMatch(a, b, at)

      const aList = await adapter.listForUser(a)
      const bList = await adapter.listForUser(b)
      expect(aList).toEqual([{ otherUserId: b, matchedAt: at }])
      expect(bList).toEqual([{ otherUserId: a, matchedAt: at }])
    })

    it('is idempotent on the same pair (duplicate detection from concurrent swipes)', async () => {
      const a = userId()
      const b = userId()
      const at = new Date('2026-04-29T10:00:00Z')
      const later = new Date('2026-04-29T10:00:05Z')

      await adapter.recordMatch(a, b, at)
      await adapter.recordMatch(a, b, later)
      await adapter.recordMatch(b, a, later)

      const aList = await adapter.listForUser(a)
      expect(aList).toEqual([{ otherUserId: b, matchedAt: at }])
    })

    it('lists matches newest-first by matchedAt', async () => {
      const viewer = userId()
      const older = userId()
      const newer = userId()
      const middle = userId()
      await adapter.recordMatch(viewer, older, new Date('2026-04-01T00:00:00Z'))
      await adapter.recordMatch(viewer, newer, new Date('2026-04-29T00:00:00Z'))
      await adapter.recordMatch(viewer, middle, new Date('2026-04-15T00:00:00Z'))

      const list = await adapter.listForUser(viewer)

      expect(list.map((m) => m.otherUserId)).toEqual([newer, middle, older])
    })

    it('isolates matches per user', async () => {
      const a = userId()
      const b = userId()
      const c = userId()
      await adapter.recordMatch(a, b, new Date('2026-04-29T00:00:00Z'))

      const cList = await adapter.listForUser(c)
      expect(cList).toEqual([])
    })

    it('caps results to limit', async () => {
      const viewer = userId()
      for (let i = 0; i < 5; i++) {
        await adapter.recordMatch(
          viewer,
          userId(),
          new Date(`2026-04-${10 + i}T00:00:00Z`),
        )
      }

      const list = await adapter.listForUser(viewer, { limit: 2 })

      expect(list.length).toBe(2)
    })

    it('paginates with before cursor (excludes matches at or after the cursor)', async () => {
      const viewer = userId()
      const oldest = userId()
      const middle = userId()
      const newest = userId()
      await adapter.recordMatch(viewer, oldest, new Date('2026-04-01T00:00:00Z'))
      await adapter.recordMatch(viewer, middle, new Date('2026-04-15T00:00:00Z'))
      await adapter.recordMatch(viewer, newest, new Date('2026-04-29T00:00:00Z'))

      const page = await adapter.listForUser(viewer, {
        before: new Date('2026-04-29T00:00:00Z'),
      })

      expect(page.map((m) => m.otherUserId)).toEqual([middle, oldest])
    })
  })
}
