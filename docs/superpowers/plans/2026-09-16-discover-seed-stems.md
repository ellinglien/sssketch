# Discover Seed Stems Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Discover start from an existing riff's own stems (picked from
Browse or the Shelf) instead of only from scratch, fully tinkerable from
there exactly like any other Discover loop.

**Architecture:** A new pure module builds `DiscoverSlot[]` from either an
already-resolved list of `Stem`s (Shelf) or a list of `DiscoverCandidate`s
(Browse). `DiscoverSlot` gains one new optional field so a slot can start
already-resolved (Shelf) instead of only ever starting from an unresolved
candidate (the existing, unchanged path -- also what Browse-seeded slots
use). Two new UI triggers (a button in `LibraryBrowser.tsx`'s own
already-existing riff-detail panel for Browse, a right-click on a
`Shelf.tsx` tile for Shelf) call the builder, then hand off to Discover.

**Tech Stack:** No new dependencies. Reuses `resolveStemRole`/
`SOUND_TYPE_TO_ARRANGE_ROLE` (`@shared/stemRole`), the existing
`resolveCandidateStem`/`DiscoverSlotRow` resolution machinery, and this
codebase's own established `window.confirm` discard-guard convention.

---

## Before you start

Every task below quotes exact current code from files touched heavily this
session (`DiscoverPanel.tsx` especially). Match by CODE CONTENT, not line
numbers -- search for each quoted snippet's own exact text. If a snippet's
surrounding shape has changed by more than a line or two of drift, STOP and
escalate rather than guessing how to reconcile it.

---

### Task 1: DiscoverPanel.tsx -- export what Task 2 needs, add the new field

**Files:**
- Modify: `src/renderer/src/components/DiscoverPanel.tsx`

Four small, mechanical changes, all in this one file.

**1a. Export `ResolvedCandidateStem`.**

Find (search for the exact text):

```typescript
interface ResolvedCandidateStem {
  author: string
  name: string
  type: SoundType
  path: string
  durationSec: number
  barLength: number
}
```

Replace with:

```typescript
export interface ResolvedCandidateStem {
  author: string
  name: string
  type: SoundType
  path: string
  durationSec: number
  barLength: number
}
```

**1b. Export `freshSlotId`.**

Find (search for the exact text):

```typescript
let nextSlotId = 0
function freshSlotId(): string {
  nextSlotId += 1
  return `slot-${nextSlotId}`
}
```

Replace with:

```typescript
let nextSlotId = 0
export function freshSlotId(): string {
  nextSlotId += 1
  return `slot-${nextSlotId}`
}
```

**1c. Hoist `DISCOVER_UNDO_LIMIT` to module scope and export it** -- so
`LibraryBrowser.tsx` (Task 4/5) can push undo snapshots using the exact
same cap, instead of duplicating the magic number `20` in a second file.

Find (search for the exact text -- this is currently INSIDE the
`DiscoverPanel` component body):

```typescript
  // Undo/redo for Discover's own slot-CONTENT actions (add/remove slot,
  // reroll one, random-reroll one, reroll all) -- deliberately excludes
  // lock/mute/solo toggles and gain drags, see undoStack's own doc comment
  // on this component's props above. Capped so a very long Discover
  // session doesn't grow an unbounded history in memory.
  const DISCOVER_UNDO_LIMIT = 20
```

Delete it from that spot entirely (including the comment), and add this at
module scope instead -- directly above the `export function DiscoverPanel({`
line (search for that exact text to find the insertion point):

```typescript
// Undo/redo for Discover's own slot-CONTENT actions (add/remove slot,
// reroll one, random-reroll one, reroll all, and seeding -- see Task 4/5 of
// docs/superpowers/plans/2026-09-16-discover-seed-stems.md) -- deliberately
// excludes lock/mute/solo toggles and gain drags, see undoStack's own doc
// comment on this component's props below. Capped so a very long Discover
// session doesn't grow an unbounded history in memory. Exported so
// LibraryBrowser.tsx's own seed-triggering handlers (which own the lifted
// undoStack/setUndoStack state directly) can push a snapshot using the
// exact same cap, rather than duplicating this number in a second file.
export const DISCOVER_UNDO_LIMIT = 20

export function DiscoverPanel({
```

(Every other internal use of `DISCOVER_UNDO_LIMIT` inside the component
body -- `pushUndoSnapshot`, `undoDiscoverAction`, `redoDiscoverAction` --
stays completely unchanged; a module-scoped const is still visible inside
the function body exactly the same as a locally-declared one was.)

**1d. Add the new `seedStem` field to `DiscoverSlot`.**

Find (search for the exact text):

```typescript
export interface DiscoverSlot {
  id: string
  role: ArrangeRole
  locked: boolean
  candidate: DiscoverCandidate | null
```

Replace with:

```typescript
export interface DiscoverSlot {
  id: string
  role: ArrangeRole
  locked: boolean
  candidate: DiscoverCandidate | null
  /** An already-resolved stem this slot should start showing immediately,
   * bypassing `candidate`-based resolution entirely -- set only by seeding
   * Discover from an existing riff's stems that are ALREADY local/resolved
   * (a Shelf-sourced riff's own real Stem data has no riffCID/stemCID to
   * build a DiscoverCandidate from at all; see
   * docs/superpowers/specs/2026-09-16-discover-seed-stems-design.md).
   * Browse-sourced seeding does NOT use this field -- it sets `candidate`
   * instead, going through the normal (lazy, per-row) resolution path, so
   * a Browse-seeded slot shows the same "downloading + analyzing…" state a
   * fresh roll already does. Always `undefined` for a normally-rolled
   * slot. Cleared back to `undefined` the moment this slot is rerolled (see
   * `rollForSlot`/`rollRandomForSlot` below) -- a reroll always fully
   * supersedes whatever this slot started as. */
  seedStem?: ResolvedCandidateStem
```

**Steps:**

1. Make all four edits above (1a-1d).
2. Typecheck and lint: `npm run typecheck && npx eslint src/renderer/src/components/DiscoverPanel.tsx` -- expect 0 errors, 0 warnings.
3. Run the full test suite: `npx vitest run` -- expect the same pass count as before this task (no regressions).
4. Commit:

```bash
git add src/renderer/src/components/DiscoverPanel.tsx
git commit -m "DiscoverPanel: export types/const, add DiscoverSlot.seedStem field"
```

---

### Task 2: New module -- build seed slots from Stems or DiscoverCandidates

**Files:**
- Create: `src/renderer/src/audio/discoverSeed.ts`
- Test: `src/renderer/src/audio/discoverSeed.test.ts`

Depends on Task 1's exports (`freshSlotId`, `ResolvedCandidateStem`, and
`DiscoverSlot` itself, already exported before this plan started).

This is pure logic (no Electron/DOM dependency) -- same convention
`discoverRifffAssembly.ts` already follows in this same directory.

- [ ] **Step 1: Write the failing tests**

```typescript
// src/renderer/src/audio/discoverSeed.test.ts
import { describe, expect, it } from 'vitest'
import { buildSeedSlotsFromStems, buildSeedSlotsFromCandidates } from './discoverSeed'
import type { Stem } from '@shared/types'
import type { DiscoverCandidate } from '../../../main/discoverCandidates'

function fixtureStem(overrides: Partial<Stem> = {}): Stem {
  return {
    slot: 1,
    author: 'elling',
    name: 'a stem',
    type: 'drums',
    path: '/a.wav',
    durationSec: 4,
    barLength: 4,
    ...overrides
  }
}

function fixtureCandidate(overrides: Partial<DiscoverCandidate> = {}): DiscoverCandidate {
  return {
    stemCID: 'stem-1',
    jamCID: 'jam-1',
    riffCID: 'riff-1',
    presetName: 'a preset',
    creatorUserName: 'elling',
    arrangeRole: 'drums',
    drumSubRole: null,
    riffBpm: 120,
    ...overrides
  }
}

describe('buildSeedSlotsFromStems', () => {
  it('returns one slot per stem, in order, each locked: false', () => {
    const stems = [
      fixtureStem({ name: 'kick', type: 'drums' }),
      fixtureStem({ name: 'bassline', type: 'bass' })
    ]
    const slots = buildSeedSlotsFromStems(stems)
    expect(slots).toHaveLength(2)
    expect(slots[0].seedStem?.name).toBe('kick')
    expect(slots[1].seedStem?.name).toBe('bassline')
    expect(slots.every((s) => s.locked === false)).toBe(true)
  })

  it('infers role from stem type via the same guessing resolveStemRole already uses', () => {
    const slots = buildSeedSlotsFromStems([fixtureStem({ type: 'bass', name: 'a random name' })])
    expect(slots[0].role).toBe('bass')
  })

  it('each slot has candidate: null and hasRerolled: true, gain: 1', () => {
    const slots = buildSeedSlotsFromStems([fixtureStem()])
    expect(slots[0].candidate).toBeNull()
    expect(slots[0].hasRerolled).toBe(true)
    expect(slots[0].gain).toBe(1)
  })

  it('gives every slot a fresh, distinct id', () => {
    const slots = buildSeedSlotsFromStems([fixtureStem(), fixtureStem()])
    expect(slots[0].id).not.toBe(slots[1].id)
  })

  it('caps at 8 slots even if given more stems', () => {
    const stems = Array.from({ length: 10 }, (_, i) => fixtureStem({ name: `stem-${i}` }))
    const slots = buildSeedSlotsFromStems(stems)
    expect(slots).toHaveLength(8)
    expect(slots[0].seedStem?.name).toBe('stem-0')
    expect(slots[7].seedStem?.name).toBe('stem-7')
  })

  it('returns an empty array for an empty input', () => {
    expect(buildSeedSlotsFromStems([])).toEqual([])
  })
})

describe('buildSeedSlotsFromCandidates', () => {
  it('returns one slot per candidate, in order, with that candidate set and role from it', () => {
    const candidates = [
      fixtureCandidate({ stemCID: 'a', arrangeRole: 'drums' }),
      fixtureCandidate({ stemCID: 'b', arrangeRole: 'bass' })
    ]
    const slots = buildSeedSlotsFromCandidates(candidates)
    expect(slots).toHaveLength(2)
    expect(slots[0].candidate?.stemCID).toBe('a')
    expect(slots[0].role).toBe('drums')
    expect(slots[1].candidate?.stemCID).toBe('b')
    expect(slots[1].role).toBe('bass')
  })

  it('each slot has seedStem: undefined, locked: false, hasRerolled: true, gain: 1', () => {
    const slots = buildSeedSlotsFromCandidates([fixtureCandidate()])
    expect(slots[0].seedStem).toBeUndefined()
    expect(slots[0].locked).toBe(false)
    expect(slots[0].hasRerolled).toBe(true)
    expect(slots[0].gain).toBe(1)
  })

  it('caps at 8 slots even if given more candidates', () => {
    const candidates = Array.from({ length: 10 }, (_, i) =>
      fixtureCandidate({ stemCID: `stem-${i}` })
    )
    expect(buildSeedSlotsFromCandidates(candidates)).toHaveLength(8)
  })

  it('returns an empty array for an empty input', () => {
    expect(buildSeedSlotsFromCandidates([])).toEqual([])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/renderer/src/audio/discoverSeed.test.ts`
Expected: FAIL -- `Cannot find module './discoverSeed'` (the file doesn't
exist yet).

- [ ] **Step 3: Write the implementation**

```typescript
// src/renderer/src/audio/discoverSeed.ts
import { resolveStemRole } from '@shared/stemRole'
import type { Stem } from '@shared/types'
import { freshSlotId, type DiscoverSlot, type ResolvedCandidateStem } from '../components/DiscoverPanel'
import type { DiscoverCandidate } from '../../../main/discoverCandidates'

// A real Rifff can only ever have 8 stems (StemCID_1..8, see
// riffLibrarySchema.ts) -- caps defensively at the same number
// discoverRifffAssembly.ts's own MAX_STEMS_PER_RIFFF already enforces on
// the way back OUT of Discover, so seeding never produces more slots than
// a "plunk in arranger" could ever turn back into a single rifff anyway.
const MAX_SEED_SLOTS = 8

/** Builds Discover's replacement slots from a list of already-resolved,
 * local Stem objects -- the Shelf-sourced seed path (a Shelf riff is
 * already a real `Rifff` with real local Stem data, `state.rifffs`, no
 * network/resolution step needed at all). Each stem becomes one slot with
 * `seedStem` set (DiscoverSlotRow, per Task 3 of this same plan, treats a
 * slot with `seedStem` as already resolved, skipping the normal
 * candidate-based resolution path entirely) and `candidate: null` (there is
 * no DiscoverCandidate to speak of -- a real placed/shelved Stem carries no
 * riffCID/stemCID at all).
 *
 * Role is inferred via `resolveStemRole` (the SAME heuristic
 * AutoArrangeRoleStep.tsx/ClusterStemsBrowser.tsx's own role-confirmation
 * pickers already use) with `busId: null` -- a Shelf/unplaced stem has no
 * channel/bus assignment yet (that only exists for PLACED rifffs), so this
 * always falls through to `resolveStemRole`'s own preset-name-guess-then-
 * soundType-fallback chain, never its busId shortcut.
 *
 * Every slot starts unlocked and `hasRerolled: true` (there is no
 * meaningful "hasn't rolled yet" state for a slot that already has real
 * content) and `gain: 1` (full volume, matching every other fresh slot's
 * own default). Returns `[]` for an empty input. */
export function buildSeedSlotsFromStems(stems: readonly Stem[]): DiscoverSlot[] {
  return stems.slice(0, MAX_SEED_SLOTS).map((stem) => {
    const seedStem: ResolvedCandidateStem = {
      author: stem.author,
      name: stem.name,
      type: stem.type,
      path: stem.path,
      durationSec: stem.durationSec,
      barLength: stem.barLength
    }
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
  })
}

/** Builds Discover's replacement slots from a list of unresolved
 * DiscoverCandidates -- the Browse-sourced seed path. Each candidate
 * becomes one slot with `candidate` set (the existing, UNCHANGED
 * DiscoverSlotRow resolution path handles it exactly like a normal roll's
 * own candidate -- same lazy per-row "downloading + analyzing…" state, same
 * caching). `arrangeRole` comes directly off the candidate (already
 * populated by whoever built it -- see LibraryBrowser.tsx's own
 * seed-triggering handler). Every slot starts unlocked and
 * `hasRerolled: true`, `gain: 1`, `seedStem: undefined` -- same defaults as
 * the Stems path above. Returns `[]` for an empty input. */
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

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/renderer/src/audio/discoverSeed.test.ts`
Expected: PASS, 12/12.

- [ ] **Step 5: Typecheck and lint**

Run: `npm run typecheck && npx eslint src/renderer/src/audio/discoverSeed.ts src/renderer/src/audio/discoverSeed.test.ts`
Expected: no errors.

- [ ] **Step 6: Run the full test suite**

Run: `npx vitest run` -- expect the prior count plus 12 new tests, no regressions.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/audio/discoverSeed.ts src/renderer/src/audio/discoverSeed.test.ts
git commit -m "Add discoverSeed.ts: build Discover slots from an existing riff's stems"
```

---

### Task 3: DiscoverSlotRow -- resolve a seedStem immediately, fix the label

**Files:**
- Modify: `src/renderer/src/components/DiscoverPanel.tsx`

Depends on Task 1's `seedStem` field. Three edits, all in this one file.

**3a. The resolve effect gets a new branch.**

Find (search for the exact text):

```typescript
  useEffect(() => {
    let cancelled = false
    if (!slot.candidate) return
    const candidate = slot.candidate
    void resolveCandidateStem(candidate).then((stem) => {
      if (cancelled) return
      setResolved(
        stem
          ? { candidate, status: 'ready', stem: { slot: 1, ...stem } }
          : { candidate, status: 'failed' }
      )
    })
    return () => {
      cancelled = true
    }
  }, [slot.candidate])
```

Replace it with:

```typescript
  useEffect(() => {
    // A seeded slot (see DiscoverSlot's own seedStem doc comment) is
    // already resolved -- there is nothing to fetch, so this skips
    // resolveCandidateStem entirely and populates the SAME `resolved`
    // shape the candidate path below produces, just synchronously.
    // `candidate: slot.candidate` here is always `null` for a seeded slot
    // (seedStem and candidate are mutually exclusive, see
    // rollForSlot/rollRandomForSlot's own seedStem-clearing below) --
    // pairing against slot.candidate (not some seed-specific identity)
    // keeps the EXISTING staleness check just below
    // (`resolved?.candidate === slot.candidate`) working unchanged: it
    // stays valid (null === null) until this slot is ever rerolled, at
    // which point slot.candidate becomes non-null and seedStem is cleared
    // in the same update, correctly invalidating this branch's own result.
    if (slot.seedStem) {
      setResolved({ candidate: slot.candidate, status: 'ready', stem: { slot: 1, ...slot.seedStem } })
      return
    }
    let cancelled = false
    if (!slot.candidate) return
    const candidate = slot.candidate
    void resolveCandidateStem(candidate).then((stem) => {
      if (cancelled) return
      setResolved(
        stem
          ? { candidate, status: 'ready', stem: { slot: 1, ...stem } }
          : { candidate, status: 'failed' }
      )
    })
    return () => {
      cancelled = true
    }
  }, [slot.candidate, slot.seedStem])
```

**3b. `resolved`'s own state type must allow a `null` candidate** (a
seeded slot's own `resolved.candidate` is `null`, per 3a above -- the
type currently requires a real `DiscoverCandidate`).

Find (search for the exact text):

```typescript
  const [resolved, setResolved] = useState<
    | { candidate: DiscoverCandidate; status: 'ready'; stem: Stem }
    | { candidate: DiscoverCandidate; status: 'failed' }
    | null
  >(null)
```

Replace it with:

```typescript
  const [resolved, setResolved] = useState<
    | { candidate: DiscoverCandidate | null; status: 'ready'; stem: Stem }
    | { candidate: DiscoverCandidate | null; status: 'failed' }
    | null
  >(null)
```

**3c. The preset-name label needs a case for "resolved, but no candidate"**
-- otherwise a seeded slot's own real, resolved stem shows next to the
text "no candidate yet", which is wrong (there IS a real stem, it just
didn't come from a candidate).

Find (search for the exact text):

```typescript
        {rerolling
          ? slot.candidate
            ? 'rerolling…'
            : 'rolling…'
          : resolveFailed
            ? "couldn't load -- try again"
            : slot.candidate
              ? slot.candidate.presetName
              : slot.hasRerolled
                ? 'no match for this role yet'
                : 'no candidate yet'}
```

Replace it with:

```typescript
        {rerolling
          ? slot.candidate
            ? 'rerolling…'
            : 'rolling…'
          : resolveFailed
            ? "couldn't load -- try again"
            : slot.candidate
              ? slot.candidate.presetName
              : resolvedStem
                ? resolvedStem.name
                : slot.hasRerolled
                  ? 'no match for this role yet'
                  : 'no candidate yet'}
```

**3d. `rollForSlot` and `rollRandomForSlot` must clear `seedStem` when they
set a fresh `candidate`** -- otherwise the resolve effect's `if
(slot.seedStem)` branch (3a) would keep winning forever after a reroll,
and the freshly-rolled candidate would never actually resolve.

Find (search for the exact text):

```typescript
      setSlots((prev) =>
        prev.map((s) => (s.id === id ? { ...s, candidate: picked, hasRerolled: true } : s))
      )
```

Replace it with:

```typescript
      setSlots((prev) =>
        prev.map((s) =>
          s.id === id ? { ...s, candidate: picked, hasRerolled: true, seedStem: undefined } : s
        )
      )
```

Find (search for the exact text -- a DIFFERENT call site, inside
`rollRandomForSlot`, not the one just above):

```typescript
      setSlots((prev) =>
        prev.map((s) => (s.id === id ? { ...s, candidate, hasRerolled: true } : s))
      )
```

Replace it with:

```typescript
      setSlots((prev) =>
        prev.map((s) =>
          s.id === id ? { ...s, candidate, hasRerolled: true, seedStem: undefined } : s
        )
      )
```

**Steps:**

1. Make all four edits above (3a-3d).
2. Typecheck and lint: `npm run typecheck && npx eslint src/renderer/src/components/DiscoverPanel.tsx` -- expect 0 errors, 0 warnings.
3. Run the full test suite: `npx vitest run` -- expect the same pass count as before this task.
4. Commit:

```bash
git add src/renderer/src/components/DiscoverPanel.tsx
git commit -m "DiscoverSlotRow: resolve a seeded slot immediately, fix its label"
```

---

### Task 4: Browse-tab seed trigger (LibraryBrowser.tsx)

**Files:**
- Modify: `src/renderer/src/components/LibraryBrowser.tsx`

Depends on Task 2's `buildSeedSlotsFromCandidates` and Task 1's exported
`DISCOVER_UNDO_LIMIT`.

**4a. Import what this task needs.**

Find (search for the exact text):

```typescript
import { DiscoverPanel, type DiscoverSlot } from './DiscoverPanel'
```

Replace it with:

```typescript
import { DiscoverPanel, DISCOVER_UNDO_LIMIT, type DiscoverSlot } from './DiscoverPanel'
import { buildSeedSlotsFromCandidates } from '../audio/discoverSeed'
import { SOUND_TYPE_TO_ARRANGE_ROLE } from '@shared/stemRole'
import type { DiscoverCandidate } from '../../../main/discoverCandidates'
```

**4b. Add the seed-triggering handler**, right below the existing
`handleImport`/`handleImportSelected` functions (search for the exact
text to find them -- their own current implementation doesn't need to be
quoted here since it's untouched, just find them to anchor the insertion
point directly after):

Find (search for the exact text -- the end of `handleImportSelected`'s own
closing brace, immediately followed by whatever function currently comes
next):

```typescript
  function handleImport(): void {
```

Add this new function directly ABOVE that line:

```typescript
  // Direct request, 2026-09-16: seed Discover's own looper from an
  // existing riff's stems instead of starting from scratch -- see
  // docs/superpowers/specs/2026-09-16-discover-seed-stems-design.md. Only
  // meaningful for a SINGLE selected riff (unlike handleImport/
  // handleImportSelected, which both support a multi-select batch) --
  // "seed from N different riffs at once" has no coherent meaning here,
  // so this is only ever wired to fire when exactly one riff is selected.
  function seedDiscoverFromBrowseRiff(): void {
    if (!selectedRiffCID || !selectedJamCID || !resolvedRiff) return
    // Replaces discoverSlots wholesale -- confirm before destroying real
    // existing content, same window.confirm convention this file already
    // uses elsewhere (e.g. its own jam-sync-removal confirmation above).
    // An empty/never-touched Discover (every slot has no candidate at all)
    // needs no confirmation -- there's nothing to lose.
    const hasRealContent = discoverSlots.some((s) => s.candidate !== null)
    if (
      hasRealContent &&
      !window.confirm(
        'Replace the current Discover loop with this riff\'s stems? Whatever you\'ve built so far in Discover will be lost.'
      )
    ) {
      return
    }
    const candidates: DiscoverCandidate[] = resolvedRiff.stems.map((stem) => ({
      stemCID: stem.stemCID,
      jamCID: selectedJamCID,
      riffCID: selectedRiffCID,
      presetName: stem.presetName,
      creatorUserName: stem.creatorUserName,
      arrangeRole:
        SOUND_TYPE_TO_ARRANGE_ROLE[
          instrumentMaskToSoundType(stem.instrumentMask) ??
            guessSoundTypeFromPresetName(stem.presetName) ??
            'fx'
        ],
      drumSubRole: null,
      riffBpm: resolvedRiff.bpm
    }))
    // Same "push a snapshot before mutating" convention every other
    // Discover slot-content action already uses (DiscoverPanel.tsx's own
    // pushUndoSnapshot) -- inlined here rather than calling into
    // DiscoverPanel directly, since discoverUndoStack/setDiscoverUndoStack
    // (like discoverSlots itself) are owned HERE, lifted up specifically so
    // they survive a 'browse' <-> 'discover' switch.
    setDiscoverUndoStack((prev) => [...prev, discoverSlots].slice(-DISCOVER_UNDO_LIMIT))
    setDiscoverRedoStack([])
    setDiscoverSlots(buildSeedSlotsFromCandidates(candidates))
    setLibraryMode('discover')
  }

  function handleImport(): void {
```

**4c. Add the button** in the riff-detail panel, next to the existing
"import to project" button.

Find (search for the exact text -- the closing of the "download missing
stems" button, immediately followed by the "import to project" button's
own opening):

```typescript
                              {downloadingRiffCID === selectedRiffCID
                                ? 'downloading…'
                                : 'download missing stems'}
                            </button>
                          )}
                          <button
                            onClick={() => {
                              if (selectedRiffCIDs.size > 1) {
                                void handleImportSelected()
                              } else {
                                void handleImport()
                              }
                            }}
```

Replace it with (adds one new button between the two; the existing
"import to project" button below is UNCHANGED, only reproduced here so the
insertion point is unambiguous):

```typescript
                              {downloadingRiffCID === selectedRiffCID
                                ? 'downloading…'
                                : 'download missing stems'}
                            </button>
                          )}
                          {selectedRiffCIDs.size <= 1 && (
                            <button
                              onClick={seedDiscoverFromBrowseRiff}
                              title="replace Discover's current loop with this riff's own stems, then keep tinkering from there"
                              style={{
                                height: 24,
                                borderRadius: 0,
                                padding: '0 10px',
                                fontSize: 10,
                                border: '1px solid var(--ra-border)',
                                background: 'var(--ra-bg-row-active)',
                                color: 'var(--ra-text-2)'
                              }}
                            >
                              seed discover with this
                            </button>
                          )}
                          <button
                            onClick={() => {
                              if (selectedRiffCIDs.size > 1) {
                                void handleImportSelected()
                              } else {
                                void handleImport()
                              }
                            }}
```

**Steps:**

1. Make all three edits above (4a-4c).
2. Typecheck and lint: `npm run typecheck && npx eslint src/renderer/src/components/LibraryBrowser.tsx` -- expect 0 errors, 0 warnings.
3. Run the full test suite: `npx vitest run` -- expect the same pass count as before this task. (`LibraryBrowser.tsx` has no dedicated test file today -- React components in this codebase are typecheck+lint verified only, don't add one.)
4. Commit:

```bash
git add src/renderer/src/components/LibraryBrowser.tsx
git commit -m "LibraryBrowser: seed Discover from a selected Browse riff"
```

---

### Task 5: Shelf-tab seed trigger (Shelf.tsx, App.tsx, LibraryBrowser.tsx)

**Files:**
- Modify: `src/renderer/src/components/Shelf.tsx`
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/components/LibraryBrowser.tsx`

Depends on Task 2's `buildSeedSlotsFromStems`. Independent of Task 4's own
edits (different section of `LibraryBrowser.tsx`), but sequenced after it
per this plan's own task order -- both tasks touch the same file, so
completing Task 4 first keeps this task's own "find this exact text"
anchors accurate.

**Key architectural facts this task relies on**:

- `LibraryBrowser` fully unmounts and remounts every time it opens
  (`{riffLibraryOpen && <LibraryBrowser .../>}` in App.tsx, conditionally
  rendered) -- so a new prop consumed only via `useState`'s own LAZY
  initializer (a function passed to `useState`, evaluated exactly once per
  mount) is sufficient; no `useEffect`, no "has this been consumed yet"
  flag, and no risk of double-seeding is needed.
- Shelf is only ever visible while `LibraryBrowser` is CLOSED (Discover's
  own full-screen modal covers Shelf entirely while open -- see the design
  spec's own Background section) -- so a Shelf-triggered seed can only
  ever fire into a brand-new, empty `LibraryBrowser` mount. Unlike Task 4's
  Browse-triggered seed (which can fire into a session that already has
  real Discover content built up), there is structurally nothing to
  discard here, so this task deliberately does NOT add a
  `window.confirm` discard-guard for the Shelf path -- it would always be
  a no-op confirming against emptiness.
- Because seeding here happens via a lazy `useState` initializer (not a
  call to `setDiscoverSlots` after the component already exists), the
  normal "push the previous slots onto discoverUndoStack before
  overwriting" pattern (which Task 4 already uses) doesn't apply the same
  way -- there IS no "previous" `discoverSlots` value to push, since this
  component didn't exist a moment ago. Instead, `discoverUndoStack` ITSELF
  gets lazily seeded with one entry (`[]`, the empty state) whenever
  `initialDiscoverSeed` is present, so hitting "undo" right after a
  Shelf-triggered seed still does the expected thing (revert back to an
  empty Discover) -- see 5c's own edit to `discoverUndoStack` below.

**5a. `Shelf.tsx` -- new prop, new right-click action.**

Find (search for the exact text):

```typescript
export function Shelf({
  onImported,
  onOpenLibrary
}: {
  onImported: (groupId: string) => void
  /** Opens whichever library browser is the default entry point -- the
   * Endlesss login tab, not LORE, per direct feedback (LORE's warehouse
   * path only ever resolves on one specific machine; Endlesss login works
   * for anyone). LORE stays reachable via that browser's own "switch to
   * lore" link. */
  onOpenLibrary: () => void
}): React.JSX.Element {
```

Replace it with:

```typescript
export function Shelf({
  onImported,
  onOpenLibrary,
  onSeedDiscover
}: {
  onImported: (groupId: string) => void
  /** Opens whichever library browser is the default entry point -- the
   * Endlesss login tab, not LORE, per direct feedback (LORE's warehouse
   * path only ever resolves on one specific machine; Endlesss login works
   * for anyone). LORE stays reachable via that browser's own "switch to
   * lore" link. */
  onOpenLibrary: () => void
  /** Seeds Discover's own looper with this riff's stems, then opens it
   * already showing them -- direct request, 2026-09-16 (right-click a
   * Shelf tile). App.tsx owns the actual seeding + opening (it's the one
   * component with access to both Shelf and LibraryBrowser), so this is
   * just "here's the riff the user picked," nothing more. See
   * docs/superpowers/specs/2026-09-16-discover-seed-stems-design.md --
   * live drag onto Discover isn't possible (Discover's own full-screen
   * modal covers Shelf entirely), so this is triggered explicitly instead. */
  onSeedDiscover: (rifff: Rifff) => void
}): React.JSX.Element {
```

Find (search for the exact text -- the Shelf tile's own `onDragStart`
handler and its sibling props, ending at the tile's own `title`):

```typescript
              onMouseEnter={() => setHoverId(rifff.groupId)}
              onClick={(e) => handleTileClick(e, rifff)}
              title={`${rifff.name} — click to preview, drag to arrange, shift/cmd-click to multi-select, delete to remove from library`}
```

Replace it with:

```typescript
              onMouseEnter={() => setHoverId(rifff.groupId)}
              onClick={(e) => handleTileClick(e, rifff)}
              onContextMenu={(e) => {
                e.preventDefault()
                onSeedDiscover(rifff)
              }}
              title={`${rifff.name} — click to preview, drag to arrange, right-click to seed Discover with these stems, shift/cmd-click to multi-select, delete to remove from library`}
```

**5b. `App.tsx` -- own the pending seed, thread it through.**

Find (search for the exact text):

```typescript
  const [riffLibraryOpen, setRiffLibraryOpen] = useState(false)
```

Replace it with:

```typescript
  const [riffLibraryOpen, setRiffLibraryOpen] = useState(false)
  // Set by Shelf's own "seed Discover with this riff" right-click action,
  // read exactly once by LibraryBrowser's own lazy useState initializer at
  // the moment it mounts (see LibraryBrowser.tsx's own initialDiscoverSeed
  // prop) -- direct request, 2026-09-16. Cleared back to null by
  // openRiffLibrary() itself (below) so a LATER, ordinary open (the normal
  // toolbar button, no seed intended) never accidentally re-seeds from a
  // stale value left over from an earlier seed action.
  const [pendingDiscoverSeed, setPendingDiscoverSeed] = useState<Rifff | null>(null)
```

Find (search for the exact text -- `Rifff` may already be imported; if
`import type { Rifff } from '@shared/types'` or an equivalent named import
already exists anywhere in this file's own import block, do NOT add a
second one, just confirm it's present):

```typescript
  function openRiffLibrary(): void {
    setLibraryBrowserOpen(false)
    setRiffLibraryOpen(true)
  }
```

Replace it with:

```typescript
  function openRiffLibrary(): void {
    setLibraryBrowserOpen(false)
    setPendingDiscoverSeed(null)
    setRiffLibraryOpen(true)
  }
  // Shelf's own onSeedDiscover -- see its own doc comment for why this
  // lives here (App.tsx is the one place with access to both Shelf and
  // LibraryBrowser).
  function openRiffLibraryWithDiscoverSeed(rifff: Rifff): void {
    setLibraryBrowserOpen(false)
    setPendingDiscoverSeed(rifff)
    setRiffLibraryOpen(true)
  }
```

Find (search for the exact text):

```typescript
        <Shelf onImported={handleImported} onOpenLibrary={openRiffLibrary} />
```

Replace it with:

```typescript
        <Shelf
          onImported={handleImported}
          onOpenLibrary={openRiffLibrary}
          onSeedDiscover={openRiffLibraryWithDiscoverSeed}
        />
```

Find (search for the exact text):

```typescript
        {riffLibraryOpen && (
          <LibraryBrowser
            onClose={() => setRiffLibraryOpen(false)}
            onImported={handleLibraryImported}
            currentSketch={currentSketch}
            discoverConsented={discoverConsented}
            setDiscoverConsented={setDiscoverConsented}
          />
        )}
```

Replace it with:

```typescript
        {riffLibraryOpen && (
          <LibraryBrowser
            onClose={() => setRiffLibraryOpen(false)}
            onImported={handleLibraryImported}
            currentSketch={currentSketch}
            discoverConsented={discoverConsented}
            setDiscoverConsented={setDiscoverConsented}
            initialDiscoverSeed={pendingDiscoverSeed}
          />
        )}
```

**5c. `LibraryBrowser.tsx` -- consume the seed via a lazy state
initializer for BOTH `discoverSlots` and `libraryMode`.**

Find (search for the exact text):

```typescript
export function LibraryBrowser({
  onClose,
  onImported,
  currentSketch,
  discoverConsented,
  setDiscoverConsented
}: {
  onClose: () => void
```

Replace it with:

```typescript
export function LibraryBrowser({
  onClose,
  onImported,
  currentSketch,
  discoverConsented,
  setDiscoverConsented,
  initialDiscoverSeed
}: {
  onClose: () => void
```

Find (search for the exact text -- the end of this component's own props
type, right before the closing `}): React.JSX.Element {`):

```typescript
  discoverConsented: boolean
  setDiscoverConsented: (value: boolean) => Promise<void>
}): React.JSX.Element {
```

Replace it with:

```typescript
  discoverConsented: boolean
  setDiscoverConsented: (value: boolean) => Promise<void>
  /** Set by App.tsx when Shelf's own "seed Discover with this riff"
   * right-click action fired -- consumed exactly once, via the lazy
   * useState initializers just below, at the moment THIS component mounts
   * (LibraryBrowser fully unmounts/remounts every time it opens, so a lazy
   * initializer alone is enough; no effect, no "already consumed" flag
   * needed). `null` for every other, ordinary way of opening this
   * component. See docs/superpowers/specs/2026-09-16-discover-seed-stems-
   * design.md. */
  initialDiscoverSeed: Rifff | null
}): React.JSX.Element {
```

Find (search for the exact text):

```typescript
  const [libraryMode, setLibraryMode] = useState<'browse' | 'discover'>('browse')
```

Replace it with:

```typescript
  const [libraryMode, setLibraryMode] = useState<'browse' | 'discover'>(
    initialDiscoverSeed ? 'discover' : 'browse'
  )
```

Find (search for the exact text):

```typescript
  const [discoverSlots, setDiscoverSlots] = useState<DiscoverSlot[]>([])
```

Replace it with:

```typescript
  const [discoverSlots, setDiscoverSlots] = useState<DiscoverSlot[]>(() =>
    initialDiscoverSeed ? buildSeedSlotsFromStems(initialDiscoverSeed.stems) : []
  )
```

Find (search for the exact text -- directly below `discoverSlots`'s own
declaration):

```typescript
  const [discoverUndoStack, setDiscoverUndoStack] = useState<DiscoverSlot[][]>([])
```

Replace it with:

```typescript
  // Lazily seeded with one entry (the empty state, `[]`) whenever this
  // mount was seeded from Shelf -- there's no "previous discoverSlots" to
  // push the normal way (this component didn't exist a moment ago), but
  // hitting "undo" right after a Shelf-triggered seed should still revert
  // back to an empty Discover, same as undoing any other slot-content
  // action. Task 4's own Browse-triggered seed pushes onto this stack the
  // ordinary way instead (setDiscoverUndoStack, called after this
  // component already exists) -- this lazy seed only matters for the
  // Shelf path.
  const [discoverUndoStack, setDiscoverUndoStack] = useState<DiscoverSlot[][]>(() =>
    initialDiscoverSeed ? [[]] : []
  )
```

Add the same `buildSeedSlotsFromStems` import Task 4 already added
`buildSeedSlotsFromCandidates` alongside -- find (search for the exact
text, as Task 4 left it):

```typescript
import { buildSeedSlotsFromCandidates } from '../audio/discoverSeed'
```

Replace it with:

```typescript
import { buildSeedSlotsFromCandidates, buildSeedSlotsFromStems } from '../audio/discoverSeed'
```

**Steps:**

1. Make all edits above (5a-5c).
2. Typecheck and lint: `npm run typecheck && npx eslint src/renderer/src/components/Shelf.tsx src/renderer/src/App.tsx src/renderer/src/components/LibraryBrowser.tsx` -- expect 0 errors, 0 warnings.
3. Run the full test suite: `npx vitest run` -- expect the same pass count as before this task.
4. Commit:

```bash
git add src/renderer/src/components/Shelf.tsx src/renderer/src/App.tsx src/renderer/src/components/LibraryBrowser.tsx
git commit -m "Shelf/App/LibraryBrowser: seed Discover from a right-clicked Shelf riff"
```

---

### Task 6: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Full verification pass**

Run, in order:

```bash
npm run typecheck
npx eslint .
npx vitest run
```

Expected: all clean, full suite passing at the same count as before Task 1
plus the 12 new tests from Task 2.

- [ ] **Step 2: Review the diff for this feature**

Tasks 1-5 each end with exactly one commit:

```bash
git log --oneline -5
git diff HEAD~5..HEAD
```

Confirm the 5 commits match Tasks 1-5's own commit messages before
diffing. Confirm: no edit strayed into `buildEngineProject.ts`,
`native-engine/`, `store.ts`'s own reducer (this feature never dispatches
into the real, undo-tracked project state -- Discover's own slots are a
separate, lifted-but-not-undo-tracked-the-same-way piece of state), or
`SET_TEMPO`/any tempo-related dispatch (per the design spec's own
"tempo is NOT overridden" decision). Confirm every `seedStem`-setting path
(`buildSeedSlotsFromStems`) is paired with `candidate: null`, and every
`candidate`-setting path (`buildSeedSlotsFromCandidates`, and both
`rollForSlot`/`rollRandomForSlot` after Task 3) clears `seedStem`.

- [ ] **Step 3: Report status -- do NOT claim it's confirmed working**

This environment cannot click a real button, right-click a real Shelf
tile, or listen to real audio. State plainly in the final summary that
this is implemented and self-verified (typecheck/lint/tests/diff review)
as far as this environment allows -- not that the feature is confirmed
working. Elling needs to actually run the checklist below.

- [ ] **Step 4: Manual walkthrough checklist for Elling**

Report this checklist back in the final summary, exactly as follows,
flagged as needing his own confirmation:

1. Right-click a riff tile on the Shelf. Expected: Discover opens
   immediately, already showing that riff's own stems as slots -- no
   loading/resolving state on any of them (they're already local), and
   the project's own tempo (Discover's own tempo field) is unchanged from
   whatever it already was.
2. Open Browse, select a riff, click "seed discover with this" (next to
   "import to project"). Expected: Discover opens showing that riff's own
   stems as slots, each one going through the normal "downloading +
   analyzing…" resolving state per slot (same as a fresh roll), settling
   into real waveforms once resolved.
3. With Discover already showing real content (from either seed source, or
   a normal roll), seed again from a different riff. Expected: a
   confirmation prompt appears before replacing what's there; canceling it
   leaves Discover untouched.
4. After seeding (either source), reroll one of the seeded slots.
   Expected: behaves exactly like rerolling a normally-rolled slot (shows
   the reroll spinner state, resolves a new candidate, replaces that one
   slot only -- the OTHER seeded slots stay exactly as they were).
5. After seeding, try "undo" (the toolbar undo button). Expected: reverts
   the whole seed back to whatever Discover showed immediately before
   seeding (empty, if Discover was empty).
