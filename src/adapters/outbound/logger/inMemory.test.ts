import { runLoggerContract } from './contract'
import { InMemoryLoggerAdapter } from './inMemory'

runLoggerContract({
  name: 'in-memory',
  setup: () => {
    const adapter = new InMemoryLoggerAdapter()
    return { logger: adapter, records: () => adapter.records }
  },
})
