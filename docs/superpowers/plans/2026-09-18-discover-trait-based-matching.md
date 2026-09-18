# Discover Trait-Based Matching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Discover's discrete-`ArrangeRole` candidate matching with a
7-kind `DiscoverSlotKind` model: 3 kinds (`drums`/`bass`/`lead`) filtered
directly by Endlesss's own reliable instrument mask, and 4 kinds
(`bassHeavy`/`rhythmic`/`bright`/`warm`) filtered/ranked by cheap,
already-cached `StemFeatureCache` numeric fields for whatever the mask can't
place (audioIn-masked or unmasked stems).

**Architecture:** A new shared `DiscoverSlotKind` type + a fixed
`discoverSlotKindToArrangeRole` mapping (identity for the 3 mask kinds, a
fixed approximation for the 4 trait kinds), consumed only at
add-to-shelf/add-to-timeline time. `getDiscoverCandidates`
(`discoverCandidates.ts`) branches into two candidate-pool paths by kind: a
direct `Instrument`-bitmask filter for the 3 mask kinds (no
`StemAutoCategory`/embedding widening at all), and a new
`StemFeatureCache`-based path for the 4 trait kinds (restricted to
audioIn/unmasked stems, so the two pools never overlap). `rankCandidates`
(`discoverRanking.ts`) gets a new, additive trait-distance scoring term used
only for trait-kind candidates. `discoverAdjacency.ts`'s `matchRole` gets the
same kind-aware rewrite. `DiscoverPanel.tsx`'s `DiscoverSlot.role: ArrangeRole`
becomes `DiscoverSlot.kind: DiscoverSlotKind` throughout, with 7 slot-creation
buttons replacing today's 8.

**Tech Stack:** No new dependencies. Reuses `Stems.Instrument` (already
synced) and `StemFeatureCache` (already populated by the existing background
feature-extraction scan) — every signal this feature reads already exists.

**Spec:** `docs/superpowers/specs/2026-09-18-discover-trait-based-matching-design.md`
— read it before starting if anything below is unclear on intent.

---

## Before you start

This plan makes four judgment calls the spec deliberately left open, stated
here so every task agrees on them:

1. **Human confirmations (`StemCategories`) stay in the pool for the 3 mask
   kinds too.** The spec's architecture section says mask-kind pools drop
   `StemAutoCategory`/embedding widening — it doesn't say to also drop real
   human confirmations. This codebase's own established principle ("a real
   human confirmation always wins") is preserved: a stem a human confirmed
   `drums`/`bass`/`lead` in Tidy Up is still a candidate even if its own mask
   is ambiguous or missing, same as today. Only the *machine-guessed*
   `StemAutoCategory` layer is dropped for these 3 kinds.
2. **`discoverAdjacency.ts`'s `matchRole` becomes kind-aware directly**
   (mask check for 3 kinds, feature-cache-presence check for 4 kinds) rather
   than keeping its current `resolveStemArrangeRole`-based lookup. This keeps
   "adjacent" riff browsing consistent with what a normal roll would surface
   for the same slot kind. `resolveStemArrangeRole` itself is NOT changed —
   only this one caller stops using it. It also has no existing automated
   test coverage to preserve (see Task 6's own note) — this task doesn't add
   any; it's verified by typecheck plus a manual walkthrough item (Task 8
   Step 7).
3. **Externally-imported samples (drag-and-drop / "+ sample") default to a
   single fixed trait kind (`bright`)**, not a guessed `ArrangeRole` — an
   external file has no Endlesss `Instrument` mask at all, so it can never
   be a genuine mask-kind candidate, and computing a real trait value at
   import time would mean synchronous feature extraction this whole
   redesign exists to avoid (Task 8 Step 5).
4. **The three Discover-related IPC handlers/preload methods** (`get-
   discover-candidates`, `get-random-discover-candidate`, `get-adjacent-
   discover-candidates`) are renamed in their own dedicated task (Task 7),
   sequenced between the main-process/shared work (Tasks 1-6) and the
   renderer work (Task 8) that calls them — the spec itself doesn't mention
   this layer at all, but it exists today and has to change in lockstep.

---

### Task 1: `DiscoverSlotKind` type and the kind → ArrangeRole mapping

**Files:**
- Create: `src/shared/discoverSlotKind.ts`
- Test: `src/shared/discoverSlotKind.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/shared/discoverSlotKind.test.ts
import { describe, expect, it } from 'vitest'
import {
  DISCOVER_SLOT_KIND_OPTIONS,
  DISCOVER_MASK_SLOT_KINDS,
  DISCOVER_TRAIT_SLOT_KINDS,
  discoverSlotKindToArrangeRole,
  type DiscoverSlotKind
} from './discoverSlotKind'

describe('DISCOVER_SLOT_KIND_OPTIONS', () => {
  it('lists exactly the 7 kinds, mask kinds first', () => {
    expect(DISCOVER_SLOT_KIND_OPTIONS).toEqual([
      'drums',
      'bass',
      'lead',
      'bassHeavy',
      'rhythmic',
      'bright',
      'warm'
    ])
  })

  it('DISCOVER_MASK_SLOT_KINDS and DISCOVER_TRAIT_SLOT_KINDS partition it with no overlap', () => {
    const all = new Set(DISCOVER_SLOT_KIND_OPTIONS)
    const mask = new Set(DISCOVER_MASK_SLOT_KINDS)
    const trait = new Set(DISCOVER_TRAIT_SLOT_KINDS)
    expect(mask.size + trait.size).toBe(all.size)
    for (const kind of mask) expect(trait.has(kind)).toBe(false)
    expect(new Set([...mask, ...trait])).toEqual(all)
  })
})

describe('discoverSlotKindToArrangeRole', () => {
  it('is identity for the 3 mask kinds', () => {
    expect(discoverSlotKindToArrangeRole('drums')).toBe('drums')
    expect(discoverSlotKindToArrangeRole('bass')).toBe('bass')
    expect(discoverSlotKindToArrangeRole('lead')).toBe('lead')
  })

  it('maps the 4 trait kinds to a fixed approximation', () => {
    expect(discoverSlotKindToArrangeRole('bassHeavy')).toBe('bass')
    expect(discoverSlotKindToArrangeRole('rhythmic')).toBe('drums')
    expect(discoverSlotKindToArrangeRole('bright')).toBe('lead')
    expect(discoverSlotKindToArrangeRole('warm')).toBe('aux')
  })

  it('covers every DiscoverSlotKind with no missing entry', () => {
    for (const kind of DISCOVER_SLOT_KIND_OPTIONS) {
      expect(() => discoverSlotKindToArrangeRole(kind)).not.toThrow()
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/shared/discoverSlotKind.test.ts`
Expected: FAIL — `Cannot find module './discoverSlotKind'`

- [ ] **Step 3: Write the implementation**

```ts
// src/shared/discoverSlotKind.ts
import type { ArrangeRole } from './stemRole'

/** Discover's own candidate-matching taxonomy -- replaces the old, fallible
 * ArrangeRole-classifier-driven slot model (see
 * docs/superpowers/specs/2026-09-18-discover-trait-based-matching-design.md).
 * The 3 mask kinds are filtered directly by Endlesss's own reliable
 * instrument bitmask (drums/bass/notes bits -- see
 * instrumentMaskToSoundType, @shared/riffLibraryTypes); the 4 trait kinds
 * are filtered/ranked by cheap, already-cached StemFeatureCache numeric
 * fields, restricted to stems the mask can't reliably place (audioIn or
 * unmasked) -- the two groups' candidate pools never overlap. Literal
 * string values double as their own UI display text (matching
 * ARRANGE_ROLE_OPTIONS' own established convention, stemRole.ts) except
 * for the 3 camelCase ones, which DiscoverPanel.tsx's own label rendering
 * maps to a hyphenated display string (see DISCOVER_SLOT_KIND_LABEL
 * there) since 'bassHeavy' isn't itself a valid display string. */
export type DiscoverSlotKind =
  | 'drums'
  | 'bass'
  | 'lead'
  | 'bassHeavy'
  | 'rhythmic'
  | 'bright'
  | 'warm'

export const DISCOVER_MASK_SLOT_KINDS: DiscoverSlotKind[] = ['drums', 'bass', 'lead']
export const DISCOVER_TRAIT_SLOT_KINDS: DiscoverSlotKind[] = [
  'bassHeavy',
  'rhythmic',
  'bright',
  'warm'
]
export const DISCOVER_SLOT_KIND_OPTIONS: DiscoverSlotKind[] = [
  ...DISCOVER_MASK_SLOT_KINDS,
  ...DISCOVER_TRAIT_SLOT_KINDS
]

/** Only ever consulted when a slot's stem is actually placed (added to
 * shelf/timeline) -- autoArrangeEngine's diversity weighting and DAW export
 * both need a real ArrangeRole/BusId, which Discover's own matching no
 * longer resolves upfront. Identity for the 3 mask kinds (the mask bit
 * already IS the right answer); a fixed, deliberately approximate table for
 * the 4 trait kinds -- same "cheap, good-enough, not perfect" tradeoff as
 * the instrument-mask short-circuit in stemAutoClassify.ts. */
const DISCOVER_SLOT_KIND_TO_ARRANGE_ROLE: Record<DiscoverSlotKind, ArrangeRole> = {
  drums: 'drums',
  bass: 'bass',
  lead: 'lead',
  bassHeavy: 'bass',
  rhythmic: 'drums',
  bright: 'lead',
  warm: 'aux'
}

export function discoverSlotKindToArrangeRole(kind: DiscoverSlotKind): ArrangeRole {
  return DISCOVER_SLOT_KIND_TO_ARRANGE_ROLE[kind]
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/shared/discoverSlotKind.test.ts`
Expected: PASS, 5 tests

- [ ] **Step 5: Typecheck and lint**

Run: `npm run typecheck && npx eslint --cache src/shared/discoverSlotKind.ts src/shared/discoverSlotKind.test.ts`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add src/shared/discoverSlotKind.ts src/shared/discoverSlotKind.test.ts
git commit -m "Add DiscoverSlotKind type and kind->ArrangeRole mapping"
```

---

### Task 2: Rewrite `getDiscoverCandidates` for the 3 mask kinds

Re-read the CURRENT `src/main/discoverCandidates.ts` and
`src/main/discoverCandidates.test.ts` before starting — both changed
multiple times earlier today; do not trust line numbers from this plan.

**Files:**
- Modify: `src/main/discoverCandidates.ts`
- Modify: `src/main/discoverCandidates.test.ts`

**What changes:**
- `DiscoverCandidate.arrangeRole: ArrangeRole` becomes
  `DiscoverCandidate.slotKind: DiscoverSlotKind`. Also add
  `traitValue: number | null` (used by Task 3/5; always `null` for mask-kind
  candidates, set for trait-kind candidates — added now so Task 2's own
  edits to every `DiscoverCandidate` object literal only happen once).
- `getInstrumentMatchedStemCIDs`'s `arrangeRole: ArrangeRole` parameter
  becomes `slotKind: DiscoverSlotKind`, and its match check changes from
  `SOUND_TYPE_TO_ARRANGE_ROLE[soundType] === arrangeRole` to a direct
  `soundType -> DiscoverSlotKind` check (drums/notes/bass only — this
  function is only ever called for one of the 3 mask kinds now, never a
  trait kind, so `audioIn`/`null` soundType never matches anything here,
  same as today).
- `getDiscoverCandidates`'s own `arrangeRole: ArrangeRole` parameter becomes
  `kind: DiscoverSlotKind`. Its `StemAutoCategory` widening block (the
  `getAutoCategorizedStemCIDs` loop) is REMOVED — per "Before you start"
  above, only the human-confirmed `StemCategories` layer and the
  mask-matched layer remain for mask kinds. This task only handles the 3
  mask kinds; Task 3 adds the trait-kind path as a second branch in the
  same function.

- [ ] **Step 1: Update the failing/changing tests first**

Open `src/main/discoverCandidates.test.ts`. Every `getDiscoverCandidates`
call currently passes `arrangeRole: 'drums'` (or another role) — rename
every one of those to `kind: 'drums'` (etc.). Every `seedAutoCategory(...)`
call feeding a test that currently expects that auto-categorized stem to
show up in `getDiscoverCandidates`'s results for a MASK kind must be
updated: `StemAutoCategory` no longer widens the mask-kind pool, so those
specific stems must now be seeded with a real `Stems.Instrument` mask value
instead (via the existing `seedStem(db, stemCID, jamCID, { instrument })`
helper — already present in this file) if the test still wants them to
appear, or the test's own expectation must change to `toEqual([])` if it was
specifically testing the old StemAutoCategory-widening behavior for a mask
kind (that behavior is being removed, not relocated). Read each test
seeding `StemAutoCategory` for a mask-kind role and decide per-test which
applies; do not guess blindly — the test's own name/comment says which.

Every `DiscoverCandidate` object literal in test assertions
(`toEqual({...})`, `toMatchObject({...})`) that references `arrangeRole`
must become `slotKind`.

Also update `discoverCandidates.test.ts`'s own `seedCategory` /
`seedAutoCategory` helper JSDoc comments if they mention `ArrangeRole`
specifically as this function's own axis (they can stay, `StemCategories`
still uses `ArrangeRole` as its own column — only `getDiscoverCandidates`'s
own parameter/return shape changes).

- [ ] **Step 2: Run the test suite to confirm it now fails against the OLD implementation**

Run: `npx vitest run src/main/discoverCandidates.test.ts`
Expected: FAIL — `kind` doesn't exist on the params type, `slotKind` doesn't
exist on `DiscoverCandidate`, etc. (many compile-level failures, expected —
this is deliberately being driven from the test side first)

- [ ] **Step 3: Update `DiscoverCandidate` and imports**

```ts
// Near the top of discoverCandidates.ts, replace the ArrangeRole-based
// interface with:
import { type DiscoverSlotKind } from '@shared/discoverSlotKind'
// (keep the existing `import { SOUND_TYPE_TO_ARRANGE_ROLE, type ArrangeRole, type DrumSubRole } from '@shared/stemRole'`
// -- ArrangeRole/DrumSubRole are still used by DrumSubRole itself and by
// getRandomLibraryCandidate's own label param in Task 4)

export interface DiscoverCandidate {
  stemCID: string
  jamCID: string
  riffCID: string
  presetName: string
  creatorUserName: string
  slotKind: DiscoverSlotKind
  drumSubRole: DrumSubRole | null
  riffBpm: number
  /** The raw StemFeatureCache field value this candidate was ranked
   * against, for a TRAIT slot kind (bassHeavy/rhythmic/bright/warm) -- see
   * discoverRanking.ts's own trait-distance scoring term. Always null for
   * a mask-kind candidate (drums/bass/lead), which ranks by BPM alone. */
  traitValue: number | null
}
```

- [ ] **Step 4: Rewrite `getInstrumentMatchedStemCIDs`**

```ts
/** Every StemCID, across the given jams, that isn't confirmed
 * (StemCategories) for ANY role -- a real human confirmation always wins --
 * but whose own Endlesss instrument category (Stems.Instrument, a bitmask)
 * directly identifies it as `kind`. Only ever called for one of the 3 MASK
 * kinds (drums/bass/lead) -- an audioIn-masked or unmasked stem never
 * matches here, by design (see this codebase's own real finding, 2026-09-18:
 * audioIn is not a reliable signal, "can indeed be drums though"). */
async function getInstrumentMatchedStemCIDs(
  ownDb: Database.Database,
  jams: JamDbPair[],
  kind: DiscoverSlotKind
): Promise<Set<string>> {
  const confirmedAnyRole = new Set(
    (
      ownDb.prepare(`SELECT StemCID FROM StemCategories WHERE ArrangeRole IS NOT NULL`).all() as {
        StemCID: string
      }[]
    ).map((r) => r.StemCID)
  )

  const jamCIDsByDb = new Map<Database.Database, Set<string>>()
  for (const { jamCID, dbForJam } of jams) {
    const existing = jamCIDsByDb.get(dbForJam)
    if (existing) existing.add(jamCID)
    else jamCIDsByDb.set(dbForJam, new Set([jamCID]))
  }

  const matched = new Set<string>()
  let sinceYield = 0
  for (const [db, allowedJamCIDs] of jamCIDsByDb) {
    const rows = await getInstrumentRowsForDb(db)
    for (const row of rows) {
      if (
        allowedJamCIDs.has(row.OwnerJamCID) &&
        row.Instrument !== null &&
        !confirmedAnyRole.has(row.StemCID) &&
        !matched.has(row.StemCID)
      ) {
        const soundType = instrumentMaskToSoundType(row.Instrument)
        if (
          (soundType === 'drums' && kind === 'drums') ||
          (soundType === 'bass' && kind === 'bass') ||
          (soundType === 'notes' && kind === 'lead')
        ) {
          matched.add(row.StemCID)
        }
      }
      sinceYield += 1
      if (sinceYield >= CLASSIFY_YIELD_EVERY) {
        sinceYield = 0
        await yieldToEventLoop()
      }
    }
  }
  return matched
}
```

- [ ] **Step 5: Rewrite `getDiscoverCandidates`'s mask-kind branch**

Replace the function's `arrangeRole` param with `kind: DiscoverSlotKind`,
remove the `StemAutoCategory` widening block, and update every
`DiscoverCandidate` push to use `slotKind`/`traitValue: null`. The mask-kind
path (everything in this function today) becomes:

```ts
export async function getDiscoverCandidates({
  ownDb,
  jams,
  kind,
  onlyOwnStems = false,
  targetUser
}: {
  ownDb: Database.Database
  jams: JamDbPair[]
  kind: DiscoverSlotKind
  onlyOwnStems?: boolean
  targetUser?: string
}): Promise<DiscoverCandidate[]> {
  if (DISCOVER_TRAIT_SLOT_KINDS.includes(kind)) {
    return getTraitDiscoverCandidates({ ownDb, jams, kind, onlyOwnStems, targetUser })
  }

  // Human-confirmed StemCategories rows for this exact ArrangeRole still
  // win outright -- a real confirmation is trusted even over an ambiguous
  // or missing mask bit. Reuses the SAME ArrangeRole column StemCategories
  // has always had (untouched by this redesign) -- discoverSlotKindToArrangeRole
  // gives the identity mapping for the 3 mask kinds.
  const arrangeRole = discoverSlotKindToArrangeRole(kind)
  const confirmedRows = ownDb
    .prepare(`SELECT StemCID, ArrangeRole, DrumSubRole FROM StemCategories WHERE ArrangeRole = ?`)
    .all(arrangeRole) as { StemCID: string; ArrangeRole: string; DrumSubRole: string | null }[]

  const categoryByStemCID = new Map(confirmedRows.map((row) => [row.StemCID, row]))

  // Live mask match, no StemAutoCategory/embedding widening at all -- see
  // this plan's own "Before you start" note for why.
  const instrumentMatchedStemCIDs = await getInstrumentMatchedStemCIDs(ownDb, jams, kind)
  for (const stemCID of instrumentMatchedStemCIDs) {
    categoryByStemCID.set(stemCID, {
      StemCID: stemCID,
      ArrangeRole: arrangeRole,
      DrumSubRole: null
    })
  }

  if (categoryByStemCID.size === 0) return []

  const confirmedStemCIDs = pickRandomSample(
    [...categoryByStemCID.keys()],
    MAX_CANDIDATE_RESOLUTION_POOL
  )
  const out: DiscoverCandidate[] = []

  const jamCIDsByDb = new Map<Database.Database, Set<string>>()
  for (const { jamCID, dbForJam } of jams) {
    const existing = jamCIDsByDb.get(dbForJam)
    if (existing) existing.add(jamCID)
    else jamCIDsByDb.set(dbForJam, new Set([jamCID]))
  }

  let sinceYield = 0
  for (const [db, allowedJamCIDs] of jamCIDsByDb) {
    const riffIndex = await getRiffIndexForDb(db)
    const matchedStemCIDs = confirmedStemCIDs.filter((cid) => {
      const entry = riffIndex.get(cid)
      return entry !== undefined && allowedJamCIDs.has(entry.ownerJamCID)
    })
    if (matchedStemCIDs.length === 0) continue

    for (const stemCIDChunk of chunk(matchedStemCIDs, CANDIDATE_QUERY_CHUNK_SIZE)) {
      const stemPlaceholders = stemCIDChunk.map(() => '?').join(', ')

      let stemRows: { StemCID: string; PresetName: string | null; CreatorUserName: string | null }[]
      try {
        stemRows = db
          .prepare(
            `SELECT StemCID, PresetName, CreatorUserName FROM Stems WHERE StemCID IN (${stemPlaceholders})`
          )
          .all(...stemCIDChunk) as typeof stemRows
      } catch {
        continue
      }
      const stemByCID = new Map(stemRows.map((row) => [row.StemCID, row]))

      for (const stemCID of stemCIDChunk) {
        const riffInfo = riffIndex.get(stemCID)!
        const category = categoryByStemCID.get(stemCID)
        if (!category) continue

        const stemRow = stemByCID.get(stemCID)
        if (!stemRow) continue

        if (onlyOwnStems && stemRow.CreatorUserName !== targetUser) continue

        out.push({
          stemCID,
          jamCID: riffInfo.ownerJamCID,
          riffCID: riffInfo.riffCID,
          presetName: stemRow.PresetName ?? '',
          creatorUserName: stemRow.CreatorUserName ?? '',
          slotKind: kind,
          drumSubRole: (category.DrumSubRole as DrumSubRole | null) ?? null,
          riffBpm: riffInfo.bpmRnd,
          traitValue: null
        })
      }

      sinceYield += 1
      if (sinceYield >= RIFF_QUERY_YIELD_EVERY) {
        sinceYield = 0
        await yieldToEventLoop()
      }
    }
  }

  return out
}
```

Add the import: `import { DISCOVER_TRAIT_SLOT_KINDS, discoverSlotKindToArrangeRole, type DiscoverSlotKind } from '@shared/discoverSlotKind'`.
`getTraitDiscoverCandidates` is a forward reference to Task 3 — for THIS
task, stub it to satisfy the compiler:

```ts
// Temporary stub -- replaced in full by Task 3. Keeps this task's own tests
// green without depending on Task 3 landing first.
async function getTraitDiscoverCandidates(_args: {
  ownDb: Database.Database
  jams: JamDbPair[]
  kind: DiscoverSlotKind
  onlyOwnStems: boolean
  targetUser?: string
}): Promise<DiscoverCandidate[]> {
  return []
}
```

- [ ] **Step 6: Run the tests and fix any remaining mismatches**

Run: `npx vitest run src/main/discoverCandidates.test.ts`
Expected: PASS for every test exercising a mask kind (`drums`/`bass`/`lead`).
Any test that was specifically about `StemAutoCategory` widening a mask-kind
pool should have been updated in Step 1 to reflect the new behavior — if one
still fails here, re-check Step 1 rather than changing the implementation to
match it.

- [ ] **Step 7: Typecheck and lint**

Run: `npm run typecheck && npx eslint --cache src/main/discoverCandidates.ts src/main/discoverCandidates.test.ts`
Expected: no errors (some `ArrangeRole` import may now be unused in
discoverCandidates.ts if nothing else references it directly — remove if so;
`DrumSubRole` is still used)

- [ ] **Step 8: Commit**

```bash
git add src/main/discoverCandidates.ts src/main/discoverCandidates.test.ts
git commit -m "Discover: mask-based candidate pool for drums/bass/lead slot kinds"
```

---

### Task 3: Trait-kind candidate pool (`bassHeavy`/`rhythmic`/`bright`/`warm`)

**Files:**
- Modify: `src/main/discoverCandidates.ts`
- Modify: `src/main/discoverCandidates.test.ts`

**What changes:** Replaces Task 2's `getTraitDiscoverCandidates` stub with
the real implementation, and adds a `seedFeatures` test helper.

- [ ] **Step 1: Write the failing test**

Add to `src/main/discoverCandidates.test.ts` (near the other seed helpers):

```ts
function seedFeatures(db: Database.Database, stemCID: string, featuresJSON: string): void {
  db.prepare(
    `INSERT INTO StemFeatureCache (StemCID, FeaturesJSON, ExtractedAt) VALUES (?, ?, 1000)`
  ).run(stemCID, featuresJSON)
}

function featuresJSON(overrides: Partial<{
  transientDensity: number
  bassEnergyRatio: number
  spectralCentroidHz: number
  zcrBrightness: number
}> = {}): string {
  return JSON.stringify({
    transientDensity: 0,
    bassEnergyRatio: 0,
    spectralCentroidHz: 0,
    zcrBrightness: 0,
    voicedFraction: 0,
    pitchVarianceCents: 0,
    mfcc: new Array(13).fill(0),
    ...overrides
  })
}
```

Add `StemFeatureCache` to `freshDb()`'s schema (it's likely already there
from earlier work this session -- check first, only add if missing):

```sql
CREATE TABLE IF NOT EXISTS StemFeatureCache (
  StemCID TEXT PRIMARY KEY, FeaturesJSON TEXT NOT NULL, ExtractedAt INTEGER NOT NULL
);
```

Add a new `describe` block:

```ts
describe('getDiscoverCandidates (trait kinds)', () => {
  it('returns bassHeavy candidates ranked by bassEnergyRatio, excluding drums/bass/notes-masked stems', async () => {
    const own = freshDb()
    seedRiff(own, 'r1', 'jam1', 128, ['high', 'low', 'masked-out'])
    seedStem(own, 'high', 'jam1')
    seedFeatures(own, 'high', featuresJSON({ bassEnergyRatio: 0.9 }))
    seedStem(own, 'low', 'jam1')
    seedFeatures(own, 'low', featuresJSON({ bassEnergyRatio: 0.1 }))
    // Drums-masked -- must never appear as a bassHeavy candidate, even with
    // a cached feature row and a high bassEnergyRatio.
    seedStem(own, 'masked-out', 'jam1', { instrument: 1 << 1 })
    seedFeatures(own, 'masked-out', featuresJSON({ bassEnergyRatio: 0.99 }))

    const candidates = await getDiscoverCandidates({
      ownDb: own,
      jams: [{ jamCID: 'jam1', dbForJam: own }],
      kind: 'bassHeavy'
    })
    expect(candidates.map((c) => c.stemCID).sort()).toEqual(['high', 'low'])
    const high = candidates.find((c) => c.stemCID === 'high')!
    expect(high.traitValue).toBeCloseTo(0.9)
    expect(high.slotKind).toBe('bassHeavy')
  })

  it('includes an audioIn-masked stem as a trait candidate (mask alone cannot place it)', async () => {
    const own = freshDb()
    seedRiff(own, 'r1', 'jam1', 128, ['s1'])
    seedStem(own, 's1', 'jam1', { instrument: 1 << 4 }) // audioIn bit
    seedFeatures(own, 's1', featuresJSON({ transientDensity: 0.8 }))

    const candidates = await getDiscoverCandidates({
      ownDb: own,
      jams: [{ jamCID: 'jam1', dbForJam: own }],
      kind: 'rhythmic'
    })
    expect(candidates.map((c) => c.stemCID)).toEqual(['s1'])
  })

  it('excludes a stem with no cached StemFeatureCache row', async () => {
    const own = freshDb()
    seedRiff(own, 'r1', 'jam1', 128, ['s1'])
    seedStem(own, 's1', 'jam1')

    const candidates = await getDiscoverCandidates({
      ownDb: own,
      jams: [{ jamCID: 'jam1', dbForJam: own }],
      kind: 'bright'
    })
    expect(candidates).toEqual([])
  })

  it('respects onlyOwnStems for trait kinds the same way mask kinds already do', async () => {
    const own = freshDb()
    seedRiff(own, 'r1', 'jam1', 128, ['mine', 'theirs'])
    seedStem(own, 'mine', 'jam1', { creatorUserName: 'elling' })
    seedFeatures(own, 'mine', featuresJSON({ zcrBrightness: 0.5 }))
    seedStem(own, 'theirs', 'jam1', { creatorUserName: 'someoneElse' })
    seedFeatures(own, 'theirs', featuresJSON({ zcrBrightness: 0.5 }))

    const candidates = await getDiscoverCandidates({
      ownDb: own,
      jams: [{ jamCID: 'jam1', dbForJam: own }],
      kind: 'warm',
      onlyOwnStems: true,
      targetUser: 'elling'
    })
    expect(candidates.map((c) => c.stemCID)).toEqual(['mine'])
  })
})
```

Check `seedStem`'s existing signature in this file for the exact
`creatorUserName`/`instrument` field names it already accepts (it's used
elsewhere in this file already) and match it exactly — do not invent a
different shape.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/discoverCandidates.test.ts -t "trait kinds"`
Expected: FAIL — the stub from Task 2 returns `[]` for every case

- [ ] **Step 3: Implement `getTraitDiscoverCandidates`**

Replace Task 2's stub with:

```ts
// Field this trait kind ranks/filters candidates by, within StemFeatures.
// 'bright' and 'warm' share the SAME underlying field (spectralCentroidHz)
// -- one spectral-brightness axis, two opposite targets, not two
// independent measurements (see this feature's own design spec).
const TRAIT_FIELD: Record<
  'bassHeavy' | 'rhythmic' | 'bright' | 'warm',
  keyof Pick<StemFeatures, 'bassEnergyRatio' | 'transientDensity' | 'spectralCentroidHz'>
> = {
  bassHeavy: 'bassEnergyRatio',
  rhythmic: 'transientDensity',
  bright: 'spectralCentroidHz',
  warm: 'spectralCentroidHz'
}

interface FeatureCandidateRow {
  StemCID: string
  FeaturesJSON: string
}

interface TraitMatchedStem {
  stemCID: string
  jamCID: string
  featureValue: number
}

/** Candidate pool for the 4 TRAIT slot kinds -- everything a reliable
 * instrument-mask read can't place (audioIn-masked or unmasked), AND not
 * already human-confirmed for any role, ranked by a cheap, already-cached
 * StemFeatureCache numeric field. Never overlaps with the 3 mask kinds' own
 * pool (getInstrumentMatchedStemCIDs above) -- a drums/bass/notes-masked
 * stem, or a stem confirmed via Tidy Up for ANY role, is excluded here even
 * if it also has a cached feature row.
 *
 * StemFeatureCache stores each stem's own features as one JSON blob
 * (FeaturesJSON), not separate SQL columns -- same "fetch raw rows, parse
 * in JS" convention stemAutoClassify.ts's own fetchPendingFeatureBatch
 * already uses, since there's no SQL-level way to ORDER BY a JSON field
 * without relying on SQLite's JSON1 extension, which nothing else in this
 * codebase depends on.
 *
 * Bounded via a cheap COUNT + ONE random-offset `ORDER BY StemCID LIMIT/
 * OFFSET` page (code review, 2026-09-18) -- NOT `ORDER BY RANDOM() LIMIT`,
 * which was this function's own first-draft shape and is a real bug class
 * this file has already hit and fixed more than once elsewhere
 * (buildRiffIndex/getInstrumentRowsForDb's own doc comments): SQLite must
 * assign a sort key to and fully sort EVERY row before LIMIT ever applies,
 * so cost scales with the WHOLE table, not the requested pool size -- the
 * exact "one unbounded synchronous SQL statement" freeze shape already
 * root-caused at real scale in this same file. A random OFFSET into an
 * `ORDER BY StemCID` scan (which DOES use the primary-key index) gives
 * real per-roll variety -- a different contiguous slice of the table each
 * call -- at a fraction of the cost, same accepted "OFFSET cost grows with
 * how far in you land, still fast in practice" tradeoff
 * discoverIndexCache.ts's own pagination already relies on. */
async function getTraitDiscoverCandidates({
  ownDb,
  jams,
  kind,
  onlyOwnStems,
  targetUser
}: {
  ownDb: Database.Database
  jams: JamDbPair[]
  kind: DiscoverSlotKind
  onlyOwnStems: boolean
  targetUser?: string
}): Promise<DiscoverCandidate[]> {
  const field = TRAIT_FIELD[kind as keyof typeof TRAIT_FIELD]

  let total: number
  try {
    total = (ownDb.prepare(`SELECT COUNT(*) AS n FROM StemFeatureCache`).get() as { n: number }).n
  } catch {
    return []
  }
  if (total === 0) return []

  const offset =
    total > MAX_CANDIDATE_RESOLUTION_POOL
      ? Math.floor(Math.random() * (total - MAX_CANDIDATE_RESOLUTION_POOL))
      : 0
  let rows: FeatureCandidateRow[]
  try {
    rows = ownDb
      .prepare(
        `SELECT StemCID, FeaturesJSON FROM StemFeatureCache ORDER BY StemCID LIMIT ? OFFSET ?`
      )
      .all(MAX_CANDIDATE_RESOLUTION_POOL, offset) as FeatureCandidateRow[]
  } catch {
    return []
  }
  if (rows.length === 0) return []

  // Merge Instrument-mask rows across every unique db in `jams` -- a
  // stem's own Stems row (and thus its mask) can live in a different db
  // than ownDb's own StemFeatureCache (external LORE archive stems still
  // get their features cached in ownDb). Reuses the SAME per-db cache the
  // mask-kind path already warms. dbByStemCID (not just jamCID) is
  // captured here too, so the second pass below can group survivors by DB
  // CONNECTION directly -- see that pass's own comment for why that
  // matters.
  const jamCIDsByDb = new Map<Database.Database, Set<string>>()
  for (const { jamCID, dbForJam } of jams) {
    const existing = jamCIDsByDb.get(dbForJam)
    if (existing) existing.add(jamCID)
    else jamCIDsByDb.set(dbForJam, new Set([jamCID]))
  }
  const instrumentByStemCID = new Map<string, number | null>()
  const dbByStemCID = new Map<string, Database.Database>()
  const jamCIDByStemCID = new Map<string, string>()
  for (const [db, allowedJamCIDs] of jamCIDsByDb) {
    const instrumentRows = await getInstrumentRowsForDb(db)
    for (const row of instrumentRows) {
      if (!allowedJamCIDs.has(row.OwnerJamCID)) continue
      instrumentByStemCID.set(row.StemCID, row.Instrument)
      dbByStemCID.set(row.StemCID, db)
      jamCIDByStemCID.set(row.StemCID, row.OwnerJamCID)
    }
  }

  // Same cross-role-leakage guard getInstrumentMatchedStemCIDs already
  // uses (code review, 2026-09-18) -- without this, a stem a human has
  // confirmed via Tidy Up for SOME role, but whose raw mask is audioIn or
  // unset, would leak into a trait-kind pool too, silently breaking the
  // "mask kinds and trait kinds never overlap" invariant this function's
  // own doc comment promises.
  const confirmedAnyRole = new Set(
    (
      ownDb.prepare(`SELECT StemCID FROM StemCategories WHERE ArrangeRole IS NOT NULL`).all() as {
        StemCID: string
      }[]
    ).map((r) => r.StemCID)
  )

  const matched: TraitMatchedStem[] = []
  let sinceYield = 0
  for (const row of rows) {
    // A single `do {} while (false)` block with `break` on every
    // disqualifying condition -- so `sinceYield` below increments exactly
    // ONCE per row regardless of which condition (if any) disqualified it
    // (code review, 2026-09-18: the original version only incremented on
    // SOME of this loop's exit paths, an inconsistency with every other
    // yield-counted loop in this file).
    do {
      if (confirmedAnyRole.has(row.StemCID)) break

      const instrument = instrumentByStemCID.get(row.StemCID)
      if (instrument !== undefined && instrument !== null) {
        const soundType = instrumentMaskToSoundType(instrument)
        if (soundType === 'drums' || soundType === 'bass' || soundType === 'notes') break
      }

      const jamCID = jamCIDByStemCID.get(row.StemCID)
      if (jamCID === undefined) break // not among the caller's own jams

      let features: StemFeatures
      try {
        features = JSON.parse(row.FeaturesJSON) as StemFeatures
      } catch {
        break
      }

      matched.push({ stemCID: row.StemCID, jamCID, featureValue: features[field] })
    } while (false)

    sinceYield += 1
    if (sinceYield >= CLASSIFY_YIELD_EVERY) {
      sinceYield = 0
      await yieldToEventLoop()
    }
  }
  if (matched.length === 0) return []

  // Second pass: resolve riff/Stems metadata for exactly the stems that
  // survived filtering above -- grouped by DB CONNECTION (dbByStemCID,
  // captured above), NOT by jamCID (code review, 2026-09-18): grouping by
  // jamCID here would reintroduce the exact "one query per jam" bug
  // getInstrumentMatchedStemCIDs's own doc comment already documents as a
  // real, previously-fixed live incident (5,057 separate round trips on a
  // real library) -- survivors drawn from a random slice of the whole
  // library will typically span many jams sharing one db connection.
  const byDb = new Map<Database.Database, TraitMatchedStem[]>()
  for (const entry of matched) {
    const db = dbByStemCID.get(entry.stemCID)
    if (!db) continue
    const list = byDb.get(db)
    if (list) list.push(entry)
    else byDb.set(db, [entry])
  }

  const result: DiscoverCandidate[] = []
  let sinceYield2 = 0
  for (const [db, entries] of byDb) {
    const riffIndex = await getRiffIndexForDb(db)

    for (const entryChunk of chunk(entries, CANDIDATE_QUERY_CHUNK_SIZE)) {
      const stemCIDs = entryChunk.map((e) => e.stemCID)
      const placeholders = stemCIDs.map(() => '?').join(', ')
      let stemRows: { StemCID: string; PresetName: string | null; CreatorUserName: string | null }[]
      try {
        stemRows = db
          .prepare(
            `SELECT StemCID, PresetName, CreatorUserName FROM Stems WHERE StemCID IN (${placeholders})`
          )
          .all(...stemCIDs) as typeof stemRows
      } catch {
        continue
      }
      const stemByCID = new Map(stemRows.map((r) => [r.StemCID, r]))

      for (const entry of entryChunk) {
        const riffInfo = riffIndex.get(entry.stemCID)
        if (!riffInfo) continue
        const stemRow = stemByCID.get(entry.stemCID)
        if (!stemRow) continue
        if (onlyOwnStems && stemRow.CreatorUserName !== targetUser) continue

        result.push({
          stemCID: entry.stemCID,
          jamCID: riffInfo.ownerJamCID,
          riffCID: riffInfo.riffCID,
          presetName: stemRow.PresetName ?? '',
          creatorUserName: stemRow.CreatorUserName ?? '',
          slotKind: kind,
          drumSubRole: null,
          riffBpm: riffInfo.bpmRnd,
          traitValue: entry.featureValue
        })
      }

      sinceYield2 += 1
      if (sinceYield2 >= RIFF_QUERY_YIELD_EVERY) {
        sinceYield2 = 0
        await yieldToEventLoop()
      }
    }
  }

  return result
}
```

Add the import: `import type { StemFeatures } from '@shared/stemFeatures'`.

Add three more tests to the same `describe('getDiscoverCandidates (trait
kinds)')` block, covering the code-review fixes above:

```ts
  it('excludes a stem already confirmed (StemCategories) for ANY role, even with no reliable mask signal', async () => {
    const own = freshDb()
    seedRiff(own, 'r1', 'jam1', 128, ['confirmed-elsewhere'])
    seedStem(own, 'confirmed-elsewhere', 'jam1') // no instrument mask at all
    seedFeatures(own, 'confirmed-elsewhere', featuresJSON({ bassEnergyRatio: 0.9 }))
    seedCategory(own, 'confirmed-elsewhere', { arrangeRole: 'vocal' })

    const candidates = await getDiscoverCandidates({
      ownDb: own,
      jams: [{ jamCID: 'jam1', dbForJam: own }],
      kind: 'bassHeavy'
    })
    expect(candidates).toEqual([])
  })

  it('skips a stem with malformed FeaturesJSON rather than crashing', async () => {
    const own = freshDb()
    seedRiff(own, 'r1', 'jam1', 128, ['broken', 'good'])
    seedStem(own, 'broken', 'jam1')
    db_insertRawFeaturesJSON(own, 'broken', 'not valid json{{{')
    seedStem(own, 'good', 'jam1')
    seedFeatures(own, 'good', featuresJSON({ bassEnergyRatio: 0.5 }))

    const candidates = await getDiscoverCandidates({
      ownDb: own,
      jams: [{ jamCID: 'jam1', dbForJam: own }],
      kind: 'bassHeavy'
    })
    expect(candidates.map((c) => c.stemCID)).toEqual(['good'])
  })

  it('does not throw when a jam in the caller-supplied list has no matching db entry for a surviving stem', async () => {
    const own = freshDb()
    seedRiff(own, 'r1', 'jam1', 128, ['s1'])
    seedStem(own, 's1', 'jam1')
    seedFeatures(own, 's1', featuresJSON({ bassEnergyRatio: 0.5 }))

    // Empty jams list -- s1 is sampled from StemFeatureCache but has no
    // known owning jam/db at all, matching the real "stem exists in the
    // feature cache but the caller's own jams list doesn't cover it"
    // shape this function must tolerate rather than throw on.
    await expect(
      getDiscoverCandidates({ ownDb: own, jams: [], kind: 'bassHeavy' })
    ).resolves.toEqual([])
  })
```

`db_insertRawFeaturesJSON` above is a placeholder name for a tiny new test
helper (`function db_insertRawFeaturesJSON(db, stemCID, rawJson): void`,
same one-line `INSERT INTO StemFeatureCache` shape as `seedFeatures` but
taking the raw string directly instead of routing it through
`JSON.stringify` first) — add it next to `seedFeatures`, or just write the
malformed-JSON test using `seedFeatures`'s own `db.prepare(...).run(...)`
call inline with a literal bad string; either is fine, name it sensibly
rather than using the placeholder name literally.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/discoverCandidates.test.ts`
Expected: PASS, every test in the file including the new `(trait kinds)`
block

- [ ] **Step 5: Typecheck and lint**

Run: `npm run typecheck && npx eslint --cache src/main/discoverCandidates.ts src/main/discoverCandidates.test.ts`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add src/main/discoverCandidates.ts src/main/discoverCandidates.test.ts
git commit -m "Discover: trait-based candidate pool for bassHeavy/rhythmic/bright/warm slot kinds"
```

---

### Task 4: Update `getRandomLibraryCandidate`/`getRandomOwnStemCandidate`

**Files:**
- Modify: `src/main/discoverCandidates.ts`
- Modify: `src/main/discoverCandidates.test.ts`

These two functions don't filter by role/kind at all today — they just
LABEL an unclassified random stem with whatever the caller asked for. Purely
mechanical: rename their own `arrangeRole: ArrangeRole` parameter to
`kind: DiscoverSlotKind`, and every `DiscoverCandidate` object literal they
build gets `slotKind: kind, traitValue: null` instead of `arrangeRole`.

- [ ] **Step 1: Update the tests**

In `discoverCandidates.test.ts`, find every `getRandomLibraryCandidate(...)`
call passing `arrangeRole: '...'` and rename to `kind: '...'`. Update any
assertion checking `.arrangeRole` on the returned candidate to `.slotKind`.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/main/discoverCandidates.test.ts`
Expected: FAIL — type errors on the renamed field

- [ ] **Step 3: Update the implementation**

In `getRandomLibraryCandidate`, rename the `arrangeRole` param to `kind:
DiscoverSlotKind` in its own params type, and change its one
`DiscoverCandidate` return literal's `arrangeRole,` line to `slotKind:
kind,\n      traitValue: null,`. Do the exact same rename in
`getRandomOwnStemCandidate` (same param, same one return literal). Update
`getRandomLibraryCandidate`'s own call to `getRandomOwnStemCandidate` to
pass `kind` instead of `arrangeRole`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/discoverCandidates.test.ts`
Expected: PASS, full file

- [ ] **Step 5: Typecheck and lint**

Run: `npm run typecheck && npx eslint --cache src/main/discoverCandidates.ts src/main/discoverCandidates.test.ts`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add src/main/discoverCandidates.ts src/main/discoverCandidates.test.ts
git commit -m "Discover: rename ArrangeRole param to DiscoverSlotKind on random-candidate helpers"
```

---

### Task 5: Trait-distance scoring in `rankCandidates`

Re-read the CURRENT `src/shared/discoverRanking.ts` and
`src/shared/discoverRanking.test.ts` before starting.

**Files:**
- Modify: `src/shared/discoverRanking.ts`
- Modify: `src/shared/discoverRanking.test.ts`

- [ ] **Step 1: Update the test file's `candidate()` helper and write the failing tests**

In `discoverRanking.test.ts`, change the `candidate()` helper's default
`arrangeRole: 'drums'` to `slotKind: 'drums', traitValue: null` (matching
`DiscoverCandidate`'s new shape from Task 2). Every existing test in this
file keeps passing unchanged after this — they don't set a `targetTrait`
option, so the new scoring term stays inert for them (see Step 3).

Add:

```ts
describe('rankCandidates (trait scoring)', () => {
  it('scores a candidate closer to the trait target higher, for a trait-kind roll', () => {
    const close = candidate({ stemCID: 'close', riffBpm: 128, traitValue: 0.95 })
    const far = candidate({ stemCID: 'far', riffBpm: 128, traitValue: 0.1 })
    const ranked = rankCandidates([far, close], {
      targetBpm: 128,
      targetTrait: { direction: 'high', maxValue: 1 }
    })
    expect(ranked[0].candidate.stemCID).toBe('close')
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score)
  })

  it('"low" direction ranks the smallest traitValue highest -- for the warm end of bright/warm', () => {
    const warm = candidate({ stemCID: 'warm', riffBpm: 128, traitValue: 0.05 })
    const bright = candidate({ stemCID: 'bright', riffBpm: 128, traitValue: 0.9 })
    const ranked = rankCandidates([bright, warm], {
      targetBpm: 128,
      targetTrait: { direction: 'low', maxValue: 1 }
    })
    expect(ranked[0].candidate.stemCID).toBe('warm')
  })

  it('a candidate with traitValue null (e.g. mixed into a trait roll by mistake) scores as the worst possible trait match, not a crash', () => {
    const withTrait = candidate({ stemCID: 'has-trait', riffBpm: 128, traitValue: 0.5 })
    const noTrait = candidate({ stemCID: 'no-trait', riffBpm: 128, traitValue: null })
    expect(() =>
      rankCandidates([withTrait, noTrait], {
        targetBpm: 128,
        targetTrait: { direction: 'high', maxValue: 1 }
      })
    ).not.toThrow()
  })

  it('omitting targetTrait ranks purely by BPM, exactly like today -- mask-kind rolls are unaffected', () => {
    const close = candidate({ stemCID: 'close', riffBpm: 128, traitValue: 0.01 })
    const far = candidate({ stemCID: 'far', riffBpm: 90, traitValue: 0.99 })
    const ranked = rankCandidates([far, close], { targetBpm: 128 })
    expect(ranked[0].candidate.stemCID).toBe('close')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/shared/discoverRanking.test.ts`
Expected: FAIL — `targetTrait` doesn't exist on the options type yet

- [ ] **Step 3: Implement the trait-distance term**

```ts
// Added to a trait-kind candidate's own BPM score before weighting, same
// additive-with-tunable-weight shape as FAVOURITE_BOOST above -- direct
// request, 2026-09-18: rank trait-kind rolls (bassHeavy/rhythmic/bright/
// warm) by real closeness to the target end of their own StemFeatureCache
// field, on top of the existing BPM term (never a replacement for it).
// 1 (not larger, unlike FAVOURITE_BOOST's 1.5) -- a trait roll's WHOLE
// point is trait closeness, so it should be able to meaningfully outweigh
// a BPM-only near-miss, but doesn't need to be an even bigger gap than
// FAVOURITE_BOOST's own deliberately-dominant weight.
const TRAIT_SCORE_WEIGHT = 1

export interface TraitTarget {
  /** Which end of the field's own real range this roll targets --
   * 'high' for bassHeavy/rhythmic/bright, 'low' for warm (see
   * DiscoverSlotKind's own doc comment: bright/warm share one field, two
   * opposite targets). */
  direction: 'high' | 'low'
  /** The field's own plausible max value, for normalizing distance into a
   * 0-1 score -- StemFeatures' own continuous fields are roughly 0-1 already
   * (bassEnergyRatio, transientDensity, zcrBrightness) except
   * spectralCentroidHz (real Hz values, a few hundred to a few thousand) --
   * callers pass whatever's appropriate for the field actually being
   * targeted. */
  maxValue: number
}

/** Normalized [0, 1] closeness to the trait target -- 1 at the extreme
 * (direction='high': traitValue === maxValue; direction='low':
 * traitValue === 0), degrading linearly toward 0 at the opposite extreme.
 * A null traitValue (a candidate somehow missing its own feature value)
 * scores 0 -- worst possible trait match, never a crash or a NaN leaking
 * into the final score. */
function traitScore(traitValue: number | null, target: TraitTarget): number {
  if (traitValue === null || target.maxValue <= 0) return 0
  const normalized = Math.max(0, Math.min(1, traitValue / target.maxValue))
  return target.direction === 'high' ? normalized : 1 - normalized
}

export function rankCandidates(
  candidates: DiscoverCandidate[],
  {
    targetBpm,
    favouriteStemCIDs,
    targetTrait
  }: { targetBpm: number; favouriteStemCIDs?: Set<string>; targetTrait?: TraitTarget }
): RankedCandidate[] {
  return candidates
    .map((candidate) => {
      const bpmDistance = Math.abs(candidate.riffBpm - targetBpm)
      let score = Math.max(0, 1 - bpmDistance / BPM_FALLOFF)
      if (favouriteStemCIDs?.has(candidate.stemCID)) score += FAVOURITE_BOOST
      if (targetTrait) score += traitScore(candidate.traitValue, targetTrait) * TRAIT_SCORE_WEIGHT
      return { candidate, score }
    })
    .sort((a, b) => b.score - a.score)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/shared/discoverRanking.test.ts`
Expected: PASS, full file (existing BPM/favourite tests AND the new trait
ones)

- [ ] **Step 5: Typecheck and lint**

Run: `npm run typecheck && npx eslint --cache src/shared/discoverRanking.ts src/shared/discoverRanking.test.ts`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add src/shared/discoverRanking.ts src/shared/discoverRanking.test.ts
git commit -m "Discover: add trait-distance scoring term to rankCandidates"
```

---

### Task 6: `discoverAdjacency.ts` — kind-aware `matchRole`

Re-read the CURRENT `src/main/discoverAdjacency.ts` and
`src/main/discoverAdjacency.test.ts` before starting.

**Files:**
- Modify: `src/main/discoverAdjacency.ts`
- Modify: `src/main/discoverAdjacency.test.ts`

**What changes:** `getAdjacentDiscoverCandidates`'s `role: ArrangeRole`
param becomes `kind: DiscoverSlotKind`. `AdjacentDiscoverCandidate`'s
`arrangeRole` field becomes `slotKind` (+ `traitValue`, matching
`DiscoverCandidate`'s own new shape from Task 2 — `AdjacentDiscoverCandidate
extends DiscoverCandidate`). `matchRole`'s own matching logic stops calling
`resolveStemArrangeRole` (a DB round trip per stem) and instead checks each
resolved stem's own `instrumentMask` directly for the 3 mask kinds, or
whether it HAS a cached `StemFeatureCache` row (fetched once per stem, same
per-stem cost shape as today) for the 4 trait kinds — first qualifying stem
in a riff wins, same "one candidate per matching riff" shape as today (no
best-of-N trait ranking within a single riff — see this plan's own "Before
you start" note).

**No existing test coverage for `getAdjacentDiscoverCandidates`/`matchRole`
to preserve**: `discoverAdjacency.test.ts` today only tests the pure,
dependency-free `walkAdjacentWindow` helper (confirmed by reading the whole
file — 71 lines, one `describe` block, `vi.mock` isn't even imported).
`getAdjacentDiscoverCandidates` itself depends on several `riffLibraryStore.ts`
exports (`resolveRiffWithContext`, `listRiffs`, `resolveRiff`,
`downloadMissingStems`, `resolveStemPath`) plus `openOwnRiffLibraryDb`, none
of which have an established mock shape in this file — building that mock
harness from scratch is a bigger investment than this rename+rewrite task
warrants on its own. This task does NOT add new automated coverage for
`matchRole`; it's verified by typecheck (the type-level rename forces every
call site to agree) plus the manual walkthrough checklist in Task 8 Step 7,
which includes a line for this. If `matchRole` coverage is wanted later,
that's a real, separate follow-up task (a mock harness for
`riffLibraryStore.ts`'s own multi-function surface), not part of this plan.

- [ ] **Step 1: Update `walkAdjacentWindow`'s own existing tests**

`walkAdjacentWindow` itself is untouched by this task (pure, kind-agnostic)
— `discoverAdjacency.test.ts` needs NO changes for it. Run it once now to
confirm the baseline is green before touching the implementation:

Run: `npx vitest run src/main/discoverAdjacency.test.ts`
Expected: PASS, 4 tests (the existing baseline)

- [ ] **Step 2: Rewrite `matchRole` and `getAdjacentDiscoverCandidates`**

```ts
import {
  DISCOVER_TRAIT_SLOT_KINDS,
  type DiscoverSlotKind
} from '@shared/discoverSlotKind'
import type { StemFeatures } from '@shared/stemFeatures'
// Remove the now-unused imports: guessSoundTypeFromPresetName,
// resolveStemArrangeRole, SOUND_TYPE_TO_ARRANGE_ROLE (keep ArrangeRole only
// if AdjacentDiscoverCandidate or another type in this file still needs it
// -- it doesn't once DiscoverCandidate itself no longer carries arrangeRole,
// per Task 2 -- remove the import if unused, typecheck will confirm).

export interface AdjacentDiscoverCandidate extends DiscoverCandidate {
  path: string
  soundType: SoundType | null
}

// Field this trait kind's adjacency match requires a cached row for --
// mirrors discoverCandidates.ts's own TRAIT_FIELD table exactly (kept as a
// separate small copy here rather than exported/shared, matching this
// codebase's own "small duplicated tables are cheaper than coupling two
// independently-scoped files" convention used elsewhere, e.g.
// DiscoverLibraryScan.tsx's own BATCH_SIZE not importing from
// BackgroundFeatureScan.tsx).
const TRAIT_FIELD: Record<
  'bassHeavy' | 'rhythmic' | 'bright' | 'warm',
  keyof Pick<StemFeatures, 'bassEnergyRatio' | 'transientDensity' | 'spectralCentroidHz'>
> = {
  bassHeavy: 'bassEnergyRatio',
  rhythmic: 'transientDensity',
  bright: 'spectralCentroidHz',
  warm: 'spectralCentroidHz'
}

export async function getAdjacentDiscoverCandidates(
  centerRiffCID: string,
  kind: DiscoverSlotKind
): Promise<AdjacentWalkResult<AdjacentDiscoverCandidate>> {
  const context = resolveRiffWithContext(centerRiffCID)
  if (!context) return { newer: [], older: [] }

  const windowOffset = Math.max(0, context.rank - ADJACENT_FETCH_PER_DIRECTION)
  const page = listRiffs(context.jamCID, {
    offset: windowOffset,
    limit: ADJACENT_FETCH_PER_DIRECTION * 2 + 1
  })
  const centerIndex = page.riffs.findIndex((r) => r.riffCID === context.matchedRiffCID)
  if (centerIndex === -1) return { newer: [], older: [] }

  const jamCID = context.jamCID
  const ownDb = openOwnRiffLibraryDb()
  const isTraitKind = DISCOVER_TRAIT_SLOT_KINDS.includes(kind)

  async function matchRole(summary: { riffCID: string }): Promise<AdjacentDiscoverCandidate | null> {
    const resolved = resolveRiff(summary.riffCID)
    if (!resolved) return null
    for (const stem of resolved.stems) {
      const soundType = instrumentMaskToSoundType(stem.instrumentMask)

      if (!isTraitKind) {
        // Mask kinds: direct check, same shape as
        // discoverCandidates.ts's own getInstrumentMatchedStemCIDs.
        const isMatch =
          (soundType === 'drums' && kind === 'drums') ||
          (soundType === 'bass' && kind === 'bass') ||
          (soundType === 'notes' && kind === 'lead')
        if (!isMatch) continue
        return {
          stemCID: stem.stemCID,
          jamCID,
          riffCID: summary.riffCID,
          presetName: stem.presetName,
          creatorUserName: stem.creatorUserName,
          slotKind: kind,
          drumSubRole: null,
          riffBpm: resolved.bpm,
          traitValue: null,
          soundType,
          path: resolveStemPath(jamCID, stem.stemCID)
        }
      }

      // Trait kinds: excluded if the mask reliably places it elsewhere
      // (drums/bass/notes already belong to the 3 mask kinds' own pool),
      // otherwise needs a cached StemFeatureCache row to have any trait
      // value to match on at all.
      if (soundType === 'drums' || soundType === 'bass' || soundType === 'notes') continue
      const featureRow = ownDb
        .prepare(`SELECT FeaturesJSON FROM StemFeatureCache WHERE StemCID = ?`)
        .get(stem.stemCID) as { FeaturesJSON: string } | undefined
      if (!featureRow) continue
      let features: StemFeatures
      try {
        features = JSON.parse(featureRow.FeaturesJSON) as StemFeatures
      } catch {
        continue
      }
      return {
        stemCID: stem.stemCID,
        jamCID,
        riffCID: summary.riffCID,
        presetName: stem.presetName,
        creatorUserName: stem.creatorUserName,
        slotKind: kind,
        drumSubRole: null,
        riffBpm: resolved.bpm,
        traitValue: features[TRAIT_FIELD[kind as keyof typeof TRAIT_FIELD]],
        soundType,
        path: resolveStemPath(jamCID, stem.stemCID)
      }
    }
    return null
  }

  const result = await walkAdjacentWindow(
    page.riffs,
    centerIndex,
    matchRole,
    ADJACENT_MATCHES_PER_DIRECTION
  )

  await Promise.all([...result.newer, ...result.older].map((c) => downloadMissingStems(c.riffCID)))

  return result
}
```

- [ ] **Step 3: Run the existing (untouched) test file to confirm nothing broke**

Run: `npx vitest run src/main/discoverAdjacency.test.ts`
Expected: PASS, the same 4 `walkAdjacentWindow` tests from Step 1 — this
file has no test of `matchRole` itself to run here (see this task's own
note above), so this step only confirms the untouched pure-function tests
still pass alongside the rewritten code in the same file.

- [ ] **Step 4: Typecheck and lint**

Run: `npm run typecheck && npx eslint --cache src/main/discoverAdjacency.ts src/main/discoverAdjacency.test.ts`
Expected: no errors — pay attention to unused-import warnings for
`guessSoundTypeFromPresetName`/`resolveStemArrangeRole`/
`SOUND_TYPE_TO_ARRANGE_ROLE`/`ArrangeRole` and remove whichever are now
genuinely unused in this file

- [ ] **Step 5: Commit**

```bash
git add src/main/discoverAdjacency.ts src/main/discoverAdjacency.test.ts
git commit -m "Discover: make adjacent-riff matching DiscoverSlotKind-aware"
```

---

### Task 7: `main/index.ts` and `preload/index.ts` — IPC layer

`getDiscoverCandidates`, `getRandomLibraryCandidate`, and
`getAdjacentDiscoverCandidates` are all called from the renderer over IPC —
the main-process handlers AND the preload-exposed signatures both still
pass `arrangeRole`/`role` today and must be updated in lockstep with Tasks
2-6, before Task 8 touches the renderer side that calls them.

**Files:**
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`

No test file for either — these are thin IPC plumbing, verified by
typecheck (the renamed types force every call site to agree) same as the
rest of this plan's own React-adjacent layer.

- [ ] **Step 1: Update the three IPC handlers in `main/index.ts`**

Find (via `grep -n "get-discover-candidates\|get-random-discover-candidate\|get-adjacent-discover-candidates" src/main/index.ts`
— re-confirm line numbers fresh) and replace:

```ts
ipcMain.handle(
  'get-discover-candidates',
  async (
    _event,
    arrangeRole: ArrangeRole,
    onlyOwnStems: boolean,
    targetUser?: string
  ): Promise<DiscoverCandidate[]> => {
    const t0 = Date.now()
    const jams = listJamsWithDb().map(({ jamCID, db }) => ({ jamCID, dbForJam: db }))
    const t1 = Date.now()
    console.log(
      `get-discover-candidates(${arrangeRole}): listJamsWithDb -- ${jams.length} jams in ${t1 - t0}ms`
    )
    const result = await getDiscoverCandidates({
      ownDb: openOwnRiffLibraryDb(),
      jams,
      arrangeRole,
      onlyOwnStems,
      targetUser
    })
    console.log(
      `get-discover-candidates(${arrangeRole}): getDiscoverCandidates -- ${result.length} candidates in ${Date.now() - t1}ms`
    )
    return result
  }
)

ipcMain.handle(
  'get-random-discover-candidate',
  (
    _event,
    arrangeRole: ArrangeRole,
    onlyOwnStems: boolean,
    targetUser?: string
  ): Promise<DiscoverCandidate | null> =>
    getRandomLibraryCandidate({
      jams: listJamsWithDb().map(({ jamCID, db }) => ({ jamCID, dbForJam: db })),
      arrangeRole,
      onlyOwnStems,
      targetUser
    })
)

ipcMain.handle(
  'get-adjacent-discover-candidates',
  (_event, centerRiffCID: string, role: ArrangeRole) =>
    getAdjacentDiscoverCandidates(centerRiffCID, role)
)
```

with:

```ts
ipcMain.handle(
  'get-discover-candidates',
  async (
    _event,
    kind: DiscoverSlotKind,
    onlyOwnStems: boolean,
    targetUser?: string
  ): Promise<DiscoverCandidate[]> => {
    const t0 = Date.now()
    const jams = listJamsWithDb().map(({ jamCID, db }) => ({ jamCID, dbForJam: db }))
    const t1 = Date.now()
    console.log(
      `get-discover-candidates(${kind}): listJamsWithDb -- ${jams.length} jams in ${t1 - t0}ms`
    )
    const result = await getDiscoverCandidates({
      ownDb: openOwnRiffLibraryDb(),
      jams,
      kind,
      onlyOwnStems,
      targetUser
    })
    console.log(
      `get-discover-candidates(${kind}): getDiscoverCandidates -- ${result.length} candidates in ${Date.now() - t1}ms`
    )
    return result
  }
)

ipcMain.handle(
  'get-random-discover-candidate',
  (
    _event,
    kind: DiscoverSlotKind,
    onlyOwnStems: boolean,
    targetUser?: string
  ): Promise<DiscoverCandidate | null> =>
    getRandomLibraryCandidate({
      jams: listJamsWithDb().map(({ jamCID, db }) => ({ jamCID, dbForJam: db })),
      kind,
      onlyOwnStems,
      targetUser
    })
)

ipcMain.handle(
  'get-adjacent-discover-candidates',
  (_event, centerRiffCID: string, kind: DiscoverSlotKind) =>
    getAdjacentDiscoverCandidates(centerRiffCID, kind)
)
```

Add `import type { DiscoverSlotKind } from '@shared/discoverSlotKind'` near
this file's other `@shared` imports. Leave the existing `ArrangeRole` import
in place — `resolve-stem-arrange-roles` (a different, untouched handler,
around line ~1000) still uses it.

- [ ] **Step 2: Update the three preload-exposed methods in `preload/index.ts`**

Find (via `grep -n "getDiscoverCandidates\|getRandomDiscoverCandidate\|getAdjacentDiscoverCandidates" src/preload/index.ts`)
and replace:

```ts
getDiscoverCandidates: (
  arrangeRole: ArrangeRole,
  onlyOwnStems: boolean,
  targetUser?: string
): Promise<DiscoverCandidate[]> =>
  ipcRenderer.invoke('get-discover-candidates', arrangeRole, onlyOwnStems, targetUser),
getRandomDiscoverCandidate: (
  arrangeRole: ArrangeRole,
  onlyOwnStems: boolean,
  targetUser?: string
): Promise<DiscoverCandidate | null> =>
  ipcRenderer.invoke('get-random-discover-candidate', arrangeRole, onlyOwnStems, targetUser),
getAdjacentDiscoverCandidates: (
  centerRiffCID: string,
  role: ArrangeRole
): Promise<{ newer: AdjacentDiscoverCandidate[]; older: AdjacentDiscoverCandidate[] }> =>
```

with:

```ts
getDiscoverCandidates: (
  kind: DiscoverSlotKind,
  onlyOwnStems: boolean,
  targetUser?: string
): Promise<DiscoverCandidate[]> =>
  ipcRenderer.invoke('get-discover-candidates', kind, onlyOwnStems, targetUser),
getRandomDiscoverCandidate: (
  kind: DiscoverSlotKind,
  onlyOwnStems: boolean,
  targetUser?: string
): Promise<DiscoverCandidate | null> =>
  ipcRenderer.invoke('get-random-discover-candidate', kind, onlyOwnStems, targetUser),
getAdjacentDiscoverCandidates: (
  centerRiffCID: string,
  kind: DiscoverSlotKind
): Promise<{ newer: AdjacentDiscoverCandidate[]; older: AdjacentDiscoverCandidate[] }> =>
```

(the function body on the line after `getAdjacentDiscoverCandidates`'s
signature — `ipcRenderer.invoke('get-adjacent-discover-candidates',
centerRiffCID, role)` — also needs `role` renamed to `kind`; re-check the
line immediately following what's shown above and update it too.)

Add `import type { DiscoverSlotKind } from '@shared/discoverSlotKind'` near
this file's other `@shared` imports. Leave the existing `ArrangeRole` import
in place if anything else in this file still uses it (check with a fresh
grep — `resolveStemArrangeRoles`'s own exposed method likely still does).

- [ ] **Step 3: Typecheck and lint**

Run: `npm run typecheck && npx eslint --cache src/main/index.ts src/preload/index.ts`
Expected: type errors at every renderer call site that still passes
`arrangeRole`/`role` positionally with the old meaning — these are exactly
the call sites Task 8 fixes next; seeing them fail here confirms the IPC
layer itself is now correctly typed. Do not silence or work around these
errors in this task — Task 8 resolves them.

- [ ] **Step 4: Commit**

```bash
git add src/main/index.ts src/preload/index.ts
git commit -m "Discover: rename ArrangeRole param to DiscoverSlotKind across the IPC layer"
```

---

### Task 8: `DiscoverPanel.tsx` — slot kind rename and UI

Re-read the CURRENT `src/renderer/src/components/DiscoverPanel.tsx` before
starting — it's a large file (3400+ lines) that changed multiple times
earlier today. Re-grep for every occurrence of `role`/`arrangeRole`/
`ArrangeRole`/`ARRANGE_ROLE_OPTIONS` in this file fresh (there is no
guarantee the line numbers below still match) rather than trusting this
plan's own line references.

**Files:**
- Modify: `src/renderer/src/components/DiscoverPanel.tsx`
- Modify: `src/renderer/src/components/DiscoverNearbyPopover.tsx`

No test file for either — per this codebase's own established convention,
React component changes are verified via typecheck + lint + manual
walkthrough, not new automated tests (see CLAUDE.md's own Testing
conventions section).

- [ ] **Step 1: Update imports**

Replace:
```ts
import { ARRANGE_ROLE_OPTIONS, resolveStemRole, type ArrangeRole } from '@shared/stemRole'
```
with:
```ts
import { resolveStemRole } from '@shared/stemRole'
import { DISCOVER_SLOT_KIND_OPTIONS, type DiscoverSlotKind } from '@shared/discoverSlotKind'
```
(`resolveStemRole` is still used elsewhere in this file for seed-stem role
guessing on external drag-and-drop imports — keep it; only
`ARRANGE_ROLE_OPTIONS`/`ArrangeRole` are being replaced. If `ArrangeRole` is
still referenced anywhere else in this file after the rest of this task's
edits, keep that import too — check with a fresh grep before removing it.)

- [ ] **Step 2: Rename `DiscoverSlot.role` to `DiscoverSlot.kind`**

In the `DiscoverSlot` interface (`role: ArrangeRole`), rename to `kind:
DiscoverSlotKind`.

Then, mechanically, everywhere in this file that reads or sets `slot.role`
(confirmed occurrences as of this plan's own investigation — re-grep for
`\.role\b` fresh, since line numbers drift): `addSlot`'s own `role:
ArrangeRole` parameter becomes `kind: DiscoverSlotKind`; every place it
builds a new slot object (`{ id, role, locked: false, ... }`) becomes `{ id,
kind, locked: false, ... }`; `rollForSlot`/`rollRandomForSlot`'s own `role:
ArrangeRole` parameters become `kind: DiscoverSlotKind`, and their own calls
into `getDiscoverCandidates`/`getRandomLibraryCandidate` pass `kind:` instead
of `arrangeRole:`; every `slot.role` read (in `rollForSlot`/
`rollRandomForSlot` call sites, the `roles = [...new Set(placeable.map((s)
=> s.role))]` dedup, the seed-stem-anchor's `arrangeRole: slot.role` builder
around line ~2748 which becomes `slotKind: slot.kind, traitValue: null,`)
becomes `slot.kind`; the slot label span (`{slot.role}` around line ~3352)
becomes `{slot.kind}`; `DiscoverNearbyPopover`'s own `role={slot.role}` prop
becomes `kind={slot.kind}` (its own prop type needs updating too — see Step
4); `ARRANGE_ROLE_OPTIONS[0]` (used once, seeding the very first slot for a
brand-new empty project) becomes `DISCOVER_SLOT_KIND_OPTIONS[0]` (still
`'drums'`, since mask kinds are listed first in `DISCOVER_SLOT_KIND_OPTIONS`
— see Task 1).

- [ ] **Step 3: Update the slot-creation button row**

Find the `{ARRANGE_ROLE_OPTIONS.map((role) => (...))}` block (the "+ drums /
+ bass / ..." row). Replace with:

```tsx
{DISCOVER_SLOT_KIND_OPTIONS.map((kind) => (
  <button
    key={kind}
    onClick={() => addSlot(kind)}
    style={{
      fontFamily: 'inherit',
      fontSize: 9,
      padding: '4px 8px',
      background: 'transparent',
      border: 'none',
      color: 'var(--ra-text-2)',
      cursor: 'pointer'
    }}
  >
    + {DISCOVER_SLOT_KIND_LABEL[kind]}
  </button>
))}
```

Add a small label lookup near the top of this file (module scope, next to
other constants), since `'bassHeavy'` isn't itself a valid display string
(the other 6 kinds ARE their own valid display text, matching
`ARRANGE_ROLE_OPTIONS`'s own established "the value IS the label" convention
— only this one needs a real mapping):

```ts
const DISCOVER_SLOT_KIND_LABEL: Record<DiscoverSlotKind, string> = {
  drums: 'drums',
  bass: 'bass',
  lead: 'lead',
  bassHeavy: 'bass-heavy',
  rhythmic: 'rhythmic',
  bright: 'bright',
  warm: 'warm'
}
```

Also use `DISCOVER_SLOT_KIND_LABEL[slot.kind]` (not the raw `slot.kind`) for
the per-slot-row label span from Step 2, so `bassHeavy` reads as
"bass-heavy" there too, not literal camelCase.

- [ ] **Step 4: Update `DiscoverNearbyPopover.tsx`'s own prop type**

Replace:

```ts
import type { ArrangeRole } from '@shared/stemRole'
```

with:

```ts
import type { DiscoverSlotKind } from '@shared/discoverSlotKind'
```

Replace the component's own prop:

```ts
  role: ArrangeRole
```

with:

```ts
  kind: DiscoverSlotKind
```

Replace its own destructured prop name and every use of it:

```ts
export function DiscoverNearbyPopover({
  x,
  y,
  startCandidate,
  role,
  onPick,
  onClose,
  ignoreRef
}: {
```

becomes

```ts
export function DiscoverNearbyPopover({
  x,
  y,
  startCandidate,
  kind,
  onPick,
  onClose,
  ignoreRef
}: {
```

and further down in the same component:

```ts
  const resultKey = `${centerCandidate.riffCID}:${role}`

  useEffect(() => {
    let cancelled = false
    window.rifffApi
      .getAdjacentDiscoverCandidates(centerCandidate.riffCID, role)
      .then((candidates) => {
        if (!cancelled) setResult({ key: resultKey, candidates })
      })
      .catch((err) => {
        console.error('DiscoverNearbyPopover: getAdjacentDiscoverCandidates failed:', err)
        if (!cancelled) setResult({ key: resultKey, candidates: { newer: [], older: [] } })
      })
    return () => {
      cancelled = true
    }
  }, [centerCandidate.riffCID, role, resultKey])
```

becomes

```ts
  const resultKey = `${centerCandidate.riffCID}:${kind}`

  useEffect(() => {
    let cancelled = false
    window.rifffApi
      .getAdjacentDiscoverCandidates(centerCandidate.riffCID, kind)
      .then((candidates) => {
        if (!cancelled) setResult({ key: resultKey, candidates })
      })
      .catch((err) => {
        console.error('DiscoverNearbyPopover: getAdjacentDiscoverCandidates failed:', err)
        if (!cancelled) setResult({ key: resultKey, candidates: { newer: [], older: [] } })
      })
    return () => {
      cancelled = true
    }
  }, [centerCandidate.riffCID, kind, resultKey])
```

Back in `DiscoverPanel.tsx`, the `<DiscoverNearbyPopover ... role={slot.role} ... />`
JSX prop (updated in Step 2 above to `kind={slot.kind}`) now matches this
new prop name.

- [ ] **Step 5: Default externally-imported samples to a trait kind, not a guessed ArrangeRole**

Find `importPathsAsLoopSeeds` (shared by the drag-and-drop drop handler and
the "+ sample" file-picker button, shipped earlier the same day). It
currently guesses a role for the new slot via `resolveStemRole` and uses it
directly:

```ts
      const roleGuessStem: Stem = { slot: 1, ...seedStem }
      const { arrangeRole } = resolveStemRole(roleGuessStem, roleGuessStem.path, null)

      newSlots.push({
        id: freshSlotId(),
        role: arrangeRole,
```

An externally-imported sample has no Endlesss `Instrument` mask at all (it
was never an Endlesss stem) — it can never be a genuine mask-kind (`drums`/
`bass`/`lead`) candidate in the new model, only a trait kind. Computing a
real trait value for it on the spot would mean running feature extraction
synchronously at import time, which is real per-file cost this whole
redesign exists to avoid paying casually. Default it to a single fixed
trait kind instead — arbitrary but deterministic, consistent with "cheap
and fast" over "exactly right for every case":

```ts
      newSlots.push({
        id: freshSlotId(),
        kind: 'bright',
```

Remove the now-unused `roleGuessStem`/`resolveStemRole` call entirely (the
`arrangeRole` guess isn't used for anything else in this function). If
`resolveStemRole`/`Stem` (the type) end up unused anywhere else in this
file after this change, remove their imports too — check with a fresh grep
before removing (per Step 1's own note, `resolveStemRole` may still be
needed elsewhere; only remove if genuinely unused now).

- [ ] **Step 6: Typecheck and lint**

Run: `npm run typecheck && npx eslint --cache src/renderer/src/components/DiscoverPanel.tsx src/renderer/src/components/DiscoverNearbyPopover.tsx`
Expected: no errors. Fix every reported mismatch — do not leave any
`ArrangeRole`/`role`/`arrangeRole` reference unconverted; the typechecker
will surface each one.

- [ ] **Step 7: Manual walkthrough**

Per this codebase's own testing convention, this environment cannot click
through the real Electron app — report explicitly that this step needs
Elling's own hands-on testing, and hand him this checklist:

- Open Discover on an existing project. Confirm the slot-creation row now
  reads "+ drums / + bass / + lead / + bass-heavy / + rhythmic / + bright /
  + warm" (7 buttons, not 8).
- Click "+ drums" — a new slot appears, labeled "drums", with a real
  candidate loaded.
- Click "+ bass-heavy" — a new slot appears, labeled "bass-heavy", with a
  real candidate loaded.
- Click "similar"/"random" on both a mask-kind slot and a trait-kind slot —
  each still rerolls to a new candidate.
- Click "adjacent" on both a mask-kind slot and a trait-kind slot (this is
  the one code path in this whole plan with no automated test coverage at
  all, per Task 6's own note — this manual check is its only verification).
- Add a bass-heavy slot's stem to the shelf/timeline — confirm it lands on
  a sensible bus (bass) in the resulting arrangement, not an error or a
  missing bus.
- Drag an external (non-Endlesss) sample file onto the panel, or use "+
  sample" — confirm the new slot is labeled "bright" (the new fixed
  default) rather than erroring or silently guessing something else.
- Confirm the earlier-reported symptom (a `notes`-masked stem showing up in
  the `drums` slot) no longer reproduces on a few fresh drums rolls.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/components/DiscoverPanel.tsx src/renderer/src/components/DiscoverNearbyPopover.tsx
git commit -m "Discover: rename slot role to DiscoverSlotKind, 7-button slot-creation row"
```

---

### Task 9: `discoverSeed.ts` and `LibraryBrowser.tsx` — the Browse/Shelf seed paths

**Found mid-execution, not in the original plan**: Task 2's own implementer
correctly flagged that `npm run typecheck` shows real errors beyond
`discoverCandidates.ts` itself — `src/renderer/src/audio/discoverSeed.ts`
and `src/renderer/src/components/LibraryBrowser.tsx` both construct
`DiscoverCandidate`/`DiscoverSlot` objects with `arrangeRole`/`role` fields
directly, entirely OUTSIDE `getDiscoverCandidates`. These are Discover's two
"seed from something that already exists" paths (Shelf-sourced and
Browse-sourced) — this plan's original file inventory missed them. This
task closes that gap.

**Files:**
- Modify: `src/renderer/src/audio/discoverSeed.ts`
- Modify: `src/renderer/src/components/LibraryBrowser.tsx`

No test file for either — same established convention as Task 8 (React/
renderer-adjacent code here is verified via typecheck + lint + manual
walkthrough, not new automated tests).

**What changes and why:** Both paths currently guess a role via one of two
mechanisms that this whole redesign moves away from for Discover's own
matching: `buildSeedSlotsFromStems` (Shelf-sourced) calls `resolveStemRole`
(the same heuristic Tidy Up's own role picker uses — untouched elsewhere,
per this plan's own "does not change" list, but not what Discover's new
model should seed a slot's KIND from); `seedDiscoverFromBrowseRiff`
(Browse-sourced, in `LibraryBrowser.tsx`) calls the `resolve-stem-arrange-
roles` IPC handler, which trusts `StemCategories`/`StemAutoCategory` —
exactly the fallible machine-guessed layer Task 2 just stopped trusting for
mask-kind candidate pools.

The fix: a new, small, PURE `discoverSlotKindForSoundType` helper in
`discoverSeed.ts`, used by both paths, that maps a stem's own `SoundType`
directly to a `DiscoverSlotKind` — `drums`/`bass`/`notes` map to their
obvious mask kind (`notes` → `lead`, matching `SOUND_TYPE_TO_ARRANGE_ROLE`'s
own existing convention), everything else (`audioIn`, `fx`, `extInst`,
`sampler`, `extFx` — none of which have a reliable mask-kind signal) falls
back to a single fixed trait kind, `'bright'` — the SAME "cheap and fast
over exactly right" default Task 8 already established for externally
dragged-in samples (no per-stem computation, no IPC round trip, no
classifier). This ELIMINATES the `resolve-stem-arrange-roles` IPC call from
`seedDiscoverFromBrowseRiff` entirely (do not remove the IPC handler itself
— `resolve-stem-arrange-roles` may have other callers; only stop calling it
from THIS call site) and the `resolveStemRole` call from
`buildSeedSlotsFromStems` (check with a fresh grep whether `resolveStemRole`
is still imported/used anywhere else in `discoverSeed.ts` after this change
— if not, remove the now-unused import).

- [ ] **Step 1: Re-read both files fresh**

Run `grep -n "arrangeRole\|ArrangeRole\|resolveStemArrangeRoles\|resolveStemRole" src/renderer/src/audio/discoverSeed.ts src/renderer/src/components/LibraryBrowser.tsx`
and read the surrounding context for every hit — do not trust this plan's
own quoted line numbers or code below without confirming it still matches.

- [ ] **Step 2: Add `discoverSlotKindForSoundType` to `discoverSeed.ts`**

```ts
import type { SoundType } from '@shared/types'
import type { DiscoverSlotKind } from '@shared/discoverSlotKind'

/** Best-effort DiscoverSlotKind for a stem's own SoundType -- used by both
 * seed paths in this file (Shelf-sourced and, via LibraryBrowser.tsx,
 * Browse-sourced). A real Endlesss instrument mask reliably identifies
 * drums/bass/notes (see reliableMaskSoundType, stemAutoClassify.ts, for
 * the same real-data finding this mirrors); everything else -- audioIn,
 * fx, extInst, sampler, extFx -- has no reliable mask-kind signal, so it
 * falls back to a single fixed trait kind rather than guessing, same
 * "cheap and fast over exactly right" tradeoff as DiscoverPanel.tsx's own
 * external-sample-import default (see that file's own doc comment on why
 * 'bright' specifically). */
export function discoverSlotKindForSoundType(soundType: SoundType): DiscoverSlotKind {
  if (soundType === 'drums') return 'drums'
  if (soundType === 'bass') return 'bass'
  if (soundType === 'notes') return 'lead'
  return 'bright'
}
```

- [ ] **Step 3: Update `buildSeedSlotsFromStems`**

Replace:

```ts
    const { arrangeRole } = resolveStemRole(stem, stem.path, null)
    return {
      id: freshSlotId(),
      role: arrangeRole,
      locked: false,
      candidate: null,
      hasRerolled: true,
      gain: 1,
      seedStem
    }
```

with:

```ts
    return {
      id: freshSlotId(),
      kind: discoverSlotKindForSoundType(stem.type),
      locked: false,
      candidate: null,
      hasRerolled: true,
      gain: 1,
      seedStem
    }
```

If `resolveStemRole` is no longer used anywhere else in this file, remove
its now-unused import (`import { resolveStemRole } from '@shared/stemRole'`).

- [ ] **Step 4: Update `buildSeedSlotsFromCandidates`**

Replace:

```ts
export function buildSeedSlotsFromCandidates(
  candidates: readonly DiscoverCandidate[]
): DiscoverSlot[] {
  return candidates.slice(0, MAX_SEED_SLOTS).map((candidate) => ({
    id: freshSlotId(),
    role: candidate.arrangeRole,
    locked: false,
    candidate,
    hasRerolled: true,
    gain: 1
  }))
}
```

with:

```ts
export function buildSeedSlotsFromCandidates(
  candidates: readonly DiscoverCandidate[]
): DiscoverSlot[] {
  return candidates.slice(0, MAX_SEED_SLOTS).map((candidate) => ({
    id: freshSlotId(),
    kind: candidate.slotKind,
    locked: false,
    candidate,
    hasRerolled: true,
    gain: 1
  }))
}
```

- [ ] **Step 5: Update `seedDiscoverFromBrowseRiff` in `LibraryBrowser.tsx`**

Replace:

```ts
      const roles = await window.rifffApi.resolveStemArrangeRoles(
        resolvedRiff.stems.map((stem) => ({
          stemCID: stem.stemCID,
          instrumentMask: stem.instrumentMask,
          presetName: stem.presetName
        }))
      )
      const candidates: DiscoverCandidate[] = resolvedRiff.stems.map((stem) => ({
        stemCID: stem.stemCID,
        jamCID: selectedJamCID,
        riffCID: selectedRiffCID,
        presetName: stem.presetName,
        creatorUserName: stem.creatorUserName,
        arrangeRole:
          roles[stem.stemCID] ??
          SOUND_TYPE_TO_ARRANGE_ROLE[
            instrumentMaskToSoundType(stem.instrumentMask) ??
              guessSoundTypeFromPresetName(stem.presetName) ??
              'fx'
          ],
        drumSubRole: null,
        riffBpm: resolvedRiff.bpm
      }))
```

with:

```ts
      const candidates: DiscoverCandidate[] = resolvedRiff.stems.map((stem) => ({
        stemCID: stem.stemCID,
        jamCID: selectedJamCID,
        riffCID: selectedRiffCID,
        presetName: stem.presetName,
        creatorUserName: stem.creatorUserName,
        slotKind: discoverSlotKindForSoundType(
          instrumentMaskToSoundType(stem.instrumentMask) ??
            guessSoundTypeFromPresetName(stem.presetName) ??
            'fx'
        ),
        drumSubRole: null,
        riffBpm: resolvedRiff.bpm,
        traitValue: null
      }))
```

Update the import at the top of the file:
`import { buildSeedSlotsFromCandidates, discoverHasRealContent } from '../audio/discoverSeed'`
becomes
`import { buildSeedSlotsFromCandidates, discoverSlotKindForSoundType, discoverHasRealContent } from '../audio/discoverSeed'`.

If `SOUND_TYPE_TO_ARRANGE_ROLE` (`import { SOUND_TYPE_TO_ARRANGE_ROLE } from '@shared/stemRole'`)
is no longer used anywhere else in this file, remove its now-unused import
— check with a fresh grep first (this file is large; it may have other,
unrelated uses). This change also means `seedDiscoverFromBrowseRiff` no
longer NEEDS to `await` an IPC round trip before building `candidates` —
leave the function `async`/the rest of its own `try`/`finally` (`setBusy`)
structure exactly as it is; only the one block above changes. Do NOT remove
or modify the `resolve-stem-arrange-roles` IPC handler itself (`main/
index.ts`) or its preload exposure — this task only stops ONE caller from
using it; it may have other real callers elsewhere in the app that are
out of scope for this plan.

- [ ] **Step 6: Typecheck and lint**

Run: `npm run typecheck && npx eslint --cache src/renderer/src/audio/discoverSeed.ts src/renderer/src/components/LibraryBrowser.tsx`
Expected: no errors. If typecheck still shows errors in OTHER files not yet
touched by this plan's own sequencing, cross-check them against this plan's
full task list (Tasks 1-9) before assuming something else is broken — a
file this plan hasn't reached yet touching `DiscoverCandidate`/
`DiscoverSlot` is expected only if it's `DiscoverPanel.tsx`/
`DiscoverNearbyPopover.tsx` and Task 8 hasn't run yet relative to this one,
or vice versa; anything else is a genuine new gap and should be reported
the same way Task 2's implementer reported this one.

- [ ] **Step 7: Manual walkthrough note**

Add to the SAME manual walkthrough checklist Task 8 Step 7 already produces
(don't create a second, separate checklist) — report this alongside it:

- Open Browse, select a riff, click "seed Discover from this riff" (or
  however that action is currently labeled) — confirm Discover opens with
  real slots, each labeled with a sensible kind (drums-masked stems show
  "drums", etc.), not an error or empty slots.
- From Shelf, seed Discover from an existing placed rifff — same check.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/audio/discoverSeed.ts src/renderer/src/components/LibraryBrowser.tsx
git commit -m "Discover: DiscoverSlotKind for the Browse/Shelf seed paths"
```

---

### Task 10: Full verification sweep

Not a code task — confirms every prior task's own local verification still
holds true together, across the whole changed surface.

- [ ] **Step 1: Full typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 2: Full lint**

Run: `npx eslint --cache .`
Expected: no errors (fix any warnings introduced by this plan's own changes;
pre-existing warnings elsewhere in the codebase are out of scope)

- [ ] **Step 3: Full test suite**

Run: `npx vitest run`
Expected: every test file passes, including every one this plan touched
(`discoverSlotKind.test.ts`, `discoverCandidates.test.ts`,
`discoverRanking.test.ts`, `discoverAdjacency.test.ts`) and every OTHER test
file untouched by this plan (confirms no unrelated regression)

- [ ] **Step 4: Grep sweep for any leftover `ArrangeRole`/`arrangeRole` reference in Discover's own files**

Run: `grep -rn "ArrangeRole\|arrangeRole" src/main/discoverCandidates.ts src/main/discoverAdjacency.ts src/main/index.ts src/preload/index.ts src/renderer/src/components/DiscoverPanel.tsx src/renderer/src/components/DiscoverNearbyPopover.tsx src/renderer/src/audio/discoverSeed.ts src/renderer/src/components/LibraryBrowser.tsx`
Expected: zero matches from Discover's own new code, OR only matches inside
a comment explicitly explaining the `DiscoverSlotKind -> ArrangeRole`
mapping boundary (Task 1's own `discoverSlotKindToArrangeRole` and its call
site at add-to-shelf/add-to-timeline time) — `main/index.ts`/
`preload/index.ts` will still show real, unrelated `ArrangeRole` matches
from `resolve-stem-arrange-roles` (untouched by this plan, see Task 7 Step
1's own note); every OTHER reference should have been converted or removed
by Tasks 2-9 (Task 9 in particular should leave `SOUND_TYPE_TO_ARRANGE_ROLE`
and `resolveStemArrangeRoles` with ZERO remaining references in
`LibraryBrowser.tsx` — that file's own separate PolarGlyph-preview code,
around line ~2153 as of this plan's own investigation, uses
`instrumentMaskToSoundType`/`guessSoundTypeFromPresetName` directly for an
unrelated display glyph, never `SOUND_TYPE_TO_ARRANGE_ROLE`). If a genuine
leftover is found (not the `resolve-stem-arrange-roles` handler itself),
fix it now.

- [ ] **Step 5: Report the manual walkthrough checklist back**

Report Task 8 Step 7's checklist AND Task 9 Step 7's own two additional
items to Elling directly (the controller/session running this plan), since
this environment cannot itself click through the
real app — do not consider this plan complete until he's actually run
through it.
