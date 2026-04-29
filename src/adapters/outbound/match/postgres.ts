import type pg from 'pg'
import type {
  ListMatchesOptions,
  MatchEntry,
  MatchPort,
} from '../../../domain/match/match-port'
import { UserIdSchema, type UserId } from '../../../domain/shared/types'

const RECORD_SQL = `
  INSERT INTO matches (user_id, other_user_id, matched_at)
  VALUES ($1::uuid, $2::uuid, $3::timestamptz),
         ($2::uuid, $1::uuid, $3::timestamptz)
  ON CONFLICT (user_id, other_user_id) DO NOTHING
`

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

  async recordMatch(
    userA: UserId,
    userB: UserId,
    matchedAt: Date,
  ): Promise<void> {
    await this.pool.query(RECORD_SQL, [userA, userB, matchedAt])
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
