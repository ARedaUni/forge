import {
  bootstrapPostgres,
  truncateUsers,
} from '../../../infrastructure/postgres/bootstrap'
import { createPostgresPool } from '../../../infrastructure/postgres/client'
import { runFeedContract } from './contract'
import { PostgresPostGisFeedAdapter, insertProfile } from './postgres-postgis'

runFeedContract({
  name: 'postgres-postgis',
  setup: async () => {
    const pool = createPostgresPool()
    await bootstrapPostgres(pool)
    const adapter = new PostgresPostGisFeedAdapter(pool)
    return {
      adapter,
      seed: async (profiles) => {
        for (const p of profiles) {
          await insertProfile(pool, p)
        }
      },
      truncate: () => truncateUsers(pool),
      teardown: async () => {
        await pool.end()
      },
    }
  },
})
