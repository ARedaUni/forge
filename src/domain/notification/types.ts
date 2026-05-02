import { z } from 'zod'
import { UserIdSchema } from '../shared/types'

export const MatchNotificationSchema = z.object({
  type: z.literal('match'),
  userId: UserIdSchema,
  otherUserId: UserIdSchema,
  matchedAt: z.coerce.date(),
})
export type MatchNotification = z.infer<typeof MatchNotificationSchema>
