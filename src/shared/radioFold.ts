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
import type { RadioTurnarounds } from './radioTurnaround'
import { hashText, seededRandom } from './seededRandom'

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
/** The pace window while the mode is on (spec section 1): it replaces the user's. 8-32 bars
 * since v2 (2026-10-03-radio-fold-v2-design.md section 1: "faster changes"), 16-64 before. */
export const FOLD_PACE_BARS: Readonly<{ min: number; max: number }> = Object.freeze({
  min: 8,
  max: 32
})
/** A settled fold re-folds at its own realignment top with this chance, from bend 0 to 100
 * (v2 section 1): to a new length, or a new phase where the bend's menu has offsets. */
export const FOLD_REFOLD_CHANCE: Readonly<{ atNone: number; atFull: number }> = Object.freeze({
  atNone: 0.3,
  atFull: 0.7
})
/** A fold rotates out after this many of its own realignment tops, drawn per fold (v2 section 1),
 * when another row could take its place. */
export const FOLD_ROTATE_AFTER_REALIGNS: Readonly<{ min: number; max: number }> = Object.freeze({
  min: 2,
  max: 4
})
/** A change prefers a realignment top at most this many laps past its drawn interval. */
export const FOLD_PREFER_WAIT_LAPS = 2
/** Fold following the pace slider above 70 (stepRadioFold's `hurry`, 0..1; 2026-10-03 fold
 * follows pace): stretches shrink to this share of their drawn bars at full hurry ... */
export const FOLD_HURRY_STRETCH_MIN_SCALE = 0.25
/** ... and a top that is not a realignment still opens (re-fold, rotation, an unfold's wait, a
 * second fold) with this chance at full hurry, drawn once per step and only while hurrying. */
export const FOLD_HURRY_OPEN_CHANCE = 0.5
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
/** Any-text seeds (v2 section 3) are kept up to this many characters. */
export const FOLD_SEED_TEXT_MAX = 32
/** A six-character code: what `new` draws, and every seed saved before any-text seeds. */
const FOLD_SEED_CODE = new RegExp(`^[${FOLD_SEED_ALPHABET}]{${FOLD_SEED_LENGTH}}$`)

/** A 0..100 fader value, rounded; anything that is not a finite number is `fallback`. */
export function normalizeFoldAmount(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(100, Math.max(0, Math.round(value)))
}

/** A typed seed, or null when there is nothing to use (not a string, or blank: a box left empty
 * keeps the seed in use). A six-character code, in any case, is that code lowercased, so every
 * saved seed replays exactly as before; any other text is kept as typed, trimmed, at most
 * FOLD_SEED_TEXT_MAX characters (v2 section 3). */
export function cleanFoldSeed(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const t = value.trim()
  if (t === '') return null
  const lower = t.toLowerCase()
  if (FOLD_SEED_CODE.test(lower)) return lower
  return [...t].slice(0, FOLD_SEED_TEXT_MAX).join('')
}

/** A saved or typed seed, the default for nothing usable (cleanFoldSeed). */
export function normalizeFoldSeed(value: unknown): string {
  return cleanFoldSeed(value) ?? DEFAULT_FOLD_SEED
}

/** What the machine draws from: a code as it is (so `autech` draws `autech#0`, `autech#1`... as
 * it always has), any other text through FNV-1a (hashText), lowercased: `Elling` and `elling`
 * fold the same. The `~` keeps a hashed text from ever equalling a code. */
export function foldSeedKey(seed: string): string {
  const lower = seed.toLowerCase()
  return FOLD_SEED_CODE.test(lower) ? lower : `~${hashText(lower)}`
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

/** The parameters drift moves (spec section 1). `cutoff` is the row's own low-pass (1 open),
 * `send` an extra reverb send over the row's own, `dub` its send into the dub echo. */
export type FoldDriftParam = 'cutoff' | 'send' | 'dub'
export const FOLD_DRIFT_PARAMS: readonly FoldDriftParam[] = ['cutoff', 'send', 'dub']
export type FoldDriftRange = Readonly<
  Record<FoldDriftParam, { min: number; max: number; rest: number }>
>
/** Where drift may go at a bend (0..100), and where it rests (v2 section 1, "audible drift"): the
 * cutoff from 1 down to 0.62 - 0.22b (0.4 at bend 100; never closed), the added reverb send up to
 * 0.15 + 0.15b, the dub send up to 0.18 + 0.17b (sends only ever added). */
export function radioFoldDriftRange(bend: number): FoldDriftRange {
  const b = normalizeFoldAmount(bend, DEFAULT_RADIO_FOLD) / 100
  return {
    cutoff: { min: 0.62 - 0.22 * b, max: 1, rest: 1 },
    send: { min: 0, max: 0.15 + 0.15 * b, rest: 0 },
    dub: { min: 0, max: 0.18 + 0.17 * b, rest: 0 }
  }
}
/** The range at bend 0: v1's fixed range (0.62 is about 1.4 kHz). */
export const FOLD_DRIFT_RANGE: FoldDriftRange = Object.freeze(radioFoldDriftRange(0))
/** One sweep's length, drawn (spec section 1). */
export const FOLD_DRIFT_SWEEP_BARS: Readonly<{ min: number; max: number }> = Object.freeze({
  min: 32,
  max: 128
})
/** A sweep is never fewer laps than this, whatever its drawn bars: one lap moves a parameter at
 * most an eighth of its range. A runtime holds each lap flat at its value (radioFoldDriftCurves)
 * and its lanes can land a little after the top, so a lap's step is what a listener hears. */
export const FOLD_DRIFT_MIN_SWEEP_LAPS = 8

interface FoldSweep {
  from: number
  to: number
  startLap: number
  laps: number
}
type RowDrift = Record<FoldDriftParam, FoldSweep>
/** A parameter's value at the start and at the end of the decided lap. A runtime plays the
 * start value flat across the lap (radioFoldDriftCurves); the end is the next lap's start. */
export type FoldDriftLap = Record<FoldDriftParam, readonly [number, number]>

export interface RadioFoldRowState {
  rowId: string
  stemId: string
  fullBeats: number
  targetBeats: number
  /** The cycle the row plays in the decided lap. */
  cycleBeats: number
  phaseBeats: number
  /** The lap whose top this cycle started on. */
  originLap: number
  /** Lengths still to step through, one per loop top, in order. */
  path: number[]
  /** The lengths the fold has stepped through on its way in, in order, the latest last: an
   * unfold walks them back (spec section 1). Absent in a state saved before it was kept. */
  walk?: number[]
  /** `refolding`: a settled fold moving to a new length or phase at its realignment top (v2),
   * one or two lengths, and settled again on the top after it lands. */
  mode: 'folding' | 'settled' | 'unfolding' | 'refolding'
  /** The lap it was asked to unfold on (the stretch ended), or null. */
  unfoldSince: number | null
  serial: number
  /** Its own realignment tops passed settled, and how many it rotates out after (drawn,
   * FOLD_ROTATE_AFTER_REALIGNS). Absent in a state saved before v2: none, and the most. */
  realigns?: number
  rotateAfter?: number
}

export interface RadioFoldState {
  seed: string
  /** Draws made so far: the counter every draw is seeded from. */
  draws: number
  /** The lap the last step decided; -1 before the first. */
  lap: number
  loopBeats: number
  /** The tempo the last step decided at; 0 before the first. Absent in a state saved before it
   * was kept, which reads as no change. */
  bpm: number
  stretch: 'straight' | 'folded'
  /** The lap the current stretch gives way on. */
  stretchEndsLap: number
  rows: RadioFoldRowState[]
  drift: Record<string, RowDrift>
  serial: number
  /** The decided lap's top is a realignment (radioFoldMarkedBarsAhead reads it). */
  marked: boolean
  /** A rotation under way (v2): `from` walks back out, and `to` folds in on the top `from` has
   * left. Absent in a state saved before v2: none. */
  rotate?: { from: string; to: string } | null
}

export function createRadioFold(seed: string): RadioFoldState {
  return {
    seed: normalizeFoldSeed(seed),
    draws: 0,
    lap: -1,
    loopBeats: 0,
    bpm: 0,
    stretch: 'straight',
    stretchEndsLap: -1,
    rows: [],
    drift: {},
    serial: 0,
    marked: false,
    rotate: null
  }
}

export interface RadioFoldInput {
  /** In a stable order (the panel's slot order): new folds draw from it by index. */
  rows: readonly RadioFoldRow[]
  loopBars: number
  bpm: number
  /** The `fold` fader, 0..100. */
  fold: number
  /** 0..1, from the pace slider above 70 (radioCadence.foldHurry): the machine's own timers
   * shorten -- stretches, fold-in and re-fold steps, the unfold wait, the realignments before a
   * rotation -- and any top may open like a realignment (FOLD_HURRY_OPEN_CHANCE). Absent or 0:
   * exactly as before, the same draws. */
  hurry?: number
}

/** What one row plays in the decided lap. Absent from `cycles`: full length. */
export interface RadioFoldCycle {
  rowId: string
  /** The stem the fold was decided for: a runtime folds the row only while it plays this one. */
  stemId: string
  /** Changes whenever the cycle restarts; while unchanged the cycle runs on across tops. */
  cycleId: string
  cycleBeats: number
  phaseBeats: number
}

export interface RadioFoldStep {
  state: RadioFoldState
  /** The lap these decisions are for: the one starting at the NEXT loop top. */
  lap: number
  anchorId: string | null
  cycles: RadioFoldCycle[]
  /** That lap's top is a realignment: a settled fold lines up with the loop there. */
  marked: boolean
  stretch: 'straight' | 'folded'
  /** Every audible row's drift over that lap. */
  drift: Record<string, FoldDriftLap>
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t

function stretchLaps(bars: number, loopBars: number): number {
  return Math.max(1, Math.round(bars / Math.max(loopBars, 1e-9)))
}

function cycleMenu(f: number): readonly number[] {
  return f < 0.5 ? [7, 9] : f < 0.75 ? [5, 7, 9] : FOLD_CYCLE_BEATS
}

function phaseMenu(f: number): readonly number[] {
  return f < 0.5 ? [0] : f < 0.75 ? [0, 0.25] : [0, 0.25, 1 / 3, 0.5]
}

function maxRows(f: number): number {
  return f >= 0.6 ? FOLD_MAX_ROWS : 1
}

/** The cycles `row` may fold to: the fader's menu, inside the allowed window, shorter than the
 * row. Empty means the row does not fold at this `fold` (a 1-bar row has no 7 or 9 below it). */
function foldTargets(row: RadioFoldRow, loopBeats: number, bpm: number, f: number): number[] {
  const full = row.barLength * 4
  const allowed = radioFoldAllowedCycles(loopBeats, bpm)
  return cycleMenu(f).filter((c) => c < full && allowed.includes(c))
}

/** Whether a row's cycle lines up with the loop at the top of `lap`. */
function realignsAt(r: RadioFoldRowState, lap: number, loopBeats: number): boolean {
  if (lap <= r.originLap) return false
  return ((lap - r.originLap) * halves(loopBeats)) % halves(r.cycleBeats) === 0
}

/** realignsAt, for radioFoldStatus (radioFoldStatus.ts). */
export function radioFoldRowRealignsAt(
  r: RadioFoldRowState,
  lap: number,
  loopBeats: number
): boolean {
  return realignsAt(r, lap, loopBeats)
}

function pickFrom<T>(items: readonly T[], r: number): T {
  return items[Math.min(items.length - 1, Math.floor(r * items.length))]
}

function restingDrift(lap: number): RowDrift {
  const rest = (p: FoldDriftParam): FoldSweep => ({
    from: FOLD_DRIFT_RANGE[p].rest,
    to: FOLD_DRIFT_RANGE[p].rest,
    startLap: lap,
    laps: 0
  })
  return { cutoff: rest('cutoff'), send: rest('send'), dub: rest('dub') }
}

function sweepAt(sw: FoldSweep, lap: number): readonly [number, number] {
  const at = (l: number): number =>
    sw.laps <= 0
      ? sw.to
      : lerp(sw.from, sw.to, Math.min(1, Math.max(0, (l - sw.startLap) / sw.laps)))
  return [at(lap), at(lap + 1)]
}

/** One loop top: decides the NEXT lap (see the top of this file). Pure: `prev` is untouched. */
export function stepRadioFold(prev: RadioFoldState, input: RadioFoldInput): RadioFoldStep {
  const s: RadioFoldState = {
    ...prev,
    rows: prev.rows.map((r) => ({
      ...r,
      path: [...r.path],
      ...(r.walk !== undefined ? { walk: [...r.walk] } : {})
    })),
    drift: { ...prev.drift }
  }
  const key = foldSeedKey(s.seed)
  const draw = (): number => seededRandom(`${key}#${s.draws++}`)()
  const lap = s.lap + 1
  s.lap = lap
  const f = normalizeFoldAmount(input.fold, DEFAULT_RADIO_FOLD) / 100
  const h = Math.min(1, Math.max(0, Number.isFinite(input.hurry) ? (input.hurry as number) : 0))
  /** A count of steps or laps, shortened by the hurry (never below `floor`); as drawn at 0. */
  const hurried = (n: number, floor: number): number =>
    h > 0 ? Math.max(floor, Math.round(n * (1 - h))) : n
  const stretchScale = h > 0 ? 1 - (1 - FOLD_HURRY_STRETCH_MIN_SCALE) * h : 1
  const loopBeats = input.loopBars * 4
  const loopChanged = prev.lap >= 0 && s.loopBeats !== loopBeats
  s.loopBeats = loopBeats
  s.bpm = input.bpm
  const anchorId = radioFoldAnchor(input.rows)
  const byId = new Map(input.rows.map((r) => [r.id, r]))
  const restart = (r: RadioFoldRowState): void => {
    r.originLap = lap
    r.serial = ++s.serial
  }
  /** Rows that may start a fold on this top: foldable, with a target at this bend, not already
   * folded and not just left (a row that leaves plays full length for at least this top). */
  const foldable = (): RadioFoldRow[] => {
    const taken = new Set(s.rows.map((r) => r.rowId))
    return input.rows.filter(
      (row) =>
        !taken.has(row.id) &&
        !left.has(row.id) &&
        radioFoldCanFold(row, anchorId) &&
        foldTargets(row, loopBeats, input.bpm, f).length > 0
    )
  }

  // 1. Rows already folded keep their fold only while they still may and still play the stem it
  //    was decided for, at the length it was decided at; a changed stem leaves the fold (the new
  //    layer arrives straight). A changed loop restarts every cycle at this top, since the
  //    realignment arithmetic has changed. A row that leaves here does not start a new fold on
  //    the same top.
  const left = new Set<string>()
  s.rows = s.rows.filter((r) => {
    const row = byId.get(r.rowId)
    const keep =
      row !== undefined &&
      row.stemId === r.stemId &&
      row.barLength * 4 === r.fullBeats &&
      radioFoldCanFold(row, anchorId)
    if (!keep) left.add(r.rowId)
    return keep
  })
  if (loopChanged) for (const r of s.rows) restart(r)
  //    A changed loop or tempo moves every realignment: a fold whose target no longer realigns
  //    inside the window walks back from this top. Checked on every top, not only on a change
  //    seen here, so a state saved without its tempo is covered too.
  const outside = new Set<string>()
  const allowed = radioFoldAllowedCycles(loopBeats, input.bpm)
  for (const r of s.rows) {
    if (r.mode === 'unfolding' || allowed.includes(r.targetBeats)) continue
    outside.add(r.rowId)
    if (r.unfoldSince === null) r.unfoldSince = lap
  }
  const marked = s.rows.some((r) => r.mode === 'settled' && realignsAt(r, lap, loopBeats))
  // Hurrying, a top that is not a realignment may still open for what waits on one. Drawn only
  // while hurrying, so an unhurried machine draws exactly what it always did. `marked` stays the
  // true realignment: the change and the turnaround prefer that one alone.
  const opensAnyway = h > 0 && draw() < FOLD_HURRY_OPEN_CHANCE * h
  const opens = (r: RadioFoldRowState): boolean => realignsAt(r, lap, loopBeats) || opensAnyway

  // 2. Stretches. `fold` 0 ends a folded stretch at once and keeps it straight. A straight
  //    stretch only counts its laps once every fold has walked back: it is meant to be heard.
  if (f === 0 && s.stretch === 'folded') s.stretchEndsLap = lap
  if (s.stretch === 'straight' && s.rows.length > 0) s.stretchEndsLap += 1
  if (lap >= s.stretchEndsLap) {
    if (s.stretch === 'folded' || f === 0) {
      s.stretch = 'straight'
      const bars =
        lerp(FOLD_STRAIGHT_STRETCH_BARS.atNone, FOLD_STRAIGHT_STRETCH_BARS.atFull, f) *
        (0.75 + 0.5 * draw()) *
        stretchScale
      s.stretchEndsLap = lap + stretchLaps(bars, input.loopBars)
      for (const r of s.rows) if (r.unfoldSince === null) r.unfoldSince = lap
    } else {
      s.stretch = 'folded'
      const bars =
        lerp(FOLD_FOLDED_STRETCH_BARS.atNone, FOLD_FOLDED_STRETCH_BARS.atFull, f) *
        (0.75 + 0.5 * draw()) *
        stretchScale
      s.stretchEndsLap = lap + stretchLaps(bars, input.loopBars)
    }
  }

  // 2b. A settled fold's own realignment top (v2 section 1). It counts the top; once it has passed
  //     its drawn count it rotates out if another row could take its place -- it walks back from
  //     here (3), and that row folds in on the top the walk-back ends (5). Otherwise it re-folds
  //     by the bend's chance: a new length from the bend's menu (never its own) in one or two
  //     steps, or, where the menu has offsets (bend 50 and up), the same length at a new phase.
  //     Only in a folded stretch, never a fold already asked to leave.
  if (s.stretch === 'folded' && f > 0) {
    for (const r of s.rows) {
      if (r.mode !== 'settled' || r.unfoldSince !== null || !opens(r)) continue
      r.realigns = (r.realigns ?? 0) + 1
      if (
        (s.rotate ?? null) === null &&
        r.realigns >= hurried(r.rotateAfter ?? FOLD_ROTATE_AFTER_REALIGNS.max, 1)
      ) {
        const others = foldable()
        if (others.length > 0) {
          s.rotate = { from: r.rowId, to: pickFrom(others, draw()).id }
          r.unfoldSince = lap
          continue
        }
      }
      if (draw() >= lerp(FOLD_REFOLD_CHANCE.atNone, FOLD_REFOLD_CHANCE.atFull, f)) continue
      const row = byId.get(r.rowId)!
      const lengths = foldTargets(row, loopBeats, input.bpm, f).filter((c) => c !== r.targetBeats)
      const phases = phaseMenu(f)
      const otherPhases = phases.filter((p) => p !== r.phaseBeats)
      // null: the same length at a new phase
      const choices: (number | null)[] = [
        ...lengths,
        // a phase-only re-fold needs a phase menu (bend 50 and up), even if a fold drawn higher still sits off the beat
        ...(phases.length > 1 && otherPhases.length > 0 ? [null] : [])
      ]
      if (choices.length === 0) continue
      const pick = pickFrom(choices, draw())
      r.mode = 'refolding'
      if (pick === null) {
        r.phaseBeats = pickFrom(otherPhases, draw())
        r.path = []
      } else {
        r.phaseBeats = pickFrom(phases, draw())
        r.targetBeats = pick
        r.path = radioFoldPath(r.cycleBeats, pick, hurried(1 + Math.floor(draw() * 2), 1))
        r.cycleBeats = r.path.shift() ?? pick
        // the walk back out passes only lengths it played longer than the new target, at most
        // three of them, the nearest: an unfold stays three steps at most, as in v1
        r.walk = [...(r.walk ?? []).filter((w) => w > pick).slice(-3), pick]
      }
      restart(r)
    }
  }

  // 3. Unfolding starts: at once while still folding or outside the window, else on the row's own
  //    realignment top (or after FOLD_UNFOLD_MAX_WAIT_LAPS), walking back the way it came: the
  //    lengths it stepped in through, in reverse, then full length.
  for (const r of s.rows) {
    if (r.unfoldSince === null || r.mode === 'unfolding') continue
    const due =
      r.mode === 'folding' ||
      r.mode === 'refolding' ||
      outside.has(r.rowId) ||
      opens(r) ||
      lap - r.unfoldSince >= hurried(FOLD_UNFOLD_MAX_WAIT_LAPS, 0)
    if (!due) continue
    r.mode = 'unfolding'
    r.targetBeats = r.fullBeats
    const from = r.cycleBeats
    r.path =
      r.walk !== undefined
        ? [
            ...r.walk
              .slice(0, -1)
              .reverse()
              .filter((w) => w > from),
            r.fullBeats
          ]
        : radioFoldPath(r.cycleBeats, r.fullBeats, 3)
    r.cycleBeats = r.path.shift() ?? r.fullBeats
    restart(r)
  }

  // 4. Curves step on, one length per loop top. A fold that reaches its target settles; a row
  //    that walks back to full length leaves, and plays full length for at least this top.
  for (const r of s.rows) {
    if (r.mode === 'settled' || r.originLap === lap) continue
    const next = r.path.shift()
    if (next === undefined) {
      if (r.mode === 'folding' || r.mode === 'refolding') r.mode = 'settled'
      continue
    }
    r.cycleBeats = next
    restart(r)
    if (r.mode === 'folding') r.walk?.push(next)
    if (r.path.length === 0 && (r.mode === 'folding' || r.mode === 'refolding')) r.mode = 'settled'
  }
  s.rows = s.rows.filter((r) => {
    if (r.cycleBeats < r.fullBeats) return true
    left.add(r.rowId)
    return false
  })

  // 5. New folds, only in a folded stretch: one at once when none is folding, a second (high
  //    `fold` only) on a realignment top, half the time. A row still walking back holds its
  //    place against the most rows at once, so below fold 60 one row at a time it is. A rotation
  //    (2b) holds every other new fold back until its `from` has left; on that top its `to` folds
  //    in, if it still may (else the usual pick).
  if (s.stretch !== 'folded' || f === 0) s.rotate = null
  if (s.stretch === 'folded' && f > 0) {
    let row: RadioFoldRow | undefined
    const rotate = s.rotate ?? null
    if (rotate !== null && !s.rows.some((r) => r.rowId === rotate.from)) {
      s.rotate = null
      if (s.rows.length < maxRows(f)) row = foldable().find((x) => x.id === rotate.to)
    }
    if (row === undefined && (s.rotate ?? null) === null) {
      const active = s.rows.filter((r) => r.unfoldSince === null).length
      const may =
        s.rows.length < maxRows(f) && (active === 0 || ((marked || opensAnyway) && draw() < 0.5))
      const candidates = may ? foldable() : []
      if (candidates.length > 0) row = pickFrom(candidates, draw())
    }
    if (row !== undefined) {
      const target = pickFrom(foldTargets(row, loopBeats, input.bpm, f), draw())
      const phase = pickFrom(phaseMenu(f), draw())
      const full = row.barLength * 4
      const path = radioFoldPath(full, target, hurried(2 + Math.floor(draw() * 3), 1))
      const first = path.shift() ?? target
      const { min, max } = FOLD_ROTATE_AFTER_REALIGNS
      const rotateAfter = min + Math.floor(draw() * (max - min + 1))
      s.rows.push({
        rowId: row.id,
        stemId: row.stemId!,
        fullBeats: full,
        targetBeats: target,
        cycleBeats: first,
        phaseBeats: phase,
        originLap: lap,
        path,
        walk: [first],
        mode: path.length === 0 ? 'settled' : 'folding',
        unfoldSince: null,
        serial: ++s.serial,
        realigns: 0,
        rotateAfter
      })
    }
  }

  // 6. Drift: every audible row, by id so the draws do not depend on the rows' order.
  const drift: Record<string, FoldDriftLap> = {}
  const nextDrift: Record<string, RowDrift> = {}
  const audible = input.rows
    .filter((r) => r.audible)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const ranges = radioFoldDriftRange(input.fold)
  for (const row of audible) {
    const d: RowDrift = { ...(s.drift[row.id] ?? restingDrift(lap)) }
    for (const p of FOLD_DRIFT_PARAMS) {
      if (lap >= d[p].startLap + d[p].laps) {
        const range = ranges[p]
        const bars = lerp(FOLD_DRIFT_SWEEP_BARS.min, FOLD_DRIFT_SWEEP_BARS.max, draw())
        d[p] = {
          from: d[p].to,
          to: lerp(range.min, range.max, draw()),
          startLap: lap,
          laps: Math.max(FOLD_DRIFT_MIN_SWEEP_LAPS, stretchLaps(bars, input.loopBars))
        }
      }
    }
    nextDrift[row.id] = d
    drift[row.id] = {
      cutoff: sweepAt(d.cutoff, lap),
      send: sweepAt(d.send, lap),
      dub: sweepAt(d.dub, lap)
    }
  }
  s.drift = nextDrift
  s.marked = marked

  return {
    state: s,
    lap,
    anchorId,
    cycles: s.rows.map((r) => ({
      rowId: r.rowId,
      stemId: r.stemId,
      cycleId: `${r.rowId}~${r.serial}`,
      cycleBeats: r.cycleBeats,
      phaseBeats: r.phaseBeats
    })),
    marked,
    stretch: s.stretch,
    drift
  }
}

/** Playback restarted while `lap` plays: a play after a pause, a seek, a snap back to the top.
 * The engine starts a new lap clock on every such move (Transport.cpp) and every folded cycle
 * restarts its phase from the top of the lap it restarted in (CycleTable::originFor), so the
 * machine's own origins have to follow, or it would mark realignment tops (and re-fold, rotate,
 * unfold on them) that the engine no longer plays. Every row whose cycle began before `lap` now
 * begins on it; a cycle beginning on or after it is left alone. Ids are untouched (a restart is not
 * a new cycle: the engine keeps the ones it has), nothing is drawn, so the seed still replays the
 * same decisions from here. `marked` (the decided lap's top) holds only if a settled row still
 * realigns there. Pure: `state` is untouched. */
export function radioFoldRestartAt(state: RadioFoldState, lap: number): RadioFoldState {
  if (!state.rows.some((r) => r.originLap < lap)) return state
  const rows = state.rows.map((r) => (r.originLap < lap ? { ...r, originLap: lap } : r))
  return { ...state, rows, marked: state.marked && marksTop(rows, state.lap, state.loopBeats) }
}

/** radioFoldRestartAt for a step: its state, and its own `marked` (the step's lap's top). */
export function radioFoldRestartStep(step: RadioFoldStep, lap: number): RadioFoldStep {
  const state = radioFoldRestartAt(step.state, lap)
  if (state === step.state) return step
  return {
    ...step,
    state,
    marked: step.marked && marksTop(state.rows, step.lap, state.loopBeats)
  }
}

function marksTop(rows: readonly RadioFoldRowState[], lap: number, loopBeats: number): boolean {
  return rows.some((r) => r.mode === 'settled' && realignsAt(r, lap, loopBeats))
}

/** The tops ahead that are realignments if nothing changes, in bars from the top of the lap
 * playing now (the one before the decided lap): the decided lap's own top is `loopBars`. */
export function radioFoldMarkedBarsAhead(
  state: RadioFoldState,
  loopBars: number,
  horizonLaps: number
): number[] {
  const out: number[] = []
  if (state.lap < 0) return out
  if (state.marked) out.push(loopBars)
  const loopBeats = loopBars * 4
  for (let k = 1; k <= horizonLaps; k++) {
    const lap = state.lap + k
    if (
      state.rows.some(
        (r) => r.mode === 'settled' && r.unfoldSince === null && realignsAt(r, lap, loopBeats)
      )
    ) {
      out.push((k + 1) * loopBars)
    }
  }
  return out
}

/** A change's interval under the mode: the drawn bars, moved later to a realignment top when one
 * comes within at most `preferWaitLaps` laps of it (spec section 1: the next change prefers it;
 * FOLD_PREFER_WAIT_LAPS by default, 0 never waits: fold following the pace slider fades it out).
 * `stepOwed`: the lap playing now has started but its wrap's step has not run yet (sssketch steps
 * a couple of microtasks after the wrap, behind that wrap's landings), so `state` still decided
 * the lap playing now and counts its tops from the lap before: `fromBars` is a lap further on. */
export function radioFoldIntervalBars(
  state: RadioFoldState | null,
  drawnBars: number,
  loopBars: number,
  fromBars = 0,
  stepOwed = false,
  preferWaitLaps: number = FOLD_PREFER_WAIT_LAPS
): number {
  if (state === null || !(loopBars > 0) || !(preferWaitLaps > 0)) return drawnBars
  const from = fromBars + (stepOwed ? loopBars : 0)
  const limit = drawnBars + preferWaitLaps * loopBars
  const horizon = Math.ceil((limit + from) / loopBars)
  let best: number | null = null
  for (const top of radioFoldMarkedBarsAhead(state, loopBars, horizon)) {
    const m = top - from
    if (m >= drawnBars && m <= limit && (best === null || m < best)) best = m
  }
  return best ?? drawnBars
}

/** A phrase end that is also a realignment top rolls its turnaround at `often`'s chance (spec
 * section 1: the next turnaround prefers it); `off` stays off. */
export function radioFoldTurnaroundRate(
  rate: RadioTurnarounds,
  markedTop: boolean
): RadioTurnarounds {
  return markedTop && rate !== 'off' ? 'often' : rate
}

/** Whether the fold machine holds `rowId` in the lap playing (`now`) or the next (`next`): a
 * cycle for it in either step. Phase 1 of fold following the slider keeps such a row to its loop
 * tops (radioCadenceBarEvery); phase 2 lets it cut mid-loop, carrying its fold (radioFoldCarry). */
export function radioFoldHoldsRow(
  now: RadioFoldStep | null,
  next: RadioFoldStep | null,
  rowId: string
): boolean {
  return [now, next].some((st) => st?.cycles.some((c) => c.rowId === rowId) === true)
}

/** PHASE 1. The rows radio may pick from while fold mode runs in the slider's bar band (`active`):
 * every id the fold machine does not hold in the lap playing or the next (radioFoldHoldsRow), so
 * the folded layers keep their stems while the rest churn; all of `ids` when that leaves none, or
 * when not `active` (the same array, so nothing downstream draws differently). */
export function radioFoldPickableIds(
  ids: readonly string[],
  now: RadioFoldStep | null,
  next: RadioFoldStep | null,
  active: boolean
): readonly string[] {
  if (!active) return ids
  const free = ids.filter((id) => !radioFoldHoldsRow(now, next, id))
  return free.length > 0 ? free : ids
}
