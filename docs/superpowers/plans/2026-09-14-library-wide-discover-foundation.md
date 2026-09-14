# Library-Wide Discover — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the persistence foundation for Library-Wide Discover: a new library-wide `StemCategories` table, forward-capture writes from Tidy Up and Auto-Arrange/Draw Arrangement, a one-time backfill migration recovering bus categorization trapped in old project files, and — per Elling's own explicit request that no individual screen should have its own scanning feature — a persistent, cross-session `StemFeatureCache` table plus an ambient background scan, so opening Tidy Up or Auto-Arrange typically finds its stems already analyzed rather than visibly waiting on a scan.

**Architecture:** This is Plan A of three sequential plans implementing `docs/superpowers/specs/2026-09-14-library-wide-discover-design.md` (§1-§3 and §9's consolidation work here; §6-§7 accuracy classifiers and §4-§5/§8 the discover screen itself are separate later plans that build on this one). Nothing in this plan is user-facing — no new screen, no new menu item. It ships as a working, independently testable persistence layer: two new SQLite tables that existing screens now read from and write into as a side effect of actions they already perform, a startup migration recovering old data, and a top-level ambient scan that runs independent of which screen (if any) is open. Verified via real `vitest` unit tests for every pure/DB function, and a manual walkthrough confirming both existing screens still behave exactly as before (functionally) while no longer visibly waiting on analysis once the background scan has caught up.

**Tech Stack:** better-sqlite3 (existing `warehouse.db3`), Electron IPC (existing `ipcMain.handle`/`contextBridge` pattern), React hooks.

---

## Important context for every task below

**Content-addressed stem paths.** A stem imported from the synced riff library has a `path` whose basename IS its `StemCID`, no extension — confirmed by reading `resolveStemPath` (`src/main/riffLibraryStore.ts:167-182`): both the own-warehouse case (`.../endlesss-cache/stems/<shard>/<StemCID>`) and the external-LORE case (`.../stem_v2/<JamCID>/<shard>/<StemCID>`) end in the bare `StemCID`. This plan relies on that fact to recover a `StemCID` from a placed stem's `path` — the in-project `Stem` type (`src/shared/types.ts`) carries no `StemCID` field of its own. A locally-dropped file, one-shot sample, or in-app recording has a `path` whose basename is NOT a real `StemCID` — every write function below validates the derived candidate against the real `Stems` table and silently skips anything that doesn't match, rather than writing garbage rows.

**Column-scoped upserts, not whole-row overwrites.** Per the design spec's §1, a `StemCategories` row can have `ArrangeRole`/`DrumSubRole` set without `BusId` or vice versa — "both are genuinely independent, partial signals worth keeping." Every upsert below only lists the columns its own axis (bus vs. role) actually knows about in its `ON CONFLICT DO UPDATE SET` clause, so a bus-only write never nulls out a role that was already there, and vice versa.

**Order-independent "most recent wins."** Per §2/§3, a stem categorized more than once keeps whichever write is newest. Rather than relying on call order, every upsert's `ON CONFLICT` clause carries `WHERE excluded.UpdatedAt >= StemCategories.UpdatedAt` — SQLite's conditional-upsert syntax (supported by better-sqlite3's bundled SQLite). This makes both the backfill migration (§3, which needs cross-file "most recent project wins" behavor) and forward capture (§2) correct regardless of what order their entries happen to be processed in.

**`UpdatedAt` is always passed in, never computed inside the writer.** Forward capture passes `Math.floor(Date.now() / 1000)`; backfill passes each project file's own `mtimeMs`. Keeping this an explicit parameter (not a hidden `Date.now()` call) is also what makes the writer functions cleanly unit-testable with a fixed value.

---

### Task 1: `StemCategories` table

**Files:**
- Modify: `src/main/riffLibrarySchema.ts`
- Modify: `src/main/riffLibrarySchema.test.ts:39`

- [ ] **Step 1: Update the existing table-list test to expect the new table (red)**

In `src/main/riffLibrarySchema.test.ts`, change line 39 from:

```ts
    expect(tables.map((t) => t.name)).toEqual(['Jams', 'Riffs', 'StemLedger', 'Stems', 'Tags'])
```

to:

```ts
    expect(tables.map((t) => t.name)).toEqual([
      'Jams',
      'Riffs',
      'StemCategories',
      'StemLedger',
      'Stems',
      'Tags'
    ])
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/main/riffLibrarySchema.test.ts`
Expected: FAIL — actual table list has no `StemCategories`.

- [ ] **Step 3: Add the table to `SCHEMA_SQL`**

In `src/main/riffLibrarySchema.ts`, in the `SCHEMA_SQL` template string, add this new table right after the existing `StemLedger` table (before the closing backtick):

```sql

CREATE TABLE IF NOT EXISTS StemCategories (
  StemCID TEXT PRIMARY KEY,
  ArrangeRole TEXT,
  DrumSubRole TEXT,
  BusId TEXT,
  Source TEXT NOT NULL,
  SourceProject TEXT,
  UpdatedAt INTEGER NOT NULL
);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/main/riffLibrarySchema.test.ts`
Expected: PASS (all 4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/riffLibrarySchema.ts src/main/riffLibrarySchema.test.ts
git commit -m "$(cat <<'EOF'
Add StemCategories table to the riff library schema

The library-wide-discover feature's persistent record of hand-confirmed
stem categorization (bus, arrange role, drum sub-role), keyed by StemCID.
See docs/superpowers/specs/2026-09-14-library-wide-discover-design.md §1.
EOF
)"
```

---

### Task 2: `stemCategoriesStore.ts` — read/write functions

**Files:**
- Create: `src/main/stemCategoriesStore.ts`
- Create: `src/main/stemCategoriesStore.test.ts`
- Modify: `src/shared/types.ts`

- [ ] **Step 1: Add the `ProjectRef` type to `src/shared/types.ts`**

Add this near the other small exported types (e.g. right after `BusId`'s own declaration):

```ts
/** Serializable reference to "which currently-open project" a forward-
 * captured StemCategories write came from -- crosses the IPC boundary as
 * plain data. Structurally identical to App.tsx's own local `CurrentSketch`
 * state (kept as a separate declaration here rather than imported from
 * App.tsx, since main-process code needs this same shape without pulling in
 * any renderer-only module, and TypeScript's structural typing means a
 * `CurrentSketch` value assigns into a `ProjectRef`-typed prop with no cast
 * needed). null means nothing has been saved/opened yet -- the resulting
 * StemCategories row's SourceProject is null in that case. */
export type ProjectRef =
  | { kind: 'library'; name: string }
  | { kind: 'external'; path: string }
  | null
```

- [ ] **Step 2: Write the failing tests**

Create `src/main/stemCategoriesStore.test.ts`:

```ts
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let musicDir: string

vi.mock('electron', () => ({
  app: {
    getPath: () => musicDir
  }
}))

function freshDb(): Database.Database {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE StemCategories (
      StemCID TEXT PRIMARY KEY, ArrangeRole TEXT, DrumSubRole TEXT, BusId TEXT,
      Source TEXT NOT NULL, SourceProject TEXT, UpdatedAt INTEGER NOT NULL
    );
    CREATE TABLE Stems (StemCID TEXT PRIMARY KEY);
  `)
  return db
}

describe('stemCategoriesStore', () => {
  beforeEach(() => {
    musicDir = mkdtempSync(join(tmpdir(), 'sssketch-stemcategories-test-'))
  })

  afterEach(() => {
    rmSync(musicDir, { recursive: true, force: true })
  })

  describe('resolveSourceProjectPath', () => {
    it('resolves a library-kind project ref to its real .sssketchproj path', async () => {
      const { resolveSourceProjectPath } = await import('./stemCategoriesStore')
      const result = resolveSourceProjectPath({ kind: 'library', name: 'my-sketch' })
      expect(result).toBe(join(musicDir, 'sssketch', 'projects', 'my-sketch', 'my-sketch.sssketchproj'))
    })

    it('passes an external-kind project ref straight through', async () => {
      const { resolveSourceProjectPath } = await import('./stemCategoriesStore')
      expect(resolveSourceProjectPath({ kind: 'external', path: '/tmp/foo.sssketchproj' })).toBe(
        '/tmp/foo.sssketchproj'
      )
    })

    it('resolves null to null', async () => {
      const { resolveSourceProjectPath } = await import('./stemCategoriesStore')
      expect(resolveSourceProjectPath(null)).toBe(null)
    })
  })

  describe('upsertStemCategoryBus', () => {
    it('writes a BusId row for a stem whose path basename matches a real StemCID', () => {
      const db = freshDb()
      db.prepare(`INSERT INTO Stems (StemCID) VALUES (?)`).run('cid-1')
      const { upsertStemCategoryBus, getStemCategory } = require('./stemCategoriesStore')
      upsertStemCategoryBus(
        db,
        [{ path: '/library/stems/cid-1', busId: 'drums' }],
        'tidyup',
        null,
        1000
      )
      const row = getStemCategory(db, 'cid-1')
      expect(row).toEqual({
        stemCID: 'cid-1',
        arrangeRole: null,
        drumSubRole: null,
        busId: 'drums',
        source: 'tidyup',
        sourceProject: null,
        updatedAt: 1000
      })
    })

    it('skips a stem whose path basename does not match any real StemCID', () => {
      const db = freshDb()
      const { upsertStemCategoryBus, getStemCategory } = require('./stemCategoriesStore')
      upsertStemCategoryBus(
        db,
        [{ path: '/some/local/one-shot.wav', busId: 'drums' }],
        'tidyup',
        null,
        1000
      )
      expect(getStemCategory(db, 'one-shot.wav')).toBe(null)
    })

    it('a newer write overwrites BusId, but an older write does not', () => {
      const db = freshDb()
      db.prepare(`INSERT INTO Stems (StemCID) VALUES (?)`).run('cid-1')
      const { upsertStemCategoryBus, getStemCategory } = require('./stemCategoriesStore')
      upsertStemCategoryBus(db, [{ path: '/x/cid-1', busId: 'drums' }], 'tidyup', null, 2000)
      upsertStemCategoryBus(db, [{ path: '/x/cid-1', busId: 'bass' }], 'backfill', null, 1000)
      expect(getStemCategory(db, 'cid-1')?.busId).toBe('drums')
      upsertStemCategoryBus(db, [{ path: '/x/cid-1', busId: 'lead' }], 'tidyup', null, 3000)
      expect(getStemCategory(db, 'cid-1')?.busId).toBe('lead')
    })

    it('a bus write never touches an existing ArrangeRole/DrumSubRole on the same row', () => {
      const db = freshDb()
      db.prepare(`INSERT INTO Stems (StemCID) VALUES (?)`).run('cid-1')
      const { upsertStemCategoryBus, upsertStemCategoryRole, getStemCategory } = require('./stemCategoriesStore')
      upsertStemCategoryRole(
        db,
        [{ path: '/x/cid-1', arrangeRole: 'lead', drumSubRole: undefined }],
        'autoarrange',
        null,
        1000
      )
      upsertStemCategoryBus(db, [{ path: '/x/cid-1', busId: 'drums' }], 'tidyup', null, 2000)
      const row = getStemCategory(db, 'cid-1')
      expect(row?.arrangeRole).toBe('lead')
      expect(row?.busId).toBe('drums')
    })
  })

  describe('upsertStemCategoryRole', () => {
    it('writes ArrangeRole/DrumSubRole without touching an existing BusId', () => {
      const db = freshDb()
      db.prepare(`INSERT INTO Stems (StemCID) VALUES (?)`).run('cid-1')
      const { upsertStemCategoryBus, upsertStemCategoryRole, getStemCategory } = require('./stemCategoriesStore')
      upsertStemCategoryBus(db, [{ path: '/x/cid-1', busId: 'drums' }], 'tidyup', null, 1000)
      upsertStemCategoryRole(
        db,
        [{ path: '/x/cid-1', arrangeRole: 'drums', drumSubRole: 'kick' }],
        'autoarrange',
        '/some/project.sssketchproj',
        2000
      )
      const row = getStemCategory(db, 'cid-1')
      expect(row).toEqual({
        stemCID: 'cid-1',
        arrangeRole: 'drums',
        drumSubRole: 'kick',
        busId: 'drums',
        source: 'autoarrange',
        sourceProject: '/some/project.sssketchproj',
        updatedAt: 2000
      })
    })

    it('an omitted drumSubRole is stored as null, not undefined/absent', () => {
      const db = freshDb()
      db.prepare(`INSERT INTO Stems (StemCID) VALUES (?)`).run('cid-1')
      const { upsertStemCategoryRole, getStemCategory } = require('./stemCategoriesStore')
      upsertStemCategoryRole(
        db,
        [{ path: '/x/cid-1', arrangeRole: 'bass', drumSubRole: undefined }],
        'drawarrange',
        null,
        1000
      )
      expect(getStemCategory(db, 'cid-1')?.drumSubRole).toBe(null)
    })
  })

  describe('getStemCategory', () => {
    it('returns null for a StemCID with no row', () => {
      const db = freshDb()
      const { getStemCategory } = require('./stemCategoriesStore')
      expect(getStemCategory(db, 'nonexistent')).toBe(null)
    })
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/main/stemCategoriesStore.test.ts`
Expected: FAIL — `Cannot find module './stemCategoriesStore'`.

- [ ] **Step 4: Implement `src/main/stemCategoriesStore.ts`**

```ts
// src/main/stemCategoriesStore.ts
import { basename } from 'node:path'
import type Database from 'better-sqlite3'
import type { BusId, ProjectRef } from '@shared/types'
import type { ArrangeRole, DrumSubRole } from '@shared/stemRole'
import { sketchProjectPath } from './projectLibrary'

/** Resolves a renderer-supplied ProjectRef into the real absolute path
 * StemCategories.SourceProject should carry -- a library-kind sketch is
 * identified by name only in the renderer (App.tsx's own CurrentSketch),
 * but this column needs the same real .sssketchproj path the backfill
 * migration (stemCategoriesBackfill.ts) already writes for the SAME file,
 * so the two are directly comparable rather than looking like two different
 * projects. Called once per IPC write (not per entry) by index.ts's own
 * handlers -- see stemCategoriesBackfill.ts for the migration's own,
 * already-resolved-path case. */
export function resolveSourceProjectPath(project: ProjectRef): string | null {
  if (project === null) return null
  return project.kind === 'library' ? sketchProjectPath(project.name) : project.path
}

/** A stem's on-disk path is content-addressed by its own StemCID for any
 * stem that actually came from the synced riff library (resolveStemPath,
 * riffLibraryStore.ts:167-182 -- the basename IS the StemCID, no
 * extension). A locally-dropped file, one-shot sample, or in-app recording
 * has no such relationship, so the candidate is validated against the real
 * Stems table before anything is written -- silently skipped (not an
 * error) rather than writing a StemCategories row for a StemCID that isn't
 * real. */
function stemCIDForPath(db: Database.Database, path: string): string | null {
  const candidate = basename(path)
  const row = db.prepare(`SELECT 1 FROM Stems WHERE StemCID = ?`).get(candidate)
  return row ? candidate : null
}

export interface StemBusCategoryEntry {
  path: string
  busId: BusId
}

/** Column-scoped: only ever touches BusId/Source/SourceProject/UpdatedAt,
 * never ArrangeRole/DrumSubRole -- see this file's own module-level
 * context in the implementation plan for why a bus write must never clobber
 * an independently-confirmed role on the same row. The `WHERE
 * excluded.UpdatedAt >= StemCategories.UpdatedAt` guard makes this safe to
 * call in any order across multiple sources (forward capture, backfill)
 * without needing to sort by recency first. */
export function upsertStemCategoryBus(
  db: Database.Database,
  entries: StemBusCategoryEntry[],
  source: string,
  sourceProject: string | null,
  updatedAt: number
): void {
  const stmt = db.prepare(
    `INSERT INTO StemCategories (StemCID, BusId, Source, SourceProject, UpdatedAt)
     VALUES (@stemCID, @busId, @source, @sourceProject, @updatedAt)
     ON CONFLICT(StemCID) DO UPDATE SET
       BusId = excluded.BusId,
       Source = excluded.Source,
       SourceProject = excluded.SourceProject,
       UpdatedAt = excluded.UpdatedAt
     WHERE excluded.UpdatedAt >= StemCategories.UpdatedAt`
  )
  const txn = db.transaction((rows: StemBusCategoryEntry[]) => {
    for (const row of rows) {
      const stemCID = stemCIDForPath(db, row.path)
      if (!stemCID) continue
      stmt.run({ stemCID, busId: row.busId, source, sourceProject, updatedAt })
    }
  })
  txn(entries)
}

export interface StemRoleCategoryEntry {
  path: string
  arrangeRole: ArrangeRole
  drumSubRole?: DrumSubRole
}

/** Column-scoped counterpart to upsertStemCategoryBus -- only ever touches
 * ArrangeRole/DrumSubRole/Source/SourceProject/UpdatedAt, never BusId. */
export function upsertStemCategoryRole(
  db: Database.Database,
  entries: StemRoleCategoryEntry[],
  source: string,
  sourceProject: string | null,
  updatedAt: number
): void {
  const stmt = db.prepare(
    `INSERT INTO StemCategories (StemCID, ArrangeRole, DrumSubRole, Source, SourceProject, UpdatedAt)
     VALUES (@stemCID, @arrangeRole, @drumSubRole, @source, @sourceProject, @updatedAt)
     ON CONFLICT(StemCID) DO UPDATE SET
       ArrangeRole = excluded.ArrangeRole,
       DrumSubRole = excluded.DrumSubRole,
       Source = excluded.Source,
       SourceProject = excluded.SourceProject,
       UpdatedAt = excluded.UpdatedAt
     WHERE excluded.UpdatedAt >= StemCategories.UpdatedAt`
  )
  const txn = db.transaction((rows: StemRoleCategoryEntry[]) => {
    for (const row of rows) {
      const stemCID = stemCIDForPath(db, row.path)
      if (!stemCID) continue
      stmt.run({
        stemCID,
        arrangeRole: row.arrangeRole,
        drumSubRole: row.drumSubRole ?? null,
        source,
        sourceProject,
        updatedAt
      })
    }
  })
  txn(entries)
}

export interface StemCategoryRow {
  stemCID: string
  arrangeRole: ArrangeRole | null
  drumSubRole: DrumSubRole | null
  busId: BusId | null
  source: string
  sourceProject: string | null
  updatedAt: number
}

export function getStemCategory(db: Database.Database, stemCID: string): StemCategoryRow | null {
  const row = db
    .prepare(
      `SELECT StemCID, ArrangeRole, DrumSubRole, BusId, Source, SourceProject, UpdatedAt
       FROM StemCategories WHERE StemCID = ?`
    )
    .get(stemCID) as
    | {
        StemCID: string
        ArrangeRole: string | null
        DrumSubRole: string | null
        BusId: string | null
        Source: string
        SourceProject: string | null
        UpdatedAt: number
      }
    | undefined
  if (!row) return null
  return {
    stemCID: row.StemCID,
    arrangeRole: row.ArrangeRole as ArrangeRole | null,
    drumSubRole: row.DrumSubRole as DrumSubRole | null,
    busId: row.BusId as BusId | null,
    source: row.Source,
    sourceProject: row.SourceProject,
    updatedAt: row.UpdatedAt
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/main/stemCategoriesStore.test.ts`
Expected: PASS (all tests).

- [ ] **Step 6: Run typecheck**

Run: `npm run typecheck`
Expected: no errors. (The test file's `require(...)` calls inside `it()` bodies are a deliberate departure from this file's own dynamic-`import()`-per-test convention used for the `electron`-mocked tests above them — `upsertStemCategoryBus`/`upsertStemCategoryRole`/`getStemCategory` don't depend on the mocked `electron` module at all, so a plain top-of-describe-block `require` avoids repeating `await import(...)` in every single one of those test bodies. If `require` is unavailable in this project's vitest/ESM config, use `await import('./stemCategoriesStore')` at the top of each of those `it` bodies instead — check `riffLibraryWriter.test.ts` for this codebase's own convention if in doubt.)

- [ ] **Step 7: Commit**

```bash
git add src/main/stemCategoriesStore.ts src/main/stemCategoriesStore.test.ts src/shared/types.ts
git commit -m "$(cat <<'EOF'
Add stemCategoriesStore.ts: column-scoped, order-independent upserts

upsertStemCategoryBus/upsertStemCategoryRole each only ever touch their
own axis's columns (never clobbering the other's independently-confirmed
data on the same row), and use a conditional ON CONFLICT so "most recent
write wins" holds regardless of call order -- needed by both forward
capture and the backfill migration. Stem paths are validated against the
real Stems table (content-addressed by StemCID) before anything is
written, silently skipping any locally-dropped/one-shot/recorded stem
that was never part of the synced library.
EOF
)"
```

---

### Task 3: IPC handlers + preload bridge

**Files:**
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`

- [ ] **Step 1: Add imports and IPC handlers to `src/main/index.ts`**

Near the top, alongside the existing `riffLibraryWriter`/`busCentroidStore` imports, add:

```ts
import {
  upsertStemCategoryBus,
  upsertStemCategoryRole,
  resolveSourceProjectPath,
  type StemBusCategoryEntry,
  type StemRoleCategoryEntry
} from './stemCategoriesStore'
import type { ProjectRef } from '@shared/types'
```

Near the existing `get-bus-centroids`/`save-bus-centroids` handlers (around line 688-692), add:

```ts
  ipcMain.handle(
    'upsert-stem-category-bus',
    (_event, entries: StemBusCategoryEntry[], source: string, project: ProjectRef) => {
      upsertStemCategoryBus(
        openOwnRiffLibraryDb(),
        entries,
        source,
        resolveSourceProjectPath(project),
        Math.floor(Date.now() / 1000)
      )
    }
  )

  ipcMain.handle(
    'upsert-stem-category-role',
    (_event, entries: StemRoleCategoryEntry[], source: string, project: ProjectRef) => {
      upsertStemCategoryRole(
        openOwnRiffLibraryDb(),
        entries,
        source,
        resolveSourceProjectPath(project),
        Math.floor(Date.now() / 1000)
      )
    }
  )
```

- [ ] **Step 2: Add preload bridge methods**

In `src/preload/index.ts`, change the existing `@shared/types` import (currently `import type { Rifff, Stem } from '@shared/types'`) to also pull in `BusId` and `ProjectRef`:

```ts
import type { Rifff, Stem, BusId, ProjectRef } from '@shared/types'
```

Add a new import for the role types:

```ts
import type { ArrangeRole, DrumSubRole } from '@shared/stemRole'
```

Near the existing `getBusCentroids`/`saveBusCentroids` entries in the `api` object, add:

```ts
  upsertStemCategoryBus: (
    entries: { path: string; busId: BusId }[],
    source: string,
    project: ProjectRef
  ): Promise<void> => ipcRenderer.invoke('upsert-stem-category-bus', entries, source, project),
  upsertStemCategoryRole: (
    entries: { path: string; arrangeRole: ArrangeRole; drumSubRole?: DrumSubRole }[],
    source: string,
    project: ProjectRef
  ): Promise<void> => ipcRenderer.invoke('upsert-stem-category-role', entries, source, project),
```

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Run lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/main/index.ts src/preload/index.ts
git commit -m "$(cat <<'EOF'
Wire StemCategories writes through IPC (upsert-stem-category-bus/-role)

Exposes stemCategoriesStore.ts's two writer functions to the renderer as
window.rifffApi.upsertStemCategoryBus/upsertStemCategoryRole. Not called
from anywhere yet -- forward-capture call sites land in later tasks.
EOF
)"
```

---

### Task 4: Backfill migration

**Files:**
- Create: `src/main/stemCategoriesBackfill.ts`
- Create: `src/main/stemCategoriesBackfill.test.ts`
- Modify: `src/main/index.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/main/stemCategoriesBackfill.test.ts`:

```ts
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let musicDir: string
let userDataDir: string

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => (name === 'music' ? musicDir : userDataDir)
  }
}))

function freshDb(): Database.Database {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE StemCategories (
      StemCID TEXT PRIMARY KEY, ArrangeRole TEXT, DrumSubRole TEXT, BusId TEXT,
      Source TEXT NOT NULL, SourceProject TEXT, UpdatedAt INTEGER NOT NULL
    );
    CREATE TABLE Stems (StemCID TEXT PRIMARY KEY);
  `)
  return db
}

function writeSketch(
  name: string,
  contents: { busOf: Record<string, string>; rifffs: Record<string, unknown> }
): string {
  const dir = join(musicDir, 'sssketch', 'projects', name)
  mkdirSync(dir, { recursive: true })
  const path = join(dir, `${name}.sssketchproj`)
  writeFileSync(path, JSON.stringify(contents), 'utf-8')
  return path
}

describe('stemCategoriesBackfill', () => {
  beforeEach(() => {
    musicDir = mkdtempSync(join(tmpdir(), 'sssketch-backfill-music-test-'))
    userDataDir = mkdtempSync(join(tmpdir(), 'sssketch-backfill-userdata-test-'))
  })

  afterEach(() => {
    rmSync(musicDir, { recursive: true, force: true })
    rmSync(userDataDir, { recursive: true, force: true })
  })

  it('recovers busOf entries whose stem path resolves to a real StemCID', async () => {
    const db = freshDb()
    db.prepare(`INSERT INTO Stems (StemCID) VALUES (?)`).run('cid-1')
    writeSketch('my-sketch', {
      busOf: { 'group-a:1': 'drums' },
      rifffs: { 'group-a': { groupId: 'group-a', stems: [{ slot: 1, path: '/lib/cid-1' }] } }
    })
    const { backfillStemCategoriesFromProjectLibrary } = await import('./stemCategoriesBackfill')
    const { getStemCategory } = await import('./stemCategoriesStore')
    const summary = backfillStemCategoriesFromProjectLibrary(db)
    expect(summary.scannedProjects).toBe(1)
    expect(summary.categorizedStems).toBe(1)
    const row = getStemCategory(db, 'cid-1')
    expect(row?.busId).toBe('drums')
    expect(row?.source).toBe('backfill')
    expect(row?.sourceProject).toBe(join(musicDir, 'sssketch', 'projects', 'my-sketch', 'my-sketch.sssketchproj'))
  })

  it('skips a busOf entry whose stemKey has no matching rifff/stem in the same file', async () => {
    const db = freshDb()
    db.prepare(`INSERT INTO Stems (StemCID) VALUES (?)`).run('cid-1')
    writeSketch('my-sketch', {
      busOf: { 'group-a:1': 'drums', 'group-b:1': 'bass' },
      rifffs: { 'group-a': { groupId: 'group-a', stems: [{ slot: 1, path: '/lib/cid-1' }] } }
    })
    const { backfillStemCategoriesFromProjectLibrary } = await import('./stemCategoriesBackfill')
    const summary = backfillStemCategoriesFromProjectLibrary(db)
    expect(summary.categorizedStems).toBe(1)
  })

  it('a more-recently-modified project wins when two projects categorize the same stem differently', async () => {
    const db = freshDb()
    db.prepare(`INSERT INTO Stems (StemCID) VALUES (?)`).run('cid-1')
    writeSketch('older', {
      busOf: { 'group-a:1': 'drums' },
      rifffs: { 'group-a': { groupId: 'group-a', stems: [{ slot: 1, path: '/lib/cid-1' }] } }
    })
    const olderPath = join(musicDir, 'sssketch', 'projects', 'older', 'older.sssketchproj')
    const olderStat = statSync(olderPath)
    writeFileSync(olderPath, readOlderContents(olderPath), 'utf-8')
    // Force a real, distinct mtime ordering regardless of filesystem
    // timestamp resolution -- touch 'newer' second (loop until strictly
    // greater than 'older', bounded so this can never hang).
    let newerPath = ''
    for (let i = 0; i < 50; i++) {
      newerPath = writeSketch('newer', {
        busOf: { 'group-a:1': 'bass' },
        rifffs: { 'group-a': { groupId: 'group-a', stems: [{ slot: 1, path: '/lib/cid-1' }] } }
      })
      if (statSync(newerPath).mtimeMs > olderStat.mtimeMs) break
    }
    const { backfillStemCategoriesFromProjectLibrary } = await import('./stemCategoriesBackfill')
    const { getStemCategory } = await import('./stemCategoriesStore')
    backfillStemCategoriesFromProjectLibrary(db)
    expect(getStemCategory(db, 'cid-1')?.busId).toBe('bass')

    function readOlderContents(path: string): string {
      // no-op passthrough -- keeps the file's own already-written contents,
      // this call exists only so olderStat above reflects the real,
      // already-on-disk mtime before 'newer' is written a moment later.
      return require('node:fs').readFileSync(path, 'utf-8')
    }
  })

  it('is safe to re-run: re-running with no changes does not throw and leaves rows as-is', async () => {
    const db = freshDb()
    db.prepare(`INSERT INTO Stems (StemCID) VALUES (?)`).run('cid-1')
    writeSketch('my-sketch', {
      busOf: { 'group-a:1': 'drums' },
      rifffs: { 'group-a': { groupId: 'group-a', stems: [{ slot: 1, path: '/lib/cid-1' }] } }
    })
    const { backfillStemCategoriesFromProjectLibrary } = await import('./stemCategoriesBackfill')
    const { getStemCategory } = await import('./stemCategoriesStore')
    backfillStemCategoriesFromProjectLibrary(db)
    expect(() => backfillStemCategoriesFromProjectLibrary(db)).not.toThrow()
    expect(getStemCategory(db, 'cid-1')?.busId).toBe('drums')
  })

  it('records an unparsable project file as skipped rather than throwing', async () => {
    const db = freshDb()
    const dir = join(musicDir, 'sssketch', 'projects', 'broken')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'broken.sssketchproj'), 'not valid json', 'utf-8')
    const { backfillStemCategoriesFromProjectLibrary } = await import('./stemCategoriesBackfill')
    const summary = backfillStemCategoriesFromProjectLibrary(db)
    expect(summary.skippedProjects).toEqual(['broken'])
    expect(summary.categorizedStems).toBe(0)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/main/stemCategoriesBackfill.test.ts`
Expected: FAIL — `Cannot find module './stemCategoriesBackfill'`.

- [ ] **Step 3: Implement `src/main/stemCategoriesBackfill.ts`**

```ts
// src/main/stemCategoriesBackfill.ts
import { readFileSync } from 'node:fs'
import type Database from 'better-sqlite3'
import { listLibrarySketches, sketchProjectPath } from './projectLibrary'
import { upsertStemCategoryBus, type StemBusCategoryEntry } from './stemCategoriesStore'
import type { BusId } from '@shared/types'

export interface BackfillSummary {
  scannedProjects: number
  categorizedStems: number
  /** Names of sketches whose .sssketchproj failed to parse as JSON --
   * reported, not thrown, so one corrupt project file doesn't abort the
   * whole backfill for every other sketch in the library. */
  skippedProjects: string[]
}

interface ParsedSketchStem {
  slot: number
  path: string
}

interface ParsedSketchRifff {
  groupId: string
  stems: ParsedSketchStem[]
}

interface ParsedSketch {
  busOf?: Record<string, string>
  rifffs?: Record<string, ParsedSketchRifff>
}

/** One-time-in-spirit, safe-to-call-on-every-startup migration recovering
 * Tidy Up's busOf assignments that are otherwise trapped inside whichever
 * .sssketchproj file happened to be open when they were made -- see the
 * design spec's §3 and Background. Only busOf is backfillable; ArrangeRole/
 * DrumSubRole corrections were never saved to any project file (confirmed
 * in the design spec's own Background), so there is nothing to recover for
 * them here.
 *
 * Idempotent via upsertStemCategoryBus's own conditional ON CONFLICT (see
 * stemCategoriesStore.ts) -- re-running this after some real forward-capture
 * writes have already happened can never regress a newer write with older
 * project-file data, and re-running it with nothing changed is a safe
 * no-op, matching riffFavouritesMigration.ts's own "safe to call on every
 * app startup" convention. Scoped to the project LIBRARY folder only
 * (listLibrarySketches) -- a sketch opened from an arbitrary external
 * Finder location is out of scope, matching the design spec's own "under
 * the project library folder" wording. */
export function backfillStemCategoriesFromProjectLibrary(db: Database.Database): BackfillSummary {
  const sketches = listLibrarySketches()
  let categorizedStems = 0
  const skippedProjects: string[] = []

  for (const sketch of sketches) {
    const projectPath = sketchProjectPath(sketch.name)
    let parsed: ParsedSketch
    try {
      parsed = JSON.parse(readFileSync(projectPath, 'utf-8')) as ParsedSketch
    } catch {
      skippedProjects.push(sketch.name)
      continue
    }

    const busOf = parsed.busOf ?? {}
    const rifffs = parsed.rifffs ?? {}
    const pathByStemKey = new Map<string, string>()
    for (const rifff of Object.values(rifffs)) {
      for (const stem of rifff.stems) {
        pathByStemKey.set(`${rifff.groupId}:${stem.slot}`, stem.path)
      }
    }

    const entries: StemBusCategoryEntry[] = []
    for (const [stemKeyValue, busId] of Object.entries(busOf)) {
      const path = pathByStemKey.get(stemKeyValue)
      if (path) entries.push({ path, busId: busId as BusId })
    }

    if (entries.length > 0) {
      upsertStemCategoryBus(
        db,
        entries,
        'backfill',
        projectPath,
        Math.floor(sketch.mtimeMs / 1000)
      )
      categorizedStems += entries.length
    }
  }

  return { scannedProjects: sketches.length, categorizedStems, skippedProjects }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/main/stemCategoriesBackfill.test.ts`
Expected: PASS (all tests). If the "more-recently-modified project wins" test is flaky in CI due to filesystem mtime resolution, that's an acceptable known limitation of testing real file mtimes — the retry loop in that test already guards against it for local runs.

- [ ] **Step 5: Wire the migration into app startup**

In `src/main/index.ts`, near the existing `migrateLegacyFavourites(openOwnRiffLibraryDb())` call (around line 276), add right after it:

```ts
  backfillStemCategoriesFromProjectLibrary(openOwnRiffLibraryDb())
```

Add the import alongside the existing `riffFavouritesMigration` import:

```ts
import { backfillStemCategoriesFromProjectLibrary } from './stemCategoriesBackfill'
```

- [ ] **Step 6: Run typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/main/stemCategoriesBackfill.ts src/main/stemCategoriesBackfill.test.ts src/main/index.ts
git commit -m "$(cat <<'EOF'
Add StemCategories backfill migration, wired into app startup

Recovers busOf assignments trapped in old .sssketchproj files under the
project library folder -- safe to re-run on every startup, matching
riffFavouritesMigration.ts's own convention. Only busOf is recoverable;
ArrangeRole/DrumSubRole were never persisted to any project file (see
the design spec's own Background/§3).
EOF
)"
```

---

### Task 5: `StemFeatureCache` table

**Files:**
- Modify: `src/main/riffLibrarySchema.ts`
- Modify: `src/main/riffLibrarySchema.test.ts`

- [ ] **Step 1: Update the table-list test to expect the new table (red)**

In `src/main/riffLibrarySchema.test.ts`, change the `expect(tables.map(...)).toEqual([...])` array from Task 1's own version to:

```ts
    expect(tables.map((t) => t.name)).toEqual([
      'Jams',
      'Riffs',
      'StemCategories',
      'StemFeatureCache',
      'StemLedger',
      'Stems',
      'Tags'
    ])
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/main/riffLibrarySchema.test.ts`
Expected: FAIL — actual table list has no `StemFeatureCache`.

- [ ] **Step 3: Add the table to `SCHEMA_SQL`**

In `src/main/riffLibrarySchema.ts`, add this new table right after the `StemCategories` table Task 1 added (before the closing backtick):

```sql

CREATE TABLE IF NOT EXISTS StemFeatureCache (
  StemCID TEXT PRIMARY KEY,
  FeaturesJSON TEXT NOT NULL,
  ExtractedAt INTEGER NOT NULL
);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/main/riffLibrarySchema.test.ts`
Expected: PASS (all 4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/riffLibrarySchema.ts src/main/riffLibrarySchema.test.ts
git commit -m "$(cat <<'EOF'
Add StemFeatureCache table to the riff library schema

Persistent, cross-session home for a stem's computed StemFeatures
(stemFeatures.ts), keyed by StemCID -- replaces stemFeaturesCache.ts's
renderer-memory-only cache as the durable layer beneath it. Per Elling's
own request that no individual screen should have its own scanning
feature: once a stem is scanned anywhere, it never needs scanning again
in any future session or screen. See design spec §9's "Persistent,
cross-session feature caching" addition.
EOF
)"
```

---

### Task 6: `stemFeatureCacheStore.ts` — read/write functions

**Files:**
- Modify: `src/main/stemCategoriesStore.ts`
- Create: `src/main/stemFeatureCacheStore.ts`
- Create: `src/main/stemFeatureCacheStore.test.ts`

- [ ] **Step 1: Export `stemCIDForPath` from `stemCategoriesStore.ts` for reuse**

In `src/main/stemCategoriesStore.ts`, change:

```ts
function stemCIDForPath(db: Database.Database, path: string): string | null {
```

to:

```ts
export function stemCIDForPath(db: Database.Database, path: string): string | null {
```

(No other change to that function — its doc comment already explains the content-addressing rationale, which now applies to two callers instead of one.)

- [ ] **Step 2: Write the failing tests**

Create `src/main/stemFeatureCacheStore.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import type { StemFeatures } from '@shared/stemFeatures'
import { getStemFeatureCache, setStemFeatureCache } from './stemFeatureCacheStore'

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

describe('stemFeatureCacheStore', () => {
  it('returns null for a path with no cached row yet', () => {
    const db = freshDb()
    db.prepare(`INSERT INTO Stems (StemCID) VALUES (?)`).run('cid-1')
    expect(getStemFeatureCache(db, '/lib/cid-1')).toBe(null)
  })

  it('round-trips a written feature set back out', () => {
    const db = freshDb()
    db.prepare(`INSERT INTO Stems (StemCID) VALUES (?)`).run('cid-1')
    const features = fakeFeatures()
    setStemFeatureCache(db, '/lib/cid-1', features, 1000)
    expect(getStemFeatureCache(db, '/lib/cid-1')).toEqual(features)
  })

  it('a later write overwrites an earlier one for the same stem', () => {
    const db = freshDb()
    db.prepare(`INSERT INTO Stems (StemCID) VALUES (?)`).run('cid-1')
    setStemFeatureCache(db, '/lib/cid-1', fakeFeatures(), 1000)
    const updated = { ...fakeFeatures(), transientDensity: 0.9 }
    setStemFeatureCache(db, '/lib/cid-1', updated, 2000)
    expect(getStemFeatureCache(db, '/lib/cid-1')?.transientDensity).toBe(0.9)
  })

  it('silently skips writing for a path whose basename is not a real StemCID', () => {
    const db = freshDb()
    setStemFeatureCache(db, '/local/one-shot.wav', fakeFeatures(), 1000)
    expect(getStemFeatureCache(db, '/local/one-shot.wav')).toBe(null)
    const count = db.prepare(`SELECT COUNT(*) as n FROM StemFeatureCache`).get() as { n: number }
    expect(count.n).toBe(0)
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/main/stemFeatureCacheStore.test.ts`
Expected: FAIL — `Cannot find module './stemFeatureCacheStore'`.

- [ ] **Step 4: Implement `src/main/stemFeatureCacheStore.ts`**

```ts
// src/main/stemFeatureCacheStore.ts
import type Database from 'better-sqlite3'
import type { StemFeatures } from '@shared/stemFeatures'
import { stemCIDForPath } from './stemCategoriesStore'

/** Reads a stem's persisted StemFeatures by its on-disk path -- resolves
 * the same content-addressed StemCID convention stemCategoriesStore.ts
 * already established (basename of a real library stem's path IS its
 * StemCID). Returns null both for "never scanned yet" and "not a real
 * library stem at all" -- a caller (stemFeaturesCache.ts's own
 * getStemFeatures) treats both identically: compute fresh. A row whose
 * FeaturesJSON fails to parse (shouldn't happen -- only ever written by
 * setStemFeatureCache below -- but defensive against a corrupted DB file)
 * is treated the same as a miss rather than throwing. */
export function getStemFeatureCache(db: Database.Database, path: string): StemFeatures | null {
  const stemCID = stemCIDForPath(db, path)
  if (!stemCID) return null
  const row = db
    .prepare(`SELECT FeaturesJSON FROM StemFeatureCache WHERE StemCID = ?`)
    .get(stemCID) as { FeaturesJSON: string } | undefined
  if (!row) return null
  try {
    return JSON.parse(row.FeaturesJSON) as StemFeatures
  } catch {
    return null
  }
}

/** Persists a freshly computed StemFeatures for a stem, keyed by the
 * StemCID its path resolves to. A no-op (not an error) for a path that
 * doesn't resolve to a real Stems row -- a locally-dropped file, one-shot
 * sample, or in-app recording has nothing to persist against, exactly
 * matching stemCategoriesStore.ts's own upsert functions' same silent-skip
 * behavior for the same reason. */
export function setStemFeatureCache(
  db: Database.Database,
  path: string,
  features: StemFeatures,
  extractedAt: number
): void {
  const stemCID = stemCIDForPath(db, path)
  if (!stemCID) return
  db.prepare(
    `INSERT INTO StemFeatureCache (StemCID, FeaturesJSON, ExtractedAt)
     VALUES (@stemCID, @featuresJson, @extractedAt)
     ON CONFLICT(StemCID) DO UPDATE SET
       FeaturesJSON = excluded.FeaturesJSON,
       ExtractedAt = excluded.ExtractedAt`
  ).run({ stemCID, featuresJson: JSON.stringify(features), extractedAt })
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/main/stemFeatureCacheStore.test.ts src/main/stemCategoriesStore.test.ts`
Expected: PASS (all tests — including `stemCategoriesStore.test.ts`, confirming Step 1's export change didn't break anything there).

- [ ] **Step 6: Run typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/main/stemCategoriesStore.ts src/main/stemFeatureCacheStore.ts src/main/stemFeatureCacheStore.test.ts
git commit -m "$(cat <<'EOF'
Add stemFeatureCacheStore.ts: persistent per-stem StemFeatures read/write

Reuses stemCategoriesStore.ts's own stemCIDForPath (now exported) rather
than re-deriving the same content-addressing logic a second time. Not
wired into getStemFeatures yet -- that's the next task.
EOF
)"
```

---

### Task 7: IPC handlers + preload bridge for the feature cache

**Files:**
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`

- [ ] **Step 1: Add imports and IPC handlers to `src/main/index.ts`**

Near the `stemCategoriesStore` import added in Task 3, add:

```ts
import { getStemFeatureCache, setStemFeatureCache } from './stemFeatureCacheStore'
import type { StemFeatures } from '@shared/stemFeatures'
```

Near the `upsert-stem-category-bus`/`upsert-stem-category-role` handlers added in Task 3, add:

```ts
  ipcMain.handle('get-stem-feature-cache', (_event, path: string): StemFeatures | null =>
    getStemFeatureCache(openOwnRiffLibraryDb(), path)
  )

  ipcMain.handle('set-stem-feature-cache', (_event, path: string, features: StemFeatures) => {
    setStemFeatureCache(openOwnRiffLibraryDb(), path, features, Math.floor(Date.now() / 1000))
  })
```

- [ ] **Step 2: Add preload bridge methods**

In `src/preload/index.ts`, add the import:

```ts
import type { StemFeatures } from '@shared/stemFeatures'
```

Near the `upsertStemCategoryBus`/`upsertStemCategoryRole` entries added in Task 3, add:

```ts
  getStemFeatureCache: (path: string): Promise<StemFeatures | null> =>
    ipcRenderer.invoke('get-stem-feature-cache', path),
  setStemFeatureCache: (path: string, features: StemFeatures): Promise<void> =>
    ipcRenderer.invoke('set-stem-feature-cache', path, features),
```

- [ ] **Step 3: Run typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/main/index.ts src/preload/index.ts
git commit -m "$(cat <<'EOF'
Wire the persistent feature cache through IPC

Exposes window.rifffApi.getStemFeatureCache/setStemFeatureCache. Not
called from anywhere yet -- getStemFeatures' own redesign to use these
is the next task.
EOF
)"
```

---

### Task 8: Redesign `getStemFeatures` to check/write the persistent cache

**Files:**
- Modify: `src/renderer/src/audio/stemFeaturesCache.ts`
- Modify: `src/renderer/src/audio/stemFeaturesCache.test.ts`

**Before you start:** re-read both files fresh. `stemFeaturesCache.ts`'s existing renderer-memory `Map<string, Promise<StemFeatures>>` cache (module-level `cache`) stays exactly as-is — it still absorbs same-session repeat calls for free, with zero IPC round-trip. What changes is what happens on a same-session cache MISS: today it goes straight to decode; after this task, it checks the persistent store first via IPC, and on a genuine miss there too, computes as before and then persists the result.

- [ ] **Step 1: Update the existing test file's `window.rifffApi` stub (red for the new tests)**

In `src/renderer/src/audio/stemFeaturesCache.test.ts`, change the `beforeEach` block from:

```ts
  beforeEach(() => {
    vi.resetModules()
    readAudioFileMock = vi.fn()
    decodeAudioDataMock = vi.fn()

    vi.stubGlobal('window', { rifffApi: { readAudioFile: readAudioFileMock } })
    class FakeAudioContext {
      decodeAudioData = decodeAudioDataMock
    }
    vi.stubGlobal('AudioContext', FakeAudioContext)
  })
```

to:

```ts
  beforeEach(() => {
    vi.resetModules()
    readAudioFileMock = vi.fn()
    decodeAudioDataMock = vi.fn()
    getStemFeatureCacheMock = vi.fn().mockResolvedValue(null)
    setStemFeatureCacheMock = vi.fn().mockResolvedValue(undefined)

    vi.stubGlobal('window', {
      rifffApi: {
        readAudioFile: readAudioFileMock,
        getStemFeatureCache: getStemFeatureCacheMock,
        setStemFeatureCache: setStemFeatureCacheMock
      }
    })
    class FakeAudioContext {
      decodeAudioData = decodeAudioDataMock
    }
    vi.stubGlobal('AudioContext', FakeAudioContext)
  })
```

Add the two new `let` declarations alongside the existing ones at the top of the `describe` block:

```ts
  let readAudioFileMock: ReturnType<typeof vi.fn>
  let decodeAudioDataMock: ReturnType<typeof vi.fn>
  let getStemFeatureCacheMock: ReturnType<typeof vi.fn>
  let setStemFeatureCacheMock: ReturnType<typeof vi.fn>
```

Add two new tests at the end of the `describe` block, before the closing `})`:

```ts
  it('returns a persisted feature set without decoding at all', async () => {
    const persisted = {
      transientDensity: 0.7,
      bassEnergyRatio: 0.2,
      spectralCentroidHz: 900,
      zcrBrightness: 0.3,
      voicedFraction: 0.5,
      pitchVarianceCents: 15,
      mfcc: Array.from({ length: 13 }, (_, i) => i)
    }
    getStemFeatureCacheMock.mockResolvedValue(persisted)

    const { getStemFeatures } = await import('./stemFeaturesCache')
    const features = await getStemFeatures('/some/stem.wav')

    expect(features).toEqual(persisted)
    expect(readAudioFileMock).not.toHaveBeenCalled()
    expect(decodeAudioDataMock).not.toHaveBeenCalled()
  })

  it('persists a freshly computed feature set via setStemFeatureCache', async () => {
    readAudioFileMock.mockResolvedValue(fakeBytes())
    decodeAudioDataMock.mockResolvedValue(fakeAudioBuffer())

    const { getStemFeatures } = await import('./stemFeaturesCache')
    const features = await getStemFeatures('/some/stem.wav')

    expect(setStemFeatureCacheMock).toHaveBeenCalledWith('/some/stem.wav', features)
  })
```

- [ ] **Step 2: Run the tests to verify the new ones fail**

Run: `npx vitest run src/renderer/src/audio/stemFeaturesCache.test.ts`
Expected: the two new tests FAIL (the persisted-cache-hit test fails because `getStemFeatures` doesn't check the persistent store yet; the persist-on-compute test fails because nothing calls `setStemFeatureCache` yet). The three pre-existing tests should still PASS unchanged (the stub now includes two extra mocked methods, but the pre-existing tests don't assert on them).

- [ ] **Step 3: Redesign `getStemFeatures`**

In `src/renderer/src/audio/stemFeaturesCache.ts`, replace:

```ts
export function getStemFeatures(path: string): Promise<StemFeatures> {
  const cached = cache.get(path)
  if (cached) return cached

  const promise = (async () => {
    try {
      const [brightness, pitchContour, bytes] = await Promise.all([
        getBrightness(path),
        getPitchContour(path),
        window.rifffApi.readAudioFile(path)
      ])
      const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
      const audioBuffer = await getAudioContext().decodeAudioData(arrayBuffer as ArrayBuffer)
      const samples = audioBuffer.getChannelData(0)
      const pitchFeatures = voicedPitchFeatures(pitchContour)
      return computeFeatures(samples, audioBuffer.sampleRate, brightness, pitchFeatures)
    } catch (err) {
      cache.delete(path)
      throw err
    }
  })()

  cache.set(path, promise)
  return promise
}
```

with:

```ts
export function getStemFeatures(path: string): Promise<StemFeatures> {
  const cached = cache.get(path)
  if (cached) return cached

  const promise = (async () => {
    try {
      // Persistent, cross-session cache first (stemFeatureCacheStore.ts,
      // via IPC) -- a stem the background scan (BackgroundFeatureScan.tsx)
      // or any prior session already extracted needs no decode at all.
      // Returns null both for "never scanned" and "not a real library
      // stem" (see stemFeatureCacheStore.ts's own doc comment) -- either
      // way, fall through to computing fresh below.
      const persisted = await window.rifffApi.getStemFeatureCache(path)
      if (persisted) return persisted

      const [brightness, pitchContour, bytes] = await Promise.all([
        getBrightness(path),
        getPitchContour(path),
        window.rifffApi.readAudioFile(path)
      ])
      const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
      const audioBuffer = await getAudioContext().decodeAudioData(arrayBuffer as ArrayBuffer)
      const samples = audioBuffer.getChannelData(0)
      const pitchFeatures = voicedPitchFeatures(pitchContour)
      const features = computeFeatures(samples, audioBuffer.sampleRate, brightness, pitchFeatures)
      // Fire-and-forget -- a real library stem's path persists for next
      // time (this session's own renderer-memory `cache` above already
      // covers repeat calls within THIS session regardless of whether this
      // write succeeds); a non-library path is silently skipped by the
      // main-process side (see stemFeatureCacheStore.ts).
      void window.rifffApi.setStemFeatureCache(path, features)
      return features
    } catch (err) {
      cache.delete(path)
      throw err
    }
  })()

  cache.set(path, promise)
  return promise
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/renderer/src/audio/stemFeaturesCache.test.ts`
Expected: PASS (all 5 tests).

- [ ] **Step 5: Run typecheck, lint, and the full test suite**

Run: `npm run typecheck && npm run lint && npm test`
Expected: no errors, no regressions.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/audio/stemFeaturesCache.ts src/renderer/src/audio/stemFeaturesCache.test.ts
git commit -m "$(cat <<'EOF'
getStemFeatures checks/writes the persistent StemFeatureCache

The renderer-memory Map cache is unchanged (still absorbs same-session
repeat calls for free) -- on a same-session MISS, this now checks the
cross-session persistent store first (a real library stem previously
scanned in ANY session needs no decode at all), and persists a freshly
computed result for next time. A non-library path (local drop/one-shot/
recording) behaves exactly as before -- nothing to key persistence by.
EOF
)"
```

---

### Task 9: `useStemFeatureScan` hook

**Files:**
- Create: `src/renderer/src/audio/useStemFeatureScan.ts`

No test file for this task — this is a React hook, and per this codebase's established convention (root `CLAUDE.md`'s Testing conventions), React-layer code is typecheck+lint-verified only. With Task 8 landed, most calls into this hook will resolve near-instantly from the persistent cache (or the ambient background scan from Task 10 will have already warmed it) — but a screen can still open before either has caught up (e.g. a stem placed moments ago, or the background scan mid-throttle), so this hook's own loading state is still real and necessary, not vestigial.

- [ ] **Step 1: Implement the hook**

Create `src/renderer/src/audio/useStemFeatureScan.ts`:

```ts
// src/renderer/src/audio/useStemFeatureScan.ts
import { useEffect, useState } from 'react'
import type { StemFeatures } from '@shared/stemFeatures'
import { getStemFeatures } from './stemFeaturesCache'

export interface StemFeatureScanItem {
  key: string
  path: string
}

export interface StemFeatureScanResult {
  loading: boolean
  featuresByKey: Map<string, StemFeatures>
}

/**
 * Shared scan orchestration for "get every one of these stems' own
 * StemFeatures" -- the exact useEffect + Promise.allSettled + loading-
 * state wrapper AutoArrangeRoleStep.tsx and ClusterStemsBrowser.tsx used to
 * each reimplement independently around getStemFeatures
 * (stemFeaturesCache.ts) itself (see the design spec's own §9 consolidation
 * priority). With Task 8's persistent-cache redesign, most calls here
 * resolve near-instantly (a cache hit needs no decode) -- this hook's own
 * loading state still matters for whatever hasn't been scanned/persisted
 * yet, it just resolves fast in the common case rather than eliminating
 * the concept of "loading" entirely. A stem whose extraction genuinely
 * fails (corrupt/unreadable file) is logged and excluded from
 * featuresByKey entirely, matching both original call sites' own "don't
 * substitute a fake zero-vector entry" reasoning (a fake entry would
 * corrupt any per-population standardization a caller runs downstream --
 * see stemFeatures.ts's own standardizeFeatures).
 *
 * `items` must be a referentially-stable array across renders (e.g. built
 * via useMemo, the way ClusterStemsBrowser.tsx's own `stems` and
 * AutoArrangeRoleStep.tsx's own `flatStems` already are) -- this hook's
 * effect keys off `items`' own identity, not deep equality.
 *
 * Keyed by a caller-supplied `key` (this app's own stemKey convention), not
 * `path` -- downstream callers already key their own per-stem state by
 * stemKey elsewhere, so this hook stays consistent with that.
 *
 * `loading` is derived from comparing the last completed scan's own item-
 * array reference against the current `items`, not a separate useState --
 * same pattern ClusterStemsBrowser.tsx's own pre-extraction `computed`/
 * `loading` split already used, to avoid a synchronous setState-in-effect
 * that would trip this codebase's react-hooks/set-state-in-effect lint
 * rule (see that component's own doc comment for the same reasoning).
 */
export function useStemFeatureScan(items: StemFeatureScanItem[]): StemFeatureScanResult {
  const [scanned, setScanned] = useState<{
    forItems: StemFeatureScanItem[]
    featuresByKey: Map<string, StemFeatures>
  } | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const results = await Promise.allSettled(
        items.map(async (item) => ({ key: item.key, features: await getStemFeatures(item.path) }))
      )
      if (cancelled) return
      const featuresByKey = new Map<string, StemFeatures>()
      results.forEach((result, i) => {
        if (result.status === 'fulfilled') {
          featuresByKey.set(result.value.key, result.value.features)
        } else {
          console.error(
            'useStemFeatureScan: feature extraction failed for stem',
            items[i].path,
            result.reason
          )
        }
      })
      setScanned({ forItems: items, featuresByKey })
    })().catch((err: unknown) => {
      if (!cancelled) {
        console.error('useStemFeatureScan: scan failed', err)
        setScanned({ forItems: items, featuresByKey: new Map() })
      }
    })
    return () => {
      cancelled = true
    }
  }, [items])

  const loading = scanned === null || scanned.forItems !== items
  return { loading, featuresByKey: loading ? new Map() : scanned.featuresByKey }
}
```

- [ ] **Step 2: Run typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/audio/useStemFeatureScan.ts
git commit -m "$(cat <<'EOF'
Add useStemFeatureScan: shared scan-orchestration hook

Extracts the useEffect+Promise.allSettled+loading-state wrapper around
getStemFeatures that AutoArrangeRoleStep.tsx and ClusterStemsBrowser.tsx
each currently reimplement independently. Not wired into either yet --
that's Tasks 11 and 12.
EOF
)"
```

---

### Task 10: Ambient background feature scan

**Files:**
- Create: `src/renderer/src/audio/BackgroundFeatureScan.tsx`
- Modify: `src/renderer/src/App.tsx`

- [ ] **Step 1: Implement the component**

Create `src/renderer/src/audio/BackgroundFeatureScan.tsx`:

```tsx
// src/renderer/src/audio/BackgroundFeatureScan.tsx
import { useEffect, useRef } from 'react'
import { usePlacedFlatStems } from '../state/usePlacedFlatStems'
import { getStemFeatures } from './stemFeaturesCache'

// Small batches with a real delay between them, rather than firing every
// currently-placed stem's extraction at once -- a large project's worth of
// never-before-scanned stems shouldn't compete heavily with real playback/
// interaction. getStemFeatures' own two-tier cache (renderer memory, then
// the persistent store) means calling it here for a stem some OTHER path
// (a screen's own useStemFeatureScan, or an earlier batch) already
// resolved is a cheap no-op, not redundant work.
const BATCH_SIZE = 3
const BATCH_DELAY_MS = 500

/** Ambient, always-on background scan -- proactively warms getStemFeatures'
 * cache for every stem currently placed on the timeline, independent of
 * whether Tidy Up or Auto-Arrange happen to be open. Mounted once at the
 * top level (Frame(), alongside SketchModeAutoFollow) rather than
 * triggered by any one screen opening -- per the design spec's own §9,
 * the whole point is that opening a screen should typically find its
 * stems already scanned rather than triggering a visible wait of its own.
 * Scoped to PLACED stems only, not the whole synced library (which can run
 * to thousands of stems nobody has placed anywhere) -- scanning the entire
 * library ahead of time is the discover screen's own concern (§8), since
 * that's the first feature that needs features for stems nobody has
 * placed anywhere yet. Renders nothing (mirrors SketchModeAutoFollow's own
 * `(): null` shape). */
export function BackgroundFeatureScan(): null {
  const { flatStems } = usePlacedFlatStems()
  const attemptedRef = useRef(new Set<string>())

  useEffect(() => {
    const toScan = flatStems.filter((fs) => !attemptedRef.current.has(fs.stemKey))
    if (toScan.length === 0) return
    let cancelled = false

    function runBatch(startIndex: number): void {
      if (cancelled) return
      const batch = toScan.slice(startIndex, startIndex + BATCH_SIZE)
      if (batch.length === 0) return
      for (const fs of batch) {
        attemptedRef.current.add(fs.stemKey)
        void getStemFeatures(fs.stem.path).catch((err: unknown) => {
          console.error('BackgroundFeatureScan: extraction failed for stem', fs.stem.path, err)
        })
      }
      const nextIndex = startIndex + BATCH_SIZE
      if (nextIndex < toScan.length) {
        window.setTimeout(() => runBatch(nextIndex), BATCH_DELAY_MS)
      }
    }
    runBatch(0)

    return () => {
      cancelled = true
    }
  }, [flatStems])

  return null
}
```

- [ ] **Step 2: Mount it in `App.tsx`**

In `src/renderer/src/App.tsx`, add the import alongside the other component imports:

```ts
import { BackgroundFeatureScan } from './audio/BackgroundFeatureScan'
```

Add `<BackgroundFeatureScan />` alongside the existing `<SketchModeAutoFollow />` mount (around line 2030):

```tsx
      <SketchModeAutoFollow />
      <BackgroundFeatureScan />
```

- [ ] **Step 3: Run typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: no errors.

- [ ] **Step 4: Run the full test suite**

Run: `npm test`
Expected: no regressions.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/audio/BackgroundFeatureScan.tsx src/renderer/src/App.tsx
git commit -m "$(cat <<'EOF'
Add ambient BackgroundFeatureScan, mounted at the app's top level

Proactively warms getStemFeatures' cache for every currently-placed stem,
independent of whether any particular screen is open -- so Tidy Up and
Auto-Arrange typically find their stems already scanned. Throttled in
small batches. Needs Elling's own manual walkthrough: open a project with
several never-before-scanned stems, wait a few seconds, then open Tidy Up
-- it should show little to no "analyzing stems..." wait.
EOF
)"
```

---

### Task 11: Migrate `ClusterStemsBrowser.tsx` onto `useStemFeatureScan`

**Files:**
- Modify: `src/renderer/src/components/ClusterStemsBrowser.tsx`

**Before you start:** re-read the current file fresh — this plan was grounded against it earlier in the same session, but confirm line numbers/exact surrounding code haven't shifted before editing. The scan effect currently lives around lines 242-285, feeding `computed.rawVectorsByKey` (a `Map<string, number[]>` of `toFeatureArray`-flattened vectors, used both by `trainCentroids` — raw space, per busCentroids.ts's own doc comment — and by the DSP clustering population). This task replaces ONLY the extraction/loading mechanics; `toFeatureArray`/`standardizeFeatures`/clustering/`trainCentroids` all keep their exact current behavior.

- [ ] **Step 1: Replace the scan effect with the shared hook**

Replace this block (current lines 219-285 — the `computed` state, `loading` derivation, and the scan `useEffect`):

```ts
  const [computed, setComputed] = useState<{
    forStems: ClusterableStem[]
    analyzedStems: ClusterableStem[]
    rawVectorsByKey: Map<string, number[]>
  } | null>(null)
  const loading = computed === null || computed.forStems !== stems
  const [clusterCount, setClusterCount] = useState(DEFAULT_CLUSTER_COUNT)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const results = await Promise.allSettled(
        stems.map(async (s) => {
          const features = await getStemFeatures(s.path)
          return toFeatureArray(features)
        })
      )
      if (cancelled) return
      const analyzedStems: ClusterableStem[] = []
      const rawVectorsByKey = new Map<string, number[]>()
      results.forEach((result, i) => {
        if (result.status === 'fulfilled') {
          analyzedStems.push(stems[i])
          rawVectorsByKey.set(stems[i].key, result.value)
        } else {
          console.error(
            'ClusterStemsBrowser: feature extraction failed for stem',
            stems[i].path,
            result.reason
          )
        }
      })
      setComputed({ forStems: stems, analyzedStems, rawVectorsByKey })
    })().catch((err) => {
      if (!cancelled) {
        console.error('ClusterStemsBrowser: feature extraction failed', err)
        setComputed({ forStems: stems, analyzedStems: [], rawVectorsByKey: new Map() })
      }
    })
    return () => {
      cancelled = true
    }
  }, [stems])
```

with:

```ts
  const [clusterCount, setClusterCount] = useState(DEFAULT_CLUSTER_COUNT)

  const scanItems = useMemo(() => stems.map((s) => ({ key: s.key, path: s.path })), [stems])
  const { loading, featuresByKey } = useStemFeatureScan(scanItems)

  // Mirrors the old `computed` shape's own two derived pieces exactly --
  // analyzedStems (only the stems that scanned successfully) and
  // rawVectorsByKey (toFeatureArray-flattened, raw/unstandardized, since
  // trainCentroids below needs raw space -- see busCentroids.ts's own doc
  // comment) -- so every downstream consumer needs zero further changes
  // beyond what Step 2 below updates.
  const computed = useMemo(() => {
    if (loading) return null
    const analyzedStems = stems.filter((s) => featuresByKey.has(s.key))
    const rawVectorsByKey = new Map<string, number[]>()
    for (const s of analyzedStems) {
      const features = featuresByKey.get(s.key)
      if (features) rawVectorsByKey.set(s.key, toFeatureArray(features))
    }
    return { analyzedStems, rawVectorsByKey }
  }, [loading, stems, featuresByKey])
```

Add the new import alongside the existing ones at the top of the file:

```ts
import { useStemFeatureScan } from '../audio/useStemFeatureScan'
```

`getStemFeatures` is no longer called directly in this file — remove its now-unused import (`import { getStemFeatures } from '../audio/stemFeaturesCache'`).

- [ ] **Step 2: Simplify the one remaining `computed.forStems` reference**

The `partitioned` `useMemo` (around line 301) currently guards with:

```ts
    if (!computed || computed.forStems !== stems) return null
```

Since the new `computed` above is `null` exactly when `loading` is true and is otherwise always freshly derived from the current `stems`/`featuresByKey`, simplify this to:

```ts
    if (!computed) return null
```

This is the only other reference to `computed.forStems` in the file (confirmed by grepping the pre-edit file for `computed\.` — the only other matches are `computed.rawVectorsByKey.get(m.key)` inside `trainCentroids`, whose shape is unchanged and needs no edit).

- [ ] **Step 3: Run typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: no errors.

- [ ] **Step 4: Run the full test suite**

Run: `npm test`
Expected: no regressions.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/ClusterStemsBrowser.tsx
git commit -m "$(cat <<'EOF'
Migrate ClusterStemsBrowser.tsx onto useStemFeatureScan

Replaces its own inline useEffect+Promise.allSettled scan wrapper with
the shared hook (design spec §9) -- toFeatureArray/standardizeFeatures/
clustering/trainCentroids all keep their exact current behavior. Needs
Elling's own manual walkthrough: confirm Tidy Up still scans stems, shows
suggestions, and clusters exactly as before.
EOF
)"
```

---

### Task 12: Migrate `AutoArrangeRoleStep.tsx` onto `useStemFeatureScan`

**Files:**
- Modify: `src/renderer/src/components/AutoArrangeRoleStep.tsx`

**Before you start:** re-read the current file fresh. The scan effect currently lives around lines 268-332, computing `roles` (via synchronous `resolveStemRole`, unrelated to feature extraction) and `densities` (from `computeDensityScore` over each stem's scanned features, fed into `buildDensityMap` per owning rifff). This task replaces ONLY the extraction mechanics inside that effect — `resolveStemRole`/`computeDensityScore`/`buildDensityMap` all keep their exact current behavior and results.

- [ ] **Step 1: Replace the scan effect with the shared hook**

Replace this block (current lines 268-332 — the whole `useEffect`):

```ts
  useEffect(() => {
    if (flatStems.length === 0) return
    let cancelled = false
    async function load(): Promise<void> {
      const resolved: StemRoleInfo[] = flatStems.map(({ stem, stemKey: key }) =>
        resolveStemRole(stem, key, busOf[key] ?? null)
      )
      const results = await Promise.allSettled(
        flatStems.map(({ stem }) => getStemFeatures(stem.path).then(computeDensityScore))
      )
      if (cancelled) return
      results.forEach((result, i) => {
        if (result.status === 'rejected') {
          console.error(
            'AutoArrangeRoleStep: feature extraction failed for stem',
            flatStems[i].stem.path,
            result.reason
          )
        }
      })
      setRoles(resolved)
      let cursor = 0
      const densityMap: Record<string, number> = {}
      for (const rifff of placedRifffs) {
        const sliceResults = results.slice(cursor, cursor + rifff.stems.length)
        Object.assign(densityMap, buildDensityMap(rifff.stems, rifff.groupId, sliceResults))
        cursor += rifff.stems.length
      }
      setDensities(densityMap)
    }
    load().catch((err: unknown) => {
      if (!cancelled) {
        console.error('AutoArrangeRoleStep: role/feature load failed', err)
        setRoles([])
        setDensities({})
      }
    })
    return () => {
      cancelled = true
    }
  }, [flatStems, placedRifffs, busOf])
```

with:

```ts
  const scanItems = useMemo(
    () => flatStems.map(({ stem, stemKey: key }) => ({ key, path: stem.path })),
    [flatStems]
  )
  const { loading: scanLoading, featuresByKey } = useStemFeatureScan(scanItems)

  // buildDensityMap's own PromiseSettledResult<number>[] shape (one entry
  // per stem, in flatStems order, 'fulfilled' with a density score or
  // 'rejected') is reused as-is here -- rather than changing that shared
  // helper's own signature, a scanned-but-missing feature (a stem
  // useStemFeatureScan's own Promise.allSettled excluded) is turned back
  // into an equivalent 'rejected' entry, and buildDensityMap's existing
  // "rejected -> density score 0, 'sparse'" fallback handles it exactly
  // the same way a genuinely rejected extraction always has.
  const densityResults = useMemo<PromiseSettledResult<number>[]>(
    () =>
      flatStems.map(({ stem, stemKey: key }) => {
        const features = featuresByKey.get(key)
        return features
          ? { status: 'fulfilled', value: computeDensityScore(features) }
          : { status: 'rejected', reason: new Error(`no scanned features for stem ${stem.path}`) }
      }),
    [flatStems, featuresByKey]
  )

  useEffect(() => {
    if (flatStems.length === 0) return
    if (scanLoading) return
    const resolved: StemRoleInfo[] = flatStems.map(({ stem, stemKey: key }) =>
      resolveStemRole(stem, key, busOf[key] ?? null)
    )
    setRoles(resolved)
    let cursor = 0
    const densityMap: Record<string, number> = {}
    for (const rifff of placedRifffs) {
      const sliceResults = densityResults.slice(cursor, cursor + rifff.stems.length)
      Object.assign(densityMap, buildDensityMap(rifff.stems, rifff.groupId, sliceResults))
      cursor += rifff.stems.length
    }
    setDensities(densityMap)
  }, [flatStems, placedRifffs, busOf, scanLoading, densityResults])
```

Add the new import:

```ts
import { useStemFeatureScan } from '../audio/useStemFeatureScan'
```

`getStemFeatures` is no longer called directly in this file — remove its now-unused import (`import { getStemFeatures } from '../audio/stemFeaturesCache'`).

- [ ] **Step 2: Confirm the loading-state guard below still matches**

The component's own `if (!roles) return <div>...analyzing stems...</div>` early return (further down the file) is unchanged by this task — `roles` is still `null` until the effect above's `setRoles(resolved)` runs, which now additionally waits on `scanLoading` being `false` first. With Task 8's persistent cache and Task 10's ambient scan in place, this state should now resolve near-instantly in the common case (most placed stems already scanned). Confirm this by reading the render body once the edit is in place; no code change should be needed here, this is a verification-only sub-step.

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
Migrate AutoArrangeRoleStep.tsx onto useStemFeatureScan

Replaces its own inline useEffect+Promise.allSettled scan wrapper with
the shared hook (design spec §9) -- resolveStemRole/computeDensityScore/
buildDensityMap all keep their exact current behavior and fallback for a
stem whose extraction failed. Needs Elling's own manual walkthrough:
confirm both Auto-Arrange and Draw Arrangement (which reuses this same
component) still show roles/densities and reach "analyzing stems..." ->
results, ideally near-instantly now that scanning is proactive.
EOF
)"
```

---

### Task 13: Tidy Up's bus forward-capture write

**Files:**
- Modify: `src/renderer/src/components/ClusterStemsBrowser.tsx`
- Modify: `src/renderer/src/App.tsx`

- [ ] **Step 1: Thread `currentSketch` into `ClusterStemsBrowser`'s props**

In `src/renderer/src/components/ClusterStemsBrowser.tsx`, change the component signature from:

```ts
export function ClusterStemsBrowser({ onClose }: { onClose: () => void }): React.JSX.Element {
```

to:

```ts
export function ClusterStemsBrowser({
  onClose,
  currentSketch
}: {
  onClose: () => void
  currentSketch: ProjectRef
}): React.JSX.Element {
```

Add the import:

```ts
import type { ProjectRef } from '@shared/types'
```

- [ ] **Step 2: Record the bus categorization alongside `trainCentroids`**

Add a new function near `trainCentroids` (around line 431):

```ts
  // Forward-captures every member's BusId into the library-wide
  // StemCategories table (design spec §2) -- fire-and-forget, mirrors how
  // trainCentroids above already sits alongside the ASSIGN_STEMS_TO_BUS
  // dispatch rather than blocking on it. Uses each member's own `path`
  // (content-addressed by StemCID for a real library stem -- see
  // stemCategoriesStore.ts's own doc comment); a member whose path doesn't
  // resolve to a real StemCID is silently skipped by the main-process side,
  // not an error here.
  function recordBusCategories(members: ClusterableStem[], busId: BusId): void {
    void window.rifffApi.upsertStemCategoryBus(
      members.map((m) => ({ path: m.path, busId })),
      'tidyup',
      currentSketch
    )
  }
```

Call it alongside both existing `trainCentroids(members, busId)` call sites:

In `assignCluster` (around line 454-461):

```ts
  function assignCluster(rowIndex: number, members: ClusterableStem[], busId: BusId): void {
    dispatch({ type: 'ASSIGN_STEMS_TO_BUS', stemKeys: members.map((m) => m.key), busId })
    trainCentroids(members, busId)
    recordBusCategories(members, busId)
    setCelebratingRow(rowIndex)
    window.setTimeout(() => {
      setCelebratingRow((current) => (current === rowIndex ? null : current))
    }, 500)
  }
```

In `assignSuggestedGroup` (around line 483-494):

```ts
  function assignSuggestedGroup(
    suggestedBus: BusId,
    members: ClusterableStem[],
    busId: BusId
  ): void {
    dispatch({ type: 'ASSIGN_STEMS_TO_BUS', stemKeys: members.map((m) => m.key), busId })
    trainCentroids(members, busId)
    recordBusCategories(members, busId)
    setCelebratingSuggestedBus(suggestedBus)
    window.setTimeout(() => {
      setCelebratingSuggestedBus((current) => (current === suggestedBus ? null : current))
    }, 500)
  }
```

- [ ] **Step 3: Pass `currentSketch` from `App.tsx`**

In `src/renderer/src/App.tsx`, at the `ClusterStemsBrowser` mount site (around line 2267):

```tsx
        {clusterStemsOpen && (
          <ClusterStemsBrowser onClose={() => setClusterStemsOpen(false)} currentSketch={currentSketch} />
        )}
```

- [ ] **Step 4: Run typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: no errors.

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: no regressions.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/ClusterStemsBrowser.tsx src/renderer/src/App.tsx
git commit -m "$(cat <<'EOF'
Forward-capture Tidy Up bus assignments into StemCategories

Every real bus confirmation (both a DSP-cluster assign and a suggestion
accept) now also writes into the library-wide StemCategories table,
alongside its existing AppState.busOf write and busCentroids training --
design spec §2. Needs Elling's own manual walkthrough: confirm assigning
a bus in Tidy Up still behaves identically (this is purely an added,
non-blocking side effect).
EOF
)"
```

---

### Task 14: Auto-Arrange/Draw-Arrangement role forward-capture write

**Files:**
- Create: `src/renderer/src/state/stemCategoryCapture.ts`
- Modify: `src/renderer/src/components/AutoArrangeWizard.tsx`
- Modify: `src/renderer/src/components/DrawArrangeWizard.tsx`
- Modify: `src/renderer/src/App.tsx`

- [ ] **Step 1: Create the shared capture helper**

Create `src/renderer/src/state/stemCategoryCapture.ts`:

```ts
// src/renderer/src/state/stemCategoryCapture.ts
import type { StemRoleInfo } from '@shared/stemRole'
import type { ProjectRef } from '@shared/types'
import type { FlatStem } from './usePlacedFlatStems'

/** Forward-captures every INCLUDED stem's confirmed arrangeRole/drumSubRole
 * into the library-wide StemCategories table (design spec §2) -- fire-and-
 * forget, matching ClusterStemsBrowser.tsx's own recordBusCategories. This
 * is new behavior: today this data reaches nowhere at all once the wizard
 * closes (see the design spec's own Background) -- it's the only way
 * role/drum-sub-role data ever becomes recoverable going forward.
 *
 * Shared by AutoArrangeWizard.tsx and DrawArrangeWizard.tsx's own
 * handleRoleConfirm, which both reach this exact same confirmation shape
 * from otherwise-unrelated flows -- duplicating this per-wizard would
 * silently let the two call sites drift out of sync with each other (see
 * the design spec's own §9 consolidation priority). */
export function recordRoleCategorization(
  roles: StemRoleInfo[],
  flatStemsByKey: Map<string, FlatStem>,
  source: 'autoarrange' | 'drawarrange',
  currentSketch: ProjectRef
): void {
  const entries: {
    path: string
    arrangeRole: StemRoleInfo['arrangeRole']
    drumSubRole?: StemRoleInfo['drumSubRole']
  }[] = []
  for (const role of roles) {
    if (!role.included) continue
    const stem = flatStemsByKey.get(role.stemKey)?.stem
    if (!stem) continue
    entries.push({ path: stem.path, arrangeRole: role.arrangeRole, drumSubRole: role.drumSubRole })
  }
  if (entries.length === 0) return
  void window.rifffApi.upsertStemCategoryRole(entries, source, currentSketch)
}
```

- [ ] **Step 2: Call it from `AutoArrangeWizard.tsx`**

In `src/renderer/src/components/AutoArrangeWizard.tsx`, change the `Props` interface:

```ts
interface Props {
  onClose: () => void
  currentSketch: ProjectRef
}
```

Add the imports:

```ts
import type { ProjectRef } from '@shared/types'
import { recordRoleCategorization } from '../state/stemCategoryCapture'
```

Update the component signature and add the call at the top of `handleRoleConfirm`, right after `const included = roles.filter((r) => r.included)`:

```ts
export function AutoArrangeWizard({ onClose, currentSketch }: Props): React.JSX.Element {
  const dispatch = useDispatch()
  const state = useAppState()
  const { flatStemsByKey } = usePlacedFlatStems()

  async function handleRoleConfirm(
    roles: StemRoleInfo[],
    buildOptions?: { targetSections: number; shape: ArrangeShape }
  ): Promise<void> {
    const { targetSections, shape } = buildOptions!

    const included = roles.filter((r) => r.included)
    recordRoleCategorization(roles, flatStemsByKey, 'autoarrange', currentSketch)
    // ... rest of the function unchanged
```

- [ ] **Step 3: Call it from `DrawArrangeWizard.tsx`**

In `src/renderer/src/components/DrawArrangeWizard.tsx`, change the `Props` interface:

```ts
interface Props {
  onClose: () => void
  currentSketch: ProjectRef
}
```

Add the imports:

```ts
import type { ProjectRef } from '@shared/types'
import { recordRoleCategorization } from '../state/stemCategoryCapture'
```

Update the component signature and add the call at the top of `handleRoleConfirm`:

```ts
export function DrawArrangeWizard({ onClose, currentSketch }: Props): React.JSX.Element {
  const dispatch = useDispatch()
  const state = useAppState()
  const { flatStemsByKey } = usePlacedFlatStems()

  const [step, setStep] = useState<WizardStep>({ phase: 'role' })

  function handleRoleConfirm(roles: StemRoleInfo[]): void {
    recordRoleCategorization(roles, flatStemsByKey, 'drawarrange', currentSketch)
    const included = roles.filter((r) => r.included)
    // ... rest of the function unchanged
```

- [ ] **Step 4: Pass `currentSketch` from `App.tsx`**

In `src/renderer/src/App.tsx`, at the `AutoArrangeWizard`/`DrawArrangeWizard` mount sites (around lines 2268-2269):

```tsx
        {autoArrangeOpen && (
          <AutoArrangeWizard onClose={() => setAutoArrangeOpen(false)} currentSketch={currentSketch} />
        )}
        {drawArrangeOpen && (
          <DrawArrangeWizard onClose={() => setDrawArrangeOpen(false)} currentSketch={currentSketch} />
        )}
```

- [ ] **Step 5: Run typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: no errors.

- [ ] **Step 6: Run the full test suite**

Run: `npm test`
Expected: no regressions.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/state/stemCategoryCapture.ts src/renderer/src/components/AutoArrangeWizard.tsx src/renderer/src/components/DrawArrangeWizard.tsx src/renderer/src/App.tsx
git commit -m "$(cat <<'EOF'
Forward-capture Auto-Arrange/Draw-Arrangement role confirmations

Every included stem's confirmed arrangeRole/drumSubRole now also writes
into the library-wide StemCategories table on confirm -- design spec §2.
This is the only way this data ever becomes recoverable going forward
(it was never persisted anywhere before this, not even to the project
file -- see the design spec's own Background). Needs Elling's own manual
walkthrough: confirm both Auto-Arrange and Draw Arrangement still build/
apply arrangements identically (this is purely an added, non-blocking
side effect on confirm).
EOF
)"
```

---

### Task 15: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Full typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 2: Full lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 3: Full test suite**

Run: `npm test`
Expected: all tests pass, including every new test file from Tasks 1-8.

- [ ] **Step 4: Grep for stale references**

Run: `grep -rn "getStemFeatures" src/renderer/src/components/AutoArrangeRoleStep.tsx src/renderer/src/components/ClusterStemsBrowser.tsx`
Expected: no matches — both files should call `getStemFeatures` only indirectly, through `useStemFeatureScan`, not directly anymore.

- [ ] **Step 5: Write the manual-walkthrough summary for Elling**

Post a summary (not a file — just the session's own final message) listing exactly what needs a real, interactive walkthrough before this is considered done, per this codebase's standing convention that a coding agent cannot click through the UI itself:

1. **Persistent + ambient scanning (Tasks 8/10, the headline change this session added mid-plan)**: open a project with several stems that have never been scanned before, wait a few seconds without opening any screen, then open Tidy Up or Auto-Arrange — either should show little to no "analyzing stems..." wait, since `BackgroundFeatureScan` should have already warmed the cache. Restart the app entirely and re-open the same project — the SAME stems should scan even faster the second time (persistent cache surviving the restart), not restart the wait from scratch.
2. **Tidy Up (`ClusterStemsBrowser.tsx`)**: confirm scanning/clustering/suggestions still work exactly as before (Task 11's hook migration), and confirm assigning a bus (both a DSP-cluster row and a suggested row) still works with no visible change (Task 13's new forward-capture write).
3. **Auto-Arrange (`AutoArrangeRoleStep.tsx` via `AutoArrangeWizard.tsx`)**: confirm role/density resolution still shows correctly and the automated build still runs (Task 12's hook migration), and confirm clicking "build" with real included stems works with no visible change (Task 14's new forward-capture write).
4. **Draw Arrangement (`AutoArrangeRoleStep.tsx` via `DrawArrangeWizard.tsx`)**: same as above for its own role-confirmation step and grid-drawing flow.
5. **Backfill migration**: on next app launch against a real library with pre-existing tidied sketches, spot-check (e.g. via a temporary `console.log` or a DB browser against `warehouse.db3`) that `StemCategories` picked up real `busOf` history from at least one old project file.

- [ ] **Step 6: No commit for this task** (verification only — nothing to commit unless Step 4's grep or the test suite surfaces something to fix, in which case fix it and commit as its own small fix).
