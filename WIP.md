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

Each interesting port will have ≥2 adapters and a shared contract test suite.

### Ports planned

| Port | Adapters planned |
|---|---|
| `SwipeMatchPort` | cassandra-naive (broken), cassandra-lwt-sorted-pair, redis-lua, postgres-for-update |
| `FeedPort` | postgres-postgis, elasticsearch |
| `SeenFilterPort` | client-cache simulation, redis-bloom |
| `FeedCachePort` | none (live query), redis + cron warmer |

## Increments

### ✅ Increment 1 — Scaffold

- `package.json` (zod, typescript, vitest, @types/node — nothing else; deps land per increment)
- `tsconfig.json` strict, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`
- `vitest.config.ts`
- Domain types: `UserId` (branded UUID via Zod), `SwipeDecision`, `Swipe`, `Match`
- `SwipeMatchPort` interface + `SwipeResult` discriminated union (`{kind:'recorded'} | {kind:'matched', match}`)
- `.gitignore`
- No infra, no adapters, no tests yet

### ✅ Increment 2 — First port, first adapter (deliberately broken)

- `docker-compose.yml` — Cassandra 5.0 only (other services land with their adapters)
- `cassandra-driver` ^4.7.2 added; esbuild build script approved via `pnpm.onlyBuiltDependencies`
- `infrastructure/cassandra/client.ts` — `createCassandraClient()`. Connection-only, default consistency QUORUM
- `infrastructure/cassandra/bootstrap.ts` — exports `KEYSPACE` constant + `bootstrapSchema()` that creates keyspace + `swipes` table (`PRIMARY KEY (swiper_id, target_id)` — partition by swiper, the article's naive schema)
- `domain/match-rule.ts` — pure `evaluateSwipe(swipe, inverseDecision): SwipeResult`. Canonicalizes match user IDs by sort order so A→B and B→A produce the same `Match` shape
- `domain/match-rule.test.ts` — 8 unit tests (exhaustive yes/no matrix, null-inverse, ID canonicalization, matchedAt). Runs in 2ms.
- `adapters/outbound/swipe-match/cassandra-naive.ts` — implements `SwipeMatchPort`. SELECT inverse → INSERT this swipe → call `evaluateSwipe`. Trust-boundary parsing of `decision` column via `SwipeDecisionSchema.safeParse`.
- `adapters/outbound/swipe-match/cassandra-naive.test.ts` — 2 integration tests against real Cassandra (persistence + end-to-end match wiring). ~290ms.

**Status:** all 10 tests green. Adapter is functionally correct under serial use; it has a known race condition under concurrency that increment 3 will expose.

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
    │   └── cassandra/
    │       ├── bootstrap.ts
    │       └── client.ts
    └── adapters/
        └── outbound/
            └── swipe-match/
                ├── cassandra-naive.ts
                └── cassandra-naive.test.ts
```

## Test report (current)

```
✓ src/domain/match-rule.test.ts                            (8 tests, 2ms)
✓ src/adapters/.../cassandra-naive.test.ts                 (2 tests, 291ms)
Test Files  2 passed
Tests       10 passed
```

## Next: Increment 3 — Concurrency torture test (expose the race)

Write a test that:
1. Generates N user pairs (e.g., N=200)
2. Fires both reciprocal swipes (A→B and B→A) for every pair concurrently via `Promise.all`
3. Counts how many calls returned `{kind:'matched'}`
4. Asserts the count equals N (one match per pair)

Expected outcome: **the test FAILS on `CassandraNaiveSwipeMatchAdapter`** because two concurrent SELECTs both see nothing before either INSERT lands. The reported lost-match count is the experimental measurement of the race.

Once we have this failing test, it becomes the **shared contract test** that every subsequent adapter (Cassandra LWT, Redis Lua, Postgres FOR UPDATE) must pass. That's when we'll extract the contract-test pattern: each adapter's `*.test.ts` becomes a thin caller of `runSwipeMatchContract(name, setup)`.

## Open questions / things to revisit

- **Test isolation strategy.** Currently TRUNCATE between tests. Faster than DROP/CREATE; fine for single-suite work. May need per-test keyspaces if we ever parallelize integration tests across files.
- **Adapter constructor takes a `Client`, not a factory.** Lifecycle (connect/shutdown) lives in test setup. When we add an HTTP layer, application bootstrap will own the connection lifecycle.
- **`Match` schema has `userAId`/`userBId`** (canonical pair) **not** `swiperId`/`targetId`. The match is symmetric; the swipe that produced it is directional. We may add a `triggeredBy: UserId` field later if the use case needs to know who completed the match.
- **No application/use-case layer yet.** The adapter currently inlines the orchestration (read → write → decide). When we add multiple adapters and an HTTP layer, we'll likely add `RecordSwipeUseCase` as a thin caller of `port.recordSwipe`. The atomicity has to live in the adapter (otherwise we can't compose LWT or Lua atomic ops), so the use case stays thin.
