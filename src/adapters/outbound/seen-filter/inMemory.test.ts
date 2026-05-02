import { runSeenFilterContract } from './contract'
import { InMemorySeenFilterAdapter } from './inMemory'

runSeenFilterContract({
  name: 'in-memory',
  setup: async () => {
    const adapter = new InMemorySeenFilterAdapter()
    return {
      adapter,
      truncate: async () => adapter.reset(),
      teardown: async () => {},
    }
  },
})
