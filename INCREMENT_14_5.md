# Increment 14.5 — Observability foundation

> Bolt on the SRE story now that 14b has shipped. Sequenced so each piece is
> justified by something already in the code, not a hypothetical future need.
> Architecture chosen to match what Monzo / Netflix / Stripe / Uber actually
> ship: one shared library called directly from app code, no per-service
> wrapping. The only port we add is `Logger`.

## Architecture decision

| Concern | Port? | Why |
|---|---|---|
| Logger | yes | real dep, swap to in-memory in tests, Pino/Winston don't share an API |
| Tracing (OTel) | no | OTel API is already the abstraction; wrapping loses context propagation |
| Metrics (prom-client) | no port + thin domain helper module | centralises label cardinality without inventing a `MetricsPort` |
| Health checks | yes | each adapter exposes `ping()`; `/readyz` aggregates |

**Wide-events school (Majors / Sigelman / Morrell):** the request span is the
unit of telemetry. One root span per request, enriched with attributes as
work progresses; logs and metrics derive from the same dimensions. Use cases
stay free of observability imports — the HTTP adapter enriches the active
span/log from use-case results via `currentLogger()` and (14.5c)
`enrichRequest()`, both backed by `AsyncLocalStorage` / OTel context.

---

## 14.5a — Logger port + livez/readyz

- `domain/observability/logger.ts` — `Logger` port (`info/warn/error/debug`).
- `adapters/outbound/logger/pino.ts` — Pino adapter.
- `adapters/outbound/logger/inMemory.ts` — capturing test adapter.
- `infrastructure/observability/requestContext.ts` — `AsyncLocalStorage` +
  `runWithLogger` / `currentLogger` helpers.
- HTTP `onRequest` hook: mint `reqId`, build child logger, run handler inside
  ALS context. Replace default Fastify logger.
- `GET /livez` → `200 {status:"ok"}`, no dep checks.
- `GET /readyz` → parallel `HealthCheck[]` with timeout; `503` if any
  *critical* dep down. Kafka/Debezium explicitly **not critical**.
- Add `ping()` to Postgres / Cassandra / Redis infra clients.
- `docker-compose.yml`: add `healthcheck` on the app service hitting `/livez`.

## 14.5b — Metrics

- `infrastructure/observability/metrics.ts` — prom-client `Registry` +
  domain-named helpers (`recordSwipeOutcome`, `recordHttpRequest`, etc.).
- Fastify hook: per-route latency histogram, status-code counter.
- Per-adapter: histogram around outbound calls (cassandra/pg/redis).
- `GET /metrics` (public, no auth) returns Prometheus text format.

## 14.5c — Tracing (wide-events school)

Following Majors / Sigelman / Morrell: **the request span is the wide event**.
One root span per request, enriched with high-cardinality attributes as work
progresses. No child spans for in-process business steps — those become
attributes on the root. Cross-cutting stays external: use cases never import
the tracer.

- `infrastructure/observability/otel.ts` — SDK init, **must run before any
  app import**. Auto-instrumentations: Fastify, pg, ioredis, cassandra-driver,
  kafkajs. Auto-instrumentation handles all I/O child spans for free.
- `docker-compose.yml`: add Jaeger (OTLP receiver + UI on 16686).
- `infrastructure/observability/requestContext.ts` — extend with
  `enrichRequest(attrs)` helper that calls `setAttributes` on the root span
  pinned to OTel context (`MAIN_SPAN_CONTEXT_KEY` pattern). Mirrors the
  existing `currentLogger()` indirection.
- HTTP `onResponse` hook stamps domain attributes from the use-case result
  (`swipe.decision`, `swipe.matched`, `feed.candidates_returned`, `user.id`,
  etc.). Use cases stay pure — adapter does the enrichment.
- HTTP `onResponse` hook also emits a **canonical log line**: one info-level
  record per request with route, status, duration, userId, db ms, error
  class. Same fields as the root span attributes. Brandur-style fallback
  visibility when Jaeger is down.
- Pino mixin: stamp `traceId` / `spanId` from `trace.getActiveSpan()` into
  every log line → log↔trace correlation.
- Trace-context column on `matches` row (**required, not stretch**) so the
  Debezium → Kafka hop joins the same trace. Without it the async unit of
  work is severed from its trace — breaks the single-source-of-truth
  invariant the wide-events model depends on.

Span naming follows OTel `{verb} {object}` low-cardinality rule: `record
swipe`, never `record_swipe_<userId>`. IDs go in attributes only.

## 14.5d — Prometheus + Grafana

- `docker-compose.yml`: add Prometheus (scraping `/metrics`) + Grafana.
- `ops/prometheus.yml` — scrape config.
- `ops/grafana/dashboards/app.json` — committed dashboard: RED per route,
  per-dep latency, swipe-outcome counts.

---

## TDD order inside 14.5a

1. RED: `Logger` port contract — in-memory adapter records calls.
2. RED: Fastify hook attaches a `reqId`-tagged child logger per request.
3. RED: ALS bridge — `currentLogger()` inside an awaited handler returns
   the request-scoped child.
4. RED: `GET /livez` → 200, no dep calls.
5. RED: `GET /readyz` → 200 with all-up status when every check resolves.
6. RED: `GET /readyz` → 503 when a critical check rejects.
7. RED: `GET /readyz` → 503 when a critical check exceeds timeout.
8. RED: `GET /readyz` → 200 when only a non-critical check fails.
9. Wire concrete pings (pg `SELECT 1`, redis `PING`, cassandra `SELECT now()`)
   in `main.ts`.
10. Add Docker `healthcheck` on app service.

## Estimated time

~90 min for 14.5a. 14.5b–d are separate sessions.
