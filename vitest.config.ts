import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    testTimeout: 30_000,
    // Test files share real DBs (Postgres `users`, Cassandra `swipe_pairs`).
    // Per-file truncate races cross-file when run in parallel. Serialize.
    fileParallelism: false,
  },
})
