import { randomUUID } from 'node:crypto'
import type { Consumer } from 'kafkajs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  MatchNotificationSchema,
  type MatchNotification,
} from '../../core/notification/types'
import { UserIdSchema } from '../../core/shared/types'
import { bootstrapPostgres, truncateMatches } from '../postgres/bootstrap'
import { createPostgresPool } from '../postgres/client'
import { createKafka } from '../kafka/client'
import { CONNECTOR_NAME, registerMatchesConnector } from './registerConnector'

const CONNECT_URL = process.env['CONNECT_URL'] ?? 'http://localhost:8083'

async function deleteConnector(): Promise<void> {
  await fetch(`${CONNECT_URL}/connectors/${CONNECTOR_NAME}`, {
    method: 'DELETE',
  })
}

describe('registerMatchesConnector', () => {
  // The Debezium connector uses publication.autocreate.mode=filtered, which
  // builds the publication FROM the tables in table.include.list — so those
  // tables must exist at registration time. Locally the docker volume keeps
  // matches around between runs; on a fresh CI box it doesn't. Bootstrap
  // here so the connector has something to filter on.
  const pool = createPostgresPool()
  beforeAll(async () => {
    await bootstrapPostgres(pool)
    await deleteConnector()
  })
  afterAll(async () => {
    await deleteConnector()
    await pool.end()
  })

  it('PUTs the matches connector config and waits until it reports RUNNING', async () => {
    await registerMatchesConnector(CONNECT_URL)

    const res = await fetch(`${CONNECT_URL}/connectors/${CONNECTOR_NAME}/status`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      connector: { state: string }
      tasks: ReadonlyArray<{ state: string }>
    }
    expect(body.connector.state).toBe('RUNNING')
    expect(body.tasks).toHaveLength(1)
    expect(body.tasks[0]?.state).toBe('RUNNING')
  }, 60_000)

  it('is idempotent — re-registering the same connector does not throw', async () => {
    await registerMatchesConnector(CONNECT_URL)
    await registerMatchesConnector(CONNECT_URL)
  }, 60_000)
})

// Adapter contract: the CDC pipeline (Postgres row → Debezium → Kafka) must
// place bytes on the `notifications` topic that parse cleanly against
// MatchNotificationSchema. This is the published-language contract between
// this bounded context and any downstream consumer.
describe('matches CDC adapter — wire-format contract', () => {
  const pool = createPostgresPool()
  const kafka = createKafka(`cdc-contract-${randomUUID()}`)
  let consumer: Consumer
  const buffer: MatchNotification[] = []

  beforeAll(async () => {
    await bootstrapPostgres(pool)
    await truncateMatches(pool)

    const admin = kafka.admin()
    await admin.connect()
    await admin
      .createTopics({
        topics: [{ topic: 'notifications', numPartitions: 3, replicationFactor: 1 }],
      })
      .catch(() => {})
    await admin.disconnect()

    await registerMatchesConnector(CONNECT_URL)

    consumer = kafka.consumer({ groupId: `cdc-contract-${randomUUID()}` })
    await consumer.connect()
    await consumer.subscribe({ topic: 'notifications', fromBeginning: false })
    await consumer.run({
      eachMessage: async ({ message }) => {
        if (!message.value) return
        const parsed = MatchNotificationSchema.safeParse(
          JSON.parse(message.value.toString('utf8')),
        )
        if (parsed.success) buffer.push(parsed.data)
      },
    })
  }, 60_000)

  afterAll(async () => {
    await consumer.disconnect()
    await deleteConnector()
    await pool.end()
  })

  it('publishes one MatchNotification per row that conforms to the domain schema', async () => {
    const userA = UserIdSchema.parse(randomUUID())
    const userB = UserIdSchema.parse(randomUUID())
    const at = new Date('2026-05-03T12:00:00.000Z')

    await pool.query(
      `INSERT INTO matches (user_id, other_user_id, matched_at)
       VALUES ($1::uuid, $2::uuid, $3::timestamptz)`,
      [userA, userB, at],
    )

    const deadline = Date.now() + 15_000
    const isOurs = (e: MatchNotification): boolean =>
      e.userId === userA && e.otherUserId === userB
    while (Date.now() < deadline) {
      if (buffer.some(isOurs)) break
      await new Promise((r) => setTimeout(r, 100))
    }

    const ours = buffer.filter(isOurs)
    expect(ours).toHaveLength(1)
    expect(ours[0]).toEqual({
      type: 'match',
      userId: userA,
      otherUserId: userB,
      matchedAt: at,
      // Row inserted directly here (no producer adapter, no active OTel
      // context), so Debezium replicates the column as null.
      traceContext: null,
    })
  }, 30_000)
})
