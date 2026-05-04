import type { MatchNotification } from './types'

export interface NotificationDeliveryPort {
  deliver(notification: MatchNotification): Promise<void>
}
