import type pg from 'pg'

export async function bootstrapPostgres(pool: pg.Pool): Promise<void> {
  await pool.query(`CREATE EXTENSION IF NOT EXISTS postgis`)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id            UUID PRIMARY KEY,
      age           SMALLINT NOT NULL,
      gender        TEXT NOT NULL CHECK (gender IN ('man','woman')),
      interested_in TEXT[] NOT NULL,
      age_min       SMALLINT NOT NULL,
      age_max       SMALLINT NOT NULL,
      location      GEOGRAPHY(POINT, 4326) NOT NULL
    )
  `)

  await pool.query(`
    CREATE INDEX IF NOT EXISTS users_location_gist
    ON users USING GIST (location)
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS matches (
      user_id        UUID NOT NULL,
      other_user_id  UUID NOT NULL,
      matched_at     TIMESTAMPTZ NOT NULL,
      trace_context  TEXT,
      PRIMARY KEY (user_id, other_user_id)
    )
  `)

  // Idempotent for tables created before 14.5c shipped the column.
  await pool.query(`
    ALTER TABLE matches ADD COLUMN IF NOT EXISTS trace_context TEXT
  `)

  await pool.query(`
    CREATE INDEX IF NOT EXISTS matches_user_id_matched_at_desc
    ON matches (user_id, matched_at DESC)
  `)
}

export async function truncateUsers(pool: pg.Pool): Promise<void> {
  await pool.query(`TRUNCATE TABLE users`)
}

export async function truncateMatches(pool: pg.Pool): Promise<void> {
  await pool.query(`TRUNCATE TABLE matches`)
}
