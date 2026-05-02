import type { Kafka, Producer } from 'kafkajs'
import type { NotificationPort } from '../../../domain/notification/port'
import type { MatchNotification } from '../../../domain/notification/types'

export class KafkaNotificationAdapter implements NotificationPort {
  private readonly producer: Producer

  constructor(
    kafka: Kafka,
    private readonly topic: string = 'notifications',
  ) {
    this.producer = kafka.producer({ allowAutoTopicCreation: true })
  }

  async connect(): Promise<void> {
    await this.producer.connect()
  }

  async disconnect(): Promise<void> {
    await this.producer.disconnect()
  }

  async enqueue(event: MatchNotification): Promise<void> {
    await this.producer.send({
      topic: this.topic,
      acks: 1,
      messages: [
        {
          key: event.userId,
          value: JSON.stringify(event),
        },
      ],
    })
  }
}
