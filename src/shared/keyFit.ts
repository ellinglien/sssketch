// src/shared/keyFit.ts
//
// How well two riffs' keys sit together (spec 2026-11-21-picking-key-level-groove-design, 1).
// The key is Endlesss's own per-riff Root and Scale: evidence, not proof, so an unknown or
// chromatic key is neutral, never a clash.

export interface RiffKey {
  root: number | null
  scale: number | null
}

/** An unknown key's fit: it never beats a known match and is never a clash. */
export const KEY_NEUTRAL = 0.5

/** Semitone steps of each Endlesss scale, in RIFF_LIBRARY_SCALE_NAMES order
 * (riffLibraryTypes.ts). 17 (Chromatic) has no entry: every note, so no key. */
const SCALE_STEPS: readonly (readonly number[])[] = [
  [0, 2, 4, 5, 7, 9, 11], // Major (Ionian)
  [0, 2, 3, 5, 7, 9, 10], // Dorian
  [0, 1, 3, 5, 7, 8, 10], // Phrygian
  [0, 2, 4, 6, 7, 9, 11], // Lydian
  [0, 2, 4, 5, 7, 9, 10], // Mixolydian
  [0, 2, 3, 5, 7, 8, 10], // Minor (Aeolian)
  [0, 1, 3, 5, 6, 8, 10], // Locrian
  [0, 3, 5, 7, 10], // Minor Pentatonic
  [0, 2, 4, 7, 9], // Major Pentatonic
  [0, 2, 5, 7, 10], // Suspended Pent.
  [0, 3, 5, 8, 10], // Blues Minor Pent.
  [0, 2, 5, 7, 9], // Blues Major Pent.
  [0, 2, 3, 5, 7, 8, 11], // Harmonic Minor
  [0, 2, 3, 5, 7, 9, 11], // Melodic Minor
  [0, 1, 4, 5, 7, 8, 11], // Double Harmonic
  [0, 3, 5, 6, 7, 10], // Blues
  [0, 2, 4, 6, 8, 10] // Whole Tone
]

/** The key's notes as a 12-bit set, or null when it says nothing. */
function notesOf(key: RiffKey): number | null {
  const { root, scale } = key
  if (root === null || scale === null) return null
  if (!Number.isInteger(root) || root < 0 || root > 11) return null
  const steps = SCALE_STEPS[scale]
  if (!steps) return null
  let bits = 0
  for (const s of steps) bits |= 1 << ((root + s) % 12)
  return bits
}

const count = (bits: number): number => {
  let n = 0
  for (let b = bits; b; b &= b - 1) n++
  return n
}

/** True when the key says something (known root, a real scale). */
export function hasKey(key: RiffKey): boolean {
  return notesOf(key) !== null
}

/** 0 to 1: the notes both keys share over the smaller key's notes, with half or fewer shared
 * counting as a plain clash (0). KEY_NEUTRAL when either key is unknown or chromatic. */
export function keyFit(a: RiffKey, b: RiffKey): number {
  const na = notesOf(a)
  const nb = notesOf(b)
  if (na === null || nb === null) return KEY_NEUTRAL
  const shared = count(na & nb) / Math.min(count(na), count(nb))
  return Math.min(1, Math.max(0, (shared - 0.5) / 0.5))
}
