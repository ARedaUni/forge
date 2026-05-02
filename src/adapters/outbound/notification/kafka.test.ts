import { randomUUID } from 'node:crypto'
import type { Consumer } from 'kafkajs'
import { createKafka } from '../../../infrastructure/kafka/client'
import {
  MatchNotificationSchema,
  type MatchNotification,
} from '../../../domain/notification/types'
import { runNotificationContract } from './contract'
import { KafkaNotificationAdapter } from './kafka'

runNotificationContract({
  name: 'kafka',
  setup: async () => {
    const topic = `notifications-${randomUUID()}`
    const kafka = createKafka(`kafka-notif-test-${randomUUID()}`)

    const admin = kafka.admin()
    await admin.connect()
    await admin.createTopics({
      topics: [{ topic, numPartitions: 3, replicationFactor: 1 }],
    })
    await admin.disconnect()

    const adapter = new KafkaNotificationAdapter(kafka, topic)
    await adapter.connect()

    const buffer: MatchNotification[] = []
    const consumer: Consumer = kafka.consumer({
      groupId: `test-${randomUUID()}`,
    })
    await consumer.connect()
    await consumer.subscribe({ topic, fromBeginning: true })
    await consumer.run({
      eachMessage: async ({ message }) => {
        if (!message.value) return
        buffer.push(
          MatchNotificationSchema.parse(
            JSON.parse(message.value.toString('utf8')),
          ),
        )
      },
    })

    return {
      adapter,
      drain: async () => {
        // Wait for a quiet window: 300ms with no new events ⇒ in-flight settled.
        const deadline = Date.now() + 5_000
        let lastCount = -1
        let lastChange = Date.now()
        while (Date.now() < deadline) {
          if (buffer.length !== lastCount) {
            lastCount = buffer.length
            lastChange = Date.now()
          } else if (
            buffer.length > 0 &&
            Date.now() - lastChange > 300
          ) {
            break
          }
          await new Promise((r) => setTimeout(r, 50))
        }
        const snapshot = buffer.slice()
        buffer.length = 0
        return snapshot
      },
      teardown: async () => {
        await consumer.disconnect()
        await adapter.disconnect()
      },
    }
  },
})
