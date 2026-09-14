# Library-Wide Discover — Accuracy Classifiers (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve sssketch's weak auto-classification (`resolveStemRole`) by extending two pieces of already-existing infrastructure rather than building new ones: `presetNames.ts`'s keyword table gets an `ArrangeRole`/`DrumSubRole`-keyed lookup alongside its existing `SoundType`-keyed one, and `busCentroids.ts`'s nearest-centroid classifier — already live in Tidy Up for `BusId` — generalizes into a multi-axis classifier covering `ArrangeRole`/`DrumSubRole` too, trained centrally from every `StemCategories` write (not just Tidy Up's own).

**Architecture:** This is Plan B1 of the "Library-Wide Discover" feature's three total plans (Plan A: Foundation, already complete on this branch; Plan B2: YAMNet ML embeddings, sequenced after this plan per the design spec's own explicit ordering; Plan C: the discover screen itself, not yet written). A key structural change this plan makes: centroid training moves from client-side (Tidy Up's own `ClusterStemsBrowser.tsx`, which trains and saves after every confirm) to server-side (the main-process IPC handlers behind `upsertStemCategoryBus`/`upsertStemCategoryRole`, which now train automatically as a side effect of any write, reading each stem's already-persisted `StemFeatureCache` row rather than needing a fresh Web Audio decode). This is what makes "every `StemCategories` write trains the classifier, not just Tidy Up's" possible without threading feature vectors through every forward-capture call site by hand.

**Tech Stack:** No new external dependencies — this plan extends existing TypeScript modules (`src/shared/`, `src/main/`) and existing SQLite/JSON persistence patterns already established by Plan A.

---

## Important context for every task below

**Priority order for `resolveStemRole`'s guessing, after this plan:** `busId` (human-confirmed via Tidy Up) → centroid classifier suggestion (if confident) → `PresetName` keyword match → raw `SoundType` fallback. The centroid classifier ranks ABOVE the `PresetName` keyword table because it's a real, growing, audio-content-grounded signal that improves as the library gets used, versus a static ~250-name table that only covers Endlesss's own built-in packs. Both new signals only ever apply when `busId` is `null` (untidied) — a human confirmation in Tidy Up always wins outright, unchanged from today.

**`Stem.name` already holds the preset name — no new plumbing needed.** Confirmed by reading `src/renderer/src/audio/importResolvedRiff.ts:42-53`: every stem imported via the library/LORE/Endlesss-direct path (the one shared import function all three browsers use) sets `name: s.presetName` at import time, and already calls `guessSoundTypeFromPresetName(s.presetName)` as part of resolving `SoundType`. `resolveStemRole` (`src/shared/stemRole.ts`) takes the already-built `Stem` object, so `stem.name` is exactly the right, already-available field to check the new `ArrangeRole`/`DrumSubRole` lookup against — no new field, no new async round-trip. A drag-and-drop local file or one-shot sample has `stem.name` set to something else (a filename or user-given name) and simply won't match any known preset name, the same as today's `SoundType`-keyed lookup already behaves for those.

**The new `ArrangeRole`/`DrumSubRole`-keyed table reuses the SAME ~250 preset-name strings, not a new/expanded list.** Per the design spec's own wording ("same ~250-name table"), this plan does not add new preset names — inventing plausible-sounding drum/bass preset names without verified sourcing would risk real misclassification (a fabricated "Kick" preset name that doesn't actually exist in any real pack would just never match, which is harmless, but a fabricated name that collides with something unrelated would actively misclassify). Since the existing three arrays (`FX_PRESET_NAMES`, `NOTES_PRESET_NAMES`, `AUDIO_IN_PRESET_NAMES`) cover `fx`/`notes`/`audioIn` only — none of which are drums or bass presets — the new `ArrangeRole`-keyed lookup built from them will have real entries for `textureFx`/`lead`/`vocal` but literally zero entries that ever resolve to a `DrumSubRole`. The lookup function still returns an optional `drumSubRole`, correctly future-proofed for whenever the preset-name corpus is later expanded with real, sourced data — but this plan doesn't populate that case, and says so plainly rather than pretending otherwise.

**No circular import.** `categoryCentroids.ts` (the generalized centroid classifier) needs `ArrangeRole`/`DrumSubRole` types from `stemRole.ts`. If `stemRole.ts` in turn imported from `categoryCentroids.ts` to apply a centroid suggestion, that would be a real import cycle. This plan avoids it by putting the "apply a centroid suggestion on top of an already-resolved role" logic in its own new file (`src/shared/roleCentroidRefinement.ts`), which imports from BOTH `stemRole.ts` and `categoryCentroids.ts` — neither of which imports from it or from each other in that direction.

**Backward compatibility for the renamed centroid store's persisted file.** Real users already have a `busCentroids.json` file on disk (shaped `{buses, global}`) from before this plan. The generalized store's shape is a super-set (`{buses, arrangeRoles, drumSubRoles, global}`) — loading an old file must default the two new keys to `{}` rather than crash or silently drop the user's own already-trained bus data. The JSON **filename** stays `busCentroids.json` unchanged (only the TypeScript module/function names are renamed) specifically so existing installs keep working with zero migration needed.

**Trainable-category exclusions mirror `BusId`'s own existing `'aux'` exclusion, for the same reason.** `busCentroids.ts` already excludes `'aux'` from `TRAINABLE_BUS_IDS` with the reasoning "no real sound category with a coherent acoustic signature of its own... would blur its centroid across everything nobody could place anywhere else." Applying that same reasoning: `ArrangeRole`'s own `'aux'` value is excluded from `TRAINABLE_ARRANGE_ROLES` for the identical reason (it's `ArrangeRole`'s own catch-all, same as `BusId`'s). `DrumSubRole`'s `'perc'` value ("perc/other" — its own doc comment already flags it as a catch-all) is excluded from `TRAINABLE_DRUM_SUB_ROLES` for the same reason. Every other value in both taxonomies has a real, distinctive acoustic character worth training a centroid for.

---

### Task 1: Extend `presetNames.ts` with an `ArrangeRole`/`DrumSubRole`-keyed lookup

**Files:**
- Modify: `src/shared/presetNames.ts`
- Modify: `src/shared/presetNames.test.ts`

- [ ] **Step 1: Write the failing tests**

Read `src/shared/presetNames.test.ts` fresh first to see its current exact test style, then add these test cases to it (adjust import/describe placement to match the file's own existing conventions):

```ts
describe('guessArrangeRoleFromPresetName', () => {
  it('maps a known FX preset name to textureFx', () => {
    expect(guessArrangeRoleFromPresetName('Keymasher')).toEqual({ arrangeRole: 'textureFx' })
  })

  it('maps a known Notes preset name to lead', () => {
    expect(guessArrangeRoleFromPresetName('Eardrop')).toEqual({ arrangeRole: 'lead' })
  })

  it('maps the literal "Microphone" preset name to vocal', () => {
    expect(guessArrangeRoleFromPresetName('Microphone')).toEqual({ arrangeRole: 'vocal' })
  })

  it('is case-insensitive and trims whitespace, matching guessSoundTypeFromPresetName', () => {
    expect(guessArrangeRoleFromPresetName('  keymasher  ')).toEqual({ arrangeRole: 'textureFx' })
  })

  it('returns null for an unrecognized name', () => {
    expect(guessArrangeRoleFromPresetName('My Custom Take 3')).toBeNull()
  })

  it('never returns a drumSubRole today -- the reused preset-name corpus has no drum entries', () => {
    const result = guessArrangeRoleFromPresetName('Keymasher')
    expect(result?.drumSubRole).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/shared/presetNames.test.ts`
Expected: FAIL — `guessArrangeRoleFromPresetName is not defined`.

- [ ] **Step 3: Implement the new lookup in `presetNames.ts`**

Read `src/shared/presetNames.ts` fresh first to confirm the current exact structure (it should have `FX_PRESET_NAMES`, `NOTES_PRESET_NAMES`, `AUDIO_IN_PRESET_NAMES` arrays, `buildLookup`, `PRESET_NAME_TO_TYPE`, and `guessSoundTypeFromPresetName`). Add this near the bottom of the file, after the existing `guessSoundTypeFromPresetName` export:

```ts
import type { ArrangeRole, DrumSubRole } from './stemRole'

/** A guessed ArrangeRole (and, when the matched preset name happens to
 * imply one, a DrumSubRole) for a stem's PresetName -- the ArrangeRole/
 * DrumSubRole-keyed counterpart to guessSoundTypeFromPresetName above,
 * reusing the exact same ~250-name corpus (not a new or expanded list --
 * see this plan's own "Important context" for why) mapped onto
 * ArrangeRole's own taxonomy instead of SoundType's. drumSubRole is
 * always undefined today: none of FX_PRESET_NAMES/NOTES_PRESET_NAMES/
 * AUDIO_IN_PRESET_NAMES are drum presets, so there's nothing in the
 * current corpus that could ever populate it -- the field exists so a
 * future, separately-sourced expansion of real drum preset names doesn't
 * need a second lookup function or a breaking signature change. */
export interface ArrangeRoleGuess {
  arrangeRole: ArrangeRole
  drumSubRole?: DrumSubRole
}

function buildArrangeRoleLookup(
  names: string[],
  guess: ArrangeRoleGuess
): [string, ArrangeRoleGuess][] {
  return names.map((name) => [name.toLowerCase(), guess])
}

// Mirrors SOUND_TYPE_TO_ARRANGE_ROLE's own fx->textureFx/notes->lead/
// audioIn->vocal mapping (stemRole.ts) -- the same three SoundType
// buckets these preset names already resolve to, just expressed directly
// in ArrangeRole terms instead of routing through SoundType first.
const PRESET_NAME_TO_ARRANGE_ROLE = new Map<string, ArrangeRoleGuess>([
  ...buildArrangeRoleLookup(FX_PRESET_NAMES, { arrangeRole: 'textureFx' }),
  ...buildArrangeRoleLookup(NOTES_PRESET_NAMES, { arrangeRole: 'lead' }),
  ...buildArrangeRoleLookup(AUDIO_IN_PRESET_NAMES, { arrangeRole: 'vocal' })
])

/** Exact, case-insensitive lookup of a stem's preset/source name against
 * the ArrangeRole/DrumSubRole-keyed table above. Returns null (no
 * confident mapping) for anything not in the table -- the same
 * "unrecognized name" case guessSoundTypeFromPresetName already has. */
export function guessArrangeRoleFromPresetName(name: string): ArrangeRoleGuess | null {
  return PRESET_NAME_TO_ARRANGE_ROLE.get(name.trim().toLowerCase()) ?? null
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/shared/presetNames.test.ts`
Expected: PASS (all tests, existing + new).

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/shared/presetNames.ts src/shared/presetNames.test.ts
git commit -m "$(cat <<'EOF'
Add guessArrangeRoleFromPresetName, reusing the existing preset-name table

Extends presetNames.ts's own ~250-name corpus (not a new/expanded list)
with an ArrangeRole/DrumSubRole-keyed lookup alongside its existing
SoundType-keyed one -- same exact-match/case-insensitive convention.
drumSubRole is always undefined today since none of the reused names are
drum presets; the field is there for a future, separately-sourced
expansion. Not wired into resolveStemRole yet -- that's the next task.
EOF
)"
```

---

### Task 2: Wire the `PresetName` lookup into `resolveStemRole`

**Files:**
- Modify: `src/shared/stemRole.ts`
- Modify: `src/shared/stemRole.test.ts` (create if it doesn't exist yet — check first)

- [ ] **Step 1: Check whether `src/shared/stemRole.test.ts` already exists**

Run: `ls src/shared/stemRole.test.ts 2>&1`. If it exists, read it fresh to match its existing style. If it doesn't, you're creating it fresh in Step 2 below.

- [ ] **Step 2: Write the failing tests**

Add (or create the file with) these test cases:

```ts
import { describe, expect, it } from 'vitest'
import { resolveStemRole } from './stemRole'
import type { Stem } from './types'

function fakeStem(overrides: Partial<Stem> = {}): Stem {
  return {
    slot: 1,
    author: 'someone',
    name: 'untitled',
    type: 'fx',
    path: '/lib/some-stem',
    durationSec: 4,
    barLength: 4,
    ...overrides
  }
}

describe('resolveStemRole', () => {
  it('a confirmed busId always wins, even when the preset name would also match', () => {
    const stem = fakeStem({ name: 'Keymasher', type: 'fx' })
    const role = resolveStemRole(stem, 'k', 'drums')
    expect(role.arrangeRole).toBe('drums')
  })

  it('falls back to a PresetName match when there is no busId', () => {
    const stem = fakeStem({ name: 'Keymasher', type: 'fx' })
    const role = resolveStemRole(stem, 'k', null)
    expect(role.arrangeRole).toBe('textureFx')
  })

  it('falls back to the raw SoundType mapping when neither busId nor PresetName match', () => {
    const stem = fakeStem({ name: 'My Custom Take', type: 'notes' })
    const role = resolveStemRole(stem, 'k', null)
    expect(role.arrangeRole).toBe('lead')
  })

  it('a stem is no longer "uncertain" once a PresetName match is found, even with SoundType still fx', () => {
    const stem = fakeStem({ name: 'Keymasher', type: 'fx' })
    const role = resolveStemRole(stem, 'k', null)
    expect(role.uncertain).toBe(false)
  })

  it('stays "uncertain" when SoundType is still fx and neither busId nor PresetName resolve it', () => {
    const stem = fakeStem({ name: 'My Custom Take', type: 'fx' })
    const role = resolveStemRole(stem, 'k', null)
    expect(role.uncertain).toBe(true)
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/shared/stemRole.test.ts`
Expected: the PresetName-related tests FAIL (arrangeRole still resolves via the old SoundType-only fallback). The busId-wins test should already PASS (unchanged behavior).

- [ ] **Step 4: Wire the lookup into `resolveStemRole`**

Read `src/shared/stemRole.ts` fresh first. Change:

```ts
import type { BusId, SoundType, Stem } from './types'
```

to:

```ts
import type { BusId, SoundType, Stem } from './types'
import { guessArrangeRoleFromPresetName } from './presetNames'
```

Change:

```ts
export function resolveStemRole(stem: Stem, stemKey: string, busId: BusId | null): StemRoleInfo {
  const uncertain = stem.type === 'fx' && busId === null
  const arrangeRole =
    busId !== null ? BUS_ID_TO_ARRANGE_ROLE[busId] : SOUND_TYPE_TO_ARRANGE_ROLE[stem.type]
  return {
    stemKey,
    soundType: stem.type,
    busId,
    arrangeRole,
    uncertain,
    included: true,
    frequency: 'occasional'
  }
}
```

to:

```ts
export function resolveStemRole(stem: Stem, stemKey: string, busId: BusId | null): StemRoleInfo {
  // Checked only when there's no confirmed busId -- a human confirmation
  // in Tidy Up always wins outright, unchanged from before this lookup
  // existed. See presetNames.ts's own doc comment on ArrangeRoleGuess for
  // why drumSubRole is always undefined with today's preset-name corpus.
  const presetGuess = busId === null ? guessArrangeRoleFromPresetName(stem.name) : null
  const uncertain = stem.type === 'fx' && busId === null && presetGuess === null
  const arrangeRole =
    busId !== null
      ? BUS_ID_TO_ARRANGE_ROLE[busId]
      : (presetGuess?.arrangeRole ?? SOUND_TYPE_TO_ARRANGE_ROLE[stem.type])
  return {
    stemKey,
    soundType: stem.type,
    busId,
    arrangeRole,
    drumSubRole: busId === null ? presetGuess?.drumSubRole : undefined,
    uncertain,
    included: true,
    frequency: 'occasional'
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/shared/stemRole.test.ts`
Expected: PASS (all tests).

- [ ] **Step 6: Run typecheck, lint, and the full test suite**

Run: `npm run typecheck && npm run lint && npm test`
Expected: no errors, no regressions (this changes `resolveStemRole`'s own output for a real subset of stems, so double-check nothing downstream hardcoded an expectation about the old fallback-only behavior).

- [ ] **Step 7: Commit**

```bash
git add src/shared/stemRole.ts src/shared/stemRole.test.ts
git commit -m "$(cat <<'EOF'
Wire PresetName keyword matching into resolveStemRole

busId (confirmed) -> PresetName match -> raw SoundType fallback, in that
priority order -- a PresetName match also clears the "uncertain" flag,
since a recognized preset name is a real signal even when SoundType is
still stuck on its unresolved 'fx' default. Design spec §6's first of two
Phase 1 additions; the centroid classifier (next several tasks) becomes
the signal ranked ABOVE PresetName matching, not below it -- see this
plan's own "Important context" for why.
EOF
)"
```

---

### Task 3: Generalize `busCentroids.ts` into `categoryCentroids.ts`

**Files:**
- Create: `src/shared/categoryCentroids.ts`
- Create: `src/shared/categoryCentroids.test.ts`
- Delete: `src/shared/busCentroids.ts`
- Delete: `src/shared/busCentroids.test.ts`

**Before you start:** read `src/shared/busCentroids.ts` and `src/shared/busCentroids.test.ts` fresh in full — you are generalizing this exact file, not writing something new from scratch. Every existing test case below has a direct analog to one already in `busCentroids.test.ts`; keep the SAME assertions/reasoning, just retargeted at the generic axis-based API.

- [ ] **Step 1: Write the failing tests**

Create `src/shared/categoryCentroids.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { emptyCategoryCentroidStore, recordConfirmedCategory, suggestCategory } from './categoryCentroids'

const DIM = 19
function vec(fillValue: number): number[] {
  return new Array(DIM).fill(fillValue)
}

describe('emptyCategoryCentroidStore', () => {
  it('starts with no trained categories on any axis and zeroed global stats', () => {
    const store = emptyCategoryCentroidStore()
    expect(store.buses).toEqual({})
    expect(store.arrangeRoles).toEqual({})
    expect(store.drumSubRoles).toEqual({})
    expect(store.global.count).toBe(0)
    expect(store.global.mean).toEqual(vec(0))
  })
})

describe('recordConfirmedCategory', () => {
  it('is a no-op for a non-trainable category on the bus axis (aux) -- store reference unchanged', () => {
    const store = emptyCategoryCentroidStore()
    const result = recordConfirmedCategory(store, 'bus', 'aux', vec(5))
    expect(result).toBe(store)
  })

  it('is a no-op for a non-trainable category on the arrangeRole axis (aux)', () => {
    const store = emptyCategoryCentroidStore()
    const result = recordConfirmedCategory(store, 'arrangeRole', 'aux', vec(5))
    expect(result).toBe(store)
  })

  it('is a no-op for a non-trainable category on the drumSubRole axis (perc)', () => {
    const store = emptyCategoryCentroidStore()
    const result = recordConfirmedCategory(store, 'drumSubRole', 'perc', vec(5))
    expect(result).toBe(store)
  })

  it('tracks a running mean per category across multiple confirms, on the bus axis', () => {
    let store = emptyCategoryCentroidStore()
    store = recordConfirmedCategory(store, 'bus', 'drums', vec(0))
    store = recordConfirmedCategory(store, 'bus', 'drums', vec(10))
    expect(store.buses.drums?.count).toBe(2)
    expect(store.buses.drums?.mean).toEqual(vec(5))
  })

  it('tracks a running mean per category on the arrangeRole axis, independently of the bus axis', () => {
    let store = emptyCategoryCentroidStore()
    store = recordConfirmedCategory(store, 'bus', 'drums', vec(0))
    store = recordConfirmedCategory(store, 'arrangeRole', 'vocal', vec(10))
    expect(store.buses.drums?.mean).toEqual(vec(0))
    expect(store.arrangeRoles.vocal?.mean).toEqual(vec(10))
    expect(store.buses.vocal).toBeUndefined()
    expect(store.arrangeRoles.drums).toBeUndefined()
  })

  it('tracks a running mean per category on the drumSubRole axis', () => {
    let store = emptyCategoryCentroidStore()
    store = recordConfirmedCategory(store, 'drumSubRole', 'kick', vec(0))
    store = recordConfirmedCategory(store, 'drumSubRole', 'kick', vec(10))
    expect(store.drumSubRoles.kick?.count).toBe(2)
    expect(store.drumSubRoles.kick?.mean).toEqual(vec(5))
  })

  it('updates ONE shared global stats structure regardless of which axis/category the stem went to', () => {
    let store = emptyCategoryCentroidStore()
    store = recordConfirmedCategory(store, 'bus', 'drums', vec(0))
    store = recordConfirmedCategory(store, 'arrangeRole', 'vocal', vec(10))
    store = recordConfirmedCategory(store, 'drumSubRole', 'kick', vec(20))
    expect(store.global.count).toBe(3)
    expect(store.global.mean).toEqual(vec(10))
  })
})

describe('suggestCategory', () => {
  it('returns null when no category on that axis has enough trained samples yet', () => {
    let store = emptyCategoryCentroidStore()
    store = recordConfirmedCategory(store, 'bus', 'drums', vec(0))
    store = recordConfirmedCategory(store, 'bus', 'drums', vec(1))
    expect(suggestCategory(store, 'bus', vec(0))).toBeNull()
  })

  it('suggests the nearest trained category once it has enough samples, with only one trained', () => {
    let store = emptyCategoryCentroidStore()
    for (let i = 0; i < 5; i++) store = recordConfirmedCategory(store, 'bus', 'drums', vec(0))
    expect(suggestCategory(store, 'bus', vec(1))).toBe('drums')
  })

  it('picks the closer of two well-separated trained categories on the arrangeRole axis', () => {
    let store = emptyCategoryCentroidStore()
    for (let i = 0; i < 5; i++) store = recordConfirmedCategory(store, 'arrangeRole', 'drums', vec(0))
    for (let i = 0; i < 5; i++) store = recordConfirmedCategory(store, 'arrangeRole', 'vocal', vec(20))
    expect(suggestCategory(store, 'arrangeRole', vec(1))).toBe('drums')
    expect(suggestCategory(store, 'arrangeRole', vec(19))).toBe('vocal')
  })

  it('returns null (declines to guess) for a query roughly equidistant between two trained categories', () => {
    let store = emptyCategoryCentroidStore()
    for (let i = 0; i < 5; i++) store = recordConfirmedCategory(store, 'bus', 'drums', vec(0))
    for (let i = 0; i < 5; i++) store = recordConfirmedCategory(store, 'bus', 'bass', vec(20))
    expect(suggestCategory(store, 'bus', vec(10))).toBeNull()
  })

  it('a category with a variance of zero across every trained sample does not blow up standardization', () => {
    let store = emptyCategoryCentroidStore()
    for (let i = 0; i < 5; i++) store = recordConfirmedCategory(store, 'drumSubRole', 'kick', vec(3))
    expect(() => suggestCategory(store, 'drumSubRole', vec(3))).not.toThrow()
    expect(suggestCategory(store, 'drumSubRole', vec(3))).toBe('kick')
  })

  it('querying one axis never returns a category trained only on a different axis', () => {
    let store = emptyCategoryCentroidStore()
    for (let i = 0; i < 5; i++) store = recordConfirmedCategory(store, 'bus', 'drums', vec(0))
    expect(suggestCategory(store, 'arrangeRole', vec(0))).toBeNull()
    expect(suggestCategory(store, 'drumSubRole', vec(0))).toBeNull()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/shared/categoryCentroids.test.ts`
Expected: FAIL — `Cannot find module './categoryCentroids'`.

- [ ] **Step 3: Implement `src/shared/categoryCentroids.ts`**

```ts
// src/shared/categoryCentroids.ts
import type { BusId } from './types'
import type { ArrangeRole, DrumSubRole } from './stemRole'

// Matches toFeatureArray's own fixed layout (stemFeatures.ts) -- every raw
// vector this module ever receives is expected to already be in that order.
const FEATURE_DIM = 19

/** Which classification signal a confirmed stem is being trained/queried
 * against. Three independent axes, one shared feature-space/global-stats
 * population (see GlobalStats' own doc comment below for why sharing is
 * correct here). */
export type CategoryAxis = 'bus' | 'arrangeRole' | 'drumSubRole'

// 'aux' (bus and arrangeRole) and 'perc' (drumSubRole) are each their own
// axis's "no confident answer" catch-all -- training on them would blur
// their centroid across everything nobody could place anywhere else,
// exactly the wrong direction for a useful classifier. Mirrors
// TRAINABLE_BUS_IDS' own original reasoning (this module's own predecessor,
// busCentroids.ts), now applied consistently to the other two axes too.
const TRAINABLE_BUS_IDS: BusId[] = ['drums', 'bass', 'lead', 'backing']
const TRAINABLE_ARRANGE_ROLES: ArrangeRole[] = [
  'drums',
  'bass',
  'lead',
  'backing',
  'textureFx',
  'fill',
  'vocal'
]
const TRAINABLE_DRUM_SUB_ROLES: DrumSubRole[] = ['kick', 'snare', 'hihat', 'clap']

function trainableCategoriesFor(axis: CategoryAxis): string[] {
  switch (axis) {
    case 'bus':
      return TRAINABLE_BUS_IDS
    case 'arrangeRole':
      return TRAINABLE_ARRANGE_ROLES
    case 'drumSubRole':
      return TRAINABLE_DRUM_SUB_ROLES
  }
}

type StoreKey = 'buses' | 'arrangeRoles' | 'drumSubRoles'

function storeKeyFor(axis: CategoryAxis): StoreKey {
  switch (axis) {
    case 'bus':
      return 'buses'
    case 'arrangeRole':
      return 'arrangeRoles'
    case 'drumSubRole':
      return 'drumSubRoles'
  }
}

interface Centroid {
  /** Running mean of every RAW (unstandardized) feature vector confirmed
   * into this category so far -- kept in raw space specifically so it
   * never goes stale as `global` below evolves. */
  mean: number[]
  count: number
}

/** ONE shared global stats structure across all three axes, not three
 * separate ones -- global stats describe "what does a typical confirmed
 * stem in this library look like, dimension by dimension," a property of
 * the stem population itself, not of any one classification axis. Sharing
 * means every confirmed stem (whichever axis it was confirmed on)
 * contributes to a single, faster-converging population estimate, rather
 * than needing 3x the samples to get each axis's own estimate up to a
 * useful size. */
export interface GlobalStats {
  mean: number[]
  m2: number[]
  count: number
}

/**
 * Cross-project, incrementally-trained, multi-axis classifier state --
 * generalizes busCentroids.ts's own BusId-only architecture (already live
 * in Tidy Up) to also cover ArrangeRole and DrumSubRole, so the same
 * running-centroid-plus-global-Welford-stats mechanism serves every axis
 * `resolveStemRole` needs a stronger-than-keyword-table signal for.
 */
export interface CategoryCentroidStore {
  buses: Partial<Record<BusId, Centroid>>
  arrangeRoles: Partial<Record<ArrangeRole, Centroid>>
  drumSubRoles: Partial<Record<DrumSubRole, Centroid>>
  global: GlobalStats
}

export function emptyCategoryCentroidStore(): CategoryCentroidStore {
  return {
    buses: {},
    arrangeRoles: {},
    drumSubRoles: {},
    global: { mean: new Array(FEATURE_DIM).fill(0), m2: new Array(FEATURE_DIM).fill(0), count: 0 }
  }
}

function updateWelford(stats: GlobalStats, vector: number[]): GlobalStats {
  const count = stats.count + 1
  const mean = stats.mean.slice()
  const m2 = stats.m2.slice()
  for (let d = 0; d < FEATURE_DIM; d++) {
    const delta = vector[d] - mean[d]
    mean[d] += delta / count
    const delta2 = vector[d] - mean[d]
    m2[d] += delta * delta2
  }
  return { mean, m2, count }
}

function updateRunningMean(centroid: Centroid | undefined, vector: number[]): Centroid {
  if (!centroid) return { mean: vector.slice(), count: 1 }
  const count = centroid.count + 1
  const mean = centroid.mean.map((m, d) => m + (vector[d] - m) / count)
  return { mean, count }
}

/**
 * Folds one more confirmed (stem -> category) assignment into the store,
 * on the given axis -- updates that category's own running centroid AND
 * the shared global stats, both incrementally. A no-op for a non-trainable
 * category on that axis (returns the SAME store reference unchanged, not
 * a copy) -- see the module-level TRAINABLE_* lists above.
 */
export function recordConfirmedCategory(
  store: CategoryCentroidStore,
  axis: CategoryAxis,
  category: string,
  rawFeatureVector: number[]
): CategoryCentroidStore {
  if (!trainableCategoriesFor(axis).includes(category)) return store
  const key = storeKeyFor(axis)
  return {
    ...store,
    [key]: {
      ...store[key],
      [category]: updateRunningMean(
        (store[key] as Record<string, Centroid | undefined>)[category],
        rawFeatureVector
      )
    },
    global: updateWelford(store.global, rawFeatureVector)
  }
}

// A category needs at least this many confirmed samples before its
// centroid is trusted enough to suggest from.
const MIN_SAMPLES_PER_CATEGORY = 3

// The nearest category must be at least this much closer than the
// SECOND-nearest (on the SAME axis) to count as a confident suggestion.
const CONFIDENCE_RATIO = 0.7

function standardize(vector: number[], stats: GlobalStats): number[] {
  return vector.map((v, d) => {
    const variance = stats.count > 0 ? stats.m2[d] / stats.count : 0
    const stddev = Math.sqrt(variance)
    return stddev > 1e-10 ? (v - stats.mean[d]) / stddev : 0
  })
}

function euclideanDistance(a: number[], b: number[]): number {
  let sum = 0
  for (let i = 0; i < a.length; i++) sum += (a[i] - b[i]) ** 2
  return Math.sqrt(sum)
}

/**
 * Nearest-centroid classification for one new stem's raw feature vector,
 * on the given axis only -- never returns a category trained on a
 * different axis. Returns null (not a forced guess) when fewer than
 * MIN_SAMPLES_PER_CATEGORY samples back the nearest category on this axis,
 * or when the nearest and second-nearest are too close to call
 * confidently.
 */
export function suggestCategory(
  store: CategoryCentroidStore,
  axis: CategoryAxis,
  rawFeatureVector: number[]
): string | null {
  const key = storeKeyFor(axis)
  const bucket = store[key] as Record<string, Centroid | undefined>
  const trainedCategories = trainableCategoriesFor(axis).filter(
    (c) => (bucket[c]?.count ?? 0) >= MIN_SAMPLES_PER_CATEGORY
  )
  if (trainedCategories.length === 0) return null

  const query = standardize(rawFeatureVector, store.global)
  const distances = trainedCategories
    .map((c) => ({
      category: c,
      distance: euclideanDistance(query, standardize(bucket[c]!.mean, store.global))
    }))
    .sort((a, b) => a.distance - b.distance)

  const [nearest, secondNearest] = distances
  if (secondNearest && nearest.distance > CONFIDENCE_RATIO * secondNearest.distance) return null
  return nearest.category
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/shared/categoryCentroids.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Delete the old `busCentroids.ts` and its test file**

```bash
rm src/shared/busCentroids.ts src/shared/busCentroids.test.ts
```

Do NOT run the full test suite yet — `busCentroidStore.ts`, `busCentroidStore.test.ts`, and `ClusterStemsBrowser.tsx` still import from `./busCentroids`/`@shared/busCentroids` and will fail to resolve until Tasks 4 and 8 update them. This is expected and handled by those later tasks, not a sign of a mistake here.

- [ ] **Step 6: Run typecheck for THIS file only, to confirm `categoryCentroids.ts` itself is sound**

Run: `npx tsc --noEmit -p tsconfig.node.json --composite false 2>&1 | grep -v "busCentroid\|ClusterStemsBrowser"`
Expected: no errors reported for `categoryCentroids.ts` itself (errors about `busCentroidStore.ts`/`ClusterStemsBrowser.tsx` failing to resolve `./busCentroids` are expected and filtered out here — they're fixed in Tasks 4 and 8).

- [ ] **Step 7: Commit**

```bash
git add -A src/shared/categoryCentroids.ts src/shared/categoryCentroids.test.ts src/shared/busCentroids.ts src/shared/busCentroids.test.ts
git commit -m "$(cat <<'EOF'
Generalize busCentroids.ts into categoryCentroids.ts (bus/arrangeRole/drumSubRole)

Same running-centroid-plus-global-Welford-stats mechanism, now
parameterized by axis instead of hardcoded to BusId -- one shared global
stats structure across all three axes (a property of the confirmed-stem
population itself, not any one axis). recordConfirmedCategory/
suggestCategory replace recordConfirmedStem/suggestBus. Trainable-set
exclusions ('aux' on bus/arrangeRole, 'perc' on drumSubRole) mirror the
original file's own BusId 'aux' exclusion reasoning. This commit leaves
busCentroidStore.ts and ClusterStemsBrowser.tsx broken (still importing
the now-deleted module) -- fixed in the next two tasks, not a mistake
here.
EOF
)"
```

---

### Task 4: Generalize `busCentroidStore.ts` into `categoryCentroidStore.ts`

**Files:**
- Create: `src/main/categoryCentroidStore.ts`
- Create: `src/main/categoryCentroidStore.test.ts`
- Delete: `src/main/busCentroidStore.ts`
- Delete: `src/main/busCentroidStore.test.ts`

**Before you start:** read `src/main/busCentroidStore.ts` and `src/main/busCentroidStore.test.ts` fresh in full.

- [ ] **Step 1: Write the failing tests**

Create `src/main/categoryCentroidStore.test.ts`:

```ts
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { emptyCategoryCentroidStore, recordConfirmedCategory } from '@shared/categoryCentroids'

let userDataDir: string

vi.mock('electron', () => ({
  app: {
    getPath: () => userDataDir
  }
}))

describe('categoryCentroidStore', () => {
  beforeEach(() => {
    userDataDir = mkdtempSync(join(tmpdir(), 'sssketch-category-centroid-test-'))
  })

  afterEach(() => {
    rmSync(userDataDir, { recursive: true, force: true })
  })

  it('loadCategoryCentroidStore returns an empty store when no file exists yet', async () => {
    const { loadCategoryCentroidStore } = await import('./categoryCentroidStore')
    expect(loadCategoryCentroidStore()).toEqual(emptyCategoryCentroidStore())
  })

  it('saveCategoryCentroidStore then loadCategoryCentroidStore round-trips', async () => {
    const { loadCategoryCentroidStore, saveCategoryCentroidStore } = await import(
      './categoryCentroidStore'
    )
    let store = emptyCategoryCentroidStore()
    store = recordConfirmedCategory(store, 'bus', 'drums', new Array(19).fill(1))
    store = recordConfirmedCategory(store, 'arrangeRole', 'vocal', new Array(19).fill(2))
    store = recordConfirmedCategory(store, 'drumSubRole', 'kick', new Array(19).fill(3))
    saveCategoryCentroidStore(store)
    expect(loadCategoryCentroidStore()).toEqual(store)
  })

  it('loadCategoryCentroidStore returns an empty store rather than throwing on a corrupt file', async () => {
    writeFileSync(join(userDataDir, 'busCentroids.json'), 'not valid json{{{')
    const { loadCategoryCentroidStore } = await import('./categoryCentroidStore')
    expect(loadCategoryCentroidStore()).toEqual(emptyCategoryCentroidStore())
  })

  it('loads a pre-existing bus-only file (from before arrangeRoles/drumSubRoles existed) with those two axes defaulted to empty', async () => {
    const legacyShape = {
      buses: { drums: { mean: new Array(19).fill(1), count: 3 } },
      global: { mean: new Array(19).fill(1), m2: new Array(19).fill(0), count: 3 }
    }
    writeFileSync(join(userDataDir, 'busCentroids.json'), JSON.stringify(legacyShape))
    const { loadCategoryCentroidStore } = await import('./categoryCentroidStore')
    const loaded = loadCategoryCentroidStore()
    expect(loaded.buses).toEqual(legacyShape.buses)
    expect(loaded.arrangeRoles).toEqual({})
    expect(loaded.drumSubRoles).toEqual({})
    expect(loaded.global).toEqual(legacyShape.global)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/main/categoryCentroidStore.test.ts`
Expected: FAIL — `Cannot find module './categoryCentroidStore'`.

- [ ] **Step 3: Implement `src/main/categoryCentroidStore.ts`**

```ts
// src/main/categoryCentroidStore.ts
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import type { CategoryCentroidStore } from '@shared/categoryCentroids'
import { emptyCategoryCentroidStore } from '@shared/categoryCentroids'

// Filename intentionally UNCHANGED from busCentroidStore.ts's own -- real
// users already have this file on disk, shaped {buses, global}. Renaming
// it would orphan their already-trained bus data on next launch for no
// benefit; only the TypeScript module/function names changed, not the
// persisted artifact's own name.
const STORE_FILENAME = 'busCentroids.json'

function storePath(): string {
  return join(app.getPath('userData'), STORE_FILENAME)
}

/** Mirrors pluginCatalog.ts's own loadCatalog exactly -- an empty store
 * (never a thrown error) both when nothing has ever been confirmed yet and
 * when reading one fails. A pre-existing file from before arrangeRoles/
 * drumSubRoles existed (shaped {buses, global} only) loads correctly, with
 * both new axes defaulted to {} rather than causing a mismatched-shape
 * bug -- real existing users' already-trained bus data stays intact.
 * Deliberately GLOBAL (not per-project), same reasoning as the original
 * busCentroidStore.ts: the whole point of a classifier here is to
 * generalize across every sketch the user tidies/arranges, not start over
 * cold on each new one. */
export function loadCategoryCentroidStore(): CategoryCentroidStore {
  const path = storePath()
  if (!existsSync(path)) return emptyCategoryCentroidStore()
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as Partial<CategoryCentroidStore>
    const empty = emptyCategoryCentroidStore()
    return {
      buses: parsed.buses ?? empty.buses,
      arrangeRoles: parsed.arrangeRoles ?? empty.arrangeRoles,
      drumSubRoles: parsed.drumSubRoles ?? empty.drumSubRoles,
      global: parsed.global ?? empty.global
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`loadCategoryCentroidStore: failed to read ${path}: ${message}`)
    return emptyCategoryCentroidStore()
  }
}

export function saveCategoryCentroidStore(store: CategoryCentroidStore): void {
  try {
    writeFileSync(storePath(), JSON.stringify(store, null, 2), 'utf-8')
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`saveCategoryCentroidStore: failed to write ${storePath()}: ${message}`)
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/main/categoryCentroidStore.test.ts`
Expected: PASS (all tests, including the legacy-shape backward-compatibility one).

- [ ] **Step 5: Delete the old `busCentroidStore.ts` and its test file**

```bash
rm src/main/busCentroidStore.ts src/main/busCentroidStore.test.ts
```

`index.ts` and `preload/index.ts` still import from the now-deleted module — expected, fixed in Task 6.

- [ ] **Step 6: Commit**

```bash
git add -A src/main/categoryCentroidStore.ts src/main/categoryCentroidStore.test.ts src/main/busCentroidStore.ts src/main/busCentroidStore.test.ts
git commit -m "$(cat <<'EOF'
Generalize busCentroidStore.ts into categoryCentroidStore.ts

Same persistence mechanics (single JSON file in userData, empty-store
fallback on missing/corrupt file), now for the generalized multi-axis
CategoryCentroidStore. The persisted FILENAME stays busCentroids.json
unchanged -- only the module/function names changed -- so real users'
already-trained bus data keeps loading correctly, verified by a new test
loading a pre-existing bus-only-shaped file. This commit leaves index.ts
and preload/index.ts broken (still importing the now-deleted module) --
fixed in Task 6.
EOF
)"
```

---

### Task 5: `categoryCentroidTraining.ts` — server-side training orchestration

**Files:**
- Create: `src/main/categoryCentroidTraining.ts`
- Create: `src/main/categoryCentroidTraining.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/main/categoryCentroidTraining.test.ts`:

```ts
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { StemFeatures } from '@shared/stemFeatures'
import { emptyCategoryCentroidStore } from '@shared/categoryCentroids'

let userDataDir: string

vi.mock('electron', () => ({
  app: {
    getPath: () => userDataDir
  }
}))

function freshDb(): Database.Database {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE StemFeatureCache (
      StemCID TEXT PRIMARY KEY, FeaturesJSON TEXT NOT NULL, ExtractedAt INTEGER NOT NULL
    );
    CREATE TABLE Stems (StemCID TEXT PRIMARY KEY);
  `)
  return db
}

function fakeFeatures(): StemFeatures {
  return {
    transientDensity: 0.5,
    bassEnergyRatio: 0.3,
    spectralCentroidHz: 1200,
    zcrBrightness: 0.4,
    voicedFraction: 0.1,
    pitchVarianceCents: 20,
    mfcc: Array.from({ length: 13 }, (_, i) => i * 0.1)
  }
}

function seedFeatures(db: Database.Database, stemCID: string): void {
  db.prepare(`INSERT INTO Stems (StemCID) VALUES (?)`).run(stemCID)
  db.prepare(
    `INSERT INTO StemFeatureCache (StemCID, FeaturesJSON, ExtractedAt) VALUES (?, ?, ?)`
  ).run(stemCID, JSON.stringify(fakeFeatures()), 1000)
}

describe('categoryCentroidTraining', () => {
  beforeEach(() => {
    userDataDir = mkdtempSync(join(tmpdir(), 'sssketch-category-centroid-training-test-'))
  })

  afterEach(() => {
    rmSync(userDataDir, { recursive: true, force: true })
  })

  it('trainCentroidsFromBusEntries trains the bus axis from a stem with cached features', async () => {
    const db = freshDb()
    seedFeatures(db, 'cid-1')
    seedFeatures(db, 'cid-2')
    seedFeatures(db, 'cid-3')
    const { trainCentroidsFromBusEntries } = await import('./categoryCentroidTraining')
    const { loadCategoryCentroidStore } = await import('./categoryCentroidStore')
    trainCentroidsFromBusEntries(db, [
      { path: '/lib/cid-1', busId: 'drums' },
      { path: '/lib/cid-2', busId: 'drums' },
      { path: '/lib/cid-3', busId: 'drums' }
    ])
    expect(loadCategoryCentroidStore().buses.drums?.count).toBe(3)
  })

  it('trainCentroidsFromBusEntries silently skips a stem with no cached features yet', async () => {
    const db = freshDb()
    db.prepare(`INSERT INTO Stems (StemCID) VALUES (?)`).run('cid-1')
    // No StemFeatureCache row for cid-1 -- never scanned yet.
    const { trainCentroidsFromBusEntries } = await import('./categoryCentroidTraining')
    const { loadCategoryCentroidStore } = await import('./categoryCentroidStore')
    expect(() =>
      trainCentroidsFromBusEntries(db, [{ path: '/lib/cid-1', busId: 'drums' }])
    ).not.toThrow()
    expect(loadCategoryCentroidStore()).toEqual(emptyCategoryCentroidStore())
  })

  it('trainCentroidsFromRoleEntries trains the arrangeRole axis', async () => {
    const db = freshDb()
    seedFeatures(db, 'cid-1')
    seedFeatures(db, 'cid-2')
    seedFeatures(db, 'cid-3')
    const { trainCentroidsFromRoleEntries } = await import('./categoryCentroidTraining')
    const { loadCategoryCentroidStore } = await import('./categoryCentroidStore')
    trainCentroidsFromRoleEntries(db, [
      { path: '/lib/cid-1', arrangeRole: 'vocal' },
      { path: '/lib/cid-2', arrangeRole: 'vocal' },
      { path: '/lib/cid-3', arrangeRole: 'vocal' }
    ])
    expect(loadCategoryCentroidStore().arrangeRoles.vocal?.count).toBe(3)
  })

  it('trainCentroidsFromRoleEntries ALSO trains the drumSubRole axis when an entry has one', async () => {
    const db = freshDb()
    seedFeatures(db, 'cid-1')
    seedFeatures(db, 'cid-2')
    seedFeatures(db, 'cid-3')
    const { trainCentroidsFromRoleEntries } = await import('./categoryCentroidTraining')
    const { loadCategoryCentroidStore } = await import('./categoryCentroidStore')
    trainCentroidsFromRoleEntries(db, [
      { path: '/lib/cid-1', arrangeRole: 'drums', drumSubRole: 'kick' },
      { path: '/lib/cid-2', arrangeRole: 'drums', drumSubRole: 'kick' },
      { path: '/lib/cid-3', arrangeRole: 'drums', drumSubRole: 'kick' }
    ])
    const store = loadCategoryCentroidStore()
    expect(store.arrangeRoles.drums?.count).toBe(3)
    expect(store.drumSubRoles.kick?.count).toBe(3)
  })

  it('an entry with no drumSubRole trains only the arrangeRole axis', async () => {
    const db = freshDb()
    seedFeatures(db, 'cid-1')
    seedFeatures(db, 'cid-2')
    seedFeatures(db, 'cid-3')
    const { trainCentroidsFromRoleEntries } = await import('./categoryCentroidTraining')
    const { loadCategoryCentroidStore } = await import('./categoryCentroidStore')
    trainCentroidsFromRoleEntries(db, [
      { path: '/lib/cid-1', arrangeRole: 'drums' },
      { path: '/lib/cid-2', arrangeRole: 'drums' },
      { path: '/lib/cid-3', arrangeRole: 'drums' }
    ])
    const store = loadCategoryCentroidStore()
    expect(store.arrangeRoles.drums?.count).toBe(3)
    expect(store.drumSubRoles).toEqual({})
  })

  it('accepts extraCandidateDbs and finds a stem whose features live only there', async () => {
    const db = freshDb()
    const externalDb = freshDb()
    seedFeatures(externalDb, 'cid-external')
    seedFeatures(externalDb, 'cid-external-2')
    seedFeatures(externalDb, 'cid-external-3')
    const { trainCentroidsFromBusEntries } = await import('./categoryCentroidTraining')
    const { loadCategoryCentroidStore } = await import('./categoryCentroidStore')
    trainCentroidsFromBusEntries(
      db,
      [
        { path: '/lore-archive/cid-external', busId: 'bass' },
        { path: '/lore-archive/cid-external-2', busId: 'bass' },
        { path: '/lore-archive/cid-external-3', busId: 'bass' }
      ],
      [externalDb]
    )
    expect(loadCategoryCentroidStore().buses.bass?.count).toBe(3)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/main/categoryCentroidTraining.test.ts`
Expected: FAIL — `Cannot find module './categoryCentroidTraining'`.

- [ ] **Step 3: Implement `src/main/categoryCentroidTraining.ts`**

```ts
// src/main/categoryCentroidTraining.ts
import type Database from 'better-sqlite3'
import { toFeatureArray } from '@shared/stemFeatures'
import { recordConfirmedCategory, type CategoryCentroidStore } from '@shared/categoryCentroids'
import { loadCategoryCentroidStore, saveCategoryCentroidStore } from './categoryCentroidStore'
import { getStemFeatureCache } from './stemFeatureCacheStore'
import type { StemBusCategoryEntry, StemRoleCategoryEntry } from './stemCategoriesStore'

/** The server-side half of "every StemCategories write trains the
 * classifier, not just Tidy Up's own" (design spec §6). Called from every
 * real write site (the upsert-stem-category-bus/-role IPC handlers, and
 * the backfill migration) right after their own StemCategories write --
 * reads each entry's ALREADY-PERSISTED StemFeatures (Plan A's
 * StemFeatureCache, via getStemFeatureCache) rather than needing a fresh
 * Web Audio decode, which is what makes training possible entirely
 * server-side with no renderer involvement. A stem whose features haven't
 * been scanned/persisted yet is silently skipped for training purposes
 * (not an error) -- it simply doesn't contribute a data point this time;
 * a later StemCategories write for the same stem, once its features exist,
 * trains it then. extraCandidateDbs is passed straight through to
 * getStemFeatureCache, mirroring stemCategoriesStore.ts's own
 * upsertStemCategoryBus/-Role -- a stem from an external LORE archive
 * needs the same candidate-db lookup to find its cached features that it
 * already needed to validate its StemCID in the first place. */
export function trainCentroidsFromBusEntries(
  db: Database.Database,
  entries: StemBusCategoryEntry[],
  extraCandidateDbs: Database.Database[] = []
): void {
  let store: CategoryCentroidStore | null = null
  let changed = false
  for (const entry of entries) {
    const features = getStemFeatureCache(db, entry.path, extraCandidateDbs)
    if (!features) continue
    store ??= loadCategoryCentroidStore()
    const next = recordConfirmedCategory(store, 'bus', entry.busId, toFeatureArray(features))
    if (next !== store) changed = true
    store = next
  }
  if (changed && store) saveCategoryCentroidStore(store)
}

export function trainCentroidsFromRoleEntries(
  db: Database.Database,
  entries: StemRoleCategoryEntry[],
  extraCandidateDbs: Database.Database[] = []
): void {
  let store: CategoryCentroidStore | null = null
  let changed = false
  for (const entry of entries) {
    const features = getStemFeatureCache(db, entry.path, extraCandidateDbs)
    if (!features) continue
    store ??= loadCategoryCentroidStore()
    const raw = toFeatureArray(features)
    const afterArrangeRole = recordConfirmedCategory(store, 'arrangeRole', entry.arrangeRole, raw)
    if (afterArrangeRole !== store) changed = true
    store = afterArrangeRole
    if (entry.drumSubRole) {
      const afterDrumSubRole = recordConfirmedCategory(store, 'drumSubRole', entry.drumSubRole, raw)
      if (afterDrumSubRole !== store) changed = true
      store = afterDrumSubRole
    }
  }
  if (changed && store) saveCategoryCentroidStore(store)
}
```

**Note:** `stemCategoriesStore.ts` needs to export `StemBusCategoryEntry` and `StemRoleCategoryEntry` for this import to work — confirm they're already exported (they should be, from Plan A's own Task 2) by running `grep -n "export interface StemBusCategoryEntry\|export interface StemRoleCategoryEntry" src/main/stemCategoriesStore.ts` before writing this file. If either isn't exported yet, add the `export` keyword to it as part of this step (a one-line change, not a redesign).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/main/categoryCentroidTraining.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: no errors (should now be fully clean again — `categoryCentroids.ts`/`categoryCentroidStore.ts`/`categoryCentroidTraining.ts` are all internally consistent now; `index.ts`/`preload/index.ts`/`ClusterStemsBrowser.tsx` still reference the deleted `busCentroids`/`busCentroidStore` modules until Tasks 6 and 8).

- [ ] **Step 6: Commit**

```bash
git add src/main/categoryCentroidTraining.ts src/main/categoryCentroidTraining.test.ts
git commit -m "$(cat <<'EOF'
Add categoryCentroidTraining.ts: server-side centroid training

Reads each StemCategories entry's already-persisted StemFeatureCache row
(Plan A) rather than needing a fresh Web Audio decode -- this is what
makes training possible entirely server-side, triggered from wherever a
StemCategories write actually happens (IPC handlers, backfill) instead
of only from Tidy Up's own renderer-side trainCentroids. A stem with no
cached features yet is silently skipped for training, not an error. Not
wired into any real write path yet -- that's the next two tasks.
EOF
)"
```

---

### Task 6: Wire training into the `StemCategories` IPC handlers + rename the centroid IPC surface

**Files:**
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`

**Before you start:** re-read the current exact content of `src/main/index.ts`'s `upsert-stem-category-bus`/`upsert-stem-category-role`/`get-bus-centroids`/`save-bus-centroids` handlers, and `src/preload/index.ts`'s matching entries — these were touched by Plan A and its own follow-up fixes, so confirm the exact current code before editing.

- [ ] **Step 1: Update imports in `src/main/index.ts`**

Remove:
```ts
import { loadBusCentroidStore, saveBusCentroidStore } from './busCentroidStore'
import type { BusCentroidStore } from '@shared/busCentroids'
```

Add:
```ts
import { loadCategoryCentroidStore } from './categoryCentroidStore'
import type { CategoryCentroidStore } from '@shared/categoryCentroids'
import {
  trainCentroidsFromBusEntries,
  trainCentroidsFromRoleEntries
} from './categoryCentroidTraining'
```

- [ ] **Step 2: Replace the centroid IPC handlers**

Find the existing `get-bus-centroids`/`save-bus-centroids` handlers:
```ts
  ipcMain.handle('get-bus-centroids', (): BusCentroidStore => loadBusCentroidStore())

  ipcMain.handle('save-bus-centroids', (_event, store: BusCentroidStore) =>
    saveBusCentroidStore(store)
  )
```

Replace with a SINGLE read-only handler — the renderer no longer needs to SAVE the centroid store itself, since training (and therefore saving) now only ever happens server-side:

```ts
  ipcMain.handle('get-category-centroids', (): CategoryCentroidStore => loadCategoryCentroidStore())
```

- [ ] **Step 3: Train from every `StemCategories` write**

Find the `upsert-stem-category-bus` handler (added in Plan A, extended with `candidateDbsForRiff()` by a follow-up fix). It currently looks like:

```ts
  ipcMain.handle(
    'upsert-stem-category-bus',
    (_event, entries: StemBusCategoryEntry[], source: string, project: ProjectRef) => {
      upsertStemCategoryBus(
        openOwnRiffLibraryDb(),
        entries,
        source,
        resolveSourceProjectPath(project),
        Date.now() / 1000,
        candidateDbsForRiff()
      )
    }
  )
```

Add a `trainCentroidsFromBusEntries` call right after the `upsertStemCategoryBus` call, reusing the SAME `db`/`candidateDbsForRiff()` values (compute them once into local variables rather than calling `openOwnRiffLibraryDb()`/`candidateDbsForRiff()` twice):

```ts
  ipcMain.handle(
    'upsert-stem-category-bus',
    (_event, entries: StemBusCategoryEntry[], source: string, project: ProjectRef) => {
      const db = openOwnRiffLibraryDb()
      const extraCandidateDbs = candidateDbsForRiff()
      upsertStemCategoryBus(
        db,
        entries,
        source,
        resolveSourceProjectPath(project),
        Date.now() / 1000,
        extraCandidateDbs
      )
      trainCentroidsFromBusEntries(db, entries, extraCandidateDbs)
    }
  )
```

Apply the exact same pattern to the `upsert-stem-category-role` handler — hoist `db`/`extraCandidateDbs` into local variables, keep the existing `upsertStemCategoryRole` call exactly as it is (same arguments, same order), and add `trainCentroidsFromRoleEntries(db, entries, extraCandidateDbs)` right after it.

- [ ] **Step 4: Update `src/preload/index.ts`**

Remove:
```ts
import type { BusCentroidStore } from '@shared/busCentroids'
```
```ts
  getBusCentroids: (): Promise<BusCentroidStore> => ipcRenderer.invoke('get-bus-centroids'),
  saveBusCentroids: (store: BusCentroidStore): Promise<void> =>
    ipcRenderer.invoke('save-bus-centroids', store),
```

Add:
```ts
import type { CategoryCentroidStore } from '@shared/categoryCentroids'
```
```ts
  getCategoryCentroids: (): Promise<CategoryCentroidStore> =>
    ipcRenderer.invoke('get-category-centroids'),
```

- [ ] **Step 5: Run typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: still some errors expected in `ClusterStemsBrowser.tsx` (still referencing the old `getBusCentroids`/`saveBusCentroids`/`busCentroids` imports) — fixed in Task 8. Confirm `index.ts`/`preload/index.ts` THEMSELVES are clean (no errors reported for those two files specifically).

- [ ] **Step 6: Commit**

```bash
git add src/main/index.ts src/preload/index.ts
git commit -m "$(cat <<'EOF'
Wire centroid training into StemCategories IPC handlers; rename centroid IPC to category-centroids, read-only

upsert-stem-category-bus/-role now each also call
trainCentroidsFromBusEntries/trainCentroidsFromRoleEntries right after
their own StemCategories write, so training happens automatically from
every source (Tidy Up, backfill, Auto-Arrange, Draw Arrangement) with no
per-call-site wiring needed anywhere else. get-bus-centroids/
save-bus-centroids collapse into a single get-category-centroids
(read-only) -- the renderer no longer trains/saves the store itself now
that training is server-side. ClusterStemsBrowser.tsx still references
the old names until the next two tasks.
EOF
)"
```

---

### Task 7: Wire training into the backfill migration

**Files:**
- Modify: `src/main/stemCategoriesBackfill.ts`

**Before you start:** re-read the current exact content fresh.

- [ ] **Step 1: Add the import**

```ts
import { trainCentroidsFromBusEntries } from './categoryCentroidTraining'
```

- [ ] **Step 2: Train after each sketch's own `upsertStemCategoryBus` call**

The current code calls `upsertStemCategoryBus(db, entries, 'backfill', projectPath, Math.floor(sketch.mtimeMs / 1000), candidateDbsForRiff())` once per sketch with recoverable entries (inside the `for (const sketch of sketches)` loop, guarded by `if (entries.length > 0)`). Add a `trainCentroidsFromBusEntries` call right after it, reusing the SAME `entries` and the SAME `candidateDbsForRiff()` result already computed for that call (hoist it into a local variable if it's currently computed inline more than once, so it isn't recomputed redundantly):

```ts
    if (entries.length > 0) {
      const extraCandidateDbs = candidateDbsForRiff()
      upsertStemCategoryBus(
        db,
        entries,
        'backfill',
        projectPath,
        Math.floor(sketch.mtimeMs / 1000),
        extraCandidateDbs
      )
      trainCentroidsFromBusEntries(db, entries, extraCandidateDbs)
      categorizedStems += entries.length
    }
```

(Read the current exact surrounding code first — this shows the shape of the change, not necessarily byte-identical surrounding lines; match it to what's actually there.)

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: no errors for this file (still expected elsewhere until Task 8).

- [ ] **Step 4: Run the backfill's own test suite**

Run: `npx vitest run src/main/stemCategoriesBackfill.test.ts`
Expected: PASS — the existing tests don't assert on centroid training, so they should pass unchanged; this just confirms the added call doesn't throw or break anything.

- [ ] **Step 5: Commit**

```bash
git add src/main/stemCategoriesBackfill.ts
git commit -m "$(cat <<'EOF'
Train centroids from the backfill migration's own recovered bus history

Historical busOf assignments recovered from old project files are a real
source of confirmed categorization -- design spec §6 explicitly calls
out backfill as one of the sources training should cover, not just live
forward-capture.
EOF
)"
```

---

### Task 8: Update `ClusterStemsBrowser.tsx` — read the renamed store, drop client-side training

**Files:**
- Modify: `src/renderer/src/components/ClusterStemsBrowser.tsx`

**Before you start:** re-read the current file fresh. Training moves server-side in this plan (Tasks 5-7) — this task removes the now-redundant client-side half (which would otherwise double-train every confirmation: once via the server-side hook this plan just added, once via this component's own existing `trainCentroids`/`saveBusCentroids` call). The "load the store once on mount, read suggestions from a frozen snapshot all session" half stays, simplified to the new axis-based API.

- [ ] **Step 1: Update the import**

Replace:
```ts
import {
  emptyBusCentroidStore,
  recordConfirmedStem,
  suggestBus,
  type BusCentroidStore
} from '@shared/busCentroids'
```
with:
```ts
import { emptyCategoryCentroidStore, suggestCategory, type CategoryCentroidStore } from '@shared/categoryCentroids'
```
(`recordConfirmedStem` is no longer imported — training is server-side now.)

- [ ] **Step 2: Simplify the centroid store loading**

Replace:
```ts
  const [centroidStore, setCentroidStore] = useState<BusCentroidStore>(emptyBusCentroidStore)
  const [centroidStoreSnapshot, setCentroidStoreSnapshot] =
    useState<BusCentroidStore>(emptyBusCentroidStore)
  useEffect(() => {
    void window.rifffApi.getBusCentroids().then((store) => {
      setCentroidStore(store)
      setCentroidStoreSnapshot(store)
    })
  }, [])
```
with:
```ts
  // Frozen the first time the real store loads, never again -- see this
  // doc comment's own original reasoning below (unchanged): confirming
  // ANY bus mid-tidy-up must not retrain the LIVE suggestion set shown
  // here, since training itself is now entirely server-side (see
  // categoryCentroidTraining.ts) and would otherwise flip an unrelated,
  // already-visible DSP-cluster stem into "suggested" mid-session.
  const [centroidStoreSnapshot, setCentroidStoreSnapshot] =
    useState<CategoryCentroidStore>(emptyCategoryCentroidStore)
  useEffect(() => {
    void window.rifffApi.getCategoryCentroids().then(setCentroidStoreSnapshot)
  }, [])
```

Update the surrounding multi-paragraph doc comment above this block (currently explaining `centroidStore` vs `centroidStoreSnapshot`) to reflect that there's now only ONE state value (the frozen snapshot) since the live, continuously-retraining half moved server-side — keep the core "why frozen, not live" reasoning (the "jolting"/"took over" user feedback this originally fixed), just drop the parts describing the now-removed live `centroidStore`.

- [ ] **Step 3: Update the suggestion lookup**

Find:
```ts
      const suggestedBus = raw ? suggestBus(centroidStoreSnapshot, raw) : null
```
Replace with:
```ts
      const suggestedBus = raw
        ? (suggestCategory(centroidStoreSnapshot, 'bus', raw) as BusId | null)
        : null
```

- [ ] **Step 4: Remove the `trainCentroids` function and its two call sites**

Delete the whole `trainCentroids` function (the one with the doc comment referencing `recordConfirmedStem`/`saveBusCentroids`).

In `assignCluster`, remove the `trainCentroids(members, busId)` line — keep `recordBusCategories(members, busId)` exactly as it is (that's the call that triggers the `StemCategories` write, which now ALSO trains centroids server-side, per Task 6):

```ts
  function assignCluster(rowIndex: number, members: ClusterableStem[], busId: BusId): void {
    dispatch({ type: 'ASSIGN_STEMS_TO_BUS', stemKeys: members.map((m) => m.key), busId })
    recordBusCategories(members, busId)
    setCelebratingRow(rowIndex)
    window.setTimeout(() => {
      setCelebratingRow((current) => (current === rowIndex ? null : current))
    }, 500)
  }
```

Apply the same removal to `assignSuggestedGroup` (remove its own `trainCentroids(members, busId)` line, keep `recordBusCategories(members, busId)`).

- [ ] **Step 5: Run typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: no errors — this should be the point where the WHOLE project is typecheck-clean again (every reference to the deleted `busCentroids`/`busCentroidStore` modules has now been updated).

- [ ] **Step 6: Run the full test suite**

Run: `npm test`
Expected: no regressions.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/components/ClusterStemsBrowser.tsx
git commit -m "$(cat <<'EOF'
ClusterStemsBrowser.tsx reads the renamed, generalized centroid store; drops client-side training

Training moved server-side (Tasks 5-7) -- this component's own
trainCentroids/saveBusCentroids call would now double-train every
confirmation. Keeps the "load once on mount, read suggestions from a
frozen snapshot all session" half, simplified to one state value instead
of two, using suggestCategory(store, 'bus', raw) in place of the old
suggestBus. Needs Elling's own manual walkthrough: confirm Tidy Up still
shows bus suggestions exactly as before.
EOF
)"
```

---

### Task 9: `roleCentroidRefinement.ts` — apply a centroid suggestion on top of a resolved role

**Files:**
- Create: `src/shared/roleCentroidRefinement.ts`
- Create: `src/shared/roleCentroidRefinement.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/shared/roleCentroidRefinement.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { refineRoleWithCentroidSuggestion } from './roleCentroidRefinement'
import { resolveStemRole } from './stemRole'
import { emptyCategoryCentroidStore, recordConfirmedCategory } from './categoryCentroids'
import type { Stem } from './types'

const DIM = 19
function vec(fillValue: number): number[] {
  return new Array(DIM).fill(fillValue)
}

function fakeStem(overrides: Partial<Stem> = {}): Stem {
  return {
    slot: 1,
    author: 'someone',
    name: 'untitled',
    type: 'fx',
    path: '/lib/some-stem',
    durationSec: 4,
    barLength: 4,
    ...overrides
  }
}

describe('refineRoleWithCentroidSuggestion', () => {
  it('leaves a role with a confirmed busId completely untouched, even with a confident suggestion available', () => {
    let store = emptyCategoryCentroidStore()
    for (let i = 0; i < 5; i++) store = recordConfirmedCategory(store, 'arrangeRole', 'vocal', vec(0))
    const role = resolveStemRole(fakeStem(), 'k', 'drums')
    const refined = refineRoleWithCentroidSuggestion(role, vec(0), store)
    expect(refined).toEqual(role)
  })

  it('leaves the role untouched when no feature vector was scanned yet (null)', () => {
    const store = emptyCategoryCentroidStore()
    const role = resolveStemRole(fakeStem(), 'k', null)
    const refined = refineRoleWithCentroidSuggestion(role, null, store)
    expect(refined).toEqual(role)
  })

  it('leaves the role untouched when the classifier has no confident suggestion yet (cold start)', () => {
    const store = emptyCategoryCentroidStore()
    const role = resolveStemRole(fakeStem(), 'k', null)
    const refined = refineRoleWithCentroidSuggestion(role, vec(0), store)
    expect(refined).toEqual(role)
  })

  it('overrides arrangeRole with a confident suggestion, and clears uncertain', () => {
    let store = emptyCategoryCentroidStore()
    for (let i = 0; i < 5; i++) store = recordConfirmedCategory(store, 'arrangeRole', 'vocal', vec(0))
    const role = resolveStemRole(fakeStem({ type: 'fx' }), 'k', null)
    expect(role.uncertain).toBe(true)
    const refined = refineRoleWithCentroidSuggestion(role, vec(0), store)
    expect(refined.arrangeRole).toBe('vocal')
    expect(refined.uncertain).toBe(false)
  })

  it('also suggests a drumSubRole when the arrangeRole suggestion is drums and drumSubRole has a confident match', () => {
    let store = emptyCategoryCentroidStore()
    for (let i = 0; i < 5; i++) store = recordConfirmedCategory(store, 'arrangeRole', 'drums', vec(0))
    for (let i = 0; i < 5; i++) store = recordConfirmedCategory(store, 'drumSubRole', 'kick', vec(0))
    const role = resolveStemRole(fakeStem(), 'k', null)
    const refined = refineRoleWithCentroidSuggestion(role, vec(0), store)
    expect(refined.arrangeRole).toBe('drums')
    expect(refined.drumSubRole).toBe('kick')
  })

  it('does not set a drumSubRole when the suggested arrangeRole is not drums', () => {
    let store = emptyCategoryCentroidStore()
    for (let i = 0; i < 5; i++) store = recordConfirmedCategory(store, 'arrangeRole', 'vocal', vec(0))
    for (let i = 0; i < 5; i++) store = recordConfirmedCategory(store, 'drumSubRole', 'kick', vec(0))
    const role = resolveStemRole(fakeStem(), 'k', null)
    const refined = refineRoleWithCentroidSuggestion(role, vec(0), store)
    expect(refined.arrangeRole).toBe('vocal')
    expect(refined.drumSubRole).toBeUndefined()
  })

  it('overrides a PresetName-based guess too, not just the raw SoundType fallback -- centroid ranks above PresetName', () => {
    let store = emptyCategoryCentroidStore()
    for (let i = 0; i < 5; i++) store = recordConfirmedCategory(store, 'arrangeRole', 'vocal', vec(0))
    // 'Keymasher' is a real, known FX preset name -- resolveStemRole alone
    // would guess 'textureFx' from it.
    const role = resolveStemRole(fakeStem({ name: 'Keymasher', type: 'fx' }), 'k', null)
    expect(role.arrangeRole).toBe('textureFx')
    const refined = refineRoleWithCentroidSuggestion(role, vec(0), store)
    expect(refined.arrangeRole).toBe('vocal')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/shared/roleCentroidRefinement.test.ts`
Expected: FAIL — `Cannot find module './roleCentroidRefinement'`.

- [ ] **Step 3: Implement `src/shared/roleCentroidRefinement.ts`**

```ts
// src/shared/roleCentroidRefinement.ts
import type { StemRoleInfo, ArrangeRole, DrumSubRole } from './stemRole'
import { suggestCategory, type CategoryCentroidStore } from './categoryCentroids'

/** Applies the centroid classifier's own suggestion on top of an already-
 * resolved StemRoleInfo (resolveStemRole, stemRole.ts) -- kept as its own
 * function/file rather than folded into resolveStemRole itself, since
 * categoryCentroids.ts needs ArrangeRole/DrumSubRole types FROM
 * stemRole.ts, and stemRole.ts importing back from categoryCentroids.ts
 * to call this would be a real circular import. See this plan's own
 * "Important context" for the full reasoning.
 *
 * Only ever overrides a role that has NO confirmed busId -- a human
 * confirmation in Tidy Up always wins outright, exactly like
 * resolveStemRole's own busId handling. When it does apply, the centroid
 * suggestion overrides BOTH the raw SoundType fallback AND a PresetName
 * match -- the centroid classifier ranks as the STRONGER signal of the
 * two non-human-confirmed ones (see this plan's own "Important context"
 * for why). rawFeatureVector is null for a stem that hasn't been scanned
 * yet (see useStemFeatureScan.ts) -- nothing to suggest from, role passes
 * through unchanged. */
export function refineRoleWithCentroidSuggestion(
  role: StemRoleInfo,
  rawFeatureVector: number[] | null,
  centroidStore: CategoryCentroidStore
): StemRoleInfo {
  if (role.busId !== null) return role
  if (!rawFeatureVector) return role

  const suggestedArrangeRole = suggestCategory(
    centroidStore,
    'arrangeRole',
    rawFeatureVector
  ) as ArrangeRole | null
  if (!suggestedArrangeRole) return role

  const drumSubRole =
    suggestedArrangeRole === 'drums'
      ? ((suggestCategory(centroidStore, 'drumSubRole', rawFeatureVector) as DrumSubRole | null) ??
        undefined)
      : undefined

  return { ...role, arrangeRole: suggestedArrangeRole, drumSubRole, uncertain: false }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/shared/roleCentroidRefinement.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/shared/roleCentroidRefinement.ts src/shared/roleCentroidRefinement.test.ts
git commit -m "$(cat <<'EOF'
Add roleCentroidRefinement.ts: apply a centroid suggestion over resolveStemRole

Own file (not folded into stemRole.ts itself) to avoid a circular import
-- categoryCentroids.ts needs ArrangeRole/DrumSubRole from stemRole.ts,
so stemRole.ts can't import back from it. Only ever overrides a role with
no confirmed busId, and ranks above a PresetName match too, not just the
raw SoundType fallback. Not wired into any real component yet -- that's
the next task.
EOF
)"
```

---

### Task 10: Wire the centroid refinement into `AutoArrangeRoleStep.tsx`

**Files:**
- Modify: `src/renderer/src/components/AutoArrangeRoleStep.tsx`

**Before you start:** re-read the current file fresh — confirm the current exact shape of the `scanItems`/`useStemFeatureScan`/`densityResults`/role-resolution `useEffect` block (grounded against the file's state as of Plan A's own Task 12, reproduced in this plan's own "Important context" investigation — but re-verify against the live file before editing, since it may have shifted).

- [ ] **Step 1: Add the centroid store loading**

Add near the top of the component, alongside its other `useState`/`useEffect` hooks (a natural place is right before the `scanItems`/`useStemFeatureScan` block):

```ts
  // Loaded once on mount, same "frozen for this session" pattern as
  // ClusterStemsBrowser.tsx's own centroidStoreSnapshot -- there's no
  // equivalent "jolting suggestions mid-session" concern here (this
  // component shows one role per stem, not a reshuffling suggested-groups
  // list), but loading once and never refetching is still the simplest
  // correct choice, and keeps this consistent with the established
  // pattern rather than inventing a second one.
  const [centroidStore, setCentroidStore] = useState<CategoryCentroidStore>(
    emptyCategoryCentroidStore
  )
  useEffect(() => {
    void window.rifffApi.getCategoryCentroids().then(setCentroidStore)
  }, [])
```

Add the new imports:

```ts
import { emptyCategoryCentroidStore, type CategoryCentroidStore } from '@shared/categoryCentroids'
import { refineRoleWithCentroidSuggestion } from '@shared/roleCentroidRefinement'
import { toFeatureArray } from '@shared/stemFeatures'
```

- [ ] **Step 2: Apply the refinement in the role-resolution effect**

Find:
```ts
  useEffect(() => {
    if (flatStems.length === 0) return
    if (scanLoading) return
    // Role resolution itself is synchronous and can't fail -- resolve it
    // for every stem once the shared scan hook has settled.
    const resolved: StemRoleInfo[] = flatStems.map(({ stem, stemKey: key }) =>
      resolveStemRole(stem, key, busOf[key] ?? null)
    )
```

Replace with:
```ts
  useEffect(() => {
    if (flatStems.length === 0) return
    if (scanLoading) return
    // Role resolution itself is synchronous and can't fail -- resolve it
    // for every stem once the shared scan hook has settled, then let the
    // centroid classifier refine any stem with no confirmed busId (see
    // roleCentroidRefinement.ts's own doc comment for the full priority
    // order and why this ranks above a PresetName match too).
    const resolved: StemRoleInfo[] = flatStems.map(({ stem, stemKey: key }) => {
      const base = resolveStemRole(stem, key, busOf[key] ?? null)
      const features = featuresByKey.get(key)
      const raw = features ? toFeatureArray(features) : null
      return refineRoleWithCentroidSuggestion(base, raw, centroidStore)
    })
```

Update the effect's own dependency array (find its closing `}, [flatStems, placedRifffs, busOf, scanLoading, densityResults])` line) to add `centroidStore`:

```ts
  }, [flatStems, placedRifffs, busOf, scanLoading, densityResults, centroidStore])
```

- [ ] **Step 3: Run typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: no errors.

- [ ] **Step 4: Run the full test suite**

Run: `npm test`
Expected: no regressions.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/AutoArrangeRoleStep.tsx
git commit -m "$(cat <<'EOF'
Apply centroid-classifier role refinement in AutoArrangeRoleStep.tsx

Loads the category centroid store once on mount (same frozen-snapshot
pattern as Tidy Up's own), then refines each stem's resolved role via
refineRoleWithCentroidSuggestion once its own features have been
scanned. Shared by both Auto-Arrange and Draw Arrangement (both wrap
this same component). Needs Elling's own manual walkthrough: with a
reasonably-trained library, open Auto-Arrange or Draw Arrangement and
confirm previously-uncertain/generic-fallback roles now show a more
specific, more often-correct starting guess for untidied stems.
EOF
)"
```

---

### Task 11: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Full typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 2: Full lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 3: Full test suite**

Run: `npm test`
Expected: all tests pass, including every new/renamed test file from Tasks 1-10.

- [ ] **Step 4: Grep for stale references to the deleted modules**

Run: `grep -rln "busCentroids\|busCentroidStore\|BusCentroidStore\|recordConfirmedStem\b\|suggestBus\b\|getBusCentroids\|saveBusCentroids" src/ | grep -v ".test.ts"`
Expected: no matches — every reference to the old BusId-only module/functions/IPC names should have been replaced by the generalized `categoryCentroids`/`categoryCentroidStore` equivalents across the whole `src/` tree.

- [ ] **Step 5: Write the manual-walkthrough summary for Elling**

Post a summary (not a file — just the session's own final message) listing exactly what needs a real, interactive walkthrough before this is considered done:

1. **Tidy Up (`ClusterStemsBrowser.tsx`)**: confirm bus-suggestion behavior is unchanged from before this plan (same "suggested" dashed-border rows, same confidence gating) — this plan changed WHERE training happens (server-side now) but not what gets shown or how confident a suggestion needs to be to appear.
2. **Auto-Arrange / Draw Arrangement (`AutoArrangeRoleStep.tsx`)**: with a library that has SOME real hand-categorized history (either from this session's own testing, or Plan A's backfill having recovered some), open either wizard and check whether previously-generic role guesses for untidied stems now look more specific/plausible. This is inherently a judgment call about classification QUALITY, not a pass/fail check — the code working correctly and the suggestions being GOOD are two different things, and only the first is verifiable without real usage data.
3. **Cold start**: on a fresh/mostly-untrained library (fewer than 3 confirmed samples for any given category), confirm nothing errors and roles simply fall back to PresetName/SoundType exactly as before this plan — the classifier should decline to guess, not force a wrong one.
4. **Restart persistence**: confirm centroid training survives an app restart (train a few stems, quit, relaunch, confirm a previously-untrained stem now gets a suggestion consistent with what was trained before quitting).

- [ ] **Step 6: No commit for this task** (verification only — nothing to commit unless Step 4's grep or the test suite surfaces something to fix, in which case fix it and commit as its own small fix).
