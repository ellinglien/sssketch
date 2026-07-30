import type { SoundType } from './types'

/** Default LORE username, used only as the initial value of the
 * user-editable "your username" setting in LoreLibraryBrowser (persisted to
 * localStorage from there) and as computeOwnerFraction's own fallback
 * default below. Not a hardcoded identity any more — other people testing
 * this app set their own in the LORE library browser's filter bar. */
export const LORE_USERNAME = 'elling'

export interface LoreJam {
  jamCID: string
  name: string
  lastRiffTime: number // unix seconds
}

export interface LoreRiffSummary {
  riffCID: string
  creationTime: number
  bpm: number
  barLength: number
  userName: string
  stemCount: number // populated slots, 1-8
  cachedStemCount: number // of those, how many are on disk right now
  ownerFraction: number // 0-1, fraction of populated slots created by LORE_USERNAME
}

export interface LoreResolvedStem {
  stemCID: string
  slot: number // 1-8
  path: string | null // local file path, or null if not cached
  gain: number // from the riff's GainsJSON, default 1.0
  creatorUserName: string
  presetName: string
  instrumentMask: number
  durationSec: number // computed from this stem's own BPMrnd/BarLength, not the riff's
  barLength: number // this stem's own loop length — may differ from the riff's own barLength if the stem tiles
}

export interface LoreResolvedRiff {
  riffCID: string
  bpm: number
  barLength: number
  stems: LoreResolvedStem[]
}

/** Traced directly from OUROVEON's own source (toolkit.warehouse.cpp), not
 * guessed: bit 1 = drum, bit 2 = note, bit 3 = bass, bit 4 = mic. If multiple
 * bits are set, drum wins, then note, then bass, then mic — matching
 * OUROVEON's own getInstrumentType() resolution order. No bits set (or any
 * other combination without one of these four) returns null, meaning "no
 * confident mapping" — the caller falls back to the existing audio-content
 * heuristic (classifyStems) rather than guessing 'fx'. */
export function instrumentMaskToSoundType(mask: number): SoundType | null {
  if ((mask & (1 << 1)) !== 0) return 'drums'
  if ((mask & (1 << 2)) !== 0) return 'notes'
  if ((mask & (1 << 3)) !== 0) return 'bass'
  if ((mask & (1 << 4)) !== 0) return 'audioIn'
  return null
}

/** Fraction of `creatorUserNames` equal to `targetUser` (defaults to
 * LORE_USERNAME). Returns 0 for an empty list rather than dividing by zero. */
export function computeOwnerFraction(
  creatorUserNames: string[],
  targetUser: string = LORE_USERNAME
): number {
  if (creatorUserNames.length === 0) return 0
  const matching = creatorUserNames.filter((u) => u === targetUser).length
  return matching / creatorUserNames.length
}
