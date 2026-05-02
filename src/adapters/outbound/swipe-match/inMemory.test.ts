import { runSwipeMatchContract } from './contract'
import { InMemorySwipeMatchAdapter } from './inMemory'

runSwipeMatchContract({
  name: 'in-memory',
  setup: async () => {
    const adapter = new InMemorySwipeMatchAdapter()
    return {
      adapter,
      truncate: async () => adapter.reset(),
      teardown: async () => {},
    }
  },
})
