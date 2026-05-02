import { createCassandraClient } from '../../../infrastructure/cassandra/client'
import { KEYSPACE, bootstrapSchema } from '../../../infrastructure/cassandra/bootstrap'
import { CassandraNaiveSwipeMatchAdapter } from './cassandraNaive-inactive'
import { runSwipeMatchContract } from './contract'

runSwipeMatchContract({
  name: 'CassandraNaiveSwipeMatchAdapter',
  setup: async () => {
    const adminClient = createCassandraClient()
    await adminClient.connect()
    await bootstrapSchema(adminClient)
    await adminClient.shutdown()

    const client = createCassandraClient({ keyspace: KEYSPACE })
    await client.connect()

    return {
      adapter: new CassandraNaiveSwipeMatchAdapter(client),
      truncate: async () => {
        await client.execute(`TRUNCATE ${KEYSPACE}.swipes`)
      },
      teardown: async () => {
        await client.shutdown()
      },
    }
  },
  knownBroken: { concurrency: true },
})
