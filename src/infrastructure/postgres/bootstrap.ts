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
}

export async function truncateUsers(pool: pg.Pool): Promise<void> {
  await pool.query(`TRUNCATE TABLE users`)
}
