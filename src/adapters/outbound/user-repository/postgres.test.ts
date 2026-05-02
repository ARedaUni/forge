import { randomUUID } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { GenderSchema } from '../../../domain/feed/types'
import { UserIdSchema, type UserId } from '../../../domain/shared/types'
import {
  bootstrapPostgres,
  truncateUsers,
} from '../../../infrastructure/postgres/bootstrap'
import { createPostgresPool } from '../../../infrastructure/postgres/client'
import { PostgresUserRepositoryAdapter } from './postgres'

const pool = createPostgresPool()
const adapter = new PostgresUserRepositoryAdapter(pool)

const userId = (): UserId => UserIdSchema.parse(randomUUID())

const makeProfile = (id: UserId) => ({
  id,
  age: 28,
  gender: GenderSchema.parse('woman'),
  interestedIn: [GenderSchema.parse('man')] as [typeof GenderSchema._type],
  ageRange: { min: 25, max: 35 },
  location: { lat: 51.5074, lng: -0.1278 },
})

beforeEach(async () => {
  await bootstrapPostgres(pool)
  await truncateUsers(pool)
})

afterAll(async () => {
  await pool.end()
})

describe('PostgresUserRepositoryAdapter', () => {
  it('inserts a new profile without error', async () => {
    await expect(adapter.upsert(makeProfile(userId()))).resolves.toBeUndefined()
  })

  it('upserts an existing profile (re-insert same id updates the row, no error)', async () => {
    const id = userId()
    await adapter.upsert(makeProfile(id))
    const updated = { ...makeProfile(id), age: 30 }
    await expect(adapter.upsert(updated)).resolves.toBeUndefined()

    const row = await pool.query<{ age: number }>(
      'SELECT age FROM users WHERE id = $1',
      [id],
    )
    expect(row.rows[0]?.age).toBe(30)
  })
})
