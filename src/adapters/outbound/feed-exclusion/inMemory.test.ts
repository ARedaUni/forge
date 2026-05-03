import { runFeedExclusionContract } from './contract'
import { InMemoryFeedExclusionAdapter } from './inMemory'

runFeedExclusionContract({
  name: 'in-memory',
  setup: async () => {
    const adapter = new InMemoryFeedExclusionAdapter()
    return {
      adapter,
      truncate: async () => adapter.reset(),
      teardown: async () => {},
    }
  },
})
