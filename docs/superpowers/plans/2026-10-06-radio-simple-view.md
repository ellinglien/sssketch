# Radio Simple View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give sssketch's radio view two views, as the web radio has `simple` and `full`:
- **advanced** is today's radio view, unchanged: every radio setting out front (the design pass of
  2026-10-04);
- **simple**, the default, keeps the controls that play:
  - the top line as today, with only `keep` of the mix actions;
  - rows with the live cluster (`m s`, skip, 👍, 👎, hook, dig), the kind label, the waveform and
    its plates; a locked row shows its padlock as a mark, not a button;
  - the live bar's tempo, pace, skip, new bed, turn and level, plus the intensity arc's `build`,
    `drop`, `energy` and `drama` while density is `intensity`;
  - no shaping columns and no move chips.
- A `simple / advanced` word switch on the top line, beside undo/redo. The choice is remembered
  across sessions. Switching never stops, restarts or changes anything that plays: hidden settings
  keep their values and keep working.

**Spec:** `docs/superpowers/specs/2026-10-05-radio-simple-view-design.md` (b89face5, approved by
Elling). Read it first; it is one page.

**Context, for the view being trimmed:**
- `docs/superpowers/specs/2026-10-03-sssketch-radio-view-design.md`, both "As built" sections;
- `docs/superpowers/plans/2026-10-04-sssketch-radio-view.md` and
  `2026-10-04-radio-view-design-pass.md` (format, the no-remount rule, the walkthroughs);
- `docs/superpowers/plans/2026-10-05-radio-intensity-arc.md`, Tasks 1, 10 and 11 and its "Overlap
  with the simple / advanced view spec" table.

**Architecture:**
- **One pure module, TDD:** `src/shared/radioView.ts`. It says what each view draws:
  - `radioViewStrip(groups, view, settings)`: the strip model's groups as a view draws them (top
    line mix, live bar, move chips, columns). Advanced is the model's own places, unchanged;
    simple picks explicit id lists;
  - `radioRowParts(view, { locked })`: a radio row's button-line parts;
  - `RadioView`, `DEFAULT_RADIO_VIEW` (`simple`), `normalizeRadioView`, and the words.
- **`radioStripModel.ts` does not change.** It stays the advanced view. Its coverage test ("every
  radio setting has a control") now collects the controls through `radioViewStrip(..., 'advanced')`.
- **The setting:** `DiscoverSettings.radioView` (the app settings file `discoverSettings.json`,
  the same store, IPC and App mirror as the radio settings and the trait match bar). It is not a
  `RadioSettings` field (planning decision 1).
- **Visibility only:** a `view` prop on `RadioTopLine`, `RadioStrip` and `DiscoverSlotRow`'s radio
  layout, plus a `shown` set on `RadioMixActions`. Same trees. Rows hide parts with conditional
  children inside the button line's existing containers; the waveform cell never moves, so no row
  remounts.

**Tech stack:** TypeScript, React 19, Electron (electron-vite), vitest (node, no DOM).

**Repo:** sssketch only (`/Users/nickel/Claudecode/sssketch`). The web radio is untouched: it
imports `@shared` but nothing it reads changes (`radioView.ts` is new; `RadioSettings` gains
nothing).

**Base and sequencing:** build AFTER the intensity arc's Task 11 (desktop strip and phone) is
committed, as the spec says: both touch the strip and the live bar. Work where the arc landed
(today `master`; the arc's commits went straight to master) or on a `radio-simple-view` branch
from it. **Do not push.** See "Assumptions about intensity arc Task 11" below for exactly what this
plan expects T11 to have done, and how to adjust if it differs.

**Commits:** every commit message ends with exactly these two lines, after a blank line:

```
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01KK8TyKjVKvWU8ZjQCk3ozz
```

Commit each task's own files only (`git commit --only <paths>`), never `git add -A`. Other agents
share this tree, and `native-engine/.cache/` is untracked and not ours. `--only` commits the whole
file as it is on disk: before each commit, `git diff <path>` must show only this task's lines. If
another agent has uncommitted edits in the same file (`App.tsx`, `DiscoverPanel.tsx`), stop and
wait for theirs to land rather than sweep them into this commit.

**Before you start:**
- Run `git status --short` and leave other agents' files alone.
- Run `git log --oneline -15` and confirm intensity arc Task 11's commit is in (its message starts
  `discover radio: build and drop on the strip and the phone`). If it is not, do Tasks 1, 2, 3
  and 5 only, and stop before Task 4.
- Run `npm test`, `npm run typecheck`, `npm run lint`. They should be green, except the
  machine-dependent engine-spawn tests (memory `coreaudiod_thread_leak`; in a checkout with no
  `native-engine/build` they fail with "binary not found" / ENOENT).
- `DiscoverPanel.tsx` (~13.6k lines) changes daily. Anchor every edit on function names and quoted
  context, never on line numbers.
- No test file here opens better-sqlite3: `radioView.test.ts` is pure and
  `discoverSettingsStore.test.ts` opens no database, so `vitest.config.ts`'s CI exclude list is
  unchanged.

**No agent can run the app, see it, hear it or click it.** Every UI task is checked by typecheck,
lint, the shared tests, the grep checks written into the task, and Elling's walkthrough (Task 6).
Say so in every commit message that touches the UI ("unseen by any agent"), and never claim a UI
change was "tested".

---

## How this plan's code was checked

Planning scratchpad:
`/private/tmp/claude-501/-Users-nickel-Claudecode-sssketch/16705ad5-406f-4f11-81e4-e91aab27bbc8/scratchpad/simple-view/`

| path | what it is |
|---|---|
| `repo/` | sssketch at `dc6450dd` (before intensity arc T11) with every change below applied |
| `orig/` | the six renderer files as they were at `dc6450dd` |
| `diffs/` | each file's diff against `dc6450dd` |

- **Every code block below is the scratch copy's file or diff, verbatim**, apart from elisions
  marked `// ... unchanged ...` and the steps that say they are instructions (Task 4's T11 merge
  points).
- **With every task in, at `dc6450dd`:**
  - `npm run typecheck` (node and web): clean;
  - `npx vitest run src/shared src/main/discoverSettingsStore.test.ts`: **179 files, 2933 tests
    passed** (the new `radioView.test.ts`: 13; the store: +1, 15 in all);
  - `npx vitest run src`: everything passes except the engine-binary tests (no
    `native-engine/build` in a scratch copy);
  - `eslint` on every changed file: 0 errors, 0 warnings;
  - `prettier --check` on every changed file: clean.
- **The coverage test still bites:** with `radioViewStrip`'s advanced branch made to return no
  columns, `sets every radio setting from some control in the advanced view` fails; reverted, it
  passes (Task 1 Step 4 repeats this check).
- **Not checked:** anything on screen. T11's changes to `RadioStrip.tsx` were not in the scratch
  copy, so Task 4's merge points with them are instructions.

## Decisions made in planning

1. **The view is `DiscoverSettings.radioView`, not a `RadioSettings` field.**
   - `DiscoverPanel` has effects keyed on `radioSettings` (for example the one ending
     `}, [pos, radioOn, radioSettings])`). A switch must re-run none of them. With its own field,
     App's merge (`{ ...discoverSettings, radioView }`) keeps the `radio` object's identity.
   - The strip's coverage test requires every `RadioSettings` key to have a strip control. The
     view is not a radio setting, and the switch is not a strip control.
   - The web radio builds its own `RadioSettings` through `@shared`; it stays untouched.
   - It persists exactly as the other radio settings do: `discoverSettings.json` in userData,
     `get-discover-settings` / `set-discover-settings`, App's whole-object mirror that merges, and
     normalized on load (`normalizeRadioView`: anything but `advanced` reads as `simple`).
2. **The helper lives in a new `src/shared/radioView.ts`**, not inside `radioStripModel.ts` (the
   spec's "e.g."). `radioStripModel.ts` stays the advanced view, untouched; main imports the
   normalizer without the strip model and the sound panel.
3. **Simple shows the arc's `build`, `drop`, `energy` and `drama` only while density is
   `intensity`.** Greyed, they would point at the density control, which simple does not show.
   Advanced keeps them greyed-not-hidden, as today. **Ask Elling** (see "Questions for Elling");
   the flip is one line (`RADIO_SIMPLE_INTENSITY_ONLY`) and one test.
4. **`build` and `drop` are in simple** (with intensity). They are one-press gestures like `turn`,
   not move chips. The intensity arc plan left this for this plan, and required that simple's
   pinned list name them either way: it does.
5. **Simple's lists are explicit ids** (`RADIO_SIMPLE_TOP`, `RADIO_SIMPLE_LIVE`,
   `RADIO_SIMPLE_ROW`), not "the play group minus the chips". A control added to the strip model
   lands in advanced only; adding it to simple is a deliberate edit and a test change.
6. **Simple's live bar order:** tempo, pace, skip, new bed, fire now (`turn`, `build`, `drop`),
   `energy`, `drama`, level.
   - `energy` and `drama` are drawn there as live-size segment bars (120px), committing on release
     and resetting to their defaults on a double-click, through the same `ColumnBar` the columns
     use (it gains a `size` prop).
   - In advanced they stay in the picks column, where intensity arc Task 1 put them. They are
     never drawn twice.
7. **The switch** is a `Segmented` (the strip's word switch) at live size, options `simple` and
   `advanced`, in the top line's right-hand group before undo.
   - It is made of buttons, so Tab and Enter or Space reach it.
   - Both options carry one tooltip, saying what the other view adds or leaves out
     (`RADIO_VIEW_TOOLTIP[view]`).
   - Pressing the option already on writes nothing.
8. **Simple's kind label** is a plain span in the stem's type colour, with no caret and no menu.
   The match meter is hidden (the spec hides "the kinds menu and match meter").
9. **The lock mark** is a span (`role="img"`, `aria-label="locked"`) with the locked button's own
   look (`--ra-stretch-on` ink and border on `--ra-stretch-on-bg`). Its tooltip is
   `locked · unlock in advanced`. It is not focusable and does nothing.
10. **Popovers of hidden parts are gated by the same part** (`shows('nearby')`,
    `shows('meter')`, `shows('kind-menu')`), so an open one leaves with its button. The click on
    the switch also closes them through their own outside-click handlers (the artist picker too).
    No effect is used to close them: `react-hooks/set-state-in-effect` is an error here.
11. **The columns unmount in simple** (`RadioShapingColumns`; it holds only per-gesture drafts).
    The live bar stays mounted and only its children change.
12. **Radio off (the grid layout) is untouched:** `shows()` is always true there.

## Questions for Elling

1. Decision 3: in simple, with density `arc` (the desktop's default), should `build`, `drop`,
   `energy` and `drama` show greyed (as advanced does), or stay out of sight until density is
   `intensity` (this plan)?

## Assumptions about intensity arc Task 11

Already on master (checked at `dc6450dd`), so this plan depends on them directly:
- **T1** (`cc53406b`) put the strip model's controls in place: `build` and `drop` in the `play`
  group after `turn`, and `energy` and `drama` as `slider`s in the `picks` group after `density`,
  all greyed with density not `intensity`.
- **T10** (`d360770d`, `792550e4`) left the presses on `intensityPressRef` and moved
  `radioArcShown` to T11.

**What this plan assumes T11 did** (its plan text, Step 1):
- `RadioLiveBar` draws two `FireButton`s, `build` and `drop`, in the `fire now` field after the
  turn button, reading `byId('build')` / `byId('drop')` for tooltips and `disabled`.
- `RadioStripProps` gained `arc: { shown, onPress }`, fed from `DiscoverPanel`'s `radioArcShown`.
- `energy` and `drama` stay in the picks column. `RadioShapingColumns`' slider case gets its
  double-click default from a map by id (`bend`, `mismatch`, `energy`, `drama`).

**How simple uses them:**
- Simple's live bar takes `energy` and `drama` from the picks group by id
  (`RADIO_SIMPLE_LIVE`) and draws them itself.
- It keeps T11's `build` / `drop` buttons, each wrapped in `has('build') &&` /
  `has('drop') &&`, so simple can leave them out with another density.

**If T11 differs:**
- **Other names for the state or props** (`arc`, `radioArcShown`): nothing here reads them. Leave
  them as T11 wrote them.
- **T11 hoisted its slider-default map to a module constant:** use it for the live dials instead
  of Task 4's `LIVE_DIAL_DEFAULTS`. If it inlined the map, hoist it and share it. Either way
  `energy` resets to `DEFAULT_RADIO_ENERGY` and `drama` to `DEFAULT_RADIO_DRAMA`.
- **T11 moved `energy` / `drama` into the play group:** advanced's live bar then has them too.
  Task 4's `liveDials` block draws them in both views, so it still works. Re-run Task 1's tests:
  only the advanced ordering test reads groups, and it reads them from the model.
- **T11 renamed a control id or added a new live control** (an arc readout, say): `radioView.test.ts`
  fails on "names only controls the strip model has" or on the pinned lists. Fix
  `RADIO_SIMPLE_LIVE` (a rename) or decide with Elling whether simple gets the new control (an
  addition; by default it does not).
- **T11 is not in yet:** do Tasks 1, 2, 3 and 5, and stop. Task 4 needs T11's buttons in
  `RadioLiveBar` to wrap them.

## File map

- **Create:**
  - `src/shared/radioView.ts`, `src/shared/radioView.test.ts` (T1).
- **Modify:**
  - `src/shared/radioStripModel.test.ts`: the coverage test runs against advanced (T1);
  - `src/main/discoverSettingsStore.ts` (+ test): `radioView` (T2);
  - `src/renderer/src/App.tsx`, `src/renderer/src/components/LibraryBrowser.tsx`: the setting and
    its setter, passed through (T3);
  - `src/renderer/src/components/RadioTopLine.tsx`: the switch (T3);
  - `src/renderer/src/components/DiscoverPanel.tsx`: the props (T3), the strip context hoisted and
    the mix's `shown` (T4), `radioView` on each row (T5);
  - `src/renderer/src/components/RadioStrip.tsx`: the live bar, the columns, the mix (T4);
  - `src/renderer/src/components/DiscoverSlotRow.tsx`: the row's parts and the lock mark (T5).
- **Not touched:** `radioStripModel.ts`, `RadioControls.tsx`, `RadioRowPlates.tsx`, the phone
  (`remoteServer.ts`, `remotePage.ts`), the engine, the web radio.

## Task graph

```
T1 radioView.ts (pure, TDD) ─> T2 the setting (main) ─> T3 the switch (App, LibraryBrowser, panel props, top line)
                                                          ├─> T4 strip: live bar, columns, mix   (needs intensity arc T11)
                                                          └─> T5 rows: parts, lock mark
T4, T5 ─> T6 verify, review, handoff, walkthrough
```

- **T1 and T2 are parallel-safe now** (a new module; a main-only field). They change nothing on
  screen.
- **T3 shows a switch that changes nothing until T4 and T5.** Land T3, T4 and T5 together (no
  release or handoff in between).
- **T4 and T5 are independent** (different files, apart from one line each in `DiscoverPanel.tsx`).

---

### Task 1: What each view draws (`radioView.ts`)

**Parallel-safe.** **Depends on:** nothing (the strip model ids it names are on master since
intensity arc T1).

**Files:**
- Create: `src/shared/radioView.ts`, `src/shared/radioView.test.ts`
- Modify: `src/shared/radioStripModel.test.ts`

- [ ] **Step 1: Write the failing test.** Create `src/shared/radioView.test.ts`:

```ts
// The radio view's simple and advanced views (spec 2026-10-05-radio-simple-view-design):
// radioView.ts. Simple's lists are pinned here, so a control added to the strip model does not
// silently land in simple; advanced is the strip model's own places (its coverage test runs there,
// radioStripModel.test.ts).
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_RADIO_VIEW,
  RADIO_LOCK_MARK_TOOLTIP,
  RADIO_ROW_PARTS,
  RADIO_SIMPLE_LIVE,
  RADIO_VIEWS,
  RADIO_VIEW_TOOLTIP,
  normalizeRadioView,
  radioRowParts,
  radioViewStrip,
  type RadioView
} from './radioView'
import { radioStripModel, type RadioStripContext, type RadioStripGroup } from './radioStripModel'
import { DEFAULT_RADIO_SETTINGS, RADIO_DENSITY_OPTIONS, type RadioSettings } from './radioSchedule'
import { RADIO_TURNAROUNDS_OPTIONS } from './radioTurnaround'
import { DEFAULT_SOUND_SETTINGS } from './radioSound'

const CTX: RadioStripContext = {
  artistMode: false,
  hasUsername: true,
  sound: DEFAULT_SOUND_SETTINGS,
  sounding: true
}

function settings(over: Partial<RadioSettings> = {}): RadioSettings {
  return { ...DEFAULT_RADIO_SETTINGS, ...over }
}

function view(s: RadioSettings, v: RadioView): ReturnType<typeof radioViewStrip> {
  return radioViewStrip(radioStripModel(s, CTX), v, s)
}

const ids = (cs: readonly { id: string }[]): string[] => cs.map((c) => c.id)

/** Every state the strip's visibility rules turn on. */
const STATES: RadioSettings[] = RADIO_DENSITY_OPTIONS.flatMap((density) =>
  RADIO_TURNAROUNDS_OPTIONS.flatMap((turnarounds) =>
    [false, true].map((foldMode) => settings({ density, turnarounds, foldMode }))
  )
)

describe('radioView: the setting', () => {
  it('is simple by default, and an unknown value reads as simple', () => {
    expect(DEFAULT_RADIO_VIEW).toBe('simple')
    expect(RADIO_VIEWS).toEqual(['simple', 'advanced'])
    expect(normalizeRadioView('advanced')).toBe('advanced')
    expect(normalizeRadioView('simple')).toBe('simple')
    expect(normalizeRadioView(undefined)).toBe('simple')
    expect(normalizeRadioView('full')).toBe('simple')
    expect(normalizeRadioView(1)).toBe('simple')
  })

  it('words its switch and the lock mark in lowercase, no emoji, no exclamation mark', () => {
    for (const w of [
      ...Object.values(RADIO_VIEW_TOOLTIP),
      RADIO_LOCK_MARK_TOOLTIP,
      ...RADIO_VIEWS
    ]) {
      expect(w, w).toBe(w.toLowerCase())
      expect(w, w).not.toMatch(/!|\p{Extended_Pictographic}/u)
    }
  })
})

describe('radioView: advanced is the strip model, unchanged', () => {
  it('draws every group in its own place, every control, the move chips', () => {
    for (const s of STATES) {
      const groups = radioStripModel(s, CTX)
      const at = (place: RadioStripGroup['place']): RadioStripGroup[] =>
        groups.filter((g) => g.place === place)
      const a = view(s, 'advanced')
      expect(ids(a.top)).toEqual(ids(at('top').flatMap((g) => g.controls)))
      expect(ids(a.live)).toEqual(ids(at('live').flatMap((g) => g.controls)))
      expect(a.columns.map((g) => g.id)).toEqual(at('columns').map((g) => g.id))
      expect(a.moveChips).toBe(true)
      const drawn = [...a.top, ...a.live, ...a.columns.flatMap((g) => g.controls)]
      expect(ids(drawn).sort()).toEqual(ids(groups.flatMap((g) => g.controls)).sort())
    }
  })

  it('draws every row part but the lock mark, locked or not', () => {
    for (const locked of [false, true]) {
      expect([...radioRowParts('advanced', { locked })]).toEqual(
        RADIO_ROW_PARTS.filter((p) => p !== 'lock-mark')
      )
    }
  })
})

describe('radioView: simple, pinned', () => {
  it('keeps only keep on the top line', () => {
    for (const s of STATES) expect(ids(view(s, 'simple').top)).toEqual(['keep'])
  })

  it('draws the live bar: the play controls, and the arc and its dials with density intensity', () => {
    for (const s of STATES) {
      const live = ids(view(s, 'simple').live)
      if (s.density === 'intensity') {
        expect(live).toEqual([
          'tempo',
          'pace',
          'skip',
          'new-bed',
          'turn',
          'build',
          'drop',
          'energy',
          'drama',
          'level'
        ])
      } else {
        expect(live).toEqual(['tempo', 'pace', 'skip', 'new-bed', 'turn', 'level'])
      }
    }
  })

  it('has no move chips and no columns', () => {
    for (const s of STATES) {
      const v = view(s, 'simple')
      expect(v.moveChips).toBe(false)
      expect(v.columns).toEqual([])
    }
  })

  it('names only controls the strip model has: a renamed id fails here, not on screen', () => {
    const all = ids(
      radioStripModel(settings({ density: 'intensity' }), CTX).flatMap((g) => g.controls)
    )
    for (const id of [...RADIO_SIMPLE_LIVE, 'keep']) expect(all, id).toContain(id)
  })

  it('sets only pace, energy and drama: a setting added to the strip stays in advanced', () => {
    const sets = new Set(
      view(settings({ density: 'intensity' }), 'simple').live.flatMap((c) => [...c.sets])
    )
    expect([...sets].sort()).toEqual(['drama', 'energy', 'paceLevel'])
  })

  it('passes the model controls through as they are (greyed, tooltips, patches)', () => {
    const s = settings({ density: 'intensity' })
    const model = radioStripModel(s, { ...CTX, sounding: false })
    const simple = radioViewStrip(model, 'simple', s)
    const all = model.flatMap((g) => g.controls)
    for (const c of simple.live) expect(c).toBe(all.find((x) => x.id === c.id))
    expect(simple.live.find((c) => c.id === 'level')?.disabled).toBe(true)
  })

  it('draws the live cluster and the label on a row', () => {
    expect([...radioRowParts('simple', { locked: false })]).toEqual([
      'mute-solo',
      'skip',
      'like',
      'change-soon',
      'hook-dig',
      'kind'
    ])
  })

  it('shows a locked row its lock, as a mark and never the button', () => {
    const p = radioRowParts('simple', { locked: true })
    expect(p.has('lock-mark')).toBe(true)
    expect(p.has('lock')).toBe(false)
    expect(radioRowParts('simple', { locked: false }).has('lock-mark')).toBe(false)
  })

  it('hides the extras, the kinds menu and the meter', () => {
    for (const locked of [false, true]) {
      const p = radioRowParts('simple', { locked })
      for (const hidden of [
        'any-stem',
        'nearby',
        'duplicate',
        'kind-menu',
        'meter',
        'lock',
        'remove'
      ] as const) {
        expect(p.has(hidden), hidden).toBe(false)
      }
    }
  })
})
```

  - The coverage test runs against advanced. `src/shared/radioStripModel.test.ts`:

```diff
--- a/src/shared/radioStripModel.test.ts
+++ b/src/shared/radioStripModel.test.ts
@@ -38,6 +38,7 @@
 import { RADIO_TRANSITIONS_OPTIONS } from './radioTransition'
 import { DEFAULT_SOUND_SETTINGS, normalizeSoundSettings } from './radioSound'
 import { soundPanelModel, type SoundSliderControl } from './soundPanelModel'
+import { radioViewStrip } from './radioView'
 
 const CTX: RadioStripContext = {
   artistMode: false,
@@ -69,11 +70,17 @@
   )
 )
 
-describe('radioStripModel: nothing hidden', () => {
-  it('sets every radio setting from some control (the legacy pace pair aside)', () => {
+/** The controls the advanced view draws (radioView.ts): the coverage test runs there. Simple
+ * keeps fewer on purpose; its list is pinned in radioView.test.ts. */
+function advancedControls(s: RadioSettings): RadioStripControl[] {
+  const v = radioViewStrip(radioStripModel(s, CTX), 'advanced', s)
+  return [...v.top, ...v.live, ...v.columns.flatMap((g) => g.controls)]
+}
+
+describe('radioStripModel: nothing hidden', () => {
+  it('sets every radio setting from some control in the advanced view (the legacy pace pair aside)', () => {
     const set = new Set<RadioSettingKey>()
-    for (const s of STATES)
-      for (const c of controls(radioStripModel(s, CTX))) c.sets.forEach((k) => set.add(k))
+    for (const s of STATES) for (const c of advancedControls(s)) c.sets.forEach((k) => set.add(k))
     const keys = (Object.keys(DEFAULT_RADIO_SETTINGS) as RadioSettingKey[]).filter(
       (k) => !RADIO_STRIP_LEGACY_KEYS.includes(k)
     )
```

  The rest of that test is unchanged: it must not be edited to pass.

  - Run `npx vitest run src/shared/radioView.test.ts src/shared/radioStripModel.test.ts`.
    **Expected:** both FAIL to load (`./radioView` does not exist).

- [ ] **Step 2: The module.** Create `src/shared/radioView.ts`:

```ts
// src/shared/radioView.ts -- the radio view's two views (spec 2026-10-05-radio-simple-view-design):
// `advanced` is the radio view as the design pass built it, every radio setting out front
// (radioStripModel's groups, each in its place); `simple`, the default, keeps the controls that
// play. Pure: which strip controls, which mix actions and which row parts each view draws are
// decided (and pinned by tests) here. Visibility only -- a view is never a setting radio reads:
// a hidden control keeps its value and keeps working.
//
// SIMPLE'S LISTS ARE EXPLICIT, by control id. A control added to the strip model lands in
// advanced (the strip's coverage test runs there) and in simple only when it is named below, so
// nothing silently joins simple (radioView.test.ts pins both lists).
import { radioIntensityOn, type RadioSettings } from './radioSchedule'
import type { RadioStripControl, RadioStripGroup } from './radioStripModel'

export type RadioView = 'simple' | 'advanced'

/** The switch's options, in its order. */
export const RADIO_VIEWS: readonly RadioView[] = ['simple', 'advanced']

/** Simple is the default (Elling, 2026-10-05); the choice is remembered (DiscoverSettings). */
export const DEFAULT_RADIO_VIEW: RadioView = 'simple'

export function normalizeRadioView(value: unknown): RadioView {
  return value === 'simple' || value === 'advanced' ? value : DEFAULT_RADIO_VIEW
}

/** The switch's tooltip, on both its options: what the other view adds or leaves out. */
export const RADIO_VIEW_TOOLTIP: Readonly<Record<RadioView, string>> = {
  simple: 'advanced adds every setting, the moves and the row extras',
  advanced: 'simple keeps what plays. hidden settings keep working'
}

/** A locked row's padlock in simple: a mark, not a button. */
export const RADIO_LOCK_MARK_TOOLTIP = 'locked · unlock in advanced'

/** Simple's top-line mix actions: keep, the one people reach for while listening. */
export const RADIO_SIMPLE_TOP: readonly string[] = ['keep']

/** Simple's live bar, in order: the play group's controls (the move chips aside: `turn` picks
 * for you), then the intensity arc's dials from the picks column. */
export const RADIO_SIMPLE_LIVE: readonly string[] = [
  'tempo',
  'pace',
  'skip',
  'new-bed',
  'turn',
  'build',
  'drop',
  'energy',
  'drama',
  'level'
]

/** The intensity arc's controls: in simple only while density is `intensity` (planning decision
 * 3). Greyed, they would point at a density control simple does not show. */
export const RADIO_SIMPLE_INTENSITY_ONLY: readonly string[] = ['build', 'drop', 'energy', 'drama']

/** What a view draws of the strip model's groups. */
export interface RadioViewStrip {
  /** The top line's mix actions, in order. */
  top: RadioStripControl[]
  /** The live bar's controls, in order. */
  live: RadioStripControl[]
  /** The seven fire-now move chips beside `turn`. */
  moveChips: boolean
  /** The shaping columns. */
  columns: RadioStripGroup[]
}

/** The strip model's groups as `view` draws them, for the settings the model was built from.
 * Advanced is the model's own places, unchanged; simple picks its lists by id, in their order. */
export function radioViewStrip(
  groups: readonly RadioStripGroup[],
  view: RadioView,
  settings: Pick<RadioSettings, 'density'>
): RadioViewStrip {
  if (view === 'advanced') {
    return {
      top: groups.filter((g) => g.place === 'top').flatMap((g) => g.controls),
      live: groups.filter((g) => g.place === 'live').flatMap((g) => g.controls),
      moveChips: true,
      columns: groups.filter((g) => g.place === 'columns')
    }
  }
  const all = groups.flatMap((g) => g.controls)
  const pick = (ids: readonly string[]): RadioStripControl[] =>
    ids.flatMap((id) => {
      const c = all.find((x) => x.id === id)
      return c === undefined ? [] : [c]
    })
  const arcIdle = !radioIntensityOn(settings)
  return {
    top: pick(RADIO_SIMPLE_TOP),
    live: pick(
      RADIO_SIMPLE_LIVE.filter((id) => !(arcIdle && RADIO_SIMPLE_INTENSITY_ONLY.includes(id)))
    ),
    moveChips: false,
    columns: []
  }
}

/** A radio-layout row's parts in its button line (DiscoverSlotRow's radio assembly). The
 * waveform and its plates are in both views and are not parts: the waveform cell never moves, so
 * a switch remounts nothing. */
export type RadioRowPart =
  | 'mute-solo'
  | 'skip'
  | 'like'
  | 'change-soon'
  | 'hook-dig'
  /** The kind label in the stem's type colour (both views). */
  | 'kind'
  /** The kind label opens the kinds menu (a button with its caret). */
  | 'kind-menu'
  | 'meter'
  | 'any-stem'
  | 'nearby'
  | 'duplicate'
  | 'lock'
  /** A locked row's padlock as a status mark, not a button (simple). */
  | 'lock-mark'
  | 'remove'

/** Every part, in the button line's reading order. */
export const RADIO_ROW_PARTS: readonly RadioRowPart[] = [
  'mute-solo',
  'skip',
  'like',
  'change-soon',
  'hook-dig',
  'kind',
  'kind-menu',
  'meter',
  'any-stem',
  'nearby',
  'duplicate',
  'lock',
  'lock-mark',
  'remove'
]

/** Simple's button line: the live cluster (m s, skip, like, change soon, hook dig) and the
 * label. */
export const RADIO_SIMPLE_ROW: readonly RadioRowPart[] = [
  'mute-solo',
  'skip',
  'like',
  'change-soon',
  'hook-dig',
  'kind'
]

/** The parts a row's button line draws in `view`. A part's own condition (a stem to act on,
 * radio running, a nearby anchor) still applies on top. A locked row in simple shows its lock as
 * a mark: hiding an active lock would be confusing (spec). */
export function radioRowParts(
  view: RadioView,
  row: { locked: boolean }
): ReadonlySet<RadioRowPart> {
  if (view === 'advanced') return new Set(RADIO_ROW_PARTS.filter((p) => p !== 'lock-mark'))
  return new Set<RadioRowPart>(row.locked ? [...RADIO_SIMPLE_ROW, 'lock-mark'] : RADIO_SIMPLE_ROW)
}
```

- [ ] **Step 3: Run the tests.**
  `npx vitest run src/shared/radioView.test.ts src/shared/radioStripModel.test.ts`.
  **Expected:** PASS (13 and 24).
- [ ] **Step 4: Prove the coverage test still bites.** In `radioViewStrip`'s advanced branch,
  temporarily replace `columns: groups.filter((g) => g.place === 'columns')` with `columns: []`.
  Run `npx vitest run src/shared/radioStripModel.test.ts`. **Expected:** `sets every radio setting
  from some control in the advanced view` FAILS. Revert, re-run: PASS. Do not commit the mutation.
- [ ] **Step 5: Verify, commit.**
  - Run `npx vitest run src/shared`, `npm run typecheck`,
    `npx eslint src/shared/radioView.ts src/shared/radioView.test.ts src/shared/radioStripModel.test.ts`,
    `npx prettier --check` on the same three.
  - The web radio reads `@shared` from this working tree: run `npm run typecheck` in
    `/Users/nickel/Claudecode/ell.ing/radio` too. **Expected:** clean (nothing it imports changed).
  - Commit `src/shared/radioView.ts src/shared/radioView.test.ts src/shared/radioStripModel.test.ts`.
    Message:
    `radio view: simple and advanced, what each draws (spec 2026-10-05-radio-simple-view-design) -- @shared/radioView: RadioView (simple default, normalizeRadioView), radioViewStrip (advanced = the strip model's own places, unchanged; simple = keep on the top line, the live bar's tempo/pace/skip/new bed/turn/level plus build/drop/energy/drama with density intensity, no move chips, no columns), radioRowParts (simple: m s, skip, like, change soon, hook dig, the kind label; a locked row's lock as a mark). Simple's lists are explicit ids, pinned by radioView.test.ts, so a new strip control lands in advanced only; the strip's coverage test now runs against advanced (proved to still fail when advanced drops a group). Inert: nothing draws it yet`,
    then the trailer.

### Task 2: The setting, remembered (`discoverSettingsStore.ts`)

**Depends on:** Task 1.

**Files:** Modify `src/main/discoverSettingsStore.ts`, `src/main/discoverSettingsStore.test.ts`.

- [ ] **Step 1: Write the failing tests.** In `src/main/discoverSettingsStore.test.ts`:
  - **Every whole-object expectation and every `saveDiscoverSettings({ ... })` call gains
    `radioView: 'simple'`** after its `radio:` line. There are eight, in these tests:
    - `defaults to not consented when no file exists yet` (the expectation);
    - `persists consent across a save/load round trip` (the save and the expectation);
    - `defaults to not consented (not a thrown error) when the file is corrupted` (the save and
      the expectation);
    - `persists the trait match bar, ...` (both saves);
    - `defaults the radio settings for a file written before radio existed` (the expectation).

    For example:

```diff
@@ -27,7 +27,8 @@
     expect(loadDiscoverSettings()).toEqual({
       consentedToLibraryScan: false,
       traitMatchBar: 0.75,
-      radio: { ...DEFAULT_RADIO_SETTINGS, foldSeed: expect.stringMatching(FOLD_SEED) }
+      radio: { ...DEFAULT_RADIO_SETTINGS, foldSeed: expect.stringMatching(FOLD_SEED) },
+      radioView: 'simple'
     })
   })
```

  - `round-trips every radio setting` saves `advanced` and reads it back:

```diff
@@ -135,8 +142,10 @@
         sizedBuilds: false,
         energy: 20,
         drama: 85
-      }
+      },
+      radioView: 'advanced'
     })
+    expect(loadDiscoverSettings().radioView).toBe('advanced')
     expect(loadDiscoverSettings().radio).toEqual({
       pace: 'fast',
       paceBars: { min: 5, max: 9 },
```

  - A new test, before `sized builds: a saved file without the field loads on, ...`:

```ts
  // Spec 2026-10-05-radio-simple-view-design: simple is the default, advanced is remembered.
  it('radio view: simple for a file without it or with nonsense, advanced kept', async () => {
    const { loadDiscoverSettings } = await import('./discoverSettingsStore')
    writeFileSync(
      join(dir, 'discoverSettings.json'),
      JSON.stringify({ consentedToLibraryScan: true, radio: { pace: 'mid' } }),
      'utf-8'
    )
    expect(loadDiscoverSettings().radioView).toBe('simple')
    writeFileSync(
      join(dir, 'discoverSettings.json'),
      JSON.stringify({ radioView: 'full' }),
      'utf-8'
    )
    expect(loadDiscoverSettings().radioView).toBe('simple')
    writeFileSync(
      join(dir, 'discoverSettings.json'),
      JSON.stringify({ radioView: 'advanced' }),
      'utf-8'
    )
    expect(loadDiscoverSettings().radioView).toBe('advanced')
  })
```

  - Run `npx vitest run src/main/discoverSettingsStore.test.ts`. **Expected:** FAIL (no
    `radioView` in what loads; `npm run typecheck` also flags the saves' unknown property).

- [ ] **Step 2: The field.** `src/main/discoverSettingsStore.ts`:

```diff
--- a/src/main/discoverSettingsStore.ts
+++ b/src/main/discoverSettingsStore.ts
@@ -8,6 +8,7 @@
   normalizeRadioSettings,
   type RadioSettings
 } from '@shared/radioSchedule'
+import { DEFAULT_RADIO_VIEW, normalizeRadioView, type RadioView } from '@shared/radioView'
 
 export interface DiscoverSettings {
   /** Whether the user has explicitly agreed to the whole-library background
@@ -29,6 +30,10 @@
    * because re-picking them every launch is an annoyance with a four-line
    * fix. docs/superpowers/specs/2026-09-28-radio-controls-design.md. */
   radio: RadioSettings
+  /** The radio view's `simple` / `advanced` switch (spec 2026-10-05-radio-simple-view-design):
+   * what the view shows, never what radio does, so it is not a RadioSettings field (a change to
+   * `radio` re-runs the panel's radio effects). Simple unless saved advanced. */
+  radioView: RadioView
 }
 
 const STORE_FILENAME = 'discoverSettings.json'
@@ -40,7 +45,8 @@
 const DEFAULT_SETTINGS: DiscoverSettings = {
   consentedToLibraryScan: false,
   traitMatchBar: DEFAULT_TRAIT_BAR,
-  radio: DEFAULT_RADIO_SETTINGS
+  radio: DEFAULT_RADIO_SETTINGS,
+  radioView: DEFAULT_RADIO_VIEW
 }
 
 /** Mirrors categoryCentroidStore.ts's own loadCategoryCentroidStore -- an
@@ -58,7 +64,8 @@
         // `parsed.radioPace` is the 1.3.0 shape -- flat, no `radio` object.
         // Passing it through migrates a real user's chosen pace rather than
         // silently resetting it. An explicit `radio.pace` always wins.
-        radio: normalizeRadioSettings(parsed.radio, (parsed as { radioPace?: unknown }).radioPace)
+        radio: normalizeRadioSettings(parsed.radio, (parsed as { radioPace?: unknown }).radioPace),
+        radioView: normalizeRadioView(parsed.radioView)
       },
       parsed.radio?.foldSeed
     )
```

- [ ] **Step 3: Verify, commit.**
  - Run `npx vitest run src/main/discoverSettingsStore.test.ts` (15 pass).
  - Run `npm run typecheck`. **Expected:** it FAILS in `App.tsx` (its initial `DiscoverSettings`
    state lacks `radioView`). Add `radioView: DEFAULT_RADIO_VIEW` there now (the first hunk of
    Task 3 Step 1's App diff, with its import), so this commit typechecks; Task 3 does the rest.
  - `npx eslint` and `npx prettier --check` on the three files.
  - Commit `src/main/discoverSettingsStore.ts src/main/discoverSettingsStore.test.ts src/renderer/src/App.tsx`.
    Message:
    `discover settings: the radio view, remembered (spec 2026-10-05-radio-simple-view-design) -- DiscoverSettings.radioView, normalized on load (anything but advanced reads simple, the default), beside radio rather than in it: a switch must not change the radio object the panel's effects depend on, and RadioSettings stays every-key-has-a-strip-control. App's initial mirror carries the default. Inert: nothing reads it yet`,
    then the trailer.

### Task 3: The switch (`App.tsx`, `LibraryBrowser.tsx`, `DiscoverPanel.tsx`, `RadioTopLine.tsx`)

**Depends on:** Task 2. Lands together with Tasks 4 and 5 (the switch changes nothing on screen
until they do).

- [ ] **Step 1: App's setter** (`src/renderer/src/App.tsx`, after `setRadioSettings`), and the
  two props on `<LibraryBrowser`:

```diff
--- a/src/renderer/src/App.tsx
+++ b/src/renderer/src/App.tsx
@@ -117,6 +117,7 @@
 import type { DiscoverSettings } from '../../main/discoverSettingsStore'
 import { DEFAULT_TRAIT_BAR, nextTraitMatchBar } from '@shared/traitBar'
 import { DEFAULT_RADIO_SETTINGS, type RadioSettings } from '@shared/radioSchedule'
+import { DEFAULT_RADIO_VIEW, type RadioView } from '@shared/radioView'
 import { pickBestRifffForReOne } from '@shared/reOneScoring'
 
 /** Tracks what the currently-open project actually is, so Save/Export know
@@ -1695,11 +1696,13 @@
   const [discoverSettings, setDiscoverSettingsState] = useState<DiscoverSettings>({
     consentedToLibraryScan: false,
     traitMatchBar: DEFAULT_TRAIT_BAR,
-    radio: DEFAULT_RADIO_SETTINGS
+    radio: DEFAULT_RADIO_SETTINGS,
+    radioView: DEFAULT_RADIO_VIEW
   })
   const discoverConsented = discoverSettings.consentedToLibraryScan
   const traitMatchBar = discoverSettings.traitMatchBar
   const radioSettings = discoverSettings.radio
+  const radioView = discoverSettings.radioView
   useEffect(() => {
     void window.rifffApi
       .getDiscoverSettings()
@@ -1742,6 +1745,12 @@
     await updateDiscoverSettings({ radio: { ...radioSettings, ...patch } })
   }
 
+  /** The radio view's simple / advanced switch (spec 2026-10-05-radio-simple-view-design). Its
+   * own field, so `radio` keeps its identity and nothing radio does re-runs on a switch. */
+  async function setRadioView(view: RadioView): Promise<void> {
+    await updateDiscoverSettings({ radioView: view })
+  }
+
   async function startTour(): Promise<void> {
     // Puts the app into the one view every step's anchor is actually
     // mounted in: 'sketch' swaps the whole Timeline out for SketchStrip and
@@ -2808,6 +2817,8 @@
             traitMatchBar={traitMatchBar}
             radioSettings={radioSettings}
             onRadioSettingsChange={setRadioSettings}
+            radioView={radioView}
+            onRadioViewChange={setRadioView}
             setDiscoverConsented={setDiscoverConsented}
             discoverSlots={discoverSlots}
             setDiscoverSlots={setDiscoverSlots}
```

  (Task 2 already added the import's `DEFAULT_RADIO_VIEW` and the initial state's line; add
  `type RadioView` to that import now.)

- [ ] **Step 2: The pass-through** (`LibraryBrowser.tsx`):

```diff
--- a/src/renderer/src/components/LibraryBrowser.tsx
+++ b/src/renderer/src/components/LibraryBrowser.tsx
@@ -35,6 +35,7 @@
 import { formatBpm } from '@shared/format'
 import { libraryModeLabel, type LibraryMode } from '@shared/libraryEntryPoints'
 import type { RadioSettings } from '@shared/radioSchedule'
+import type { RadioView } from '@shared/radioView'
 import { bytesLabel } from '@shared/visuals'
 import { stemKey, type Rifff } from '@shared/types'
 import type { ProjectRef } from '@shared/types'
@@ -181,6 +182,8 @@
   traitMatchBar,
   radioSettings,
   onRadioSettingsChange,
+  radioView,
+  onRadioViewChange,
   setDiscoverConsented,
   discoverSlots,
   setDiscoverSlots,
@@ -227,6 +230,10 @@
    * controls-design.md. */
   radioSettings: RadioSettings
   onRadioSettingsChange: (patch: Partial<RadioSettings>) => Promise<void>
+  /** The radio view's simple / advanced switch (DiscoverSettings.radioView) and its persisting
+   * setter: a pass-through, as radioSettings. */
+  radioView: RadioView
+  onRadioViewChange: (view: RadioView) => Promise<void>
   setDiscoverConsented: (value: boolean) => Promise<void>
   /** App.tsx's own lifted Discover session state -- see its own doc
    * comment for why it lives there now (survives the WHOLE LibraryBrowser
@@ -2519,6 +2526,8 @@
             traitMatchBar={traitMatchBar}
             radioSettings={radioSettings}
             onRadioSettingsChange={onRadioSettingsChange}
+            radioView={radioView}
+            onRadioViewChange={onRadioViewChange}
             setDiscoverConsented={setDiscoverConsented}
             seedBpm={discoverSeedBpm}
             onCoachSlotsChange={onCoachSlotsChange}
```

- [ ] **Step 3: The panel's props** (`DiscoverPanel.tsx`): in the destructuring after
  `onRadioSettingsChange,` and in the props type after `onRadioSettingsChange: ...`; the import
  goes beside `import { RadioMixActions, RadioStrip, type RadioMixBundle } from './RadioStrip'`:

```diff
@@ -2,6 +2,8 @@
 import { RadioMixActions, RadioStrip, type RadioMixBundle } from './RadioStrip'
+import { type RadioView } from '@shared/radioView'
 import { RadioTopLine, RedoIcon, UndoIcon } from './RadioTopLine'
@@
   radioSettings,
   onRadioSettingsChange,
+  radioView,
+  onRadioViewChange,
   setDiscoverConsented,
   seedBpm,
   onCoachSlotsChange
@@
   radioSettings: RadioSettings
   onRadioSettingsChange: (patch: Partial<RadioSettings>) => Promise<void>
+  /** The radio view's simple / advanced switch (spec 2026-10-05-radio-simple-view-design), and
+   * its persisting setter (App's DiscoverSettings.radioView). What shows, never what radio does:
+   * nothing radio runs reads it. */
+  radioView: RadioView
+  onRadioViewChange: (view: RadioView) => Promise<void>
```

  and at `<RadioTopLine`, after `actions={...}`:

```tsx
          view={radioView}
          onViewChange={(v) => void onRadioViewChange(v)}
```

  Task 4 widens the import to `import { radioViewStrip, type RadioView } from '@shared/radioView'`.

- [ ] **Step 4: The switch** (`RadioTopLine.tsx`): in the right-hand group, before the undo button.

```diff
--- a/src/renderer/src/components/RadioTopLine.tsx
+++ b/src/renderer/src/components/RadioTopLine.tsx
@@ -4,10 +4,13 @@
 // radio's `.top`): while radio runs, Discover's two header rows become this one sticky line.
 // Left, play/stop and `radio` (the stop) with its interval line inside its bottom edge; then the
 // readout (status line, phrase ruler, fold's line); then the mix actions (RadioMixActions, passed
-// in: they act on what is playing); right, undo and redo. Values and callbacks only.
+// in: they act on what is playing); right, the `simple / advanced` switch (spec
+// 2026-10-05-radio-simple-view-design), undo and redo. Values and callbacks only.
 import type { ReactNode } from 'react'
 import { RADIO_VIEW_FRAME } from './discoverRowGrid'
+import { Segmented } from './RadioControls'
 import { radioRulerCells, type RadioReadout } from '@shared/radioReadout'
+import { RADIO_VIEWS, RADIO_VIEW_TOOLTIP, type RadioView } from '@shared/radioView'
 
 /** Behind the sticky bars: the library box's own fill (LibraryBrowser), so nothing shows through
  * and nothing looks like a second panel. */
@@ -23,6 +26,8 @@
   readout,
   foldSummary,
   actions,
+  view,
+  onViewChange,
   canUndo,
   canRedo,
   onUndo,
@@ -40,6 +45,9 @@
   foldSummary: string | null
   /** The mix actions (RadioMixActions): they act on what is playing. */
   actions: ReactNode
+  /** The view shown (simple or advanced), and the switch's choice. What shows, never what plays. */
+  view: RadioView
+  onViewChange: (view: RadioView) => void
   canUndo: boolean
   canRedo: boolean
   onUndo: () => void
@@ -214,6 +222,18 @@
           borderLeft: '1px solid var(--ra-border)'
         }}
       >
+        {/* The view switch: the strip's word switch (Segmented), buttons, so Tab and Enter
+            reach it. Its tooltip says what the other view adds or leaves out. */}
+        <Segmented
+          ariaLabel="radio view"
+          size="live"
+          options={RADIO_VIEWS.map((v) => ({
+            label: v,
+            on: view === v,
+            tooltip: RADIO_VIEW_TOOLTIP[view],
+            onClick: () => (view === v ? undefined : onViewChange(v))
+          }))}
+        />
         <button
           onClick={onUndo}
           disabled={!canUndo}
```

- [ ] **Step 5: Checks.**
  - `npm run typecheck`; `npx eslint` and `npx prettier --check` on the four files.
  - `grep -n "radioView" src/renderer/src/components/DiscoverPanel.tsx`: only the destructuring,
    the props type and the `<RadioTopLine` line. **Never** in a `useEffect` / `useCallback` /
    `useMemo` deps array, a ref, or anything that reaches the engine, the clock or the phone.
  - Read App's `updateDiscoverSettings`: a view write spreads `discoverSettings`, so
    `discoverSettings.radio` is the same object after it.
- [ ] Commit the four files. Message:
  `radio view: the simple / advanced switch on the top line (spec 2026-10-05-radio-simple-view-design) -- a Segmented word switch beside undo/redo (buttons: Tab and Enter reach it; the tooltip says what the other view adds or leaves out; pressing the one on writes nothing), App's setRadioView through LibraryBrowser to DiscoverPanel, saved in DiscoverSettings.radioView beside radio (radio keeps its identity: no radio effect re-runs). Nothing hides yet (Tasks 4-5). Unseen by any agent`,
  then the trailer.

### Task 4: The strip: live bar, columns, mix (`RadioStrip.tsx`, `DiscoverPanel.tsx`)

**Depends on:** Tasks 1 and 3, and **intensity arc Task 11** (its `build` / `drop` buttons are in
`RadioLiveBar`).

The blocks below are the scratch copy's (written at `dc6450dd`, before T11), verbatim. Where T11's
code sits, the step says what to do with it.

- [ ] **Step 1: Imports and props** (`RadioStrip.tsx`):
  - `@shared/radioSchedule`'s import gains `DEFAULT_RADIO_DRAMA` and `DEFAULT_RADIO_ENERGY`
    (T11 may have added them already);
  - add `import { radioViewStrip, type RadioView } from '@shared/radioView'`;
  - `./RadioControls`' import gains `type ControlSize`;
  - `RadioStripProps` gains, after `ctx`:

```ts
  /** Simple or advanced (@shared/radioView): which of the model's controls are drawn. */
  view: RadioView
```

- [ ] **Step 2: The mix.** `RadioMixActions` draws only what the view shows:

```tsx
/** The model's `mix` group, as the top line's buttons: they act on what is playing. `keep` is
 * the emphasised one; a dead button reads `--ra-text-4`; `similar all` is a word, `rerolling…`
 * and disabled while it rolls (Cmd-click is still immediate). `shown` is the view's mix
 * (radioViewStrip's `top`, by id): simple keeps `keep` alone. */
export function RadioMixActions({
  mix,
  shown
}: {
  mix: RadioMixBundle
  shown: ReadonlySet<string>
}): React.JSX.Element {
  const b = (id: string, a: RadioStripAction, emphasis = false): React.JSX.Element => (
    // ... unchanged ...
  )
  return (
    <>
      {shown.has('similar-all') && (
        <ActionButton
          label={mix.rolling ? 'rerolling…' : 'similar all'}
          onClick={(e) => mix.onSimilarAll(e.metaKey)}
          disabled={mix.rolling}
          tooltip={mix.rolling ? 'rerolling…' : 'similar all'}
        />
      )}
      {shown.has('fetch-hearts') && b('fetch-hearts', mix.hearts)}
      {shown.has('add-to-shelf') && b('add-to-shelf', mix.shelf)}
      {shown.has('add-to-timeline') && b('add-to-timeline', mix.timeline)}
      {shown.has('keep') && b('keep', mix.keep, true)}
    </>
  )
}
```

- [ ] **Step 3: `ColumnBar` at live size.** Above `ColumnBar` (if T11 hoisted its own
  slider-default map, use that instead and skip this constant):

```ts
/** The arc's dials' double-click defaults where simple's live bar draws them. */
const LIVE_DIAL_DEFAULTS: Readonly<Record<string, number>> = {
  energy: DEFAULT_RADIO_ENERGY,
  drama: DEFAULT_RADIO_DRAMA
}
```

  `ColumnBar` gains `size` (default `control`, so every column is unchanged):

```diff
-/** One 0-100 value of a column: a ControlField over a SegmentBar, with its number as the
- * readout. `onChange` is the live half (a preview, a draft), `onCommit` the release; a caller
+/** One 0-100 value of a column (or, `size` live, of the live bar): a ControlField over a
+ * SegmentBar, with its number as the readout. `onChange` is the live half (a preview, a draft),
+ * `onCommit` the release; a caller
  * with only `onChange` is live (source, matching, filter, res). The local draft only feeds the
@@
   disabled = false,
   dimmed = false,
-  tooltip
+  tooltip,
+  size = 'control'
 }: {
@@
   tooltip?: string
+  size?: ControlSize
 }): React.JSX.Element {
@@
       disabled={disabled}
       dimmed={dimmed}
+      live={size === 'live'}
     >
       <SegmentBar
         label={ariaLabel}
         value={value}
-        size="control"
+        size={size}
```

  (Re-wrap that doc comment to 100 columns; prettier does not wrap comments.)

- [ ] **Step 4: `RadioLiveBar`** draws what the view gives it.
  - The signature and its head:

```tsx
/** The live bar (design pass: the controls that PLAY, 36px, raised under the rows, sticky at the
 * bottom): tempo, pace, skip, new bed, fire now (turn and the seven moves), level. It draws the
 * controls the view gives it (`controls`, radioViewStrip's `live`), each only when given: simple
 * leaves out the move chips (`moveChips`) and adds the arc's dials, energy and drama. */
function RadioLiveBar(
  props: RadioStripProps & { controls: readonly RadioStripControl[]; moveChips: boolean }
): React.JSX.Element {
  const { settings, onSettingsChange, play, turn, sound, controls, moveChips } = props
  const byId = (id: string): RadioStripControl | undefined => controls.find((c) => c.id === id)
  const has = (id: string): boolean => byId(id) !== undefined
  // The arc's dials, when the view puts them here (simple, density intensity).
  const liveDials = (['energy', 'drama'] as const).flatMap((id) => {
    const c = byId(id)
    return c?.kind === 'slider' ? [c] : []
  })
```

    Keep T11's own destructuring (its `arc` prop) alongside.
  - Wrap each of these, unchanged inside, in a presence check (prettier re-indents them; that is
    the bulk of the diff):
    - the tempo `ControlField` in `{has('tempo') && (...)}`;
    - the skip `<button>` in `{has('skip') && (...)}`;
    - the new bed `<button>` in `{has('new-bed') && (...)}`;
    - the whole `fire now` `ControlField` in `{has('turn') && (...)}`;
    - **inside it, T11's two `FireButton`s**: `build` in `{has('build') && (...)}` and `drop` in
      `{has('drop') && (...)}`;
    - the moves: `{moveChips && TURNAROUND_MOVES.map((move) => { ... })}`.

    `pace` (`pace?.kind === 'slider' &&`) and `level` (`level !== undefined &&`) already are.
  - After the `fire now` field and before `level`:

```tsx
      {liveDials.map((c) => (
        <div key={c.id} style={{ width: 120 }}>
          <ColumnBar
            label={c.label}
            value={c.value}
            defaultValue={LIVE_DIAL_DEFAULTS[c.id] ?? 50}
            tooltip={c.tooltip}
            disabled={c.disabled}
            size="live"
            onCommit={(v) => onSettingsChange(c.patch(v))}
          />
        </div>
      ))}
```

    Advanced's live bar has no `energy` / `drama` (they are in its picks column), so this draws
    nothing there. In advanced every `has(...)` is true and `moveChips` is true: the bar renders
    as before.

- [ ] **Step 5: `RadioStrip`:**

```tsx
export function RadioStrip(props: RadioStripProps): React.JSX.Element {
  const shown = radioViewStrip(
    radioStripModel(props.settings, props.ctx),
    props.view,
    props.settings
  )
  return (
    <>
      <RadioLiveBar {...props} controls={shown.live} moveChips={shown.moveChips} />
      {/* Simple has no columns: nothing is drawn, the settings keep their values. */}
      {shown.columns.length > 0 && <RadioShapingColumns {...props} groups={shown.columns} />}
    </>
  )
}
```

  Update the file's header comment: the live bar and the columns draw what the view gives them
  (`@shared/radioView`); simple has no columns and no move chips.

- [ ] **Step 6: The panel** (`DiscoverPanel.tsx`).
  - Imports, beside `./RadioStrip`'s:

```ts
import { radioStripModel, type RadioStripContext } from '@shared/radioStripModel'
import { radioViewStrip, type RadioView } from '@shared/radioView'
```

  - Hoist the strip's context, and the mix's `shown`, just above
    `// The mix actions (similar all, fetch hearts, ...)` / `const radioMix: RadioMixBundle = {`:

```ts
  // What the radio view draws (spec 2026-10-05-radio-simple-view-design): the strip model's
  // groups through the view. The top line's mix reads it here; the strip reads it from the same
  // settings, context and view.
  const radioStripCtx: RadioStripContext = {
    artistMode: mode === 'other',
    hasUsername,
    sound: soundNow,
    sounding: previewingSlotIds.size > 0
  }
  const radioMixShown = new Set(
    radioViewStrip(radioStripModel(radioSettings, radioStripCtx), radioView, radioSettings).top.map(
      (c) => c.id
    )
  )
```

  - `<RadioTopLine`: `actions={<RadioMixActions mix={radioMix} shown={radioMixShown} />}`.
  - `<RadioStrip`: the inline `ctx={{ ... }}` becomes `ctx={radioStripCtx}`, and add
    `view={radioView}` after it. T11's `arc={...}` prop stays as it is.

- [ ] **Step 7: Checks.**
  - `npm run typecheck`, `npx vitest run src/shared`, `npx eslint` and `npx prettier --check` on
    `RadioStrip.tsx` and `DiscoverPanel.tsx`.
  - Every model id still has a case. There is no DOM test, so read `RadioLiveBar` against
    `radioView.test.ts`'s simple lists and `radioStripModel.test.ts`'s `places every control in its
    group`, and list in the commit message which ids the live bar gates.
  - `grep -n "radioView" src/renderer/src/components/DiscoverPanel.tsx`: as Task 3 Step 5, plus
    `radioMixShown` and `<RadioStrip`'s `view=`. Nothing radio runs reads it.
- [ ] Commit the two files. Message:
  `radio view: simple's strip (spec 2026-10-05-radio-simple-view-design) -- the live bar draws the controls radioViewStrip gives it (tempo, pace, skip, new bed, turn, build, drop, level each gated on presence; the move chips on moveChips), and in simple energy and drama as live segment bars (commit on release, double-click to their defaults); no shaping columns in simple; the top line's mix keeps keep alone (RadioMixActions' shown, from the same model and view). Advanced draws exactly as before. Hidden settings keep their values and keep working. Unseen by any agent`,
  then the trailer.

### Task 5: The rows (`DiscoverSlotRow.tsx`, `DiscoverPanel.tsx`)

**Depends on:** Tasks 1 and 3. Not on T11.

**Rule (the radio view plans' no-remount rule):** change only conditional children inside the
radio assembly's existing containers. The row root, its children's order (holding bar, button
line, `{waveformCell}`), the `slots.map(<DiscoverSlotRow key={slot.id} …>)` and the rows wrapper
are untouched. The grid layout renders as before (`shows()` is true there).

- [ ] **Step 1: The prop and the parts.**

```diff
--- a/src/renderer/src/components/DiscoverSlotRow.tsx
+++ b/src/renderer/src/components/DiscoverSlotRow.tsx
@@ -49,6 +49,12 @@
 import { RadioRowPlates } from './RadioRowPlates'
 import type { RadioRowPlates as RadioRowPlatesModel } from '@shared/radioRowPlates'
 import {
+  RADIO_LOCK_MARK_TOOLTIP,
+  radioRowParts,
+  type RadioRowPart,
+  type RadioView
+} from '@shared/radioView'
+import {
   peekResolvedCandidateStem,
   resolveCandidateStem,
   type ResolvedCandidateStem
@@ -292,6 +298,7 @@
   soundSourceEndlesss,
   soundSourceAudioIn,
   layout,
+  radioView,
   rowNumber,
   plates
 }: {
@@ -459,6 +466,10 @@
    * runs, the radio view's button line over a full-width waveform. The same parts either way,
    * and the same DiscoverSlotRow, so switching never remounts the row. */
   layout: 'grid' | 'radio'
+  /** The radio layout's view (@shared/radioView): simple draws the live cluster and the label,
+   * advanced every part. Only conditional children of the button line change; the waveform cell
+   * stays where it is, so a switch remounts nothing. The grid ignores it. */
+  radioView: RadioView
   /** The row's place in the list, from 1: the radio layout's accessible name. */
   rowNumber: number
   /** The radio layout's plates on the waveform (@shared/radioRowPlates): label and tail, cue,
@@ -901,6 +912,9 @@
   const rowBtn = radioLayout ? 'var(--ra-h-row-button)' : 18
   const liveBorder = radioLayout ? 'var(--ra-border-strong)' : 'var(--ra-border)'
   const waveHeight = radioLayout ? RADIO_WAVEFORM_HEIGHT : DISCOVER_WAVEFORM_HEIGHT
+  // Which button-line parts the radio layout's view draws; the grid draws them all, as before.
+  const radioParts = radioRowParts(radioView, { locked: slot.locked })
+  const shows = (part: RadioRowPart): boolean => !radioLayout || radioParts.has(part)
 
   // Direct request, 2026-09-15: "an X for remove" -- icon-only, same
   // as every other row button now.
```

- [ ] **Step 2: The lock mark**, right after `const lockButton = (...)`:

```tsx
  // Simple's padlock on a locked row: the lock button's locked look, as a status mark, not a
  // button (spec: hiding an active lock would be confusing).
  const lockMark = (
    <span
      role="img"
      aria-label="locked"
      data-tooltip={RADIO_LOCK_MARK_TOOLTIP}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: rowBtn,
        height: rowBtn,
        background: 'var(--ra-stretch-on-bg)',
        border: '1px solid var(--ra-stretch-on)',
        color: 'var(--ra-stretch-on)'
      }}
    >
      <LockGlyph locked />
    </span>
  )
```

- [ ] **Step 3: `kindsBlock`.** Its first child, the kind `<button ref={kindButtonRef} …>`,
  becomes the first branch of `shows('kind-menu') ? (…) : (…)`, unchanged inside (prettier
  re-indents it); the second branch is simple's label; the meter gains `shows('meter') &&`:

```tsx
      {shows('kind-menu') ? (
        <button
          ref={kindButtonRef}
          // ... the kind button, unchanged ...
        </button>
      ) : (
        // Simple: the kind label in the stem's type colour, not a menu.
        <span
          data-tooltip={slotKindsLabel(slot.kinds)}
          style={{
            maxWidth: 110,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            fontSize: 'var(--ra-fs-10)',
            color: resolvedStem !== null ? stemColorVar(resolvedStem) : 'var(--ra-text-2)'
          }}
        >
          {slotKindsLabel(slot.kinds)}
        </span>
      )}
      {shows('meter') && shownMeter.length > 0 && (
```

- [ ] **Step 4: Popovers of hidden parts** (`const popovers`):

```diff
-      {nearbyMenu && nearbyAnchor !== null && (
+      {nearbyMenu && nearbyAnchor !== null && shows('nearby') && (
@@
-      {reclassifyMenu && slot.candidate && (
+      {reclassifyMenu && slot.candidate && shows('meter') && (
@@
-      {kindMenu && !slot.locked && (
+      {kindMenu && !slot.locked && shows('kind-menu') && (
```

- [ ] **Step 5: The radio assembly's button line** (`if (radioLayout) { … }`):

```diff
             {/* The live cluster: m s, skip like next, hook dig, as icons. */}
-            <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>{muteSolo}</span>
+            <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
+              {shows('mute-solo') && muteSolo}
+            </span>
             <span style={{ display: 'flex', alignItems: 'center', gap: 3, marginLeft: 6 }}>
-              {skipButton}
-              {likeButton}
-              {dislikeButton}
+              {shows('skip') && skipButton}
+              {shows('like') && likeButton}
+              {shows('change-soon') && dislikeButton}
             </span>
             <span
               data-slot="radio-role"
               style={{ display: 'flex', alignItems: 'center', gap: 3, marginLeft: 6 }}
             >
-              {roleButtons}
+              {shows('hook-dig') && roleButtons}
             </span>
-            {kindsBlock}
+            {shows('kind') && kindsBlock}
             <span style={{ flex: 1 }} />
-            {/* The extras, quieter. */}
-            {anyStemButton}
-            {nearbyButton}
-            {duplicateButton}
-            {lockButton}
-            {removeButton}
+            {/* The extras, quieter: advanced only. Simple shows a locked row's lock as a mark.
+                Each slot is fixed, so a switch shifts nothing and remounts nothing. */}
+            {shows('any-stem') && anyStemButton}
+            {shows('nearby') && nearbyButton}
+            {shows('duplicate') && duplicateButton}
+            {shows('lock') && lockButton}
+            {shows('lock-mark') && lockMark}
+            {shows('remove') && removeButton}
           </div>
           {waveformCell}
         </div>
```

- [ ] **Step 6: The panel passes the view** (`DiscoverPanel.tsx`, the `<DiscoverSlotRow` in
  `slots.map`), after `layout={radioOn ? 'radio' : 'grid'}`:

```tsx
              radioView={radioView}
```

- [ ] **Step 7: No-remount and grid checks.**

```bash
cd /Users/nickel/Claudecode/sssketch/src/renderer/src/components
grep -c "ref={rowsRef}" DiscoverPanel.tsx                  # 1
grep -c "ref={sweepLineRef}" DiscoverPanel.tsx             # 1
grep -n "data-fold-dot=" *.tsx                             # RadioRowPlates.tsx only
grep -c "<DiscoverSlotRow" DiscoverPanel.tsx               # 1
grep -n "key={slot.id}" DiscoverPanel.tsx                  # the same row key as before
git diff -U0 DiscoverSlotRow.tsx | grep -n "waveformCell"  # nothing: the waveform cell is untouched
```

  Read by hand:
  - the row root's children are still `{holding && …}`, the button-line `<div>`, `{waveformCell}`,
    in that order;
  - every grid-layout use of the parts is unchanged (`shows()` is true with `radioLayout` false);
  - the kind button's grid styling is unchanged (only its indent moved).
- [ ] **Step 8: Verify, commit.** `npm run typecheck`, `npx eslint` and `npx prettier --check` on
  both files. Commit `DiscoverSlotRow.tsx` and `DiscoverPanel.tsx`. Message:
  `radio view: simple's rows (spec 2026-10-05-radio-simple-view-design) -- the radio layout's button line draws radioRowParts: simple keeps m s, skip, like, change soon, hook dig and the kind label (in the stem's type colour, not a menu; no meter); the extras (any stem, nearby, duplicate, lock, remove) only in advanced; a locked row in simple shows its padlock as a mark (role img, the locked look, "locked · unlock in advanced"), not a button. Conditional children inside the existing containers only: the waveform cell and the row key are untouched, so a switch remounts no row; a hidden part's popover leaves with it. The grid (radio off) is unchanged. Unseen by any agent`,
  then the trailer.

### Task 6: Verification, review, handoff, walkthrough

- [ ] **Step 1: Green.** `npm test`, `npm run typecheck`, `npm run lint` (the engine-spawn tests
  aside, as before). In `/Users/nickel/Claudecode/ell.ing/radio`: `npm run typecheck` and
  `npx vitest run` (it reads `@shared` from this tree; nothing it imports changed).
- [ ] **Step 2: The spec's notes, one by one:**
  - visibility only: `grep -rn "radioView" src/` finds `radioView.ts`, its test, the store, App,
    LibraryBrowser, DiscoverPanel's props / `radioStripCtx` / JSX, `RadioTopLine`, `RadioStrip`,
    `DiscoverSlotRow`, and nothing under `src/main` but the store (no IPC to the engine or the
    phone), nothing in a hook deps array;
  - no remounts: Task 5 Step 7 again on the final tree;
  - the coverage test runs against advanced and still bites: Task 1 Step 4 again;
  - simple's list is pinned: `radioView.test.ts`.
- [ ] **Step 3: Review** with superpowers:requesting-code-review against the spec and this plan's
  decisions.
- [ ] **Step 4: Handoff.**
  - Add a memory note `radio_simple_view_shipped.md`: what landed, decision 3's open question, that
    it is unpushed and needs Elling's walkthrough. Add its line to `MEMORY.md`.
  - Add an "As built" section to the spec with the commits, any deviation from this plan, and
    "unseen by any agent".
  - **Do not push.**
- [ ] **Step 5: The walkthrough** (Elling's). Fully quit (Cmd+Q) and relaunch `npm run dev`.
  **No agent can click through the UI, see it or hear it; none of this has been seen.**
  1. **Opens in simple.** Start radio. It is in `simple`:
     - the top line has play/stop, `radio` with its interval line, the status line, the ruler
       (fold's line with fold on), `keep` alone, the `simple / advanced` switch, undo and redo;
     - each row has m s, skip, 👍, 👎, hook, dig and the coloured kind label over the waveform
       and its plates (age, role words, `next`, flashes, fold's `7 / 16`, an away hook's name);
     - the live bar has tempo, pace, skip, new bed, turn and level;
     - there are no columns and no move chips.
  2. **Switch mid-loop.** With a loop playing and a change on its way (a row breathing), switch
     to advanced and back, a few times. Expect:
     - no audible restart or dropout;
     - no waveform blinking to its loading line, the playhead keeps running;
     - the waiting change lands as it would have.
  3. **Remembered.** Leave it on advanced, Cmd+Q, relaunch, start radio: advanced. Back to simple,
     relaunch: simple.
  4. **A locked row.** Lock a row in advanced, switch to simple: the row shows its padlock as a
     mark (it does nothing when clicked; its tooltip says `locked · unlock in advanced`). Unlock
     it in advanced: the mark goes.
  5. **Hidden settings keep working.** In advanced set fold on, turnarounds `often` and a
     different turnover; switch to simple. Fold's readout still shows on rows, turnarounds still
     mark the phrase ends, and `t` and `turn` still turn.
  6. **Intensity.** Set density to `intensity` in advanced, then switch to simple: `build` and
     `drop` sit after `turn`, `energy` and `drama` before `level`. Drag energy in simple, then
     check advanced's picks column shows the same value. Double-click resets each dial. Set
     density back to `arc`: simple shows none of the four (decision 3: say if you would rather
     see them greyed).
  7. **Keyboard and tooltips.** Tab reaches the switch, Enter or Space switches, and each view's
     tooltip says what the other view adds or leaves out.
  8. **Open popovers.** In advanced open a row's kind menu, its nearby popover and the artist
     picker one at a time, then click `simple`: each closes.
  9. **Widths.** At 945 × 614 and at about 1440: simple's top line and live bar fit with no
     sideways scroll; count the rows between the sticky bars (more than advanced's).
  10. **Radio off and the phone.** Stop radio: Discover looks exactly as before. The phone remote
      works as before in either view.

## Risks, per task

- **T1: the coverage test.** It must not be weakened to pass. Step 4 proves it still fails when
  advanced drops a group.
- **T2: whole-object test expectations.** Every `toEqual` on `loadDiscoverSettings()` gains
  `radioView`. Missing one fails loudly, so it is safe.
- **T3: a switch that does nothing.** Until T4 and T5 land, the switch only saves. Land the three
  together.
- **T3: App's merge.** `updateDiscoverSettings` spreads the render's `discoverSettings`. Two writes
  in the same tick (a view switch and a radio setting) could drop one. This is the existing
  pattern (the trait match bar shares it), and a switch is a click, so it is unlikely.
- **T4: merging with T11.** `RadioStrip.tsx` is T11's file too. Re-anchor by function name. Gate
  T11's `build` / `drop` buttons; do not move them.
- **T4: the live bar's look in simple.** Fewer controls, plus two 120px dials at live size. It is
  not measured; walkthrough 9 checks it by eye.
- **T5: remounts.** This is the radio view plans' risk again. Only conditional children inside the
  button line change, and the waveform cell, the row key, `rowsRef`, `sweepLineRef` and
  `data-fold-dot` are untouched (Step 7's greps).
- **T5: the kind button's ref.** In simple `kindButtonRef` is null; the kind picker that reads it
  (`ignoreRef`) is not rendered then.
- **Move visuals** (spec `2026-10-05-radio-move-visuals-design`, not yet planned) draw on the
  waveform and the plates, which both views keep. When that lands, its row changes stay outside
  `radioRowParts`.
