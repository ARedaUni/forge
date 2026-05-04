import { randomUUID } from 'node:crypto'
import type { Consumer } from 'kafkajs'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PostgresMatchAdapter } from '../adapters/outbound/match/postgres'
import { InMemoryFeedExclusionAdapter } from '../adapters/outbound/feed-exclusion/inMemory'
import { InMemorySwipeMatchAdapter } from '../adapters/outbound/swipe-match/inMemory'
import {
  MatchNotificationSchema,
  type MatchNotification,
} from '../core/notification/types'
import { UserIdSchema } from '../core/shared/types'
import {
  CONNECTOR_NAME,
  registerMatchesConnector,
} from '../infrastructure/debezium/registerConnector'
import { createKafka } from '../infrastructure/kafka/client'
import { createMetrics } from '../infrastructure/observability/metrics'
import { bootstrapPostgres, truncateMatches } from '../infrastructure/postgres/bootstrap'
import { createPostgresPool } from '../infrastructure/postgres/client'
import { RecordSwipeUseCase } from './recordSwipe'

const CONNECT_URL = process.env['CONNECT_URL'] ?? 'http://localhost:8083'
const userId = () => UserIdSchema.parse(randomUUID())

// Use-case-level invariant: RecordSwipeUseCase has no NotificationPort, yet a
// match still produces observable events on the `notifications` topic. The
// wire-format contract itself is verified separately in
// infrastructure/debezium/registerConnector.test.ts.
describe('RecordSwipeUseCase — events arrive on Kafka via Debezium CDC, not via the use case', () => {
  const pool = createPostgresPool()
  const kafka = createKafka(`cdc-test-${randomUUID()}`)
  let consumer: Consumer
  const buffer: MatchNotification[] = []

  beforeAll(async () => {
    await bootstrapPostgres(pool)

    // Create the destination topic up-front so the consumer can subscribe
    // immediately. (Otherwise subscribe races against Debezium's first produce.)
    const admin = kafka.admin()
    await admin.connect()
    await admin
      .createTopics({
        topics: [{ topic: 'notifications', numPartitions: 3, replicationFactor: 1 }],
      })
      .catch(() => {})
    await admin.disconnect()

    await registerMatchesConnector(CONNECT_URL)

    consumer = kafka.consumer({ groupId: `cdc-test-${randomUUID()}` })
    await consumer.connect()
    // fromBeginning: false — only consume messages produced after the consumer
    // joins. The topic accumulates messages across runs; replaying from offset
    // 0 makes the test wait for the consumer to catch up past hundreds of
    // unrelated messages, which exceeds the 15s deadline. Safe because we
    // await GROUP_JOIN below before letting beforeAll resolve.
    await consumer.subscribe({ topic: 'notifications', fromBeginning: false })

    // consumer.run() returns once eachMessage is registered, but the consumer
    // may not yet have joined the group / been assigned partitions
    // (tulios/kafkajs#1629). Without this wait, a producer writing in that
    // window lands at an offset the "latest" reset skips. GROUP_JOIN's
    // payload includes the assignment, so this single signal covers both.
    const groupJoined = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('cdc-test consumer GROUP_JOIN timed out')),
        30_000,
      )
      const remove = consumer.on(consumer.events.GROUP_JOIN, () => {
        clearTimeout(timeout)
        remove()
        resolve()
      })
    })

    await consumer.run({
      eachMessage: async ({ message }) => {
        if (!message.value) return
        const parsed = MatchNotificationSchema.safeParse(
          JSON.parse(message.value.toString('utf8')),
        )
        if (parsed.success) buffer.push(parsed.data)
      },
    })

    await groupJoined
  }, 60_000)

  beforeEach(async () => {
    await truncateMatches(pool)
    buffer.length = 0
  })

  afterAll(async () => {
    await consumer.disconnect()
    await fetch(`${CONNECT_URL}/connectors/${CONNECTOR_NAME}`, {
      method: 'DELETE',
    })
    await pool.end()
  })

  it('emits two MatchNotification events on the notifications topic when a match is committed, with no Kafka producer in the use case', async () => {
    const swipeMatch = new InMemorySwipeMatchAdapter()
    const feedExclusion = new InMemoryFeedExclusionAdapter()
    const matchPort = new PostgresMatchAdapter(pool)

    // The use case has no notification port at all — any event we observe on
    // Kafka must have come from Debezium tailing the WAL.
    const useCase = new RecordSwipeUseCase(
      swipeMatch,
      feedExclusion,
      matchPort,
      createMetrics(),
    )

    const swiper = userId()
    const target = userId()
    const at = new Date('2026-05-03T12:00:00.000Z')

    await swipeMatch.recordSwipe({
      swiperId: target,
      targetId: swiper,
      decision: 'yes',
      createdAt: at,
    })

    const result = await useCase.execute({
      swiperId: swiper,
      targetId: target,
      decision: 'yes',
      createdAt: at,
    })
    expect(result.kind).toBe('matched')

    // Wait for both mirrored CDC events for this specific pair.
    const deadline = Date.now() + 15_000
    const isOurPair = (e: MatchNotification): boolean =>
      (e.userId === swiper && e.otherUserId === target) ||
      (e.userId === target && e.otherUserId === swiper)
    while (Date.now() < deadline) {
      if (buffer.filter(isOurPair).length >= 2) break
      await new Promise((r) => setTimeout(r, 100))
    }

    const ours = buffer.filter(isOurPair)
    expect(ours).toHaveLength(2)
    const bySide = new Map(ours.map((e) => [e.userId, e]))
    // The use case runs without an active OTel span here, so the producer
    // adapter writes traceContext=null on the row and Debezium replicates it
    // verbatim. (Wired-end-to-end trace propagation is exercised in
    // registerConnector.integration.test.ts and the consumer's own tests.)
    expect(bySide.get(swiper)).toEqual({
      type: 'match',
      userId: swiper,
      otherUserId: target,
      matchedAt: at,
      traceContext: null,
    })
    expect(bySide.get(target)).toEqual({
      type: 'match',
      userId: target,
      otherUserId: swiper,
      matchedAt: at,
      traceContext: null,
    })
  }, 30_000)
})
