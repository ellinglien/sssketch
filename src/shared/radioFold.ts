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
import { seededRandom } from './seededRandom'

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

/** The parameters drift moves (spec section 1). `cutoff` is the row's own low-pass (1 open),
 * `send` an extra reverb send over the row's own, `dub` its send into the dub echo. */
export type FoldDriftParam = 'cutoff' | 'send' | 'dub'
export const FOLD_DRIFT_PARAMS: readonly FoldDriftParam[] = ['cutoff', 'send', 'dub']
/** Where drift may go, and where it rests. The cutoff never closes (0.62 is about 1.4 kHz). */
export const FOLD_DRIFT_RANGE: Readonly<
  Record<FoldDriftParam, { min: number; max: number; rest: number }>
> = Object.freeze({
  cutoff: { min: 0.62, max: 1, rest: 1 },
  send: { min: 0, max: 0.15, rest: 0 },
  dub: { min: 0, max: 0.18, rest: 0 }
})
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
  mode: 'folding' | 'settled' | 'unfolding'
  /** The lap it was asked to unfold on (the stretch ended), or null. */
  unfoldSince: number | null
  serial: number
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
    marked: false
  }
}

export interface RadioFoldInput {
  /** In a stable order (the panel's slot order): new folds draw from it by index. */
  rows: readonly RadioFoldRow[]
  loopBars: number
  bpm: number
  /** The `fold` fader, 0..100. */
  fold: number
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
  const draw = (): number => seededRandom(`${s.seed}#${s.draws++}`)()
  const lap = s.lap + 1
  s.lap = lap
  const f = normalizeFoldAmount(input.fold, DEFAULT_RADIO_FOLD) / 100
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

  // 2. Stretches. `fold` 0 ends a folded stretch at once and keeps it straight. A straight
  //    stretch only counts its laps once every fold has walked back: it is meant to be heard.
  if (f === 0 && s.stretch === 'folded') s.stretchEndsLap = lap
  if (s.stretch === 'straight' && s.rows.length > 0) s.stretchEndsLap += 1
  if (lap >= s.stretchEndsLap) {
    if (s.stretch === 'folded' || f === 0) {
      s.stretch = 'straight'
      const bars =
        lerp(FOLD_STRAIGHT_STRETCH_BARS.atNone, FOLD_STRAIGHT_STRETCH_BARS.atFull, f) *
        (0.75 + 0.5 * draw())
      s.stretchEndsLap = lap + stretchLaps(bars, input.loopBars)
      for (const r of s.rows) if (r.unfoldSince === null) r.unfoldSince = lap
    } else {
      s.stretch = 'folded'
      const bars =
        lerp(FOLD_FOLDED_STRETCH_BARS.atNone, FOLD_FOLDED_STRETCH_BARS.atFull, f) *
        (0.75 + 0.5 * draw())
      s.stretchEndsLap = lap + stretchLaps(bars, input.loopBars)
    }
  }

  // 3. Unfolding starts: at once while still folding or outside the window, else on the row's own
  //    realignment top (or after FOLD_UNFOLD_MAX_WAIT_LAPS), walking back the way it came: the
  //    lengths it stepped in through, in reverse, then full length.
  for (const r of s.rows) {
    if (r.unfoldSince === null || r.mode === 'unfolding') continue
    const due =
      r.mode === 'folding' ||
      outside.has(r.rowId) ||
      realignsAt(r, lap, loopBeats) ||
      lap - r.unfoldSince >= FOLD_UNFOLD_MAX_WAIT_LAPS
    if (!due) continue
    r.mode = 'unfolding'
    r.targetBeats = r.fullBeats
    r.path =
      r.walk !== undefined
        ? [...r.walk.slice(0, -1).reverse(), r.fullBeats]
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
      if (r.mode === 'folding') r.mode = 'settled'
      continue
    }
    r.cycleBeats = next
    restart(r)
    if (r.mode === 'folding') r.walk?.push(next)
    if (r.path.length === 0 && r.mode === 'folding') r.mode = 'settled'
  }
  s.rows = s.rows.filter((r) => {
    if (r.cycleBeats < r.fullBeats) return true
    left.add(r.rowId)
    return false
  })

  // 5. New folds, only in a folded stretch: one at once when none is folding, a second (high
  //    `fold` only) on a realignment top, half the time. A row still walking back holds its
  //    place against the most rows at once, so below fold 60 one row at a time it is.
  if (s.stretch === 'folded' && f > 0) {
    const active = s.rows.filter((r) => r.unfoldSince === null).length
    const may = s.rows.length < maxRows(f) && (active === 0 || (marked && draw() < 0.5))
    if (may) {
      const taken = new Set(s.rows.map((r) => r.rowId))
      const candidates = input.rows.filter(
        (row) =>
          !taken.has(row.id) &&
          !left.has(row.id) &&
          radioFoldCanFold(row, anchorId) &&
          foldTargets(row, loopBeats, input.bpm, f).length > 0
      )
      if (candidates.length > 0) {
        const row = pickFrom(candidates, draw())
        const target = pickFrom(foldTargets(row, loopBeats, input.bpm, f), draw())
        const phase = pickFrom(phaseMenu(f), draw())
        const full = row.barLength * 4
        const path = radioFoldPath(full, target, 2 + Math.floor(draw() * 3))
        const first = path.shift() ?? target
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
          serial: ++s.serial
        })
      }
    }
  }

  // 6. Drift: every audible row, by id so the draws do not depend on the rows' order.
  const drift: Record<string, FoldDriftLap> = {}
  const nextDrift: Record<string, RowDrift> = {}
  const audible = input.rows
    .filter((r) => r.audible)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  for (const row of audible) {
    const d: RowDrift = { ...(s.drift[row.id] ?? restingDrift(lap)) }
    for (const p of FOLD_DRIFT_PARAMS) {
      if (lap >= d[p].startLap + d[p].laps) {
        const range = FOLD_DRIFT_RANGE[p]
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
 * comes within FOLD_PREFER_WAIT_LAPS laps of it (spec section 1: the next change prefers it). */
export function radioFoldIntervalBars(
  state: RadioFoldState | null,
  drawnBars: number,
  loopBars: number,
  fromBars = 0
): number {
  if (state === null || !(loopBars > 0)) return drawnBars
  const limit = drawnBars + FOLD_PREFER_WAIT_LAPS * loopBars
  const horizon = Math.ceil((limit + fromBars) / loopBars)
  let best: number | null = null
  for (const top of radioFoldMarkedBarsAhead(state, loopBars, horizon)) {
    const m = top - fromBars
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
