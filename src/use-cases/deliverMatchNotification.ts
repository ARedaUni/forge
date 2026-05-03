import type { NotificationDeliveryPort } from '../domain/notification/port'
import type { MatchNotification } from '../domain/notification/types'

export class DeliverMatchNotificationUseCase {
  constructor(private readonly delivery: NotificationDeliveryPort) {}

  async execute(notification: MatchNotification): Promise<void> {
    await this.delivery.deliver(notification)
  }
}
