# Rifffs beyond eight stems — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A rifff in sssketch's own riff library can carry up to **twenty** stems instead of eight, so `keep` in Discover saves the whole stack he built instead of silently truncating it at eight.

**Architecture:** A purely additive side table, `RiffStemsExtra (RiffCID, Slot, StemCID)`, holding **slots 9-20 only** — `Riffs.StemCID_1..8` is untouched, because sssketch's own warehouse is deliberately schema-compatible with OUROVEON's LORE warehouse (README, acknowledgments) and an external LORE `warehouse.db3` is opened **read-only** and can never be given this table. Every read joins the columns to the side table through **one module** (`src/main/riffStemsExtra.ts`) whose readers return an **empty map when the table is absent** — so the ≤8-stem behaviour on an external archive is the same code path as everything else, not a special case bolted on afterwards.

**Tech Stack:** TypeScript, Electron main/preload/renderer, better-sqlite3, vitest.

**Spec:** `docs/superpowers/specs/2026-09-27-rifffs-beyond-eight-stems-design.md` (2026-09-27). Its settled decisions are not re-opened here: **a side table, not new columns**; **slots 9-20, not 1-20 duplicated**; **no foreign key**; **twenty, in one constant**.

**Baseline (verify before Task 1):**

```
Test Files  193 passed (193)
     Tests  2954 passed (2954)
```

`npm run typecheck` — 0 errors. `npm run lint` — 0 errors + **4 pre-existing prettier warnings in unrelated files**. Any *new* warning is yours.

**NO NATIVE-ENGINE CHANGES.** Nothing in this plan reaches `native-engine/`. `EngineProject::EngineRifff::stems` is a `std::vector<EngineStem>` keyed by `stemKey(groupId, slot)` (`native-engine/Source/EngineProject.h:180`) — there is no fixed-size eight anywhere in the wire format, so `EngineProject` / `buildEngineProject.ts`, the hand-synced pair CLAUDE.md warns about, **both stay exactly as they are**. If you conclude a native-engine change is needed, **STOP and report it rather than planning one.**

**ANOTHER AGENT IS CONCURRENTLY EDITING** `src/main/remotePage.ts`, `src/main/remotePage.test.ts` and `src/renderer/src/components/DiscoverPanel.tsx`. This plan touches **none of those three files** — see finding 3. If you find yourself wanting to edit `DiscoverPanel.tsx`, stop and re-read that finding first.

---

## Findings that shaped this plan — read these before Task 1

1. **There are three different eights and conflating them is how this bug happened.** Get these straight before you change a number.
   - **the storage eight** — `Riffs.StemCID_1..8`, `src/main/riffLibrarySchema.ts:54-55`. The real constraint. This plan extends it to twenty via the side table.
   - **the assembly eight** — `MAX_STEMS_PER_RIFFF`, `src/renderer/src/audio/discoverRifffAssembly.ts:36`. A *renderer* cap on how many members go into an in-memory `Rifff`. Its own doc comment justifies itself by the storage eight, so it rises with it.
   - **the seed eight** — `MAX_SEED_SLOTS`, `src/renderer/src/audio/discoverSeed.ts:34`. How many Discover slots seeding creates. Its own comment justifies itself by the assembly eight, so it rises too.
   - A fourth eight is not in this codebase: **a real Endlesss rifff is eight stems.** That is the product fact the storage eight encodes. It does not change.

2. **The truncation happens in the renderer, before the IPC.** `resolveDiscoverRifff()` (`DiscoverPanel.tsx:2314-2367`) is shared verbatim by `add to timeline`, `add to shelf` **and** `keepGroup`, and it calls `assembleDiscoverRifff(name, placed, bpm)` with **no `maxMembers`** — so it takes the assembly eight as a default and `keepGroup` never sees the ninth stem. Widening the database without raising that default fixes nothing at all.

3. **Raising the assembly eight is a one-line change in `discoverRifffAssembly.ts` and needs NO `DiscoverPanel.tsx` edit.** This is deliberate and it is how this plan stays clear of the concurrent agent. `keepGroup` maps `rifff.stems` straight into its IPC payload; once the default `maxMembers` is twenty, all twelve arrive with no change to the panel. Elling is separately removing the cap's misapplication to `add to timeline` in that same file — that work and this plan do not collide.

4. **How absence of the table is detected — do not invent a different way.** `db.prepare('PRAGMA table_info(RiffStemsExtra)').all().length > 0`, the exact idiom `riffLibrarySchema.ts` already uses twice (`ensureDiscoverRiffIndexCacheHasCreationTime:249`, `ensureStemCategoriesHasSubcategoryNote:272`), both of whose comments call it "cheap: one PRAGMA query".
   - **NOT `Database#readonly`.** `getRiffLibraryDb()` opens the *configured* root with `readonly: true`, and the default configured root **is sssketch's own library** (`riffLibraryRootPath()` falls back to `ownRiffLibraryRoot()`). On a normal install the own warehouse is open twice, and a `readonly` check would call the second handle external and hide slots 9-20 from browse for everyone who never touched the folder picker.
   - **NOT comparing `db.name` to `ownRiffLibraryDbPath()`.** It answers "which file is this", not "does this database carry the extension" — and those come apart on an own warehouse opened before the migration ran.

5. **Absence must not be a caller's problem.** The check lives inside the two readers in `src/main/riffStemsExtra.ts` and nowhere else. Both return `Map<string, StemSlotRef[]>`; absent table → empty map. No call site branches on it, so no call site can forget it.

6. **`.all()`, never `.iterate()`.** `.iterate()` across an `await` caused a real live crash. `buildRiffIndex` (`discoverCandidates.ts`) is `async` and yields inside its page loop — this rule is not theoretical there.

7. **Read the whole side table ONCE per database connection on any full-table scan.** Three readers walk all of `Riffs` in pages (`scanTargetCache.ts`, `discoverCandidates.ts`, `discoverLibraryStems.ts`). They must call `readAllExtraStemSlots(db)` once and hold the map — never re-query per page and never per riff. Jams share one database; per-jam loop-requerying caused two real bugs in a day (CLAUDE.md). For an external archive the call is free: the table is not there.

8. **`GainsJSON` already works at twenty and must not be "fixed".** `writeRiffDetail` writes `gains[String(stem.slot)]` for **every** stem; `buildResolvedRiff` reads `gains[String(slot)]`. Both are slot-keyed and neither is bounded. A twelve-stem group's gains for slots 9-12 persist today with no change. Leave a comment saying so.

9. **`src/shared/buildRifff.ts` is NOT on this path.** It builds a `Rifff` from a scanned folder of `.wav` files (drag-and-drop of an Endlesss stem-folder export, via `importRifff.ts`). It never touches SQLite and never sees library data. Its slot dedupe at `:76-86` is about two *filenames* claiming the same slot — and its "downstream code treats slot as a de facto primary key" comment is the justification for this side table's `PRIMARY KEY (RiffCID, Slot)`. **Do not edit it.**

10. **`deleteJamRows`' orphan check must be one statement, and the obvious extension of it is wrong.** It currently runs `SELECT 1 FROM Riffs WHERE StemCID_1 = @cid OR … LIMIT 1` *after* the jam's `Riffs` rows are deleted. Appending `OR EXISTS (SELECT 1 FROM RiffStemsExtra …)` to that `WHERE` silently does nothing when `Riffs` is empty, because `FROM Riffs` yields no rows to filter. The correct shape is `SELECT 1 WHERE EXISTS (SELECT 1 FROM Riffs WHERE …) OR EXISTS (SELECT 1 FROM RiffStemsExtra WHERE StemCID = @cid)`. Task 5 uses exactly that.

11. **`listRiffs`' placeholder arithmetic stops being comfortable.** Its own comment (`riffLibraryStore.ts:344-347`) says "worst case one page's rows reference up to 8 distinct StemCIDs each, i.e. 8000 placeholders … comfortably under" SQLite's 32766. At twenty that worst case is 20,000 — still legal, no longer comfortable, and the comment becomes false. Task 7 chunks that `IN (…)` at 900 and rewrites the comment.

12. **`scanTargetCache`'s incremental `extend` stays correct.** It watermarks by `Riffs.rowid`, so a side row added for an *existing* riff would be missed. That cannot happen: extra rows are only ever written alongside a **brand-new** `Riffs` row (`saveDiscoveredRifff` mints a fresh `discovered-<uuid>` riffCID and never upserts an existing group), which moves the count and the watermark. Do not add a second change signal for the side table.

13. **`buildResolvedRiff` already does one `Stems` lookup per stem** inside its `.map()`. At twenty that is twenty point lookups on an explicit, single-riff resolve — the same shape CLAUDE.md's "never one query per stem" rule explicitly is *not* about (it is about batch paths). Leave the shape alone; do not "optimise" it into a batched `IN (…)` in this plan.

14. **ANY NEW MAIN-PROCESS TEST FILE THAT OPENS better-sqlite3 MUST BE ADDED TO THE CI EXCLUSION LIST IN `vitest.config.ts`.** This is not housekeeping. A stale list broke **every release for six weeks**: the v1.2.0 build failed on both legs with 22 `Worker exited unexpectedly` errors and **zero failed tests**, because 21 Discover-era files had never been added. The cause is an N-API problem with the addon on GitHub's macOS runners — **do not re-chase the ABI theory**, it is ruled out in the config's own comment. This plan creates **exactly one** such file, `src/main/riffStemsExtra.test.ts`, and adding it to the list is **Step 7 of Task 2**, not a footnote. Files already on the list that this plan edits (`riffLibraryStore.test.ts`, `riffLibraryWriter.test.ts`, `riffLibrarySchema.test.ts`, `discoveredLibrary.test.ts`, `scanTargetCache.test.ts`, `discoverCandidates.test.ts`, `discoverLibraryStems.test.ts`) need nothing. `src/shared/riffStemSlots.test.ts` is pure and needs nothing.

15. **Main-process tests build their own DDL, and that is a feature here.** The convention (`riffLibraryWriter.test.ts:27-45`, `discoveredLibrary.test.ts:18-51`) is a `freshDb()` that pastes the subset of `SCHEMA_SQL` it needs into `new Database(':memory:')`, with `vi.mock('electron', () => ({ app: { getPath: () => tmpDir } }))` and nothing else mocked. **A fixture that does not create `RiffStemsExtra` is a perfectly faithful external-LORE warehouse** — so several existing test files exercise the absence path for free, and you add the table only to the fixtures whose tests need twenty.

16. **React components are NOT unit-tested in this codebase** (CLAUDE.md). Task 10 has no component tests, deliberately. This environment has no GUI or audio tooling: **do not claim any UI change was tested, and do not claim anything about how it sounds.**

17. **Lint rules that will bite.** Explicit return type on every function, inline ones included. Prettier: `singleQuote: true`, `semi: false`, `printWidth: 100`, `trailingComma: none`.

## Known limits, accepted on purpose

- **A downgrade shows eight-stem rifffs**, and that is fine: nothing is corrupted, the side rows are untouched, and re-upgrading restores twenty. Two named consequences — an old build's `forget this` orphans side rows (never read; a riffCID collision is impossible), and an old build's duplicate check is weaker because it sees only eight of a twelve-stem group's CIDs. Both accepted in the spec.
- **A twenty-stem group is a tall group** in the shelf and the arranger. More scrolling. That is the honest cost of what was asked for. `RifffBlockRow` computes its height from `rifff.stems.length`, so nothing needs changing for it.
- **`PolarGlyph` degrades visibly at twenty and is not addressed here.** It divides a fixed `RING_BUDGET` of 3 across `stems.length - 1` (`PolarGlyph.tsx:99-103`); its own comment says the design targets 8-16. Twenty rings sit 0.16 units apart instead of 0.43. Nothing breaks — every ring stays in frame by construction — it just reads as mush. That is a visual judgement for Elling, not a number to change in this plan.
- **No visual marker distinguishes a >8-stem sssketch group from a real Endlesss rifff** in browse beyond the hover title's stem count. Not asked for.

## File map

| File | Change |
|---|---|
| `src/shared/riffStemSlots.ts` | **NEW** — `LORE_STEM_COLUMN_COUNT`, `MAX_RIFFF_STEM_SLOTS`, `STEM_SLOT_COLUMNS`, `StemSlotRef`, `columnStemSlots`, `splitStemSlots`, `mergeStemSlots` |
| `src/shared/riffStemSlots.test.ts` | **NEW** — full TDD, pure, **not** CI-excluded |
| `src/main/riffStemsExtra.ts` | **NEW** — `RIFF_STEMS_EXTRA_DDL`, `hasExtraStemSlotsTable`, `readExtraStemSlots`, `readAllExtraStemSlots`, `writeExtraStemSlots`, `deleteExtraStemSlotsForRiff`, `deleteExtraStemSlotsForJam`, `extraStemCIDsForJam` |
| `src/main/riffStemsExtra.test.ts` | **NEW** — full TDD, **and added to `vitest.config.ts`'s CI exclusion list** |
| `vitest.config.ts` | one line: `src/main/riffStemsExtra.test.ts` |
| `src/main/riffLibrarySchema.ts` | `SCHEMA_SQL` gains the table via `${RIFF_STEMS_EXTRA_DDL}` |
| `src/main/riffLibrarySchema.test.ts` | one case: the table exists after open |
| `src/main/riffLibraryWriter.ts` | `writeRiffDetail` splits at eight and writes the rest; `deleteJamRows` widens both passes and deletes the jam's extra rows |
| `src/main/riffLibraryWriter.test.ts` | new cases + `RiffStemsExtra` in `freshDb()` |
| `src/main/riffLibraryStore.ts` | `buildResolvedRiff` takes extras; `resolveRiff` reads them; `listRiffs` reads them per page and chunks its creator lookup |
| `src/main/riffLibraryStore.test.ts` | new cases, including the absence path |
| `src/main/discoveredLibrary.ts` | `listDiscoveredGroups` widens; `forgetDiscoveredRifff` deletes extra rows; `saveDiscoveredRifff` caps at `MAX_RIFFF_STEM_SLOTS` |
| `src/main/discoveredLibrary.test.ts` | a twelve-stem save/dupe/forget round trip |
| `src/main/scanTargetCache.ts` | `slotsOf`/`collectRiff` take an extras map; `rebuild` and `extend` read it once per source db |
| `src/main/discoverCandidates.ts` | `buildRiffIndex` reads it once per db; `getRandomLibraryCandidate`'s eight-way riff lookup learns the side table |
| `src/shared/riffLibraryTypes.ts` | two doc comments that say `1-8` |
| `src/main/discoverLibraryStems.ts` | the per-db walk reads it once per db |
| `src/renderer/src/audio/discoverRifffAssembly.ts` | `MAX_STEMS_PER_RIFFF` → `MAX_RIFFF_STEM_SLOTS`, comment rewritten |
| `src/renderer/src/audio/discoverSeed.ts` | `MAX_SEED_SLOTS` → `MAX_RIFFF_STEM_SLOTS`, comment rewritten |

**Nothing else is touched. No file is deleted. `DiscoverPanel.tsx`, `remotePage.ts`, `remotePage.test.ts`, `buildRifff.ts`, `buildEngineProject.ts` and everything under `native-engine/` are NOT in this plan.**

## Commands (run from `/Users/nickel/Claudecode/sssketch`)

```bash
npx vitest run src/shared/riffStemSlots.test.ts   # one file
npm test                                           # full suite
npm run typecheck
npm run lint
```

---

## Task 0: Confirm the baseline

**Files:** none.

- [ ] **Step 1: Run the full suite**

Run: `npm test`
Expected: `Test Files  193 passed (193)` / `Tests  2954 passed (2954)`.

- [ ] **Step 2: Run typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: 0 type errors; 0 lint errors and exactly **4** prettier warnings, all in files this plan does not touch. Write the four filenames down. Any fifth warning at the end of this plan is yours.

---

## Task 1: The two numbers and the slot arithmetic, in `src/shared/`

Pure logic, no database, no Electron. This is the file a future reader opens to find out which eight is which.

**Files:**
- Create: `src/shared/riffStemSlots.ts`
- Test: `src/shared/riffStemSlots.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/shared/riffStemSlots.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  LORE_STEM_COLUMN_COUNT,
  MAX_RIFFF_STEM_SLOTS,
  STEM_SLOT_COLUMNS,
  columnStemSlots,
  splitStemSlots,
  mergeStemSlots
} from './riffStemSlots'

describe('riffStemSlots', () => {
  it('names the two numbers apart', () => {
    expect(LORE_STEM_COLUMN_COUNT).toBe(8)
    expect(MAX_RIFFF_STEM_SLOTS).toBe(20)
  })

  it('STEM_SLOT_COLUMNS is exactly the eight LORE columns, in order', () => {
    expect(STEM_SLOT_COLUMNS).toEqual([
      'StemCID_1',
      'StemCID_2',
      'StemCID_3',
      'StemCID_4',
      'StemCID_5',
      'StemCID_6',
      'StemCID_7',
      'StemCID_8'
    ])
  })

  it('columnStemSlots reads non-null columns as 1-indexed slots and skips the nulls', () => {
    expect(
      columnStemSlots({ StemCID_1: 'a', StemCID_2: null, StemCID_3: 'c', StemCID_8: 'h' })
    ).toEqual([
      { slot: 1, stemCID: 'a' },
      { slot: 3, stemCID: 'c' },
      { slot: 8, stemCID: 'h' }
    ])
  })

  it('columnStemSlots on a row with no stems at all is empty, not an error', () => {
    expect(columnStemSlots({})).toEqual([])
  })

  it('splitStemSlots puts 1-8 in the columns and 9-20 in the extras', () => {
    const stems = Array.from({ length: 12 }, (_, i) => ({ slot: i + 1, stemCID: `s${i + 1}` }))
    const { columnStems, extraStems, dropped } = splitStemSlots(stems)
    expect(columnStems.map((s) => s.slot)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    expect(extraStems.map((s) => s.slot)).toEqual([9, 10, 11, 12])
    expect(dropped).toEqual([])
  })

  it('splitStemSlots drops anything past the ceiling rather than writing it somewhere unreadable', () => {
    const stems = [{ slot: 20, stemCID: 'twenty' }, { slot: 21, stemCID: 'over' }]
    const { extraStems, dropped } = splitStemSlots(stems)
    expect(extraStems.map((s) => s.slot)).toEqual([20])
    expect(dropped.map((s) => s.slot)).toEqual([21])
  })

  it('splitStemSlots drops a slot below 1 too', () => {
    const { columnStems, dropped } = splitStemSlots([{ slot: 0, stemCID: 'nope' }])
    expect(columnStems).toEqual([])
    expect(dropped.map((s) => s.stemCID)).toEqual(['nope'])
  })

  it('splitStemSlots keeps the given order within each half', () => {
    const { columnStems } = splitStemSlots([
      { slot: 3, stemCID: 'c' },
      { slot: 1, stemCID: 'a' }
    ])
    expect(columnStems.map((s) => s.stemCID)).toEqual(['c', 'a'])
  })

  it('mergeStemSlots returns one ascending slot list', () => {
    expect(
      mergeStemSlots(
        [
          { slot: 1, stemCID: 'a' },
          { slot: 2, stemCID: 'b' }
        ],
        [
          { slot: 10, stemCID: 'j' },
          { slot: 9, stemCID: 'i' }
        ]
      )
    ).toEqual([
      { slot: 1, stemCID: 'a' },
      { slot: 2, stemCID: 'b' },
      { slot: 9, stemCID: 'i' },
      { slot: 10, stemCID: 'j' }
    ])
  })

  it('mergeStemSlots with no extras is just the columns -- the external-LORE shape', () => {
    const columns = [{ slot: 1, stemCID: 'a' }]
    expect(mergeStemSlots(columns, [])).toEqual(columns)
  })

  it('mergeStemSlots ignores an extra that claims a column slot, so the columns always win', () => {
    expect(
      mergeStemSlots([{ slot: 1, stemCID: 'real' }], [{ slot: 1, stemCID: 'impostor' }])
    ).toEqual([{ slot: 1, stemCID: 'real' }])
  })
})
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx vitest run src/shared/riffStemSlots.test.ts`
Expected: FAIL — `Failed to resolve import "./riffStemSlots"`.

- [ ] **Step 3: Write the implementation**

Create `src/shared/riffStemSlots.ts`:

```ts
// src/shared/riffStemSlots.ts

/** How many literal StemCID_N columns the `Riffs` table has --
 * Riffs.StemCID_1..8 (src/main/riffLibrarySchema.ts). This is OUROVEON's
 * shape, not ours: sssketch's own riff library is deliberately
 * schema-compatible with a real LORE warehouse, and the app can open an
 * external one read-only (README, acknowledgments). It stays 8 forever.
 * Stems past the eighth live in the sssketch-exclusive RiffStemsExtra side
 * table instead -- see src/main/riffStemsExtra.ts. */
export const LORE_STEM_COLUMN_COUNT = 8

/** The most stems one rifff can carry in sssketch: the 8 LORE columns plus
 * 12 rows in RiffStemsExtra. sssketch's own extension -- a real Endlesss
 * rifff is 8 stems, and this number has no meaning outside this app.
 *
 * This is the ONLY place the ceiling is written down. Raising it is free
 * (the side table's own CHECK constrains only the LOWER bound, so no
 * migration is needed); lowering it below 9 would be a real migration. */
export const MAX_RIFFF_STEM_SLOTS = 20

/** The eight column names, in slot order. Was defined separately in
 * riffLibraryWriter.ts and discoveredLibrary.ts and inlined as a SQL
 * string in four more places before this. */
export const STEM_SLOT_COLUMNS: readonly string[] = Array.from(
  { length: LORE_STEM_COLUMN_COUNT },
  (_, i) => `StemCID_${i + 1}`
)

export interface StemSlotRef {
  slot: number
  stemCID: string
}

/** The non-null StemCID_1..8 columns of a Riffs row, as 1-indexed slots.
 * Takes a plain record so it works for every row shape in the codebase
 * (RiffRow, FullRiffRow, RiffCandidateRow, RiffPageRow) without any of
 * them needing a common type. */
export function columnStemSlots(row: Record<string, unknown>): StemSlotRef[] {
  const out: StemSlotRef[] = []
  for (let slot = 1; slot <= LORE_STEM_COLUMN_COUNT; slot++) {
    const stemCID = row[`StemCID_${slot}`]
    if (typeof stemCID === 'string' && stemCID.length > 0) out.push({ slot, stemCID })
  }
  return out
}

/** Splits a rifff's stems into what the eight columns hold and what the
 * side table holds. `dropped` is anything outside 1..MAX_RIFFF_STEM_SLOTS:
 * returned rather than silently discarded so the writer can say so out
 * loud instead of losing a stem the way this whole feature's original bug
 * did. Order within each half is the given order, untouched. */
export function splitStemSlots<T extends { slot: number }>(
  stems: readonly T[]
): { columnStems: T[]; extraStems: T[]; dropped: T[] } {
  const columnStems: T[] = []
  const extraStems: T[] = []
  const dropped: T[] = []
  for (const stem of stems) {
    if (stem.slot >= 1 && stem.slot <= LORE_STEM_COLUMN_COUNT) columnStems.push(stem)
    else if (stem.slot > LORE_STEM_COLUMN_COUNT && stem.slot <= MAX_RIFFF_STEM_SLOTS)
      extraStems.push(stem)
    else dropped.push(stem)
  }
  return { columnStems, extraStems, dropped }
}

/** One ascending slot list from the two halves. An extra claiming a slot
 * the columns own is ignored: the columns are the only source of truth for
 * 1..8, which is the whole reason the side table starts at 9. With no
 * extras -- an external LORE warehouse, which has no side table and cannot
 * be given one -- this is just the columns, which is the correct answer
 * there and not a degraded one. */
export function mergeStemSlots(
  columnSlots: readonly StemSlotRef[],
  extraSlots: readonly StemSlotRef[]
): StemSlotRef[] {
  const merged = [
    ...columnSlots,
    ...extraSlots.filter((s) => s.slot > LORE_STEM_COLUMN_COUNT)
  ]
  return merged.sort((a, b) => a.slot - b.slot)
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx vitest run src/shared/riffStemSlots.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add src/shared/riffStemSlots.ts src/shared/riffStemSlots.test.ts
git commit -m "$(cat <<'EOF'
name the two eights apart, because conflating them is what capped a kept group

lore_stem_column_count is the riffs table's own eight columns and never
moves; max_rifff_stem_slots is sssketch's own ceiling and is now the only
place twenty is written down.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h
EOF
)"
```

---

## Task 2: The side table's own module

Everything that knows the table exists lives here, including the absence check. **Nothing outside this file may ask whether the table is present.**

**Files:**
- Create: `src/main/riffStemsExtra.ts`
- Test: `src/main/riffStemsExtra.test.ts`
- Modify: `vitest.config.ts`

- [ ] **Step 1: Write the failing test**

Create `src/main/riffStemsExtra.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import {
  RIFF_STEMS_EXTRA_DDL,
  hasExtraStemSlotsTable,
  readExtraStemSlots,
  readAllExtraStemSlots,
  writeExtraStemSlots,
  deleteExtraStemSlotsForRiff,
  deleteExtraStemSlotsForJam,
  extraStemCIDsForJam
} from './riffStemsExtra'

/** A warehouse WITH the sssketch extension -- i.e. sssketch's own. */
function ownDb(): Database.Database {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE Riffs (
      RiffCID TEXT PRIMARY KEY, OwnerJamCID TEXT NOT NULL,
      StemCID_1 TEXT, StemCID_2 TEXT, StemCID_3 TEXT, StemCID_4 TEXT,
      StemCID_5 TEXT, StemCID_6 TEXT, StemCID_7 TEXT, StemCID_8 TEXT
    );
  `)
  db.exec(RIFF_STEMS_EXTRA_DDL)
  return db
}

/** A warehouse WITHOUT it -- exactly what a real external OUROVEON/LORE
 * warehouse.db3 looks like, and it is opened read-only so it can never be
 * given the table. */
function externalDb(): Database.Database {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE Riffs (
      RiffCID TEXT PRIMARY KEY, OwnerJamCID TEXT NOT NULL,
      StemCID_1 TEXT, StemCID_2 TEXT, StemCID_3 TEXT, StemCID_4 TEXT,
      StemCID_5 TEXT, StemCID_6 TEXT, StemCID_7 TEXT, StemCID_8 TEXT
    );
  `)
  return db
}

describe('riffStemsExtra', () => {
  it('detects the table on sssketch own db and its absence on an external one', () => {
    expect(hasExtraStemSlotsTable(ownDb())).toBe(true)
    expect(hasExtraStemSlotsTable(externalDb())).toBe(false)
  })

  it('round-trips slots 9-12 for one riff', () => {
    const db = ownDb()
    writeExtraStemSlots(db, 'r1', [
      { slot: 9, stemCID: 's9' },
      { slot: 10, stemCID: 's10' },
      { slot: 11, stemCID: 's11' },
      { slot: 12, stemCID: 's12' }
    ])
    expect(readExtraStemSlots(db, ['r1']).get('r1')).toEqual([
      { slot: 9, stemCID: 's9' },
      { slot: 10, stemCID: 's10' },
      { slot: 11, stemCID: 's11' },
      { slot: 12, stemCID: 's12' }
    ])
  })

  it('reads several riffs in one query and keys them apart', () => {
    const db = ownDb()
    writeExtraStemSlots(db, 'r1', [{ slot: 9, stemCID: 'a' }])
    writeExtraStemSlots(db, 'r2', [{ slot: 9, stemCID: 'b' }])
    const map = readExtraStemSlots(db, ['r1', 'r2', 'r3'])
    expect(map.get('r1')).toEqual([{ slot: 9, stemCID: 'a' }])
    expect(map.get('r2')).toEqual([{ slot: 9, stemCID: 'b' }])
    expect(map.has('r3')).toBe(false)
  })

  it('rewriting a riff replaces its extras rather than accumulating them', () => {
    const db = ownDb()
    writeExtraStemSlots(db, 'r1', [
      { slot: 9, stemCID: 'a' },
      { slot: 10, stemCID: 'b' }
    ])
    writeExtraStemSlots(db, 'r1', [{ slot: 9, stemCID: 'c' }])
    expect(readExtraStemSlots(db, ['r1']).get('r1')).toEqual([{ slot: 9, stemCID: 'c' }])
  })

  it('shrinking a riff back under nine leaves no rows behind', () => {
    const db = ownDb()
    writeExtraStemSlots(db, 'r1', [{ slot: 9, stemCID: 'a' }])
    writeExtraStemSlots(db, 'r1', [])
    expect(readExtraStemSlots(db, ['r1']).has('r1')).toBe(false)
  })

  it('refuses a slot inside the column range at the storage layer', () => {
    const db = ownDb()
    expect(() => writeExtraStemSlots(db, 'r1', [{ slot: 8, stemCID: 'a' }])).toThrow()
  })

  it('readAllExtraStemSlots returns the whole table in one pass', () => {
    const db = ownDb()
    writeExtraStemSlots(db, 'r1', [{ slot: 9, stemCID: 'a' }])
    writeExtraStemSlots(db, 'r2', [{ slot: 9, stemCID: 'b' }])
    const all = readAllExtraStemSlots(db)
    expect(all.size).toBe(2)
    expect(all.get('r2')).toEqual([{ slot: 9, stemCID: 'b' }])
  })

  it('every reader is empty, not an error, against a db with no such table', () => {
    const db = externalDb()
    expect(readExtraStemSlots(db, ['r1']).size).toBe(0)
    expect(readAllExtraStemSlots(db).size).toBe(0)
    expect(extraStemCIDsForJam(db, 'jam1')).toEqual([])
  })

  it('every writer is a no-op, not an error, against a db with no such table', () => {
    const db = externalDb()
    expect(() => writeExtraStemSlots(db, 'r1', [{ slot: 9, stemCID: 'a' }])).not.toThrow()
    expect(() => deleteExtraStemSlotsForRiff(db, 'r1')).not.toThrow()
    expect(() => deleteExtraStemSlotsForJam(db, 'jam1')).not.toThrow()
  })

  it('deletes one riff extras without touching another', () => {
    const db = ownDb()
    writeExtraStemSlots(db, 'r1', [{ slot: 9, stemCID: 'a' }])
    writeExtraStemSlots(db, 'r2', [{ slot: 9, stemCID: 'b' }])
    deleteExtraStemSlotsForRiff(db, 'r1')
    expect(readAllExtraStemSlots(db).size).toBe(1)
  })

  it('collects and deletes a whole jam extras through the Riffs join', () => {
    const db = ownDb()
    db.prepare(`INSERT INTO Riffs (RiffCID, OwnerJamCID) VALUES ('r1', 'jamA')`).run()
    db.prepare(`INSERT INTO Riffs (RiffCID, OwnerJamCID) VALUES ('r2', 'jamB')`).run()
    writeExtraStemSlots(db, 'r1', [{ slot: 9, stemCID: 'a' }])
    writeExtraStemSlots(db, 'r2', [{ slot: 9, stemCID: 'b' }])

    expect(extraStemCIDsForJam(db, 'jamA')).toEqual(['a'])
    deleteExtraStemSlotsForJam(db, 'jamA')
    expect(extraStemCIDsForJam(db, 'jamA')).toEqual([])
    expect(extraStemCIDsForJam(db, 'jamB')).toEqual(['b'])
  })

  it('reads more riffCIDs than one SQL statement can bind, in chunks', () => {
    const db = ownDb()
    const riffCIDs = Array.from({ length: 2500 }, (_, i) => `r${i}`)
    for (const riffCID of riffCIDs) writeExtraStemSlots(db, riffCID, [{ slot: 9, stemCID: riffCID }])
    expect(readExtraStemSlots(db, riffCIDs).size).toBe(2500)
  })
})
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx vitest run src/main/riffStemsExtra.test.ts`
Expected: FAIL — `Failed to resolve import "./riffStemsExtra"`.

- [ ] **Step 3: Write the implementation**

Create `src/main/riffStemsExtra.ts`:

```ts
// src/main/riffStemsExtra.ts
import type Database from 'better-sqlite3'
import { LORE_STEM_COLUMN_COUNT, type StemSlotRef } from '@shared/riffStemSlots'

/** The one sssketch-exclusive table that lets a rifff carry more than the
 * eight stems Riffs.StemCID_1..8 can address.
 *
 * Slots 9 and up ONLY -- the eight columns remain the sole source of truth
 * for slots 1-8, so there is never a question of which side wins. That is
 * enforced here, by CHECK, rather than left to convention.
 *
 * No FOREIGN KEY to Riffs, deliberately: SQLite only enforces one when
 * PRAGMA foreign_keys is ON, and this codebase never sets it anywhere, so
 * a declared FK would read as a guarantee and enforce nothing. It would
 * also point a sssketch-exclusive table AT the LORE-compatible one, which
 * is backwards -- Riffs is OUROVEON's shape and our extension must never
 * be able to fail a write to it. Deletion is explicit instead
 * (deleteExtraStemSlotsForRiff / ForJam), and a dangling row is harmless
 * because every read is driven FROM Riffs and simply never reaches it.
 *
 * The ceiling (MAX_RIFFF_STEM_SLOTS, currently 20) is deliberately NOT a
 * CHECK: SQLite cannot ALTER one, so encoding a product number here would
 * mean a table rebuild the first time twenty is not enough. The lower
 * bound is an invariant; the upper bound is a decision. */
export const RIFF_STEMS_EXTRA_DDL = `
CREATE TABLE IF NOT EXISTS RiffStemsExtra (
  RiffCID TEXT NOT NULL,
  Slot INTEGER NOT NULL CHECK (Slot >= ${LORE_STEM_COLUMN_COUNT + 1}),
  StemCID TEXT NOT NULL,
  PRIMARY KEY (RiffCID, Slot)
);
-- deleteJamRows asks "is this stem still referenced by ANY riff" once per
-- candidate stem; without this that question is a full scan of this table.
CREATE INDEX IF NOT EXISTS idx_riffstemsextra_stem ON RiffStemsExtra(StemCID);
`

/** Chunk size for an IN (...) bind list. SQLite's default
 * SQLITE_MAX_VARIABLE_NUMBER is 32766 on modern bundled versions; 900
 * keeps every statement in this file far away from it without anyone
 * having to think about page sizes again. */
const BIND_CHUNK = 900

/** Whether `db` carries the sssketch extension at all.
 *
 * This is THE question, and it is deliberately a question about the
 * SCHEMA, not about the connection. An external OUROVEON/LORE warehouse
 * does not have this table and is opened read-only (riffLibraryStore.ts's
 * getRiffLibraryDb), so it can never be given one -- that is the
 * constraint this whole module is shaped around.
 *
 * Two plausible alternatives are both wrong here. `Database#readonly`
 * fails in the DEFAULT configuration, because getRiffLibraryDb opens
 * whatever root is configured read-only and the default configured root IS
 * sssketch's own library -- so the own warehouse is normally open twice and
 * the read-only handle would be misread as external. Comparing db.name to
 * ownRiffLibraryDbPath() answers "which file is this" rather than "does
 * this database carry the extension", and the two come apart on an own
 * warehouse opened before the migration ran.
 *
 * Same cheap PRAGMA idiom riffLibrarySchema.ts already uses twice, against
 * the connection's in-memory schema. Called once per read operation --
 * never per riff, never per stem. */
export function hasExtraStemSlotsTable(db: Database.Database): boolean {
  return db.prepare(`PRAGMA table_info(RiffStemsExtra)`).all().length > 0
}

interface ExtraRow {
  RiffCID: string
  Slot: number
  StemCID: string
}

function collect(rows: ExtraRow[], into: Map<string, StemSlotRef[]>): void {
  for (const row of rows) {
    const list = into.get(row.RiffCID)
    const ref = { slot: row.Slot, stemCID: row.StemCID }
    if (list) list.push(ref)
    else into.set(row.RiffCID, [ref])
  }
}

/** Slots 9+ for each of `riffCIDs` that has any, batched -- never one
 * query per riff. Returns an EMPTY MAP when the table is absent, which is
 * the whole external-LORE story: no caller branches on it, so no caller
 * can forget it, and a ≤8-stem rifff there falls out of the same code path
 * as everything else.
 *
 * .all(), never .iterate() -- callers include async page loops, and
 * .iterate() across an await caused a real live crash. */
export function readExtraStemSlots(
  db: Database.Database,
  riffCIDs: readonly string[]
): Map<string, StemSlotRef[]> {
  const out = new Map<string, StemSlotRef[]>()
  if (riffCIDs.length === 0 || !hasExtraStemSlotsTable(db)) return out
  for (let i = 0; i < riffCIDs.length; i += BIND_CHUNK) {
    const chunk = riffCIDs.slice(i, i + BIND_CHUNK)
    const placeholders = chunk.map(() => '?').join(',')
    const rows = db
      .prepare(
        `SELECT RiffCID, Slot, StemCID FROM RiffStemsExtra
         WHERE RiffCID IN (${placeholders}) ORDER BY RiffCID, Slot`
      )
      .all(...chunk) as ExtraRow[]
    collect(rows, out)
  }
  return out
}

/** The whole table, in one pass. For the three readers that walk ALL of
 * Riffs in pages (scanTargetCache.ts, discoverCandidates.ts,
 * discoverLibraryStems.ts): call this ONCE per database connection and
 * hold the map. Do NOT re-query it per page and never per riff -- jams
 * share one database, and per-jam loop-requerying is the pattern that
 * caused two real bugs in a day (CLAUDE.md).
 *
 * Free against an external archive, which has no such table, and small
 * against sssketch's own: only a rifff with more than eight stems has any
 * rows here at all. */
export function readAllExtraStemSlots(db: Database.Database): Map<string, StemSlotRef[]> {
  const out = new Map<string, StemSlotRef[]>()
  if (!hasExtraStemSlotsTable(db)) return out
  const rows = db
    .prepare(`SELECT RiffCID, Slot, StemCID FROM RiffStemsExtra ORDER BY RiffCID, Slot`)
    .all() as ExtraRow[]
  collect(rows, out)
  return out
}

/** Replaces this riff's slots 9+ wholesale -- delete then insert, so an
 * upsert that SHRINKS a rifff cannot leave a stale row behind pointing at
 * a stem the riff no longer has.
 *
 * Takes no transaction of its own: the one caller (writeRiffDetail) is
 * already inside one, and the Riffs row and these rows must commit or fail
 * together.
 *
 * A db with no such table is a no-op with one warning, not a throw. In
 * production that cannot happen -- openOwnRiffLibraryDb always creates the
 * table and an external archive is never written to -- so this branch only
 * ever sees a test fixture that did not paste the DDL. Dropping the extras
 * there is the same answer as reading them back as absent. */
export function writeExtraStemSlots(
  db: Database.Database,
  riffCID: string,
  extras: readonly StemSlotRef[]
): void {
  if (!hasExtraStemSlotsTable(db)) {
    if (extras.length > 0) {
      console.warn(
        `writeExtraStemSlots: no RiffStemsExtra table on ${db.name}; ` +
          `dropped ${extras.length} slot(s) past ${LORE_STEM_COLUMN_COUNT} for riff ${riffCID}`
      )
    }
    return
  }
  db.prepare(`DELETE FROM RiffStemsExtra WHERE RiffCID = ?`).run(riffCID)
  const insert = db.prepare(
    `INSERT INTO RiffStemsExtra (RiffCID, Slot, StemCID) VALUES (?, ?, ?)`
  )
  for (const extra of extras) insert.run(riffCID, extra.slot, extra.stemCID)
}

export function deleteExtraStemSlotsForRiff(db: Database.Database, riffCID: string): void {
  if (!hasExtraStemSlotsTable(db)) return
  db.prepare(`DELETE FROM RiffStemsExtra WHERE RiffCID = ?`).run(riffCID)
}

/** Every distinct StemCID a jam's riffs reference from slot 9 up. One
 * query via a subselect on Riffs -- NOT a riffCID list bound from JS,
 * which on a 20,000-riff jam would be 23 chunked statements for no reason.
 *
 * Must be called BEFORE the jam's Riffs rows are deleted; the subselect
 * depends on them. */
export function extraStemCIDsForJam(db: Database.Database, jamCID: string): string[] {
  if (!hasExtraStemSlotsTable(db)) return []
  const rows = db
    .prepare(
      `SELECT DISTINCT StemCID FROM RiffStemsExtra
       WHERE RiffCID IN (SELECT RiffCID FROM Riffs WHERE OwnerJamCID = ?)`
    )
    .all(jamCID) as { StemCID: string }[]
  return rows.map((row) => row.StemCID)
}

/** Same ordering requirement as extraStemCIDsForJam: before the Riffs
 * delete, or the subselect finds nothing and the rows are orphaned. */
export function deleteExtraStemSlotsForJam(db: Database.Database, jamCID: string): void {
  if (!hasExtraStemSlotsTable(db)) return
  db.prepare(
    `DELETE FROM RiffStemsExtra
     WHERE RiffCID IN (SELECT RiffCID FROM Riffs WHERE OwnerJamCID = ?)`
  ).run(jamCID)
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx vitest run src/main/riffStemsExtra.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 5: Run the full suite to confirm nothing else moved**

Run: `npm test`
Expected: `Test Files 195 passed (195)` / `Tests 2976 passed (2976)` — 193 + 2 new files, 2954 + 10 + 12 new tests.

- [ ] **Step 6: Run typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: 0 errors, still exactly 4 prettier warnings.

- [ ] **Step 7: Add the new test file to the CI exclusion list — DO NOT SKIP THIS**

`src/main/riffStemsExtra.test.ts` opens `better-sqlite3`, which crashes its vitest worker on GitHub's macOS runners. A missing entry does not fail a test — it produces a non-zero exit with **zero failed tests named**, and that signature blocked every release for six weeks. In `vitest.config.ts`, add one line to the `exclude` array, keeping it alphabetical among the `src/main/` entries — between `'src/main/riffLibraryWriter.test.ts'` and `'src/main/categoryCentroidTraining.test.ts'` is where the riff-library group sits, so put it directly after `riffLibraryWriter`:

```ts
          'src/main/riffLibraryWriter.test.ts',
          'src/main/riffStemsExtra.test.ts',
          'src/main/riffFavouritesMigration.test.ts',
```

- [ ] **Step 8: Confirm the exclusion actually takes**

Run: `CI=1 npx vitest run src/main/riffStemsExtra.test.ts`
Expected: no tests run, exit 0 (`passWithNoTests: true` is set). If the file's tests run, the path string does not match — fix it before committing.

- [ ] **Step 9: Commit**

```bash
git add src/main/riffStemsExtra.ts src/main/riffStemsExtra.test.ts vitest.config.ts
git commit -m "$(cat <<'EOF'
a side table for the stems past the eighth, absent on purpose everywhere else

riffstemsextra holds slots 9 and up so the lore-compatible riffs shape is
untouched. both readers answer with an empty map when the table is not
there, which is what an external read-only lore warehouse always looks
like, so no caller has to know about that case. the new test file goes on
the ci exclusion list in the same commit.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h
EOF
)"
```

---

## Task 3: Create the table on every own-warehouse open

The whole migration. No `ALTER`, no backfill, no version flag — every existing rifff has ≤8 stems, so an empty table is already the correct state.

**Files:**
- Modify: `src/main/riffLibrarySchema.ts`
- Test: `src/main/riffLibrarySchema.test.ts`

- [ ] **Step 1: Write the failing test**

Append to the top-level `describe` in `src/main/riffLibrarySchema.test.ts`:

```ts
  it('opening the own db creates RiffStemsExtra, and doing it twice is a no-op', () => {
    const db = openOwnRiffLibraryDb()
    const columns = db.prepare(`PRAGMA table_info(RiffStemsExtra)`).all() as { name: string }[]
    expect(columns.map((c) => c.name)).toEqual(['RiffCID', 'Slot', 'StemCID'])

    db.prepare(`INSERT INTO RiffStemsExtra (RiffCID, Slot, StemCID) VALUES ('r1', 9, 's9')`).run()
    closeOwnRiffLibraryDb()
    const reopened = openOwnRiffLibraryDb()
    const { n } = reopened.prepare(`SELECT COUNT(*) AS n FROM RiffStemsExtra`).get() as { n: number }
    expect(n).toBe(1)
  })

  it('the table refuses a slot the eight columns already own', () => {
    const db = openOwnRiffLibraryDb()
    expect(() =>
      db.prepare(`INSERT INTO RiffStemsExtra (RiffCID, Slot, StemCID) VALUES ('r2', 8, 's8')`).run()
    ).toThrow()
  })
```

If `closeOwnRiffLibraryDb` is not already imported at the top of that file, add it to the existing `from './riffLibrarySchema'` import.

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx vitest run src/main/riffLibrarySchema.test.ts -t 'RiffStemsExtra'`
Expected: FAIL — `expected [] to deeply equal [ 'RiffCID', 'Slot', 'StemCID' ]`.

- [ ] **Step 3: Wire the DDL into `SCHEMA_SQL`**

In `src/main/riffLibrarySchema.ts`, add the import beside the existing ones at the top:

```ts
import { RIFF_STEMS_EXTRA_DDL } from './riffStemsExtra'
```

Then append to the very end of the `SCHEMA_SQL` template literal, immediately before its closing backtick (after `DiscoverInstrumentRowsCacheMeta`):

```ts
-- Rifffs beyond eight stems (2026-09-27). Interpolated from
-- riffStemsExtra.ts rather than written out here, unlike every other table
-- in this file, for one reason: the test fixtures that need this table
-- paste its DDL too, and one shared constant is the only way those cannot
-- drift. That module also owns every read and write of it, including the
-- "does this database have it at all" check -- an external OUROVEON/LORE
-- warehouse never will, and is opened read-only, so it can never be given
-- one.
--
-- Migration is exactly this CREATE TABLE IF NOT EXISTS and nothing else.
-- No ALTER and no backfill: every rifff that already exists has eight
-- stems or fewer, so an empty table is already the right answer for all of
-- them. (Contrast the two special cases above --
-- ensureDiscoverRiffIndexCacheHasCreationTime drops and rebuilds because
-- CREATE TABLE IF NOT EXISTS cannot add a COLUMN, and
-- ensureStemCategoriesHasSubcategoryNote does a real ALTER because that
-- table holds irreplaceable data. Neither applies to adding a new table;
-- both are the precedents to copy if this one ever needs a column.)
--
-- Downgrade: an older build reads Riffs.StemCID_1..8 and sees an
-- eight-stem rifff. It never drops a table it does not know about, so the
-- rows survive and re-upgrading restores all twenty. GainsJSON is
-- slot-keyed and already carries gains for slots 9-20 with no schema
-- change at all -- an older build simply never asks for those keys. Do not
-- "tidy" GainsJSON to eight keys.
${RIFF_STEMS_EXTRA_DDL}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx vitest run src/main/riffLibrarySchema.test.ts`
Expected: PASS, whole file.

- [ ] **Step 5: Commit**

```bash
git add src/main/riffLibrarySchema.ts src/main/riffLibrarySchema.test.ts
git commit -m "$(cat <<'EOF'
create the side table on every own-warehouse open, which is the whole migration

no alter and no backfill: every rifff that already exists has eight stems
or fewer, so an empty table is already correct for all of them. an older
build opening this db still sees eight-stem rifffs and corrupts nothing.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h
EOF
)"
```

---

## Task 4: `writeRiffDetail` writes slots 9-20

**Files:**
- Modify: `src/main/riffLibraryWriter.ts:96-102` (the `slots` array inside the transaction)
- Test: `src/main/riffLibraryWriter.test.ts`

- [ ] **Step 1: Add the table to the test fixture and write the failing tests**

In `src/main/riffLibraryWriter.test.ts`, add to the imports at the top:

```ts
import { RIFF_STEMS_EXTRA_DDL, readExtraStemSlots } from './riffStemsExtra'
```

Inside `freshDb()`, after the existing `db.exec(...)` call, add:

```ts
  db.exec(RIFF_STEMS_EXTRA_DDL)
```

Then append these cases inside the existing `describe('writeRiffDetail', …)` block (or the top-level describe if there is no such block):

```ts
  it('writes the first eight stems to the columns and the rest to the side table', () => {
    const db = freshDb()
    const stems = Array.from({ length: 12 }, (_, i) => ({
      ...resolvedRiffFixture().stems[0],
      stemCID: `stem_${i + 1}`,
      slot: i + 1
    }))
    writeRiffDetail(db, 'jam_1', { creationTime: 10, userName: 'elling' }, {
      ...resolvedRiffFixture(),
      stems
    })

    const row = db.prepare(`SELECT StemCID_8 FROM Riffs WHERE RiffCID = 'riff_1'`).get() as {
      StemCID_8: string
    }
    expect(row.StemCID_8).toBe('stem_8')
    expect(readExtraStemSlots(db, ['riff_1']).get('riff_1')).toEqual([
      { slot: 9, stemCID: 'stem_9' },
      { slot: 10, stemCID: 'stem_10' },
      { slot: 11, stemCID: 'stem_11' },
      { slot: 12, stemCID: 'stem_12' }
    ])
    db.close()
  })

  it('gives every stem past the eighth a real Stems row too', () => {
    const db = freshDb()
    const stems = Array.from({ length: 12 }, (_, i) => ({
      ...resolvedRiffFixture().stems[0],
      stemCID: `stem_${i + 1}`,
      slot: i + 1
    }))
    writeRiffDetail(db, 'jam_1', { creationTime: 10, userName: 'elling' }, {
      ...resolvedRiffFixture(),
      stems
    })
    const { n } = db.prepare(`SELECT COUNT(*) AS n FROM Stems`).get() as { n: number }
    expect(n).toBe(12)
    db.close()
  })

  it('carries gains for slots past the eighth in GainsJSON, unchanged', () => {
    const db = freshDb()
    const stems = Array.from({ length: 10 }, (_, i) => ({
      ...resolvedRiffFixture().stems[0],
      stemCID: `stem_${i + 1}`,
      slot: i + 1,
      gain: (i + 1) / 10
    }))
    writeRiffDetail(db, 'jam_1', { creationTime: 10, userName: 'elling' }, {
      ...resolvedRiffFixture(),
      stems
    })
    const row = db.prepare(`SELECT GainsJSON FROM Riffs WHERE RiffCID = 'riff_1'`).get() as {
      GainsJSON: string
    }
    expect((JSON.parse(row.GainsJSON) as Record<string, number>)['10']).toBeCloseTo(1.0)
    db.close()
  })

  it('an upsert that shrinks a rifff leaves no stale side rows', () => {
    const db = freshDb()
    const base = resolvedRiffFixture()
    const twelve = Array.from({ length: 12 }, (_, i) => ({
      ...base.stems[0],
      stemCID: `stem_${i + 1}`,
      slot: i + 1
    }))
    writeRiffDetail(db, 'jam_1', { creationTime: 10, userName: 'elling' }, {
      ...base,
      stems: twelve
    })
    writeRiffDetail(db, 'jam_1', { creationTime: 10, userName: 'elling' }, {
      ...base,
      stems: twelve.slice(0, 5)
    })
    expect(readExtraStemSlots(db, ['riff_1']).has('riff_1')).toBe(false)
    db.close()
  })
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `npx vitest run src/main/riffLibraryWriter.test.ts -t 'side table'`
Expected: FAIL — the side table is empty, `expected undefined to deeply equal [ … ]`.

- [ ] **Step 3: Write the implementation**

In `src/main/riffLibraryWriter.ts`, add to the imports at the top:

```ts
import { LORE_STEM_COLUMN_COUNT, STEM_SLOT_COLUMNS, splitStemSlots } from '@shared/riffStemSlots'
import { writeExtraStemSlots } from './riffStemsExtra'
```

and delete the local `const STEM_SLOT_COLUMNS = Array.from({ length: 8 }, …)` at `:211` — it is now the shared one, with the same value and the same name, so nothing else in this file changes for it.

Inside `writeRiffDetail`'s transaction, replace the `slots` array (currently `Array.from({ length: 8 }, …)`) and add the side-table write. The block becomes:

```ts
  const txn = db.transaction((riff: RiffLibraryResolvedRiff) => {
    // Slots 1-8 go in the Riffs columns; 9-20 go in the RiffStemsExtra
    // side table, so the LORE-compatible shape of Riffs is untouched. A
    // slot outside 1..MAX_RIFFF_STEM_SLOTS is dropped and SAID SO -- the
    // original version of this cap dropped stems in silence, which is the
    // bug this whole change exists to fix.
    const { columnStems, extraStems, dropped } = splitStemSlots(riff.stems)
    if (dropped.length > 0) {
      console.warn(
        `writeRiffDetail: riff ${riff.riffCID} had ${dropped.length} stem(s) outside ` +
          `slots 1..${MAX_RIFFF_STEM_SLOTS}; they were not written`
      )
    }
    const slots: (string | null)[] = Array.from({ length: LORE_STEM_COLUMN_COUNT }, (_, i) => {
      const stem = columnStems.find((s) => s.slot === i + 1)
      return stem?.stemCID ?? null
    })
    // GainsJSON is slot-keyed and has never been bounded by eight, so a
    // 12-stem rifff's gains for slots 9-12 persist here with no schema
    // change at all. An older build simply never asks for those keys. Do
    // not "tidy" this to eight entries.
    const gains: Record<string, number> = {}
    for (const stem of riff.stems) gains[String(stem.slot)] = stem.gain

    upsertRiffRow.run({
      /* …unchanged… */
    })

    // Inside the same transaction as the Riffs row, and delete-then-insert
    // inside itself, so an upsert that SHRINKS a rifff cannot leave a
    // stale slot-12 row pointing at a stem the riff no longer has.
    writeExtraStemSlots(db, riff.riffCID, extraStems)

    for (const stem of riff.stems) {
      /* …unchanged: every stem, including 9-20, gets its Stems row… */
    }
  })
```

Add `MAX_RIFFF_STEM_SLOTS` to the `@shared/riffStemSlots` import for that warning.

- [ ] **Step 4: Run the tests and watch them pass**

Run: `npx vitest run src/main/riffLibraryWriter.test.ts`
Expected: PASS, whole file.

- [ ] **Step 5: Commit**

```bash
git add src/main/riffLibraryWriter.ts src/main/riffLibraryWriter.test.ts
git commit -m "$(cat <<'EOF'
the writer splits a rifff at the eighth stem and keeps the rest beside it

both halves commit in the one transaction the riffs row already used, and
a shrinking upsert clears the side rows rather than leaving a slot
pointing at a stem the rifff no longer has.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h
EOF
)"
```

---

## Task 5: `deleteJamRows` stops deleting stems that slot 9+ still needs

The comment at `riffLibraryWriter.ts:223` calls the slot columns *"the actual source of truth for is this stem still needed by ANY jam."* That sentence stops being true the moment a stem can live only in slot 12. Left alone, removing a jam from sync deletes `Stems` rows a kept group still points at.

**Files:**
- Modify: `src/main/riffLibraryWriter.ts:211-256` (`deleteJamRows`)
- Test: `src/main/riffLibraryWriter.test.ts`

- [ ] **Step 1: Write the failing tests**

Append inside the existing `describe('deleteJamRows', …)`:

```ts
  it('collects a stem that only appears past the eighth slot as a candidate', () => {
    const db = freshDb()
    db.prepare(`INSERT INTO Jams (JamCID, PublicName) VALUES ('jam_1', 'one')`).run()
    db.prepare(
      `INSERT INTO Riffs (RiffCID, OwnerJamCID, StemCID_1) VALUES ('r1', 'jam_1', 'in_column')`
    ).run()
    db.prepare(`INSERT INTO RiffStemsExtra VALUES ('r1', 9, 'only_extra')`).run()
    db.prepare(`INSERT INTO Stems (StemCID, OwnerJamCID) VALUES ('in_column', 'jam_1')`).run()
    db.prepare(`INSERT INTO Stems (StemCID, OwnerJamCID) VALUES ('only_extra', 'jam_1')`).run()

    expect(deleteJamRows(db, 'jam_1').sort()).toEqual(['in_column', 'only_extra'])
    db.close()
  })

  it('keeps a stem another jam riff still holds past its eighth slot', () => {
    const db = freshDb()
    db.prepare(`INSERT INTO Jams (JamCID, PublicName) VALUES ('jam_1', 'one')`).run()
    db.prepare(`INSERT INTO Jams (JamCID, PublicName) VALUES ('jam_2', 'two')`).run()
    db.prepare(
      `INSERT INTO Riffs (RiffCID, OwnerJamCID, StemCID_1) VALUES ('r1', 'jam_1', 'shared')`
    ).run()
    db.prepare(`INSERT INTO Riffs (RiffCID, OwnerJamCID) VALUES ('r2', 'jam_2')`).run()
    db.prepare(`INSERT INTO RiffStemsExtra VALUES ('r2', 12, 'shared')`).run()
    db.prepare(`INSERT INTO Stems (StemCID, OwnerJamCID) VALUES ('shared', 'jam_1')`).run()

    expect(deleteJamRows(db, 'jam_1')).toEqual([])
    expect(db.prepare(`SELECT 1 FROM Stems WHERE StemCID = 'shared'`).get()).toBeDefined()
    db.close()
  })

  it('deletes the jam own side rows along with its riffs', () => {
    const db = freshDb()
    db.prepare(`INSERT INTO Jams (JamCID, PublicName) VALUES ('jam_1', 'one')`).run()
    db.prepare(`INSERT INTO Riffs (RiffCID, OwnerJamCID) VALUES ('r1', 'jam_1')`).run()
    db.prepare(`INSERT INTO RiffStemsExtra VALUES ('r1', 9, 'a')`).run()
    deleteJamRows(db, 'jam_1')
    const { n } = db.prepare(`SELECT COUNT(*) AS n FROM RiffStemsExtra`).get() as { n: number }
    expect(n).toBe(0)
    db.close()
  })
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `npx vitest run src/main/riffLibraryWriter.test.ts -t 'deleteJamRows'`
Expected: FAIL — the first returns only `['in_column']`, the second wrongly returns `['shared']` and deletes the row, the third leaves one row behind.

- [ ] **Step 3: Write the implementation**

Add to the `./riffStemsExtra` import in `src/main/riffLibraryWriter.ts`:

```ts
import {
  deleteExtraStemSlotsForJam,
  extraStemCIDsForJam,
  hasExtraStemSlotsTable,
  writeExtraStemSlots
} from './riffStemsExtra'
```

Replace the body of `deleteJamRows` from the candidate collection down to the return with:

```ts
export function deleteJamRows(db: Database.Database, jamCID: string): string[] {
  const slotSelect = STEM_SLOT_COLUMNS.join(', ')
  const riffRows = db
    .prepare(`SELECT ${slotSelect} FROM Riffs WHERE OwnerJamCID = ?`)
    .all(jamCID) as Record<string, string | null>[]
  const candidateStemCIDs = new Set<string>()
  for (const row of riffRows) {
    for (const column of STEM_SLOT_COLUMNS) {
      const cid = row[column]
      if (cid) candidateStemCIDs.add(cid)
    }
  }
  // Slots 9+ are candidates too. Read BEFORE the delete below -- both of
  // these go through Riffs to find the jam's riffCIDs, so after the delete
  // they would find nothing. One query each, via a subselect, rather than
  // binding a 20,000-riffCID list from JS.
  for (const stemCID of extraStemCIDsForJam(db, jamCID)) candidateStemCIDs.add(stemCID)

  db.transaction(() => {
    deleteExtraStemSlotsForJam(db, jamCID)
    db.prepare(`DELETE FROM Riffs WHERE OwnerJamCID = ?`).run(jamCID)
    db.prepare(`DELETE FROM Tags WHERE OwnerJamCID = ?`).run(jamCID)
    db.prepare(`DELETE FROM Jams WHERE JamCID = ?`).run(jamCID)
  })()

  if (candidateStemCIDs.size === 0) return []
  const stillReferencedWhere = STEM_SLOT_COLUMNS.map((c) => `${c} = @cid`).join(' OR ')
  // SELECT 1 WHERE EXISTS(...) OR EXISTS(...), not SELECT 1 FROM Riffs
  // WHERE ... OR EXISTS(...). The second shape looks equivalent and is
  // not: with the jam's riffs gone, Riffs can be empty, and a statement
  // selecting FROM an empty table returns no rows however true the EXISTS
  // is -- so a stem held only in some other riff's slot 12 would be
  // reported orphaned and deleted.
  const extraClause = hasExtraStemSlotsTable(db)
    ? ` OR EXISTS (SELECT 1 FROM RiffStemsExtra WHERE StemCID = @cid)`
    : ''
  const checkStmt = db.prepare(
    `SELECT 1 WHERE EXISTS (SELECT 1 FROM Riffs WHERE ${stillReferencedWhere})${extraClause}`
  )
  const orphanedStemCIDs = [...candidateStemCIDs].filter((cid) => !checkStmt.get({ cid }))
  if (orphanedStemCIDs.length > 0) {
    const placeholders = orphanedStemCIDs.map(() => '?').join(',')
    db.prepare(`DELETE FROM Stems WHERE StemCID IN (${placeholders})`).run(...orphanedStemCIDs)
  }
  return orphanedStemCIDs
}
```

Update that function's doc comment: the sentence *"walks every `Riffs.StemCID_1..8` slot — the actual source of truth for 'is this stem still needed by ANY jam'"* becomes *"walks every `Riffs.StemCID_1..8` slot AND every `RiffStemsExtra` row — together, the actual source of truth for 'is this stem still needed by ANY jam'"*.

- [ ] **Step 4: Run the tests and watch them pass**

Run: `npx vitest run src/main/riffLibraryWriter.test.ts`
Expected: PASS, whole file — including the pre-existing `deleteJamRows` cases, which must be unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/main/riffLibraryWriter.ts src/main/riffLibraryWriter.test.ts
git commit -m "$(cat <<'EOF'
removing a jam no longer deletes a stem that only a ninth slot still holds

the orphan check now asks the side table as well, through an exists pair
rather than a select from riffs, because the jam's own rows are already
gone by the time it runs and an empty table answers nothing.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h
EOF
)"
```

---

## Task 6: `resolveRiff` returns all twenty

The read path that feeds preview, import-to-shelf, add-to-timeline and both exports.

**Files:**
- Modify: `src/main/riffLibraryStore.ts:499-593` (`buildResolvedRiff`, `resolveRiff`)
- Test: `src/main/riffLibraryStore.test.ts`

- [ ] **Step 1: Write the failing tests**

In `src/main/riffLibraryStore.test.ts`, add to the imports:

```ts
import { RIFF_STEMS_EXTRA_DDL } from './riffStemsExtra'
```

Append inside `describe('resolveRiff', …)`:

```ts
  it('resolves a twelve-stem rifff, columns and side table merged in slot order', () => {
    root = mkdtempSync(join(tmpdir(), 'sssketch-lore-root-test-'))
    createFixtureWarehouse(root)
    setRiffLibraryRootForTests(root)
    const db = new Database(join(root, 'cache', 'common', 'warehouse.db3'))
    db.exec(RIFF_STEMS_EXTRA_DDL)
    db.prepare(`INSERT INTO Jams (JamCID, PublicName) VALUES ('jam_1', 'jam one')`).run()
    const columns = Array.from({ length: 8 }, (_, i) => `'stem_${i + 1}'`).join(', ')
    db.prepare(
      `INSERT INTO Riffs (RiffCID, OwnerJamCID, CreationTime, BPMrnd, BarLength, UserName,
                          StemCID_1, StemCID_2, StemCID_3, StemCID_4,
                          StemCID_5, StemCID_6, StemCID_7, StemCID_8, GainsJSON)
       VALUES ('riff_big', 'jam_1', 100, 120, 4, 'elling', ${columns}, '{"12":0.25}')`
    ).run()
    for (let slot = 9; slot <= 12; slot++) {
      db.prepare(`INSERT INTO RiffStemsExtra VALUES ('riff_big', ?, ?)`).run(slot, `stem_${slot}`)
    }
    for (let i = 1; i <= 12; i++) {
      db.prepare(
        `INSERT INTO Stems (StemCID, OwnerJamCID, CreatorUserName, PresetName, Instrument,
                            BPMrnd, Length16s)
         VALUES (?, 'jam_1', 'elling', 'thud', 1, 120, 64)`
      ).run(`stem_${i}`)
    }
    db.close()

    const resolved = resolveRiff('riff_big')
    expect(resolved?.stems.map((s) => s.slot)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
    expect(resolved?.stems[11].stemCID).toBe('stem_12')
    expect(resolved?.stems[11].gain).toBeCloseTo(0.25)
  })

  it('resolves eight stems against a warehouse with no side table, which is every external LORE one', () => {
    root = mkdtempSync(join(tmpdir(), 'sssketch-lore-root-test-'))
    createFixtureWarehouse(root)
    setRiffLibraryRootForTests(root)
    const db = new Database(join(root, 'cache', 'common', 'warehouse.db3'))
    db.prepare(`INSERT INTO Jams (JamCID, PublicName) VALUES ('jam_1', 'jam one')`).run()
    db.prepare(
      `INSERT INTO Riffs (RiffCID, OwnerJamCID, CreationTime, BPMrnd, BarLength, UserName, StemCID_1)
       VALUES ('riff_plain', 'jam_1', 100, 120, 4, 'elling', 'stem_1')`
    ).run()
    db.prepare(
      `INSERT INTO Stems (StemCID, OwnerJamCID, CreatorUserName, PresetName, Instrument, BPMrnd, Length16s)
       VALUES ('stem_1', 'jam_1', 'elling', 'thud', 1, 120, 64)`
    ).run()
    db.close()

    expect(resolveRiff('riff_plain')?.stems.map((s) => s.slot)).toEqual([1])
  })
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `npx vitest run src/main/riffLibraryStore.test.ts -t 'twelve-stem'`
Expected: FAIL — `expected [1,2,3,4,5,6,7,8] to deeply equal [1,…,12]`.

- [ ] **Step 3: Write the implementation**

In `src/main/riffLibraryStore.ts`, add to the imports:

```ts
import { columnStemSlots, mergeStemSlots, type StemSlotRef } from '@shared/riffStemSlots'
import { readExtraStemSlots } from './riffStemsExtra'
```

Give `buildResolvedRiff` a third parameter and replace its slot loop:

```ts
function buildResolvedRiff(
  db: Database.Database,
  riffRow: FullRiffRow,
  // Slots 9+ from RiffStemsExtra, already read in one batched query by the
  // caller. Empty for an external OUROVEON/LORE warehouse, which has no
  // such table and cannot be given one -- so ≤8 stems there is the same
  // code path as everything else, not a special case.
  extraSlots: readonly StemSlotRef[] = []
): RiffLibraryResolvedRiff {
  // …GainsJSON parsing unchanged…

  const slots = mergeStemSlots(columnStemSlots(riffRow as unknown as Record<string, unknown>), extraSlots)

  // …the .map over `slots` is unchanged; it already reads each stem's own
  // Stems row by StemCID and each slot's own gain out of GainsJSON, both
  // of which are slot-keyed and unbounded.
```

Delete the old `const slots: { slot: number; stemCID: string }[] = []` / `for (let slot = 1; slot <= 8; slot++)` block it replaces.

In `resolveRiff`, pass the extras:

```ts
export function resolveRiff(riffCID: string): RiffLibraryResolvedRiff | null {
  for (const db of candidateDbsForRiff()) {
    const riffRow = db
      .prepare(
        `SELECT RiffCID, OwnerJamCID, CreationTime, BPMrnd, BarLength, UserName, GainsJSON, Root, Scale,
                StemCID_1, StemCID_2, StemCID_3, StemCID_4, StemCID_5, StemCID_6, StemCID_7, StemCID_8
         FROM Riffs WHERE RiffCID = ?`
      )
      .get(riffCID) as FullRiffRow | undefined
    if (riffRow) {
      return buildResolvedRiff(db, riffRow, readExtraStemSlots(db, [riffCID]).get(riffCID) ?? [])
    }
  }
  return null
}
```

Leave `buildResolvedRiff`'s per-stem `SELECT … FROM Stems WHERE StemCID = ?` inside the `.map()` exactly as it is. At twenty that is twenty point lookups on an explicit single-riff resolve, which is not what CLAUDE.md's "never one query per stem" rule is about — that rule is about batch paths.

- [ ] **Step 4: Run the tests and watch them pass**

Run: `npx vitest run src/main/riffLibraryStore.test.ts`
Expected: PASS, whole file.

- [ ] **Step 5: Commit**

```bash
git add src/main/riffLibraryStore.ts src/main/riffLibraryStore.test.ts
git commit -m "$(cat <<'EOF'
resolving a rifff merges the eight columns with whatever sits past them

one batched read of the side table per resolve, and an external lore
warehouse simply has nothing to merge, so it keeps returning eight.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h
EOF
)"
```

---

## Task 7: `listRiffs` counts all twenty

`stemCount` / `cachedStemCount` drive the browse circle's hover title and the `onlyFullyCached` filter. Left at eight, a twelve-stem group reads `8 stems` and passes `onlyFullyCached` while four of its stems are missing from disk.

**Files:**
- Modify: `src/main/riffLibraryStore.ts:340-450` (`listRiffs`, and the `RIFF_PAGE_SIZE` comment)
- Test: `src/main/riffLibraryStore.test.ts`

- [ ] **Step 1: Write the failing test**

Append inside the `describe` that covers `listRiffs`:

```ts
  it('counts stems past the eighth in a page summary', () => {
    root = mkdtempSync(join(tmpdir(), 'sssketch-lore-root-test-'))
    createFixtureWarehouse(root)
    setRiffLibraryRootForTests(root)
    const db = new Database(join(root, 'cache', 'common', 'warehouse.db3'))
    db.exec(RIFF_STEMS_EXTRA_DDL)
    db.prepare(`INSERT INTO Jams (JamCID, PublicName) VALUES ('jam_1', 'jam one')`).run()
    const columns = Array.from({ length: 8 }, (_, i) => `'stem_${i + 1}'`).join(', ')
    db.prepare(
      `INSERT INTO Riffs (RiffCID, OwnerJamCID, CreationTime, BPMrnd, BarLength, UserName,
                          StemCID_1, StemCID_2, StemCID_3, StemCID_4,
                          StemCID_5, StemCID_6, StemCID_7, StemCID_8)
       VALUES ('riff_big', 'jam_1', 100, 120, 4, 'elling', ${columns})`
    ).run()
    for (let slot = 9; slot <= 12; slot++) {
      db.prepare(`INSERT INTO RiffStemsExtra VALUES ('riff_big', ?, ?)`).run(slot, `stem_${slot}`)
    }
    db.close()

    expect(listRiffs('jam_1', {}).riffs[0].stemCount).toBe(12)
  })
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx vitest run src/main/riffLibraryStore.test.ts -t 'past the eighth in a page'`
Expected: FAIL — `expected 8 to be 12`.

- [ ] **Step 3: Write the implementation**

In `listRiffs`, immediately after the `rows` query, read the page's extras once:

```ts
  // ONE query for the whole page's slots 9+, not one per riff. Empty for
  // an external OUROVEON/LORE warehouse, which has no such table.
  const extraByRiff = readExtraStemSlots(
    db,
    rows.map((row) => row.RiffCID)
  )
  const slotsByRiff = new Map(
    rows.map((row) => [
      row.RiffCID,
      mergeStemSlots(
        columnStemSlots(row as unknown as Record<string, unknown>),
        extraByRiff.get(row.RiffCID) ?? []
      )
    ])
  )
```

Replace both `for (let slot = 1; slot <= 8; slot++)` loops with reads from `slotsByRiff`:

```ts
  const allStemCIDs = new Set<string>()
  for (const slots of slotsByRiff.values()) {
    for (const { stemCID } of slots) allStemCIDs.add(stemCID)
  }
```

and, inside the `summaries` map:

```ts
    const stemCIDs = (slotsByRiff.get(row.RiffCID) ?? []).map((s) => s.stemCID)
```

Then chunk the creator lookup, replacing the single `IN (…)` with:

```ts
  const stemCreators = new Map<string, string>()
  if (allStemCIDs.size > 0) {
    const cidList = [...allStemCIDs]
    // Chunked, because the old "worst case 8000 placeholders, comfortably
    // under SQLITE_MAX_VARIABLE_NUMBER" arithmetic no longer holds: a page
    // of 1000 rifffs can now reference up to 20 distinct stems each, i.e.
    // 20,000. Still legal, no longer comfortable, and not worth being
    // clever about.
    for (let i = 0; i < cidList.length; i += 900) {
      const chunk = cidList.slice(i, i + 900)
      const placeholders = chunk.map(() => '?').join(',')
      const stemRows = db
        .prepare(`SELECT StemCID, CreatorUserName FROM Stems WHERE StemCID IN (${placeholders})`)
        .all(...chunk) as StemLookupRow[]
      for (const s of stemRows) stemCreators.set(s.StemCID, s.CreatorUserName)
    }
  }
```

Finally, fix the now-false `RIFF_PAGE_SIZE` comment at `:344-347`: replace *"worst case one page's rows reference up to 8 distinct StemCIDs each, i.e. 8000 placeholders in that IN (...) query, comfortably under the limit"* with *"a page's rows can reference up to MAX_RIFFF_STEM_SLOTS distinct StemCIDs each, so that lookup is chunked rather than relying on staying under SQLITE_MAX_VARIABLE_NUMBER."*

And fix the two doc comments in `src/shared/riffLibraryTypes.ts` that now lie — documentation only, no runtime effect, but they are the first thing the next reader will trust:

- `:22` `stemCount: number // populated slots, 1-8` → `// populated slots, 1..MAX_RIFFF_STEM_SLOTS (see @shared/riffStemSlots)`
- `:29` `slot: number // 1-8` → `// 1..MAX_RIFFF_STEM_SLOTS -- 1-8 live in Riffs.StemCID_1..8, the rest in RiffStemsExtra`

- [ ] **Step 4: Run the tests and watch them pass**

Run: `npx vitest run src/main/riffLibraryStore.test.ts`
Expected: PASS, whole file.

- [ ] **Step 5: Commit**

```bash
git add src/main/riffLibraryStore.ts src/main/riffLibraryStore.test.ts src/shared/riffLibraryTypes.ts
git commit -m "$(cat <<'EOF'
a browse page counts every stem a rifff has, not just the first eight

one extra query per page. also chunks the creator lookup, whose old
"comfortably under the bind limit" arithmetic stopped being true once a
page can reference twenty stems per rifff instead of eight.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h
EOF
)"
```

---

## Task 8: The discovered room — save twenty, dedupe on twenty, forget twenty

`listDiscoveredGroups` is the dangerous one. It powers both the duplicate check and `forget this`'s "is this copied file still needed by another group" test. Left at eight, forgetting group A deletes the copied stems 9-12 that group B still uses — a permanently uncached circle with no way back.

**Files:**
- Modify: `src/main/discoveredLibrary.ts:72-83` (`listDiscoveredGroups`), `:131` (`saveDiscoveredRifff`), `:285-299` (`forgetDiscoveredRifff`)
- Test: `src/main/discoveredLibrary.test.ts`

- [ ] **Step 1: Add the table to the fixture and write the failing tests**

In `src/main/discoveredLibrary.test.ts`, add to the imports:

```ts
import { RIFF_STEMS_EXTRA_DDL } from './riffStemsExtra'
```

and inside `freshOwnDb()`, after the existing `db.exec(...)`:

```ts
  db.exec(RIFF_STEMS_EXTRA_DDL)
```

Append these cases:

```ts
  it('saves all twelve members of a group, not the first eight', () => {
    const db = freshOwnDb()
    const members = Array.from({ length: 12 }, (_, i) => ({
      path: seedStemOnDisk(`cid_${i + 1}`),
      gain: 1,
      name: `stem ${i + 1}`,
      author: 'elling',
      barLength: 4,
      durationSec: 2
    }))
    for (let i = 1; i <= 12; i++) {
      db.prepare(`INSERT INTO Stems (StemCID, OwnerJamCID) VALUES (?, 'jam_1')`).run(`cid_${i}`)
    }

    const saved = saveDiscoveredRifff(db, [], { members, bpm: 120, barLength: 4 , creationTime: 1 })
    expect(saved).not.toBeNull()
    const groups = listDiscoveredGroups(db)
    expect(groups[0].stemCIDs).toHaveLength(12)
    db.close()
  })

  it('a twelve-stem group is a duplicate of itself, and an eight-stem prefix of it is not', () => {
    const db = freshOwnDb()
    const member = (n: number): DiscoveredMemberInput => ({
      path: seedStemOnDisk(`cid_${n}`),
      gain: 1,
      name: `stem ${n}`,
      author: 'elling',
      barLength: 4,
      durationSec: 2
    })
    for (let i = 1; i <= 12; i++) {
      db.prepare(`INSERT INTO Stems (StemCID, OwnerJamCID) VALUES (?, 'jam_1')`).run(`cid_${i}`)
    }
    const twelve = Array.from({ length: 12 }, (_, i) => member(i + 1))

    saveDiscoveredRifff(db, [], { members: twelve, bpm: 120, barLength: 4, creationTime: 1 })
    expect(
      saveDiscoveredRifff(db, [], { members: twelve, bpm: 120, barLength: 4, creationTime: 2 })
        ?.duplicate
    ).toBe(true)
    expect(
      saveDiscoveredRifff(db, [], {
        members: twelve.slice(0, 8),
        bpm: 120,
        barLength: 4,
        creationTime: 3
      })?.duplicate
    ).toBe(false)
    db.close()
  })

  it('forgetting one group never deletes a copy another group holds past its eighth slot', () => {
    const db = freshOwnDb()
    for (let i = 1; i <= 12; i++) {
      db.prepare(`INSERT INTO Stems (StemCID, OwnerJamCID) VALUES (?, 'jam_1')`).run(`cid_${i}`)
    }
    const member = (n: number): DiscoveredMemberInput => ({
      path: seedStemOnDisk(`cid_${n}`),
      gain: 1,
      name: `stem ${n}`,
      author: 'elling',
      barLength: 4,
      durationSec: 2
    })
    const a = saveDiscoveredRifff(db, [], {
      members: Array.from({ length: 12 }, (_, i) => member(i + 1)),
      bpm: 120,
      barLength: 4,
      creationTime: 1
    })
    saveDiscoveredRifff(db, [], {
      members: [member(12), member(1)],
      bpm: 120,
      barLength: 4,
      creationTime: 2
    })

    forgetDiscoveredRifff(db, a!.riffCID)
    expect(existsSync(discoveredStemPath('cid_12'))).toBe(true)
    expect(listDiscoveredGroups(db)).toHaveLength(1)
    const { n } = db
      .prepare(`SELECT COUNT(*) AS n FROM RiffStemsExtra WHERE RiffCID = ?`)
      .get(a!.riffCID) as { n: number }
    expect(n).toBe(0)
    db.close()
  })
```

Add `DiscoveredMemberInput` and `discoveredStemPath` to the file's imports if they are not already there.

- [ ] **Step 2: Run the tests and watch them fail**

Run: `npx vitest run src/main/discoveredLibrary.test.ts -t 'twelve'`
Expected: FAIL — `expected length 8 to be 12` on the first.

- [ ] **Step 3: Write the implementation**

In `src/main/discoveredLibrary.ts`, add the imports:

```ts
import { MAX_RIFFF_STEM_SLOTS, STEM_SLOT_COLUMNS, columnStemSlots, mergeStemSlots } from '@shared/riffStemSlots'
import { deleteExtraStemSlotsForRiff, readExtraStemSlots } from './riffStemsExtra'
```

and delete the local `const STEM_SLOT_COLUMNS = Array.from({ length: 8 }, …)` at `:72` — it is now the shared one, same name, same value.

Replace `listDiscoveredGroups`:

```ts
/** Every kept group in the room, as {riffCID, stemCIDs} -- TWO queries
 * over the whole room (the Riffs rows, then one batched read of every
 * slot past the eighth), never a per-riff or per-stem lookup. Both the
 * duplicate check and forget's "is this copy still needed" test read this
 * same list, and both are WRONG if it stops at eight: the duplicate check
 * would call two different twelve-stem groups the same, and forget would
 * delete a copied file that another group still holds in slot 12. At a
 * realistic few hundred saved groups it is free. */
export function listDiscoveredGroups(
  ownDb: Database.Database
): { riffCID: string; stemCIDs: string[] }[] {
  const rows = ownDb
    .prepare(
      `SELECT RiffCID, ${STEM_SLOT_COLUMNS.join(', ')} FROM Riffs WHERE OwnerJamCID = ?`
    )
    .all(DISCOVERED_JAM_CID) as Record<string, string | null>[]
  const extras = readExtraStemSlots(
    ownDb,
    rows.map((row) => row.RiffCID as string)
  )
  return rows.map((row) => {
    const riffCID = row.RiffCID as string
    return {
      riffCID,
      stemCIDs: mergeStemSlots(columnStemSlots(row), extras.get(riffCID) ?? []).map(
        (s) => s.stemCID
      )
    }
  })
}
```

In `saveDiscoveredRifff`, cap at the top of the function, replacing `if (input.members.length === 0) return null`:

```ts
  if (input.members.length === 0) return null
  // The ceiling is enforced HERE, on the database's own side of the IPC,
  // not in the renderer -- the renderer's cap being raised is what lets
  // the stems arrive; this is what guarantees nothing is ever written that
  // a reader could not read back. In practice the renderer already stops
  // at the same number, so this only ever fires if the two drift.
  const members = input.members.slice(0, MAX_RIFFF_STEM_SLOTS)
  if (members.length < input.members.length) {
    console.warn(
      `saveDiscoveredRifff: ${input.members.length} members offered, ` +
        `keeping the first ${MAX_RIFFF_STEM_SLOTS}`
    )
  }
```

and change the two later uses of `input.members` (the `resolved` map at `:131` and nothing else) to `members`. Update the function's own "Eight point lookups" comment to *"Up to twenty point lookups"*.

In `forgetDiscoveredRifff`, add the side-row delete inside its existing transaction, **before** the `Riffs` delete for symmetry with `deleteJamRows` (order does not matter here — this one deletes by riffCID, not through a subselect on Riffs — but keeping the same order in both makes them read the same):

```ts
  ownDb.transaction(() => {
    deleteExtraStemSlotsForRiff(ownDb, riffCID)
    ownDb
      .prepare(`DELETE FROM Riffs WHERE RiffCID = ? AND OwnerJamCID = ?`)
      .run(riffCID, DISCOVERED_JAM_CID)
    ownDb.prepare(`DELETE FROM Tags WHERE RiffCID = ?`).run(riffCID)
  })()
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `npx vitest run src/main/discoveredLibrary.test.ts`
Expected: PASS, whole file.

- [ ] **Step 5: Commit**

```bash
git add src/main/discoveredLibrary.ts src/main/discoveredLibrary.test.ts
git commit -m "$(cat <<'EOF'
the discovered room keeps, dedupes and forgets on all twenty stems

the group listing stopping at eight was the dangerous one: forgetting one
group would have deleted a copied stem another group still held in slot
twelve. main also caps a save at the ceiling, since that is the side of
the ipc that owns the database.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h
EOF
)"
```

---

## Task 9: The three full-table scans

A stem that only ever appears in slot 9+ would otherwise have no features, no peaks, no auto-category, and would be invisible to Discover's own rolls — so a stem he found through Discover could never come back around.

Each of these walks **all** of `Riffs` in pages. Each reads the side table **once per database connection** and holds the map. Not per page, not per riff.

**Files:**
- Modify: `src/main/scanTargetCache.ts:104-127` (`slotsOf`, `collectRiff`), `:243-280` (`rebuild`), `:284-340` (`extend`)
- Modify: `src/main/discoverCandidates.ts:425-485` (`buildRiffIndex`)
- Modify: `src/main/discoverLibraryStems.ts:145-192` (the per-db walk)
- Test: `src/main/scanTargetCache.test.ts`, `src/main/discoverCandidates.test.ts`, `src/main/discoverLibraryStems.test.ts`

- [ ] **Step 1: Write the failing tests**

Add `import { RIFF_STEMS_EXTRA_DDL } from './riffStemsExtra'` and `db.exec(RIFF_STEMS_EXTRA_DDL)` to each file's own fixture-db helper, then one case per file.

`src/main/scanTargetCache.test.ts`:

```ts
  it('records a stem that only appears past the eighth slot', async () => {
    const { sourceDb, ownDb } = freshDbs()
    sourceDb.exec(RIFF_STEMS_EXTRA_DDL)
    sourceDb
      .prepare(`INSERT INTO Riffs (RiffCID, OwnerJamCID, StemCID_1) VALUES ('r1', 'jam_1', 'a')`)
      .run()
    sourceDb.prepare(`INSERT INTO RiffStemsExtra VALUES ('r1', 9, 'only_extra')`).run()

    const pairs = await getCachedStemJamPairs(ownDb, sourceDb)
    expect(pairs.map((p) => p.stemCID).sort()).toEqual(['a', 'only_extra'])
  })
```

`src/main/discoverCandidates.test.ts`:

```ts
  it('indexes a stem that only appears past the eighth slot', async () => {
    const db = freshDb()
    db.exec(RIFF_STEMS_EXTRA_DDL)
    db.prepare(
      `INSERT INTO Riffs (RiffCID, OwnerJamCID, BPMrnd, CreationTime, StemCID_1)
       VALUES ('r1', 'jam_1', 120, 100, 'a')`
    ).run()
    db.prepare(`INSERT INTO RiffStemsExtra VALUES ('r1', 9, 'only_extra')`).run()

    const index = await getRiffIndexForDb(db)
    expect(index.has('only_extra')).toBe(true)
  })
```

`src/main/discoverLibraryStems.test.ts`:

```ts
  it('lists a stem that only appears past the eighth slot as a scan target', async () => {
    const db = freshDb()
    db.exec(RIFF_STEMS_EXTRA_DDL)
    db.prepare(
      `INSERT INTO Riffs (RiffCID, OwnerJamCID, StemCID_1) VALUES ('r1', 'jam_1', 'a')`
    ).run()
    db.prepare(`INSERT INTO RiffStemsExtra VALUES ('r1', 9, 'only_extra')`).run()

    const targets = await listLibraryScanTargets([{ jamCID: 'jam_1', dbForJam: db }], () => true)
    expect(targets.map((t) => t.key).sort()).toEqual(['a', 'only_extra'])
  })
```

Match each file's own existing fixture-helper names and imports — they differ between the three; read the top of each file before writing.

- [ ] **Step 2: Run the tests and watch them fail**

Run: `npx vitest run src/main/scanTargetCache.test.ts src/main/discoverCandidates.test.ts src/main/discoverLibraryStems.test.ts -t 'past the eighth'`
Expected: FAIL on all three — the extra stem is missing.

- [ ] **Step 3: `scanTargetCache.ts`**

Add the imports:

```ts
import { columnStemSlots, mergeStemSlots, type StemSlotRef } from '@shared/riffStemSlots'
import { readAllExtraStemSlots } from './riffStemsExtra'
```

Replace `slotsOf` and thread the map through `collectRiff`:

```ts
function slotsOf(riff: RiffRow, extras: Map<string, StemSlotRef[]>): StemSlotRef[] {
  return mergeStemSlots(
    columnStemSlots(riff as unknown as Record<string, unknown>),
    extras.get(riff.RiffCID) ?? []
  )
}

function collectRiff(
  riff: RiffRow,
  pairs: Map<string, PairEntry>,
  extras: Map<string, StemSlotRef[]>
): boolean {
  const slots = slotsOf(riff, extras)
  // …body unchanged…
}
```

In **both** `rebuild` and `extend`, add one line before their page loops and pass it to all three `collectRiff` call sites (`:261`, `:306`, `:325`):

```ts
  // ONCE per source db, held for the whole walk. Not per page and never
  // per riff -- jams share one database. Free for an external archive,
  // which has no such table, and small for sssketch's own, where only a
  // rifff with more than eight stems has any rows at all.
  const extras = readAllExtraStemSlots(sourceDb)
```

The incremental `extend` needs no second change signal: extra rows are only ever written alongside a **brand-new** `Riffs` row (`saveDiscoveredRifff` always mints a fresh riffCID and never upserts an existing group), which moves the `rowid` watermark this function already tracks.

- [ ] **Step 4: `discoverCandidates.ts`**

Same two imports. In `buildRiffIndex`, add the once-per-db read immediately after the `signal` guard and before the page loop:

```ts
  const extras = readAllExtraStemSlots(db)
```

and replace the inner slot loop:

```ts
    for (const riff of page) {
      for (const { stemCID } of mergeStemSlots(
        columnStemSlots(riff as unknown as Record<string, unknown>),
        extras.get(riff.RiffCID) ?? []
      )) {
        if (index.has(stemCID)) continue
        index.set(stemCID, {
          riffCID: riff.RiffCID,
          ownerJamCID: riff.OwnerJamCID,
          bpmRnd: riff.BPMrnd,
          creationTime: riff.CreationTime
        })
      }
      sinceYield += 1
      if (sinceYield >= CLASSIFY_YIELD_EVERY) {
        sinceYield = 0
        await yieldToEventLoop()
      }
    }
```

`readAllExtraStemSlots` uses `.all()`, so nothing here holds an open cursor across the `await`.

Then, still in `discoverCandidates.ts`, fix the **second** eight in this file — `getRandomLibraryCandidate`'s "which riff contains this stem" lookup at `:1896-1903`, an eight-way `StemCID_N = ?` `OR` chain bound with `...Array<string>(8).fill(stemRow.StemCID)`. No match means `continue`, so a stem living only in slot 9+ of a kept group would be skipped every single time it came up as a random candidate — silently, and only for his own kept material. Replace that statement with:

```ts
      // The side table is part of the answer to "which riff contains this
      // stem", not an afterthought -- a kept group's twelfth stem is in no
      // column at all. Built conditionally because an external
      // OUROVEON/LORE archive has no such table.
      const extraClause = hasExtraStemSlotsTable(db)
        ? ` OR RiffCID IN (SELECT RiffCID FROM RiffStemsExtra WHERE StemCID = ?)`
        : ''
      const slotParams = Array<string>(extraClause ? 9 : 8).fill(stemRow.StemCID)
      riffRow = db
        .prepare(
          `SELECT RiffCID, BPMrnd, CreationTime FROM Riffs WHERE OwnerJamCID = ? AND (
             StemCID_1 = ? OR StemCID_2 = ? OR StemCID_3 = ? OR StemCID_4 = ? OR
             StemCID_5 = ? OR StemCID_6 = ? OR StemCID_7 = ? OR StemCID_8 = ?${extraClause}
           ) LIMIT 1`
        )
        .get(stemRow.OwnerJamCID, ...slotParams) as typeof riffRow
```

and add `hasExtraStemSlotsTable` to this file's `./riffStemsExtra` import.

- [ ] **Step 5: `discoverLibraryStems.ts`**

Same two imports. Inside `for (const [db, allowedJamCIDs] of jamCIDsByDb)`, immediately after the cached-pairs `continue` and before `countWork('sql:scan-targets.walk')`:

```ts
    const extras = readAllExtraStemSlots(db)
```

and replace the inner slot loop:

```ts
      for (const riff of page) {
        if (!allowedJamCIDs.has(riff.OwnerJamCID)) continue
        for (const { stemCID } of mergeStemSlots(
          columnStemSlots(riff as unknown as Record<string, unknown>),
          extras.get(riff.RiffCID) ?? []
        )) {
          if (consider(stemCID, riff.OwnerJamCID)) await yieldToEventLoop()
        }
      }
```

- [ ] **Step 6: Run the tests and watch them pass**

Run: `npx vitest run src/main/scanTargetCache.test.ts src/main/discoverCandidates.test.ts src/main/discoverLibraryStems.test.ts`
Expected: PASS, all three files.

- [ ] **Step 7: Commit**

```bash
git add src/main/scanTargetCache.ts src/main/scanTargetCache.test.ts src/main/discoverCandidates.ts src/main/discoverCandidates.test.ts src/main/discoverLibraryStems.ts src/main/discoverLibraryStems.test.ts
git commit -m "$(cat <<'EOF'
the three library-wide walks see a stem that only lives past the eighth slot

each reads the side table once per database connection and holds it, never
per page and never per riff, because jams share one database. without this
a stem found through discover would have no analysis and could never come
back around in a roll.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h
EOF
)"
```

---

## Task 10: Retire the assembly eight and the seed eight

This is the change that actually makes `keep` save twelve — everything before it widened the database, and the renderer was still cutting the stack down before the IPC.

**Files:**
- Modify: `src/renderer/src/audio/discoverRifffAssembly.ts:28-36, 63-70, 94`
- Modify: `src/renderer/src/audio/discoverSeed.ts:27-34`
- Test: `src/renderer/src/audio/discoverRifffAssembly.test.ts`

**Do not touch `src/renderer/src/components/DiscoverPanel.tsx`.** `resolveDiscoverRifff()` calls `assembleDiscoverRifff(name, placed, bpm)` with no `maxMembers`, so raising the default is all `keepGroup` needs — and another agent is editing that file right now.

- [ ] **Step 1: Write the failing test**

Append to `src/renderer/src/audio/discoverRifffAssembly.test.ts`:

```ts
  it('assembles twelve members by default, because a rifff now holds twenty', () => {
    const members = Array.from({ length: 12 }, (_, i) => ({
      stem: {
        author: 'elling',
        name: `stem ${i + 1}`,
        type: 'fx' as const,
        path: `/tmp/stem_${i + 1}`,
        durationSec: 2,
        barLength: 4
      },
      gain: 1
    }))
    const assembly = assembleDiscoverRifff('discover preview', members, 120)
    expect(assembly?.rifff.stems.map((s) => s.slot)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12
    ])
  })

  it('still stops at the ceiling, so nothing is assembled that could not be persisted', () => {
    const members = Array.from({ length: 25 }, (_, i) => ({
      stem: {
        author: 'elling',
        name: `stem ${i + 1}`,
        type: 'fx' as const,
        path: `/tmp/stem_${i + 1}`,
        durationSec: 2,
        barLength: 4
      },
      gain: 1
    }))
    expect(assembleDiscoverRifff('discover preview', members, 120)?.rifff.stems).toHaveLength(20)
  })
```

Check the existing test at `:86` (`assembleDiscoverRifff('discover preview', members, 120, 32)`) and any case that asserts a cap of 8 — if one asserts the **default** truncates at 8, update it to 20; if it passes an explicit `maxMembers`, leave it alone.

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx vitest run src/renderer/src/audio/discoverRifffAssembly.test.ts -t 'twelve members by default'`
Expected: FAIL — `expected [1,…,8] to deeply equal [1,…,12]`.

- [ ] **Step 3: Raise the assembly eight**

In `src/renderer/src/audio/discoverRifffAssembly.ts`, add the import:

```ts
import { MAX_RIFFF_STEM_SLOTS } from '@shared/riffStemSlots'
```

Replace the constant and its comment at `:28-36`:

```ts
// The persisted ceiling on one rifff: 20. Riffs.StemCID_1..8 addresses the
// first eight and the RiffStemsExtra side table addresses slots 9-20 (see
// src/main/riffStemsExtra.ts) -- so this caps at the most a Rifff could
// actually be written to the library as, rather than silently producing
// one no part of this codebase's own storage could represent.
//
// This was 8 until 2026-09-27, and its being 8 is what capped a kept
// Discover group at eight stems no matter how many slots were on screen:
// resolveDiscoverRifff (DiscoverPanel.tsx) takes this default, and `keep`
// shares that helper with `add to shelf` and `add to timeline`. The number
// lives in @shared/riffStemSlots now precisely so there is one place to
// change and one place to read -- do not reintroduce a local literal.
```

and at `:94`, the default becomes:

```ts
  maxMembers: number = MAX_RIFFF_STEM_SLOTS,
```

Update the doc comment's `` `maxMembers` defaults to MAX_STEMS_PER_RIFFF (8) `` sentence to say 20 and keep the rest of that paragraph, including the 2026-09-16 preview-sync bug it records — that bug is still the reason `syncPreviewToEngine` passes an explicit higher value, and a preview genuinely has no storage ceiling at all.

- [ ] **Step 4: Raise the seed eight**

In `src/renderer/src/audio/discoverSeed.ts`, add the same import and replace `:27-34`:

```ts
// Seeding must be able to reproduce anything `keep` could have saved --
// otherwise seeding Discover from a kept twelve-stem group silently
// returns eight slots, and "seed discover with this" stops round-tripping.
// Same single ceiling as discoverRifffAssembly.ts's own maxMembers default
// (@shared/riffStemSlots), for the same reason: one number, one place.
const MAX_SEED_SLOTS = MAX_RIFFF_STEM_SLOTS
```

- [ ] **Step 5: Run the tests and watch them pass**

Run: `npx vitest run src/renderer/src/audio/`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/audio/discoverRifffAssembly.ts src/renderer/src/audio/discoverRifffAssembly.test.ts src/renderer/src/audio/discoverSeed.ts
git commit -m "$(cat <<'EOF'
keep saves the whole stack, because the renderer stops cutting it at eight

resolvediscoverrifff takes assemblediscoverrifff's default maxmembers, so
that default was doing the truncating long before main ever saw a ninth
stem. seeding rises with it, or a kept twelve would come back as eight.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h
EOF
)"
```

---

## Task 11: Verify the whole thing, and say honestly what was not verified

**Files:** none.

- [ ] **Step 1: Full suite**

Run: `npm test`
Expected: all files pass. Count: 195 files (193 + `riffStemSlots.test.ts` + `riffStemsExtra.test.ts`), and roughly 3000 tests. **Zero failures.** A non-zero exit with no named failure means a worker died — check the exclusion list first.

- [ ] **Step 2: The CI shape of the suite**

Run: `CI=1 npm test`
Expected: passes, with a file count **lower** than the local one by exactly the number of excluded files. `src/main/riffStemsExtra.test.ts` must be among the skipped. `src/shared/riffStemSlots.test.ts` must still run — it is pure and must not be excluded.

- [ ] **Step 3: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: 0 type errors, 0 lint errors, exactly the same **4** prettier warnings written down in Task 0, in the same files.

- [ ] **Step 4: Confirm nothing reached the native engine or the concurrent agent's files**

Run: `git diff --name-only 3d0515f..HEAD`
Expected: no path under `native-engine/`, and none of `src/main/remotePage.ts`, `src/main/remotePage.test.ts`, `src/renderer/src/components/DiscoverPanel.tsx`, `src/shared/buildRifff.ts`, `src/shared/buildEngineProject.ts`. If any appears, something went wrong — stop and report it.

- [ ] **Step 5: Report what cannot be verified here**

Write this into the completion report verbatim rather than claiming coverage. This environment has no GUI, no audio and no way to open the app, so **every one of these is Elling's alone:**

- that `keep` on a real twelve-stack saves twelve, and the kept circle's hover reads `12 stems`
- that importing that group to the shelf brings back all twelve with the gains he set
- that `seed discover with this` on a twenty-stem group returns twenty slots
- whether a twenty-row group in the arranger is usable or just tall
- that exporting it to Ableton and to REAPER produces twenty tracks that play
- **that a real external LORE `warehouse.db3` still browses identically.** That is the whole compatibility promise of this design and it can only be checked against his own archive

Nothing in a build log covers any of those. Say so.
