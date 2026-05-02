import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PostgresMatchAdapter } from '../adapters/outbound/match/postgres'
import { InMemorySeenFilterAdapter } from '../adapters/outbound/seen-filter/inMemory'
import { InMemorySwipeMatchAdapter } from '../adapters/outbound/swipe-match/inMemory'
import type { NotificationPort } from '../domain/notification/port'
import type { MatchNotification } from '../domain/notification/types'
import { UserIdSchema } from '../domain/shared/types'
import {
  bootstrapPostgres,
  truncateMatches,
} from '../infrastructure/postgres/bootstrap'
import { createPostgresPool } from '../infrastructure/postgres/client'
import { RecordSwipeUseCase } from './recordSwipe'

class FaultInjectingNotificationPort implements NotificationPort {
  readonly attempts: MatchNotification[] = []
  async enqueue(event: MatchNotification): Promise<void> {
    this.attempts.push(event)
    throw new Error('simulated kafka outage')
  }
}

const userId = () => UserIdSchema.parse(randomUUID())

describe('RecordSwipeUseCase — dual-write hazard (the broken baseline)', () => {
  const pool = createPostgresPool()

  beforeAll(async () => {
    await bootstrapPostgres(pool)
  })
  beforeEach(async () => {
    await truncateMatches(pool)
  })
  afterAll(async () => {
    await pool.end()
  })

  it(
    'leaves the match committed in Postgres even when the notification publish fails — the inconsistent state has no automatic recovery',
    async () => {
      const matchPort = new PostgresMatchAdapter(pool)
      const swipeMatch = new InMemorySwipeMatchAdapter()
      const seenFilter = new InMemorySeenFilterAdapter()
      const notificationPort = new FaultInjectingNotificationPort()
      const useCase = new RecordSwipeUseCase(
        swipeMatch,
        seenFilter,
        matchPort,
        notificationPort,
      )

      const swiper = userId()
      const target = userId()
      const at = new Date('2026-05-01T10:00:00Z')

      // Pre-existing inverse "yes" so the next swipe produces a match.
      await swipeMatch.recordSwipe({
        swiperId: target,
        targetId: swiper,
        decision: 'yes',
        createdAt: at,
      })

      // The swipe call surfaces the Kafka failure to the caller (HTTP 500 in prod).
      await expect(
        useCase.execute({
          swiperId: swiper,
          targetId: target,
          decision: 'yes',
          createdAt: at,
        }),
      ).rejects.toThrow('simulated kafka outage')

      // …but the match row is already committed.
      const matches = await matchPort.listForUser(swiper)
      expect(matches).toEqual([{ otherUserId: target, matchedAt: at }])

      // …and only the FIRST enqueue was even attempted (the second never ran).
      expect(notificationPort.attempts).toHaveLength(1)

      // The damning part: a client retry can't fix it. The match write is
      // idempotent (no-op on retry), the enqueue still throws — the system is
      // permanently inconsistent until something outside this use case repairs it.
      // Increment 14b eliminates the second write entirely via Debezium CDC.
    },
  )
})
