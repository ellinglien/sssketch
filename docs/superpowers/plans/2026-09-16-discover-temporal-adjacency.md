# Discover Temporal Adjacency Exploration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** From any resolved Discover slot, open a popover that browses the riffs recorded near that slot's own riff in the same jam's iteration sequence, and click any of them to swap it into the slot and recenter browsing around it — a clickable chain along the jam's own timeline.

**Architecture:** One new main-process module (`src/main/discoverAdjacency.ts`) wires three existing, already-tested `riffLibraryStore.ts` functions (`resolveRiffWithContext`, `listRiffs`, `resolveRiff`) together with the same role-inference chain already used for Browse-sourced Discover seeding — no new SQL, no new caching layer. One new IPC handler exposes it. One new renderer component (`DiscoverNearbyPopover.tsx`) is a stateful popover, positioned/dismissed the same way `ContextMenu.tsx` already is. `DiscoverSlotRow` gains a trigger button and shrinks its existing icon-button row to make room.

**Tech Stack:** No new dependencies. Reuses `DiscoverCandidate` (main/discoverCandidates.ts) as the wire type, so a picked adjacent candidate is directly assignable to `DiscoverSlot.candidate` with no conversion.

---

## Before you start

Every task below is grounded in fresh reads of the real current files (2026-09-16). Match by **code content**, not line numbers — several files in this plan (`DiscoverPanel.tsx` especially) have been edited many times this session and line numbers will have drifted by the time you read this. If a quoted block doesn't match closely (more than a line or two of real drift), stop and escalate rather than guessing.

**Terminology trap, already caught once during planning — read this before Task 1:** `listRiffs` orders rows `CreationTime DESC` (rank 0 = newest riff in the jam). A **smaller** rank than the center's riff means a **larger** CreationTime — recorded chronologically **after** the center (the "later" section in the UI). A **larger** rank means a **smaller** CreationTime — recorded **before** the center (the "earlier" section). This is the opposite of what intuition suggests from "DESC" alone. To avoid re-inverting this, the backend code in this plan never uses the words "earlier"/"later" internally — it uses `newer`/`older` (unambiguous, chronological), and only the popover's own UI-facing labels say "earlier"/"later" (mapped explicitly: `older` → "earlier" section, `newer` → "later" section).

---

## File Structure

- **Modify:** `src/main/riffLibraryStore.ts` — `resolveRiffWithContext` gains a `rank` field on its return type (the raw rank the offset is already computed from internally, just not currently exposed).
- **Modify:** `src/main/riffLibraryStore.test.ts` — two existing `resolveRiffWithContext` tests gain a `rank` assertion.
- **Create:** `src/main/discoverAdjacency.ts` — the pure outward-walk function (`walkAdjacentWindow`) plus the real, DB-backed wiring function (`getAdjacentDiscoverCandidates`).
- **Create:** `src/main/discoverAdjacency.test.ts` — real TDD tests for `walkAdjacentWindow` (pure, fake data).
- **Modify:** `src/main/index.ts` — one new `ipcMain.handle`.
- **Modify:** `src/preload/index.ts` — one new bridge method.
- **Create:** `src/renderer/src/components/DiscoverNearbyPopover.tsx` — the popover itself.
- **Modify:** `src/renderer/src/components/DiscoverPanel.tsx` — shrink `DiscoverSlotRow`'s 7 existing icon buttons to 18×18, add an 8th "explore nearby" button + wiring, add `swapSlotFromNearby`.

---

### Task 1: `resolveRiffWithContext` exposes its raw rank

**Files:**
- Modify: `src/main/riffLibraryStore.ts`
- Modify: `src/main/riffLibraryStore.test.ts`

The current `RiffContextResult` interface and `resolveRiffWithContext` function (in `src/main/riffLibraryStore.ts`) look like this:

```ts
export interface RiffContextResult {
  jamCID: string
  /** Offset to pass to listRiffs(jamCID, { offset }) to fetch a ~20-riff
   * page centered on the target riff (10 before, 10 after -- clamped to 0
   * for a riff near the very start of the jam). */
  offset: number
  /** The riffCID actually matched -- identical to the input except when the
   * typo-tolerant fallback below kicked in, so the caller can highlight the
   * right row even if the pasted ID had a case/whitespace mismatch. */
  matchedRiffCID: string
}

const RIFF_CONTEXT_WINDOW_BEFORE = 10

export function resolveRiffWithContext(riffCID: string): RiffContextResult | null {
  const trimmed = riffCID.trim()

  for (const db of candidateDbsForRiff()) {
    const exactRow = db
      .prepare(`SELECT RiffCID, OwnerJamCID, CreationTime FROM Riffs WHERE RiffCID = ?`)
      .get(trimmed) as { RiffCID: string; OwnerJamCID: string; CreationTime: number } | undefined
    const row =
      exactRow ??
      (db
        .prepare(
          `SELECT RiffCID, OwnerJamCID, CreationTime FROM Riffs WHERE RiffCID = ? COLLATE NOCASE`
        )
        .get(trimmed) as { RiffCID: string; OwnerJamCID: string; CreationTime: number } | undefined)
    if (!row) continue

    const { rank } = db
      .prepare(`SELECT COUNT(*) as rank FROM Riffs WHERE OwnerJamCID = ? AND CreationTime > ?`)
      .get(row.OwnerJamCID, row.CreationTime) as { rank: number }

    return {
      jamCID: row.OwnerJamCID,
      offset: Math.max(0, rank - RIFF_CONTEXT_WINDOW_BEFORE),
      matchedRiffCID: row.RiffCID
    }
  }
  return null
}
```

`rank` is already computed — it's just not returned. `discoverAdjacency.ts` (Task 3) needs the raw rank (not the `-10`-adjusted `offset`, which is specific to the "jump to a pasted riff ID" 20-row page this function was originally built for) to center its own, differently-sized window.

- [ ] **Step 1: Write the failing tests**

Open `src/main/riffLibraryStore.test.ts`. Find the two existing tests inside `describe('resolveRiffWithContext', ...)`:

```ts
  it('resolves the jam and an offset centered on the riff, for a riff in the middle of a jam', () => {
    root = mkdtempSync(join(tmpdir(), 'sssketch-lore-test-'))
    createFixtureWarehouse(root)
    const db = new Database(join(root, 'cache', 'common', 'warehouse.db3'))
    db.exec(`INSERT INTO Jams (JamCID, PublicName) VALUES ('jam-big', 'Big Jam')`)
    const insert = db.prepare(
      'INSERT INTO Riffs (RiffCID, OwnerJamCID, CreationTime, BPMrnd, BarLength, UserName) VALUES (?,?,?,?,?,?)'
    )
    // 41 riffs, CreationTime 0..40 -- riff-20 sits at rank 20 (20 riffs
    // newer than it: CreationTime 21..40), so offset should be 20-10=10.
```

(the fixture-insertion loop continues below this, unchanged) followed by:

```ts
    const result = resolveRiffWithContext('riff-20')
    expect(result).not.toBeNull()
    expect(result!.jamCID).toBe('jam-big')
    expect(result!.matchedRiffCID).toBe('riff-20')
    expect(result!.offset).toBe(10)
  })
```

Add one line to that assertion block:

```ts
    const result = resolveRiffWithContext('riff-20')
    expect(result).not.toBeNull()
    expect(result!.jamCID).toBe('jam-big')
    expect(result!.matchedRiffCID).toBe('riff-20')
    expect(result!.offset).toBe(10)
    expect(result!.rank).toBe(20)
  })
```

And the second test:

```ts
  it('clamps the offset to 0 for a riff at (or near) the very start of a jam', () => {
    root = mkdtempSync(join(tmpdir(), 'sssketch-lore-test-'))
    createSeededFixtureWarehouse(root)
    setRiffLibraryRootForTests(root)

    // riff-2 (CreationTime 2000) is the NEWEST riff in jam-techno -- rank 0,
    // offset would be 0-10 = -10, clamped to 0.
    const result = resolveRiffWithContext('riff-2')
    expect(result).not.toBeNull()
    expect(result!.jamCID).toBe('jam-techno')
    expect(result!.offset).toBe(0)
  })
```

Add:

```ts
    const result = resolveRiffWithContext('riff-2')
    expect(result).not.toBeNull()
    expect(result!.jamCID).toBe('jam-techno')
    expect(result!.offset).toBe(0)
    expect(result!.rank).toBe(0)
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/main/riffLibraryStore.test.ts -t resolveRiffWithContext`
Expected: FAIL — `result!.rank` is `undefined`, not `20`/`0`.

- [ ] **Step 3: Add `rank` to the interface and return value**

In `src/main/riffLibraryStore.ts`, change:

```ts
export interface RiffContextResult {
  jamCID: string
  /** Offset to pass to listRiffs(jamCID, { offset }) to fetch a ~20-riff
   * page centered on the target riff (10 before, 10 after -- clamped to 0
   * for a riff near the very start of the jam). */
  offset: number
  /** The riffCID actually matched -- identical to the input except when the
   * typo-tolerant fallback below kicked in, so the caller can highlight the
   * right row even if the pasted ID had a case/whitespace mismatch. */
  matchedRiffCID: string
}
```

to:

```ts
export interface RiffContextResult {
  jamCID: string
  /** Offset to pass to listRiffs(jamCID, { offset }) to fetch a ~20-riff
   * page centered on the target riff (10 before, 10 after -- clamped to 0
   * for a riff near the very start of the jam). */
  offset: number
  /** The riffCID actually matched -- identical to the input except when the
   * typo-tolerant fallback below kicked in, so the caller can highlight the
   * right row even if the pasted ID had a case/whitespace mismatch. */
  matchedRiffCID: string
  /** This riff's own raw rank in its jam's CreationTime DESC ordering (0 =
   * newest) -- the number `offset` above is derived from (rank - 10,
   * clamped). Exposed separately for discoverAdjacency.ts, which needs to
   * center a differently-sized window around the real rank rather than
   * this function's own fixed "10 before" page. */
  rank: number
}
```

Then change the return statement:

```ts
    return {
      jamCID: row.OwnerJamCID,
      offset: Math.max(0, rank - RIFF_CONTEXT_WINDOW_BEFORE),
      matchedRiffCID: row.RiffCID
    }
```

to:

```ts
    return {
      jamCID: row.OwnerJamCID,
      offset: Math.max(0, rank - RIFF_CONTEXT_WINDOW_BEFORE),
      matchedRiffCID: row.RiffCID,
      rank
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/main/riffLibraryStore.test.ts`
Expected: PASS, full file (this change must not break any other test in it).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors. (`index.ts`'s own `riff-library-resolve-riff-with-context` handler just forwards the whole object over IPC — an added field is non-breaking there.)

- [ ] **Step 6: Commit**

```bash
git add src/main/riffLibraryStore.ts src/main/riffLibraryStore.test.ts
git commit -m "riffLibraryStore: expose raw rank from resolveRiffWithContext"
```

---

### Task 2: `discoverAdjacency.ts` — the pure outward-walk function, TDD

**Files:**
- Create: `src/main/discoverAdjacency.ts`
- Create: `src/main/discoverAdjacency.test.ts`

This is the part of the feature that's genuinely pure (no SQLite, no IPC) and gets real unit tests. Given an ordered window of rows, the center's own index within that window, a (possibly async) per-row matcher, and how many matches to collect per direction, it walks outward from the center in both directions and collects matches.

- [ ] **Step 1: Write the failing tests**

Create `src/main/discoverAdjacency.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { walkAdjacentWindow } from './discoverAdjacency'

describe('walkAdjacentWindow', () => {
  it('walks outward from the center in both directions, closest first', async () => {
    // Ranks 0..6, center at index 3 (rank 3). Every row "matches" (returns
    // its own rank), so this just proves the walk order/direction split.
    const window = [0, 1, 2, 3, 4, 5, 6]
    const matcher = vi.fn(async (row: number) => row)

    const result = await walkAdjacentWindow(window, 3, matcher, 10)

    // newer = smaller rank than center, closest first: 2, 1, 0
    expect(result.newer).toEqual([2, 1, 0])
    // older = larger rank than center, closest first: 4, 5, 6
    expect(result.older).toEqual([4, 5, 6])
  })

  it('stops each direction once maxPerDirection matches are found, even if more rows remain', async () => {
    const window = [0, 1, 2, 3, 4, 5, 6, 7, 8]
    const matcher = vi.fn(async (row: number) => row)

    const result = await walkAdjacentWindow(window, 4, matcher, 2)

    expect(result.newer).toEqual([3, 2])
    expect(result.older).toEqual([5, 6])
    // Never called the matcher for rows past what was needed to find 2
    // matches per direction (rank 0, 1 on the newer side; rank 7, 8 on the
    // older side).
    expect(matcher).not.toHaveBeenCalledWith(1)
    expect(matcher).not.toHaveBeenCalledWith(0)
    expect(matcher).not.toHaveBeenCalledWith(7)
    expect(matcher).not.toHaveBeenCalledWith(8)
  })

  it('skips non-matching rows (matcher returns null) without counting them', async () => {
    const window = [0, 1, 2, 3, 4, 5, 6]
    // Only even ranks "match".
    const matcher = vi.fn(async (row: number) => (row % 2 === 0 ? row : null))

    const result = await walkAdjacentWindow(window, 3, matcher, 2)

    // newer direction from rank 3 outward: 2 (match), 1 (skip), 0 (match) -- 2 found
    expect(result.newer).toEqual([2, 0])
    // older direction from rank 3 outward: 4 (match), 5 (skip), 6 (match) -- 2 found
    expect(result.older).toEqual([4, 6])
  })

  it('returns fewer than maxPerDirection matches when the window runs out first', async () => {
    const window = [0, 1, 2, 3]
    const matcher = vi.fn(async (row: number) => row)

    // Center at rank 1 -- only one row (rank 0) available on the newer
    // side, three available on the older side.
    const result = await walkAdjacentWindow(window, 1, matcher, 5)

    expect(result.newer).toEqual([0])
    expect(result.older).toEqual([2, 3])
  })

  it('returns empty arrays for a center with nothing on either side', async () => {
    const window = [0]
    const matcher = vi.fn(async (row: number) => row)

    const result = await walkAdjacentWindow(window, 0, matcher, 5)

    expect(result.newer).toEqual([])
    expect(result.older).toEqual([])
    expect(matcher).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/main/discoverAdjacency.test.ts`
Expected: FAIL — `./discoverAdjacency` doesn't exist yet.

- [ ] **Step 3: Write the implementation**

Create `src/main/discoverAdjacency.ts`:

```ts
// src/main/discoverAdjacency.ts

/** Result of walking outward from a center index in both directions --
 * `newer`/`older` name the two directions unambiguously in real, wall-clock
 * time (not "earlier"/"later", which inverts depending on whether you mean
 * chronological order or DESC-rank order -- see this plan's own "Before you
 * start" section). `newer[0]`/`older[0]`, when present, are always the
 * CLOSEST match to the center in that direction -- the row a popover's own
 * step ("skip to the next one this direction") button should act on. */
export interface AdjacentWalkResult<Match> {
  newer: Match[]
  older: Match[]
}

/** Walks outward from `centerIndex` in `window` (already ordered so that a
 * SMALLER index means a row recorded chronologically LATER -- exactly what
 * listRiffs' own `ORDER BY CreationTime DESC` produces, rank 0 = newest) in
 * both directions, calling `matcher` on each row until `maxPerDirection`
 * non-null results are collected per direction OR that direction's rows are
 * exhausted, whichever comes first. Pure -- no I/O of its own; `matcher` may
 * do I/O (real usage resolves a candidate riff's stems over IPC/SQLite, see
 * getAdjacentDiscoverCandidates below), but this function itself has no
 * side effects and is safe to unit test with plain data. */
export async function walkAdjacentWindow<Row, Match>(
  window: Row[],
  centerIndex: number,
  matcher: (row: Row) => Promise<Match | null>,
  maxPerDirection: number
): Promise<AdjacentWalkResult<Match>> {
  // Smaller index = smaller rank = larger CreationTime = recorded AFTER the
  // center = "newer". Walking from centerIndex - 1 down to 0 walks outward,
  // closest-to-center first -- .reverse() after the slice, since slice
  // itself preserves ascending order (index 0 first).
  const newerRows = window.slice(0, centerIndex).reverse()
  // Larger index = larger rank = smaller CreationTime = recorded BEFORE the
  // center = "older". Already closest-to-center first after slicing.
  const olderRows = window.slice(centerIndex + 1)

  async function collect(rows: Row[]): Promise<Match[]> {
    const out: Match[] = []
    for (const row of rows) {
      if (out.length >= maxPerDirection) break
      const match = await matcher(row)
      if (match !== null) out.push(match)
    }
    return out
  }

  const [newer, older] = await Promise.all([collect(newerRows), collect(olderRows)])
  return { newer, older }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/main/discoverAdjacency.test.ts`
Expected: PASS, 5/5.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/main/discoverAdjacency.ts src/main/discoverAdjacency.test.ts
git commit -m "discoverAdjacency: add walkAdjacentWindow (pure, TDD)"
```

---

### Task 3: `getAdjacentDiscoverCandidates` — the real, DB-backed wiring

**Files:**
- Modify: `src/main/discoverAdjacency.ts`

This is NOT unit-tested with a fake DB (this codebase's own convention for Electron-dependent code: exercise the real functions, don't mock `electron` wholesale) — it's covered by Task 6's manual walkthrough, plus the fact that everything it calls (`resolveRiffWithContext`, `listRiffs`, `resolveRiff`) already has its own real test coverage in `riffLibraryStore.test.ts`.

First, re-read `src/main/discoverCandidates.ts`'s exact current `DiscoverCandidate` interface (it's the wire type this function returns — reused directly, not duplicated):

```ts
export interface DiscoverCandidate {
  stemCID: string
  jamCID: string
  riffCID: string
  presetName: string
  creatorUserName: string
  arrangeRole: ArrangeRole
  drumSubRole: DrumSubRole | null
  riffBpm: number
}
```

And `src/shared/riffLibraryTypes.ts`'s `RiffLibraryRiffSummary` (what `listRiffs` returns per row) and `RiffLibraryResolvedStem` (what `resolveRiff` returns per stem):

```ts
export interface RiffLibraryRiffSummary {
  riffCID: string
  creationTime: number
  bpm: number
  barLength: number
  userName: string
  stemCount: number
  cachedStemCount: number
  ownerFraction: number
}

export interface RiffLibraryResolvedStem {
  stemCID: string
  slot: number
  path: string | null
  gain: number
  creatorUserName: string
  presetName: string
  instrumentMask: number
  durationSec: number
  barLength: number
  bpm?: number
  // (a downloadUrl field also exists, unused here)
}
```

- [ ] **Step 1: Add the wiring function**

Append to `src/main/discoverAdjacency.ts`:

```ts
import { SOUND_TYPE_TO_ARRANGE_ROLE, type ArrangeRole } from '@shared/stemRole'
import { instrumentMaskToSoundType } from '@shared/riffLibraryTypes'
import { guessSoundTypeFromPresetName } from '@shared/presetNames'
import {
  resolveRiffWithContext,
  listRiffs,
  resolveRiff,
  downloadMissingStems
} from './riffLibraryStore'
import type { DiscoverCandidate } from './discoverCandidates'

// How many role-matched candidates to surface per direction -- matches the
// design spec's own fixed default (docs/superpowers/specs/2026-09-16-
// discover-temporal-adjacency-design.md).
const ADJACENT_MATCHES_PER_DIRECTION = 4

// How many RAW riffs (matched or not) to fetch per direction before giving
// up looking for that many matches -- generously larger than
// ADJACENT_MATCHES_PER_DIRECTION, since most riffs in a jam won't have a
// stem in any one specific requested role at all.
const ADJACENT_FETCH_MULTIPLIER = 8
const ADJACENT_FETCH_PER_DIRECTION = ADJACENT_MATCHES_PER_DIRECTION * ADJACENT_FETCH_MULTIPLIER

/** Finds up to ADJACENT_MATCHES_PER_DIRECTION riffs recorded near
 * `centerRiffCID`, in the SAME jam's own iteration sequence, that have at
 * least one stem matching `role` -- see this plan's own header for the
 * architecture. `newer`/`older` are unambiguous, real chronological
 * directions (see walkAdjacentWindow's own doc comment) -- the CALLER maps
 * them to "earlier"/"later" UI labels (older -> earlier, newer -> later).
 * Returns `{ newer: [], older: [] }` (never throws) if `centerRiffCID`
 * can't be resolved at all -- same "never throws, empty means unavailable"
 * convention every other riffLibraryStore.ts-backed function in this
 * codebase already follows. */
export async function getAdjacentDiscoverCandidates(
  centerRiffCID: string,
  role: ArrangeRole
): Promise<AdjacentWalkResult<DiscoverCandidate>> {
  const context = resolveRiffWithContext(centerRiffCID)
  if (!context) return { newer: [], older: [] }

  const windowOffset = Math.max(0, context.rank - ADJACENT_FETCH_PER_DIRECTION)
  const page = listRiffs(context.jamCID, {
    offset: windowOffset,
    limit: ADJACENT_FETCH_PER_DIRECTION * 2 + 1
  })
  const centerIndex = page.riffs.findIndex((r) => r.riffCID === context.matchedRiffCID)
  // Shouldn't happen (the center riff itself is always inside a window
  // built around its own rank) -- defensive, matching this codebase's own
  // "never throw, degrade to empty" convention for riff-library lookups.
  if (centerIndex === -1) return { newer: [], older: [] }

  async function matchRole(summary: { riffCID: string }): Promise<DiscoverCandidate | null> {
    const resolved = resolveRiff(summary.riffCID)
    if (!resolved) return null
    for (const stem of resolved.stems) {
      const soundType =
        instrumentMaskToSoundType(stem.instrumentMask) ?? guessSoundTypeFromPresetName(stem.presetName)
      if (soundType === null) continue
      if (SOUND_TYPE_TO_ARRANGE_ROLE[soundType] !== role) continue
      return {
        stemCID: stem.stemCID,
        jamCID: context.jamCID,
        riffCID: summary.riffCID,
        presetName: stem.presetName,
        creatorUserName: stem.creatorUserName,
        arrangeRole: role,
        drumSubRole: null,
        riffBpm: resolved.bpm
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

  // Download audio only for riffs actually being returned (has a role
  // match) -- not speculatively for the whole fetched window, most of
  // which gets discarded before ever needing its audio. Matches the design
  // spec's own "Resolve concurrency" note.
  await Promise.all(
    [...result.newer, ...result.older].map((c) => downloadMissingStems(c.riffCID))
  )

  return result
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Lint**

Run: `npx eslint --cache src/main/discoverAdjacency.ts`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/main/discoverAdjacency.ts
git commit -m "discoverAdjacency: add getAdjacentDiscoverCandidates"
```

---

### Task 4: IPC handler + preload bridge

**Files:**
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`

First, re-read `src/main/index.ts`'s real current imports from `riffLibraryStore.ts`/`discoverCandidates.ts` and its real current `ipcMain.handle` list around the existing `riff-library-*` and `get-discover-*` handlers, to place this consistently. The naming convention confirmed from the real file: kebab-case channel names, `get-discover-*` for Discover-specific reads (e.g. `get-discover-candidates`, `get-discover-settings`).

- [ ] **Step 1: Add the import**

In `src/main/index.ts`, find the existing import block that includes:

```ts
  resolveRiff,
  resolveRiffWithContext,
```

(from `'./riffLibraryStore'`) and, near wherever `discoverCandidates.ts`'s own exports are imported (e.g. alongside `getDiscoverCandidates`), add:

```ts
import { getAdjacentDiscoverCandidates } from './discoverAdjacency'
```

- [ ] **Step 2: Add the handler**

Find the existing handler:

```ts
  ipcMain.handle(
    'get-discover-candidates',
```

and add a new handler near it:

```ts
  ipcMain.handle(
    'get-adjacent-discover-candidates',
    (_event, centerRiffCID: string, role: ArrangeRole) =>
      getAdjacentDiscoverCandidates(centerRiffCID, role)
  )
```

(`ArrangeRole` is already imported in this file — it's used by the existing `get-discover-candidates`/`upsert-stem-category-role` handlers already visible nearby. If it isn't already in scope at this exact spot for some reason, add `import type { ArrangeRole } from '@shared/stemRole'` alongside this file's other `@shared` type imports.)

- [ ] **Step 3: Add the preload bridge method**

In `src/preload/index.ts`, find:

```ts
  upsertStemCategoryRole: (
```

and add, near it or near `getDiscoverCandidates`'s own bridge entry:

```ts
  getAdjacentDiscoverCandidates: (
    centerRiffCID: string,
    role: ArrangeRole
  ): Promise<{ newer: DiscoverCandidate[]; older: DiscoverCandidate[] }> =>
    ipcRenderer.invoke('get-adjacent-discover-candidates', centerRiffCID, role),
```

Check this file's real current imports for `DiscoverCandidate` and `ArrangeRole` — both are very likely already imported (the existing `getDiscoverCandidates`/`upsertStemCategoryRole` bridge entries use them). If either is missing, add:

```ts
import type { DiscoverCandidate } from '../main/discoverCandidates'
import type { ArrangeRole } from '@shared/stemRole'
```

matching whatever this file's own existing import style for these two types already is (re-read it fresh — don't guess the exact path alias vs. relative-path convention without checking).

Also check `src/preload/index.d.ts` (or wherever this file's own exposed-API type declaration lives, if `window.rifffApi`'s type isn't inferred directly from this same file) — if there's a separate declaration file, add the matching entry there too.

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Lint**

Run: `npx eslint --cache src/main/index.ts src/preload/index.ts`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/main/index.ts src/preload/index.ts
git commit -m "Add get-adjacent-discover-candidates IPC handler + bridge"
```

---

### Task 5: `DiscoverSlotRow` — shrink icon buttons, add the trigger

**Files:**
- Modify: `src/renderer/src/components/DiscoverPanel.tsx`

Re-read `DiscoverSlotRow`'s real current button row fresh before starting (it has been touched many times this session). As of this plan being written, it renders these 7 icon buttons, each with `width: 22, height: 22` in its own inline style object: the lock button, the mute ("m") button, the solo ("s") button, the favourite (star) button, the reroll (shuffle icon) button, the random (dice icon) button, and the remove ("X") button.

- [ ] **Step 1: Shrink every existing icon button from 22×22 to 18×18**

Find every occurrence of `width: 22,\n          height: 22,` (or `width: 22, height: 22` with whatever the real current indentation is) **within `DiscoverSlotRow`'s own return block specifically** (not the tempo stepper buttons elsewhere in this file, which are already 18×18, and not the "resolving" placeholder box, which uses `height: 40` for a different reason). Change each to `width: 18, height: 18`. There are 7 of them (lock, mute, solo, favourite, reroll, random, remove) — confirm the count matches before moving on; if it doesn't, you're either missing one or have edited something outside `DiscoverSlotRow`.

- [ ] **Step 2: Add a hand-drawn icon for the new button**

Find where `LockGlyph`/`ShuffleIcon`/`DiceIcon`/`StarIcon` are defined (small standalone functions near the bottom of this file, each a plain inline SVG, `currentColor`-based, no icon library — this codebase's own established convention). Add a new one alongside them:

```tsx
// Three connected waypoints -- "browse nearby points along this jam's own
// timeline." Same hand-drawn, monochrome-via-currentColor convention as
// LockGlyph/ShuffleIcon/DiceIcon/StarIcon just above -- no icon library.
function NearbyIcon(): React.JSX.Element {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
      <circle cx="3" cy="8" r="1.6" />
      <circle cx="8" cy="3" r="1.6" />
      <circle cx="8" cy="13" r="1.6" />
      <circle cx="13" cy="8" r="1.6" />
      <line x1="4.3" y1="7.3" x2="6.7" y2="4.3" />
      <line x1="4.3" y1="8.7" x2="6.7" y2="11.7" />
      <line x1="9.3" y1="4.3" x2="11.7" y2="7.3" />
      <line x1="9.3" y1="11.7" x2="11.7" y2="8.7" />
    </svg>
  )
}
```

- [ ] **Step 3: Add the trigger button and popover state to `DiscoverSlotRow`**

Re-read `DiscoverSlotRow`'s own current props list and its `resolvedStem`/`resolveFailed`/`resolving` local derivation (all near the top of the function) before this step — the new button is gated the same way the existing mute/solo/favourite buttons already are (`{resolvedStem && (...)}`), but ALSO requires `slot.candidate !== null` specifically (not just `resolvedStem` truthy) — a seeded slot's `resolvedStem` can be truthy via `seedStem` with no real `candidate`/`riffCID` to anchor adjacency from.

Add two new pieces of local state near this component's other `useState`/`useRef` declarations:

```tsx
  const [nearbyMenu, setNearbyMenu] = useState<{ x: number; y: number } | null>(null)
  const nearbyButtonRef = useRef<HTMLButtonElement>(null)
```

Add a new prop to `DiscoverSlotRow`'s own props (both the destructure and its type block): `onSwapFromNearby: (candidate: DiscoverCandidate) => void`, documented the same way `onReroll`/`onRerollRandom` are just above it:

```tsx
  /** DiscoverPanel's own swapSlotFromNearby -- called when the user picks a
   * candidate from this slot's own "explore nearby" popover. Same instant,
   * undoable swap as a normal reroll landing; see swapSlotFromNearby's own
   * doc comment in DiscoverPanel. */
  onSwapFromNearby: (candidate: DiscoverCandidate) => void
```

Add the button itself, inside the existing `{resolvedStem && (<>...</>)}` block, right after the favourite button and before the closing `</>`:

```tsx
          {slot.candidate !== null && (
            <button
              ref={nearbyButtonRef}
              onClick={(e) => {
                if (nearbyMenu) {
                  setNearbyMenu(null)
                  return
                }
                const rect = e.currentTarget.getBoundingClientRect()
                setNearbyMenu({ x: rect.left, y: rect.bottom + 4 })
              }}
              title="explore riffs recorded near this one in the same jam"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 18,
                height: 18,
                padding: 0,
                background: nearbyMenu ? 'var(--ra-stretch-on-bg)' : 'var(--ra-bg-row-active)',
                border: `1px solid ${nearbyMenu ? 'var(--ra-stretch-on)' : 'var(--ra-border)'}`,
                color: nearbyMenu ? 'var(--ra-stretch-on)' : 'var(--ra-text-2)',
                cursor: 'pointer'
              }}
            >
              <NearbyIcon />
            </button>
          )}
```

And, right after the closing tag of `DiscoverSlotRow`'s own outer returned `<div>` (i.e. as a sibling, not nested inside it — matching how a positioned popover/menu is rendered as a sibling elsewhere in this app, e.g. `ContextMenu` usage in `App.tsx`), conditionally render the popover from Task 6:

```tsx
      {nearbyMenu && slot.candidate !== null && (
        <DiscoverNearbyPopover
          x={nearbyMenu.x}
          y={nearbyMenu.y}
          startCandidate={slot.candidate}
          role={slot.role}
          onPick={onSwapFromNearby}
          onClose={() => setNearbyMenu(null)}
          ignoreRef={nearbyButtonRef}
        />
      )}
```

(This will fail to typecheck until Task 6 creates `DiscoverNearbyPopover` — that's expected and fine; Task 6 is next.)

- [ ] **Step 4: Wire the new prop at `DiscoverSlotRow`'s own call site**

Find where `DiscoverPanel` renders `<DiscoverSlotRow ... onGainChange={(gain) => updateSlotGain(slot.id, gain)} />` and add, alongside the other `on*` props:

```tsx
            onSwapFromNearby={(candidate) => swapSlotFromNearby(slot.id, candidate)}
```

(`swapSlotFromNearby` is added to `DiscoverPanel` itself in Task 7 — this call site edit can land now; it'll typecheck once that function exists.)

- [ ] **Step 5: Commit**

This task's own typecheck/lint won't be clean until Tasks 6–7 land (missing `DiscoverNearbyPopover` import and `swapSlotFromNearby`) — that's expected given the dependency order. Stage and commit anyway with a note, OR (simpler) treat Tasks 5–7 as one combined commit at the end of Task 7. **Recommended: skip committing at the end of this task; commit once at the end of Task 7 instead**, so every commit in this plan independently typechecks/lints clean. Say so explicitly if you deviate.

---

### Task 6: `DiscoverNearbyPopover` component

**Files:**
- Create: `src/renderer/src/components/DiscoverNearbyPopover.tsx`

Re-read `src/renderer/src/components/ContextMenu.tsx` in full immediately before starting this task (already quoted in the design research, but re-verify fresh) — this component's own positioning-clamp (`useLayoutEffect` measuring real rendered size against `window.innerWidth`/`innerHeight`), outside-click dismissal (capture-phase `window` listener registered on a `setTimeout(..., 0)` so the opening click itself doesn't immediately close it), and Escape-to-close pattern are reused here, adapted to this popover's own richer content (not `ContextMenu` itself, which only renders a flat list of `{label, onClick}` items — too rigid for waveform thumbnails/sections/step-buttons/a header).

Also re-read `src/renderer/src/components/Waveform.tsx`'s props (`path: string`, `color: string`, `opacity?: number`) and `src/renderer/src/components/LoadingLoader.tsx`'s props (a `size` prop, used elsewhere in `DiscoverPanel.tsx` as `<LoadingLoader size={16} />`) fresh before writing the candidate-row JSX below.

```tsx
// src/renderer/src/components/DiscoverNearbyPopover.tsx
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Waveform } from './Waveform'
import { LoadingLoader } from './LoadingLoader'
import type { ArrangeRole } from '@shared/stemRole'
import type { DiscoverCandidate } from '../../../main/discoverAdjacency'

// Fixed size for every candidate's own waveform thumbnail -- deliberately
// NOT DiscoverSlotRow's own proportional bar-length tiling (that's for
// comparing relative loop lengths within the arrangement; this is a short
// browsing list, where a fixed box keeps entries from visibly jumping
// around as they resolve at different times). Direct request, 2026-09-16.
const THUMB_WIDTH = 96
const THUMB_HEIGHT = 32

// No client-side cap constant here -- getAdjacentDiscoverCandidates
// (discoverAdjacency.ts) already returns at most 4 per direction; re-capping
// here would be dead defensiveness against a contract this popover already
// controls both ends of.

/** One resolved-or-resolving candidate stem, shown as a fixed-size
 * thumbnail. `path` is undefined while the real stem audio hasn't
 * downloaded yet (see getAdjacentDiscoverCandidates' own downloadMissingStems
 * call -- by the time this popover has a candidate at all, its download has
 * already been kicked off on the main-process side; this local resolve step
 * just waits for the SAME real stem-resolve pipeline DiscoverSlotRow itself
 * already uses, via resolveCandidateStem). */
function CandidateRow({
  candidate,
  onClick
}: {
  candidate: DiscoverCandidate
  onClick: () => void
}): React.JSX.Element {
  const [path, setPath] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    setPath(null)
    setFailed(false)
    window.rifffApi
      .riffLibraryResolveRiff(candidate.riffCID)
      .then((resolved) => {
        if (cancelled) return
        const stem = resolved?.stems.find((s) => s.stemCID === candidate.stemCID)
        if (stem?.path) setPath(stem.path)
        else setFailed(true)
      })
      .catch((err) => {
        console.error('DiscoverNearbyPopover: failed to resolve candidate stem:', err)
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [candidate.riffCID, candidate.stemCID])

  return (
    <button
      onClick={onClick}
      title={candidate.presetName || candidate.stemCID}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        width: THUMB_WIDTH,
        padding: 0,
        background: 'transparent',
        border: '1px solid var(--ra-border)',
        cursor: 'pointer',
        flexShrink: 0
      }}
    >
      <div
        style={{
          position: 'relative',
          width: THUMB_WIDTH - 2,
          height: THUMB_HEIGHT,
          overflow: 'hidden',
          background: 'var(--ra-bg-row-sub)'
        }}
      >
        {path && <Waveform path={path} color="var(--ra-text-3)" opacity={1} />}
        {!path && !failed && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <LoadingLoader size={14} />
          </div>
        )}
      </div>
      <span
        style={{
          fontSize: 8,
          color: 'var(--ra-text-3)',
          padding: '0 3px 3px',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap'
        }}
      >
        {candidate.presetName || '(untitled)'}
      </span>
    </button>
  )
}

function Section({
  label,
  candidates,
  loading,
  onStep,
  onPick
}: {
  label: string
  candidates: DiscoverCandidate[]
  loading: boolean
  onStep: () => void
  onPick: (candidate: DiscoverCandidate) => void
}): React.JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 9, color: 'var(--ra-text-3)' }}>{label}</span>
        <button
          onClick={onStep}
          disabled={candidates.length === 0}
          title={`skip to the next ${label} match`}
          style={{
            width: 16,
            height: 16,
            padding: 0,
            fontSize: 9,
            border: '1px solid var(--ra-border)',
            background: 'var(--ra-bg-row-active)',
            color: candidates.length === 0 ? 'var(--ra-text-4)' : 'var(--ra-text)',
            cursor: candidates.length === 0 ? 'default' : 'pointer'
          }}
        >
          {label === 'earlier' ? '<' : '>'}
        </button>
      </div>
      <div style={{ display: 'flex', gap: 6, minHeight: THUMB_HEIGHT + 14 }}>
        {candidates.map((c) => (
          <CandidateRow key={c.stemCID} candidate={c} onClick={() => onPick(c)} />
        ))}
        {!loading && candidates.length === 0 && (
          <span style={{ fontSize: 9, color: 'var(--ra-text-4)', alignSelf: 'center' }}>
            no nearby match found
          </span>
        )}
      </div>
    </div>
  )
}

export function DiscoverNearbyPopover({
  x,
  y,
  startCandidate,
  role,
  onPick,
  onClose,
  ignoreRef
}: {
  x: number
  y: number
  /** The slot's own candidate at the moment this popover was opened --
   * "back to start" returns to exactly this, without needing a fresh IPC
   * round trip to reconstruct it. */
  startCandidate: DiscoverCandidate
  role: ArrangeRole
  /** DiscoverSlotRow's own onSwapFromNearby -- fires on every pick, INCLUDING
   * a step-button pick or "back to start." This popover recenters its own
   * browsing around whatever was just picked; it does NOT close itself. */
  onPick: (candidate: DiscoverCandidate) => void
  onClose: () => void
  ignoreRef: React.RefObject<HTMLElement | null>
}): React.JSX.Element {
  // Tracks the full candidate, not just its riffCID -- the header below
  // shows this candidate's own presetName/creatorUserName for orientation
  // ("what am I centered on right now"), which a bare riffCID string
  // wouldn't give us without a second IPC round trip. Starts as
  // `startCandidate`, becomes whatever was last picked.
  const [centerCandidate, setCenterCandidate] = useState(startCandidate)
  const [candidates, setCandidates] = useState<{
    newer: DiscoverCandidate[]
    older: DiscoverCandidate[]
  }>({ newer: [], older: [] })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    window.rifffApi
      .getAdjacentDiscoverCandidates(centerCandidate.riffCID, role)
      .then((result) => {
        if (!cancelled) setCandidates(result)
      })
      .catch((err) => {
        console.error('DiscoverNearbyPopover: getAdjacentDiscoverCandidates failed:', err)
        if (!cancelled) setCandidates({ newer: [], older: [] })
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [centerCandidate.riffCID, role])

  function handlePick(candidate: DiscoverCandidate): void {
    onPick(candidate)
    setCenterCandidate(candidate)
  }

  // --- Positioning + dismissal, mirroring ContextMenu.tsx's own pattern ---
  const menuRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ left: x, top: y })

  useLayoutEffect(() => {
    const el = menuRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const margin = 8
    const left = Math.max(margin, Math.min(x, window.innerWidth - rect.width - margin))
    const top = Math.max(margin, Math.min(y, window.innerHeight - rect.height - margin))
    setPosition({ left, top })
  }, [x, y])

  useEffect(() => {
    function handleDismiss(e: MouseEvent): void {
      if (menuRef.current?.contains(e.target as Node)) return
      if (ignoreRef.current?.contains(e.target as Node)) return
      onClose()
    }
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose()
    }
    const id = setTimeout(() => {
      window.addEventListener('click', handleDismiss, true)
    }, 0)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      clearTimeout(id)
      window.removeEventListener('click', handleDismiss, true)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose, ignoreRef])

  const atStart = centerCandidate.riffCID === startCandidate.riffCID

  return (
    <div
      ref={menuRef}
      style={{
        position: 'fixed',
        left: position.left,
        top: position.top,
        zIndex: 1200,
        background: 'var(--ra-bg-bar)',
        border: '1px solid var(--ra-border-strong)',
        padding: 8,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        boxShadow: '0 6px 20px rgba(0,0,0,0.4)'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {/* Orientation: which riff is currently the center of this popover's
            own browsing, not the whole loading/count state -- direct spec
            requirement ("A small header shows the current center riff...").
            Fixed max-width + ellipsis so a long preset name can't push the
            "back to start" button off the popover's own edge. */}
        <span
          style={{
            fontSize: 9,
            color: 'var(--ra-text-3)',
            maxWidth: 160,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap'
          }}
          title={`${centerCandidate.presetName || '(untitled)'} — ${centerCandidate.creatorUserName}`}
        >
          near {centerCandidate.presetName || '(untitled)'}
        </span>
        <button
          onClick={() => handlePick(startCandidate)}
          disabled={atStart}
          title="back to the riff this slot started with"
          style={{
            marginLeft: 'auto',
            fontSize: 9,
            padding: '2px 6px',
            border: '1px solid var(--ra-border)',
            background: 'var(--ra-bg-row-active)',
            color: atStart ? 'var(--ra-text-4)' : 'var(--ra-text)',
            cursor: atStart ? 'default' : 'pointer'
          }}
        >
          back to start
        </button>
      </div>
      {/* older = recorded chronologically BEFORE the center -- the
          "earlier" section, see this plan's own terminology note. */}
      <Section
        label="earlier"
        candidates={candidates.older}
        loading={loading}
        onStep={() => candidates.older[0] && handlePick(candidates.older[0])}
        onPick={handlePick}
      />
      {/* newer = recorded chronologically AFTER the center -- "later". */}
      <Section
        label="later"
        candidates={candidates.newer}
        loading={loading}
        onStep={() => candidates.newer[0] && handlePick(candidates.newer[0])}
        onPick={handlePick}
      />
    </div>
  )
}
```

- [ ] **Step 1: Fix the import in `DiscoverPanel.tsx`/`DiscoverSlotRow`**

Task 5 wrote `import` usage implicitly via JSX (`<DiscoverNearbyPopover ...>`) — add the actual import line near this file's other component imports:

```tsx
import { DiscoverNearbyPopover } from './DiscoverNearbyPopover'
```

- [ ] **Step 2: Fix `DiscoverCandidate` import path used above**

This plan's own draft of `DiscoverNearbyPopover.tsx` imports `DiscoverCandidate` from `'../../../main/discoverAdjacency'` — but `discoverAdjacency.ts` (Task 3) does NOT itself export `DiscoverCandidate`, it only re-exports the TYPE via its own function signatures (it imports `DiscoverCandidate` from `./discoverCandidates`, Task 3's own code). Fix the import in `DiscoverNearbyPopover.tsx` to the real source:

```tsx
import type { DiscoverCandidate } from '../../../main/discoverCandidates'
```

(matching `DiscoverPanel.tsx`'s own existing import of the same type, confirmed at this file's own top-of-file import block: `import type { DiscoverCandidate } from '../../../main/discoverCandidates'`.)

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors. If `window.rifffApi.getAdjacentDiscoverCandidates` isn't recognized, re-check Task 4's preload bridge addition landed with the exact method name used here.

- [ ] **Step 4: Lint**

Run: `npx eslint --cache src/renderer/src/components/DiscoverNearbyPopover.tsx src/renderer/src/components/DiscoverPanel.tsx`
Expected: no errors.

- [ ] **Step 5: Do NOT commit yet** — Task 7 adds `swapSlotFromNearby`, which this component's own call site (Task 5) already references. Commit once, at the end of Task 7.

---

### Task 7: `swapSlotFromNearby` in `DiscoverPanel`

**Files:**
- Modify: `src/renderer/src/components/DiscoverPanel.tsx`

Re-read `rollForSlot`'s own final `setSlots` call fresh (already quoted in this plan's own research, but re-verify — this function has been touched multiple times this session):

```ts
      setSlots((prev) =>
        prev.map((s) =>
          s.id === id ? { ...s, candidate: picked, hasRerolled: true, seedStem: undefined } : s
        )
      )
```

`swapSlotFromNearby` mirrors this exactly (a picked adjacent candidate is a real, already-resolved-enough `DiscoverCandidate` — no ranking/fetching needed, just the same "commit this as the slot's new candidate" shape), plus the same `pushUndoSnapshot()` every other slot-content action in this file already calls first.

- [ ] **Step 1: Add the function**

Find `toggleLock` (a short, simple function near the other slot-mutating functions):

```ts
  function toggleLock(id: string): void {
    setSlots((prev) => prev.map((s) => (s.id === id ? { ...s, locked: !s.locked } : s)))
  }
```

Add, right after it:

```ts
  // Commits a candidate picked from a slot's own "explore nearby" popover
  // -- same instant, undoable swap as a normal reroll landing (rollForSlot's
  // own final setSlots call, mirrored exactly here), just skipping the
  // fetch/rank/pick machinery since the popover already handed us a real,
  // specific candidate to use. Direct request, 2026-09-16 (temporal
  // adjacency exploration) -- see docs/superpowers/specs/2026-09-16-
  // discover-temporal-adjacency-design.md.
  function swapSlotFromNearby(id: string, candidate: DiscoverCandidate): void {
    pushUndoSnapshot()
    setSlots((prev) =>
      prev.map((s) =>
        s.id === id ? { ...s, candidate, hasRerolled: true, seedStem: undefined } : s
      )
    )
  }
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors — this closes the last dangling reference from Task 5's own call site.

- [ ] **Step 3: Lint**

Run: `npx eslint --cache src/renderer/src/components/DiscoverPanel.tsx src/renderer/src/components/DiscoverNearbyPopover.tsx`
Expected: no errors.

- [ ] **Step 4: Run the full test suite**

Run: `npm test`
Expected: PASS, full suite (nothing in Tasks 5–7 touches tested logic directly, but this confirms nothing else broke).

- [ ] **Step 5: Commit** (this is the combined commit for Tasks 5–7)

```bash
git add src/renderer/src/components/DiscoverPanel.tsx src/renderer/src/components/DiscoverNearbyPopover.tsx
git commit -m "DiscoverPanel: add temporal adjacency exploration popover"
```

---

### Task 8: Final verification + manual walkthrough

**Files:** none (verification only)

- [ ] **Step 1: Full verification pass**

Run, in order:
```bash
npm run typecheck
npm run lint
npm test
```
All three must be clean/passing. If lint reports pre-existing issues unrelated to this plan's own changed files, note them but don't fix them here (out of scope).

- [ ] **Step 2: Diff review**

Run: `git log --oneline` (this plan's own commits) and `git diff <first-commit-of-this-plan>^..HEAD` — read the whole diff once, end to end, checking specifically for: the `newer`/`older` vs. "earlier"/"later" mapping (Section labels in `DiscoverNearbyPopover.tsx` — `older` must render under the "earlier" heading, `newer` under "later"), and that every button touched in Task 5 is genuinely 18×18, not accidentally left at 22 or changed to some other value.

- [ ] **Step 3: Report the manual walkthrough checklist**

This environment cannot click a real popover, hear real audio, or browse a real riff library — say so explicitly rather than claiming the feature is "confirmed working." Report back to Elling with exactly this checklist, needing his own hands-on confirmation:

- Open the popover (the new waypoints icon) on a resolved slot with real nearby role-matched riffs in both directions — both "earlier" and "later" sections populate with fixed-size, non-jumping thumbnails as they resolve.
- A slot whose riff sits at the very start or end of its jam — the section with nothing on that side shows "no nearby match found," not a blank area or an error.
- A slot whose role has no nearby match in either direction at all — both sections show the empty state.
- Click a candidate — it swaps into the slot immediately (same as a normal reroll), and both sections recompute around the new candidate.
- Click a candidate again, several times in the same direction — each click keeps finding new matches further out (a real click-through chain along the jam's timeline).
- Use a section's own `<`/`>` step button — identical result to clicking that section's own nearest candidate, without having to look at the thumbnails first.
- After chaining a few clicks away, click "back to start" — returns exactly to the riff the slot held when the popover was first opened.
- Undo (the panel's own existing undo button) after a nearby-pick — reverts that swap, same as undoing a normal reroll.
- A seeded slot with no `candidate` (only `seedStem`) — the new waypoints button doesn't render on that row at all.
- Open the popover, then click elsewhere on screen / press Escape — it closes.
- Open the popover near the right or bottom edge of the window — it stays fully on-screen (positioning clamp working).

- [ ] **Step 4: Report to the user**

Summarize what shipped, list the 8 walkthrough items above verbatim, and note this environment's own limits on verifying UI/audio behavior directly.
