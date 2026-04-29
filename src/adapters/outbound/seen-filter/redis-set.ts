import type Redis from 'ioredis'
import type { SeenFilterPort } from '../../../domain/seen-filter/seen-filter-port'
import { UserIdSchema, type UserId } from '../../../domain/shared/types'

const keyFor = (userId: UserId): string => `seen:${userId}`

export class RedisSetSeenFilterAdapter implements SeenFilterPort {
  constructor(private readonly redis: Redis) {}

  async add(userId: UserId, candidateId: UserId): Promise<void> {
    await this.redis.sadd(keyFor(userId), candidateId)
  }

  async contains(userId: UserId, candidateIds: UserId[]): Promise<Set<UserId>> {
    if (candidateIds.length === 0) return new Set()
    const flags = await this.redis.smismember(keyFor(userId), ...candidateIds)
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
