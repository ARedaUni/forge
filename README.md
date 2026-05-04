# forge

A practice repo for **learning system design tradeoffs through hexagonal
architecture, TDD, and CDC-driven streaming** — shaped around a Tinder-style
swipe/match backend. The dating domain is incidental; the point is the
engineering practices.

## Thesis: hex as a substrate for studying tradeoffs

Hexagonal architecture (Cockburn) isn't the goal here — it's the *tool*. By
defining every external dependency as a port (an interface owned by the core),
this repo treats infrastructure as a knob you can turn:

- **Trivially swap databases.** Every storage concern lives behind a port.
  Unit tests run against in-memory adapters; integration tests run against the
  real thing. Want to study "what would change if we moved the feed read model
  from Cassandra to Postgres?" — write a `PostgresFeedAdapter` against the
  existing `FeedPort`, point the composition root at it, and the rest of the
  codebase doesn't move.
- **Contract tests enforce the port.** Each port has a shared contract test
  suite that every adapter must pass. The in-memory and Postgres
  implementations of `SwipeRepository` are exercised by the same tests; if a
  new adapter implements the interface but not the *behaviour*, contract tests
  fail. This is what makes the swap actually trivial — you find out at test
  time, not in production.
- **Compare implementations side by side.** Because adapters are
  interchangeable, the repo lets you reason concretely about why we picked
  Cassandra over Postgres for the feed, why Redis over Postgres for ephemeral
  rate counters, why Kafka over a synchronous fan-out for match notifications.
  The alternatives aren't hypothetical — they're one composition-root edit away.

In short: hex gives the leverage, contract tests give the safety net, and the
combination turns "what if?" questions about system design into something you
can actually run.

## What else this repo is trying to prove

- **TDD as the default.** Every behaviour change starts with a failing test.
  Tests target the architectural boundary (use cases / HTTP / adapter
  contracts), not internals. Many production files have zero tests by design.
- **Evolutionary design.** Components are added when an increment needs them —
  not pre-scaffolded for a hypothetical future. The polyglot persistence story
  earned its complexity one use case at a time.
- **CDC instead of dual-writes.** Match notifications are not produced by the
  HTTP handler. Postgres is the source of truth; Debezium streams changes to
  Kafka; downstream consumers project them into Cassandra and notification
  feeds. Writes go to one place, reads come from many.
- **Continuous delivery shape (Farley/Humble).** Two-stage CI: a fast commit
  stage that fails red in under five minutes, and an acceptance stage that runs
  integration tests against the same `docker-compose` stack used locally.

## Stack

- **Language:** TypeScript (strict mode), executed via `tsx` — no compile step yet.
- **Runtime:** Node 20+, pnpm 10.15.0.
- **HTTP:** Fastify 5.
- **Persistence:**
  - Postgres — write model (users, swipes, matches).
  - Cassandra — feed read model (denormalised candidate lists).
  - Redis — short-lived caches and rate counters.
- **Streaming:** Kafka (KRaft mode, single-node) + Debezium for Postgres CDC.
- **Auth:** JWT.
- **Observability:** Pino logging, Prometheus metrics endpoint, OpenTelemetry tracing hooks.
- **Tests:** Vitest, split into `unit` and `integration` workspace projects.

## Repository layout

```
src/
  core/                 # pure use cases, domain types, port interfaces
    auth/  feed/  match/  swipe-match/  user/  ...
  adapters/
    inbound/http/       # Fastify routes — adapter onto the HTTP port
    outbound/           # Postgres, Cassandra, Redis, Kafka adapters
  infrastructure/       # client construction (pg pool, kafka client, etc.)
  main.ts               # composition root — wires adapters into use cases
```

The arrow of dependency points inwards: adapters depend on `core`, never the
other way round. Renaming or rewriting an adapter (e.g. swapping Postgres for
SQLite in tests) does not touch `core/`.

## Getting started

Prerequisites: Node 20+, pnpm 10.15.0, Docker.

```bash
pnpm install
cp .env.example .env

# Bring up Postgres, Cassandra, Redis, Kafka, Debezium (Kafka Connect).
docker compose up -d --wait

# Register the Debezium connector against Postgres.
pnpm tsx src/infrastructure/debezium/registerConnector.ts

# Run the HTTP server with hot reload.
pnpm dev
```

The server listens on `PORT` (default `3000`). All env vars have defaults that
match `docker-compose.yml`, so the `.env` copy is optional for local runs.

### Demo script

`pnpm demo` walks two synthetic users through registration, swiping, and the
resulting match notification flowing through Debezium → Kafka → consumer.
Useful for sanity-checking the full pipeline end to end.

## Testing

```bash
pnpm test               # unit tests (in-memory adapters, fast)
pnpm test:integration   # integration tests against docker-compose services
pnpm test:all           # both
pnpm test:watch         # unit in watch mode
```

Unit tests use in-memory port implementations. Integration tests hit real
Postgres / Cassandra / Redis / Kafka instances brought up by
`docker compose up -d --wait`. **Contract tests** are shared between in-memory
and real adapters — the same suite runs against both, so a passing in-memory
test means nothing unless the real adapter passes it too.

## Linting and formatting

```bash
pnpm lint               # eslint, errors only
pnpm lint:fix
pnpm format             # prettier --write
pnpm format:check
pnpm typecheck          # tsc --noEmit
```

ESLint runs `typescript-eslint`'s `recommendedTypeChecked` preset with a few
project-specific overrides; Prettier handles style; `eslint-config-prettier`
suppresses style rules in ESLint to avoid double-reporting.

## CI pipeline

Defined in `.github/workflows/ci.yml`. Two jobs, hard dependency:

- **commit stage** (≤ 5 min budget): install, lint, format check, typecheck,
  unit tests, build the Docker image once.
- **acceptance stage** (depends on commit stage): bring up the same
  `docker-compose` services used locally, run the integration suite, tear down.

Reusing `docker-compose.yml` in CI keeps one source of truth for service
definitions — the pipeline runs against the same versions and health checks
that developers use.

There is no CD stage yet; adding one without a deployment target would be
cargo-culting.

## What's deliberately not here (yet)

- **CD / release stage.** No deployment target defined.
- **Compiled JS in the runtime image.** Currently uses `tsx` to run TypeScript
  directly. Flip `tsconfig.noEmit` and add a build step before shipping for real.
- **Acceptance tests through the running container.** Today's integration tests
  exercise adapters directly. A fuller acceptance stage would `docker run` the
  built image and exercise it through HTTP.
- **Coverage and mutation testing.** Both belong in a follow-up.
- **Pre-commit hooks.** CI is the gate; local hooks are a convenience, not a
  contract.

These are noted so the deferral is intentional, not accidental.
