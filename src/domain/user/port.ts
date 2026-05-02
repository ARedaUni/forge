import type { UserProfile } from './types'
import type { UserId } from '../shared/types'

export interface UserRepositoryPort {
  upsert(profile: UserProfile): Promise<void>
  findById(id: UserId): Promise<UserProfile | null>
}
