import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

// End-to-end smoke against a running stack:
//   1. docker compose up -d
//   2. pnpm start
//   3. pnpm tsx scripts/demo.ts
//
// Walks the full hexagon: auth → profile → feed → swipe → match → list,
// asserting each step. Reads the Kafka `notifications` topic at the end to
// prove the Debezium CDC pipeline produced the match events end-to-end.

// Server binds to 127.0.0.1 only — using IPv4 literal avoids Node fetch
// resolving `localhost` to ::1 and getting an empty reply.
const BASE_URL = process.env['DEMO_BASE_URL'] ?? 'http://127.0.0.1:3000'
const KAFKA_BROKERS = (process.env['KAFKA_BROKERS'] ?? 'localhost:9092').split(',')

type Json = Record<string, unknown>

async function call(
  method: string,
  path: string,
  opts: { token?: string; body?: Json } = {},
): Promise<{ status: number; body: Json }> {
  const headers: Record<string, string> = {}
  if (opts.body) headers['content-type'] = 'application/json'
  if (opts.token) headers['authorization'] = `Bearer ${opts.token}`

  const init: RequestInit = { method, headers }
  if (opts.body) init.body = JSON.stringify(opts.body)

  const res = await fetch(`${BASE_URL}${path}`, init)
  const text = await res.text()
  const body = text ? (JSON.parse(text) as Json) : {}
  return { status: res.status, body }
}

function step(n: number, title: string): void {
  console.log(`\n── step ${n}: ${title} ──`)
}

async function issueToken(userId: string): Promise<string> {
  const { status, body } = await call('POST', '/auth/token', {
    body: { userId },
  })
  assert.equal(status, 200, `issueToken: ${status} ${JSON.stringify(body)}`)
  const token = body['token']
  assert.equal(typeof token, 'string')
  return token as string
}

async function upsertProfile(token: string, profile: Json): Promise<void> {
  const { status, body } = await call('POST', '/profiles', {
    token,
    body: profile,
  })
  assert.equal(status, 201, `upsertProfile: ${status} ${JSON.stringify(body)}`)
}

type FeedCandidate = { profile: { id: string }; distanceKm: number }

async function getFeed(
  token: string,
  center: { lat: number; lng: number },
): Promise<FeedCandidate[]> {
  const { status, body } = await call('POST', '/feed', {
    token,
    body: { center, radiusKm: 50, limit: 50 },
  })
  assert.equal(status, 200, `getFeed: ${status} ${JSON.stringify(body)}`)
  return body['candidates'] as FeedCandidate[]
}

async function swipe(
  token: string,
  targetId: string,
  decision: 'yes' | 'no',
): Promise<{ kind: string }> {
  const { status, body } = await call('POST', '/swipes', {
    token,
    body: { targetId, decision },
  })
  assert.equal(status, 200, `swipe: ${status} ${JSON.stringify(body)}`)
  return body as { kind: string }
}

async function listMatches(
  token: string,
): Promise<Array<{ otherUserId: string; matchedAt: string }>> {
  const { status, body } = await call('GET', '/matches', { token })
  assert.equal(status, 200, `listMatches: ${status} ${JSON.stringify(body)}`)
  return body['matches'] as Array<{ otherUserId: string; matchedAt: string }>
}

async function readCdcEventsForPair(
  alice: string,
  bob: string,
  timeoutMs: number,
): Promise<unknown[]> {
  const { Kafka, logLevel } = await import('kafkajs')
  const kafka = new Kafka({
    clientId: `demo-${randomUUID()}`,
    brokers: KAFKA_BROKERS,
    logLevel: logLevel.NOTHING,
  })
  const consumer = kafka.consumer({ groupId: `demo-${randomUUID()}` })
  await consumer.connect()
  await consumer.subscribe({ topic: 'notifications', fromBeginning: true })

  const collected: Array<Record<string, unknown>> = []
  const isOurs = (e: Record<string, unknown>): boolean => {
    const a = e['userId']
    const b = e['otherUserId']
    return (a === alice && b === bob) || (a === bob && b === alice)
  }

  await consumer.run({
    eachMessage: async ({ message }) => {
      if (!message.value) return
      try {
        const parsed = JSON.parse(message.value.toString('utf8')) as Record<
          string,
          unknown
        >
        if (isOurs(parsed)) collected.push(parsed)
      } catch {
        // not our event
      }
    },
  })

  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline && collected.length < 2) {
    await new Promise((r) => setTimeout(r, 100))
  }
  await consumer.disconnect()
  return collected
}

async function main(): Promise<void> {
  const aliceId = randomUUID()
  const bobId = randomUUID()
  const center = { lat: 52.52, lng: 13.405 } // Berlin
  console.log(`Alice: ${aliceId}`)
  console.log(`Bob:   ${bobId}`)

  step(1, 'issue tokens for Alice and Bob')
  const aliceToken = await issueToken(aliceId)
  const bobToken = await issueToken(bobId)
  console.log('  ✓ both tokens issued')

  step(2, 'create compatible profiles (man↔woman, same city)')
  await upsertProfile(aliceToken, {
    id: aliceId,
    age: 28,
    gender: 'woman',
    interestedIn: ['man'],
    ageRange: { min: 25, max: 35 },
    location: center,
  })
  await upsertProfile(bobToken, {
    id: bobId,
    age: 30,
    gender: 'man',
    interestedIn: ['woman'],
    ageRange: { min: 25, max: 35 },
    location: { lat: 52.5, lng: 13.4 },
  })
  console.log('  ✓ both profiles upserted')

  step(3, 'Alice fetches her feed — expects to see Bob')
  const aliceFeed = await getFeed(aliceToken, center)
  const aliceSeesBob = aliceFeed.some((c) => c.profile.id === bobId)
  assert.equal(aliceSeesBob, true, `Alice's feed did not contain Bob`)
  console.log(`  ✓ Alice's feed has ${aliceFeed.length} candidate(s), Bob included`)

  step(4, 'Alice swipes yes on Bob — expects "recorded" (no inverse yet)')
  const r1 = await swipe(aliceToken, bobId, 'yes')
  assert.equal(r1.kind, 'recorded')
  console.log('  ✓ recorded')

  step(5, 'Bob swipes yes on Alice — expects "matched"')
  const r2 = await swipe(bobToken, aliceId, 'yes')
  assert.equal(r2.kind, 'matched')
  console.log('  ✓ matched')

  step(6, 'both users list their matches via GET /matches')
  const aliceMatches = await listMatches(aliceToken)
  const bobMatches = await listMatches(bobToken)
  assert.ok(
    aliceMatches.some((m) => m.otherUserId === bobId),
    `Alice's matches missing Bob`,
  )
  assert.ok(
    bobMatches.some((m) => m.otherUserId === aliceId),
    `Bob's matches missing Alice`,
  )
  console.log(`  ✓ Alice sees Bob, Bob sees Alice`)

  step(7, 'tail Kafka `notifications` for the CDC events (≤10s)')
  const events = await readCdcEventsForPair(aliceId, bobId, 10_000)
  assert.equal(
    events.length,
    2,
    `expected 2 CDC events for the pair, got ${events.length}`,
  )
  console.log(`  ✓ saw 2 MatchNotification events on Kafka:`)
  for (const e of events) console.log(`    ${JSON.stringify(e)}`)

  console.log('\n✓ end-to-end demo OK')
}

main().catch((err) => {
  console.error('\n✗ demo failed:', err)
  process.exit(1)
})
