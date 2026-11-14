import { describe, expect, it } from 'vitest'
import {
  CATEGORY_BUS,
  CATEGORY_ROLE,
  STEM_CATEGORY_OPTIONS,
  categoryOfBus,
  categoryOfRole,
  rolesInCategory
} from './stemCategory'
import { ARRANGE_ROLE_OPTIONS, ARRANGE_ROLE_TO_BUS } from './stemRole'

describe('stemCategory', () => {
  it('lists the four in display order', () => {
    expect(STEM_CATEGORY_OPTIONS).toEqual(['drums', 'bass', 'back', 'front'])
  })

  it('maps every stored role', () => {
    expect(categoryOfRole('drums')).toBe('drums')
    expect(categoryOfRole('fill')).toBe('drums')
    expect(categoryOfRole('bass')).toBe('bass')
    expect(categoryOfRole('backing')).toBe('back')
    expect(categoryOfRole('aux')).toBe('back')
    expect(categoryOfRole('textureFx')).toBe('back')
    expect(categoryOfRole('lead')).toBe('front')
    expect(categoryOfRole('vocal')).toBe('front')
  })

  it('maps every stored bus', () => {
    expect(categoryOfBus('drums')).toBe('drums')
    expect(categoryOfBus('bass')).toBe('bass')
    expect(categoryOfBus('backing')).toBe('back')
    expect(categoryOfBus('aux')).toBe('back')
    expect(categoryOfBus('lead')).toBe('front')
  })

  it('writes a role and bus that read back as the same category', () => {
    for (const c of STEM_CATEGORY_OPTIONS) {
      expect(categoryOfRole(CATEGORY_ROLE[c])).toBe(c)
      expect(categoryOfBus(CATEGORY_BUS[c])).toBe(c)
    }
    expect(CATEGORY_ROLE.back).toBe('backing')
    expect(CATEGORY_ROLE.front).toBe('lead')
  })

  it('lists the roles of a category', () => {
    expect(rolesInCategory('back')).toEqual(['backing', 'aux', 'textureFx'])
    expect(rolesInCategory('front')).toEqual(['lead', 'vocal'])
    expect(rolesInCategory('drums')).toEqual(['drums', 'fill'])
  })

  it("routes every role to a bus of the role's own category", () => {
    for (const role of ARRANGE_ROLE_OPTIONS) {
      expect(categoryOfBus(ARRANGE_ROLE_TO_BUS[role])).toBe(categoryOfRole(role))
    }
  })
})
