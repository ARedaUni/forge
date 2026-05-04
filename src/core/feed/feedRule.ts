import type { UserProfile } from '../user/types'

export function matchesFilters(target: UserProfile, viewer: UserProfile): boolean {
  if (!viewer.interestedIn.includes(target.gender)) return false
  if (!target.interestedIn.includes(viewer.gender)) return false
  if (target.age < viewer.ageRange.min || target.age > viewer.ageRange.max) return false
  if (viewer.age < target.ageRange.min || viewer.age > target.ageRange.max) return false
  return true
}
