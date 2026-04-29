import { createRedisClient } from '../../../infrastructure/redis/client'
import { runSeenFilterContract } from './contract'
import { RedisSetSeenFilterAdapter } from './redisSet'

runSeenFilterContract({
  name: 'redis-set',
  setup: async () => {
    const redis = createRedisClient({ db: 1 })
    await redis.connect()
    const adapter = new RedisSetSeenFilterAdapter(redis)
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
