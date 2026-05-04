import type Redis from 'ioredis'
import type { FeedExclusionPort } from '../../../core/feed-exclusion/port'
import type { UserId } from '../../../core/shared/types'

const keyFor = (viewer: UserId): string => `seen:${viewer}`

export class RedisSetFeedExclusionAdapter implements FeedExclusionPort {
  constructor(private readonly redis: Redis) {}

  async markShown(viewer: UserId, candidate: UserId): Promise<void> {
    await this.redis.sadd(keyFor(viewer), candidate)
  }

  async excludeSeen(viewer: UserId, candidates: UserId[]): Promise<UserId[]> {
    if (candidates.length === 0) return []
    const flags = await this.redis.smismember(keyFor(viewer), ...candidates)
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
