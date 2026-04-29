import type { UserProfile } from './types'

export interface UserRepositoryPort {
  upsert(profile: UserProfile): Promise<void>
}
