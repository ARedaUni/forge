# UI — Tier 2 visualization dashboard (deferred)

A single-page admin UI to **see and switch** the system-design tradeoffs we've built. Not a user-facing Tinder UI — this is an SRE-style control panel that makes the hexagonal architecture's lessons visceral.

## The headliner demo (the reason this UI exists)

> 1. Switch `SwipeMatchPort` → `cassandra-naive`
> 2. Click "Fire 200 reciprocals"
> 3. Match counter: **0 / 200**. Lost-update race exposed.
> 4. Switch → `cassandra-lwt`. Click again. **200 / 200**. ~2ms slower per call (Paxos cost).
> 5. Switch → `redis-lua`. Click again. **200 / 200**. ~15× faster than LWT.
>
> Same demo for bloom-vs-set memory; same for (future) cache hit-rate; same for (future) outbox lag.

## Layout (one page)

```
┌─────────────────────────────────────────────────────────────────────┐
│  Wiring                                                              │
│  FeedPort: [postgres-postgis ▾]   SeenFilter: [redis-bloom ▾]       │
│  SwipeMatch: [cassandra-lwt ▾]    Match: [postgres ▾]                │
│  UserRepo: [postgres ▾]           Auth: [jwt ▾]                      │
├──────────────┬──────────────────────────────┬────────────────────────┤
│ Demo         │ Live results                 │ Metrics                │
│ ─────────    │ ──────────────────           │ ─────────────          │
│ [Seed 100]   │ {                            │ p50/p95/p99 per port   │
│ [Seed 1000]  │   matched: 200 / 200,        │ (sparkline, last 100)  │
│              │   timeMs: 412                │                        │
│ Reciprocals: │ }                            │ SeenFilter memory:     │
│ [Fire K=200] │                              │   bloom: 12 KB         │
│              │ Last feed query:             │   set:   500 KB        │
│ Feed:        │   3 candidates, 18ms         │                        │
│ [Run query]  │                              │ Active connections     │
│              │                              │ pg: 4  redis: 1  cas:1 │
│ Swipe:       │                              │                        │
│ [yes/no]     │                              │                        │
├──────────────┴──────────────────────────────┴────────────────────────┤
│ Timeline (last 20 ops)                                               │
│ 12:04:31  POST /swipes  → Cassandra(LWT) 4ms, Redis(Bloom) <1ms,    │
│                          Postgres(Match) 2ms                         │
│ 12:04:30  POST /feed    → Postgres(PostGIS) 18ms, Redis(Bloom) 1ms  │
└─────────────────────────────────────────────────────────────────────┘
```

## Backend additions required

All under an `/admin/*` namespace, gated by env flag.

1. **Wiring registry** — refactor `main.ts` so adapters live in a mutable `Wiring` object handlers read from per-request, not captured constants. ~30 lines, but one-way door (rethink test seams).
2. `POST /admin/wiring` — `{ port, adapter }` swaps the registry entry.
3. `POST /admin/seed` — generates N profiles with realistic geographic distribution.
4. `POST /admin/fire-reciprocals` — runs K concurrent reciprocal pairs, returns `{ fired, matched, durationMs, perCallLatency: number[] }`.
5. `GET /admin/metrics` — in-process latency ring buffer (last 100 per port) + memory probes (`BF.INFO`, `pg_relation_size`, `SCARD * MEMORY USAGE`).
6. **Adapter timing wrapper** — decorator that wraps each port impl with `performance.now()` deltas. Pure decoration, no domain change.

## Frontend stack

- Vite + React + TypeScript + Tailwind (boring, fast).
- Charts: **uPlot** (tiny, snappy — these update per-click).
- No router, no state library. `useState` + a tiny fetch hook.
- Lives in `frontend/` at repo root, separate `package.json`, dev server on 5173 proxying `/api/*` → Fastify 3000.

## What this unlocks for future increments

Each new increment becomes a **new switch or gauge** in the UI:

| Increment | UI addition |
|---|---|
| 14a (outbox) | "Outbox lag" gauge: rows queued vs dispatched, p99 enqueue→send |
| 14b (WebSocket) | "Connected sockets" counter; "deliver" button to push a fake notification |
| 14c (LISTEN/NOTIFY) | Toggle relay: polling vs LISTEN; watch lag drop from ~500ms to ~10ms |
| 15 (ES feed) | FeedPort switch gains `elasticsearch` option; latency comparison chart |
| 16 (cache) | "Cache hit rate" gauge; toggle `cached: on/off`; watch p99 |

The UI is **leverage** — build once, every subsequent system-design lesson visualizes for free.

## When to build

After Increment 14a is committed. By then we'll have outbox lag as a brand-new metric, and the wiring registry refactor in 14a (if we do live re-wiring there) overlaps with what the UI needs.

## Open questions to resolve before building

1. Live re-wiring or "restart with new env"? Live is sexier; restart is honest about prod constraints. Recommend **live**, gated to admin/dev only.
2. Persist metrics across server restarts? Probably no — keep them in-memory, accept the loss on restart. Avoids needing yet another store.
3. Auth on admin endpoints — same JWT? A separate admin token? Recommend separate `ADMIN_TOKEN` env var, header-checked.
