import { Client, types } from 'cassandra-driver'

export interface CassandraClientOptions {
  contactPoints?: string[]
  localDataCenter?: string
  keyspace?: string
}

export function createCassandraClient(options: CassandraClientOptions = {}): Client {
  return new Client({
    contactPoints: options.contactPoints ?? ['127.0.0.1:9042'],
    localDataCenter: options.localDataCenter ?? 'datacenter1',
    ...(options.keyspace !== undefined ? { keyspace: options.keyspace } : {}),
    queryOptions: { consistency: types.consistencies.quorum },
  })
}
