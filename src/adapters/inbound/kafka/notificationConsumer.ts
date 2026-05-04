import {
  ROOT_CONTEXT,
  SpanKind,
  propagation,
  trace,
  type Link,
} from '@opentelemetry/api'
import type { Consumer, Kafka } from 'kafkajs'
import {
  MatchNotificationSchema,
  type MatchNotification,
} from '../../../core/notification/types'
import type { Logger } from '../../../core/observability/logger'
import type { DeliverMatchNotificationUseCase } from '../../../use-cases/deliverMatchNotification'

const tracer = trace.getTracer('notification-consumer')

// OTel messaging semconv: when a queue/CDC hop separates producer from
// consumer, model the relationship as a span LINK, not parent-child. The
// producer span is long closed by the time the consumer fires, so nesting
// would distort durations. We extract the W3C traceparent the producer wrote
// onto the matches row (carried through Debezium as a regular field) and
// attach it as a link on the consumer span.
function linksFromNotification(n: MatchNotification): Link[] {
  if (!n.traceContext) return []
  const carrier: Record<string, string> = { traceparent: n.traceContext }
  const ctx = propagation.extract(ROOT_CONTEXT, carrier)
  const spanContext = trace.getSpanContext(ctx)
  if (!spanContext) return []
  return [{ context: spanContext }]
}

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

        await tracer.startActiveSpan(
          'process match notification',
          { kind: SpanKind.CONSUMER, links: linksFromNotification(parsed.data) },
          async (span) => {
            span.setAttribute('messaging.system', 'kafka')
            span.setAttribute('messaging.destination.name', this.topic)
            span.setAttribute('user.id', parsed.data.userId)
            try {
              await this.useCase.execute(parsed.data)
            } catch (err) {
              this.logger.error('notification-consumer.delivery-failed', {
                error: (err as Error).message,
                userId: parsed.data.userId,
                otherUserId: parsed.data.otherUserId,
              })
              span.recordException(err as Error)
            } finally {
              span.end()
            }
          },
        )
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
