import { createRedisClient } from '../../../infrastructure/redis/client'
import { runFeedExclusionContract } from './contract'
import { RedisBloomFeedExclusionAdapter } from './redisBloom'

runFeedExclusionContract({
  name: 'redis-bloom',
  knownLossy: { mayExcludeUnmarked: true },
  setup: async () => {
    const redis = createRedisClient({ db: 2 })
    await redis.connect()
    const adapter = new RedisBloomFeedExclusionAdapter(redis, {
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
