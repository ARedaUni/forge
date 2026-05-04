import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { FeedExclusionPort } from '../../../core/feed-exclusion/port'
import { UserIdSchema, type UserId } from '../../../core/shared/types'

const userId = (): UserId => UserIdSchema.parse(randomUUID())

export type FeedExclusionContractSetup = {
  name: string
  knownLossy?: { mayExcludeUnmarked?: boolean }
  setup: () => Promise<{
    adapter: FeedExclusionPort
    truncate: () => Promise<void>
    teardown: () => Promise<void>
  }>
}

export function runFeedExclusionContract(cfg: FeedExclusionContractSetup): void {
  describe(`FeedExclusionPort contract — ${cfg.name}`, () => {
    let adapter: FeedExclusionPort
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

    it('returns all candidates when nothing has been marked', async () => {
      const viewer = userId()
      const a = userId()
      const b = userId()
      const result = await adapter.excludeSeen(viewer, [a, b])
      expect(result).toEqual([a, b])
    })

    it('returns empty list for empty candidate list', async () => {
      const viewer = userId()
      await adapter.markShown(viewer, userId())
      const result = await adapter.excludeSeen(viewer, [])
      expect(result).toEqual([])
    })

    it('excludes a candidate after markShown (no false-unseen reports)', async () => {
      const viewer = userId()
      const shown = userId()
      await adapter.markShown(viewer, shown)
      const result = await adapter.excludeSeen(viewer, [shown])
      expect(result).toEqual([])
    })

    it('returns the unseen subset, preserving input order', async () => {
      const viewer = userId()
      const shownA = userId()
      const shownB = userId()
      const unseen = userId()
      await adapter.markShown(viewer, shownA)
      await adapter.markShown(viewer, shownB)
      const result = await adapter.excludeSeen(viewer, [shownA, unseen, shownB])
      expect(result).toEqual([unseen])
    })

    it('never returns a marked candidate as unseen across many marks', async () => {
      const viewer = userId()
      const shown = Array.from({ length: 50 }, () => userId())
      for (const id of shown) await adapter.markShown(viewer, id)
      const result = await adapter.excludeSeen(viewer, shown)
      expect(result).toEqual([])
    })

    it("isolates state per viewer (A's marks do not affect B)", async () => {
      const viewerA = userId()
      const viewerB = userId()
      const shownByA = userId()
      await adapter.markShown(viewerA, shownByA)
      const result = await adapter.excludeSeen(viewerB, [shownByA])
      expect(result).toEqual([shownByA])
    })

    if (!cfg.knownLossy?.mayExcludeUnmarked) {
      it('never excludes an unmarked candidate (exact adapter)', async () => {
        const viewer = userId()
        const shown = userId()
        const unseen = Array.from({ length: 20 }, () => userId())
        await adapter.markShown(viewer, shown)
        const result = await adapter.excludeSeen(viewer, unseen)
        expect(result).toEqual(unseen)
      })
    }
  })
}
