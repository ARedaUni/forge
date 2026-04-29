import type pg from 'pg'
import type { UserProfile } from '../../../domain/feed/types'
import type { UserRepositoryPort } from '../../../domain/user-repository/port'
import { insertProfile } from '../feed/postgresPostgis'

export class PostgresUserRepositoryAdapter implements UserRepositoryPort {
  constructor(private readonly pool: pg.Pool) {}

  async upsert(profile: UserProfile): Promise<void> {
    await insertProfile(this.pool, profile)
  }
}
