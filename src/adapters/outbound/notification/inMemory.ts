import type { NotificationDeliveryPort } from '../../../core/notification/port'
import type { MatchNotification } from '../../../core/notification/types'

export class InMemoryNotificationDeliveryAdapter
  implements NotificationDeliveryPort
{
  readonly delivered: MatchNotification[] = []

  async deliver(notification: MatchNotification): Promise<void> {
    this.delivered.push(notification)
  }
}
