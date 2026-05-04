import pg from 'pg'

export type PostgresConfig = {
  host: string
  port: number
  user: string
  password: string
  database: string
}

export const defaultPostgresConfig: PostgresConfig = {
  host: process.env['POSTGRES_HOST'] ?? 'localhost',
  port: Number(process.env['POSTGRES_PORT'] ?? 5433),
  user: process.env['POSTGRES_USER'] ?? 'tinderclone',
  password: process.env['POSTGRES_PASSWORD'] ?? 'tinderclone',
  database: process.env['POSTGRES_DB'] ?? 'tinderclone',
}

export function createPostgresPool(
  config: PostgresConfig = defaultPostgresConfig,
): pg.Pool {
  return new pg.Pool({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    max: 10,
  })
}
