import type { Match, Swipe } from './types'

export type SwipeResult =
  | { kind: 'recorded' }
  | { kind: 'matched'; match: Match }

export interface SwipeMatchPort {
  recordSwipe(swipe: Swipe): Promise<SwipeResult>
}
