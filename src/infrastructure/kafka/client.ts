import { Kafka, logLevel } from 'kafkajs'

export type KafkaConfig = {
  brokers: string[]
}

export const defaultKafkaConfig: KafkaConfig = {
  brokers: (process.env['KAFKA_BROKERS'] ?? 'localhost:9092').split(','),
}

export function createKafka(
  clientId: string,
  config: KafkaConfig = defaultKafkaConfig,
): Kafka {
  return new Kafka({
    clientId,
    brokers: config.brokers,
    logLevel: logLevel.NOTHING,
  })
}
