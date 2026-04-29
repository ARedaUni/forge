import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { SeenFilterPort } from '../../../domain/seen-filter/seen-filter-port'
import { UserIdSchema, type UserId } from '../../../domain/shared/types'

const userId = (): UserId => UserIdSchema.parse(randomUUID())

export type SeenFilterContractSetup = {
  name: string
  knownLossy?: { falsePositives?: boolean }
  setup: () => Promise<{
    adapter: SeenFilterPort
    truncate: () => Promise<void>
    teardown: () => Promise<void>
  }>
}

export function runSeenFilterContract(cfg: SeenFilterContractSetup): void {
  describe(`SeenFilterPort contract — ${cfg.name}`, () => {
    let adapter: SeenFilterPort
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

    it('returns empty set when nothing has been added', async () => {
      const viewer = userId()
      const result = await adapter.contains(viewer, [userId(), userId()])
      expect(result).toEqual(new Set())
    })

    it('returns empty set for empty candidate list', async () => {
      const viewer = userId()
      await adapter.add(viewer, userId())
      const result = await adapter.contains(viewer, [])
      expect(result).toEqual(new Set())
    })

    it('returns added candidate after add (no false negatives)', async () => {
      const viewer = userId()
      const seen = userId()
      await adapter.add(viewer, seen)
      const result = await adapter.contains(viewer, [seen])
      expect(result).toEqual(new Set([seen]))
    })

    it('returns the seen subset of the candidate list', async () => {
      const viewer = userId()
      const seenA = userId()
      const seenB = userId()
      const unseen = userId()
      await adapter.add(viewer, seenA)
      await adapter.add(viewer, seenB)
      const result = await adapter.contains(viewer, [seenA, unseen, seenB])
      expect(result).toEqual(new Set([seenA, seenB]))
    })

    it('never reports a false negative across many adds', async () => {
      const viewer = userId()
      const seen = Array.from({ length: 50 }, () => userId())
      for (const id of seen) await adapter.add(viewer, id)
      const result = await adapter.contains(viewer, seen)
      expect(result.size).toBe(seen.length)
      for (const id of seen) expect(result.has(id)).toBe(true)
    })

    it("isolates state per user (A's seen do not affect B)", async () => {
      const userA = userId()
      const userB = userId()
      const seenByA = userId()
      await adapter.add(userA, seenByA)
      const result = await adapter.contains(userB, [seenByA])
      expect(result).toEqual(new Set())
    })

    if (!cfg.knownLossy?.falsePositives) {
      it('never reports a false positive (exact adapter)', async () => {
        const viewer = userId()
        const seen = userId()
        const unseen = Array.from({ length: 20 }, () => userId())
        await adapter.add(viewer, seen)
        const result = await adapter.contains(viewer, unseen)
        expect(result).toEqual(new Set())
      })
    }
  })
}
