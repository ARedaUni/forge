import { types, type Client } from 'cassandra-driver'
import type { UserId } from '../../../domain/shared/types'
import { evaluateSwipe } from '../../../domain/swipe-match/match-rule'
import type { SwipeMatchPort, SwipeResult } from '../../../domain/swipe-match/swipe-match-port'
import { SwipeDecisionSchema, type Swipe, type SwipeDecision } from '../../../domain/swipe-match/types'
import { KEYSPACE } from '../../../infrastructure/cassandra/bootstrap'

const INSERT_LWT = `
  INSERT INTO ${KEYSPACE}.swipe_pairs (low_id, high_id, swiper_id, decision, created_at)
  VALUES (?, ?, ?, ?, ?)
  IF NOT EXISTS
`

const SELECT_PARTITION = `
  SELECT swiper_id, decision FROM ${KEYSPACE}.swipe_pairs
  WHERE low_id = ? AND high_id = ?
`

export class CassandraLwtSwipeMatchAdapter implements SwipeMatchPort {
  constructor(private readonly client: Client) {}

  async recordSwipe(swipe: Swipe): Promise<SwipeResult> {
    let lowId: UserId
    let highId: UserId
    if (swipe.swiperId < swipe.targetId) {
      lowId = swipe.swiperId
      highId = swipe.targetId
    } else {
      lowId = swipe.targetId
      highId = swipe.swiperId
    }

    await this.client.execute(
      INSERT_LWT,
      [lowId, highId, swipe.swiperId, swipe.decision, swipe.createdAt],
      { prepare: true, serialConsistency: types.consistencies.serial },
    )

    const partition = await this.client.execute(
      SELECT_PARTITION,
      [lowId, highId],
      { prepare: true, consistency: types.consistencies.serial },
    )

    const inverseDecision = findInverseDecision(partition.rows, swipe.swiperId)
    return evaluateSwipe(swipe, inverseDecision)
  }
}

function findInverseDecision(
  rows: ReadonlyArray<Record<string, unknown>>,
  mySwiperId: UserId,
): SwipeDecision | null {
  for (const row of rows) {
    const rowSwiper = String(row['swiper_id'])
    if (rowSwiper === mySwiperId) continue
    const parsed = SwipeDecisionSchema.safeParse(row['decision'])
    if (parsed.success) return parsed.data
  }
  return null
}
