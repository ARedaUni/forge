import type { UserProfile } from './types'
import type { UserId } from '../shared/types'

export interface UserRepositoryPort {
  save(profile: UserProfile): Promise<void>
  load(id: UserId): Promise<UserProfile | null>
}
