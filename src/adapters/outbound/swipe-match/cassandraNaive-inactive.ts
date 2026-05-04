import type { Client } from 'cassandra-driver'
import { evaluateSwipe } from '../../../core/swipe-match/matchRule'
import type { SwipeMatchPort, SwipeResult } from '../../../core/swipe-match/port'
import { SwipeDecisionSchema, type Swipe, type SwipeDecision } from '../../../core/swipe-match/types'
import { KEYSPACE } from '../../../infrastructure/cassandra/bootstrap'

const SELECT_INVERSE = `
  SELECT decision FROM ${KEYSPACE}.swipes
  WHERE swiper_id = ? AND target_id = ?
`

const INSERT_SWIPE = `
  INSERT INTO ${KEYSPACE}.swipes (swiper_id, target_id, decision, created_at)
  VALUES (?, ?, ?, ?)
`

export class CassandraNaiveSwipeMatchAdapter implements SwipeMatchPort {
  constructor(private readonly client: Client) {}

  async recordSwipe(swipe: Swipe): Promise<SwipeResult> {
    const inverse = await this.client.execute(
      SELECT_INVERSE,
      [swipe.targetId, swipe.swiperId],
      { prepare: true },
    )

    await this.client.execute(
      INSERT_SWIPE,
      [swipe.swiperId, swipe.targetId, swipe.decision, swipe.createdAt],
      { prepare: true },
    )

    const inverseDecision = parseInverseDecision(inverse.rows[0]?.['decision'])
    return evaluateSwipe(swipe, inverseDecision)
  }
}

function parseInverseDecision(raw: unknown): SwipeDecision | null {
  if (raw === undefined || raw === null) return null
  const parsed = SwipeDecisionSchema.safeParse(raw)
  return parsed.success ? parsed.data : null
}
