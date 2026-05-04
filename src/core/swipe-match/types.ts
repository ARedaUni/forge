import { z } from 'zod'
import { UserIdSchema } from '../shared/types'

export const SwipeDecisionSchema = z.enum(['yes', 'no'])
export type SwipeDecision = z.infer<typeof SwipeDecisionSchema>

export const SwipeSchema = z.object({
  swiperId: UserIdSchema,
  targetId: UserIdSchema,
  decision: SwipeDecisionSchema,
  createdAt: z.date(),
})
export type Swipe = z.infer<typeof SwipeSchema>

export const MatchSchema = z.object({
  userAId: UserIdSchema,
  userBId: UserIdSchema,
  matchedAt: z.date(),
})
export type Match = z.infer<typeof MatchSchema>
