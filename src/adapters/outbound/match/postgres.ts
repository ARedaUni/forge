import { context, propagation } from '@opentelemetry/api'
import type pg from 'pg'
import type { ListMatchesOptions, MatchEntry, MatchPort } from '../../../core/match/port'
import { UserIdSchema, type UserId } from '../../../core/shared/types'

const RECORD_SQL = `
  INSERT INTO matches (user_id, other_user_id, matched_at, trace_context)
  VALUES ($1::uuid, $2::uuid, $3::timestamptz, $4),
         ($2::uuid, $1::uuid, $3::timestamptz, $4)
  ON CONFLICT (user_id, other_user_id) DO NOTHING
`

// Serialise the active OTel context to a W3C traceparent string and stash it
// on the row. Debezium replicates the column verbatim through Kafka; the
// consumer extracts it to link its span to the producer span (per OTel
// messaging semconv: link, don't nest, when the producer span has long
// closed by the time the async hop fires).
function captureTraceParent(): string | null {
  const carrier: Record<string, string> = {}
  propagation.inject(context.active(), carrier)
  return carrier['traceparent'] ?? null
}

const LIST_BASE = `
  SELECT other_user_id::text AS other_user_id, matched_at
  FROM matches
  WHERE user_id = $1::uuid
`

type Row = {
  other_user_id: string
  matched_at: Date
}

export class PostgresMatchAdapter implements MatchPort {
  constructor(private readonly pool: pg.Pool) {}

  async recordMatch(userA: UserId, userB: UserId, matchedAt: Date): Promise<void> {
    await this.pool.query(RECORD_SQL, [userA, userB, matchedAt, captureTraceParent()])
  }

  async listForUser(
    userId: UserId,
    options: ListMatchesOptions = {},
  ): Promise<MatchEntry[]> {
    const params: unknown[] = [userId]
    let sql = LIST_BASE
    if (options.before) {
      params.push(options.before)
      sql += ` AND matched_at < $${params.length}::timestamptz`
    }
    sql += ` ORDER BY matched_at DESC`
    if (options.limit !== undefined) {
      params.push(options.limit)
      sql += ` LIMIT $${params.length}::int`
    }

    const result = await this.pool.query<Row>(sql, params)
    return result.rows.map((row) => ({
      otherUserId: UserIdSchema.parse(row.other_user_id),
      matchedAt: row.matched_at,
    }))
  }
}
