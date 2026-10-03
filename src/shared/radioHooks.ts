// src/shared/radioHooks.ts
//
// HOOKS THAT LEAVE AND COME BACK (docs/superpowers/specs/2026-10-03-radio-anointed-stems-design.md
// section 2). A hook is a STEM on its home row: it stays 16-32 bars, leaves on a line with an echo
// throw (bass dry), is away 16-32 bars while its row plays a substitute radio picks, and comes
// back on a phrase start -- preferring one where something else changes, so the return is the
// drop. One hook away at a time; after HOOK_RETURNS_BEFORE_REST returns it rests longer. Every
// length scales with the pace slider (radioHookPaceScale).
//
// Successor to radioSlotFlags' `hook` (a row flag that only divided the row's draw weight). Not
// persisted: a hook names a stem on a row of this session.
//
// Pure and seeded. The runtime runs stepRadioHooks once per loop top, BEFORE the fold step and the
// turnaround roll (spec section 10, risk 1), and lands what it decided a lap later, through its
// manual-change path, marked as the hook's (never clearing a hook or a replace-soon).
//
// No hooks: no draws, and the same state object back.

import type { DiscoverSlotKind } from './discoverSlotKind'
import { drawThrowBeats, drawThrowEcho, type ThrowTiming } from './radioThrows'

export type RadioHookState = 'in' | 'away' | 'resting'

/** An exit's echo throw (radioThrows' drawThrowBeats + drawThrowEcho, in that order). */
export interface RadioHookThrow {
  beats: number
  timing: ThrowTiming
  feedback: number
}

/** An event decided at a wrap, landing on the NEXT wrap (its line), binding once decided. */
export type RadioHookDecided =
  | {
      event: 'exit'
      /** The row goes silent (it rests) instead of taking a substitute. */
      rest: boolean
      /** Null: a dry exit (a bass row). */
      throw: RadioHookThrow | null
      /** The absence drawn for it, in bars. */
      awayBars: number
      /** The absence is the long rest (HOOK_LONG_REST): its return does not count. */
      longRest: boolean
    }
  | {
      event: 'return'
      /** The stay drawn for it, in bars. */
      stayBars: number
      /** Bars it will have been away at the line. */
      awayBars: number
    }

export interface RadioHook {
  rowId: string
  /** The hooked stem (the row plays it while `in`). */
  stemId: string
  state: RadioHookState
  /** Bars played in the current state, counted lap by lap at each wrap. */
  bars: number
  /** The state's drawn length; the event is due at the first line where `bars` reaches it. */
  targetBars: number
  /** Returns since it was set, or since its last long rest. */
  returns: number
  /** Away on its long rest: its return does not count toward the next one. */
  longRest: boolean
  /** It has waited one phrase this absence (the calm wait). */
  waited: boolean
  /** Tapped back: no calm wait this absence. */
  broughtBack: boolean
  /** The runtime was asked to arm or warm for the next event (`prepare`): once per state. */
  prepared: boolean
  /** The event decided for the next line, or null. */
  decided: RadioHookDecided | null
  /** Order of setting, for the cap's oldest-first release. */
  setSeq: number
}

export interface RadioHooksState {
  hooks: readonly RadioHook[]
  /** The next setSeq. */
  seq: number
}

export const NO_RADIO_HOOKS: RadioHooksState = Object.freeze({
  hooks: Object.freeze([]) as readonly RadioHook[],
  seq: 0
}) as RadioHooksState

// ---- the numbers (spec 2.3-2.6; every one [INF], to tune by ear) ----

export const HOOK_STAY: readonly { bars: number; weight: number }[] = Object.freeze([
  { bars: 16, weight: 0.25 },
  { bars: 24, weight: 0.35 },
  { bars: 32, weight: 0.4 }
])
export const HOOK_AWAY: readonly { bars: number; weight: number }[] = Object.freeze([
  { bars: 16, weight: 0.4 },
  { bars: 24, weight: 0.35 },
  { bars: 32, weight: 0.25 }
])
export const HOOK_LONG_REST: readonly { bars: number; weight: number }[] = Object.freeze([
  { bars: 48, weight: 0.5 },
  { bars: 64, weight: 0.5 }
])
/** Returns before the long rest. */
export const HOOK_RETURNS_BEFORE_REST = 3
/** Chance an eligible exit rests (the row goes silent) instead of taking a substitute. */
export const HOOK_REST_CHANCE = 0.5
/** At most this many row landings in the last phrase is calm. */
export const HOOK_CALM_LANDINGS = 1
/** Chance a return waits one phrase when it has been calm. */
export const HOOK_CALM_WAIT_CHANCE = 0.5
/** Lengths are rounded to this, and clamped to [HOOK_MIN_BARS, HOOK_MAX_BARS]. */
export const HOOK_ROUND_BARS = 8
export const HOOK_MIN_BARS = 8
export const HOOK_MAX_BARS = 64
/** [level, scale], geometric between knots: shorter at ludicrous, longer at slow. */
export const HOOK_PACE_SCALE_KNOTS: readonly (readonly [number, number])[] = Object.freeze([
  [0, 1.5],
  [25, 1.25],
  [50, 1],
  [70, 0.75],
  [90, 0.5],
  [100, 0.5]
] as const)

/** The hook cap: half the rows, at least one. */
export function radioHooksMax(rows: number): number {
  return Math.max(1, Math.floor((Number.isFinite(rows) ? rows : 0) / 2))
}

/** How the pace slider scales every hook length, by its level (0..100). */
export function radioHookPaceScale(level: number): number {
  const knots = HOOK_PACE_SCALE_KNOTS
  const l = Number.isFinite(level) ? Math.min(100, Math.max(0, level)) : 50
  let i = 0
  while (i < knots.length - 2 && l > knots[i + 1][0]) i++
  const [l0, s0] = knots[i]
  const [l1, s1] = knots[i + 1]
  const t = l1 > l0 ? (l - l0) / (l1 - l0) : 0
  return s0 * Math.pow(s1 / s0, Math.min(1, Math.max(0, t)))
}

/** A length scaled, rounded to the nearest HOOK_ROUND_BARS (ties up) and clamped. */
export function radioHookBars(bars: number, scale: number): number {
  const r = Math.floor((bars * scale) / HOOK_ROUND_BARS + 0.5 + 1e-9) * HOOK_ROUND_BARS
  return Math.min(HOOK_MAX_BARS, Math.max(HOOK_MIN_BARS, r))
}

/** One draw from a menu, scaled by the pace. */
export function drawRadioHookBars(
  menu: readonly { bars: number; weight: number }[],
  scale: number,
  random: () => number
): number {
  const total = menu.reduce((s, m) => s + m.weight, 0)
  let draw = random() * total
  for (const m of menu) {
    draw -= m.weight
    if (draw < 0) return radioHookBars(m.bars, scale)
  }
  return radioHookBars(menu[menu.length - 1].bars, scale)
}

// ---- lines (spec 2.2) ----

/** What the wrap ending the lap that starts now is: a phrase start (the new turnaroundLap 0), a
 * half line (an even phrase, its middle), or neither. `lap` is the turnaroundLap starting now,
 * `phraseLaps` the turnaround phrase in laps (turnaroundPhraseLaps). Exits land on lines (both),
 * returns only on phrase starts. */
export function radioHookLine(lap: number, phraseLaps: number): 'phrase' | 'half' | null {
  if (!(phraseLaps > 0)) return null
  const next = (Math.floor(lap) + 1) % phraseLaps
  if (next === 0) return 'phrase'
  if (phraseLaps % 2 === 0 && next === phraseLaps / 2) return 'half'
  return null
}

// ---- who holds what ----

export function radioHookOf(state: RadioHooksState, rowId: string): RadioHook | null {
  return state.hooks.find((h) => h.rowId === rowId) ?? null
}

/** A hook is IN on this row: the planner keeps it (TurnaroundRow.hooked), fold never folds it. */
export function radioHookInRow(state: RadioHooksState, rowId: string): boolean {
  const h = radioHookOf(state, rowId)
  return h !== null && h.state === 'in'
}

/** A hook will be in on this row in the lap after the coming wrap: in and not leaving there, or
 * coming back there. What a fold step deciding that lap reads (spec section 5). */
export function radioHookInRowNext(state: RadioHooksState, rowId: string): boolean {
  const h = radioHookOf(state, rowId)
  if (h === null) return false
  if (h.decided?.event === 'return') return true
  return h.state === 'in' && h.decided?.event !== 'exit'
}

/** The row is a hook's home, in any state: the density arc never removes it. */
export function radioHookReservesRow(state: RadioHooksState, rowId: string): boolean {
  return radioHookOf(state, rowId) !== null
}

/** Radio's own turnover leaves this row alone: a hook is in, an event is decided on it, or the
 * hook is away and its return is being prepared. */
export function radioHookTurnoverExcluded(state: RadioHooksState, rowId: string): boolean {
  const h = radioHookOf(state, rowId)
  if (h === null) return false
  return h.state === 'in' || h.decided !== null || h.prepared
}

/** The stems of hooks away or resting: used, so no row picks them while they are out. */
export function radioHookStemsAway(state: RadioHooksState): string[] {
  return state.hooks.filter((h) => h.state !== 'in').map((h) => h.stemId)
}

/** A hook is away, resting, or has an event decided: no other exit may be decided. */
function anyOut(state: RadioHooksState, exceptRow?: string): boolean {
  return state.hooks.some((h) => h.rowId !== exceptRow && (h.state !== 'in' || h.decided !== null))
}

// ---- taps (spec 2.7) ----

function withHooks(state: RadioHooksState, hooks: RadioHook[], seq = state.seq): RadioHooksState {
  return { hooks, seq }
}

/** Release the hook on this row (any state). The runtime handles the row: an away hook's
 * substitute stays; a resting row gets a fresh pick. */
export function releaseRadioHook(
  state: RadioHooksState,
  rowId: string
): { state: RadioHooksState; released: RadioHook | null } {
  const h = radioHookOf(state, rowId)
  if (h === null) return { state, released: null }
  return {
    state: withHooks(
      state,
      state.hooks.filter((x) => x !== h)
    ),
    released: h
  }
}

export interface RadioHookSet {
  rowId: string
  /** The stem the row plays now. */
  stemId: string
  /** Rows on the bed, for the cap. */
  rowCount: number
  paceLevel: number
  random: () => number
}

/** Hook the row's playing stem: in, with a stay drawn (one draw). At the cap, hooks are released
 * until the new one fits -- more than one when the bed has shrunk since they were set -- each time
 * the oldest that is in with nothing decided, else the oldest (an away one is coming back).
 * `released` is in release order. */
function setHook(
  state: RadioHooksState,
  o: RadioHookSet
): { state: RadioHooksState; released: RadioHook[] } {
  let hooks = [...state.hooks]
  const released: RadioHook[] = []
  const max = radioHooksMax(o.rowCount)
  while (hooks.length > 0 && hooks.length >= max) {
    const bySeq = [...hooks].sort((a, b) => a.setSeq - b.setSeq)
    const out = bySeq.find((h) => h.state === 'in' && h.decided === null) ?? bySeq[0]
    released.push(out)
    hooks = hooks.filter((h) => h !== out)
  }
  hooks.push({
    rowId: o.rowId,
    stemId: o.stemId,
    state: 'in',
    bars: 0,
    targetBars: drawRadioHookBars(HOOK_STAY, radioHookPaceScale(o.paceLevel), o.random),
    returns: 0,
    longRest: false,
    waited: false,
    broughtBack: false,
    prepared: false,
    decided: null,
    setSeq: state.seq
  })
  return { state: withHooks(state, hooks, state.seq + 1), released }
}

/** The row's hook toggle: releases a hook there (any state), or hooks the playing stem (releasing
 * what the cap needs: setHook). `released`: every hook let go, in release order. */
export function toggleRadioHookStem(
  state: RadioHooksState,
  o: RadioHookSet
): { state: RadioHooksState; released: RadioHook[]; set: boolean } {
  if (radioHookOf(state, o.rowId) !== null) {
    const r = releaseRadioHook(state, o.rowId)
    return { state: r.state, released: r.released === null ? [] : [r.released], set: false }
  }
  return { ...setHook(state, o), set: true }
}

/** 👍's hold half: hooks the row's playing stem when the row has no hook and `canHold` (radio on,
 * the row not padlocked). Never un-hooks; on a row whose hook is away it does nothing (a row
 * holds one hook, and that one is coming back). */
export function likeRadioStem(
  state: RadioHooksState,
  o: RadioHookSet & { canHold: boolean }
): { state: RadioHooksState; released: RadioHook[] } {
  if (!o.canHold || radioHookOf(state, o.rowId) !== null) return { state, released: [] }
  return setHook(state, o)
}

/** Tapping an away hook's dimmed name: it comes back at the next phrase start whose decision is
 * still to come, with no calm wait. */
export function bringRadioHookBack(state: RadioHooksState, rowId: string): RadioHooksState {
  const h = radioHookOf(state, rowId)
  if (h === null || h.state === 'in' || h.decided !== null) return state
  return withHooks(
    state,
    state.hooks.map((x) =>
      x === h ? { ...x, targetBars: Math.min(x.targetBars, x.bars), broughtBack: true } : x
    )
  )
}

/** A manual change committed on the row (similar, adjacent, random, swap-now, Cmd, the phone --
 * never a hook's own landing): a hook IN is cleared (the hooked stem is gone, and a hook is about
 * that stem); an away or resting hook stays (the change replaced its substitute). */
export function forgetRadioHookOnManualChange(
  state: RadioHooksState,
  rowId: string
): RadioHooksState {
  const h = radioHookOf(state, rowId)
  if (h === null || h.state !== 'in') return state
  return withHooks(
    state,
    state.hooks.filter((x) => x !== h)
  )
}

/** A decided event the runtime could not land (taken back on hold, refused, a manual change won
 * the line): undecided, it is tried again at the next line (an exit) or phrase start (a
 * return). */
export function withdrawRadioHookEvent(state: RadioHooksState, rowId: string): RadioHooksState {
  const h = radioHookOf(state, rowId)
  if (h === null || h.decided === null) return state
  return withHooks(
    state,
    state.hooks.map((x) => (x === h ? { ...x, decided: null } : x))
  )
}

/** Drop hooks for rows that no longer exist. The same object when none was stale. */
export function pruneRadioHooks(
  state: RadioHooksState,
  liveRowIds: ReadonlySet<string>
): RadioHooksState {
  if (state.hooks.every((h) => liveRowIds.has(h.rowId))) return state
  return withHooks(
    state,
    state.hooks.filter((h) => liveRowIds.has(h.rowId))
  )
}

/** Radio off (desktop) or stopped (web): away and resting hooks are dropped (the row keeps what
 * it plays), decisions undone; hooks in are kept, inert. */
export function radioHooksStopped(state: RadioHooksState): RadioHooksState {
  if (state.hooks.every((h) => h.state === 'in' && h.decided === null && !h.prepared)) return state
  return withHooks(
    state,
    state.hooks
      .filter((h) => h.state === 'in')
      .map((h) => ({ ...h, decided: null, prepared: false }))
  )
}

/** Radio starting: every hook in draws a fresh stay (in row order), from bar 0. */
export function radioHooksStarted(
  state: RadioHooksState,
  o: { paceLevel: number; random: () => number }
): RadioHooksState {
  if (state.hooks.length === 0) return state
  const scale = radioHookPaceScale(o.paceLevel)
  return withHooks(
    state,
    state.hooks.map((h) => ({
      ...h,
      bars: 0,
      targetBars: drawRadioHookBars(HOOK_STAY, scale, o.random),
      decided: null,
      prepared: false
    }))
  )
}

// ---- the step, once per loop top (spec 2.4-2.6) ----

export interface RadioHookRowInput {
  id: string
  /** The stem the row plays now (null: none). */
  stemId: string | null
  kinds: readonly DiscoverSlotKind[]
  /** isRadioEligibleSlot: unlocked, audible, not rerolling. Radio's own rest silence does not
   * make a hook's home row ineligible; a user mute, a lock or a solo elsewhere does. */
  eligible: boolean
  /** The last heard row of drums or of bass (the arc's lastOfItsKind, over heard rows). */
  lastLowHeard: boolean
}

export interface RadioHooksStepInput {
  loopBars: number
  /** The turnaroundLap starting at this wrap (RadioClock.turnaroundLap after advanceRadioClock). */
  lap: number
  /** The turnaround phrase in laps (turnaroundPhraseLaps). */
  phraseLaps: number
  paceLevel: number
  /** Radio is held: the hook clock stops and nothing is decided. A decided event still lands. */
  held: boolean
  /** In row order (ties go to the earlier row). */
  rows: readonly RadioHookRowInput[]
  /** The event's stem is warm: an exit's substitute (a rest needs none), a return's hooked stem. */
  ready: (rowId: string, event: 'exit' | 'return') => boolean
  /** Something else changes at the next wrap (radio's change, decided or predicted, a companion, a
   * manual change, an arc step): a return there does not wait. */
  changeAtNextWrap: boolean
  /** Row landings, of any kind, in the last phrase (radioLandingsInPhrase). */
  calmLandings: number
  /** The density arc is thinning, with the count above its target. */
  arcThinning: boolean
  /** The runtime can silence a row at a line (resting exits). False: an exit never rests and its
   * rest draw is never made. */
  canRest: boolean
  random: () => number
}

export interface RadioHooksStepResult {
  state: RadioHooksState
  /** Events whose line is THIS wrap: the state has flipped (the runtime landed them). */
  applied: { rowId: string; event: 'exit' | 'return' }[]
  /** Arm a substitute (exit) or warm the hooked stem (return) for an event a line or so ahead. */
  prepare: { rowId: string; event: 'exit' | 'return'; stemId: string }[]
  /** Decided now, landing at the next wrap: binding. */
  decided: ({ rowId: string; stemId: string } & RadioHookDecided)[]
}

const isBass = (kinds: readonly DiscoverSlotKind[]): boolean => kinds.includes('bass')

/** The echo throw's draws, in order: beats, timing, feedback -- a regular throw's own
 * (drawThrowBeats, drawThrowEcho), so the two cannot drift. */
function drawExitThrow(random: () => number): RadioHookThrow {
  const beats = drawThrowBeats(random)
  return { beats, ...drawThrowEcho(random) }
}

/**
 * One loop top. In order:
 *   1. events decided at the last wrap land here: their state flips, `bars` from 0;
 *   2. unless held, every other hook's clock adds the lap that ended;
 *   3. unless held, decisions for the NEXT wrap, in row order: returns first (each on its own),
 *      then at most one exit -- none while another hook is out -- the hook with the most bars in;
 *   4. prepares: a hook whose event is within a line and a lap, once per state.
 * Draws, in row order: a return's calm wait (when calm and not yet waited), then its stay; an
 * exit's rest (when it may rest), its throw's three (when it throws), then its absence.
 */
export function stepRadioHooks(
  state: RadioHooksState,
  input: RadioHooksStepInput
): RadioHooksStepResult {
  const none: RadioHooksStepResult = { state, applied: [], prepare: [], decided: [] }
  if (state.hooks.length === 0) return none
  const loopBars = input.loopBars > 0 && Number.isFinite(input.loopBars) ? input.loopBars : 0
  const applied: RadioHooksStepResult['applied'] = []
  // 1-2: land, then count
  let hooks: RadioHook[] = state.hooks.map((h) => {
    const d = h.decided
    if (d !== null) {
      applied.push({ rowId: h.rowId, event: d.event })
      if (d.event === 'exit') {
        return {
          ...h,
          state: d.rest ? 'resting' : 'away',
          bars: 0,
          targetBars: d.awayBars,
          longRest: d.longRest,
          prepared: false,
          decided: null,
          broughtBack: false
        }
      }
      return {
        ...h,
        state: 'in',
        bars: 0,
        targetBars: d.stayBars,
        // HOOK_RETURNS_BEFORE_REST ordinary absences between long rests
        returns: h.longRest ? 0 : h.returns + 1,
        longRest: false,
        waited: false,
        broughtBack: false,
        prepared: false,
        decided: null
      }
    }
    return input.held || loopBars === 0 ? h : { ...h, bars: h.bars + loopBars }
  })
  if (input.held || loopBars === 0) {
    return applied.length === 0 ? none : { ...none, state: withHooks(state, hooks), applied }
  }
  const line = radioHookLine(input.lap, input.phraseLaps)
  const scale = radioHookPaceScale(input.paceLevel)
  const phraseBars = input.phraseLaps * loopBars
  const rowOf = (id: string): RadioHookRowInput | undefined => input.rows.find((r) => r.id === id)
  const order = (h: RadioHook): number => {
    const i = input.rows.findIndex((r) => r.id === h.rowId)
    return i < 0 ? Number.POSITIVE_INFINITY : i
  }
  const decided: RadioHooksStepResult['decided'] = []
  const set = (h: RadioHook, next: RadioHook): void => {
    hooks = hooks.map((x) => (x === h ? next : x))
  }
  const byRow = [...hooks].sort((a, b) => order(a) - order(b))
  // 3a. returns, on phrase starts only
  if (line === 'phrase') {
    for (const h of byRow) {
      if (h.state === 'in' || h.decided !== null) continue
      const row = rowOf(h.rowId)
      if (row === undefined || !row.eligible) continue
      if (h.bars + loopBars < h.targetBars - 1e-9) continue
      if (!input.ready(h.rowId, 'return')) continue
      const calm = input.calmLandings <= HOOK_CALM_LANDINGS
      if (!input.changeAtNextWrap && calm && !h.waited && !h.broughtBack) {
        if (input.random() < HOOK_CALM_WAIT_CHANCE) {
          set(h, { ...h, targetBars: h.targetBars + phraseBars, waited: true })
          continue
        }
      }
      const d: RadioHookDecided = {
        event: 'return',
        stayBars: drawRadioHookBars(HOOK_STAY, scale, input.random),
        awayBars: h.bars + loopBars
      }
      set(h, { ...h, decided: d })
      decided.push({ rowId: h.rowId, stemId: h.stemId, ...d })
    }
  }
  // 3b. at most one exit, on a line, none while another hook is out
  if (line !== null) {
    const now = { hooks, seq: state.seq }
    const due = [...hooks]
      .filter((h) => {
        if (h.state !== 'in' || h.decided !== null) return false
        const row = rowOf(h.rowId)
        return (
          row !== undefined &&
          row.eligible &&
          row.stemId === h.stemId &&
          h.bars + loopBars >= h.targetBars - 1e-9 &&
          !anyOut(now, h.rowId)
        )
      })
      .sort((a, b) => b.bars - a.bars || order(a) - order(b))
    for (const h of due) {
      const row = rowOf(h.rowId)!
      const mayRest = input.canRest && input.arcThinning && !row.lastLowHeard
      // the substitute must be warm, unless this exit can rest -- decided by its draw below
      if (!mayRest && !input.ready(h.rowId, 'exit')) continue
      const rest = mayRest && input.random() < HOOK_REST_CHANCE
      if (!rest && !input.ready(h.rowId, 'exit')) continue
      const thrown = isBass(row.kinds) ? null : drawExitThrow(input.random)
      const longRest = h.returns >= HOOK_RETURNS_BEFORE_REST
      const awayBars = drawRadioHookBars(longRest ? HOOK_LONG_REST : HOOK_AWAY, scale, input.random)
      const d: RadioHookDecided = { event: 'exit', rest, throw: thrown, awayBars, longRest }
      set(h, { ...h, decided: d })
      decided.push({ rowId: h.rowId, stemId: h.stemId, ...d })
      break
    }
  }
  // 4. prepares
  const prepare: RadioHooksStepResult['prepare'] = []
  const exitSpacing =
    (input.phraseLaps % 2 === 0 ? input.phraseLaps / 2 : input.phraseLaps) * loopBars
  for (const h of [...hooks].sort((a, b) => order(a) - order(b))) {
    if (h.prepared || h.decided !== null) continue
    const event = h.state === 'in' ? 'exit' : 'return'
    const spacing = event === 'exit' ? exitSpacing : phraseBars
    if (h.targetBars - h.bars > spacing + loopBars + 1e-9) continue
    prepare.push({ rowId: h.rowId, event, stemId: h.stemId })
    set(h, { ...h, prepared: true })
  }
  return { state: withHooks(state, hooks), applied, prepare, decided }
}

// ---- calm: landings in the last phrase ----

/** Row landings per lap, the lap playing last; at most a phrase of laps. */
export type RadioLandingWindow = readonly number[]

export const NO_RADIO_LANDINGS: RadioLandingWindow = Object.freeze([0]) as RadioLandingWindow

/** A wrap: a new lap with none yet, keeping the last `phraseLaps`. */
export function advanceRadioLandingWindow(
  w: RadioLandingWindow,
  phraseLaps: number
): RadioLandingWindow {
  const keep = Math.max(1, Math.floor(phraseLaps))
  return [...w, 0].slice(-keep)
}

/** `n` rows landed in the lap playing. */
export function noteRadioLandings(w: RadioLandingWindow, n: number): RadioLandingWindow {
  if (!(n > 0)) return w
  const out = w.length === 0 ? [0] : [...w]
  out[out.length - 1] += n
  return out
}

export function radioLandingsInPhrase(w: RadioLandingWindow): number {
  return w.reduce((s, n) => s + n, 0)
}

// ---- the row's words (spec section 6) ----

/** Bars until an away hook's planned return: the first phrase start at which its bars reach its
 * target, from `pos` bars into the lap `lap`. Null for a hook that is in. */
export function radioHookBarsToReturn(
  h: Pick<RadioHook, 'state' | 'bars' | 'targetBars'>,
  o: { lap: number; phraseLaps: number; loopBars: number; pos: number }
): number | null {
  if (h.state === 'in' || !(o.loopBars > 0) || !(o.phraseLaps > 0)) return null
  let wraps = o.phraseLaps - (Math.floor(o.lap) % o.phraseLaps)
  while (h.bars + wraps * o.loopBars < h.targetBars - 1e-9) wraps += o.phraseLaps
  const pos = Math.min(o.loopBars, Math.max(0, o.pos))
  return (wraps - 1) * o.loopBars + (o.loopBars - pos)
}

/** Widest role text on a row, in characters (`hook · back in 64 bars`, phone width 320 px). */
export const RADIO_ROLE_WORDS_MAX = 22
export const RADIO_HOOK_WORD = 'hook'
export const RADIO_DIG_WORD = 'dig'
export const RADIO_HOOK_OUT_WORD = 'hook out'
export const RADIO_HOOK_BACK_WORD = 'hook back'
export const RADIO_HOOK_TOOLTIP = 'hook: it leaves and comes back'
export const RADIO_HOOK_RELEASE_TOOLTIP = 'release hook'
export const RADIO_DIG_TOOLTIP = 'dig: lean toward this'
export const RADIO_DIG_STOP_TOOLTIP = 'stop digging'
export const RADIO_HOOK_BRING_BACK_TOOLTIP = 'bring it back'

/** A row's role, in words: `hook`, `hook · out next`, `hook · back in 16 bars`, `hook · back next`,
 * `dig`, `hook · dig`. `narrow` (under 360 px) shortens to `back in 16`, `back next`, `out next`.
 * `· dig` is dropped where it would pass RADIO_ROLE_WORDS_MAX. Null: no role. */
export function radioRoleWords(o: {
  hook: {
    state: RadioHookState
    decided: 'exit' | 'return' | null
    barsToReturn: number | null
  } | null
  dig: boolean
  narrow?: boolean
}): string | null {
  const narrow = o.narrow === true
  let hook: string | null = null
  if (o.hook !== null) {
    const h = o.hook
    if (h.state === 'in') {
      hook = h.decided === 'exit' ? (narrow ? 'out next' : 'hook · out next') : RADIO_HOOK_WORD
    } else if (h.decided === 'return') {
      hook = narrow ? 'back next' : 'hook · back next'
    } else if (h.barsToReturn !== null && Number.isFinite(h.barsToReturn)) {
      const n = Math.max(1, Math.ceil(h.barsToReturn - 1e-6))
      hook = narrow ? `back in ${n}` : `hook · back in ${n} bar${n === 1 ? '' : 's'}`
    } else {
      hook = narrow ? 'away' : 'hook · away'
    }
  }
  if (!o.dig) return hook
  if (hook === null) return RADIO_DIG_WORD
  const both = `${hook} · ${RADIO_DIG_WORD}`
  return both.length <= RADIO_ROLE_WORDS_MAX ? both : hook
}
