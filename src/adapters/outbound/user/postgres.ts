import type pg from 'pg'
import { GenderSchema, type Gender, type UserProfile } from '../../../core/user/types'
import { UserIdSchema, type UserId } from '../../../core/shared/types'
import type { UserRepositoryPort } from '../../../core/user/port'
import { insertProfile } from '../feed/postgresPostgis'

const FIND_BY_ID_SQL = `
  SELECT
    u.id::text                  AS id,
    u.age                       AS age,
    u.gender                    AS gender,
    u.interested_in             AS interested_in,
    u.age_min                   AS age_min,
    u.age_max                   AS age_max,
    ST_Y(u.location::geometry)  AS lat,
    ST_X(u.location::geometry)  AS lng
  FROM users u
  WHERE u.id = $1::uuid
`

type Row = {
  id: string
  age: number
  gender: string
  interested_in: string[]
  age_min: number
  age_max: number
  lat: number
  lng: number
}

function rowToProfile(row: Row): UserProfile {
  return {
    id: UserIdSchema.parse(row.id),
    age: row.age,
    gender: GenderSchema.parse(row.gender),
    interestedIn: row.interested_in.map((g) => GenderSchema.parse(g)) as [Gender, ...Gender[]],
    ageRange: { min: row.age_min, max: row.age_max },
    location: { lat: row.lat, lng: row.lng },
  }
}

export class PostgresUserRepositoryAdapter implements UserRepositoryPort {
  constructor(private readonly pool: pg.Pool) {}

  async save(profile: UserProfile): Promise<void> {
    await insertProfile(this.pool, profile)
  }

  async load(id: UserId): Promise<UserProfile | null> {
    const result = await this.pool.query<Row>(FIND_BY_ID_SQL, [id])
    const row = result.rows[0]
    if (!row) return null
    return rowToProfile(row)
  }
}
