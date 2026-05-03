import type { UserId } from '../shared/types'

export interface FeedExclusionPort {
  markShown(viewer: UserId, candidate: UserId): Promise<void>
  excludeSeen(viewer: UserId, candidates: UserId[]): Promise<UserId[]>
}
