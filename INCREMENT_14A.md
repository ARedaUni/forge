# Increment 14a — naive Kafka producer (the broken baseline)

> Pedagogy mirrors cassandra-naive → cassandra-lwt: build the broken thing,
> prove it's broken with a test, fix it properly in the next increment.
> 14a is the broken version. 14b will fix it via Debezium CDC.

## Goal

Add `NotificationPort` + `KafkaNotificationAdapter`. Wire it into
`RecordSwipeUseCase` as **two separate awaits with no shared transaction**.
Then write the killer test that **proves the dual-write problem**:
inject a fault between the match write and the Kafka publish, assert the
match row landed but the Kafka topic is empty.

**Do not fix.** That's 14b's entire purpose.

## What gets added

### Infrastructure
- **Kafka** in `docker-compose.yml` — KRaft mode (no Zookeeper), single
  broker, port 9092.
- **`infrastructure/kafka/client.ts`** — KafkaJS client factory.

### Domain
- **`domain/notification/types.ts`** — `MatchNotification` Zod schema:
  `{ type: 'match', userId, otherUserId, matchedAt }`.
- **`domain/notification/port.ts`** — `NotificationPort.enqueue(event): Promise<void>`.

### Adapter
- **`adapters/outbound/notification/kafka.ts`** — `KafkaNotificationAdapter`
  implements `NotificationPort`. Produces to topic `notifications`,
  partitioned by `userId` (so per-user ordering is preserved).
- **`adapters/outbound/notification/contract.ts`** — shared contract suite
  (so a future in-memory adapter and the future CDC version can share it).

### Use case integration
- `RecordSwipeUseCase` gains a third dependency. On `{kind: 'matched'}`,
  calls `notificationPort.enqueue(...)` **twice** (once per side).
  Naive: each enqueue is its own network call, completely independent of
  the match write. **This is the bug we're documenting.**

### The killer test
- **`use-cases/recordSwipe.dualWrite.test.ts`** — uses a fault-injecting
  `NotificationPort` that throws on call. Asserts: `matchPort` shows the
  match recorded; the kafka topic drains zero events for that pair.
  The whole point of this increment.

## Design forks (recommendations adopted unless overridden)

| Fork | Decision |
|---|---|
| **A. Kafka client** | `kafkajs` — pure JS, no native deps. |
| **B. Schema format** | Plain JSON. No Avro/Schema Registry yet. |
| **C. Test isolation** | Per-file unique topic name (`notifications-${suffix}`). Topics are cheap. |
| **D. Producer acks** | Default `acks: 1`. Document that prod = `acks: -1` (all replicas). |
| **E. Test loop tax** | Assume broker is up (`docker compose up -d` once at start of session). Same model as Postgres/Cassandra/Redis today. |

## TDD sequence

1. **RED:** Test for `KafkaNotificationAdapter.enqueue` — produces, consumer reads back.
2. **GREEN:** Add Kafka to docker-compose, write the adapter, pass.
3. **REFACTOR:** Extract `runNotificationContract` for future adapters.
4. **RED:** `RecordSwipeUseCase` test — on `matched`, `notificationPort.enqueue` called twice.
5. **GREEN:** Wire `notificationPort` into `RecordSwipeUseCase`.
6. **RED — the headliner:** dual-write test. Fault-inject `NotificationPort` to throw. Assert: match exists; kafka empty.
7. **DECISION POINT:** decide what the use case does on enqueue failure today. All three options are wrong:
   - **Throw →** match exists, swipe call returns 500, client retries; idempotency saves us from duplicate matches but state is inconsistent for one round trip.
   - **Catch & log →** swipe returns success, target user never notified. **Silent data loss.**
   - **Pre-commit the kafka write →** then crash before the match commits → notification for a non-existent match.
   The lesson is that *no ordering of two unrelated writes is safe*. The fix in 14b will eliminate the second write entirely.
8. **COMMIT** as the broken baseline. Update `WIP.md` with Increment 14a section. Next session = 14b.

## Estimated time

~90 minutes if Kafka comes up cleanly. The fault-injection test is the educational climax.

## What 14b will look like (preview, not in scope)

- Add Debezium connector (Kafka Connect + postgres-source plugin) to `docker-compose.yml`.
- Set Postgres `wal_level = logical`, create publication + replication slot.
- Drop the explicit `notificationPort.enqueue` calls from the use case.
- Debezium tails the WAL — every committed `INSERT INTO matches` becomes a Kafka event automatically.
- The dual-write test from 14a now passes: there is no second write to fail.
- New test: simulate process crash *immediately after* `matchPort.recordMatch` commits, assert the event still appears in Kafka after restart (Debezium reads the WAL from its checkpoint).

## What 14c will look like (preview)

- WebSocket inbound adapter at `/ws/notifications`.
- JWT auth on the handshake (query param or first message).
- In-process connection registry: `Map<UserId, Set<WebSocket>>`.
- Kafka consumer reads the `notifications` topic and pushes to connected sockets.
- Second adapter for the dispatcher: Redis pub/sub for cross-Node fan-out (so two Node instances can each hold half the connections).
