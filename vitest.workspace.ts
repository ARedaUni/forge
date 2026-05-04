import { defineWorkspace } from 'vitest/config'

export default defineWorkspace([
  {
    test: {
      name: 'unit',
      include: ['src/**/*.test.ts'],
      // `*-inactive.test.ts` files exercise alternative adapter implementations
      // kept around for tradeoff comparison. They need real infra (Cassandra,
      // Redis) so they belong in the integration project, not unit.
      exclude: ['src/**/*.integration.test.ts', 'src/**/*-inactive.test.ts'],
    },
  },
  {
    test: {
      name: 'integration',
      include: ['src/**/*.integration.test.ts', 'src/**/*-inactive.test.ts'],
      // Integration tests share real DBs (Postgres `users`, Cassandra
      // `swipe_pairs`, Redis keys). Per-file truncate races cross-file when
      // run in parallel. Serialize.
      fileParallelism: false,
      testTimeout: 30_000,
    },
  },
])
