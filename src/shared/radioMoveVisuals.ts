// src/shared/radioMoveVisuals.ts
//
// RADIO'S MOVES, SHOWN WHILE THEY SOUND -- docs/superpowers/specs/2026-10-05-radio-move-visuals-
// design.md. A drop, a filter sweep, a wash, a riser, a gap, a duck, a throw or a rest is drawn on
// the row it plays on, for as long as it plays, from the same curves the audio follows. Pure, and
// shared by both radios (ell.ing/radio's full mode and sssketch's radio view), so they show the
// same thing at the same moment.
//
// How a runtime uses it:
//   - when it SCHEDULES a move, it logs the move's visuals on its own clock (the web: AudioContext
//     seconds; sssketch: bars played since radio started, the readout's clock), keyed by what
//     armed it, as the gesture flashes are (radioReadout's RadioFlash). The adapters below turn
//     each kind of plan into visuals: radioTurnaroundVisuals, radioGestureVisuals,
//     radioThrowVisual, radioRestVisual;
//   - a take-back drops its key (dropRadioMoveVisuals); every tick prunes what is over
//     (pruneRadioMoveVisuals);
//   - every frame (the web) or position tick (sssketch), while anything sounds
//     (radioMoveVisualsSounding), it reads each row at the clock's now (radioRowVisualAt) and
//     writes the result as CSS custom properties (radioRowVisualVars).
//
// One visual is one curve of one parameter on one row (or on the mix: a turnaround's riser is its
// own voice, so it is drawn on the ruler, not a row):
//   volume    the row's gain, 0..1: a drop, a stop, a gap, a hole, a duck, a rest. At rest 1.
//   highpass  a lift's normalised cutoff, open at 0. At rest 0.
//   lowpass   a dip's or a filter in's normalised cutoff, open at 1. At rest 1.
//   wash      a wash's or a bloom's share of its peak, 0..1. At rest 0.
//   riser     a riser's progress, 0 where it starts .. 1 where it ends. At rest 0.
//   echo      a throw's echo, 0..1: full while what was sent repeats, then each repeat
//             `feedback` as loud. At rest 0.
// A row's look is all of them at once: the volumes MULTIPLY (as both engines multiply a
// turnaround's drop into a hole or a duck: combineRadioCurves, the web's separate gain nodes),
// everything else takes the strongest. So an intensity breakdown's rest, a hook's rest, the drop's
// gap and a duck compose without knowing about each other, and the one -- where every curve steps
// back to rest -- brings everything back at once.
//
// Quick fades (Elling, 2026-10-05: "maybe a quicker fade in and out"): a move's way IN is never
// shorter than `fade` (the runtime's RADIO_VISUAL_FADE_SEC on its clock), so a dim or a sweep's
// first step reads as a fade rather than a cut; its way OUT, on the one, stays a step, so the one
// is seen on the beat.

import { buildDropOutCurve } from './radioDropOut'
import {
  buildBloomCurve,
  buildDuckCurve,
  buildFilterInCurve,
  buildTransitionRiser,
  type RadioTransitionKind
} from './radioTransition'
import {
  TURNAROUND_DIP_FLOOR,
  TURNAROUND_LIFT_TOP,
  turnaroundDropCurve,
  type TurnaroundPlan,
  type TurnaroundPoint
} from './radioTurnaround'
import type { AutomationPoint } from './toolkit'

const BEATS_PER_BAR = 4

export type RadioVisualParam = 'volume' | 'highpass' | 'lowpass' | 'wash' | 'riser' | 'echo'

/** A point on the runtime's own clock. */
export interface RadioVisualPoint {
  at: number
  value: number
}

export interface RadioMoveVisual {
  /** What armed it (the flash's key): a take-back drops every visual it armed. */
  key: string
  /** The row it shows on; null for the mix as a whole (a turnaround's riser: the ruler). */
  rowId: string | null
  param: RadioVisualParam
  /** What it is, for the logs and the tests: drop, gap, lift, dip, wash, riser (a turnaround's),
   * a gesture's kind (hole, drop-out, filter in, bloom, duck, riser), throw, rest. */
  move: string
  /** Ascending on the runtime's clock; linear between, a stacked pair a step. Before the first
   * point and after the last, the param's rest value -- unless `holds`. */
  points: RadioVisualPoint[]
  /** An open rest: its last value holds after its last point, until it is closed
   * (closeRadioRestVisuals) or its key goes (pruneRadioMoveVisuals' `live`). */
  holds?: true
  /** An echo: how far its ghost trails the row, in bars (one repeat's delay). */
  shiftBars?: number
}

/** What a row looks like at a moment, every part 0..1 (spec: `{ level, lowCut, highCut, wash,
 * riser, ghost }`), plus how far the ghost trails. */
export interface RadioRowVisual {
  /** The volumes, multiplied: 1 heard, 0 silent. Drawn as brightness (radioVisualBrightness). */
  level: number
  /** A lift: how much of the low end the high-pass has taken (1 at the bold lift's top). */
  lowCut: number
  /** A dip or a filter in: how much of the top the low-pass has taken (1 at the bold dip's floor). */
  highCut: number
  wash: number
  riser: number
  ghost: number
  ghostShiftBars: number
}

export const RADIO_ROW_VISUAL_REST: Readonly<RadioRowVisual> = {
  level: 1,
  lowCut: 0,
  highCut: 0,
  wash: 0,
  riser: 0,
  ghost: 0,
  ghostShiftBars: 0
}

/** A silent row's brightness (spec: "dims to about 25% brightness while silent"). */
export const RADIO_VISUAL_DIM_FLOOR = 0.25
/** The shortest way into a move, in seconds (each runtime puts it on its clock). */
export const RADIO_VISUAL_FADE_SEC = 0.1
/** A sweep under prefers-reduced-motion: one steady thinning for the move's whole length. */
export const RADIO_VISUAL_STEADY_CUT = 0.6
/** An echo quieter than this is drawn as gone. */
export const RADIO_VISUAL_ECHO_FLOOR = 0.05

const REST: Readonly<Record<RadioVisualParam, number>> = {
  volume: 1,
  highpass: 0,
  lowpass: 1,
  wash: 0,
  riser: 0,
  echo: 0
}

const clamp01 = (x: number): number => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0)

/** The brightness a level is drawn at: the dim floor when silent, full when heard. */
export function radioVisualBrightness(level: number): number {
  return RADIO_VISUAL_DIM_FLOOR + (1 - RADIO_VISUAL_DIM_FLOOR) * clamp01(level)
}

// ---- evaluating ----

/** The points as drawn: stepping in from rest at the first point, the way in never shorter than
 * `fade`, and (unless it holds) stepping back to rest at the last. */
function drawnPoints(v: RadioMoveVisual, fade: number): RadioVisualPoint[] {
  const rest = REST[v.param]
  const src = v.points
  if (src.length === 0) return []
  const out: RadioVisualPoint[] = []
  if (src[0].value !== rest) out.push({ at: src[0].at, value: rest })
  for (const p of src) out.push({ at: p.at, value: p.value })
  if (v.holds !== true && out[out.length - 1].value !== rest) {
    out.push({ at: out[out.length - 1].at, value: rest })
  }
  if (fade > 0) {
    for (let i = 1; i < out.length; i++) {
      const a = out[i - 1]
      const b = out[i]
      // further from rest than the point before, too quickly: the way in, stretched to `fade`
      // (never past the next point, so the shape after it is untouched)
      if (Math.abs(b.value - rest) > Math.abs(a.value - rest) && b.at - a.at < fade) {
        const next = out[i + 1]
        b.at = Math.min(a.at + fade, next !== undefined ? next.at : Number.POSITIVE_INFINITY)
      }
    }
  }
  return out
}

/** One visual's value at `t`: linear between its points, a stacked pair a step to the later
 * value, the rest value outside them (the last value after them while it holds). */
export function radioMoveVisualValueAt(v: RadioMoveVisual, t: number, fade = 0): number {
  const rest = REST[v.param]
  const pts = drawnPoints(v, fade)
  if (pts.length === 0 || !Number.isFinite(t) || t < pts[0].at) return rest
  const last = pts[pts.length - 1]
  if (t >= last.at) return v.holds === true ? last.value : rest
  for (let i = 1; i < pts.length; i++) {
    const b = pts[i]
    if (t >= b.at) continue
    const a = pts[i - 1]
    const span = b.at - a.at
    return span <= 0 ? b.value : a.value + ((b.value - a.value) * (t - a.at)) / span
  }
  return rest
}

/** A row's look at `t` (rowId null: the mix's, for the ruler). `fade`: the shortest way into a
 * move on the visuals' clock (RADIO_VISUAL_FADE_SEC there; 0 under reduced motion). */
export function radioRowVisualAt(
  visuals: readonly RadioMoveVisual[],
  rowId: string | null,
  t: number,
  fade = 0
): RadioRowVisual {
  const out: RadioRowVisual = { ...RADIO_ROW_VISUAL_REST }
  for (const v of visuals) {
    if (v.rowId !== rowId) continue
    const x = radioMoveVisualValueAt(v, t, fade)
    switch (v.param) {
      case 'volume':
        out.level *= clamp01(x)
        break
      case 'highpass':
        out.lowCut = Math.max(out.lowCut, clamp01(x / TURNAROUND_LIFT_TOP))
        break
      case 'lowpass':
        out.highCut = Math.max(out.highCut, clamp01((1 - x) / (1 - TURNAROUND_DIP_FLOOR)))
        break
      case 'wash':
        out.wash = Math.max(out.wash, clamp01(x))
        break
      case 'riser':
        out.riser = Math.max(out.riser, clamp01(x))
        break
      case 'echo': {
        const g = clamp01(x)
        if (g > out.ghost) {
          out.ghost = g
          out.ghostShiftBars = v.shiftBars ?? 0
        }
        break
      }
    }
  }
  return out
}

/** Whether anything is sounding at `t` (a visual between its first and last points, or holding
 * after them). False: every row is at rest, and a runtime can skip its frame. */
export function radioMoveVisualsSounding(visuals: readonly RadioMoveVisual[], t: number): boolean {
  return visuals.some((v) => {
    if (v.points.length === 0) return false
    return t >= v.points[0].at && (v.holds === true || t < v.points[v.points.length - 1].at)
  })
}

/** Under prefers-reduced-motion: steady states, no sweeps or glows (spec "Rendering"). A row
 * silent for most of the moment is at the floor, else full; a filter move is one steady thinning
 * while it lasts; no wash, riser or ghost. Evaluate with `fade` 0 first. */
export function radioRowVisualSteady(v: RadioRowVisual): RadioRowVisual {
  return {
    level: v.level < 0.5 ? 0 : 1,
    lowCut: v.lowCut > 0 ? RADIO_VISUAL_STEADY_CUT : 0,
    highCut: v.highCut > 0 ? RADIO_VISUAL_STEADY_CUT : 0,
    wash: 0,
    riser: 0,
    ghost: 0,
    ghostShiftBars: 0
  }
}

/** The look as the CSS custom properties both radios style the row with (each its own rules):
 *   --mv-bright       the waveform's opacity (radioVisualBrightness)
 *   --mv-low          a lift's thinning of the waveform's lower half, 0..1
 *   --mv-high         a dip's thinning of its upper half, 0..1
 *   --mv-wash         the wash's soften, 0..1
 *   --mv-riser        a riser line's length, 0..1 of the row
 *   --mv-ghost        the echo's ghost's strength, 0..1
 *   --mv-ghost-shift  how far it trails, a percent of the row's window (`windowBars`; 0% without)
 * Under `reducedMotion`, the steady states (radioRowVisualSteady). */
export function radioRowVisualVars(
  v: RadioRowVisual,
  opts: { windowBars?: number; reducedMotion?: boolean } = {}
): Record<string, string> {
  const s = opts.reducedMotion === true ? radioRowVisualSteady(v) : v
  const w = opts.windowBars
  const shift = w !== undefined && w > 0 ? (s.ghostShiftBars / w) * 100 : 0
  return {
    '--mv-bright': radioVisualBrightness(s.level).toFixed(3),
    '--mv-low': s.lowCut.toFixed(3),
    '--mv-high': s.highCut.toFixed(3),
    '--mv-wash': s.wash.toFixed(3),
    '--mv-riser': s.riser.toFixed(3),
    '--mv-ghost': s.ghost.toFixed(3),
    '--mv-ghost-shift': `${shift.toFixed(2)}%`
  }
}

// ---- keeping the log ----

/** The log without the visuals `key` armed (a move taken back): its rows go back at once. */
export function dropRadioMoveVisuals(
  visuals: readonly RadioMoveVisual[],
  key: string
): RadioMoveVisual[] {
  return visuals.filter((v) => v.key !== key)
}

/** The log without what is over by `now`, and -- given `live`, the keys still armed (sssketch reads
 * them off what is armed every tick) -- without every move whose key is gone: taken back, its
 * curve has left the project, so its look goes too. Except an echo already ringing: it rings on
 * after its throw closes (and its key goes), as its audio does. */
export function pruneRadioMoveVisuals(
  visuals: readonly RadioMoveVisual[],
  now: number,
  live?: ReadonlySet<string>
): RadioMoveVisual[] {
  return visuals.filter((v) => {
    if (v.points.length === 0) return false
    const gone = live !== undefined && !live.has(v.key)
    if (gone && (v.param !== 'echo' || v.points[0].at > now)) return false
    if (v.holds === true) return true
    return v.points[v.points.length - 1].at >= now
  })
}

/** The row's open rests closed at `until` (its return is decided: it is heard again from there).
 * A rest that would close before it began is gone. */
export function closeRadioRestVisuals(
  visuals: readonly RadioMoveVisual[],
  rowId: string,
  until: number
): RadioMoveVisual[] {
  const out: RadioMoveVisual[] = []
  for (const v of visuals) {
    if (v.rowId !== rowId || v.move !== 'rest' || v.holds !== true) {
      out.push(v)
      continue
    }
    const from = v.points[0]?.at ?? until
    if (!(until > from)) continue
    out.push({
      key: v.key,
      rowId: v.rowId,
      param: v.param,
      move: v.move,
      points: [...v.points, { at: until, value: 0 }, { at: until, value: 1 }]
    })
  }
  return out
}

/** The row's rests closed at `until` open again (the return there was taken back). */
export function reopenRadioRestVisuals(
  visuals: readonly RadioMoveVisual[],
  rowId: string,
  until: number
): RadioMoveVisual[] {
  return visuals.map((v) => {
    const n = v.points.length
    if (
      v.rowId !== rowId ||
      v.move !== 'rest' ||
      v.holds === true ||
      n < 4 ||
      v.points[n - 1].at !== until
    ) {
      return v
    }
    return { ...v, points: v.points.slice(0, -2), holds: true }
  })
}

// ---- the adapters: each kind of plan as visuals ----

/** A curve in beats before a wrap, on the runtime's clock. */
function beforeWrap(
  points: readonly TurnaroundPoint[],
  wrapAt: number,
  unitsPerBeat: number
): RadioVisualPoint[] {
  return points.map((p) => ({ at: wrapAt - p.beats * unitsPerBeat, value: p.value }))
}

/** A curve in bars from a lap's start, on the runtime's clock. */
function fromLapStart(
  points: readonly AutomationPoint[],
  lapStartAt: number,
  unitsPerBar: number
): RadioVisualPoint[] {
  return points.map((p) => ({ at: lapStartAt + p.bar * unitsPerBar, value: p.value }))
}

/** A riser's line: from nothing where it starts to full where it ends, gone after. */
function riserPoints(start: number, end: number): RadioVisualPoint[] {
  return [
    { at: start, value: 0 },
    { at: end, value: 1 },
    { at: end, value: 0 }
  ]
}

export interface RadioTurnaroundVisualsAt {
  /** The wrap the turnaround ends on, on the runtime's clock. */
  wrapAt: number
  /** One beat on that clock, in the lap that ends on the wrap. */
  unitsPerBeat: number
  /** That lap's loop, in bars (the gap's drop and the riser are placed in it). */
  loopBars: number
  key: string
  /** Rows the plan never saw that the runtime silences through the gap
   * (turnaroundGapLateRowIds). */
  lateRowIds?: readonly string[]
}

/** A phrase turnaround (or a turn) as visuals: each row's volume (its drops, the stop and the gap,
 * merged by the planner), filter (a lift's high-pass or a dip's low-pass) and wash; each late row
 * silent through the gap; the riser, when there is one, on the mix -- from its start to where it
 * ends (the gap's start, or the one). */
export function radioTurnaroundVisuals(
  plan: TurnaroundPlan,
  at: RadioTurnaroundVisualsAt
): RadioMoveVisual[] {
  const { wrapAt, unitsPerBeat, key } = at
  const out: RadioMoveVisual[] = []
  for (const r of plan.rows) {
    if (r.volume !== undefined && r.volume.length > 0) {
      out.push({
        key,
        rowId: r.rowId,
        param: 'volume',
        move: 'drop',
        points: beforeWrap(r.volume, wrapAt, unitsPerBeat)
      })
    }
    if (r.filter !== undefined && r.filter.cutoff.length > 0) {
      const lift = r.filter.mode === 'highpass'
      out.push({
        key,
        rowId: r.rowId,
        param: lift ? 'highpass' : 'lowpass',
        move: lift ? 'lift' : 'dip',
        points: beforeWrap(r.filter.cutoff, wrapAt, unitsPerBeat)
      })
    }
    if (r.reverbSend !== undefined && r.reverbSend.points.length > 0) {
      out.push({
        key,
        rowId: r.rowId,
        param: 'wash',
        move: 'wash',
        points: beforeWrap(r.reverbSend.points, wrapAt, unitsPerBeat)
      })
    }
  }
  const gap = plan.gapBeats ?? 0
  if (gap > 0 && at.lateRowIds !== undefined && at.lateRowIds.length > 0) {
    const drop = turnaroundDropCurve(at.loopBars, gap)
    if (drop.length > 0) {
      for (const rowId of at.lateRowIds) {
        out.push({
          key,
          rowId,
          param: 'volume',
          move: 'gap',
          points: beforeWrap(drop, wrapAt, unitsPerBeat)
        })
      }
    }
  }
  if (plan.riserBars !== undefined && plan.riserBars > 0) {
    // buildTransitionRiser's placement, as both engines place it (planRiser on the web)
    const clip = buildTransitionRiser('visual', at.loopBars, plan.riserBars, {
      endBeforeBars: gap / BEATS_PER_BAR
    })
    if (clip !== null) {
      const unitsPerBar = unitsPerBeat * BEATS_PER_BAR
      const start = wrapAt - (at.loopBars - clip.startBar) * unitsPerBar
      out.push({
        key,
        rowId: null,
        param: 'riser',
        move: 'riser',
        points: riserPoints(start, start + clip.lengthBars * unitsPerBar)
      })
    }
  }
  return out
}

/** A lap on the runtime's clock: its loop in bars and one bar's length. */
export interface RadioVisualLap {
  loopBars: number
  unitsPerBar: number
}

export interface RadioGestureVisualInput {
  /** The gesture as it was scheduled (the engine's answer: a lead-in with no room is a cut). */
  kind: RadioTransitionKind | 'drop-out'
  rowId: string
  beats: number
  /** The wrap the change lands on (a drop-out: the wrap its row leaves on). */
  wrapAt: number
  /** The lap ending on the wrap: where a hole, a drop-out and a riser play. */
  before: RadioVisualLap
  /** The lap starting on it: where a filter in, a bloom and a duck play. */
  after: RadioVisualLap
  /** A duck's rows: every other heard row, none changing on the wrap. */
  duckRowIds?: readonly string[]
  key: string
}

/** A change's gesture as visuals, from radioTransition's own curve builders (the ones both engines
 * play): a hole or the arc's exit drop-out dims the row into the wrap, a riser draws its line on
 * the row it announces, a filter in thins the arriving row's top and opens, a bloom washes it and
 * clears, a duck dims every row in `duckRowIds`. A cut is nothing. */
export function radioGestureVisuals(g: RadioGestureVisualInput): RadioMoveVisual[] {
  const { kind, rowId, key, wrapAt, before, after } = g
  const lapStart = wrapAt - before.loopBars * before.unitsPerBar
  const bars = g.beats / BEATS_PER_BAR
  switch (kind) {
    case 'cut':
      return []
    case 'hole':
    case 'drop-out': {
      const curve = buildDropOutCurve(before.loopBars, g.beats)
      if (curve.length === 0) return []
      // the curve is silent into the wrap; the row is heard again on it (a new stem lands full,
      // or the row has left)
      const points = [
        ...fromLapStart(curve, lapStart, before.unitsPerBar),
        { at: wrapAt, value: 1 }
      ]
      return [{ key, rowId, param: 'volume', move: kind, points }]
    }
    case 'riser': {
      const clip = buildTransitionRiser(rowId, before.loopBars, bars)
      if (clip === null) return []
      const start = lapStart + clip.startBar * before.unitsPerBar
      return [
        {
          key,
          rowId,
          param: 'riser',
          move: 'riser',
          points: riserPoints(start, start + clip.lengthBars * before.unitsPerBar)
        }
      ]
    }
    case 'filter in': {
      const curve = buildFilterInCurve(after.loopBars, bars)
      if (curve.length === 0) return []
      return [
        {
          key,
          rowId,
          param: 'lowpass',
          move: kind,
          points: fromLapStart(curve, wrapAt, after.unitsPerBar)
        }
      ]
    }
    case 'bloom': {
      const curve = buildBloomCurve(after.loopBars, bars)
      const peak = Math.max(0, ...curve.map((p) => p.value))
      if (curve.length === 0 || !(peak > 0)) return []
      const points = fromLapStart(curve, wrapAt, after.unitsPerBar).map((p) => ({
        at: p.at,
        value: p.value / peak
      }))
      return [{ key, rowId, param: 'wash', move: kind, points }]
    }
    case 'duck': {
      const curve = buildDuckCurve(after.loopBars, bars)
      if (curve.length === 0) return []
      return (g.duckRowIds ?? []).map((id) => ({
        key,
        rowId: id,
        param: 'volume' as const,
        move: kind,
        points: fromLapStart(curve, wrapAt, after.unitsPerBar)
      }))
    }
  }
}

export interface RadioThrowVisualInput {
  rowId: string
  /** Where the send opens, on the runtime's clock. */
  at: number
  /** How long it stays open, on that clock. */
  open: number
  /** One repeat's delay, on that clock (throwDelaySec there). */
  delay: number
  feedback: number
  /** One repeat's delay in bars: how far the ghost trails. */
  shiftBars: number
  key: string
}

/** A dub throw's ghost: what the send caught repeats one delay later, at full while the send was
 * open, then each repeat `feedback` as loud, until it is under RADIO_VISUAL_ECHO_FLOOR. */
export function radioThrowVisual(t: RadioThrowVisualInput): RadioMoveVisual | null {
  if (!(t.open > 0) || !(t.delay > 0) || !(t.feedback > 0 && t.feedback < 1)) return null
  const first = t.at + t.delay
  const closed = first + t.open
  const points: RadioVisualPoint[] = [
    { at: first, value: 1 },
    { at: closed, value: 1 }
  ]
  let level = 1
  let k = 0
  while (level >= RADIO_VISUAL_ECHO_FLOOR && k < 64) {
    k += 1
    level *= t.feedback
    points.push({ at: closed + k * t.delay, value: level >= RADIO_VISUAL_ECHO_FLOOR ? level : 0 })
  }
  return {
    key: t.key,
    rowId: t.rowId,
    param: 'echo',
    move: 'throw',
    points,
    shiftBars: t.shiftBars
  }
}

/** A row resting (a hook's resting exit, the intensity arc's breakdown): silent from `from`, heard
 * again from `until` -- or, with `until` null, until it is closed (closeRadioRestVisuals). */
export function radioRestVisual(r: {
  rowId: string
  from: number
  until: number | null
  key: string
}): RadioMoveVisual {
  const points: RadioVisualPoint[] = [
    { at: r.from, value: 1 },
    { at: r.from, value: 0 }
  ]
  if (r.until === null)
    return { key: r.key, rowId: r.rowId, param: 'volume', move: 'rest', points, holds: true }
  return {
    key: r.key,
    rowId: r.rowId,
    param: 'volume',
    move: 'rest',
    points: [...points, { at: r.until, value: 0 }, { at: r.until, value: 1 }]
  }
}
