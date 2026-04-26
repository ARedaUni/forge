import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Client } from 'cassandra-driver'
import { createCassandraClient } from '../../../infrastructure/cassandra/client'
import { KEYSPACE, bootstrapSchema } from '../../../infrastructure/cassandra/bootstrap'
import { UserIdSchema, type UserId } from '../../../domain/types'
import { CassandraNaiveSwipeMatchAdapter } from './cassandra-naive'

const userId = (): UserId => UserIdSchema.parse(randomUUID())

describe('CassandraNaiveSwipeMatchAdapter — integration', () => {
  let client: Client
  let adapter: CassandraNaiveSwipeMatchAdapter

  beforeAll(async () => {
    const adminClient = createCassandraClient()
    await adminClient.connect()
    await bootstrapSchema(adminClient)
    await adminClient.shutdown()

    client = createCassandraClient({ keyspace: KEYSPACE })
    await client.connect()
    adapter = new CassandraNaiveSwipeMatchAdapter(client)
  })

  beforeEach(async () => {
    await client.execute(`TRUNCATE ${KEYSPACE}.swipes`)
  })

  afterAll(async () => {
    await client.shutdown()
  })

  it('persists a swipe and returns recorded when no inverse exists', async () => {
    const a = userId()
    const b = userId()

    const result = await adapter.recordSwipe({
      swiperId: a,
      targetId: b,
      decision: 'yes',
      createdAt: new Date(),
    })

    expect(result).toEqual({ kind: 'recorded' })

    const persisted = await client.execute(
      `SELECT decision FROM ${KEYSPACE}.swipes WHERE swiper_id = ? AND target_id = ?`,
      [a, b],
      { prepare: true },
    )
    expect(persisted.rows[0]?.['decision']).toBe('yes')
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
})
