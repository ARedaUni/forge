import { z } from 'zod'
import { UserIdSchema } from '../shared/types'

export const MatchNotificationSchema = z.object({
  type: z.literal('match'),
  userId: UserIdSchema,
  otherUserId: UserIdSchema,
  matchedAt: z.coerce.date(),
  // W3C traceparent the producer wrote on the matches row. Optional because
  // pre-14.5c rows have no value, and Debezium emits `null` for them — we
  // don't want a schema rejection to drop a real notification.
  traceContext: z.string().nullish(),
})
export type MatchNotification = z.infer<typeof MatchNotificationSchema>
