import type { Consumer, Kafka } from 'kafkajs'
import { MatchNotificationSchema } from '../../../core/notification/types'
import type { Logger } from '../../../core/observability/logger'
import type { DeliverMatchNotificationUseCase } from '../../../use-cases/deliverMatchNotification'

export type NotificationConsumerOptions = {
  kafka: Kafka
  useCase: DeliverMatchNotificationUseCase
  logger: Logger
  groupId: string
  topic: string
  // Defaults to false (start at "latest"), which is correct for production:
  // each new consumer group should pick up new traffic, not replay history.
  // Set to true for tests against a fresh topic, where the alternative —
  // KafkaJS's offset-reset-to-latest racing with the first produced message
  // — silently drops messages.
  fromBeginning?: boolean
}

// Inbound (driving) adapter — Kafka events drive the application via the
// DeliverMatchNotificationUseCase. Symmetric with HTTP adapters: transport in,
// use case out.
//
// Failure semantics (v1): malformed payloads and downstream errors are logged
// and skipped — Kafka commits the offset and we move on. Trades at-least-once
// delivery for liveness; revisit when retry/DLQ is actually needed.
// TODO: introduce retry / DLQ in a later increment.
export class NotificationConsumer {
  private readonly kafka: Kafka
  private readonly useCase: DeliverMatchNotificationUseCase
  private readonly logger: Logger
  private readonly groupId: string
  private readonly topic: string
  private readonly fromBeginning: boolean
  private consumer: Consumer | undefined

  constructor(opts: NotificationConsumerOptions) {
    this.kafka = opts.kafka
    this.useCase = opts.useCase
    this.logger = opts.logger
    this.groupId = opts.groupId
    this.topic = opts.topic
    this.fromBeginning = opts.fromBeginning ?? false
  }

  async start(): Promise<void> {
    const consumer = this.kafka.consumer({ groupId: this.groupId })
    await consumer.connect()
    await consumer.subscribe({ topic: this.topic, fromBeginning: this.fromBeginning })

    // `consumer.run()` is fire-and-forget — it returns once `eachMessage` is
    // registered, but the consumer may not yet have joined the group or been
    // assigned partitions (KafkaJS issue tulios/kafkajs#1629). If a producer
    // writes a message in that window, the "latest" offset reset can skip it.
    // Wait for GROUP_JOIN so callers can rely on `start()` resolving only when
    // the consumer is genuinely ready to receive — its payload includes
    // `memberAssignment`, so partition assignment is part of this signal.
    const groupJoined = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('NotificationConsumer.start: GROUP_JOIN timed out'))
      }, 30_000)
      const remove = consumer.on(consumer.events.GROUP_JOIN, () => {
        clearTimeout(timeout)
        remove()
        resolve()
      })
    })

    await consumer.run({
      eachMessage: async ({ message }) => {
        if (!message.value) return
        const raw = message.value.toString('utf8')

        let json: unknown
        try {
          json = JSON.parse(raw)
        } catch (err) {
          this.logger.warn('notification-consumer.parse-failed', {
            error: (err as Error).message,
            raw,
          })
          return
        }

        const parsed = MatchNotificationSchema.safeParse(json)
        if (!parsed.success) {
          this.logger.warn('notification-consumer.schema-violation', {
            issues: parsed.error.issues,
          })
          return
        }

        try {
          await this.useCase.execute(parsed.data)
        } catch (err) {
          this.logger.error('notification-consumer.delivery-failed', {
            error: (err as Error).message,
            userId: parsed.data.userId,
            otherUserId: parsed.data.otherUserId,
          })
        }
      },
    })

    await groupJoined
    this.consumer = consumer
  }

  async stop(): Promise<void> {
    if (this.consumer) {
      await this.consumer.disconnect()
      this.consumer = undefined
    }
  }
}
