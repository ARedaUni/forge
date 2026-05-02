import type { MatchNotification } from './types'

export interface NotificationPort {
  enqueue(event: MatchNotification): Promise<void>
}
