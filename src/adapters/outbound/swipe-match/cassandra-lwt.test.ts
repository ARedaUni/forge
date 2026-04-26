import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Client } from 'cassandra-driver'
import { createCassandraClient } from '../../../infrastructure/cassandra/client'
import { KEYSPACE, bootstrapSchema } from '../../../infrastructure/cassandra/bootstrap'
import { UserIdSchema, type UserId } from '../../../domain/types'
import { CassandraLwtSwipeMatchAdapter } from './cassandra-lwt'

const userId = (): UserId => UserIdSchema.parse(randomUUID())

describe('CassandraLwtSwipeMatchAdapter — integration', () => {
  let client: Client
  let adapter: CassandraLwtSwipeMatchAdapter

  beforeAll(async () => {
    const adminClient = createCassandraClient()
    await adminClient.connect()
    await bootstrapSchema(adminClient)
    await adminClient.shutdown()

    client = createCassandraClient({ keyspace: KEYSPACE })
    await client.connect()
    adapter = new CassandraLwtSwipeMatchAdapter(client)
  })

  beforeEach(async () => {
    await client.execute(`TRUNCATE ${KEYSPACE}.swipe_pairs`)
  })

  afterAll(async () => {
    await client.shutdown()
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

  it('produces exactly one match per reciprocal pair under concurrent load', async () => {
    const N = 200
    const pairs = Array.from({ length: N }, () => ({ a: userId(), b: userId() }))
    const now = new Date()

    const swipes = pairs.flatMap(({ a, b }) => [
      adapter.recordSwipe({ swiperId: a, targetId: b, decision: 'yes', createdAt: now }),
      adapter.recordSwipe({ swiperId: b, targetId: a, decision: 'yes', createdAt: now }),
    ])

    const results = await Promise.all(swipes)
    const matchedPairs = new Set(
      results.flatMap((r) => (r.kind === 'matched' ? [`${r.match.userAId}|${r.match.userBId}`] : [])),
    )

    expect(matchedPairs.size).toBe(N)
  })
})
