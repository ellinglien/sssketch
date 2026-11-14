// src/shared/stemCategory.ts
//
// The four categories every surface of the app shows and asks for
// (docs/superpowers/specs/2026-11-14-four-categories-design.md). Stored values
// (ArrangeRole, BusId) are unchanged; this is the one mapping between them.
import type { BusId } from './types'
import type { ArrangeRole } from './stemRole'

export type StemCategory = 'drums' | 'bass' | 'back' | 'front'

export const STEM_CATEGORY_OPTIONS: readonly StemCategory[] = ['drums', 'bass', 'back', 'front']

const ROLE_CATEGORY: Record<ArrangeRole, StemCategory> = {
  drums: 'drums',
  fill: 'drums',
  bass: 'bass',
  backing: 'back',
  aux: 'back',
  textureFx: 'back',
  lead: 'front',
  vocal: 'front'
}

const BUS_CATEGORY: Record<BusId, StemCategory> = {
  drums: 'drums',
  bass: 'bass',
  backing: 'back',
  aux: 'back',
  lead: 'front'
}

/** The role a pick of each category stores: values older app versions already read. */
export const CATEGORY_ROLE: Record<StemCategory, ArrangeRole> = {
  drums: 'drums',
  bass: 'bass',
  back: 'backing',
  front: 'lead'
}

/** The bus a pick of each category stores. */
export const CATEGORY_BUS: Record<StemCategory, BusId> = {
  drums: 'drums',
  bass: 'bass',
  back: 'backing',
  front: 'lead'
}

export function categoryOfRole(role: ArrangeRole): StemCategory {
  return ROLE_CATEGORY[role]
}

export function categoryOfBus(bus: BusId): StemCategory {
  return BUS_CATEGORY[bus]
}

/** Every stored role that reads as `category`, in ROLE_CATEGORY's order. */
export function rolesInCategory(category: StemCategory): ArrangeRole[] {
  return (Object.keys(ROLE_CATEGORY) as ArrangeRole[]).filter((r) => ROLE_CATEGORY[r] === category)
}
