# Better Picks (key, level, balance) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Discover and both radios prefer picks that fit the sounding rows' key and balance strong parts against sparse ones, and a new row arrives at a common loudness.

**Architecture:** Three optional terms/values beside the existing ones. `keyFit` (pure) feeds a new `key` term in `rankCandidates`; `arrivalGain` (pure) is computed in main and carried on the candidate as the row's starting gain; `presence` (from the intensity parts already stored) is carried on the candidate and feeds a `balance` term. Every term is absent-safe: without its input the ranking is exactly today's.

**Tech Stack:** TypeScript, vitest, better-sqlite3 (main), the web radio's Vite index build.

**Spec:** `docs/superpowers/specs/2026-11-21-picking-key-level-groove-design.md`

**Where:** sssketch worktree `~/Claudecode/sssketch-picks`, branch `better-picks` (from `four-categories`). Web radio worktree `~/Claudecode/ell.ing/radio-picks`, branch `better-picks` (from its `four-categories`). The radio resolves `@shared` to `../../sssketch/src/shared`; for its tests in the worktree, check how `radio-categories` pointed at `sssketch-categories` (its tsconfig/vite alias or a symlink) and do the same for `sssketch-picks`.

**House rules (every task):**
- Never launch Electron or `npm run dev`. Never push, tag, deploy. Never touch the real library db.
- TDD: failing test first. Gates per task: the task's tests, then `npm run typecheck && npm run lint`.
- Known unrelated failure: `src/main/pluginScan.test.ts` (x86 bridge). The engineClient disconnect test sometimes flakes.
- The repo is public: made-up names in tests, no personal names or paths in code or docs.
- Commit style: `feat(picks): ...` / `test(picks): ...`, one commit per task. End messages with the attribution lines the session gives.
- UI copy lowercase, no emoji, no exclamation marks.

---

### Task 1: `keyFit`

**Files:**
- Create: `src/shared/keyFit.ts`, `src/shared/keyFit.test.ts`

- [ ] **Step 1: failing test**

```ts
import { describe, expect, it } from 'vitest'
import { keyFit, KEY_NEUTRAL, type RiffKey } from './keyFit'

const k = (root: number | null, scale: number | null): RiffKey => ({ root, scale })
const MAJOR = 0, MINOR = 5, MINOR_PENT = 7, CHROMATIC = 17

describe('keyFit', () => {
  it('same key fits fully', () => expect(keyFit(k(4, MINOR), k(4, MINOR))).toBe(1))
  it('relative major and minor fit fully', () => expect(keyFit(k(0, MAJOR), k(9, MINOR))).toBe(1))
  it('a pentatonic inside its parent fits fully', () =>
    expect(keyFit(k(9, MINOR_PENT), k(9, MINOR))).toBe(1))
  it('a fifth apart fits well', () => expect(keyFit(k(0, MAJOR), k(7, MAJOR))).toBeCloseTo(5 / 7, 5))
  it('a semitone apart clashes', () => expect(keyFit(k(0, MAJOR), k(1, MAJOR))).toBe(0))
  it('a tritone apart clashes', () => expect(keyFit(k(0, MAJOR), k(6, MAJOR))).toBe(0))
  it('is symmetric', () => expect(keyFit(k(2, 1), k(7, 4))).toBe(keyFit(k(7, 4), k(2, 1))))
  it('unknown or chromatic is neutral', () => {
    for (const other of [k(null, null), k(0, null), k(0, CHROMATIC), k(0, 99), k(12, MAJOR)]) {
      expect(keyFit(other, k(0, MAJOR))).toBe(KEY_NEUTRAL)
      expect(keyFit(k(0, MAJOR), other)).toBe(KEY_NEUTRAL)
    }
  })
})
```

- [ ] **Step 2:** `npx vitest run src/shared/keyFit.test.ts` → FAIL (module missing).

- [ ] **Step 3: implement**

```ts
// src/shared/keyFit.ts
//
// How well two riffs' keys sit together (spec 2026-11-21-picking-key-level-groove-design, 1).
// The key is Endlesss's own per-riff Root and Scale: evidence, not proof, so an unknown or
// chromatic key is neutral, never a clash.

export interface RiffKey {
  root: number | null
  scale: number | null
}

/** An unknown key's fit: it never beats a known match and is never a clash. */
export const KEY_NEUTRAL = 0.5

/** Semitone steps of each Endlesss scale, in RIFF_LIBRARY_SCALE_NAMES order
 * (riffLibraryTypes.ts). 17 (Chromatic) has no entry: every note, so no key. */
const SCALE_STEPS: readonly (readonly number[])[] = [
  [0, 2, 4, 5, 7, 9, 11], // Major (Ionian)
  [0, 2, 3, 5, 7, 9, 10], // Dorian
  [0, 1, 3, 5, 7, 8, 10], // Phrygian
  [0, 2, 4, 6, 7, 9, 11], // Lydian
  [0, 2, 4, 5, 7, 9, 10], // Mixolydian
  [0, 2, 3, 5, 7, 8, 10], // Minor (Aeolian)
  [0, 1, 3, 5, 6, 8, 10], // Locrian
  [0, 3, 5, 7, 10], // Minor Pentatonic
  [0, 2, 4, 7, 9], // Major Pentatonic
  [0, 2, 5, 7, 10], // Suspended Pent.
  [0, 3, 5, 8, 10], // Blues Minor Pent.
  [0, 2, 5, 7, 9], // Blues Major Pent.
  [0, 2, 3, 5, 7, 8, 11], // Harmonic Minor
  [0, 2, 3, 5, 7, 9, 11], // Melodic Minor
  [0, 1, 4, 5, 7, 8, 11], // Double Harmonic
  [0, 3, 5, 6, 7, 10], // Blues
  [0, 2, 4, 6, 8, 10] // Whole Tone
]

/** The key's notes as a 12-bit set, or null when it says nothing. */
function notesOf(key: RiffKey): number | null {
  const { root, scale } = key
  if (root === null || scale === null) return null
  if (!Number.isInteger(root) || root < 0 || root > 11) return null
  const steps = SCALE_STEPS[scale]
  if (!steps) return null
  let bits = 0
  for (const s of steps) bits |= 1 << ((root + s) % 12)
  return bits
}

const count = (bits: number): number => {
  let n = 0
  for (let b = bits; b; b &= b - 1) n++
  return n
}

/** True when the key says something (known root, a real scale). */
export function hasKey(key: RiffKey): boolean {
  return notesOf(key) !== null
}

/** 0 to 1: the notes both keys share over the smaller key's notes, with half or fewer shared
 * counting as a plain clash (0). KEY_NEUTRAL when either key is unknown or chromatic. */
export function keyFit(a: RiffKey, b: RiffKey): number {
  const na = notesOf(a)
  const nb = notesOf(b)
  if (na === null || nb === null) return KEY_NEUTRAL
  const shared = count(na & nb) / Math.min(count(na), count(nb))
  return Math.min(1, Math.max(0, (shared - 0.5) / 0.5))
}
```

- [ ] **Step 4:** test passes; typecheck, lint.
- [ ] **Step 5:** commit `feat(picks): keyFit, how well two riff keys sit together`.

---

### Task 2: candidates carry their riff's key

**Files:**
- Modify: `src/shared/discoverCandidate.ts` (add fields)
- Modify: `src/main/discoverCandidates.ts` (`RiffIndexEntry` ~line 283; fill sites ~2153, ~2504, ~2699, ~2811)
- Modify: every place that builds a `RiffIndexEntry`: `src/main/riffIndexWalk.ts:132`, `src/main/discoverIndexCache.ts:361` and `:595`, `src/main/ownStemIndex.ts:176`, `src/main/discoveredLibrary.ts:68` and `:263`
- Modify: `src/main/discoverAdjacency.ts:283`
- Tests: the existing tests beside each file

Add to `DiscoverCandidate`, after `riffBpm`:

```ts
  /** The OWNING RIFF's key as Endlesss stored it (Riffs.Root 0-11, Riffs.Scale, an index into
   * RIFF_LIBRARY_SCALE_NAMES), for rankCandidates' key term (@shared/keyFit). Optional: absent or
   * null is an unknown key, which is neutral. */
  riffRoot?: number | null
  riffScale?: number | null
```

Add `root: number | null` and `scale: number | null` to `RiffIndexEntry`.

- [ ] **Step 1:** grep every `bpmRnd` writer and every SQL that selects `BPMrnd` for those entries (`grep -rn 'BPMrnd\|bpmRnd' src/main | grep -v test`). For each, add `Root, Scale` to the SELECT and the fields to the entry. **`discoverIndexCache.ts` persists the index**: read how it stores entries; if entries are serialized (a cache table or file), old cached entries lack the fields. Treat a missing field as `null` when reading, and bump that cache's own version constant if it has one so the index is rebuilt with keys (find it; say in your report which you did).
- [ ] **Step 2:** failing tests: in the test file beside each changed builder, one assertion that a riff seeded with `Root = 4, Scale = 5` yields an entry / candidate with `root: 4, scale: 5` (and `riffRoot: 4, riffScale: 5` on the candidate from `getDiscoverCandidates`). Follow each file's existing seeding helpers; add `Root`/`Scale` columns to test schemas where the helper creates `Riffs`.
- [ ] **Step 3:** fill `riffRoot`/`riffScale` at the four candidate sites in `discoverCandidates.ts` and in `discoverAdjacency.ts` (from the resolved riff; if `resolved` has no root/scale, look where it's built and add them the same way). `DiscoverSlotRow.tsx:775` and `LibraryBrowser.tsx:1725` build candidates from a resolved riff in the renderer: leave the fields off there (unknown, neutral) unless the resolved riff already carries `key` as numbers.
- [ ] **Step 4:** the changed tests pass; `npx vitest run src/main` (expect only the known failure); typecheck, lint.
- [ ] **Step 5:** commit `feat(picks): discover candidates carry their riff's root and scale`.

---

### Task 3: the key term in `rankCandidates`

**Files:**
- Modify: `src/shared/discoverRanking.ts`
- Test: `src/shared/discoverRanking.test.ts` (extend)

- [ ] **Step 1: failing tests** (use the file's existing candidate factory; if none, a local `cand(over)`):

```ts
describe('key term', () => {
  const MINOR = 5, MAJOR = 0
  const bed = [{ root: 9, scale: MINOR }]
  const fit = cand({ stemCID: 'fit', riffBpm: 120, riffRoot: 9, riffScale: MINOR })
  const clash = cand({ stemCID: 'clash', riffBpm: 120, riffRoot: 6, riffScale: MAJOR })
  const unknown = cand({ stemCID: 'unknown', riffBpm: 120 })

  it('ranks a fitting key over an unknown one over a clash', () => {
    const r = rankCandidates([clash, unknown, fit], { targetBpm: 120, key: { others: bed } })
    expect(r.map((x) => x.candidate.stemCID)).toEqual(['fit', 'unknown', 'clash'])
    expect(r[0].score).toBeCloseTo(1 + KEY_WEIGHT, 5)
    expect(r[1].score).toBeCloseTo(1 + KEY_WEIGHT * 0.5, 5)
    expect(r[2].score).toBeCloseTo(1, 5)
  })
  it('no others, or only unknown others: exactly the ranking without it', () => {
    const plain = rankCandidates([clash, fit], { targetBpm: 120 })
    expect(rankCandidates([clash, fit], { targetBpm: 120, key: { others: [] } })).toEqual(plain)
    expect(
      rankCandidates([clash, fit], { targetBpm: 120, key: { others: [{ root: null, scale: null }] } })
    ).toEqual(plain)
  })
  it('exempt candidates get no term', () => {
    const r = rankCandidates([fit], { targetBpm: 120, key: { others: bed, exempt: true } })
    expect(r[0].score).toBeCloseTo(1, 5)
  })
  it('scores against the mean of the others', () => {
    const r = rankCandidates([fit], {
      targetBpm: 120,
      key: { others: [...bed, { root: 6, scale: MAJOR }] }
    })
    expect(r[0].score).toBeCloseTo(1 + KEY_WEIGHT * 0.5, 5) // fits one fully, clashes with one
  })
  it('at the default matching a fitting stem is drawn about three times as often', () => {
    const pool = Array.from({ length: 100 }, (_, i) =>
      cand({ stemCID: `s${i}`, riffBpm: 120, riffRoot: i % 2 ? 9 : 6, riffScale: i % 2 ? MINOR : MAJOR })
    )
    const ranked = rankCandidates(pool, { targetBpm: 120, key: { others: bed } })
    let seed = 7
    const random = (): number => (seed = (seed * 16807) % 2147483647) / 2147483647
    let fits = 0
    for (let i = 0; i < 10000; i++)
      if (pickReroll(ranked, DEFAULT_DISCOVER_CHAOS, random)!.riffRoot === 9) fits++
    // top 75: 50 fitting at 3, 25 clashing at 1 -> 150/175 = 0.857
    expect(fits / 10000).toBeGreaterThan(0.83)
    expect(fits / 10000).toBeLessThan(0.88)
  })
})
```

- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: implement.** Imports: `import { hasKey, keyFit, type RiffKey } from './keyFit'`. Add:

```ts
// A fitting key outweighs a favourite (1.5): a strong lean, not a rule (spec 2026-11-21, 1). At
// the default matching a fitting stem is drawn about three times as often as a clashing one of
// the same tempo; discoverRanking.test.ts measures it.
export const KEY_WEIGHT = 2

/** The keys a pick will sound with (every other row that isn't drums). `exempt`: the slot
 * being filled is drums, which has no key. */
export interface RankKey {
  others: readonly RiffKey[]
  exempt?: boolean
}
```

Option `key?: RankKey` with the doc "Absent, exempt, or no other row with a known key: no term, exactly the ranking without it." Before the `.map`:

```ts
  const keyOthers = key && !key.exempt ? key.others.filter(hasKey) : []
```

Inside the map, after the dig term:

```ts
      if (keyOthers.length > 0) {
        const own = { root: candidate.riffRoot ?? null, scale: candidate.riffScale ?? null }
        let sum = 0
        for (const other of keyOthers) sum += keyFit(own, other)
        score += KEY_WEIGHT * (sum / keyOthers.length)
      }
```

- [ ] **Step 4:** tests pass (the whole file: no existing expectation may change); typecheck, lint.
- [ ] **Step 5:** commit `feat(picks): rankCandidates leans toward the sounding rows' key`.

---

### Task 4: Discover and radio pass the key, and a row shows it

**Files:**
- Create: `src/shared/discoverKey.ts`, `src/shared/discoverKey.test.ts`
- Modify: `src/renderer/src/components/DiscoverPanel.tsx` (the `rankCandidates` call ~line 10099)
- Modify: the row tooltip that shows the riff's date (grep `riffCreationTime` in `src/renderer/src/components/Discover*.tsx`)

- [ ] **Step 1: failing test** for a pure helper, so the panel only calls it:

```ts
// discoverKey.test.ts
import { describe, expect, it } from 'vitest'
import { rankKeyFor, rowKeyLabel } from './discoverKey'

const row = (id: string, kinds: string[], root: number | null, scale: number | null) => ({
  id,
  kinds,
  candidate: root === null && scale === null ? null : { riffRoot: root, riffScale: scale }
})

describe('rankKeyFor', () => {
  const rows = [row('a', ['drums'], 0, 0), row('b', ['bass'], 9, 5), row('c', ['front'], 4, 5), row('d', ['back'], null, null)]
  it('takes every other non-drums row that has a candidate', () => {
    expect(rankKeyFor(rows as never, 'c', ['front'])).toEqual({ others: [{ root: 9, scale: 5 }], exempt: false })
  })
  it('a drums slot is exempt', () => {
    expect(rankKeyFor(rows as never, 'a', ['drums']).exempt).toBe(true)
  })
  it('a drums slot with a trait is still exempt', () => {
    expect(rankKeyFor(rows as never, 'a', ['drums', 'bright']).exempt).toBe(true)
  })
})

describe('rowKeyLabel', () => {
  it('names a known key in lowercase', () => expect(rowKeyLabel(5, 5)).toBe('f minor (aeolian)'))
  it('is undefined for unknown or chromatic', () => {
    expect(rowKeyLabel(null, 5)).toBeUndefined()
    expect(rowKeyLabel(0, 17)).toBeUndefined()
  })
})
```

- [ ] **Step 2: implement** `discoverKey.ts`:

```ts
// src/shared/discoverKey.ts -- which keys a Discover/radio pick is ranked against, and a row's
// key as its tooltip shows it (spec 2026-11-21-picking-key-level-groove-design, 1).
import type { RankKey } from './discoverRanking'
import type { DiscoverSlotKind } from './discoverSlotKind'
import { hasKey } from './keyFit'
import { resolveKeyName } from './riffLibraryTypes'

interface KeyRow {
  id: string
  kinds: readonly DiscoverSlotKind[]
  candidate: { riffRoot?: number | null; riffScale?: number | null } | null
}

const isDrums = (kinds: readonly DiscoverSlotKind[]): boolean => kinds.includes('drums')

/** The key term's input for filling `slotId`: the other rows that aren't drums and hold a stem. */
export function rankKeyFor(
  rows: readonly KeyRow[],
  slotId: string,
  kinds: readonly DiscoverSlotKind[]
): RankKey {
  return {
    exempt: isDrums(kinds),
    others: rows
      .filter((r) => r.id !== slotId && r.candidate !== null && !isDrums(r.kinds))
      .map((r) => ({ root: r.candidate!.riffRoot ?? null, scale: r.candidate!.riffScale ?? null }))
  }
}

/** "f minor (aeolian)", or undefined when the key says nothing. */
export function rowKeyLabel(
  root: number | null | undefined,
  scale: number | null | undefined
): string | undefined {
  const key = { root: root ?? null, scale: scale ?? null }
  return hasKey(key) ? resolveKeyName(key.root, key.scale)?.toLowerCase() : undefined
}
```

(If `resolveKeyName` lives where importing it into `src/shared` drags in non-shared code, it doesn't: `riffLibraryTypes.ts` is in `src/shared`. Check `discoverSlotKind.ts` for the drums kind's exact literal.)

- [ ] **Step 3: wire the panel.** In the `rankCandidates` call add `key: rankKeyFor(slotsRef.current, id, kinds),`. Use the same "rows that sound with it" set the clash term uses if a row can be present but not previewing: follow `previewingSlotIdsRef` exactly as the clash bed does (filter `slotsRef.current` first, then pass). Grep `rankCandidates(` in `ShapePanel.tsx` and `CrossPanel.tsx`: leave them unchanged (no rows to match there).
- [ ] **Step 4: tooltip.** Where a row's tooltip shows the riff's date, append ` · ${rowKeyLabel(c.riffRoot, c.riffScale)}` when defined. Same string in every place that tooltip is built (grep it; the date tooltip was added for Discover, the arranger and sketch: only Discover's candidates carry the key, do only those).
- [ ] **Step 5:** tests, typecheck, lint. Report plainly that the panel wiring and tooltip are unverified in the running app.
- [ ] **Step 6:** commit `feat(picks): discover and radio rank by key; a row's tooltip names its key`.

---

### Task 5: `arrivalGain`, attached to candidates

**Files:**
- Modify: `src/shared/stemLevel.ts`, `src/shared/stemLevel.test.ts`
- Modify: `src/shared/discoverCandidate.ts`
- Modify: `src/main/discoverCandidates.ts` (attach beside `attachDiscoverIntensity`, called for every roll in `getDiscoverCandidates` ~line 1620, and for the dig near pool in `discoverAdjacency.ts`)
- Test: `src/main/discoverCandidates.test.ts` (or the file where `attachDiscoverIntensity` is tested)

- [ ] **Step 1: failing unit tests** in `stemLevel.test.ts`:

```ts
describe('arrivalGain', () => {
  it('turns a loud stem down to the target', () =>
    expect(arrivalGain(-17, -23)).toBeCloseTo(10 ** (-6 / 20), 5))
  it('never turns up', () => expect(arrivalGain(-30, -23)).toBe(1))
  it('has a floor', () => expect(arrivalGain(0, -23)).toBe(ARRIVAL_GAIN_FLOOR))
  it('is 1 for an unmeasured stem', () => {
    expect(arrivalGain(null, -23)).toBe(1)
    expect(arrivalGain(undefined, -23)).toBe(1)
    expect(arrivalGain(NaN, -23)).toBe(1)
  })
})
describe('rerolledGain', () => {
  it('a fresh row takes the new stem\'s arrival gain', () => expect(rerolledGain(1, 1, 0.5)).toBe(0.5))
  it('an untouched row follows the new stem', () => expect(rerolledGain(0.5, 0.5, 0.8)).toBeCloseTo(0.8, 5))
  it('a hand-set balance is kept', () => expect(rerolledGain(0.25, 0.5, 0.8)).toBeCloseTo(0.4, 5))
  it('stays in 0..1', () => {
    expect(rerolledGain(1, 0.25, 1)).toBe(1)
    expect(rerolledGain(0, 0.5, 1)).toBe(0)
  })
})
```

- [ ] **Step 2: implement** in `stemLevel.ts`:

```ts
/** The loudness a new Discover/radio row arrives at when the library has no percentile yet. */
export const ARRIVAL_TARGET_FALLBACK_LUFS = -23
/** The library percentile of loudnessLufs rows are trimmed toward: the quieter quarter. */
export const ARRIVAL_TARGET_PERCENTILE = 0.25
export const ARRIVAL_GAIN_FLOOR = 0.25

/** A new row's starting gain (spec 2026-11-21-picking-key-level-groove-design, 2): down to
 * `targetLufs`, never up (row gains are 0..1 and a stem at unity is already loud), never under
 * the floor. An unmeasured stem arrives at 1. */
export function arrivalGain(loudnessLufs: number | null | undefined, targetLufs: number): number {
  if (typeof loudnessLufs !== 'number' || !Number.isFinite(loudnessLufs)) return 1
  if (!Number.isFinite(targetLufs)) return 1
  const gain = Math.pow(10, (targetLufs - loudnessLufs) / 20)
  return Math.min(1, Math.max(ARRIVAL_GAIN_FLOOR, gain))
}

/** A row's gain after its stem changes: the row's gain relative to the old stem's arrival gain,
 * carried to the new stem's. A fresh row (1, 1) takes the new arrival gain; a balance set by hand
 * holds. */
export function rerolledGain(rowGain: number, oldArrival: number, newArrival: number): number {
  const old = oldArrival > 0 ? oldArrival : 1
  return Math.min(1, Math.max(0, (rowGain / old) * newArrival))
}
```

- [ ] **Step 3:** add to `DiscoverCandidate`:

```ts
  /** The gain a row holding this stem starts at (@shared/stemLevel arrivalGain), (0, 1]. Main
   * attaches it to every roll; absent (older constructors, an unmeasured stem): 1. */
  arrivalGain?: number
```

- [ ] **Step 4: attach in main.** Write `attachArrivalGain(ownDb, pool)` beside `attachDiscoverIntensity`, same shape (yielding loop, same value source: read how `intensityValueSource` gets `loudnessLufs` from the in-memory value table or `StemFeatureCache`, and reuse it; don't write a second reader). The target: the `ARRIVAL_TARGET_PERCENTILE` quantile of the `loudnessLufs` quantile table from `getTraitQuantileTables(ownDb)` (read `traitQuantiles.ts` for how a table maps a percentile back to a value; if it only maps value→percentile, add a small pure `valueAtPercentile(table, p)` there with a unit test), else `ARRIVAL_TARGET_FALLBACK_LUFS`. Set `arrivalGain` only when it is below 1 (keeps payloads and old snapshots unchanged). Call it for every roll, before/after the intensity attach, and for the dig near pool. Failing test first: a pool of three stems (loud, quiet, no feature row) against a seeded library gets `< 1`, absent, absent.
- [ ] **Step 5:** tests, typecheck, lint.
- [ ] **Step 6:** commit `feat(picks): a candidate carries the gain its row should arrive at`.

---

### Task 6: rows arrive at their gain

**Files:**
- Modify: `src/renderer/src/components/DiscoverPanel.tsx`

The row's `gain` is set to `1` where a row is created (grep `gain: 1` in the file: ~8688, 9220, 9300, 11437, 11834, 12318) and is otherwise left alone when a row's candidate changes.

- [ ] **Step 1:** find every place a row's `candidate` is replaced by a rolled/landed pick (the reroll result, radio's staged change landing, companions, nearby/duplicate picks, dig). List them in your report.
- [ ] **Step 2:** at each, set the row's gain with one helper call:

```ts
gain: rerolledGain(slot.gain, slot.candidate?.arrivalGain ?? 1, picked.arrivalGain ?? 1)
```

A row created empty keeps `gain: 1` and gets its arrival gain on its first pick (1, 1 → new). A row created *with* a candidate (a duplicate keeps the source row's gain; a seeded project row keeps 1: seeds have no `arrivalGain`). Undo/redo must restore the gain with the candidate: check that the undo snapshot holds `gain` (it does if it snapshots slots whole; say what you found).
- [ ] **Step 3:** the gain a kept/added row commits is already the row's `gain` (`discoverRifffAssembly.ts`): no change. Confirm by reading, don't edit.
- [ ] **Step 4:** radio's staged swap: if the staged engine project is built before the landing with the row's gain, the staged project must use the NEW gain (the one the row will have). Trace where the staged change builds its preview stems and make it use `rerolledGain(...)` for the incoming stem, so there is no level jump one moment after the landing.
- [ ] **Step 5:** typecheck, lint, `npx vitest run src/renderer src/shared`. No new unit test here beyond Task 5's (the logic is the helper); say so, and that it is unverified in the running app.
- [ ] **Step 6:** commit `feat(picks): a new discover or radio row arrives at a common loudness`.

---

### Task 7: the web radio (key and level)

**Worktree:** `~/Claudecode/ell.ing/radio-picks`. Its `@shared` must resolve to `~/Claudecode/sssketch-picks/src/shared` while testing.

**Files:**
- Modify: `src/index/buildIndex.ts` and its record type (find `IndexRecord`), `scripts/export-index.mjs` if it lists fields or coverage
- Modify: `src/radio/pick.ts` (`toCandidate` ~line 291, the `rankCandidates` call ~line 415)
- Modify: where a layer's gain is set when a pick lands (grep `gain` in `src/audio/engine.ts` and `src/radio/controller.ts`)
- Tests: beside each

- [ ] **Step 1: index.** Each record gains `kr` (root, integer 0-11) and `ks` (scale index), omitted when null, and `g` (arrival gain, rounded to 3 places, omitted when 1). `buildIndex` reads Root/Scale from the stem's riff the same way it reads the riff-level fields it already has (find how `t`/`bpm` are sourced; the riff a stem maps to is the riff index's, as everywhere), and computes `g` with `arrivalGain(loudnessLufs, target)` where `target` is the 25th percentile of the exported stems' `loudnessLufs` (it already gathers loudness for intensity: reuse that pass), fallback `ARRIVAL_TARGET_FALLBACK_LUFS`. Bump the index's version/header field if it has one and note whether an old client reading a new index (or a new client reading the old one) still works: both fields are optional, so it must. Failing tests first in the index's test file: a record round-trips `kr`/`ks`/`g`; a quiet stem has no `g`.
- [ ] **Step 2: pick.** `toCandidate` adds `riffRoot: r.kr ?? null, riffScale: r.ks ?? null, ...(r.g !== undefined && { arrivalGain: r.g })`. `pickFor` (whatever calls `rankCandidates`) takes the other layers' keys from its caller and passes `key: { others, exempt }` built with `rankKeyFor` from `@shared/discoverKey` if the controller's rows fit its `KeyRow` shape, else the same two rules inline (drums exempt; others = non-drums layers' keys). Failing test: with a bed in a minor and a pool of fitting and clashing stems, seeded picks land on fitting ones more than 80% of the time; with a drums slot the share is ~50%.
- [ ] **Step 3: gain.** When a layer's stem lands, its gain starts at `candidate.arrivalGain ?? 1` times whatever level the layer already had from the radio's own rules (don't replace an existing per-layer level; multiply). Read the engine's gain path first and say in the report what a layer's gain was before this.
- [ ] **Step 4:** `npm test` (all), typecheck/lint as that repo defines them. Do not run `export-index.mjs` against the real library, do not deploy.
- [ ] **Step 5:** commit in the radio worktree `feat(picks): the web radio ranks by key and levels new layers`.

---

### Task 8: presence, attached to candidates

(Groove moved to design 2: see the spec's "Moved to design 2". Tasks 8 and 9 are the balance.)

**Files:**
- Modify: `src/shared/radioIntensity.ts`, its test
- Modify: `src/shared/discoverCandidate.ts`
- Modify: `src/main/discoverCandidates.ts` (the Task 5 attach: one loop adds both values)
- Web radio: `src/index/buildIndex.ts` (`p`, 2 decimals, omitted when null), `src/radio/pick.ts` `toCandidate`

- [ ] **Step 1:** read `radioIntensity.ts` whole. `stemIntensityScore` builds four parts (`busy`, `low`, `full`, `bright`) from library percentiles. Export `stemPresence(values, tables): number | null`: the mean of the `busy` and `full` parts that are present (one present: that one; neither: null). Reuse the file's `part(...)`; don't copy it.
- [ ] **Step 2: failing tests first** in the intensity test file, with its existing table fixtures: a busy, loud, always-sounding stem scores above 0.8; a sparse quiet one under 0.2; only loudness known gives the `full` part alone; nothing known gives null.
- [ ] **Step 3:** `DiscoverCandidate` gains `presence?: number | null` ("how much a stem demands, 0 sparse and quiet to 1 busy and loud (@shared/radioIntensity stemPresence); attached to every roll; absent or null: unknown"). Main: the Task 5 attach computes it from the same values and tables in the same loop (rename it `attachLevelAndPresence`). Extend its test: loud busy stem gets a high `presence`, a stem with no feature row gets none.
- [ ] **Step 4:** web: `buildIndex` writes `p` from the same function over the exported stems' tables (it already builds them for `x`); `toCandidate` maps `presence: r.p ?? null`. Test the round-trip.
- [ ] **Step 5:** tests in both repos, typecheck, lint. Commits `feat(picks): a candidate carries its presence` (one per repo).

---

### Task 9: the balance term

**Files:**
- Modify: `src/shared/discoverRanking.ts`, its test
- Modify: `src/shared/discoverKey.ts` (add `rankBalanceFor`), its test
- Modify: `src/renderer/src/components/DiscoverPanel.tsx`
- Web radio: `src/radio/pick.ts`

- [ ] **Step 1: failing ranking tests:**

```ts
describe('balance term', () => {
  const strong = cand({ stemCID: 'strong', riffBpm: 120, presence: 0.9 })
  const sparse = cand({ stemCID: 'sparse', riffBpm: 120, presence: 0.1 })
  const unknown = cand({ stemCID: 'unknown', riffBpm: 120 })
  it('a strong bed prefers a sparse pick', () => {
    const r = rankCandidates([strong, sparse, unknown], { targetBpm: 120, balance: { others: [0.9, 0.3] } })
    expect(r.map((x) => x.candidate.stemCID)).toEqual(['sparse', 'strong', 'unknown'])
    expect(r[0].score).toBeCloseTo(1 + BALANCE_WEIGHT * 1, 5) // want 0.1
    expect(r[1].score).toBeCloseTo(1 + BALANCE_WEIGHT * 0.2, 5)
    expect(r[2].score).toBeCloseTo(1, 5) // no presence: no term
  })
  it('a sparse bed prefers a strong pick', () => {
    const r = rankCandidates([sparse, strong], { targetBpm: 120, balance: { others: [0.1] } })
    expect(r[0].candidate.stemCID).toBe('strong')
  })
  it('no others, or exempt: exactly the ranking without it', () => {
    const plain = rankCandidates([strong, sparse], { targetBpm: 120 })
    expect(rankCandidates([strong, sparse], { targetBpm: 120, balance: { others: [] } })).toEqual(plain)
    expect(
      rankCandidates([strong, sparse], { targetBpm: 120, balance: { others: [0.9], exempt: true } })
    ).toEqual(plain)
  })
})
```

- [ ] **Step 2: implement:**

```ts
// A trait's weight: balance shapes a pick as much as "bright" does, under key (2) and a
// favourite (1.5). Spec 2026-11-21-picking-key-level-groove-design, 3.
export const BALANCE_WEIGHT = 1

/** The presences (@shared/radioIntensity stemPresence) of the rows a pick will sound with that
 * count toward the balance. `exempt`: the slot being filled doesn't count (drums). */
export interface RankBalance {
  others: readonly number[]
  exempt?: boolean
}
```

Before the map: `const strongest = balance && !balance.exempt ? Math.max(-Infinity, ...balance.others.filter(Number.isFinite)) : -Infinity`. In the map, when `strongest` is finite and the candidate's `presence` is a finite number: `score += BALANCE_WEIGHT * (1 - Math.abs(candidate.presence - (1 - strongest)))`.

- [ ] **Step 3:** `rankBalanceFor(rows, slotId, kinds, countDrums = false)` in `discoverKey.ts`: `exempt` when the slot's kinds include drums and `countDrums` is false; `others` = the presences of the other rows holding a stem with a finite `presence`, leaving out drum rows unless `countDrums`. Bass rows count. Tests: drums left out by default and counted with the flag; bass counted; the slot itself excluded; a drums slot exempt. (`KeyRow`'s candidate type gains `presence?: number | null`.)
- [ ] **Step 4:** panel: `balance: rankBalanceFor(rows, id, kinds)` beside the `key` option, same row set. Web `pick.ts`: the same from the other layers.
- [ ] **Step 5:** tests in both repos, typecheck, lint; commits `feat(picks): picks balance strong parts against sparse ones` (one per repo).

---

### Task 9b: radio peaks at 3 or 4 rows

**Files:**
- Modify: `src/shared/radioDensity.ts`, its tests; any test in either repo that pins the old peak (grep `DENSITY_PEAK`, `DENSITY_MAX`, and literal 5s in `radioDensity*.test.ts`, the radio repo's `density.test.ts`, `step.test.ts`)

- [ ] **Step 1:** read `radioDensity.ts` whole. `DENSITY_PEAK = { min: 4, max: 5 }` becomes `{ min: 3, max: 4 }`; `DENSITY_TROUGH` stays `{ min: 2, max: 3 }`. Update the comments (spec 2026-11-21 section 4; keep the older quotes as history, add the new one: "the number of elements ... often a bit too many").
- [ ] **Step 2:** work out what `DENSITY_MAX` (5) governs: if it is only the arc's ceiling, make it 4; if it also caps rows the user adds by hand or the row-count UI, leave it and say so. A peak of 3 after a trough of 3 is a leg that goes nowhere: check the leg logic draws a peak above the trough it left (and a trough below the peak), and if it can draw equal ends, make the draw exclude that with a test.
- [ ] **Step 3:** failing tests first for the new window (a growing leg's target is 3 or 4, never 5), then the constants. Fix pinned expectations in both repos only where they encode the old peak, not where they encode behaviour.
- [ ] **Step 4:** tests in both repos, typecheck, lint; commits `feat(radio): the density arc peaks at 3 or 4 rows` (one per repo if the radio repo's tests changed).

---

### Task 10: docs and the full gates

- [ ] **Step 1:** `CLAUDE.md`: a short "Better picks (key, level, balance)" section after "Four categories": the three terms and where they live (`keyFit.ts`, `discoverKey.ts`, `stemLevel.ts` `arrivalGain`/`rerolledGain`, `radioIntensity.ts` `stemPresence`), the rules (drums exempt from key and from the balance, bass counts in the balance; unknown key neutral; gain only turns down and is the row's ordinary gain; every term absent-safe), and that the web index carries `kr`/`ks`/`g`/`p`.
- [ ] **Step 2:** the spec's Level section says the candidate carries `loudnessLufs`; it carries `arrivalGain` (main computes it, the renderer has no percentile tables). Fix that sentence. Set the spec's status line to "built on `better-picks`, unmerged".
- [ ] **Step 3:** full gates in both worktrees: `npm run typecheck && npm run lint && npm test`. Report exact counts and any failure verbatim.
- [ ] **Step 4:** commit `docs(picks): handoff notes; spec matches the build`.
