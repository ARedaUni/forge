import type { NotificationDeliveryPort } from '../../../domain/notification/port'
import type { MatchNotification } from '../../../domain/notification/types'

export class InMemoryNotificationDeliveryAdapter
  implements NotificationDeliveryPort
{
  readonly delivered: MatchNotification[] = []

  async deliver(notification: MatchNotification): Promise<void> {
    this.delivered.push(notification)
  }
}
