import type pg from 'pg'

// Serialise bootstraps behind a session-scoped advisory lock. CREATE TABLE
// IF NOT EXISTS does a non-atomic check-then-insert against pg_type/pg_class;
// concurrent callers (e.g. multiple integration test files on a fresh CI box)
// can both pass the existence check and one then fails the pg_type unique
// index. The lock must be acquired and released on the SAME pg connection,
// so we pin a client out of the pool for the duration.
const BOOTSTRAP_LOCK_KEY = 0x71_64_65_72 // ascii('qder') — arbitrary but stable

export async function bootstrapPostgres(pool: pg.Pool): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query(`SELECT pg_advisory_lock($1)`, [BOOTSTRAP_LOCK_KEY])

    await client.query(`CREATE EXTENSION IF NOT EXISTS postgis`)

    await client.query(`
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

    await client.query(`
      CREATE INDEX IF NOT EXISTS users_location_gist
      ON users USING GIST (location)
    `)

    await client.query(`
      CREATE TABLE IF NOT EXISTS matches (
        user_id        UUID NOT NULL,
        other_user_id  UUID NOT NULL,
        matched_at     TIMESTAMPTZ NOT NULL,
        trace_context  TEXT,
        PRIMARY KEY (user_id, other_user_id)
      )
    `)

    // Idempotent for tables created before 14.5c shipped the column.
    await client.query(`
      ALTER TABLE matches ADD COLUMN IF NOT EXISTS trace_context TEXT
    `)

    await client.query(`
      CREATE INDEX IF NOT EXISTS matches_user_id_matched_at_desc
      ON matches (user_id, matched_at DESC)
    `)
  } finally {
    await client.query(`SELECT pg_advisory_unlock($1)`, [BOOTSTRAP_LOCK_KEY])
    client.release()
  }
}

export async function truncateUsers(pool: pg.Pool): Promise<void> {
  await pool.query(`TRUNCATE TABLE users`)
}

export async function truncateMatches(pool: pg.Pool): Promise<void> {
  await pool.query(`TRUNCATE TABLE matches`)
}
