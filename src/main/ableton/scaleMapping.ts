// Same chromatic order as loreWarehouse.ts's own LORE_ROOT_NAMES (kept as a
// separate copy here, not imported, since loreWarehouse.ts pulls in
// better-sqlite3/warehouse-connection concerns this module has no business
// depending on for a pure string-parsing job). The array index IS the
// semitone offset from C -- confirmed against the reference template
// (E -> index 4 -> Ableton's own Root Value="4" for a Set the user set to
// E Minor).
const LORE_ROOT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'] as const

// Only entries confirmed against a real Ableton-generated reference file
// (see docs/superpowers/specs/2026-08-04-ableton-export-design.md) --
// LORE_SCALE_NAMES has 18 entries total, but this table intentionally has
// only these two. Every other LORE scale name falls through to undefined
// below rather than guessing an unverified Ableton enum value.
const ABLETON_SCALE_NAME_TO_ENUM: Record<string, number> = {
  'Major (Ionian)': 0,
  'Minor (Aeolian)': 1
}

export interface AbletonScale {
  /** Semitone offset from C, 0-11. */
  root: number
  /** Ableton's own scale-type enum value. */
  name: number
}

/**
 * Reverse-parses a Rifff.key display string (e.g. "E Minor (Aeolian)",
 * produced by loreWarehouse.ts's resolveKeyName) into Ableton's Set-level
 * Scale representation. Returns undefined for anything unparseable, or for
 * a scale name outside the confirmed set above -- never guesses.
 */
export function parseKeyToAbletonScale(key: string | undefined): AbletonScale | undefined {
  if (!key) return undefined
  const spaceIdx = key.indexOf(' ')
  if (spaceIdx === -1) return undefined

  const rootName = key.slice(0, spaceIdx)
  const scaleName = key.slice(spaceIdx + 1)

  const root = LORE_ROOT_NAMES.indexOf(rootName as (typeof LORE_ROOT_NAMES)[number])
  if (root === -1) return undefined

  const name = ABLETON_SCALE_NAME_TO_ENUM[scaleName]
  if (name === undefined) return undefined

  return { root, name }
}
