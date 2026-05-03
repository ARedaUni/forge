import type Redis from 'ioredis'
import type { FeedExclusionPort } from '../../../domain/feed-exclusion/port'
import type { UserId } from '../../../domain/shared/types'

export type RedisBloomConfig = {
  capacity: number
  errorRate: number
}

const DEFAULT_CONFIG: RedisBloomConfig = {
  capacity: 10000,
  errorRate: 0.01,
}

const keyFor = (viewer: UserId): string => `seen-bloom:${viewer}`

export class RedisBloomFeedExclusionAdapter implements FeedExclusionPort {
  private readonly capacity: number
  private readonly errorRate: number

  constructor(
    private readonly redis: Redis,
    config: Partial<RedisBloomConfig> = {},
  ) {
    this.capacity = config.capacity ?? DEFAULT_CONFIG.capacity
    this.errorRate = config.errorRate ?? DEFAULT_CONFIG.errorRate
  }

  async markShown(viewer: UserId, candidate: UserId): Promise<void> {
    await this.redis.call(
      'BF.INSERT',
      keyFor(viewer),
      'CAPACITY',
      String(this.capacity),
      'ERROR',
      String(this.errorRate),
      'ITEMS',
      candidate,
    )
  }

  async excludeSeen(viewer: UserId, candidates: UserId[]): Promise<UserId[]> {
    if (candidates.length === 0) return []
    const flags = (await this.redis.call(
      'BF.MEXISTS',
      keyFor(viewer),
      ...candidates,
    )) as number[]
    const unseen: UserId[] = []
    flags.forEach((flag, i) => {
      if (flag !== 1) {
        const id = candidates[i]
        if (id !== undefined) unseen.push(id)
      }
    })
    return unseen
  }
}
