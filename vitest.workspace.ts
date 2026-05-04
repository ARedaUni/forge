import { defineWorkspace } from 'vitest/config'

export default defineWorkspace([
  {
    test: {
      name: 'unit',
      include: ['src/**/*.test.ts'],
      exclude: ['src/**/*.integration.test.ts'],
    },
  },
  {
    test: {
      name: 'integration',
      include: ['src/**/*.integration.test.ts'],
      // Integration tests share real DBs (Postgres `users`, Cassandra
      // `swipe_pairs`, Redis keys). Per-file truncate races cross-file when
      // run in parallel. Serialize.
      fileParallelism: false,
      testTimeout: 30_000,
    },
  },
])
