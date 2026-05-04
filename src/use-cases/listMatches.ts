import type { ListMatchesOptions, MatchEntry, MatchPort } from '../core/match/port'
import type { UserId } from '../core/shared/types'

export class ListMatchesUseCase {
  constructor(private readonly matchPort: MatchPort) {}

  async execute(viewer: UserId, options?: ListMatchesOptions): Promise<MatchEntry[]> {
    return this.matchPort.listForUser(viewer, options)
  }
}
