import { describe, expect, it } from 'vitest'
import type { NotificationDeliveryPort } from '../../../core/notification/port'
import { MatchNotificationSchema } from '../../../core/notification/types'
import { UserIdSchema } from '../../../core/shared/types'

export type DeliveryHarness = {
  adapter: NotificationDeliveryPort
  // Returns the notifications the adapter has observed since construction.
  // Implementations that don't naturally retain a record (e.g. logging) can
  // capture them via a sink injected at construction time.
  observed: () => ReadonlyArray<unknown>
}

export type DeliveryAdapterUnderTest = {
  name: string
  build: () => DeliveryHarness | Promise<DeliveryHarness>
}

const A = UserIdSchema.parse('00000000-0000-4000-8000-00000000000a')
const B = UserIdSchema.parse('00000000-0000-4000-8000-00000000000b')
const AT = new Date('2026-05-03T12:00:00.000Z')

const make = (
  overrides: Partial<{ userId: string; otherUserId: string; matchedAt: Date }> = {},
) =>
  MatchNotificationSchema.parse({
    type: 'match',
    userId: overrides.userId ?? A,
    otherUserId: overrides.otherUserId ?? B,
    matchedAt: overrides.matchedAt ?? AT,
  })

export function runDeliveryContract(cfg: DeliveryAdapterUnderTest): void {
  describe(`NotificationDeliveryPort contract — ${cfg.name}`, () => {
    it('delivers a single notification', async () => {
      const h = await cfg.build()
      const n = make()

      await h.adapter.deliver(n)

      expect(h.observed()).toHaveLength(1)
      expect(h.observed()[0]).toMatchObject({
        type: 'match',
        userId: A,
        otherUserId: B,
      })
    })

    it('delivers notifications in the order they were submitted', async () => {
      const h = await cfg.build()
      const n1 = make({ userId: A, otherUserId: B })
      const n2 = make({ userId: B, otherUserId: A })

      await h.adapter.deliver(n1)
      await h.adapter.deliver(n2)

      const seen = h.observed() as Array<{ userId: string; otherUserId: string }>
      expect(seen.map((s) => s.userId)).toEqual([A, B])
    })
  })
}
