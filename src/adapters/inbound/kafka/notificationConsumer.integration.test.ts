import { randomUUID } from 'node:crypto'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { InMemoryNotificationDeliveryAdapter } from '../../outbound/notification/inMemory'
import { MatchNotificationSchema } from '../../../core/notification/types'
import type { LogFields, Logger } from '../../../core/observability/logger'
import { UserIdSchema } from '../../../core/shared/types'
import { createKafka } from '../../../infrastructure/kafka/client'
import { DeliverMatchNotificationUseCase } from '../../../use-cases/deliverMatchNotification'
import { NotificationConsumer } from './notificationConsumer'

// Use a per-run topic so prior CDC tests (which write to the production
// `notifications` topic) don't bleed messages into this consumer's view.
// `fromBeginning: false` should make new consumer groups skip pre-existing
// messages, but KafkaJS's offset-reset has timing races during partition
// assignment that we don't need to fight here — give each run a fresh topic.
const TOPIC = `notifications-consumer-test-${randomUUID()}`

const A = UserIdSchema.parse(randomUUID())
const B = UserIdSchema.parse(randomUUID())

const sampleNotification = MatchNotificationSchema.parse({
  type: 'match',
  userId: A,
  otherUserId: B,
  matchedAt: new Date('2026-05-03T12:00:00Z'),
})

type Logged = {
  level: 'debug' | 'info' | 'warn' | 'error'
  message: string
  fields: LogFields | undefined
}

const captureLogger = (): { lines: Logged[]; logger: Logger } => {
  const lines: Logged[] = []
  const logger: Logger = {
    debug: (message, fields) => lines.push({ level: 'debug', message, fields }),
    info: (message, fields) => lines.push({ level: 'info', message, fields }),
    warn: (message, fields) => lines.push({ level: 'warn', message, fields }),
    error: (message, fields) => lines.push({ level: 'error', message, fields }),
    child: () => logger,
  }
  return { lines, logger }
}

describe('NotificationConsumer', () => {
  const kafka = createKafka(`consumer-test-${randomUUID()}`)
  const consumers: NotificationConsumer[] = []

  beforeAll(async () => {
    const admin = kafka.admin()
    await admin.connect()
    await admin
      .createTopics({
        topics: [{ topic: TOPIC, numPartitions: 3, replicationFactor: 1 }],
      })
      .catch(() => {})
    await admin.disconnect()
  }, 30_000)

  afterEach(async () => {
    while (consumers.length > 0) {
      const c = consumers.pop()
      if (c) await c.stop()
    }
  })

  const produce = async (value: string): Promise<void> => {
    const producer = kafka.producer()
    await producer.connect()
    await producer.send({
      topic: TOPIC,
      messages: [{ key: null, value }],
    })
    await producer.disconnect()
  }

  it('parses messages off the topic and dispatches them through the use case', async () => {
    const delivery = new InMemoryNotificationDeliveryAdapter()
    const useCase = new DeliverMatchNotificationUseCase(delivery)
    const { logger } = captureLogger()
    const consumer = new NotificationConsumer({
      kafka,
      useCase,
      logger,
      groupId: `consumer-test-${randomUUID()}`,
      topic: TOPIC,
    })
    consumers.push(consumer)

    await consumer.start()
    await produce(JSON.stringify(sampleNotification))

    const deadline = Date.now() + 10_000
    while (Date.now() < deadline && delivery.delivered.length === 0) {
      await new Promise((r) => setTimeout(r, 50))
    }

    expect(delivery.delivered).toHaveLength(1)
    expect(delivery.delivered[0]).toMatchObject({
      type: 'match',
      userId: A,
      otherUserId: B,
    })
  }, 30_000)

  it('logs and skips malformed messages without crashing the consumer', async () => {
    const delivery = new InMemoryNotificationDeliveryAdapter()
    const useCase = new DeliverMatchNotificationUseCase(delivery)
    const { lines, logger } = captureLogger()
    const consumer = new NotificationConsumer({
      kafka,
      useCase,
      logger,
      groupId: `consumer-test-${randomUUID()}`,
      topic: TOPIC,
    })
    consumers.push(consumer)

    await consumer.start()
    await produce('this-is-not-json')
    await produce(JSON.stringify(sampleNotification))

    const deadline = Date.now() + 10_000
    while (Date.now() < deadline && delivery.delivered.length === 0) {
      await new Promise((r) => setTimeout(r, 50))
    }

    expect(delivery.delivered).toHaveLength(1)
    expect(lines.some((l) => l.level === 'warn')).toBe(true)
  }, 30_000)

  it('logs and skips when the use case throws (does not crash consumer)', async () => {
    const failing = new DeliverMatchNotificationUseCase({
      deliver: async () => {
        throw new Error('downstream is sad')
      },
    })
    const { lines, logger } = captureLogger()
    const consumer = new NotificationConsumer({
      kafka,
      useCase: failing,
      logger,
      groupId: `consumer-test-${randomUUID()}`,
      topic: TOPIC,
    })
    consumers.push(consumer)

    await consumer.start()
    await produce(JSON.stringify(sampleNotification))

    const deadline = Date.now() + 10_000
    while (Date.now() < deadline && !lines.some((l) => l.level === 'error')) {
      await new Promise((r) => setTimeout(r, 50))
    }

    expect(lines.some((l) => l.level === 'error')).toBe(true)
  }, 30_000)
})
