import type { SeenFilterPort } from '../../../domain/seen-filter/port'
import type { UserId } from '../../../domain/shared/types'

export class InMemorySeenFilterAdapter implements SeenFilterPort {
  private readonly seen = new Map<UserId, Set<UserId>>()

  async add(userId: UserId, candidateId: UserId): Promise<void> {
    let set = this.seen.get(userId)
    if (set === undefined) {
      set = new Set()
      this.seen.set(userId, set)
    }
    set.add(candidateId)
  }

  async contains(userId: UserId, candidateIds: UserId[]): Promise<Set<UserId>> {
    const userSeen = this.seen.get(userId)
    if (userSeen === undefined) return new Set()
    const result = new Set<UserId>()
    for (const id of candidateIds) {
      if (userSeen.has(id)) result.add(id)
    }
    return result
  }

  reset(): void {
    this.seen.clear()
  }
}
