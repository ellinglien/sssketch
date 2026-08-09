# LORE Warehouse Sync — Favourites Migration (Plan 2a of 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move riff favourites from the old flat JSON file (`riffFavourites.ts`) onto the new
SQLite warehouse's `Tags` table (built in Plan 1, `docs/superpowers/plans/2026-08-09-lore-warehouse-sync-backend.md`),
via a one-time idempotent migration, then repoint the existing `list-riff-favourites`/
`toggle-riff-favourite` IPC channels at it.

**Architecture:** Add two DB-injected functions to the already-shipped `loreWarehouseWriter.ts`
(`listWarehouseFavourites`/`toggleWarehouseFavourite`), a migration function that copies
`riffFavourites.json`'s existing riffCIDs into `Tags` rows (idempotent via `ON CONFLICT DO
NOTHING`, safe to run on every app startup), wire that migration into `app.whenReady()` next to
the existing `migrateEndlesssStemCache()` call, then swap the two existing IPC handlers over.

**Tech Stack:** TypeScript, `better-sqlite3`, Vitest.

**Scope note — this is Plan 2a of 3.** Per the design spec
(`docs/superpowers/specs/2026-08-09-lore-warehouse-sync-design.md`)'s Migration section, the
full cutover also requires merging the two library browser UI components and retiring
`endlesssSyncIndex.ts`/`endlesssSync.ts`/`riffFavourites.ts` for good — that's a separate,
much larger "Plan 2b" (browser merge + old-file removal), not yet written, because it also needs
to resolve a real architectural gap this plan doesn't touch: `loreWarehouse.ts`'s stem-path
resolution (`resolveStemPath`) assumes a jam-sharded `stem_v2` folder layout, which doesn't match
where Plan 1's sync actually downloads stem audio (the existing content-addressed
`endlesss-cache/stems/` cache, reused as-is via `downloadMissingStemsFor`) — so reading riff/stem
data from the self-built warehouse through `loreWarehouse.ts` unmodified would report every stem
as uncached. That's a UI-merge-time problem (nothing reads riff/stem data from the self-built
warehouse until the browsers are wired to it), not a favourites-migration-time problem, so it's
explicitly out of scope here. `riffFavourites.ts` itself is deliberately NOT deleted by this
plan — it's kept as the migration's read source until Plan 2b confirms it's safe to retire.

---

### Task 1: `loreWarehouseWriter.ts` — Tags read/write + schema tweak

**Files:**
- Modify: `src/main/loreWarehouseSchema.ts`
- Modify: `src/main/loreWarehouseWriter.ts`
- Test: `src/main/loreWarehouseWriter.test.ts`

`Tags.OwnerJamCID` is currently `NOT NULL`, but a legacy-migrated favourite (Task 2) has no known
jam — the old `riffFavourites.json` format is just a flat list of riffCIDs, no jam association.
Since nothing has ever written a real `Tags` row yet (Plan 1 only created the table), relaxing
this constraint is a safe, zero-risk schema tweak, not a behavior change to anything shipped.

- [ ] **Step 1: Write the failing test**

Add to `src/main/loreWarehouseWriter.test.ts` (reuse the existing `freshDb()` helper already in
this file — but it needs one line changed first, see Step 1a):

**Step 1a:** In `freshDb()`'s DDL string (near the top of the file), change:
```sql
CREATE TABLE Tags (RiffCID TEXT PRIMARY KEY, OwnerJamCID TEXT NOT NULL, Favour INTEGER NOT NULL DEFAULT 0, Note TEXT);
```
to:
```sql
CREATE TABLE Tags (RiffCID TEXT PRIMARY KEY, OwnerJamCID TEXT, Favour INTEGER NOT NULL DEFAULT 0, Note TEXT);
```
(This mirrors the real schema change Step 3 below makes to `loreWarehouseSchema.ts` — the test
fixture DDL in this file is a hand-duplicated copy, same convention already established in Task 3
of the original backend plan.)

**Step 1b:** Add these tests to the `describe('loreWarehouseWriter', ...)` block:

```typescript
  it('toggleWarehouseFavourite favourites a riff not yet in Tags, looking up its OwnerJamCID from Riffs if known', () => {
    upsertJam(db, 'jam_1', 'Jam')
    writeRiffDetail(db, 'jam_1', { creationTime: 100, userName: 'elling' }, resolvedRiffFixture())
    const ids = toggleWarehouseFavourite(db, 'riff_1')
    expect(ids).toEqual(['riff_1'])
    const row = db.prepare('SELECT OwnerJamCID, Favour FROM Tags WHERE RiffCID = ?').get('riff_1') as {
      OwnerJamCID: string
      Favour: number
    }
    expect(row).toEqual({ OwnerJamCID: 'jam_1', Favour: 1 })
  })

  it('toggleWarehouseFavourite favourites a riff with unknown jam as null OwnerJamCID', () => {
    const ids = toggleWarehouseFavourite(db, 'unsynced_riff')
    expect(ids).toEqual(['unsynced_riff'])
    const row = db.prepare('SELECT OwnerJamCID FROM Tags WHERE RiffCID = ?').get('unsynced_riff') as {
      OwnerJamCID: string | null
    }
    expect(row.OwnerJamCID).toBeNull()
  })

  it('toggleWarehouseFavourite un-favourites an already-favourited riff', () => {
    toggleWarehouseFavourite(db, 'riff_1')
    const ids = toggleWarehouseFavourite(db, 'riff_1')
    expect(ids).toEqual([])
    const row = db.prepare('SELECT Favour FROM Tags WHERE RiffCID = ?').get('riff_1') as { Favour: number }
    expect(row.Favour).toBe(0)
  })

  it('listWarehouseFavourites returns only riffCIDs with Favour = 1', () => {
    toggleWarehouseFavourite(db, 'riff_1')
    toggleWarehouseFavourite(db, 'riff_2')
    toggleWarehouseFavourite(db, 'riff_2') // un-favourite
    expect(listWarehouseFavourites(db).sort()).toEqual(['riff_1'])
  })
```

Also add `toggleWarehouseFavourite, listWarehouseFavourites` to the existing `import { ... } from
'./loreWarehouseWriter'` line at the top of the test file.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/loreWarehouseWriter.test.ts -t "Favourite"`
Expected: FAIL — `toggleWarehouseFavourite`/`listWarehouseFavourites` don't exist yet, and/or the
DDL still has `OwnerJamCID TEXT NOT NULL` so the "unknown jam" test would fail on a NOT NULL
constraint even once the functions exist.

- [ ] **Step 3: Relax the real schema + write the implementation**

In `src/main/loreWarehouseSchema.ts`, change the `Tags` table DDL:

```sql
CREATE TABLE IF NOT EXISTS Tags (
  RiffCID TEXT PRIMARY KEY,
  OwnerJamCID TEXT,
  Favour INTEGER NOT NULL DEFAULT 0,
  Note TEXT
);
```

(only `OwnerJamCID TEXT NOT NULL` → `OwnerJamCID TEXT` changes — everything else identical.)

In `src/main/loreWarehouseWriter.ts`, add these two functions (near the end of the file, after
`getWarehouseSyncStatus` or wherever fits the file's existing organization):

```typescript
/** Every currently-favourited riffCID, in no particular order -- the
 * renderer sorts/displays them however it needs. */
export function listWarehouseFavourites(db: Database.Database): string[] {
  const rows = db.prepare(`SELECT RiffCID FROM Tags WHERE Favour = 1`).all() as { RiffCID: string }[]
  return rows.map((r) => r.RiffCID)
}

/** Toggles one riff's favourite status and returns the updated full list,
 * matching riffFavourites.ts's old toggleFavouriteRiff contract exactly (so
 * the IPC handler/renderer side needs no changes beyond which function it
 * calls). Looks up the riff's OwnerJamCID from Riffs if it's already synced
 * -- if it's not (e.g. favourited via the old on-demand browsing path that
 * never got warehouse-synced), OwnerJamCID is left NULL rather than
 * blocking the favourite; Tags.OwnerJamCID is nullable for exactly this
 * reason (see this plan's Task 1). */
export function toggleWarehouseFavourite(db: Database.Database, riffCID: string): string[] {
  const existing = db.prepare(`SELECT Favour FROM Tags WHERE RiffCID = ?`).get(riffCID) as
    | { Favour: number }
    | undefined
  if (existing?.Favour === 1) {
    db.prepare(`UPDATE Tags SET Favour = 0 WHERE RiffCID = ?`).run(riffCID)
  } else {
    const jamRow = db.prepare(`SELECT OwnerJamCID FROM Riffs WHERE RiffCID = ?`).get(riffCID) as
      | { OwnerJamCID: string }
      | undefined
    db.prepare(
      `INSERT INTO Tags (RiffCID, OwnerJamCID, Favour) VALUES (?, ?, 1)
       ON CONFLICT(RiffCID) DO UPDATE SET Favour = 1, OwnerJamCID = excluded.OwnerJamCID`
    ).run(riffCID, jamRow?.OwnerJamCID ?? null)
  }
  return listWarehouseFavourites(db)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/loreWarehouseWriter.test.ts`
Expected: PASS (all tests in the file, including the pre-existing ones — confirms the schema
tweak didn't break anything already covered)

- [ ] **Step 5: Commit**

```bash
git add src/main/loreWarehouseSchema.ts src/main/loreWarehouseWriter.ts src/main/loreWarehouseWriter.test.ts
git commit -m "$(cat <<'EOF'
Add Tags read/write to loreWarehouseWriter.ts; make Tags.OwnerJamCID nullable

A legacy-migrated favourite (next task) has no known jam -- the old
riffFavourites.json format is just a flat riffCID list. Nothing has written
a real Tags row yet, so relaxing this constraint is a safe, zero-risk tweak.
EOF
)"
```

---

### Task 2: Legacy favourites migration function

**Files:**
- Create: `src/main/riffFavouritesMigration.ts`
- Test: `src/main/riffFavouritesMigration.test.ts`

Mirrors `stemCacheMigration.ts`'s own shape (a small, focused, idempotent one-purpose migration
module) rather than folding this logic into `loreWarehouseWriter.ts` — this keeps the "migrate
from the old system" concern separate from "read/write the new system's own data," matching how
`stemCacheMigration.ts` itself is already a separate file from the cache-path logic it migrates
into.

- [ ] **Step 1: Write the failing test**

```typescript
// src/main/riffFavouritesMigration.test.ts
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'

let userDataDir: string

vi.mock('electron', () => ({
  app: {
    getPath: () => userDataDir
  }
}))

function freshDb(): Database.Database {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE Jams (JamCID TEXT PRIMARY KEY, PublicName TEXT NOT NULL, SyncComplete INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE Riffs (
      RiffCID TEXT PRIMARY KEY, OwnerJamCID TEXT NOT NULL, CreationTime INTEGER,
      Root INTEGER, Scale INTEGER, BPMrnd REAL, BarLength INTEGER, UserName TEXT,
      StemCID_1 TEXT, StemCID_2 TEXT, StemCID_3 TEXT, StemCID_4 TEXT,
      StemCID_5 TEXT, StemCID_6 TEXT, StemCID_7 TEXT, StemCID_8 TEXT,
      GainsJSON TEXT, AppVersion INTEGER
    );
    CREATE TABLE Stems (
      StemCID TEXT PRIMARY KEY, OwnerJamCID TEXT NOT NULL, CreationTime INTEGER,
      FileEndpoint TEXT, FileBucket TEXT, FileKey TEXT, BPMrnd REAL, Instrument INTEGER,
      Length16s REAL, PresetName TEXT, CreatorUserName TEXT
    );
    CREATE TABLE Tags (RiffCID TEXT PRIMARY KEY, OwnerJamCID TEXT, Favour INTEGER NOT NULL DEFAULT 0, Note TEXT);
    CREATE TABLE StemLedger (StemCID TEXT PRIMARY KEY, Type TEXT NOT NULL, Note TEXT);
  `)
  return db
}

describe('riffFavouritesMigration', () => {
  beforeEach(() => {
    userDataDir = mkdtempSync(join(tmpdir(), 'sssketch-favourites-migration-test-'))
  })

  afterEach(() => {
    rmSync(userDataDir, { recursive: true, force: true })
  })

  it('copies every legacy favourite into Tags as a new favourited row', async () => {
    writeFileSync(
      join(userDataDir, 'riffFavourites.json'),
      JSON.stringify({ riffCIDs: ['riff_1', 'riff_2'] })
    )
    const { migrateLegacyFavourites } = await import('./riffFavouritesMigration')
    const db = freshDb()
    migrateLegacyFavourites(db)
    const rows = db.prepare('SELECT RiffCID, Favour FROM Tags ORDER BY RiffCID').all()
    expect(rows).toEqual([
      { RiffCID: 'riff_1', Favour: 1 },
      { RiffCID: 'riff_2', Favour: 1 }
    ])
  })

  it('is idempotent -- running it twice does not error or duplicate rows', async () => {
    writeFileSync(join(userDataDir, 'riffFavourites.json'), JSON.stringify({ riffCIDs: ['riff_1'] }))
    const { migrateLegacyFavourites } = await import('./riffFavouritesMigration')
    const db = freshDb()
    migrateLegacyFavourites(db)
    migrateLegacyFavourites(db)
    const rows = db.prepare('SELECT COUNT(*) as n FROM Tags').get() as { n: number }
    expect(rows.n).toBe(1)
  })

  it('does not overwrite an existing Tags row that was already un-favourited in the new system', async () => {
    writeFileSync(join(userDataDir, 'riffFavourites.json'), JSON.stringify({ riffCIDs: ['riff_1'] }))
    const { migrateLegacyFavourites } = await import('./riffFavouritesMigration')
    const db = freshDb()
    db.prepare('INSERT INTO Tags (RiffCID, OwnerJamCID, Favour) VALUES (?, NULL, 0)').run('riff_1')
    migrateLegacyFavourites(db)
    const row = db.prepare('SELECT Favour FROM Tags WHERE RiffCID = ?').get('riff_1') as { Favour: number }
    expect(row.Favour).toBe(0)
  })

  it('does nothing when no legacy favourites file exists', async () => {
    const { migrateLegacyFavourites } = await import('./riffFavouritesMigration')
    const db = freshDb()
    expect(() => migrateLegacyFavourites(db)).not.toThrow()
    const rows = db.prepare('SELECT COUNT(*) as n FROM Tags').get() as { n: number }
    expect(rows.n).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/riffFavouritesMigration.test.ts`
Expected: FAIL with "Cannot find module './riffFavouritesMigration'"

- [ ] **Step 3: Write the implementation**

```typescript
// src/main/riffFavouritesMigration.ts
import type Database from 'better-sqlite3'
import { listFavouriteRiffCIDs } from './riffFavourites'

/** One-time-in-spirit, idempotent-in-practice migration copying every
 * riffCID from the old flat-JSON favourites file (riffFavourites.ts) into
 * the new warehouse's Tags table -- see docs/superpowers/plans/
 * 2026-08-09-lore-warehouse-favourites-migration.md. Safe to call on every
 * app startup: `INSERT ... ON CONFLICT(RiffCID) DO NOTHING` means an
 * already-migrated riff (whether still favourited or since un-favourited
 * through the new system) is left completely alone -- this migration only
 * ever ADDS a row for a legacy favourite it's never seen before, never
 * overwrites. riffFavourites.ts's own listFavouriteRiffCIDs() already
 * returns [] (never throws) when no favourites file exists yet, so no
 * separate existence check is needed here. */
export function migrateLegacyFavourites(db: Database.Database): void {
  const legacyRiffCIDs = listFavouriteRiffCIDs()
  if (legacyRiffCIDs.length === 0) return
  const insert = db.prepare(
    `INSERT INTO Tags (RiffCID, OwnerJamCID, Favour) VALUES (?, NULL, 1)
     ON CONFLICT(RiffCID) DO NOTHING`
  )
  const txn = db.transaction((riffCIDs: string[]) => {
    for (const riffCID of riffCIDs) insert.run(riffCID)
  })
  txn(legacyRiffCIDs)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/riffFavouritesMigration.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/riffFavouritesMigration.ts src/main/riffFavouritesMigration.test.ts
git commit -m "$(cat <<'EOF'
Add riffFavouritesMigration.ts: copy legacy favourites into Tags

Idempotent via ON CONFLICT DO NOTHING -- only ever adds a row for a legacy
favourite never seen before, never overwrites a Tags row the new system has
already touched.
EOF
)"
```

---

### Task 3: Wire the migration into app startup

**Files:**
- Modify: `src/main/index.ts`

- [ ] **Step 1: Add the import and call**

Near the existing `import { migrateEndlesssStemCache } from './stemCacheMigration'` line, add:

```typescript
import { migrateLegacyFavourites } from './riffFavouritesMigration'
import { openOwnWarehouseDb } from './loreWarehouseSchema'
```

(`openOwnWarehouseDb` may already be imported from an earlier Plan 1 task — check first and don't
duplicate the import if so; just add it to the existing import line if one exists.)

Immediately after the existing `migrateEndlesssStemCache()` call inside `app.whenReady().then(async () => { ... })`, add:

```typescript
  // One-time-in-spirit, idempotent migration of favourites off the old
  // flat-JSON file onto the new warehouse's Tags table -- see
  // riffFavouritesMigration.ts's own doc comment for why this is safe to
  // run unconditionally on every startup.
  migrateLegacyFavourites(openOwnWarehouseDb())
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/main/index.ts
git commit -m "$(cat <<'EOF'
Wire migrateLegacyFavourites into app startup, next to the stem-cache migration
EOF
)"
```

---

### Task 4: Repoint favourites IPC handlers to the new warehouse

**Files:**
- Modify: `src/main/index.ts`

No preload changes needed — `listRiffFavourites`/`toggleRiffFavourite`'s signatures in
`src/preload/index.ts` are unchanged; only which functions the main-process handlers call
changes. No renderer changes needed either (`StoreContext.tsx`'s favourites hooks only ever call
through `window.rifffApi.listRiffFavourites()`/`toggleRiffFavourite()`, never touch
`riffFavourites.ts` directly).

- [ ] **Step 1: Swap the import and the two handler bodies**

In `src/main/index.ts`, remove this line:

```typescript
import { listFavouriteRiffCIDs, toggleFavouriteRiff } from './riffFavourites'
```

(`riffFavourites.ts` itself is NOT deleted — `riffFavouritesMigration.ts` still imports
`listFavouriteRiffCIDs` from it directly. Only this specific import in `index.ts` is removed,
since `index.ts` no longer calls these two functions directly.)

Add `listWarehouseFavourites, toggleWarehouseFavourite` to the existing `loreWarehouseWriter`
import (the one already used by `getWarehouseSyncStatus` from Plan 1's Task 6 — add these two
names to that same import statement rather than creating a second one).

Replace:

```typescript
  ipcMain.handle('list-riff-favourites', () => listFavouriteRiffCIDs())

  ipcMain.handle('toggle-riff-favourite', (_event, riffCID: string) => toggleFavouriteRiff(riffCID))
```

with:

```typescript
  ipcMain.handle('list-riff-favourites', () => listWarehouseFavourites(openOwnWarehouseDb()))

  ipcMain.handle('toggle-riff-favourite', (_event, riffCID: string) =>
    toggleWarehouseFavourite(openOwnWarehouseDb(), riffCID)
  )
```

(channel names `'list-riff-favourites'`/`'toggle-riff-favourite'` are unchanged — only which
functions back them.)

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 3: Manual smoke check (documented, not automatable)**

This is an IPC-wiring change with no dedicated test file, matching this codebase's established
convention (see Plan 1's Task 6). A real verification of "favourites still work end to end"
needs the running app (favourite a riff in one of the existing browsers, quit, relaunch, confirm
it's still favourited, confirm it now round-trips through `Tags` instead of
`riffFavourites.json`) — flag this explicitly as needing manual verification, don't claim it was
done if only typecheck/lint/unit-tests were run.

- [ ] **Step 4: Commit**

```bash
git add src/main/index.ts
git commit -m "$(cat <<'EOF'
Repoint list-riff-favourites/toggle-riff-favourite IPC at the warehouse Tags table

riffFavourites.ts itself stays -- riffFavouritesMigration.ts still reads it
as the migration source. Channel names and the preload/renderer contract
are both unchanged.
EOF
)"
```

---

### Task 5: Full verification

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
already documented in Plan 1's own Task 7 (this worktree has no compiled `native-engine/build`)

- [ ] **Step 4: Manual walkthrough — flag explicitly, don't claim it was done**

Same limitation as Plan 1: favouriting/un-favouriting a riff through the real running app (either
existing browser) and confirming it survives a restart and now lives in the SQLite warehouse
(inspectable via a SQLite browser at `~/Library/Application Support/sssketch/lore-warehouse/
cache/common/warehouse.db3`) requires the real app running with a real Endlesss login/library —
cannot be completed by an implementer subagent solo.

- [ ] **Step 5: Commit (only if Steps 1-3 required any fixes not already committed)**

```bash
git add -A
git commit -m "$(cat <<'EOF'
Fix verification issues found in full-suite run
EOF
)"
```
