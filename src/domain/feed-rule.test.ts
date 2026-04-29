import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { matchesFilters } from './feed-rule'
import { UserIdSchema, type UserProfile } from './types'

const profile = (overrides: Partial<UserProfile> = {}): UserProfile => ({
  id: UserIdSchema.parse(randomUUID()),
  age: 30,
  gender: 'woman',
  interestedIn: ['man'],
  ageRange: { min: 25, max: 40 },
  location: { lat: 0, lng: 0 },
  ...overrides,
})

describe('matchesFilters', () => {
  it('passes when both gender preferences and both age ranges agree', () => {
    const viewer = profile({
      gender: 'man',
      interestedIn: ['woman'],
      age: 30,
      ageRange: { min: 25, max: 35 },
    })
    const target = profile({
      gender: 'woman',
      interestedIn: ['man'],
      age: 28,
      ageRange: { min: 28, max: 40 },
    })
    expect(matchesFilters(target, viewer)).toBe(true)
  })

  it("rejects when target's gender is not in viewer's interestedIn", () => {
    const viewer = profile({ gender: 'man', interestedIn: ['woman'] })
    const target = profile({ gender: 'man', interestedIn: ['man'] })
    expect(matchesFilters(target, viewer)).toBe(false)
  })

  it("rejects when viewer's gender is not in target's interestedIn (mutual filter)", () => {
    const viewer = profile({ gender: 'man', interestedIn: ['woman'] })
    const target = profile({ gender: 'woman', interestedIn: ['woman'] })
    expect(matchesFilters(target, viewer)).toBe(false)
  })

  it("rejects when target.age is outside viewer's ageRange", () => {
    const viewer = profile({
      gender: 'man',
      interestedIn: ['woman'],
      ageRange: { min: 25, max: 35 },
    })
    const target = profile({
      gender: 'woman',
      interestedIn: ['man'],
      age: 50,
    })
    expect(matchesFilters(target, viewer)).toBe(false)
  })

  it("rejects when viewer.age is outside target's ageRange (mutual filter)", () => {
    const viewer = profile({
      gender: 'man',
      interestedIn: ['woman'],
      age: 50,
      ageRange: { min: 18, max: 99 },
    })
    const target = profile({
      gender: 'woman',
      interestedIn: ['man'],
      age: 28,
      ageRange: { min: 25, max: 35 },
    })
    expect(matchesFilters(target, viewer)).toBe(false)
  })

  it('passes when both users list multiple genders and there is overlap', () => {
    const viewer = profile({
      gender: 'man',
      interestedIn: ['man', 'woman'],
    })
    const target = profile({
      gender: 'woman',
      interestedIn: ['man', 'woman'],
    })
    expect(matchesFilters(target, viewer)).toBe(true)
  })

  it('treats ageRange bounds as inclusive', () => {
    const viewer = profile({
      gender: 'man',
      interestedIn: ['woman'],
      age: 25,
      ageRange: { min: 25, max: 35 },
    })
    const target = profile({
      gender: 'woman',
      interestedIn: ['man'],
      age: 35,
      ageRange: { min: 25, max: 35 },
    })
    expect(matchesFilters(target, viewer)).toBe(true)
  })
})

