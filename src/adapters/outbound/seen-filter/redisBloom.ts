import type Redis from 'ioredis'
import type { SeenFilterPort } from '../../../domain/seen-filter/port'
import { UserIdSchema, type UserId } from '../../../domain/shared/types'

export type RedisBloomConfig = {
  capacity: number
  errorRate: number
}

const DEFAULT_CONFIG: RedisBloomConfig = {
  capacity: 10000,
  errorRate: 0.01,
}

const keyFor = (userId: UserId): string => `seen-bloom:${userId}`

export class RedisBloomSeenFilterAdapter implements SeenFilterPort {
  private readonly capacity: number
  private readonly errorRate: number

  constructor(
    private readonly redis: Redis,
    config: Partial<RedisBloomConfig> = {},
  ) {
    this.capacity = config.capacity ?? DEFAULT_CONFIG.capacity
    this.errorRate = config.errorRate ?? DEFAULT_CONFIG.errorRate
  }

  async add(userId: UserId, candidateId: UserId): Promise<void> {
    await this.redis.call(
      'BF.INSERT',
      keyFor(userId),
      'CAPACITY',
      String(this.capacity),
      'ERROR',
      String(this.errorRate),
      'ITEMS',
      candidateId,
    )
  }

  async contains(userId: UserId, candidateIds: UserId[]): Promise<Set<UserId>> {
    if (candidateIds.length === 0) return new Set()
    const flags = (await this.redis.call(
      'BF.MEXISTS',
      keyFor(userId),
      ...candidateIds,
    )) as number[]
    const result = new Set<UserId>()
    flags.forEach((flag, i) => {
      if (flag === 1) {
        const id = candidateIds[i]
        if (id !== undefined) result.add(UserIdSchema.parse(id))
      }
    })
    return result
  }
}
