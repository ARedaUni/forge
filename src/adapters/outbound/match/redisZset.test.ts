import { createRedisClient } from '../../../infrastructure/redis/client'
import { runMatchContract } from './contract'
import { RedisZsetMatchAdapter } from './redisZset'

runMatchContract({
  name: 'redis-zset',
  setup: async () => {
    const redis = createRedisClient({ db: 3 })
    await redis.connect()
    const adapter = new RedisZsetMatchAdapter(redis)
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
