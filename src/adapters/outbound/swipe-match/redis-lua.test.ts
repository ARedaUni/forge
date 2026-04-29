import { createRedisClient } from '../../../infrastructure/redis/client'
import { RedisLuaSwipeMatchAdapter } from './redis-lua'
import { runSwipeMatchContract } from './contract'

runSwipeMatchContract({
  name: 'RedisLuaSwipeMatchAdapter',
  setup: async () => {
    const client = createRedisClient({ db: 0 })
    await client.connect()

    return {
      adapter: new RedisLuaSwipeMatchAdapter(client),
      truncate: async () => {
        await client.flushdb()
      },
      teardown: async () => {
        await client.quit()
      },
    }
  },
})
