# sssketch Radio View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** While radio runs, Discover looks like the web radio's full mode in sssketch's own look:
1. **A top line:** play/stop and `radio` (with its interval line) on the left; the readout's status
   line, the phrase ruler and fold's status line in the middle; undo/redo on the right. Sticky.
2. **Rows as two lines:** a button line (`m s skip 👍 👎 hook dig`, then any stem, nearby jam,
   duplicate, kinds and meter, lock, remove) above a full-width waveform carrying the web's plates
   (label + tail top left, cue bottom right with the away hook's name bottom left, fold top
   right). Holding is a 2px bar at the row's left edge.
3. **An always-visible strip** under the rows (sticky bottom) holding EVERY radio setting in six
   captioned groups: play, picks, shape, fold, sound, mix.
4. **The running radio menu goes.** The start prompt stays (`RadioStartPrompt`).
5. **The web's notification vocabulary:** the strip's `skip` flickers once per landing, and the
   row flashes `no fave fits` / `no near fits`.

With radio off, Discover is exactly what it is today. Every control does what it does today and
commits when it does today; only placement and presentation change. The phone is untouched.

**Spec:** `docs/superpowers/specs/2026-10-03-sssketch-radio-view-design.md` (c3ff2dd, plus this
plan's commit: the "Updated for the tree as of 2026-10-04" section, the corrections in place, and
the Decided section that answers its three open questions). Read it first. Its sections 1.2, 1.3,
2 and 6 are the review checklist.

**Elling's answers (2026-10-04):** keep the start prompt; no whole-mix `hold` now; the strip's
saturation, pump and echo edit the open project's sound (undoable, marks it unsaved).

**Architecture:**
- **Pure rules in `src/shared/`, TDD:** `radioStripModel.ts` (the groups, their controls, the
  visibility rules, the patches, the hint tooltips; a test that fails if any radio setting lacks a
  strip control), `radioRowPlates.ts` (the plates' words), `radioLanding.ts` (the flicker's rule).
- **Rendering moves out of `DiscoverPanel.tsx`; state stays in it.** New components receive values
  and callbacks only: `DiscoverSlotRow.tsx` (moved verbatim first), `RadioRowPlates.tsx`,
  `RadioControls.tsx`, `RadioStrip.tsx`, `RadioTopLine.tsx`, `RadioStartPrompt.tsx`; plus two
  non-component modules for what the panel and the row share (`discoverCandidateStem.ts`,
  `discoverRowGrid.ts`).
- **One guarantee:** the rows wrapper (`rowsRef`) and the `slots.map` of `DiscoverSlotRow` stay the
  same elements at the same place in the tree in both modes, so switching radio on or off
  re-renders every row and never remounts one.

**Tech Stack:** TypeScript, React 19, Electron (electron-vite), vitest (node environment, no DOM),
`@phosphor-icons/react`.

**Repo:** sssketch only (`/Users/nickel/Claudecode/sssketch`). ell.ing/radio is the reference
(`src/ui/full.ts`, `full.css`, `fullModel.ts` at 49b824d) and is not changed. Base: `master` at
this plan's commit.

**Branch:** `radio-view` (`git switch -c radio-view`).

**Commits:** every commit message ends with exactly these two lines, after a blank line:

```
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01KK8TyKjVKvWU8ZjQCk3ozz
```

Commit each task's own files only (`git commit --only <paths>` or `git add <paths>`), never
`git add -A`: other agents share this working tree (`native-engine/.cache/` is untracked and not
ours).

**Before you start:**
- `git status --short`: note other agents' files and leave them alone.
- `npm test` (green except the machine-dependent engine-spawn tests: memory
  `coreaudiod_thread_leak`), `npm run typecheck`, `npm run lint` (clean at 209878f; eslint prints a
  harmless Babel "deoptimised the styling" note for `DiscoverPanel.tsx`).
- **The code** in this plan was written against sssketch `209878f`. If `DiscoverPanel.tsx` has
  moved on (it changes daily), make the same edits by hand, anchored on the quoted context and
  function names, never on line numbers. Line numbers below are a guide to 209878f.

**No agent can run the app, see it, hear it or click it.** Every UI task is verified by
typecheck, lint, the shared tests, grep checks written into the task, and Elling's walkthrough
(end of plan). Say so in every commit message that touches the UI ("unseen by any agent").

---

## How this plan's code was checked

Planning scratchpad: `/private/tmp/claude-501/-Users-nickel-Claudecode-sssketch/16705ad5-406f-4f11-81e4-e91aab27bbc8/scratchpad/radioview/`,
a copy of sssketch's `src/shared` at 209878f with the three new modules and their tests added.

- **Tasks 1-3 (the shared modules)** were applied in the copy, and every code block for them below
  is the copy's file, verbatim, after `prettier` with the repo's `.prettierrc.yaml`:
  - `tsc` with `@electron-toolkit/tsconfig/tsconfig.web.json` (strict, `noUnusedLocals`) over the
    six files: clean;
  - `vitest run` on the three test files: **3 files, 29 tests passed**; `radioReadout.test.ts`
    and `soundPanelModel.test.ts` unchanged and green (47);
  - **the "nothing hidden" test was mutation-checked:** with the `builds` control's `sets`
    emptied, it fails with `no strip control sets sizedBuilds` (and the patch test fails too).
- **Not compiled, written as precise instructions:** the UI tasks (4-13). `DiscoverPanel.tsx` is
  14,211 lines and changes daily; every instruction is anchored on a function name or quoted
  context.

## Decisions made in planning (the spec's are in its Decided section and its 2026-10-04 update)

1. **Flat files, no subfolders.** `src/renderer/src/components/` has none; the spec's
   `components/discover/radio/` paths are dropped (spec updated).
2. **Two small non-component modules** keep React refresh's `only-export-components` rule quiet
   and break the would-be import cycle:
   - `components/discoverCandidateStem.ts`: `ResolvedCandidateStem`, `resolveCandidateStem`,
     `peekResolvedCandidateStem` and their two caches (the panel and the row both use them).
     `DiscoverPanel.tsx` re-exports the type, so `audio/discoverSeed.ts` keeps its import.
   - `components/discoverRowGrid.ts`: `DISCOVER_WAVEFORM_HEIGHT`, the grid template and
     `discoverRowGridColumns`, the column gap and the waveform column constants (the panel's
     playhead overlay and the row both read them).
3. **The row keeps ONE implementation of every button** (spec section 3): Task 5 names each of the
   row's parts as a local constant (pure refactor, grid only); Task 7 assembles the same constants
   into the radio layout. `RowIconButton`'s `gridColumn` becomes optional.
4. **The radio row's kinds block is one line** (label, then the meter), so the button line stays
   20px tall and rows stay one height.
5. **The away hook's name** moves to the waveform's bottom left, sharing one bar with the cue (the
   web's layout since 22de927). It is the one plate with `pointer-events: auto`.
6. **The playhead overlay keeps its three elements in both modes** (outer box, waveform cell,
   line): only their styles switch (a grid in grid mode; an absolute box inset 6px each side in
   radio mode). The line's element never remounts, so `sweepLineRef` stays attached; the sweep
   layout effect also gains `radioOn` in its deps so the line is placed on the switch even while
   paused.
7. **Rows are capped at 1200px and centred in radio mode** by a style on the rows wrapper itself
   (same element), so the overlay inside it is capped with it.
8. **The strip lands before the top line** (Tasks 8-9, then 10), so radio's settings are never
   unreachable between commits: until Task 10 the old header (with its chevron and menu) and the
   strip both show while radio runs. Only the artist button is guarded in between (one
   `artistButtonRef`).
9. **Sound group:** saturation, pump and echo are the sound panel's own slider controls
   (`soundPanelModel` ids `saturation.amount`, `pump.depthDb`, `throws.level`) shown as 0..100
   dials (`soundDialPosition` / `soundDialValue`, on the slider's step); a release dispatches
   `SET_SOUND_SETTINGS` with the control's own `patch`, as `SoundSettingsPanel`'s project mode
   does. Their on/off switches stay in the sound panel.
10. **Dials need no blur; range inputs do.** `Dial` is a `div role="slider"`; only `PaceSlider` and
    `FoldSlider` (range `INPUT`s) blur after a pointer release so `t` works at once. `Dial` gains an
    additive `disabled` prop (for level, reverb, filter, res while nothing sounds, and the greyed
    sound dials).
11. **`no near fits` joins `no fave fits`** as a row flash (the web flashes both).
12. **The landing flicker is called from the clock tick's landing branches** (spec section 2,
    corrected): the wrap / held-bar branch (radio's change, waiting manual changes, hook landings,
    arc rows) and the course change's branch. Coalesced by `performance.now()` within 50ms
    (`shouldFlickerLanding`), radio on only.
13. **Reduced motion is scoped to the radio view:** the pending pulse becomes a class
    (`discover-pending`); a `prefers-reduced-motion` rule under `[data-radio-view]` (the rows
    wrapper while radio runs) stops it, and stops the flicker. Radio-off Discover is unchanged
    for everyone.
14. **Focus follows the switch:** `start` in the prompt focuses the top line's `radio`; pressing
    `radio` there (stop) focuses the header's `radio` button that replaces it.
15. **Dead grid branches go last (Task 13):** once the radio layout exists, the grid layout only
    ever renders with radio off, so its role tracks (16-17), fold track (18) and readout overlay
    are dead. They are removed in their own commit, after the walkthrough-critical work.

## File map

**Create (`src/shared/`):**
- `radioStripModel.ts`, `radioStripModel.test.ts` (Task 1);
- `radioRowPlates.ts`, `radioRowPlates.test.ts` (Task 2);
- `radioLanding.ts`, `radioLanding.test.ts` (Task 3).

**Create (`src/renderer/src/components/`):**
- `discoverCandidateStem.ts`, `discoverRowGrid.ts`, `DiscoverSlotRow.tsx` (Task 4);
- `RadioControls.tsx` (Task 6);
- `RadioRowPlates.tsx` (Task 7);
- `RadioStrip.tsx` (Task 8, sound group Task 9);
- `RadioTopLine.tsx` (Task 10);
- `RadioStartPrompt.tsx` (Task 11).

**Modify:**
- `components/DiscoverPanel.tsx` (Tasks 4, 5, 7-13);
- `components/DiscoverSlotRow.tsx` (Tasks 5, 7, 12, 13);
- `components/Dial.tsx` (Task 6: `disabled`);
- `components/DiscoverRadioMenu.tsx` (Task 6: imports the moved sliders; **deleted** in Task 11);
- `components/SoundSettingsPanel.tsx`, `components/DiscoverArtistPicker.tsx` (Task 11: comments
  that name `DiscoverRadioMenu`).

## Task graph

```
T1 strip model ─────────────────────────────────┐
T2 row plates ─────────────────┐                │
T3 landing rule ───────────────┼────────────────┼───────────────────────┐
T4 move row (pure) ─> T5 name the row's parts ─┴> T7 radio rows ─> T8 strip ─> T9 sound ─> T10 top line ─> T11 start prompt, menu gone ─> T12 notifications ─> T13 grid cleanup ─> T14 verify, review, handoff
T6 radio controls, Dial.disabled ──────────────────────────────────┘ (before T8)
```

- **Parallel-safe now (new files, inert until something imports them):** T1, T2, T3 with each
  other and with T4-T6.
- **T6 is parallel-safe with T4 and T5** (it touches `Dial.tsx`, `DiscoverRadioMenu.tsx` and a new
  file, never `DiscoverPanel.tsx` or `DiscoverSlotRow.tsx`).
- **Strictly in order:** T4 → T5 → T7 → T8 → T9 → T10 → T11 → T12 → T13 (all edit
  `DiscoverPanel.tsx`, and T5/T7/T12/T13 `DiscoverSlotRow.tsx`). T7 needs T2; T8 needs T1 and T6;
  T12 needs T3.
- **The riskiest step is T7** (rows must not remount; the playhead, breath and fold dots are
  written outside React). T11 carries the second risk (Escape in the fold seed field; it lands in
  T6 and is exercised from T8 on).

**Other agents' work:** check `git log` before each `DiscoverPanel.tsx` task; rebase onto their
commits and re-anchor by function name.

---

## Phase 1: the pure rules (TDD)

### Task 1: The strip model (`radioStripModel.ts`)

**Parallel-safe** (new files). **Depends on:** nothing.

**Files:**
- Create: `/Users/nickel/Claudecode/sssketch/src/shared/radioStripModel.test.ts`
- Create: `/Users/nickel/Claudecode/sssketch/src/shared/radioStripModel.ts`

- [ ] **Step 1: Write the failing test.** Create `src/shared/radioStripModel.test.ts`:

```ts
// The radio view's strip (spec 2026-10-03-sssketch-radio-view-design sections 1.3 and 4):
// radioStripModel.ts. The first test is the one that matters most: a radio setting added without
// a strip control fails it.
import { describe, expect, it } from 'vitest'
import {
  RADIO_CHANNEL_OPTIONS,
  RADIO_STRIP_GROUPS,
  RADIO_STRIP_HINTS,
  RADIO_STRIP_LEGACY_KEYS,
  radioStripModel,
  soundDialPosition,
  soundDialValue,
  type RadioSettingKey,
  type RadioStripContext,
  type RadioStripControl,
  type RadioStripGroup
} from './radioStripModel'
import {
  DEFAULT_RADIO_SETTINGS,
  RADIO_DENSITY_OPTIONS,
  RADIO_LOOP_END_OPTIONS,
  RADIO_PHRASE_OPTIONS,
  RADIO_TURNOVER_OPTIONS,
  normalizeRadioSettings,
  type RadioSettings
} from './radioSchedule'
import {
  RADIO_TURNAROUNDS_OPTIONS,
  TURNAROUND_DEPTH_OPTIONS,
  TURNAROUND_FAMILIES
} from './radioTurnaround'
import { RADIO_TRANSITIONS_OPTIONS } from './radioTransition'
import { DEFAULT_SOUND_SETTINGS, normalizeSoundSettings } from './radioSound'
import { soundPanelModel, type SoundSliderControl } from './soundPanelModel'

const CTX: RadioStripContext = {
  artistMode: false,
  hasUsername: true,
  sound: DEFAULT_SOUND_SETTINGS,
  sounding: true
}

function settings(over: Partial<RadioSettings> = {}): RadioSettings {
  return { ...DEFAULT_RADIO_SETTINGS, ...over }
}

function controls(groups: RadioStripGroup[]): RadioStripControl[] {
  return groups.flatMap((g) => g.controls)
}

function control(groups: RadioStripGroup[], id: string): RadioStripControl | undefined {
  return controls(groups).find((c) => c.id === id)
}

function ids(groups: RadioStripGroup[], group: string): string[] {
  return groups.find((g) => g.id === group)?.controls.map((c) => c.id) ?? []
}

/** Every state the visibility rules turn on: density, turnarounds and fold, each both ways. */
const STATES: RadioSettings[] = RADIO_DENSITY_OPTIONS.flatMap((density) =>
  RADIO_TURNAROUNDS_OPTIONS.flatMap((turnarounds) =>
    [false, true].map((foldMode) => settings({ density, turnarounds, foldMode }))
  )
)

describe('radioStripModel: nothing hidden', () => {
  it('sets every radio setting from some control (the legacy pace pair aside)', () => {
    const set = new Set<RadioSettingKey>()
    for (const s of STATES)
      for (const c of controls(radioStripModel(s, CTX))) c.sets.forEach((k) => set.add(k))
    const keys = (Object.keys(DEFAULT_RADIO_SETTINGS) as RadioSettingKey[]).filter(
      (k) => !RADIO_STRIP_LEGACY_KEYS.includes(k)
    )
    // also every key normalizeRadioSettings writes, so an optional field added there counts
    const normalized = Object.keys(normalizeRadioSettings({})) as RadioSettingKey[]
    for (const k of new Set([...keys, ...normalized])) {
      if (RADIO_STRIP_LEGACY_KEYS.includes(k)) continue
      expect(set.has(k), `no strip control sets ${k}`).toBe(true)
    }
  })

  it('only patches what a control says it sets', () => {
    for (const s of STATES) {
      for (const c of controls(radioStripModel(s, CTX))) {
        const patches =
          c.kind === 'chips'
            ? c.chips.map((x) => x.patch)
            : c.kind === 'slider'
              ? [c.patch(7)]
              : c.kind === 'switch'
                ? [c.patch(true), c.patch(false)]
                : c.kind === 'seed'
                  ? [c.patch('abc')]
                  : []
        for (const p of patches) {
          for (const k of Object.keys(p)) expect(c.sets, `${c.id} patches ${k}`).toContain(k)
        }
      }
    }
  })
})

describe('radioStripModel: groups and order', () => {
  it('has the six groups in order, each captioned with its name', () => {
    const groups = radioStripModel(settings(), CTX)
    expect(groups.map((g) => g.id)).toEqual(['play', 'picks', 'shape', 'fold', 'sound', 'mix'])
    expect(groups.map((g) => g.caption)).toEqual([...RADIO_STRIP_GROUPS])
  })

  it('places every control in its group, in reading order', () => {
    const g = radioStripModel(
      settings({ density: 'off', turnarounds: 'rare', foldMode: true }),
      CTX
    )
    expect(ids(g, 'play')).toEqual(['tempo', 'pace', 'skip', 'new-bed'])
    expect(ids(g, 'picks')).toEqual([
      'faves',
      'source',
      'matching',
      'artist',
      'my-sounds',
      'density',
      'channels',
      'turnover'
    ])
    expect(ids(g, 'shape')).toEqual([
      'phrase',
      'loop-end',
      'transitions',
      'turnarounds',
      'moves',
      'depth',
      'builds',
      'turn'
    ])
    expect(ids(g, 'fold')).toEqual(['fold', 'bend', 'mismatch', 'seed'])
    expect(ids(g, 'sound')).toEqual([
      'level',
      'reverb',
      'filter',
      'res',
      'filter-mode',
      'saturation',
      'pump',
      'echo'
    ])
    expect(ids(g, 'mix')).toEqual([
      'similar-all',
      'keep',
      'fetch-hearts',
      'add-to-shelf',
      'add-to-timeline'
    ])
  })
})

describe('radioStripModel: visibility', () => {
  it('shows channels only with density off', () => {
    expect(control(radioStripModel(settings({ density: 'off' }), CTX), 'channels')).toBeDefined()
    expect(control(radioStripModel(settings({ density: 'arc' }), CTX), 'channels')).toBeUndefined()
  })

  it('shows moves and depth only while turnarounds is not off', () => {
    for (const t of RADIO_TURNAROUNDS_OPTIONS) {
      const g = radioStripModel(settings({ turnarounds: t }), CTX)
      expect(control(g, 'moves') !== undefined).toBe(t !== 'off')
      expect(control(g, 'depth') !== undefined).toBe(t !== 'off')
    }
  })

  it('shows bend, mismatch and the seed only with fold on; the switch always', () => {
    expect(ids(radioStripModel(settings({ foldMode: false }), CTX), 'fold')).toEqual(['fold'])
    expect(ids(radioStripModel(settings({ foldMode: true }), CTX), 'fold')).toEqual([
      'fold',
      'bend',
      'mismatch',
      'seed'
    ])
  })

  it('greys the master dials while nothing sounds, and nothing else', () => {
    const g = radioStripModel(settings(), { ...CTX, sounding: false })
    for (const id of ['level', 'reverb', 'filter', 'res', 'filter-mode']) {
      expect(control(g, id)?.disabled, id).toBe(true)
    }
    expect(control(g, 'pace')?.disabled).toBe(false)
    expect(control(radioStripModel(settings(), CTX), 'level')?.disabled).toBe(false)
  })

  it('dims faves in artist mode and greys my sounds without a username or in artist mode', () => {
    expect(control(radioStripModel(settings(), CTX), 'faves')?.dimmed).toBe(false)
    expect(
      control(radioStripModel(settings(), { ...CTX, artistMode: true }), 'faves')?.dimmed
    ).toBe(true)
    expect(control(radioStripModel(settings(), CTX), 'my-sounds')?.disabled).toBe(false)
    expect(
      control(radioStripModel(settings(), { ...CTX, hasUsername: false }), 'my-sounds')?.disabled
    ).toBe(true)
    expect(
      control(radioStripModel(settings(), { ...CTX, artistMode: true }), 'my-sounds')?.disabled
    ).toBe(true)
  })
})

describe('radioStripModel: options come from the shared constants', () => {
  function chipsOf(g: RadioStripGroup[], id: string): { label: string; on: boolean }[] {
    const c = control(g, id)
    if (c?.kind !== 'chips') throw new Error(`${id} is not chips`)
    return c.chips.map(({ label, on }) => ({ label, on }))
  }
  const all = radioStripModel(settings({ density: 'off', turnarounds: 'often' }), CTX)

  it('lists every option, in the constants order, with the setting lit', () => {
    expect(chipsOf(all, 'density').map((c) => c.label)).toEqual([...RADIO_DENSITY_OPTIONS])
    expect(chipsOf(all, 'channels').map((c) => c.label)).toEqual(RADIO_CHANNEL_OPTIONS.map(String))
    expect(chipsOf(all, 'turnover').map((c) => c.label)).toEqual([...RADIO_TURNOVER_OPTIONS])
    expect(chipsOf(all, 'phrase')).toHaveLength(RADIO_PHRASE_OPTIONS.length)
    expect(chipsOf(all, 'loop-end')).toHaveLength(RADIO_LOOP_END_OPTIONS.length)
    expect(chipsOf(all, 'transitions').map((c) => c.label)).toEqual([...RADIO_TRANSITIONS_OPTIONS])
    expect(chipsOf(all, 'turnarounds').map((c) => c.label)).toEqual([...RADIO_TURNAROUNDS_OPTIONS])
    expect(chipsOf(all, 'moves').map((c) => c.label)).toEqual([...TURNAROUND_FAMILIES])
    expect(chipsOf(all, 'depth').map((c) => c.label)).toEqual([...TURNAROUND_DEPTH_OPTIONS])
    for (const id of [
      'density',
      'channels',
      'turnover',
      'phrase',
      'loop-end',
      'transitions',
      'turnarounds',
      'depth',
      'builds'
    ]) {
      expect(
        chipsOf(all, id).filter((c) => c.on),
        id
      ).toHaveLength(1)
    }
  })

  it('labels loop end and phrase as the menu did', () => {
    expect(chipsOf(all, 'loop-end').map((c) => c.label)).toEqual(
      RADIO_LOOP_END_OPTIONS.map((n) => (n === 0 ? 'always' : `${n} bars`))
    )
    expect(chipsOf(all, 'phrase').map((c) => c.label)).toEqual(
      RADIO_PHRASE_OPTIONS.map((n) => (n === 0 ? 'loop' : `${n} bars`))
    )
  })

  it('toggles one move family at a time', () => {
    const c = control(all, 'moves')
    if (c?.kind !== 'chips') throw new Error('moves')
    const first = TURNAROUND_FAMILIES[0]
    expect(c.chips[0].patch.turnaroundMoves).toEqual(TURNAROUND_FAMILIES.filter((f) => f !== first))
  })

  it('switches builds and fold, and reads pace as the slider level', () => {
    const b = control(radioStripModel(settings({ sizedBuilds: false }), CTX), 'builds')
    if (b?.kind !== 'chips') throw new Error('builds')
    expect(b.chips.map((x) => [x.label, x.on])).toEqual([
      ['sized', false],
      ['off', true]
    ])
    const f = control(all, 'fold')
    if (f?.kind !== 'switch') throw new Error('fold')
    expect(f.patch(true)).toEqual({ foldMode: true })
    const p = control(radioStripModel(settings({ paceLevel: 63 }), CTX), 'pace')
    if (p?.kind !== 'slider') throw new Error('pace')
    expect(p.value).toBe(63)
    expect(p.patch(80)).toEqual({ paceLevel: 80 })
  })
})

describe('radioStripModel: words', () => {
  const words = (c: RadioStripControl): string[] => [
    c.label,
    ...(c.tooltip !== undefined ? [c.tooltip] : []),
    ...(c.kind === 'chips' ? c.chips.map((x) => x.label) : [])
  ]

  it('is lowercase, with no emoji and no exclamation mark', () => {
    for (const s of STATES) {
      for (const g of radioStripModel(s, CTX)) {
        for (const w of [g.caption, ...g.controls.flatMap(words)]) {
          expect(w, w).toBe(w.toLowerCase())
          expect(w, w).not.toMatch(/!|\p{Extended_Pictographic}/u)
        }
      }
    }
  })

  it('puts each hint sentence on exactly one control', () => {
    const everything = controls(
      radioStripModel(settings({ density: 'off', turnarounds: 'rare', foldMode: true }), CTX)
    )
    for (const sentence of Object.values(RADIO_STRIP_HINTS).flat()) {
      const on = everything.filter((c) => c.tooltip?.includes(sentence)).map((c) => c.id)
      expect(on, sentence).toHaveLength(1)
    }
  })
})

describe('radioStripModel: the sound dials are the sound panel', () => {
  function slider(
    settingsIn: Parameters<typeof soundPanelModel>[0],
    id: string
  ): SoundSliderControl {
    const c = soundPanelModel(settingsIn)
      .flatMap((r) => r.controls)
      .find((x) => x.id === id)
    if (c?.kind !== 'slider') throw new Error(id)
    return c
  }
  const cases = [
    DEFAULT_SOUND_SETTINGS,
    normalizeSoundSettings({ mastering: { on: false } }),
    normalizeSoundSettings({ pump: { on: false }, throws: { on: false } }),
    normalizeSoundSettings({ saturation: { on: true, amount: 0.4 } })
  ]

  it('greys and patches exactly as the panel does', () => {
    for (const sound of cases) {
      const g = radioStripModel(settings(), { ...CTX, sound })
      for (const [id, panelId] of [
        ['saturation', 'saturation.amount'],
        ['pump', 'pump.depthDb'],
        ['echo', 'throws.level']
      ]) {
        const c = control(g, id)
        if (c?.kind !== 'sound') throw new Error(id)
        const p = slider(sound, panelId)
        expect(c.disabled, id).toBe(p.disabled)
        expect(c.control.value, id).toBe(p.value)
        expect(c.control.patch(0.5), id).toEqual(p.patch(0.5))
      }
    }
  })

  it('says why a dial does nothing, and that it is the project sound', () => {
    const noMastering = radioStripModel(settings(), {
      ...CTX,
      sound: normalizeSoundSettings({ mastering: { on: false } })
    })
    expect(control(noMastering, 'saturation')?.tooltip).toBe('project sound · needs mastering')
    const pumpOff = radioStripModel(settings(), {
      ...CTX,
      sound: normalizeSoundSettings({ pump: { on: false } })
    })
    expect(control(pumpOff, 'pump')?.tooltip).toBe('project sound · switched off in sound')
  })

  it('maps a 0..100 dial onto the slider, on its step, both ways', () => {
    const pump = slider(DEFAULT_SOUND_SETTINGS, 'pump.depthDb')
    expect(soundDialValue(pump, 0)).toBe(pump.min)
    expect(soundDialValue(pump, 100)).toBe(pump.max)
    expect(soundDialValue(pump, 50)).toBe(4)
    expect(soundDialValue(pump, 3)).toBe(0) // 0.24 dB rounds to the 0.5 dB step's 0
    expect(soundDialValue(pump, 150)).toBe(pump.max)
    expect(soundDialPosition(pump, 4)).toBe(50)
    expect(soundDialPosition(pump, 8)).toBe(100)
    const sat = slider(DEFAULT_SOUND_SETTINGS, 'saturation.amount')
    for (let pos = 0; pos <= 100; pos += 5) {
      expect(soundDialPosition(sat, soundDialValue(sat, pos))).toBe(pos)
    }
  })
})
```

- [ ] **Step 2: Run it, see it fail.** `npx vitest run src/shared/radioStripModel.test.ts`.
  Expected: FAIL, `Failed to resolve import "./radioStripModel"`.

- [ ] **Step 3: Write the module.** Create `src/shared/radioStripModel.ts`:

```ts
// src/shared/radioStripModel.ts -- the radio view's strip (spec
// 2026-10-03-sssketch-radio-view-design section 1.3): every radio setting out front, in six
// groups, while radio runs. Pure, as soundPanelModel is for the sound panel: RadioStrip.tsx draws
// these groups as they come, so which control is in which group, in what order, when it shows,
// what it says, and which RadioSettings patch a choice makes are decided (and tested) here.
//
// THE GROUPS, in order: play (tempo, pace, skip, new bed), picks (faves, source, matching,
// artist, my sounds, density, channels, turnover), shape (phrase, loop end, transitions,
// turnarounds, moves, depth, builds, turn), fold (the switch; bend, mismatch, seed), sound
// (level, reverb, filter, res, filter mode; saturation, pump, echo), mix (similar all, keep,
// fetch hearts, add to shelf, add to timeline).
//
// THE KINDS. `chips`, `slider`, `switch` and `seed` are RadioSettings controls and carry their
// patches. `sound` carries the sound panel's own slider control (soundPanelModel), so its greyed
// state and its SET_SOUND_SETTINGS patch are the panel's. `panel` is a control the panel draws
// from its own state (the tempo field, the dials it already owns, the artist picker, the mix
// actions); the model only places it and says what it sets.
//
// VISIBILITY is omission: a control that does not show is not in its group. Channels shows only
// with density `off`; moves and depth only while turnarounds is not `off`; bend, mismatch and the
// seed only with fold on (Elling, 2026-10-03: hidden as before, not disabled).
//
// THE HINTS. The running radio menu's hint paragraph went with the menu; each of its sentences is
// now the tooltip of the control it explains (RADIO_STRIP_HINTS), every one on exactly one control.
import {
  RADIO_CHANNELS_MAX,
  RADIO_CHANNELS_MIN,
  RADIO_DENSITY_OPTIONS,
  RADIO_LOOP_END_OPTIONS,
  RADIO_PHRASE_OPTIONS,
  RADIO_TURNOVER_OPTIONS,
  radioDensityOf,
  radioPaceLevelOf,
  radioSizedBuildsOf,
  type RadioSettings
} from './radioSchedule'
import { RADIO_PACE_LABEL, RADIO_PACE_TOOLTIP } from './radioPace'
import {
  RADIO_TURNAROUNDS_OPTIONS,
  TURNAROUND_DEPTH_OPTIONS,
  TURNAROUND_FAMILIES,
  toggleTurnaroundFamily
} from './radioTurnaround'
import { RADIO_TRANSITIONS_OPTIONS } from './radioTransition'
import { FAVES_LABEL, FAVES_TOOLTIP } from './discoverFaves'
import { soundPanelModel, type SoundSliderControl } from './soundPanelModel'
import type { DeepReadonly, SoundSettings } from './radioSound'

export type RadioStripGroupId = 'play' | 'picks' | 'shape' | 'fold' | 'sound' | 'mix'

/** The groups in order; each group's caption is its id. */
export const RADIO_STRIP_GROUPS: readonly RadioStripGroupId[] = [
  'play',
  'picks',
  'shape',
  'fold',
  'sound',
  'mix'
]

export type RadioSettingKey = keyof RadioSettings

/** Kept on RadioSettings only to migrate an old settings file (paceLevel supersedes both): no
 * control sets them. */
export const RADIO_STRIP_LEGACY_KEYS: readonly RadioSettingKey[] = ['pace', 'paceBars']

export interface RadioStripChip {
  label: string
  on: boolean
  patch: Partial<RadioSettings>
}

interface RadioStripControlBase {
  id: string
  label: string
  tooltip?: string
  /** The RadioSettings keys this control writes (none for a control that is not a setting). */
  sets: readonly RadioSettingKey[]
  /** Greyed and inert. */
  disabled: boolean
  /** Dimmed but live (the faves dial in artist mode: your stars are not among the artist's). */
  dimmed?: boolean
}

export type RadioStripControl =
  | (RadioStripControlBase & { kind: 'chips'; chips: readonly RadioStripChip[] })
  | (RadioStripControlBase & {
      kind: 'slider'
      value: number
      patch(value: number): Partial<RadioSettings>
    })
  | (RadioStripControlBase & {
      kind: 'switch'
      on: boolean
      patch(on: boolean): Partial<RadioSettings>
    })
  | (RadioStripControlBase & {
      kind: 'seed'
      value: string
      patch(seed: string): Partial<RadioSettings>
    })
  | (RadioStripControlBase & { kind: 'sound'; control: SoundSliderControl })
  | (RadioStripControlBase & { kind: 'panel' })

export interface RadioStripGroup {
  id: RadioStripGroupId
  caption: string
  controls: RadioStripControl[]
}

export interface RadioStripContext {
  /** Discover artist mode (another artist's stems). */
  artistMode: boolean
  /** The user's own username is known (`my sounds` needs it). */
  hasUsername: boolean
  /** The open project's sound settings, normalized (the panel's `sound ?? app defaults`). */
  sound: DeepReadonly<SoundSettings>
  /** Something is in the playing mix: the master dials address it, and mean nothing otherwise. */
  sounding: boolean
}

/** The running menu's hint paragraph, sentence by sentence, keyed by the control each now
 * explains. `loopEnd` drops the paragraph's leading `below that,`: its `that` was the pace
 * sentence before it, which is no longer beside it. */
export const RADIO_STRIP_HINTS = {
  pace: [
    'pace is heard from the next change, and takes nothing back',
    'above fast the phrase shortens, and from 71 changes may come at every loop top',
    'from 80 changes may land mid-loop on bar lines, every 4, 2 or 1 bars, as cuts, long layers included',
    'above 70 a change may turn over more than one row, up to four at 100, all landing together'
  ],
  loopEnd: [
    'a layer longer than loop end changes at the top of the loop, a shorter one on its own cycle'
  ],
  phrase: [
    'phrase holds every change back to a 16 or 32 bar boundary, counted from where radio started'
  ],
  transitions: [
    'transitions decide how a layer arrives, and a hole or a riser holds its change to the top of the loop'
  ],
  density: [
    'density arc grows the rows to four or five and thins them to two or three, only ever removing rows radio added'
  ],
  turnarounds: ['turnarounds mark the end of each phrase'],
  fold: [
    'fold loops one or two short layers at odd lengths against the beat, and changes come every 8 to 32 bars while it is on'
  ]
} as const

/** Joins a short tooltip and its hint sentences into one tooltip. */
function tip(...parts: readonly string[]): string {
  return parts.join('. ')
}

/** The `loop end` chips: 0 is every layer waiting for the loop top. */
export function radioLoopEndLabel(bars: number): string {
  return bars === 0 ? 'always' : `${bars} bars`
}

/** The `phrase` chips: 0 is no phrase grid, every boundary the loop offers. */
export function radioPhraseLabel(bars: number): string {
  return bars === 0 ? 'loop' : `${bars} bars`
}

export const RADIO_CHANNEL_OPTIONS: readonly number[] = Array.from(
  { length: RADIO_CHANNELS_MAX - RADIO_CHANNELS_MIN + 1 },
  (_, i) => RADIO_CHANNELS_MIN + i
)

export const RADIO_TURNOVER_TOOLTIP =
  'which row changes next: even, the one that has gone longest; random, any'
export const RADIO_BUILDS_TOOLTIP = 'build-ups sized to the change; every turnaround paid off'
export const RADIO_NEW_BED_TOOLTIP = 'every unlocked row at once, at the next loop top'
export const RADIO_SOUND_TOOLTIP = 'project sound'

/** The strip's sound dials, from the sound panel's own controls: [strip id, panel id, label]. */
export const RADIO_STRIP_SOUND_DIALS: readonly (readonly [string, string, string])[] = [
  ['saturation', 'saturation.amount', 'saturation'],
  ['pump', 'pump.depthDb', 'pump'],
  ['echo', 'throws.level', 'echo']
]

function chips<T>(
  options: readonly T[],
  label: (o: T) => string,
  on: (o: T) => boolean,
  patch: (o: T) => Partial<RadioSettings>
): RadioStripChip[] {
  return options.map((o) => ({ label: label(o), on: on(o), patch: patch(o) }))
}

function panel(
  id: string,
  label: string,
  o: {
    tooltip?: string
    sets?: readonly RadioSettingKey[]
    disabled?: boolean
    dimmed?: boolean
  } = {}
): RadioStripControl {
  return {
    kind: 'panel',
    id,
    label,
    ...(o.tooltip !== undefined ? { tooltip: o.tooltip } : {}),
    sets: o.sets ?? [],
    disabled: o.disabled ?? false,
    ...(o.dimmed !== undefined ? { dimmed: o.dimmed } : {})
  }
}

/** A sound panel slider as a strip dial: greyed exactly when the panel greys it; the tooltip
 * says it is the project's sound, and why it does nothing when it does nothing. */
function soundDial(
  id: string,
  label: string,
  control: SoundSliderControl,
  mastering: boolean
): RadioStripControl {
  const why = !control.disabled
    ? null
    : id === 'saturation' && !mastering
      ? 'needs mastering'
      : 'switched off in sound'
  return {
    kind: 'sound',
    id,
    label,
    tooltip: why === null ? RADIO_SOUND_TOOLTIP : `${RADIO_SOUND_TOOLTIP} · ${why}`,
    sets: [],
    disabled: control.disabled,
    control
  }
}

/** The strip for these settings, group by group, only what shows. */
export function radioStripModel(
  settings: RadioSettings,
  ctx: RadioStripContext
): RadioStripGroup[] {
  const density = radioDensityOf(settings)
  const turnaroundsOn = settings.turnarounds !== 'off'
  const foldOn = settings.foldMode
  const sizedBuilds = radioSizedBuildsOf(settings)

  const play: RadioStripControl[] = [
    panel('tempo', 'tempo'),
    {
      kind: 'slider',
      id: 'pace',
      label: RADIO_PACE_LABEL,
      tooltip: tip(RADIO_PACE_TOOLTIP, ...RADIO_STRIP_HINTS.pace),
      sets: ['paceLevel'],
      disabled: false,
      value: radioPaceLevelOf(settings),
      patch: (v) => ({ paceLevel: v })
    },
    panel('skip', 'skip', { tooltip: 'skip a row' }),
    panel('new-bed', 'new bed', { tooltip: RADIO_NEW_BED_TOOLTIP })
  ]

  const picks: RadioStripControl[] = [
    panel('faves', FAVES_LABEL, {
      tooltip: FAVES_TOOLTIP,
      sets: ['faves'],
      dimmed: ctx.artistMode
    }),
    panel('source', 'source', { tooltip: 'other clockwise' }),
    panel('matching', 'matching', { tooltip: 'more matching clockwise' }),
    panel('artist', 'artist', { tooltip: 'whose stems discover plays' }),
    panel('my-sounds', 'my sounds', { disabled: !ctx.hasUsername || ctx.artistMode }),
    {
      kind: 'chips',
      id: 'density',
      label: 'density',
      tooltip: tip(...RADIO_STRIP_HINTS.density),
      sets: ['density'],
      disabled: false,
      chips: chips(
        RADIO_DENSITY_OPTIONS,
        (d) => d,
        (d) => density === d,
        (d) => ({ density: d })
      )
    },
    ...(density === 'off'
      ? [
          {
            kind: 'chips' as const,
            id: 'channels',
            label: 'channels',
            sets: ['channels'] as const,
            disabled: false,
            chips: chips(
              RADIO_CHANNEL_OPTIONS,
              (n) => String(n),
              (n) => settings.channels === n,
              (n) => ({ channels: n })
            )
          }
        ]
      : []),
    {
      kind: 'chips',
      id: 'turnover',
      label: 'turnover',
      tooltip: RADIO_TURNOVER_TOOLTIP,
      sets: ['turnover'],
      disabled: false,
      chips: chips(
        RADIO_TURNOVER_OPTIONS,
        (t) => t,
        (t) => settings.turnover === t,
        (t) => ({ turnover: t })
      )
    }
  ]

  const shape: RadioStripControl[] = [
    {
      kind: 'chips',
      id: 'phrase',
      label: 'phrase',
      tooltip: tip(...RADIO_STRIP_HINTS.phrase),
      sets: ['phraseBars'],
      disabled: false,
      chips: chips(
        RADIO_PHRASE_OPTIONS,
        radioPhraseLabel,
        (n) => settings.phraseBars === n,
        (n) => ({ phraseBars: n })
      )
    },
    {
      kind: 'chips',
      id: 'loop-end',
      label: 'loop end',
      tooltip: tip(...RADIO_STRIP_HINTS.loopEnd),
      sets: ['loopEndOverBars'],
      disabled: false,
      chips: chips(
        RADIO_LOOP_END_OPTIONS,
        radioLoopEndLabel,
        (n) => settings.loopEndOverBars === n,
        (n) => ({ loopEndOverBars: n })
      )
    },
    {
      kind: 'chips',
      id: 'transitions',
      label: 'transitions',
      tooltip: tip(...RADIO_STRIP_HINTS.transitions),
      sets: ['transitions'],
      disabled: false,
      chips: chips(
        RADIO_TRANSITIONS_OPTIONS,
        (t) => t,
        (t) => settings.transitions === t,
        (t) => ({ transitions: t })
      )
    },
    {
      kind: 'chips',
      id: 'turnarounds',
      label: 'turnarounds',
      tooltip: tip(...RADIO_STRIP_HINTS.turnarounds),
      sets: ['turnarounds'],
      disabled: false,
      chips: chips(
        RADIO_TURNAROUNDS_OPTIONS,
        (t) => t,
        (t) => settings.turnarounds === t,
        (t) => ({ turnarounds: t })
      )
    },
    ...(turnaroundsOn
      ? [
          {
            kind: 'chips' as const,
            id: 'moves',
            label: 'moves',
            tooltip: 'which moves',
            sets: ['turnaroundMoves'] as const,
            disabled: false,
            chips: chips(
              TURNAROUND_FAMILIES,
              (f) => f,
              (f) => settings.turnaroundMoves.includes(f),
              (f) => ({ turnaroundMoves: toggleTurnaroundFamily(settings.turnaroundMoves, f) })
            )
          },
          {
            kind: 'chips' as const,
            id: 'depth',
            label: 'depth',
            tooltip: 'how far',
            sets: ['turnaroundDepth'] as const,
            disabled: false,
            chips: chips(
              TURNAROUND_DEPTH_OPTIONS,
              (d) => d,
              (d) => settings.turnaroundDepth === d,
              (d) => ({ turnaroundDepth: d })
            )
          }
        ]
      : []),
    {
      kind: 'chips',
      id: 'builds',
      label: 'builds',
      tooltip: RADIO_BUILDS_TOOLTIP,
      sets: ['sizedBuilds'],
      disabled: false,
      chips: [
        { label: 'sized', on: sizedBuilds, patch: { sizedBuilds: true } },
        { label: 'off', on: !sizedBuilds, patch: { sizedBuilds: false } }
      ]
    },
    panel('turn', 'turn', { tooltip: 'turn at the top' })
  ]

  const fold: RadioStripControl[] = [
    {
      kind: 'switch',
      id: 'fold',
      label: 'fold',
      tooltip: tip('layers in other time signatures', ...RADIO_STRIP_HINTS.fold),
      sets: ['foldMode'],
      disabled: false,
      on: foldOn,
      patch: (on) => ({ foldMode: on })
    },
    ...(foldOn
      ? [
          {
            kind: 'slider' as const,
            id: 'bend',
            label: 'bend',
            tooltip: 'how far layers bend off the beat',
            sets: ['fold'] as const,
            disabled: false,
            value: settings.fold,
            patch: (v: number) => ({ fold: v })
          },
          {
            kind: 'slider' as const,
            id: 'mismatch',
            label: 'mismatch',
            tooltip: 'how unlike the rest new layers are',
            sets: ['clash'] as const,
            disabled: false,
            value: settings.clash,
            patch: (v: number) => ({ clash: v })
          },
          {
            kind: 'seed' as const,
            id: 'seed',
            label: 'seed',
            tooltip: 'same seed, same folding. any text',
            sets: ['foldSeed'] as const,
            disabled: false,
            value: settings.foldSeed,
            patch: (seed: string) => ({ foldSeed: seed })
          }
        ]
      : [])
  ]

  const soundControls = soundPanelModel(ctx.sound).flatMap((r) => r.controls)
  const sliderOf = (panelId: string): SoundSliderControl => {
    const c = soundControls.find((x) => x.id === panelId)
    if (c === undefined || c.kind !== 'slider') throw new Error(`no sound slider ${panelId}`)
    return c
  }
  const quiet = !ctx.sounding
  const sound: RadioStripControl[] = [
    panel('level', 'level', { tooltip: 'whole mix level', disabled: quiet }),
    panel('reverb', 'reverb', { tooltip: 'whole mix reverb', disabled: quiet }),
    panel('filter', 'filter', { tooltip: 'whole mix filter', disabled: quiet }),
    panel('res', 'res', { tooltip: 'filter resonance', disabled: quiet }),
    panel('filter-mode', 'filter mode', { disabled: quiet }),
    ...RADIO_STRIP_SOUND_DIALS.map(([id, panelId, label]) =>
      soundDial(id, label, sliderOf(panelId), ctx.sound.mastering.on)
    )
  ]

  const mix: RadioStripControl[] = [
    panel('similar-all', 'similar all'),
    panel('keep', 'keep', { tooltip: 'keep this group' }),
    panel('fetch-hearts', 'fetch hearts', { tooltip: 'fetch radio hearts' }),
    panel('add-to-shelf', 'add to shelf'),
    panel('add-to-timeline', 'add to timeline')
  ]

  const byId: Record<RadioStripGroupId, RadioStripControl[]> = {
    play,
    picks,
    shape,
    fold,
    sound,
    mix
  }
  return RADIO_STRIP_GROUPS.map((id) => ({ id, caption: id, controls: byId[id] }))
}

/** A 0..100 strip dial's position for a sound panel slider's value. */
export function soundDialPosition(control: SoundSliderControl, value = control.value): number {
  const span = control.max - control.min
  if (!(span > 0)) return 0
  const t = (value - control.min) / span
  return Math.round(Math.min(1, Math.max(0, t)) * 100)
}

/** The sound panel slider's value at a 0..100 strip dial position: on the slider's own step,
 * inside its range, rounded as the panel's patch rounds. */
export function soundDialValue(control: SoundSliderControl, position: number): number {
  const span = control.max - control.min
  const t = Math.min(100, Math.max(0, Number.isFinite(position) ? position : 0)) / 100
  const steps = Math.round((t * span) / control.step)
  const v = Math.min(control.max, Math.max(control.min, control.min + steps * control.step))
  return Math.round(v * 1e6) / 1e6
}
```

- [ ] **Step 4: Run it, see it pass.** `npx vitest run src/shared/radioStripModel.test.ts`.
  Expected: 18 tests passed. Then `npm run typecheck` and
  `npx eslint src/shared/radioStripModel.ts src/shared/radioStripModel.test.ts`: clean.

- [ ] **Step 5: Prove the guard bites.** Temporarily change the `builds` control's
  `sets: ['sizedBuilds']` to `sets: []` and rerun: the "sets every radio setting" test must fail
  with `no strip control sets sizedBuilds`. Put it back; green again.

- [ ] **Step 6: Commit.**
  `git commit --only src/shared/radioStripModel.ts src/shared/radioStripModel.test.ts` with
  message `radio view: the strip model (@shared/radioStripModel, spec 2026-10-03-sssketch-radio-view-design 1.3 and 4) -- six groups (play, picks, shape, fold, sound, mix), every radio setting on a control (a test fails for a setting with none; pace/paceBars are migration-only), visibility by omission (channels with density off, moves/depth while turnarounds are on, bend/mismatch/seed with fold on), options from the shared constants, the menu's hint paragraph as tooltips, the new turnover chips and builds; saturation/pump/echo are the sound panel's own sliders (same greying, same patches) as 0..100 dials. Nothing reads it yet`, then the trailer.

### Task 2: The row plates (`radioRowPlates.ts`)

**Parallel-safe** (new files). **Depends on:** nothing.

**Files:**
- Create: `/Users/nickel/Claudecode/sssketch/src/shared/radioRowPlates.test.ts`
- Create: `/Users/nickel/Claudecode/sssketch/src/shared/radioRowPlates.ts`

- [ ] **Step 1: Write the failing test.** Create `src/shared/radioRowPlates.test.ts`:

```ts
// The radio view's on-waveform plates (spec 2026-10-03-sssketch-radio-view-design section 4):
// the web's full-mode row render, lifted (radioRowPlates.ts).
import { describe, expect, it } from 'vitest'
import { NO_RADIO_ROW_PLATES, radioRowPlates } from './radioRowPlates'
import type { RadioReadoutRow } from './radioReadout'

function row(over: Partial<RadioReadoutRow> = {}): RadioReadoutRow {
  return {
    rowId: 'r1',
    label: 'drums · heavy',
    age: '1 lap',
    isNext: false,
    nextKind: null,
    nextLabel: null,
    flash: null,
    ...over
  }
}

describe('radioRowPlates', () => {
  it('splits the info plate into the label and a tail kept whole, after a no-break space', () => {
    expect(radioRowPlates(row(), null).info).toEqual({
      label: 'drums · heavy',
      tail: ' · 1 lap'
    })
  })

  it('keeps the role words in the tail, so they are never cut with the label', () => {
    const p = radioRowPlates(row({ age: '3 laps · hook · back in 16 bars' }), null)
    expect(p.info?.tail).toBe(' · 3 laps · hook · back in 16 bars')
  })

  it('has a bare tail with no label, a bare label with no age, and no plate with neither', () => {
    expect(radioRowPlates(row({ label: '' }), null).info).toEqual({ label: '', tail: '1 lap' })
    expect(radioRowPlates(row({ age: '' }), null).info).toEqual({
      label: 'drums · heavy',
      tail: ''
    })
    expect(radioRowPlates(row({ label: '', age: '' }), null).info).toBeNull()
  })

  it('hides the cue with neither a flash nor a next, and shows either alone', () => {
    expect(radioRowPlates(row(), null).cue).toBeNull()
    expect(radioRowPlates(row({ nextLabel: '' }), null).cue).toBeNull()
    expect(radioRowPlates(row({ nextLabel: 'next · filter in' }), null).cue).toEqual({
      flash: null,
      next: 'next · filter in'
    })
    const flashOnly = radioRowPlates(row({ flash: { word: 'throw', t: 0.5 } }), null).cue
    expect(flashOnly?.next).toBeNull()
    expect(flashOnly?.flash?.word).toBe('throw')
    expect(flashOnly?.flash?.opacity).toBeCloseTo(1, 6)
  })

  it('fades the flash in and out over its window', () => {
    const at = (t: number): number | undefined =>
      radioRowPlates(row({ flash: { word: 'wash', t } }), null).cue?.flash?.opacity
    expect(at(0)).toBeCloseTo(0, 6)
    expect(at(0.25)).toBeCloseTo(Math.SQRT1_2, 6)
    expect(at(1)).toBeCloseTo(0, 6)
  })

  it('shows the fold plate only on a folded row', () => {
    expect(radioRowPlates(row(), '7 / 16').fold).toBe('7 / 16')
    expect(radioRowPlates(row(), null).fold).toBeNull()
    expect(radioRowPlates(row(), '').fold).toBeNull()
  })

  it('draws nothing with no readout (radio off) and no fold', () => {
    expect(radioRowPlates(null, null)).toEqual(NO_RADIO_ROW_PLATES)
    // a folded row's plate does not need the readout
    expect(radioRowPlates(null, '3½ / 16')).toEqual({ info: null, cue: null, fold: '3½ / 16' })
  })
})
```

- [ ] **Step 2: Run it, see it fail.** `npx vitest run src/shared/radioRowPlates.test.ts`.
  Expected: FAIL, `Failed to resolve import "./radioRowPlates"`.

- [ ] **Step 3: Write the module.** Create `src/shared/radioRowPlates.ts`:

```ts
// src/shared/radioRowPlates.ts -- what the radio view draws ON a row's waveform (spec
// 2026-10-03-sssketch-radio-view-design section 1.2): the web radio's full-mode plates (ell.ing/radio
// src/ui/full.ts's row render, as of 22de927), lifted so the desktop draws the same words from the
// same readout. Pure. The web keeps its own copy for now (scope A changes only the desktop).
//
//   info  top left: the readout's label, cut with an ellipsis, then its tail kept whole -- the age
//         and the role words after it (`3 laps · hook · back in 16 bars`). The web's tail starts
//         with a no-break space, since a flex item's leading space would collapse.
//   cue   bottom right: the gesture flash (its word and opacity over its bar) and `next · ...`.
//         Hidden when it has neither.
//   fold  top right: fold mode's `7 / 16` on a folded row; the phase dot under it is the
//         panel's (data-fold-dot), never this module's.
import { radioFlashOpacity, type RadioReadoutRow } from './radioReadout'

export interface RadioRowPlates {
  /** Null when the row has neither a label nor an age. */
  info: { label: string; tail: string } | null
  /** Null when the row has neither a flash nor a `next`. */
  cue: { flash: { word: string; opacity: number } | null; next: string | null } | null
  /** Null on a row playing straight, and with fold mode off. */
  fold: string | null
}

export const NO_RADIO_ROW_PLATES: RadioRowPlates = { info: null, cue: null, fold: null }

/** The plates for one row: its readout (null while radio is off) and fold's label for it (null
 * unless it is folded). */
export function radioRowPlates(
  row: RadioReadoutRow | null,
  foldLabel: string | null
): RadioRowPlates {
  const label = row?.label ?? ''
  const age = row?.age ?? ''
  const tail = age === '' ? '' : label === '' ? age : ` · ${age}`
  const flash =
    row?.flash != null ? { word: row.flash.word, opacity: radioFlashOpacity(row.flash.t) } : null
  const next = row?.nextLabel != null && row.nextLabel !== '' ? row.nextLabel : null
  return {
    info: label === '' && tail === '' ? null : { label, tail },
    cue: flash === null && next === null ? null : { flash, next },
    fold: foldLabel !== null && foldLabel !== '' ? foldLabel : null
  }
}
```

- [ ] **Step 4: Run it, see it pass.** Expected: 7 tests passed. `npm run typecheck`, eslint on
  both files: clean.

- [ ] **Step 5: Commit** (`--only` the two files): `radio view: the row plates (@shared/radioRowPlates) -- the web's full-mode row render lifted: the info plate as a label (ellipsized) and a tail kept whole (age and role words, after a no-break space), the cue (flash with its opacity, next) hidden when empty, fold's label. Nothing reads it yet`, then the trailer.

### Task 3: The landing flicker's rule (`radioLanding.ts`)

**Parallel-safe** (new files). **Depends on:** nothing.

**Files:**
- Create: `/Users/nickel/Claudecode/sssketch/src/shared/radioLanding.test.ts`
- Create: `/Users/nickel/Claudecode/sssketch/src/shared/radioLanding.ts`

- [ ] **Step 1: Write the failing test.** Create `src/shared/radioLanding.test.ts`:

```ts
// The landing flicker's rule (spec 2026-10-03-sssketch-radio-view-design section 2):
// radioLanding.ts.
import { describe, expect, it } from 'vitest'
import {
  RADIO_LANDING_COALESCE_MS,
  shouldFlickerLanding,
  type RadioLandingSource
} from './radioLanding'

describe('shouldFlickerLanding', () => {
  it('flickers on the first landing', () => {
    expect(shouldFlickerLanding(null, 1000, 'radio')).toBe(true)
  })

  it('coalesces landings within 50 ms into one flicker, either side', () => {
    expect(shouldFlickerLanding(1000, 1000, 'radio')).toBe(false)
    expect(shouldFlickerLanding(1000, 1000 + RADIO_LANDING_COALESCE_MS - 1, 'arc')).toBe(false)
    expect(shouldFlickerLanding(1000, 1000 - 10, 'course')).toBe(false)
    expect(shouldFlickerLanding(1000, 1000 + RADIO_LANDING_COALESCE_MS, 'radio')).toBe(true)
  })

  it('flickers for everything radio-paced, never for a manual change landed at once', () => {
    const paced: RadioLandingSource[] = ['radio', 'course', 'arc', 'manual-wait', 'hook']
    for (const s of paced) expect(shouldFlickerLanding(null, 5000, s)).toBe(true)
    expect(shouldFlickerLanding(null, 5000, 'manual-now')).toBe(false)
    expect(shouldFlickerLanding(0, 5000, 'manual-now')).toBe(false)
  })

  it('ignores a time that is not a number', () => {
    expect(shouldFlickerLanding(null, Number.NaN, 'radio')).toBe(false)
  })
})
```

- [ ] **Step 2: Run it, see it fail** (unresolved import).

- [ ] **Step 3: Write the module.** Create `src/shared/radioLanding.ts`:

```ts
// src/shared/radioLanding.ts -- the radio view's landing flicker (spec
// 2026-10-03-sssketch-radio-view-design section 2): the strip's `skip` flickers in the playhead
// colour when radio's change is heard, as the web's `next` does (ell.ing/radio src/main.ts's
// onLanding: several rows landing on one wrap are one flicker). Pure; the panel keeps the last
// flicker's time and calls this from the places a change lands at a loop top or a held bar.
//
// It answers "did radio's change just happen", so a manual change made with Cmd (landing at once,
// not on radio's clock) never flickers. A manual change that WAITED for the top did happen on
// radio's clock and does.

/** Where a landing came from: radio's own change (with its companions), a course change (`new
 * bed`, an artist change), the density arc's row joining, a manual change that waited for the top,
 * a hook's exit or return, or a manual change landed at once (Cmd). */
export type RadioLandingSource = 'radio' | 'course' | 'arc' | 'manual-wait' | 'hook' | 'manual-now'

/** Landings closer together than this are one moment: one flicker (the web's 0.05 s). */
export const RADIO_LANDING_COALESCE_MS = 50

/** The flicker's length (the web's `full-flicker`, 600 ms). */
export const RADIO_LANDING_FLICKER_MS = 600

/** True when this landing should flicker. `prevAtMs` is the time of the last landing that did
 * (null before any); the caller records `atMs` only when this returns true, as the web does. */
export function shouldFlickerLanding(
  prevAtMs: number | null,
  atMs: number,
  source: RadioLandingSource
): boolean {
  if (source === 'manual-now') return false
  if (!Number.isFinite(atMs)) return false
  return prevAtMs === null || Math.abs(atMs - prevAtMs) >= RADIO_LANDING_COALESCE_MS
}
```

- [ ] **Step 4: Run it, see it pass.** Expected: 4 tests passed. Typecheck, eslint: clean.

- [ ] **Step 5: Commit** (`--only` the two files): `radio view: the landing flicker's rule (@shared/radioLanding) -- one flicker per landing moment (50 ms, the web's onLanding), every radio-paced landing (radio, course, arc, a waiting manual change, a hook), never a manual change landed at once. Nothing reads it yet`, then the trailer.

---

## Phase 2: the row, moved and split


### Task 4: Move the row out of `DiscoverPanel.tsx` (pure move, no behaviour change)

**Depends on:** nothing (do it first among the UI tasks). **Parallel with:** T1-T3, T6.

**Files:**
- Create: `src/renderer/src/components/discoverCandidateStem.ts`
- Create: `src/renderer/src/components/discoverRowGrid.ts`
- Create: `src/renderer/src/components/DiscoverSlotRow.tsx`
- Modify: `src/renderer/src/components/DiscoverPanel.tsx`

This commit changes no behaviour and no text inside any moved declaration. It goes in alone, with
typecheck and lint green, because explicit `gridColumn` numbers have caused off-by-one bugs here
before (spec section 6).

- [ ] **Step 1: The candidate-stem resolver.** Cut from `DiscoverPanel.tsx`, verbatim, everything
  from `export interface ResolvedCandidateStem {` (:404) up to (not including)
  `export interface DiscoverSlot {` (:502): the interface, `resolvedCandidateCache`,
  `settledCandidateStems`, `peekResolvedCandidateStem`, `resolveCandidateStem` and their comments.
  Paste into `discoverCandidateStem.ts` under a header comment
  (`// The Discover candidate -> local stem resolver, shared by DiscoverPanel and DiscoverSlotRow (moved verbatim from DiscoverPanel.tsx, radio view plan Task 4).`).
  Add `export` to `peekResolvedCandidateStem` and `resolveCandidateStem`. Give it the imports it
  needs (at 209878f: `type DiscoverCandidate` from `'../../../main/discoverCandidates'`,
  `type SoundType` from `'@shared/types'`, `guessSoundTypeFromPresetName` from
  `'@shared/presetNames'`, `instrumentMaskToSoundType` from `'@shared/riffLibraryTypes'`; let
  `npm run typecheck` name anything else). In `DiscoverPanel.tsx`:
  `import { peekResolvedCandidateStem, resolveCandidateStem, type ResolvedCandidateStem } from './discoverCandidateStem'`
  (drop `peekResolvedCandidateStem` if the panel no longer uses it after Step 3), and
  `export type { ResolvedCandidateStem } from './discoverCandidateStem'` so
  `audio/discoverSeed.ts`'s `type ResolvedCandidateStem` import from `../components/DiscoverPanel`
  still resolves.

- [ ] **Step 2: The row grid constants.** Cut, verbatim, from the comment above
  `const DISCOVER_WAVEFORM_HEIGHT = 40` (:12573) through `const DISCOVER_WAVEFORM_MIN_WIDTH = 140`
  (:12610): `DISCOVER_WAVEFORM_HEIGHT`, `DISCOVER_ROW_GRID_COLUMNS`,
  `DISCOVER_FOLD_READOUT_TRACK`, `DISCOVER_RADIO_ROLE_TRACKS`, `discoverRowGridColumns`,
  `DISCOVER_ROW_COLUMN_GAP`, `DISCOVER_WAVEFORM_COLUMN`, `DISCOVER_WAVEFORM_MIN_WIDTH`, with their
  comments. Paste into `discoverRowGrid.ts` and `export` each. The panel imports
  `discoverRowGridColumns`, `DISCOVER_ROW_COLUMN_GAP`, `DISCOVER_WAVEFORM_COLUMN`,
  `DISCOVER_WAVEFORM_MIN_WIDTH` (its playhead overlay, :12025-12060).

- [ ] **Step 3: The row.** Cut, verbatim: `LockGlyph` (:12353-12385 with its comment),
  `RowIconButton` (:12425-12531 with its doc comment), `RadioRoleButtons` (:12612-12655) and
  `DiscoverSlotRow` (:12657 to the end of the file). Leave in the panel: `ADD_ROW_DIAL_COLUMN_WIDTH`,
  `MY_SOUNDS_NEEDS_USERNAME`, `AddRowDivider`, `AddRowChip`, `UndoIcon`, `RedoIcon`, `DiceIcon`
  (the header and add row use them). Paste into `DiscoverSlotRow.tsx` in the same order, under a
  header comment
  (`// One Discover row (moved verbatim from DiscoverPanel.tsx, radio view plan Task 4): its buttons, waveform, readout and popovers. State that outlives a row stays in DiscoverPanel.`).
  Change only `function DiscoverSlotRow(` to `export function DiscoverSlotRow(`. Imports: the row
  needs (at 209878f) React's `useCallback`, `useEffect`, `useMemo`, `useRef`, `useState`; the
  Phosphor icons `Compass`, `Copy`, `Repeat`, `Shovel`, `Shuffle`, `SkipForward`, `ThumbsDown`,
  `ThumbsUp`; `DiscoverKindPicker`, `DiscoverNearbyPopover`, `DiscoverReclassifyPicker`,
  `LoadingLoader`, `LoopLines`, `RepeatedWaveform`, `startPointerDrag` (`./dragUtils`),
  `stemColorVar` (`../theme/typeColor`); from `@shared`: `buildMatchMeter`, `discoverRoleLabel`,
  `reclassifyKindSources`, `MATCH_METER_STEPS` (`discoverMatchMeter`), `ROLE_LABELS`
  (`autoArrangeLabels`), `discoverSlotKindToArrangeRole`, `slotKindsLabel`, `type DiscoverSlotKind`
  (`discoverSlotKind`), `discoverWindowLayout`, the `RADIO_HOOK_*` / `RADIO_DIG_*` tooltips and
  words it uses (`radioHooks`), `radioFlashOpacity`, `type RadioReadoutRow` (`radioReadout`),
  `type RadioApproach`, `type RadioSlotFlag`, `type ArrangeRole`, `type Stem`; plus
  `type DiscoverCandidate`, `type DiscoverSlot` (`import type { DiscoverSlot } from './DiscoverPanel'`:
  a type-only import, no runtime cycle), `peekResolvedCandidateStem`, `resolveCandidateStem`,
  `type ResolvedCandidateStem` (`./discoverCandidateStem`) and the grid constants
  (`./discoverRowGrid`). Let `npm run typecheck` complete the list. The panel imports
  `DiscoverSlotRow` from `./DiscoverSlotRow`.

- [ ] **Step 4: Prune.** `npm run typecheck` (with `noUnusedLocals`) lists every panel import the
  move left unused (the Phosphor icons only the row used, `DiscoverKindPicker`, `LoopLines`,
  `stemColorVar`, `startPointerDrag`, `MATCH_METER_STEPS`, ...): delete exactly those. Keep
  `SkipForward` (the header's skip uses it).

- [ ] **Step 5: Prove it is a move.** Each of these prints nothing but the one `export` line:

```bash
cd /Users/nickel/Claudecode/sssketch
old() { git show HEAD:src/renderer/src/components/DiscoverPanel.tsx; }
diff <(old | sed -n '/^function DiscoverSlotRow(/,/^}$/p') \
     <(sed -n '/^export function DiscoverSlotRow(/,/^}$/p' src/renderer/src/components/DiscoverSlotRow.tsx)
for f in LockGlyph RowIconButton RadioRoleButtons; do
  diff <(old | sed -n "/^function $f(/,/^}$/p") \
       <(sed -n "/^function $f(/,/^}$/p" src/renderer/src/components/DiscoverSlotRow.tsx)
done
diff <(old | sed -n '/^function resolveCandidateStem(/,/^}$/p') \
     <(sed -n '/^export function resolveCandidateStem(/,/^}$/p' src/renderer/src/components/discoverCandidateStem.ts)
diff <(old | sed -n '/^function discoverRowGridColumns(/,/^}$/p') \
     <(sed -n '/^export function discoverRowGridColumns(/,/^}$/p' src/renderer/src/components/discoverRowGrid.ts)
grep -n "^function DiscoverSlotRow\|^function RowIconButton\|^const DISCOVER_ROW_GRID_COLUMNS\|^const resolvedCandidateCache" src/renderer/src/components/DiscoverPanel.tsx   # nothing
grep -c "gridColumn" <(old | sed -n '/^function DiscoverSlotRow(/,/^}$/p') src/renderer/src/components/DiscoverSlotRow.tsx   # same count in the row's span as before
```

- [ ] **Step 6: Verify.** `npm run typecheck`, `npm run lint` (no new warnings: the two `.ts`
  modules export no components, `DiscoverSlotRow.tsx` exports only a component), `npm test`.
  `wc -l` the panel: about 12,300.

- [ ] **Step 7: Commit** (`--only` the four files): `discover: DiscoverSlotRow moves to its own file, verbatim (radio view plan Task 4) -- with LockGlyph, RowIconButton and RadioRoleButtons; the candidate-stem resolver (resolveCandidateStem, its peek and caches) and the row grid constants move to discoverCandidateStem.ts and discoverRowGrid.ts, which the panel and the row both import. No behaviour change; DiscoverPanel.tsx 14211 -> ~12300 lines`, then the trailer.

### Task 5: Name the row's parts (pure refactor, grid only)

**Depends on:** Task 4.

**Files:** Modify `src/renderer/src/components/DiscoverSlotRow.tsx`.

The radio layout (Task 7) arranges the SAME elements differently. So that every button keeps one
implementation, each part of the row's return becomes a local constant first, with the grid
assembled from them exactly as today.

- [ ] **Step 1: `RowIconButton`'s `gridColumn` becomes optional** (`gridColumn?: number`); its
  style keeps `gridColumn` (undefined is no placement). `RadioRoleButtons` takes an optional
  `columns?: [number, number]` (default `[16, 17]`) and passes `gridColumn={columns?.[0]}` /
  `[1]`, so Task 7 can pass none.

- [ ] **Step 2: A placement helper.** Inside `DiscoverSlotRow`, before `return`:
  `const at = (n: number): { gridColumn?: number } => ({ gridColumn: n })`. (Task 7 makes it return
  `{}` in the radio layout.)

- [ ] **Step 3: Name the parts.** Move each child of the grid `div`, unchanged except that its
  `gridColumn: N` becomes `...at(N)` (in a style object) or `gridColumn={at(N).gridColumn}` (on a
  `RowIconButton`), into a constant declared just before `return`:
  `removeButton` (col 1), `lockButton` (2), `muteSolo` (the `hasStemToActOn && <>m s</>` fragment,
  3-4), `waveformCell` (the col-5 `div` with the waveform, placeholder and today's readout
  overlay), `kindsBlock` (7), `skipButton` (10), `nearbyButton` (11, still conditional on
  `nearbyAnchor`), `anyStemButton` (12), `duplicateButton` (13), `likeButton` (14, still
  conditional on `hasStemToActOn`), `dislikeButton` (15), `roleButtons` (the `(radioOn ||
  foldTrack) && <RadioRoleButtons/>`), `foldReadoutCell` (18), and `popovers` (the three popovers
  after the grid). The spacer cells (6, 8) and the divider (9) stay inline in the grid. The return
  is then the same tree: `<><div style={...grid}>{removeButton}{lockButton}{muteSolo}{waveformCell}<div style={{ gridColumn: 6 }} />{kindsBlock}...{foldReadoutCell}</div>{popovers}</>`
  in today's child order.

- [ ] **Step 4: Prove it is a no-op.** Every placement is still there, once:

```bash
cd /Users/nickel/Claudecode/sssketch
git show HEAD:src/renderer/src/components/DiscoverSlotRow.tsx | grep -o "gridColumn[:=] *{\?[0-9A-Z_]*" | sort | uniq -c
grep -o "at([0-9]*)\|gridColumn[:=] *{\?[0-9A-Z_]*" src/renderer/src/components/DiscoverSlotRow.tsx | sort | uniq -c
```
  The second list has the same numbers as the first (as `at(N)`, plus the two spacers and the
  divider still inline and `DISCOVER_WAVEFORM_COLUMN` as `at(DISCOVER_WAVEFORM_COLUMN)`). Read the
  diff once more for any style property that changed: none may.

- [ ] **Step 5: Verify, commit.** `npm run typecheck`, `npm run lint`, `npm test`. Message:
  `discover row: its parts named (radio view plan Task 5) -- each button, the waveform cell, the kinds block and the popovers become local constants the grid assembles in today's order; RowIconButton's gridColumn optional, RadioRoleButtons' columns optional. No behaviour change`, then the trailer.

### Task 6: Radio controls, and `Dial.disabled`

**Parallel-safe with Tasks 1-5** (touches only `Dial.tsx`, `DiscoverRadioMenu.tsx` and a new file).

**Files:**
- Create: `src/renderer/src/components/RadioControls.tsx`
- Modify: `src/renderer/src/components/DiscoverRadioMenu.tsx`
- Modify: `src/renderer/src/components/Dial.tsx`

- [ ] **Step 1: `Dial` gains `disabled?: boolean`** (default false). When disabled: `tabIndex={-1}`,
  `aria-disabled`, every handler returns early (pointer down/move/up, wheel via `latest.current`,
  keys, double-click), `cursor: 'default'`, and the arc and pointer stroke in `--ra-text-4`
  instead of `--ra-text` (the track stays `--ra-border-strong`). Read `disabled` in the wheel
  listener through `latest` (it is attached once). A disabled dial still renders its value. No
  caller passes it yet, so nothing changes.

- [ ] **Step 2: Move the menu's three controls.** Cut `FoldSlider`, `PaceSlider` and
  `FoldSeedInput` from `DiscoverRadioMenu.tsx`, verbatim, into `RadioControls.tsx` (with their
  imports), `export` them, and import them back into the menu. The menu renders exactly as
  before.

- [ ] **Step 3: Range sliders blur after a pointer gesture** (spec 1.3: `t` works straight after a
  drag; Tab focus is kept). In both `FoldSlider` and `PaceSlider`: a `pointerRef = useRef(false)`;
  `onPointerDown={() => { pointerRef.current = true }}`; `onPointerUp={(e) => { commit(); if (pointerRef.current) { pointerRef.current = false; e.currentTarget.blur() } }}`.
  `onBlur` still commits (a second commit is a no-op: `draft` is null by then). Both take an
  optional `width?: number` (default 96, the menu's; the strip passes 72).

- [ ] **Step 4: Escape in the seed field.** `FoldSeedInput`'s `onKeyDown` gains:
  `if (e.key === 'Escape') { e.stopPropagation(); setDraft(null); e.currentTarget.blur() }`.
  React's `stopPropagation` stops the native event at the React root, before `LibraryBrowser`'s
  window-level Escape (which closes the whole library) and before App's window shortcuts. Inside
  the old menu nothing changes: the menu's capture-phase handler sees Escape first and closes it.

- [ ] **Step 5: The strip's widgets** (exported, used from Task 8), all monochrome, sharp corners,
  `fontFamily: 'inherit'`:
  - `StripChip({ label, on, onClick, tooltip?, dimmed?, disabled? })`: the menu's chip (fontSize
    9, `padding: 'var(--ra-s-0) 8px'`, `--ra-border` / `--ra-text-2`; on: `--ra-text` border and
    ink on `--ra-bg-row-active`), `aria-pressed={on}`. `dimmed` draws `--ra-text-4` ink (the
    turn chips' `not now`).
  - `StripWordSwitch({ label, on, onChange, tooltip })`: one button reading `fold: on` /
    `fold: off` (the state word `--ra-text` when on, `--ra-text-3` when off; the label
    `--ra-text-2`), `aria-pressed={on}`, `aria-label={`${label} mode`}`.
  - `StripDial({ label, value, onChange, onCommit?, defaultValue, tooltip?, disabled?, dimmed?, before?, after? })`:
    a `Dial` at `size={22}` with its caption to the right on one line (fontSize 8, `--ra-text-3`),
    `before`/`after` for the source dial's `endlesss` / `other` captions, `opacity: 0.4` when
    `dimmed` (the add row's faves treatment).
  - `StripGroup({ caption, children })`: `role="group"`, `aria-label={caption}`, `display: flex`,
    `flexWrap: wrap`, `alignItems: center`, `gap: '4px 10px'`, `minWidth: 0`, `maxWidth: '100%'`,
    the caption first in `--ra-text-4` at `var(--ra-fs-9)`.

- [ ] **Step 6: Verify, commit.** Typecheck, lint, test. Grep: `grep -n "function PaceSlider\|function FoldSlider\|function FoldSeedInput" src/renderer/src/components/*.tsx` finds them only in `RadioControls.tsx`. Message: `radio view: RadioControls (plan Task 6) -- the menu's pace, fold sliders and seed field move to their own file (the menu imports them, unchanged); range sliders let go of focus after a pointer drag so t works at once (Tab keeps it); Escape in the seed field reverts it and stops there, never closing the library; the strip's chip, word switch, captioned dial and group; Dial gains disabled. Unseen by any agent`, then the trailer.

---

## Phase 3: the radio view

### Task 7: Rows in the radio layout (THE RISKY STEP)

**Depends on:** Tasks 2, 4, 5.

**Files:**
- Create: `src/renderer/src/components/RadioRowPlates.tsx`
- Modify: `src/renderer/src/components/DiscoverSlotRow.tsx`
- Modify: `src/renderer/src/components/DiscoverPanel.tsx`

**What must not break** (spec section 6), each with its check in Step 8:
1. **No row remounts when radio toggles.** A remount drops `resolved`, `rerollAction`, the open
   popovers and an in-progress gain drag, and its `onResolvedChange(null)` cleanup would pull the
   row out of the playing mix (an audible restart). So `DiscoverSlotRow` keeps its type and `key`,
   inside the SAME `rowsRef` `div`, at the same child index of the panel's root, in both modes.
2. **The writes outside React:** `--discover-breath` on `rowsRef`, `sweepLineRef`'s `left`, and
   `[data-fold-dot]` under `rowsRef` (the sweep layout effect, `DiscoverPanel.tsx` :1325-1393).
3. **The one playhead** sits over the waveforms in both layouts.

- [ ] **Step 1: `RadioRowPlates.tsx`.** Props: `plates: RadioRowPlates` (from
  `@shared/radioRowPlates`), `slotId: string`, `hookAwayName: string | null`,
  `onBringHookBack: () => void`. Renders, inside the waveform cell (which is `position:
  relative`), all `aria-hidden` and `pointerEvents: 'none'` except the away-name button:
  - plate style (shared const): `background: 'color-mix(in srgb, var(--ra-bg-page) 80%, transparent)'`,
    `padding: '1px 3px'`, `fontSize: 8`, `lineHeight: 1`, `whiteSpace: 'nowrap'`, no radius;
  - **info** (when `plates.info`): `position: absolute; top: 2px; left: 4px; display: flex;
    maxWidth: 'calc(100% - 56px)'`, `--ra-text`; a label span (`flex: '0 1 auto', minWidth: 0,
    overflow: hidden, textOverflow: ellipsis`) then the tail span (`flex: 'none'`);
  - **fold** (when `plates.fold`): `top: 2px; right: 4px`, column, `alignItems: flex-end`,
    `gap: 3`, `--ra-text-2`; the label, then a 28px track (`height: 1`, `--ra-text-3`, relative)
    holding the dot `<span data-fold-dot={slotId} style={{ position: 'absolute', top: -1, width: 3, height: 3, marginLeft: -1, background: 'var(--ra-text)', display: 'none' }} />`
    (identical to today's dot: the sweep effect shows, hides and moves it);
  - **the bottom bar**: `position: absolute; bottom: 0; left: 0; right: 4px; display: flex;
    alignItems: flex-end; gap: 6`; in it, when `hookAwayName !== null`, the away name button
    moved from today's readout line (keep `type="button"`, `data-hook-away`,
    `data-tooltip`/`aria-label` `RADIO_HOOK_BRING_BACK_TOOLTIP`, `onClick={onBringHookBack}`), as a
    transparent hit box (`padding: '17px 8px 2px 4px'`, `flex: '0 1 auto'`, `minWidth: 0`,
    `pointerEvents: 'auto'`, `cursor: pointer`, `--ra-text-2`, hover `--ra-text`) around the
    name on a plate (ellipsized); then the **cue** (when `plates.cue`), `flex: 'none'`,
    `margin: '0 0 2px auto'`, `gap: 6`, `--ra-text-2`: the flash word in `--ra-text` at
    `opacity: cue.flash.opacity`, then `cue.next`.
  The whole layer is `aria-hidden` except the away button (it is a real control).

- [ ] **Step 2: The row takes the layout.** New props on `DiscoverSlotRow`:
  `layout: 'grid' | 'radio'`, `rowNumber: number`, `plates: RadioRowPlates` (Task 2's type). In
  the radio layout, `at` returns `{}`.

- [ ] **Step 3: The radio assembly.** When `layout === 'radio'`, return (same Fragment, same
  `popovers` after it):

```tsx
<div
  role="group"
  aria-label={radioRowLabel /* `row ${rowNumber}` or `row ${rowNumber}: ${radioReadout.label}` */}
  style={{
    position: 'relative',
    padding: '4px 6px',
    marginBottom: 4,
    background: /* today's radioApproach color-mix, unchanged, the same expression */,
  }}
>
  {holding && (
    <span aria-hidden style={{ position: 'absolute', left: 0, top: 6, bottom: 6, width: 2,
      background: 'color-mix(in srgb, var(--ra-text) 45%, transparent)', pointerEvents: 'none' }} />
  )}
  <div style={{ display: 'flex', alignItems: 'center', gap: 4, height: 20 }}>
    {muteSolo}{skipButton}{likeButton}{dislikeButton}
    <span data-slot="radio-role" style={{ display: 'contents' }}>{roleButtons}</span>
    <span style={{ marginLeft: 'auto' }} />
    {anyStemButton}{nearbyButton}{duplicateButton}{kindsBlock}{lockButton}{removeButton}
  </div>
  {waveformCell}
</div>
```
  - `muteSolo`, `likeButton` and `nearbyButton` keep their own conditions; in a flex line a
    missing one shifts its neighbours, which is fine here (no grid to keep).
  - `roleButtons` renders `<RadioRoleButtons columns={undefined} .../>` (no placement) whenever
    radio runs (in this layout, always).
  - **👍 in the radio layout shows only the star:** `holding` no longer inverts it (background
    `--ra-bg-row-active`, border `--ra-recording-live` when favourited else `--ra-border`, ink
    `--ra-recording-live` when favourited else `--ra-text-2`); tooltip, `aria-label`,
    `aria-pressed` and `aria-description="holding longer"` unchanged. The grid layout keeps
    today's look (radio is never on there after this task, so it never shows holding anyway).
  - **`kindsBlock` in the radio layout is one line:** `flexDirection: 'row'`, `alignItems:
    'center'`, `gap: 6`, `width: 'auto'`, `whiteSpace: 'nowrap'`; the kind button keeps its 110px
    max (`maxWidth: 110`); the meter after it, `flexWrap: 'nowrap'`. Same elements, same handlers.
  - **`waveformCell` in the radio layout:** `width: '100%'`, `minWidth: 0` (not
    `DISCOVER_WAVEFORM_MIN_WIDTH`), still `position: relative`; today's readout overlay (the
    `radioReadout !== null && <div aria-hidden ...>` block with the away button in it) is NOT
    rendered; `<RadioRowPlates plates={plates} slotId={slot.id} hookAwayName={hookAwayName} onBringHookBack={onBringHookBack} />`
    is, after the waveform/placeholder. Every waveform child (`handleGainDragStart`, the
    resolving placeholder, `no match`, the date tooltip, `RepeatedWaveform`, the gain line,
    `LoopLines`) is the same element.
  - `foldReadoutCell` is not rendered in the radio layout (the plate replaces it).
  - Every button keeps its 18x18 size, tooltip, aria-label, disabled/dimmed/pulsing rule and
    Cmd-click meaning, because they are the same constants.

- [ ] **Step 4: The panel passes the layout** (`slots.map`, :11950): `slots.map((slot, i) => (`,
  `layout={radioOn ? 'radio' : 'grid'}`, `rowNumber={i + 1}`,
  `plates={radioRowPlates(radioReadoutRows.get(slot.id) ?? null, radioFoldReadouts.get(slot.id) ?? null)}`.
  Keep every existing prop (`foldTrack`, `foldReadout`, `radioReadout` stay for the grid until
  Task 13). Do NOT wrap the map, the wrapper or the rows in anything new.

- [ ] **Step 5: The rows wrapper switches style, not element** (:11940):

```tsx
<div
  ref={rowsRef}
  data-radio-view={radioOn ? '' : undefined}
  style={radioOn ? { position: 'relative', maxWidth: 1200, margin: '0 auto' } : { position: 'relative' }}
>
```

- [ ] **Step 6: The playhead overlay keeps its three elements** (:12024-12059). Same outer `div`,
  same inner cell `div`, same line `div ref={sweepLineRef}`; only styles switch:
  - outer: grid mode as today; radio mode `{ position: 'absolute', top: 0, bottom: 0, left: 6, right: 6, pointerEvents: 'none' }`
    (no grid);
  - cell: grid mode as today; radio mode `{ position: 'absolute', inset: 0 }`;
  - line: unchanged (its `left` is a percentage of the cell, which is the waveform span in both
    layouts: the radio rows' waveform is the row width less 6px each side).
  Then add `radioOn` to the sweep layout effect's deps (`[pos, playing, sweepActive, previewLoopBars, radioOn]`)
  so the line is re-placed when the layout switches with the transport paused.

- [ ] **Step 7: Typecheck, lint, test.**

- [ ] **Step 8: The checks this task exists for.** Run each; every expected result must hold:

```bash
cd /Users/nickel/Claudecode/sssketch
P=src/renderer/src/components/DiscoverPanel.tsx; R=src/renderer/src/components/DiscoverSlotRow.tsx
grep -c "ref={rowsRef}" $P                  # 1: one wrapper, both modes
grep -c "ref={sweepLineRef}" $P             # 1: one line element, both modes
grep -n "<DiscoverSlotRow" $P               # 1 site, inside the rowsRef div, not inside a conditional
grep -c "data-fold-dot={slot.id}" $R        # 1 (the grid's readout cell); and:
grep -c "data-fold-dot={slotId}" src/renderer/src/components/RadioRowPlates.tsx   # 1
grep -n "querySelectorAll<HTMLElement>('\[data-fold-dot\]')" $P   # still on rowsRef.current
grep -n "setProperty('--discover-breath'" $P                      # still on rowsRef.current (2 sites)
grep -n "data-hook-away" $R src/renderer/src/components/RadioRowPlates.tsx  # in both until Task 13
```
  And by reading the panel's return: between the root `div` and `ref={rowsRef}` every sibling
  before it is a single expression (`{cond && <X/>}` or `{radioOn ? <A/> : <B/>}`), never a
  `.map` or an array whose length changes with radio. That is what keeps the wrapper's child
  index, and so every row's identity, stable.
  Elling's walkthrough items 2-5 confirm it by ear and eye (no restart, no blink, a popover open
  across a toggle).

- [ ] **Step 9: Commit** (`--only` the three files): `discover radio: rows in the radio layout (radio view plan Task 7, spec 1.2) -- while radio runs each row is a button line (m s skip 👍 👎 hook dig, then any stem, nearby, duplicate, kinds and meter on one line, lock, remove) over a full-width waveform with the web's plates (label and whole tail top left, cue bottom right with the away hook's name bottom left, fold's 7 / 16 and phase dot top right; RadioRowPlates over @shared/radioRowPlates); holding is a 2px bar at the row's left edge and 👍 shows only the star; rows capped at 1200px. The same DiscoverSlotRow elements in the same rowsRef wrapper in both modes (no remount), the playhead overlay's three elements restyled not replaced, the sweep effect re-runs on the switch. Unseen by any agent`, then the trailer.


### Task 8: The strip: play, picks, shape, fold, mix

**Depends on:** Tasks 1, 6, 7.

**Files:**
- Create: `src/renderer/src/components/RadioStrip.tsx`
- Modify: `src/renderer/src/components/DiscoverPanel.tsx`

The strip renders right after the rows wrapper while radio runs (planning decision 8: the old
header and its menu still show too until Task 10). This task moves the add row's four picks
controls into it and adds every menu setting; the sound group follows in Task 9.

- [ ] **Step 1: `RadioStrip.tsx`.** It calls `radioStripModel(settings, ctx)` and draws each group
  with `StripGroup`, each control by `kind` and `id`:
  - `chips` → one `StripChip` per chip, `onClick={() => onSettingsChange(chip.patch)}`, the
    control's caption before them (`--ra-text-3`, `fontSize: 9`, with the control's tooltip as
    `data-tooltip` on the caption, as the menu's row label had);
  - `slider` → `id === 'pace'`: `PaceSlider` (`value`, `fold={settings.foldMode}`, `width={72}`,
    `onCommit={(v) => onSettingsChange(c.patch(v))}`), with `data-tooltip={c.tooltip}` on a
    wrapping label; else `FoldSlider` (`label`, `value`, `width={72}`) likewise;
  - `switch` → `StripWordSwitch`;
  - `seed` → `FoldSeedInput` (`value`, `onCommit={(s) => onSettingsChange(c.patch(s))}`) and a
    `StripChip` `new` (`onClick={() => onSettingsChange(c.patch(newFoldSeed()))}`);
  - `panel` → by id, from the prop bundles below (tempo, skip, new bed, faves, source, matching,
    artist, my sounds, turn, the mix actions; sound is Task 9: until then `RadioStrip` skips the
    `sound` group).
  Container: `display: flex; flexWrap: wrap; alignItems: center; justifyContent: center; gap:
  '4px 24px'; padding: '8px 12px 10px'; borderTop: '1px solid var(--ra-border)'` (sticky comes
  in Task 10, with the top line).

  Props (bundles, so the call site reads):

```ts
interface RadioStripProps {
  settings: RadioSettings
  onSettingsChange: (patch: Partial<RadioSettings>) => void
  ctx: RadioStripContext
  play: {
    tempoText: string; onTempoText: (t: string) => void; onTempoFocus: () => void
    onTempoCommit: () => void; onTempoStep: (delta: 1 | -1) => void
    seedTempo: number | null; bpm: number; onMatchSeed: () => void
    onSkip: () => void; onNewBed: () => void; skipFlicker: number
  }
  picks: {
    faves: number; onFavesPreview: (v: number) => void; onFavesCommit: (v: number) => void
    favesTooltip: string
    source: number; onSource: (v: number) => void
    matching: number; onMatching: (v: number) => void
    artistLabel: string; artistActive: boolean; artistOpen: boolean
    artistButtonRef: React.RefObject<HTMLButtonElement | null>
    onArtistButton: (e: React.MouseEvent<HTMLButtonElement>) => void
    mySounds: boolean; onMySounds: () => void; mySoundsTooltip: string | undefined
  }
  turn: {
    shown: { move: TurnaroundMove | null } | null
    can: { moves: readonly TurnaroundMove[] } | null
    flash: string | null
    onTurn: (move?: TurnaroundMove) => void
  }
  mix: {
    rolling: boolean; onSimilarAll: (immediate: boolean) => void
    keep: { label: string; disabled: boolean; tooltip: string | undefined; pulse: boolean; onClick: () => void }
    hearts: { label: string; disabled: boolean; tooltip: string | undefined; pulse: boolean; onClick: () => void }
    shelf: { label: string; disabled: boolean; tooltip: string | undefined; pulse: boolean; onClick: () => void }
    timeline: { label: string; disabled: boolean; listenOnly: boolean; tooltip: string | undefined; pulse: boolean; onClick: () => void }
  }
}
```
  (Check `radioTurnCan`'s real type in the panel, :3271, and match it.) Each panel control is
  today's element moved, with its exact styles, labels and states, from where it is now:
  - `tempo`: header row 1's `tempo` caption, `−`, number field (`aria-label="Tempo (BPM)"`), `+`,
    `bpm`, and `match seed (N)` while `seedTempo !== null && seedTempo !== bpm`;
  - `skip`: a word button `skip` (`data-tooltip="skip a row"`, `aria-label="skip a row"`), whose
    text is `<span key={play.skipFlicker} className={play.skipFlicker > 0 ? 'radio-landing-flicker' : undefined}>skip</span>`
    (the class does nothing until Task 12 adds its CSS);
  - `new-bed`: a `StripChip` `new bed` (not pressed) calling `onNewBed`;
  - `faves`, `source` (with `before="endlesss"` / `after="other"`), `matching`: `StripDial`s with
    today's values, defaults (`DEFAULT_FAVES`, `DEFAULT_SOURCE_LEAN`, `100 - DEFAULT_DISCOVER_CHAOS`),
    `ariaLabel`s and tooltips (faves `dimmed` from the model);
  - `artist`: header row 2's artist button, moved, with `ref={picks.artistButtonRef}`;
  - `my-sounds`: the add row's `BracketToggle` (`checked={!c.disabled && picks.mySounds}`,
    `disabled={c.disabled}`, tooltip `picks.mySoundsTooltip`);
  - `turn`: header row 2's turn button and move chips, moved with their exact look (the turn
    button keeps its inverted fill while a turn waits; held chip inverted; `not now` chips
    `--ra-text-4` with tooltip `not now`); the chips sit after the button on the same line;
  - `similar-all`, `keep`, `fetch-hearts`, `add-to-shelf`, `add-to-timeline`: header row 2's
    buttons, moved with their exact look (dice spinning, `keeping…`, `fetching…`, `✓ added`,
    `discover-add-pulse`, listen-only dimming and tooltips).

- [ ] **Step 2: The panel renders it** after the rows wrapper's closing tag, before the add row:
  `{radioOn && <RadioStrip ... />}`. Build `ctx` with `artistMode: mode === 'other'`,
  `hasUsername`, `sound: soundNow` (Task 9 adds it; until then pass
  `normalizeSoundSettings(sound ?? appSoundDefaultsNow())` through a `useMemo` on `[sound]`
  named `soundNow`), `sounding: previewingSlotIds.size > 0`. Wire every bundle to the handlers the
  header and add row use today (`dispatch({ type: 'SET_TEMPO', ... })`, `commitTempo`,
  `setTempoFocused(true)`, `skipRadio`, `collectRadioCourseChange`, `previewFaves`/`commitFaves`/
  `favesShown`, `changeSourceLean`, `setChaos(100 - m)`, the artist button's open/close, 
  `setGlobalModifiers(toggleSlotModifier(...,'mine'))`, `turnRadio`, `rerollAll`, `keepGroup`,
  `fetchHearts`, `addToShelf`, `addToTimeline`), and `onSettingsChange={(p) => void onRadioSettingsChange(p)}`.
  `skipFlicker`: pass `0` until Task 12.

- [ ] **Step 3: The add row loses four controls while radio runs.** In the add row (:12062-12299)
  the faves dial and the modifiers line, and the right-hand column with source and matching,
  render only with `!radioOn` (the grid's columns stay, so the chip list stays centred). The
  artist button in header row 2 renders only with `!radioOn`, and the
  `{artistMenu && <DiscoverArtistPicker .../>}` block moves out of header row 2 to just after the
  strip, unchanged, so either button opens it (one `artistButtonRef`, one button at a time).

- [ ] **Step 4: Verify, commit.** Typecheck, lint, test. Grep: `grep -n "<DiscoverArtistPicker" src/renderer/src/components/DiscoverPanel.tsx` (one site, outside the header). Message:
  `discover radio: the strip (radio view plan Task 8, spec 1.3) -- while radio runs, under the rows: play (tempo, pace, skip, new bed), picks (faves, source, matching, artist, my sounds, density, channels, the new turnover chips), shape (phrase, loop end, transitions, turnarounds, moves, depth, builds, turn), fold (switch; bend, mismatch, seed), mix (similar all, keep, fetch hearts, add to shelf/timeline), drawn from @shared/radioStripModel; the add row's four picks controls and the artist button move into it while radio runs. The header and menu still show until Task 10. Unseen by any agent`, then the trailer.

### Task 9: The strip's sound group

**Depends on:** Task 8.

**Files:** Modify `RadioStrip.tsx`, `DiscoverPanel.tsx`.

- [ ] **Step 1: The bundle.** `RadioStripProps` gains

```ts
sound: {
  level: number; onLevel: (v: number) => void
  reverb: number; onReverbDraft: (v: number) => void; onReverbCommit: (v: number) => void
  cutoff: number; cutoffDefault: number; onCutoff: (v: number) => void
  resonance: number; onResonance: (v: number) => void
  filterMode: FilterMode; onFilterMode: () => void
  onSoundPatch: (patch: SoundSettingsPatch) => void
}
```
  and draws the `sound` group: `level`, `reverb`, `filter`, `res` as `StripDial`s with the master
  strip's values, defaults (100, 0, `neutralCutoff(mode) * 100`, 0), aria-labels and tooltips,
  `disabled` from the model (nothing sounding); `filter-mode` as the master strip's word button
  (`lo pass` / `hi pass`), disabled the same way; `saturation`, `pump`, `echo` (kind `sound`) as
  `StripDial`s through a tiny local `StripSoundDial`: `const [draft, setDraft] = useState<number | null>(null)`,
  `value={draft ?? soundDialPosition(c.control)}`, `onChange={setDraft}`,
  `onCommit={(pos) => { onSoundPatch(c.control.patch(soundDialValue(c.control, pos))); setDraft(null) }}`,
  `defaultValue={soundDialPosition(c.control, <the default's value>)}` (read the default from
  `soundPanelModel(DEFAULT_SOUND_SETTINGS)` by the same id), `disabled={c.disabled}`,
  `tooltip={c.tooltip}`, caption `c.label`.

- [ ] **Step 2: The panel wires it** to the master strip's own state and handlers, moved from its
  JSX into the bundle as they are (`setMasterLevel` + `masterLevelRef` + `pushMasterLevel`;
  `setMasterSendDraft` / `commitMasterSend`; the cutoff and resonance writers into
  `masterFilterRef` + `pushMasterFilter`; `toggleMasterFilterMode`), and
  `onSoundPatch={(patch) => dispatch({ type: 'SET_SOUND_SETTINGS', settings: patch })}`: exactly
  `SoundSettingsPanel`'s project-mode commit (undoable, saved with the project; the panel's
  `[sound]` effect resyncs the preview once per release). To avoid two copies of the master
  dials' handlers, lift each inline handler from the master strip into a named function in the
  panel (`setMasterLevelLive`, `setMasterCutoffLive`, `setMasterResonanceLive`) and use it in both
  places.

- [ ] **Step 3: The master strip hides while radio runs:** its condition becomes
  `previewingSlotIds.size > 0 && !radioOn`.

- [ ] **Step 4: Verify, commit.** Typecheck, lint, test (`radioStripModel.test.ts` covers the
  greying and patches). Message: `discover radio: the strip's sound group (radio view plan Task 9) -- level, reverb, filter, res and the filter mode (the master strip's, which hides while radio runs; greyed while nothing sounds), and saturation, pump and echo: the sound panel's own sliders as dials, greyed when the panel greys them (saturation needs mastering; a stage switched off in sound) and committed on release as SET_SOUND_SETTINGS -- the open project's sound, undoable, marks it unsaved (Elling, 2026-10-04). Unseen by any agent`, then the trailer.

### Task 10: The top line; the old header goes while radio runs; sticky

**Depends on:** Task 9.

**Files:**
- Create: `src/renderer/src/components/RadioTopLine.tsx`
- Modify: `src/renderer/src/components/DiscoverPanel.tsx`, `RadioStrip.tsx`

- [ ] **Step 1: `RadioTopLine.tsx`.** Props: `playing`, `canPlay` (`previewingSlotIds.size > 0`),
  `onPlayToggle`, `onStopRadio`, `radioButtonRef`, `progress` (0..1), `readout:
  RadioReadout | null`, `foldSummary: string | null`, `canUndo`, `canRedo`, `onUndo`, `onRedo`,
  plus `UndoIcon` / `RedoIcon` (move both from the panel into this file and export them; the
  panel's header keeps using them through the import). Layout (the web's `.top`):
  `position: 'sticky', top: 0, zIndex: 2, background: 'var(--ra-bg-page)'`,
  `display: 'flex', alignItems: 'flex-start', gap: 10, padding: '4px 0 8px'`:
  - left corner: today's play/stop button (identical); `radio` (today's lit look, `--ra-play-on`;
    `data-tooltip="stop radio"`, `onClick={onStopRadio}`) with today's 2px interval line under it
    (`radioProgress`);
  - middle, `flex: '1 1 0', minWidth: 0`, centred column, `gap: 3`, `fontSize: 9`,
    `--ra-text-2`: the status line (wraps: `whiteSpace: 'normal', overflowWrap: 'anywhere'`;
    hidden when empty); the ruler (`aria-hidden`, `width: '100%', maxWidth: 320`, ticks `flex: 1`
    1px, played `--ra-text`, unplayed `--ra-text-4`, end label `--ra-text-3` `fontSize: 9`); fold's
    summary (`nowrap`, ellipsis, `maxWidth: '100%'`), only when given. No `aria-live`.
  - right corner: undo and redo, identical to today's (undo enabled while a turn waits).

- [ ] **Step 2: The panel's header switches.** The two header rows (:11161-11778, the
  `display: flex` row 1 and row 2) become ONE expression:
  `{radioOn ? <RadioTopLine ... /> : <>{row 1}{row 2}</>}`. The radio-off branch is today's JSX
  minus what only showed with radio on: the skip square, the chevron, the turn group, the readout
  span, fold's status span and the `{radioMenu && <DiscoverRadioMenu/>}` block (all `radioOn &&`
  today). The `radio` button in row 2 stays (it opens the start prompt). The notes (lingering,
  artist) stay right after this expression, unchanged. Keep it one expression so the rows
  wrapper's child index does not move (Task 7, Step 8).

- [ ] **Step 3: The strip is sticky.** `RadioStrip`'s container gains
  `position: 'sticky', bottom: 0, zIndex: 2, background: 'var(--ra-bg-page)'` (both sticky
  bars need a z-index: the rows wrapper is `position: relative` and would paint over them).

- [ ] **Step 4: The `DiscoverRadioMenu` `running` mode is now unreachable** (its only opener, the
  chevron, is gone). Leave the file for Task 11.

- [ ] **Step 5: Verify, commit.** Typecheck, lint, test. Grep:
  `grep -n "radioChevronRef" src/renderer/src/components/DiscoverPanel.tsx` (only the ref's
  declaration is left; Task 11 removes it). Message: `discover radio: the top line (radio view plan Task 10, spec 1.1) -- while radio runs the two header rows become one sticky line: play/stop and radio with its interval line, the readout's status line (wrapping) and ruler (up to 320px, played --ra-text) and fold's status line in the middle, undo/redo at the right; the strip is sticky at the bottom. The radio menu's chevron goes with the old header. Unseen by any agent`, then the trailer.

### Task 11: The start prompt; the menu is deleted; focus follows the switch

**Depends on:** Task 10.

**Files:**
- Create: `src/renderer/src/components/RadioStartPrompt.tsx`
- Delete: `src/renderer/src/components/DiscoverRadioMenu.tsx`
- Modify: `DiscoverPanel.tsx`, `SoundSettingsPanel.tsx`, `DiscoverArtistPicker.tsx` (comments)

- [ ] **Step 1: `RadioStartPrompt.tsx`.** `DiscoverRadioMenu`'s `start` mode, nothing else: same
  props minus `mode` and `onNewBed` (`x`, `y`, `settings`, `onChange`, `onStart`, `onClose`,
  `ignoreRef`); same position clamp, outside-click dismissal and capture-phase Escape; the pace
  row (`PaceSlider` from `RadioControls` with `onDraft`, and the `start` chip with today's
  write-if-moved rule), density, channels while density is `off`, and the hint `set a pace and
  start`. Chips: `StripChip`. Carry over the menu's doc comment's start-mode half (Elling's
  2026-09-28 rule) and say the running half became the strip.

- [ ] **Step 2: The panel.** Rename `radioMenu` / `setRadioMenu` / `closeRadioMenu` to
  `radioPrompt` / `setRadioPrompt` / `closeRadioPrompt`; delete `radioChevronRef`; the header's
  `radio` button (radio off only now) loses its `if (radioOn) { ... stopRadio() }` branch and
  toggles the prompt; render `{radioPrompt && <RadioStartPrompt ... ignoreRef={radioMenuButtonRef} />}`
  where the menu was. Delete the import of `DiscoverRadioMenu`.

- [ ] **Step 3: Focus follows the switch** (planning decision 14). A `radioTopButtonRef` on the
  top line's `radio`, and `const focusAfterSwitchRef = useRef<'top' | 'header' | null>(null)`.
  The prompt's `onStart` sets `'top'` before `startRadio(level)`; the top line's `onStopRadio` sets
  `'header'` before `stopRadio()`. An effect on `[radioOn]` focuses
  `radioTopButtonRef` / `radioMenuButtonRef` accordingly and clears the ref. (A start or stop from
  the phone never sets it, so it never steals focus.)

- [ ] **Step 4: Delete `DiscoverRadioMenu.tsx`** (`git rm`). Update the comments that name it:
  `SoundSettingsPanel.tsx` (:381, "DiscoverRadioMenu's way") and `DiscoverArtistPicker.tsx`
  (:70, "Same dismissal as DiscoverRadioMenu") now name `RadioStartPrompt`. Grep:
  `grep -rn "DiscoverRadioMenu" src` finds nothing.

- [ ] **Step 5: Verify, commit.** Typecheck, lint, test. Message: `discover radio: the start prompt is its own component; the radio menu is gone (radio view plan Task 11, spec 1.4) -- RadioStartPrompt keeps the menu's start mode (pace slider and start, density, channels with density off; same position, dismissal and Escape capture); every running setting lives in the strip; start focuses the top line's radio, stop focuses the header's. Unseen by any agent`, then the trailer.

### Task 12: Notifications: the landing flicker, `no fave fits`, `no near fits`, reduced motion

**Depends on:** Tasks 3, 11.

**Files:** Modify `DiscoverPanel.tsx`, `DiscoverSlotRow.tsx`.

- [ ] **Step 1: The CSS.** In the panel's one `<style>` tag (:11104) add:

```css
@keyframes radio-landing-flicker { 50% { color: var(--ra-playhead); } }
.radio-landing-flicker { animation: radio-landing-flicker 600ms ease-in-out; }
.discover-pending { animation: discover-slot-pulse 900ms ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) {
  .radio-landing-flicker { animation: none; }
  [data-radio-view] .discover-pending { animation: none; opacity: 0.45; }
}
```
  `--ra-playhead` is chrome colour only here, because the flicker marks an audio event (spec 2).

- [ ] **Step 2: The pending pulse becomes the class.** `RowIconButton`: drop the inline
  `animation` and pass `className={pulsing ? 'discover-pending' : undefined}`. Radio-off rows look
  the same (the class is the same animation); only reduced-motion users in the radio view see it
  still (planning decision 13).

- [ ] **Step 3: The flicker's state.** In the panel: `const radioLandingAtRef = useRef<number | null>(null)`,
  `const [radioSkipFlicker, setRadioSkipFlicker] = useState(0)`, and

```ts
/** The strip's `skip` flickers once per landing moment (@shared/radioLanding). */
function noteRadioLanding(source: RadioLandingSource): void {
  if (!radioOnRef.current) return
  const at = performance.now()
  if (!shouldFlickerLanding(radioLandingAtRef.current, at, source)) return
  radioLandingAtRef.current = at
  setRadioSkipFlicker((n) => n + 1)
}
```
  Pass `skipFlicker={radioSkipFlicker}` to the strip. Reset `radioLandingAtRef` to null in
  `startRadio`.

- [ ] **Step 4: Call it where changes land** (planning decision 12). In the clock tick:
  - the wrap / held-bar landing branch (:6768,
    `if ((step.wrapped || crossedHeldBar) && (radioLedChangeRef.current !== null || manualToLand.length > 0))`):
    right after `setManualChanges(...)` / `manualLandedIds = landingIds` (where the branch already
    sets state), `noteRadioLanding(led !== null ? 'radio' : manualToLand.some(([, m]) => m.hook !== undefined) ? 'hook' : manualToLand.some(([id]) => arcAddingRef.current?.slotId === id) ? 'arc' : 'manual-wait')`;
  - the course change's branch (:7128, `if (step.wrapped && radioCourseChangeRef.current !== null)`):
    `noteRadioLanding('course')`.
  If either site turns out to run synchronously inside the effect body rather than in the tick's
  deferred microtask, wrap the call in `queueMicrotask` (this repo errors on a synchronous setState
  in an effect). A manual Cmd change commits through `commitSlotPick` outside these branches and
  never calls it.

- [ ] **Step 5: `no fave fits` and `no near fits`** (spec 2). In `pickForSlot` (:8985-9001), next
  to the two `console.log`s (keep them):

```ts
const flashPickFallback = (word: string, tag: string): void => {
  if (!radioOnRef.current) return
  const now = radioPlayRef.current.startBars + (radioClockRef.current?.lastPos ?? 0)
  radioFlashLogRef.current = [
    ...radioFlashLogRef.current,
    { rowId: id, word, at: now, key: `${tag}@${id}@${myGeneration}` }
  ]
}
```
  call `flashPickFallback(NO_NEAR_FITS, 'near')` where `candidates === null` after a dig anchor
  (the `NO_NEAR_FITS` log), and `flashPickFallback(NO_FAVE_FITS, 'fave')` where `favesFallback`
  logs. (`toggleSlotDig` writes a flash the same way.) Import `NO_FAVE_FITS` from
  `@shared/discoverFaves`. The readout's existing flash path shows them; nothing about the pick
  changes.

- [ ] **Step 6: Verify, commit.** Typecheck, lint, test. Grep: `grep -n "noteRadioLanding(" src/renderer/src/components/DiscoverPanel.tsx` (the definition and two call sites);
  `grep -n "discover-slot-pulse 900ms" src/renderer/src/components/DiscoverSlotRow.tsx` (none:
  the class carries it; the placeholder's failed pulse is a different element and keeps its
  inline animation). Message: `discover radio: the web's notifications (radio view plan Task 12, spec 2) -- the strip's skip flickers in the playhead colour once per landing moment (radio's change, a course change, an arc row, a hook, a manual change that waited; never a Cmd change; @shared/radioLanding), no fave fits and no near fits flash on the row as on the web; with reduced motion the flicker and the radio view's pending pulse do not animate. Unseen by any agent`, then the trailer.

### Task 13: The grid's dead radio branches go

**Depends on:** Task 12.

**Files:** Modify `DiscoverSlotRow.tsx`, `discoverRowGrid.ts`, `DiscoverPanel.tsx`.

Since Task 7 the grid layout renders only with radio off, so what it drew only while radio ran is
dead (planning decision 15).

- [ ] **Step 1: The grid template.** `discoverRowGrid.ts`: delete `DISCOVER_FOLD_READOUT_TRACK`,
  `DISCOVER_RADIO_ROLE_TRACKS` and `discoverRowGridColumns`; export `DISCOVER_ROW_GRID_COLUMNS`
  (15 tracks) and use it in the row and the overlay. Update its comment: the radio layout has no
  grid.

- [ ] **Step 2: The row's grid branch.** Delete the grid's `roleButtons` and `foldReadoutCell`
  placements, today's readout overlay inside `waveformCell` (the radio layout uses
  `RadioRowPlates`), and the props only they read: `foldTrack`, `foldReadout`, `radioReadout`
  (the radio label for `aria-label` now comes from `plates.info?.label`). `RadioRoleButtons` loses
  `columns`. Update the long track comment above the grid template in the row to 15 tracks.

- [ ] **Step 3: The panel.** Stop passing the deleted props; `radioFoldReadouts` stays (it feeds
  `plates`). `radioFoldTrack` keeps its name and meaning (fold's status while radio runs) but no
  longer feeds a grid.

- [ ] **Step 4: Verify, commit.** Typecheck, lint, test. Grep:
  `grep -n "gridColumn: 1[6-8]\|gridColumn={1[6-8]}\|DISCOVER_RADIO_ROLE_TRACKS\|DISCOVER_FOLD_READOUT_TRACK" src/renderer/src/components/*.ts*`
  finds nothing; `grep -c "data-fold-dot" src/renderer/src/components/DiscoverSlotRow.tsx` is 0
  and `RadioRowPlates.tsx` 1; `grep -c "data-hook-away" src/renderer/src/components/DiscoverSlotRow.tsx` is 0.
  Message: `discover row: the grid's radio-only branches go (radio view plan Task 13) -- with radio on the rows use the radio layout, so the grid's hook/dig tracks (16-17), fold's readout track (18) and the readout overlay were dead; the grid is its 15 tracks again. No behaviour change`, then the trailer.

### Task 14: Verification, review, handoff, walkthrough

- [ ] **Step 1: Full suites.** `npm test`, `npm run typecheck`, `npm run lint`. Native: nothing
  changed (no rebuild).
- [ ] **Step 2: Grep sweep** (spec section 6, "the plan must check each by grep"):

```bash
cd /Users/nickel/Claudecode/sssketch/src/renderer/src/components
grep -c "ref={rowsRef}" DiscoverPanel.tsx                 # 1
grep -c "ref={sweepLineRef}" DiscoverPanel.tsx            # 1
grep -n "'\[data-fold-dot\]'" DiscoverPanel.tsx           # the sweep effect, on rowsRef.current
grep -n "data-fold-dot=" *.tsx                            # RadioRowPlates.tsx only
grep -rn "DiscoverRadioMenu\|radioChevronRef" ..          # nothing
grep -n "e.key === 'Escape'" RadioControls.tsx            # the seed field's, with stopPropagation
```
- [ ] **Step 3: An independent review** (superpowers:requesting-code-review) with the spec's
  sections 1.2, 1.3, 2, 5 and 6 as the checklist. Ask the reviewer to check: no conditional or
  array before the rows wrapper changes length with radio; every header control that showed with
  radio on has a home in the top line or the strip; every row button keeps its handler, tooltip
  and Cmd meaning; every `onRadioSettingsChange` patch the old menu made, the strip makes; sticky
  z-index; tokens only (no new colours; `--ra-playhead` only in the flicker); lowercase copy.
- [ ] **Step 4: Handoff.** A section in the current `docs/superpowers/HANDOFF-*.md` (or a new dated
  one); a memory file `radio_view_shipped.md` with a `MEMORY.md` line. Say plainly that no agent
  has seen the view, clicked it or heard it.

**Elling's walkthrough** (spec section 4; no agent can do any of it):
1. **Widths.** At the 945px minimum, at 1440px and full screen: the top line, rows and strip fit
   with no horizontal scroll; the strip wraps into captioned groups; at 945x614 about three rows
   show and the rest scroll between the sticky top line and strip; rows stop at 1200px wide and
   centre on a big screen.
2. **No remount.** With a loop playing, start radio and stop it: the music does not restart or
   drop out, and no waveform blinks to the loading line.
3. Open a row's kind picker or nearby popover, then press `t`: it stays open; a reroll in flight
   (its button pulsing) keeps pulsing across a radio start.
4. **The playhead** runs over the waveforms (not the buttons' column) in both layouts, also after
   switching while paused; the breath (armed, held) lights the whole two-line row.
5. **Rows:** every button works as before, Cmd-click included (skip, any stem, nearby, duplicate
   land at once); hook and dig toggle; holding shows the left bar and 👍 shows only the star; the
   away hook's name sits bottom left, tap brings it back; the label cuts before the age and role
   words do; the cue (flash, `next · ...`) bottom right; folded rows show `7 / 16` with a moving
   dot top right.
6. **The strip:** each control does what the menu or old place did (pace's readout in fold mode,
   phrase, loop end, transitions, turnarounds, moves/depth appearing with turnarounds on, builds,
   density, channels appearing with density off, turnover now settable, fold switch and its
   hidden-when-off sliders and seed, `new`).
7. **Sound:** saturation greyed with mastering off (tooltip says so); pump / echo greyed when
   switched off in the sound panel; a saturation change is undone by Cmd+Z in the arrangement and
   marks the project unsaved; level, reverb, filter, res greyed while nothing sounds.
8. **Escape in the seed field** reverts the text and the library stays open.
9. **`t` after a pace or bend drag** turns at once.
10. **Start prompt:** `radio` (off) opens it as before; `start` starts at the slider's pace and the
    top line's `radio` has focus; pressing it stops radio and returns the normal layout.
11. **Landing flicker:** `skip` in the strip flickers once when radio's change lands (once for a
    combined change), not for a Cmd change; with reduced motion on (System Settings >
    Accessibility > Display), no flicker and no pulse in the radio view.
12. **`no fave fits`:** faves at 100 with no starred stem of a row's kind: the row flashes it.
    **`no near fits`:** dig a row whose jam has nothing near: the row flashes it.
13. Switching radio off mid-change (a row breathing, a turn waiting): the normal layout comes back
    and the change lands or withdraws as it did before this work.
14. The phone remote works as before.

## Risks, per task

- **Task 4 -- a move that is not a move.** A missed import or a hand edit inside a moved body
  (the `gridColumn` numbers above all). Step 5's diffs must print only the `export` lines.
- **Task 5 -- an inline element reordered.** The grid assembly must keep today's child order (the
  explicit `gridColumn`s make order mostly cosmetic, but conditional children and the spacer
  cells must stay where they are).
- **Task 7 -- remounts.** Any change that wraps the map, moves the wrapper, or turns a sibling
  before it into a list remounts every row (lost state, an audible restart through
  `onResolvedChange(null)`). Step 8's checks and walkthrough items 2-3.
- **Task 7 -- imperative writes.** The breath (`rowsRef`), the line (`sweepLineRef`) and the fold
  dots (`[data-fold-dot]` under `rowsRef`) are written outside React; the plate's dot keeps the
  attribute and lives under the wrapper; the overlay's line element never changes parent.
- **Task 7 -- the playhead's span.** The radio overlay's 6px insets must equal the radio row's side
  padding, and the wrapper's 1200px cap applies to both because the overlay is inside it.
- **Task 8 -- two artist buttons.** Only one may render at a time (one ref); the picker is rendered
  once.
- **Task 9 -- project sound from Discover.** One `SET_SOUND_SETTINGS` per release (never per drag
  frame: the dial's `onChange` only moves the draft); each is an undo step and a preview resync.
- **Task 10 -- sticky.** Without `zIndex` the rows wrapper (positioned) paints over the bars; the
  bars' ground must be `--ra-bg-page` (LibraryBrowser's) or they read as a band.
- **Task 10 -- the header expression.** It must stay one child expression; splitting it into
  `radioOn && A` plus `!radioOn && B` keeps the index too, but a fragment that flattens into the
  parent's children list does not exist in React (fragments are one child), so either form is
  safe; an array is not.
- **Task 11 -- Escape.** Covered by Task 6's seed handler; the prompt keeps its capture. The tempo
  field's Escape still closes the library, as it does today (unchanged, not in scope).
- **Task 12 -- setState in the tick.** The landing branches already set state in the tick's
  deferred path; if not, `queueMicrotask`. A flicker must never fire with radio off.
- **Width.** The 945px estimates (spec section 5) are from Silkscreen metrics, not measured; if the
  strip is cramped, the fix is narrower captions or chip rows, never hiding settings.
