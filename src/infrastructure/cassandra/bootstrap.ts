import type { Client } from 'cassandra-driver'

export const KEYSPACE = 'tinderclone'

export async function bootstrapSchema(client: Client): Promise<void> {
  await client.execute(`
    CREATE KEYSPACE IF NOT EXISTS ${KEYSPACE}
    WITH replication = {'class': 'SimpleStrategy', 'replication_factor': 1}
  `)

  await client.execute(`
    CREATE TABLE IF NOT EXISTS ${KEYSPACE}.swipes (
      swiper_id uuid,
      target_id uuid,
      decision text,
      created_at timestamp,
      PRIMARY KEY (swiper_id, target_id)
    )
  `)
}
