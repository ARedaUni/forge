import type { UserId } from '../shared/types'

export interface SeenFilterPort {
  add(userId: UserId, candidateId: UserId): Promise<void>
  contains(userId: UserId, candidateIds: UserId[]): Promise<Set<UserId>>
}
