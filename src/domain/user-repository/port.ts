import type { UserProfile } from '../feed/types'

export interface UserRepositoryPort {
  upsert(profile: UserProfile): Promise<void>
}
