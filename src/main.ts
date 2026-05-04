import { createServer } from './adapters/inbound/http/server'
import { NotificationConsumer } from './adapters/inbound/kafka/notificationConsumer'
import { JwtAuthAdapter } from './adapters/outbound/auth/jwt'
import { PinoLoggerAdapter } from './adapters/outbound/logger/pino'
import type { HealthCheck } from './core/observability/healthCheck'
import { PostgresPostGisFeedAdapter } from './adapters/outbound/feed/postgresPostgis'
import { PostgresMatchAdapter } from './adapters/outbound/match/postgres'
import { LoggingNotificationDeliveryAdapter } from './adapters/outbound/notification/logging'
import { RedisBloomFeedExclusionAdapter } from './adapters/outbound/feed-exclusion/redisBloom'
import { CassandraLwtSwipeMatchAdapter } from './adapters/outbound/swipe-match/cassandraLwt'
import { PostgresUserRepositoryAdapter } from './adapters/outbound/user/postgres'
import { bootstrapSchema as bootstrapCassandra } from './infrastructure/cassandra/bootstrap'
import { createCassandraClient } from './infrastructure/cassandra/client'
import { registerMatchesConnector } from './infrastructure/debezium/registerConnector'
import { createKafka } from './infrastructure/kafka/client'
import { bootstrapPostgres } from './infrastructure/postgres/bootstrap'
import { createPostgresPool } from './infrastructure/postgres/client'
import { createRedisClient } from './infrastructure/redis/client'
import { DeliverMatchNotificationUseCase } from './use-cases/deliverMatchNotification'
import { GetFeedUseCase } from './use-cases/getFeed'
import { ListMatchesUseCase } from './use-cases/listMatches'
import { RecordSwipeUseCase } from './use-cases/recordSwipe'

async function main(): Promise<void> {
  const pool = createPostgresPool()
  await bootstrapPostgres(pool)

  // Match notifications are produced by Debezium reading the Postgres WAL —
  // the application never writes to Kafka directly. This eliminates the
  // dual-write hazard that 14a documented.
  const connectUrl = process.env['CONNECT_URL'] ?? 'http://localhost:8083'
  await registerMatchesConnector(connectUrl)

  const redis = createRedisClient({ db: 0 })
  await redis.connect()

  const cassandra = createCassandraClient()
  await cassandra.connect()
  await bootstrapCassandra(cassandra)

  const feedPort = new PostgresPostGisFeedAdapter(pool)
  const userRepo = new PostgresUserRepositoryAdapter(pool)
  const matchPort = new PostgresMatchAdapter(pool)
  const feedExclusion = new RedisBloomFeedExclusionAdapter(redis, {
    capacity: 10000,
    errorRate: 0.01,
  })
  const swipeMatch = new CassandraLwtSwipeMatchAdapter(cassandra)

  const getFeed = new GetFeedUseCase(feedPort, feedExclusion)
  const recordSwipe = new RecordSwipeUseCase(swipeMatch, feedExclusion, matchPort)
  const listMatches = new ListMatchesUseCase(matchPort)
  const authPort = new JwtAuthAdapter({
    secret: process.env['JWT_SECRET'] ?? 'change-me-in-production',
  })

  const logger = new PinoLoggerAdapter({ level: process.env['LOG_LEVEL'] ?? 'info' })

  // Inbound consumer for the `notifications` topic Debezium produces. Closes
  // the CDC loop: row → WAL → Kafka → consumer → delivery (logging for now).
  const kafka = createKafka(process.env['KAFKA_CLIENT_ID'] ?? 'tinderclone')
  const notificationDelivery = new LoggingNotificationDeliveryAdapter(
    logger.child({ component: 'notification-delivery' }),
  )
  const deliverMatchNotification = new DeliverMatchNotificationUseCase(
    notificationDelivery,
  )
  const notificationConsumer = new NotificationConsumer({
    kafka,
    useCase: deliverMatchNotification,
    logger: logger.child({ component: 'notification-consumer' }),
    groupId: process.env['NOTIFICATION_CONSUMER_GROUP'] ?? 'tinderclone-notifications',
    topic: 'notifications',
  })
  await notificationConsumer.start()

  const healthChecks: HealthCheck[] = [
    {
      name: 'postgres',
      critical: true,
      check: async () => { await pool.query('SELECT 1') },
    },
    {
      name: 'redis',
      critical: true,
      check: async () => { await redis.ping() },
    },
    {
      name: 'cassandra',
      critical: true,
      check: async () => { await cassandra.execute('SELECT now() FROM system.local') },
    },
  ]

  const server = createServer({
    getFeed,
    recordSwipe,
    listMatches,
    userRepo,
    authPort,
    logger,
    healthChecks,
  })

  const port = Number(process.env['PORT'] ?? 3000)
  await server.listen({ port, host: '127.0.0.1' })

  const shutdown = async (): Promise<void> => {
    await server.close()
    await notificationConsumer.stop()
    await redis.quit()
    await cassandra.shutdown()
    await pool.end()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
