import { describe, expect, it } from 'vitest'
import { InMemoryNotificationDeliveryAdapter } from '../adapters/outbound/notification/inMemory'
import type { NotificationDeliveryPort } from '../domain/notification/port'
import { MatchNotificationSchema } from '../domain/notification/types'
import { UserIdSchema } from '../domain/shared/types'
import { DeliverMatchNotificationUseCase } from './deliverMatchNotification'

const A = UserIdSchema.parse('00000000-0000-4000-8000-00000000000a')
const B = UserIdSchema.parse('00000000-0000-4000-8000-00000000000b')
const AT = new Date('2026-05-03T12:00:00Z')

const make = () =>
  MatchNotificationSchema.parse({
    type: 'match',
    userId: A,
    otherUserId: B,
    matchedAt: AT,
  })

describe('DeliverMatchNotificationUseCase', () => {
  it('forwards the notification to the delivery port', async () => {
    const delivery = new InMemoryNotificationDeliveryAdapter()
    const useCase = new DeliverMatchNotificationUseCase(delivery)

    await useCase.execute(make())

    expect(delivery.delivered).toHaveLength(1)
    expect(delivery.delivered[0]).toMatchObject({
      type: 'match',
      userId: A,
      otherUserId: B,
    })
  })

  it('propagates errors from the delivery port (no swallowing)', async () => {
    const failing: NotificationDeliveryPort = {
      deliver: async () => {
        throw new Error('downstream is sad')
      },
    }
    const useCase = new DeliverMatchNotificationUseCase(failing)

    await expect(useCase.execute(make())).rejects.toThrow('downstream is sad')
  })
})
