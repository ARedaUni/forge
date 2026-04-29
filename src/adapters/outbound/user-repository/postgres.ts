import type pg from 'pg'
import type { UserProfile } from '../../../domain/feed/types'
import type { UserRepositoryPort } from '../../../domain/feed/user-repository-port'
import { insertProfile } from '../feed/postgres-postgis'

export class PostgresUserRepositoryAdapter implements UserRepositoryPort {
  constructor(private readonly pool: pg.Pool) {}

  async upsert(profile: UserProfile): Promise<void> {
    await insertProfile(this.pool, profile)
  }
}
