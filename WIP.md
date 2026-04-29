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
| `FeedPort` | postgres-postgis, elasticsearch | postgis ✅, elasticsearch next |
| `SeenFilterPort` | redis-set, redis-bloom | both ✅ |
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

### ✅ Increment 7 — `FeedPort` with PostGIS (geospatial pivot)

Hello Interview frames the feed as: *"Users can view a stack of potential matches in line with their preferences and within max distance of their current location"* with NFR *"low latency (e.g. < 300ms)."* Their proposed naive query (lat/long bounding box with B-tree indexes) is dismissed as "incredibly inefficient." We solve it properly with a GIST/R-tree index on a `geography(Point, 4326)` column.

**Domain layer (pure):**
- `UserProfile { id, age, gender, interestedIn[], ageRange{min,max}, location{lat,lng} }` and `FeedQuery { viewer, center, radiusKm, limit }` schemas (Zod) in `domain/types.ts`.
- `domain/feed-rule.ts` — pure `matchesFilters(target, viewer)` predicate enforcing **mutual** gender and age filtering. 7 microsecond unit tests.
- `domain/ports/feed-port.ts` — `FeedPort.query(q): Promise<FeedCandidate[]>`. Returns `{ profile, distanceKm }[]`.

**Why mutual filters in the rule:** Hello Interview's sample SQL only filters one direction (`age BETWEEN 18 AND 35`). That's the *viewer's* filter on targets. The *target's* filter on the viewer is missing. The pure rule encodes both, so PostGIS + ES adapters must implement both.

**Why `viewer` is a full profile, not a userId:** every adapter would otherwise have to fetch the viewer's row first — turning one query into two round-trips. Latency budget matters.

**Why `center` is separate from `viewer.location`:** models Tinder's "Passport" feature without surgery.

**Infrastructure:**
- `postgis/postgis:16-3.4` in docker-compose, host port 5433 (5432 was taken).
- `infrastructure/postgres/{client,bootstrap}.ts` — `pg.Pool` (max 10), `CREATE EXTENSION postgis`, `users` table with `geography(Point, 4326)` and `CREATE INDEX users_location_gist ON users USING GIST (location)`.
- `interested_in TEXT[]` (Postgres array) for symmetric `= ANY(...)` filtering both directions. Age stored as `age_min`/`age_max` columns (not a range type — keep simple, refactor when needed).

**The query (the load-bearing SQL):**
```sql
WITH center AS (
  SELECT ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography AS pt
)
SELECT u.*, ST_Distance(u.location, c.pt) / 1000.0 AS distance_km
FROM users u, center c
WHERE ST_DWithin(u.location, c.pt, $3)         -- index-friendly radius predicate
  AND u.gender = ANY($4)                       -- viewer's interestedIn ⊇ target.gender
  AND $5 = ANY(u.interested_in)                -- target's interestedIn ⊇ viewer.gender
  AND u.age BETWEEN $6 AND $7                  -- target.age ∈ viewer.ageRange
  AND $8 BETWEEN u.age_min AND u.age_max       -- viewer.age ∈ target.ageRange
  AND u.id <> $9                               -- self-exclusion
ORDER BY ST_Distance(u.location, c.pt) ASC
LIMIT $10
```

**Two architectural levers in play:**
- *Index choice*: `ST_DWithin` decomposes into a bounding-box lookup on the GIST/R-tree, *then* exact distance recheck on the shortlist. `ST_Distance(...) <= radius` would not use the index — same answer, full scan. **Use `ST_DWithin` for radius, always.**
- *Coordinate system*: `geography(POINT, 4326)` computes WGS84 great-circle distance (real km on the ellipsoid). `geometry` would do flat Euclidean — fast but wrong over long distances. Tradeoff: ~10% slower, correct.

**Contract `runFeedContract`** asserts 10 properties: empty store, radius exclusion, distance ordering, mutual gender filter (both halves), mutual age filter (both halves), limit, self-exclusion, distanceKm accuracy (±0.05 km via `expect.closeTo`). The seed step is a per-adapter callable (FeedPort itself is read-only by design).

**Result:** all 10 contract tests pass on first run, ~190ms. Full suite 34 tests across 6 files, 642ms.

## Current file tree

```
.
├── docker-compose.yml                 ← + postgres on host:5433
├── package.json                       ← + pg, @types/pg
├── pnpm-lock.yaml
├── tsconfig.json
├── vitest.config.ts
├── WIP.md
└── src/
    ├── domain/
    │   ├── match-rule.ts
    │   ├── match-rule.test.ts
    │   ├── feed-rule.ts               ← pure mutual-filter predicate
    │   ├── feed-rule.test.ts          ← 7 microsecond tests
    │   ├── types.ts                   ← + UserProfile, Gender, Location, AgeRange
    │   └── ports/
    │       ├── swipe-match-port.ts
    │       └── feed-port.ts           ← FeedPort, FeedQuery, FeedCandidate
    ├── infrastructure/
    │   ├── cassandra/
    │   │   ├── bootstrap.ts
    │   │   └── client.ts
    │   ├── redis/
    │   │   └── client.ts
    │   └── postgres/
    │       ├── bootstrap.ts           ← CREATE EXTENSION + users table + GIST
    │       └── client.ts              ← pg.Pool factory
    └── adapters/
        └── outbound/
            ├── swipe-match/
            │   ├── contract.ts
            │   ├── cassandra-naive.ts
            │   ├── cassandra-naive.test.ts
            │   ├── cassandra-lwt.ts
            │   ├── cassandra-lwt.test.ts
            │   ├── redis-lua.ts
            │   └── redis-lua.test.ts
            └── feed/
                ├── contract.ts        ← runFeedContract (10 tests)
                ├── postgres-postgis.ts
                └── postgres-postgis.test.ts
```

## Test report (current)

```
✓ src/domain/match-rule.test.ts                 (8 tests, 2ms)
✓ src/domain/feed-rule.test.ts                  (7 tests, 2ms)
✓ .../cassandra-naive.test.ts                   (3 tests, 237ms)  ← concurrency = it.fails
✓ .../cassandra-lwt.test.ts                     (3 tests, 379ms)
✓ .../redis-lua.test.ts                         (3 tests, 18ms)
✓ .../feed/postgres-postgis.test.ts             (10 tests, 214ms)
Test Files  6 passed
Tests       34 passed
```

### ✅ Increment 8 — `SeenFilterPort` (Set vs Bloom head-to-head)

Hello Interview NFR: *"avoid showing user profiles that the user has previously swiped on."* The canonical example for choosing **probabilistic over exact** data structures.

**Domain:**
- `domain/seen-filter/seen-filter-port.ts` — `add(userId, candidateId)`, `contains(userId, candidateIds): Promise<Set<UserId>>`. Returns the *seen* subset; caller filters them out.

**Two adapters, same contract:**

| Adapter | Mechanism | Memory @ 10K items | Accuracy |
|---|---|---|---|
| `redis-set` | Redis Set (`SADD` / `SMISMEMBER`) | ~500 KB / user | exact |
| `redis-bloom` | RedisBloom (`BF.INSERT` / `BF.MEXISTS`), 1% FP rate | ~12 KB / user (~40× less) | no false negatives, ≤1% false positives |

**Why bloom wins for this use case:** asymmetric error costs. False negative = user sees a profile they've already swiped (broken UX). False positive = user doesn't see a fresh candidate (one of millions — invisible). Bloom only has the second kind. ~40× memory saved.

**Contract `runSeenFilterContract`** asserts 7 invariants — empty store, empty input, no false negatives, returns subset, isolation per user, plus a `!knownLossy.falsePositives` test. Bloom adapter sets `knownLossy: { falsePositives: true }` and skips the exact-only test, satisfying 6/7. Same contract proves both adapters honor the port's promise modulo the *one* dimension bloom explicitly sacrifices.

**Infrastructure:**
- Swapped `redis:7.4-alpine` → `redis/redis-stack-server:7.4.0-v0` (superset; ships RedisBloom + RediSearch + RedisJSON).
- Each redis-using test file selects its own logical db (`db: 0` redis-lua, `db: 1` redis-set, `db: 2` redis-bloom). `FLUSHDB` is per-db, so parallel test files don't trample each other. Resolves the "test isolation strategy" open question.

**Result:** 47 tests across 8 files, 673ms. Redis-set 7/7, Redis-bloom 6/6 (skips false-positive prohibition by design).

### ✅ Increment 9 — `GetFeedUseCase`

First application-layer work. `src/use-cases/get-feed.ts`:

```ts
async execute({ viewer, center, radiusKm, limit }) {
  const candidates = await feedPort.query({...})
  if (candidates.length === 0) return []                    // skip Redis round-trip
  const seen = await seenFilter.contains(viewer.id, candidates.map(c => c.profile.id))
  return candidates.filter(c => !seen.has(c.profile.id))
}
```

6 tests in 3ms using in-memory `FeedPort` / `SeenFilterPort` fakes. By transitivity through the port contracts, this is correct against any adapter pair (PostGIS+Set, PostGIS+Bloom, future-ES+Bloom, etc).

### ✅ Increment 10 — `RecordSwipeUseCase`

`src/use-cases/record-swipe.ts`:

```ts
async execute(swipe) {
  const result = await swipeMatch.recordSwipe(swipe)
  await seenFilter.add(swipe.swiperId, swipe.targetId)   // future feeds skip them
  return result
}
```

5 tests in 7ms. Marks target seen on yes *and* no — both decisions exhaust the candidate. One-directional (swiper not added to target's seen set; if the target hasn't swiped on the swiper yet, they should still see them).

**Pyramid is now visible:**

| Layer | Tests | Time |
|---|---|---|
| Domain (pure) | 15 | 5ms |
| Use case (in-memory fakes) | 11 | 10ms |
| Adapter contracts (real DBs) | 32 | ~700ms |

58 tests across 10 files, 766ms.

## Next: Increment 11 candidates

Pick one (or vote):

**A. `FeedCachePort` (HI's "Great" tier).** Pre-compute each user's feed asynchronously into Redis (sorted set), serve from cache; recompute on cron / on profile change. Domain port: `FeedCachePort.get(userId): Promise<FeedCandidate[] | null>`. Adapters: `none` (live-only) and `redis-zset`. Use case picks cache first, falls back to live. **Highest learning density** (cache invalidation, write amplification, staleness budget).

**B. Inbound HTTP layer.** First *driving* adapter. Express/Fastify handlers calling the use cases. Now the project actually *runs*. Adds: routing, request parsing (Zod), auth-stub, error mapping. Lower system-design value but converts the project from a library into an app.

**C. Elasticsearch FeedPort (second adapter).** Prove the contract pattern by swapping PostGIS for ES. Forces the FeedPort to be honestly storage-agnostic; surfaces what ES wins (text search, weighted scoring) vs what PostGIS wins (geo accuracy, ACID). Less novel mechanically — same contract, different store.

**D. `UserRepositoryPort` and profile lifecycle.** Address the "profile writes have no port" open question. Required before HTTP because new-user signup needs a write path other than test seed.

## Open questions / things to revisit

- **Profile writes have no port yet.** `insertProfile` is a free function exported from the PostGIS adapter purely to seed contract tests. Real registration/profile-update flows will need a `UserRepositoryPort` so the FeedPort doesn't accidentally absorb writes.
- **No filter on the GIST index.** GIST is on `location` only. The `gender = ANY(...)` and age predicates are filtered after the index lookup. For uniform geographic density this is fine; for skewed cases (e.g. Manhattan, where 99% match within 1km) we'd want partial indexes or a multi-column index. Revisit if we ever measure the planner spending time on the recheck.
- **Duplicate match detection on LWT and Redis-Lua.** Concurrent reciprocal swipes can both return `{matched}`. Acceptable here because notifications de-dupe downstream. If we ever wire a synchronous "this is the moment of match" event, only the second writer should fire it — would need a claim mechanism.
- **Per-user read pattern lost on `swipe_pairs` / Redis hash keys.** Atomicity-friendly partitioning makes "show me everyone A swiped" expensive. In production we'd dual-write to a per-user index. Defer until we need the read.
- **Redis durability not characterized.** Default `appendfsync everysec` can lose up to 1s of writes on crash. For learning we don't care; for production we'd pair Redis with a durable log (Kafka / commit log replay).
- **Partial-failure semantics in `RecordSwipeUseCase`.** If `swipeMatch.recordSwipe` succeeds but `seenFilter.add` fails, the swipe is durable but the seen set hasn't been updated → user might see this profile again. Acceptable because seen-filter is best-effort (bloom already has FPs); a real fix is outbox/event-driven add. Document; don't fix yet.
- **`GetFeedUseCase` doesn't over-fetch.** Asking FeedPort for `limit=N` then filtering seen can return fewer than N. In production we'd request `limit * (1 + seenRate)` or paginate. Defer until we measure starvation.
- **Postgres-FOR-UPDATE adapter deferred.** We've already covered the three atomicity classes (CAS, single-thread, lock) by name; building the fourth concretely is rounding-out, not new ground. Revisit if we want a tidy quartet.
