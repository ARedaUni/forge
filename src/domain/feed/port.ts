import { z } from 'zod'
import { LocationSchema, UserProfileSchema, type UserProfile } from '../user/types'

export const FeedQuerySchema = z.object({
  viewer: UserProfileSchema,
  center: LocationSchema,
  radiusKm: z.number().positive(),
  limit: z.number().int().positive().max(500),
})
export type FeedQuery = z.infer<typeof FeedQuerySchema>

export type FeedCandidate = {
  profile: UserProfile
  distanceKm: number
}

export interface FeedPort {
  query(q: FeedQuery): Promise<FeedCandidate[]>
}
