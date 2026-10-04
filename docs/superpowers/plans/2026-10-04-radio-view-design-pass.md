# sssketch Radio View: Design Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the radio view's look to Elling's design pass (claude.ai/design canvas, board
**3a "radio view · playing over shaping"** and **3b "start prompt"**). This pass changes layout,
hierarchy and visual consistency only. Every control keeps what it does, when it commits, its undo
and its keyboard behaviour, and every radio setting stays on screen while radio runs.

**The idea: two weights, one control language.**
- **Playing** controls are 36px tall, in a raised **live bar** right under the rows: tempo, pace,
  skip, new bed, `fire now` (turn and the seven moves), level. `skip` has the one bright border
  and flickers on each landing.
- **Shaping** controls are 26px tall, in **five quiet titled columns** under the live bar: picks
  ("which stems come up"), shape ("how long things last"), moves ("what happens between"), fold
  ("how far it drifts") and sound ("the output").
- **One language:**
  - selected is a filled `--ra-text` block with dark ink, everywhere;
  - every 0–100 value is a 10-cell **segment bar** with its number;
  - each choice is a row of equal-width segments;
  - `fire now` buttons are dashed: they fire once and are never selected;
  - disabled means the whole control at low opacity.
- **The top line** is one band: transport (stop/play, `radio` with its interval line), then the
  status line, the ruler and fold's line, then the **mix actions** (moved up from the strip, since
  they act on what is playing; `keep` emphasised), then undo/redo.
- **Rows:**
  - live buttons in one bordered cluster at the left (`m s · skip like next · hook dig`);
  - then one kind label in the row's type colour, with its match meter;
  - the extras borderless and grey at the right (`any near dup lock x`);
  - the waveform full width, with the plates sitting on it.

**Brief:** `docs/superpowers/specs/2026-10-04-radio-view-design-pass-brief.md` (constraints,
inventory, code map). **Spec of the view being restyled:**
`docs/superpowers/specs/2026-10-03-sssketch-radio-view-design.md`, including its "As built" section.
**Previous plan, for format and for the risks that still apply:**
`docs/superpowers/plans/2026-10-04-sssketch-radio-view.md`.

**Reference screenshots** of the canvas, rendered in headless Chrome with real Silkscreen. The
blocky waveforms are canvas placeholders, so keep our real waveforms:
- `docs/superpowers/references/radio-view-design-pass/ref-3a-radio-view-1440.png`: 3a at the
  1440 width preset;
- `.../ref-3a-radio-view-945.png`: 3a at the 945 minimum. The top line's mix wraps to a second
  line, `fire now` and level wrap under tempo and pace, and the sound column drops alone to a
  second row (this plan fixes that last one, see decision 8);
- `.../ref-3b-start-prompt.png`: 3b, the start prompt;
- `.../ref-3a-notes.png`: the canvas's own four notes ("two weights", "one control language",
  "rows and top line", "cut, open, unjudged").

The canvas source is `phone.html`. Its sections "2a", "thumb console", "cartridge", "pair" and
"desktop modal" are earlier boards and are **not** in scope.

**Tech stack:** TypeScript, React 19, Electron (electron-vite), vitest (node, no DOM),
`@phosphor-icons/react`.

**Repo:** sssketch only. Base: `master` at this plan's commit. **Branch:** `radio-view-design-pass`
(`git switch -c radio-view-design-pass`).

**Commits:** every commit message ends with exactly these two lines, after a blank line:

```
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01KK8TyKjVKvWU8ZjQCk3ozz
```

Commit each task's own files only (`git commit --only <paths>`), never `git add -A`. Other agents
share this tree, and `native-engine/.cache/` is untracked and not ours.

**Before you start:**
- Run `git status --short` and leave other agents' files alone.
- Run `npm test`, `npm run typecheck` and `npm run lint`. They should be green, except the
  machine-dependent engine-spawn tests (memory `coreaudiod_thread_leak`).
- `DiscoverPanel.tsx` (~12k lines) changes daily. Anchor every edit on function names and quoted
  context, never on line numbers.

**No agent can run the app, see it, hear it or click it.** Every UI task is checked by typecheck,
lint, the shared tests, the grep checks written into the task, and Elling's walkthrough at the end.
Say so in every commit message that touches the UI ("unseen by any agent").

---

## Gap check: the brief's inventory against 3a

Key: **in 3a** means the canvas draws it. **Plan** says where it lands and what the plan decides
when 3a drops or changes something.

### Top line

| inventory item | in 3a | plan |
|---|---|---|
| play/stop | yes, 36px square at the left | as drawn (`--ra-h-live`); disabled while nothing is in the mix, as today |
| `radio` + interval line | yes, filled, with a 2px line along its bottom edge | as drawn: the line moves *inside* the button's bottom edge (today it sits under the button) |
| undo / redo | yes, far right, after a rule | as drawn; undo still withdraws a waiting turn first |
| status line | yes, `--ra-fs-10`, `--ra-text`, left-aligned | as drawn (today it is 9px, `--ra-text-2`, centred) |
| phrase ruler | yes, but as 16 4px cells: played, now, ahead, every 4th ahead brighter | as drawn: one cell per bar from `readout.ruler` (pure helper `radioRulerCells`, Task 4) |
| ruler end label (`wash`, `turn: drop`) | **dropped** | **kept**, at the ruler's right, `--ra-fs-9`, `--ra-text-3`, as today: it says which turnaround ends the phrase |
| fold's status line | yes, under the ruler | as drawn, unchanged |
| artist / lingering notes | not drawn | kept under the top line as today (`role="note"`) |
| mix: similar all, fetch hearts, add to shelf, add to timeline, keep | **moved here** from the strip | as drawn (Task 6); `similar all` becomes a word button (see decision 6) |

### Each row

| inventory item | in 3a | plan |
|---|---|---|
| m, s | yes, cluster 1 | `m` on: `--ra-mute-on` fill, `--ra-mute-on-ink` ink; `s` on: filled |
| skip | yes, cluster 2 (word) | word button; keeps its pulse while rerolling, its dim while a manual change waits, and Cmd for immediate |
| 👍 like (star shows favourited) | yes, `like` / `★ like` | word `like` with a leading Phosphor `Star` (fill) when favourited. Silkscreen has no ★ (see the meter's comment in `DiscoverSlotRow.tsx`), so the star is an icon. It keeps today's `--ra-recording-live` ink |
| 👎 change next | yes, `next` | word `next`, filled while replace-soon is set; tooltip and aria stay `change soon` (question 3) |
| hook, dig | yes, cluster 3 | words, filled while set; same tooltips (`RADIO_HOOK_*`, `RADIO_DIG_*`) |
| any stem, nearby, duplicate, lock, remove | yes, borderless grey words at the right: `any near dup lock x` | as drawn; `nearby` still shows only with a nearby anchor; `lock` is filled while locked (one "selected" look) |
| kinds menu | yes, `drummy ▾` in the type colour | as drawn: `stemColorVar(resolvedStem)`, or `--ra-text-2` while unresolved; no `▾` while locked, as today |
| match meter / `guess` | yes, 5 cells + `guess` right after the kind label | as drawn. The mask entry's duplicated `drummy:` prefix goes when the slot has one kind (pure helper `compactRadioMeter`, Task 4); `guess` stays the reclassify button |
| waveform, full width, type colour | yes, 60px | 60px in the radio layout (`RADIO_WAVEFORM_HEIGHT`); the grid layout keeps 40 |
| label plate (label · age · role words) | yes, top-left | as drawn: 9px, solid `--ra-bg-page`, 1px `--ra-border` |
| cue flashes and `next` | yes, top-right; `next` inverted | **moves top-right** (today bottom-right): `next · …` is an inverted plate, and a flash word is a normal plate beside it |
| `no fave fits`, `no near fits` | yes (`no near fits`, top-right, dim) | flash words on the cue plate, as today |
| fold readout `7 / 16` + phase dot | yes, bottom-right, `7 / 16 ●` | **moves bottom-right** (today top-right). The ● is a placeholder: keep the 28px phase-dot track with `data-fold-dot`, inline after the count |
| away hook's name, clickable | yes, bottom-left, dim | as drawn and as today (bottom-left; the one plate with pointer events) |
| holding bar | yes, 3px, type colour | 3px in `stemColorVar(resolvedStem)` (today 2px `--ra-text` at 45%). The row's type colour is audio information |
| approach background (armed/held) | drawn as a static lighter row and a strong border | the breath (`--discover-breath` `color-mix`) stays as it is, plus a `--ra-border-strong` frame while `radioApproach !== null` |

### Play (the live bar)

| inventory item | in 3a | plan |
|---|---|---|
| tempo − / value / + | yes, 36px | as drawn; the value stays a typed field (blur/Enter commits) |
| `bpm` caption | dropped | the control's label reads `tempo`, and its readout slot (right of the label) reads `bpm` |
| match seed (only when the seed tempo differs) | **dropped** | **kept**: a 36px button after `+`, same condition and label `match seed (N)` |
| pace + readout (`2-4 bars`, `ludicrous`, fold window) | yes, 8 cells + readout | segment bar with **10 cells** (decision 3); the readout is `radioPaceLabel(shown, { fold })` |
| skip (flickers) | yes, the one bright border | as drawn; the flicker stays today's `radio-landing-flicker` (playhead-colour ink, off with reduced motion) |
| new bed | yes | as drawn |
| turn + move chips (fire now, dim when they can't sound) | yes, **moved here** from shape; dashed | as drawn. `turn` shows `turning` / its flash, inverted while a turn waits; a move is inverted while held, `--ra-text-4` dashed with tooltip `not now` when it can't sound |
| level | yes, **moved here** from sound, right-aligned | as drawn; disabled while nothing sounds, as today |

### Picks, shape, moves, fold, sound (the columns)

| inventory item | in 3a | plan |
|---|---|---|
| faves, source, matching (0–100) | segment bars | as drawn. Faves stays dimmed (live) in artist mode. Source's label is `source · endlesss - other` (`↔` fails the no-emoji test, Task 3) |
| artist | drawn as segments `elling` / `anyone` | **changed** (decision 5): one full-width field button (`elling ▾`) that opens `DiscoverArtistPicker`, filled while another artist is picked. There is no "anyone" setting: `null` means your own stems |
| my sounds | segments `on` / `off` | as drawn; disabled without a username or in artist mode, as today |
| density off / arc | segments | as drawn |
| channels (density off) | drawn **dimmed** with density arc, as 6 cells | segments `2 … 8` (seven, `RADIO_CHANNEL_OPTIONS`: it is a choice, not a 0–100 value), disabled with density arc (question 2) |
| turnover even / random | segments | as drawn |
| phrase, loop end, transitions, builds | segments, in **shape** | as drawn. Loop end reads `2 4 8 always` under the label `loop end · bars` |
| turnarounds, families, depth | segments, in a new **moves** group | as drawn. Families (`moves` today) is multi-select. Families and depth are disabled while turnarounds is `off` (question 2; the canvas leaves them live) |
| fold on/off | segments `on` / `off` | as drawn (replaces the `fold: on` word switch) |
| bend, mismatch (0–100) | segment bars, dimmed with fold off | as drawn (question 2) |
| seed + `new` | field + button, dimmed with fold off | as drawn; Escape in the field still reverts and stops there |
| reverb, filter, res (0–100) | segment bars | as drawn; disabled while nothing sounds, as today |
| filter mode | segments `lo pass` / `hi pass` | as drawn (it is a control again, not a field) |
| the canvas's "res and mode disabled with filter at 0" | **added** by the canvas | **not adopted:** it would be new behaviour, and cutoff 0 is not "off" in our filter (a low-pass is open at 100, see `neutralCutoff`) |
| `project sound · undoable` divider | yes | as drawn; the tooltips keep `project sound · needs mastering` / `· switched off in sound` |
| saturation, pump, echo | segment bars | as drawn: release commits one `SET_SOUND_SETTINGS`; greyed exactly as the sound panel greys them |

### Mix, start prompt, leftover UI

| inventory item | in 3a | plan |
|---|---|---|
| keep, fetch hearts, add to shelf, add to timeline, similar all | top line | as drawn: keep's `keeping…` / kept labels and pulse, the listen-only dimming and `✓ added` all kept. `add to timeline` loses its special fill, and `keep` takes the emphasis |
| start prompt: pace, density, channels, start | 3b: title `start radio`, pace bar, density segments, channels (dimmed with arc), a full-width `start` | as drawn; `start` still starts at the bar's draft, and position, dismissal and Escape capture are unchanged |
| "add a stem that is …" / "hold shift to combine" | **removed** while radio runs | hidden while radio runs, back with radio off (question 1) |

**Nothing else in the inventory is missing from 3a.** The changes are the ones marked above: the
ruler end label, match seed, `bpm`, artist, the filter-at-0 rule, the star glyph and the fold dot.

---

## Questions for Elling

Each has a default the plan builds. The executor does not wait on an answer, but must not merge
before Elling has seen these.

1. **"add a stem that is" in radio.** The canvas removes it while radio runs ("it is grid ui; rows
   still change via skip and the kinds menu. say if it stays"). Without it, the only ways to grow
   the mix in radio are `dup`, density arc and stopping radio. **Default: hidden while radio
   runs.**
2. **Greyed or hidden.** The canvas greys channels (density arc) and bend, mismatch and seed (fold
   off), where today they are hidden. On 2026-10-03 you chose "hidden as before, not disabled" for
   the web's fold sliders. Greying keeps the columns from jumping, and every setting is visible
   ("everything out front"). **Default: greyed, and families and depth (turnarounds off) greyed the
   same way for consistency.**
3. **Row buttons: words or icons.** The canvas draws words (`skip like next`, `any near dup lock
   x`). Today these are Phosphor icons (your 2026-09-29 call). Also, `next` (👎) shares its word
   with the cue plate's `next · filter in`. **Default: words as drawn, with `next`'s tooltip still
   `change soon`.**

**Elling's answers (2026-10-04, relayed by the coordinator):**
1. "add a stem that is" is **hidden while radio runs** (the default stands).
2. Settings that do not apply are **greyed, not hidden**: channels (density arc), bend, mismatch
   and seed (fold off), families and depth (turnarounds off).
3. Row buttons **stay icons**, not words. Task 9 keeps today's Phosphor icon buttons and their
   tooltips, and adopts only the design's grouping and sizes: live cluster `m s · skip like next
   · hook dig` as icons, then the kind label with its meter, then the extras
   (`any near dup lock x`) as icons, quieter (borderless, `--ra-text-3`). Task 9 Step 2's
   `word`/`look` props become `look: 'live' | 'extra'` only (size and border, no word).

## Decisions made in planning

1. **Tokens.** The canvas's colours map onto existing tokens (table below). Four tokens are new,
   because the "two weights" idea needs them in several files: `--ra-h-live: 36px`,
   `--ra-h-control: 26px`, `--ra-h-row-button: 24px` and `--ra-opacity-disabled: 0.3`. The last
   formalises the rule already written at the foot of `tokens.css` ("disabled = 30% opacity"); the
   canvas's 0.35 rounds to it. No new colours.
2. **One shared widget per kind of value**, in `RadioControls.tsx`:
   - `SegmentBar` for 0–100;
   - `Segmented` for choices (single or multi);
   - `FireButton` for momentary moves;
   - `ActionButton` for mix;
   - `ControlField` for the label/readout header every control has.
   The pure math (cells, pointer → value, keys) lives in `src/shared/radioSegmentBar.ts`, under TDD.
3. **Segment bars keep full 0–100 resolution.** The canvas's bars click to multiples of 10, which
   would change behaviour. Ours light cells fractionally (the last lit cell partly filled), and:
   - a pointer press or drag sets the value under the pointer, to 1;
   - the wheel moves it as `dialValueAfterWheel` does, committing 200ms after the last notch;
   - the arrows move it ±1 (Shift ±10), Home/End go to the ends, and PageUp/PageDown move ±10;
   - double-click resets to the control's default;
   - each control keeps its preview/commit split (faves `previewFaves`/`commitFaves`, reverb
     draft/commit, pace/bend/mismatch/sound commit on release, source/matching/level/filter/res
     live).

   Pace has 10 cells too, not the canvas's 8: one language, and pace's thresholds (71, 80, 90)
   fall on cell edges. It is `div role="slider"`, as `Dial` is, so `t` works after a drag with no
   blur needed. A pointer gesture still leaves no focus behind (it blurs on release), so pace and
   bend behave as the brief requires.
4. **The model owns placement.** `radioStripModel` gains a `moves` group and two fields per group:
   `place: 'top' | 'live' | 'columns'` and `subtitle`. `turn` and `level` move into `play`, and
   turnarounds/families/depth into `moves`. Conditional controls are **always present** and
   `disabled` with a reason in the tooltip (question 2), so "nothing hidden" now holds in every
   state, not only across states.
5. **Artist** stays one button opening the picker. The canvas's `elling | anyone` assumes a binary
   that does not exist (`artist: null` is your own stems; any other name comes from the picker's
   search). It renders as a full-width 26px field showing `artistFieldLabel` without its `artist: `
   prefix (the column label says it) plus `▾`, filled while `artistActive`.
6. **`similar all`** becomes a word button, since the canvas has no dice. While rolling it reads
   `rerolling…`, disabled, as its aria-label says today. Cmd-click is still immediate.
7. **The live bar is sticky at the bottom** (as the strip is today), so the playing controls are
   always in reach. The columns flow after it, so the bar sits on top of them once you scroll to
   the end. The top line stays sticky at the top.
8. **Columns:** `display: grid; gridTemplateColumns: repeat(5, minmax(0, 1fr))` at every width
   the app allows. At 945 each column is ~185px (161px inside a 12px padding), which fits
   phrase's three segments (measured in Silkscreen 9px: `loop` + `16 bars` + `32 bars` + padding
   = 159px). Segments wrap inside a column when they must (families at 945). The canvas's
   `auto-fit, minmax(220px, …)` left sound alone on a second row at 945 (see the screenshot).
9. **One column width for the whole radio view.** The top line, notes, rows wrapper, live bar and
   columns share `RADIO_VIEW_MAX_WIDTH = 1440` with `margin: 0 auto`, replacing the rows' 1200px
   cap, so left edges align (the brief's "dead space" complaint). This changes the rows wrapper's
   **style** only, never the element.
10. **Row insets are constants.** The radio row is 1px bordered, with 14px of inner padding at the
    left (room for the holding bar) and 8px at the right. The playhead overlay's insets read the
    same constants (`RADIO_ROW_INSET_LEFT = 15`, `RADIO_ROW_INSET_RIGHT = 9`, border included)
    from `discoverRowGrid.ts`, replacing the two hard-coded `6`s. Getting this wrong misplaces the
    one playhead line.
11. **Plates become two flex bars.**
    - The top bar holds the label (it shrinks, ellipsis on the label part, the tail kept whole)
      and the cue at the right.
    - The bottom bar holds the away hook's name at the left and the fold readout at the right.
    - This settles the canvas's "plate collisions on busy rows" by construction.
    - `radioRowPlates.ts` (the words) does not change.
12. **Sizes map onto the type scale.**
    - 9px → `--ra-fs-9`;
    - 10px → `--ra-fs-10`;
    - 11px → `--ra-fs-11`;
    - the canvas's 12px (skip, the play glyph, `start radio`, `start`) → `--ra-fs-13`;
    - 13px (the tempo value) → `--ra-fs-13`.
    - The start button's 44px → `--ra-h-transport` (46px).

### Colour and size map (canvas → tokens)

| canvas | token |
|---|---|
| `#050505` (frame, selected ink, plate ground) | `--ra-bg-page` |
| `#0a0a0a` (rows, raised bar, seed field) | `--ra-bg-row` / `--ra-bg-bar`. The raised live bar uses `--ra-bg-row-sub` (`#0e0e0e`): the panel's own fill is already `#0a0a0a`, so "raised" needs one step up, plus `--ra-border-strong` rules |
| `#111111` (armed row) | none: the breath does it (above) |
| `#222222` (rules, empty cells, quiet borders) | `--ra-border` |
| `#3a3a3a` (control borders) | `--ra-border-strong`; as ink (redo disabled) `--ra-text-4` |
| `#6a6a6a` (labels, extras) | `--ra-text-3` |
| `#8f8f8f` (unselected segment ink, readouts, played ruler) | `--ra-text-2` |
| `#ededed` (text, selected fill, lit cells) | `--ra-text` (fills of a "live" state: `--ra-play-on`) |
| `#c56164` (`m` on) | `--ra-mute-on` / ink `--ra-mute-on-ink` |
| type colours (kind label, waveform, holding bar) | `stemColorVar(resolvedStem)` (`theme/typeColor.ts`) |
| 36px live controls, transport, top-line squares | `--ra-h-live` (new) |
| 32px top-line mix buttons, undo/redo | `--ra-h-live` too: one height for the top band (the canvas's 32 vs 36 is not a distinction worth a token) |
| 26px shaping controls, start-prompt segments | `--ra-h-control` (new) |
| 24px row buttons | `--ra-h-row-button` (new) |
| 14px cell height (shaping bars) | `--ra-s-6` |
| gaps 2 / 3–4 / 6 / 12 / 16–24 | `2px` literal (the cell gap, as the match meter's 1px is) / `--ra-s-1` / `--ra-s-2` / `--ra-s-5` / `--ra-s-7` |
| low opacity (disabled) | `--ra-opacity-disabled` (new, 0.3) |

## File map

**Create:**
- `src/shared/radioSegmentBar.ts`, `src/shared/radioSegmentBar.test.ts` (Task 2).

**Modify:**
- `src/renderer/src/styles/tokens.css` (Task 1);
- `src/shared/radioStripModel.ts`, `radioStripModel.test.ts` (Task 3);
- `src/shared/radioReadout.ts` and its test (Task 4: `radioRulerCells`);
- `src/shared/discoverMatchMeter.ts` and its test (Task 4: `compactRadioMeter`);
- `src/renderer/src/components/RadioControls.tsx` (Task 5; the old widgets go in Task 12);
- `RadioTopLine.tsx` (Task 6);
- `RadioStrip.tsx` (Tasks 6–8: `RadioMixActions`, `RadioLiveBar`, `RadioShapingColumns`);
- `DiscoverSlotRow.tsx`, `RadioRowPlates.tsx`, `discoverRowGrid.ts` (Task 9);
- `DiscoverPanel.tsx` (Tasks 6–10: wiring only, kept small);
- `RadioStartPrompt.tsx` (Task 11);
- the spec's as-built section (Task 13).

## Task graph

```
T1 tokens ──────────────┐
T2 segment bar math ────┼─> T5 widgets ─> T6 top line + mix ─> T7 live bar ─> T8 columns ─> T9 rows ─> T10 frame, add row ─> T11 start prompt ─> T12 cleanup ─> T13 verify, walkthrough
T3 strip model ─────────┤
T4 ruler cells, meter ──┘
```

- T1–T4 are parallel-safe (separate files, inert until imported).
- T6–T11 all touch `DiscoverPanel.tsx` or `RadioStrip.tsx`, so they run strictly in order.
- T9 is the risky one: rows must not remount, and the playhead and fold dots are written outside
  React.

---

## Phase 1: tokens and pure rules (TDD)

### Task 1: Tokens

**Files:** Modify `src/renderer/src/styles/tokens.css`.

- [ ] **Step 1.** Under `/* ——— geometry ——— */`, after `--ra-h-titlebar`, add:

```css
  /* The radio view's two weights (design pass 2026-10-04, plans/2026-10-04-radio-view-design-pass):
   * playing controls 36px, shaping controls 26px, a row's own buttons 24px. */
  --ra-h-live: 36px;
  --ra-h-control: 26px;
  --ra-h-row-button: 24px;
```

  Under the closing comment's rule ("disabled = 30% opacity"), inside `:root` before `}`, add
  `--ra-opacity-disabled: 0.3;` with a one-line comment pointing at that rule.
- [ ] **Step 2.** `npm run typecheck && npm run lint`, then commit (`tokens: radio view heights
  and the disabled opacity`).

### Task 2: Segment bar math (`radioSegmentBar.ts`)

**Files:** Create `src/shared/radioSegmentBar.ts` and `src/shared/radioSegmentBar.test.ts`.

Write the tests first, watch them fail, then implement.

```ts
/** How lit each of `cells` cells is, 0..1, for `value` in [min, max]: the last lit cell partly. */
export function segmentBarFills(value: number, cells: number, min?: number, max?: number): number[]
/** The value under a pointer at `x` px across a bar `width` px wide, on `step`, clamped. */
export function segmentBarValueAt(x: number, width: number, o?: { min?: number; max?: number; step?: number }): number
/** The value a key gives, or null for a key the bar does not take. */
export function segmentBarKey(value: number, key: string, shift: boolean, o?: { min?: number; max?: number }): number | null
```

- [ ] **Step 1: Tests.**
  - `segmentBarFills(0, 10)` is ten 0s; `segmentBarFills(100, 10)` is ten 1s;
    `segmentBarFills(35, 10)` is `[1,1,1,0.5,0,0,0,0,0,0]`; values outside 0..100 clamp; NaN
    reads as min.
  - `segmentBarValueAt(0, 200)` is 0; `(200, 200)` is 100; `(99, 200)` is 50 (rounded to step
    1); negative x and x past the width clamp; width 0 gives min.
  - `segmentBarKey`:
    - `ArrowRight` / `ArrowUp` give +1 and `ArrowLeft` / `ArrowDown` give −1; Shift makes these
      ±10;
    - `PageUp` / `PageDown` give ±10;
    - `Home` / `End` give min / max;
    - a result clamps, and returns null when it equals `value` (no commit for a no-op);
    - `Tab` is null.
- [ ] **Step 2.** Implement, with `npx vitest run src/shared/radioSegmentBar.test.ts` green. Then
  `npm run typecheck`, and commit.

### Task 3: The strip model, regrouped (`radioStripModel.ts`)

**Files:** Modify `src/shared/radioStripModel.ts` and `src/shared/radioStripModel.test.ts`.

Tests first. The "nothing hidden" test (`sets every radio setting from some control`) must stay
**unchanged** and green.

- [ ] **Step 1: Types.** Add `'moves'` to `RadioStripGroupId`. `RADIO_STRIP_GROUPS` becomes
  `['play', 'picks', 'shape', 'moves', 'fold', 'sound', 'mix']`. `RadioStripGroup` gains
  `place: 'top' | 'live' | 'columns'` and `subtitle: string | null`. Export
  `RADIO_STRIP_SUBTITLES`:
  - picks: `which stems come up`;
  - shape: `how long things last`;
  - moves: `what happens between`;
  - fold: `how far it drifts`;
  - sound: `the output`;
  - play and mix: `null`.
- [ ] **Step 2: Placement and order** (update `places every control in its group, in reading
  order`):
  - play (`live`): `tempo, pace, skip, new-bed, turn, level`;
  - picks (`columns`): `faves, source, matching, artist, my-sounds, density, channels, turnover`;
  - shape (`columns`): `phrase, loop-end, transitions, builds`;
  - moves (`columns`): `turnarounds, moves, depth`. The `moves` control's label becomes
    `families`; keep the id `moves` and `sets: ['turnaroundMoves']`;
  - fold (`columns`): `fold, bend, mismatch, seed`;
  - sound (`columns`): `reverb, filter, res, filter-mode, saturation, pump, echo`;
  - mix (`top`): `similar-all, fetch-hearts, add-to-shelf, add-to-timeline, keep`.
- [ ] **Step 3: Greyed, not omitted** (rewrite the `visibility` describe; see question 2):
  - **New test:** "every control is present in every state". The id list per group is identical
    across `STATES`.
  - `channels` is `disabled` unless density is `off`, with tooltip `with density off`.
  - `moves` and `depth` are `disabled` while turnarounds is `off`, with tooltip suffix
    `· with turnarounds on`.
  - `bend`, `mismatch` and `seed` are `disabled` with fold off, with suffix `· with fold on`.
  - Disabled chips still carry their patches (the renderer makes them inert), so `only patches what
    a control says it sets` stays as is.
  - Keep `greys the master dials while nothing sounds, and nothing else`, with the new disabled
    set listed per state. Level's rule is unchanged; it only moved group.
- [ ] **Step 4: Words.**
  - `radioLoopEndLabel` gives `'2'`, `'4'`, `'8'`, `'always'`, and the control's label is
    `loop end · bars`. Update `labels loop end and phrase as the menu did`; phrase stays
    `loop`, `16 bars`, `32 bars`.
  - `source`'s label becomes `source · endlesss - other`. The canvas draws `↔`, but U+2194 is
    `Extended_Pictographic`, so the words test rejects it. Silkscreen has no glyph for it either,
    so it would render in a fallback font.
  - Extend the words test to cover `subtitle`.
  - The hint sentences stay one per control, on the same controls.
- [ ] **Step 5.** Make it pass: `npx vitest run src/shared/radioStripModel.test.ts`.
  `RadioStrip.tsx` still compiles, because it maps over groups. Expect it to render `moves` as a
  seventh flex group until Task 7, which is fine because nothing is lost. Run
  `npm run typecheck`, then commit.

### Task 4: Ruler cells and the compact radio meter

**Files:** Modify `src/shared/radioReadout.ts` (+ `radioReadout.test.ts`) and
`src/shared/discoverMatchMeter.ts` (+ `discoverMatchMeter.test.ts`).

- [ ] **Step 1: `radioRulerCells(ruler)`**, returning
  `('played' | 'now' | 'ahead' | 'ahead-bar')[]`, one per tick. Cell `i`:
  - `played` if `i < filled`;
  - `now` if `i === filled` (the bar in progress);
  - `ahead-bar` if it is ahead and `i % 4 === 0`;
  - otherwise `ahead`.

  Tests: 16 ticks with 4 filled gives `played ×4, now, ahead ×3, ahead-bar, …`. `filled === ticks`
  gives all `played`. 0 ticks gives `[]`.
- [ ] **Step 2: `compactRadioMeter(entries, kindCount)`**. With `kindCount === 1`, a `mask`
  entry's `label` becomes `''`, so the kind button beside it names the kind once. With more
  kinds, the entries are unchanged. Trait entries are always unchanged. Read `buildMatchMeter`'s
  entry type first and keep its shape. Tests for both cases.
- [ ] **Step 3.** Run the vitest files, then typecheck, then commit.

## Phase 2: widgets

### Task 5: The control language (`RadioControls.tsx`)

**Files:** Modify `src/renderer/src/components/RadioControls.tsx`. Add to it; remove nothing yet
(Task 12).

Every widget is monochrome, has sharp corners, uses `fontFamily: 'inherit'`, and uses tokens only.
`size: 'live' | 'control'` picks `--ra-h-live` or `--ra-h-control`. A `disabled` widget gets
`opacity: var(--ra-opacity-disabled)` on its whole control, is inert, and is out of the tab order.

- [ ] **`ControlField({ label, readout, tooltip, disabled, dimmed, children })`**:
  - a column; the header is a `space-between` row with the label (`--ra-fs-9`, `--ra-text-3`,
    carrying `data-tooltip`) and the readout (`--ra-fs-9`, `--ra-text-2`; in the live bar
    `--ra-text`);
  - `dimmed` is opacity 0.4, as `StripDial`'s is today (faves in artist mode: dimmed but live).
- [ ] **`SegmentBar({ label, value, onChange, onCommit?, onDraft?, defaultValue, cells = 10,
  size, disabled, ariaValueText?, tooltip })`**:
  - It is a `div role="slider"` (`aria-valuemin 0`, `aria-valuemax 100`, `aria-valuenow`,
    `aria-valuetext`), with `tabIndex` 0, or −1 when disabled.
  - Cells are `flex: 1` and `2px` apart. Each is `--ra-border` with a lit part in `--ra-text`,
    sized `width: fill*100%`, drawn from `segmentBarFills`. Cell height is `--ra-h-live` (live) or
    `--ra-s-6` (columns).
  - **Pointer:** `preventDefault` and `stopPropagation` at press, as `Dial` does (the
    click-to-scrub bug in `Dial`'s comment); `setPointerCapture`; the value comes from
    `segmentBarValueAt`. A local draft drives `onChange` and `onDraft` each move. On up, cancel or
    lost capture: `onCommit(final)` if it moved, then `suppressNextSyntheticClick()` and
    `currentTarget.blur()`.
  - **Wheel:** a non-passive listener using `dialValueAfterWheel` (import from `./dialMath`),
    committing 200ms after the last notch, as `Dial` does.
  - **Keys:** `segmentBarKey`, which calls `onChange` and then `onCommit`.
  - **Double-click:** `defaultValue`.
  - Callers whose `onChange` is already the commit pass no `onCommit`.
- [ ] **`Segmented<T>({ options: { label, on, onClick, tooltip? }[], size, disabled, multi,
  ariaLabel })`**:
  - a `role="group"` row, `display: flex; flexWrap: wrap; gap: 2px`;
  - each option is a `button` with `flex: 1 1 0`, `minHeight` from the size, `padding: 0
    var(--ra-s-2)`, `aria-pressed={on}`, and `whiteSpace: nowrap`;
  - **on:** background `--ra-text`, ink `--ra-bg-page`, border `--ra-text`;
  - **off:** transparent, ink `--ra-text-2`, border `--ra-border-strong`;
  - text at `--ra-fs-9` (control) or `--ra-fs-10` (live).
- [ ] **`FireButton({ label, held, notNow, onClick, tooltip, ariaLabel, primary })`**:
  - a 36px button with a `1px dashed` border: `--ra-text` for primary (`turn`), `--ra-text-2`
    otherwise, `--ra-border-strong` when `notNow`;
  - ink `--ra-text`, or `--ra-text-3` when `notNow`;
  - `held` inverts it (`--ra-text` fill, `--ra-bg-page` ink, `aria-pressed`);
  - `:active` inverts too: add `.radio-fire:active { background: var(--ra-text); color:
    var(--ra-bg-page) }` to DiscoverPanel's `<style>` block, next to `.radio-plate-away`.
- [ ] **`ActionButton({ label, onClick, disabled, tooltip, pulse, emphasis })`**:
  - height `--ra-h-live`, `padding: 0 var(--ra-s-4)`, border `--ra-border-strong`, `--ra-fs-9`;
  - `emphasis` (keep) is a `--ra-text` border, `--ra-fs-11`, `padding: 0 18px`;
  - disabled ink is `--ra-text-4`;
  - `pulse` keeps `discover-add-pulse`.
- [ ] **`FoldSeedInput`**: restyle only. Height `--ra-h-control`, `flex: 1`, background
  `--ra-bg-bar`, `--ra-fs-10`. Its Escape handler does not change (`stopPropagation`, revert,
  blur).
- [ ] Run typecheck and lint, then commit (`radio controls: segment bar, segments, fire and action
  buttons (unused until the next tasks)`).

## Phase 3: the view

### Task 6: The top line, with mix

**Files:** Modify `RadioTopLine.tsx`, `RadioStrip.tsx` and `DiscoverPanel.tsx`.

- [ ] **Step 1: `RadioMixActions`** (exported from `RadioStrip.tsx`, props = today's `mix`
  bundle). It renders the model's `mix` group in order, as `ActionButton`s:
  - `similar all` (Cmd immediate; `rerolling…` and disabled while rolling);
  - `fetch hearts`, `add to shelf`, `add to timeline` (listen-only dims, as today);
  - `keep` with `emphasis`.
- [ ] **Step 2: `RadioTopLine`**:
  - Add an `actions: ReactNode` prop.
  - Layout: one flex row, `alignItems: center`, `gap: var(--ra-s-7)`, `flexWrap: wrap`,
    `padding: var(--ra-s-4) var(--ra-s-7)`, a bottom rule in `--ra-border`, still sticky, with
    `zIndex: 2` on `RADIO_STICKY_BACKGROUND`. The groups, left to right:
    - **Transport:** play/stop as a `--ra-h-live` square, then `radio` (`--ra-h-live` tall,
      `padding: 0 var(--ra-s-6)`, `--ra-fs-11`, filled `--ra-play-on`). The interval line becomes
      an absolutely positioned 2px bar at the button's bottom edge in `--ra-play-on-ink`, width
      `progress`.
    - **Readout:** `flex: 1 1 360px; minWidth: 0`, a left-aligned column, `gap: 5px`:
      - the status line at `--ra-fs-10`, `--ra-text`, one line with an ellipsis. Its full text
        goes in `title`, since the canvas cuts it where today it wraps. A long status line now
        cuts, and the readout still shows it on hover;
      - the ruler: `radioRulerCells` → 4px cells, `gap: 2px` (1px past 32 ticks), `maxWidth:
        360`. `played` is `--ra-text-2`, `now` is `--ra-text`, `ahead-bar` is
        `--ra-border-strong`, `ahead` is `--ra-border`. The end label stays at the right;
      - fold's line at `--ra-fs-9`, `--ra-text-2`, ellipsis.
    - **Actions:** `{actions}`, a wrapping flex row with `gap: var(--ra-s-1)`.
    - **Undo/redo:** `padding-left: var(--ra-s-5)` with a left rule in `--ra-border`,
      `--ra-h-live` squares, the existing icons and states.
- [ ] **Step 3: `DiscoverPanel`.** Pass `actions={<RadioMixActions {...mixBundle} />}` to
  `RadioTopLine`, and stop `RadioStrip` rendering the `mix` group (it skips `place === 'top'`).
  Build the bundle once. It is the object the strip's `mix` prop gets today, so move that
  expression into a `const` before the JSX. The header stays **one child expression** (`radioOn ?
  <RadioTopLine …/> : <>…</>`).
- [ ] **Step 4.** Run typecheck and lint, and grep `grep -n "<RadioMixActions" DiscoverPanel.tsx`
  (one). Commit ("unseen by any agent").

### Task 7: The live bar

**Files:** Modify `RadioStrip.tsx` and `DiscoverPanel.tsx`.

- [ ] **Step 1: `RadioLiveBar`** (in `RadioStrip.tsx`) draws the `play` group:
  - a flex row, `alignItems: flex-end`, `gap: var(--ra-s-7) 24px`, `flexWrap: wrap`,
    `padding: var(--ra-s-5) var(--ra-s-7) var(--ra-s-6)`;
  - background `--ra-bg-row-sub`, top and bottom rules in `--ra-border-strong`;
  - **sticky at the bottom** (`position: sticky; bottom: 0; zIndex: 2`).

  Each control is in a `ControlField`:
  - **tempo** (readout `bpm`): `−` button, typed field, `+` button, all `--ra-h-live`; the field
    is 56px, `--ra-fs-13`, with today's `onFocus`/`onChange`/`onBlur`/Enter handlers. Then
    `match seed (N)` under its existing condition.
  - **pace**, 200px wide: `SegmentBar` (live) with `value={c.value}` and a local draft. The
    readout is `radioPaceLabel(draft ?? value, { fold: settings.foldMode })`, and the bar's
    `aria-valuetext` is the same. `onCommit = (v) => onSettingsChange(c.patch(v))`. The tooltip
    stays the model's.
  - **skip:** `--ra-h-live`, `padding: 0 18px`, `--ra-fs-13`, a `--ra-text` border. The inner span
    keeps the `key={skipFlicker}` and `radio-landing-flicker` class exactly as today.
  - **new bed:** `--ra-h-live`, `--ra-border-strong`, `--ra-fs-10`.
  - **fire now:**
    - `turn` is a `FireButton` with `primary`. Its label is `turn.flash ?? (turn.shown ?
      'turning' : 'turn')`, and it is held while `turn.shown !== null`;
    - then `TURNAROUND_MOVES.map` → `FireButton`, with `held` and `notNow` computed as today and
      the tooltips/aria as today.
  - **level**, 150px, `marginLeft: auto`: `SegmentBar` (live), readout = the value. `onChange =
    sound.onLevel`, with no `onCommit` (it is live today). `disabled={c.disabled}`, default 100,
    aria-label `master level`.
- [ ] **Step 2: `RadioStrip`'s root.** It becomes a fragment, `<RadioLiveBar/>` then
  `<RadioShapingColumns/>` (Task 8; until then the old flex groups for `place === 'columns'`). The
  old sticky goes from the columns, which are not sticky.
- [ ] **Step 3.** Run typecheck and lint, then commit.

### Task 8: The shaping columns

**Files:** Modify `RadioStrip.tsx`.

- [ ] **Step 1: `RadioShapingColumns`** draws the groups with `place === 'columns'`:
  - the grid is `repeat(5, minmax(0, 1fr))`;
  - each column is `role="group"` with its `aria-label` = caption, `padding: var(--ra-s-6)
    var(--ra-s-5) 18px`, `gap: var(--ra-s-6)`, and right and bottom rules in `--ra-border`;
  - the title is the caption at `--ra-fs-10` in `--ra-text-2`, and the subtitle is at
    `--ra-fs-9` in `--ra-text-3`.

  Each control is a `ControlField` (`disabled={c.disabled}`, tooltip = the model's):
  - **`chips`** → `Segmented` (control size). Pass `multi` for `moves`. The options are
    `c.chips.map(chip => ({ label, on, onClick: () => onSettingsChange(chip.patch) }))`.
  - **`slider`** (bend, mismatch) → `SegmentBar` with a local draft, readout = draft ?? value,
    `onCommit = (v) => onSettingsChange(c.patch(v))`, default 0. Today `FoldSlider` has no default,
    so double-click goes to the setting's default from `DEFAULT_RADIO_SETTINGS`.
  - **`switch`** (fold) → `Segmented` with `[{ label: 'on', on: c.on }, { label: 'off', on:
    !c.on }]`, each calling `c.patch(...)`.
  - **`seed`** → a row of `FoldSeedInput` plus a `new` `Segmented`-style button (not a toggle: a
    plain 26px bordered button), with `disabled` from the model.
  - **`sound`** → `StripSoundDial`, rebuilt on `SegmentBar`: same draft/commit, same
    `soundDialPosition`/`soundDialValue`, same `SOUND_DIAL_DEFAULTS`. A `ControlField` divider note
    `project sound · undoable` (`--ra-fs-9`, `--ra-text-3`, a 1px `--ra-border` line under it)
    goes before `saturation`.
  - **`panel`** by id:
    - `faves`: `SegmentBar`, preview/commit, dimmed in artist mode, `DEFAULT_FAVES`;
    - `source`: `SegmentBar` live, `DEFAULT_SOURCE_LEAN`;
    - `matching`: `SegmentBar` live, `100 - DEFAULT_DISCOVER_CHAOS`;
    - `artist`: decision 5. The same `ref={picks.artistButtonRef}`, `onClick`, `aria-expanded`;
    - `my-sounds`: `Segmented` on/off; each option calls `picks.onMySounds` only when it would
      change the value; disabled per model;
    - `reverb`: draft/commit, default 0;
    - `filter`: live, default `neutralCutoff(mode) * 100`;
    - `res`: live, default 0;
    - `filter-mode`: `Segmented` with `lo pass` / `hi pass`, each calling `sound.onFilterMode`
      only when it is not already that mode.
- [ ] **Step 2.** Delete the old flex-group rendering path from `RadioStrip`.
- [ ] **Step 3: Checks.**
  - typecheck and lint;
  - grep `grep -n "StripDial\|StripChip\|StripWordSwitch\|PaceSlider\|FoldSlider" RadioStrip.tsx`
    finds nothing;
  - every model id has a case. There is no DOM test, so read the render switch against the id
    lists in the model test's `places every control in its group` and list them in the commit
    message. The `default:` returns null, as today.
- [ ] Commit.

### Task 9: The rows (THE RISKY STEP)

**Files:** Modify `DiscoverSlotRow.tsx`, `RadioRowPlates.tsx`, `discoverRowGrid.ts` and
`DiscoverPanel.tsx` (the overlay insets only).

Rule: change only the `if (radioLayout) { … }` assembly, the parts' radio-only props and the plates.
The grid layout must render byte-for-byte as before.

- [ ] **Step 1: Constants.** Add to `discoverRowGrid.ts`:
  - `RADIO_WAVEFORM_HEIGHT = 60`;
  - `RADIO_ROW_INSET_LEFT = 15` (1px border + 14px);
  - `RADIO_ROW_INSET_RIGHT = 9` (1px border + 8px).

  The waveform cell's height and the gain-drag math (`startGain - deltaY / height`) read the
  layout's height. The grid keeps `DISCOVER_WAVEFORM_HEIGHT`.
- [ ] **Step 2: Word buttons.** `RowIconButton` gains `word?: string` and `look?: 'live' |
  'extra'`; only the radio assembly passes them.
  - When `word` is set, it renders the word instead of its icon child:
    - `live`: height `--ra-h-row-button`, `minWidth: 28`, `padding: 0 7px`, border
      `--ra-border-strong`, `--ra-fs-9`;
    - `extra`: borderless, ink `--ra-text-3`, hover `--ra-text`.
  - **On / soft** states fill (`--ra-text` with `--ra-bg-page` ink); `m` on uses
    `--ra-mute-on`.
  - `disabled`, `dimmed`, `pulsing`, `hidden`, tooltips, aria-labels, `aria-pressed`,
    `ariaExpanded` and `buttonRef` are unchanged.
  - Each part constant passes its word (`skip`, `like`, `next`, `hook`, `dig`, `any`, `near`,
    `dup`, `lock`, `x`; `m`/`s` already are words) as a prop and keeps its icon child. One
    implementation per button, as the last plan required.
  - `like` keeps `Star` (Phosphor, `weight="fill"`, `--ra-recording-live`) before the word when
    favourited.
- [ ] **Step 3: The radio assembly.**
  - **Root:** `role="group"` and the aria-label as today. `position: relative`, border `1px solid
    var(--ra-border)` (`--ra-border-strong` while `radioApproach !== null`), background
    `approachBackground ?? 'var(--ra-bg-row)'`, `marginBottom: 6`.
  - **Holding bar:** `left: 0; top: 0; bottom: 0; width: 3`, background
    `stemColorVar(resolvedStem)` (or `--ra-text-2` while unresolved).
  - **Button line:** `display: flex; alignItems: center; gap: var(--ra-s-5); flexWrap: wrap;
    padding: 6px 8px 6px 14px`:
    - cluster 1 (`gap: 3px`): `muteSolo`;
    - cluster 2 (`marginLeft: 6`): `skipButton likeButton dislikeButton`;
    - cluster 3 (`marginLeft: 6`): the `data-slot="radio-role"` span with `roleButtons`;
    - `kindsBlock`;
    - `<span style={{ flex: 1 }} />`;
    - extras: `anyStemButton nearbyButton duplicateButton lockButton removeButton`.

    **Order change:** today kinds sits among the extras; the canvas puts it right after the live
    cluster.
  - **`kindsBlock`, radio branch:**
    - the kind button's ink is `stemColorVar(resolvedStem)` (or `--ra-text-2`), `--ra-fs-10`;
    - the meter is `compactRadioMeter(meterEntries, slot.kinds.length)`. Read the actual type
      of `slot.kinds` and pass its count;
    - the cells are `4×9` (canvas) in `--ra-text-2` / `--ra-border`, with the source word
      (`guess` …) after the cells, `--ra-fs-9`, `--ra-text-3`, still the reclassify button.
  - **Waveform:** `margin: '0 8px 8px 14px'`, height `RADIO_WAVEFORM_HEIGHT`.
- [ ] **Step 4: `RadioRowPlates`.**
  - `PLATE` becomes `--ra-fs-9`, `padding: 3px 6px`, `lineHeight: 1`, background `--ra-bg-page`
    (solid), border `1px solid var(--ra-border)`.
  - The **top bar** (`position: absolute; top: 0; left: 0; right: 0; display: flex; gap:
    var(--ra-s-1)`, `pointerEvents: none`):
    - info (`flex: 0 1 auto; minWidth: 0`, label ellipsis, tail whole);
    - `margin-left: auto`;
    - the cue cluster: the flash plate (`--ra-text`, at its opacity) and the `next` plate,
      inverted (`--ra-text` ground, `--ra-bg-page` ink, `--ra-text` border).
  - The **bottom bar** (`bottom: 0`): the away button (unchanged hit box and handler; padding
    adjusted so the plate sits flush), then the fold plate at the right. The fold plate is the
    count, then the 28px `data-fold-dot` track inline (`alignItems: center; gap: 6`).
  - The `data-fold-dot` element and its styles stay as they are: the sweep effect writes them.
- [ ] **Step 5: The playhead overlay** (`DiscoverPanel.tsx`, the `sweepActive &&` block, radio
  branch). Replace `left: 6, right: 6` with `left: RADIO_ROW_INSET_LEFT, right:
  RADIO_ROW_INSET_RIGHT`. Leave the element structure alone.
- [ ] **Step 6: No-remount and imperative-write checks:**

```bash
cd /Users/nickel/Claudecode/sssketch/src/renderer/src/components
grep -c "ref={rowsRef}" DiscoverPanel.tsx          # 1
grep -c "ref={sweepLineRef}" DiscoverPanel.tsx     # 1
grep -n "data-fold-dot=" *.tsx                     # RadioRowPlates.tsx only
grep -n "left: 6,\|right: 6," DiscoverPanel.tsx    # none left in the overlay's radio branch
git diff --stat                                    # DiscoverSlotRow, RadioRowPlates, discoverRowGrid, DiscoverPanel only
```

  Check by reading: the `slots.map(<DiscoverSlotRow key={slot.id} …>)` and the wrapper are
  untouched, and nothing before the wrapper changed shape.
- [ ] Run typecheck and lint, then commit ("unseen by any agent").

### Task 10: The view's frame; the add row goes while radio runs

**Files:** Modify `DiscoverPanel.tsx` (and export `RADIO_VIEW_MAX_WIDTH` from `RadioTopLine.tsx`).

- [ ] **Step 1.** `RADIO_VIEW_MAX_WIDTH = 1440`. Apply `{ maxWidth: RADIO_VIEW_MAX_WIDTH, margin:
  '0 auto', width: '100%' }` to:
  - the top line's root;
  - the notes;
  - the rows wrapper's radio style (replacing `maxWidth: 1200`);
  - the live bar;
  - the columns.

  The rows wrapper keeps the same element and only its style object changes.
- [ ] **Step 2.** Wrap the add row (the block holding `add a stem that is:` through `hold shift to
  combine`) in `{!radioOn && …}`, or give it `display: none` while radio runs if it holds
  state-bearing children (check for popover anchors and refs first; `display: none` keeps them
  mounted). Question 1's default.
- [ ] **Step 3.** Run typecheck and lint. Grep that the add row's guard sits **after** the rows
  wrapper. Commit.

### Task 11: The start prompt

**Files:** Modify `RadioStartPrompt.tsx`.

- [ ] Restyle to 3b. Keep position, dismissal, Escape capture, `onStart(paceDraft ?? paceLevel)`
  and its write-only-when-moved rule. The layout:
  - width 380, `padding: 18`, `gap: 18`, `--ra-bg-bar` with a `--ra-border-strong` border;
  - the title `start radio` at `--ra-fs-13`, `--ra-text`;
  - **pace:** `ControlField` (readout = `radioPaceLabel(draft ?? value, { fold })`) with a
    `SegmentBar` (control height, cells `--ra-h-control` tall). `onDraft = setPaceDraft`, and
    `onCommit` writes `paceLevel`;
  - **density:** `Segmented` (control size; the canvas's 30px rounds to 26);
  - **channels:** `Segmented` 2…8, **disabled with density arc** (question 2), tooltip
    `with density off`;
  - **`start`:** a full-width button, height `--ra-h-transport`, `--ra-fs-13`, a `--ra-text`
    border, `:active` inverted.
  - The `set a pace and start` hint goes; the title says it.
- [ ] Typecheck and lint, then commit.

### Task 12: Cleanup

- [ ] Delete `StripChip`, `StripWordSwitch`, `StripDial`, `StripGroup`, `PaceSlider` and
  `FoldSlider` from `RadioControls.tsx` if nothing imports them (`grep -rn` first). `Dial.tsx`
  stays: the master strip, add row and arranger use it.
- [ ] Update header comments in `RadioStrip.tsx`, `RadioControls.tsx`, `RadioTopLine.tsx` and
  `radioStripModel.ts` (the groups, the live bar, the columns, mix in the top line, greyed not
  hidden).
- [ ] Typecheck, lint, `npm test`. Commit.

### Task 13: Verification, review, handoff, walkthrough

- [ ] **Step 1: Full suites.** `npm test` (with `radioStripModel.test.ts`, the "nothing hidden"
  coverage test included, and the new "every control present in every state"), `npm run
  typecheck`, `npm run lint`. Nothing native changed.
- [ ] **Step 2: Grep sweep:** Task 9 Step 6's lines, plus:

```bash
grep -rn "e.key === 'Escape'" src/renderer/src/components/RadioControls.tsx   # the seed field's, with stopPropagation
grep -rn "#[0-9a-fA-F]\{3,6\}\b" src/renderer/src/components/Radio*.tsx       # no hex colours
grep -rn "borderRadius: [1-9]" src/renderer/src/components/Radio*.tsx         # none
```
- [ ] **Step 3: An independent review** (superpowers:requesting-code-review). The checklist:
  - the brief's constraints and this plan's gap check;
  - every control keeps its commit timing (faves preview/commit, reverb draft/commit, sound
    release, pace/bend/mismatch release; source/matching/level/filter/res live);
  - no remount, as in Task 9 Step 6;
  - tokens only;
  - lowercase copy.
- [ ] **Step 4: Handoff.**
  - Add an "As built (design pass)" section to `specs/2026-10-03-sssketch-radio-view-design.md`.
  - Write a memory file `radio_view_design_pass_shipped.md` with a `MEMORY.md` line.
  - Say plainly that no agent has seen it.

**Elling's walkthrough.** Compare against `docs/superpowers/references/radio-view-design-pass/`
(ref-3a-radio-view-1440.png, ref-3a-radio-view-945.png, ref-3b-start-prompt.png). Cmd+Q and
relaunch `npm run dev` first.
1. **Widths.** At 945×614, at ~1440 and full screen:
   - nothing clips and there is no sideways scroll;
   - the top line's mix wraps to a second line at 945 without overlapping the readout;
   - the five columns stay five at 945 (families may wrap to two lines);
   - the top line, rows, live bar and columns share one left edge;
   - at 945×614, how many rows show between the sticky top line and the sticky live bar? With
     60px waveforms expect about two and a half. If that is too few, say so: the fix is the
     waveform height (`RADIO_WAVEFORM_HEIGHT`), not hiding anything.
2. **No remount.** With a loop playing, start and stop radio. The music doesn't restart, and no
   waveform blinks to its loading line.
3. **The playhead** runs over the waveforms' exact span (the left edge of the waveform, not the
   holding bar) in both layouts.
4. **Rows:**
   - every word button works as its icon did (Cmd-click on skip, any, near, dup);
   - `m`/`s`/`next`/`hook`/`dig`/`lock` fill when on;
   - `like` shows the star when favourited;
   - the kind label is in the row's colour, and `guess` opens reclassify;
   - the holding bar is the row's colour;
   - `next · …` is the inverted plate top right, and `no fave fits` / `no near fits` flash there;
   - a folded row shows `7 / 16` and its moving dot bottom right;
   - the away hook's name sits bottom left and brings it back on click;
   - on a busy row nothing overlaps.
5. **The live bar:**
   - tempo −/+ and typing work, and `match seed` appears when it should;
   - dragging, clicking, scrolling, using the arrows on and double-clicking pace each work, and
     its readout follows, fold window in fold mode;
   - pressing `t` straight after a pace drag turns at once;
   - `skip` flickers on each landing (not with reduced motion);
   - `turn` and each move fire, the held move inverts, and moves that can't sound are dim with
     `not now`;
   - level works while something sounds and is greyed while nothing does.
6. **The columns:**
   - each segment control sets what it did;
   - each 0–100 bar sets any value (not just tens) and commits when it did: dragging faves
     previews and lets go once; reverb commits on release;
   - channels greys with density arc, families and depth grey with turnarounds off, and bend,
     mismatch and seed grey with fold off;
   - artist opens the picker;
   - Escape in the seed field reverts and the library stays open;
   - saturation, pump and echo are greyed as the sound panel greys them, and a change is undone by
     Cmd+Z in the arrangement.
7. **The top line's mix:** `keep` (pulse, `keeping…`), `fetch hearts`, `add to shelf` /
   `add to timeline` (`✓ added`, listen-only dimming), and `similar all` (`rerolling…`, Cmd
   immediate).
8. **The start prompt:**
   - `radio` opens it;
   - the pace bar's draft starts radio at that pace;
   - density and channels set (channels greyed with arc);
   - Escape and a click outside close it;
   - the top line's `radio` gets focus.
9. **The add row** is gone while radio runs and back with radio off (question 1).
10. **Radio off** Discover looks exactly as before.
11. The phone remote works as before.

## Risks, per task

- **Task 3: the coverage test.** It must not be edited to pass. Run it after the regroup before
  touching anything else. The new "present in every state" test is stricter; keep both.
- **Task 5: `SegmentBar` swallowing gestures.** It must `preventDefault` and `stopPropagation` at
  press and suppress the trailing synthetic click, or a release jumps the transport (`Dial`'s
  documented bug). It must also end the drag on lost capture.
- **Tasks 7–8: commit timing.** Only `onCommit` may call `onSettingsChange` or
  `SET_SOUND_SETTINGS` for pace, bend, mismatch, sound and faves. A per-move write would hit the
  settings file and the undo stack every frame.
- **Task 9: remounts and imperative writes.** These are the same risks as the last plan's Task 7:
  `rowsRef`, `sweepLineRef` and `[data-fold-dot]` under the wrapper. The overlay insets must equal
  the row's border plus padding.
- **Task 9: the grid layout.** It must not move. Every new prop is radio-only (`word`, `look`, the
  height).
- **Task 10: hiding the add row.** If it owns refs that popovers or the phone read, use
  `display: none`, not unmount.
- **Width.** The 945 numbers are measured Silkscreen widths for text, not the app. The top line
  at 945 wraps by design; check it by eye (walkthrough 1).

---

## As built (2026-10-04, Task 13 review)

Commits b4e9cc2..d25020d (Tasks 1-12), on `master`, not on the `radio-view-design-pass` branch the
plan named. Unpushed. Checks at d25020d: `npm run typecheck` is clean, `npm run lint` has 0 errors
(4 old prettier warnings in unrelated main-process files), and `npm test` passes 288 files and
4805 tests, with the coverage test unchanged and the new "present in every state" test.

**What was built, against the plan:**
- The rows keep their Phosphor icons (Elling's answer 3). `s` on and `lock` on keep their old
  `--ra-stretch-on` look, which is monochrome. They are not the plan's filled block.
- Everything else is as planned: the top line with the mix, the live bar, the five columns
  greyed-not-hidden, the plates as two bars, the frame, the add row hidden while radio runs, the
  start prompt and the cleanup.

**Geometry the plan got wrong.** Discover is not the whole window. It sits in LibraryBrowser's
box, which is `min(1500px, 90vw)` by `min(900px, 85vh)`, inside a 10px padding.
- **At the 945×614 minimum** the content is about 830px wide and the scroll area about 455px
  tall. The plan assumed 945.
- **At a 1440 window** the content is about 1275px wide. The 1440 frame cap only matters above a
  ~1620px window.
- **Rendered in headless Chrome** (real Silkscreen, the real tokens and components, placeholder
  rows of real height):
  - top line 122px at 945 (the mix wraps), 66px at 1440;
  - live bar 150px (two lines) at both 945 and 1440; one line (79px) only at about 1920;
  - room for rows between the sticky bars at 945: **about 163px, so 1.5 rows**, not the 2.5 the
    walkthrough below used to expect.

**Elling's walkthrough** (Cmd+Q, then relaunch `npm run dev`). Compare against
`docs/superpowers/references/radio-view-design-pass/`. The references were drawn at the full window
width, so the app at the same window size is narrower.
1. **Widths.** Check at 945×614, at ~1440 and at full screen:
   - nothing clips and there is no sideways scroll;
   - the mix wraps under the readout at 945;
   - five columns stay five;
   - the left edges line up;
   - at 945, count the rows between the sticky bars (about 1.5 expected).
   Known at 945: the picks column's `source · endlesss - other` label pushes its number about
   16px past the column edge. Known at 1440: `level` drops alone onto a second live-bar line.
2. **No remount.** With a loop playing, start and stop radio. The music doesn't restart and no
   waveform blinks.
3. **The playhead** covers exactly the waveform's span, not the holding bar.
4. **Rows:**
   - the icons work as before (Cmd on skip, any, near and dup);
   - `like`'s star shows when favourited;
   - the kind label is in the row's colour, and `guess` reclassifies;
   - the holding bar is in the row's colour;
   - `next · …` is the inverted plate at the top right, and `no fave fits` / `no near fits` flash
     there;
   - a folded row shows `7 / 16` with a moving dot at the bottom right;
   - the away hook sits at the bottom left and brings the hook back on a click;
   - nothing overlaps on a busy row.
5. **Live bar:**
   - tempo −/+, typing and `match seed` work;
   - pace works by drag, click, wheel, arrows and double-click, and its readout follows (the fold
     window in fold mode);
   - `t` works straight after a pace drag;
   - skip flickers on each landing;
   - turn and the moves fire, a held move inverts, and moves that can't sound are faint with
     `not now`;
   - level is greyed while nothing sounds.
6. **Columns:**
   - every choice sets what it did;
   - the bars set any value, not just tens;
   - dragging faves previews and commits once;
   - reverb commits on release;
   - the greyed controls (channels; families and depth; bend, mismatch and seed) are still
     **readable**. The review found them at about 9% opacity;
   - artist opens the picker;
   - Escape in the seed field stays local;
   - saturation, pump and echo grey as the sound panel greys them, and Cmd+Z undoes one change.
     A double-click reset currently takes two undos.
7. **Top line mix:** keep (pulse, `keeping…`), fetch hearts, add to shelf and add to timeline
   (`✓ added`, listen-only dimming), and similar all (`rerolling…`, Cmd for immediate).
8. **Start prompt:**
   - `radio` opens it;
   - drag pace, **then nudge it with an arrow key**, then `start`: radio should start at the
     nudged pace. The review expects the drag position instead (a bug);
   - density works, and channels greys with arc;
   - Escape and a click outside close it.
9. **Add row:** gone while radio runs, back with radio off.
10. **Radio off:** Discover looks exactly as before.
11. **Phone remote:** works as before.
