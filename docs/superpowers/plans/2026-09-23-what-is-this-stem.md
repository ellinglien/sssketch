# What is this stem — the map on any arrangement, and one surface for saying so — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the arrangement map columns, a phrase and readable row labels on **any** arrangement — guided or not — and then merge Tidy Up and the auto-arrange role step into one surface that answers "what is this stem" once, globally.

**Architecture:** Two halves, in order. **Part 1** replaces the map's dependency on `coach.sections` with a plain list of columns that can come from either a guided map (one column per `CoachSection`) or an unguided one (one unnamed column per phrase, `ceil(totalBars / phraseBars)` of them), and replaces its dependency on `coach.lockedClimax` with a rule that reads the row's own material. It ends in a **"what is this?"** button. **Part 2** makes that button open Tidy Up — widened to take a *population* (this sketch, or the library) — and strips the role step's two role `<select>`s in favour of `DiscoverReclassifyPicker`, with one write path underneath both.

**Part 1 is independently shippable.** After Task 7 the map works on any arrangement and the button opens today's unchanged Tidy Up. If Part 2 slips, nothing is half-built.

**Tech Stack:** TypeScript, React 19, Electron main/preload/renderer, better-sqlite3, vitest.

**Spec:** `docs/superpowers/specs/2026-09-23-what-is-this-stem-design.md` (2026-09-23). Three of its "Open" items are **closed in the file itself** and are not re-litigated here: the merged surface is a **modal**; the library population is ordered **unconfirmed first, then most-recently-imported**; **least-confident-first was considered and rejected as the default**.

**Sits on:** `docs/superpowers/plans/2026-09-23-arrangement-map-foundations.md` and `2026-09-23-arrangement-map-ui.md`, both landed. Their module names are the contract this plan is written against. **Re-read every file immediately before editing it** and prefer what is on disk to what is quoted here.

**Baseline (verified on `auto-arrangement-exploration`, 2026-09-23):**

```
Test Files  166 passed (166)
     Tests  2564 passed (2564)
```

`npm run typecheck` — 0 errors. `npm run lint` — 0 errors + **4 pre-existing prettier warnings in unrelated files**. Any *new* warning is yours.

**NO NATIVE-ENGINE CHANGES.** Nothing here reaches `native-engine/`. The engine already plays whatever `EngineProject` it is handed and has no memory of a "real" project versus a preview (`docs/superpowers/specs/2026-09-15-discover-native-engine-preview-design.md`). `EngineProject` / `buildEngineProject.ts` are a hand-synced pair (CLAUDE.md) and **this plan changes neither**. If you conclude a native-engine change is needed, **STOP and report it rather than planning one.**

---

## Findings that shaped this plan — read these before Task 1

1. **The map already holds no state and owns no grid.** `ArrangementMap.tsx`'s own doc comment is emphatic. What it takes from `coach` is narrower than it looks: `sections` (the column list), `phrase.bars` (the phrase), and three decorations that are simply absent without a walk — `walkIndex`, `tension` (→ `appliedAt` / `appliedLabelAt`), and `phraseReading` (→ the phrase button row). So the map does not need to be made general. **It needs columns and a phrase.**

2. **NO INFERENCE OF SECTION BOUNDARIES.** Elling rejected this explicitly (spec, "Columns: unnamed, one phrase each"): *"a plausible wrong boundary looks exactly like a right one."* The unguided column list is `ceil(totalBars / phraseBars)` columns of **one pass each**, and the header carries **no text at all** — the existing per-column `data-tooltip` already says which bar it starts at. Do not add a column name, a number, or a bar label. If you find yourself writing "detect where material enters and leaves", stop.

3. **The phrase on an unguided map is the EARLIEST PLACED RIFFF's `barLength`.** A rifff *is* a loop and its `barLength` is the nominal phrase without measuring anything. Where several distinct bar lengths are placed, the **existing** phrase button row appears offering **the distinct lengths actually present** — facts about the arrangement, never guesses about it. That button row already exists in `ArrangementMap.tsx` (lines ~256–294); it is re-pointed at a different option source, not rebuilt.

4. **The phrase is about GRID SPACING, not structure.** Getting it wrong makes the squares the wrong size. It cannot make the map say something untrue about the song. Do not add a warning about it.

5. **A row is toggleable when its material names a single stem.** Today `buildCellToggleActions` reads `climax.stems.find(...)` to know what to put back, and that is *the only thing `climax` is consulted for in the map*. A channel whose clips all resolve to one stem path already knows what belongs there — it has the `Stem` object on the clip and the gain in `state.vol`. **One rule for both maps.** Risers and mixed rows stay read-only for the reasons `coachMapRows.ts` already gives at length.

   **One decision beyond the spec's letter, made deliberately:** when a row's material is gone entirely (every cell toggled off), the climax is kept as a **fallback** source for a guided map. Without it, emptying a guided row would make it permanently un-refillable, which is exactly the one-way door the spec rejects under "off-only editing". The rule is therefore *prefer the row's own material; fall back to the climax when the row is empty*. An **unguided** row emptied completely has no fallback — see "Known limits".

6. **Row labels need a read the renderer does not have yet.** The spec's chain is *confirmed role from the global `StemCategories` table → stem name → path*. Nothing in `src/preload/index.ts` reads that table back: the only role APIs are `upsertStemCategoryRole` (write) and `getConfirmedEmbeddings` (embeddings, not roles). `getStemCategory(db, stemCID)` exists in `src/main/stemCategoriesStore.ts` but is single-row and unexposed. Task 4 adds a bulk, path-keyed read. **The climax role stays as the second link** (a locally-dropped file has no `StemCID` at all, so the table can never answer for it) — the full chain is *table role → climax role → stem name → path*.

7. **Real Endlesss material is recorded through audio-in.** A stem's name and its `SoundType` both read "audio in" on nearly every row, which is why the guided map labels rows with the confirmed role in the first place (direct report, 2026-09-23). This is the entire reason Part 1 ends in a button that opens Part 2.

8. **THE TWO AUDITION PATHS MUST BEHAVE IDENTICALLY WHERE IT MATTERS.** `useStemPreviewPlayback` (sketch) applies `stemPreviewOverrides` from `store.ts` — no curves, no reverb, no mute regions, no risers, no sends, no automation — so a stem is judged as the file, not as the arrangement. A library stem has no `stemKey` and is in no rifff, so it goes through a throwaway one-stem project instead, where there is no toolkit to blank.

   **The invariant, stated precisely, because the loose phrasing is ambiguous:** *each audition hands the engine a project containing exactly the stems being auditioned and nothing else, and starting one stops the previous one entirely.* Neither path may regress to letting a previous audition ring on underneath a new one — **that was a real reported bug** (*"tidy up often plays multiple stems at once"*, fixed by `stemPreviewOverrides`). Both paths are generation-guarded so two in-flight engine loads cannot both land.

9. **THE LIBRARY POPULATION IS NOT CLUSTERED, AND CANNOT BE.** `computeMergeSequence` (`src/shared/agglomerativeCluster.ts`) is O(n³); `categoryCentroids.ts` records testing against *"a real ~45,000-stem backlog"*. Clustering that is not a performance problem, it is arithmetic. Tidy Up already has two halves — a **suggested** half grouped by the classifier with no dendrogram behind it, and a **DSP** half that clusters. The library population gets the suggested half, through `expandFlatGroupIntoRows`, which exists precisely because a suggested group has no clustering behind it until someone asks. **Do not pass library stems to `computeMergeSequence`.**

10. **BUS WRITES STOP AT THE SKETCH BOUNDARY.** `ASSIGN_STEMS_TO_BUS` writes `state.busOf`, keyed by `stemKey`, in *this* project. A library stem has neither a `stemKey` nor a project. So the library population calls the role write and **not** `window.rifffApi.upsertStemCategoryBus`, and dispatches no `ASSIGN_STEMS_TO_BUS`. The same click does slightly different work in the two populations, on purpose.

11. **NO NEW COLOUR TABLE.** `typeColorVar(soundType)` is the one sanctioned source. `coachMapRows.ts` already records, in a comment worth reading rather than re-deriving, why `ArrangeRole` does not invert onto `SoundType` cleanly and why `busColorHex(ARRANGE_ROLE_TO_BUS[role])` is the wrong palette. **Rows keep the stem's own `typeColorVar` swatch and the role is carried by the row's text.** Elling confirmed today that one flat colour is fine now the labels are real. A library row, having a `SoundType` from its instrument mask, gets the same swatch.

12. **ALL THREE TAXONOMIES SURVIVE AND MEAN DIFFERENT THINGS.** `SoundType` (`shared/types.ts`) is **provenance** — what Endlesss's instrument bitmask called it, never a human. Discover kinds (`shared/discoverSlotKind.ts`) are a property of a **slot** — *what am I looking for* — and nothing writes one onto a file. `ArrangeRole` + `DrumSubRole` (`shared/stemRole.ts`) are **the human judgement**. **The merged surface writes `ArrangeRole` and `DrumSubRole` and nothing else**; `BusId` stays derived through `ARRANGE_ROLE_TO_BUS`. `ARRANGE_ROLE_SLOT_KINDS` and `discoverSlotKindToArrangeRole` both stay. **Do not propose a fourth taxonomy, and do not delete one of these three.**

13. **The one leak to fix.** `DiscoverReclassifyPicker.tsx` writes an `ArrangeRole` and labels its buttons with `discoverRoleLabel(role, ROLE_LABELS)`, which prefers the **kind's** playful name where one exists — so picking "drummy" writes `arrangeRole: 'drums'`. The rule: **kind names describe a slot; role names describe a stem.** A picker writing a role says `ROLE_LABELS`. The match meter, explaining why a *slot* admitted a stem, keeps `discoverRoleLabel` — that is what it is talking about. One line in one file (Task 8); `discoverRoleLabel` keeps its other caller (`DiscoverPanel.tsx:3224`) and its tests.

14. **`SOUND_TYPE_TO_ARRANGE_ROLE` is a seed and never a confirmation.** It was caught asserting `audioIn → vocal` on the most common stem in a real library and was patched 2026-09-14 by flagging those rows `uncertain`, not by deleting the mapping. That patch is the general rule: *a machine guess may pre-fill a picker and may never look like an answer.*

15. **The notes field goes from the UI; the SQLite column stays.** Grepping `subcategoryNote` / `SubcategoryNote` across `src/` finds the column in `riffLibrarySchema.ts`, its migration, and the INSERT in `stemCategoriesStore.ts` — **not one SELECT, not one consumer**. Its own tooltip says it does not affect training. Dropping a SQLite column means rebuilding a table that also holds the user's real library, and would destroy anything already typed. So: remove the write, keep the column, keep its rows.

16. **React components are NOT unit-tested in this codebase** (CLAUDE.md). Tasks 6, 7, 8, 10, 13 and 14 have **no component tests**, deliberately. They are verified by `npm run typecheck` + `npm run lint` + the pure logic's own tests, then by Elling's manual walkthrough. **This environment has no GUI or audio tooling — do not claim any UI change was tested and do not claim anything about how it sounds.**

17. **Lint rules that will bite.** This repo **errors** on a synchronous `setState` inside a React effect (`react-hooks/set-state-in-effect` — the established workaround is deferring through `void Promise.resolve().then(...)`, see `useCachedStemEmbeddings.ts` and `AutoArrangeRoleStep.tsx`'s role-resolution effect), on render-time impurity (`react-hooks/purity`), and requires an **explicit return type on every function**, inline ones included. Prettier: `singleQuote: true`, `semi: false`, `printWidth: 100`, `trailingComma: none` — every code block below is already inside 100 columns.

18. **`src/renderer/src/styles/css.test.ts` parses every stylesheet.** **Never write a CSS comment containing a star-slash.** No task here adds a stylesheet, but the inline `<style>` blocks in `ClusterStemsBrowser.tsx` / `AutoArrangeRoleStep.tsx` are edited — leave their comments alone.

19. **Design tokens are the law** (`src/renderer/src/styles/tokens.css`, `docs/design.md`): near-black shell, Silkscreen, **no `border-radius` anywhere**, lowercase copy, no emoji, no exclamation marks, colour only on things carrying audio information. Tooltips are **one attribute**: `data-tooltip="…"`, never alongside `title` on the same node.

20. **sssketchy says nothing on an unguided map.** He walks *sections*, and there are none. **No `coachScript.ts` / `coachLines.ts` changes in this plan.** The "what is this?" button's label is ordinary UI copy and lives with the component, like every other button label. If this feature ever does need him to speak, that line goes in `src/shared/coachScript.ts` and nowhere else.

---

## File map

### Part 1

| File | Change |
|---|---|
| `src/shared/arrangementMapColumns.ts` | **NEW** — `ArrangementMapColumn`, `PlacedLoop`, `unguidedMapColumns`, `unguidedPhraseBars`, `distinctPlacedBarLengths` |
| `src/shared/arrangementMapColumns.test.ts` | **NEW** — full TDD |
| `src/renderer/src/state/coachMapRows.ts` | `CoachMapRow` gains `source` and `role`; `label` becomes the *fallback* label; `kind` derives from `source` |
| `src/renderer/src/state/coachMapRows.test.ts` | rewritten for the new fields; the label-numbering cases move out |
| `src/renderer/src/state/coachMapRowLabels.ts` | **NEW** — `coachMapRowLabels(rows, confirmedRoleByPath)`, the one place the final label string is decided |
| `src/renderer/src/state/coachMapRowLabels.test.ts` | **NEW** — full TDD, incl. the numbering cases moved from `coachMapRows.test.ts` |
| `src/renderer/src/state/coachMapPlacement.ts` | `placeRun` takes a plain stem + gain; `buildCellToggleActions` loses its `climax` parameter and places from `row.source`; `buildCoachMapActions` / `buildMapRebuildActions` unchanged in behaviour |
| `src/renderer/src/state/coachMapPlacement.test.ts` | cases for the climax-free toggle |
| `src/main/stemCategoriesStore.ts` | **NEW export** `getStemCategoryRolesForPaths` |
| `src/main/stemCategoriesStore.test.ts` | full TDD for it |
| `src/main/index.ts` | `ipcMain.handle('get-stem-category-roles', …)` |
| `src/preload/index.ts` | `getStemCategoryRoles(paths)` |
| `src/renderer/src/state/useConfirmedStemRoles.ts` | **NEW** — the hook that fetches it |
| `src/renderer/src/components/ArrangementMap.tsx` | columns instead of sections; the unguided phrase; the label chain; the "what is this?" button; decorations silent without a walk |
| `src/renderer/src/App.tsx` | `onWhatIsThis` wired to `setClusterStemsOpen(true)` |

### Part 2

| File | Change |
|---|---|
| `src/renderer/src/components/DiscoverReclassifyPicker.tsx` | `ROLE_LABELS[role] ?? role` instead of `discoverRoleLabel(...)` |
| `src/renderer/src/state/stemCategoryCapture.ts` | `recordRoleCategorization` → `recordStemRoles` + `roleConfirmationsFromStemRoles`; returns a promise |
| `src/renderer/src/state/stemCategoryCapture.test.ts` | **NEW** — TDD for `roleConfirmationsFromStemRoles` |
| `src/renderer/src/components/AutoArrangeWizard.tsx` | calls `recordStemRoles` |
| `src/renderer/src/components/DrawArrangeWizard.tsx` | calls `recordStemRoles` |
| `src/renderer/src/components/DiscoverPanel.tsx` | `reclassifySlot` awaits `recordStemRoles` |
| `src/renderer/src/components/ClusterStemsBrowser.tsx` | `recordRoleCategories` → `recordStemRoles`; the note input, its `note` state and the `note` parameter **deleted**; `population` prop; library branch |
| `src/preload/index.ts` | `subcategoryNote` removed from `upsertStemCategoryRole`; `getTidyUpLibraryStems` added |
| `src/main/stemCategoriesStore.ts` | `subcategoryNote` removed from `StemRoleCategoryEntry` and from the SQL |
| `src/main/stemCategoriesStore.test.ts` | the note cases removed; a case asserting an existing note survives a role re-write |
| `src/renderer/src/components/AutoArrangeRoleStep.tsx` | the two `<select>`s, their `selectStyle` usage and the stale-sub-role branch **deleted**; a role readout that opens `DiscoverReclassifyPicker` |
| `src/main/tidyUpLibraryStems.ts` | **NEW** — the library population query |
| `src/main/tidyUpLibraryStems.test.ts` | **NEW** — full TDD against an in-memory db |
| `src/main/riffLibrarySchema.ts` | `idx_stems_created` |
| `src/main/index.ts` | `ipcMain.handle('get-tidy-up-library-stems', …)` |
| `src/renderer/src/state/useThrowawayStemPreview.ts` | **NEW** — the library audition |
| `src/renderer/src/App.tsx` | a second menu entry, "tidy up library" |

**Nothing else is touched. No file is deleted outright** — `stemCategoryCapture.ts` is rewritten in place, which is the "one function" the spec asks for.

## Commands (run from `/Users/nickel/Claudecode/sssketch`)

```bash
npx vitest run src/shared/arrangementMapColumns.test.ts   # one file
npm test                                                   # full suite
npm run typecheck
npm run lint
```

---

# PART 1 — the map works on any arrangement

## Task 1: Unguided columns, the phrase, and the lengths actually present

**Files:**
- Create: `src/shared/arrangementMapColumns.ts`
- Test: `src/shared/arrangementMapColumns.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/shared/arrangementMapColumns.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  distinctPlacedBarLengths,
  unguidedMapColumns,
  unguidedPhraseBars
} from './arrangementMapColumns'

describe('unguidedMapColumns', () => {
  it('gives one column per whole phrase', () => {
    const columns = unguidedMapColumns(16, 4)
    expect(columns.map((c) => c.startBar)).toEqual([0, 4, 8, 12])
    expect(columns.every((c) => c.passes === 1)).toBe(true)
  })

  it('names nothing -- a column header carries no text at all', () => {
    expect(unguidedMapColumns(8, 4).every((c) => c.name === null)).toBe(true)
  })

  it('gives stable, distinct ids so React keys do not collide', () => {
    const ids = unguidedMapColumns(12, 4).map((c) => c.id)
    expect(new Set(ids).size).toBe(3)
    expect(unguidedMapColumns(12, 4).map((c) => c.id)).toEqual(ids)
  })

  it('rounds a partial last phrase UP to a whole column', () => {
    expect(unguidedMapColumns(9, 4)).toHaveLength(3)
  })

  it('is empty for an empty timeline', () => {
    expect(unguidedMapColumns(0, 4)).toEqual([])
  })

  it('gives one column when the phrase is longer than the arrangement', () => {
    expect(unguidedMapColumns(3, 8)).toHaveLength(1)
  })

  it('treats a nonsense phrase as one bar rather than dividing by zero', () => {
    expect(unguidedMapColumns(4, 0)).toHaveLength(4)
    expect(unguidedMapColumns(4, Number.NaN)).toHaveLength(4)
  })
})

describe('unguidedPhraseBars', () => {
  it('is the EARLIEST placed loop bar length', () => {
    expect(
      unguidedPhraseBars([
        { startBar: 8, barLength: 2 },
        { startBar: 0, barLength: 4 },
        { startBar: 4, barLength: 16 }
      ])
    ).toBe(4)
  })

  it('breaks a startBar tie toward the longer loop, so squares are not too small', () => {
    expect(
      unguidedPhraseBars([
        { startBar: 0, barLength: 2 },
        { startBar: 0, barLength: 8 }
      ])
    ).toBe(8)
  })

  it('is null for nothing placed', () => {
    expect(unguidedPhraseBars([])).toBeNull()
  })

  it('ignores a loop with no usable bar length', () => {
    expect(
      unguidedPhraseBars([
        { startBar: 0, barLength: 0 },
        { startBar: 4, barLength: 4 }
      ])
    ).toBe(4)
  })
})

describe('distinctPlacedBarLengths', () => {
  it('reports the lengths actually present, ascending, deduplicated', () => {
    expect(
      distinctPlacedBarLengths([
        { startBar: 0, barLength: 4 },
        { startBar: 4, barLength: 8 },
        { startBar: 8, barLength: 4 }
      ])
    ).toEqual([4, 8])
  })

  it('reports one length when every loop agrees, so the caller can stay silent', () => {
    expect(distinctPlacedBarLengths([{ startBar: 0, barLength: 4 }])).toEqual([4])
  })

  it('never invents a length nobody placed', () => {
    expect(distinctPlacedBarLengths([])).toEqual([])
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/shared/arrangementMapColumns.test.ts`
Expected: FAIL — `Failed to resolve import "./arrangementMapColumns"`.

- [ ] **Step 3: Write the implementation**

Create `src/shared/arrangementMapColumns.ts`:

```ts
/**
 * The map's columns when nobody built it.
 *
 * THE RULE (spec, "Columns: unnamed, one phrase each", and Elling's own
 * choice): **no inference of section boundaries.** The app does not know
 * where the verse ends and will not pretend to. A column is ONE PASS of the
 * phrase, and its header carries no text at all -- the map's existing
 * per-column tooltip already says which bar it starts at, and a header
 * saying "4" on every fourth column is a rule somebody has to maintain
 * forever for no information.
 *
 * Rejected, and recorded so it is not re-derived: inferring sections from
 * where material enters and leaves would be wrong in the way that is
 * hardest to notice, because a plausible wrong boundary looks exactly like
 * a right one. One column per bar needs no phrase at all, but a 128-bar
 * arrangement is then 128 columns of single squares and the map stops
 * being a map.
 *
 * The phrase itself is the ONE number an unguided map assumes, and it is
 * about GRID SPACING, not structure: getting it wrong makes the squares the
 * wrong size and cannot make the map say something untrue about the song.
 */

/** A column of the map, whichever kind of map it is. A guided map maps one
 * of these off each CoachSection; an unguided one gets them from
 * unguidedMapColumns below. Structurally compatible with everything in
 * coachMapRead.ts / coachMapEdit.ts, which only ever ask for
 * `{ startBar, passes }`. */
export interface ArrangementMapColumn {
  /** Stable across renders -- the map keys its columns off this. */
  id: string
  /** The user's own name for it, or **null when nobody named it**. Null is
   * not "unknown": it means this column has no name and must be drawn
   * without one. */
  name: string | null
  startBar: number
  passes: number
}

/** One loop already on the timeline, as this module needs to see it. */
export interface PlacedLoop {
  startBar: number
  barLength: number
}

function wholePhrase(phraseBars: number): number {
  if (!Number.isFinite(phraseBars) || phraseBars < 1) return 1
  return Math.max(1, Math.round(phraseBars))
}

function usableBarLength(value: number): number | null {
  if (!Number.isFinite(value) || value <= 0) return null
  return Math.max(1, Math.round(value))
}

/** `ceil(totalBars / phraseBars)` unnamed columns of one pass each. */
export function unguidedMapColumns(
  totalBars: number,
  phraseBars: number
): ArrangementMapColumn[] {
  const phrase = wholePhrase(phraseBars)
  const bars = Number.isFinite(totalBars) ? Math.max(0, totalBars) : 0
  const count = Math.ceil(bars / phrase)
  const columns: ArrangementMapColumn[] = []
  for (let index = 0; index < count; index += 1) {
    columns.push({ id: `bar-${index * phrase}`, name: null, startBar: index * phrase, passes: 1 })
  }
  return columns
}

/** The bar length of the EARLIEST placed loop -- a rifff IS a loop, and its
 * barLength is the nominal phrase without measuring anything. A startBar tie
 * goes to the LONGER loop: too large a phrase draws fewer, bigger squares,
 * where too small a one draws a wall of them. null when nothing usable is
 * placed, which the caller reads as "there is no map to draw". */
export function unguidedPhraseBars(placed: readonly PlacedLoop[]): number | null {
  let best: { startBar: number; barLength: number } | null = null
  for (const loop of placed) {
    const barLength = usableBarLength(loop.barLength)
    if (barLength === null) continue
    if (!Number.isFinite(loop.startBar)) continue
    if (
      best === null ||
      loop.startBar < best.startBar ||
      (loop.startBar === best.startBar && barLength > best.barLength)
    ) {
      best = { startBar: loop.startBar, barLength }
    }
  }
  return best?.barLength ?? null
}

/** The distinct bar lengths ACTUALLY PRESENT, ascending. Facts about the
 * arrangement rather than guesses about it, which is the property that makes
 * offering them allowed at all. */
export function distinctPlacedBarLengths(placed: readonly PlacedLoop[]): number[] {
  const lengths = new Set<number>()
  for (const loop of placed) {
    const barLength = usableBarLength(loop.barLength)
    if (barLength !== null) lengths.add(barLength)
  }
  return [...lengths].sort((a, b) => a - b)
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/shared/arrangementMapColumns.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 5: Commit**

```bash
git add src/shared/arrangementMapColumns.ts src/shared/arrangementMapColumns.test.ts
git commit -m "The map's columns, for an arrangement nobody was asked about

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h"
```

---

## Task 2: A row knows what belongs on it, from its own material

**Files:**
- Modify: `src/renderer/src/state/coachMapRows.ts`
- Test: `src/renderer/src/state/coachMapRows.test.ts`

`CoachMapRow` gains two fields and `label` narrows in meaning. Read this whole task before editing — the existing label-numbering tests move to Task 5.

- [ ] **Step 1: Write the failing tests**

Add to `src/renderer/src/state/coachMapRows.test.ts` (keep every existing test except the two that assert numbered labels like `'drums 1'` — those move in Task 5; replace their assertions with `row.role`):

```ts
describe('the stem a toggle would put back', () => {
  it('reads the row own material when the clips name ONE stem', () => {
    const state = stateWith([rifff('c0', 'kick.wav', 0), rifff('c0b', 'kick.wav', 8)], {
      channelOf: { c0b: 'c0' },
      vol: { 'c0:1': 0.5 }
    })
    const row = coachMapRows(state).find((r) => r.channelId === 'c0')!
    expect(row.kind).toBe('stem')
    expect(row.source?.stem.path).toBe('kick.wav')
    expect(row.source?.gain).toBe(0.5)
  })

  it('refuses a row whose material names SEVERAL stems', () => {
    const state = stateWith([rifff('c0', 'kick.wav', 0), rifff('c0b', 'snare.wav', 8)], {
      channelOf: { c0b: 'c0' }
    })
    const row = coachMapRows(state).find((r) => r.channelId === 'c0')!
    expect(row.source).toBeNull()
    expect(row.kind).toBe('other')
  })

  it('refuses a riser row -- toggling one on would be INVENTING a riser', () => {
    const state = stateWith([], { risers: [createRiser('r0', 'c9', 0)] })
    const row = coachMapRows(state).find((r) => r.channelId === 'c9')!
    expect(row.kind).toBe('riser')
    expect(row.source).toBeNull()
  })

  it('falls back to the climax when a guided row has been emptied', () => {
    const state = laidOutState(['kick.wav'], climaxOf({ 'kick.wav': 'drums' }))
    const emptied: AppState = { ...state, rifffs: {} }
    const row = coachMapRows(emptied).find((r) => r.path === 'kick.wav')
    expect(row).toBeUndefined()
  })

  it('carries the climax role so the label chain has a second link', () => {
    const state = laidOutState(['kick.wav'], climaxOf({ 'kick.wav': 'drums' }))
    expect(coachMapRows(state)[0].role).toBe('drums')
  })

  it('has no role at all on an unguided arrangement', () => {
    const state = stateWith([rifff('c0', 'kick.wav', 0)])
    expect(coachMapRows(state)[0].role).toBeNull()
  })

  it('falls its label back to the stem name, then the path', () => {
    const state = stateWith([rifff('c0', 'kick.wav', 0)])
    expect(coachMapRows(state)[0].label).toBe('kick.wav')
  })
})
```

Note the fourth test: a guided row whose clips are all gone has **no channel at all** (`channelsInOrder` builds channels from placed rifffs), so the fallback can only fire while at least one clip is still somewhere on the row. That is what the test pins. The climax fallback still matters for a row whose remaining clips somehow name several stems.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/renderer/src/state/coachMapRows.test.ts`
Expected: FAIL — `Property 'source' does not exist on type 'CoachMapRow'`.

- [ ] **Step 3: Implement**

In `src/renderer/src/state/coachMapRows.ts`, add `Stem` to the type import from `@shared/types`, import `stemKey`, and change the interface and function:

```ts
import { stemKey, type SoundType, type Stem } from '@shared/types'
```

Add to `CoachMapRow`, after `path`:

```ts
  /** The stem a toggle on this row would put back, and the gain it is
   * playing at.
   *
   * ONE RULE FOR BOTH MAPS (spec): **a row is toggleable when its material
   * names a single stem.** For a guided map that is every lane the builder
   * made, unchanged. For an unguided one it is every channel holding one
   * stem's clips -- which, in practice, is most of them, because that is
   * what the arranger's rows already are.
   *
   * Read from the row's OWN material first, and only then from the locked
   * climax. The climax used to be the only source (buildCellToggleActions
   * looked the path up in climax.stems), which is why an unguided map could
   * not be edited at all; it survives here purely as a fallback for a
   * guided row whose remaining clips no longer agree on one stem. Nothing
   * else in the map consults the climax any more.
   *
   * null for a riser row (toggling one ON would mean INVENTING a riser,
   * which is the map spec's own named bad line) and for a mixed row (there
   * is no single stem the map could honestly put back). */
  source: { stem: Omit<Stem, 'slot'>; gain: number } | null
  /** The role the user confirmed for this row's stem in the auto-arrange
   * wizard, carried verbatim on the locked climax. null on an unguided map,
   * where nobody was asked. The SECOND link of the label chain -- see
   * ./coachMapRowLabels.ts, which owns the final string. */
  role: ArrangeRole | null
```

Change `label`'s doc comment to say it is now the **fallback** label only (riser name / stem name / path) and that `coachMapRowLabels.ts` decides the string actually drawn.

Then rewrite the body's per-channel return. Replace the whole `return channels.map(...)` block with:

```ts
  return channels.map((channel): CoachMapRow => {
    const channelRisers = risersOnChannel(state.risers, channel.channelId)
    const clips: MapClip[] = channel.rifffs
      .filter((rifff) => rifff.startBar !== undefined)
      .map((rifff): MapClip => {
        const startBar = (rifff.startBar ?? 0) + (state.leftCrop[rifff.groupId] ?? 0)
        return {
          groupId: rifff.groupId,
          startBar,
          endBar: (rifff.startBar ?? 0) + resolvePlayedBars(state, rifff.groupId)
        }
      })
    for (const riser of channelRisers) {
      clips.push({ groupId: riser.id, startBar: riser.startBar, endBar: riserEndBar(riser) })
    }

    // A riser-only row reports and never acts -- decided before anything
    // else, so no later branch can hand one a stem.
    if (channel.rifffs.length === 0 && channelRisers.length > 0) {
      return {
        channelId: channel.channelId,
        kind: 'riser',
        label: channelRisers[0].name,
        path: null,
        source: null,
        role: null,
        soundType: null,
        clips
      }
    }

    // Every distinct stem path this row's own clips name, with one real
    // occurrence kept per path so a single-stem row can place from it.
    const byPath = new Map<string, { stem: Stem; groupId: string }>()
    for (const rifff of channel.rifffs) {
      for (const stem of rifff.stems) {
        if (!byPath.has(stem.path)) byPath.set(stem.path, { stem, groupId: rifff.groupId })
      }
    }

    const lanePath = pathByChannel[channel.channelId] ?? null
    let source: CoachMapRow['source'] = null
    if (byPath.size === 1) {
      const [{ stem, groupId }] = [...byPath.values()]
      const { slot: _slot, ...rest } = stem
      source = { stem: rest, gain: state.vol[stemKey(groupId, stem.slot)] ?? 1 }
    } else if (lanePath !== null) {
      // The guided fallback: this lane was laid out for one climax stem and
      // its clips no longer agree on one. The climax still knows.
      const climaxStem = state.coach?.lockedClimax?.stems.find((s) => s.path === lanePath)
      if (climaxStem !== undefined) {
        source = {
          stem: {
            author: climaxStem.author,
            name: climaxStem.name,
            type: climaxStem.type,
            path: climaxStem.path,
            durationSec: climaxStem.durationSec,
            barLength: climaxStem.barLength
          },
          gain: climaxStem.gain
        }
      }
    }

    const first = byPath.size === 1 ? [...byPath.values()][0].stem : channel.rifffs[0]?.stems[0]
    return {
      channelId: channel.channelId,
      kind: source === null ? 'other' : 'stem',
      label: first?.name ?? channel.rifffs[0]?.name ?? channel.channelId,
      path: source?.stem.path ?? lanePath,
      source,
      role: lanePath === null ? null : (roleByPath.get(lanePath) ?? null),
      soundType: source?.stem.type ?? first?.type ?? null,
      clips
    }
  })
```

Delete the `roled` / `labelByPath` block above it (lines ~97–107) and the now-unused `stemLabelsByKey` import — the numbering moves to Task 5. Keep `roleByPath`.

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run src/renderer/src/state/coachMapRows.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/state/coachMapRows.ts src/renderer/src/state/coachMapRows.test.ts
git commit -m "A row that has material on it knows what belongs there

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h"
```

---

## Task 3: The toggle drops its climax dependency

**Files:**
- Modify: `src/renderer/src/state/coachMapPlacement.ts`
- Test: `src/renderer/src/state/coachMapPlacement.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/renderer/src/state/coachMapPlacement.test.ts`:

```ts
describe('buildCellToggleActions without a climax', () => {
  it('places from the row own stem when there is no locked climax', () => {
    const state = unguidedState() // one channel, one stem, bars 0-3
    const row = coachMapRows(state)[0]
    const column = { id: 'bar-4', name: null, startBar: 4, passes: 1 }
    const plan = planCellToggle({ clips: row.clips, section: column, phraseBars: 4, passIndex: 0, on: true })
    const actions = buildCellToggleActions(state, row, column, plan, 4)
    expect(actions.some((a) => a.type === 'PLACE_LOOP_ON_TIMELINE')).toBe(true)
  })

  it('does nothing on a row whose material names several stems', () => {
    const state = mixedRowState()
    const row = coachMapRows(state)[0]
    const column = { id: 'bar-4', name: null, startBar: 4, passes: 1 }
    const plan = planCellToggle({ clips: row.clips, section: column, phraseBars: 4, passIndex: 0, on: true })
    expect(buildCellToggleActions(state, row, column, plan, 4)).toEqual([])
  })

  it('names an unnamed column by its bar, so a placed clip still reads sensibly', () => {
    const state = unguidedState()
    const row = coachMapRows(state)[0]
    const column = { id: 'bar-4', name: null, startBar: 4, passes: 1 }
    const plan = planCellToggle({ clips: row.clips, section: column, phraseBars: 4, passIndex: 0, on: true })
    const placed = buildCellToggleActions(state, row, column, plan, 4).find(
      (a): a is Extract<Action, { type: 'PLACE_LOOP_ON_TIMELINE' }> =>
        a.type === 'PLACE_LOOP_ON_TIMELINE'
    )!
    expect(placed.stems[0].name).toContain('bar 4')
  })
})
```

Write `unguidedState()` and `mixedRowState()` as local helpers in that file, modelled on its existing state builders.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/renderer/src/state/coachMapPlacement.test.ts`
Expected: FAIL — `Expected 6 arguments, but got 5`.

- [ ] **Step 3: Implement**

In `src/renderer/src/state/coachMapPlacement.ts`:

Change `placeRun`'s first stem parameter from `stem: LockedClimaxStem` to a plain pair, and delete `stemFromClimax` (its only remaining caller becomes this):

```ts
/** One run of one stem, as a placed clip plus the actions that shape it.
 *
 * Takes the stem and its gain as plain values rather than a
 * LockedClimaxStem: the map's own toggle now sources both from the row's
 * existing material (coachMapRows.ts's `source`), and the build sources
 * them from the climax. Listed explicitly rather than spread, because a
 * spread of a LockedClimaxStem would carry kinds/role/gain straight into a
 * persisted Rifff. */
function placeRun(
  state: AppState,
  stem: Omit<Stem, 'slot'>,
  gain: number,
  label: string,
  startBar: number,
  barCount: number,
  lane: string | null
): { rifff: Rifff; vol: Record<string, number>; after: Action[] } | null {
  const assembly = assembleDiscoverRifff(`${label} · ${stem.name}`, [{ stem, gain }], state.bpm)
  ...
}
```

Update `buildCoachMapActions`'s call site to `placeRun(state, stemFromClimaxFields(stem), stem.gain, section.name, …)` — keep the explicit field list inline as a small local helper so nothing regresses:

```ts
function stemFields(stem: LockedClimaxStem): Omit<Stem, 'slot'> {
  return {
    author: stem.author,
    name: stem.name,
    type: stem.type,
    path: stem.path,
    durationSec: stem.durationSec,
    barLength: stem.barLength
  }
}
```

Then rewrite `buildCellToggleActions`:

```ts
/**
 * One cell toggle, as real clip actions.
 *
 * NO CLIMAX. The stem to put back comes from the row itself
 * (coachMapRows.ts's `source`), which is what lets this serve an unguided
 * map as well as a guided one -- see that field's own doc comment.
 *
 * A refusal (blockedGroupIds) produces NOTHING -- the map says why in the
 * cell's own tooltip rather than doing something approximate. See
 * coachMapEdit.ts's own rule 2.
 */
export function buildCellToggleActions(
  state: AppState,
  row: CoachMapRow,
  column: ArrangementMapColumn,
  plan: CoachMapRowPlan,
  phraseBars: number
): Action[] {
  if (plan.blockedGroupIds.length > 0) return []
  if (row.source === null) return []

  // An unnamed column names a placed clip by the bar it starts at -- the
  // column header deliberately shows nothing (spec), but a clip on the
  // timeline still needs a name a person can read.
  const label = column.name ?? `bar ${column.startBar}`
  const actions: Action[] = []
  for (const run of plan.addRuns) {
    const startBar = column.startBar + passOffsetBars(run.startPass, phraseBars)
    const placed = placeRun(
      state,
      row.source.stem,
      row.source.gain,
      label,
      startBar,
      sectionBars(run.passCount, phraseBars),
      row.channelId
    )
    if (placed === null) continue
    actions.push({
      type: 'PLACE_LOOP_ON_TIMELINE',
      stems: [placed.rifff],
      startBar,
      vol: placed.vol
    })
    actions.push(...placed.after)
  }
  // After the placements, for the same reason the build deletes last.
  if (plan.removeGroupIds.length > 0) {
    actions.push({ type: 'DELETE_RIFFFS', groupIds: [...plan.removeGroupIds] })
  }
  return actions
}
```

Add `import type { ArrangementMapColumn } from '@shared/arrangementMapColumns'` and drop the now-unused `LockedClimax` type import (keep `LockedClimaxStem`, still used by the build).

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run src/renderer/src/state/coachMapPlacement.test.ts`
Expected: PASS. `npm run typecheck` will still fail on `ArrangementMap.tsx`'s old 6-argument call — that is fixed in Task 6.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/state/coachMapPlacement.ts src/renderer/src/state/coachMapPlacement.test.ts
git commit -m "One rule for both maps: the toggle reads the row, not the climax

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h"
```

---

## Task 4: Read confirmed roles back out of the global table

**Files:**
- Modify: `src/main/stemCategoriesStore.ts`, `src/main/index.ts`, `src/preload/index.ts`
- Test: `src/main/stemCategoriesStore.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/main/stemCategoriesStore.test.ts`. **Follow the file's existing conventions exactly** — it mocks `electron` at the top, builds its own in-memory schema in a local `freshDb()` whose `Stems` table is just `CREATE TABLE Stems (StemCID TEXT PRIMARY KEY)`, and imports the module under test with a dynamic `await import('./stemCategoriesStore')` inside each test. Do **not** add columns to `freshDb()`'s `Stems` — `stemCIDForPath` only ever does `SELECT 1 FROM Stems WHERE StemCID = ?`.

```ts
describe('getStemCategoryRolesForPaths', () => {
  it('answers by the PATH it was given, not by StemCID', async () => {
    const { getStemCategoryRolesForPaths, upsertStemCategoryRole } = await import(
      './stemCategoriesStore'
    )
    const db = freshDb()
    db.prepare(`INSERT INTO Stems (StemCID) VALUES ('abc')`).run()
    upsertStemCategoryRole(db, [{ path: '/w/abc', arrangeRole: 'drums' }], 'tidyup', null, 1)
    expect(getStemCategoryRolesForPaths(db, ['/w/abc'])).toEqual({
      '/w/abc': { arrangeRole: 'drums', drumSubRole: null }
    })
  })

  it('carries a drum sub-role through', async () => {
    const { getStemCategoryRolesForPaths, upsertStemCategoryRole } = await import(
      './stemCategoriesStore'
    )
    const db = freshDb()
    db.prepare(`INSERT INTO Stems (StemCID) VALUES ('abc')`).run()
    upsertStemCategoryRole(
      db,
      [{ path: '/w/abc', arrangeRole: 'drums', drumSubRole: 'snare' }],
      'tidyup',
      null,
      1
    )
    expect(getStemCategoryRolesForPaths(db, ['/w/abc'])['/w/abc'].drumSubRole).toBe('snare')
  })

  it('omits a path with no confirmed role rather than inventing one', async () => {
    const { getStemCategoryRolesForPaths } = await import('./stemCategoriesStore')
    const db = freshDb()
    db.prepare(`INSERT INTO Stems (StemCID) VALUES ('abc')`).run()
    expect(getStemCategoryRolesForPaths(db, ['/w/abc'])).toEqual({})
  })

  it('omits a locally-dropped file, which has no StemCID at all', async () => {
    const { getStemCategoryRolesForPaths } = await import('./stemCategoriesStore')
    expect(getStemCategoryRolesForPaths(freshDb(), ['/Users/e/Desktop/clap.wav'])).toEqual({})
  })

  it('omits a row confirmed on the BUS axis only', async () => {
    const { getStemCategoryRolesForPaths, upsertStemCategoryBus } = await import(
      './stemCategoriesStore'
    )
    const db = freshDb()
    db.prepare(`INSERT INTO Stems (StemCID) VALUES ('abc')`).run()
    upsertStemCategoryBus(db, [{ path: '/w/abc', busId: 'drums' }], 'tidyup', null, 1)
    expect(getStemCategoryRolesForPaths(db, ['/w/abc'])).toEqual({})
  })

  it('answers an empty list without touching the db', async () => {
    const { getStemCategoryRolesForPaths } = await import('./stemCategoriesStore')
    expect(getStemCategoryRolesForPaths(freshDb(), [])).toEqual({})
  })

  it('handles more paths than one IN-list chunk', async () => {
    const { getStemCategoryRolesForPaths, upsertStemCategoryRole } = await import(
      './stemCategoriesStore'
    )
    const db = freshDb()
    const paths: string[] = []
    for (let i = 0; i < 600; i += 1) {
      db.prepare(`INSERT INTO Stems (StemCID) VALUES (?)`).run(`s${i}`)
      paths.push(`/w/s${i}`)
    }
    upsertStemCategoryRole(
      db,
      paths.map((path) => ({ path, arrangeRole: 'bass' as const })),
      'tidyup',
      null,
      1
    )
    expect(Object.keys(getStemCategoryRolesForPaths(db, paths))).toHaveLength(600)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/main/stemCategoriesStore.test.ts`
Expected: FAIL — `getStemCategoryRolesForPaths is not exported`.

- [ ] **Step 3: Implement the main-process read**

Append to `src/main/stemCategoriesStore.ts`:

```ts
/** One path's confirmed role, as the renderer needs it. */
export interface StemRoleLookup {
  arrangeRole: ArrangeRole
  drumSubRole: DrumSubRole | null
}

// One IN-list query per chunk, matching stemAnalysisNeeds.ts's own chunked
// lookups. 500 is the same number that file uses.
const ROLE_LOOKUP_CHUNK_SIZE = 500

/**
 * Every CONFIRMED role among these paths, keyed by the path that was asked
 * about rather than by StemCID -- the renderer holds paths (map rows, flat
 * stems) and has no idea what a StemCID is.
 *
 * A path with no `Stems` row (a locally-dropped file, a one-shot, an in-app
 * recording) is simply absent from the result, as is a stem confirmed only
 * on the BUS axis. Absent means "nobody has said what this is", which is
 * exactly what the map's label chain and the role step's readout need to
 * fall through on -- never an empty string and never a guess.
 *
 * Read-only and synchronous: at the sizes this is called with (one
 * arrangement's stems, or one Tidy Up page) a chunked IN-list is cheap, and
 * it must not hold a statement open across an await -- see MEMORY.md's own
 * "never .iterate() across an await" rule.
 */
export function getStemCategoryRolesForPaths(
  db: Database.Database,
  paths: string[],
  extraCandidateDbs: Database.Database[] = []
): Record<string, StemRoleLookup> {
  const out: Record<string, StemRoleLookup> = {}
  const pathsByStemCID = new Map<string, string[]>()
  for (const path of paths) {
    const stemCID = stemCIDForPath(db, path, extraCandidateDbs)
    if (!stemCID) continue
    const existing = pathsByStemCID.get(stemCID)
    if (existing) existing.push(path)
    else pathsByStemCID.set(stemCID, [path])
  }
  const stemCIDs = [...pathsByStemCID.keys()]
  for (let start = 0; start < stemCIDs.length; start += ROLE_LOOKUP_CHUNK_SIZE) {
    const chunk = stemCIDs.slice(start, start + ROLE_LOOKUP_CHUNK_SIZE)
    countWork('sql:stem-category-roles')
    const placeholders = chunk.map(() => '?').join(',')
    const rows = db
      .prepare(
        `SELECT StemCID, ArrangeRole, DrumSubRole FROM StemCategories
         WHERE ArrangeRole IS NOT NULL AND StemCID IN (${placeholders})`
      )
      .all(...chunk) as { StemCID: string; ArrangeRole: string; DrumSubRole: string | null }[]
    for (const row of rows) {
      for (const path of pathsByStemCID.get(row.StemCID) ?? []) {
        out[path] = {
          arrangeRole: row.ArrangeRole as ArrangeRole,
          drumSubRole: row.DrumSubRole as DrumSubRole | null
        }
      }
    }
  }
  return out
}
```

- [ ] **Step 4: Wire the IPC**

In `src/main/index.ts`, add `getStemCategoryRolesForPaths` and `type StemRoleLookup` to the existing `./stemCategoriesStore` import block, and add a handler next to `'upsert-stem-category-role'`:

```ts
  ipcMain.handle(
    'get-stem-category-roles',
    (_event, paths: string[]): Record<string, StemRoleLookup> =>
      getStemCategoryRolesForPaths(openOwnRiffLibraryDb(), paths, candidateDbsForRiff())
  )
```

In `src/preload/index.ts`, next to `upsertStemCategoryRole`:

```ts
  getStemCategoryRoles: (
    paths: string[]
  ): Promise<Record<string, { arrangeRole: ArrangeRole; drumSubRole: DrumSubRole | null }>> =>
    ipcRenderer.invoke('get-stem-category-roles', paths),
```

- [ ] **Step 5: Run the tests and the typechecker**

Run: `npx vitest run src/main/stemCategoriesStore.test.ts && npm run typecheck`
Expected: tests PASS. `typecheck` still reports the Task 3 call-site error in `ArrangementMap.tsx` and nothing new.

- [ ] **Step 6: Commit**

```bash
git add src/main/stemCategoriesStore.ts src/main/stemCategoriesStore.test.ts src/main/index.ts src/preload/index.ts
git commit -m "What somebody already said a stem is, readable by path

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h"
```

---

## Task 5: One place decides a row's label

**Files:**
- Create: `src/renderer/src/state/coachMapRowLabels.ts`
- Test: `src/renderer/src/state/coachMapRowLabels.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/renderer/src/state/coachMapRowLabels.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { CoachMapRow } from './coachMapRows'
import { coachMapRowLabels } from './coachMapRowLabels'

function row(partial: Partial<CoachMapRow> & { channelId: string }): CoachMapRow {
  return {
    kind: 'stem',
    label: 'audio in',
    path: null,
    source: null,
    role: null,
    soundType: 'audioIn',
    clips: [],
    ...partial
  }
}

describe('coachMapRowLabels', () => {
  it('prefers the CONFIRMED role from the global table', () => {
    const rows = [row({ channelId: 'c0', path: 'a.wav', role: 'aux' })]
    expect(coachMapRowLabels(rows, { 'a.wav': 'drums' }).get('c0')).toBe('drums')
  })

  it('falls back to the climax role when nothing is confirmed', () => {
    const rows = [row({ channelId: 'c0', path: 'a.wav', role: 'bass' })]
    expect(coachMapRowLabels(rows, {}).get('c0')).toBe('bass')
  })

  it('falls back to the row own label when there is no role at all', () => {
    const rows = [row({ channelId: 'c0', path: 'a.wav', label: 'kick 02' })]
    expect(coachMapRowLabels(rows, {}).get('c0')).toBe('kick 02')
  })

  it('numbers rows that share a role, in ROW order', () => {
    const rows = [
      row({ channelId: 'c0', path: 'a.wav' }),
      row({ channelId: 'c1', path: 'b.wav' })
    ]
    const labels = coachMapRowLabels(rows, { 'a.wav': 'drums', 'b.wav': 'drums' })
    expect(labels.get('c0')).toBe('drums 1')
    expect(labels.get('c1')).toBe('drums 2')
  })

  it('does not number a role only one row has', () => {
    const rows = [
      row({ channelId: 'c0', path: 'a.wav' }),
      row({ channelId: 'c1', path: 'b.wav' })
    ]
    const labels = coachMapRowLabels(rows, { 'a.wav': 'drums', 'b.wav': 'bass' })
    expect(labels.get('c0')).toBe('drums')
    expect(labels.get('c1')).toBe('bass')
  })

  it('spells a role with ROLE_LABELS, not its raw value', () => {
    const rows = [row({ channelId: 'c0', path: 'a.wav' })]
    expect(coachMapRowLabels(rows, { 'a.wav': 'textureFx' }).get('c0')).toBe('texture/fx')
  })

  it('leaves a riser row its own name', () => {
    const rows = [row({ channelId: 'c9', kind: 'riser', label: 'riser 1', soundType: null })]
    expect(coachMapRowLabels(rows, {}).get('c9')).toBe('riser 1')
  })
})

describe('mapRowsNeedCategorising', () => {
  it('is true when a row with a stem has no role from anywhere', () => {
    const rows = [row({ channelId: 'c0', path: 'a.wav' })]
    expect(mapRowsNeedCategorising(rows, {})).toBe(true)
  })

  it('is false when every stem row has a role', () => {
    const rows = [row({ channelId: 'c0', path: 'a.wav', role: 'drums' })]
    expect(mapRowsNeedCategorising(rows, {})).toBe(false)
  })

  it('is false for a map of nothing but risers -- there is nothing to ask about', () => {
    const rows = [row({ channelId: 'c9', kind: 'riser', label: 'riser 1', soundType: null })]
    expect(mapRowsNeedCategorising(rows, {})).toBe(false)
  })
})
```

Add `mapRowsNeedCategorising` to the import at the top.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/renderer/src/state/coachMapRowLabels.test.ts`
Expected: FAIL — `Failed to resolve import "./coachMapRowLabels"`.

- [ ] **Step 3: Implement**

Create `src/renderer/src/state/coachMapRowLabels.ts`:

```ts
import type { ArrangeRole } from '@shared/stemRole'
import { ROLE_LABELS, stemLabelsByKey } from '../components/autoArrangeLabels'
import type { CoachMapRow } from './coachMapRows'

/**
 * The string actually drawn in a map row's header, and the ONE place that
 * decides it.
 *
 * THE CHAIN (spec, "Row labels, which is where part 1 meets part 2"):
 * **the confirmed role from the global StemCategories table -> the climax
 * role -> the stem's name -> the path.**
 *
 * Why the table comes first: real Endlesss material is recorded through
 * audio-in, so a stem's name and its SoundType both read "audio in" on
 * nearly every row at once and the map ends up saying nothing (direct
 * report, 2026-09-23). The role IS the categorised information, and a
 * library that has been through Tidy Up gives every map in the app readable
 * row headers for free, retroactively, with no wizard involved.
 *
 * Why the climax role survives as the second link rather than being deleted:
 * a locally-dropped file, a one-shot sample or an in-app recording has no
 * StemCID at all, so the global table can never answer for it. The climax
 * can. Dropping it would make the guided map WORSE for exactly the material
 * the user just made.
 *
 * Rows sharing a role are numbered ("drums 1", "drums 2") by
 * stemLabelsByKey, the same numbering DrawArrangeWizard's grid rows use --
 * two identical labels would re-lose exactly what this fixed. Numbered in
 * ROW order, so the "drums 1" above "drums 2" on screen is always the
 * earlier of the two.
 *
 * A pure function over plain data, not a hook, for the same reason
 * coachMapRows is one: the map's read path is the riskiest thing in this
 * feature and it has to be testable without mounting anything.
 */
export function coachMapRowLabels(
  rows: readonly CoachMapRow[],
  confirmedRoleByPath: Readonly<Record<string, ArrangeRole>>
): Map<string, string> {
  const roleByChannel = new Map<string, ArrangeRole>()
  for (const row of rows) {
    const role = roleFor(row, confirmedRoleByPath)
    if (role !== null) roleByChannel.set(row.channelId, role)
  }
  const numbered = stemLabelsByKey(
    [...roleByChannel].map(([channelId, role]) => ({ stemKey: channelId, role, included: true }))
  )
  const labels = new Map<string, string>()
  for (const row of rows) {
    labels.set(row.channelId, numbered.get(row.channelId) ?? row.label)
  }
  return labels
}

function roleFor(
  row: CoachMapRow,
  confirmedRoleByPath: Readonly<Record<string, ArrangeRole>>
): ArrangeRole | null {
  if (row.kind === 'riser') return null
  const confirmed = row.path === null ? undefined : confirmedRoleByPath[row.path]
  return confirmed ?? row.role
}

/**
 * Whether the map has rows nobody has named -- which is when the "what is
 * this?" button is worth offering.
 *
 * A riser row never counts: it has no stem and nothing to categorise. A row
 * with no path (clips the map did not lay out, naming several stems) does
 * not count either -- the merged surface works per stem, and there is no
 * single stem here for it to answer about.
 */
export function mapRowsNeedCategorising(
  rows: readonly CoachMapRow[],
  confirmedRoleByPath: Readonly<Record<string, ArrangeRole>>
): boolean {
  return rows.some((row) => row.path !== null && roleFor(row, confirmedRoleByPath) === null)
}

export { ROLE_LABELS }
```

`stemLabelsByKey` already spells a role through `ROLE_LABELS`, so the `textureFx → texture/fx` test passes without a second lookup. Remove the trailing `export { ROLE_LABELS }` if lint flags it as unused by any importer.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/renderer/src/state/coachMapRowLabels.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/state/coachMapRowLabels.ts src/renderer/src/state/coachMapRowLabels.test.ts
git commit -m "The label a map row shows, decided in one place

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h"
```

---

## Task 6: The map draws columns, not sections

**Files:**
- Create: `src/renderer/src/state/useConfirmedStemRoles.ts`
- Modify: `src/renderer/src/components/ArrangementMap.tsx`

**No component tests** — see Finding 16.

- [ ] **Step 1: Write the hook**

Create `src/renderer/src/state/useConfirmedStemRoles.ts`:

```ts
import { useEffect, useMemo, useState } from 'react'
import type { ArrangeRole } from '@shared/stemRole'

const EMPTY: Readonly<Record<string, ArrangeRole>> = {}

/**
 * What somebody already said these stems are, out of the global
 * StemCategories table.
 *
 * Fetched once per distinct path set and then left alone. A path nobody has
 * confirmed is simply absent -- never an empty string, never a guess (see
 * getStemCategoryRolesForPaths, main/stemCategoriesStore.ts).
 *
 * The setState is deferred through a microtask, not called directly in the
 * effect body: this repo ERRORS on a synchronous setState in an effect
 * (react-hooks/set-state-in-effect). Same established workaround as
 * useCachedStemEmbeddings.ts and AutoArrangeRoleStep.tsx's own
 * role-resolution effect.
 */
export function useConfirmedStemRoles(paths: string[]): Readonly<Record<string, ArrangeRole>> {
  const key = useMemo(() => [...new Set(paths)].sort().join(' '), [paths])
  const [byPath, setByPath] = useState<Readonly<Record<string, ArrangeRole>>>(EMPTY)

  useEffect(() => {
    let cancelled = false
    const wanted = key === '' ? [] : key.split(' ')
    if (wanted.length === 0) {
      void Promise.resolve().then(() => {
        if (!cancelled) setByPath(EMPTY)
      })
      return () => {
        cancelled = true
      }
    }
    void window.rifffApi
      .getStemCategoryRoles(wanted)
      .then((rows) => {
        if (cancelled) return
        const next: Record<string, ArrangeRole> = {}
        for (const [path, row] of Object.entries(rows)) next[path] = row.arrangeRole
        setByPath(next)
      })
      .catch((err: unknown) => {
        // A failed read means the map falls back to the climax role and the
        // stem's name, which is exactly what it did before this existed.
        console.error('useConfirmedStemRoles: failed to read confirmed roles:', err)
      })
    return () => {
      cancelled = true
    }
  }, [key])

  return byPath
}
```

- [ ] **Step 2: Rework `ArrangementMap.tsx`**

Add the props and the new imports:

```ts
import {
  distinctPlacedBarLengths,
  unguidedMapColumns,
  unguidedPhraseBars,
  type ArrangementMapColumn
} from '@shared/arrangementMapColumns'
import { coachMapRowLabels, mapRowsNeedCategorising } from '../state/coachMapRowLabels'
import { useConfirmedStemRoles } from '../state/useConfirmedStemRoles'
import { placedTimelineSpanBars } from '../state/selectors'
```

```ts
export function ArrangementMap({
  onWhatIsThis
}: {
  /** Opens the surface that answers "what is this stem" -- Tidy Up, on this
   * sketch's stems. Part 1's whole join to part 2 (spec). */
  onWhatIsThis: () => void
}): React.JSX.Element {
```

Replace the phrase/column derivation (currently lines ~60–73 and ~125–162). The guided branch is unchanged in behaviour; the unguided one is new:

```ts
  const state = useAppState()
  const dispatch = useDispatch()
  const coach = state.coach
  const sections = useMemo(() => coach?.sections ?? [], [coach])
  const guided = sections.length > 0

  // The loops actually placed, which is where an unguided map gets both its
  // phrase and the lengths its button row may offer -- facts about the
  // arrangement rather than guesses about it.
  const placedLoops = useMemo(
    () =>
      Object.values(state.rifffs)
        .filter((rifff) => rifff.startBar !== undefined)
        .map((rifff) => ({ startBar: rifff.startBar ?? 0, barLength: rifff.barLength })),
    [state.rifffs]
  )

  // The user's own answer wins wherever there is one -- on an unguided map
  // that is whatever he last clicked in the button row below; otherwise the
  // earliest placed rifff's own bar length. A rifff IS a loop, so its
  // barLength is the nominal phrase without measuring anything.
  //
  // Written as an if-chain, not a ??/|| expression: TypeScript rejects
  // mixing ?? with || without parentheses, and the parenthesised version of
  // this reads like nothing at all.
  const phraseBars = useMemo((): number => {
    const answered = coach?.phrase?.bars
    if (answered !== undefined) return answered
    if (guided) return coach?.lockedClimax?.barLength ?? 1
    return unguidedPhraseBars(placedLoops) ?? 1
  }, [coach, guided, placedLoops])

  const columns = useMemo((): ArrangementMapColumn[] => {
    if (guided) {
      return sections.map((section) => ({
        id: section.id,
        name: section.name,
        startBar: section.startBar,
        passes: section.passes
      }))
    }
    return unguidedMapColumns(placedTimelineSpanBars(state), phraseBars)
  }, [guided, sections, state, phraseBars])
```

Then every `sections.map(...)` / `sections[index]` in the render becomes `columns.map(...)` / `columns[index]`, and `section.name` in the header becomes:

```tsx
              {column.name}
```

(with `name === null` rendering nothing — React renders `null` as nothing, which is exactly the "no text at all" the spec asks for; the `data-tooltip` still says `${column.passes} x ${phraseBars} bars, from bar ${column.startBar}`).

`boundaries` / `boundaryAfter` / `appliedAt` / `appliedLabelAt` / `walkIndex` all derive from `coach` and are already empty/null without one — **leave them exactly as they are**. On an unguided map they produce no dividers, no join labels and no dimming, which is what "sssketchy says nothing here" means in practice. Do not add an `if (!guided)` around them.

The phrase button row's option source changes. Replace the `reading` / `phraseOptions` block:

```ts
  // Guided: the app's own measurement, offered once, with the silence rule
  // (coachPhrase.ts) so a loop that really does take all its bars is never
  // nagged. Unguided: the distinct bar lengths ACTUALLY PRESENT -- facts
  // about the arrangement, which is the property that makes offering them
  // allowed at all. Shown only when there is more than one to choose from.
  const reading = coach?.phraseReading ?? null
  const phraseOptions: readonly CoachPhrase[] = guided
    ? reading !== null && loopPhraseIsWorthSaying(reading)
      ? phraseAnswerOptions(reading)
      : []
    : distinctPlacedBarLengths(placedLoops).map((bars) => ({ bars, source: 'nominal' as const }))
```

and `changePhrase` gains an unguided branch — **there is no map to rebuild, only squares to re-size**:

```ts
  const changePhrase = useCallback(
    (option: CoachPhrase): void => {
      if (option.bars === phraseBars) return
      if (!guided) {
        // Nothing to rebuild: an unguided map's columns are computed from
        // this number every render, so writing the answer IS the re-size.
        dispatch({ type: 'COACH_SET_PHRASE', phrase: option })
        return
      }
      if (coach === null) return
      const built = buildMapRebuildActions(state, coach, option.bars)
      dispatch({
        type: 'BATCH',
        actions: [
          { type: 'COACH_SET_PHRASE', phrase: option },
          ...built.actions,
          { type: 'COACH_RECORD_MAP_PLACEMENT', placedGroupIds: built.placedGroupIds }
        ]
      })
    },
    [coach, dispatch, guided, phraseBars, state]
  )
```

**Check before implementing:** `COACH_SET_PHRASE` is only reachable when `state.coach` exists. If the reducer's case returns early on a null `coach`, the unguided branch must first dispatch whatever action starts the coach state (`startCoach`) or — simpler and preferred — keep the chosen phrase in a local `useState<number | null>` in this component and use it in place of `coach?.phrase?.bars`. **Read `store.ts`'s `COACH_SET_PHRASE` case and pick whichever of the two is true; do not guess.** If you take the local-state route, say so in the commit message: a view-level grid preference that is not an undo step and does not belong on disk is the same class of thing as `state.mode`.

`toggle` loses its climax guard:

```ts
  const toggle = useCallback(
    (row: CoachMapRow, column: ArrangementMapColumn, passIndex: number, on: boolean): void => {
      if (row.source === null) return
      const plan = planCellToggle({ clips: row.clips, section: column, phraseBars, passIndex, on })
      const actions = buildCellToggleActions(state, row, column, plan, phraseBars)
      if (actions.length === 0) return
      // ONE batch, so one cell is one undo step.
      dispatch({ type: 'BATCH', actions })
    },
    [dispatch, phraseBars, state]
  )
```

Labels:

```ts
  const rows = useMemo(() => coachMapRows(state), [state])
  const rowPaths = useMemo(
    () => rows.map((row) => row.path).filter((path): path is string => path !== null),
    [rows]
  )
  const confirmedRoles = useConfirmedStemRoles(rowPaths)
  const labels = useMemo(() => coachMapRowLabels(rows, confirmedRoles), [rows, confirmedRoles])
```

and every `row.label` in the render becomes `labels.get(row.channelId) ?? row.label`.

Cell `editable` becomes `row.source !== null`.

The empty state:

```tsx
  if (columns.length === 0) {
    return (
      <div style={{ padding: 'var(--ra-s-7)', fontSize: 11, color: 'var(--ra-text-3)' }}>
        nothing on the timeline yet.
      </div>
    )
  }
```

The footer's total-bars line uses `columns.reduce((sum, column) => sum + column.passes, 0)`.

- [ ] **Step 3: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: 0 errors, no new prettier warnings. `App.tsx` will fail typecheck on the missing `onWhatIsThis` prop — that is Task 7.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/state/useConfirmedStemRoles.ts src/renderer/src/components/ArrangementMap.tsx
git commit -m "The map draws columns, and an arrangement nobody built has some

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h"
```

---

## Task 7: "what is this?" — the join to part 2 (**SHIP POINT**)

**Files:**
- Modify: `src/renderer/src/components/ArrangementMap.tsx`, `src/renderer/src/App.tsx`

- [ ] **Step 1: Add the button**

In `ArrangementMap.tsx`, beside the phrase button row (above the positioned box holding the rail and rows), add:

```tsx
      {mapRowsNeedCategorising(rows, confirmedRoles) && (
        <div style={{ display: 'flex', marginBottom: 'var(--ra-s-5)' }}>
          <button
            type="button"
            onClick={onWhatIsThis}
            data-tooltip="say what these stems are. the map reads the answers back as row names."
            style={{
              height: 20,
              borderRadius: 0,
              padding: '0 8px',
              fontSize: 10,
              fontFamily: 'inherit',
              border: '1px solid var(--ra-border)',
              background: 'var(--ra-bg-row-active)',
              color: 'var(--ra-text-2)',
              cursor: 'pointer'
            }}
          >
            what is this?
          </button>
        </div>
      )}
```

Lowercase, no emoji, no exclamation mark, sharp corners, no colour — see Finding 19. **It is a button and nothing else.** sssketchy does not mention it, does not nudge toward it, and gains no line: he walks sections, and an unguided map has none (Finding 20).

- [ ] **Step 2: Wire it in `App.tsx`**

Line ~2508:

```tsx
                <ArrangementMap onWhatIsThis={() => setClusterStemsOpen(true)} />
```

`setClusterStemsOpen` and the `{clusterStemsOpen && <ClusterStemsBrowser … />}` mount both already exist (App.tsx:2700). **Nothing about Tidy Up changes in this task** — that is the whole point of the ship point.

- [ ] **Step 3: Full verification**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all green, ≥ 2564 tests, 0 typecheck errors, 0 lint errors + the same 4 pre-existing prettier warnings.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/ArrangementMap.tsx src/renderer/src/App.tsx
git commit -m "A button that asks what these are, and a map that reads the answer

Part 1 ships here: the map works on any arrangement, and the button opens
today's Tidy Up unchanged.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h"
```

**STOP AND REPORT HERE.** Part 1 is complete and shippable. Elling verifies:
- whether the unguided map is legible on a real messy arrangement, or whether sixty unnamed columns is just a wall;
- whether the row labels actually say something now, on real audio-in material;
- whether toggling cells on an unguided map does what he expects.

---

# PART 2 — Tidy Up and the role step merge

## Task 8: A picker writing a role says the role's name

**Files:**
- Modify: `src/renderer/src/components/DiscoverReclassifyPicker.tsx`

- [ ] **Step 1: Make the change**

Replace the import:

```ts
import { DISCOVER_RECLASSIFY_ROLES } from '@shared/discoverMatchMeter'
import { ROLE_LABELS } from './autoArrangeLabels'
```

and the button label (line 114):

```tsx
              {ROLE_LABELS[role] ?? role}
```

Add to the component's doc comment:

```
 * **Kind names describe a SLOT; role names describe a STEM.** This picker
 * writes an ArrangeRole onto a file, so it says the ROLE's name
 * (ROLE_LABELS) -- it used to say discoverRoleLabel(role, ROLE_LABELS),
 * which prefers a mask kind's playful name where one exists, so picking
 * "drummy" wrote arrangeRole: 'drums'. That is the two vocabularies leaking
 * into each other at the one place a user is making a claim about a file.
 * The match meter, which is explaining why a SLOT admitted a stem, keeps
 * the kind names -- that is what it is talking about, and
 * discoverRoleLabel still serves it (DiscoverPanel.tsx).
```

`discoverRoleLabel` keeps its export, its other caller and its tests. **Do not delete it.**

- [ ] **Step 2: Verify**

Run: `npx vitest run src/shared/discoverMatchMeter.test.ts && npm run typecheck && npm run lint`
Expected: PASS / 0 / 0.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/DiscoverReclassifyPicker.tsx
git commit -m "A picker writing a role says the role's name, not a slot's

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h"
```

---

## Task 9: One write path, and the notes field goes

**Files:**
- Modify: `src/renderer/src/state/stemCategoryCapture.ts`, `src/renderer/src/components/AutoArrangeWizard.tsx`, `src/renderer/src/components/DrawArrangeWizard.tsx`, `src/renderer/src/components/DiscoverPanel.tsx`, `src/renderer/src/components/ClusterStemsBrowser.tsx`, `src/preload/index.ts`, `src/main/stemCategoriesStore.ts`
- Test: `src/renderer/src/state/stemCategoryCapture.test.ts` (new), `src/main/stemCategoriesStore.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/renderer/src/state/stemCategoryCapture.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { StemRoleInfo } from '@shared/stemRole'
import type { Stem } from '@shared/types'
import { roleConfirmationsFromStemRoles } from './stemCategoryCapture'
import type { FlatStem } from './usePlacedFlatStems'

function flat(stemKey: string, path: string): FlatStem {
  const stem: Stem = {
    slot: 1,
    author: 'e',
    name: path,
    type: 'audioIn',
    path,
    durationSec: 4,
    barLength: 4
  }
  return { stem, groupId: 'g', stemKey }
}

function info(partial: Partial<StemRoleInfo> & { stemKey: string }): StemRoleInfo {
  return {
    soundType: 'audioIn',
    busId: null,
    arrangeRole: 'aux',
    uncertain: false,
    included: true,
    frequency: 'occasional',
    ...partial
  }
}

describe('roleConfirmationsFromStemRoles', () => {
  it('turns included roles into path-keyed confirmations', () => {
    const byKey = new Map([['k1', flat('k1', 'a.wav')]])
    expect(roleConfirmationsFromStemRoles([info({ stemKey: 'k1', arrangeRole: 'bass' })], byKey))
      .toEqual([{ path: 'a.wav', arrangeRole: 'bass', drumSubRole: undefined }])
  })

  it('drops a stem the user excluded', () => {
    const byKey = new Map([['k1', flat('k1', 'a.wav')]])
    expect(
      roleConfirmationsFromStemRoles([info({ stemKey: 'k1', included: false })], byKey)
    ).toEqual([])
  })

  it('drops a stem key with no flat stem behind it', () => {
    expect(roleConfirmationsFromStemRoles([info({ stemKey: 'gone' })], new Map())).toEqual([])
  })

  it('carries a drum sub-role', () => {
    const byKey = new Map([['k1', flat('k1', 'a.wav')]])
    const out = roleConfirmationsFromStemRoles(
      [info({ stemKey: 'k1', arrangeRole: 'drums', drumSubRole: 'kick' })],
      byKey
    )
    expect(out[0].drumSubRole).toBe('kick')
  })
})
```

And in `src/main/stemCategoriesStore.test.ts`, **delete every `subcategoryNote` case** and add (same dynamic-import convention as the rest of that file):

```ts
  it('leaves an existing note alone when a role is re-confirmed', async () => {
    const { upsertStemCategoryRole } = await import('./stemCategoriesStore')
    const db = freshDb()
    db.prepare(`INSERT INTO Stems (StemCID) VALUES ('abc')`).run()
    db.prepare(
      `INSERT INTO StemCategories (StemCID, SubcategoryNote, Source, UpdatedAt)
       VALUES ('abc', 'the good one', 'tidyup', 1)`
    ).run()
    upsertStemCategoryRole(db, [{ path: '/w/abc', arrangeRole: 'lead' }], 'tidyup', null, 2)
    const row = db.prepare(`SELECT SubcategoryNote FROM StemCategories WHERE StemCID = 'abc'`).get()
    expect((row as { SubcategoryNote: string | null }).SubcategoryNote).toBe('the good one')
  })
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/renderer/src/state/stemCategoryCapture.test.ts src/main/stemCategoriesStore.test.ts`
Expected: FAIL on both files.

- [ ] **Step 3: Rewrite `stemCategoryCapture.ts`**

```ts
// src/renderer/src/state/stemCategoryCapture.ts
import type { ArrangeRole, DrumSubRole, StemRoleInfo } from '@shared/stemRole'
import type { ProjectRef } from '@shared/types'
import type { FlatStem } from './usePlacedFlatStems'

/** One claim about one file. The ONLY thing the merged surface writes --
 * ArrangeRole and DrumSubRole, and nothing else (spec, "The taxonomy").
 * BusId is derived from it through ARRANGE_ROLE_TO_BUS; Discover's kinds
 * are a property of a SLOT and nothing writes one onto a file. */
export interface StemRoleConfirmation {
  path: string
  arrangeRole: ArrangeRole
  drumSubRole?: DrumSubRole
}

/** Where a confirmation came from, for the Source column. */
export type StemRoleSource = 'tidyup' | 'autoarrange' | 'drawarrange' | 'discover'

/**
 * THE one path a confirmed role reaches the library-wide StemCategories
 * table by.
 *
 * Replaces recordRoleCategorization (the wizards') and
 * recordRoleCategories (Tidy Up's), which were two functions writing the
 * same rows through the same IPC handler into the same table and triggering
 * the same server-side training (categoryCentroidTraining.ts). Two of these
 * is how the suggestion chains drifted apart in the first place, which cost
 * a real user-visible defect ("arrange mode is much better at guessing
 * currently... tidy up doesn't seem to be using it at all", 2026-09-15).
 *
 * Returns the promise rather than swallowing it: most callers are
 * fire-and-forget (`void recordStemRoles(...)`), but DiscoverPanel's
 * reclassifySlot has to know whether the write landed before it shows the
 * slot as reclassified. A member whose path does not resolve to a real
 * StemCID is silently skipped by the main-process side, not an error here.
 */
export function recordStemRoles(
  entries: StemRoleConfirmation[],
  source: StemRoleSource,
  currentSketch: ProjectRef
): Promise<void> {
  if (entries.length === 0) return Promise.resolve()
  return window.rifffApi.upsertStemCategoryRole(entries, source, currentSketch)
}

/** The wizards' own confirmation shape, as entries. INCLUDED stems only --
 * a stem the user took out of the arrangement has not been given a role,
 * it has been declined. */
export function roleConfirmationsFromStemRoles(
  roles: readonly StemRoleInfo[],
  flatStemsByKey: ReadonlyMap<string, FlatStem>
): StemRoleConfirmation[] {
  const entries: StemRoleConfirmation[] = []
  for (const role of roles) {
    if (!role.included) continue
    const stem = flatStemsByKey.get(role.stemKey)?.stem
    if (!stem) continue
    entries.push({
      path: stem.path,
      arrangeRole: role.arrangeRole,
      drumSubRole: role.drumSubRole
    })
  }
  return entries
}
```

- [ ] **Step 4: Update every caller**

- `AutoArrangeWizard.tsx` / `DrawArrangeWizard.tsx`: replace `recordRoleCategorization(roles, flatStemsByKey, 'autoarrange', currentSketch)` with
  `void recordStemRoles(roleConfirmationsFromStemRoles(roles, flatStemsByKey), 'autoarrange', currentSketch)` (and `'drawarrange'` respectively).
- `DiscoverPanel.tsx`'s `reclassifySlot`: replace the `window.rifffApi.upsertStemCategoryRole([...])` call with
  `await recordStemRoles([{ path: candidate.stemCID, arrangeRole: role }], 'discover', currentSketch)`.
  Keep the surrounding `try`/`catch` and the comment about a bare StemCID working as a path.
- `ClusterStemsBrowser.tsx`: delete `recordRoleCategories` entirely and call
  `void recordStemRoles(members.map((m) => ({ path: m.path, arrangeRole, drumSubRole })), 'tidyup', currentSketch)` from `assignCluster` / `assignSuggestedGroup` / `assignDrumSubRole`.

- [ ] **Step 5: Remove the note, everywhere but the column**

- `ClusterStemsBrowser.tsx`: delete the `<input type="text" … placeholder="specific note (optional)" …>` block (lines ~1195–1213), the `const [note, setNote] = useState('')` state and its doc comment, the `note` parameter from `onAssign` / `assignCluster` / `assignSuggestedGroup`, and `note.trim() || undefined` from the category button's `onClick`.
- `src/preload/index.ts`: drop `subcategoryNote?: string` from `upsertStemCategoryRole`'s entry type.
- `src/main/stemCategoriesStore.ts`: drop `subcategoryNote` from `StemRoleCategoryEntry`, from the INSERT column list, from the `VALUES` list, from the `DO UPDATE SET`, and from the `stmt.run({...})` object. Replace the field's doc comment with:

```ts
/** NO subcategoryNote. The column stays in riffLibrarySchema.ts and keeps
 * its rows -- dropping a SQLite column means rebuilding a table that also
 * holds the user's real library, for no gain, and anything already typed
 * into it would be destroyed. It simply stops gaining new ones: NOTHING
 * EVER READ IT (grepped across src/: the column, its migration and this
 * INSERT, and not one SELECT), its own tooltip said it did not affect
 * classifier training, and it occupied the busiest control row of the
 * busiest modal in the app -- on a surface whose whole value is that the
 * question can be answered in one click, a text box is the one control
 * that cannot. If a real consumer ever appears, the write path is four
 * lines. */
```

- [ ] **Step 6: Verify**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all green. Then confirm the removal actually happened:

```bash
grep -rn "subcategoryNote\|recordRoleCategorization\|recordRoleCategories" src/
```
Expected: **no matches**. (`SubcategoryNote`, capital S, still appears in `riffLibrarySchema.ts` and its migration — that is correct and deliberate.)

- [ ] **Step 7: Commit**

```bash
git add -A src/
git commit -m "One way to say what a stem is, and a text box that nothing read

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h"
```

---

## Task 10: The role step stops owning a role picker

**Files:**
- Modify: `src/renderer/src/components/AutoArrangeRoleStep.tsx`

**No component tests** — see Finding 16.

- [ ] **Step 1: Delete the two `<select>`s**

Remove:
- the `arrangeRole` `<select>` (lines ~680–701) **and its stale-sub-role clearing comment/branch**,
- the `drumSubRole` `<select>` (lines ~702–721),
- `ARRANGE_ROLE_OPTIONS`, `DRUM_SUB_ROLE_OPTIONS`, `DRUM_SUB_ROLE_LABELS` and `DrumSubRole` from the `@shared/stemRole` import,
- `selectStyle` and the `''`-means-generic comment block above `FREQUENCY_LEVELS`,
- `ArrangeRole` from the import **only if** nothing else uses it — the picker's `onPick` still does, so keep it.

`updateRole` **stays** — `included` and `frequency` still need it. Its role/sub-role branch is what goes.

- [ ] **Step 2: Add the readout and the picker**

```tsx
  const currentSketch = /* already a prop? if not, thread it from the wizard */
  const [picker, setPicker] = useState<{ stemKey: string; x: number; y: number } | null>(null)
  const pickerAnchorRef = useRef<HTMLButtonElement>(null)
  const confirmedRoles = useConfirmedStemRoles(
    useMemo(() => flatStems.map((fs) => fs.stem.path), [flatStems])
  )
```

Where the two selects were:

```tsx
                <button
                  ref={picker?.stemKey === role.stemKey ? pickerAnchorRef : undefined}
                  type="button"
                  onClick={(e): void => {
                    const rect = e.currentTarget.getBoundingClientRect()
                    setPicker({ stemKey: role.stemKey, x: rect.left, y: rect.bottom + 4 })
                  }}
                  data-tooltip="what is this stem? saved to your library, not just this sketch."
                  style={{
                    height: 22,
                    borderRadius: 0,
                    padding: '0 8px',
                    fontSize: 10,
                    fontFamily: 'inherit',
                    border: '1px solid var(--ra-border)',
                    background: 'var(--ra-bg-row-active)',
                    color: 'var(--ra-text)',
                    cursor: 'pointer'
                  }}
                >
                  {ROLE_LABELS[engineRoleFor(role)] ?? role.arrangeRole}
                </button>
```

`engineRoleFor` (`@shared/stemRole`) already substitutes a drum sub-role in for the generic `drums` bucket, and `ROLE_LABELS` already carries `kick`/`snare`/`hihat`/`clap`/`perc` alongside the eight roles — so the readout says "snare" where a snare was confirmed, with no new table.

Render the picker once, outside the row loop:

```tsx
      {picker !== null && (
        <DiscoverReclassifyPicker
          x={picker.x}
          y={picker.y}
          currentRole={roles.find((r) => r.stemKey === picker.stemKey)?.arrangeRole ?? null}
          onPick={(nextRole): void => {
            updateRole(picker.stemKey, { arrangeRole: nextRole, drumSubRole: undefined })
            const path = flatStemsByKey.get(picker.stemKey)?.stem.path
            if (path !== undefined) {
              void recordStemRoles([{ path, arrangeRole: nextRole }], 'autoarrange', currentSketch)
            }
          }}
          onClose={(): void => setPicker(null)}
          ignoreRef={pickerAnchorRef}
        />
      )}
```

`DiscoverReclassifyPicker` offers `DISCOVER_RECLASSIFY_ROLES`, which is the three mask-kind roles plus every `ARRANGE_ROLE_OPTIONS` entry without a mask kind — **all eight, no role lost** (verify with `DISCOVER_RECLASSIFY_ROLES.length === 8` while implementing). It already says "this stem is", already writes a Tidy Up-style confirmation, and already lives at exactly this gesture on the Discover match meter. **Nothing is built to replace the selects.**

- [ ] **Step 3: Read the role back from the global table**

In the role-resolution effect (line ~312), after `refineRoleWithEmbeddingOrCentroidSuggestion`, let a confirmed role win outright:

```ts
      const refined = refineRoleWithEmbeddingOrCentroidSuggestion(
        base,
        raw,
        centroidStore,
        {
          arrangeRoles: confirmedArrangeRoleEmbeddings,
          drumSubRoles: confirmedDrumSubRoleEmbeddings
        },
        embeddingByKey.get(key) ?? null
      )
      // A human already answered this question about this FILE, in Tidy Up
      // or in the reclassify picker, and a confirmation always beats a
      // machine guess -- the same rule resolveStemRole already applies to a
      // confirmed busId. Absent means nobody has said, which falls through
      // to the guess above rather than to a blank.
      const confirmed = confirmedRoles[stem.path]
      if (confirmed === undefined) return refined
      return { ...refined, arrangeRole: confirmed, uncertain: false }
```

Add `confirmedRoles` to the effect's dependency array.

- [ ] **Step 4: Verify**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/AutoArrangeRoleStep.tsx
git commit -m "The role step reads the answer instead of asking again

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h"
```

---

## Task 11: Tidy Up takes a population

**Files:**
- Modify: `src/renderer/src/components/ClusterStemsBrowser.tsx`

This task is **behaviour-preserving**. It names the thing that is about to gain a second value and changes nothing the user can see.

- [ ] **Step 1: Add the prop and the type**

```tsx
/** Which stems this pass is over.
 *
 * 'sketch' is today's behaviour, unchanged and the default: every stem on
 * the timeline (rifff.startBar !== undefined), clustered, auditioned
 * through useStemPreviewPlayback, writing BOTH role and bus.
 *
 * 'library' is the whole library: NOT clustered (computeMergeSequence is
 * O(n^3) against a real ~45,000-stem backlog -- that is arithmetic, not a
 * performance problem), auditioned through a throwaway one-stem project,
 * and writing ROLE ONLY. The bus is a fact about an export of THIS project
 * and a library stem has neither a stemKey nor a project, so
 * ASSIGN_STEMS_TO_BUS and upsertStemCategoryBus do not fire there. That
 * asymmetry is correct rather than unfortunate -- the bus is a fact about
 * an export, the role is a fact about a file -- but it means the same click
 * does slightly different work in the two populations, on purpose. */
export type TidyUpPopulation = 'sketch' | 'library'
```

Add `population = 'sketch'` to the props with that default. Guard the two bus writes:

```ts
  function assignCluster(id: number, members: ClusterableStem[], category: ArrangeRole): void {
    if (population === 'sketch') {
      const busId = ARRANGE_ROLE_TO_BUS[category]
      dispatch({ type: 'ASSIGN_STEMS_TO_BUS', stemKeys: members.map((m) => m.key), busId })
      recordBusCategories(members, busId)
    }
    void recordStemRoles(
      members.map((m) => ({ path: m.path, arrangeRole: category })),
      'tidyup',
      currentSketch
    )
    ...
  }
```

Same shape in `assignSuggestedGroup`.

- [ ] **Step 2: Verify nothing changed**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all green, no behaviour difference — nothing passes `population` yet.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/ClusterStemsBrowser.tsx
git commit -m "Tidy up names the population it is working over

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h"
```

---

## Task 12: The library population, unconfirmed first

**Files:**
- Create: `src/main/tidyUpLibraryStems.ts`, `src/main/tidyUpLibraryStems.test.ts`
- Modify: `src/main/riffLibrarySchema.ts`, `src/main/index.ts`, `src/preload/index.ts`

**The riskiest task in this plan.** Read Finding 9 and the note at the end of this task before starting.

- [ ] **Step 1: Write the failing test**

Create `src/main/tidyUpLibraryStems.test.ts`. **`riffLibrarySchema.ts` does not export its `SCHEMA_SQL`** (its only exports are `ownRiffLibraryRoot`, `ownRiffLibraryDbPath`, `openOwnRiffLibraryDb`, `closeOwnRiffLibraryDb`), so build the four tables by hand in a local `freshDb()`, exactly the way `stemCategoriesStore.test.ts` already does — and give `Stems` only the columns this module reads:

```ts
function freshDb(): Database.Database {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE Stems (
      StemCID TEXT PRIMARY KEY, OwnerJamCID TEXT NOT NULL, CreationTime INTEGER,
      BPMrnd REAL, Instrument INTEGER, Length16s REAL, PresetName TEXT,
      CreatorUserName TEXT
    );
    CREATE TABLE StemFeatureCache (
      StemCID TEXT PRIMARY KEY, FeaturesJSON TEXT NOT NULL, ExtractedAt INTEGER NOT NULL
    );
    CREATE TABLE StemCategories (
      StemCID TEXT PRIMARY KEY, ArrangeRole TEXT, DrumSubRole TEXT, BusId TEXT,
      Source TEXT NOT NULL, SourceProject TEXT, UpdatedAt INTEGER NOT NULL
    );
    CREATE TABLE StemAutoCategory (
      StemCID TEXT PRIMARY KEY, ArrangeRole TEXT NOT NULL, Source TEXT NOT NULL,
      ComputedAt INTEGER NOT NULL
    );
  `)
  return db
}
```

Inject `existsFn` so there is no filesystem dependency, exactly as `listLibraryScanTargets` does. `resolveStemPath` is pure string computation (see its own doc comment) so it needs no mocking.

```ts
describe('listTidyUpLibraryStems', () => {
  it('puts UNCONFIRMED stems before confirmed ones', async () => {
    // two stems, one with an ArrangeRole in StemCategories, one without
    const out = await listTidyUpLibraryStems(db, [], 10, () => true)
    expect(out[0].confirmedRole).toBeNull()
  })

  it('orders within each group by CreationTime, newest first', async () => { /* ... */ })

  it('only offers stems whose features have been scanned', async () => { /* ... */ })

  it('only offers stems whose audio is already on disk', async () => {
    const out = await listTidyUpLibraryStems(db, [], 10, (path) => path.endsWith('here'))
    expect(out.map((s) => s.stemCID)).toEqual(['here'])
  })

  it('carries the classifier own guess through, when there is one', async () => { /* ... */ })

  it('derives barLength from Length16s and durationSec from that and the bpm', async () => {
    // Length16s 64, BPMrnd 120 -> barLength 4, durationSec 4 * (60/120) * 4 = 8
  })

  it('honours the limit', async () => { /* ... */ })

  it('answers an empty list for an empty library', async () => {
    expect(await listTidyUpLibraryStems(db, [], 10, () => true)).toEqual([])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/main/tidyUpLibraryStems.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/main/tidyUpLibraryStems.ts`:

```ts
// src/main/tidyUpLibraryStems.ts
import type Database from 'better-sqlite3'
import type { SoundType } from '@shared/types'
import type { ArrangeRole } from '@shared/stemRole'
import { instrumentMaskToSoundType } from '@shared/riffLibraryTypes'
import { guessSoundTypeFromPresetName } from '@shared/presetNames'
import { resolveStemPath } from './riffLibraryStore'
import { createDirListingExists } from './discoverLibraryStems'
import { countWork } from './workCounters'

/** One library stem, as Tidy Up's library population needs it. */
export interface TidyUpLibraryStem {
  stemCID: string
  path: string
  /** The stem's own raw Endlesss preset name -- what
   * guessArrangeRoleFromPresetName matches against. */
  presetName: string
  author: string
  type: SoundType
  barLength: number
  durationSec: number
  /** What a human already said this is, or null. Rows with one sort LAST. */
  confirmedRole: ArrangeRole | null
  /** The overnight classifier's own guess (StemAutoCategory), or null. */
  suggestedRole: ArrangeRole | null
}

const PAGE_SIZE = 2000

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

/**
 * The library population, in the order the spec chose.
 *
 * **UNCONFIRMED FIRST, THEN MOST-RECENTLY-IMPORTED** (spec, SETTLED
 * 2026-09-23). It matches why the surface was opened -- a jam just came in
 * and wants labelling -- and it is the cheapest labelling condition there
 * is: a stem from last week is one you can still recognise, where a stem
 * from two years ago has to be auditioned from scratch.
 *
 * **Least-confident-first was considered and REJECTED as the default.** It
 * optimises for the classifier rather than the person: the stems it is
 * least sure about are disproportionately the noisy, odd, genuinely
 * unclassifiable ones, so it opens with the hardest possible screen and the
 * least useful stems in the library, at the highest compute cost. A pass
 * that opens with ten things you cannot confidently name is a pass you
 * close. If it earns a place later it is as a deliberate secondary mode,
 * never the default. Do not "improve" this ordering.
 *
 * Only stems whose FEATURES have already been scanned are offered
 * (StemFeatureCache) and only ones whose audio is already on disk
 * (existsFn) -- the same rule listLibraryScanTargets follows and for the
 * same reason: Elling's consent is about working with what is already
 * there, not triggering tens of thousands of downloads.
 *
 * Paged with a yield between pages, and `.all()` per page -- never a
 * statement held open across an await (MEMORY.md's hard-won SQLite rule).
 *
 * `ownDb` holds StemFeatureCache / StemCategories / StemAutoCategory, which
 * are sssketch-exclusive and live only on the user's own writable db.
 * `extraCandidateDbs` are the read-only external archives a stem's own
 * `Stems` row may live in instead -- so the eligible-id query runs against
 * ownDb and the metadata hydration runs across both, which is why this is
 * two passes rather than one JOIN.
 */
export async function listTidyUpLibraryStems(
  ownDb: Database.Database,
  extraCandidateDbs: Database.Database[],
  limit: number,
  existsFn: (path: string) => boolean = createDirListingExists()
): Promise<TidyUpLibraryStem[]> {
  // ... implement as described in Step 4
}
```

- [ ] **Step 4: The two passes, concretely**

**Pass one — eligible ids and what is known about them**, from `ownDb`, keyset-paged on `StemCID`:

```sql
SELECT f.StemCID AS StemCID,
       c.ArrangeRole AS ConfirmedRole,
       a.ArrangeRole AS SuggestedRole
FROM StemFeatureCache f
LEFT JOIN StemCategories c ON c.StemCID = f.StemCID
LEFT JOIN StemAutoCategory a ON a.StemCID = f.StemCID
WHERE f.StemCID > ?
ORDER BY f.StemCID LIMIT ?
```

`countWork('sql:tidy-up-library.eligible')` per page, `await yieldToEventLoop()` between pages.

**Pass two — metadata**, in chunks of 500, across `[ownDb, ...extraCandidateDbs]`, first db that answers wins:

```sql
SELECT StemCID, OwnerJamCID, CreationTime, BPMrnd, Length16s, PresetName, CreatorUserName,
       Instrument
FROM Stems WHERE StemCID IN (...)
```

Derive exactly as `riffLibraryStore.ts:508-510` already does — **do not invent a second derivation**:

```ts
const barLength = (row.Length16s ?? 16) / 16
const durationSec = barLength * (60 / (row.BPMrnd ?? 120)) * 4
```

and the sound type exactly as `DiscoverPanel.tsx:125-128` already does:

```ts
const type =
  instrumentMaskToSoundType(row.Instrument ?? 0) ??
  guessSoundTypeFromPresetName(row.PresetName ?? '') ??
  'fx'
```

Then: `path = resolveStemPath(row.OwnerJamCID, row.StemCID)`, filter by `existsFn(path)`, sort by

```ts
  (a, b) =>
    Number(a.confirmedRole !== null) - Number(b.confirmedRole !== null) ||
    b.creationTime - a.creationTime
```

and `slice(0, limit)`.

- [ ] **Step 5: Add the index**

In `src/main/riffLibrarySchema.ts`, next to the existing `idx_riffs_*` lines:

```sql
-- Tidy Up's library population orders by recency (spec: "unconfirmed
-- first, then most-recently-imported"). Own db only -- an external LORE
-- archive is read-only and no index can be added there, so its own stems
-- are sorted in JS off the hydrated page instead.
CREATE INDEX IF NOT EXISTS idx_stems_created ON Stems(CreationTime DESC);
```

**Honest note the spec is slightly optimistic about:** the spec calls the recency ordering "free, being an index that already exists". There was no index on `Stems(CreationTime)` — only `idx_riffs_owner_created` on `Riffs`. This adds one for the own db. It is still cheap; it is just not free.

- [ ] **Step 6: Wire the IPC**

`src/main/index.ts`:

```ts
  ipcMain.handle(
    'get-tidy-up-library-stems',
    (_event, limit: number): Promise<TidyUpLibraryStem[]> =>
      listTidyUpLibraryStems(openOwnRiffLibraryDb(), candidateDbsForRiff(), limit)
  )
```

`src/preload/index.ts`:

```ts
  getTidyUpLibraryStems: (limit: number): Promise<TidyUpLibraryStem[]> =>
    ipcRenderer.invoke('get-tidy-up-library-stems', limit),
```

- [ ] **Step 7: Verify**

Run: `npx vitest run src/main/tidyUpLibraryStems.test.ts && npm run typecheck && npm run lint`
Expected: PASS / 0 / 0.

- [ ] **Step 8: Commit**

```bash
git add src/main/tidyUpLibraryStems.ts src/main/tidyUpLibraryStems.test.ts src/main/riffLibrarySchema.ts src/main/index.ts src/preload/index.ts
git commit -m "The library, unconfirmed first and newest first after that

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h"
```

**If pass one turns out to be slow at Elling's real scale (~45,000 stems), STOP and report rather than optimising blind.** The two honest fallbacks, in order: (a) cap pass one at the first N pages and accept that a very large library's oldest stems are never offered; (b) restrict the population to the own warehouse and drop the external-archive hydration. Both are contained; neither should be chosen without a real measurement.

---

## Task 13: The library audition

**Files:**
- Create: `src/renderer/src/state/useThrowawayStemPreview.ts`

**No component tests** — see Finding 16. Read Finding 8 before starting.

- [ ] **Step 1: Write the hook**

```ts
import { useCallback, useEffect, useRef } from 'react'
import { assembleDiscoverRifff } from '../audio/discoverRifffAssembly'
import { resolveStretchedForPlayback } from '../audio/resolveStretchedForPlayback'
import { buildEngineProject } from '@shared/buildEngineProject'
import type { Stem } from '@shared/types'
import { initialState } from './store'
import {
  useAppSelector,
  useDispatch,
  useEngineOwnership,
  useFlushEngineSyncNow,
  usePluginCatalog
} from './StoreContext'

/**
 * Auditioning a stem that is in NO rifff and has no stemKey -- a library
 * stem, which useStemPreviewPlayback cannot reach because it solos by
 * stemKey against state.rifffs.
 *
 * THE INVARIANT THIS SHARES WITH useStemPreviewPlayback, and the reason
 * both are acceptable (spec, "There are two audition paths"): **each
 * audition hands the engine a project containing exactly the stems being
 * auditioned and nothing else, and starting one stops the previous one
 * entirely.** For the sketch that is store.ts's stemPreviewOverrides -- no
 * curves, no reverb, no mute regions, no risers -- so a stem is judged as
 * the file and not as the arrangement. Here it is free: a throwaway project
 * built from these stems alone has no toolkit to blank. **Neither path may
 * regress to letting a previous audition ring on underneath a new one** --
 * that was a real reported bug ("tidy up often plays multiple stems at
 * once").
 *
 * Deliberately NOT an extraction of DiscoverPanel's own syncPreviewToEngine.
 * That function carries a slot-id mapping, a barLengthOverride computed
 * across every resolved slot, an rAF burst-coalescer and a mute/solo model,
 * every one of which exists for a bug this hook cannot have (there are no
 * slots and nothing toggles mid-audition). Rewiring DiscoverPanel to share
 * this would be a large change to correctness-critical async ordering for no
 * behaviour gain. This is a narrow sibling, on purpose, and it keeps the
 * three guards that actually matter: an unmount flag, a generation counter,
 * and the engine-ownership token.
 */
export function useThrowawayStemPreview(): {
  previewStems: (stems: { stem: Omit<Stem, 'slot'>; gain: number }[]) => Promise<void>
} {
  const dispatch = useDispatch()
  const bpm = useAppSelector((s) => s.bpm)
  const masterChain = useAppSelector((s) => s.masterChain)
  const channelPlugins = useAppSelector((s) => s.channelPlugins)
  const pluginCatalog = usePluginCatalog()
  const flushEngineSyncNow = useFlushEngineSyncNow()
  const { claim: claimEngine, stillOwn: stillOwnEngine, release: releaseEngine } =
    useEngineOwnership()

  const unmountedRef = useRef(false)
  const generationRef = useRef(0)
  const loadedRef = useRef(false)

  // The `= false` in the SETUP body, not just in useRef, is load-bearing:
  // this app runs under <StrictMode>, whose synthetic setup -> cleanup ->
  // setup cycle would otherwise leave this true forever. Same gotcha
  // useStemPreviewPlayback.ts and DiscoverPanel.tsx both document at length.
  useEffect(() => {
    unmountedRef.current = false
    return () => {
      unmountedRef.current = true
      const token = releaseEngine()
      if (!loadedRef.current) return
      loadedRef.current = false
      // Stop, then hand the real project back -- without the PAUSE the
      // engine's transport keeps running under whatever project lands next
      // (DiscoverPanel's restorePreviewIfLoaded documents the same report).
      dispatch({ type: 'PAUSE' })
      void flushEngineSyncNow(undefined, () => !stillOwnEngine(token))
    }
  }, [dispatch, flushEngineSyncNow, releaseEngine, stillOwnEngine])

  const previewStems = useCallback(
    async (stems: { stem: Omit<Stem, 'slot'>; gain: number }[]): Promise<void> => {
      const myGeneration = ++generationRef.current
      const engineToken = claimEngine('tidy-up-library-preview')
      const assembly = assembleDiscoverRifff('tidy up', stems, bpm, stems.length)
      if (assembly === null) return
      const { rifff, vol } = assembly
      const previewState = {
        ...initialState,
        bpm,
        masterChain,
        channelPlugins,
        rifffs: { [rifff.groupId]: { ...rifff, startBar: 0 } },
        vol,
        stretch: { [rifff.groupId]: true }
      }
      try {
        const project = await buildEngineProject(
          previewState,
          resolveStretchedForPlayback,
          pluginCatalog
        )
        if (unmountedRef.current || generationRef.current !== myGeneration) return
        if (!stillOwnEngine(engineToken)) return
        await window.rifffApi.engineLoadProject(project)
        if (unmountedRef.current || generationRef.current !== myGeneration) return
        if (!stillOwnEngine(engineToken)) return
        loadedRef.current = true
        void window.rifffApi.engineSetPosition(0)
        dispatch({ type: 'PLAY' })
      } catch (err) {
        console.error('useThrowawayStemPreview: failed to load preview:', err)
        if (!loadedRef.current && stillOwnEngine(engineToken)) releaseEngine()
      }
    },
    [
      bpm,
      channelPlugins,
      claimEngine,
      dispatch,
      masterChain,
      pluginCatalog,
      releaseEngine,
      stillOwnEngine
    ]
  )

  return { previewStems }
}
```

**Verified while writing this plan, so do not second-guess it:** `buildEngineProject` is imported from `@shared/buildEngineProject` (not from `../audio/`), `resolveStretchedForPlayback` is a **plain module import** from `../audio/resolveStretchedForPlayback` and **not a hook** (`DiscoverPanel.tsx:12` imports it exactly that way and passes it straight through), and `usePluginCatalog` / `useFlushEngineSyncNow` / `useEngineOwnership` all come from `./StoreContext` (`DiscoverPanel.tsx:425-431`).

- [ ] **Step 2: Verify**

Run: `npm run typecheck && npm run lint`
Expected: 0 / 0. The hook is not mounted anywhere yet.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/state/useThrowawayStemPreview.ts
git commit -m "Auditioning a stem that lives in no arrangement

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h"
```

---

## Task 14: Tidy Up, over the library

**Files:**
- Modify: `src/renderer/src/components/ClusterStemsBrowser.tsx`, `src/renderer/src/App.tsx`

**No component tests** — see Finding 16.

- [ ] **Step 1: Fetch the population**

In `ClusterStemsBrowser.tsx`, alongside the existing `stems` memo:

```ts
  // Fetched once per modal session, like every other frozen-at-mount input
  // in this file (busOfSnapshot, centroidStoreSnapshot,
  // confirmedBusEmbeddings) and for the same reason: a list that reshuffles
  // under the user mid-pass was reported as "jolting"/like it "took over".
  const [libraryStems, setLibraryStems] = useState<TidyUpLibraryStem[] | null>(null)
  useEffect(() => {
    if (population !== 'library') return
    void window.rifffApi.getTidyUpLibraryStems(LIBRARY_PAGE).then(setLibraryStems)
  }, [population])
```

`const LIBRARY_PAGE = 200` — one evening's worth, not the whole backlog.

Map them into the existing `ClusterableStem` shape. A library stem has no timeline, so:

```ts
  // A library stem is in no rifff and on no timeline, so it has no groupId,
  // no slot and no bar. `key` is its StemCID, which is unique and is all
  // this file's own Maps/Sets need it for. startBar 0 and
  // visibleBars/tileSpanBars = barLength make the thumbnail draw one whole
  // pass of the file, which is exactly what <Waveform> renders anyway --
  // the playhead overlay simply never lights, because nothing on the
  // timeline is playing.
```

- [ ] **Step 2: Branch the four things that differ**

1. **Clustering.** `partitioned`'s `computeMergeSequence(standardizeFeatures(dspVectors))` must not run for the library. Give every library stem a suggested group from its `suggestedRole ?? confirmedRole ?? guessArrangeRoleFromPresetName(presetName)?.arrangeRole`, mapped through `ARRANGE_ROLE_TO_BUS`, and leave `dspStems` empty so the DSP half renders nothing. `expandFlatGroupIntoRows` then splits those suggested groups on demand exactly as it already does — **that is a unification, not a new mode**: the function exists precisely because a suggested group has no clustering behind it until someone asks for one. Hide the cluster-count slider when `population === 'library'`; it has nothing to cut.

2. **Audition.** `previewStem` / `playRow` / `playSuggestedGroup` branch:

```ts
  const { previewStems } = useThrowawayStemPreview()
  function previewStem(stem: ClusterableStem, targetBar: number): void {
    if (population === 'library') {
      void previewStems([{ stem: stemFieldsOf(stem), gain: 1 }])
      return
    }
    void startPreview(new Set([stem.key]), stem.groupId, targetBar)
  }
```

`targetBar` is meaningless for a throwaway one-loop project (it starts at 0 and loops) — that is a real difference and it is acceptable: the thumbnail's whole pass IS the loop. Do not fabricate a seek.

3. **Writes.** Already guarded in Task 11 — `population === 'sketch'` gates `ASSIGN_STEMS_TO_BUS` and `recordBusCategories`.

4. **Chrome.** `assignedBus` reads `state.busOf`, which never has a library stem in it, so a library row shows a confirmed highlight from the fetched `confirmedRole` instead:

```ts
  const assignedRole = population === 'library' ? (members[0]?.confirmedRole ?? null) : null
```

and the category button's `buttonStyle` state becomes `'confirmed'` when `assignedRole === category`. Note what this gives up: a confirmation made **during** this session does not re-highlight, because the fetched list is frozen. Acceptable — the celebration pulse already acknowledges the click, which is exactly what it was added for.

- [ ] **Step 3: A second menu entry**

In `App.tsx`'s gear `ContextMenu` items (line ~866):

```ts
            { label: 'tidy up', onClick: onOpenClusterStems },
            { label: 'tidy up library', onClick: onOpenClusterStemsLibrary },
```

Thread a `clusterStemsPopulation` state alongside `clusterStemsOpen` and pass it to `<ClusterStemsBrowser population={clusterStemsPopulation} … />`. The "what is this?" button from Task 7 keeps opening the **sketch** population — it is asking about the rows on this map.

Do **not** rename "tidy up". It is Elling's word, it has a tour step (`data-tour-id="tour-tidy"`), a menu entry and `TidyUpNudgeModal.tsx` attached to it. "what is this?" is his phrase for the *question*; whether it becomes the name of the thing is explicitly still open in the spec.

- [ ] **Step 4: Verify**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all green.

Then confirm the library never reaches the clusterer:

```bash
grep -n "computeMergeSequence" src/renderer/src/components/ClusterStemsBrowser.tsx
```
Expected: two matches only — inside `expandFlatGroupIntoRows`, and inside `partitioned`'s sketch-only branch.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/ClusterStemsBrowser.tsx src/renderer/src/App.tsx
git commit -m "Tidy up, over a library that was never clustered

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h"
```

---

## Task 15: The verification sweep

**Files:** none — this task only runs commands and reports.

- [ ] **Step 1: The full suite**

```bash
npm test && npm run typecheck && npm run lint
```
Expected: ≥ 2564 tests passing, 0 typecheck errors, 0 lint errors + exactly the 4 pre-existing prettier warnings.

- [ ] **Step 2: The greps that encode this plan's own rules**

```bash
# the two old write functions are gone, and the note with them
grep -rn "recordRoleCategorization\|recordRoleCategories\|subcategoryNote" src/     # expect: nothing

# the column survives
grep -rn "SubcategoryNote" src/main/riffLibrarySchema.ts                            # expect: 2 matches

# no fourth taxonomy, and none of the three deleted
grep -rn "SOUND_TYPE_TO_ARRANGE_ROLE\|ARRANGE_ROLE_SLOT_KINDS\|discoverSlotKindToArrangeRole" src/shared/  # expect: matches

# no second colour table
grep -rn "busColorHex" src/renderer/src/components/ArrangementMap.tsx src/renderer/src/state/coachMapRow*.ts  # expect: nothing

# nothing reached the engine
git diff --stat master -- native-engine/                                            # expect: empty
```

- [ ] **Step 3: Report honestly**

State what was built, what only Elling can verify (the whole of the spec's "Testing" section's second half), and **do not claim any UI behaviour was tested or that anything sounds a particular way** — this environment has no GUI or audio tooling.

---

## Known limits — write these down rather than discovering them later

1. **An unguided row emptied completely cannot be refilled from the map.** The source of the stem to put back is the row's own material, so once every cell on a row is off there is nothing left to read. Undo brings it back; nothing else does. A guided row has the locked climax as a fallback and does not have this problem. Accepted over the spec's rejected "off-only editing", which would have made *half* the clicks irreversible rather than one rare one.

2. **The map's columns do not follow the music.** An unguided column is `phraseBars` wide and starts where the arithmetic puts it. Dragging a clip a bar to the right moves it a bar to the right on the map. That is honest — the map reports where material sits against a regular grid — but it is not a structural reading and must never be described as one.

3. **The drum sub-role can only be set in Tidy Up now.** The role step's second `<select>` goes and `DiscoverReclassifyPicker` has no sub-role, which is the spec's own "nothing is built to replace them". The wizard still *reads* sub-roles back (Task 10's `engineRoleFor(role)` readout, seeded from the global table), so a sub-role confirmed in Tidy Up flows into the arrangement — it just cannot be typed in during the wizard.

4. **A library row's "confirmed" highlight is frozen at open.** See Task 14 Step 2.4.

5. **A library audition does not seek.** A throwaway one-loop project starts at 0 and loops; clicking partway into a library thumbnail previews the stem, not that point in it.

6. **`Stems(CreationTime)` had no index.** One is added for the own db in Task 12; a read-only external LORE archive cannot have one, so its stems are ordered in JS off the hydrated page.

## Self-review

**Spec coverage.** Part 1: columns (T1), phrase + button row (T1, T6), toggleable-row rule (T2, T3), label chain (T4, T5, T6), "what is this?" button (T7), sssketchy silent (Finding 20, no task — deliberate). Part 2: the merged surface is Tidy Up widened (T11, T14), the role step gives up its selects (T10), one write function (T9), notes removed / column kept (T9), the `ROLE_LABELS` leak (T8), the two audition paths (T13 + Finding 8), library not clustered (T14 + Finding 9), bus writes stop at the sketch boundary (T11), no new colour table (Finding 11, no task), all three taxonomies survive (Finding 12, no task), library ordering (T12).

**Not planned cleanly, and why:** the unguided phrase answer's storage (`COACH_SET_PHRASE` may refuse a null `coach`) is left as an explicit two-way decision inside Task 6 Step 2, because it depends on a reducer branch that must be read rather than guessed. Task 12's scale behaviour is a real unknown with two named fallbacks rather than a pretended answer.
