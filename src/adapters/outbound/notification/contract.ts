import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { NotificationPort } from '../../../domain/notification/port'
import type { MatchNotification } from '../../../domain/notification/types'
import { UserIdSchema, type UserId } from '../../../domain/shared/types'

const userId = (): UserId => UserIdSchema.parse(randomUUID())

export type NotificationContractSetup = {
  name: string
  setup: () => Promise<{
    adapter: NotificationPort
    drain: () => Promise<MatchNotification[]>
    teardown: () => Promise<void>
  }>
}

export function runNotificationContract(cfg: NotificationContractSetup): void {
  describe(`NotificationPort contract — ${cfg.name}`, () => {
    let adapter: NotificationPort
    let drain: () => Promise<MatchNotification[]>
    let teardown: () => Promise<void>

    beforeAll(async () => {
      const ctx = await cfg.setup()
      adapter = ctx.adapter
      drain = ctx.drain
      teardown = ctx.teardown
    })

    afterAll(async () => {
      await teardown()
    })

    it('round-trips a match notification', async () => {
      const event: MatchNotification = {
        type: 'match',
        userId: userId(),
        otherUserId: userId(),
        matchedAt: new Date('2026-05-01T12:00:00Z'),
      }

      await adapter.enqueue(event)

      const received = await drain()
      const got = received.find((e) => e.userId === event.userId)
      expect(got).toEqual(event)
    })

    it('preserves order for events with the same recipient (per-user partitioning)', async () => {
      const recipient = userId()
      const events: MatchNotification[] = [
        {
          type: 'match',
          userId: recipient,
          otherUserId: userId(),
          matchedAt: new Date('2026-05-02T10:00:00Z'),
        },
        {
          type: 'match',
          userId: recipient,
          otherUserId: userId(),
          matchedAt: new Date('2026-05-02T10:00:01Z'),
        },
        {
          type: 'match',
          userId: recipient,
          otherUserId: userId(),
          matchedAt: new Date('2026-05-02T10:00:02Z'),
        },
      ]

      for (const e of events) {
        await adapter.enqueue(e)
      }

      const received = await drain()
      const forRecipient = received.filter((e) => e.userId === recipient)
      expect(forRecipient.map((e) => e.matchedAt.toISOString())).toEqual(
        events.map((e) => e.matchedAt.toISOString()),
      )
    })
  })
}
