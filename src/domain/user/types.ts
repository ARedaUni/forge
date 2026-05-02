import { z } from 'zod'
import { UserIdSchema } from '../shared/types'

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
