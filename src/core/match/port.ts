import type { UserId } from '../shared/types'

export type MatchEntry = {
  otherUserId: UserId
  matchedAt: Date
}

export type ListMatchesOptions = {
  limit?: number
  before?: Date
}

export interface MatchPort {
  recordMatch(userA: UserId, userB: UserId, matchedAt: Date): Promise<void>
  listForUser(
    userId: UserId,
    options?: ListMatchesOptions,
  ): Promise<MatchEntry[]>
}
