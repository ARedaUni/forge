import { createServer } from './adapters/inbound/http/server'
import { PostgresPostGisFeedAdapter } from './adapters/outbound/feed/postgresPostgis'
import { PostgresMatchAdapter } from './adapters/outbound/match/postgres'
import { RedisBloomSeenFilterAdapter } from './adapters/outbound/seen-filter/redisBloom'
import { RedisLuaSwipeMatchAdapter } from './adapters/outbound/swipe-match/redisLua'
import { PostgresUserRepositoryAdapter } from './adapters/outbound/user-repository/postgres'
import { bootstrapPostgres } from './infrastructure/postgres/bootstrap'
import { createPostgresPool } from './infrastructure/postgres/client'
import { createRedisClient } from './infrastructure/redis/client'
import { GetFeedUseCase } from './use-cases/getFeed'
import { RecordSwipeUseCase } from './use-cases/recordSwipe'

async function main(): Promise<void> {
  const pool = createPostgresPool()
  await bootstrapPostgres(pool)

  const redis = createRedisClient({ db: 0 })
  await redis.connect()

  const feedPort = new PostgresPostGisFeedAdapter(pool)
  const userRepo = new PostgresUserRepositoryAdapter(pool)
  const matchPort = new PostgresMatchAdapter(pool)
  const seenFilter = new RedisBloomSeenFilterAdapter(redis, {
    capacity: 10000,
    errorRate: 0.01,
  })
  const swipeMatch = new RedisLuaSwipeMatchAdapter(redis)

  const getFeed = new GetFeedUseCase(feedPort, seenFilter)
  const recordSwipe = new RecordSwipeUseCase(swipeMatch, seenFilter, matchPort)

  const server = createServer({ getFeed, recordSwipe, userRepo, matchPort })

  const port = Number(process.env['PORT'] ?? 3000)
  await server.listen({ port, host: '127.0.0.1' })

  const shutdown = async (): Promise<void> => {
    await server.close()
    await redis.quit()
    await pool.end()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
