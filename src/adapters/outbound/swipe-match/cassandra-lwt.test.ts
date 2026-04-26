import { createCassandraClient } from '../../../infrastructure/cassandra/client'
import { KEYSPACE, bootstrapSchema } from '../../../infrastructure/cassandra/bootstrap'
import { CassandraLwtSwipeMatchAdapter } from './cassandra-lwt'
import { runSwipeMatchContract } from './contract'

runSwipeMatchContract({
  name: 'CassandraLwtSwipeMatchAdapter',
  setup: async () => {
    const adminClient = createCassandraClient()
    await adminClient.connect()
    await bootstrapSchema(adminClient)
    await adminClient.shutdown()

    const client = createCassandraClient({ keyspace: KEYSPACE })
    await client.connect()

    return {
      adapter: new CassandraLwtSwipeMatchAdapter(client),
      truncate: async () => {
        await client.execute(`TRUNCATE ${KEYSPACE}.swipe_pairs`)
      },
      teardown: async () => {
        await client.shutdown()
      },
    }
  },
})
