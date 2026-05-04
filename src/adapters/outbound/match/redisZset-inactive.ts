import type Redis from 'ioredis'
import type {
  ListMatchesOptions,
  MatchEntry,
  MatchPort,
} from '../../../core/match/port'
import { UserIdSchema, type UserId } from '../../../core/shared/types'

const keyFor = (userId: UserId): string => `matches:${userId}`

export class RedisZsetMatchAdapter implements MatchPort {
  constructor(private readonly redis: Redis) {}

  async recordMatch(
    userA: UserId,
    userB: UserId,
    matchedAt: Date,
  ): Promise<void> {
    const score = matchedAt.getTime()
    await Promise.all([
      this.redis.zadd(keyFor(userA), 'NX', score, userB),
      this.redis.zadd(keyFor(userB), 'NX', score, userA),
    ])
  }

  async listForUser(
    userId: UserId,
    options: ListMatchesOptions = {},
  ): Promise<MatchEntry[]> {
    const max = options.before ? `(${options.before.getTime()}` : '+inf'
    const min = '-inf'
    const key = keyFor(userId)

    let raw: string[]
    if (options.limit !== undefined) {
      raw = await this.redis.zrevrangebyscore(
        key,
        max,
        min,
        'WITHSCORES',
        'LIMIT',
        0,
        options.limit,
      )
    } else {
      raw = await this.redis.zrevrangebyscore(key, max, min, 'WITHSCORES')
    }

    const entries: MatchEntry[] = []
    for (let i = 0; i < raw.length; i += 2) {
      const member = raw[i]
      const score = raw[i + 1]
      if (member === undefined || score === undefined) continue
      entries.push({
        otherUserId: UserIdSchema.parse(member),
        matchedAt: new Date(Number(score)),
      })
    }
    return entries
  }
}
