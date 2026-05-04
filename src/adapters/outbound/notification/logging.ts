import type { Logger } from '../../../core/observability/logger'
import type { NotificationDeliveryPort } from '../../../core/notification/port'
import type { MatchNotification } from '../../../core/notification/types'

export class LoggingNotificationDeliveryAdapter implements NotificationDeliveryPort {
  constructor(private readonly logger: Logger) {}

  async deliver(notification: MatchNotification): Promise<void> {
    this.logger.info('match-notification.delivered', {
      type: notification.type,
      userId: notification.userId,
      otherUserId: notification.otherUserId,
      matchedAt: notification.matchedAt.toISOString(),
    })
  }
}
