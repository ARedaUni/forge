import {
  bootstrapPostgres,
  truncateMatches,
} from '../../../infrastructure/postgres/bootstrap'
import { createPostgresPool } from '../../../infrastructure/postgres/client'
import { runMatchContract } from './contract'
import { PostgresMatchAdapter } from './postgres'

runMatchContract({
  name: 'postgres',
  setup: async () => {
    const pool = createPostgresPool()
    await bootstrapPostgres(pool)
    const adapter = new PostgresMatchAdapter(pool)
    return {
      adapter,
      truncate: () => truncateMatches(pool),
      teardown: async () => {
        await pool.end()
      },
    }
  },
})
