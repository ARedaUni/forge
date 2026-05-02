import type {
  ListMatchesOptions,
  MatchEntry,
  MatchPort,
} from '../../../domain/match/port'
import type { UserId } from '../../../domain/shared/types'

const pairKey = (a: UserId, b: UserId): string => {
  if (a < b) return `${a}|${b}`
  return `${b}|${a}`
}

export class InMemoryMatchAdapter implements MatchPort {
  private readonly pairs = new Map<string, { a: UserId; b: UserId; matchedAt: Date }>()

  async recordMatch(userA: UserId, userB: UserId, matchedAt: Date): Promise<void> {
    const key = pairKey(userA, userB)
    if (this.pairs.has(key)) return
    this.pairs.set(key, { a: userA, b: userB, matchedAt })
  }

  async listForUser(
    userId: UserId,
    options: ListMatchesOptions = {},
  ): Promise<MatchEntry[]> {
    const entries: MatchEntry[] = []
    for (const { a, b, matchedAt } of this.pairs.values()) {
      if (a === userId) entries.push({ otherUserId: b, matchedAt })
      else if (b === userId) entries.push({ otherUserId: a, matchedAt })
    }

    let filtered = entries
    if (options.before !== undefined) {
      const before = options.before
      filtered = filtered.filter((e) => e.matchedAt < before)
    }
    filtered.sort((x, y) => y.matchedAt.getTime() - x.matchedAt.getTime())
    if (options.limit !== undefined) {
      filtered = filtered.slice(0, options.limit)
    }
    return filtered
  }

  reset(): void {
    this.pairs.clear()
  }
}
