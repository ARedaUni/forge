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
  private consumer: Consumer | undefined

  constructor(opts: NotificationConsumerOptions) {
    this.kafka = opts.kafka
    this.useCase = opts.useCase
    this.logger = opts.logger
    this.groupId = opts.groupId
    this.topic = opts.topic
  }

  async start(): Promise<void> {
    const consumer = this.kafka.consumer({ groupId: this.groupId })
    await consumer.connect()
    await consumer.subscribe({ topic: this.topic, fromBeginning: false })
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
    this.consumer = consumer
  }

  async stop(): Promise<void> {
    if (this.consumer) {
      await this.consumer.disconnect()
      this.consumer = undefined
    }
  }
}
