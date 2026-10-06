// src/shared/radioGuide.ts -- the radio's `?` guide: how radio works, for a casual listener, in ONE
// place. Both radios draw it from this data (sssketch's RadioGuide.tsx, ell.ing/radio's
// src/ui/guide.ts), so their guides cannot drift apart. Copy from the published "radio field guide"
// explainer (2026-10-06), checked against the code it describes; the numbers are read from the
// modules that own them, so a retuned constant retunes the guide.
//
// THE SHAPE. A guide is sections; a section is blocks: text, a key list (`keys`: a word and what it
// does), cards (the turnaround moves, each with a small diagram) and figures. Anything with `only`
// shows in that app alone. A key list with `controls` names real controls: each of its items says
// which control it names, in each app it shows in (`desktop`: a radioStripModel control id or a
// radio row part; `web`: the web radio's word for it). radioGuide.test.ts (here) and the web's
// guide.test.ts check every one, so a renamed control fails a test.
//
// THE DIAGRAMS are data too: bars in lanes (a lane is a row of a kind of sound, a cell one step of
// its waveform), plus lines, a riser ramp and words under them; and one scale (the pace slider).
// Each app draws them its own way: the desktop in the type colours (typeColorVar), the web in ink.
//
// Copy rules (tokens.css; the web's CLAUDE.md): lowercase, no emoji, no exclamation marks.
// Pure: no DOM, no randomness (the waveforms come from a fixed seed).
import type { SoundType } from './types'
import type { RadioRowPart } from './radioView'
import {
  RADIO_FOLD_PACE_FROM,
  RADIO_FOLD_PACE_JOINS,
  RADIO_PACE_ANCHORS,
  RADIO_PACE_BAR_BANDS,
  RADIO_PACE_LEVEL_MAX,
  RADIO_PACE_PHRASE_CAPS,
  RADIO_PACE_ROWS_FROM,
  RADIO_PACE_ROWS_MAX,
  radioPacePhraseBars,
  radioPaceProfile
} from './radioPace'
import { HOOK_AWAY, HOOK_LONG_REST, HOOK_RETURNS_BEFORE_REST, HOOK_STAY } from './radioHooks'
import {
  INTENSITY_DRAMA_FULL,
  INTENSITY_DRAMA_THIN,
  INTENSITY_ENERGY_HIGH,
  INTENSITY_ENERGY_LOW,
  INTENSITY_PHRASES,
  INTENSITY_UNTIL_BIG
} from './radioIntensityArc'
import {
  TURNAROUND_DEFAULT_PHRASE_BARS,
  TURNAROUND_GAP_WORD,
  TURNAROUND_MOVE_LABEL,
  type TurnaroundMove
} from './radioTurnaround'
import {
  FOLD_CYCLE_BEATS,
  FOLD_MAX_ROW_BARS,
  FOLD_MAX_ROWS,
  FOLD_PACE_BARS,
  FOLD_REALIGN_MAX_SEC,
  FOLD_REALIGN_MIN_SEC
} from './radioFold'
import { THROW_BEATS, THROW_EVERY_BARS } from './radioThrows'
import { DIG_NEAR_SHARE } from './radioDig'

// ---- the shape ----

export type RadioGuideApp = 'desktop' | 'web'

/** The kinds of sound a diagram's lanes are drawn as (the desktop's type colours). */
export type RadioGuideKind = Extract<SoundType, 'drums' | 'bass' | 'notes' | 'extInst' | 'fx'>

/** One step of a lane's waveform: `v` its height (0..1), `a` how strongly it sounds (0 silent,
 * 1 full); `half` keeps only the top (the low end filtered out) or the bottom (the top end out);
 * `blur` a reverb wash round it. */
export interface RadioGuideCell {
  v: number
  a: number
  half?: 'top' | 'bottom'
  blur?: boolean
}

export interface RadioGuideLane {
  kind: RadioGuideKind
  /** A small word over the lane (the fold lanes' lengths). */
  label?: string
  cells: readonly RadioGuideCell[]
}

/** Lanes of bars, all the same number of cells. Positions are fractions of the width, 0..1. */
export interface RadioGuideBars {
  type: 'bars'
  /** What the diagram shows, for a screen reader. */
  alt: string
  lanes: readonly RadioGuideLane[]
  /** Vertical lines (a loop's top, a bar line); `strong` the one that matters (a change, a drop). */
  lines?: readonly { at: number; strong?: boolean }[]
  /** A riser: a ramp under the lanes, climbing from `from` to `to`. */
  ramp?: { from: number; to: number }
  /** Words under the lanes, each starting at its position; `row` 1 a line lower (so neighbours
   * never run into each other on a phone). */
  labels?: readonly { at: number; text: string; row?: 1 }[]
}

/** The pace slider as a scale: `values` (0..1, evenly from 0 to 100) how often radio changes
 * something along it; `words` over it and `ticks` under it, at levels 0..100. */
export interface RadioGuideScale {
  type: 'scale'
  alt: string
  values: readonly number[]
  words: readonly { at: number; text: string }[]
  ticks: readonly number[]
}

export type RadioGuideFigure = RadioGuideBars | RadioGuideScale

/** A control a guide line names, in the desktop: a strip control (radioStripModel's ids, every
 * group) or a part of a radio row's button line (radioView's RadioRowPart). */
export type RadioGuideDesktopControl = { strip: string } | { row: RadioRowPart }

export interface RadioGuideItem {
  /** The word (or the number) on the left. */
  key: string
  text: string
  only?: RadioGuideApp
  /** In a `controls` list: the desktop controls this line names (every one, when it shows there). */
  desktop?: readonly RadioGuideDesktopControl[]
  /** In a `controls` list: the web radio's words for the controls this line names. */
  web?: readonly string[]
  /** A card's diagram. */
  figure?: RadioGuideBars
}

export type RadioGuideBlock =
  | { type: 'text'; text: string; only?: RadioGuideApp }
  | {
      type: 'keys'
      title?: string
      /** Its items name controls (checked by test). */
      controls?: boolean
      items: readonly RadioGuideItem[]
      only?: RadioGuideApp
    }
  | { type: 'cards'; items: readonly RadioGuideItem[]; only?: RadioGuideApp }
  | { type: 'figure'; figure: RadioGuideFigure; caption: string; only?: RadioGuideApp }

export interface RadioGuideSection {
  id: string
  /** A small word over the heading. */
  eyebrow: string
  heading: string
  blocks: readonly RadioGuideBlock[]
}

export interface RadioGuide {
  title: string
  lede: string
  sections: readonly RadioGuideSection[]
  foot: string
}

/** Where the web radio's pace slider starts for a visitor with nothing saved: ell.ing/radio's
 * DEFAULT_WEB_PACE_LEVEL (src/ui/pacePrefs.ts), which @shared cannot import; that repo's
 * guide.test.ts holds the two equal. */
export const RADIO_GUIDE_WEB_START_PACE = 60

/** The button that opens the guide, and its accessible name (both apps). */
export const RADIO_GUIDE_BUTTON = '?'
export const RADIO_GUIDE_LABEL = 'how radio works'

// ---- the waveforms (a fixed seed: the same picture every time) ----

function seeded(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 16807) % 2147483647
    return (s - 1) / 2147483646
  }
}

const round2 = (v: number): number => Math.round(v * 100) / 100
const clamp = (v: number): number => Math.min(1, Math.max(0.06, v))

/** `n` heights for a kind, from `seed`: drums hit on every fourth step, bass swells, notes ripple,
 * an instrument pulses, fx drift. */
export function radioGuideWave(kind: RadioGuideKind, n: number, seed = 7): number[] {
  const r = seeded(seed)
  const out: number[] = []
  for (let i = 0; i < n; i++) {
    const p = i / n
    let v: number
    if (kind === 'drums') v = i % 4 === 0 ? 0.95 : i % 2 === 0 ? 0.5 : 0.18 + 0.1 * r()
    else if (kind === 'bass') v = 0.45 + 0.35 * Math.abs(Math.sin(p * Math.PI * 4)) + 0.08 * r()
    else if (kind === 'notes')
      v = 0.3 + 0.4 * (0.5 + 0.5 * Math.sin(p * Math.PI * 6 + 1)) * (0.6 + 0.4 * r())
    else if (kind === 'extInst') v = (i % 4 < 2 ? 0.7 : 0.18) * (0.6 + 0.4 * r())
    else v = 0.3 + 0.2 * Math.sin(p * Math.PI * 2) + 0.15 * r()
    out.push(round2(clamp(v)))
  }
  return out
}

const full = (vs: readonly number[]): RadioGuideCell[] => vs.map((v) => ({ v, a: 1 }))

/** A lane of `kind`: `n` cells of its waveform, then `shape` applied to each cell by index. */
function lane(
  kind: RadioGuideKind,
  n: number,
  seed: number,
  shape?: (cell: RadioGuideCell, i: number) => RadioGuideCell
): RadioGuideLane {
  const cells = full(radioGuideWave(kind, n, seed))
  return { kind, cells: shape ? cells.map(shape) : cells }
}

// ---- the figures ----

/** Four 4-bar loops (8 cells each) make a 16-bar phrase: the notes row changes on loop 2's one,
 * and the phrase ends with a turnaround (the drums out, a riser, a gap before the one). */
function phraseFigure(): RadioGuideBars {
  const N = 32
  const loop = 8
  const repeat = (kind: RadioGuideKind, seed: number): number[] => {
    const one = radioGuideWave(kind, loop, seed)
    return Array.from({ length: N }, (_, i) => one[i % loop])
  }
  const old = radioGuideWave('notes', loop, 3)
  const fresh = radioGuideWave('extInst', loop, 11)
  const notes = Array.from({ length: N }, (_, i) => (i < loop ? old[i % loop] : fresh[i % loop]))
  const gap = (c: RadioGuideCell, i: number): RadioGuideCell => (i >= N - 1 ? { ...c, a: 0 } : c)
  return {
    type: 'bars',
    alt: 'four loops make a phrase: one row changes at the start of the second loop, and the phrase ends with the drums out, a riser and a short gap',
    lanes: [
      {
        kind: 'drums',
        cells: full(repeat('drums', 5)).map((c, i) => gap(i >= N - 4 ? { ...c, a: 0.15 } : c, i))
      },
      { kind: 'bass', cells: full(repeat('bass', 9)).map(gap) },
      { kind: 'notes', cells: full(notes).map(gap) }
    ],
    lines: [{ at: 0.25, strong: true }, { at: 0.5 }, { at: 0.75 }],
    ramp: { from: (N - 4) / N, to: (N - 1) / N },
    labels: [
      { at: 0, text: 'loop 1' },
      { at: 0.25, text: 'loop 2' },
      { at: 0.5, text: 'loop 3' },
      { at: 0.75, text: 'loop 4' }
    ]
  }
}

/** How often radio changes something at a pace level, as a rate: rows per change over the
 * middle of the drawn window. */
function paceRate(level: number): number {
  const p = radioPaceProfile(level)
  return p.rows / ((p.window.min + p.window.max) / 2)
}

/** The pace slider, its rate read from radioPaceProfile on a log scale (0 at slow, 1 at 100). */
function paceFigure(): RadioGuideScale {
  const lo = Math.log(paceRate(0))
  const hi = Math.log(paceRate(RADIO_PACE_LEVEL_MAX))
  const values: number[] = []
  for (let l = 0; l <= RADIO_PACE_LEVEL_MAX; l += 2) {
    values.push(round2(0.08 + (0.92 * (Math.log(paceRate(l)) - lo)) / (hi - lo)))
  }
  return {
    type: 'scale',
    alt: 'the pace slider from 0 to 100: changes come more and more often from slow to ludicrous',
    values,
    words: (['slow', 'mid', 'fast', 'ludicrous'] as const).map((w) => ({
      at: RADIO_PACE_ANCHORS[w],
      text: w
    })),
    ticks: [
      RADIO_PACE_ANCHORS.slow,
      RADIO_PACE_ANCHORS.mid,
      RADIO_PACE_ANCHORS.fast,
      RADIO_PACE_ROWS_FROM,
      RADIO_PACE_BAR_BANDS[0][0],
      RADIO_PACE_ANCHORS.ludicrous,
      RADIO_PACE_LEVEL_MAX
    ]
  }
}

/** A move's card picture: four lanes over 24 steps, the move on the last 8 (the phrase's end). */
function moveFigure(move: TurnaroundMove | 'gap'): RadioGuideBars {
  const N = 24
  const from = 16
  const late = (i: number): boolean => i >= from
  const out = (c: RadioGuideCell, i: number): RadioGuideCell => (late(i) ? { ...c, a: 0.15 } : c)
  const top = (c: RadioGuideCell, i: number): RadioGuideCell =>
    late(i) ? { ...c, half: 'top' } : c
  const bottom = (c: RadioGuideCell, i: number): RadioGuideCell =>
    late(i) ? { ...c, half: 'bottom' } : c
  const wash = (c: RadioGuideCell, i: number): RadioGuideCell =>
    late(i) ? { ...c, blur: true } : c
  const gap = (c: RadioGuideCell, i: number): RadioGuideCell => (i >= N - 2 ? { ...c, a: 0 } : c)
  const lanes = (shapes: Partial<Record<RadioGuideKind, typeof out>>): RadioGuideLane[] =>
    (['drums', 'bass', 'notes', 'fx'] as const).map((k, j) => lane(k, N, 5 + j * 4, shapes[k]))
  const alt = (what: string): string => `the end of a phrase: ${what}`
  const line = [{ at: from / N }]
  switch (move) {
    case 'drum drop':
      return {
        type: 'bars',
        alt: alt('the drums drop out'),
        lanes: lanes({ drums: out }),
        lines: line
      }
    case 'low drop':
      return {
        type: 'bars',
        alt: alt('the drums and the bass drop out'),
        lanes: lanes({ drums: out, bass: out }),
        lines: line
      }
    case 'stop':
      return {
        type: 'bars',
        alt: alt('everything stops but one melodic row'),
        lanes: lanes({ drums: out, bass: out, fx: out }),
        lines: line
      }
    case 'wash':
      return {
        type: 'bars',
        alt: alt('a reverb wash blurs the rows'),
        lanes: lanes({ notes: wash, fx: wash }),
        lines: line
      }
    case 'lift':
      return {
        type: 'bars',
        alt: alt('a filter takes the low end out'),
        lanes: lanes({ bass: top, notes: top, fx: top }),
        lines: line
      }
    case 'dip':
      return {
        type: 'bars',
        alt: alt('a filter takes the top end out'),
        lanes: lanes({ bass: bottom, notes: bottom, fx: bottom }),
        lines: line
      }
    case 'riser':
      return {
        type: 'bars',
        alt: alt('a riser climbs toward the one'),
        lanes: lanes({}),
        lines: line,
        ramp: { from: from / N, to: 1 }
      }
    case 'gap':
      return {
        type: 'bars',
        alt: alt('a riser stops short, and a beat of silence comes before the one'),
        lanes: lanes({ drums: gap, bass: gap, notes: gap, fx: gap }),
        lines: line,
        ramp: { from: from / N, to: (N - 2) / N }
      }
  }
}

/** One wave of intensity: a build that starts low and climbs, the breakdown, the drop, a ride at
 * the top, and the next build starting low again. Heights are how intense the mix is. */
function intensityFigure(): RadioGuideBars {
  const N = 48
  const level = (i: number): number => {
    if (i < 14) return 0.3 + (0.45 * i) / 13 // build
    if (i < 24) return 0.14 // breakdown
    if (i < 35) return 0.95 - (0.08 * (i - 24)) / 10 // drop, then the ride
    return 0.4 + (0.4 * (i - 35)) / 12 // the next build, low again
  }
  const jitter = seeded(13)
  const cells: RadioGuideCell[] = Array.from({ length: N }, (_, i) => ({
    v: round2(clamp(level(i) * (0.88 + 0.12 * jitter()))),
    a: 1
  }))
  return {
    type: 'bars',
    alt: 'intensity over a few minutes: a build climbs, the breakdown dips, the drop comes back at the top, a ride, then the next build starts low',
    lanes: [{ kind: 'drums', cells }],
    lines: [{ at: 24 / N, strong: true }],
    labels: [
      { at: 0, text: 'build' },
      { at: 14 / N, text: 'breakdown', row: 1 },
      { at: 24 / N, text: 'drop, ride' },
      { at: 35 / N, text: 'build', row: 1 }
    ]
  }
}

/** A hook: it plays, leaves on an echo, stays away, and comes back on a phrase start. */
function hookFigure(): RadioGuideBars {
  const N = 40
  const echo = [0.6, 0.42, 0.28, 0.18]
  return {
    type: 'bars',
    alt: 'a hook plays, leaves on an echo, stays away, then comes back on a phrase start',
    lanes: [
      lane('bass', N, 9, (c, i) =>
        i < 14 ? c : i < 18 ? { ...c, a: echo[i - 14] } : i < 30 ? { ...c, a: 0.1 } : c
      )
    ],
    lines: [{ at: 30 / N, strong: true }],
    labels: [
      { at: 0, text: 'plays' },
      { at: 14 / N, text: 'echo' },
      { at: 20 / N, text: 'away' },
      { at: 30 / N, text: 'back' }
    ]
  }
}

/** Fold: lanes of 4, 3 and 5 beats against the bar; a strong step where each lane restarts. */
function foldFigure(): RadioGuideBars {
  const beats = 30
  const fold = (kind: RadioGuideKind, len: number): RadioGuideLane => ({
    kind,
    label: `${len} beats`,
    cells: Array.from({ length: beats }, (_, b) =>
      b % len === 0 ? { v: 0.9, a: 1 } : { v: 0.45, a: 0.35 }
    )
  })
  const lines: { at: number }[] = []
  for (let b = 4; b < beats; b += 4) lines.push({ at: b / beats })
  return {
    type: 'bars',
    alt: 'three rows loop at 4, 3 and 5 beats: their restarts drift apart and line up again only now and then',
    lanes: [fold('drums', 4), fold('extInst', 3), fold('fx', 5)],
    lines
  }
}

// ---- the copy ----

const everyBars = (level: number): string => {
  const w = radioPaceProfile(level).window
  if (w.min === w.max) return w.min === 1 ? 'bar' : `${w.min} bars`
  return `${w.min} to ${w.max} bars`
}
const barsRange = (menu: readonly { bars: number }[]): string =>
  `${Math.min(...menu.map((m) => m.bars))} to ${Math.max(...menu.map((m) => m.bars))} bars`
const phrasesRange = (menus: Record<string, readonly number[]>): string => {
  const all = Object.values(menus).flat()
  const lo = Math.min(...all)
  const hi = Math.max(...all)
  return lo === hi ? `${lo}` : `${lo} to ${hi}`
}
const words = [
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten'
] as const
const word = (n: number): string => words[n - 1] ?? String(n)
const or = (ns: readonly number[]): string =>
  ns.length === 1 ? String(ns[0]) : `${ns.slice(0, -1).join(', ')} or ${ns[ns.length - 1]}`

const PHRASE = TURNAROUND_DEFAULT_PHRASE_BARS
const { slow, mid, fast, ludicrous } = RADIO_PACE_ANCHORS
const [[capAt1, cap1], [capAt2, cap2]] = RADIO_PACE_PHRASE_CAPS
const [[band4At], [band2At], [band1At]] = RADIO_PACE_BAR_BANDS
const pct = (x: number): number => Math.round(x * 100)
const foldBeats = FOLD_CYCLE_BEATS.filter((b) => Number.isInteger(b))

/** The move cards, in the planner's order, then the gap. */
const MOVE_TEXT: Readonly<Record<TurnaroundMove, string>> = {
  'drum drop': 'a drums row drops out for the end of the phrase',
  'low drop': 'the drums and the bass drop out together',
  stop: 'everything stops but one melodic row',
  wash: 'a swell of reverb blurs all but the drums, dry again on the one',
  lift: 'a filter sweeps the low end out',
  dip: 'a filter sweeps the top end out',
  riser: 'a noise sweep climbs toward the one'
}

export const RADIO_GUIDE: RadioGuide = {
  title: 'how radio works',
  lede: 'radio is a mix that keeps rewriting itself. a handful of loops play together, and every so often one of them changes. sit back and listen, or reach in and steer it.',
  sections: [
    {
      id: 'loops',
      eyebrow: 'the basics',
      heading: 'it plays in loops',
      blocks: [
        {
          type: 'text',
          text: 'every sound is a short loop recorded in an endlesss jam. radio stretches them all to one tempo and plays them together as rows: drums, bass, chords, melodies, textures.'
        },
        {
          type: 'text',
          text: `changes wait for the top of a loop, its first beat, so the music never stumbles. a phrase is ${PHRASE} bars, a few loops back to back, and the end of a phrase is where the bigger moves happen.`
        },
        {
          type: 'figure',
          figure: phraseFigure(),
          caption: `four 4-bar loops make a ${PHRASE}-bar phrase. one row changes on the first beat of loop 2; the phrase ends with a turnaround: the drums out, a riser, a gap.`
        }
      ]
    },
    {
      id: 'pace',
      eyebrow: 'how fast',
      heading: 'pace: slow to ludicrous',
      blocks: [
        {
          type: 'text',
          text: 'one slider sets how often radio changes something. its readout says slow, mid, fast or ludicrous at those points, and a number of bars in between.'
        },
        {
          type: 'figure',
          figure: paceFigure(),
          caption: 'further right, changes come more often.'
        },
        {
          type: 'keys',
          items: [
            { key: `${slow} slow`, text: `a change every ${everyBars(slow)}. the mix settles in` },
            { key: `${mid} mid`, text: `a change every ${everyBars(mid)}` },
            { key: `${fast} fast`, text: `a change every ${everyBars(fast)}` },
            {
              key: `${fast + 1} to ${capAt2}`,
              text: `quicker still: every ${everyBars(capAt1)} at ${capAt1}, every ${everyBars(capAt2)} at ${capAt2}`
            },
            {
              key: `${RADIO_PACE_ROWS_FROM + 1}`,
              text: `a change may change more than one row at once, up to ${word(RADIO_PACE_ROWS_MAX)} at ${RADIO_PACE_LEVEL_MAX}`
            },
            {
              key: `${band4At}`,
              text: `changes may land mid-loop, on a bar line: every 4 bars, every 2 from ${band2At}, every bar from ${band1At}`
            },
            {
              key: `${ludicrous} ludicrous`,
              text: `something changes every ${everyBars(ludicrous)}`
            }
          ]
        },
        {
          type: 'text',
          only: 'web',
          text: `this radio starts at ${RADIO_GUIDE_WEB_START_PACE}: a change every ${everyBars(RADIO_GUIDE_WEB_START_PACE)}, and it waits for the next ${radioPacePhraseBars(radioPaceProfile(RADIO_GUIDE_WEB_START_PACE), PHRASE)}-bar phrase. up to fast, a change waits for the next ${PHRASE}-bar phrase; above fast the phrase shortens to ${cap1} bars, then ${cap2}, and from ${RADIO_PACE_ROWS_FROM + 1} a change may land at any loop top.`
        },
        {
          type: 'text',
          only: 'desktop',
          text: `sssketch starts at mid. with phrase set to 16 or 32 bars (advanced), a change also waits for the start of a phrase; above fast that phrase shortens to ${cap1} bars, then ${cap2}, and from ${RADIO_PACE_ROWS_FROM + 1} it is gone.`
        },
        {
          type: 'text',
          text: `with fold on, pace up to ${RADIO_FOLD_PACE_FROM} keeps fold's own ${FOLD_PACE_BARS.min} to ${FOLD_PACE_BARS.max} bars; above that fold speeds up, and from ${RADIO_FOLD_PACE_JOINS} it follows the slider.`
        }
      ]
    },
    {
      id: 'turnarounds',
      eyebrow: 'the end of a phrase',
      heading: 'turnarounds',
      blocks: [
        {
          type: 'text',
          text: 'at the end of a phrase, radio can make a move into the next one, the way a dj or a band would. moves often stack: a riser over a filter lift with the drums out, then a beat of silence before everything comes back on the one.'
        },
        {
          type: 'text',
          text: 'a build-up always pays off: something real changes when the next phrase lands, so it never builds up to nothing, and a small change gets a small move or none.'
        },
        {
          type: 'cards',
          items: [
            ...(Object.keys(MOVE_TEXT) as TurnaroundMove[]).map((m) => ({
              key: TURNAROUND_MOVE_LABEL[m],
              text: MOVE_TEXT[m],
              figure: moveFigure(m)
            })),
            {
              key: TURNAROUND_GAP_WORD,
              text: 'a riser stops short, and the mix drops out for a beat or two before the one',
              figure: moveFigure('gap')
            }
          ]
        },
        {
          type: 'text',
          text: 'when the mix is about to grow, radio leans on drops, lifts and risers; when it thins, on washes and dips. turn plays a turnaround at the next loop top, radio choosing the move.'
        },
        {
          type: 'text',
          only: 'desktop',
          text: 'in advanced: turnarounds (off, rare: one phrase end in three, often: two in three), families (which moves), depth (subtle or bold), builds (sized: every build-up pays off, or off), and a chip for each move beside turn.'
        },
        {
          type: 'text',
          only: 'web',
          text: 'in full: the families (drops, wash, filters, riser; none on means no turnarounds), depth (subtle or bold), and a chip for each move beside turn.'
        }
      ]
    },
    {
      id: 'intensity',
      eyebrow: 'the shape over minutes',
      heading: 'intensity: build, breakdown, drop',
      blocks: [
        {
          type: 'text',
          text: 'with density set to intensity, radio plays in waves.'
        },
        {
          type: 'text',
          only: 'desktop',
          text: 'density is in advanced. sssketch starts on arc; build, drop, energy and drama show in simple once density is intensity.'
        },
        {
          type: 'text',
          text: `a build lasts ${phrasesRange(INTENSITY_PHRASES.build)} phrases and starts lighter: at its top the busiest row can leave and heavy drums or bass make way for lighter ones. then, phrase by phrase, rows join and the picks lean busier and heavier.`
        },
        {
          type: 'text',
          text: `a breakdown pulls the drums and bass out for ${phrasesRange(INTENSITY_PHRASES.breakdown)} phrases while pads and leads carry on, often with an echo on the drums as they leave.`
        },
        {
          type: 'text',
          text: `then the drop: the drums and bass come back on the one after a riser and a gap, sometimes on fresh, heavier sounds. a ride holds the top for ${phrasesRange(INTENSITY_PHRASES.drop)} phrases, then the next build. every ${or(INTENSITY_UNTIL_BIG)} waves comes a bigger peak: higher, longer, a deeper breakdown.`
        },
        {
          type: 'figure',
          figure: intensityFigure(),
          caption: 'one wave, roughly. higher means busier drums, heavier bass and more rows.'
        },
        {
          type: 'keys',
          controls: true,
          items: [
            {
              key: 'energy',
              text: `where the time goes. under ${pct(INTENSITY_ENERGY_LOW)}: long builds and breakdowns, short rides. over ${pct(INTENSITY_ENERGY_HIGH)}: short breakdowns, long rides. higher also lifts the whole wave`,
              desktop: [{ strip: 'energy' }],
              web: ['energy']
            },
            {
              key: 'drama',
              text: `how far it swings. under ${INTENSITY_DRAMA_THIN}: a gentle swell, nothing drops out. under ${INTENSITY_DRAMA_FULL}: the bass leaves and one drums row stays. from ${INTENSITY_DRAMA_FULL}: the drums and bass all go`,
              desktop: [{ strip: 'drama' }],
              web: ['drama']
            },
            {
              key: 'build',
              text: 'in a ride: the next build at the next loop top. in a build: a row joins at the top and the build hurries. in a breakdown: the drop comes sooner',
              desktop: [{ strip: 'build' }],
              web: ['build']
            },
            {
              key: 'drop',
              text: 'in a breakdown: the drop at the next loop top. in a build or a ride: a quick drop, the drums and bass out for a moment, back on the one',
              desktop: [{ strip: 'drop' }],
              web: ['drop']
            },
            {
              key: 'density',
              text: 'off keeps a steady number of rows. arc grows them to four or five and thins them to two or three, without the big drops. intensity plays the waves',
              desktop: [{ strip: 'density' }],
              web: ['density', 'off', 'arc', 'intensity']
            }
          ]
        }
      ]
    },
    {
      id: 'hooks',
      eyebrow: 'favourites that come back',
      heading: 'hooks and dig',
      blocks: [
        {
          type: 'text',
          text: `hook a row (hook, or like) and radio treats its sound as a favourite. it plays for ${barsRange(HOOK_STAY)}, leaves on an echo (a bassline leaves dry), stays away ${barsRange(HOOK_AWAY)}, then comes back on a phrase start, where it can on one where something else changes too, so its return is the drop.`
        },
        {
          type: 'figure',
          figure: hookFigure(),
          caption: `those lengths are at fast pace: longer when slower, as little as half at the quickest.`
        },
        {
          type: 'text',
          text: `while it is away, its row plays something else, or now and then rests in silence. after ${word(HOOK_RETURNS_BEFORE_REST)} returns it takes a longer break, ${barsRange(HOOK_LONG_REST)}. up to half the rows can be hooks, one away at a time.`
        },
        {
          type: 'text',
          text: 'while a hook is away, its name shows dimmed on the row. tap it to bring the hook back at the next phrase start.'
        },
        {
          type: 'text',
          text: `dig is for when you love where a sound came from. while it is on, ${DIG_NEAR_SHARE === 1 / 3 ? 'a third' : `${pct(DIG_NEAR_SHARE)} percent`} of radio's picks come from near that sound (the same jam, close in time), and the rest lean toward it. one row is dug at a time; dig again to stop.`
        }
      ]
    },
    {
      id: 'fold',
      eyebrow: 'for rhythm nerds',
      heading: 'fold',
      blocks: [
        {
          type: 'text',
          text: `turn on fold and ${word(FOLD_MAX_ROWS - 1)} or ${word(FOLD_MAX_ROWS)} short rhythmic rows loop at odd lengths, like ${or(foldBeats.slice(0, 3))} beats, against the bar. they drift out of line and back in, so the groove keeps shifting even when nothing new arrives. one row keeps its full length and holds the one; a row longer than ${FOLD_MAX_ROW_BARS} bars never folds. inspired by how autechre bends rhythm.`
        },
        {
          type: 'figure',
          figure: foldFigure(),
          caption: `lanes of 4, 3 and 5 beats. the strong steps are where each restarts; they meet again only now and then. a fold lines up with the loop again every ${FOLD_REALIGN_MIN_SEC} seconds to ${FOLD_REALIGN_MAX_SEC / 60} minutes.`
        },
        {
          type: 'keys',
          controls: true,
          items: [
            {
              key: 'bend',
              text: 'how far the rows bend off the beat',
              desktop: [{ strip: 'bend' }],
              web: ['bend']
            },
            {
              key: 'mismatch',
              text: 'how unlike the rest new layers are',
              desktop: [{ strip: 'mismatch' }],
              web: ['mismatch']
            },
            {
              key: 'seed',
              text: 'any text. the same seed folds the same way',
              desktop: [{ strip: 'seed' }],
              web: ['fold seed']
            }
          ]
        }
      ]
    },
    {
      id: 'throws',
      eyebrow: 'dub echoes',
      heading: 'throws',
      blocks: [
        {
          type: 'text',
          text: `now and then, every ${THROW_EVERY_BARS[0]} to ${THROW_EVERY_BARS[1]} bars, radio opens one row's echo for ${word(THROW_BEATS[0])} or ${word(THROW_BEATS[1])} beats, and the repeats ring on after it closes.`
        },
        {
          type: 'text',
          text: 'when a change is near, the throw is timed to end right on it, so the echoes spill over the new sound, or into the silence just before a drop.'
        },
        {
          type: 'text',
          text: 'throws stay off the drums and bass, except when a hook leaves or the drums leave for a breakdown. the echo dial sets how loud they are; at zero there are none.'
        }
      ]
    },
    {
      id: 'steer',
      eyebrow: 'your hands',
      heading: 'what you can steer',
      blocks: [
        {
          type: 'text',
          text: 'radio decides when and what to change. you can nudge any of it.'
        },
        {
          type: 'keys',
          title: 'on each row',
          controls: true,
          only: 'desktop',
          items: [
            {
              key: 'mute · solo',
              text: 'silence the row, or hear only it',
              desktop: [{ row: 'mute-solo' }]
            },
            {
              key: 'skip',
              text: 'a new sound on this row at the next loop top. cmd-click: now',
              desktop: [{ row: 'skip' }]
            },
            {
              key: 'like',
              text: 'the thumbs up: star the sound as a favourite and hook it',
              desktop: [{ row: 'like' }]
            },
            {
              key: 'change soon',
              text: 'the thumbs down: radio changes this row sooner',
              desktop: [{ row: 'change-soon' }]
            },
            {
              key: 'hook',
              text: 'it leaves and comes back as a drop',
              desktop: [{ row: 'hook-dig' }]
            },
            { key: 'dig', text: 'more from around this sound', desktop: [{ row: 'hook-dig' }] }
          ]
        },
        {
          type: 'keys',
          title: 'on each row',
          controls: true,
          only: 'web',
          items: [
            { key: 'm · s', text: 'mute the row, or solo it', web: ['mute', 'solo'] },
            { key: 'skip', text: 'a new sound on this row at the next bar', web: ['skip'] },
            {
              key: 'like',
              text: 'the thumbs up: hook the sound and like it; your likes count on the faves dial',
              web: ['like']
            },
            {
              key: 'less of',
              text: 'the thumbs down: radio changes this row sooner',
              web: ['less of']
            },
            { key: 'hook', text: 'it leaves and comes back as a drop', web: ['hook'] },
            { key: 'dig', text: 'more from around this sound', web: ['dig'] }
          ]
        },
        {
          type: 'keys',
          title: 'for the whole mix',
          controls: true,
          only: 'desktop',
          items: [
            { key: 'tempo', text: 'the speed everything plays at', desktop: [{ strip: 'tempo' }] },
            { key: 'pace', text: 'how often things change', desktop: [{ strip: 'pace' }] },
            {
              key: 'skip',
              text: 'radio changes a row of its choosing, at the next loop top',
              desktop: [{ strip: 'skip' }]
            },
            {
              key: 'new bed',
              text: 'every unlocked row changes at once, at the next loop top',
              desktop: [{ strip: 'new-bed' }]
            },
            {
              key: 'turn',
              text: 'a turnaround at the next loop top',
              desktop: [{ strip: 'turn' }]
            },
            {
              key: 'build · drop',
              text: 'push the intensity wave along',
              desktop: [{ strip: 'build' }, { strip: 'drop' }]
            },
            {
              key: 'level',
              text: 'the whole mix, louder or quieter',
              desktop: [{ strip: 'level' }]
            },
            {
              key: 'keep',
              text: 'save the rows playing now to your library',
              desktop: [{ strip: 'keep' }]
            }
          ]
        },
        {
          type: 'keys',
          title: 'in advanced',
          controls: true,
          only: 'desktop',
          items: [
            {
              key: 'faves',
              text: 'how much to stick to the sounds you liked',
              desktop: [{ strip: 'faves' }]
            },
            {
              key: 'source',
              text: 'endlesss sounds to the left, other sounds to the right',
              desktop: [{ strip: 'source' }]
            },
            {
              key: 'matching',
              text: 'how closely new sounds match the rest',
              desktop: [{ strip: 'matching' }]
            },
            { key: 'artist', text: 'whose sounds radio plays', desktop: [{ strip: 'artist' }] },
            {
              key: 'phrase',
              text: 'loop, 16 or 32 bars: where changes may land',
              desktop: [{ strip: 'phrase' }]
            },
            {
              key: 'transitions',
              text: 'how a new layer arrives',
              desktop: [{ strip: 'transitions' }]
            },
            {
              key: 'fold',
              text: 'rows at odd lengths against the beat',
              desktop: [{ strip: 'fold' }]
            },
            {
              key: 'reverb · filter',
              text: 'the whole mix, washed or filtered',
              desktop: [{ strip: 'reverb' }, { strip: 'filter' }]
            },
            {
              key: 'saturation · pump · echo',
              text: "radio's own sound: warmth, pumping, the throws' echo",
              desktop: [{ strip: 'saturation' }, { strip: 'pump' }, { strip: 'echo' }]
            }
          ]
        },
        {
          type: 'keys',
          title: 'for the whole mix',
          controls: true,
          only: 'web',
          items: [
            { key: '- +', text: 'slower or faster', web: ['slower', 'faster'] },
            { key: 'pace', text: 'how often things change', web: ['pace'] },
            {
              key: 'skip',
              text: 'radio changes a row of its choosing, at the next bar',
              web: ['skip']
            },
            {
              key: 'hold',
              text: 'hold this mix: nothing changes until you press it again',
              web: ['hold']
            },
            {
              key: 'heart',
              text: 'love the mix playing now. hearts are shared, and lean the faves dial',
              web: ['love this mix']
            },
            {
              key: 'faves',
              text: 'how much to stick to loved sounds: your likes and the hearts',
              web: ['faves']
            },
            {
              key: 'source',
              text: 'endlesss sounds to the left, other sounds to the right',
              web: ['source']
            },
            { key: 'turn', text: 'a turnaround at the next loop top', web: ['turn'] },
            { key: 'build · drop', text: 'push the intensity wave along', web: ['build', 'drop'] },
            {
              key: 'level · reverb',
              text: 'the whole mix, louder or washed',
              web: ['level', 'reverb']
            },
            {
              key: 'saturation · pump · echo',
              text: "radio's own sound: warmth, pumping, the throws' echo",
              web: ['saturation', 'pump', 'echo']
            },
            { key: 'visuals', text: 'the moving picture behind, on or off', web: ['visuals'] }
          ]
        },
        {
          type: 'keys',
          title: 'keys',
          only: 'web',
          items: [
            { key: 'space', text: 'play or stop' },
            { key: 'n', text: 'skip' },
            { key: 'h', text: 'hold' },
            { key: 'l', text: 'love this mix' },
            { key: '- =', text: 'slower, faster' }
          ]
        }
      ]
    },
    {
      id: 'views',
      eyebrow: 'two views',
      heading: 'simple and advanced',
      blocks: [
        {
          type: 'text',
          only: 'desktop',
          text: 'simple shows the rows and the controls you touch while listening. advanced adds every setting, the move chips and the row extras: lock, nearby, duplicate, remove. a setting hidden in simple keeps working.'
        },
        {
          type: 'text',
          only: 'desktop',
          text: 'radio here can play your own library or other artists, and a phone on the same wifi works as a remote.'
        },
        {
          type: 'text',
          only: 'web',
          text: 'simple just plays, with a moving picture to watch: play, tempo, skip and the heart. full shows the rows and every control.'
        },
        {
          type: 'text',
          text: 'radio runs in sssketch, the desktop app, and on the web at ell.ing/radio. both make their choices with the same shared code, so what you learn on one carries over to the other.'
        }
      ]
    }
  ],
  foot: 'radio as of october 2026. some details, like exact timings, change as it gets tuned.'
}

const shows = (only: RadioGuideApp | undefined, app: RadioGuideApp): boolean =>
  only === undefined || only === app

/** The guide as `app` shows it: the blocks and items for the other app left out, and the views
 * section's heading in that app's words (the web's views are simple and full). */
export function radioGuideFor(app: RadioGuideApp): RadioGuide {
  return {
    ...RADIO_GUIDE,
    sections: RADIO_GUIDE.sections.map((s) => ({
      ...s,
      heading: s.id === 'views' && app === 'web' ? 'simple and full' : s.heading,
      blocks: s.blocks
        .filter((b) => shows(b.only, app))
        .map((b) =>
          b.type === 'keys' || b.type === 'cards'
            ? { ...b, items: b.items.filter((i) => shows(i.only, app)) }
            : b
        )
    }))
  }
}
