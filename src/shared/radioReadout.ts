// src/shared/radioReadout.ts
//
// What radio is about to do, and why, said plainly (spec 2026-10-03-radio-readout-design.md): the
// status line (where the density arc is heading, which row changes next, how, and when), the
// phrase ruler (bars into the phrase, and the turnaround armed for its end), and each row's
// readout (what it was picked as, its author, how long it has played, `next`, and a brief word
// when a gesture hits it). Pure, and shared, so sssketch's Discover and the web radio say the
// same; each runtime fills the input from its own state. radioFoldStatus.ts is its sibling.

import {
  isMaskSlotKind,
  isTraitSlotKind,
  normalizeSlotKinds,
  DISCOVER_TRAIT_SLOT_KINDS,
  type DiscoverSlotKind,
  type DiscoverTraitKind
} from './discoverSlotKind'
import { radioGestureLeadsChange, type RadioTransitionKind } from './radioTransition'
import {
  TURNAROUND_LABEL_MAX,
  turnaroundArc,
  turnaroundLabel,
  turnaroundPhraseLaps,
  type TurnaroundMove
} from './radioTurnaround'
import type { SoundType } from './types'

/** A word on a row when a gesture hits it, from when it SOUNDS. `at` is on the runtime's own
 * clock (the web: AudioContext seconds; sssketch: bars played since radio started) and the
 * window it shows for is one bar on that clock. `key` names what armed it, so a gesture taken
 * back before it sounds takes its word back too (dropRadioFlashes, pruneRadioFlashes). */
export interface RadioFlash {
  rowId: string
  word: string
  at: number
  key: string
  /** Where the move it names ends, on the same clock (spec 2026-10-05-radio-move-visuals-design:
   * "the move's word stays on for the move's duration"). Absent: a moment's word (hook out, dig,
   * no fave fits), shown for one window. */
  until?: number
}

/** A flash showing now: its word, and how far through its window it is (0..1). `opacity` only
 * when it was asked for with a fade (radioFlashShown's `fade`): drawn at that, not
 * radioFlashOpacity(t). */
export interface RadioFlashShown {
  word: string
  t: number
  opacity?: number
}

/** The flash's quick fades, in seconds (each runtime puts them on its clock): in, and out once
 * its move has ended (Elling, 2026-10-05: "maybe a quicker fade in and out"). */
export const RADIO_FLASH_FADE_IN_SEC = 0.1
export const RADIO_FLASH_FADE_OUT_SEC = 0.15

/** Fades on a runtime's clock. */
export interface RadioFlashFade {
  in: number
  out: number
}

/** `breakdown` and `drop`: the intensity arc's (radioReadoutIntensityArc). */
export type RadioReadoutArcState = 'growing' | 'thinning' | 'steady' | 'off' | 'breakdown' | 'drop'

export interface RadioReadoutRowInput {
  rowId: string
  /** The slot's kinds: what the row was picked as. */
  kinds: readonly DiscoverSlotKind[]
  /** The stem's trait percentiles (0..1, direction-adjusted), when known. */
  traits?: Partial<Record<DiscoverTraitKind, number | null>> | null
  /** The stem's own sound type, when known: the label of last resort. */
  stemType?: SoundType | null
  /** Who made the stem, when known. */
  author?: string | null
  /** Laps it has played, the one playing included (1 on its first). */
  laps: number
  flash?: RadioFlashShown | null
}

export interface RadioReadoutInput {
  bars: { intoPhrase: number; phraseBars: number; loopBars: number }
  /** Whatever lands next -- radio's own change, or the density arc adding a row (a row not on the
   * bed, or `adding`: `a new row`) or taking one out (`leaving`: `row 2 leaves`), or a course
   * change turning the rows in `course` over at once -- with how it arrives (null while only
   * armed, and for a leaving row), and bars until it lands (null when its bar is not known yet). */
  nextChange: {
    rowId: string
    kind: RadioTransitionKind | null
    barsAway: number | null
    leaving?: boolean
    /** The arc's new row, already drawn as a row (sssketch: silent until it joins). */
    adding?: boolean
    /** A course change: every row it turns over (`rowId` among them). */
    course?: readonly string[]
    /** The pace slider's extra rows riding radio's change (its companions), cuts landing with
     * it: `next: row 2 +2 → bloom`, and each of them reads `next · cut`. */
    with?: readonly string[]
    /** A hook leaving (`out`) or coming back (`back`) on that row (radioHooks.ts):
     * `next: row 2 → hook back · 4 bars`. */
    hook?: 'out' | 'back'
    /** The intensity arc's drop is decided for that top: `next: drop · 4 bars` (`rowId` one of
     * the rows coming back). */
    drop?: boolean
    /** The breakdown rests that row there: `next: row 2 rests · 4 bars`. */
    rests?: boolean
    /* Which rows ride (held, locked or muted ones excluded) is the caller's call at decision
     * time; the readout only shows the ones that are rows and not the led row, once each. */
  } | null
  /** The turnaround armed for the phrase's end, or a turn waiting; `move` null while a turn
   * waits for its roll. A combined one also gives `parts` (its moves, the lead first:
   * turnaroundPlanMoves) and `gap` (it leaves a gap before the one). */
  armedTurnaround: {
    move: TurnaroundMove | null
    isTurn: boolean
    parts?: readonly TurnaroundMove[]
    gap?: boolean
  } | null
  arc: {
    state: RadioReadoutArcState
    count: number
    target: number
    /** A breakdown: bars to the drop's planned top (null: not known). */
    dropInBars?: number | null
    /** A bigger peak's build: `building ↑↑`. */
    big?: boolean
  }
  /** Under 360 px: the short forms (`breakdown · 12`). */
  narrow?: boolean
  /** Radio is held: the arc part reads `held` (it goes nowhere while held). The runtime passes as
   * `nextChange` only what still lands while held (an arc step already on the timeline), or null. */
  held?: boolean
  rows: readonly RadioReadoutRowInput[]
}

export interface RadioReadoutRow {
  rowId: string
  /** `drums · bright — elling`; '' when nothing is known. */
  label: string
  /** `12 laps`, `1 lap`. */
  age: string
  isNext: boolean
  nextKind: RadioTransitionKind | null
  /** `next · filter in`, `next · leaves` for a row the arc takes out, or `next` while the arrival
   * is not drawn yet; null on other rows. */
  nextLabel: string | null
  flash: RadioFlashShown | null
}

export interface RadioReadout {
  /** `building ↑ 3 → 5 · next: row 2 → filter in · 6 bars`; '' when there is nothing to say. */
  statusLine: string
  /** One tick per bar of the phrase; `filled` whole bars played in it; `end` the turnaround
   * armed for its end (`wash`, or `turn: wash` for a turn), null for none. */
  ruler: { ticks: number; filled: number; end: string | null }
  rows: RadioReadoutRow[]
}

export type RadioRulerCell = 'played' | 'now' | 'ahead' | 'ahead-bar'

/** One cell per tick of the phrase ruler: the bars played, the bar in progress, and the bars
 * ahead (every fourth, counting from the phrase's start, marked as a bar line). */
export function radioRulerCells(ruler: RadioReadout['ruler']): RadioRulerCell[] {
  return Array.from({ length: Math.max(0, ruler.ticks) }, (_, i) =>
    i < ruler.filled ? 'played' : i === ruler.filled ? 'now' : i % 4 === 0 ? 'ahead-bar' : 'ahead'
  )
}

/** A trait percentile at or above this is the stem's dominant trait, for a row picked by mask
 * alone (a stem barely bright is not called bright). */
export const RADIO_TRAIT_DOMINANT = 0.6

/** The word each kind reads as in the readout: terse, the kind itself (Discover's playful names,
 * DISCOVER_SLOT_KIND_LABEL, stay on the kind picker). */
export const RADIO_KIND_WORD: Readonly<Record<DiscoverSlotKind, string>> = {
  drums: 'drums',
  bass: 'bass',
  lead: 'lead',
  bassHeavy: 'heavy',
  rhythmic: 'rhythmic',
  bright: 'bright',
  warm: 'warm'
}

const SOUND_TYPE_WORD: Readonly<Record<SoundType, string>> = {
  drums: 'drums',
  notes: 'notes',
  bass: 'bass',
  extInst: 'ext inst',
  sampler: 'sampler',
  fx: 'fx',
  extFx: 'ext fx',
  audioIn: 'audio in'
}

/** A dub throw's word. */
export const RADIO_THROW_WORD = 'throw'

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

/** Where the playhead is in the turnaround's phrase (turnaroundPhraseLaps: 16 bars when
 * `phraseBars` is 0), from the radio clock's turnaroundLap and the bars into the lap playing. */
export function radioReadoutBars(
  turnaroundLap: number | undefined,
  pos: number,
  loopBars: number,
  phraseBars: number
): RadioReadoutInput['bars'] {
  const laps = turnaroundPhraseLaps(phraseBars, loopBars)
  if (laps === 0) return { intoPhrase: 0, phraseBars: 0, loopBars: 0 }
  const lap = Math.max(0, Math.floor(turnaroundLap ?? 0)) % laps
  const inLap = Number.isFinite(pos) ? Math.min(loopBars, Math.max(0, pos)) : 0
  return { intoPhrase: lap * loopBars + inLap, phraseBars: laps * loopBars, loopBars }
}

/** The arc as the readout reads it: off, or its direction (turnaroundArc) from the leg and the
 * row count the arc itself counts, heading for the leg's target. */
export function radioReadoutArc(
  leg: { phase: 'growing' | 'thinning'; target: number } | null,
  count: number,
  on: boolean
): RadioReadoutInput['arc'] {
  if (!on) return { state: 'off', count, target: count }
  return { state: turnaroundArc(leg, count), count, target: leg?.target ?? count }
}

function strongestTrait(traits: RadioReadoutRowInput['traits']): DiscoverTraitKind | null {
  let best: DiscoverTraitKind | null = null
  let top = RADIO_TRAIT_DOMINANT
  for (const k of DISCOVER_TRAIT_SLOT_KINDS as DiscoverTraitKind[]) {
    const v = traits?.[k]
    if (typeof v === 'number' && Number.isFinite(v) && v >= top) {
      if (best === null || v > top) {
        best = k
        top = v
      }
    }
  }
  return best
}

/** What a row was picked as: its first mask kind and a trait word (the one it was picked for,
 * else the stem's dominant one), or with no mask kind the trait alone, or the stem's type; then
 * ` — author` when known. */
export function radioRowLabel(row: RadioReadoutRowInput): string {
  const kinds = normalizeSlotKinds(row.kinds)
  const mask = kinds.find(isMaskSlotKind) ?? null
  const trait = kinds.find(isTraitSlotKind) ?? strongestTrait(row.traits)
  const words: string[] = []
  if (mask !== null) words.push(RADIO_KIND_WORD[mask])
  if (trait !== null) words.push(RADIO_KIND_WORD[trait])
  let label = words.join(' · ')
  if (label === '' && row.stemType) label = SOUND_TYPE_WORD[row.stemType]
  const author = row.author?.trim()
  if (author) label = label === '' ? author : `${label} — ${author}`
  return label
}

/** `12 laps`, `1 lap`. */
export function radioAgeLabel(laps: number): string {
  return plural(Number.isFinite(laps) ? Math.max(0, Math.floor(laps)) : 0, 'lap')
}

/** The intensity arc as the readout reads it (spec 2026-10-05-radio-intensity-arc-design 9): the
 * build as `growing` toward its peak (`big` on a bigger peak), the breakdown with the bars to its
 * drop, the ride as `drop`. Before the machine has begun: steady. */
export function radioReadoutIntensityArc(
  arc: {
    begun: boolean
    phase: 'build' | 'breakdown' | 'drop'
    peakRows: number
    big: boolean
  },
  count: number,
  dropInBars: number | null
): RadioReadoutInput['arc'] {
  if (!arc.begun) return { state: 'steady', count, target: count }
  switch (arc.phase) {
    case 'build':
      return count < arc.peakRows
        ? { state: 'growing', count, target: arc.peakRows, ...(arc.big && { big: true }) }
        : { state: 'steady', count, target: count }
    case 'breakdown':
      return { state: 'breakdown', count, target: count, dropInBars }
    case 'drop':
      return { state: 'drop', count, target: count }
  }
}

function arcPart(arc: RadioReadoutInput['arc'], held: boolean, narrow: boolean): string | null {
  if (held) return arc.state === 'off' ? 'held' : `held · ${plural(arc.count, 'row')}`
  switch (arc.state) {
    case 'growing':
      return `building ${arc.big === true ? '↑↑' : '↑'} ${arc.count} → ${arc.target}`
    case 'breakdown': {
      const bars = arc.dropInBars
      if (bars === null || bars === undefined || !Number.isFinite(bars)) return 'breakdown'
      const n = Math.max(1, Math.ceil(bars - 1e-6))
      return narrow ? `breakdown · ${n}` : `breakdown · drop in ${plural(n, 'bar')}`
    }
    case 'drop':
      return `drop · ${plural(arc.count, 'row')}`
    case 'thinning':
      return `thinning ↓ ${arc.count} → ${arc.target}`
    case 'steady':
      return `steady · ${plural(arc.count, 'row')}`
    case 'off':
      return null
  }
}

function nextPart(input: RadioReadoutInput): string | null {
  const n = input.nextChange
  if (n === null) return null
  if (n.barsAway === null || !Number.isFinite(n.barsAway)) return 'next: soon'
  const i = input.rows.findIndex((r) => r.rowId === n.rowId)
  const present = new Set(input.rows.map((r) => r.rowId))
  const companions = n.course
    ? []
    : [...new Set(n.with ?? [])].filter((id) => id !== n.rowId && present.has(id))
  const extra = companions.length > 0 ? ` +${companions.length}` : ''
  const bars = Math.max(1, Math.ceil(n.barsAway - 1e-6))
  if (n.drop === true) {
    // a breakdown counting down to it says the drop already
    const counting =
      input.held !== true &&
      input.arc.state === 'breakdown' &&
      typeof input.arc.dropInBars === 'number' &&
      Number.isFinite(input.arc.dropInBars)
    return counting ? null : `next: drop · ${plural(bars, 'bar')}`
  }
  const who =
    (n.course ? 'course change' : i >= 0 && !n.adding ? `row ${i + 1}` : 'a new row') + extra
  const how = n.course
    ? ''
    : n.rests === true
      ? ' rests'
      : n.hook !== undefined
        ? ` → hook ${n.hook}`
        : n.leaving
          ? ' leaves'
          : n.kind !== null
            ? ` → ${n.kind}`
            : ''
  return `next: ${who}${how} · ${plural(bars, 'bar')}`
}

/** What a turn's ruler label starts with. */
const TURN_PREFIX = 'turn: '

function rulerEnd(t: RadioReadoutInput['armedTurnaround']): string | null {
  if (t === null) return null
  if (t.move === null) return t.isTurn ? 'turn' : null
  const moves = t.parts !== undefined && t.parts.length > 0 ? t.parts : [t.move]
  const gap = t.gap === true
  if (!t.isTurn) return turnaroundLabel(moves, gap)
  return TURN_PREFIX + turnaroundLabel(moves, gap, TURNAROUND_LABEL_MAX - TURN_PREFIX.length)
}

export function radioReadout(input: RadioReadoutInput): RadioReadout {
  const statusLine = [arcPart(input.arc, !!input.held, input.narrow === true), nextPart(input)]
    .filter((p): p is string => p !== null)
    .join(' · ')
  const ticks = Math.max(0, Math.round(input.bars.phraseBars))
  const filled = Math.min(ticks, Math.max(0, Math.floor(input.bars.intoPhrase + 1e-9)))
  const next = input.nextChange
  return {
    statusLine,
    ruler: { ticks, filled, end: rulerEnd(input.armedTurnaround) },
    rows: input.rows.map((r) => {
      const companion =
        next !== null &&
        !next.course &&
        next.rowId !== r.rowId &&
        (next.with?.includes(r.rowId) ?? false)
      const isNext =
        next !== null &&
        (next.rowId === r.rowId || (next.course?.includes(r.rowId) ?? false) || companion)
      const leaving = isNext && !companion && !!next.leaving
      // every row the breakdown rests reads it, its companions too (no cut there)
      const rests = isNext && next.rests === true
      const nextKind = rests ? null : companion ? 'cut' : isNext && !leaving ? next.kind : null
      return {
        rowId: r.rowId,
        label: radioRowLabel(r),
        age: radioAgeLabel(r.laps),
        isNext,
        nextKind,
        nextLabel: !isNext
          ? null
          : rests
            ? 'next · rests'
            : !companion && next.hook !== undefined
              ? `next · hook ${next.hook}`
              : leaving
                ? 'next · leaves'
                : nextKind !== null
                  ? `next · ${nextKind}`
                  : 'next',
        flash: r.flash ?? null
      }
    })
  }
}

// ---- the gesture flash ----

/** The word a transition gesture flashes: its kind; none for a cut or the arc's exit. */
export function radioGestureFlashWord(kind: RadioTransitionKind | 'drop-out'): string | null {
  return kind === 'cut' || kind === 'drop-out' ? null : kind
}

/** A gesture's word placed again on the lap as it is now (sssketch's tick, every tick for each
 * armed gesture, as its visuals: radioMoveVisuals' placeRadioGestureVisuals; the clock is bars): a
 * lead-in's (a hole, a riser) over its beats before the wrap ending the lap, on until that wrap; an
 * arrival's (a filter in, a bloom, a duck) from the lap's top, on until its curve ends (half the
 * loop at most). A cut and the arc's exit say nothing. Only `key`'s words change. */
export function placeRadioGestureFlash(
  log: readonly RadioFlash[],
  g: {
    kind: RadioTransitionKind | 'drop-out'
    rowId: string
    beats: number
    lapStart: number
    loopBars: number
    key: string
  }
): RadioFlash[] {
  const rest = dropRadioFlashes(log, g.key)
  const word = radioGestureFlashWord(g.kind)
  if (word === null || g.kind === 'drop-out') return rest
  // Capped at half the loop both ways, as the curves cap a lead-in and an arrival.
  const bars = Math.min(g.beats / 4, g.loopBars / 2)
  const leads = radioGestureLeadsChange(g.kind)
  return [
    ...rest,
    {
      rowId: g.rowId,
      word,
      at: g.lapStart + (leads ? g.loopBars - bars : 0),
      key: g.key,
      until: g.lapStart + (leads ? g.loopBars : bars)
    }
  ]
}

/** Where a flash's word stops showing at full: its move's end, or one window after it starts. */
function flashEnd(f: RadioFlash, window: number): number {
  return f.until !== undefined && f.until > f.at ? f.until : f.at + window
}

/** The row's flash at `now`: the latest word whose start lies within the last `window` (one
 * bar on the log's clock), or null. A word not sounding yet does not show.
 *
 * With `fade` (the quick fades, RADIO_FLASH_FADE_IN_SEC / _OUT_SEC on the log's clock): a word
 * shows from its start until its move ends (`until`; else one window), at full after a fade in,
 * then fades out over `fade.out`; the latest start still wins. Its `opacity` says how visible it
 * is, and `t` is how far through that whole showing it is. Without, exactly as before. */
export function radioFlashShown(
  log: readonly RadioFlash[],
  rowId: string,
  now: number,
  window: number,
  fade?: RadioFlashFade
): RadioFlashShown | null {
  if (!(window > 0) || !Number.isFinite(now)) return null
  if (fade === undefined) {
    let best: RadioFlash | null = null
    for (const f of log) {
      if (f.rowId !== rowId || f.at > now + 1e-9 || now - f.at >= window) continue
      if (best === null || f.at > best.at) best = f
    }
    return best === null
      ? null
      : { word: best.word, t: Math.min(1, Math.max(0, (now - best.at) / window)) }
  }
  const out = Math.max(0, fade.out)
  let best: RadioFlash | null = null
  for (const f of log) {
    if (f.rowId !== rowId || f.at > now + 1e-9 || now >= flashEnd(f, window) + out) continue
    if (best === null || f.at > best.at) best = f
  }
  if (best === null) return null
  const end = flashEnd(best, window)
  const fadeIn = fade.in > 0 ? Math.min(1, (now - best.at) / fade.in) : 1
  const fadeOut = now < end ? 1 : out > 0 ? Math.max(0, 1 - (now - end) / out) : 0
  return {
    word: best.word,
    t: Math.min(1, Math.max(0, (now - best.at) / (end + out - best.at))),
    opacity: Math.min(1, Math.max(0, Math.min(fadeIn, fadeOut)))
  }
}

/** The log without words whose window has passed, and -- given `live`, the keys still armed --
 * without words not sounding yet whose gesture has been taken back. `fadeOut` (the quick fade's,
 * on the log's clock): a word is kept until its move's end (`until`, else its window) and its
 * fade out are over. Absent, and with no `until`, exactly as before. */
export function pruneRadioFlashes(
  log: readonly RadioFlash[],
  now: number,
  window: number,
  live?: ReadonlySet<string>,
  fadeOut = 0
): RadioFlash[] {
  const out = Math.max(0, fadeOut)
  return log.filter((f) =>
    f.at > now
      ? live === undefined || live.has(f.key)
      : f.until === undefined && out === 0
        ? // today's expression, as radioFlashShown's without the fades: `f.at + window` can
          // round the other way at the boundary
          now - f.at < window
        : now < flashEnd(f, window) + out
  )
}

/** The log without the words `key` armed (a gesture taken back). */
export function dropRadioFlashes(log: readonly RadioFlash[], key: string): RadioFlash[] {
  return log.filter((f) => f.key !== key)
}

/** How visible a flash is, 0..1: in and out again over its window. */
export function radioFlashOpacity(t: number): number {
  return Number.isFinite(t) ? Math.sin(Math.PI * Math.min(1, Math.max(0, t))) : 0
}
