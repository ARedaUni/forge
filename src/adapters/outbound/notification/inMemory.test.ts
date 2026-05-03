import { runDeliveryContract } from './contract'
import { InMemoryNotificationDeliveryAdapter } from './inMemory'

runDeliveryContract({
  name: 'InMemoryNotificationDeliveryAdapter',
  build: () => {
    const adapter = new InMemoryNotificationDeliveryAdapter()
    return { adapter, observed: () => adapter.delivered }
  },
})
