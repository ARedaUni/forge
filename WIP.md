# WIP — Tinder Clone (System Design Learning Project)

## Goal

Build a working Tinder clone in TypeScript using **real production technologies** (Cassandra, Redis, Postgres+PostGIS, Elasticsearch) and **hexagonal architecture**, so the same domain port can have multiple adapters that we run head-to-head against the same contract test suite. Source material: Hello Interview's "Tinder" system design write-up + the comment thread.

The point is to *feel* tradeoffs (lost matches under contention, geo-query latency, stale feed caches, Bloom filter false positives) by writing the failing test, watching it fail on one adapter, and watching it pass on another.

## Working principles

- **Evolutionary design.** Add infrastructure only when the current increment justifies it. No premature load balancers, API gateways, or unused data stores.
- **TDD non-negotiable.** Failing test first; minimum impl to pass; refactor only when it adds value.
- **Pyramid-shaped tests.** Pure domain rules → unit tests (microseconds). Adapter-vs-DB behavior → integration tests (real DB, ~50ms each). HTTP/E2E → later.
- **Read real docs before implementing each adapter.** No vibe-coding against half-remembered APIs.
- **pnpm**, TypeScript strict + `exactOptionalPropertyTypes` + `noUncheckedIndexedAccess`, Zod schemas at trust boundaries, vitest.

## Architecture (hexagonal)

```
domain/        ← entities + pure rules + port interfaces. Depends on nothing.
application/   ← use cases. Depends on domain. (not yet built)
adapters/
  inbound/     ← HTTP handlers. (not yet built)
  outbound/    ← port implementations. Depends on domain.
infrastructure/← connection helpers, schema bootstrap.
```

Each interesting port has ≥2 adapters and a shared contract test suite.

### Ports planned

| Port | Adapters | Status |
|---|---|---|
| `SwipeMatchPort` | cassandra-naive (broken), cassandra-lwt, redis-lua, postgres-for-update | naive ✅, lwt ✅, redis-lua ✅, postgres deferred |
| `FeedPort` | postgres-postgis, elasticsearch | next |
| `SeenFilterPort` | client-cache simulation, redis-bloom | not yet |
| `FeedCachePort` | none (live query), redis + cron warmer | not yet |

## Increments

### ✅ Increment 1 — Scaffold

Strict TS config, vitest, Zod schemas (`UserId` branded UUID, `Swipe`, `Match`), `SwipeMatchPort` interface with `SwipeResult` discriminated union.

### ✅ Increment 2 — First adapter (deliberately broken)

`docker-compose.yml` for Cassandra 5.0. `infrastructure/cassandra/{client,bootstrap}.ts` separating connection from schema. Pure `evaluateSwipe()` domain rule + 8 microsecond unit tests. `CassandraNaiveSwipeMatchAdapter` with `swipes` table partitioned by `swiper_id`. SELECT inverse → INSERT → evaluate. Functionally correct under serial use, has a dormant race under concurrent reciprocal writes.

### ✅ Increment 3 — Concurrency torture test (race exposed)

Concurrency test fires 200 reciprocal pairs (400 swipes) via `Promise.all`, asserts every pair is detected as a match. Result on naive adapter: **0 / 200 detected** — every match lost. Cause: `Promise.all` dispatches all SELECTs before any INSERT round-trips, so every SELECT sees nothing.

The test now lives in the shared contract suite. Marked `it.fails` for the naive adapter to document the race without breaking CI.

### ✅ Increment 4 — Cassandra LWT adapter (race fixed)

New `swipe_pairs` table partitioned by **canonical pair** `((low_id, high_id), swiper_id)`. Both directions of a swipe land on the same partition → Paxos can serialize them.

`CassandraLwtSwipeMatchAdapter`:
1. `INSERT IF NOT EXISTS` (LWT) into `swipe_pairs`
2. `SELECT ... CONSISTENCY SERIAL` on the partition
3. `evaluateSwipe(swipe, inverseDecisionFromPartition)`

Passes the concurrency contract: every reciprocal pair detected. Reports 1–2 matches per pair depending on read-after-LWT timing — duplicate detection is a downstream notification concern, not a correctness bug.

**Two architectural levers in play:**
- *Schema*: partition by canonical pair so both writes meet on the same replica set. (Naive partitioning by user makes coordination impossible.)
- *Consistency*: `SERIAL` on the read links the read path to the Paxos state machine. Plain `QUORUM` reads can miss in-flight LWTs.

### ✅ Increment 5 — Shared contract extraction

`adapters/outbound/swipe-match/contract.ts` defines `runSwipeMatchContract({ name, setup, knownBroken })`. Each adapter's test file is a thin caller (~25 lines) supplying connection/teardown/truncate. The contract owns the test bodies. `knownBroken: { concurrency: true }` flips the naive adapter's concurrency case to `it.fails`.

### ✅ Increment 6 — Redis-Lua adapter (third mechanism)

Added Redis 7.4 to docker-compose. `infrastructure/redis/client.ts` builds an `ioredis` client.

`RedisLuaSwipeMatchAdapter`:
- Key per pair: `swipe:<low>:<high>` — a hash with two fields, `low` and `high`, holding directional decisions.
- Atomic via embedded Lua script over `EVAL`. Server-side, the script HSETs the swiper's side and HGETs the inverse side in one uninterruptible block.
- No CAS, no locks. Atomicity comes from Redis being single-threaded — the script literally cannot interleave with anything else.

Performance: same contract suite runs in **27ms** vs LWT's **398ms** on the concurrency case (~15× faster). The LWT does ~4 round-trips per write (Paxos: Prepare/Promise/Propose/Accept). The Lua script does 1 round-trip and runs entirely in-process on Redis's command thread.

**Three mechanisms now compared on identical contract:**

| Adapter | Atomicity mechanism | Class |
|---|---|---|
| cassandra-naive | (none — broken) | — |
| cassandra-lwt | Distributed CAS via Paxos (`IF NOT EXISTS`) | Optimistic |
| redis-lua | Single-thread script execution | Physical serialization |
| (future) postgres-for-update | Row-level lock | Pessimistic |

## Current file tree

```
.
├── docker-compose.yml
├── package.json
├── pnpm-lock.yaml
├── tsconfig.json
├── vitest.config.ts
├── WIP.md
└── src/
    ├── domain/
    │   ├── match-rule.ts
    │   ├── match-rule.test.ts
    │   ├── types.ts
    │   └── ports/
    │       └── swipe-match-port.ts
    ├── infrastructure/
    │   ├── cassandra/
    │   │   ├── bootstrap.ts        ← swipes + swipe_pairs
    │   │   └── client.ts
    │   └── redis/
    │       └── client.ts
    └── adapters/
        └── outbound/
            └── swipe-match/
                ├── contract.ts
                ├── cassandra-naive.ts
                ├── cassandra-naive.test.ts
                ├── cassandra-lwt.ts
                ├── cassandra-lwt.test.ts
                ├── redis-lua.ts
                └── redis-lua.test.ts
```

## Test report (current)

```
✓ src/domain/match-rule.test.ts                 (8 tests, 2ms)
✓ .../cassandra-naive.test.ts                   (3 tests, 225ms)  ← concurrency = it.fails
✓ .../cassandra-lwt.test.ts                     (3 tests, 398ms)
✓ .../redis-lua.test.ts                         (3 tests, 27ms)
Test Files  4 passed
Tests       17 passed
```

## Next: Increment 7 — `FeedPort` with PostGIS

Pivot from atomicity exploration to the geospatial side of the article. The feed answers: **"given a user's location and preferences, return N candidate profiles ordered by distance."**

First adapter: PostGIS. Use a geographic index (`GIST` on a `geography(Point)` column) to make `ST_DWithin` and `ST_Distance` cheap. Schema needs a `users` table with location + filter attributes (gender, age, etc., minimal for now).

Plan:
1. Add Postgres+PostGIS service to `docker-compose.yml`
2. `infrastructure/postgres/{client,bootstrap}.ts` — connection + schema (PostGIS extension + users table)
3. Domain types: `UserProfile`, `FeedQuery { lat, lng, radiusKm, limit, ... }`, `FeedPort`
4. `adapters/outbound/feed/postgres-postgis.ts` — `ST_DWithin(...)` + ORDER BY `ST_Distance(...)`
5. Contract: small fixed dataset, assert ordering by distance, exclusion of out-of-radius profiles
6. Later: Elasticsearch as second adapter, feel the latency tradeoffs (and the "denormalize for read" story)

## Open questions / things to revisit

- **Duplicate match detection on LWT and Redis-Lua.** Concurrent reciprocal swipes can both return `{matched}`. Acceptable here because notifications de-dupe downstream. If we ever wire a synchronous "this is the moment of match" event, only the second writer should fire it — would need a claim mechanism.
- **Per-user read pattern lost on `swipe_pairs` / Redis hash keys.** Atomicity-friendly partitioning makes "show me everyone A swiped" expensive. In production we'd dual-write to a per-user index. Defer until we need the read.
- **Redis durability not characterized.** Default `appendfsync everysec` can lose up to 1s of writes on crash. For learning we don't care; for production we'd pair Redis with a durable log (Kafka / commit log replay).
- **Test isolation strategy.** Currently TRUNCATE / FLUSHDB between tests. Per-test namespaces if we ever parallelize integration test files.
- **No application/use-case layer yet.** Adapters inline orchestration (read → write → decide). Atomicity has to live in the adapter (otherwise we can't compose LWT/Lua atomic ops), so when we add a use case it stays thin.
- **Postgres-FOR-UPDATE adapter deferred.** We've already covered the three atomicity classes (CAS, single-thread, lock) by name; building the fourth concretely is rounding-out, not new ground. Revisit if we want a tidy quartet.
