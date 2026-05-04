import type { NotificationDeliveryPort } from '../core/notification/port'
import type { MatchNotification } from '../core/notification/types'

export class DeliverMatchNotificationUseCase {
  constructor(private readonly delivery: NotificationDeliveryPort) {}

  async execute(notification: MatchNotification): Promise<void> {
    await this.delivery.deliver(notification)
  }
}
