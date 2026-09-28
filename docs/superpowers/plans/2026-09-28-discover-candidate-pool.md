# Discover candidate pool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep a stock of Discover candidates warm per slot-kind key in the main process, topped up
in the background, so `get-discover-candidates` draws from memory and a reroll stops costing
hundreds of milliseconds of SQLite.

**Architecture:** Four phases. Phase 1 is a pure, TDD'd store in `src/shared/` with no Electron and
no SQL — keys, draws, water marks, LRU. Phase 2 puts it behind the existing IPC handler in main, so
**the renderer changes not at all** and the app is faster the moment it lands. Phase 3 adds the
background refill with the classifier's scheduling posture. Phase 4 adds invalidation. Each phase
leaves the app working.

**Tech Stack:** TypeScript, Electron main, vitest.

**Spec:** `docs/superpowers/specs/2026-09-28-discover-candidate-pool-design.md` (2026-09-28). Its
§11 "not now" list is the scope boundary — **if something is not named as in, it is out.**

---

## READ THIS BEFORE TASK 1

### 1. The pool is NOT the fix for the late radio start. That already shipped.

Three commits landed on `master` before this plan was written, and the plan assumes them:

| | commit | what |
|---|---|---|
| 1 | `705510a` | the next pick waits for the current change to reach the engine |
| 2 | `8d81f22` | the jam list is kept until the jams change, not for sixty seconds |
| 3 | `5b0a91b` | the scan target walk yields on a clock, not on a row count |

`705510a` is the one that fixed the reported symptom. **If you find yourself justifying a decision
in this plan by "it makes radio land on time", stop — that is already done, and you are about to
build the wrong thing.** What this plan is for is `similar`, `rerollAll`, and a new slot's first
roll, which pay the same cost with no interval to hide in. Spec §9.

### 2. The measured cost you are removing

A mask-kind roll on Elling's library (5,056 jams, 372,319 riffs, a 541 MB warehouse on a **USB /
ExFAT** volume) costs **~300–450 ms of its own work**, dominated by:

- five external `Stems WHERE StemCID IN (200)` queries — **273 ms warm**,
- the per-kind admitted walk — 10–30 ms,
- `readClassificationSignature` — 5–13 ms.

Not by the kind-index rebuild (37–69 ms) and not by the yields (8 µs each). Spec §2.

### 3. Main-process SQLite rules, both learned from real crashes

- **Never `.iterate()` across an `await`.** Use `.all()`. This caused a real live crash.
- **Batch by db connection, not by looping requeries** — jams share one database.

Nothing in this plan writes new SQL. It calls `getDiscoverCandidates` unchanged. If you find
yourself writing a query, you have left the plan's scope.

### 4. `vitest.config.ts` — the list that broke six weeks of releases

Any **new** main-process test file that opens better-sqlite3 **must** be added to the CI exclusion
list in `vitest.config.ts`. A stale list silently broke every release for six weeks.

**This plan adds exactly one such file** (`src/main/discoverCandidatePool.test.ts`, Task 6), and
adding it to that list is **Task 6, Step 5 — a numbered, non-optional step.** Do not skip it
because the tests pass locally; the local run does not use the exclusion list.

`src/shared/discoverCandidatePoolStore.test.ts` (Phase 1) opens no database and must **not** be
added to that list.

### 5. React components are not unit-tested here

This codebase does not unit-test React components (CLAUDE.md, Testing conventions). **This plan
requires no renderer change at all** — Phase 2 puts the pool behind the existing IPC handler, so
`DiscoverPanel.tsx` is untouched. If you conclude a renderer change is needed, stop and report it.

Nothing in this plan can be verified by a coding agent clicking through the app. Say so rather than
claiming a UI change was tested.

### 6. NO `native-engine/` CHANGES

Nothing here reaches it.

**Baseline (verified on `master`, 2026-09-28, commit `5b0a91b`):**

```
Test Files  201 passed (201)
     Tests  3287 passed (3287)
```

`npm run typecheck` — 0 errors. `npm run lint` — **0 errors, 4 pre-existing prettier warnings**
(`generate-x64-test-config.js:46`, `categoryCentroidStore.test.ts:30`,
`categoryCentroidTraining.ts:59`, `stemCategoriesBackfill.test.ts:69`). Those four are the
baseline; do not fix them and do not add a fifth.

Known flakes under parallel load, neither caused by this plan:
`pluginScan.test.ts > … a real installed VST3`, and occasionally
`playbackEngineLifecycle.test.ts`. Both pass when run alone.

---

## File structure

| file | responsibility |
|---|---|
| **Create** `src/shared/discoverCandidatePoolStore.ts` | Pure store: the key, draw, fill, water mark, age ceiling, LRU. No Electron, no SQL, no `DiscoverCandidate` import — generic over the item type so it stays trivially testable. |
| **Create** `src/shared/discoverCandidatePoolStore.test.ts` | Its tests. TDD. No database. |
| **Create** `src/main/discoverCandidatePool.ts` | Binds the store to `getDiscoverCandidates`: draw-or-fall-through, seeding, the refill scheduler, invalidation. The only file that knows both halves. |
| **Create** `src/main/discoverCandidatePool.test.ts` | Its tests. **Opens better-sqlite3 → goes in `vitest.config.ts`'s CI exclusion list (Task 6 Step 5).** |
| **Modify** `src/main/index.ts` | `get-discover-candidates` calls the pool instead of the query directly; start the refill loop at ready. |
| **Modify** `src/main/riffLibraryStore.ts` | `closeRiffLibraryDb()` also clears the pool. |
| **Modify** `vitest.config.ts` | One line. Task 6 Step 5. |

`src/main/discoverCandidates.ts` is **not** modified. It is the most-tested file in this area and
stays a pure-ish query module that knows nothing about pooling.

---

# Phase 1 — the pure store

No Electron, no SQL. Everything here is TDD'd per CLAUDE.md.

## Task 1: The pool key

**Files:**
- Create: `src/shared/discoverCandidatePoolStore.ts`
- Create: `src/shared/discoverCandidatePoolStore.test.ts`

The key must cover everything that changes the query's answer: the normalized kind set, and the
roll options `onlyOwnStems` / `targetUser` / `soundSource`. A pool drawn under "endlesss only" must
never be served to a roll that has since turned audio-in back on.

- [ ] **Step 1: Write the failing test**

```ts
// src/shared/discoverCandidatePoolStore.test.ts
import { describe, expect, it } from 'vitest'
import { candidatePoolKey } from './discoverCandidatePoolStore'

const BOTH = { endlesss: true, audioIn: true }

describe('candidatePoolKey', () => {
  it('is stable across kind order, because normalizeSlotKinds already decides the pool', () => {
    expect(candidatePoolKey({ kinds: ['lead', 'drums'], soundSource: BOTH })).toBe(
      candidatePoolKey({ kinds: ['drums', 'lead'], soundSource: BOTH })
    )
  })

  it('separates kind sets', () => {
    expect(candidatePoolKey({ kinds: ['drums'], soundSource: BOTH })).not.toBe(
      candidatePoolKey({ kinds: ['bass'], soundSource: BOTH })
    )
  })

  it('separates the sound-source filter, so an endlesss-only pool is never served to an audio-in roll', () => {
    expect(
      candidatePoolKey({ kinds: ['drums'], soundSource: { endlesss: true, audioIn: false } })
    ).not.toBe(
      candidatePoolKey({ kinds: ['drums'], soundSource: { endlesss: true, audioIn: true } })
    )
  })

  it('separates onlyOwnStems, and the user it is scoped to', () => {
    const open = candidatePoolKey({ kinds: ['drums'], soundSource: BOTH })
    const mine = candidatePoolKey({
      kinds: ['drums'],
      soundSource: BOTH,
      onlyOwnStems: true,
      targetUser: 'elling'
    })
    const theirs = candidatePoolKey({
      kinds: ['drums'],
      soundSource: BOTH,
      onlyOwnStems: true,
      targetUser: 'someone'
    })
    expect(new Set([open, mine, theirs]).size).toBe(3)
  })

  it('ignores targetUser when onlyOwnStems is off, since the query does too', () => {
    expect(
      candidatePoolKey({ kinds: ['drums'], soundSource: BOTH, targetUser: 'elling' })
    ).toBe(candidatePoolKey({ kinds: ['drums'], soundSource: BOTH }))
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/shared/discoverCandidatePoolStore.test.ts`
Expected: FAIL — `Failed to resolve import "./discoverCandidatePoolStore"`.

- [ ] **Step 3: Write the implementation**

```ts
// src/shared/discoverCandidatePoolStore.ts
//
// The warm candidate pool's own bookkeeping, with no Electron, no SQL and
// no knowledge of what a candidate is -- see
// docs/superpowers/specs/2026-09-28-discover-candidate-pool-design.md.
// main/discoverCandidatePool.ts binds this to the real query; everything
// that can be decided without a database is decided here, where it can be
// tested without one.
import { slotKindsKey, type DiscoverSlotKind } from './discoverSlotKind'
import type { DiscoverSoundSourceFilter } from './riffLibraryTypes'

/** Everything about a roll that changes which candidates are eligible.
 * Mirrors getDiscoverCandidates' own parameters exactly -- if that
 * function grows a filter, it belongs here the same day, or a pool drawn
 * under one filter will be served to a roll asking for another. */
export interface CandidatePoolRequest {
  kinds: readonly DiscoverSlotKind[]
  soundSource: DiscoverSoundSourceFilter
  onlyOwnStems?: boolean
  targetUser?: string
}

/** The pool's identity for a request. `slotKindsKey` is reused rather than
 * re-derived because it is already what decides the SQL pool -- so the
 * pool can never disagree with the query about what a slot is asking for.
 *
 * targetUser is part of the key ONLY when onlyOwnStems is on, matching
 * getDiscoverCandidates' own `onlyOwnStems && CreatorUserName !== targetUser`
 * check: with the flag off the name is not consulted, so keying on it would
 * split one pool into needless duplicates. */
export function candidatePoolKey(request: CandidatePoolRequest): string {
  const owner = request.onlyOwnStems ? (request.targetUser ?? '') : ''
  const source = `${request.soundSource.endlesss ? 'e' : ''}${request.soundSource.audioIn ? 'a' : ''}`
  return `${slotKindsKey(request.kinds)}|${owner}|${source}`
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run src/shared/discoverCandidatePoolStore.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/shared/discoverCandidatePoolStore.ts src/shared/discoverCandidatePoolStore.test.ts
git commit -m "a pool key that cannot disagree with the query about what a slot wants"
```

---

## Task 2: Draw and fill

**Files:**
- Modify: `src/shared/discoverCandidatePoolStore.ts`
- Modify: `src/shared/discoverCandidatePoolStore.test.ts`

A draw takes a **random sample** and **removes it**. Both halves matter and the test says why:
sampling reproduces the per-roll randomness today's re-query gives for free, and removing
guarantees no repeat within a pool generation. Spec §5.3, §6.1.

- [ ] **Step 1: Write the failing test**

Extend the existing import at the top of the file — do not add a second `import` from the same
module, it will not lint:

```ts
import {
  candidatePoolKey,
  createCandidatePool,
  drawFromPool,
  fillPool,
  poolSize,
  DRAW_SIZE,
  MAX_POOL_SIZE
} from './discoverCandidatePoolStore'
```

Then append:

```ts
// append to src/shared/discoverCandidatePoolStore.test.ts
const items = (n: number): string[] => Array.from({ length: n }, (_, i) => `s${i}`)

describe('drawFromPool / fillPool', () => {
  it('returns nothing for a key that was never filled, rather than throwing', () => {
    const pool = createCandidatePool<string>()
    expect(drawFromPool(pool, 'drums|@|ea', 0)).toEqual([])
  })

  it('draws up to DRAW_SIZE and removes exactly what it drew', () => {
    const pool = createCandidatePool<string>()
    fillPool(pool, 'drums|@|ea', items(500), 0)
    const drawn = drawFromPool(pool, 'drums|@|ea', 0)

    expect(drawn).toHaveLength(DRAW_SIZE)
    expect(new Set(drawn).size).toBe(DRAW_SIZE)
    expect(poolSize(pool, 'drums|@|ea')).toBe(500 - DRAW_SIZE)
  })

  it('never returns the same item twice across consecutive draws', () => {
    const pool = createCandidatePool<string>()
    fillPool(pool, 'drums|@|ea', items(500), 0)
    const first = drawFromPool(pool, 'drums|@|ea', 0)
    const second = drawFromPool(pool, 'drums|@|ea', 0)
    expect(first.filter((s) => second.includes(s))).toEqual([])
  })

  it('samples rather than slicing, so two fills of the same items draw different sets', () => {
    // The variety property. Today every roll re-samples the library, which
    // is what gives the chaos dial something to work with; a pool that
    // handed back its first N in order would rank an identical list every
    // time and a low chaos setting would pick the same stem repeatedly.
    const draws = new Set<string>()
    for (let attempt = 0; attempt < 20; attempt++) {
      const pool = createCandidatePool<string>()
      fillPool(pool, 'drums|@|ea', items(500), 0)
      draws.add(drawFromPool(pool, 'drums|@|ea', 0).join(','))
    }
    expect(draws.size).toBeGreaterThan(1)
  })

  it('drains to empty without ever returning a hole, when a fill is smaller than a draw', () => {
    const pool = createCandidatePool<string>()
    fillPool(pool, 'drums|@|ea', items(30), 0)
    const drawn = drawFromPool(pool, 'drums|@|ea', 0)
    expect(drawn).toHaveLength(30)
    expect(drawn.every((s) => typeof s === 'string')).toBe(true)
    expect(poolSize(pool, 'drums|@|ea')).toBe(0)
  })

  it('replaces on fill rather than appending, so a pool cannot drift toward one lucky sample', () => {
    const pool = createCandidatePool<string>()
    fillPool(pool, 'drums|@|ea', items(200), 0)
    fillPool(pool, 'drums|@|ea', ['fresh-a', 'fresh-b'], 0)
    expect(poolSize(pool, 'drums|@|ea')).toBe(2)
  })

  it('caps a fill at MAX_POOL_SIZE', () => {
    const pool = createCandidatePool<string>()
    fillPool(pool, 'drums|@|ea', items(5000), 0)
    expect(poolSize(pool, 'drums|@|ea')).toBe(MAX_POOL_SIZE)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/shared/discoverCandidatePoolStore.test.ts`
Expected: FAIL — `createCandidatePool is not exported`.

- [ ] **Step 3: Write the implementation**

Append to `src/shared/discoverCandidatePoolStore.ts`:

```ts
/** How many candidates one draw hands the renderer. The renderer ranks
 * them (applyTraitBar, rankCandidates, pickReroll) and keeps one.
 *
 * This is the one real behaviour change the pool makes: today a roll ranks
 * whatever the query returned, measured at 305-725 on Elling's library, and
 * from here it ranks 100. It is the first number to raise if picks start
 * feeling narrow. Spec section 5.3. */
export const DRAW_SIZE = 100

/** At or below this, a refill is due -- one draw's worth, so the next roll
 * after the one that crossed it is still served from memory. */
export const REFILL_AT = 100

/** A fill takes whatever the query returned, up to this. Matches
 * discoverCandidates.ts's own MAX_CANDIDATE_RESOLUTION_POOL, which is the
 * most a query can produce anyway -- this is a memory guard, not a policy
 * (spec section 10: 1,000 x 8 keys x 874 bytes = 6.7MB worst case). */
export const MAX_POOL_SIZE = 1000

/** How many keys are kept. A kind set is any subset of 3 mask + 4 trait
 * kinds, so there are up to 127 of them before the roll-option axes -- the
 * per-key cap is not what bounds memory, this is. Least-recently-used goes
 * first; a real session touches the handful its slots are set to. */
export const MAX_POOL_KEYS = 8

/** A pool older than this is discarded on next access even if it is still
 * full. The ONLY time-based rule in the design, and it is a repetition
 * guard rather than a correctness one: it stops a long session serving one
 * lucky sample all evening. Correctness comes from the invalidation rules
 * (spec section 6.2), not from here. */
export const POOL_MAX_AGE_MS = 10 * 60_000

interface PoolEntry<T> {
  items: T[]
  filledAt: number
  /** Bumped on every access, for the LRU. A counter, not a clock, so two
   * accesses in the same millisecond still order. */
  usedAt: number
}

export interface CandidatePool<T> {
  entries: Map<string, PoolEntry<T>>
  tick: number
}

export function createCandidatePool<T>(): CandidatePool<T> {
  return { entries: new Map(), tick: 0 }
}

export function poolSize<T>(pool: CandidatePool<T>, key: string): number {
  return pool.entries.get(key)?.items.length ?? 0
}

/** Replaces `key`'s stock. Replace, never append: a pool topped up by
 * appending drifts toward whatever the first sample happened to contain,
 * while replacing keeps every fill an independent draw from the library. */
export function fillPool<T>(
  pool: CandidatePool<T>,
  key: string,
  items: readonly T[],
  now: number
): void {
  pool.tick += 1
  pool.entries.set(key, {
    items: items.slice(0, MAX_POOL_SIZE),
    filledAt: now,
    usedAt: pool.tick
  })
  evictLeastRecentlyUsed(pool)
}

/** A fresh random sample of up to DRAW_SIZE, removed from the pool. Empty
 * for a key that was never filled, or one whose stock is spent -- the
 * caller falls through to the real query then (main/discoverCandidatePool.ts). */
export function drawFromPool<T>(pool: CandidatePool<T>, key: string, now: number): T[] {
  const entry = pool.entries.get(key)
  if (!entry) return []
  if (now - entry.filledAt >= POOL_MAX_AGE_MS) {
    pool.entries.delete(key)
    return []
  }
  pool.tick += 1
  entry.usedAt = pool.tick

  // Partial Fisher-Yates from the end: swaps the chosen item out to a
  // region we then truncate, so the draw is uniform, no item can be drawn
  // twice, and removal is a single pop of the tail -- no O(n) splice per
  // item and no scratch copy of the whole pool per roll.
  const take = Math.min(DRAW_SIZE, entry.items.length)
  const drawn: T[] = []
  for (let i = 0; i < take; i++) {
    const last = entry.items.length - 1 - i
    const pick = Math.floor(Math.random() * (last + 1))
    const chosen = entry.items[pick]
    entry.items[pick] = entry.items[last]
    entry.items[last] = chosen
    drawn.push(chosen)
  }
  entry.items.length -= take
  return drawn
}

/** True when `key` is worth refilling in the background. A key that has
 * never been filled is NOT due -- nothing has asked for it, and warming a
 * key nobody wants is exactly the background work this design avoids. */
export function needsRefill<T>(pool: CandidatePool<T>, key: string, now: number): boolean {
  const entry = pool.entries.get(key)
  if (!entry) return false
  return entry.items.length <= REFILL_AT || now - entry.filledAt >= POOL_MAX_AGE_MS
}

/** Every key currently held, least-recently-used first -- the order a
 * refill loop should consider them in. */
export function poolKeys<T>(pool: CandidatePool<T>): string[] {
  return [...pool.entries.entries()].sort((a, b) => a[1].usedAt - b[1].usedAt).map(([key]) => key)
}

export function clearPool<T>(pool: CandidatePool<T>): void {
  pool.entries.clear()
}

function evictLeastRecentlyUsed<T>(pool: CandidatePool<T>): void {
  while (pool.entries.size > MAX_POOL_KEYS) {
    let oldestKey: string | null = null
    let oldestUsedAt = Infinity
    for (const [key, entry] of pool.entries) {
      if (entry.usedAt < oldestUsedAt) {
        oldestUsedAt = entry.usedAt
        oldestKey = key
      }
    }
    if (oldestKey === null) return
    pool.entries.delete(oldestKey)
  }
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run src/shared/discoverCandidatePoolStore.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add src/shared/discoverCandidatePoolStore.ts src/shared/discoverCandidatePoolStore.test.ts
git commit -m "a draw is a fresh sample that leaves the pool, so nothing repeats inside one fill"
```

---

## Task 3: Water marks, the age ceiling, and the LRU

**Files:**
- Modify: `src/shared/discoverCandidatePoolStore.test.ts`

The behaviour is implemented; this task is the tests that pin it. Written second on purpose —
Task 2's implementation is the smallest thing that makes Task 2's tests pass, and these are the
properties that would otherwise only be asserted by the main-process wiring.

- [ ] **Step 1: Write the failing tests**

Extend the existing import at the top of the file again, so it reads in full:

```ts
import {
  candidatePoolKey,
  createCandidatePool,
  drawFromPool,
  fillPool,
  poolSize,
  needsRefill,
  poolKeys,
  clearPool,
  DRAW_SIZE,
  MAX_POOL_SIZE,
  MAX_POOL_KEYS,
  REFILL_AT,
  POOL_MAX_AGE_MS
} from './discoverCandidatePoolStore'
```

Then append:

```ts
// append to src/shared/discoverCandidatePoolStore.test.ts
describe('refill and eviction policy', () => {
  it('does not consider a key nobody has asked for due for refill', () => {
    const pool = createCandidatePool<string>()
    expect(needsRefill(pool, 'never-filled', 0)).toBe(false)
  })

  it('is due once the stock falls to the low mark', () => {
    const pool = createCandidatePool<string>()
    fillPool(pool, 'k', items(REFILL_AT + 1), 0)
    expect(needsRefill(pool, 'k', 0)).toBe(false)
    fillPool(pool, 'k', items(REFILL_AT), 0)
    expect(needsRefill(pool, 'k', 0)).toBe(true)
  })

  it('is due on age alone, so a long session cannot serve one lucky sample all evening', () => {
    const pool = createCandidatePool<string>()
    fillPool(pool, 'k', items(MAX_POOL_SIZE), 0)
    expect(needsRefill(pool, 'k', POOL_MAX_AGE_MS - 1)).toBe(false)
    expect(needsRefill(pool, 'k', POOL_MAX_AGE_MS)).toBe(true)
  })

  it('discards a pool past its age ceiling on draw, rather than serving it', () => {
    const pool = createCandidatePool<string>()
    fillPool(pool, 'k', items(MAX_POOL_SIZE), 0)
    expect(drawFromPool(pool, 'k', POOL_MAX_AGE_MS)).toEqual([])
    expect(poolSize(pool, 'k')).toBe(0)
  })

  it('keeps at most MAX_POOL_KEYS, dropping the least recently used', () => {
    const pool = createCandidatePool<string>()
    for (let i = 0; i < MAX_POOL_KEYS; i++) fillPool(pool, `k${i}`, items(200), 0)
    // Touch k0 so it is no longer the oldest, then overflow by one.
    drawFromPool(pool, 'k0', 0)
    fillPool(pool, 'overflow', items(200), 0)

    const keys = poolKeys(pool)
    expect(keys).toHaveLength(MAX_POOL_KEYS)
    expect(keys).toContain('k0')
    expect(keys).toContain('overflow')
    expect(keys).not.toContain('k1')
  })

  it('lists keys least-recently-used first, which is the order a refill loop wants', () => {
    const pool = createCandidatePool<string>()
    fillPool(pool, 'a', items(200), 0)
    fillPool(pool, 'b', items(200), 0)
    drawFromPool(pool, 'a', 0)
    expect(poolKeys(pool)).toEqual(['b', 'a'])
  })

  it('clears every key', () => {
    const pool = createCandidatePool<string>()
    fillPool(pool, 'a', items(200), 0)
    fillPool(pool, 'b', items(200), 0)
    clearPool(pool)
    expect(poolKeys(pool)).toEqual([])
  })
})
```

- [ ] **Step 2: Run them**

Run: `npx vitest run src/shared/discoverCandidatePoolStore.test.ts`
Expected: PASS, 19 tests. If any fail, the Task 2 implementation is wrong — fix it there, not here.

- [ ] **Step 3: Verify the whole suite and the gates**

```bash
npm run typecheck && npm run lint && npm test
```

Expected: 0 type errors; 0 lint errors and exactly 4 prettier warnings; **202 files / 3306 tests**
(201 files + this one new shared test file; 3287 baseline + 19).

- [ ] **Step 4: Commit**

```bash
git add src/shared/discoverCandidatePoolStore.test.ts
git commit -m "pin the water marks, the age ceiling and the key cap"
```

---

# Phase 2 — behind the IPC handler

After this phase the app is faster and **no renderer file has changed.**

## Task 4: Draw-or-fall-through

**Files:**
- Create: `src/main/discoverCandidatePool.ts`

The contract that matters: **there is no path where a draw fails and the user sees nothing.** A
miss runs the real query exactly as today.

- [ ] **Step 1: Write the implementation**

```ts
// src/main/discoverCandidatePool.ts
//
// The warm candidate pool -- see docs/superpowers/specs/
// 2026-09-28-discover-candidate-pool-design.md.
//
// WHAT THIS IS NOT FOR: the late radio start. That was a renderer ordering
// bug (armRadioPick's IPC was fired in the same microtask as the commit,
// one frame ahead of the commit's own engine push) and it is fixed in
// 705510a. This pool is for `similar`, `rerollAll` and a new slot's first
// roll, which pay the same 300-450ms with no interval to hide in.
//
// Lives between index.ts's IPC handler and discoverCandidates.ts's query.
// discoverCandidates.ts is deliberately left knowing nothing about pooling:
// it is the most-tested file in this area and should keep one job.
import type Database from 'better-sqlite3'
import {
  candidatePoolKey,
  createCandidatePool,
  drawFromPool,
  fillPool,
  needsRefill,
  poolKeys,
  clearPool,
  type CandidatePoolRequest
} from '@shared/discoverCandidatePoolStore'
import { getDiscoverCandidates, type DiscoverCandidate } from './discoverCandidates'
import { countWork } from './workCounters'

interface JamDbPair {
  jamCID: string
  dbForJam: Database.Database
}

/** What a fill needs that the key does not carry: the dbs to query. Held
 * per key from the last real query so a BACKGROUND refill can run without
 * a caller -- listJamsWithDb is cheap now (8d81f22) but the ownDb handle
 * is not something a timer can invent. */
interface PoolContext {
  ownDb: Database.Database
  jams: JamDbPair[]
  request: CandidatePoolRequest
}

const pool = createCandidatePool<DiscoverCandidate>()
const contexts = new Map<string, PoolContext>()

/** The pooled front door for get-discover-candidates. Draws from memory
 * when there is stock, and otherwise runs the real query and seeds the
 * pool from it -- so the FIRST roll of a key costs exactly what it costs
 * today and every roll after it costs nothing. */
export async function drawDiscoverCandidates(args: {
  ownDb: Database.Database
  jams: JamDbPair[]
  request: CandidatePoolRequest
}): Promise<DiscoverCandidate[]> {
  const key = candidatePoolKey(args.request)
  contexts.set(key, args)

  const drawn = drawFromPool(pool, key, Date.now())
  if (drawn.length > 0) {
    countWork('discover.pool-hit', drawn.length)
    return drawn
  }

  countWork('discover.pool-miss')
  const fresh = await queryFor(args)
  fillPool(pool, key, fresh, Date.now())
  forgetEvictedContexts()
  // Serve from the pool it was just filled with, not from `fresh`, so a
  // hit and a miss return the same SHAPE of answer (a DRAW_SIZE sample,
  // removed) rather than a miss quietly handing back ten times as many
  // candidates and ranking differently.
  return drawFromPool(pool, key, Date.now())
}

/** Drops the remembered context of any key the store has evicted.
 *
 * Not tidy-up: a PoolContext holds the `jams` array, which on Elling's
 * library is 5,058 {jamCID, db} pairs and a fresh array per IPC call
 * (index.ts maps listJamsWithDb() each time). Keeping one per key ever
 * seen, while the store itself keeps only MAX_POOL_KEYS, would leak
 * roughly half a megabyte per distinct kind set -- tens of megabytes
 * across the 127 possible ones, for pools that no longer exist. */
function forgetEvictedContexts(): void {
  const live = new Set(poolKeys(pool))
  for (const key of contexts.keys()) {
    if (!live.has(key)) contexts.delete(key)
  }
}

function queryFor(ctx: PoolContext): Promise<DiscoverCandidate[]> {
  return getDiscoverCandidates({
    ownDb: ctx.ownDb,
    jams: ctx.jams,
    kinds: ctx.request.kinds,
    onlyOwnStems: ctx.request.onlyOwnStems,
    targetUser: ctx.request.targetUser,
    soundSource: ctx.request.soundSource
  })
}

/** Every key that is worth topping up, least-recently-used first. */
export function dueForRefill(now: number = Date.now()): string[] {
  return poolKeys(pool).filter((key) => needsRefill(pool, key, now))
}

/** Refills one key, if it still has a remembered context. Returns false
 * when there was nothing to do, so the caller can back off. */
export async function refillOne(key: string): Promise<boolean> {
  const ctx = contexts.get(key)
  if (!ctx) return false
  countWork('discover.pool-refill')
  fillPool(pool, key, await queryFor(ctx), Date.now())
  return true
}

/** Drops every key. For the changes that could make ANY answer different
 * -- a riff archive root switch, a library rescan. A sync landing new
 * stems, or the classifier moving one between kinds, is additive and must
 * NOT come through here: dropping on those would mean never having a warm
 * pool at all while classification is catching up, which is precisely the
 * state Elling's library is in. Spec section 6.2. */
export function clearDiscoverCandidatePool(): void {
  clearPool(pool)
  contexts.clear()
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/main/discoverCandidatePool.ts
git commit -m "draw from the pool, and fall through to the real query when it is empty"
```

---

## Task 5: Wire it into the IPC handler

**Files:**
- Modify: `src/main/index.ts`

- [ ] **Step 1: Replace the handler body**

Find `ipcMain.handle('get-discover-candidates', ...)` in `src/main/index.ts` and replace the
`getDiscoverCandidates({...})` call with the pooled one. The surrounding diagnostic logging stays —
it is what proved the problem and it is how this change will be confirmed.

```ts
      const result = await drawDiscoverCandidates({
        ownDb: openOwnRiffLibraryDb(),
        jams,
        request: { kinds, onlyOwnStems, targetUser, soundSource: soundSource ?? DEFAULT_SOUND_SOURCE }
      })
```

Add above the handler, near the other module constants:

```ts
// getDiscoverCandidates defaults this itself; the pool needs it concrete,
// because an absent filter and an all-on filter must key to the same pool.
const DEFAULT_SOUND_SOURCE = { endlesss: true, audioIn: true }
```

Add the import:

```ts
import { drawDiscoverCandidates } from './discoverCandidatePool'
```

**Remove `getDiscoverCandidates` from `index.ts`'s import list.** Verified on `5b0a91b`: its only
uses in that file are line 1202 (the call this step replaces) and two comments — nothing else
calls it, so leaving the import will fail lint as unused.

- [ ] **Step 2: Typecheck and lint**

```bash
npm run typecheck && npm run lint
```

Expected: 0 errors, exactly 4 prettier warnings.

- [ ] **Step 3: Run the full suite**

Run: `npm test`
Expected: **202 files / 3306 tests**, all passing — unchanged from Task 3, since this task
adds no test of its own.

- [ ] **Step 4: Commit**

```bash
git add src/main/index.ts
git commit -m "the candidates handler asks the pool first"
```

---

## Task 6: Test the main-process pool

**Files:**
- Create: `src/main/discoverCandidatePool.test.ts`
- Modify: `vitest.config.ts`

Follows `discoverCandidates.test.ts`'s pattern: real in-memory better-sqlite3 dbs, no mocked
`electron`.

- [ ] **Step 1: Write the failing test**

```ts
// src/main/discoverCandidatePool.test.ts
import { describe, expect, it, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import {
  drawDiscoverCandidates,
  clearDiscoverCandidatePool,
  dueForRefill
} from './discoverCandidatePool'
import { DRAW_SIZE } from '@shared/discoverCandidatePoolStore'

const BOTH = { endlesss: true, audioIn: true }

/** An own db with the tables getDiscoverCandidates reads, plus `count`
 * stems in one jam carrying `instrument` as their Endlesss mask.
 *
 * instrumentMaskToSoundType (@shared/riffLibraryTypes) reads bit 1 as
 * drums, bit 2 as notes, bit 3 as bass -- so 2 is drums and 8 is bass, and
 * a masked stem is admitted with no StemCategories or StemAutoCategory row
 * at all. That keeps this fixture to the one code path the pool cares
 * about. */
function seededDb(count: number, instrument: number): Database.Database {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE Jams (JamCID TEXT PRIMARY KEY, PublicName TEXT NOT NULL);
    CREATE TABLE Riffs (RiffCID TEXT PRIMARY KEY, OwnerJamCID TEXT, CreationTime INTEGER,
      BPMrnd REAL, BarLength INTEGER, UserName TEXT,
      StemCID_1 TEXT, StemCID_2 TEXT, StemCID_3 TEXT, StemCID_4 TEXT,
      StemCID_5 TEXT, StemCID_6 TEXT, StemCID_7 TEXT, StemCID_8 TEXT);
    CREATE TABLE Stems (StemCID TEXT PRIMARY KEY, OwnerJamCID TEXT, Instrument INTEGER,
      PresetName TEXT, CreatorUserName TEXT);
    CREATE TABLE StemCategories (StemCID TEXT PRIMARY KEY, ArrangeRole TEXT,
      DrumSubRole TEXT, UpdatedAt REAL);
    CREATE TABLE StemAutoCategory (StemCID TEXT PRIMARY KEY, ArrangeRole TEXT,
      Source TEXT, ComputedAt INTEGER);
    CREATE TABLE StemUnavailable (StemCID TEXT PRIMARY KEY, Reason TEXT, CheckedAt INTEGER);
    CREATE TABLE StemFeatureCache (StemCID TEXT PRIMARY KEY, FeaturesJSON TEXT);
    INSERT INTO Jams (JamCID, PublicName) VALUES ('jam1', 'Jam One');
  `)
  const riff = db.prepare(
    `INSERT INTO Riffs (RiffCID, OwnerJamCID, CreationTime, BPMrnd, BarLength, UserName, StemCID_1)
     VALUES (?, 'jam1', 1000, 120, 4, 'elling', ?)`
  )
  const stem = db.prepare(
    `INSERT INTO Stems (StemCID, OwnerJamCID, Instrument, PresetName, CreatorUserName)
     VALUES (?, 'jam1', ?, 'Kit', 'elling')`
  )
  for (let i = 0; i < count; i++) {
    riff.run(`r${i}`, `s${i}`)
    stem.run(`s${i}`, instrument)
  }
  return db
}

const DRUMS_MASK = 2
const BASS_MASK = 8

describe('drawDiscoverCandidates', () => {
  beforeEach(() => clearDiscoverCandidatePool())

  it('serves a second roll from memory, without the db it first queried', async () => {
    const db = seededDb(400, DRUMS_MASK)
    const args = {
      ownDb: db,
      jams: [{ jamCID: 'jam1', dbForJam: db }],
      request: { kinds: ['drums'] as const, soundSource: BOTH }
    }

    const first = await drawDiscoverCandidates(args)
    expect(first).toHaveLength(DRAW_SIZE)

    // Closing the db makes any further query throw. A second roll that
    // still succeeds therefore CANNOT have touched SQLite -- which is the
    // entire claim this pool makes, asserted rather than timed.
    db.close()
    const second = await drawDiscoverCandidates(args)
    expect(second).toHaveLength(DRAW_SIZE)
  })

  it('returns no candidate twice across the two rolls it serves from one fill', async () => {
    const db = seededDb(400, DRUMS_MASK)
    const args = {
      ownDb: db,
      jams: [{ jamCID: 'jam1', dbForJam: db }],
      request: { kinds: ['drums'] as const, soundSource: BOTH }
    }
    const first = await drawDiscoverCandidates(args)
    const second = await drawDiscoverCandidates(args)
    const firstIds = new Set(first.map((c) => c.stemCID))
    expect(second.filter((c) => firstIds.has(c.stemCID))).toEqual([])
    db.close()
  })

  it('keys separate pools per sound-source filter, so one never serves the other', async () => {
    const db = seededDb(400, DRUMS_MASK)
    const base = { ownDb: db, jams: [{ jamCID: 'jam1', dbForJam: db }] }

    await drawDiscoverCandidates({
      ...base,
      request: { kinds: ['drums'] as const, soundSource: BOTH }
    })
    // A different filter is a different key, so this must go to SQL. If it
    // wrongly shared the first pool it would succeed against a closed db.
    db.close()
    await expect(
      drawDiscoverCandidates({
        ...base,
        request: { kinds: ['drums'] as const, soundSource: { endlesss: true, audioIn: false } }
      })
    ).rejects.toThrow()
  })

  it('falls through to the query and still answers when the pool is cold', async () => {
    const db = seededDb(20, DRUMS_MASK)
    const out = await drawDiscoverCandidates({
      ownDb: db,
      jams: [{ jamCID: 'jam1', dbForJam: db }],
      request: { kinds: ['drums'] as const, soundSource: BOTH }
    })
    // Fewer than DRAW_SIZE exist -- it returns what there is, never a hole.
    expect(out.length).toBeGreaterThan(0)
    expect(out.length).toBeLessThanOrEqual(20)
    db.close()
  })

  it('marks a drained key as due for refill, and a fresh one as not', async () => {
    const big = seededDb(400, DRUMS_MASK)
    await drawDiscoverCandidates({
      ownDb: big,
      jams: [{ jamCID: 'jam1', dbForJam: big }],
      request: { kinds: ['drums'] as const, soundSource: BOTH }
    })
    expect(dueForRefill()).toEqual([])

    const small = seededDb(120, BASS_MASK)
    await drawDiscoverCandidates({
      ownDb: small,
      jams: [{ jamCID: 'jam1', dbForJam: small }],
      request: { kinds: ['bass'] as const, soundSource: BOTH }
    })
    // 120 seeded, 100 drawn, 20 left -- at or under the low mark.
    expect(dueForRefill()).toContain('bass||ea')
    big.close()
    small.close()
  })

  it('clears every key', async () => {
    const db = seededDb(400, DRUMS_MASK)
    const args = {
      ownDb: db,
      jams: [{ jamCID: 'jam1', dbForJam: db }],
      request: { kinds: ['drums'] as const, soundSource: BOTH }
    }
    await drawDiscoverCandidates(args)
    clearDiscoverCandidatePool()
    db.close()
    // Cleared, so this must go back to SQL -- against a closed db.
    await expect(drawDiscoverCandidates(args)).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run it and watch it pass**

Run: `npx vitest run src/main/discoverCandidatePool.test.ts`
Expected: PASS, 6 tests. (Unlike the Phase 1 tasks there is no red step here — the implementation
landed in Task 4, and these tests exist to prove it does what Task 4 claimed.)

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: **203 files / 3312 tests** (202 + this new main-process test file; 3306 + 6).

- [ ] **Step 5: ADD THE NEW TEST FILE TO `vitest.config.ts` — DO NOT SKIP THIS**

This file opens better-sqlite3 in the main process. A stale CI exclusion list silently broke every
release for six weeks (see MEMORY: "CI: better-sqlite3 crashes vitest workers" — N-API, not ABI;
do not re-chase the ABI theory).

In `vitest.config.ts`, inside the `process.env.CI` branch's array, add — keeping the list's
existing alphabetical grouping, right after `'src/main/discoverCandidates.test.ts'`:

```ts
          'src/main/discoverCandidatePool.test.ts',
```

- [ ] **Step 6: Verify the exclusion actually takes effect**

```bash
CI=1 npx vitest run src/main/discoverCandidatePool.test.ts
```

Expected: **no tests run** — "No test files found" or a pass-with-no-tests. If the file runs under
`CI=1`, the line is in the wrong place and the release will break.

- [ ] **Step 7: Commit**

```bash
git add src/main/discoverCandidatePool.test.ts vitest.config.ts
git commit -m "prove a second roll never touches sqlite, and keep CI off the better-sqlite3 worker"
```

---

# Phase 3 — the background refill

## Task 7: Top the pool up off the critical path

**Files:**
- Modify: `src/main/discoverCandidatePool.ts`
- Modify: `src/main/index.ts`

Reuse `stemAutoClassifyScheduler.ts`'s posture — read that file before writing this. One refill at
a time, process-wide; sleep when there is nothing due; no second background loop competing with
the classifier.

**Not consent-gated**, deliberately, and this differs from the classifier: a refill runs the
identical query a manual reroll runs, over data already on disk, only earlier. Gating it would
give a user who declined the library scan a slower reroll for no privacy gain. Spec §7.

- [ ] **Step 1: Add the loop**

Append to `src/main/discoverCandidatePool.ts`:

```ts
/** Between refills while keys are due. Matches the classifier's own
 * BUSY_DELAY_MS (stemAutoClassifyScheduler.ts) rather than picking a
 * second number: the two share one main process and there is no reason
 * for them to have different ideas about how often background work is
 * polite. */
const REFILL_BUSY_DELAY_MS = 3000

/** Nothing due. Long, because a key only becomes due when someone rolls
 * (which calls back in here anyway) or when it ages out. */
const REFILL_IDLE_DELAY_MS = 30_000

let refillTimer: ReturnType<typeof setTimeout> | null = null
let refillStarted = false

/** Starts the background top-up. Call once, at app ready. Idempotent. */
export function startDiscoverCandidatePoolRefill(): void {
  if (refillStarted) return
  refillStarted = true
  scheduleRefill(REFILL_IDLE_DELAY_MS)
}

/** Stops it. For tests and app shutdown -- a timer left running past a
 * test holds the whole worker open. */
export function stopDiscoverCandidatePoolRefill(): void {
  refillStarted = false
  if (refillTimer !== null) clearTimeout(refillTimer)
  refillTimer = null
}

function scheduleRefill(delayMs: number): void {
  if (refillTimer !== null) clearTimeout(refillTimer)
  refillTimer = setTimeout(() => {
    refillTimer = null
    void runRefillOnce()
  }, delayMs)
  // Never hold the process open for a background top-up.
  refillTimer.unref()
}

async function runRefillOnce(): Promise<void> {
  if (!refillStarted) return
  // Least-recently-used first (poolKeys' own order): the key someone is
  // actively rolling is the one most likely to be asked for again, so it
  // is refilled LAST -- it is also the one whose draw will seed itself for
  // free on a miss.
  const due = dueForRefill()
  if (due.length === 0) {
    scheduleRefill(REFILL_IDLE_DELAY_MS)
    return
  }
  try {
    await refillOne(due[0])
  } catch (err) {
    // A refill is a nicety. A failed one leaves the pool exactly as it was
    // and the next real roll pays the query itself, which is today's
    // behaviour -- never let it take the app down.
    console.error('discoverCandidatePool: background refill failed:', err)
  }
  scheduleRefill(REFILL_BUSY_DELAY_MS)
}
```

- [ ] **Step 2: Start it at app ready**

In `src/main/index.ts`, next to where `prewarmDiscoverCandidateCaches` is kicked off inside
`ready-to-show` (it must be after the window is visible, for the same reason the prewarm is — see
that call's own comment), add:

```ts
    startDiscoverCandidatePoolRefill()
```

and the import:

```ts
import {
  drawDiscoverCandidates,
  startDiscoverCandidatePoolRefill
} from './discoverCandidatePool'
```

- [ ] **Step 3: Write the failing test**

Append to `src/main/discoverCandidatePool.test.ts`:

```ts
import { refillOne, stopDiscoverCandidatePoolRefill } from './discoverCandidatePool'

describe('refillOne', () => {
  beforeEach(() => clearDiscoverCandidatePool())
  afterEach(() => stopDiscoverCandidatePoolRefill())

  it('refills a drained key from its remembered context, with no caller', async () => {
    const db = seededDb(120, DRUMS_MASK)
    await drawDiscoverCandidates({
      ownDb: db,
      jams: [{ jamCID: 'jam1', dbForJam: db }],
      request: { kinds: ['drums'] as const, soundSource: BOTH }
    })
    expect(dueForRefill()).toContain('drums||ea')

    expect(await refillOne('drums||ea')).toBe(true)
    expect(dueForRefill()).toEqual([])
    db.close()
  })

  it('reports nothing to do for a key it has never seen, rather than throwing', async () => {
    expect(await refillOne('never-seen||ea')).toBe(false)
  })
})
```

Add `afterEach` to the vitest import at the top of the file.

- [ ] **Step 4: Run it**

Run: `npx vitest run src/main/discoverCandidatePool.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Verify the gates**

```bash
npm run typecheck && npm run lint && npm test
```

Expected: 0 type errors; 0 lint errors and exactly 4 prettier warnings; **203 files / 3314 tests.**

- [ ] **Step 6: Commit**

```bash
git add src/main/discoverCandidatePool.ts src/main/discoverCandidatePool.test.ts src/main/index.ts
git commit -m "top the pool up in the background, at the classifier's pace"
```

---

# Phase 4 — invalidation

## Task 8: Drop the pool when the world changes shape

**Files:**
- Modify: `src/main/riffLibraryStore.ts`
- Modify: `src/main/discoverCandidatePool.test.ts`

Only the changes that could make **any** answer different. A sync landing new stems, or the
classifier moving one between kinds, is additive and must **not** drop the pool — doing so would
mean never having a warm pool while classification is catching up, which is precisely the state
Elling's library is in. Spec §6.2.

- [ ] **Step 1: Clear on a root switch**

`closeRiffLibraryDb()` in `src/main/riffLibraryStore.ts` is already the invalidation point for the
jam-list cache. Add the pool to it:

```ts
function closeRiffLibraryDb(): void {
  cachedDb?.close()
  cachedDb = null
  cachedJamsWithDb = null
  // The pool's candidates name riffs and stems from the PREVIOUS archive.
  // Same reason the jam list above goes: a signal check cannot see a
  // change of file.
  clearDiscoverCandidatePool()
}
```

and the import:

```ts
import { clearDiscoverCandidatePool } from './discoverCandidatePool'
```

**Check for an import cycle before committing:** `discoverCandidatePool.ts` imports
`discoverCandidates.ts`, which does not import `riffLibraryStore.ts` (it takes `jams` as a
parameter, deliberately — see its own doc comment). Run `npm run typecheck` and start the app
(`npm run dev`) to confirm; if a cycle does appear, move `clearDiscoverCandidatePool` into its own
tiny module rather than breaking the dependency direction.

- [ ] **Step 2: Write the failing test**

Append to `src/main/discoverCandidatePool.test.ts`:

```ts
  it('drops the pool on a root switch, because its candidates name the previous archive', async () => {
    const db = seededDb(400, DRUMS_MASK)
    const args = {
      ownDb: db,
      jams: [{ jamCID: 'jam1', dbForJam: db }],
      request: { kinds: ['drums'] as const, soundSource: BOTH }
    }
    await drawDiscoverCandidates(args)

    const { setRiffLibraryRootForTests } = await import('./riffLibraryStore')
    setRiffLibraryRootForTests('/no/such/archive')

    db.close()
    // Cleared by the root switch, so this must go back to SQL -- against a
    // closed db. Serving the old archive's stems here would offer picks
    // that can never resolve.
    await expect(drawDiscoverCandidates(args)).rejects.toThrow()
    setRiffLibraryRootForTests(null)
  })
```

This test imports `riffLibraryStore`, which reads `app.getPath` — add the same narrow `electron`
mock `riffLibraryStore.test.ts` uses at the top of the file:

```ts
let userDataDir = ''
vi.mock('electron', () => ({ app: { getPath: () => userDataDir } }))
```

and set `userDataDir = mkdtempSync(join(tmpdir(), 'sssketch-pool-test-'))` in a `beforeEach`.

- [ ] **Step 3: Run it**

Run: `npx vitest run src/main/discoverCandidatePool.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 4: Verify the gates**

```bash
npm run typecheck && npm run lint && npm test
```

Expected: 0 type errors; 0 lint errors and exactly 4 prettier warnings; **203 files / 3315 tests.**

- [ ] **Step 5: Commit**

```bash
git add src/main/riffLibraryStore.ts src/main/discoverCandidatePool.test.ts
git commit -m "a new archive drops the pool, a sync only tops it up"
```

---

## Task 9: Confirm it on the real library, and hand back

**Files:** none.

- [ ] **Step 1: Run the app against the real archive**

```bash
npm run dev
```

Open Discover. Roll a `drums` slot several times and read the main-process log — the diagnostic
lines from `get-discover-candidates` are still there.

Expected: the **first** roll of a kind logs its usual `getDiscoverCandidates -- N candidates in
Xms` (300–3000 ms, unchanged — a miss runs the real query). Every roll after it should be
effectively instant, and the `[work]` counter line should show `discover.pool-hit` climbing and
`discover.pool-miss` staying low.

- [ ] **Step 2: The one that matters — `rerollAll`**

With four unlocked slots, press reroll-all. Before this plan that was four sequential queries with
the main process stalled throughout; it should now be one visible pause at most.

- [ ] **Step 3: Say honestly what was not verified**

This environment has no GUI or audio interaction tooling, so a coding agent cannot itself click
through the app. If you are an agent, **do not claim Steps 1 and 2 were done** — report that they
are Elling's to walk through, and report the automated gates you did run.

- [ ] **Step 4: Final gates**

```bash
npm run typecheck && npm run lint && npm test
```

Expected: 0 type errors; 0 lint errors and exactly 4 prettier warnings; **203 files / 3315 tests.**

---

## Not in this plan

From spec §11, restated so the boundary is here too:

- Pooling `random` (`get-random-discover-candidate`) or `adjacent`
  (`get-adjacent-discover-candidates`) — one is already fast, the other is anchored on the clicked
  candidate and cannot be pre-drawn.
- Fixing the classifier's per-row `bumpStemClassificationVersion`, which invalidates the mask-kind
  index every ~3 s while a backlog exists. Real waste, ~40–70 ms a rebuild. Its own piece of work.
- Carrying `PresetName` / `CreatorUserName` in `DiscoverInstrumentRowsCache` to kill the five
  external `IN (200)` queries (273 ms warm) — the best remaining query fix, deliberately after
  this.
- An async directory listing for the scan-target walk, to break up the 626 ms cold `readdirSync`.
- Persisting the pool across launches.
- Predicting which key will be needed next.
- Anything in `native-engine/`.
