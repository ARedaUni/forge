import type { FeedExclusionPort } from '../../../core/feed-exclusion/port'
import type { UserId } from '../../../core/shared/types'

export class InMemoryFeedExclusionAdapter implements FeedExclusionPort {
  private readonly shown = new Map<UserId, Set<UserId>>()

  async markShown(viewer: UserId, candidate: UserId): Promise<void> {
    let set = this.shown.get(viewer)
    if (set === undefined) {
      set = new Set()
      this.shown.set(viewer, set)
    }
    set.add(candidate)
  }

  async excludeSeen(viewer: UserId, candidates: UserId[]): Promise<UserId[]> {
    const viewerShown = this.shown.get(viewer)
    if (viewerShown === undefined) return [...candidates]
    return candidates.filter((id) => !viewerShown.has(id))
  }

  reset(): void {
    this.shown.clear()
  }
}
