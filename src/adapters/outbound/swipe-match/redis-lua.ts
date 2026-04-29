import type Redis from 'ioredis'
import { evaluateSwipe } from '../../../domain/match-rule'
import type { SwipeMatchPort, SwipeResult } from '../../../domain/ports/swipe-match-port'
import { SwipeDecisionSchema, type Swipe, type SwipeDecision, type UserId } from '../../../domain/types'

const SCRIPT = `
local swiper = ARGV[1]
local low = ARGV[2]
local decision = ARGV[3]

local field
local inverse_field
if swiper == low then
  field = 'low'
  inverse_field = 'high'
else
  field = 'high'
  inverse_field = 'low'
end

redis.call('HSET', KEYS[1], field, decision)
local inverse = redis.call('HGET', KEYS[1], inverse_field)
if inverse == false then return nil end
return inverse
`

export class RedisLuaSwipeMatchAdapter implements SwipeMatchPort {
  constructor(private readonly client: Redis) {}

  async recordSwipe(swipe: Swipe): Promise<SwipeResult> {
    let lowId: UserId
    let highId: UserId
    if (swipe.swiperId < swipe.targetId) {
      lowId = swipe.swiperId
      highId = swipe.targetId
    } else {
      lowId = swipe.targetId
      highId = swipe.swiperId
    }

    const key = `swipe:${lowId}:${highId}`
    const raw = await this.client.eval(SCRIPT, 1, key, swipe.swiperId, lowId, swipe.decision)

    const inverseDecision = parseInverseDecision(raw)
    return evaluateSwipe(swipe, inverseDecision)
  }
}

function parseInverseDecision(raw: unknown): SwipeDecision | null {
  if (raw === null || raw === undefined) return null
  const parsed = SwipeDecisionSchema.safeParse(raw)
  if (parsed.success) return parsed.data
  return null
}
