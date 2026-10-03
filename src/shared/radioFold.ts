// src/shared/radioFold.ts
//
// RADIO FOLD MODE -- docs/superpowers/specs/2026-10-02-radio-fold-mode-design.md. Autechre's
// "folding time": one anchor row stays at full length and sets the loop top, and one or two
// short rhythmic rows loop at odd cycles (3.5, 5, 7, 9 beats...) against it, drifting out of
// phase and back. A pure, seeded state machine shared by both radios (sssketch's Discover radio
// and ell.ing/radio); each runtime plays its decisions its own way.
//
// What it promises its callers:
//   - RULES, NOT DICE (spec section 0). Every draw is seededRandom(`${seed}#${counter}`): the same
//     seed and the same sequence of steps (rows, loop, tempo, fader) give the same decisions.
//     Nothing here reads Math.random.
//   - One step per LOOP TOP, one lap AHEAD: stepRadioFold, called at the top of lap k, decides
//     lap k+1 (`lap` in its result). That lap of lead is what lets a runtime schedule a length
//     change exactly on the top it belongs to, and lets the turnaround roll (made at the top of a
//     phrase's last lap) know whether the phrase's closing top is a realignment.
//   - A cycle is in BEATS, its phase offset in beats, and it restarts at the top of the lap whose
//     `cycleId` first names it: a new id is a new phase origin, an unchanged id keeps running.
//
// It must not import radioSchedule: radioSchedule imports it.

import type { DiscoverSlotKind } from './discoverSlotKind'

/** The cycle lengths a folded row may take, in beats (spec section 1). */
export const FOLD_CYCLE_BEATS: readonly number[] = [3, 3.5, 5, 5.5, 7, 9]
/** A cycle is allowed only if it realigns with the loop this often, at the tempo. */
export const FOLD_REALIGN_MIN_SEC = 30
export const FOLD_REALIGN_MAX_SEC = 120
/** At most this many rows fold at once, never the anchor. */
export const FOLD_MAX_ROWS = 2
/** A row longer than this is a phrase, not a pattern: it never folds. */
export const FOLD_MAX_ROW_BARS = 4
/** The micro-fade at every cycle seam, both runtimes (spec section 1). */
export const FOLD_SEAM_FADE_SEC = 0.01
/** The pace window while the mode is on (spec section 1): it replaces the user's. */
export const FOLD_PACE_BARS: Readonly<{ min: number; max: number }> = Object.freeze({
  min: 16,
  max: 64
})
/** A change prefers a realignment top at most this many laps past its drawn interval. */
export const FOLD_PREFER_WAIT_LAPS = 2
/** A settled row asked to unfold waits for its own realignment top, but no longer than this. */
export const FOLD_UNFOLD_MAX_WAIT_LAPS = 8
/** Folded stretches: this many bars at `fold` 0 .. 100 (then +-25%, drawn). */
export const FOLD_FOLDED_STRETCH_BARS: Readonly<{ atNone: number; atFull: number }> = Object.freeze(
  { atNone: 16, atFull: 96 }
)
/** Straight stretches, the same way: long at a low `fold`, short at a high one. */
export const FOLD_STRAIGHT_STRETCH_BARS: Readonly<{ atNone: number; atFull: number }> =
  Object.freeze({ atNone: 96, atFull: 24 })

export const DEFAULT_RADIO_FOLD = 40
export const DEFAULT_RADIO_CLASH = 25
/** Lowercase letters and digits without the lookalikes (0/o, 1/l/i): a code read off a screen
 * and typed back has to survive the trip. */
export const FOLD_SEED_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'
export const FOLD_SEED_LENGTH = 6
export const DEFAULT_FOLD_SEED = 'autech'

/** A 0..100 fader value, rounded; anything that is not a finite number is `fallback`. */
export function normalizeFoldAmount(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(100, Math.max(0, Math.round(value)))
}

/** A typed or pasted seed: lowercased, everything outside the alphabet dropped. Exactly six
 * characters must remain, or it is the default. */
export function normalizeFoldSeed(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_FOLD_SEED
  const kept = [...value.trim().toLowerCase()].filter((ch) => FOLD_SEED_ALPHABET.includes(ch))
  return kept.length === FOLD_SEED_LENGTH ? kept.join('') : DEFAULT_FOLD_SEED
}

/** The `new` button: six characters drawn from the alphabet. */
export function newFoldSeed(random: () => number = Math.random): string {
  const n = FOLD_SEED_ALPHABET.length
  let out = ''
  for (let i = 0; i < FOLD_SEED_LENGTH; i++) {
    out += FOLD_SEED_ALPHABET[Math.min(n - 1, Math.floor(random() * n))]
  }
  return out
}

const halves = (beats: number): number => Math.round(beats * 2)

function gcd(a: number, b: number): number {
  let x = a
  let y = b
  while (y !== 0) [x, y] = [y, x % y]
  return x
}

/** Beats until a cycle and the loop line up again: their lowest common multiple on a half-beat
 * grid. 7 against 16 is 112; 3.5 against 16 is 112; 5 against 8 is 40. */
export function radioFoldRealignBeats(cycleBeats: number, loopBeats: number): number {
  const a = halves(cycleBeats)
  const b = halves(loopBeats)
  if (!(a > 0) || !(b > 0)) return Number.POSITIVE_INFINITY
  return ((a / gcd(a, b)) * b) / 2
}

/** The cycles (FOLD_CYCLE_BEATS) whose realignment with a loop of `loopBeats` falls inside
 * FOLD_REALIGN_MIN_SEC..FOLD_REALIGN_MAX_SEC at `bpm`. At 120 bpm on a 16-beat loop: 3.5, 5,
 * 5.5, 7 and 9 (3 realigns every 24 s: too often to hear as phasing). */
export function radioFoldAllowedCycles(loopBeats: number, bpm: number): number[] {
  if (!(bpm > 0) || !(loopBeats > 0)) return []
  return FOLD_CYCLE_BEATS.filter((c) => {
    const sec = (radioFoldRealignBeats(c, loopBeats) * 60) / bpm
    return sec >= FOLD_REALIGN_MIN_SEC - 1e-9 && sec <= FOLD_REALIGN_MAX_SEC + 1e-9
  })
}

/** One row as the machine sees it. `id` is opaque (a radio slot, a web row). */
export interface RadioFoldRow {
  id: string
  /** What the row is playing; null while it has nothing. A fold belongs to one stem. */
  stemId: string | null
  kinds: readonly DiscoverSlotKind[]
  /** Its own loop, in bars, at full length. */
  barLength: number
  hooked: boolean
  /** Heard right now. */
  audible: boolean
  /** The stem's own type is percussive (sssketch: a drums sound type; web: a drums mask). */
  percussive: boolean
}

const FOLDABLE_KINDS: readonly DiscoverSlotKind[] = ['drums', 'rhythmic', 'bright']
const NEVER_FOLDS: readonly DiscoverSlotKind[] = ['lead', 'bass']

/** The anchor: the longest audible drums or bass row, or, with none, the longest audible row.
 * Ties go to the first in `rows`' order. */
export function radioFoldAnchor(rows: readonly RadioFoldRow[]): string | null {
  const audible = rows.filter((r) => r.audible && r.barLength > 0)
  const low = audible.filter((r) => r.kinds.includes('drums') || r.kinds.includes('bass'))
  let best: RadioFoldRow | null = null
  for (const r of low.length > 0 ? low : audible) {
    if (best === null || r.barLength > best.barLength) best = r
  }
  return best?.id ?? null
}

/** Whether a row may fold: audible, playing a stem, not the anchor, not hooked, at most
 * FOLD_MAX_ROW_BARS long, never lead or bass, and short and rhythmic (a drums, rhythmic or
 * bright kind, or a percussive stem). */
export function radioFoldCanFold(row: RadioFoldRow, anchorId: string | null): boolean {
  if (!row.audible || row.hooked || row.id === anchorId || row.stemId === null) return false
  if (!(row.barLength > 0) || row.barLength > FOLD_MAX_ROW_BARS) return false
  if (row.kinds.some((k) => NEVER_FOLDS.includes(k))) return false
  return row.percussive || row.kinds.some((k) => FOLDABLE_KINDS.includes(k))
}

/** The lengths a fold steps through from `fromBeats` to `toBeats` in `steps` loop tops, on the
 * half-beat grid, the last exactly `toBeats`; a repeated length is dropped. 16 to 7 in three:
 * 13, 10, 7. */
export function radioFoldPath(fromBeats: number, toBeats: number, steps: number): number[] {
  const n = Math.max(1, Math.floor(steps))
  const out: number[] = []
  for (let i = 1; i <= n; i++) {
    const v = i === n ? toBeats : Math.round((fromBeats + ((toBeats - fromBeats) * i) / n) * 2) / 2
    const last = out.length > 0 ? out[out.length - 1] : fromBeats
    if (v !== last) out.push(v)
  }
  return out
}
