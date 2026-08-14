# Riff Library Rename + Relocation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename every sssketch-owned "lore"/"Lore"/"LORE" identifier, file, IPC channel, and
on-disk path to a "riff library" naming scheme (dropping any implication that sssketch's own
self-built riff-sync database is, or is affiliated with, the real third-party LORE app); relocate
both the project library and the riff library from their current defaults to visible sibling
folders under `~/Music/sssketch/`; migrate any existing user data at the old defaults; fix
`friendlyRiffName`'s hardcoded mislabeling bug; and correct `docs/USER_GUIDE.md`'s stale LORE
section.

**Architecture:** A mechanical, dependency-ordered rename sweep across ~30 files (shared types
first, since everything else imports from them; then the four main-process
`loreWarehouse*.ts` files in their own import order; then the IPC layer, touched in one
main+preload commit; then renderer call sites), followed by two new one-time startup migrations
(following the exact `stemCacheMigration.ts`/`riffFavouritesMigration.ts` precedent) and two doc
corrections. No behavior change to sync/download/playback logic anywhere in this plan — pure
rename, relocation, migration, one real bug fix (`friendlyRiffName`), and two doc rewrites.

**Tech Stack:** TypeScript (Electron main + preload + renderer), Vitest, better-sqlite3. No new
dependencies.

**Scope note.** Every task below keeps the working tree typechecking after its own commit — file
renames are grouped with every consumer's import-path/identifier update needed to keep them
compiling, per this project's own established precedent for exactly this kind of change (see
`docs/superpowers/plans/2026-08-09-lore-warehouse-old-code-cleanup.md`'s own "same task/commit to
avoid a broken intermediate state" note for IPC renames — the same principle applies here to file
renames with multiple importers).

**Design decisions made while writing this plan** (not fully pinned down by the design doc — see
this plan's own final report for the short version):
- Exact new prefs filename: `riffLibraryPrefs.json` (was `loreWarehousePrefs.json`).
- Exact new `friendlyRiffName` suffix: `'library'` (also becomes the new default value, replacing
  `'lore'`).
- `localStorage['sssketch:loreUsername']` migration mechanism: renderer-side, one-time,
  read-old-key/write-new-key/delete-old-key, folded directly into `LibraryBrowser.tsx`'s existing
  `loadStoredLoreUsername` (renamed `loadStoredRiffLibraryUsername`) rather than a separate file —
  it's the only reader/writer of that key.
- Old-directory cleanup after migration: the riff library's old `<userData>/lore-warehouse/`
  directory is removed as a natural side effect of a whole-directory `renameSync` (nothing left
  behind to separately clean up). The project library's old `~/Music/sssketch/` directory is
  deliberately **left in place** — it becomes the shared parent of the new `projects/` and
  `library/` siblings, not an orphan.
- A new IPC channel (`riff-library-is-own` / preload `riffLibraryIsOwn()`), not present in the
  original 13-channel audit, is added specifically to give `LibraryBrowser.tsx` the real signal
  `friendlyRiffName`'s bug fix (item 5) needs — see Task 9's own rationale.
- A handful of files with comment-only, historical mentions of the already-deleted
  `LoreLibraryBrowser.tsx` component (or generic "LORE" mentions describing real external-file
  provenance) are explicitly left untouched — see this plan's own final report for the full list
  and reasoning.

---

### Task 1: Rename `src/shared/loreLibrary.ts` → `riffLibraryTypes.ts` (+ every consumer's import)

**Files:**
- Rename: `src/shared/loreLibrary.ts` → `src/shared/riffLibraryTypes.ts`
- Rename: `src/shared/loreLibrary.test.ts` → `src/shared/riffLibraryTypes.test.ts`
- Modify: `src/main/loreWarehouse.ts`
- Modify: `src/main/loreWarehouse.test.ts`
- Modify: `src/main/loreWarehouseWriter.ts`
- Modify: `src/main/loreWarehouseWriter.test.ts`
- Modify: `src/main/endlesssApi.ts`
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/src/audio/importResolvedRiff.ts`
- Modify: `src/renderer/src/components/LibraryBrowser.tsx`

This is the widest-fanout file in the whole rename (7 other files import from it), so every
consumer's import path + type-name usage must land in this same commit or the tree won't
typecheck. This task touches ONLY the shared-type identifiers below in each consumer — no other
identifier in any consumer file changes here (their own internal renames are later, dedicated
tasks).

- [ ] **Step 1: Move the file and rename every identifier inside it**

```bash
git mv src/shared/loreLibrary.ts src/shared/riffLibraryTypes.ts
git mv src/shared/loreLibrary.test.ts src/shared/riffLibraryTypes.test.ts
```

In `src/shared/riffLibraryTypes.ts`, apply these renames (every occurrence, including inside doc
comments that name the identifier itself):
- `LORE_USERNAME` → `RIFF_LIBRARY_USERNAME`
- `LoreJam` → `RiffLibraryJam`
- `LoreRiffSummary` → `RiffLibraryRiffSummary`
- `LoreResolvedStem` → `RiffLibraryResolvedStem`
- `LoreResolvedRiff` → `RiffLibraryResolvedRiff`
- `LORE_ROOT_NAMES` → `RIFF_LIBRARY_ROOT_NAMES`
- `LORE_SCALE_NAMES` → `RIFF_LIBRARY_SCALE_NAMES`

`RiffFilters`, `RiffPage`, `instrumentMaskToSoundType`, `stemDownloadUrl`,
`computeOwnerFraction`, `resolveKeyName` are untouched (no "lore" in their names).

The file's own top doc comment (currently: `/** Default LORE username, used only as the initial
value of the user-editable "your username" setting in LoreLibraryBrowser (persisted to
localStorage from there) and as computeOwnerFraction's own fallback default below. Not a hardcoded
identity any more — other people testing this app set their own in the LORE library browser's
filter bar. */`) becomes:

```typescript
/** Default riff-library username, used only as the initial value of the
 * user-editable "your username" setting in LibraryBrowser (persisted to
 * localStorage from there) and as computeOwnerFraction's own fallback
 * default below. Not a hardcoded identity any more — other people testing
 * this app set their own in the riff library browser's filter bar. */
export const RIFF_LIBRARY_USERNAME = 'elling'
```

The `ownerFraction` field's own doc comment on `LoreRiffSummary` (now `RiffLibraryRiffSummary`)
currently reads `// 0-1, fraction of populated slots created by LORE_USERNAME` → becomes
`// 0-1, fraction of populated slots created by RIFF_LIBRARY_USERNAME`.

The two big root/scale-name comment blocks (currently starting `// Traced directly from
OUROVEON's own source (endlesss/core.constants.h, cRootNames), not guessed...` and `// Traced
directly from OUROVEON's own source (endlesss/core.constants.h, cScaleNames), not guessed.`) are
Bucket-B-flavored (explaining real OUROVEON/LORE provenance of the *data*, not naming a Bucket-A
identifier) — leave their prose as-is, just rename the constant declarations themselves:

```typescript
export const RIFF_LIBRARY_ROOT_NAMES = [
  'C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'
] as const
```
```typescript
export const RIFF_LIBRARY_SCALE_NAMES = [
  'Major (Ionian)', 'Dorian', 'Phrygian', 'Lydian', 'Mixolydian', 'Minor (Aeolian)',
  'Locrian', 'Minor Pentatonic', 'Major Pentatonic', 'Suspended Pent.',
  'Blues Minor Pent.', 'Blues Major Pent.', 'Harmonic Minor', 'Melodic Minor',
  'Double Harmonic', 'Blues', 'Whole Tone', 'Chromatic'
] as const
```

- [ ] **Step 2: Rename the same identifiers in `riffLibraryTypes.test.ts`**

Update the import statement and every reference:
```typescript
import {
  instrumentMaskToSoundType,
  computeOwnerFraction,
  stemDownloadUrl,
  resolveKeyName,
  RIFF_LIBRARY_USERNAME
} from './riffLibraryTypes'
```
Every `LORE_USERNAME` usage in the test bodies (the `computeOwnerFraction` describe block) becomes
`RIFF_LIBRARY_USERNAME`. No other test content changes — same assertions, same values.

- [ ] **Step 3: Update `src/main/loreWarehouse.ts`'s import**

```typescript
import type {
  RiffLibraryJam,
  RiffLibraryRiffSummary,
  RiffLibraryResolvedRiff,
  RiffLibraryResolvedStem,
  RiffFilters,
  RiffPage
} from '@shared/riffLibraryTypes'
import { computeOwnerFraction, stemDownloadUrl, resolveKeyName } from '@shared/riffLibraryTypes'
```
Then, throughout the rest of the file, replace every use of `LoreJam` → `RiffLibraryJam`,
`LoreRiffSummary` → `RiffLibraryRiffSummary`, `LoreResolvedRiff` → `RiffLibraryResolvedRiff`,
`LoreResolvedStem` → `RiffLibraryResolvedStem` as TYPE ANNOTATIONS (function return types,
`interface FullRiffRow`-adjacent usages are untouched since those are the file's OWN row types,
not the shared ones) — concretely: `listJams(...): LoreJam[]` → `: RiffLibraryJam[]`,
`LoreRiffSummary[]` in `listRiffs`'s summaries array, `resolveRiff(...): LoreResolvedRiff | null`,
the `stems: LoreResolvedStem[]` local in `resolveRiff`, and `downloadMissingStems(...):
Promise<LoreResolvedRiff | null>`.

- [ ] **Step 4: Update `src/main/loreWarehouse.test.ts`'s import**

```typescript
import { stemDownloadUrl } from '@shared/riffLibraryTypes'
```
(Only the import path changes — this test file imports the plain function, not any `Lore*` type
name, so nothing else here needs touching.)

- [ ] **Step 5: Update `src/main/loreWarehouseWriter.ts`'s import and one usage**

```typescript
import type { RiffLibraryResolvedRiff } from '@shared/riffLibraryTypes'
```
And in `writeRiffDetail`'s signature: `resolved: RiffLibraryResolvedRiff` (was `resolved:
LoreResolvedRiff`).

- [ ] **Step 6: Update `src/main/loreWarehouseWriter.test.ts`'s import and fixture type**

```typescript
import type { RiffLibraryResolvedRiff } from '@shared/riffLibraryTypes'
```
And `resolvedRiffFixture`'s own signature: `function resolvedRiffFixture(overrides:
Partial<RiffLibraryResolvedRiff> = {}): RiffLibraryResolvedRiff`.

- [ ] **Step 7: Update `src/main/endlesssApi.ts`'s import and every type usage**

Replace the import block (lines 4-12):
```typescript
import type {
  RiffLibraryJam,
  RiffLibraryResolvedRiff,
  RiffLibraryResolvedStem,
  RiffLibraryRiffSummary,
  RiffFilters,
  RiffPage
} from '@shared/riffLibraryTypes'
import { computeOwnerFraction, resolveKeyName, stemDownloadUrl } from '@shared/riffLibraryTypes'
```
Then apply four `replace_all` passes across the rest of the file (these are the ONLY identifier
changes in this file — every other "LORE"/"OUROVEON" mention is Bucket-B prose describing real
external-LORE-app file quirks, e.g. "no LORE login needed", "mirroring downloadMissingStems'
existing LORE-path contract exactly" — leave every one of those untouched):
- `LoreResolvedStem` → `RiffLibraryResolvedStem` (in `buildResolvedStem`'s return type,
  `buildResolvedRiff`'s local `stems: LoreResolvedStem[]`)
- `LoreResolvedRiff` → `RiffLibraryResolvedRiff` (in `buildResolvedRiff`'s return type,
  `summarizeResolvedRiff`'s `resolved` param, `downloadMissingStemsFor`'s param/return,
  `sharedFeedCache`'s `Map<string, ...>` type argument (both declaration and the two `new Map`
  constructions in `peekSharedFeedCache`/`listSharedFeed`), `resolveJamRiff`'s return type)
- `LoreRiffSummary` → `RiffLibraryRiffSummary` (in `summarizeResolvedRiff`'s return type,
  `listSharedFeed`'s local `summaries: LoreRiffSummary[]`, `listRiffsInJam`'s local `riffs:
  LoreRiffSummary[]`)
- `LoreJam` → `RiffLibraryJam` (in `listJams`'s return type `Promise<LoreJam[]>`)

- [ ] **Step 8: Update `src/main/index.ts`'s `RiffFilters` import**

```typescript
import type { RiffFilters } from '@shared/riffLibraryTypes'
```
(`RiffFilters` itself is unrenamed — only the import path changes here. The `loreWarehouse`/
`loreWarehouseSync`/`loreWarehouseSchema`/`loreWarehouseWriter` imports a few lines below are
untouched by this task — those are Tasks 2-5.)

- [ ] **Step 9: Update `src/preload/index.ts`'s import and every type usage**

```typescript
import type { RiffLibraryJam, RiffLibraryRiffSummary, RiffLibraryResolvedRiff } from '@shared/riffLibraryTypes'
```
Then update the six type-annotation usages (the bridge METHOD NAMES like `loreListJams` stay as-is
for now — that's Task 7):
- `loreListJams: (filterText: string): Promise<RiffLibraryJam[]> => ...`
- `loreListRiffs: (...): Promise<{ riffs: RiffLibraryRiffSummary[]; hasMore: boolean; nextOffset: number }> => ...`
- `loreResolveRiff: (riffCID: string): Promise<RiffLibraryResolvedRiff | null> => ...`
- `loreDownloadMissingStems: (riffCID: string): Promise<RiffLibraryResolvedRiff | null> => ...`
- `endlesssListJams: (): Promise<RiffLibraryJam[]> => ipcRenderer.invoke('endlesss-list-jams'),`

- [ ] **Step 10: Update `src/renderer/src/audio/importResolvedRiff.ts`'s import and two usages**

```typescript
import type { RiffLibraryResolvedRiff } from '@shared/riffLibraryTypes'
```
And in `buildImportedRifff`'s signature: `resolved: RiffLibraryResolvedRiff` (the `sourceLabel`
param's own type is touched separately in Task 8, not here).

- [ ] **Step 11: Update `src/renderer/src/components/LibraryBrowser.tsx`'s shared-type import and usages**

Replace the two import lines at the top of the file:
```typescript
import type { RiffLibraryJam, RiffLibraryResolvedRiff, RiffLibraryRiffSummary, RiffFilters } from '@shared/riffLibraryTypes'
import {
  instrumentMaskToSoundType,
  RIFF_LIBRARY_USERNAME,
  RIFF_LIBRARY_ROOT_NAMES,
  RIFF_LIBRARY_SCALE_NAMES
} from '@shared/riffLibraryTypes'
```
Then, ONLY the shared-type usages (not this component's own `loreUsername`/
`LORE_USERNAME_STORAGE_KEY`/`loadStoredLoreUsername` identifiers, which are Task 9):
- Every `LoreRiffSummary` type annotation → `RiffLibraryRiffSummary` (in `RiffTempoGroup.riffs`,
  `groupRiffsByDateAndTempo`'s param/local, the `riffs`/`setRiffs` state declaration)
- Every `LoreJam` type annotation → `RiffLibraryJam` (`syncedJams`/`setSyncedJams`,
  `membershipJams`/`setMembershipJams`, `ownJam`/`setOwnJam`, the `sharedFeedEntry: LoreJam`
  local, the three `Map`/array locals in `visibleJams`'s `useMemo`: `byId`, and `sidebarJams`'s
  `syncing`/`pinned`/`rest`)
- Every `LoreResolvedRiff` type annotation → `RiffLibraryResolvedRiff` (`resolvedRiff`/
  `setResolvedRiff` state, `patchRiffCacheCount`'s param, `ensureStemsDownloaded`'s param/return,
  `backgroundDownload`'s local, `tryStartPreview`'s param, `importResolvedRiff`'s `resolved` param
  and `buildImportedRifff` call site's own generic inference)
- `RIFF_LIBRARY_ROOT_NAMES.map(...)` in the key-filter `<select>` (was `LORE_ROOT_NAMES.map`)
- `RIFF_LIBRARY_SCALE_NAMES.map(...)` in the scale-filter `<select>` (was `LORE_SCALE_NAMES.map`)
- The fallback default inside `loadStoredLoreUsername` (function itself not yet renamed):
  `return localStorage.getItem(LORE_USERNAME_STORAGE_KEY) ?? RIFF_LIBRARY_USERNAME` and its
  `catch` branch's `return RIFF_LIBRARY_USERNAME` (the storage-key constant name and the function
  name stay `LORE_USERNAME_STORAGE_KEY`/`loadStoredLoreUsername` until Task 9 — only the two
  `RIFF_LIBRARY_USERNAME` fallback VALUES change here, since that identifier is what Task 1 owns).

- [ ] **Step 12: Typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 13: Run the affected test suites**

Run: `npx vitest run src/shared/riffLibraryTypes.test.ts src/main/loreWarehouse.test.ts src/main/loreWarehouseWriter.test.ts src/main/endlesssApi.test.ts`
Expected: all pass, same count as before (pure rename, no behavior change)

- [ ] **Step 14: Lint**

Run: `npm run lint`
Expected: no errors

- [ ] **Step 15: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
Rename shared/loreLibrary.ts to riffLibraryTypes.ts

sssketch's own self-built riff-sync database schema types get their own
identity, dropping every "Lore"/"LORE" identifier -- LoreJam ->
RiffLibraryJam, LoreRiffSummary -> RiffLibraryRiffSummary, LoreResolvedRiff
-> RiffLibraryResolvedRiff, LoreResolvedStem -> RiffLibraryResolvedStem,
LORE_USERNAME -> RIFF_LIBRARY_USERNAME, LORE_ROOT_NAMES ->
RIFF_LIBRARY_ROOT_NAMES, LORE_SCALE_NAMES -> RIFF_LIBRARY_SCALE_NAMES. Every
consumer's import path and type usage updated in this same commit to keep
the tree compiling. First of several sequential rename tasks -- see
docs/superpowers/plans/2026-08-14-riff-library-rename-implementation.md.
EOF
)"
```

---

### Task 2: Rename `src/main/loreWarehouseSchema.ts` → `riffLibrarySchema.ts` (+ relocate)

**Files:**
- Rename: `src/main/loreWarehouseSchema.ts` → `src/main/riffLibrarySchema.ts`
- Rename: `src/main/loreWarehouseSchema.test.ts` → `src/main/riffLibrarySchema.test.ts`
- Modify: `src/main/loreWarehouse.ts`
- Modify: `src/main/loreWarehouse.test.ts`
- Modify: `src/main/loreWarehouseSync.ts`
- Modify: `src/main/index.ts`

This is the rename+relocation task for item 2's riff-library half — `ownWarehouseRoot()` moves
from hidden `<userData>/lore-warehouse/` to visible `~/Music/sssketch/library/` in the SAME step
it's renamed, per the design doc's own instruction.

- [ ] **Step 1: Move the file and rewrite it**

```bash
git mv src/main/loreWarehouseSchema.ts src/main/riffLibrarySchema.ts
```

Replace the whole file with:

```typescript
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app } from 'electron'
import Database from 'better-sqlite3'

/** sssketch's own self-built riff-sync database -- distinct from any
 * externally-pointed OUROVEON/LORE archive a user might separately
 * configure via the settings menu's "change riff archive location…" folder
 * picker (see riffLibraryStore.ts). Lives under the same cache/common/
 * sub-path convention riffLibraryStore.ts's own riffLibraryDbPath()/
 * resolveStemPath() already expect from a real LORE-synced folder, so a
 * reader pointed at either root needs zero changes to riffLibraryStore.ts's
 * path logic -- only which root it's given. Lives at a visible,
 * human-findable location (~/Music/sssketch/library/, a sibling of the
 * project library's own ~/Music/sssketch/projects/) rather than hidden
 * inside Application Support -- see docs/superpowers/specs/
 * 2026-08-14-riff-library-rename-design.md §2. Existing users with real
 * content still sitting at the old hidden location are handled by
 * riffLibraryMigration.ts, wired into app startup. */
export function ownRiffLibraryRoot(): string {
  return join(app.getPath('music'), 'sssketch', 'library')
}

export function ownRiffLibraryDbPath(): string {
  return join(ownRiffLibraryRoot(), 'cache', 'common', 'warehouse.db3')
}

// Schema matches what riffLibraryStore.ts's own SELECT queries already read
// from a real OUROVEON-built warehouse (RiffRow/FullRiffRow/FullStemRow in
// riffLibraryStore.ts, cross-checked against riffLibraryStore.test.ts's own
// fixture table DDL) -- Length16s (not BarLength) is the column
// riffLibraryStore.ts's resolveRiff actually selects for a stem's own loop
// length; BarLength for Stems is real-OUROVEON-schema cruft
// riffLibraryStore.ts itself never reads, so it's omitted here rather than
// carried for no reason. AppVersion (Riffs) and SyncComplete (Jams) are new
// columns riffLibraryStore.ts never reads -- purely this sync engine's own
// resumability state, safe to add.
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS Jams (
  JamCID TEXT PRIMARY KEY,
  PublicName TEXT NOT NULL,
  SyncComplete INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS Riffs (
  RiffCID TEXT PRIMARY KEY,
  OwnerJamCID TEXT NOT NULL,
  CreationTime INTEGER,
  Root INTEGER,
  Scale INTEGER,
  BPMrnd REAL,
  BarLength INTEGER,
  UserName TEXT,
  StemCID_1 TEXT, StemCID_2 TEXT, StemCID_3 TEXT, StemCID_4 TEXT,
  StemCID_5 TEXT, StemCID_6 TEXT, StemCID_7 TEXT, StemCID_8 TEXT,
  GainsJSON TEXT,
  AppVersion INTEGER
);
CREATE INDEX IF NOT EXISTS idx_riffs_owner_created ON Riffs(OwnerJamCID, CreationTime DESC);
CREATE INDEX IF NOT EXISTS idx_riffs_needs_detail ON Riffs(OwnerJamCID, AppVersion);

CREATE TABLE IF NOT EXISTS Stems (
  StemCID TEXT PRIMARY KEY,
  OwnerJamCID TEXT NOT NULL,
  CreationTime INTEGER,
  FileEndpoint TEXT,
  FileBucket TEXT,
  FileKey TEXT,
  BPMrnd REAL,
  Instrument INTEGER,
  Length16s REAL,
  PresetName TEXT,
  CreatorUserName TEXT
);

CREATE TABLE IF NOT EXISTS Tags (
  RiffCID TEXT PRIMARY KEY,
  OwnerJamCID TEXT,
  Favour INTEGER NOT NULL DEFAULT 0,
  Note TEXT
);

CREATE TABLE IF NOT EXISTS StemLedger (
  StemCID TEXT PRIMARY KEY,
  Type TEXT NOT NULL,
  Note TEXT
);
`

let cachedDb: Database.Database | null = null

/** Opens (creating the file/directories if needed) sssketch's own writable
 * riff-library connection and ensures the schema exists -- CREATE
 * TABLE/INDEX IF NOT EXISTS make re-running the DDL on every open a cheap
 * no-op once it's already there, so there's no separate "has this been
 * initialized" flag to track. WAL mode so a background sync writing doesn't
 * block a concurrent read from the same process. Cached at module scope,
 * matching riffLibraryStore.ts's own getRiffLibraryDb -- callers needing a
 * fresh handle (tests especially) call closeOwnRiffLibraryDb() first. */
export function openOwnRiffLibraryDb(): Database.Database {
  if (cachedDb) return cachedDb
  const path = ownRiffLibraryDbPath()
  if (!existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true })
  const db = new Database(path)
  db.pragma('journal_mode = WAL')
  db.exec(SCHEMA_SQL)
  cachedDb = db
  return db
}

export function closeOwnRiffLibraryDb(): void {
  cachedDb?.close()
  cachedDb = null
}
```

- [ ] **Step 2: Move and update the test file**

```bash
git mv src/main/loreWarehouseSchema.test.ts src/main/riffLibrarySchema.test.ts
```

Replace its contents with:

```typescript
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let musicDir: string

vi.mock('electron', () => ({
  app: {
    getPath: () => musicDir
  }
}))

describe('riffLibrarySchema', () => {
  beforeEach(() => {
    musicDir = mkdtempSync(join(tmpdir(), 'sssketch-rifflib-schema-test-'))
  })

  afterEach(async () => {
    const { closeOwnRiffLibraryDb } = await import('./riffLibrarySchema')
    closeOwnRiffLibraryDb()
    rmSync(musicDir, { recursive: true, force: true })
  })

  it("ownRiffLibraryDbPath lives under <music>/sssketch/library/cache/common, matching riffLibraryStore.ts's own join convention", async () => {
    const { ownRiffLibraryDbPath } = await import('./riffLibrarySchema')
    expect(ownRiffLibraryDbPath()).toBe(
      join(musicDir, 'sssketch', 'library', 'cache', 'common', 'warehouse.db3')
    )
  })

  it('openOwnRiffLibraryDb creates the db file and every expected table', async () => {
    const { openOwnRiffLibraryDb, ownRiffLibraryDbPath } = await import('./riffLibrarySchema')
    const db = openOwnRiffLibraryDb()
    expect(existsSync(ownRiffLibraryDbPath())).toBe(true)
    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`)
      .all() as { name: string }[]
    expect(tables.map((t) => t.name)).toEqual(['Jams', 'Riffs', 'StemLedger', 'Stems', 'Tags'])
  })

  it('opening twice returns the same cached connection, not a second one', async () => {
    const { openOwnRiffLibraryDb } = await import('./riffLibrarySchema')
    const first = openOwnRiffLibraryDb()
    const second = openOwnRiffLibraryDb()
    expect(first).toBe(second)
  })

  it('closeOwnRiffLibraryDb followed by a re-open works (re-creates the schema idempotently)', async () => {
    const { openOwnRiffLibraryDb, closeOwnRiffLibraryDb } = await import('./riffLibrarySchema')
    openOwnRiffLibraryDb()
    closeOwnRiffLibraryDb()
    expect(() => openOwnRiffLibraryDb()).not.toThrow()
  })
})
```

(Note: the original test's mock ignored which `getPath` key was passed and always returned the
same tmpdir — kept as-is here since `ownRiffLibraryRoot()` now calls `app.getPath('music')`
instead of `'userData'`, and the mock's behavior of ignoring the argument means this still exactly
exercises the real join logic without needing to distinguish keys.)

- [ ] **Step 3: Update `src/main/loreWarehouse.ts`'s import and one call site**

```typescript
import { ownRiffLibraryRoot } from './riffLibrarySchema'
```
And in `resolveStemPath`: `if (root === ownRiffLibraryRoot()) {` (was `ownWarehouseRoot()`). Also
update the two doc comments in this file that name `ownWarehouseRoot()` by name (the top-of-file
comment's `"Defaults to sssketch's own self-built warehouse (ownWarehouseRoot(), populated
by..."` and `resolveStemPath`'s own comment referencing it) to say `ownRiffLibraryRoot()` instead.

- [ ] **Step 4: Update `src/main/loreWarehouse.test.ts`'s two dynamic imports**

Both occurrences of:
```typescript
const { ownWarehouseRoot } = await import('./loreWarehouseSchema')
```
become:
```typescript
const { ownRiffLibraryRoot } = await import('./riffLibrarySchema')
```
and their corresponding usages (`ownWarehouseRoot()` → `ownRiffLibraryRoot()`) in the
`warehouseRootPath defaults to...` and `resolveStemPath uses the content-addressed...` tests.

- [ ] **Step 5: Update `src/main/loreWarehouseSync.ts`'s import**

```typescript
import { openOwnRiffLibraryDb } from './riffLibrarySchema'
```
And its four usages as a default parameter value (`db: Database.Database = openOwnRiffLibraryDb()`
in `removeJamSync`, `syncSharedFeed`, `syncJam`) plus `openOwnRiffLibraryDb` in
`syncSharedFeed`/`syncJam`'s default params.

- [ ] **Step 6: Update `src/main/index.ts`'s import**

```typescript
import { openOwnRiffLibraryDb, ownRiffLibraryRoot } from './riffLibrarySchema'
```
(`ownRiffLibraryRoot` is a new import here, added ahead of when it's actually used in Task 7's new
`riff-library-is-own` handler — importing it now avoids re-touching this line twice.) Update every
existing call site of `openOwnWarehouseDb` in this file to `openOwnRiffLibraryDb` (the
`migrateLegacyFavourites(openOwnWarehouseDb())` call and the two `lore-sync-status`/
`list-riff-favourites`/`toggle-riff-favourite` handler bodies).

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 8: Run the affected test suites**

Run: `npx vitest run src/main/riffLibrarySchema.test.ts src/main/loreWarehouse.test.ts src/main/loreWarehouseSync.test.ts`
Expected: all pass

- [ ] **Step 9: Lint**

Run: `npm run lint`
Expected: no errors

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
Rename loreWarehouseSchema.ts to riffLibrarySchema.ts, relocate own root

ownWarehouseRoot() -> ownRiffLibraryRoot(), and its own default moves from
hidden <userData>/lore-warehouse/ to visible ~/Music/sssketch/library/ (a
sibling of the project library's own relocated projects/ folder) -- done
together per the design doc's own instruction, not as two separate steps.
Existing users with real content at the old default are handled by
riffLibraryMigration.ts (a later task in this plan), wired into app
startup -- this task only changes the default itself.
EOF
)"
```

---

### Task 3: Rename `src/main/loreWarehouse.ts` → `riffLibraryStore.ts`

**Files:**
- Rename: `src/main/loreWarehouse.ts` → `src/main/riffLibraryStore.ts`
- Rename: `src/main/loreWarehouse.test.ts` → `src/main/riffLibraryStore.test.ts`
- Modify: `src/main/index.ts`

Full internal rename of the "reader" module (warehouse root/prefs handling, listJams/listRiffs/
resolveRiff/resolveRiffWithContext/downloadMissingStems). Only `src/main/index.ts` imports from
this file, so this task's cross-file footprint is small.

- [ ] **Step 1: Move the file and rename every identifier inside it**

```bash
git mv src/main/loreWarehouse.ts src/main/riffLibraryStore.ts
```

Apply these renames throughout `riffLibraryStore.ts` (declarations, every call site, every doc
comment naming them):
- `WAREHOUSE_PREFS_FILENAME` → `RIFF_LIBRARY_PREFS_FILENAME`, and its string value
  `'loreWarehousePrefs.json'` → `'riffLibraryPrefs.json'`
- `warehousePrefsPath` → `riffLibraryPrefsPath`
- `warehouseRootOverride` → `riffLibraryRootOverride`
- `setWarehouseRootForTests` → `setRiffLibraryRootForTests`
- `warehouseRootPath` → `riffLibraryRootPath`
- `setWarehouseRoot` → `setRiffLibraryRoot`
- `warehouseDbPath` → `riffLibraryDbPath`
- `getWarehouseDb` → `getRiffLibraryDb`
- `closeWarehouseDb` → `closeRiffLibraryDb`
- `warehouseAvailable` → `riffLibraryAvailable`

`resolveStemPath`, `listJams`, `listRiffs`, `resolveRiff`, `resolveRiffWithContext`,
`downloadMissingStems`, `downloadOneStem`, `RiffContextResult`, `RIFF_CONTEXT_WINDOW_BEFORE`,
`RiffRow`, `StemLookupRow`, `RIFF_PAGE_SIZE`, `FullRiffRow`, `FullStemRow` are untouched (no
"lore"/"warehouse" in their own names).

Add one new exported function right after `setWarehouseRoot`'s new body (`setRiffLibraryRoot`):

```typescript
/** True once the user has explicitly repointed the riff library away from
 * its own default (whether at sssketch's own self-built store or a real
 * external LORE archive) -- see setRiffLibraryRoot. Used by
 * riffLibraryMigration.ts to make sure the one-time default-location
 * migration never runs for someone who already made their own choice. */
export function hasStoredRiffLibraryRootOverride(): boolean {
  return existsSync(riffLibraryPrefsPath())
}
```

Also fix the file's own top-of-file doc comment (currently `/** Where the user's LORE-style
warehouse lives -- user-relocatable (see setWarehouseRoot). Defaults to sssketch's own self-built
warehouse (ownWarehouseRoot(), populated by loreWarehouseSync.ts's background sync) until a user
explicitly points this at a real, externally-managed OUROVEON-synced folder via the folder picker
-- see the design spec's Favourites + external-warehouse compatibility section
(docs/superpowers/specs/2026-08-09-lore-warehouse-sync-design.md). Once a prefs file exists,
whatever root is saved there always wins; this default is only consulted on a genuinely first-ever
launch. Read fresh every call rather than cached, matching projectLibrary.ts's own
libraryRootPath convention. */`) to:

```typescript
/** Where the user's riff library lives -- user-relocatable (see
 * setRiffLibraryRoot). Defaults to sssketch's own self-built riff library
 * (ownRiffLibraryRoot(), populated by riffLibrarySync.ts's background sync)
 * until a user explicitly points this at a real, externally-managed
 * OUROVEON/LORE-synced folder via the folder picker -- see the design
 * spec's Favourites + external-archive compatibility section
 * (docs/superpowers/specs/2026-08-09-lore-warehouse-sync-design.md). Once a
 * prefs file exists, whatever root is saved there always wins; this
 * default is only consulted on a genuinely first-ever launch. Read fresh
 * every call rather than cached, matching projectLibrary.ts's own
 * libraryRootPath convention. */
export function riffLibraryRootPath(): string {
```

- [ ] **Step 2: Move and update the test file**

```bash
git mv src/main/loreWarehouse.test.ts src/main/riffLibraryStore.test.ts
```

Update the import block to:
```typescript
import {
  riffLibraryAvailable,
  riffLibraryRootPath,
  setRiffLibraryRoot,
  resolveStemPath,
  setRiffLibraryRootForTests,
  listJams,
  listRiffs,
  resolveRiff,
  resolveRiffWithContext,
  downloadMissingStems
} from './riffLibraryStore'
import { stemDownloadUrl } from '@shared/riffLibraryTypes'
```
Then apply the same identifier renames as Step 1 throughout every test body (`warehouseAvailable`
→ `riffLibraryAvailable`, `warehouseRootPath` → `riffLibraryRootPath`, `setWarehouseRoot` →
`setRiffLibraryRoot`, `setWarehouseRootForTests` → `setRiffLibraryRootForTests`) — same
assertions, same fixture data, no behavior change. The one test reading the prefs file directly
(`setWarehouseRoot() persists a new root that warehouseRootPath() then returns`) needs its
filename assertion updated too:
```typescript
it('setRiffLibraryRoot() persists a new root that riffLibraryRootPath() then returns', () => {
  setRiffLibraryRootForTests(null)
  setRiffLibraryRoot('/Users/someone/Music/EndlesssSync')
  expect(riffLibraryRootPath()).toBe('/Users/someone/Music/EndlesssSync')
  const prefs = JSON.parse(
    readFileSync(join(userDataDir, 'riffLibraryPrefs.json'), 'utf-8')
  ) as { root: string }
  expect(prefs).toEqual({ root: '/Users/someone/Music/EndlesssSync' })
})
```

- [ ] **Step 3: Update `src/main/index.ts`'s import and call sites**

```typescript
import {
  riffLibraryAvailable,
  riffLibraryRootPath,
  setRiffLibraryRoot,
  listJams,
  listRiffs,
  resolveRiff,
  resolveRiffWithContext,
  downloadMissingStems
} from './riffLibraryStore'
```
The IPC handler bodies still call the OLD channel-name strings at this point (those are Task 7) —
only the imported FUNCTION names change here: `warehouseAvailable()` → `riffLibraryAvailable()`,
`warehouseRootPath()` → `riffLibraryRootPath()`, `setWarehouseRoot(newRoot)` →
`setRiffLibraryRoot(newRoot)` inside the still-`'lore-*'`-named handlers.

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 5: Run the affected test suite**

Run: `npx vitest run src/main/riffLibraryStore.test.ts`
Expected: all pass

- [ ] **Step 6: Lint**

Run: `npm run lint`
Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
Rename loreWarehouse.ts to riffLibraryStore.ts

warehouseRootPath -> riffLibraryRootPath, setWarehouseRoot ->
setRiffLibraryRoot, warehouseAvailable -> riffLibraryAvailable,
loreWarehousePrefs.json -> riffLibraryPrefs.json, plus the reader's other
internal helpers. Adds hasStoredRiffLibraryRootOverride(), needed by
riffLibraryMigration.ts later in this plan. index.ts updated to match.
EOF
)"
```

---

### Task 4: Rename `src/main/loreWarehouseWriter.ts` → `riffLibraryWriter.ts`

**Files:**
- Rename: `src/main/loreWarehouseWriter.ts` → `src/main/riffLibraryWriter.ts`
- Rename: `src/main/loreWarehouseWriter.test.ts` → `src/main/riffLibraryWriter.test.ts`
- Modify: `src/main/loreWarehouseSync.ts`
- Modify: `src/main/index.ts`

Pure file rename — every function inside this file (`upsertJam`, `markJamSyncComplete`,
`upsertRiffSkeletons`, `writeRiffDetail`, `findRiffsNeedingDetail`, `markStemDownloadFailed`,
`isStemLedgered`, `areAllResolved`, `filterUnresolved`, `deleteJamRows`, `getWarehouseSyncStatus`,
`listWarehouseFavourites`, `toggleWarehouseFavourite`, `WarehouseSyncStatus`) has no "lore" in its
own name and stays as-is — "warehouse" here is a legitimate generic term for the local SQLite
store (matches this project's own convention, e.g. the real db filename `warehouse.db3` is
deliberately kept for external-LORE-archive path compatibility, see Task 2). Only the file's own
`.ts` name and its `@shared/riffLibraryTypes` import (already updated in Task 1) needed touching —
this task is just the physical rename plus its two consumers' import paths.

- [ ] **Step 1: Move the file**

```bash
git mv src/main/loreWarehouseWriter.ts src/main/riffLibraryWriter.ts
git mv src/main/loreWarehouseWriter.test.ts src/main/riffLibraryWriter.test.ts
```
No content changes beyond the filename itself — Task 1 already updated its `@shared/loreLibrary`
import to `@shared/riffLibraryTypes`.

- [ ] **Step 2: Update `src/main/loreWarehouseSync.ts`'s import**

```typescript
import {
  upsertJam,
  markJamSyncComplete,
  upsertRiffSkeletons,
  writeRiffDetail,
  markStemDownloadFailed,
  areAllResolved,
  filterUnresolved,
  deleteJamRows
} from './riffLibraryWriter'
```

- [ ] **Step 3: Update `src/main/index.ts`'s import**

```typescript
import {
  getWarehouseSyncStatus,
  listWarehouseFavourites,
  toggleWarehouseFavourite
} from './riffLibraryWriter'
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 5: Run the affected test suite**

Run: `npx vitest run src/main/riffLibraryWriter.test.ts`
Expected: all pass

- [ ] **Step 6: Lint**

Run: `npm run lint`
Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
Rename loreWarehouseWriter.ts to riffLibraryWriter.ts

Pure file rename -- every function inside (upsertJam, writeRiffDetail,
getWarehouseSyncStatus, etc.) keeps its existing name, since none of them
say "lore" and "warehouse" here is a legitimate generic term for the local
SQLite store. loreWarehouseSync.ts and index.ts's imports updated to match.
EOF
)"
```

---

### Task 5: Rename `src/main/loreWarehouseSync.ts` → `riffLibrarySync.ts`

**Files:**
- Rename: `src/main/loreWarehouseSync.ts` → `src/main/riffLibrarySync.ts`
- Rename: `src/main/loreWarehouseSync.test.ts` → `src/main/riffLibrarySync.test.ts`
- Modify: `src/main/index.ts`

Same as Task 4 — pure file rename, no internal identifiers change (`runWithConcurrency`,
`SyncProgress`, `abortSync`, `removeJamSync`, `RemoveJamSyncResult`, `syncSharedFeed`, `syncJam`
all stay). Tasks 2 and 4 already updated this file's OWN imports (`riffLibrarySchema`,
`riffLibraryWriter`); this task is just the physical rename plus index.ts's import path.

- [ ] **Step 1: Move the files**

```bash
git mv src/main/loreWarehouseSync.ts src/main/riffLibrarySync.ts
git mv src/main/loreWarehouseSync.test.ts src/main/riffLibrarySync.test.ts
```

- [ ] **Step 2: Update `src/main/index.ts`'s import**

```typescript
import {
  syncSharedFeed as syncSharedFeedToWarehouse,
  syncJam as syncJamToWarehouse,
  abortSync as abortWarehouseSync,
  removeJamSync as removeWarehouseJamSync
} from './riffLibrarySync'
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 4: Run the affected test suite**

Run: `npx vitest run src/main/riffLibrarySync.test.ts`
Expected: all pass

- [ ] **Step 5: Lint**

Run: `npm run lint`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
Rename loreWarehouseSync.ts to riffLibrarySync.ts

Pure file rename -- runWithConcurrency/syncSharedFeed/syncJam/abortSync/
removeJamSync keep their existing names. index.ts's import updated to
match. This completes the four-file main/loreWarehouse*.ts rename family
(riffLibrarySchema.ts, riffLibraryStore.ts, riffLibraryWriter.ts,
riffLibrarySync.ts).
EOF
)"
```

---

### Task 6: `src/main/ableton/scaleMapping.ts` local `LORE_ROOT_NAMES` copy

**Files:**
- Modify: `src/main/ableton/scaleMapping.ts`

This file has its OWN local copy of the root-names array, deliberately not importing the shared
one (see its own comment: "kept as a separate copy here, not imported, since loreWarehouse.ts
pulls in better-sqlite3/warehouse-connection concerns this module has no business depending on for
a pure string-parsing job"). Rename the local copy's own name — do NOT change it to import the
shared `RIFF_LIBRARY_ROOT_NAMES` (that would be an unrelated refactor, explicitly out of scope per
this plan's own audit).

- [ ] **Step 1: Rename the local constant and update its doc comment**

```typescript
// Same chromatic order as riffLibraryStore.ts's own RIFF_LIBRARY_ROOT_NAMES
// (kept as a separate copy here, not imported, since riffLibraryStore.ts
// pulls in better-sqlite3/riff-library-connection concerns this module has
// no business depending on for a pure string-parsing job). The array index
// IS the semitone offset from C -- confirmed against the reference template
// (E -> index 4 -> Ableton's own Root Value="4" for a Set the user set to
// E Minor).
const RIFF_LIBRARY_ROOT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'] as const
```

Update the doc comment above `ABLETON_SCALE_NAME_TO_ENUM` (currently `// LORE_SCALE_NAMES has 18
entries total, but this table intentionally has only these two. Every other LORE scale name falls
through to undefined below rather than guessing an unverified Ableton enum value.`) to say
`RIFF_LIBRARY_SCALE_NAMES` instead of `LORE_SCALE_NAMES` — this is prose referencing the shared
type's own (now-renamed) name, not a real behavior change.

Update `parseKeyToAbletonScale`'s own doc comment (`"Reverse-parses a Rifff.key display string
(e.g. "E Minor (Aeolian)", produced by loreWarehouse.ts's resolveKeyName) into..."`) to say
`riffLibraryStore.ts's resolveKeyName` (the function itself, `resolveKeyName`, actually lives in
`riffLibraryTypes.ts` post-Task-1, not `riffLibraryStore.ts` — but this doc comment is describing
where the display-string FORMAT originates conceptually / where a caller would look, so use
`riffLibraryTypes.ts's resolveKeyName` for accuracy):

```typescript
/**
 * Reverse-parses a Rifff.key display string (e.g. "E Minor (Aeolian)",
 * produced by riffLibraryTypes.ts's resolveKeyName) into Ableton's Set-level
 * Scale representation. Returns undefined for anything unparseable, or for
 * a scale name outside the confirmed set above -- never guesses.
 */
```

And its one usage inside `parseKeyToAbletonScale`:
```typescript
const root = RIFF_LIBRARY_ROOT_NAMES.indexOf(rootName as (typeof RIFF_LIBRARY_ROOT_NAMES)[number])
```

- [ ] **Step 2: Check `scaleMapping.test.ts` for references**

Run: `grep -n "LORE_ROOT_NAMES" src/main/ableton/scaleMapping.test.ts`
Expected: no output (the test file only calls `parseKeyToAbletonScale` with string literals, per
its own test style — verify this assumption holds before proceeding; if it does reference the old
name directly, rename it the same way).

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 4: Run the affected test suite**

Run: `npx vitest run src/main/ableton/scaleMapping.test.ts`
Expected: all pass

- [ ] **Step 5: Lint**

Run: `npm run lint`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
scaleMapping.ts: rename its own local LORE_ROOT_NAMES copy

Kept deliberately separate from the shared riffLibraryTypes.ts array (not
imported, per this file's own existing reasoning about not pulling in
better-sqlite3 concerns) -- just the rename, no import consolidation.
EOF
)"
```

---

### Task 7: IPC channel renames — `src/main/index.ts` + `src/preload/index.ts` + call sites

**Files:**
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/src/components/LibraryBrowser.tsx`
- Modify: `src/renderer/src/components/TransportBar.tsx`

All 13 `lore-*` IPC channel strings, plus a new 14th channel needed for Task 9's `friendlyRiffName`
fix, land in this one commit — main and preload must never disagree about a channel name, and
`window.rifffApi`'s bridge method names must match what the renderer calls, so this whole slice
has to be atomic. This task touches `LibraryBrowser.tsx`/`TransportBar.tsx` ONLY for the mechanical
`window.rifffApi.lore*` → `window.rifffApi.riffLibrary*` call-site renames — every other
identifier in those two files (state variable names, UI copy, the `friendlyRiffName` fix) is a
later, dedicated task.

- [ ] **Step 1: Rename every IPC handler registration in `src/main/index.ts`**

Replace the block from `ipcMain.handle('lore-warehouse-available', ...)` through
`ipcMain.handle('lore-remove-jam-sync', ...)` with:

```typescript
  ipcMain.handle('riff-library-available', () => riffLibraryAvailable())

  ipcMain.handle('riff-library-root', () => riffLibraryRootPath())

  ipcMain.handle('riff-library-is-own', () => riffLibraryRootPath() === ownRiffLibraryRoot())

  ipcMain.handle('riff-library-set-root', (_event, newRoot: string) => setRiffLibraryRoot(newRoot))

  ipcMain.handle('riff-library-list-jams', (_event, filterText: string) => listJams(filterText))

  ipcMain.handle('riff-library-list-riffs', (_event, jamCID: string, filters: RiffFilters) =>
    listRiffs(jamCID, filters)
  )

  ipcMain.handle('riff-library-resolve-riff', (_event, riffCID: string) => resolveRiff(riffCID))

  ipcMain.handle('riff-library-resolve-riff-with-context', (_event, riffCID: string) =>
    resolveRiffWithContext(riffCID)
  )

  ipcMain.handle('riff-library-download-missing-stems', (_event, riffCID: string) =>
    downloadMissingStems(riffCID)
  )

  ipcMain.handle('endlesss-login', (_event, username: string, password: string) =>
    loginWithCredentials(username, password)
  )
  ipcMain.handle('endlesss-logout', () => endlesssLogout())
  ipcMain.handle('endlesss-auth-status', () => getEndlesssAuthStatus())
  ipcMain.handle('endlesss-list-jams', () => listEndlesssJams())
  ipcMain.handle('endlesss-jam-riff-count', (_event, jamId: string) => jamRiffCount(jamId))
  ipcMain.handle('riff-library-sync-start-shared-feed', (event, userName: string) =>
    syncSharedFeedToWarehouse(userName, (progress) => {
      event.sender.send('riff-library-sync-progress', {
        source: 'shared' as const,
        key: userName,
        ...progress
      })
    })
  )
  ipcMain.handle('riff-library-sync-start-jam', (event, jamId: string, jamName: string) =>
    syncJamToWarehouse(jamId, jamName, (progress) => {
      event.sender.send('riff-library-sync-progress', {
        source: 'jam' as const,
        key: jamId,
        ...progress
      })
    })
  )
  ipcMain.handle('riff-library-sync-status', (_event, jamCID: string) =>
    getWarehouseSyncStatus(openOwnRiffLibraryDb(), jamCID)
  )
  // `key` matches riff-library-sync-progress's own key convention (bare
  // username for a shared-feed sync, jamId for a private jam) -- see
  // abortSync's own doc comment in riffLibrarySync.ts. Returns false, not
  // an error, if nothing was running for that key (e.g. it already
  // finished on its own).
  ipcMain.handle('riff-library-sync-abort', (_event, key: string) => abortWarehouseSync(key))
  // Renderer already confirms with the user before calling this (see
  // LibraryBrowser.tsx's right-click "remove from sync" menu) -- this
  // handler just does the deletion. Rejects (rather than silently no-op)
  // if a sync is currently running for this jamCID, matching
  // removeJamSync's own doc comment in riffLibrarySync.ts.
  ipcMain.handle('riff-library-remove-jam-sync', (_event, jamCID: string, deleteFiles: boolean) =>
    removeWarehouseJamSync(jamCID, deleteFiles)
  )
```

- [ ] **Step 2: Rename every bridge method in `src/preload/index.ts`**

Replace the block from `loreWarehouseAvailable: ...` through `onLoreSyncProgress: ...` (the whole
tail of the `api` object) with:

```typescript
  riffLibraryAvailable: (): Promise<boolean> => ipcRenderer.invoke('riff-library-available'),
  riffLibraryRoot: (): Promise<string> => ipcRenderer.invoke('riff-library-root'),
  // True iff the currently active riff library root is sssketch's own
  // self-built one (rather than a user-pointed real external LORE archive)
  // -- see riff-library-is-own's own handler in index.ts. Threaded into
  // friendlyRiffName's suffix by LibraryBrowser.tsx so an imported riff's
  // generated name reflects where it actually came from, instead of always
  // saying "lore" -- see docs/superpowers/specs/
  // 2026-08-14-riff-library-rename-design.md §4.
  riffLibraryIsOwn: (): Promise<boolean> => ipcRenderer.invoke('riff-library-is-own'),
  setRiffLibraryRoot: (newRoot: string): Promise<void> =>
    ipcRenderer.invoke('riff-library-set-root', newRoot),
  riffLibraryListJams: (filterText: string): Promise<RiffLibraryJam[]> =>
    ipcRenderer.invoke('riff-library-list-jams', filterText),
  riffLibraryListRiffs: (
    jamCID: string,
    filters: {
      dateFrom?: number
      dateTo?: number
      bpm?: number
      userName?: string
      onlyFullyCached?: boolean
      targetUser?: string
      onlyContainsUser?: boolean
      offset?: number
      limit?: number
    }
  ): Promise<{ riffs: RiffLibraryRiffSummary[]; hasMore: boolean; nextOffset: number }> =>
    ipcRenderer.invoke('riff-library-list-riffs', jamCID, filters),
  riffLibraryResolveRiff: (riffCID: string): Promise<RiffLibraryResolvedRiff | null> =>
    ipcRenderer.invoke('riff-library-resolve-riff', riffCID),
  riffLibraryResolveRiffWithContext: (
    riffCID: string
  ): Promise<{ jamCID: string; offset: number; matchedRiffCID: string } | null> =>
    ipcRenderer.invoke('riff-library-resolve-riff-with-context', riffCID),
  riffLibraryDownloadMissingStems: (riffCID: string): Promise<RiffLibraryResolvedRiff | null> =>
    ipcRenderer.invoke('riff-library-download-missing-stems', riffCID),
  endlesssLogin: (
    username: string,
    password: string
  ): Promise<{ ok: true } | { ok: false; error: string }> =>
    ipcRenderer
      .invoke('endlesss-login', username, password)
      .then((r) => (r.ok ? { ok: true } : { ok: false, error: r.error })),
  endlesssLogout: (): Promise<void> => ipcRenderer.invoke('endlesss-logout'),
  endlesssAuthStatus: (): Promise<
    { loggedIn: false } | { loggedIn: true; userId: string; username: string; expiresAt: number }
  > => ipcRenderer.invoke('endlesss-auth-status'),
  endlesssListJams: (): Promise<RiffLibraryJam[]> => ipcRenderer.invoke('endlesss-list-jams'),
  endlesssJamRiffCount: (jamId: string): Promise<number | null> =>
    ipcRenderer.invoke('endlesss-jam-riff-count', jamId),
  riffLibrarySyncStartSharedFeed: (userName: string): Promise<void> =>
    ipcRenderer.invoke('riff-library-sync-start-shared-feed', userName),
  riffLibrarySyncStartJam: (jamId: string, jamName: string): Promise<void> =>
    ipcRenderer.invoke('riff-library-sync-start-jam', jamId, jamName),
  riffLibrarySyncStatus: (jamCID: string): Promise<{ riffCount: number; complete: boolean } | null> =>
    ipcRenderer.invoke('riff-library-sync-status', jamCID),
  // `key` must match syncsInFlight's own internal key convention in
  // riffLibrarySync.ts -- `shared:<username>` for a shared-feed sync (same
  // form as Jams/Riffs' OwnerJamCID storage), or the bare jamId for a
  // private jam. NOT the same as onRiffLibrarySyncProgress's own event
  // `key` field, which uses bare username for shared feed -- a separate,
  // decoupled convention chosen for the renderer's own per-jam display
  // state (syncingKeys/syncProgressByKey), see LibraryBrowser.tsx's
  // syncKeyFor. Resolves to false, not a rejection, if nothing was running
  // for that key.
  riffLibrarySyncAbort: (key: string): Promise<boolean> =>
    ipcRenderer.invoke('riff-library-sync-abort', key),
  // jamCID here uses the SAME convention as riffLibrarySyncAbort's own
  // `key` param just above (shared:<username> for shared feed, not the
  // bare form) -- matches Jams/Riffs.OwnerJamCID storage directly. Rejects
  // if a sync is currently running for it; the renderer's right-click menu
  // should offer abort first in that case.
  riffLibraryRemoveJamSync: (
    jamCID: string,
    deleteFiles: boolean
  ): Promise<{ riffsRemoved: number; filesDeleted: number }> =>
    ipcRenderer.invoke('riff-library-remove-jam-sync', jamCID, deleteFiles),
  onRiffLibrarySyncProgress: (
    callback: (progress: {
      source: 'shared' | 'jam'
      key: string
      done: number
      total: number
      bytesDone: number
    }) => void
  ): (() => void) => {
    const listener = (
      _event: unknown,
      progress: {
        source: 'shared' | 'jam'
        key: string
        done: number
        total: number
        bytesDone: number
      }
    ): void => callback(progress)
    ipcRenderer.on('riff-library-sync-progress', listener)
    return () => ipcRenderer.removeListener('riff-library-sync-progress', listener)
  }
```

- [ ] **Step 3: Rename every `window.rifffApi.lore*` call site in `LibraryBrowser.tsx`**

Apply these `replace_all` renames (mechanical — the function bodies/logic at each call site are
unchanged, only the property name on `window.rifffApi` changes):
- `.loreWarehouseAvailable()` → `.riffLibraryAvailable()`
- `.loreWarehouseRoot()` → `.riffLibraryRoot()`
- `.loreListJams(` → `.riffLibraryListJams(`
- `.loreSyncStatus(` → `.riffLibrarySyncStatus(`
- `.onLoreSyncProgress(` → `.onRiffLibrarySyncProgress(`
- `.loreSyncStartSharedFeed(` → `.riffLibrarySyncStartSharedFeed(`
- `.loreSyncStartJam(` → `.riffLibrarySyncStartJam(`
- `.loreSyncAbort(` → `.riffLibrarySyncAbort(`
- `.loreRemoveJamSync(` → `.riffLibraryRemoveJamSync(`
- `.loreListRiffs(` → `.riffLibraryListRiffs(`
- `.loreResolveRiffWithContext(` → `.riffLibraryResolveRiffWithContext(`
- `.loreDownloadMissingStems(` → `.riffLibraryDownloadMissingStems(`
- `.loreResolveRiff(` → `.riffLibraryResolveRiff(`

Every `console.error('LibraryBrowser: lore...` log-message prefix that names the OLD bridge method
(e.g. `'LibraryBrowser: loreWarehouseAvailable() failed:'`) gets the same treatment for
consistency (`'LibraryBrowser: riffLibraryAvailable() failed:'`, etc.) — these are just string
literals inside `console.error` calls, not identifiers, so update them alongside their matching
call site.

- [ ] **Step 4: Rename the one `window.rifffApi.loreSetWarehouseRoot` call site in `TransportBar.tsx`**

Inside `handleChangeLoreLocation` (not yet renamed — that's Task 10):
```typescript
      await window.rifffApi.setRiffLibraryRoot(newRoot)
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 6: Lint**

Run: `npm run lint`
Expected: no errors

- [ ] **Step 7: Manual-walkthrough flag**

No automated test exists for IPC wiring in this codebase (matches its own established
convention — see CLAUDE.md's Testing conventions). A main↔preload channel-name mismatch only
surfaces at runtime. This task's own correctness rests on typecheck (which WOULD catch a preload
bridge/renderer-call-site name mismatch, since `window.rifffApi.foo` where `foo` doesn't exist on
`RifffApi` is a compile error) plus the exact string-literal pairing verified by hand above — but
the full riff library browser open/browse/sync/import flow still needs a real manual run before
this ships; Task 15's own final verification task covers this explicitly.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
Rename all lore-* IPC channels to riff-library-*, add riff-library-is-own

All 13 existing lore-* channel strings (main + preload, same commit to
avoid a broken intermediate state) plus one new channel,
riff-library-is-own, needed by LibraryBrowser.tsx's friendlyRiffName fix
(a later task in this plan) to tell whether the active riff library root is
sssketch's own self-built one or a user-pointed real external LORE
archive. window.rifffApi bridge method names renamed to match
(loreListJams -> riffLibraryListJams, etc.), and every renderer call site
updated in this same commit.
EOF
)"
```

---

### Task 8: `friendlyRiffName.ts` new suffix scheme + `importResolvedRiff.ts` type update

**Files:**
- Modify: `src/shared/friendlyRiffName.ts`
- Modify: `src/shared/friendlyRiffName.test.ts`
- Modify: `src/renderer/src/audio/importResolvedRiff.ts`

Fixes the real bug (item 5): the suffix type/default gains a `'library'` value for the common
case (sssketch's own riff library), and `'lore'` is now reserved for the genuine
externally-connected-LORE-archive case. `LibraryBrowser.tsx` doesn't yet PASS the real signal —
that's Task 9, which depends on this task's new type existing first.

- [ ] **Step 1: Write the failing test — new default + explicit 'lore' case**

Replace `src/shared/friendlyRiffName.test.ts`'s contents with:

```typescript
import { describe, expect, it } from 'vitest'
import { friendlyRiffName } from './friendlyRiffName'

describe('friendlyRiffName', () => {
  it('is deterministic — the same riffCID always produces the same name', () => {
    const cid = '2f29c1401234567890abcdef'
    expect(friendlyRiffName(cid)).toBe(friendlyRiffName(cid))
  })

  it('ends with the first 8 characters of the riffCID, followed by "library" by default', () => {
    const cid = '2f29c1401234567890abcdef'
    expect(friendlyRiffName(cid)).toMatch(/2f29c140 library$/)
  })

  it('starts with an "adjective noun" pair', () => {
    const cid = '2f29c1401234567890abcdef'
    expect(friendlyRiffName(cid)).toMatch(/^[a-z]+ [a-z]+ 2f29c140 library$/)
  })

  it('uses the "lore" suffix when explicitly passed, for a riff resolved through a real external LORE archive', () => {
    const cid = '2f29c1401234567890abcdef'
    expect(friendlyRiffName(cid, 'lore')).toMatch(/2f29c140 lore$/)
  })

  it('produces different names for different riffCIDs (not a constant)', () => {
    const a = friendlyRiffName('aaaaaaaa1111111111111111')
    const b = friendlyRiffName('bbbbbbbb2222222222222222')
    expect(a).not.toBe(b)
  })

  it('the adjective and noun do not always move together across different CIDs', () => {
    // Regression guard for a naive single-hash implementation where the
    // adjective and noun index would be derived from the same value (e.g.
    // one via modulo, one via integer division of the same hash), which
    // can make them covary more than expected. Not a strict statistical
    // test — just confirms a handful of sample CIDs produce more than one
    // distinct adjective AND more than one distinct noun.
    const cids = ['cid-one', 'cid-two', 'cid-three', 'cid-four', 'cid-five', 'cid-six']
    const names = cids.map((cid) => friendlyRiffName(cid).split(' '))
    const adjectives = new Set(names.map((n) => n[0]))
    const nouns = new Set(names.map((n) => n[1]))
    expect(adjectives.size).toBeGreaterThan(1)
    expect(nouns.size).toBeGreaterThan(1)
  })
})
```

- [ ] **Step 2: Run it to confirm it fails against the current implementation**

Run: `npx vitest run src/shared/friendlyRiffName.test.ts`
Expected: FAIL — the "ends with... library" and "starts with..." tests fail because the current
default suffix is still `'lore'`.

- [ ] **Step 3: Update `friendlyRiffName.ts`'s signature and doc comment**

```typescript
/** Deterministic "adjective noun <cid> <suffix>" display name for a riff
 * imported from an external source (sssketch's own riff library, a
 * genuinely-connected external LORE archive, or the direct-Endlesss path),
 * e.g. "green leopard 2f29c140 library" -- same riffCID always produces the
 * same adjective/noun pair. The adjective and noun are hashed with
 * different salts so they don't covary (a riffCID that picks "green"
 * shouldn't be more or less likely to also pick "leopard"). `suffix`
 * defaults to 'library' -- the common case, since sssketch's own riff
 * library is always present and where the overwhelming majority of riffs
 * are actually resolved from; 'lore' is passed explicitly only when a riff
 * genuinely came from a real, externally-connected LORE archive (see
 * LibraryBrowser.tsx's own isOwnRiffLibrary signal, sourced from the
 * riff-library-is-own IPC channel). */
export function friendlyRiffName(
  riffCID: string,
  suffix: 'library' | 'lore' | 'endlesss' = 'library'
): string {
  const adjective = ADJECTIVES[fnv1a(riffCID + '|adjective') % ADJECTIVES.length]
  const noun = NOUNS[fnv1a(riffCID + '|noun') % NOUNS.length]
  return `${adjective} ${noun} ${riffCID.slice(0, 8)} ${suffix}`
}
```

- [ ] **Step 4: Run the test again to confirm it passes**

Run: `npx vitest run src/shared/friendlyRiffName.test.ts`
Expected: PASS, all 6 tests

- [ ] **Step 5: Update `importResolvedRiff.ts`'s `sourceLabel` type**

In `src/renderer/src/audio/importResolvedRiff.ts`, update `buildImportedRifff`'s signature and its
own doc comment's parenthetical:

```typescript
 * Returns null if there's nothing to import (no cached stems, and no prior
 * `existing` to merge into) -- and null if merging into `existing` would add
 * nothing new (already fully up to date, in which case `existing` itself is
 * returned as `rifff` so callers can still report success). `sourceLabel`
 * feeds friendlyRiffName's suffix and Rifff.folderPath's display text
 * (e.g. 'library' / 'lore' / 'endlesss'). */
export function buildImportedRifff(
  riffCID: string,
  resolved: RiffLibraryResolvedRiff,
  existing: Rifff | undefined,
  sourceLabel: 'library' | 'lore' | 'endlesss',
  folderPathLabel: string
): { groupId: string; rifff: Rifff; newStemSlots: number[] } | null {
```

(The function body itself — the `friendlyRiffName(riffCID, sourceLabel)` call — is unchanged;
`sourceLabel`'s widened type already flows through correctly since `friendlyRiffName`'s own
parameter type was just widened to match in Step 3.)

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: an error at `LibraryBrowser.tsx`'s own `buildImportedRifff(riffCID, resolved, existing,
'lore', 'lore library')` call site is NOT expected here — `'lore'` is still a valid member of the
widened `'library' | 'lore' | 'endlesss'` union, so this compiles fine as-is; it just doesn't yet
pass the REAL signal (that's Task 9). Expected: no errors.

- [ ] **Step 7: Lint**

Run: `npm run lint`
Expected: no errors

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
friendlyRiffName: add 'library' suffix, make it the new default

The generic 'lore' suffix was hardcoded on every imported riff regardless
of real source -- 'library' is now the default (sssketch's own riff
library, the common case), 'lore' stays available for a riff genuinely
resolved through a real, externally-connected LORE archive.
buildImportedRifff's sourceLabel type widened to match. LibraryBrowser.tsx
doesn't yet pass the real signal -- that's the next task.
EOF
)"
```

---

### Task 9: `LibraryBrowser.tsx` remaining renames + real `friendlyRiffName` fix + UI copy

**Files:**
- Modify: `src/renderer/src/components/LibraryBrowser.tsx`

The last big chunk of this file's own rename work (Tasks 1 and 7 already handled the shared-type
imports and bridge-method call sites). This task covers: the `LORE_USERNAME_STORAGE_KEY`
rename + its one-time localStorage carry-forward (item 4), the `loreUsername`/`setLoreUsername`
state rename, wiring the new `riff-library-is-own` signal through to fix the hardcoded
`'lore'`/`'lore library'` import call (item 5), and the two remaining UI copy fixes.

- [ ] **Step 1: Rename the storage key + `loadStoredLoreUsername`, add the one-time migration**

Replace:
```typescript
// Persisted locally (not in project files or app state) since it's a
// per-person identity setting, not something that travels with a project —
// each tester on their own machine sets their own LORE username once here
// and it sticks across sessions, rather than being baked into the app.
const LORE_USERNAME_STORAGE_KEY = 'sssketch:loreUsername'

function loadStoredLoreUsername(): string {
  try {
    return localStorage.getItem(LORE_USERNAME_STORAGE_KEY) ?? RIFF_LIBRARY_USERNAME
  } catch {
    return RIFF_LIBRARY_USERNAME
  }
}
```
with:
```typescript
// Persisted locally (not in project files or app state) since it's a
// per-person identity setting, not something that travels with a project —
// each tester on their own machine sets their own username once here and
// it sticks across sessions, rather than being baked into the app.
const RIFF_LIBRARY_USERNAME_STORAGE_KEY = 'sssketch:riffLibraryUsername'
// Pre-rename key -- see docs/superpowers/specs/
// 2026-08-14-riff-library-rename-design.md §3. Only ever read once, by
// loadStoredRiffLibraryUsername's own one-time carry-forward below; never
// written again after this app version ships.
const LEGACY_LORE_USERNAME_STORAGE_KEY = 'sssketch:loreUsername'

function loadStoredRiffLibraryUsername(): string {
  try {
    const current = localStorage.getItem(RIFF_LIBRARY_USERNAME_STORAGE_KEY)
    if (current !== null) return current
    // One-time carry-forward from the pre-rename key, so nobody's already-
    // set username setting silently resets just because the storage key
    // itself was renamed. Never runs again once the new key exists (the
    // branch above already returns first on every subsequent call).
    const legacy = localStorage.getItem(LEGACY_LORE_USERNAME_STORAGE_KEY)
    if (legacy !== null) {
      localStorage.setItem(RIFF_LIBRARY_USERNAME_STORAGE_KEY, legacy)
      localStorage.removeItem(LEGACY_LORE_USERNAME_STORAGE_KEY)
      return legacy
    }
    return RIFF_LIBRARY_USERNAME
  } catch {
    return RIFF_LIBRARY_USERNAME
  }
}
```

- [ ] **Step 2: Rename the `loreUsername`/`setLoreUsername` state and every usage**

```typescript
  // Which username "you" are, for ownerFraction (drives the ownership
  // brightness coloring) and the "only mine" filter — editable and
  // persisted per-machine (see loadStoredRiffLibraryUsername), not
  // hardcoded, since other people testing this app aren't Elling.
  const [riffLibraryUsername, setRiffLibraryUsername] = useState(loadStoredRiffLibraryUsername)
```
Then `replace_all` every remaining `loreUsername` → `riffLibraryUsername` in the rest of the file
(the `buildRiffFilters`'s `targetUser` assignment, the `useEffect` dependency array, the
`riffIdInput`-clear-effect comment, the filter-bar `<input value={loreUsername}
onChange={(e) => setLoreUsername(...)}>` — becomes `value={riffLibraryUsername} onChange={(e) =>
setRiffLibraryUsername(e.target.value)}`).

- [ ] **Step 3: Fetch the new own-vs-external signal alongside the existing warehouse-root effect**

```typescript
  useEffect(() => {
    if (available === null) return
    window.rifffApi
      .riffLibraryRoot()
      .then(setWarehouseRootState)
      .catch((err) => {
        console.error('LibraryBrowser: riffLibraryRoot() failed:', err)
      })
    window.rifffApi
      .riffLibraryIsOwn()
      .then(setIsOwnRiffLibrary)
      .catch((err) => {
        console.error('LibraryBrowser: riffLibraryIsOwn() failed:', err)
      })
  }, [available])
```
(This REPLACES the existing single-purpose effect of the same `[available]` dependency — it's the
same effect, just with the new fetch added alongside the existing `riffLibraryRoot()` one, not a
second effect.) Add the new state declaration right next to `warehouseRoot`'s own:
```typescript
  const [available, setAvailable] = useState<boolean | null>(null)
  const [warehouseRoot, setWarehouseRootState] = useState<string | null>(null)
  // True iff the currently active riff library root is sssketch's own
  // self-built one, rather than a user-pointed real external LORE archive
  // -- see importResolvedRiff's own use of this for friendlyRiffName's
  // suffix (item 5 of docs/superpowers/specs/
  // 2026-08-14-riff-library-rename-design.md). Defaults to true (the
  // overwhelmingly common case) until the real fetch above resolves, so a
  // riff resolved in the brief window before that first fetch completes
  // still gets labeled correctly for the common case.
  const [isOwnRiffLibrary, setIsOwnRiffLibrary] = useState(true)
```

- [ ] **Step 4: Wire the real signal into `importResolvedRiff`'s `buildImportedRifff` call**

Replace:
```typescript
    const result = buildImportedRifff(riffCID, resolved, existing, 'lore', 'lore library')
```
with:
```typescript
    const result = buildImportedRifff(
      riffCID,
      resolved,
      existing,
      isOwnRiffLibrary ? 'library' : 'lore',
      isOwnRiffLibrary ? 'riff library' : 'lore library'
    )
```
And update `importResolvedRiff`'s own doc comment (currently ending `"...Always imports with
sourceLabel 'lore' since this component always reads through loreWarehouse.ts's lore-* channels,
regardless of which underlying warehouse (self-built or external) is actually active."`) to:

```typescript
   * Imports with sourceLabel 'library' when the currently active riff
   * library root is sssketch's own self-built one, or 'lore' when the user
   * has pointed sssketch at a real, externally-connected LORE archive
   * instead (see isOwnRiffLibrary, sourced from the riff-library-is-own IPC
   * channel) — see friendlyRiffName's own doc comment for why this
   * distinction matters. This component always reads through
   * riffLibraryStore.ts's riff-library-* channels either way; only which
   * underlying root is currently active changes what the resulting riff
   * should be labeled as having come from. */
```

- [ ] **Step 5: Fix the two remaining UI copy strings**

Replace:
```tsx
            <p>
              lore archive not found at {warehouseRoot ?? '...'} — change its location from the gear
              menu
            </p>
```
with:
```tsx
            <p>
              riff archive not found at {warehouseRoot ?? '...'} — change its location from the gear
              menu
            </p>
```

Replace:
```tsx
                      title="your LORE username — drives the ownership coloring below and the 'only mine' filter, saved on this machine"
```
with:
```tsx
                      title="your username — drives the ownership coloring below and the 'only mine' filter, saved on this machine"
```

The download-missing-stems button's tooltip (`"fetch missing stems directly from Endlesss's cloud
storage — no LORE login needed, they're public files"`) is Bucket B — genuinely explains bypassing
the real LORE app's own login requirement — verify its wording still reads correctly in context
(it does: this button exists regardless of which riff library root is active) and leave it
untouched.

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 7: Lint**

Run: `npm run lint`
Expected: no errors

- [ ] **Step 8: Manual-walkthrough flag**

This component has no dedicated test file (matches this project's own convention — renderer
components are verified via typecheck + lint + underlying pure-logic tests + manual walkthrough,
not unit tests). The localStorage carry-forward in Step 1 and the `friendlyRiffName` signal wiring
in Step 4 both need a real run to confirm: (a) an existing `sssketch:loreUsername` value survives
the rename into `sssketch:riffLibraryUsername` and the old key is gone afterward, and (b) an
imported riff's generated name actually says "library" now instead of "lore" for the common case.
Flag this explicitly rather than claiming it was verified — Task 15's final verification task
covers it.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
LibraryBrowser.tsx: finish the riff-library rename, fix friendlyRiffName bug

LORE_USERNAME_STORAGE_KEY -> RIFF_LIBRARY_USERNAME_STORAGE_KEY, with a
one-time localStorage carry-forward from the old key so nobody's saved
username silently resets. loreUsername/setLoreUsername state ->
riffLibraryUsername/setRiffLibraryUsername.

Real bug fix (item 5 of the rename design doc): friendlyRiffName's suffix
was hardcoded 'lore' regardless of actual source. Now threads a real
isOwnRiffLibrary signal (fetched via the new riff-library-is-own IPC
channel) through to buildImportedRifff, so an imported riff is labeled
'library' when it came from sssketch's own riff library (the common case)
and 'lore' only for a riff genuinely resolved through a real,
externally-connected LORE archive.

Plus two UI copy fixes: the warehouse-unavailable fallback message and the
username filter's own tooltip no longer say "LORE" for what's actually
sssketch's own setting.
EOF
)"
```

---

### Task 10: `TransportBar.tsx` — rename `handleChangeLoreLocation`

**Files:**
- Modify: `src/renderer/src/components/TransportBar.tsx`

Task 7 already renamed this function's inner `window.rifffApi` call
(`setRiffLibraryRoot`). This task renames the function itself and its own doc comment — the
gear-menu label text ("change riff archive location…") was already correct from earlier work this
session and needs no further change.

- [ ] **Step 1: Rename the function and its doc comment**

Replace:
```typescript
  // Same pickFolder + loreSetWarehouseRoot pair LibraryBrowser.tsx's LORE
  // tab used to offer inline (as a "choose folder" recovery button on its
  // warehouse-unavailable fallback) -- moved here so it's reachable without
  // having to hit that unavailable state first. Points LORE at a different
  // OUROVEON sync target than sssketch's own self-built warehouse; see
  // loreWarehouse.ts for what "warehouse root" means.
  async function handleChangeLoreLocation(): Promise<void> {
    try {
      const newRoot = await window.rifffApi.pickFolder()
      if (!newRoot) return
      await window.rifffApi.setRiffLibraryRoot(newRoot)
    } catch (err) {
      console.error('TransportBar: handleChangeLoreLocation() failed:', err)
    }
  }
```
with:
```typescript
  // Same pickFolder + setRiffLibraryRoot pair LibraryBrowser.tsx's own
  // warehouse-unavailable fallback used to offer inline -- moved here so
  // it's reachable without having to hit that unavailable state first.
  // Points the riff library at a different OUROVEON/LORE sync target than
  // sssketch's own self-built one; see riffLibraryStore.ts for what "riff
  // library root" means.
  async function handleChangeRiffLibraryLocation(): Promise<void> {
    try {
      const newRoot = await window.rifffApi.pickFolder()
      if (!newRoot) return
      await window.rifffApi.setRiffLibraryRoot(newRoot)
    } catch (err) {
      console.error('TransportBar: handleChangeRiffLibraryLocation() failed:', err)
    }
  }
```

- [ ] **Step 2: Update its one call site in the settings menu**

Replace:
```typescript
            {
              label: 'change riff archive location…',
              onClick: () => void handleChangeLoreLocation()
            },
```
with:
```typescript
            {
              label: 'change riff archive location…',
              onClick: () => void handleChangeRiffLibraryLocation()
            },
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 4: Lint**

Run: `npm run lint`
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
TransportBar.tsx: rename handleChangeLoreLocation

handleChangeLoreLocation -> handleChangeRiffLibraryLocation, pure rename
-- the gear-menu label text was already correct from earlier work this
session.
EOF
)"
```

---

### Task 11: Project library relocation — `projectLibrary.ts` + migration

**Files:**
- Modify: `src/main/projectLibrary.ts`
- Create: `src/main/projectLibraryMigration.ts`
- Create: `src/main/projectLibraryMigration.test.ts`
- Modify: `src/main/index.ts`

Relocates the project library default from `~/Music/sssketch/` directly to
`~/Music/sssketch/projects/`, and migrates any existing sketch folders sitting at the old default.
`~/Music/sssketch/` itself is deliberately left in place afterward — it becomes the shared parent
of the new `projects/` and the riff library's own relocated `library/` (Task 2), not an orphan.

- [ ] **Step 1: Relocate `defaultLibraryRoot()` and add the override-check helper**

In `src/main/projectLibrary.ts`, replace:
```typescript
function defaultLibraryRoot(): string {
  return join(app.getPath('music'), 'sssketch')
}

/** Where every sketch's own subfolder lives -- user-relocatable (see
 * setLibraryRootPath), defaulting to `<Music>/sssketch`. Read fresh every
 * call rather than cached, matching pluginCatalog.ts's own loadCatalog
 * convention -- this is a rarely-called, cheap file read, not a hot path. */
export function libraryRootPath(): string {
  const path = libraryPrefsPath()
  if (!existsSync(path)) return defaultLibraryRoot()
  try {
    const prefs = JSON.parse(readFileSync(path, 'utf-8')) as { root?: string }
    return prefs.root ?? defaultLibraryRoot()
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`libraryRootPath: failed to read ${path}: ${message}`)
    return defaultLibraryRoot()
  }
}

export function setLibraryRootPath(newRoot: string): void {
  try {
    writeFileSync(libraryPrefsPath(), JSON.stringify({ root: newRoot }, null, 2), 'utf-8')
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`setLibraryRootPath: failed to write ${libraryPrefsPath()}: ${message}`)
  }
}
```
with:
```typescript
function defaultLibraryRoot(): string {
  // A visible sibling of the riff library's own relocated default
  // (~/Music/sssketch/library/, see riffLibrarySchema.ts's
  // ownRiffLibraryRoot) under the same shared ~/Music/sssketch/ parent --
  // was directly `<Music>/sssketch` with no subfolder. Existing users with
  // real sketches still sitting at the old default are handled by
  // projectLibraryMigration.ts, wired into app startup.
  return join(app.getPath('music'), 'sssketch', 'projects')
}

/** Where every sketch's own subfolder lives -- user-relocatable (see
 * setLibraryRootPath), defaulting to `<Music>/sssketch/projects`. Read
 * fresh every call rather than cached, matching pluginCatalog.ts's own
 * loadCatalog convention -- this is a rarely-called, cheap file read, not a
 * hot path. */
export function libraryRootPath(): string {
  const path = libraryPrefsPath()
  if (!existsSync(path)) return defaultLibraryRoot()
  try {
    const prefs = JSON.parse(readFileSync(path, 'utf-8')) as { root?: string }
    return prefs.root ?? defaultLibraryRoot()
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`libraryRootPath: failed to read ${path}: ${message}`)
    return defaultLibraryRoot()
  }
}

export function setLibraryRootPath(newRoot: string): void {
  try {
    writeFileSync(libraryPrefsPath(), JSON.stringify({ root: newRoot }, null, 2), 'utf-8')
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`setLibraryRootPath: failed to write ${libraryPrefsPath()}: ${message}`)
  }
}

/** True once the user has explicitly repointed the project library away
 * from its own default -- see setLibraryRootPath. Used by
 * projectLibraryMigration.ts to make sure the one-time default-location
 * migration never runs for someone who already made their own choice. */
export function hasStoredLibraryRootOverride(): boolean {
  return existsSync(libraryPrefsPath())
}
```

- [ ] **Step 2: Check `projectLibrary.test.ts` for a `defaultLibraryRoot`/`libraryRootPath` default-path assertion**

Run: `grep -n "defaultLibraryRoot\|sssketch')" src/main/projectLibrary.test.ts`

If any test asserts `libraryRootPath()`'s DEFAULT value (no prefs file) equals
`join(<mocked music path>, 'sssketch')` directly, update it to
`join(<mocked music path>, 'sssketch', 'projects')` to match the new default. (Tests that only
exercise an EXPLICIT override via `setLibraryRootPath`/a mocked prefs file are unaffected — they
never touch `defaultLibraryRoot()`'s own body.)

- [ ] **Step 3: Write the failing migration test**

Create `src/main/projectLibraryMigration.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let musicDir: string
let userDataDir: string

vi.mock('electron', () => ({
  app: {
    getPath: (key: string) => (key === 'music' ? musicDir : userDataDir)
  }
}))

beforeEach(() => {
  musicDir = mkdtempSync(join(tmpdir(), 'sssketch-projectlib-migration-music-'))
  userDataDir = mkdtempSync(join(tmpdir(), 'sssketch-projectlib-migration-userdata-'))
})

afterEach(() => {
  rmSync(musicDir, { recursive: true, force: true })
  rmSync(userDataDir, { recursive: true, force: true })
})

function writeOldSketch(name: string): void {
  const dir = join(musicDir, 'sssketch', name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${name}.sssketchproj`), '{}')
}

describe('migrateProjectLibraryLocation', () => {
  it('moves a real sketch folder from the old default into the new projects/ subfolder', async () => {
    writeOldSketch('groovy-sparrow')
    const { migrateProjectLibraryLocation } = await import('./projectLibraryMigration')
    migrateProjectLibraryLocation()
    const newPath = join(
      musicDir,
      'sssketch',
      'projects',
      'groovy-sparrow',
      'groovy-sparrow.sssketchproj'
    )
    expect(existsSync(newPath)).toBe(true)
    expect(existsSync(join(musicDir, 'sssketch', 'groovy-sparrow'))).toBe(false)
  })

  it('is idempotent -- a second run does not touch new content at the old default once already migrated', async () => {
    writeOldSketch('groovy-sparrow')
    const { migrateProjectLibraryLocation } = await import('./projectLibraryMigration')
    migrateProjectLibraryLocation()
    writeOldSketch('second-one') // simulate new content appearing at the old default after migration
    migrateProjectLibraryLocation()
    expect(existsSync(join(musicDir, 'sssketch', 'second-one'))).toBe(true) // untouched
    expect(existsSync(join(musicDir, 'sssketch', 'projects', 'second-one'))).toBe(false)
  })

  it('ignores non-sketch folders (e.g. .samples-cache) at the old default', async () => {
    mkdirSync(join(musicDir, 'sssketch', '.samples-cache'), { recursive: true })
    writeFileSync(join(musicDir, 'sssketch', '.samples-cache', 'somefile.wav'), 'x')
    const { migrateProjectLibraryLocation } = await import('./projectLibraryMigration')
    migrateProjectLibraryLocation()
    expect(existsSync(join(musicDir, 'sssketch', '.samples-cache'))).toBe(true)
    expect(existsSync(join(musicDir, 'sssketch', 'projects'))).toBe(false)
  })

  it('does nothing when the old default has no real sketch content', async () => {
    const { migrateProjectLibraryLocation } = await import('./projectLibraryMigration')
    expect(() => migrateProjectLibraryLocation()).not.toThrow()
    expect(existsSync(join(musicDir, 'sssketch', 'projects'))).toBe(false)
  })

  it('does nothing when an explicit library root override is already stored', async () => {
    writeOldSketch('groovy-sparrow')
    writeFileSync(
      join(userDataDir, 'libraryPrefs.json'),
      JSON.stringify({ root: '/Volumes/External/MySketches' })
    )
    const { migrateProjectLibraryLocation } = await import('./projectLibraryMigration')
    migrateProjectLibraryLocation()
    expect(existsSync(join(musicDir, 'sssketch', 'groovy-sparrow'))).toBe(true) // untouched
  })
})
```

- [ ] **Step 4: Run it to confirm it fails (module doesn't exist yet)**

Run: `npx vitest run src/main/projectLibraryMigration.test.ts`
Expected: FAIL with "Cannot find module './projectLibraryMigration'" (or similar)

- [ ] **Step 5: Implement `projectLibraryMigration.ts`**

Create `src/main/projectLibraryMigration.ts`:

```typescript
import { existsSync, mkdirSync, readdirSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { hasStoredLibraryRootOverride, libraryRootPath } from './projectLibrary'

/** One-time, idempotent migration of real sketch-project folders off the
 * OLD project-library default (directly in `<Music>/sssketch/`) onto the
 * NEW default (`<Music>/sssketch/projects/`, a sibling of the riff
 * library's own relocated `<Music>/sssketch/library/` -- see
 * riffLibraryMigration.ts and docs/superpowers/specs/
 * 2026-08-14-riff-library-rename-design.md §2). `<Music>/sssketch/` itself
 * is NOT emptied by this -- it becomes the shared parent of both
 * `projects/` and `library/` afterward, so there's nothing left to clean
 * up there.
 *
 * Only ever runs for users relying on the silent default (no explicit
 * libraryPrefs.json override -- see hasStoredLibraryRootOverride): anyone
 * who already pointed their project library elsewhere keeps their own
 * choice untouched. Safe to call on every app startup -- once the new
 * `projects/` folder has anything in it (migrated, or a genuinely fresh
 * install), this is a no-op forever after, and never merges/overwrites
 * into an already-populated new location.
 *
 * A folder directly under the old root counts as a real sketch project
 * only if it contains a `<name>.sssketchproj` matching its own folder
 * name -- the exact same test listLibrarySketches() already uses, which
 * naturally excludes `.samples-cache` and any stray non-sketch folder
 * without needing an explicit denylist. `projects`/`library` themselves
 * are also explicitly excluded, in case this ever runs against a
 * partially-migrated tree. A real MOVE (renameSync per folder), not a
 * copy. */
export function migrateProjectLibraryLocation(): void {
  if (hasStoredLibraryRootOverride()) return
  const oldRoot = join(app.getPath('music'), 'sssketch')
  if (!existsSync(oldRoot)) return

  const newRoot = libraryRootPath()
  if (existsSync(newRoot) && readdirSync(newRoot).length > 0) return

  const entries = readdirSync(oldRoot, { withFileTypes: true })
  const sketchDirNames = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => name !== 'projects' && name !== 'library')
    .filter((name) => existsSync(join(oldRoot, name, `${name}.sssketchproj`)))

  if (sketchDirNames.length === 0) return

  mkdirSync(newRoot, { recursive: true })
  for (const name of sketchDirNames) {
    renameSync(join(oldRoot, name), join(newRoot, name))
  }
}
```

- [ ] **Step 6: Run the test again to confirm it passes**

Run: `npx vitest run src/main/projectLibraryMigration.test.ts`
Expected: PASS, all 5 tests

- [ ] **Step 7: Wire it into app startup in `src/main/index.ts`**

Add the import near the other migration imports:
```typescript
import { migrateProjectLibraryLocation } from './projectLibraryMigration'
```
And call it early in `app.whenReady().then(async () => {...})`, BEFORE
`migrateEndlesssStemCache()`:
```typescript
  // One-time, idempotent relocation of the project library from its old
  // default (~/Music/sssketch/ directly) onto its new one
  // (~/Music/sssketch/projects/) -- see projectLibraryMigration.ts's own
  // doc comment. No ordering constraint relative to the other migrations
  // below (touches an entirely separate directory tree), but run first for
  // readability alongside its riff-library counterpart (added in the next
  // task).
  migrateProjectLibraryLocation()

  migrateEndlesssStemCache()
```

- [ ] **Step 8: Typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 9: Run the full affected test suite**

Run: `npx vitest run src/main/projectLibrary.test.ts src/main/projectLibraryMigration.test.ts`
Expected: all pass

- [ ] **Step 10: Lint**

Run: `npm run lint`
Expected: no errors

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
Relocate project library default to ~/Music/sssketch/projects/

defaultLibraryRoot() now returns <Music>/sssketch/projects (was
<Music>/sssketch directly) -- a visible sibling of the riff library's own
relocated <Music>/sssketch/library/. New projectLibraryMigration.ts moves
any real sketch-project folders already sitting at the old default into
the new one, once, idempotently, on startup -- only for users with no
explicit libraryPrefs.json override. <Music>/sssketch/ itself is left in
place afterward as the new shared parent, not emptied/removed.
EOF
)"
```

---

### Task 12: Riff library relocation migration

**Files:**
- Create: `src/main/riffLibraryMigration.ts`
- Create: `src/main/riffLibraryMigration.test.ts`
- Modify: `src/main/index.ts`

Migrates sssketch's own riff-sync database off its old hidden default
(`<userData>/lore-warehouse/`) onto the new visible one (`~/Music/sssketch/library/`, already
wired as the new default in Task 2). **Must run before anything else in this process ever calls
`openOwnRiffLibraryDb()`** — moving the directory out from under an already-open SQLite connection
would corrupt it.

- [ ] **Step 1: Write the failing migration test**

Create `src/main/riffLibraryMigration.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let userDataDir: string
let musicDir: string

vi.mock('electron', () => ({
  app: {
    getPath: (key: string) => (key === 'music' ? musicDir : userDataDir)
  }
}))

beforeEach(() => {
  userDataDir = mkdtempSync(join(tmpdir(), 'sssketch-rifflib-migration-userdata-'))
  musicDir = mkdtempSync(join(tmpdir(), 'sssketch-rifflib-migration-music-'))
})

afterEach(() => {
  rmSync(userDataDir, { recursive: true, force: true })
  rmSync(musicDir, { recursive: true, force: true })
})

function writeOldRiffLibrary(): void {
  const dbDir = join(userDataDir, 'lore-warehouse', 'cache', 'common')
  mkdirSync(dbDir, { recursive: true })
  writeFileSync(join(dbDir, 'warehouse.db3'), 'fake sqlite bytes')
  writeFileSync(join(dbDir, 'warehouse.db3-wal'), 'fake wal bytes')
}

describe('migrateRiffLibraryLocation', () => {
  it('moves the whole old lore-warehouse/ directory (db3 + WAL sidecar) to the new location', async () => {
    writeOldRiffLibrary()
    const { migrateRiffLibraryLocation } = await import('./riffLibraryMigration')
    migrateRiffLibraryLocation()
    const newDbPath = join(musicDir, 'sssketch', 'library', 'cache', 'common', 'warehouse.db3')
    const newWalPath = join(
      musicDir,
      'sssketch',
      'library',
      'cache',
      'common',
      'warehouse.db3-wal'
    )
    expect(existsSync(newDbPath)).toBe(true)
    expect(existsSync(newWalPath)).toBe(true)
    expect(existsSync(join(userDataDir, 'lore-warehouse'))).toBe(false)
  })

  it('is idempotent -- a second run does not touch new content reappearing at the old default', async () => {
    writeOldRiffLibrary()
    const { migrateRiffLibraryLocation } = await import('./riffLibraryMigration')
    migrateRiffLibraryLocation()
    // Simulate a fresh db reappearing at the OLD default (shouldn't happen
    // in practice, but proves the new-location-populated check wins
    // regardless of old-side state, not just "old side is now empty").
    writeOldRiffLibrary()
    migrateRiffLibraryLocation()
    expect(existsSync(join(userDataDir, 'lore-warehouse'))).toBe(true) // untouched this run
  })

  it('does nothing when there is nothing at the old default', async () => {
    const { migrateRiffLibraryLocation } = await import('./riffLibraryMigration')
    expect(() => migrateRiffLibraryLocation()).not.toThrow()
    expect(existsSync(join(musicDir, 'sssketch', 'library'))).toBe(false)
  })

  it('does nothing when an explicit riff library root override is already stored', async () => {
    writeOldRiffLibrary()
    writeFileSync(
      join(userDataDir, 'riffLibraryPrefs.json'),
      JSON.stringify({ root: '/Volumes/External/MyLoreArchive' })
    )
    const { migrateRiffLibraryLocation } = await import('./riffLibraryMigration')
    migrateRiffLibraryLocation()
    expect(existsSync(join(userDataDir, 'lore-warehouse'))).toBe(true) // untouched
  })
})
```

- [ ] **Step 2: Run it to confirm it fails (module doesn't exist yet)**

Run: `npx vitest run src/main/riffLibraryMigration.test.ts`
Expected: FAIL with "Cannot find module './riffLibraryMigration'" (or similar)

- [ ] **Step 3: Implement `riffLibraryMigration.ts`**

Create `src/main/riffLibraryMigration.ts`:

```typescript
import { existsSync, mkdirSync, readdirSync, renameSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app } from 'electron'
import { hasStoredRiffLibraryRootOverride } from './riffLibraryStore'
import { ownRiffLibraryRoot } from './riffLibrarySchema'

/** One-time, idempotent migration of sssketch's own riff-sync database off
 * its OLD default location (hidden inside `<userData>/lore-warehouse/`,
 * the literal pre-rename path -- ownRiffLibraryRoot() itself already
 * returns the NEW location by the time this runs, so the old one is
 * hardcoded here, same convention as stemCacheMigration.ts's own
 * OLD_SOURCES) onto the NEW default (`<Music>/sssketch/library/`, a
 * visible sibling of the project library's own relocated
 * `<Music>/sssketch/projects/` -- see projectLibraryMigration.ts and
 * docs/superpowers/specs/2026-08-14-riff-library-rename-design.md §2).
 *
 * Only ever runs for users relying on the silent default (no explicit
 * riffLibraryPrefs.json override -- see hasStoredRiffLibraryRootOverride):
 * anyone who already pointed sssketch at a real external LORE archive
 * keeps their own choice untouched. Safe to call on every app startup --
 * once the new location has anything in it (migrated, or a genuinely
 * fresh install), this is a no-op forever after.
 *
 * A whole-directory move (a single renameSync, not a per-file copy) --
 * carries the db3 file AND its WAL/SHM sidecars (see riffLibrarySchema.ts's
 * WAL journal mode) along in one atomic step, so there's never a moment
 * with a db3 at the new path but its WAL sidecar still at the old one.
 * MUST run before anything in this process calls openOwnRiffLibraryDb()
 * for the first time this session -- moving the directory out from under
 * an already-open SQLite connection would corrupt it. Since this moves the
 * ENTIRE old lore-warehouse/ directory (not just its db3 file) in one
 * renameSync, nothing is left behind at the old path afterward -- no
 * separate cleanup step needed, unlike the project library's own migration
 * (which only relocates individual sketch subfolders, leaving
 * <Music>/sssketch/ itself in place as the new shared parent). */
export function migrateRiffLibraryLocation(): void {
  if (hasStoredRiffLibraryRootOverride()) return
  const oldRoot = join(app.getPath('userData'), 'lore-warehouse')
  if (!existsSync(oldRoot)) return

  const newRoot = ownRiffLibraryRoot()
  if (existsSync(newRoot) && readdirSync(newRoot).length > 0) return

  mkdirSync(dirname(newRoot), { recursive: true })
  renameSync(oldRoot, newRoot)
}
```

- [ ] **Step 4: Run the test again to confirm it passes**

Run: `npx vitest run src/main/riffLibraryMigration.test.ts`
Expected: PASS, all 4 tests

- [ ] **Step 5: Wire it into app startup in `src/main/index.ts`, BEFORE the first `openOwnRiffLibraryDb()` call**

Add the import near `migrateProjectLibraryLocation`'s own:
```typescript
import { migrateRiffLibraryLocation } from './riffLibraryMigration'
```
And call it immediately after `migrateProjectLibraryLocation()`, still before
`migrateEndlesssStemCache()` and — critically — before `migrateLegacyFavourites(openOwnRiffLibraryDb())`,
which is this process's own first call to `openOwnRiffLibraryDb()`:
```typescript
  // One-time, idempotent relocation of the project library from its old
  // default (~/Music/sssketch/ directly) onto its new one
  // (~/Music/sssketch/projects/) -- see projectLibraryMigration.ts's own
  // doc comment.
  migrateProjectLibraryLocation()

  // Same for the riff library -- see riffLibraryMigration.ts's own doc
  // comment. MUST run before migrateLegacyFavourites' own
  // openOwnRiffLibraryDb() call a few lines below, which is this process's
  // first time opening that connection -- moving the directory out from
  // under an already-open one would corrupt it.
  migrateRiffLibraryLocation()

  migrateEndlesssStemCache()
```

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 7: Run the affected test suite**

Run: `npx vitest run src/main/riffLibraryMigration.test.ts`
Expected: all pass

- [ ] **Step 8: Lint**

Run: `npm run lint`
Expected: no errors

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
Migrate the riff library from its old hidden default to the new visible one

New riffLibraryMigration.ts moves the whole old <userData>/lore-warehouse/
directory (db3 + WAL/SHM sidecars, one atomic renameSync) to the new
<Music>/sssketch/library/ default, once, idempotently, on startup -- only
for users with no explicit riffLibraryPrefs.json override. Wired into
index.ts's startup BEFORE the first openOwnRiffLibraryDb() call (currently
migrateLegacyFavourites' own), since moving the directory out from under an
already-open SQLite connection would corrupt it.
EOF
)"
```

---

### Task 13: `CLAUDE.md` correction

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Rewrite the `src/main/` bullet's LORE mention**

Replace:
```markdown
- **`src/main/`** — Electron main process. File I/O, project save/load (`projectFile.ts`),
  audio import (`importRifff.ts`), plugin scanning (`pluginScan.ts`, `runFullScan.ts`,
  `pluginCatalog.ts`), the LORE warehouse integration (`loreWarehouse.ts`), and the engine
  subprocess lifecycle (`engineProcess.ts` spawns it, `engineClient.ts` talks to it,
  `playbackEngineLifecycle.ts` wires it into app startup). Every `ipcMain.handle(...)` call
  in `index.ts` is the full IPC surface — grep there first when tracing a feature end to end.
```
with:
```markdown
- **`src/main/`** — Electron main process. File I/O, project save/load (`projectFile.ts`),
  audio import (`importRifff.ts`), plugin scanning (`pluginScan.ts`, `runFullScan.ts`,
  `pluginCatalog.ts`), the riff library integration (`riffLibraryStore.ts`, `riffLibrarySchema.ts`,
  `riffLibrarySync.ts`, `riffLibraryWriter.ts` — sssketch's own self-built, always-on riff-sync
  database, plus an optional connection to a real external LORE-synced archive if the user already
  has one), and the engine subprocess lifecycle (`engineProcess.ts` spawns it, `engineClient.ts`
  talks to it, `playbackEngineLifecycle.ts` wires it into app startup). Every `ipcMain.handle(...)`
  call in `index.ts` is the full IPC surface — grep there first when tracing a feature end to end.
```

- [ ] **Step 2: Read through the rest of the file for any other stale mention**

Run: `grep -n -i "lore" CLAUDE.md`
Expected: only the "Analysis caches" section's own unrelated "library browser" mention (about the
project library browser, not LORE) and nothing else — this file had exactly one real LORE mention
before Step 1.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "$(cat <<'EOF'
CLAUDE.md: describe the riff library integration by its new name

Was "the LORE warehouse integration (loreWarehouse.ts)" -- now names the
actual four renamed files and describes the real two-tier reality
(sssketch's own always-on riff library, plus an optional real external
LORE-archive connection).
EOF
)"
```

---

### Task 14: `docs/USER_GUIDE.md` correction

**Files:**
- Modify: `docs/USER_GUIDE.md`

Corrects the stale "requires a pre-existing LORE archive" framing and every other "LORE" mention
in this file (7 total) to describe the real, current two-tier reality: sssketch's own riff library
always works out of the box; connecting a real external LORE archive is an optional add-on.

- [ ] **Step 1: Fix the table of contents entry**

Replace:
```markdown
- [The LORE library browser](#the-lore-library-browser)
```
with:
```markdown
- [The riff library browser](#the-riff-library-browser)
```

- [ ] **Step 2: Fix the "Basic workflow" mention**

Replace:
```markdown
1. **Import** a rifff — drag an Endlesss export folder (or loose stem files)
   onto the Shelf, or pull one in from the [LORE library browser](#the-lore-library-browser)
   if you have a synced local archive.
```
with:
```markdown
1. **Import** a rifff — drag an Endlesss export folder (or loose stem files)
   onto the Shelf, or pull one in from the [riff library browser](#the-riff-library-browser).
```

- [ ] **Step 3: Fix the downbeat-picker mention**

Replace:
```markdown
When importing several rifffs at once (e.g. a batch from the LORE browser),
```
with:
```markdown
When importing several rifffs at once (e.g. a batch from the riff library browser),
```

- [ ] **Step 4: Rewrite the section itself**

Replace:
```markdown
## The LORE library browser

If you have a local OUROVEON/LORE-synced Endlesss archive, this is a
searchable alternative to drag-and-drop: pick a jam, browse its riffs as a
grid of small circles (brightness shows your own contribution level to that
riff; black means it isn't fully downloaded locally yet), click a circle to
preview it, and import with one click.

- Paste a riff ID directly to jump straight to it.
- **Download missing stems** fetches anything not yet cached locally.
- <kbd>Esc</kbd> closes the panel.
```
with:
```markdown
## The riff library browser

sssketch keeps its own local, searchable library of your Endlesss riffs —
log in once and it syncs directly from Endlesss in the background, no
external tool required. Pick a jam, browse its riffs as a grid of small
circles (brightness shows your own contribution level to that riff; black
means it isn't fully downloaded locally yet), click a circle to preview it,
and import with one click.

- Paste a riff ID directly to jump straight to it.
- **Download missing stems** fetches anything not yet cached locally.
- <kbd>Esc</kbd> closes the panel.

If you already have a local archive synced by the separate, real LORE app
(OUROVEON), you can point sssketch at it instead from the settings menu's
**change riff archive location…** — an optional override, not required for
the browser to work.
```

- [ ] **Step 5: Fix the key-commands table mention**

Replace:
```markdown
| Shift-click a tile (Shelf / sketch / LORE) | Range-select |
```
with:
```markdown
| Shift-click a tile (Shelf / sketch / riff library) | Range-select |
```

- [ ] **Step 6: Fix the key-commands subsection heading**

Replace:
```markdown
### LORE browser
```
with:
```markdown
### riff library browser
```

- [ ] **Step 7: Verify no other mention was missed**

Run: `grep -n -i "lore" docs/USER_GUIDE.md`
Expected: no output

- [ ] **Step 8: Commit**

```bash
git add docs/USER_GUIDE.md
git commit -m "$(cat <<'EOF'
USER_GUIDE.md: correct the stale LORE library browser section

Was framed as requiring a pre-existing external LORE archive -- no longer
true since sssketch started self-syncing its own riff library. Rewrites
the section (and its other 6 "LORE" mentions in this file) to describe the
real two-tier reality: sssketch's own riff library always present and
working out of the box, an optional real external-LORE-archive connection
as an add-on.
EOF
)"
```

---

### Task 15: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Full typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: no errors

- [ ] **Step 3: Full test suite**

Run: `npx vitest run`
Expected: all tests pass except the same pre-existing, unrelated native-engine-binary failures
documented in every prior plan's own verification task in this repo (no compiled
`native-engine/build` in this environment) — total count should be roughly the same as before this
plan (a handful of renamed test files, plus 9 new migration tests across Tasks 11-12, minus zero
deleted tests — this is a pure rename + two new small migrations, no test deletions).

- [ ] **Step 4: Confirm every Bucket-A "lore" identifier/channel/path is genuinely gone**

Run:
```bash
grep -rn -E "LORE|Lore[a-zA-Z]|\blore[A-Z_]|\blore\b" src/ 2>/dev/null | grep -v -E "^src/main/ableton/scaleMapping\.(ts|test\.ts):.*LORE (SCALE_NAMES|'s own)" 
```
Expected: every remaining hit falls into one of these two buckets — verify by reading, don't just
count:
1. **Bucket B** (deliberately untouched, per this plan's own scope): `native-engine/Source/*`
   (not matched by this `src/`-scoped grep, but check separately with
   `grep -rn -i lore native-engine/Source/`), plus the specific `src/shared/`+`src/main/` files
   this plan's own audit named as Bucket B (`buildEngineProject.ts`+test, `format.ts`,
   `spectrogram.ts`, `presetNames.ts`, `pitchContour.ts`, `schedulePlayback.ts`+test,
   `bakeOffset.ts`+test, `exportAudioMaterialization.ts`, `types.ts`, `endlesssApi.ts`'s own
   file-format prose, `projectLibrary.ts`'s own unrelated "LORE-sourced file" comments,
   `Inspector.tsx`), plus the real db filename `warehouse.db3` and its `cache/common/` sub-path
   convention (kept verbatim for external-archive compatibility, see Task 2).
2. **Historical/comment-only mentions of the already-deleted `LoreLibraryBrowser.tsx` component**
   (`App.tsx`, `previewLoop.ts`, `BeatPicker.tsx`, `OnboardingModal.tsx`, `RiffCircle.tsx`,
   `Shelf.tsx`, `SketchStrip.tsx`, `BusyContext.tsx`, `riffCircleColor.ts`, `reOneScoring.ts`,
   `visuals.ts`, `riffFavourites.ts`, `riffFavouritesMigration.ts`, `store.ts`+test,
   `tokens.css`) — a deliberate scope decision made while writing this plan (see its own
   "Design decisions" section at the top); flag any surprise here rather than silently accepting
   it.

If a hit doesn't fall into either bucket — i.e. it's a real, still-live Bucket-A identifier this
plan was supposed to rename — STOP and fix it before proceeding.

- [ ] **Step 5: Confirm every renamed IPC channel string is genuinely gone from shipped code**

Run:
```bash
grep -rn "lore-warehouse-available\|lore-warehouse-root\|lore-set-warehouse-root\|lore-list-jams\|lore-list-riffs\|lore-resolve-riff\|lore-resolve-riff-with-context\|lore-download-missing-stems\|lore-sync-start-shared-feed\|lore-sync-start-jam\|lore-sync-status\|lore-sync-abort\|lore-remove-jam-sync\|lore-sync-progress" src/
```
Expected: no output

- [ ] **Step 6: Confirm the new channel + relocated paths are wired correctly**

Run:
```bash
grep -n "riff-library-is-own" src/main/index.ts src/preload/index.ts
grep -n "sssketch', 'projects'" src/main/projectLibrary.ts
grep -n "sssketch', 'library'" src/main/riffLibrarySchema.ts
```
Expected: each grep returns at least one match

- [ ] **Step 7: Manual walkthrough — flag explicitly, don't claim it was done**

This plan touches a real request/response IPC contract (main↔preload channel renames, Task 7) and
two filesystem migrations that move real user data (Tasks 11-12) — none of which have automated
coverage for the actual end-to-end wiring. A coding agent cannot click through the real app in
this environment. Before this ships, a human needs to:
1. Open the real app on a machine with existing content at BOTH old default locations (a real
   `~/Music/sssketch/<sketch-name>/` and a real `<userData>/lore-warehouse/`), launch it once, and
   confirm both migrated to their new sibling locations under `~/Music/sssketch/` with nothing
   lost.
2. Open the riff library browser, browse a jam, sync, download missing stems, and import a riff —
   confirm the imported riff's generated name now says "library" (not "lore"), and that the
   settings menu's "change riff archive location…" still works end to end (pick a real external
   LORE-synced folder if one is available, confirm the browser switches to it and a subsequently
   imported riff's name says "lore" instead).
3. Confirm an existing `localStorage['sssketch:loreUsername']` value (set before this plan
   shipped) survives into `sssketch:riffLibraryUsername` on first load after upgrading, and that
   the old key is gone from localStorage afterward.

Say so explicitly in any completion report — this needs a real logged-in Endlesss account and
real pre-existing on-disk content, and cannot be completed by an implementer subagent solo.

- [ ] **Step 8: Commit (only if Steps 1-6 required any fixes not already committed)**

```bash
git add -A
git commit -m "$(cat <<'EOF'
Fix verification issues found in full-suite run
EOF
)"
```
