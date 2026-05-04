import { randomUUID } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { GenderSchema } from '../../../core/user/types'
import { UserIdSchema, type UserId } from '../../../core/shared/types'
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
  it('saves a new profile without error', async () => {
    await expect(adapter.save(makeProfile(userId()))).resolves.toBeUndefined()
  })

  it('overwrites an existing profile when save is called twice for the same id', async () => {
    const id = userId()
    await adapter.save(makeProfile(id))
    const updated = { ...makeProfile(id), age: 30 }
    await expect(adapter.save(updated)).resolves.toBeUndefined()

    const row = await pool.query<{ age: number }>('SELECT age FROM users WHERE id = $1', [
      id,
    ])
    expect(row.rows[0]?.age).toBe(30)
  })

  describe('load', () => {
    it('returns null when the user does not exist', async () => {
      const found = await adapter.load(userId())
      expect(found).toBeNull()
    })

    it('returns the profile when it exists, round-tripping every field', async () => {
      const id = userId()
      const profile = makeProfile(id)
      await adapter.save(profile)

      const found = await adapter.load(id)

      expect(found).not.toBeNull()
      expect(found?.id).toBe(id)
      expect(found?.age).toBe(profile.age)
      expect(found?.gender).toBe(profile.gender)
      expect(found?.interestedIn).toEqual(profile.interestedIn)
      expect(found?.ageRange).toEqual(profile.ageRange)
      expect(found?.location.lat).toBeCloseTo(profile.location.lat, 4)
      expect(found?.location.lng).toBeCloseTo(profile.location.lng, 4)
    })
  })
})
