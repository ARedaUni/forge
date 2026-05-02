import { runMatchContract } from './contract'
import { InMemoryMatchAdapter } from './inMemory'

runMatchContract({
  name: 'in-memory',
  setup: async () => {
    const adapter = new InMemoryMatchAdapter()
    return {
      adapter,
      truncate: async () => adapter.reset(),
      teardown: async () => {},
    }
  },
})
