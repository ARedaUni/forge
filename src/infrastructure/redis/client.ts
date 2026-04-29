import Redis, { type RedisOptions } from 'ioredis'

export function createRedisClient(options: RedisOptions = {}): Redis {
  return new Redis({
    host: options.host ?? '127.0.0.1',
    port: options.port ?? 6379,
    lazyConnect: options.lazyConnect ?? true,
    ...options,
  })
}
