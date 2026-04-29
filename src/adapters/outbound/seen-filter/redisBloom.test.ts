import { createRedisClient } from '../../../infrastructure/redis/client'
import { runSeenFilterContract } from './contract'
import { RedisBloomSeenFilterAdapter } from './redisBloom'

runSeenFilterContract({
  name: 'redis-bloom',
  knownLossy: { falsePositives: true },
  setup: async () => {
    const redis = createRedisClient({ db: 2 })
    await redis.connect()
    const adapter = new RedisBloomSeenFilterAdapter(redis, {
      capacity: 10000,
      errorRate: 0.01,
    })
    return {
      adapter,
      truncate: async () => {
        await redis.flushdb()
      },
      teardown: async () => {
        await redis.quit()
      },
    }
  },
})
