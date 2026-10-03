# Radio Readout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Both radios (sssketch's Discover radio and the web radio's full mode at ell.ing/radio) say what is coming and why: a status line (where the density arc is heading, which row changes next, how, and in how many bars), a phrase ruler (bars into the phrase, and the turnaround armed for its end), and on each row its label, its age, `next`, and a brief word when a gesture hits it.

**Architecture:** One pure module, `src/shared/radioReadout.ts` in sssketch, turns a small input (filled by each runtime from its own state) into the status line, the ruler and the row readouts, and holds the gesture flash log's rules (a word per row, from when it sounds, for one bar). The web radio fills it in `describe()` (step.ts), with a flash log the controller records where it applies gestures to the engine; `fullModel`/`full.ts` draw it. sssketch fills it on its radio clock tick from its refs, with a flash log read off the gestures armed into the preview project, and draws it in the radio bar and over each row's waveform.

**Tech Stack:** TypeScript, vitest, React (sssketch renderer), plain DOM + CSS (web radio), the `@shared` alias (the web radio imports sssketch's `src/shared` from the working tree).

**Spec:** `docs/superpowers/specs/2026-10-03-radio-readout-design.md`

---

## Before you start

- Two repos: `/Users/nickel/Claudecode/sssketch` (sssketch, its `CLAUDE.md` applies) and `/Users/nickel/Claudecode/ell.ing/radio` (the web radio, its own `CLAUDE.md` applies). The web radio's `@shared/*` is sssketch's `src/shared/*` **as it is on disk** (`vite.config.ts`, `tsconfig.json` paths), so Task 1 must be in place before Tasks 2-5.
- Work on each repo's current branch (`master` in sssketch; whatever ell.ing/radio has checked out). Commit only the files each task names. Do not push, deploy or upload anything.
- Every commit message ends with exactly these two lines (use a heredoc so they stay verbatim):

```
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01KK8TyKjVKvWU8ZjQCk3ozz
```

- No native engine change: nothing under `native-engine/` is touched, so no engine rebuild is needed.
- No agent can see or hear either radio, or hold a phone. Do not claim any UI was "tested"; Task 8 ends with Elling's walkthrough.
- Edits are given as find/replace pairs: each "find" text occurs exactly once in the file named (checked against the code as of sssketch `8d5efc4` and ell.ing/radio `fdcb0d4`). Apply them in order.

## File map

**sssketch**
- Create `src/shared/radioReadout.ts`: the readout (status line, ruler, row label/age/next), the arc and phrase helpers each runtime uses to fill it, and the gesture flash log's rules (`radioFlashShown`, `pruneRadioFlashes`, `dropRadioFlashes`, `radioGestureFlashWord`, `radioFlashOpacity`).
- Create `src/shared/radioReadout.test.ts`: its tests.
- Modify `src/renderer/src/components/DiscoverPanel.tsx`: the readout's clock (laps and bars played), each row's landing lap, the flash log (`radioFlashTick`), the readout state written on the clock tick (`radioReadoutFrom`), the radio bar's status line and ruler (Task 6), and each row's overlay (Task 7).

**ell.ing/radio**
- Modify `src/radio/step.ts`: `RadioRow.laps` (age), `RadioView.readout`, `describe(s, flashes)`.
- Modify `src/radio/step.test.ts`: the readout in `RadioView`.
- Modify `src/radio/controller.ts`: the flash log, recorded where gestures are applied (a change's lead-in or arrival, an added row's arrival, a turnaround's per-row move, a throw), taken back on cancel, pruned each tick; `view()` passes it on; `flashLog()`.
- Modify `src/radio/controller.test.ts`: the flash log.
- Modify `src/ui/fullModel.ts` / `src/ui/fullModel.test.ts`: `status`, each row's `readout`, `fullKey`, `flashes()`.
- Modify `src/ui/full.ts`, `src/ui/full.css`, `src/main.ts`: drawing it (status block between the top corners, its own line on a phone; fold status moved into it; row label, next and flash).

---

## Task 1: shared `radioReadout.ts` (sssketch)

**Files:**
- Create: `/Users/nickel/Claudecode/sssketch/src/shared/radioReadout.ts`
- Test: `/Users/nickel/Claudecode/sssketch/src/shared/radioReadout.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/shared/radioReadout.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  dropRadioFlashes,
  pruneRadioFlashes,
  radioAgeLabel,
  radioFlashOpacity,
  radioFlashShown,
  radioGestureFlashWord,
  radioReadout,
  radioReadoutArc,
  radioReadoutBars,
  radioRowLabel,
  type RadioFlash,
  type RadioReadoutInput,
  type RadioReadoutRowInput
} from './radioReadout'

const row = (rowId: string, over: Partial<RadioReadoutRowInput> = {}): RadioReadoutRowInput => ({
  rowId,
  kinds: ['drums'],
  laps: 1,
  ...over
})

const input = (over: Partial<RadioReadoutInput> = {}): RadioReadoutInput => ({
  bars: { intoPhrase: 5.5, phraseBars: 16, loopBars: 4 },
  nextChange: null,
  armedTurnaround: null,
  arc: { state: 'off', count: 3, target: 3 },
  rows: [row('a'), row('b', { kinds: ['bass'] }), row('c', { kinds: ['lead'] })],
  ...over
})

describe('radioReadout: the status line', () => {
  it('says where the arc is heading, for each state', () => {
    expect(radioReadout(input({ arc: { state: 'growing', count: 3, target: 5 } })).statusLine).toBe(
      'building ↑ 3 → 5'
    )
    expect(
      radioReadout(input({ arc: { state: 'thinning', count: 5, target: 3 } })).statusLine
    ).toBe('thinning ↓ 5 → 3')
    expect(radioReadout(input({ arc: { state: 'steady', count: 4, target: 4 } })).statusLine).toBe(
      'steady · 4 rows'
    )
    expect(radioReadout(input({ arc: { state: 'steady', count: 1, target: 1 } })).statusLine).toBe(
      'steady · 1 row'
    )
    expect(radioReadout(input()).statusLine).toBe('')
  })

  it('adds the next change: its row number, how it arrives, and whole bars away', () => {
    const r = radioReadout(
      input({
        arc: { state: 'growing', count: 3, target: 5 },
        nextChange: { rowId: 'b', kind: 'filter in', barsAway: 5.2 }
      })
    )
    expect(r.statusLine).toBe('building ↑ 3 → 5 · next: row 2 → filter in · 6 bars')
  })

  it('leaves the arrival out while it is only armed, and says 1 bar in the singular', () => {
    const r = radioReadout(input({ nextChange: { rowId: 'c', kind: null, barsAway: 0.4 } }))
    expect(r.statusLine).toBe('next: row 3 · 1 bar')
  })

  it('says next: soon when the bar is not known yet', () => {
    const r = radioReadout(
      input({
        arc: { state: 'steady', count: 3, target: 3 },
        nextChange: { rowId: 'a', kind: 'cut', barsAway: null }
      })
    )
    expect(r.statusLine).toBe('steady · 3 rows · next: soon')
  })

  it('names a row not on the bed yet as a new row', () => {
    const r = radioReadout(input({ nextChange: { rowId: 'z', kind: 'bloom', barsAway: 4 } }))
    expect(r.statusLine).toBe('next: a new row → bloom · 4 bars')
  })
})

describe('radioReadout: the phrase ruler', () => {
  it('one tick per bar, the whole bars played filled, no end label with nothing armed', () => {
    expect(radioReadout(input()).ruler).toEqual({ ticks: 16, filled: 5, end: null })
  })

  it("a phrase end's turnaround is its move's label; a turn is turn: <move>", () => {
    expect(
      radioReadout(input({ armedTurnaround: { move: 'drum drop', isTurn: false } })).ruler.end
    ).toBe('drop')
    expect(radioReadout(input({ armedTurnaround: { move: 'wash', isTurn: true } })).ruler.end).toBe(
      'turn: wash'
    )
    expect(radioReadout(input({ armedTurnaround: { move: null, isTurn: true } })).ruler.end).toBe(
      'turn'
    )
  })

  it('never fills past its ticks', () => {
    const r = radioReadout(input({ bars: { intoPhrase: 99, phraseBars: 16, loopBars: 4 } }))
    expect(r.ruler.filled).toBe(16)
  })
})

describe('radioReadoutBars', () => {
  it('counts the turnaround phrase (16 bars with no phrase grid) from the clock', () => {
    expect(radioReadoutBars(2, 1.5, 4, 0)).toEqual({ intoPhrase: 9.5, phraseBars: 16, loopBars: 4 })
    expect(radioReadoutBars(5, 0, 4, 16)).toEqual({ intoPhrase: 4, phraseBars: 16, loopBars: 4 })
    expect(radioReadoutBars(undefined, 2, 8, 32)).toEqual({
      intoPhrase: 2,
      phraseBars: 32,
      loopBars: 8
    })
    expect(radioReadoutBars(0, 1, 0, 16)).toEqual({ intoPhrase: 0, phraseBars: 0, loopBars: 0 })
  })
})

describe('radioReadoutArc', () => {
  it('off with the arc off; otherwise the direction from the leg', () => {
    expect(radioReadoutArc(null, 3, false)).toEqual({ state: 'off', count: 3, target: 3 })
    expect(radioReadoutArc({ phase: 'growing', target: 5 }, 3, true)).toEqual({
      state: 'growing',
      count: 3,
      target: 5
    })
    expect(radioReadoutArc({ phase: 'growing', target: 5 }, 5, true).state).toBe('steady')
    expect(radioReadoutArc({ phase: 'thinning', target: 2 }, 4, true).state).toBe('thinning')
    expect(radioReadoutArc(null, 4, true)).toEqual({ state: 'steady', count: 4, target: 4 })
  })
})

describe('radioRowLabel', () => {
  it('the first mask kind and the trait it was picked for', () => {
    expect(radioRowLabel(row('a', { kinds: ['bright', 'drums'] }))).toBe('drums · bright')
    expect(radioRowLabel(row('a', { kinds: ['lead', 'bass', 'warm'] }))).toBe('bass · warm')
    expect(radioRowLabel(row('a', { kinds: ['drums', 'bassHeavy'] }))).toBe('drums · heavy')
  })

  it("a mask kind alone takes the stem's dominant trait, if it has one", () => {
    expect(
      radioRowLabel(row('a', { kinds: ['drums'], traits: { bright: 0.9, rhythmic: 0.7 } }))
    ).toBe('drums · bright')
    expect(radioRowLabel(row('a', { kinds: ['drums'], traits: { bright: 0.3, warm: 0.5 } }))).toBe(
      'drums'
    )
    expect(radioRowLabel(row('a', { kinds: ['bass'], traits: { warm: null } }))).toBe('bass')
  })

  it('no mask kind: the trait alone (picked for, else strongest)', () => {
    expect(radioRowLabel(row('a', { kinds: ['rhythmic'] }))).toBe('rhythmic')
    expect(radioRowLabel(row('a', { kinds: [], traits: { warm: 0.8, rhythmic: 0.65 } }))).toBe(
      'warm'
    )
  })

  it('nothing else: the stem type; nothing at all: empty', () => {
    expect(radioRowLabel(row('a', { kinds: [], stemType: 'audioIn' }))).toBe('audio in')
    expect(radioRowLabel(row('a', { kinds: [] }))).toBe('')
  })

  it('appends the author when known', () => {
    expect(radioRowLabel(row('a', { kinds: ['drums', 'bright'], author: 'elling' }))).toBe(
      'drums · bright — elling'
    )
    expect(radioRowLabel(row('a', { kinds: [], author: 'elling' }))).toBe('elling')
    expect(radioRowLabel(row('a', { kinds: ['lead'], author: '  ' }))).toBe('lead')
  })
})

describe('radioAgeLabel', () => {
  it('laps, with 1 lap in the singular', () => {
    expect(radioAgeLabel(1)).toBe('1 lap')
    expect(radioAgeLabel(12)).toBe('12 laps')
    expect(radioAgeLabel(0)).toBe('0 laps')
    expect(radioAgeLabel(2.9)).toBe('2 laps')
    expect(radioAgeLabel(Number.NaN)).toBe('0 laps')
  })
})

describe('radioReadout: rows', () => {
  it('labels and ages each row; marks the next one with how it arrives; passes the flash on', () => {
    const r = radioReadout(
      input({
        nextChange: { rowId: 'b', kind: 'filter in', barsAway: 3 },
        rows: [
          row('a', { laps: 12, flash: { word: 'wash', t: 0.5 } }),
          row('b', { kinds: ['bass'], laps: 1, author: 'elling' })
        ]
      })
    )
    expect(r.rows).toEqual([
      {
        rowId: 'a',
        label: 'drums',
        age: '12 laps',
        isNext: false,
        nextKind: null,
        nextLabel: null,
        flash: { word: 'wash', t: 0.5 }
      },
      {
        rowId: 'b',
        label: 'bass — elling',
        age: '1 lap',
        isNext: true,
        nextKind: 'filter in',
        nextLabel: 'next · filter in',
        flash: null
      }
    ])
  })

  it('reads plain next while the arrival is not drawn', () => {
    const r = radioReadout(input({ nextChange: { rowId: 'a', kind: null, barsAway: 8 } }))
    expect(r.rows[0].nextLabel).toBe('next')
  })
})

describe('the gesture flash', () => {
  const log: RadioFlash[] = [
    { rowId: 'a', word: 'hole', at: 10, key: 'k1' },
    { rowId: 'a', word: 'throw', at: 10.5, key: 'k2' },
    { rowId: 'b', word: 'wash', at: 12, key: 'k3' }
  ]

  it('a word shows from when it sounds, for one window, the latest winning', () => {
    expect(radioFlashShown(log, 'a', 9.9, 2)).toBeNull()
    expect(radioFlashShown(log, 'a', 10.25, 2)).toEqual({ word: 'hole', t: 0.125 })
    expect(radioFlashShown(log, 'a', 11.5, 2)).toEqual({ word: 'throw', t: 0.5 })
    expect(radioFlashShown(log, 'a', 12.5, 2)).toBeNull()
    expect(radioFlashShown(log, 'b', 11, 2)).toBeNull()
    expect(radioFlashShown(log, 'b', 12, 2)).toEqual({ word: 'wash', t: 0 })
    expect(radioFlashShown(log, 'a', 10.5, 0)).toBeNull()
  })

  it('pruning drops words past their window, and words not sounding yet that were taken back', () => {
    expect(pruneRadioFlashes(log, 12.2, 2).map((f) => f.key)).toEqual(['k2', 'k3'])
    expect(pruneRadioFlashes(log, 11, 2, new Set(['k1'])).map((f) => f.key)).toEqual(['k1', 'k2'])
    expect(pruneRadioFlashes(log, 11, 2, new Set(['k3'])).map((f) => f.key)).toEqual([
      'k1',
      'k2',
      'k3'
    ])
  })

  it('dropping takes back every word one key armed', () => {
    expect(dropRadioFlashes(log, 'k2').map((f) => f.key)).toEqual(['k1', 'k3'])
  })

  it('a cut and the arc exit flash nothing; every other gesture its own name', () => {
    expect(radioGestureFlashWord('cut')).toBeNull()
    expect(radioGestureFlashWord('drop-out')).toBeNull()
    expect(radioGestureFlashWord('filter in')).toBe('filter in')
    expect(radioGestureFlashWord('riser')).toBe('riser')
  })

  it('fades in and out over its window', () => {
    expect(radioFlashOpacity(0)).toBe(0)
    expect(radioFlashOpacity(0.5)).toBeCloseTo(1, 9)
    expect(radioFlashOpacity(1)).toBeCloseTo(0, 9)
    expect(radioFlashOpacity(Number.NaN)).toBe(0)
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd /Users/nickel/Claudecode/sssketch && npx vitest run src/shared/radioReadout.test.ts`
Expected: FAIL, `Failed to resolve import "./radioReadout"`.

- [ ] **Step 3: Write the module**

Create `src/shared/radioReadout.ts`:

```ts
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
import type { RadioTransitionKind } from './radioTransition'
import {
  TURNAROUND_MOVE_LABEL,
  turnaroundArc,
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
}

/** A flash showing now: its word, and how far through its window it is (0..1). */
export interface RadioFlashShown {
  word: string
  t: number
}

export type RadioReadoutArcState = 'growing' | 'thinning' | 'steady' | 'off'

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
  /** Radio's own next change: the row, how it arrives (null while only armed), and bars until it
   * lands (null when its bar is not known yet). */
  nextChange: { rowId: string; kind: RadioTransitionKind | null; barsAway: number | null } | null
  /** The turnaround armed for the phrase's end, or a turn waiting; `move` null while a turn
   * waits for its roll. */
  armedTurnaround: { move: TurnaroundMove | null; isTurn: boolean } | null
  arc: { state: RadioReadoutArcState; count: number; target: number }
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
  /** `next · filter in`, or `next` while the arrival is not drawn yet; null on other rows. */
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

function arcPart(arc: RadioReadoutInput['arc']): string | null {
  switch (arc.state) {
    case 'growing':
      return `building ↑ ${arc.count} → ${arc.target}`
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
  const who = i >= 0 ? `row ${i + 1}` : 'a new row'
  const how = n.kind !== null ? ` → ${n.kind}` : ''
  const bars = Math.max(1, Math.ceil(n.barsAway - 1e-6))
  return `next: ${who}${how} · ${plural(bars, 'bar')}`
}

function rulerEnd(t: RadioReadoutInput['armedTurnaround']): string | null {
  if (t === null) return null
  if (t.isTurn) return t.move === null ? 'turn' : `turn: ${TURNAROUND_MOVE_LABEL[t.move]}`
  return t.move === null ? null : TURNAROUND_MOVE_LABEL[t.move]
}

export function radioReadout(input: RadioReadoutInput): RadioReadout {
  const statusLine = [arcPart(input.arc), nextPart(input)]
    .filter((p): p is string => p !== null)
    .join(' · ')
  const ticks = Math.max(0, Math.round(input.bars.phraseBars))
  const filled = Math.min(ticks, Math.max(0, Math.floor(input.bars.intoPhrase + 1e-9)))
  const next = input.nextChange
  return {
    statusLine,
    ruler: { ticks, filled, end: rulerEnd(input.armedTurnaround) },
    rows: input.rows.map((r) => {
      const isNext = next !== null && next.rowId === r.rowId
      const nextKind = isNext ? next.kind : null
      return {
        rowId: r.rowId,
        label: radioRowLabel(r),
        age: radioAgeLabel(r.laps),
        isNext,
        nextKind,
        nextLabel: isNext ? (nextKind !== null ? `next · ${nextKind}` : 'next') : null,
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

/** The row's flash at `now`: the latest word whose start lies within the last `window` (one
 * bar on the log's clock), or null. A word not sounding yet does not show. */
export function radioFlashShown(
  log: readonly RadioFlash[],
  rowId: string,
  now: number,
  window: number
): RadioFlashShown | null {
  if (!(window > 0) || !Number.isFinite(now)) return null
  let best: RadioFlash | null = null
  for (const f of log) {
    if (f.rowId !== rowId || f.at > now + 1e-9 || now - f.at >= window) continue
    if (best === null || f.at > best.at) best = f
  }
  return best === null
    ? null
    : { word: best.word, t: Math.min(1, Math.max(0, (now - best.at) / window)) }
}

/** The log without words whose window has passed, and -- given `live`, the keys still armed --
 * without words not sounding yet whose gesture has been taken back. */
export function pruneRadioFlashes(
  log: readonly RadioFlash[],
  now: number,
  window: number,
  live?: ReadonlySet<string>
): RadioFlash[] {
  return log.filter((f) =>
    f.at > now ? live === undefined || live.has(f.key) : now - f.at < window
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
```

- [ ] **Step 4: Run the tests, typecheck and lint**

Run: `cd /Users/nickel/Claudecode/sssketch && npx vitest run src/shared/radioReadout.test.ts && npm run typecheck && npx eslint src/shared/radioReadout.ts src/shared/radioReadout.test.ts`
Expected: 23 tests pass; typecheck and eslint print no errors.

- [ ] **Step 5: Commit**

```bash
cd /Users/nickel/Claudecode/sssketch
git add src/shared/radioReadout.ts src/shared/radioReadout.test.ts
git commit -F - <<'EOF'
radio readout: the shared status line, phrase ruler, row labels and age, and the gesture flash log's rules

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01KK8TyKjVKvWU8ZjQCk3ozz
EOF
```

---

## Task 2: web, the readout in `RadioView` (step.ts)

Each row counts the laps its stem has played (`RadioRow.laps`: 1 when a stem lands, via `commit`; one more at each wrap). `describe(s, flashes)` fills the shared input from the state as of the last tick: the turnaround phrase from `clock.turnaroundLap`, the next change from `upcoming`, the turn or armed turnaround, the arc from `s.density`, and each row's flash from the log (window: one bar, `240 / bpm` seconds).

**Files:**
- Modify: `/Users/nickel/Claudecode/ell.ing/radio/src/radio/step.ts`
- Test: `/Users/nickel/Claudecode/ell.ing/radio/src/radio/step.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to the end of `src/radio/step.test.ts` (it already imports `describe as view`, `WEB_RADIO_DEFAULTS`, `WebRadioSettings`, `seeded`, `LAP` and `Sim`):

```ts
describe('the readout (sssketch spec 2026-10-03-radio-readout-design)', () => {
  /** A running radio (turnarounds off unless asked), ticked from 0 to `now`. */
  function running(settings: Partial<WebRadioSettings> = {}, now = 1): Sim {
    const sim = new Sim({ turnarounds: 'off', ...settings }, seeded(1))
    sim.send({ type: 'play' })
    sim.run(0, now)
    return sim
  }

  it('is null until the radio runs', () => {
    expect(view(new Sim().s).readout).toBeNull()
  })

  it('rules the 16-bar turnaround phrase and ages each row in laps', () => {
    const sim = running({}, LAP + 1)
    const r = view(sim.s).readout!
    // a lap and half a bar into the phrase: four whole bars played
    expect(r.ruler).toEqual({ ticks: 16, filled: 4, end: null })
    expect(r.rows.map((x) => x.rowId)).toEqual(sim.s.rows.map((x) => x.id))
    // nothing changes before 8 bars (the mid window): every row is on its second lap
    expect(r.rows.map((x) => x.age)).toEqual(sim.s.rows.map(() => '2 laps'))
  })

  it("a row's age starts again at 1 lap when a stem lands on it", () => {
    const now = 40 * LAP + 1
    const sim = running({}, now)
    const last = sim.of('landAt').filter((a) => a.time <= now).at(-1)!
    const i = sim.s.rows.findIndex((x) => x.id === last.changes[0].slot)
    const laps = Math.floor((now - last.time) / LAP + 1e-9) + 1
    expect(view(sim.s).readout!.rows[i].age).toBe(`${laps} lap${laps === 1 ? '' : 's'}`)
  })

  it('names the next change on its row and in the status line', () => {
    const sim = running({}, 1)
    const v = view(sim.s)
    const up = v.upcoming!
    const i = sim.s.rows.findIndex((x) => x.id === up.slot)
    const r = v.readout!
    expect(r.rows[i]).toMatchObject({ isNext: true, nextLabel: 'next' })
    expect(r.rows.filter((x) => x.isNext)).toHaveLength(1)
    expect(r.statusLine).toMatch(new RegExp(`^next: row ${i + 1} · \\d+ bars?$`))
  })

  it("ends the ruler with a turn's move, from the press until its top has passed", () => {
    const sim = running({}, 1)
    sim.send({ type: 'turn', move: 'wash' })
    expect(view(sim.s).readout!.ruler.end).toBe('turn: wash')
    sim.run(1 + 1 / 30, 2)
    expect(view(sim.s).readout!.ruler.end).toBe('turn: wash')
    sim.run(2, LAP + 0.1)
    expect(view(sim.s).readout!.ruler.end).toBeNull()
  })

  it('says where the density arc is heading', () => {
    const sim = running({ densityArc: { ...WEB_RADIO_DEFAULTS.densityArc, on: true } }, 1)
    expect(view(sim.s).readout!.statusLine).toMatch(/^(building ↑ \d → \d|steady · \d rows) · next: /)
  })

  it("shows a flash on its row from when it sounds, for one bar (2 s at 120 bpm)", () => {
    const sim = running({}, 1)
    const now = sim.s.lastTick!.now
    const id = sim.s.rows[0].id
    const at = (t: number) => view(sim.s, [{ rowId: id, word: 'wash', at: t, key: 'k' }]).readout!.rows[0].flash
    expect(at(now - 0.5)?.word).toBe('wash')
    expect(at(now - 0.5)?.t).toBeCloseTo(0.25, 9)
    expect(at(now + 0.1)).toBeNull()
    expect(at(now - 2.1)).toBeNull()
  })
})
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `cd /Users/nickel/Claudecode/ell.ing/radio && npx vitest run src/radio/step.test.ts`
Expected: the 7 new tests FAIL (`readout` is undefined: `expected undefined to be null`, `Cannot read properties of undefined (reading 'ruler')`); the rest pass.

- [ ] **Step 3: Implement**

In `/Users/nickel/Claudecode/ell.ing/radio/src/radio/step.ts` (1 of 8), find:

```ts
import { radioFoldStatus, type RadioFoldStatus } from '@shared/radioFoldStatus'
```

replace with:

```ts
import { radioFoldStatus, type RadioFoldStatus } from '@shared/radioFoldStatus'
import {
  radioFlashShown,
  radioReadout,
  radioReadoutArc,
  radioReadoutBars,
  type RadioFlash,
  type RadioReadout
} from '@shared/radioReadout'
```

In `/Users/nickel/Claudecode/ell.ing/radio/src/radio/step.ts` (2 of 8), find:

```ts
  /** Seeding gave up on this row: it is left out of the bed. */
  gaveUp?: boolean
}
```

replace with:

```ts
  /** Seeding gave up on this row: it is left out of the bed. */
  gaveUp?: boolean
  /** Laps its stem has played, the one playing included: 1 when a stem lands on it (commit), one
   * more at every wrap. Absent reads as 1. The readout's age. */
  laps?: number
}
```

In `/Users/nickel/Claudecode/ell.ing/radio/src/radio/step.ts` (3 of 8), find:

```ts
  if (adv.wrapped) {
    driftAtWrap(c, loopBars)
```

replace with:

```ts
  if (adv.wrapped) {
    for (const r of s.rows) r.laps = (r.laps ?? 1) + 1
    driftAtWrap(c, loopBars)
```

In `/Users/nickel/Claudecode/ell.ing/radio/src/radio/step.ts` (4 of 8), find:

```ts
  if (row) row.record = record
}
```

replace with:

```ts
  if (row) {
    row.record = record
    row.laps = 1
  }
}
```

In `/Users/nickel/Claudecode/ell.ing/radio/src/radio/step.ts` (5 of 8), find:

```ts
   * row's cycle and phase); null with the mode off or before its first step. */
  fold: RadioFoldStatus | null
}
```

replace with:

```ts
   * row's cycle and phase); null with the mode off or before its first step. */
  fold: RadioFoldStatus | null
  /** What radio is about to do and why (@shared/radioReadout, sssketch spec
   * 2026-10-03-radio-readout-design): the status line, the phrase ruler, each row's label, age,
   * `next` and gesture flash. Null unless running. */
  readout: RadioReadout | null
}
```

In `/Users/nickel/Claudecode/ell.ing/radio/src/radio/step.ts` (6 of 8), find:

```ts
export function describe(s: RadioState): RadioView {
```

replace with:

```ts
/** `flashes`: the controller's gesture flash log (AudioContext seconds), read for each row's
 * flash at the last tick. */
export function describe(s: RadioState, flashes: readonly RadioFlash[] = []): RadioView {
```

In `/Users/nickel/Claudecode/ell.ing/radio/src/radio/step.ts` (7 of 8), find:

```ts
    fold: s.settings.foldMode && s.phase === 'running' ? radioFoldStatus(s.fold, s.foldNow, loopBars, s.settings.fold, next?.barsUntil ?? null) : null,
```

replace with:

```ts
    fold: s.settings.foldMode && s.phase === 'running' ? radioFoldStatus(s.fold, s.foldNow, loopBars, s.settings.fold, next?.barsUntil ?? null) : null,
    readout: readoutView(s, next, flashes),
```

In `/Users/nickel/Claudecode/ell.ing/radio/src/radio/step.ts` (8 of 8), find:

```ts
export function describe(s: RadioState, flashes
```

replace with:

```ts
/** RadioView['readout']: the shared readout, filled from the state as of the last tick. */
function readoutView(s: RadioState, next: RadioView['upcoming'], flashes: readonly RadioFlash[]): RadioReadout | null {
  const t = s.lastTick
  if (s.phase !== 'running' || !t || !s.clock) return null
  const barSec = 240 / s.bpm
  return radioReadout({
    bars: radioReadoutBars(s.clock.turnaroundLap, t.pos, t.loopBars, s.settings.phraseBars),
    nextChange: next ? { rowId: next.slot, kind: next.transition, barsAway: next.barsUntil } : null,
    armedTurnaround: s.turnRequest
      ? { move: s.turnRequest.move, isTurn: true }
      : s.turnaround
        ? { move: s.turnaround.plan.move, isTurn: !!s.turnaround.turn }
        : null,
    arc: radioReadoutArc(s.density, s.rows.length, s.density !== null),
    rows: s.rows.map((r) => ({
      rowId: r.id,
      kinds: r.kinds,
      traits: r.record?.traits ?? null,
      stemType: r.record?.mask != null ? instrumentMaskToSoundType(r.record.mask) : null,
      author: null,
      laps: r.laps ?? 1,
      flash: radioFlashShown(flashes, r.id, t.now, barSec)
    }))
  })
}

export function describe(s: RadioState, flashes
```


- [ ] **Step 4: Run the tests and the typecheck**

Run: `cd /Users/nickel/Claudecode/ell.ing/radio && npx vitest run src/radio/step.test.ts && npm run typecheck`
Expected: all pass (83 tests); typecheck prints nothing.

- [ ] **Step 5: Commit**

```bash
cd /Users/nickel/Claudecode/ell.ing/radio
git add src/radio/step.ts src/radio/step.test.ts
git commit -F - <<'EOF'
radio readout: the view carries it (@shared/radioReadout) -- the status line, the phrase ruler from the clock's turnaround lap, the turn or armed turnaround at its end, the arc, and each row's label, age in laps (RadioRow.laps, 1 when a stem lands) and flash from the controller's log

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01KK8TyKjVKvWU8ZjQCk3ozz
EOF
```

---

## Task 3: web, the gesture flash log (controller.ts)

The controller is where gestures reach the engine, so it records the words there, at the AudioContext time each one starts sounding: a change's lead-in (`hole`, `riser`) `beats` before its wrap and an arrival (`filter in`, `bloom`, `duck`) at the wrap (`land`, with the kind the engine took, so a lead-in that fell back to a cut flashes nothing); an added row's arrival at its top (`addRow`); a turnaround's move on each row of its plan, from `plan.beats` before the top (a riser has no rows, so no word); a throw at its start. Cancels take the words back (`cancel`, `cancelTurnaround`, a later turn into the same top); stop clears the log; each tick prunes words older than a bar.

**Files:**
- Modify: `/Users/nickel/Claudecode/ell.ing/radio/src/radio/controller.ts`
- Test: `/Users/nickel/Claudecode/ell.ing/radio/src/radio/controller.test.ts`

- [ ] **Step 1: Write the failing tests**

In `src/radio/controller.test.ts`, find:

```ts
import type { TurnaroundPlan } from '@shared/radioTurnaround'
```

replace with:

```ts
import { TURNAROUND_MOVE_LABEL, type TurnaroundPlan } from '@shared/radioTurnaround'
```

Then append to the end of the file (it already has `rig`, `Rig`, `started`, `Call` and imports `radioGestureLeadsChange`):

```ts
// ---- the gesture flash log (sssketch spec 2026-10-03-radio-readout-design section 1) ----

describe('the gesture flash log', () => {
  /** Tick by tick until `found` finds something, for at most `sec` of audio. */
  async function untilFound<T>(r: Rig, sec: number, found: () => T | undefined): Promise<T | undefined> {
    let x = found()
    for (let i = 0; i < sec * 30 && x === undefined; i++) {
      await r.run(1 / 30)
      x = found()
    }
    return x
  }

  it("a turnaround's move goes on each row it plays on, from its first beat", async () => {
    const r = rig({ seed: 3, settings: { turnarounds: 'often', phraseBars: 16 } })
    await started(r)
    const t = await untilFound(r, 400, () => r.eng.turnarounds().find((x) => x.plan.rows.length > 0))
    expect(t).toBeDefined()
    const words = r.ctl.flashLog().filter((f) => f.key === `turnaround@${t!.at}`)
    expect(words.map((f) => f.rowId).sort()).toEqual(t!.plan.rows.map((x) => x.rowId).sort())
    for (const f of words) {
      expect(f.word).toBe(TURNAROUND_MOVE_LABEL[t!.plan.move])
      expect(f.at).toBeCloseTo(t!.at - t!.plan.beats * 0.5, 6) // a beat is 0.5 s at 120 bpm
    }
  })

  it('a throw flashes `throw` on its row, from its start', async () => {
    const r = rig()
    await started(r)
    const th = await untilFound(r, 400, () => r.eng.calls.find((c): c is Extract<Call, { op: 'throw' }> => c.op === 'throw'))
    expect(th).toBeDefined()
    expect(r.ctl.flashLog()).toContainEqual({ rowId: th!.row, word: 'throw', at: th!.at, key: `throw@${th!.at}` })
  })

  it('a transition flashes its gesture on the row it lands on: a lead-in before the wrap, an arrival on it', async () => {
    const r = rig({ seed: 5, settings: { transitions: 'bold' } })
    await started(r)
    const sw = await untilFound(r, 800, () =>
      r.eng.calls.find((c): c is Extract<Call, { op: 'swap' }> => c.op === 'swap' && c.kind !== 'cut')
    )
    expect(sw).toBeDefined()
    const at = radioGestureLeadsChange(sw!.kind) ? sw!.at - (sw!.beats ?? 0) * 0.5 : sw!.at
    const f = r.ctl.flashLog().find((x) => x.key === `${sw!.row}@${sw!.at}`)
    expect(f).toMatchObject({ rowId: sw!.row, word: sw!.kind })
    expect(f!.at).toBeCloseTo(at, 6)
  })

  it("view() shows a row's flash while its bar runs, and the log forgets it after", async () => {
    const r = rig({ seed: 3, settings: { turnarounds: 'often', phraseBars: 16 } })
    await started(r)
    const t = await untilFound(r, 400, () => r.eng.turnarounds().find((x) => x.plan.rows.length > 0))
    const start = t!.at - t!.plan.beats * 0.5
    await r.until(start + 0.2)
    const row = t!.plan.rows[0].rowId
    expect(r.ctl.view().readout!.rows.find((x) => x.rowId === row)!.flash?.word).toBe(TURNAROUND_MOVE_LABEL[t!.plan.move])
    await r.until(start + 2.5) // one bar is 2 s
    expect(r.ctl.flashLog().some((f) => f.key === `turnaround@${t!.at}`)).toBe(false)
  })

  it('stop clears the log', async () => {
    const r = rig()
    await started(r)
    await untilFound(r, 400, () => r.eng.calls.find((c) => c.op === 'throw'))
    r.ctl.stop()
    expect(r.ctl.flashLog()).toEqual([])
  })
})
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `cd /Users/nickel/Claudecode/ell.ing/radio && npx vitest run src/radio/controller.test.ts`
Expected: the 5 new tests FAIL with `r.ctl.flashLog is not a function`.

- [ ] **Step 3: Implement**

In `/Users/nickel/Claudecode/ell.ing/radio/src/radio/controller.ts` (1 of 11), find:

```ts
import type { TurnaroundDepth, TurnaroundFamily, TurnaroundMove, TurnaroundPlan } from '@shared/radioTurnaround'
```

replace with:

```ts
import { TURNAROUND_MOVE_LABEL, type TurnaroundDepth, type TurnaroundFamily, type TurnaroundMove, type TurnaroundPlan } from '@shared/radioTurnaround'
import { RADIO_THROW_WORD, dropRadioFlashes, pruneRadioFlashes, radioGestureFlashWord, type RadioFlash } from '@shared/radioReadout'
```

In `/Users/nickel/Claudecode/ell.ing/radio/src/radio/controller.ts` (2 of 11), find:

```ts
  private throws: ThrowState = initialThrowState()
  private readonly throwRandom: () => number
```

replace with:

```ts
  private throws: ThrowState = initialThrowState()
  private readonly throwRandom: () => number
  /** The gesture flash log (sssketch spec 2026-10-03-radio-readout-design section 1): a word for
   * each row a gesture is applied to, at the AudioContext time it starts SOUNDING, keyed by what
   * armed it (`<slot>@<wrap>` a change, `turnaround@<wrap>`, `throw@<time>`). view() reads each
   * row's flash from it. */
  private flashes: RadioFlash[] = []
```

In `/Users/nickel/Claudecode/ell.ing/radio/src/radio/controller.ts` (3 of 11), find:

```ts
  view(): RadioView {
    return describe(this.s)
  }
```

replace with:

```ts
  view(): RadioView {
    return describe(this.s, this.flashes)
  }

  /** The gesture flash log, for reading. */
  flashLog(): readonly RadioFlash[] {
    return this.flashes
  }

  private flash(rowId: string, word: string | null, at: number, key: string): void {
    if (word !== null) this.flashes.push({ rowId, word, at, key })
  }
```

In `/Users/nickel/Claudecode/ell.ing/radio/src/radio/controller.ts` (4 of 11), find:

```ts
    // nothing until the loop's first top: before it, its "next loop top" is the start itself
    if (!c || now < c.startTime) return
```

replace with:

```ts
    // nothing until the loop's first top: before it, its "next loop top" is the start itself
    if (!c || now < c.startTime) return
    // a word shows for one bar from when it sounds
    this.flashes = pruneRadioFlashes(this.flashes, now, 240 / this.s.bpm)
```

In `/Users/nickel/Claudecode/ell.ing/radio/src/radio/controller.ts` (5 of 11), find:

```ts
    try {
      this.deps.engine.throwDelay(p.slot, p.at, p.beats, p.timing, p.feedback)
    } catch (err) {
```

replace with:

```ts
    try {
      this.deps.engine.throwDelay(p.slot, p.at, p.beats, p.timing, p.feedback)
      this.flash(p.slot, RADIO_THROW_WORD, p.at, `throw@${p.at}`)
    } catch (err) {
```

In `/Users/nickel/Claudecode/ell.ing/radio/src/radio/controller.ts` (6 of 11), find:

```ts
      case 'turnaround':
        try {
          e.applyTurnaround(a.plan, a.time)
        } catch (err) {
```

replace with:

```ts
      case 'turnaround': {
        // a later turn into the same top replaces the one there, words and all
        const key = `turnaround@${a.time}`
        this.flashes = dropRadioFlashes(this.flashes, key)
        try {
          e.applyTurnaround(a.plan, a.time)
          // each row the move plays on, from its first beat (a riser is its own voice: no row)
          const start = a.time - a.plan.beats * (60 / this.s.bpm)
          for (const r of a.plan.rows) this.flash(r.rowId, TURNAROUND_MOVE_LABEL[a.plan.move], start, key)
        } catch (err) {
```

In `/Users/nickel/Claudecode/ell.ing/radio/src/radio/controller.ts` (7 of 11), find:

```ts
          this.events.push({ type: 'turnaroundFailed', at: a.time })
        }
        return
      case 'cancelTurnaround':
        try {
```

replace with:

```ts
          this.events.push({ type: 'turnaroundFailed', at: a.time })
        }
        return
      }
      case 'cancelTurnaround':
        this.flashes = dropRadioFlashes(this.flashes, `turnaround@${a.time}`)
        try {
```

In `/Users/nickel/Claudecode/ell.ing/radio/src/radio/controller.ts` (8 of 11), find:

```ts
      case 'cancel': {
        // replacing the pending swap with the playing stem takes the change (and its gestures) back
        let ok = true
```

replace with:

```ts
      case 'cancel': {
        // replacing the pending swap with the playing stem takes the change (and its gestures) back
        this.flashes = dropRadioFlashes(this.flashes, `${a.slot}@${a.time}`)
        let ok = true
```

In `/Users/nickel/Claudecode/ell.ing/radio/src/radio/controller.ts` (9 of 11), find:

```ts
      case 'stop':
        this.stopTimer?.()
        this.stopTimer = null
```

replace with:

```ts
      case 'stop':
        this.flashes = []
        this.stopTimer?.()
        this.stopTimer = null
```

In `/Users/nickel/Claudecode/ell.ing/radio/src/radio/controller.ts` (10 of 11), find:

```ts
          kind = e.scheduleSwap(a.slot, stem, a.time, a.transition).kind
          if (a.muted) e.setMute(a.slot, true)
```

replace with:

```ts
          kind = e.scheduleSwap(a.slot, stem, a.time, a.transition).kind
          // its arrival (filter in or bloom) sounds from the top it joins at
          this.flash(a.slot, radioGestureFlashWord(kind), a.time, `${a.slot}@${a.time}`)
          if (a.muted) e.setMute(a.slot, true)
```

In `/Users/nickel/Claudecode/ell.ing/radio/src/radio/controller.ts` (11 of 11), find:

```ts
    this.events.push({ type: 'scheduled', slot, at, kind })
  }
```

replace with:

```ts
    // a lead-in (hole, riser) sounds over the beats before the wrap, an arrival from the wrap
    const start = radioGestureLeadsChange(kind) ? at - t.beats * (60 / this.s.bpm) : at
    this.flash(slot, radioGestureFlashWord(kind), start, `${slot}@${at}`)
    this.events.push({ type: 'scheduled', slot, at, kind })
  }
```


- [ ] **Step 4: Run the tests and the typecheck**

Run: `cd /Users/nickel/Claudecode/ell.ing/radio && npx vitest run src/radio && npm run typecheck`
Expected: all pass (controller.test.ts: 63 tests); typecheck prints nothing.

- [ ] **Step 5: Commit**

```bash
cd /Users/nickel/Claudecode/ell.ing/radio
git add src/radio/controller.ts src/radio/controller.test.ts
git commit -F - <<'EOF'
radio readout: the gesture flash log -- a word per row where the controller applies a gesture, at the time it sounds (a change's lead-in before its wrap, an arrival on it, an added row's arrival, a turnaround's move on each of its rows, a throw), taken back with a cancel, pruned after a bar, cleared on stop; view() reads each row's flash from it

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01KK8TyKjVKvWU8ZjQCk3ozz
EOF
```

---

## Task 4: web, the full-mode model (fullModel.ts)

**Files:**
- Modify: `/Users/nickel/Claudecode/ell.ing/radio/src/ui/fullModel.ts`
- Test: `/Users/nickel/Claudecode/ell.ing/radio/src/ui/fullModel.test.ts`

- [ ] **Step 1: Write the failing tests**

In `src/ui/fullModel.test.ts`, find:

```ts
  flipFilter,
  foldDots,
```

replace with:

```ts
  flashes,
  flipFilter,
  foldDots,
```

Then append to the end of the file (after the `radioDot` helper):

```ts
describe('the radio readout: the status line, the ruler, each row, the flash', () => {
  const readout = (over: Partial<NonNullable<FullView['readout']>> = {}): NonNullable<FullView['readout']> => ({
    statusLine: 'building ↑ 3 → 5 · next: row 2 → filter in · 6 bars',
    ruler: { ticks: 16, filled: 5, end: 'wash' },
    rows: [
      { rowId: 'r0', label: 'drums · bright', age: '12 laps', isNext: false, nextKind: null, nextLabel: null, flash: { word: 'wash', t: 0.5 } },
      { rowId: 'r1', label: 'bass', age: '1 lap', isNext: true, nextKind: 'filter in', nextLabel: 'next · filter in', flash: null }
    ],
    ...over
  })
  const rows = [row({ slot: 'r0' }), row({ slot: 'r1' })]

  it('the status line and the ruler while running; none without a readout', () => {
    expect(fullModel(view({ rows, readout: readout() })).status).toEqual({
      line: 'building ↑ 3 → 5 · next: row 2 → filter in · 6 bars',
      ruler: { ticks: 16, filled: 5, end: 'wash' }
    })
    expect(fullModel(view({ rows, readout: null })).status).toBeNull()
    expect(fullModel(view({ rows })).status).toBeNull()
  })

  it('each row its label, its age, and next on the row that is due', () => {
    expect(fullModel(view({ rows, readout: readout() })).rows.map((r) => r.readout)).toEqual([
      { label: 'drums · bright', age: '12 laps', next: null },
      { label: 'bass', age: '1 lap', next: 'next · filter in' }
    ])
    expect(fullModel(view({ rows })).rows.map((r) => r.readout)).toEqual([null, null])
  })

  it('a change of the line, the ruler or a row redraws; a flash alone does not', () => {
    const a = fullKey(view({ rows, readout: readout() }))
    expect(fullKey(view({ rows, readout: readout({ statusLine: 'steady · 4 rows' }) }))).not.toBe(a)
    expect(fullKey(view({ rows, readout: readout({ ruler: { ticks: 16, filled: 6, end: 'wash' } }) }))).not.toBe(a)
    expect(fullKey(view({ rows, readout: readout({ ruler: { ticks: 16, filled: 5, end: null } }) }))).not.toBe(a)
    const older = readout()
    older.rows[0] = { ...older.rows[0], age: '13 laps' }
    expect(fullKey(view({ rows, readout: older }))).not.toBe(a)
    const flashed = readout()
    flashed.rows[0] = { ...flashed.rows[0], flash: { word: 'wash', t: 0.9 } }
    expect(fullKey(view({ rows, readout: flashed }))).toBe(a)
  })

  it('flashes: the word and how visible it is, by row; none stopped', () => {
    const f = flashes(view({ rows, readout: readout() }))
    expect([...f.keys()]).toEqual(['r0'])
    expect(f.get('r0')!.word).toBe('wash')
    expect(f.get('r0')!.opacity).toBeCloseTo(1, 9)
    expect(flashes(view({ rows, readout: readout(), phase: 'stopped' })).size).toBe(0)
  })
})
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `cd /Users/nickel/Claudecode/ell.ing/radio && npx vitest run src/ui/fullModel.test.ts`
Expected: FAIL: `flashes is not a function` and `expected undefined to deeply equal { line: ... }`.

- [ ] **Step 3: Implement**

In `/Users/nickel/Claudecode/ell.ing/radio/src/ui/fullModel.ts` (1 of 8), find:

```ts
import { radioFoldBeatsIn, radioFoldPhaseDot, radioFoldRowLabel } from '@shared/radioFoldStatus'
```

replace with:

```ts
import { radioFoldBeatsIn, radioFoldPhaseDot, radioFoldRowLabel } from '@shared/radioFoldStatus'
import { radioFlashOpacity } from '@shared/radioReadout'
```

In `/Users/nickel/Claudecode/ell.ing/radio/src/ui/fullModel.ts` (2 of 8), find:

```ts
  /** Where the playhead was at the view's tick, bars (foldDots); absent reads as 0. */
  pos?: number
}
```

replace with:

```ts
  /** Where the playhead was at the view's tick, bars (foldDots); absent reads as 0. */
  pos?: number
  /** The radio readout (@shared/radioReadout); null or absent unless running. */
  readout?: RadioView['readout']
}
```

In `/Users/nickel/Claudecode/ell.ing/radio/src/ui/fullModel.ts` (3 of 8), find:

```ts
   * for a row playing straight, and with the mode off. */
  fold: string | null
}
```

replace with:

```ts
   * for a row playing straight, and with the mode off. */
  fold: string | null
  /** The radio readout on the row: what it was picked as (`drums · bright`), how long it has
   * played (`12 laps`), and `next · filter in` on the row that is due (null on the others). Null
   * unless running. Its flash is drawn per frame (flashes). */
  readout: { label: string; age: string; next: string | null } | null
}
```

In `/Users/nickel/Claudecode/ell.ing/radio/src/ui/fullModel.ts` (4 of 8), find:

```ts
  foldStatus: string | null
  /** Play pressed, the radio not running yet (seeding or starting): `…`, not "press play". */
```

replace with:

```ts
  foldStatus: string | null
  /** The radio readout's lines at the top: the status line (`building ↑ 3 → 5 · next: row 2 →
   * filter in · 6 bars`) and the phrase ruler. Null unless running. */
  status: { line: string; ruler: { ticks: number; filled: number; end: string | null } } | null
  /** Play pressed, the radio not running yet (seeding or starting): `…`, not "press play". */
```

In `/Users/nickel/Claudecode/ell.ing/radio/src/ui/fullModel.ts` (5 of 8), find:

```ts
export function fullModel(view: FullView, opts: FullOptions = {}): FullModel {
  return {
    foldStatus: view.fold?.summary ?? null,
```

replace with:

```ts
/** A row's readout (FullRow['readout']). */
function rowReadout(view: FullView, slot: string): FullRow['readout'] {
  const x = view.readout?.rows.find((y) => y.rowId === slot)
  return x ? { label: x.label, age: x.age, next: x.nextLabel } : null
}

export function fullModel(view: FullView, opts: FullOptions = {}): FullModel {
  return {
    foldStatus: view.fold?.summary ?? null,
    status: view.readout ? { line: view.readout.statusLine, ruler: view.readout.ruler } : null,
```

In `/Users/nickel/Claudecode/ell.ing/radio/src/ui/fullModel.ts` (6 of 8), find:

```ts
      fold: foldLabel(view, r.slot)
    })),
```

replace with:

```ts
      fold: foldLabel(view, r.slot),
      readout: rowReadout(view, r.slot)
    })),
```

In `/Users/nickel/Claudecode/ell.ing/radio/src/ui/fullModel.ts` (7 of 8), find:

```ts
    [r.slot, r.stemId, r.bars, r.muted, !!r.soloed, r.audible, r.flag, r.approach?.state ?? '', r.name, r.jam, r.swap?.state ?? '', !!r.stemId && liked.has(r.stemId), foldLabel(view, r.slot) ?? ''].join('|')
  )
```

replace with:

```ts
    [r.slot, r.stemId, r.bars, r.muted, !!r.soloed, r.audible, r.flag, r.approach?.state ?? '', r.name, r.jam, r.swap?.state ?? '', !!r.stemId && liked.has(r.stemId), foldLabel(view, r.slot) ?? '', Object.values(rowReadout(view, r.slot) ?? {}).join('/')].join('|')
  )
  // the readout's lines, not its flashes (frame() draws those)
  const ro = view.readout
  const readout = ro ? [ro.statusLine, ro.ruler.ticks, ro.ruler.filled, ro.ruler.end].join('/') : ''
```

In `/Users/nickel/Claudecode/ell.ing/radio/src/ui/fullModel.ts` (8 of 8), find:

```ts
  return [view.phase, view.bpm, view.tempoTarget, view.held, view.pace, view.loopBars, failed, !!view.next, heartLiked, turn, view.fold?.summary ?? '', ...rows].join('\n')
}
```

replace with:

```ts
  return [view.phase, view.bpm, view.tempoTarget, view.held, view.pace, view.loopBars, failed, !!view.next, heartLiked, turn, view.fold?.summary ?? '', readout, ...rows].join('\n')
}

/** Each row's gesture flash as frame() draws it: the word, and how visible it is (in and out over
 * its bar, @shared/radioReadout radioFlashOpacity). None unless running. */
export function flashes(view: FullView): Map<string, { word: string; opacity: number }> {
  const out = new Map<string, { word: string; opacity: number }>()
  if (view.phase !== 'running') return out
  for (const r of view.readout?.rows ?? []) {
    if (r.flash) out.set(r.rowId, { word: r.flash.word, opacity: radioFlashOpacity(r.flash.t) })
  }
  return out
}
```


- [ ] **Step 4: Run the tests and the typecheck**

Run: `cd /Users/nickel/Claudecode/ell.ing/radio && npx vitest run src/ui/fullModel.test.ts && npm run typecheck`
Expected: all pass (41 tests); typecheck prints nothing.

- [ ] **Step 5: Commit**

```bash
cd /Users/nickel/Claudecode/ell.ing/radio
git add src/ui/fullModel.ts src/ui/fullModel.test.ts
git commit -F - <<'EOF'
full mode: the radio readout in the model -- the status line and phrase ruler, each row's label, age and next; they redraw the rows (fullKey), the flash does not: flashes() gives each row's word and opacity for the frame

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01KK8TyKjVKvWU8ZjQCk3ozz
EOF
```

---

## Task 5: web, drawing it (full.ts, full.css, main.ts), phone-safe

The readout's lines sit between the top corners: the status line (wraps), under it the phrase ruler (1px, one tick per bar, the bars played in ink, the end label at its right), then fold mode's status line, moved here from the fold group so it is on its own line beneath (it keeps its ellipsis). On a phone (≤600px) the block takes its own full-width line under the corners. On a row: label and age dim over the waveform's top left (ellipsized, short of the fold readout at the top right); the flash and `next · filter in` at its bottom right, near the buttons. The flash's opacity is set every frame. None of it is a live region.

**Files:**
- Modify: `/Users/nickel/Claudecode/ell.ing/radio/src/ui/full.ts`
- Modify: `/Users/nickel/Claudecode/ell.ing/radio/src/ui/full.css`
- Modify: `/Users/nickel/Claudecode/ell.ing/radio/src/main.ts`
- Test: `/Users/nickel/Claudecode/ell.ing/radio/src/ui/fullModel.test.ts`

- [ ] **Step 1: Write the failing test**

Append to the end of `src/ui/fullModel.test.ts`:

```ts
describe('the radio readout in full.ts', () => {
  it('the readout lines are not live regions: their counts move every bar', () => {
    const src = readFileSync(fileURLToPath(new URL('./full.ts', import.meta.url)), 'utf8')
    const lines = src.split('\n').filter((l) => /\b(statusLine|ruler|nextNote|flash)\b/.test(l))
    expect(lines.length).toBeGreaterThan(0)
    for (const l of lines) expect(l).not.toMatch(/aria-live|role=|'role'/)
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd /Users/nickel/Claudecode/ell.ing/radio && npx vitest run src/ui/fullModel.test.ts`
Expected: FAIL, `expected 0 to be greater than 0` (full.ts has none of these elements yet).

- [ ] **Step 3: Implement**

In `/Users/nickel/Claudecode/ell.ing/radio/src/ui/full.ts` (1 of 10), find:

```ts
  /** The playhead (percent of the window, null for none), the rows' breath (0..1), and each
   * folded row's phase dot (0..1 round its cycle, fullModel's foldDots), by slot. */
  frame(sweepPct: number | null, breath: number, foldDots?: ReadonlyMap<string, number>): void
```

replace with:

```ts
  /** The playhead (percent of the window, null for none), the rows' breath (0..1), each folded
   * row's phase dot (0..1 round its cycle, fullModel's foldDots), and each row's gesture flash
   * (fullModel's flashes), by slot. */
  frame(
    sweepPct: number | null,
    breath: number,
    foldDots?: ReadonlyMap<string, number>,
    flashes?: ReadonlyMap<string, { word: string; opacity: number }>
  ): void
```

In `/Users/nickel/Claudecode/ell.ing/radio/src/ui/full.ts` (2 of 10), find:

```ts
  foldLabel: HTMLSpanElement
  foldDot: HTMLSpanElement
  mute: HTMLButtonElement
```

replace with:

```ts
  foldLabel: HTMLSpanElement
  foldDot: HTMLSpanElement
  /** The radio readout: what the row was picked as and its age (top left); `next` and the gesture
   * flash (bottom right). */
  info: HTMLSpanElement
  nextNote: HTMLSpanElement
  flash: HTMLSpanElement
  mute: HTMLButtonElement
```

In `/Users/nickel/Claudecode/ell.ing/radio/src/ui/full.ts` (3 of 10), find:

```ts
  const tr = h('div', 'grp')
  tr.append(heart, back)
  top.append(toggle, tr)
```

replace with:

```ts
  const tr = h('div', 'grp')
  tr.append(heart, back)
  // the radio readout's lines (sssketch spec 2026-10-03-radio-readout-design section 2), between
  // the corners (on a phone, a line of their own under them): the status line (where the arc is
  // heading, what changes next), the phrase ruler under it (a tick per bar, the bars played
  // brighter, the turnaround armed for the phrase's end at its right), and fold mode's status line
  // beneath while fold is on. Not live regions: their counts move every bar.
  const status = h('div', 'status')
  status.hidden = true
  const statusLine = h('span', 'status-line')
  const ruler = h('div', 'ruler')
  ruler.setAttribute('aria-hidden', 'true')
  const rulerTicks = h('div', 'ruler-ticks')
  const rulerEnd = h('span', 'ruler-end')
  ruler.append(rulerTicks, rulerEnd)
  top.append(toggle, status, tr)
```

In `/Users/nickel/Claudecode/ell.ing/radio/src/ui/full.ts` (4 of 10), find:

```ts
    fold.append(foldLabel, foldTrack)
    wave.append(canvas, ph, fold)
```

replace with:

```ts
    fold.append(foldLabel, foldTrack)
    // the radio readout (sssketch spec 2026-10-03-radio-readout-design section 2): what the row was
    // picked as and how long it has played, small and dim over the waveform's top left; at its
    // bottom right, near the buttons, the gesture flash and `next · filter in` on the row that is due
    const info = h('span', 'info')
    info.setAttribute('aria-hidden', 'true')
    info.hidden = true
    const cue = h('div', 'cue')
    cue.setAttribute('aria-hidden', 'true')
    const flash = h('span', 'flash')
    flash.hidden = true
    const nextNote = h('span', 'next-note')
    nextNote.hidden = true
    cue.append(flash, nextNote)
    wave.append(canvas, ph, fold, info, cue)
```

In `/Users/nickel/Claudecode/ell.ing/radio/src/ui/full.ts` (5 of 10), find:

```ts
    const r: RowEls = { el, wave, canvas, ph, fold, foldLabel, foldDot, mute, solo, skip, like, dislike, row: null, drawn: '' }
```

replace with:

```ts
    const r: RowEls = { el, wave, canvas, ph, fold, foldLabel, foldDot, info, nextNote, flash, mute, solo, skip, like, dislike, row: null, drawn: '' }
```

In `/Users/nickel/Claudecode/ell.ing/radio/src/ui/full.ts` (6 of 10), find:

```ts
  const foldStatus = h('span', 'fold-status')
  foldStatus.hidden = true
  foldGrp.append(folded.wrap, clash.wrap, seed, newSeed, foldStatus)
```

replace with:

```ts
  const foldStatus = h('span', 'fold-status')
  foldStatus.hidden = true
  status.append(statusLine, ruler, foldStatus)
  foldGrp.append(folded.wrap, clash.wrap, seed, newSeed)
```

In `/Users/nickel/Claudecode/ell.ing/radio/src/ui/full.ts` (7 of 10), find:

```ts
      foldStatus.hidden = model.foldStatus === null
      if (foldStatus.textContent !== (model.foldStatus ?? '')) foldStatus.textContent = model.foldStatus ?? ''
```

replace with:

```ts
      foldStatus.hidden = model.foldStatus === null
      if (foldStatus.textContent !== (model.foldStatus ?? '')) foldStatus.textContent = model.foldStatus ?? ''
      const st = model.status
      statusLine.hidden = !st || st.line === ''
      if (statusLine.textContent !== (st?.line ?? '')) statusLine.textContent = st?.line ?? ''
      ruler.hidden = !st || st.ruler.ticks === 0
      if (st) {
        while (rulerTicks.children.length < st.ruler.ticks) rulerTicks.append(h('span'))
        while (rulerTicks.children.length > st.ruler.ticks) rulerTicks.lastElementChild!.remove()
        for (let i = 0; i < rulerTicks.children.length; i++) rulerTicks.children[i].classList.toggle('on', i < st.ruler.filled)
        if (rulerEnd.textContent !== (st.ruler.end ?? '')) rulerEnd.textContent = st.ruler.end ?? ''
      }
      status.hidden = statusLine.hidden && ruler.hidden && foldStatus.hidden
```

In `/Users/nickel/Claudecode/ell.ing/radio/src/ui/full.ts` (8 of 10), find:

```ts
        if (row.fold !== null && r.foldLabel.textContent !== row.fold) r.foldLabel.textContent = row.fold
        draw(r)
```

replace with:

```ts
        if (row.fold !== null && r.foldLabel.textContent !== row.fold) r.foldLabel.textContent = row.fold
        const ro = row.readout
        const info = ro ? [ro.label, ro.age].filter(Boolean).join(' · ') : ''
        r.info.hidden = info === ''
        if (r.info.textContent !== info) r.info.textContent = info
        r.nextNote.hidden = !ro?.next
        if (r.nextNote.textContent !== (ro?.next ?? '')) r.nextNote.textContent = ro?.next ?? ''
        draw(r)
```

In `/Users/nickel/Claudecode/ell.ing/radio/src/ui/full.ts` (9 of 10), find:

```ts
    frame(pct, b, foldDots) {
```

replace with:

```ts
    frame(pct, b, foldDots, flashes) {
```

In `/Users/nickel/Claudecode/ell.ing/radio/src/ui/full.ts` (10 of 10), find:

```ts
        if (dot !== undefined) r.foldDot.style.left = `${(dot * 100).toFixed(2)}%`
```

replace with:

```ts
        if (dot !== undefined) r.foldDot.style.left = `${(dot * 100).toFixed(2)}%`
        const f = flashes?.get(slot)
        r.flash.hidden = f === undefined
        if (f !== undefined) {
          if (r.flash.textContent !== f.word) r.flash.textContent = f.word
          r.flash.style.opacity = f.opacity.toFixed(3)
        }
```

In `/Users/nickel/Claudecode/ell.ing/radio/src/ui/full.css` (1 of 1), find:

```css
.full .fold-status[hidden] { display: none; }
```

replace with:

```css
.full .fold-status[hidden] { display: none; }
/* the radio readout (sssketch spec 2026-10-03-radio-readout-design section 2, full.ts). The lines
   between the corners: the status line, which wraps rather than running off a phone; under it the
   phrase ruler, a 1px line of one tick per bar, the bars played in ink, the end label at its right;
   then fold mode's status line, on its own line, still cut with an ellipsis. */
.full .status { flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; align-items: center; gap: 3px; padding: 8px 8px 0; color: var(--mid); text-align: center; }
.full .status[hidden], .full .status-line[hidden], .full .ruler[hidden] { display: none; }
.full .status-line { max-width: 100%; white-space: normal; overflow-wrap: anywhere; }
.full .ruler { display: flex; align-items: center; gap: 6px; width: 100%; max-width: 320px; }
.full .ruler-ticks { flex: 1; display: flex; gap: 1px; height: 1px; }
.full .ruler-ticks span { flex: 1; background: var(--faint); }
.full .ruler-ticks span.on { background: var(--ink); }
.full .ruler-end { font-size: 9px; line-height: 1; white-space: nowrap; }
/* on a row: the label and age small and dim over the waveform's top left, one line, ellipsized
   short of the fold readout; the flash and `next` at its bottom right, near the buttons */
.full .info { position: absolute; top: 2px; left: 4px; right: 52px; color: var(--mid); font-size: 9px; line-height: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; pointer-events: none; }
.full .cue { position: absolute; bottom: 2px; right: 4px; display: flex; gap: 6px; color: var(--mid); font-size: 9px; line-height: 1; white-space: nowrap; pointer-events: none; }
.full .flash { color: var(--ink); }
.full .info[hidden], .full .flash[hidden], .full .next-note[hidden] { display: none; }
/* a phone: the readout's lines go under the corners, the screen's whole width less the gutters */
@media (max-width: 600px) {
  .full .top { flex-wrap: wrap; }
  .full .status { order: 3; flex-basis: 100%; padding: 2px 8px 0; }
}
```

In `/Users/nickel/Claudecode/ell.ing/radio/src/main.ts` (1 of 2), find:

```ts
  foldDots,
```

replace with:

```ts
  flashes,
  foldDots,
```

In `/Users/nickel/Claudecode/ell.ing/radio/src/main.ts` (2 of 2), find:

```ts
      full.frame(playing ? sweepPct(lap, pos) : null, breath(lap, pos, playing), foldDots(v, pos))
```

replace with:

```ts
      full.frame(playing ? sweepPct(lap, pos) : null, breath(lap, pos, playing), foldDots(v, pos), flashes(v))
```


- [ ] **Step 4: Run the tests, the typecheck and the build**

Run: `cd /Users/nickel/Claudecode/ell.ing/radio && npx vitest run src/ui src/radio && npm run typecheck && npx vite build`
Expected: all pass (366 tests in those folders); typecheck prints nothing; the build ends `✓ built`. (Do not deploy the build.)

- [ ] **Step 5: Commit**

```bash
cd /Users/nickel/Claudecode/ell.ing/radio
git add src/ui/full.ts src/ui/full.css src/main.ts src/ui/fullModel.test.ts
git commit -F - <<'EOF'
full mode: the radio readout drawn -- the status line and phrase ruler between the top corners (their own line on a phone), fold's status line moved beneath them; on each row its label and age over the waveform's top left, the gesture flash fading in and out over a bar and next at its bottom right

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01KK8TyKjVKvWU8ZjQCk3ozz
EOF
```

---

## Task 6: sssketch, the readout's state and the radio bar (DiscoverPanel.tsx)

The panel already re-renders at the position rate, and its radio clock effect writes `radioChangeWait` in a microtask every tick. This task adds, in that same microtask: the flash log (`radioFlashTick`, read off `radioGestureRef`, `radioTurnaroundRef` and `radioThrowRef` by armId, so none of the seven places that arm a gesture changes), then `setRadioReadoutNow(radioReadoutFrom(...))`. The readout's own clock (`radioPlayRef`: laps and bars played since radio started) advances where the effect sees a wrap; `commitSlotPick` (the one place a row's stem is replaced) records the lap for the row's age. Start and stop reset it all. The radio bar draws the status line and ruler before fold's status line.

**Files:**
- Modify: `/Users/nickel/Claudecode/sssketch/src/renderer/src/components/DiscoverPanel.tsx`

- [ ] **Step 1: The logic**

In `/Users/nickel/Claudecode/sssketch/src/renderer/src/components/DiscoverPanel.tsx` (1 of 8), find:

```tsx
  type RadioFoldStatusRow
} from '@shared/radioFoldStatus'
```

replace with:

```tsx
  type RadioFoldStatusRow
} from '@shared/radioFoldStatus'
import {
  RADIO_THROW_WORD,
  pruneRadioFlashes,
  radioFlashShown,
  radioGestureFlashWord,
  radioReadout,
  radioReadoutArc,
  radioReadoutBars,
  type RadioFlash,
  type RadioReadout
} from '@shared/radioReadout'
```

In `/Users/nickel/Claudecode/sssketch/src/renderer/src/components/DiscoverPanel.tsx` (2 of 8), find:

```tsx
  const radioThrowClearOwedRef = useRef(false)
```

replace with:

```tsx
  const radioThrowClearOwedRef = useRef(false)
  // THE RADIO READOUT (docs/superpowers/specs/2026-10-03-radio-readout-design.md, @shared/
  // radioReadout): its own clock of laps and bars played since radio started (advanced at every
  // wrap the clock effect sees), the lap each row's stem landed on (commitSlotPick: the row's
  // age), the gesture flash log on that clock (radioFlashTick) and the armIds it has logged, and
  // the readout itself -- state, as it is drawn; written once per tick (radioReadoutFrom).
  const radioPlayRef = useRef<{ lap: number; startBars: number }>({ lap: 0, startBars: 0 })
  const radioRowSinceRef = useRef<Map<string, number>>(new Map())
  const radioFlashLogRef = useRef<RadioFlash[]>([])
  const radioFlashSeenRef = useRef<Set<string>>(new Set())
  const [radioReadoutNow, setRadioReadoutNow] = useState<RadioReadout | null>(null)
```

In `/Users/nickel/Claudecode/sssketch/src/renderer/src/components/DiscoverPanel.tsx` (3 of 8), find:

```tsx
    radioThrowRef.current = step.state
    if (step.change === 'armed') scheduleSyncPreviewToEngine(previewingSlotIdsRef.current)
    else if (step.change === 'ended') clearRadioThrowCurve()
  }
```

replace with:

```tsx
    radioThrowRef.current = step.state
    if (step.change === 'armed') scheduleSyncPreviewToEngine(previewingSlotIdsRef.current)
    else if (step.change === 'ended') clearRadioThrowCurve()
  }
  /** The readout's clock and logs back to nothing: radio starting or stopping. */
  function resetRadioReadout(): void {
    radioPlayRef.current = { lap: 0, startBars: 0 }
    radioRowSinceRef.current = new Map()
    radioFlashLogRef.current = []
    radioFlashSeenRef.current = new Set()
    setRadioReadoutNow(null)
  }
  /** THE GESTURE FLASH (spec 2026-10-03-radio-readout-design section 1). Each gesture armed into
   * the preview project goes in the log once, with the bar it starts SOUNDING at on the readout's
   * clock (radioPlayRef: bars played): a lead-in (hole, riser) over the beats before the wrap of
   * the lap it is armed in; an arrival (filter in, bloom, duck) from the top of the lap it is armed
   * at; a turnaround's or a turn's move, on each row it plays on, over its last beats; a throw from
   * its own start. Read off what is armed, every tick, rather than at each of the places that arm
   * one. A word not sounding yet whose gesture has been taken back goes with it. */
  function radioFlashTick(pos: number, loopBars: number): void {
    const lapStart = radioPlayRef.current.startBars
    const now = lapStart + pos
    const seen = radioFlashSeenRef.current
    const live = new Set<string>()
    const log = [...radioFlashLogRef.current]
    for (const g of radioGestureRef.current) {
      live.add(g.armId)
      const word = radioGestureFlashWord(g.kind)
      if (seen.has(g.armId) || word === null) continue
      const leads = g.kind !== 'drop-out' && radioGestureLeadsChange(g.kind)
      log.push({
        rowId: g.slotId,
        word,
        at: lapStart + (leads ? loopBars - g.beats / 4 : 0),
        key: g.armId
      })
    }
    const ta = radioTurnaroundRef.current
    if (ta !== null) {
      live.add(ta.armId)
      if (!seen.has(ta.armId)) {
        const at = lapStart + loopBars - ta.plan.beats / 4
        const word = TURNAROUND_MOVE_LABEL[ta.plan.move]
        for (const r of ta.plan.rows) log.push({ rowId: r.rowId, word, at, key: ta.armId })
      }
    }
    const throws = radioThrowRef.current
    if (throws.armed !== null) {
      const key = `throw@${throws.armed.startBars}`
      live.add(key)
      if (!seen.has(key)) {
        log.push({
          rowId: throws.armed.slotId,
          word: RADIO_THROW_WORD,
          at: now + (throws.armed.startBars - throws.elapsedBars),
          key
        })
      }
    }
    radioFlashLogRef.current = pruneRadioFlashes(log, now, 1, live)
    radioFlashSeenRef.current = live
  }
  /** What the readout says now, from radio's refs (the clock tick's microtask only):
   * `barsUntilChange` is the rows' own wait (radioChangeWait). */
  function radioReadoutFrom(
    pos: number,
    loopBars: number,
    barsUntilChange: number | null
  ): RadioReadout {
    const led = radioLedChangeRef.current
    const pending = radioPendingRef.current
    let nextChange: Parameters<typeof radioReadout>[0]['nextChange'] = null
    if (led !== null) {
      // a held change lands with its arrival, or the lead-in armed on its row, or as a cut
      const lead = radioGestureRef.current.find(
        (g) => g.slotId === led.slotId && g.kind !== 'drop-out' && radioGestureLeadsChange(g.kind)
      )
      const leadKind = lead !== undefined && lead.kind !== 'drop-out' ? lead.kind : null
      nextChange = {
        rowId: led.slotId,
        kind: led.arrival?.kind ?? leadKind ?? 'cut',
        barsAway: barsUntilChange
      }
    } else if (pending !== null) {
      nextChange = { rowId: pending.slotId, kind: null, barsAway: barsUntilChange }
    }
    const turnWaiting = radioTurnPendingRef.current
    const armed = radioTurnaroundRef.current
    const rows = slotsRef.current
    const lap = radioPlayRef.current.lap
    const now = radioPlayRef.current.startBars + pos
    return radioReadout({
      bars: radioReadoutBars(
        radioClockRef.current?.turnaroundLap,
        pos,
        loopBars,
        radioSettings.phraseBars
      ),
      nextChange,
      armedTurnaround:
        turnWaiting !== null
          ? { move: turnWaiting.move ?? null, isTurn: true }
          : armed !== null
            ? { move: armed.plan.move, isTurn: armed.turn !== null }
            : null,
      arc: radioReadoutArc(
        densityLegRef.current,
        rows.length,
        radioDensityOf(radioSettings) === 'arc'
      ),
      rows: rows.map((s) => ({
        rowId: s.id,
        kinds: s.kinds,
        traits: s.candidate?.traitPercentiles ?? null,
        author: s.candidate?.creatorUserName ?? null,
        laps: lap - (radioRowSinceRef.current.get(s.id) ?? 0) + 1,
        flash: radioFlashShown(radioFlashLogRef.current, s.id, now, 1)
      }))
    })
  }
```

In `/Users/nickel/Claudecode/sssketch/src/renderer/src/components/DiscoverPanel.tsx` (4 of 8), find:

```tsx
    radioClockRef.current = step.clock
    // The bar a change detected on this tick was aiming at, so
```

replace with:

```tsx
    radioClockRef.current = step.clock
    // The readout's clock (radioPlayRef): a lap more, and the bars of the lap that ended.
    if (step.wrapped) {
      radioPlayRef.current = {
        lap: radioPlayRef.current.lap + 1,
        startBars: radioPlayRef.current.startBars + loopBars
      }
    }
    // The bar a change detected on this tick was aiming at, so
```

In `/Users/nickel/Claudecode/sssketch/src/renderer/src/components/DiscoverPanel.tsx` (5 of 8), find:

```tsx
      setRadioProgress(progress)
      setRadioChangeWait(changeWait)
```

replace with:

```tsx
      setRadioProgress(progress)
      setRadioChangeWait(changeWait)
      // the readout, from this tick: the flash log first, then what it all says
      if (!radioOnRef.current) return
      radioFlashTick(pos, loopBars)
      setRadioReadoutNow(radioReadoutFrom(pos, loopBars, changeWait.barsUntilChange))
```

In `/Users/nickel/Claudecode/sssketch/src/renderer/src/components/DiscoverPanel.tsx` (6 of 8), find:

```tsx
  function commitSlotPick(id: string, pick: SlotPick): void {
```

replace with:

```tsx
  function commitSlotPick(id: string, pick: SlotPick): void {
    // the row's age starts again (the radio readout)
    radioRowSinceRef.current.set(id, radioPlayRef.current.lap)
```

In `/Users/nickel/Claudecode/sssketch/src/renderer/src/components/DiscoverPanel.tsx` (7 of 8), find:

```tsx
    setRadioProgress(0)
    setRadioChangeWait(null)
  }
```

replace with:

```tsx
    setRadioProgress(0)
    setRadioChangeWait(null)
    resetRadioReadout()
  }
```

In `/Users/nickel/Claudecode/sssketch/src/renderer/src/components/DiscoverPanel.tsx` (8 of 8), find:

```tsx
    resetRadioThrows(false)
```

replace with:

```tsx
    resetRadioThrows(false)
    resetRadioReadout()
```


- [ ] **Step 2: The radio bar**

In `/Users/nickel/Claudecode/sssketch/src/renderer/src/components/DiscoverPanel.tsx` (1 of 1), find:

```tsx
        {/* FOLD MODE'S STATUS LINE (v2), while radio runs with fold on: what the folding is
```

replace with:

```tsx
        {/* THE RADIO READOUT (spec 2026-10-03-radio-readout-design section 2), while radio runs:
            where the density arc is heading and what changes next, and under it the phrase ruler
            -- a 1px tick per bar, the bars played brighter, the turnaround armed for the phrase's
            end at its right. Monochrome: chrome. Not a live region: its counts move every bar. */}
        {radioOn && radioReadoutNow !== null && (
          <span
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 3,
              minWidth: 0,
              fontSize: 9,
              color: 'var(--ra-text-3)'
            }}
          >
            {radioReadoutNow.statusLine !== '' && (
              <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {radioReadoutNow.statusLine}
              </span>
            )}
            {radioReadoutNow.ruler.ticks > 0 && (
              <span aria-hidden style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ display: 'flex', gap: 1, width: 160, height: 1 }}>
                  {Array.from({ length: radioReadoutNow.ruler.ticks }, (_, i) => (
                    <span
                      key={i}
                      style={{
                        flex: 1,
                        background:
                          i < radioReadoutNow.ruler.filled ? 'var(--ra-text-3)' : 'var(--ra-border)'
                      }}
                    />
                  ))}
                </span>
                {radioReadoutNow.ruler.end !== null && (
                  <span style={{ whiteSpace: 'nowrap' }}>{radioReadoutNow.ruler.end}</span>
                )}
              </span>
            )}
          </span>
        )}
        {/* FOLD MODE'S STATUS LINE (v2), while radio runs with fold on: what the folding is
```


- [ ] **Step 3: Typecheck, lint, format**

Run: `cd /Users/nickel/Claudecode/sssketch && npm run typecheck && npx eslint src/renderer/src/components/DiscoverPanel.tsx && npx prettier --check src/renderer/src/components/DiscoverPanel.tsx`
Expected: no errors; `All matched files use Prettier code style!` (eslint may print BABEL's "deoptimised the styling" note: that is not an error).

- [ ] **Step 4: Commit**

```bash
cd /Users/nickel/Claudecode/sssketch
git add src/renderer/src/components/DiscoverPanel.tsx
git commit -F - <<'EOF'
discover radio readout: the status line and phrase ruler in the radio bar -- filled each clock tick from radio's refs, with its own clock of laps played (row ages from commitSlotPick) and a gesture flash log read off what is armed (lead-ins before the wrap, arrivals from the top, turnaround moves per row, throws), reset on start and stop

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01KK8TyKjVKvWU8ZjQCk3ozz
EOF
```

---

## Task 7: sssketch, each row's readout (DiscoverPanel.tsx)

Discover rows have no name column (the 110px column holds the kind picker and match meter), so the row's readout goes over its waveform, as the web's does: label and age at the top left, the flash and `next` at the top right, `pointer-events: none` so the gain drag is untouched. Chrome tokens only, no colour, no radius.

**Files:**
- Modify: `/Users/nickel/Claudecode/sssketch/src/renderer/src/components/DiscoverPanel.tsx`

- [ ] **Step 1: Implement**

In `/Users/nickel/Claudecode/sssketch/src/renderer/src/components/DiscoverPanel.tsx` (1 of 6), find:

```tsx
  const radioFoldReadouts = new Map(
```

replace with:

```tsx
  // THE RADIO READOUT on each row (radioReadoutNow), only while radio runs.
  const radioReadoutRows = new Map(
    (radioOn && radioReadoutNow !== null ? radioReadoutNow.rows : []).map((r) => [r.rowId, r])
  )
  const radioFoldReadouts = new Map(
```

In `/Users/nickel/Claudecode/sssketch/src/renderer/src/components/DiscoverPanel.tsx` (2 of 6), find:

```tsx
              foldReadout={radioFoldReadouts.get(slot.id) ?? null}
```

replace with:

```tsx
              foldReadout={radioFoldReadouts.get(slot.id) ?? null}
              radioReadout={radioReadoutRows.get(slot.id) ?? null}
```

In `/Users/nickel/Claudecode/sssketch/src/renderer/src/components/DiscoverPanel.tsx` (3 of 6), find:

```tsx
  foldTrack,
  foldReadout
}: {
```

replace with:

```tsx
  foldTrack,
  foldReadout,
  radioReadout
}: {
```

In `/Users/nickel/Claudecode/sssketch/src/renderer/src/components/DiscoverPanel.tsx` (4 of 6), find:

```tsx
  foldReadout: string | null
}): React.JSX.Element {
```

replace with:

```tsx
  foldReadout: string | null
  /** The radio readout on this row (@shared/radioReadout): what it was picked as, its age,
   * `next` and the gesture flash. Null unless radio runs. */
  radioReadout: RadioReadoutRow | null
}): React.JSX.Element {
```

In `/Users/nickel/Claudecode/sssketch/src/renderer/src/components/DiscoverPanel.tsx` (5 of 6), find:

```tsx
        </div>
        <div style={{ gridColumn: 6 }} />
```

replace with:

```tsx
          {/* THE RADIO READOUT on the row (spec 2026-10-03-radio-readout-design section 2): what
              it was picked as and how long it has played, small and dim over the waveform's top
              left; the gesture flash (in and out over a bar) and `next` at its top right. Never
              in the way of the gain drag. Chrome: monochrome. */}
          {radioReadout !== null && (
            <div
              aria-hidden
              style={{
                position: 'absolute',
                inset: 0,
                pointerEvents: 'none',
                fontSize: 8,
                lineHeight: '10px',
                color: 'var(--ra-text-3)'
              }}
            >
              <span
                style={{
                  position: 'absolute',
                  top: 1,
                  left: 3,
                  right: 90,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis'
                }}
              >
                {[radioReadout.label, radioReadout.age].filter(Boolean).join(' · ')}
              </span>
              <span
                style={{
                  position: 'absolute',
                  top: 1,
                  right: 3,
                  display: 'flex',
                  gap: 6,
                  whiteSpace: 'nowrap'
                }}
              >
                {radioReadout.flash !== null && (
                  <span style={{ opacity: radioFlashOpacity(radioReadout.flash.t) }}>
                    {radioReadout.flash.word}
                  </span>
                )}
                {radioReadout.nextLabel !== null && <span>{radioReadout.nextLabel}</span>}
              </span>
            </div>
          )}
        </div>
        <div style={{ gridColumn: 6 }} />
```

In `/Users/nickel/Claudecode/sssketch/src/renderer/src/components/DiscoverPanel.tsx` (6 of 6), find:

```tsx
  type RadioFlash,
  type RadioReadout
} from '@shared/radioReadout'
```

replace with:

```tsx
  radioFlashOpacity,
  type RadioFlash,
  type RadioReadout,
  type RadioReadoutRow
} from '@shared/radioReadout'
```


- [ ] **Step 2: Typecheck, lint, format, tests**

Run: `cd /Users/nickel/Claudecode/sssketch && npm run typecheck && npx eslint src/renderer/src/components/DiscoverPanel.tsx && npx prettier --check src/renderer/src/components/DiscoverPanel.tsx && npx vitest run src/shared/radioReadout.test.ts`
Expected: no errors; prettier clean; 23 tests pass.

- [ ] **Step 3: Commit**

```bash
cd /Users/nickel/Claudecode/sssketch
git add src/renderer/src/components/DiscoverPanel.tsx
git commit -F - <<'EOF'
discover radio readout on each row: what it was picked as and its age over the waveform's top left, the gesture flash (in and out over a bar) and next at its top right, only while radio runs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01KK8TyKjVKvWU8ZjQCk3ozz
EOF
```

---

## Task 8: verification, then Elling's walkthrough

- [ ] **Step 1: sssketch, everything**

Run: `cd /Users/nickel/Claudecode/sssketch && npm test && npm run typecheck && npm run lint`
Expected: every test passes (if engine-spawning tests fail, check the coreaudiod thread leak first: `ps -M $(pgrep coreaudiod) | wc -l`; see memory `coreaudiod_thread_leak.md`; that is the machine, not this change); typecheck and lint clean.

- [ ] **Step 2: the web radio, everything**

Run: `cd /Users/nickel/Claudecode/ell.ing/radio && npm test && npm run typecheck && npx vite build`
Expected: every test passes; typecheck clean; `✓ built`. Do not deploy or upload.

- [ ] **Step 3: grep for what must not be there**

Run: `cd /Users/nickel/Claudecode && grep -n "aria-live" ell.ing/radio/src/ui/full.ts; grep -n "borderRadius" sssketch/src/renderer/src/components/DiscoverPanel.tsx | grep -i readout`
Expected: no output from either.

- [ ] **Step 4: Hand over for Elling's walkthrough (no agent can see or hear the radios)**

Tell Elling, plainly, that nothing below has been seen or heard by an agent, and ask him to check:

1. **sssketch** (`cd /Users/nickel/Claudecode/sssketch && npm run dev`; no engine rebuild needed), Discover, radio on, with the density arc on and turnarounds on:
   - the status line matches what happens (`building ↑ 3 → 5` while rows are being added, `thinning ↓` while they go, `steady · 4 rows` between);
   - `next` lands on the row that changes, with the arrival it names, and the bar count reaches it;
   - the ruler fills one tick per bar and empties at the phrase's top; its end label names the turnaround that then plays (and `turn: wash` after pressing a turn chip);
   - each flash (`hole`, `filter in`, `wash`, `throw`, …) coincides with the sound, not a lap early;
   - each row's label (`drums · bright — elling`) and age (`1 lap` after a change, counting up).
2. **The web radio** (`cd /Users/nickel/Claudecode/ell.ing/radio && npm run dev`, then the printed local URL; full mode): the same five checks, plus fold on: fold's status line on its own line under the radio's.
3. **Mobile**: `npx vite --host` in the web radio, open the printed network URL on his phone, full mode: the status block sits on its own line under the corners, the status line wraps, nothing runs off either edge, the row labels ellipsize.

Record what he reports; fix anything that is off in a follow-up task.

---

## Spec points resolved

Choices the spec left open, settled here (Elling can overrule any in the walkthrough):

1. **Flash entry shape.** `RadioFlash` is `{ rowId, word, at, key }`. `at` is on the runtime's own clock: AudioContext seconds on the web (window: one bar, `240 / bpm` s), bars played since radio started in sssketch (window: 1 bar). `key` names what armed it (`<slot>@<wrap>`, `turnaround@<wrap>`, `throw@<time>` on the web; the gesture's or turnaround's `armId`, `throw@<startBars>` in sssketch) so a gesture taken back before it sounds takes its word with it.
2. **Status line, next change.** `next: row N → <arrival> · K bars`. Row N is the row's place in the list (1-based). While the pick is only armed (no transition drawn yet) the arrival is left out (`next: row 2 · 6 bars`); `next: soon` (the whole part) when the bar is not known. Bars round up, never below `1 bar`. A row not on the bed yet reads `a new row`.
3. **Arc count.** The count shown and used for the direction is the arc's own (rows on the bed: the web's `s.rows.length`, sssketch's `slots.length`), as `turnaroundArc` already reads it; target is the leg's. With the arc on and no leg yet, `steady`.
4. **Ruler.** The phrase is the turnaround's (`turnaroundPhraseLaps`, 16 bars when `phraseBars` is 0), counted from the radio clock's `turnaroundLap`, so the end label belongs to the phrase end the ruler is filling toward. `filled` is whole bars played. A phrase end's turnaround is rolled at the start of the phrase's last lap, so its label appears then; a turn shows from the press (`turn` until its move is rolled, then `turn: wash`).
5. **Row label words.** Raw kind words (`RADIO_KIND_WORD`: `bassHeavy` reads `heavy`), not Discover's playful picker names. The trait is the one the slot was picked for, else the stem's strongest trait percentile at or above 0.6 (`RADIO_TRAIT_DOMINANT`); below that a mask row reads its kind alone. The stem-type fallback is fed on the web from the record's instrument mask; sssketch passes none (a radio slot always has kinds).
6. **Author.** sssketch: `candidate.creatorUserName`. The web radio has no creator in its index (every stem is Elling's), so it passes none and shows no author.
7. **Age.** Laps the row's stem has played, the one playing included (`1 lap` on its first). Web: `RadioRow.laps`, 1 at `commit`, +1 at each wrap. sssketch: the lap `commitSlotPick` ran at (`radioRowSinceRef`); a row untouched since radio started counts from radio's start.
8. **Flash words and timing.** Lead-ins (`hole`, `riser`) start `beats` before their wrap; arrivals (`filter in`, `bloom`, `duck`) at the wrap; turnaround moves (`drop`, `low drop`, `stop`, `wash`, `lift`, `dip`, via `TURNAROUND_MOVE_LABEL`) on each row in the plan from `plan.beats` before the top; throws at their start as `throw`. A cut and the arc's exit drop-out flash nothing (not in the spec's list). A turnaround riser has no rows, so no word. A duck's word goes on the arriving row. The fade is `sin(πt)` over the bar.
9. **Where sssketch reads gestures.** Rather than instrumenting each arming site, `radioFlashTick` diffs what is armed (`radioGestureRef`, `radioTurnaroundRef`, `radioThrowRef`) by key every tick and places each new one by the rules in 8, relative to the lap it is armed in.
10. **Web layout.** The status block is between the top corners (its own full-width line on a phone); order: status line, ruler, fold status. The fold status line moved there from the fold group. The status line wraps; the fold status keeps its ellipsis. On a row: label and age top left, fold readout top right (unchanged), flash and `next` bottom right.
11. **sssketch layout.** Status line (ellipsized, a desktop bar) and a 160px ruler before fold's status line in the radio bar. Rows have no name column, so the row readout is an overlay on the waveform: label and age top left, flash and `next` top right.
12. **Not live regions.** None of the readout's text is an ARIA live region (its counts move every bar), as with fold's status line; the row overlays are `aria-hidden`.
13. **Refresh rate.** The web view's readout is computed from the last controller tick (~30 Hz), sssketch's on each position tick; the flash's opacity steps at that rate, which is plenty for a one-bar fade.
