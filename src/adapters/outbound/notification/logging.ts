import type { Logger } from '../../../domain/observability/logger'
import type { NotificationDeliveryPort } from '../../../domain/notification/port'
import type { MatchNotification } from '../../../domain/notification/types'

export class LoggingNotificationDeliveryAdapter
  implements NotificationDeliveryPort
{
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
