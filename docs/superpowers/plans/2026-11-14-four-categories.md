# Four categories (drums, bass, back, front) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every place sssketch shows, asks for, ranks by or exports a stem's role uses four
categories (drums, bass, back, front), and one shipped model replaces the overnight guessers.

**Architecture:** Stored values don't change. One pure module (`src/shared/stemCategory.ts`) maps
every stored role and bus to a category and says what each category writes. Discover's `lead`
kind is renamed `front` and a `back` kind is added; both rank by a front/back dial. A linear
softmax over YAMNet embeddings (weights in `src/shared/stemCategoryModel.json`, trained offline by
a script) fills `StemAutoCategory` with a category and a `FrontScore`. The old centroid,
nearest-neighbour and zero-shot guessers are then deleted.

**Tech Stack:** TypeScript, Electron (main/preload/renderer), React, better-sqlite3, vitest. Node 22
(`--experimental-strip-types`) for the training script.

**Spec:** `docs/superpowers/specs/2026-11-14-four-categories-design.md`. Read it first.

---

## Ground rules for every task

- Work in the worktree `~/Claudecode/sssketch-categories`, branch `four-categories`, made from local
  `master` (Task 0). Never push. Never launch Electron (`npm run dev` included).
- Gates after every task: `npm run typecheck`, `npm run lint`, and the task's own tests with
  `npx vitest run <files>`. The full `npm test` runs at the end of each phase.
- TDD for anything in `src/shared/` and `src/main/`: failing test first, see it fail, then the code.
- UI copy is lowercase, no emoji, no exclamation marks. Colours only through `typeColor.ts`.
- Line numbers below were read on 2026-11-14 at `ed465c96`. They drift: find the code by the quoted
  text, not the number.
- Commit messages end with the session's attribution lines.
- The web radio (`~/Claudecode/ell.ing/radio`) imports this repo's `src/shared` directly (its
  `tsconfig.json` and `vite.config.ts` alias it). Task 9 keeps it compiling. Never deploy it.

## File map

**Create**
- `src/shared/stemCategory.ts` (+ test): the vocabulary.
- `src/shared/stemCategoryModel.ts` (+ test): inference and the decision rule.
- `src/shared/stemCategoryTraining.ts` (+ test): fitting and grouped cross-validation (pure, type-only imports so Node can run it).
- `src/shared/stemCategoryModel.json`: the shipped weights (Task 12).
- `src/shared/stemCategoryDial.ts` (+ test): the dial as a percentile for Discover.
- `scripts/train-stem-category-model.mts`: reads a db copy, reports, writes the JSON.
- `src/main/frontScoreCache.ts` (+ test): `FrontScore` values and their percentile table, per db.

**Modify (main groups)**
- Vocabulary and labels: `stemRole.ts`, `autoArrangeLabels.ts`, `busNaming.ts`, `tidyUpReadiness.ts` (via `ARRANGE_ROLE_TO_BUS`), `renderer/src/theme/typeColor.ts`, `renderer/src/state/selectors.ts`, `renderer/src/state/store.ts`.
- Pickers: `ClusterStemsBrowser.tsx`, `AutoArrangeRoleStep.tsx`, `DiscoverReclassifyPicker.tsx`, `discoverMatchMeter.ts`.
- Exports: `main/nativeExport.ts`, `main/ableton/buildAlsXml.ts`, `main/reaper/buildRppProject.ts`.
- Discover kinds: `discoverSlotKind.ts`, `discoverSlotKindMask.ts`, `discoverTraits.ts`, `discoverRanking.ts`, `traitBar.ts`, `traitQuantiles.ts` (type only), `discoverCandidate.ts`, `main/discoverCandidates.ts`, `main/discoverAdjacency.ts`, the radio and coach modules in `src/shared/`, `DiscoverKindPicker.tsx`, `DiscoverPanel.tsx`, `DiscoverSlotRow.tsx`, `ShapePanel.tsx`, `CrossPanel.tsx`, `audio/discoverSeed.ts`, `main/remotePage.ts`, `main/remoteServer.ts`, `shared/remoteState.ts`, `shared/coachClimax.ts`.
- Model: `main/riffLibrarySchema.ts`, `main/stemAutoCategoryStore.ts`, `main/stemAutoClassify.ts`, `main/stemCategoriesStore.ts`, `main/index.ts`, `preload/index.ts`.

**Delete (Phase 4)**: `shared/categoryCentroids.ts`, `main/categoryCentroidStore.ts`, `main/categoryCentroidTraining.ts` (its two upsert wrappers move to plain upserts), `shared/roleCentroidRefinement.ts`, `shared/roleEmbeddingRefinement.ts`, `shared/embeddingMatch.ts`, `main/embeddingMatch.ts`, `shared/audiosetClasses.ts`, `main/resolveStemArrangeRole.ts`, and their tests.

---

## Task 0: Worktree

- [ ] **Step 1: Create it**

```bash
cd ~/Claudecode/sssketch
git worktree add ../sssketch-categories -b four-categories master
cd ../sssketch-categories && npm ci
```

- [ ] **Step 2: Baseline gates**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all pass (5588 tests on 2026-11-14, give or take the bing bong docs commits). Write the
count down; later phases compare against it.

---

# Phase 1: the vocabulary (display, pickers, exports)

## Task 1: `stemCategory.ts`, and the role → bus table

**Files:**
- Create: `src/shared/stemCategory.ts`, `src/shared/stemCategory.test.ts`
- Modify: `src/shared/stemRole.ts` (`ARRANGE_ROLE_TO_BUS`)
- Test: `src/shared/stemRole.test.ts`, `src/shared/tidyUpReadiness.test.ts`

- [ ] **Step 1: Write the failing test** (`src/shared/stemCategory.test.ts`)

```ts
import { describe, expect, it } from 'vitest'
import {
  CATEGORY_BUS,
  CATEGORY_ROLE,
  STEM_CATEGORY_OPTIONS,
  categoryOfBus,
  categoryOfRole,
  rolesInCategory
} from './stemCategory'
import { ARRANGE_ROLE_OPTIONS, ARRANGE_ROLE_TO_BUS } from './stemRole'

describe('stemCategory', () => {
  it('lists the four in display order', () => {
    expect(STEM_CATEGORY_OPTIONS).toEqual(['drums', 'bass', 'back', 'front'])
  })

  it('maps every stored role', () => {
    expect(categoryOfRole('drums')).toBe('drums')
    expect(categoryOfRole('fill')).toBe('drums')
    expect(categoryOfRole('bass')).toBe('bass')
    expect(categoryOfRole('backing')).toBe('back')
    expect(categoryOfRole('aux')).toBe('back')
    expect(categoryOfRole('textureFx')).toBe('back')
    expect(categoryOfRole('lead')).toBe('front')
    expect(categoryOfRole('vocal')).toBe('front')
  })

  it('maps every stored bus', () => {
    expect(categoryOfBus('drums')).toBe('drums')
    expect(categoryOfBus('bass')).toBe('bass')
    expect(categoryOfBus('backing')).toBe('back')
    expect(categoryOfBus('aux')).toBe('back')
    expect(categoryOfBus('lead')).toBe('front')
  })

  it('writes a role and bus that read back as the same category', () => {
    for (const c of STEM_CATEGORY_OPTIONS) {
      expect(categoryOfRole(CATEGORY_ROLE[c])).toBe(c)
      expect(categoryOfBus(CATEGORY_BUS[c])).toBe(c)
    }
    expect(CATEGORY_ROLE.back).toBe('backing')
    expect(CATEGORY_ROLE.front).toBe('lead')
  })

  it('lists the roles of a category', () => {
    expect(rolesInCategory('back')).toEqual(['backing', 'aux', 'textureFx'])
    expect(rolesInCategory('front')).toEqual(['lead', 'vocal'])
    expect(rolesInCategory('drums')).toEqual(['drums', 'fill'])
  })

  it("routes every role to a bus of the role's own category", () => {
    for (const role of ARRANGE_ROLE_OPTIONS) {
      expect(categoryOfBus(ARRANGE_ROLE_TO_BUS[role])).toBe(categoryOfRole(role))
    }
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/shared/stemCategory.test.ts`
Expected: FAIL, cannot resolve `./stemCategory`.

- [ ] **Step 3: Write `src/shared/stemCategory.ts`**

```ts
// src/shared/stemCategory.ts
//
// The four categories every surface of the app shows and asks for
// (docs/superpowers/specs/2026-11-14-four-categories-design.md). Stored values
// (ArrangeRole, BusId) are unchanged; this is the one mapping between them.
import type { BusId } from './types'
import type { ArrangeRole } from './stemRole'

export type StemCategory = 'drums' | 'bass' | 'back' | 'front'

export const STEM_CATEGORY_OPTIONS: readonly StemCategory[] = ['drums', 'bass', 'back', 'front']

const ROLE_CATEGORY: Record<ArrangeRole, StemCategory> = {
  drums: 'drums',
  fill: 'drums',
  bass: 'bass',
  backing: 'back',
  aux: 'back',
  textureFx: 'back',
  lead: 'front',
  vocal: 'front'
}

const BUS_CATEGORY: Record<BusId, StemCategory> = {
  drums: 'drums',
  bass: 'bass',
  backing: 'back',
  aux: 'back',
  lead: 'front'
}

/** The role a pick of each category stores: values older app versions already read. */
export const CATEGORY_ROLE: Record<StemCategory, ArrangeRole> = {
  drums: 'drums',
  bass: 'bass',
  back: 'backing',
  front: 'lead'
}

/** The bus a pick of each category stores. */
export const CATEGORY_BUS: Record<StemCategory, BusId> = {
  drums: 'drums',
  bass: 'bass',
  back: 'backing',
  front: 'lead'
}

export function categoryOfRole(role: ArrangeRole): StemCategory {
  return ROLE_CATEGORY[role]
}

export function categoryOfBus(bus: BusId): StemCategory {
  return BUS_CATEGORY[bus]
}

/** Every stored role that reads as `category`, in ROLE_CATEGORY's order. */
export function rolesInCategory(category: StemCategory): ArrangeRole[] {
  return (Object.keys(ROLE_CATEGORY) as ArrangeRole[]).filter((r) => ROLE_CATEGORY[r] === category)
}
```

- [ ] **Step 4: Change `ARRANGE_ROLE_TO_BUS`** in `src/shared/stemRole.ts` (the table at "export const ARRANGE_ROLE_TO_BUS") to:

```ts
export const ARRANGE_ROLE_TO_BUS: Record<ArrangeRole, BusId> = {
  drums: 'drums',
  bass: 'bass',
  lead: 'lead',
  backing: 'backing',
  aux: 'aux',
  // Each role's bus has the role's own category (stemCategory.ts, 2026-11-14).
  textureFx: 'backing',
  fill: 'drums',
  vocal: 'lead'
}
```

Replace the doc comment above it with one line: `/** The bus a role tidies to: always one of the role's own category (stemCategory.ts). */`

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/shared/stemCategory.test.ts src/shared/stemRole.test.ts src/shared/tidyUpReadiness.test.ts`
Expected: the new file passes. Any existing assertion that textureFx/fill/vocal tidy to `aux`
fails: change it to the new bus (backing/drums/lead) and re-run until green.

- [ ] **Step 6: Commit**

```bash
git add src/shared/stemCategory.ts src/shared/stemCategory.test.ts src/shared/stemRole.ts src/shared/*.test.ts
git commit -m "feat(categories): the four categories, and role -> bus by category"
```

## Task 2: Labels and auto-arrange's role variety

**Files:**
- Modify: `src/shared/autoArrangeLabels.ts`, `src/shared/stemRole.ts` (`engineRoleFor`)
- Test: `src/shared/autoArrangeLabels.test.ts` (create if missing), `src/shared/stemRole.test.ts`, `src/shared/autoArrangeEngine.test.ts`

- [ ] **Step 1: Failing tests.** Add to `src/shared/autoArrangeLabels.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { ROLE_LABELS, stemLabelsByKey } from './autoArrangeLabels'

describe('ROLE_LABELS', () => {
  it('shows every stored role as its category', () => {
    expect(ROLE_LABELS.lead).toBe('front')
    expect(ROLE_LABELS.vocal).toBe('front')
    expect(ROLE_LABELS.backing).toBe('back')
    expect(ROLE_LABELS.aux).toBe('back')
    expect(ROLE_LABELS.textureFx).toBe('back')
    expect(ROLE_LABELS.fill).toBe('drums')
    expect(ROLE_LABELS.hihat).toBe('hi-hat')
  })

  it('numbers stems across a whole category', () => {
    const labels = stemLabelsByKey([
      { stemKey: 'a', role: 'backing', included: true },
      { stemKey: 'b', role: 'aux', included: true },
      { stemKey: 'c', role: 'lead', included: true }
    ])
    expect(labels.get('a')).toBe('back 1')
    expect(labels.get('b')).toBe('back 2')
    expect(labels.get('c')).toBe('front')
  })
})
```

Add to `src/shared/stemRole.test.ts`:

```ts
it('engineRoleFor compares categories, keeping drum sub-roles apart', () => {
  const base = resolveStemRole(
    { name: 'x', type: 'notes' } as Stem,
    'k',
    null
  )
  expect(engineRoleFor({ ...base, arrangeRole: 'aux' })).toBe('back')
  expect(engineRoleFor({ ...base, arrangeRole: 'textureFx' })).toBe('back')
  expect(engineRoleFor({ ...base, arrangeRole: 'vocal' })).toBe('front')
  expect(engineRoleFor({ ...base, arrangeRole: 'fill' })).toBe('drums')
  expect(engineRoleFor({ ...base, arrangeRole: 'drums', drumSubRole: 'kick' })).toBe('kick')
})
```

(Use whatever `Stem` construction the file's other tests already use, if `as Stem` doesn't typecheck.)

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run src/shared/autoArrangeLabels.test.ts src/shared/stemRole.test.ts`
Expected: FAIL (labels are 'lead'/'backing'; engineRoleFor returns 'aux').

- [ ] **Step 3: Implement.** In `autoArrangeLabels.ts`, replace `ROLE_LABELS` with:

```ts
// Every stored role shows as its category (stemCategory.ts); drum sub-roles keep their own names.
export const ROLE_LABELS: Record<string, string> = {
  drums: 'drums',
  fill: 'drums',
  bass: 'bass',
  backing: 'back',
  aux: 'back',
  textureFx: 'back',
  lead: 'front',
  vocal: 'front',
  back: 'back',
  front: 'front',
  kick: 'kick',
  snare: 'snare',
  hihat: 'hi-hat',
  clap: 'clap',
  perc: 'perc / other'
}
```

In `stemRole.ts`, `engineRoleFor`:

```ts
export function engineRoleFor(role: StemRoleInfo): string {
  if (role.arrangeRole === 'drums' && role.drumSubRole) return role.drumSubRole
  return categoryOfRole(role.arrangeRole)
}
```

with `import { categoryOfRole } from './stemCategory'`. Trim its doc comment's last sentences to
say it returns the drum sub-role or the category.

- [ ] **Step 4: Run** `npx vitest run src/shared/autoArrangeLabels.test.ts src/shared/stemRole.test.ts src/shared/autoArrangeEngine.test.ts src/renderer/src/state/coachMapRowLabels.test.ts`
Expected: new tests pass. Existing expectations of labels like "lead 2" or roles 'aux' from
`engineRoleFor` change to the category words: update them.

- [ ] **Step 5: Commit** `feat(categories): role labels and auto-arrange variety by category`

## Task 3: Bus naming, colours, the tidied view's groups

**Files:**
- Modify: `src/shared/busNaming.ts`, `src/renderer/src/theme/typeColor.ts`, `src/renderer/src/state/selectors.ts`, `src/renderer/src/state/store.ts`
- Test: `src/shared/busNaming.test.ts`, `src/renderer/src/state/selectors.test.ts`, `src/renderer/src/state/store.test.ts` (whichever cover `renameRifffsForBusAssignment` and tidied rows)

- [ ] **Step 1: Failing tests** in `src/shared/busNaming.test.ts`:

```ts
it('names a clip by its category and numbers across the category', () => {
  const names = ['back 1 — pad', 'backing 4 — old pad']
  expect(nextBusClipName(names, 'aux', 'Choir')).toBe('back 2 — Choir')
  expect(nextBusClipName([], 'lead', 'Synth')).toBe('front 1 — Synth')
})

it('strips old and new prefixes', () => {
  expect(originalNameFromBusName('aux 3 — Choir')).toBe('Choir')
  expect(originalNameFromBusName('lead 2 — Synth')).toBe('Synth')
  expect(originalNameFromBusName('back 1 — Pad')).toBe('Pad')
  expect(originalNameFromBusName('front 7 — Hook')).toBe('Hook')
})

it('names an export group by category', () => {
  expect(busGroupName('aux', [{ soundType: 'fx' }])).toBe('BACK — FX')
  expect(busGroupName('drums', [{ soundType: 'drums' }])).toBe('DRUMS')
})
```

(Check `summarizeSoundTypes`' real output for `'fx'` first and use it in the expectation.)

- [ ] **Step 2: Run to see them fail.** `npx vitest run src/shared/busNaming.test.ts`

- [ ] **Step 3: Implement** in `busNaming.ts`:

```ts
import { categoryOfBus, STEM_CATEGORY_OPTIONS } from './stemCategory'

export function busGroupName(busId: BusId, entries: { soundType: SoundType }[]): string {
  const category = categoryOfBus(busId)
  const summary = summarizeSoundTypes(entries.map((e) => e.soundType))
  const name = summary === category ? category : `${category} — ${summary}`
  return name.toUpperCase()
}

// Old bus names (before 2026-11-14) and the category names, so re-tidying never nests prefixes.
const PREFIX_WORDS = ['drums', 'bass', 'lead', 'backing', 'aux', ...STEM_CATEGORY_OPTIONS]

export function originalNameFromBusName(name: string): string {
  const pattern = new RegExp(`^(?:${[...new Set(PREFIX_WORDS)].join('|')}) \\d+ — (.+)$`)
  const match = pattern.exec(name.trim())
  return match ? match[1] : name
}

export function nextBusClipName(
  existingNames: Iterable<string>,
  busId: BusId,
  originalName: string
): string {
  const category = categoryOfBus(busId)
  const pattern = new RegExp(`^${category} (\\d+) — `, 'i')
  let max = 0
  for (const name of existingNames) {
    const match = pattern.exec(name.trim())
    if (match) max = Math.max(max, parseInt(match[1], 10))
  }
  return `${category} ${max + 1} — ${originalNameFromBusName(originalName)}`
}
```

Delete the old `BUS_IDS` constant. Keep the existing doc comments, updated to say "category".

- [ ] **Step 4: Colours.** In `typeColor.ts`, find `BUS_COLOR_HEX` and its accessor(s). Make the
lookup go through the category so aux reads as back: back uses the current `backing` colour,
front the current `lead` colour.

```ts
const CATEGORY_COLOR_HEX: Record<StemCategory, string> = {
  drums: BUS_COLOR_HEX.drums,
  bass: BUS_COLOR_HEX.bass,
  back: BUS_COLOR_HEX.backing,
  front: BUS_COLOR_HEX.lead
}
```

and in every function that returns `BUS_COLOR_HEX[bus]`, return `CATEGORY_COLOR_HEX[categoryOfBus(bus)]`.
(`ChannelRow.tsx` and `RifffBlockRow.tsx` use those functions; check they call nothing else.)

- [ ] **Step 5: Tidied rows.** In `selectors.ts` replace `TIDIED_BUS_ORDER` and its uses
(`busForRifff`, the `tidied:<bus>:<n>` rows) so rows group by `categoryOfBus(bus)` in
`STEM_CATEGORY_OPTIONS` order: row ids become `tidied:<category>:<n>`. In `store.ts` replace the
hand-copied `BUS_ORDER` the same way, and make `renameRifffsForBusAssignment` number per category
(it calls `nextBusClipName`, which now does the numbering by category; check it doesn't filter
existing names by bus first: if it does, filter by category). Write a selectors test first:

```ts
it('groups aux and backing rifffs into one back row group', () => {
  // build a state with two tidied rifffs, one whose stems' busOf is 'aux', one 'backing',
  // using this file's existing state builders; expect both under ids starting 'tidied:back:'
})
```

Fill the builder calls in from the neighbouring tests in that file (they construct tidied states
already). Run, see it fail, implement, see it pass.

- [ ] **Step 6: Run** `npx vitest run src/shared/busNaming.test.ts src/renderer/src/state/` and the typecheck.
Update existing expectations that name 5 groups or "lead 2 — " to the category forms.

- [ ] **Step 7: Commit** `feat(categories): clip names, colours and tidied rows by category`

## Task 4: Pickers (Tidy Up, auto-arrange, reclassify)

**Files:**
- Modify: `src/renderer/src/components/ClusterStemsBrowser.tsx`, `src/renderer/src/components/AutoArrangeRoleStep.tsx`, `src/renderer/src/components/DiscoverReclassifyPicker.tsx`, `src/shared/discoverMatchMeter.ts`, `src/shared/stemRole.ts` (`ARRANGE_ROLE_OPTIONS` users)
- Test: `src/shared/discoverMatchMeter.test.ts`

- [ ] **Step 1: Failing test** in `discoverMatchMeter.test.ts`:

```ts
it('offers the four categories to reclassify, as stored roles', () => {
  expect(DISCOVER_RECLASSIFY_ROLES).toEqual(['drums', 'bass', 'backing', 'lead'])
})
```

- [ ] **Step 2: Run to see it fail.**

- [ ] **Step 3:** In `discoverMatchMeter.ts`:

```ts
export const DISCOVER_RECLASSIFY_ROLES: ArrangeRole[] = STEM_CATEGORY_OPTIONS.map((c) => CATEGORY_ROLE[c])

export function discoverRoleLabel(role: ArrangeRole): string {
  return categoryOfRole(role)
}
```

Drop `discoverRoleLabel`'s second parameter and fix its callers (TypeScript lists them). Remove
`maskKindForRole` if nothing else uses it.

- [ ] **Step 4: Tidy Up** (`ClusterStemsBrowser.tsx`):
  - The role buttons (the map over `ARRANGE_ROLE_OPTIONS` near "press N"): map over
    `STEM_CATEGORY_OPTIONS` instead. Button text = the category. Clicking writes
    `CATEGORY_BUS[category]` as the bus (the same `ASSIGN_STEMS_TO_BUS` dispatch) and
    `CATEGORY_ROLE[category]` as the role (the same `upsertStemCategoryRole` path). Highlight when
    `assignedBus && categoryOfBus(assignedBus) === category`.
  - Keys 1–8 handler → keys 1–4 over `STEM_CATEGORY_OPTIONS`; `title="press N"` follows.
  - `BUS_IDS` (5) and the loop building one suggested group per bus: loop over
    `STEM_CATEGORY_OPTIONS`; a stem joins the group `categoryOfBus(suggestedBus)`; assigning the
    group writes `CATEGORY_BUS[category]`.
  - The `suggestedBus` highlight that compares a bus with a role: compare categories.
  - Leave the kit-piece select (drums only) alone.
- [ ] **Step 5: Auto-arrange role step** (`AutoArrangeRoleStep.tsx`): its role dropdown over
  `ARRANGE_ROLE_OPTIONS` becomes the four categories. The select's value is
  `categoryOfRole(role.arrangeRole)`; a change writes `arrangeRole: CATEGORY_ROLE[category]` (and
  clears `drumSubRole` unless the category is drums, as it does today for non-drums roles). The
  chip already shows `ROLE_LABELS[engineRoleFor(role)]` (Task 2).
- [ ] **Step 6: Reclassify picker** (`DiscoverReclassifyPicker.tsx`): it renders
  `DISCOVER_RECLASSIFY_ROLES`; change its labels to `discoverRoleLabel(role)`. The highlighted
  choice compares categories (`categoryOfRole(current) === categoryOfRole(role)`).
- [ ] **Step 7: Find stragglers:**

```bash
grep -rn "ARRANGE_ROLE_OPTIONS" src --include=*.tsx --include=*.ts | grep -v test
```

Every UI use must now go through `STEM_CATEGORY_OPTIONS`. Non-UI uses (tests, `presetNames.ts`) stay.

- [ ] **Step 8: Gates.** `npx vitest run src/shared/discoverMatchMeter.test.ts`, typecheck, lint.
- [ ] **Step 9: Commit** `feat(categories): four-way pickers in tidy up, auto-arrange and reclassify`

## Task 5: Exports (stems, Ableton, REAPER)

**Files:**
- Modify: `src/main/nativeExport.ts`, `src/main/ableton/buildAlsXml.ts`, `src/main/reaper/buildRppProject.ts`
- Test: `src/main/nativeExport.test.ts`, `src/main/ableton/buildAlsXml.test.ts`, `src/main/reaper/buildRppProject.test.ts`

- [ ] **Step 1: Failing tests**, one per file, built from each file's existing per-bus test
  (copy its fixture): a project whose stems have `busOf` `aux` and `backing` produces ONE back
  group; `lead` produces a front group. Assertions:
  - stems export: a file named `back.wav` (and per-track variant `<project> - back <n>.wav`), no
    `aux.wav`/`backing.wav`, and `front.wav` instead of `lead.wav`;
  - Ableton: one group track whose name starts `BACK`, coloured with back's colour;
  - REAPER: one folder `BACK…`, shared tracks labelled `BACK (shared)`.
- [ ] **Step 2: Run to see them fail.**
- [ ] **Step 3: Implement.** In each file, the `BUS_IDS`/`BUS_ORDER` list and the default bus
  `'aux'` become categories:

```ts
const CATEGORY_ORDER = STEM_CATEGORY_OPTIONS
const DEFAULT_CATEGORY: StemCategory = 'back' // a stem with no bus, as 'aux' was
const categoryOfStem = (busId: BusId | undefined): StemCategory =>
  busId ? categoryOfBus(busId) : DEFAULT_CATEGORY
```

Group by `categoryOfStem(busOf[key])`. File names, track names, labels (`busLabel =
category.toUpperCase()`), the "(shared: …)" names and error text use the category word. The colour
tables (`ABLETON_BUS_COLORS`, `REAPER_BUS_COLORS`) are re-keyed by category: back takes backing's
value, front takes lead's. `busGroupName` already names by category (Task 3) but its parameter is
still a `BusId`: pass `CATEGORY_BUS[category]`.
- [ ] **Step 4: Run** the three test files; update every other expectation that names five buses.
- [ ] **Step 5: Phase gate:** `npm run typecheck && npm run lint && npm test`. Expected: all pass.
- [ ] **Step 6: Commit** `feat(categories): exports in four groups`

---

# Phase 2: Discover's kinds

## Task 6: Rename `lead` → `front`, add `back`

**Files:**
- Modify: `src/shared/discoverSlotKind.ts`, `src/shared/discoverSlotKindMask.ts`, and every file TypeScript then flags (radio, coach, readout, renderer)
- Test: `src/shared/discoverSlotKind.test.ts`, `src/shared/discoverSlotKindMask.test.ts`

- [ ] **Step 1: Failing tests** in `discoverSlotKind.test.ts`:

```ts
import {
  DISCOVER_MASK_SLOT_KINDS,
  DISCOVER_SLOT_KIND_LABEL,
  arrangeRoleToSlotKinds,
  normalizeSlotKinds,
  parseSlotKind,
  rankKindsOf
} from './discoverSlotKind'

it('has the four categories as mask kinds', () => {
  expect(DISCOVER_MASK_SLOT_KINDS).toEqual(['drums', 'bass', 'back', 'front'])
  expect(DISCOVER_SLOT_KIND_LABEL.front).toBe('front')
  expect(DISCOVER_SLOT_KIND_LABEL.drums).toBe('drums')
  expect(DISCOVER_SLOT_KIND_LABEL.bright).toBe('sparkly')
})

it('reads a saved lead as front', () => {
  expect(parseSlotKind('lead')).toBe('front')
  expect(parseSlotKind('back')).toBe('back')
  expect(parseSlotKind('nope')).toBeNull()
  expect(parseSlotKind(3)).toBeNull()
})

it('ranks by traits and the dial', () => {
  expect(rankKindsOf(['front', 'bright', 'drums'])).toEqual(['front', 'bright'])
  expect(rankKindsOf(['drums'])).toEqual([])
})

it('gives each stored role its category kind', () => {
  expect(arrangeRoleToSlotKinds('lead')).toEqual(['front'])
  expect(arrangeRoleToSlotKinds('vocal')).toEqual(['front'])
  expect(arrangeRoleToSlotKinds('backing')).toEqual(['back'])
  expect(arrangeRoleToSlotKinds('aux')).toEqual(['back'])
  expect(arrangeRoleToSlotKinds('textureFx')).toEqual(['back', 'warm'])
  expect(arrangeRoleToSlotKinds('fill')).toEqual(['drums', 'rhythmic'])
})

it('orders mask kinds first', () => {
  expect(normalizeSlotKinds(['warm', 'front', 'back'])).toEqual(['back', 'front', 'warm'])
})
```

- [ ] **Step 2: Run to see them fail.**

- [ ] **Step 3: Implement** in `discoverSlotKind.ts`:

```ts
export type DiscoverSlotKind =
  'drums' | 'bass' | 'back' | 'front' | 'bassHeavy' | 'rhythmic' | 'bright' | 'warm'

export const DISCOVER_MASK_SLOT_KINDS: DiscoverSlotKind[] = ['drums', 'bass', 'back', 'front']

/** The mask kinds are the four categories (stemCategory.ts). */
export type DiscoverMaskKind = StemCategory

/** back and front rank by the front/back dial (stemCategoryDial.ts). */
export type DiscoverDialKind = 'back' | 'front'
export type DiscoverRankKind = DiscoverTraitKind | DiscoverDialKind

export function isDialKind(kind: DiscoverSlotKind): kind is DiscoverDialKind {
  return kind === 'back' || kind === 'front'
}

/** What a kind set ranks by: its trait kinds and its dial kinds, in canonical order. */
export function rankKindsOf(kinds: readonly DiscoverSlotKind[]): DiscoverRankKind[] {
  return normalizeSlotKinds(kinds).filter(
    (k): k is DiscoverRankKind => isTraitSlotKind(k) || isDialKind(k)
  )
}

/** A kind from saved or sent state. 'lead' is the name `front` had before 2026-11-14. */
export function parseSlotKind(raw: unknown): DiscoverSlotKind | null {
  if (raw === 'lead') return 'front'
  return typeof raw === 'string' && (DISCOVER_SLOT_KIND_OPTIONS as string[]).includes(raw)
    ? (raw as DiscoverSlotKind)
    : null
}

const DISCOVER_SLOT_KIND_TO_ARRANGE_ROLE: Record<DiscoverSlotKind, ArrangeRole> = {
  drums: 'drums',
  bass: 'bass',
  back: 'backing',
  front: 'lead',
  bassHeavy: 'bass',
  rhythmic: 'drums',
  bright: 'lead',
  warm: 'backing'
}

export const ARRANGE_ROLE_SLOT_KINDS: Record<ArrangeRole, readonly DiscoverSlotKind[]> = {
  drums: ['drums'],
  fill: ['drums', 'rhythmic'],
  bass: ['bass'],
  lead: ['front'],
  vocal: ['front'],
  backing: ['back'],
  aux: ['back'],
  textureFx: ['back', 'warm']
}

export const DISCOVER_SLOT_KIND_LABEL: Record<DiscoverSlotKind, string> = {
  drums: 'drums',
  bass: 'bass',
  back: 'back',
  front: 'front',
  bassHeavy: 'chonky',
  rhythmic: 'rhythmic',
  bright: 'sparkly',
  warm: 'buttery'
}
```

Rewrite the doc comments on the type, `ARRANGE_ROLE_SLOT_KINDS` (no kind set here is the hook,
['front','bright']; back is never in a drop set, so aux and backing are never suggested drops) and
the label table (the four categories are plain words since 2026-11-14; the trait kinds keep their
playful names). Import `StemCategory` as a type.

- [ ] **Step 4: Phone toggle table** (`discoverSlotKindMask.ts`): it indexes
  `DISCOVER_SLOT_KIND_OPTIONS`; with 8 kinds it covers 256 states. Fix its "seven"/128 comments
  and whatever is sized by them; its test's expected table size changes to 256. Run
  `npx vitest run src/shared/discoverSlotKindMask.test.ts`.

- [ ] **Step 5: Fix every compile error** `npm run typecheck` reports, by this table:

| Where | Change |
|---|---|
| `radioIntensity.ts` `INTENSITY_ROLE_WEIGHT` | `front: 0.35`, `back: 0.25` (warm's) |
| `radioIntensityArc.ts` `radioCarryKind` | `'lead'` → `'front'` (both places) |
| `radioSchedule.ts` `RADIO_STARTER_ORDER` | `['drums','bass','front','back','drums','bright','rhythmic','front']` |
| `radioTransition.ts` melodic check | `kinds.includes('front')` (back keeps the pad table) |
| `radioFold.ts` `NEVER_FOLDS` | `['front', 'bass']` |
| `radioTurnaround.ts` kept row | `r.kinds.includes('front')` |
| `radioReadout.ts` `RADIO_KIND_WORD` | `front: 'front'`, `back: 'back'` (drop `lead`) |
| `coachSections.ts` drop sets | `intro: [['front']]`, `verse/build: [['front','bright']]`, `outro: [['front']]` |
| `coachClimax.ts` loader | filter kinds with `parseSlotKind` (map, drop nulls) instead of `isDiscoverSlotKind`, so a saved `'lead'` reads as front |
| `remoteState.ts` `parseRemoteSlotKinds` | use `parseSlotKind` |
| `audio/discoverSeed.ts` | notes → `'front'` |
| `discoverMatchMeter.ts`, `discoverTraits.ts`, `discoverCandidates.ts` | leave the logic for Task 7; for now only rename the literal `'lead'` → `'front'` so it compiles |

Also grep, since literals in arrays don't always fail the typecheck:

```bash
grep -rn "'lead'" src/shared src/main src/renderer/src | grep -v test | grep -iv "arrangeRole\|busId\|BUS\|ROLE"
```

Every remaining `'lead'` must be a stored role or bus, never a kind.

- [ ] **Step 6: Update tests.** `npm test`; fixtures using kind `'lead'` become `'front'`.
  Radio tests whose expectations depended on the starter's `warm` layer change to `back`. Keep
  the change mechanical; if a radio test's meaning breaks (not just a renamed value), stop and
  report it instead of rewriting the test's intent.
- [ ] **Step 7: Coach test** for the legacy read, in `coachClimax.test.ts`: a saved climax whose
  stem has `kinds: ['lead']` loads with `kinds: ['front']`.
- [ ] **Step 8: Commit** `feat(categories): discover kinds front and back (lead reads as front)`

## Task 7: Discover's pools by category

**Files:**
- Modify: `src/shared/discoverTraits.ts` (`stemMatchesSlotKinds`), `src/main/discoverCandidates.ts` (`kindByRole`, `buildMaskKindIndex`, `buildGuessLayer`, `getMaskDiscoverCandidates`), `src/shared/discoverMatchMeter.ts` (`reclassifyKindSources`, the reclassified check)
- Test: `src/shared/discoverTraits.test.ts`, `src/main/discoverCandidates.test.ts`, `src/shared/discoverMatchMeter.test.ts`

- [ ] **Step 1: Failing tests** in `discoverTraits.test.ts` (use the file's existing mask
  constants for drums/notes/bass bits):

```ts
describe('stemMatchesSlotKinds by category', () => {
  const all = { endlesss: true, audioIn: true }
  it('a confirmed vocal is front, never back', () => {
    expect(stemMatchesSlotKinds(null, ['front'], all, { confirmedRole: 'vocal' })).toBe(true)
    expect(stemMatchesSlotKinds(null, ['back'], all, { confirmedRole: 'vocal' })).toBe(false)
  })
  it('a confirmed aux is back', () => {
    expect(stemMatchesSlotKinds(null, ['back'], all, { confirmedRole: 'aux' })).toBe(true)
  })
  it('the notes tag alone places nothing', () => {
    expect(stemMatchesSlotKinds(NOTES_MASK, ['front'], all, {})).toBe(false)
  })
  it('a back-or-front guess is in both front and back', () => {
    expect(stemMatchesSlotKinds(NOTES_MASK, ['front'], all, { autoRole: 'backing' })).toBe(true)
    expect(stemMatchesSlotKinds(NOTES_MASK, ['back'], all, { autoRole: 'lead' })).toBe(true)
    expect(stemMatchesSlotKinds(NOTES_MASK, ['drums'], all, { autoRole: 'lead' })).toBe(false)
  })
  it('the drums tag still wins over a guess', () => {
    expect(stemMatchesSlotKinds(DRUMS_MASK, ['front'], all, { autoRole: 'lead' })).toBe(false)
  })
})
```

- [ ] **Step 2: Run to see them fail.**
- [ ] **Step 3: Implement `stemMatchesSlotKinds`:**

```ts
  if (!soundSourceMatchesFilter(instrumentMask, soundSource)) return false
  const maskKinds = normalizeSlotKinds(kinds).filter(isMaskSlotKind) as StemCategory[]
  if (maskKinds.length === 0) return true

  const { confirmedRole, autoRole } = classification
  if (confirmedRole) return maskKinds.includes(categoryOfRole(confirmedRole))

  const soundType =
    instrumentMask === null || instrumentMask === undefined
      ? null
      : instrumentMaskToSoundType(instrumentMask)
  if (soundType === 'drums' || soundType === 'bass') return maskKinds.includes(soundType)
  if (!autoRole) return false
  const guessed = categoryOfRole(autoRole)
  // A back-or-front guess sits in both pools; the dial ranks it (stemCategoryDial.ts).
  if (guessed === 'back' || guessed === 'front')
    return maskKinds.includes('back') || maskKinds.includes('front')
  return maskKinds.includes(guessed)
```

Update its doc comment's rule 3 to say: confirmed category; else the drums/bass tag; else the
guess, where a back or front guess admits the stem to both.

- [ ] **Step 4: Main pools, failing test first** in `discoverCandidates.test.ts`, using the
  file's existing db fixture helpers: a stem confirmed `aux` comes back for `kinds: ['back']` with
  `kindSources.back === 'confirmed'` and not for `['front']`; a notes-masked stem with a
  `StemAutoCategory` row `('lead', 'model')` comes back for both `['front']` and `['back']` with
  source `'guess'`; a notes-masked stem with no row comes back for neither.
- [ ] **Step 5: Implement** in `discoverCandidates.ts`:
  - Delete `kindByRole()`.
  - `buildMaskKindIndex`: a confirmed row admits `categoryOfRole(role)` with `'confirmed'`; else
    `soundType === 'drums' | 'bass'` admits that kind with `'tag'`; everything else (notes
    included) goes to `residue`.
  - `buildGuessLayer`: for a residue row with an auto role, `const c = categoryOfRole(role)`;
    drums/bass admit that kind; back/front admit BOTH `'back'` and `'front'`, source `'guess'`.
  - `emptyKindLists()` keeps building from `DISCOVER_MASK_SLOT_KINDS` (now four).
  - `getMaskDiscoverCandidates`' confirmed query `WHERE ArrangeRole = ?` becomes
    `WHERE ArrangeRole IN (${rolesInCategory(kind).map(() => '?').join(',')})` with
    `...rolesInCategory(kind)` as its parameters.
  - Fix the doc comments that say "three mask kinds" / "drums/bass/lead".
- [ ] **Step 6: Match meter.** `reclassifyKindSources` and the `reclassified` check compare
  `categoryOfRole(role) === kind` instead of `discoverSlotKindToArrangeRole(kind) === role`.
  Test: reclassifying to `'vocal'` marks a `['front']` slot `'confirmed'`.
- [ ] **Step 7: Run** the three test files, then `npx vitest run src/main/discoverAdjacency.test.ts src/main/discoverArtistIndex.test.ts`.
- [ ] **Step 8: Commit** `feat(categories): discover pools by category`

## Task 8: Discover, EEEDIT, Cross and phone surfaces

**Files:**
- Modify: `DiscoverKindPicker.tsx`, `DiscoverPanel.tsx`, `DiscoverSlotRow.tsx`, `ShapePanel.tsx`, `CrossPanel.tsx`, `src/main/remotePage.ts`, `src/main/remoteServer.ts`

- [ ] **Step 1: Kind rows.** `DiscoverKindPicker.tsx`'s "instrument" row shows the four mask
  kinds (it reads `DISCOVER_MASK_SLOT_KINDS`; confirm no hard-coded list).
- [ ] **Step 2: Hard-coded dividers.** `ShapePanel.tsx` and `CrossPanel.tsx` put the trait divider
  at `'bassHeavy'`; `DiscoverPanel.tsx` at the first trait kind. Make all three use
  `isTraitSlotKind(kind) && !isTraitSlotKind(previous)` (or the first of
  `DISCOVER_TRAIT_SLOT_KINDS`), so the four category chips sit before the divider.
- [ ] **Step 3: Ranking callers.** Replace `kinds.filter(isTraitSlotKind)` with
  `rankKindsOf(kinds)` at `ShapePanel.tsx` (`rankCandidates` call), `CrossPanel.tsx`
  (`rankCandidates` call) and `DiscoverPanel.tsx` (`applyTraitBar` and `rankCandidates`). That
  compiles only once ranking accepts the dial kinds, so make these changes first (test first for
  the ranking one). Until Task 15 attaches the dial, back/front candidates carry no dial value and
  rank by bpm and favourites alone:
  - `traitQuantiles.ts`: `export type TraitPercentiles = Partial<Record<DiscoverRankKind, number | null>>`
  - `traitBar.ts` `applyTraitBar(…, targetTraits: readonly DiscoverRankKind[], …)`
  - `discoverRanking.ts` `targetTraits?: readonly DiscoverRankKind[]`; inside, for a dial kind
    there is no pool fallback: `poolValues` gets `() => null`, no range, and the score is
    `percentile ?? 0` times `TRAIT_SCORE_WEIGHT` without the clash term (clash only reads trait kinds):

```ts
      for (const kind of targetTraits) {
        const percentile = candidate.traitPercentiles?.[kind]
        const hasPercentile = typeof percentile === 'number' && Number.isFinite(percentile)
        if (isDialRankKind(kind)) {
          if (hasPercentile) score += percentile * TRAIT_SCORE_WEIGHT
          continue
        }
        const trait = hasPercentile
          ? percentile
          : traitScore(poolValues.get(kind)!(candidate), DISCOVER_TRAIT_DIRECTION[kind], ranges.get(kind))
        score += radioClashTraitScore(kind, trait, clash?.amount ?? 0) * TRAIT_SCORE_WEIGHT
      }
```

    where `isDialRankKind = (k: DiscoverRankKind): k is DiscoverDialKind => k === 'back' || k === 'front'`
    (export it from `discoverSlotKind.ts` beside `isDialKind`), and the two loops that build
    `poolValues`/`ranges` skip dial kinds. Test in `discoverRanking.test.ts`: with
    `targetTraits: ['front']`, a candidate with `traitPercentiles.front = 0.9` ranks above one with
    `0.1` at equal bpm, and one with no value ranks last.
  - `discoverMatchMeter.ts`: for a dial kind, push the mask entry only when its source is
    `'confirmed'`; otherwise push `traitEntry(kind, traitPercentiles[kind], …)` (widen
    `traitEntry`'s `kind` to `DiscoverRankKind`). Test: a `['front']` slot with source `'guess'`
    and `front: 0.7` shows one bars entry labelled `front`.
- [ ] **Step 4: Labels and names.** `slotKindsLabel` feeds the kind buttons, tooltips, the
  "no {label} stem found" error and the `discover: …` rifff name; nothing to change beyond Task 6.
  Check `DiscoverSlotRow.tsx`'s picker highlight (it picks a role from the kind) uses
  `discoverSlotKindToArrangeRole`, which now returns `backing`/`lead` for back/front.
- [ ] **Step 5: Phone.** `remotePage.ts` builds `KIND_CHIPS`/`KINDS`/`KIND_TOGGLE` from the
  options, so it gains back and front; check its trait divider uses `.t`. `remoteServer.ts`'s
  `/api/add-slot` goes through `parseRemoteSlotKinds` (Task 6), so an old page's `'lead'` works.
  Add a `remoteState.test.ts` case: `parseRemoteSlotKinds(['lead'])` → `['front']`.
- [ ] **Step 6: Gates and commit.** typecheck, lint, `npx vitest run src/shared src/main/remote*`.
  Commit `feat(categories): discover, eeedit, cross and phone show the four kinds`

## Task 9: Keep the web radio compiling (no deploy)

**Files (other repo, `~/Claudecode/ell.ing/radio`):** `src/radio/pick.ts` and whatever its typecheck flags.

- [ ] **Step 1:** In that repo, `git status` must be clean apart from Elling's own work; work on a
  branch `four-categories` there. Its alias points at the sssketch repo path: check
  `tsconfig.json`/`vite.config.ts` to see whether it points at `~/Claudecode/sssketch` (then
  typecheck it against the worktree by temporarily pointing the alias at
  `~/Claudecode/sssketch-categories`, never committing that change).
- [ ] **Step 2:** `pick.ts`: `MASK_KINDS = ['drums', 'bass', 'back', 'front']`; `byMaskKind`
  gets `front` (stems whose stored role is lead or vocal, plus what `lead` admitted before) and
  `back` (role backing, aux or textureFx), using `categoryOfRole` from the shared module on the
  index's `role`. No dial on the web: back and front are the stored role's side.
- [ ] **Step 3:** Run its typecheck and tests (`npm run typecheck`, `npm test` in that repo).
  Expected: pass. Commit on its branch. Do not run `deploy/`.
- [ ] **Step 4: Phase gate** in the sssketch worktree: `npm run typecheck && npm run lint && npm test`.

---

# Phase 3: the model

## Task 10: Inference and the decision rule

**Files:**
- Create: `src/shared/stemCategoryModel.ts`, `src/shared/stemCategoryModel.test.ts`, `src/shared/stemCategoryModel.json` (a placeholder until Task 12)

- [ ] **Step 1: Placeholder weights** (`src/shared/stemCategoryModel.json`): a valid,
  untrained model so the app builds before Task 12:

```json
{ "version": 0, "dims": 1024, "classes": ["drums", "bass", "back", "front"], "mean": [], "scale": [], "weights": [], "bias": [0, 0, 0, 0] }
```

  `version: 0` means "untrained": the classifier places nothing with it (Step 3).

- [ ] **Step 2: Failing test**

```ts
import { describe, expect, it } from 'vitest'
import { guessFromProbs, predictCategoryProbs, type StemCategoryModel } from './stemCategoryModel'

const tiny: StemCategoryModel = {
  version: 1,
  dims: 2,
  classes: ['drums', 'bass', 'back', 'front'],
  mean: [0, 0],
  scale: [1, 1],
  weights: [
    [4, 0],
    [0, 4],
    [-2, -2],
    [-2, -2]
  ],
  bias: [0, 0, 0, 0.5]
}

describe('predictCategoryProbs', () => {
  it('returns softmax probabilities that sum to 1', () => {
    const p = predictCategoryProbs(tiny, [1, 0])!
    expect(p.drums + p.bass + p.back + p.front).toBeCloseTo(1, 9)
    expect(p.drums).toBeGreaterThan(0.9)
  })
  it('rejects a wrong-length or non-finite embedding, and an untrained model', () => {
    expect(predictCategoryProbs(tiny, [1])).toBeNull()
    expect(predictCategoryProbs(tiny, [NaN, 0])).toBeNull()
    expect(predictCategoryProbs({ ...tiny, version: 0 }, [1, 0])).toBeNull()
  })
})

describe('guessFromProbs', () => {
  it('drums or bass only at 0.8 or more', () => {
    expect(guessFromProbs({ drums: 0.8, bass: 0.1, back: 0.05, front: 0.05 })).toEqual({
      category: 'drums',
      frontScore: null
    })
    expect(guessFromProbs({ drums: 0.79, bass: 0.01, back: 0.1, front: 0.1 })).toEqual({
      category: 'front',
      frontScore: 0.5
    })
  })
  it('otherwise a dial, back below 0.5', () => {
    const g = guessFromProbs({ drums: 0.1, bass: 0.1, back: 0.6, front: 0.2 })
    expect(g.category).toBe('back')
    expect(g.frontScore).toBeCloseTo(0.25, 9)
  })
})
```

- [ ] **Step 3: Implement**

```ts
// src/shared/stemCategoryModel.ts
//
// The one stem model (docs/superpowers/specs/2026-11-14-four-categories-design.md): a linear
// softmax over a stem's mean YAMNet embedding. Weights come from
// scripts/train-stem-category-model.mts; version 0 is the untrained placeholder.
import type { StemCategory } from './stemCategory'
import modelJson from './stemCategoryModel.json'

export interface StemCategoryModel {
  version: number
  dims: number
  /** Always drums, bass, back, front: the rows of `weights` and `bias`. */
  classes: StemCategory[]
  mean: number[]
  scale: number[]
  weights: number[][]
  bias: number[]
  report?: unknown
}

export type CategoryProbs = Record<StemCategory, number>

export interface CategoryGuess {
  category: StemCategory
  /** p(front) / (p(front) + p(back)); null for a drums or bass guess. */
  frontScore: number | null
}

export const STEM_CATEGORY_MODEL = modelJson as StemCategoryModel

/** Drums or bass only when the model is at least this sure (spec, "How a stem's category..."). */
export const CONFIDENT_DRUMS_BASS = 0.8

export function predictCategoryProbs(
  model: StemCategoryModel,
  embedding: readonly number[]
): CategoryProbs | null {
  if (model.version < 1 || embedding.length !== model.dims) return null
  const logits = model.bias.slice()
  for (let d = 0; d < model.dims; d++) {
    const x = embedding[d]
    if (!Number.isFinite(x)) return null
    const z = (x - model.mean[d]) / model.scale[d]
    for (let c = 0; c < logits.length; c++) logits[c] += model.weights[c][d] * z
  }
  const max = Math.max(...logits)
  const exps = logits.map((l) => Math.exp(l - max))
  const sum = exps.reduce((a, b) => a + b, 0)
  const out = {} as CategoryProbs
  model.classes.forEach((c, i) => (out[c] = exps[i] / sum))
  return out
}

export function guessFromProbs(p: CategoryProbs): CategoryGuess {
  if (p.drums >= CONFIDENT_DRUMS_BASS) return { category: 'drums', frontScore: null }
  if (p.bass >= CONFIDENT_DRUMS_BASS) return { category: 'bass', frontScore: null }
  const sum = p.front + p.back
  const frontScore = sum > 0 ? p.front / sum : 0.5
  return { category: frontScore >= 0.5 ? 'front' : 'back', frontScore }
}
```

- [ ] **Step 4: Run** `npx vitest run src/shared/stemCategoryModel.test.ts` → PASS. Typecheck.
- [ ] **Step 5: Commit** `feat(categories): stem category model inference`

## Task 11: Training core and script

**Files:**
- Create: `src/shared/stemCategoryTraining.ts`, `src/shared/stemCategoryTraining.test.ts`, `scripts/train-stem-category-model.mts`

`stemCategoryTraining.ts` must have only `import type` imports, so Node can load it from the
script with `--experimental-strip-types`.

- [ ] **Step 1: Failing test**

```ts
import { describe, expect, it } from 'vitest'
import {
  crossValidate,
  fitStemCategoryModel,
  meetsFloor,
  type TrainingSample
} from './stemCategoryTraining'
import { predictCategoryProbs } from './stemCategoryModel'

// Four clusters in 8 dimensions, each jam holding a few of every class.
function synthetic(): TrainingSample[] {
  const centres = { drums: 0, bass: 2, back: 4, front: 6 } as const
  const out: TrainingSample[] = []
  let seed = 1
  const rand = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5
  for (let jam = 0; jam < 10; jam++) {
    for (const [category, axis] of Object.entries(centres)) {
      for (let k = 0; k < 5; k++) {
        const embedding = Array.from({ length: 8 }, (_, d) => (d === axis ? 3 : 0) + rand())
        out.push({ embedding, category: category as TrainingSample['category'], group: `jam${jam}` })
      }
    }
  }
  return out
}

describe('stemCategoryTraining', () => {
  it('fits a model the inference code accepts', () => {
    const model = fitStemCategoryModel(synthetic(), { version: 3 })
    expect(model.version).toBe(3)
    expect(model.dims).toBe(8)
    const p = predictCategoryProbs(model, [0, 0, 0, 0, 0, 0, 3, 0])!
    expect(p.front).toBeGreaterThan(0.5)
  })

  it('cross-validates by group and passes the floor on separable data', () => {
    const report = crossValidate(synthetic(), { folds: 5 })
    expect(report.frontBackAccuracy).toBeGreaterThan(0.9)
    expect(report.perClass.drums.recall).toBeGreaterThan(0.9)
    expect(meetsFloor(report).ok).toBe(true)
  })

  it('refuses a report below the floor', () => {
    const report = crossValidate(
      synthetic().map((s, i) => ({ ...s, category: (['drums', 'bass', 'back', 'front'] as const)[i % 4] })),
      { folds: 5 }
    )
    const verdict = meetsFloor(report)
    expect(verdict.ok).toBe(false)
    expect(verdict.reasons.length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run to see it fail.**
- [ ] **Step 3: Implement**

```ts
// src/shared/stemCategoryTraining.ts
//
// Offline training for stemCategoryModel.ts: multinomial logistic regression with balanced
// class weights and L2, plus cross-validation grouped by jam (a jam's stems never sit on both
// sides of a fold). Type-only imports: scripts/train-stem-category-model.mts loads this file
// straight from Node.
import type { StemCategory } from './stemCategory'
import type { StemCategoryModel } from './stemCategoryModel'

const CLASSES: StemCategory[] = ['drums', 'bass', 'back', 'front']

export interface TrainingSample {
  embedding: number[]
  category: StemCategory
  /** The jam, for grouped folds. */
  group: string
}

export interface FitOptions {
  version?: number
  iterations?: number
  learningRate?: number
  l2?: number
}

export interface ClassReport {
  n: number
  precision: number
  recall: number
}

export interface CvReport {
  n: number
  folds: number
  fourWayAccuracy: number
  /** Balanced accuracy of front vs back among true back/front stems (the larger of the two wins). */
  frontBackAccuracy: number
  perClass: Record<StemCategory, ClassReport>
}

/** The 2026-10-15 test: centroid 0.55, live guesses 0.24, best model ~0.65 on unseen jams. */
export const FLOOR = { frontBack: 0.6, drumsRecall: 0.6, bassRecall: 0.6 }

export function fitStemCategoryModel(
  samples: TrainingSample[],
  { version = 1, iterations = 300, learningRate = 0.1, l2 = 0.01 }: FitOptions = {}
): StemCategoryModel {
  const dims = samples[0]?.embedding.length ?? 0
  const mean = new Array<number>(dims).fill(0)
  const scale = new Array<number>(dims).fill(0)
  for (const s of samples) for (let d = 0; d < dims; d++) mean[d] += s.embedding[d] / samples.length
  for (const s of samples)
    for (let d = 0; d < dims; d++) scale[d] += (s.embedding[d] - mean[d]) ** 2 / samples.length
  for (let d = 0; d < dims; d++) scale[d] = Math.sqrt(scale[d]) || 1

  const z = samples.map((s) => s.embedding.map((x, d) => (x - mean[d]) / scale[d]))
  const y = samples.map((s) => CLASSES.indexOf(s.category))
  const counts = CLASSES.map((_, c) => y.filter((v) => v === c).length)
  const present = counts.filter((n) => n > 0).length
  const classWeight = counts.map((n) => (n > 0 ? samples.length / (present * n) : 0))
  const totalWeight = y.reduce((a, c) => a + classWeight[c], 0)

  const W = CLASSES.map(() => new Array<number>(dims).fill(0))
  const b = CLASSES.map(() => 0)
  const vW = CLASSES.map(() => new Array<number>(dims).fill(0))
  const vb = CLASSES.map(() => 0)
  for (let it = 0; it < iterations; it++) {
    const gW = CLASSES.map(() => new Array<number>(dims).fill(0))
    const gb = CLASSES.map(() => 0)
    for (let i = 0; i < z.length; i++) {
      const p = softmax(CLASSES.map((_, c) => dot(W[c], z[i]) + b[c]))
      const w = classWeight[y[i]] / totalWeight
      for (let c = 0; c < CLASSES.length; c++) {
        const g = w * (p[c] - (c === y[i] ? 1 : 0))
        gb[c] += g
        const row = gW[c]
        const zi = z[i]
        for (let d = 0; d < dims; d++) row[d] += g * zi[d]
      }
    }
    for (let c = 0; c < CLASSES.length; c++) {
      for (let d = 0; d < dims; d++) {
        vW[c][d] = 0.9 * vW[c][d] - learningRate * (gW[c][d] + l2 * W[c][d])
        W[c][d] += vW[c][d]
      }
      vb[c] = 0.9 * vb[c] - learningRate * gb[c]
      b[c] += vb[c]
    }
  }
  return { version, dims, classes: CLASSES.slice(), mean, scale, weights: W, bias: b }
}

export function crossValidate(
  samples: TrainingSample[],
  { folds = 5, ...fit }: FitOptions & { folds?: number } = {}
): CvReport {
  const foldOf = (s: TrainingSample): number => fnv1a(s.group) % folds
  const predicted: { truth: StemCategory; probs: number[] }[] = []
  for (let f = 0; f < folds; f++) {
    const train = samples.filter((s) => foldOf(s) !== f)
    const test = samples.filter((s) => foldOf(s) === f)
    if (train.length === 0 || test.length === 0) continue
    const model = fitStemCategoryModel(train, fit)
    for (const s of test) {
      const zs = s.embedding.map((x, d) => (x - model.mean[d]) / model.scale[d])
      predicted.push({
        truth: s.category,
        probs: softmax(model.weights.map((row, c) => dot(row, zs) + model.bias[c]))
      })
    }
  }
  const argmax = (p: number[]): StemCategory => CLASSES[p.indexOf(Math.max(...p))]
  const perClass = {} as Record<StemCategory, ClassReport>
  for (const c of CLASSES) {
    const truths = predicted.filter((r) => r.truth === c)
    const calls = predicted.filter((r) => argmax(r.probs) === c)
    const hits = truths.filter((r) => argmax(r.probs) === c).length
    perClass[c] = {
      n: truths.length,
      precision: calls.length ? hits / calls.length : 0,
      recall: truths.length ? hits / truths.length : 0
    }
  }
  const sideRecall = (side: 'back' | 'front'): number => {
    const truths = predicted.filter((r) => r.truth === side)
    const right = truths.filter((r) => {
      const front = r.probs[CLASSES.indexOf('front')]
      const back = r.probs[CLASSES.indexOf('back')]
      return side === 'front' ? front >= back : back > front
    })
    return truths.length ? right.length / truths.length : 0
  }
  return {
    n: predicted.length,
    folds,
    fourWayAccuracy: predicted.length
      ? predicted.filter((r) => argmax(r.probs) === r.truth).length / predicted.length
      : 0,
    frontBackAccuracy: (sideRecall('back') + sideRecall('front')) / 2,
    perClass
  }
}

export function meetsFloor(report: CvReport): { ok: boolean; reasons: string[] } {
  const reasons: string[] = []
  if (report.frontBackAccuracy < FLOOR.frontBack)
    reasons.push(`front/back ${report.frontBackAccuracy.toFixed(3)} < ${FLOOR.frontBack}`)
  if (report.perClass.drums.recall < FLOOR.drumsRecall)
    reasons.push(`drums recall ${report.perClass.drums.recall.toFixed(3)} < ${FLOOR.drumsRecall}`)
  if (report.perClass.bass.recall < FLOOR.bassRecall)
    reasons.push(`bass recall ${report.perClass.bass.recall.toFixed(3)} < ${FLOOR.bassRecall}`)
  return { ok: reasons.length === 0, reasons }
}

function dot(a: number[], b: number[]): number {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i] * b[i]
  return s
}

function softmax(logits: number[]): number[] {
  const max = Math.max(...logits)
  const e = logits.map((l) => Math.exp(l - max))
  const sum = e.reduce((a, v) => a + v, 0)
  return e.map((v) => v / sum)
}

function fnv1a(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h
}
```

- [ ] **Step 4: Run** `npx vitest run src/shared/stemCategoryTraining.test.ts` → PASS.
- [ ] **Step 5: The script** (`scripts/train-stem-category-model.mts`):

```ts
// scripts/train-stem-category-model.mts
//
// Trains src/shared/stemCategoryModel.json from a COPY of a riff library db
// (docs/superpowers/specs/2026-11-14-four-categories-design.md, "One model"):
//
//   sqlite3 ~/Music/sssketch/library/cache/common/warehouse.db3 ".backup /tmp/x/warehouse.db3"
//   node --experimental-strip-types scripts/train-stem-category-model.mts --db /tmp/x/warehouse.db3
//
// Prints a cross-validated report (folds grouped by jam) and writes the weights only if they
// clear FLOOR. --dry-run reports without writing. Weights are numbers; no names leave the db.
import Database from 'better-sqlite3'
import { writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  crossValidate,
  fitStemCategoryModel,
  meetsFloor,
  type TrainingSample
} from '../src/shared/stemCategoryTraining.ts'

const ROLE_CATEGORY: Record<string, TrainingSample['category']> = {
  drums: 'drums', fill: 'drums', bass: 'bass',
  backing: 'back', aux: 'back', textureFx: 'back',
  lead: 'front', vocal: 'front'
}

const args = process.argv.slice(2)
const arg = (name: string): string | undefined => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
const dbPath = arg('--db')
if (!dbPath) throw new Error('--db <path to a COPY of warehouse.db3> is required')
const here = dirname(fileURLToPath(import.meta.url))
const outPath = arg('--out') ?? resolve(here, '../src/shared/stemCategoryModel.json')
const l2 = Number(arg('--l2') ?? 0.01)
const dryRun = args.includes('--dry-run')

const db = new Database(dbPath, { readonly: true, fileMustExist: true })
type Row = { StemCID: string; Role: string; EmbeddingJSON: string; Jam: string | null; Source: string }
const rows = db
  .prepare(
    `SELECT c.StemCID, COALESCE(c.ArrangeRole, c.BusId) AS Role, e.EmbeddingJSON,
            s.OwnerJamCID AS Jam, c.Source
     FROM StemCategories c
     JOIN StemEmbeddingCache e ON e.StemCID = c.StemCID
     LEFT JOIN Stems s ON s.StemCID = c.StemCID
     WHERE COALESCE(c.ArrangeRole, c.BusId) IS NOT NULL`
  )
  .all() as Row[]

const toSample = (r: Row): TrainingSample | null => {
  const category = ROLE_CATEGORY[r.Role]
  if (!category) return null
  const embedding = JSON.parse(r.EmbeddingJSON) as number[]
  if (embedding.length !== 1024 || !embedding.every(Number.isFinite)) return null
  // shortcut: a stem with no Stems row here (LORE-only) is its own group; pass the archive's
  // Stems rows in if jam leakage ever matters.
  return { embedding, category, group: r.Jam ?? r.StemCID }
}

const human = rows.filter((r) => r.Source !== 'instrumentMask').map(toSample).filter((s) => s !== null)
const count = (c: string): number => human.filter((s) => s.category === c).length
// Endlesss-tagged drums/bass top those classes up to the larger of back/front, never more:
// thousands of tagged rows against a hundred back/front stems was the old guesser's bug.
const target = Math.max(count('back'), count('front'))
const tagged = rows.filter((r) => r.Source === 'instrumentMask').map(toSample).filter((s) => s !== null)
const extra: TrainingSample[] = []
for (const category of ['drums', 'bass'] as const) {
  const need = Math.max(0, target - count(category))
  const pool = tagged.filter((s) => s.category === category)
  // Deterministic sample: every k-th row.
  const step = Math.max(1, Math.floor(pool.length / Math.max(1, need)))
  for (let i = 0; i < pool.length && extra.filter((s) => s.category === category).length < need; i += step)
    extra.push(pool[i])
}
const samples = [...human, ...extra]
console.log(
  `samples: ${samples.length} (human ${human.length}: drums ${count('drums')}, bass ${count('bass')}, ` +
    `back ${count('back')}, front ${count('front')}; tagged extra ${extra.length})`
)

const report = crossValidate(samples, { folds: 5, l2 })
console.log(JSON.stringify(report, null, 2))
const verdict = meetsFloor(report)
if (!verdict.ok) {
  console.error(`refusing to write weights: ${verdict.reasons.join('; ')}`)
  process.exit(1)
}
if (dryRun) process.exit(0)
const model = fitStemCategoryModel(samples, { version: Date.now(), l2 })
const round = (v: number): number => Math.round(v * 1e5) / 1e5
writeFileSync(
  outPath,
  JSON.stringify({
    ...model,
    mean: model.mean.map(round),
    scale: model.scale.map(round),
    weights: model.weights.map((row) => row.map(round)),
    bias: model.bias.map(round),
    report: { ...report, trainedAt: new Date().toISOString(), samples: samples.length }
  }) + '\n'
)
console.log(`wrote ${outPath}`)
```

  `version` is the training time in ms: it changes on every retrain, which is what the
  classifier's fingerprint needs (Task 14).

- [ ] **Step 6: Smoke-run** against an empty temp db to check it starts and fails cleanly:

```bash
mkdir -p "$TMPDIR/cat" && sqlite3 "$TMPDIR/cat/empty.db3" "CREATE TABLE StemCategories(StemCID, ArrangeRole, BusId, Source); CREATE TABLE StemEmbeddingCache(StemCID, EmbeddingJSON); CREATE TABLE Stems(StemCID, OwnerJamCID);"
node --experimental-strip-types scripts/train-stem-category-model.mts --db "$TMPDIR/cat/empty.db3" --dry-run; echo "exit $?"
```

Expected: prints `samples: 0 …`, a report with zeros, "refusing to write weights", exit 1.
- [ ] **Step 7: Commit** `feat(categories): offline training for the stem category model`

## Task 12: Train the shipped weights

Uses a copy of Elling's library db, as the 2026-10-15 test did with his go-ahead for this design.
The copy lives in the session scratchpad and is deleted after.

- [ ] **Step 1: Copy**

```bash
SCRATCH=<session scratchpad>/train && mkdir -p "$SCRATCH"
sqlite3 ~/Music/sssketch/library/cache/common/warehouse.db3 ".backup $SCRATCH/warehouse.db3"
```

- [ ] **Step 2: Dry run** `node --experimental-strip-types scripts/train-stem-category-model.mts --db "$SCRATCH/warehouse.db3" --dry-run`
  Expected: about 300 human samples; front/back accuracy around 0.65–0.70. If it is under the
  floor, try `--l2 0.1` and `--l2 0.001` once each; if none clears it, stop and report the
  numbers (don't lower the floor).
- [ ] **Step 3: Write** the same command without `--dry-run`. Check the JSON is under 200 KB
  (`ls -l src/shared/stemCategoryModel.json`) and has `"dims":1024`.
- [ ] **Step 4: Delete the copy** `rm -rf "$SCRATCH"`.
- [ ] **Step 5: Test** `npx vitest run src/shared/stemCategoryModel.test.ts` and add one case that
  the shipped model loads: `expect(STEM_CATEGORY_MODEL.version).toBeGreaterThan(0)` and
  `predictCategoryProbs(STEM_CATEGORY_MODEL, new Array(1024).fill(0))` is not null.
- [ ] **Step 6: Commit** `feat(categories): trained stem category weights` with the report's
  front/back accuracy and per-class recall in the message body.

## Task 13: `FrontScore`, the store, and clearing the old guesses

**Files:**
- Modify: `src/main/riffLibrarySchema.ts`, `src/main/stemAutoCategoryStore.ts`
- Test: `src/main/riffLibrarySchema.test.ts`, `src/main/stemAutoCategoryStore.test.ts`

- [ ] **Step 1: Failing tests.** Schema: opening an own db whose `StemAutoCategory` lacks
  `FrontScore` adds it, deletes every row except `Source = 'instrumentMask'` rows with role
  drums/bass, and leaves those; opening it again deletes nothing. Store:
  `upsertStemAutoCategory(db, 'S1', 'backing', 'model', 123, 0.25)` writes `FrontScore = 0.25`;
  without the last argument it writes NULL.
- [ ] **Step 2: Run to see them fail.**
- [ ] **Step 3: Schema.** Add `FrontScore REAL` to the `CREATE TABLE StemAutoCategory` DDL, and,
  beside `ensureStemCategoriesHasSubcategoryNote`, run from `openOwnRiffLibraryDb`:

```ts
/** 2026-11-14 (four categories): the dial column, added once. Adding it is the moment the
 * old guessers' rows go, so every stem is guessed again by the one model. A duplicate-column
 * error means the other app (dev vs packaged share this db) added it first: nothing to do. */
function ensureStemAutoCategoryHasFrontScore(db: Database.Database): void {
  const columns = db.prepare(`PRAGMA table_info(StemAutoCategory)`).all() as { name: string }[]
  if (columns.length === 0 || columns.some((c) => c.name === 'FrontScore')) return
  try {
    db.transaction(() => {
      db.exec(`ALTER TABLE StemAutoCategory ADD COLUMN FrontScore REAL`)
      db.exec(
        `DELETE FROM StemAutoCategory
         WHERE NOT (Source = 'instrumentMask' AND ArrangeRole IN ('drums', 'bass'))`
      )
    })()
  } catch (err) {
    if (!String(err).includes('duplicate column')) throw err
  }
}
```

  After the delete, call `bumpStemClassificationVersion(db, 'auto')` so Discover rebuilds its
  guess layer (import from `./stemClassificationVersion`; if that import would be circular from
  the schema file, do the bump in `openOwnRiffLibraryDb` right after this call returns `true`
  instead, by making the function return whether it ran).

- [ ] **Step 4: Store.**

```ts
export type StemAutoCategorySource = 'model' | 'instrumentMask'

export function upsertStemAutoCategory(
  ownDb: Database.Database,
  stemCID: string,
  arrangeRole: ArrangeRole,
  source: StemAutoCategorySource,
  computedAt: number,
  frontScore: number | null = null
): void
```

  The SQL inserts and updates `FrontScore` too. (Removing the old source names surfaces their
  writers as type errors: `applyYamnetZeroShotCategory` goes in Task 17; until then cast its
  source to keep it compiling only if needed, with a `// shortcut: removed in Task 17` note.)
- [ ] **Step 5: Run** both test files → PASS. Commit `feat(categories): FrontScore column, old guesses cleared once`

## Task 14: The classifier uses the model

**Files:**
- Modify: `src/main/stemAutoClassify.ts`
- Test: `src/main/stemAutoClassify.test.ts`, `src/main/stemAutoClassifyScheduler.test.ts`

The pass structure (pending lists, priorities, yielding transactions, the tried ledger, wake
signals) stays. What changes is what decides a row and what the fingerprint is.

- [ ] **Step 1: Failing tests** (use the file's existing fixtures for embedding rows and masks;
  inject the model through a new `options.model` so tests don't depend on the shipped weights):
  - a stem with a drums mask bit is placed `('drums', 'instrumentMask', FrontScore NULL)`;
  - a notes-masked stem with an embedding is placed by the model: with a test model that puts it
    at p(back)=0.6, p(front)=0.2, the row is `('backing', 'model', 0.25)`;
  - with a test model at p(drums)=0.85 the row is `('drums', 'model', NULL)`;
  - with an untrained model (`version: 0`) a stem with an embedding and no reliable mask is
    recorded as tried, not placed;
  - a stem whose existing row has `Source = 'embedding'` (written by an older app) is eligible
    again and gets overwritten with a `'model'` row;
  - a stem with features but no embedding and no reliable mask is recorded as tried (no centroid
    pass any more).
- [ ] **Step 2: Run to see them fail.**
- [ ] **Step 3: Implement.**
  - Imports: drop `createEmbeddingSuggester`, `suggestCategory`, `toFeatureArray`,
    `getConfirmedEmbeddings`, `loadCategoryCentroidStore`, `SOUND_TYPE_TO_ARRANGE_ROLE`. Add
    `STEM_CATEGORY_MODEL, predictCategoryProbs, guessFromProbs, type StemCategoryModel` and
    `CATEGORY_ROLE`.
  - `reliableMaskSoundType` returns `'drums' | 'bass' | null` (notes no longer). Its comment gets
    one line: the notes bit says "melodic", not front or back (2026-11-14).
  - Delete `PreparedConfirmed`, `confirmedEmbeddingsFingerprint`, `getPreparedConfirmedEmbeddings`,
    `centroidHashByStore`/`centroidStoreHash`.
  - `CLASSIFIER_VERSION = 2`, its doc comment listing what moves it now: the decision rule in
    this file, `CONFIDENT_DRUMS_BASS`, `reliableMaskSoundType`.
  - Fingerprint: `` `c${CLASSIFIER_VERSION}|m${model.version}` `` in both
    `trainingFingerprintOf(model)` and `currentAutoClassifyTrainingFingerprint()`.
  - `ClassifyBatchOptions` gains `model?: StemCategoryModel` (default `STEM_CATEGORY_MODEL`).
  - Eligibility (`eligibleStemCIDs`' WHERE): the auto-row clause becomes
    `NOT EXISTS (SELECT 1 FROM StemAutoCategory a WHERE a.StemCID = x.StemCID AND a.Source IN ('model', 'instrumentMask'))`.
    `featureEligibilityWhere` always excludes stems with an embedding (the model always counts as
    trained); drop its untrained branch and the `embeddingAxisTrained` plumbing.
  - Embedding pass, per row:

```ts
      const instrument = masks.get(row.StemCID)
      const reliable = instrument !== undefined ? reliableMaskSoundType(instrument) : null
      if (reliable) {
        return settle(row.StemCID, instrument, { role: reliable, source: 'instrumentMask', frontScore: null })
      }
      let probs: CategoryProbs | null = null
      try {
        probs = predictCategoryProbs(model, JSON.parse(row.EmbeddingJSON) as number[])
      } catch {
        // Corrupted row: not placed. A re-extraction rewrites it and forgets the record.
      }
      if (!probs) return settle(row.StemCID, instrument, null)
      const guess = guessFromProbs(probs)
      return settle(row.StemCID, instrument, {
        role: CATEGORY_ROLE[guess.category],
        source: 'model',
        frontScore: guess.frontScore
      })
```

  - Feature pass: keep only the mask short-circuit; a row without a reliable mask settles `null`
    (tried). `fetchPendingFeatureRows` no longer needs `FeaturesJSON`: select only `StemCID`.
  - `settle`'s placed type gains `frontScore: number | null`, passed to `upsertStemAutoCategory`.
- [ ] **Step 4: Run** `npx vitest run src/main/stemAutoClassify.test.ts src/main/stemAutoClassifyScheduler.test.ts src/main/stemAutoCategoryStore.test.ts src/main/stemAutoClassifyTried.test.ts`.
  Remove tests that only exercised the centroid or nearest-neighbour paths; keep every test about
  batching, yielding, priorities and the tried ledger, adapted to the model.
- [ ] **Step 5: Commit** `feat(categories): the overnight pass uses the one model`

## Task 15: The dial in Discover and radio's dig

**Files:**
- Create: `src/shared/stemCategoryDial.ts` (+ test), `src/main/frontScoreCache.ts` (+ test)
- Modify: `src/main/discoverCandidates.ts` (`getDiscoverCandidatesPool`, `attachDiscoverTraits`), `src/main/discoverAdjacency.ts`

- [ ] **Step 1: Failing test** (`stemCategoryDial.test.ts`):

```ts
import { describe, expect, it } from 'vitest'
import { dialFor, withDial } from './stemCategoryDial'
import { buildQuantileTable } from './traitQuantiles'

describe('dialFor', () => {
  const table = buildQuantileTable([0.2, 0.3, 0.4, 0.5, 0.6])
  it('a label sets the dial', () => {
    expect(dialFor({ kindSources: { front: 'confirmed' }, frontScore: null, table })).toBe(1)
    expect(dialFor({ kindSources: { back: 'confirmed' }, frontScore: 0.9, table })).toBe(0)
  })
  it('a guess is its place in the library', () => {
    expect(dialFor({ kindSources: { front: 'guess' }, frontScore: 0.6, table })).toBe(1)
    expect(dialFor({ kindSources: {}, frontScore: 0.2, table })).toBe(0)
  })
  it('no score, no dial; no table, the raw score', () => {
    expect(dialFor({ kindSources: {}, frontScore: null, table })).toBeNull()
    expect(dialFor({ kindSources: {}, frontScore: 0.3, table: null })).toBe(0.3)
  })
})

describe('withDial', () => {
  it('sets front and back as opposite ends, keeping trait percentiles', () => {
    const c = withDial({ traitPercentiles: { bright: 0.4 } }, 0.75)
    expect(c.traitPercentiles).toEqual({ bright: 0.4, front: 0.75, back: 0.25 })
    expect(withDial({ traitPercentiles: {} }, null).traitPercentiles).toEqual({ front: null, back: null })
  })
})
```

- [ ] **Step 2: Run to see it fail.** Then implement:

```ts
// src/shared/stemCategoryDial.ts
//
// The front/back dial as Discover ranks by it (spec, "Discover and radio"): a label is 1 or 0,
// a guess is its FrontScore's place among every stored FrontScore, so the trait bar means
// "front-er than most of your library" rather than a raw probability.
import type { DiscoverKindSources } from './discoverSlotKind'
import { percentileOf, type QuantileTable, type TraitPercentiles } from './traitQuantiles'

export function dialFor({
  kindSources,
  frontScore,
  table
}: {
  kindSources: DiscoverKindSources | undefined
  frontScore: number | null | undefined
  table: QuantileTable | null
}): number | null {
  if (kindSources?.front === 'confirmed') return 1
  if (kindSources?.back === 'confirmed') return 0
  if (frontScore === null || frontScore === undefined || !Number.isFinite(frontScore)) return null
  return table ? percentileOf(table, frontScore) : frontScore
}

export function withDial<T extends { traitPercentiles: TraitPercentiles }>(c: T, dial: number | null): T {
  return {
    ...c,
    traitPercentiles: { ...c.traitPercentiles, front: dial, back: dial === null ? null : 1 - dial }
  }
}
```

  (Check `percentileOf`'s real signature in `traitQuantiles.ts` and its return range [0, 1].)

- [ ] **Step 3: `frontScoreCache.ts`, failing test first:** with an own db holding three
  `StemAutoCategory` rows with FrontScore 0.1/0.5/0.9 and one NULL, `getFrontScores(db)` returns a
  map of three and a table; a second call within 10 s returns the same object; after
  `bumpStemClassificationVersion(db, 'auto')` and 10 s (inject `now`), it rebuilds.

```ts
// src/main/frontScoreCache.ts
import type Database from 'better-sqlite3'
import { buildQuantileTable, type QuantileTable } from '@shared/traitQuantiles'
import { getStemClassificationVersion } from './stemClassificationVersion'
import { countWork } from './workCounters'

export interface FrontScores {
  byStemCID: Map<string, number>
  table: QuantileTable | null
}

// While the overnight pass runs the version moves every batch; rebuilding at most this often
// keeps a roll from re-reading the table each time (same idea as GUESS_LAYER_MIN_MS).
const MIN_REBUILD_MS = 10_000

const cache = new WeakMap<Database.Database, { version: number; builtAt: number; scores: FrontScores }>()

export function getFrontScores(ownDb: Database.Database, now = Date.now()): FrontScores {
  const version = getStemClassificationVersion(ownDb, 'auto')
  const hit = cache.get(ownDb)
  if (hit && (hit.version === version || now - hit.builtAt < MIN_REBUILD_MS)) return hit.scores
  countWork('sql:front-scores')
  const rows = ownDb
    .prepare(`SELECT StemCID, FrontScore FROM StemAutoCategory WHERE FrontScore IS NOT NULL`)
    .all() as { StemCID: string; FrontScore: number }[]
  const scores: FrontScores = {
    byStemCID: new Map(rows.map((r) => [r.StemCID, r.FrontScore])),
    table: buildQuantileTable(rows.map((r) => r.FrontScore))
  }
  cache.set(ownDb, { version, builtAt: now, scores })
  return scores
}
```

  (Check `getStemClassificationVersion`'s return type; compare as it returns.)

- [ ] **Step 4: Attach the dial.** In `discoverCandidates.ts`, export:

```ts
/** The front/back dial on every candidate, for sets that rank by it (rankKindsOf). */
export function attachDiscoverDial(
  ownDb: Database.Database,
  pool: DiscoverCandidate[],
  kinds: readonly DiscoverSlotKind[]
): DiscoverCandidate[] {
  if (pool.length === 0 || !kinds.some(isDialKind)) return pool
  const { byStemCID, table } = getFrontScores(ownDb)
  return pool.map((c) =>
    withDial(c, dialFor({ kindSources: c.kindSources, frontScore: byStemCID.get(c.stemCID), table }))
  )
}
```

  Call it last in `getDiscoverCandidatesPool`'s mask branch (after `attachTraitPercentiles`, which
  replaces `traitPercentiles` wholesale), with `normalized`. In `discoverAdjacency.ts`, where the
  near pool gets `attachDiscoverTraits(…)` for its trait kinds, also call `attachDiscoverDial`
  with the slot's kinds. Its candidates may carry no `kindSources`: a labelled stem has no
  FrontScore, so it reads as no dial there; note it with
  `// shortcut: labelled stems carry no dial in the dig pool; pass their confirmed category if that ever matters`.
- [ ] **Step 5: Test** in `discoverCandidates.test.ts`: for `kinds: ['front']`, two guessed stems
  with FrontScore 0.2 and 0.8 come back with `traitPercentiles.front` low and high respectively,
  and `back` as the complement; a stem confirmed `lead` has `front === 1`.
- [ ] **Step 6: Run** the dial, cache, candidates and adjacency tests. Commit
  `feat(categories): discover ranks front and back by the dial`

## Task 16: Tidy Up and auto-arrange read the stored guess

**Files:**
- Modify: `src/main/stemCategoriesStore.ts`, `src/main/index.ts`, `src/preload/index.ts`, `ClusterStemsBrowser.tsx`, `AutoArrangeRoleStep.tsx`
- Test: `src/main/stemCategoriesStore.test.ts`

- [ ] **Step 1: Failing test:** `getStemCategoryGuessesForPaths(db, [pathA, pathB])` returns
  `{ [pathA]: { arrangeRole: 'backing', frontScore: 0.3 } }` for a stem with a model row, and
  nothing for a path whose stem has no `StemAutoCategory` row.
- [ ] **Step 2: Implement** beside `getStemCategoryRolesForPaths`, reusing its path → StemCID
  resolution and chunking (extract the shared part into a small local helper rather than copying
  it):

```ts
export interface StemGuessLookup {
  arrangeRole: ArrangeRole
  frontScore: number | null
}

export function getStemCategoryGuessesForPaths(
  db: Database.Database,
  paths: string[],
  extraCandidateDbs: Database.Database[] = []
): Record<string, StemGuessLookup>
// SELECT StemCID, ArrangeRole, FrontScore FROM StemAutoCategory WHERE StemCID IN (...)
```

  IPC `get-stem-category-guesses` in `index.ts` next to `get-stem-category-roles`, preload
  `getStemCategoryGuesses(paths)` next to `getStemCategoryRoles`.
- [ ] **Step 3: Tidy Up** (`ClusterStemsBrowser.tsx`), sketch population: replace the
  embedding/centroid suggestion (`suggestCategoryFromEmbedding(...) ?? suggestCategory(...)`) with
  the stored guess's `ARRANGE_ROLE_TO_BUS[arrangeRole]`, falling back to the preset-name guess as
  today. Fetch the guesses once per page of stems, the way it fetches the snapshots now; remove
  the `getCategoryCentroids` and `getConfirmedEmbeddings` fetches.
- [ ] **Step 4: Auto-arrange role step** (`AutoArrangeRoleStep.tsx`): replace
  `refineRoleWithEmbeddingOrCentroidSuggestion(...)` with: if there is no confirmed role and no
  busOf, use the stored guess's `arrangeRole` (marking `uncertain: false`); confirmed roles still
  override (`useConfirmedStemRoles`). Remove the centroid/embedding fetches.
- [ ] **Step 5: Gates.** typecheck, lint, the store test. Commit
  `feat(categories): tidy up and auto-arrange suggest from the stored guess`
- [ ] **Step 6: Phase gate:** `npm run typecheck && npm run lint && npm test`.

---

# Phase 4: removal, docs

## Task 17: Delete the old guessers

- [ ] **Step 1: Rewire the label writers first.** `categoryCentroidTraining.ts`'s
  `recordStemCategoryBus`/`recordStemCategoryRole` wrap the plain upserts and then retrain. Point
  every caller at `upsertStemCategoryBus`/`upsertStemCategoryRole` directly: IPC
  `upsert-stem-category-bus` and `upsert-stem-category-role` (`index.ts`),
  `stemCategoriesBackfill.ts` (drop its `waiting` bookkeeping, which exists only for training:
  a project is complete when nothing is `unresolved`), `instrumentMaskCentroidBackfill.ts`, and
  the call near `index.ts`'s startup backfills. Keep `noteAutoClassifyTrainingChanged()` calls
  out: the model doesn't train on device.
- [ ] **Step 2: Delete**, then fix what the typecheck flags (each should be an import of
  something only these files used):
  - `src/shared/categoryCentroids.ts`, `src/main/categoryCentroidStore.ts`,
    `src/main/categoryCentroidTraining.ts`, `src/shared/roleCentroidRefinement.ts`,
    `src/shared/roleEmbeddingRefinement.ts`, `src/shared/embeddingMatch.ts`,
    `src/main/embeddingMatch.ts`, `src/shared/audiosetClasses.ts`,
    `src/main/resolveStemArrangeRole.ts`, and each one's `.test.ts`.
  - IPC and preload: `get-category-centroids`, `get-confirmed-embeddings`,
    `resolve-stem-arrange-roles`, `set-yamnet-zeroshot-category`, `mark-yamnet-zeroshot-attempted`.
  - The "centroid store unreadable" startup dialog in `index.ts` and
    `setCentroidStoreUnreadableListener`.
  - Zero-shot: `applyYamnetZeroShotCategory`, `markYamnetZeroShotAttempted`
    (`stemAutoCategoryStore.ts`); the renderer's calls in `audio/stemEmbeddingCache.ts`; the
    `zeroShotAttempted`/`zeroShotClassIndex` fields of `StemAnalysisWrite`
    (`shared/stemAnalysisWrite.ts`, `main/stemAnalysisResultsWriter.ts`); the `zeroShot` need
    (`shared/stemAnalysisNeeds.ts`, `main/stemAnalysisNeeds.ts`: `zeroShotPendingStemCIDs`,
    `allZeroShotPendingStemCIDs`, the part of `stemCIDsNeedingRework` that is about zero-shot).
    Leave the `StemYamnetZeroShotAttempted` table's DDL in place (old dbs have it; nothing reads it).
    If the YAMNet worker computes the AudioSet class only for zero-shot, stop computing it; the
    embedding stays.
  - `getAutoCategorizedStemCIDs` and `getStemCategory` (tests-only callers).
- [ ] **Step 3: Check nothing is left:**

```bash
grep -rn "categoryCentroid\|CategoryCentroid\|embeddingMatch\|EmbeddingSuggester\|audiosetClasses\|ZeroShot\|zeroShot\|resolveStemArrangeRole\|busCentroids" src
```

  Expected: no hits except the kept DDL line and comments in old specs (none under `src`).
- [ ] **Step 4: Gates:** `npm run typecheck && npm run lint && npm test`. The test count drops by
  the deleted files' tests; nothing else should fail.
- [ ] **Step 5: Commit** `refactor(categories): remove the centroid, nearest-neighbour and zero-shot guessers`

## Task 18: Docs and the final check

- [ ] **Step 1: `CLAUDE.md`**: add a short section "Four categories" after "Metronome": stored
  roles/buses are unchanged and shown as four through `src/shared/stemCategory.ts`; Discover's
  mask kinds are the four, back/front rank by the dial (`stemCategoryDial.ts`,
  `frontScoreCache.ts`), `'lead'` from saved state goes through `parseSlotKind`; the one model
  (`stemCategoryModel.ts` + `.json`) is trained offline by `scripts/train-stem-category-model.mts`
  from a COPY of a library db, refuses weights below `FLOOR`, and a retrain changes `version`,
  which re-guesses every stem not placed by a label or the mask; the web radio imports
  `src/shared`, so renaming a shared export breaks its build.
- [ ] **Step 2: Spec status line** → "Status: built 2026-11-xx on `four-categories`, awaiting
  Elling's walkthrough."
- [ ] **Step 3: Final gates** and a review: `npm run typecheck && npm run lint && npm test`; then
  `superpowers:requesting-code-review` over `master..four-categories`.
- [ ] **Step 4: Commit** `docs(categories): handoff notes`. Don't merge or push: Elling walks it
  through first (spec's walkthrough list), and the web radio branch waits for his deploy call.
