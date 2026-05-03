import { createRedisClient } from '../../../infrastructure/redis/client'
import { runFeedExclusionContract } from './contract'
import { RedisSetFeedExclusionAdapter } from './redisSet-inactive'

runFeedExclusionContract({
  name: 'redis-set',
  setup: async () => {
    const redis = createRedisClient({ db: 1 })
    await redis.connect()
    const adapter = new RedisSetFeedExclusionAdapter(redis)
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
