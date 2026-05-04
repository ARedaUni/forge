import type pg from 'pg'
import type { FeedCandidate, FeedPort, FeedQuery } from '../../../core/feed/port'
import { GenderSchema, type Gender, type UserProfile } from '../../../core/user/types'
import { UserIdSchema } from '../../../core/shared/types'

const QUERY_SQL = `
  WITH center AS (
    SELECT ST_SetSRID(ST_MakePoint($1::float8, $2::float8), 4326)::geography AS pt
  )
  SELECT
    u.id::text                       AS id,
    u.age                            AS age,
    u.gender                         AS gender,
    u.interested_in                  AS interested_in,
    u.age_min                        AS age_min,
    u.age_max                        AS age_max,
    ST_Y(u.location::geometry)       AS lat,
    ST_X(u.location::geometry)       AS lng,
    ST_Distance(u.location, c.pt) / 1000.0 AS distance_km
  FROM users u, center c
  WHERE ST_DWithin(u.location, c.pt, $3::float8)
  ORDER BY ST_Distance(u.location, c.pt) ASC
  LIMIT $4::int
`

const INSERT_SQL = `
  INSERT INTO users (id, age, gender, interested_in, age_min, age_max, location)
  VALUES ($1::uuid, $2::int, $3::text, $4::text[], $5::int, $6::int,
          ST_SetSRID(ST_MakePoint($7::float8, $8::float8), 4326)::geography)
  ON CONFLICT (id) DO UPDATE SET
    age = EXCLUDED.age,
    gender = EXCLUDED.gender,
    interested_in = EXCLUDED.interested_in,
    age_min = EXCLUDED.age_min,
    age_max = EXCLUDED.age_max,
    location = EXCLUDED.location
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
  distance_km: string | number
}

function rowToCandidate(row: Row): FeedCandidate {
  const profile: UserProfile = {
    id: UserIdSchema.parse(row.id),
    age: row.age,
    gender: GenderSchema.parse(row.gender),
    interestedIn: row.interested_in.map((g) => GenderSchema.parse(g)) as [Gender, ...Gender[]],
    ageRange: { min: row.age_min, max: row.age_max },
    location: { lat: row.lat, lng: row.lng },
  }
  return {
    profile,
    distanceKm: Number(row.distance_km),
  }
}

export class PostgresPostGisFeedAdapter implements FeedPort {
  constructor(private readonly pool: pg.Pool) {}

  async query(q: FeedQuery): Promise<FeedCandidate[]> {
    const radiusMeters = q.radiusKm * 1000
    const result = await this.pool.query<Row>(QUERY_SQL, [
      q.center.lng,
      q.center.lat,
      radiusMeters,
      q.limit,
    ])
    return result.rows.map(rowToCandidate)
  }
}

export async function insertProfile(pool: pg.Pool, p: UserProfile): Promise<void> {
  await pool.query(INSERT_SQL, [
    p.id,
    p.age,
    p.gender,
    p.interestedIn,
    p.ageRange.min,
    p.ageRange.max,
    p.location.lng,
    p.location.lat,
  ])
}
