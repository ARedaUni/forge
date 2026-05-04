import type { ListMatchesOptions, MatchEntry, MatchPort } from '../domain/match/port'
import type { UserId } from '../domain/shared/types'

export class ListMatchesUseCase {
  constructor(private readonly matchPort: MatchPort) {}

  async execute(viewer: UserId, options?: ListMatchesOptions): Promise<MatchEntry[]> {
    return this.matchPort.listForUser(viewer, options)
  }
}
