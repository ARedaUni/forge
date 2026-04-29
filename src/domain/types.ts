import { z } from 'zod'

export const UserIdSchema = z.string().uuid().brand<'UserId'>()
export type UserId = z.infer<typeof UserIdSchema>

export const SwipeDecisionSchema = z.enum(['yes', 'no'])
export type SwipeDecision = z.infer<typeof SwipeDecisionSchema>

export const SwipeSchema = z.object({
  swiperId: UserIdSchema,
  targetId: UserIdSchema,
  decision: SwipeDecisionSchema,
  createdAt: z.date(),
})
export type Swipe = z.infer<typeof SwipeSchema>

export const MatchSchema = z.object({
  userAId: UserIdSchema,
  userBId: UserIdSchema,
  matchedAt: z.date(),
})
export type Match = z.infer<typeof MatchSchema>

export const GenderSchema = z.enum(['man', 'woman'])
export type Gender = z.infer<typeof GenderSchema>

export const LocationSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
})
export type Location = z.infer<typeof LocationSchema>

export const AgeRangeSchema = z
  .object({
    min: z.number().int().min(18).max(120),
    max: z.number().int().min(18).max(120),
  })
  .refine((r) => r.min <= r.max, { message: 'min must be <= max' })
export type AgeRange = z.infer<typeof AgeRangeSchema>

export const UserProfileSchema = z.object({
  id: UserIdSchema,
  age: z.number().int().min(18).max(120),
  gender: GenderSchema,
  interestedIn: z.array(GenderSchema).nonempty(),
  ageRange: AgeRangeSchema,
  location: LocationSchema,
})
export type UserProfile = z.infer<typeof UserProfileSchema>
