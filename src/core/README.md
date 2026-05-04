# `core/` — inside of the hexagon

The application core: driven port interfaces, wire schemas, value
types, and the few pure rules that the use-case layer composes.

This is **not** an Evans-DDD domain layer. There are no Entities,
Aggregates, or rich domain objects — invariants live in Zod schemas
and behavior lives in use cases. The folder is named for what it is:
the inside of a hexagonal architecture (Cockburn 2005).

## Two shapes coexist

### Pure rules

Stateless functions over plain data, exercised by their own unit tests
and called from the use-case layer.

- `feed/feedRule.ts` — `matchesFilters` (mutual gender + age compatibility)
- `swipe-match/matchRule.ts` — `evaluateSwipe` (mutual-yes → match)

### Driven ports

Interfaces (and sometimes a wire schema or value type) that the
use-case layer depends on. Adapters in `src/adapters/outbound/` provide
implementations.

- `auth/` — `AuthPort` (`issueCredential` / `verifyCredential`)
- `feed/` — `FeedPort`
- `feed-exclusion/` — `FeedExclusionPort` (`markShown` / `excludeSeen`)
- `match/` — `MatchPort` (`recordMatch` / `listForUser`)
- `notification/` — `NotificationDeliveryPort` + `MatchNotificationSchema`
- `swipe-match/` — `SwipeMatchPort`
- `user/` — `UserRepositoryPort` + `UserProfileSchema`
- `observability/` — `Logger`, `HealthCheck`
- `shared/` — primitives (`UserIdSchema`)

## The single rule for every port

> *Does this interface expose what the **application** needs, or how
> the **infrastructure** works?*

A port that says `upsert`, `contains`, `findById`, `add`, or `issueToken`
is naming the storage / protocol. Rename to what the application
actually wants: `save`, `excludeSeen`, `load`, `markShown`,
`issueCredential`. A port that returns `Set<UserId>` because that is
what a Bloom filter naturally yields is leaking the storage shape —
return what the caller will use.

If a port grows real behavior, the rule file sits alongside `port.ts`
in the same folder; the layout does not change.
