# LORE Warehouse Sync — Backend (Schema + Task-Queue Sync Engine) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build sssketch's own self-built SQLite LORE warehouse (schema matching the existing
`loreWarehouse.ts` reader) plus a NULL-column-resumable sync engine that fills it from a person's
own Endlesss shared feed and private jam(s) — as a fully additive, parallel system alongside the
existing `endlesssSyncIndex.ts`/`endlesssSync.ts` JSON-index sync, not yet wired into the UI or
the on-demand browsing path.

**Architecture:** A new writable SQLite connection (`loreWarehouseSchema.ts`) at a fixed path
sssketch owns outright (`<userData>/lore-warehouse/cache/common/warehouse.db3` — same
`cache/common/` suffix `loreWarehouse.ts`'s reader already expects from a real LORE folder, so a
future reader pointed at this root needs zero changes there). A pure row-persistence layer
(`loreWarehouseWriter.ts`) turns already-resolved riff/stem data into warehouse rows. A sync
engine (`loreWarehouseSync.ts`) walks the shared feed / a jam page by page, skeleton-inserts every
riff it sees (`INSERT ... ON CONFLICT DO NOTHING`, safe to repeat forever), and resolves whichever
riffs on that page aren't already fully resolved (`AppVersion IS NULL`) — a page where every riff
is already fully resolved is where the walk safely stops, which is what actually fixes the old
JSON-index sync's boundary-stop bug (a riff that was *seen* but never *resolved* used to get
skipped forever; now it's found again on every run until it resolves). All real network/parsing
logic (auth, doc fetching, stem CDN download+retry, malformed-data repairs) is reused unchanged
from `endlesssApi.ts` — this plan adds a persistence layer on top of it, not a second copy of it.

**Tech Stack:** TypeScript, `better-sqlite3` (already a dependency, already used by
`loreWarehouse.ts`), Vitest.

**Scope note — this is Plan 1 of 2.** This plan is deliberately backend-only: nothing here changes
what either existing library browser shows, what the existing `list-riff-favourites`/
`toggle-riff-favourite`/`endlesss-start-sync-*` IPC channels do, or removes any existing file. The
new sync runs via new, separate `lore-sync-*` IPC channels this plan adds. A second plan
(**Plan 2**, not yet written) will merge `EndlesssLibraryBrowser.tsx` and `LoreLibraryBrowser.tsx`
into one component reading this warehouse, migrate `riffFavourites.ts` into the new `Tags` table,
and remove `endlesssSyncIndex.ts`/`endlesssSync.ts`/`riffFavourites.ts` once nothing depends on
them. Splitting this way means Plan 1 ships with **zero risk of regressing the app people are
using today** — the new sync is inert until Plan 2 wires it up — and Plan 2 can be scoped once
this backend is real and tested rather than designed speculatively. See
`docs/superpowers/specs/2026-08-09-lore-warehouse-sync-design.md` for the full design this plan
implements; where this plan simplifies something from that spec (see Task 4/5's own notes on why
there's no separate "gap-filling dispatcher" task), the reasoning is called out at that task.

---

### Task 1: `LoreResolvedRiff`/`LoreResolvedStem` — carry the raw fields the warehouse schema needs

**Files:**
- Modify: `src/shared/loreLibrary.ts:27-45,77-86`
- Modify: `src/main/endlesssApi.ts:350-394`
- Test: `src/main/endlesssApi.test.ts`

The warehouse schema (Task 2) needs `Root`/`Scale` as raw integers (today only resolved to a
display string via `resolveKeyName`) and each stem's `FileEndpoint`/`FileBucket`/`FileKey` as
separate columns (today only combined into one `downloadUrl` string) and each stem's own `BPMrnd`
(today not carried at all — only the derived `durationSec`/`barLength`). All five are already
computed as local variables inside `endlesssApi.ts`'s `buildResolvedRiff`/`buildResolvedStem`,
just not returned. All new fields are **optional** — `loreWarehouse.ts`'s own `resolveRiff` (an
existing, different construction site for these same interfaces, reading an *external* warehouse)
doesn't set them and must keep compiling unchanged; this task doesn't touch `loreWarehouse.ts`.

- [ ] **Step 1: Write the failing test**

Add to `src/main/endlesssApi.test.ts`, inside the existing `describe('endlesssApi shared feed', ...)`
block (near the other `resolveSharedFeedRiff` tests, e.g. after the one at line ~351):

```typescript
  it('resolveSharedFeedRiff carries raw root/scale and stem file components, not just derived values', async () => {
    const { listSharedFeed, resolveSharedFeedRiff } = await import('./endlesssApi')
    const fakeFetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: [
              {
                _id: 'shared_1',
                doc_id: 'riff_1',
                action_timestamp: 1700000000000,
                rifff: rawRiffDoc('stem_1', { root: 4, scale: 5 }),
                loops: [rawStemDoc(), null, null, null, null, null, null, null],
                image: false
              }
            ]
          }),
          { status: 200 }
        )
    )
    await listSharedFeed('elling', 0, 20, fakeFetch as typeof fetch)
    const resolved = await resolveSharedFeedRiff('riff_1', fakeFetch as typeof fetch)
    expect(resolved).not.toBeNull()
    expect(resolved!.root).toBe(4)
    expect(resolved!.scale).toBe(5)
    expect(resolved!.stems[0]).toMatchObject({
      bpm: 120,
      fileEndpoint: 'ndls-att0.fra1.digitaloceanspaces.com',
      fileKey: 'attachments/oggAudio/1/abc'
    })
    expect(resolved!.stems[0].fileBucket).toBeUndefined()
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/endlesssApi.test.ts -t "carries raw root/scale"`
Expected: FAIL — `resolved!.root` is `undefined`, not `4` (property doesn't exist yet on the
returned object).

- [ ] **Step 3: Add the fields to the shared interfaces**

In `src/shared/loreLibrary.ts`, modify the `LoreResolvedStem` interface (lines 27-45):

```typescript
export interface LoreResolvedStem {
  stemCID: string
  slot: number // 1-8
  path: string | null // local file path, or null if not cached
  gain: number // from the riff's GainsJSON, default 1.0
  creatorUserName: string
  presetName: string
  instrumentMask: number
  durationSec: number // computed from this stem's own BPMrnd/BarLength, not the riff's
  barLength: number // this stem's own loop length — may differ from the riff's own barLength if the stem tiles
  /** This stem's own BPM (already the OUROVEON-matching rounded value, see
   * bpsToRoundedBpm) — kept separately from durationSec/barLength (which are
   * DERIVED from it) so a warehouse writer can persist it as its own BPMrnd
   * column, matching loreWarehouse.ts's own Stems.BPMrnd. Undefined only for
   * a construction site that doesn't have it (loreWarehouse.ts's own
   * resolveRiff, reading an external warehouse, doesn't set this). */
  bpm?: number
  /** Direct, unauthenticated HTTPS URL for this stem's audio — the actual
   * stem blobs turn out to be public DigitalOcean Spaces objects (verified
   * against the real warehouse; the login LORE asks for is only for the
   * Endlesss metadata API, not for fetching cached-elsewhere audio). Null
   * only if the Stems row itself is missing (shouldn't happen for a
   * populated slot). Present even when path is already non-null — a caller
   * downloading only cares about the ones where path is null. */
  downloadUrl: string | null
  /** Raw components behind downloadUrl (endpoint/bucket/key -- see
   * stemDownloadUrl), kept separately rather than only the combined URL, so
   * a SQLite warehouse writer can persist them as their own
   * FileEndpoint/FileBucket/FileKey columns matching loreWarehouse.ts's own
   * Stems table, and reconstruct the URL the same way loreWarehouse.ts's
   * resolveRiff already does. Undefined when downloadUrl itself is null
   * (no oggAudio at all) or for a construction site that doesn't have raw
   * components available (loreWarehouse.ts's own resolveRiff). fileBucket
   * is specifically undefined (not empty string) when the real endpoint had
   * no separate bucket subdomain -- matches stemDownloadUrl's own
   * fileBucket-is-optional contract. */
  fileEndpoint?: string
  fileBucket?: string
  fileKey?: string
}
```

And `LoreResolvedRiff` (lines 77-86):

```typescript
export interface LoreResolvedRiff {
  riffCID: string
  bpm: number
  barLength: number
  /** e.g. "E Minor (Aeolian)" -- resolved from the warehouse's own Root/
   * Scale columns (see loreWarehouse.ts's resolveKeyName). Undefined for
   * riffs predating this metadata, not every riff has it. */
  key?: string
  /** Raw Root/Scale ints behind `key` (see resolveKeyName) -- kept
   * separately so a warehouse writer can persist them as their own
   * Root/Scale columns rather than only the derived display string.
   * Undefined for a construction site that doesn't have them
   * (loreWarehouse.ts's own resolveRiff only derives `key`, not these). */
  root?: number
  scale?: number
  stems: LoreResolvedStem[]
}
```

- [ ] **Step 4: Populate the new fields in `buildResolvedStem`/`buildResolvedRiff`**

In `src/main/endlesssApi.ts`, modify `buildResolvedStem` (lines 350-372):

```typescript
function buildResolvedStem(stem: RawStemDoc, slot: number, gain: number): LoreResolvedStem {
  const bpm = bpsToRoundedBpm(stem.bps)
  const barLength = stem.length16ths / 16
  const ogg = stem.cdn_attachments.oggAudio
  const downloadUrl =
    ogg == null
      ? null
      : ogg.key
        ? stemDownloadUrl(ogg.endpoint, ogg.bucket ?? '', ogg.key)
        : (ogg.url ?? null)
  return {
    stemCID: stem._id,
    slot,
    path: null,
    gain,
    creatorUserName: stem.creatorUserName,
    presetName: stem.presetName,
    instrumentMask: stemFlagsToMask(stem),
    durationSec: barLength * (60 / bpm) * 4,
    barLength,
    bpm,
    downloadUrl,
    fileEndpoint: ogg?.endpoint,
    fileBucket: ogg?.bucket,
    fileKey: ogg?.key
  }
}
```

And `buildResolvedRiff` (lines 374-394):

```typescript
function buildResolvedRiff(
  riffCID: string,
  riffDoc: RawRiffDoc,
  stemDocs: (RawStemDoc | null)[]
): LoreResolvedRiff {
  const stems: LoreResolvedStem[] = []
  riffDoc.state.playback.forEach((slotWrapper, index) => {
    const current = slotWrapper.slot?.current
    if (!current || !current.on || !current.currentLoop) return
    const stemDoc = stemDocs.find((s) => s?._id === current.currentLoop)
    if (!stemDoc) return
    stems.push(buildResolvedStem(stemDoc, index + 1, current.gain))
  })
  return {
    riffCID,
    bpm: bpsToRoundedBpm(riffDoc.state.bps),
    barLength: riffDoc.state.barLength,
    key: resolveKeyName(riffDoc.root, riffDoc.scale),
    root: riffDoc.root,
    scale: riffDoc.scale,
    stems
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/main/endlesssApi.test.ts -t "carries raw root/scale"`
Expected: PASS

- [ ] **Step 6: Run the full existing endlesssApi test suite to confirm no regression**

Run: `npx vitest run src/main/endlesssApi.test.ts`
Expected: PASS (all tests, including the pre-existing ones this didn't touch)

- [ ] **Step 7: Commit**

```bash
git add src/shared/loreLibrary.ts src/main/endlesssApi.ts src/main/endlesssApi.test.ts
git commit -m "$(cat <<'EOF'
Carry raw root/scale and stem file components on LoreResolvedRiff/Stem

Both were already computed locally in buildResolvedRiff/buildResolvedStem
but discarded before being returned. The upcoming SQLite warehouse writer
needs them as separate columns, not just the derived key string/downloadUrl.
EOF
)"
```

---

### Task 2: `loreWarehouseSchema.ts` — DDL + own warehouse path + connection

**Files:**
- Create: `src/main/loreWarehouseSchema.ts`
- Test: `src/main/loreWarehouseSchema.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/main/loreWarehouseSchema.test.ts
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let userDataDir: string

vi.mock('electron', () => ({
  app: {
    getPath: () => userDataDir
  }
}))

describe('loreWarehouseSchema', () => {
  beforeEach(() => {
    userDataDir = mkdtempSync(join(tmpdir(), 'sssketch-warehouse-schema-test-'))
  })

  afterEach(async () => {
    const { closeOwnWarehouseDb } = await import('./loreWarehouseSchema')
    closeOwnWarehouseDb()
    rmSync(userDataDir, { recursive: true, force: true })
  })

  it('ownWarehouseDbPath lives under cache/common, matching loreWarehouse.ts\'s own join convention', async () => {
    const { ownWarehouseDbPath } = await import('./loreWarehouseSchema')
    expect(ownWarehouseDbPath()).toBe(
      join(userDataDir, 'lore-warehouse', 'cache', 'common', 'warehouse.db3')
    )
  })

  it('openOwnWarehouseDb creates the db file and every expected table', async () => {
    const { openOwnWarehouseDb, ownWarehouseDbPath } = await import('./loreWarehouseSchema')
    const db = openOwnWarehouseDb()
    expect(existsSync(ownWarehouseDbPath())).toBe(true)
    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`)
      .all() as { name: string }[]
    expect(tables.map((t) => t.name)).toEqual(['Jams', 'Riffs', 'StemLedger', 'Stems', 'Tags'])
  })

  it('opening twice returns the same cached connection, not a second one', async () => {
    const { openOwnWarehouseDb } = await import('./loreWarehouseSchema')
    const first = openOwnWarehouseDb()
    const second = openOwnWarehouseDb()
    expect(first).toBe(second)
  })

  it('closeOwnWarehouseDb followed by a re-open works (re-creates the schema idempotently)', async () => {
    const { openOwnWarehouseDb, closeOwnWarehouseDb } = await import('./loreWarehouseSchema')
    openOwnWarehouseDb()
    closeOwnWarehouseDb()
    expect(() => openOwnWarehouseDb()).not.toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/loreWarehouseSchema.test.ts`
Expected: FAIL with "Cannot find module './loreWarehouseSchema'"

- [ ] **Step 3: Write the implementation**

```typescript
// src/main/loreWarehouseSchema.ts
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app } from 'electron'
import Database from 'better-sqlite3'

/** sssketch's own self-built LORE-style warehouse -- distinct from any
 * externally-pointed OUROVEON warehouse a user might separately configure
 * via LoreLibraryBrowser's own folder picker (loreWarehouse.ts). Lives
 * under the same cache/common/ sub-path convention loreWarehouse.ts's own
 * warehouseDbPath()/resolveStemPath() already expect from a real
 * LORE-synced folder, so a future reader pointed at this root (see this
 * plan's "Plan 2" note) needs zero changes to loreWarehouse.ts's path
 * logic -- only which root it's given. */
export function ownWarehouseRoot(): string {
  return join(app.getPath('userData'), 'lore-warehouse')
}

export function ownWarehouseDbPath(): string {
  return join(ownWarehouseRoot(), 'cache', 'common', 'warehouse.db3')
}

// Schema matches what loreWarehouse.ts's own SELECT queries already read
// from a real OUROVEON-built warehouse (RiffRow/FullRiffRow/FullStemRow in
// loreWarehouse.ts, cross-checked against loreWarehouse.test.ts's own
// fixture table DDL) -- Length16s (not BarLength) is the column
// loreWarehouse.ts's resolveRiff actually selects for a stem's own loop
// length; BarLength for Stems is real-OUROVEON-schema cruft loreWarehouse.ts
// itself never reads, so it's omitted here rather than carried for no
// reason. AppVersion (Riffs) and SyncComplete (Jams) are new columns
// loreWarehouse.ts never reads -- purely this sync engine's own
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
  OwnerJamCID TEXT NOT NULL,
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
 * warehouse connection and ensures the schema exists -- CREATE TABLE/INDEX
 * IF NOT EXISTS make re-running the DDL on every open a cheap no-op once
 * it's already there, so there's no separate "has this been initialized"
 * flag to track. WAL mode so a background sync writing doesn't block a
 * concurrent read from the same process. Cached at module scope, matching
 * loreWarehouse.ts's own getWarehouseDb -- callers needing a fresh handle
 * (tests especially) call closeOwnWarehouseDb() first. */
export function openOwnWarehouseDb(): Database.Database {
  if (cachedDb) return cachedDb
  const path = ownWarehouseDbPath()
  if (!existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true })
  const db = new Database(path)
  db.pragma('journal_mode = WAL')
  db.exec(SCHEMA_SQL)
  cachedDb = db
  return db
}

export function closeOwnWarehouseDb(): void {
  cachedDb?.close()
  cachedDb = null
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/loreWarehouseSchema.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/loreWarehouseSchema.ts src/main/loreWarehouseSchema.test.ts
git commit -m "$(cat <<'EOF'
Add sssketch's own self-built LORE warehouse schema + connection

Same cache/common/warehouse.db3 path convention loreWarehouse.ts already
expects from a real LORE-synced folder, so a future reader pointed at this
root works with zero changes to its own path logic.
EOF
)"
```

---

### Task 3: `loreWarehouseWriter.ts` — row persistence + gap queries

**Files:**
- Create: `src/main/loreWarehouseWriter.ts`
- Test: `src/main/loreWarehouseWriter.test.ts`

Pure functions taking a `Database.Database` handle (dependency-injected, not module-cached) — so
tests can use an isolated in-memory/tmp-file DB without touching the real userData path, matching
this codebase's convention of narrow, explicit test seams.

- [ ] **Step 1: Write the failing test**

```typescript
// src/main/loreWarehouseWriter.test.ts
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import type { LoreResolvedRiff } from '@shared/loreLibrary'
import {
  upsertJam,
  markJamSyncComplete,
  upsertRiffSkeletons,
  writeRiffDetail,
  findRiffsNeedingDetail,
  markStemDownloadFailed,
  isStemLedgered,
  getWarehouseSyncStatus
} from './loreWarehouseWriter'

// Same DDL as loreWarehouseSchema.ts's SCHEMA_SQL -- duplicated here
// (rather than importing openOwnWarehouseDb, which requires mocking
// electron's app.getPath for no benefit to these tests) so this test file
// can build an isolated in-memory DB with zero Electron dependency, one
// level below where loreWarehouseSchema.test.ts already covers the real
// path/open logic.
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
    CREATE TABLE Tags (RiffCID TEXT PRIMARY KEY, OwnerJamCID TEXT NOT NULL, Favour INTEGER NOT NULL DEFAULT 0, Note TEXT);
    CREATE TABLE StemLedger (StemCID TEXT PRIMARY KEY, Type TEXT NOT NULL, Note TEXT);
  `)
  return db
}

function resolvedRiffFixture(overrides: Partial<LoreResolvedRiff> = {}): LoreResolvedRiff {
  return {
    riffCID: 'riff_1',
    bpm: 120,
    barLength: 4,
    root: 4,
    scale: 5,
    stems: [
      {
        stemCID: 'stem_1',
        slot: 1,
        path: '/cache/stem_1',
        gain: 0.8,
        creatorUserName: 'elling',
        presetName: '808 Kick',
        instrumentMask: 2,
        durationSec: 8,
        barLength: 4,
        bpm: 120,
        downloadUrl: 'https://example.com/stem_1',
        fileEndpoint: 'example.com',
        fileKey: 'stem_1'
      }
    ],
    ...overrides
  }
}

describe('loreWarehouseWriter', () => {
  let db: Database.Database

  beforeEach(() => {
    db = freshDb()
  })

  afterEach(() => {
    db.close()
  })

  it('upsertJam inserts then updates PublicName on conflict', () => {
    upsertJam(db, 'jam_1', 'First Name')
    upsertJam(db, 'jam_1', 'Renamed')
    const row = db.prepare('SELECT PublicName FROM Jams WHERE JamCID = ?').get('jam_1') as {
      PublicName: string
    }
    expect(row.PublicName).toBe('Renamed')
  })

  it('markJamSyncComplete flips SyncComplete to 1', () => {
    upsertJam(db, 'jam_1', 'Jam')
    markJamSyncComplete(db, 'jam_1')
    const status = getWarehouseSyncStatus(db, 'jam_1')
    expect(status?.complete).toBe(true)
  })

  it('upsertRiffSkeletons inserts new rows and leaves existing detail untouched', () => {
    upsertJam(db, 'jam_1', 'Jam')
    writeRiffDetail(db, 'jam_1', { creationTime: 100, userName: 'elling' }, resolvedRiffFixture())
    upsertRiffSkeletons(db, 'jam_1', [{ riffCID: 'riff_1', creationTime: 999 }, { riffCID: 'riff_2', creationTime: 200 }])
    const riff1 = db.prepare('SELECT CreationTime, AppVersion FROM Riffs WHERE RiffCID = ?').get('riff_1') as {
      CreationTime: number
      AppVersion: number | null
    }
    // Already-detailed riff_1 keeps its real CreationTime (100) and
    // AppVersion (1) -- ON CONFLICT DO NOTHING, not an overwrite.
    expect(riff1).toEqual({ CreationTime: 100, AppVersion: 1 })
    const riff2 = db.prepare('SELECT AppVersion FROM Riffs WHERE RiffCID = ?').get('riff_2') as {
      AppVersion: number | null
    }
    expect(riff2.AppVersion).toBeNull()
  })

  it('writeRiffDetail persists every stem slot, gains, and root/scale', () => {
    upsertJam(db, 'jam_1', 'Jam')
    writeRiffDetail(db, 'jam_1', { creationTime: 100, userName: 'elling' }, resolvedRiffFixture())
    const riff = db.prepare('SELECT * FROM Riffs WHERE RiffCID = ?').get('riff_1') as Record<string, unknown>
    expect(riff.StemCID_1).toBe('stem_1')
    expect(riff.StemCID_2).toBeNull()
    expect(riff.Root).toBe(4)
    expect(riff.Scale).toBe(5)
    expect(JSON.parse(riff.GainsJSON as string)).toEqual({ '1': 0.8 })
    expect(riff.AppVersion).toBe(1)
    const stem = db.prepare('SELECT * FROM Stems WHERE StemCID = ?').get('stem_1') as Record<string, unknown>
    expect(stem.FileEndpoint).toBe('example.com')
    expect(stem.FileKey).toBe('stem_1')
    expect(stem.Length16s).toBe(64) // barLength 4 * 16
    expect(stem.CreationTime).toBe(100)
  })

  it('writeRiffDetail on an already-skeleton-inserted stem fills in its detail rather than erroring', () => {
    upsertJam(db, 'jam_1', 'Jam')
    // Simulate a prior riff having already referenced this same stemCID as
    // a bare skeleton (the real cross-riff-shared-stem case).
    db.prepare('INSERT INTO Stems (StemCID, OwnerJamCID) VALUES (?, ?)').run('stem_1', 'jam_1')
    writeRiffDetail(db, 'jam_1', { creationTime: 100, userName: 'elling' }, resolvedRiffFixture())
    const stem = db.prepare('SELECT CreatorUserName FROM Stems WHERE StemCID = ?').get('stem_1') as {
      CreatorUserName: string
    }
    expect(stem.CreatorUserName).toBe('elling')
  })

  it('findRiffsNeedingDetail returns only rows with a NULL AppVersion, scoped to the jam', () => {
    upsertRiffSkeletons(db, 'jam_1', [{ riffCID: 'r1', creationTime: 1 }, { riffCID: 'r2', creationTime: 2 }])
    upsertRiffSkeletons(db, 'jam_2', [{ riffCID: 'r3', creationTime: 3 }])
    upsertJam(db, 'jam_1', 'Jam 1')
    writeRiffDetail(db, 'jam_1', { creationTime: 1, userName: 'elling' }, resolvedRiffFixture({ riffCID: 'r1' }))
    expect(findRiffsNeedingDetail(db, 'jam_1', 10)).toEqual(['r2'])
    expect(findRiffsNeedingDetail(db, 'jam_2', 10)).toEqual(['r3'])
  })

  it('markStemDownloadFailed is idempotent and queryable via isStemLedgered', () => {
    expect(isStemLedgered(db, 'stem_1')).toBe(false)
    markStemDownloadFailed(db, 'stem_1')
    markStemDownloadFailed(db, 'stem_1')
    expect(isStemLedgered(db, 'stem_1')).toBe(true)
    const rows = db.prepare('SELECT COUNT(*) as n FROM StemLedger WHERE StemCID = ?').get('stem_1') as { n: number }
    expect(rows.n).toBe(1)
  })

  it('getWarehouseSyncStatus reflects real riff count and completeness', () => {
    upsertJam(db, 'jam_1', 'Jam')
    upsertRiffSkeletons(db, 'jam_1', [{ riffCID: 'r1', creationTime: 1 }, { riffCID: 'r2', creationTime: 2 }])
    expect(getWarehouseSyncStatus(db, 'jam_1')).toEqual({ riffCount: 2, complete: false })
    markJamSyncComplete(db, 'jam_1')
    expect(getWarehouseSyncStatus(db, 'jam_1')).toEqual({ riffCount: 2, complete: true })
  })

  it('getWarehouseSyncStatus returns null for an unknown jam', () => {
    expect(getWarehouseSyncStatus(db, 'nope')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/loreWarehouseWriter.test.ts`
Expected: FAIL with "Cannot find module './loreWarehouseWriter'"

- [ ] **Step 3: Write the implementation**

```typescript
// src/main/loreWarehouseWriter.ts
import type Database from 'better-sqlite3'
import type { LoreResolvedRiff } from '@shared/loreLibrary'

export function upsertJam(db: Database.Database, jamCID: string, publicName: string): void {
  db.prepare(
    `INSERT INTO Jams (JamCID, PublicName) VALUES (?, ?)
     ON CONFLICT(JamCID) DO UPDATE SET PublicName = excluded.PublicName`
  ).run(jamCID, publicName)
}

export function markJamSyncComplete(db: Database.Database, jamCID: string): void {
  db.prepare(`UPDATE Jams SET SyncComplete = 1 WHERE JamCID = ?`).run(jamCID)
}

export interface RiffSkeleton {
  riffCID: string
  creationTime: number
}

/** Cheap, safe to call for every riff on every walked page regardless of
 * whether it's already known -- ON CONFLICT DO NOTHING means re-discovering
 * an already-detailed riff is a no-op, not an overwrite. This (not a
 * "have I seen this ID before" boundary check) is what lets the sync walk
 * safely continue past a riff that was skeleton-inserted on a prior,
 * interrupted run but never resolved -- see loreWarehouseSync.ts. */
export function upsertRiffSkeletons(db: Database.Database, jamCID: string, riffs: RiffSkeleton[]): void {
  const insert = db.prepare(
    `INSERT INTO Riffs (RiffCID, OwnerJamCID, CreationTime) VALUES (@riffCID, @jamCID, @creationTime)
     ON CONFLICT(RiffCID) DO NOTHING`
  )
  const txn = db.transaction((rows: RiffSkeleton[]) => {
    for (const row of rows) insert.run({ riffCID: row.riffCID, jamCID, creationTime: row.creationTime })
  })
  txn(riffs)
}

interface RiffDetailMeta {
  creationTime: number
  userName: string
}

/** Persists a fully-resolved riff (and every one of its stems) as real rows
 * -- AppVersion = 1 on the Riffs row is what marks it "no longer a gap" for
 * findRiffsNeedingDetail. Also skeleton-inserts (INSERT ... DO NOTHING) each
 * referenced stem before filling in its detail, so a stem shared across
 * riffs that hasn't been seen via any OTHER riff yet still gets a row. */
export function writeRiffDetail(
  db: Database.Database,
  jamCID: string,
  meta: RiffDetailMeta,
  resolved: LoreResolvedRiff
): void {
  const slots: (string | null)[] = Array.from({ length: 8 }, (_, i) => {
    const stem = resolved.stems.find((s) => s.slot === i + 1)
    return stem?.stemCID ?? null
  })
  const gains: Record<string, number> = {}
  for (const stem of resolved.stems) gains[String(stem.slot)] = stem.gain

  db.prepare(
    `INSERT INTO Riffs (
       RiffCID, OwnerJamCID, CreationTime, Root, Scale, BPMrnd, BarLength, UserName,
       StemCID_1, StemCID_2, StemCID_3, StemCID_4, StemCID_5, StemCID_6, StemCID_7, StemCID_8,
       GainsJSON, AppVersion
     ) VALUES (
       @riffCID, @jamCID, @creationTime, @root, @scale, @bpm, @barLength, @userName,
       @s1, @s2, @s3, @s4, @s5, @s6, @s7, @s8, @gainsJson, 1
     )
     ON CONFLICT(RiffCID) DO UPDATE SET
       OwnerJamCID = excluded.OwnerJamCID, CreationTime = excluded.CreationTime,
       Root = excluded.Root, Scale = excluded.Scale, BPMrnd = excluded.BPMrnd,
       BarLength = excluded.BarLength, UserName = excluded.UserName,
       StemCID_1 = excluded.StemCID_1, StemCID_2 = excluded.StemCID_2,
       StemCID_3 = excluded.StemCID_3, StemCID_4 = excluded.StemCID_4,
       StemCID_5 = excluded.StemCID_5, StemCID_6 = excluded.StemCID_6,
       StemCID_7 = excluded.StemCID_7, StemCID_8 = excluded.StemCID_8,
       GainsJSON = excluded.GainsJSON, AppVersion = 1`
  ).run({
    riffCID: resolved.riffCID,
    jamCID,
    creationTime: meta.creationTime,
    root: resolved.root ?? null,
    scale: resolved.scale ?? null,
    bpm: resolved.bpm,
    barLength: resolved.barLength,
    userName: meta.userName,
    s1: slots[0],
    s2: slots[1],
    s3: slots[2],
    s4: slots[3],
    s5: slots[4],
    s6: slots[5],
    s7: slots[6],
    s8: slots[7],
    gainsJson: JSON.stringify(gains)
  })

  const insertStemSkeleton = db.prepare(
    `INSERT INTO Stems (StemCID, OwnerJamCID) VALUES (?, ?) ON CONFLICT(StemCID) DO NOTHING`
  )
  const updateStemDetail = db.prepare(
    `UPDATE Stems SET
       CreationTime = @creationTime, FileEndpoint = @fileEndpoint, FileBucket = @fileBucket,
       FileKey = @fileKey, BPMrnd = @bpm, Instrument = @instrument, Length16s = @length16s,
       PresetName = @presetName, CreatorUserName = @creatorUserName
     WHERE StemCID = @stemCID`
  )
  const txn = db.transaction((stems: LoreResolvedRiff['stems']) => {
    for (const stem of stems) {
      insertStemSkeleton.run(stem.stemCID, jamCID)
      updateStemDetail.run({
        stemCID: stem.stemCID,
        creationTime: meta.creationTime,
        fileEndpoint: stem.fileEndpoint ?? null,
        fileBucket: stem.fileBucket ?? null,
        fileKey: stem.fileKey ?? null,
        bpm: stem.bpm ?? null,
        instrument: stem.instrumentMask,
        length16s: Math.round(stem.barLength * 16),
        presetName: stem.presetName,
        creatorUserName: stem.creatorUserName
      })
    }
  })
  txn(resolved.stems)
}

/** The whole resumability mechanism: a riff whose AppVersion is still NULL
 * has been seen (skeleton-inserted) but never had writeRiffDetail called
 * for it -- whether because this is the first time it's being processed, or
 * because a prior sync run was interrupted before it got there. Batched
 * (`limit`) so a single call can't try to resolve an unbounded backlog at
 * once. */
export function findRiffsNeedingDetail(db: Database.Database, jamCID: string, limit: number): string[] {
  const rows = db
    .prepare(`SELECT RiffCID FROM Riffs WHERE OwnerJamCID = ? AND AppVersion IS NULL LIMIT ?`)
    .all(jamCID, limit) as { RiffCID: string }[]
  return rows.map((r) => r.RiffCID)
}

/** Records that this stem's audio download exhausted its retries (see
 * endlesssApi.ts's own STEM_DOWNLOAD_RETRIES) -- bookkeeping only for now
 * (no dispatcher currently re-attempts a ledgered stem's download; there's
 * no standalone "fetch just this stem" task in this codebase's real API
 * surface, since stem audio is only ever fetched as a side effect of
 * resolving its parent riff). Idempotent: a stem already ledgered is left
 * alone rather than re-written on every repeat failure. */
export function markStemDownloadFailed(db: Database.Database, stemCID: string): void {
  db.prepare(
    `INSERT INTO StemLedger (StemCID, Type, Note) VALUES (?, 'download-failed', 'exhausted retries')
     ON CONFLICT(StemCID) DO NOTHING`
  ).run(stemCID)
}

export function isStemLedgered(db: Database.Database, stemCID: string): boolean {
  return db.prepare(`SELECT 1 FROM StemLedger WHERE StemCID = ?`).get(stemCID) !== undefined
}

export interface WarehouseSyncStatus {
  riffCount: number
  complete: boolean
}

export function getWarehouseSyncStatus(db: Database.Database, jamCID: string): WarehouseSyncStatus | null {
  const jam = db.prepare(`SELECT SyncComplete FROM Jams WHERE JamCID = ?`).get(jamCID) as
    | { SyncComplete: number }
    | undefined
  if (!jam) return null
  const { n } = db.prepare(`SELECT COUNT(*) as n FROM Riffs WHERE OwnerJamCID = ?`).get(jamCID) as {
    n: number
  }
  return { riffCount: n, complete: jam.SyncComplete === 1 }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/loreWarehouseWriter.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/loreWarehouseWriter.ts src/main/loreWarehouseWriter.test.ts
git commit -m "$(cat <<'EOF'
Add loreWarehouseWriter.ts: row persistence + NULL-column gap queries

Pure functions over an injected Database handle -- skeleton inserts are
safe to repeat forever (ON CONFLICT DO NOTHING), and AppVersion IS NULL is
the entire resumability mechanism: no separate resume state to keep in sync.
EOF
)"
```

---

### Task 4: `loreWarehouseSync.ts` — `syncSharedFeed`

**Files:**
- Create: `src/main/loreWarehouseSync.ts`
- Test: `src/main/loreWarehouseSync.test.ts`

**Why there's no separate "gap-filling dispatcher" task**, versus the design spec's description of
one: the spec described a dispatcher that polls `WHERE AppVersion IS NULL` and enqueues fill tasks
as a mechanism *distinct* from the page walk. In this implementation the walk and the gap-fill are
the same loop — each page's riffs get skeleton-inserted (harmless no-op if already known) and then
whichever of that page's riffs aren't yet fully resolved (`findRiffsNeedingDetail`, scoped to that
page) get resolved right there. This still satisfies "NULL columns are the entire resume state,
no separate bookkeeping" (the actual requirement); it just doesn't need a second, separately-timed
pass to do it, since a genuinely stuck gap gets found again the next time this same page is walked
— which happens on every sync run, since the walk now correctly doesn't stop at a page that still
has gaps (see Step 3's own comment on `pageFullyDone`).

- [ ] **Step 1: Write the failing test**

```typescript
// src/main/loreWarehouseSync.test.ts
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'

// userDataDir is read fresh on every app.getPath('userData') call (electron
// mocked below), so declaring it as a reassignable module-level `let` and
// pointing beforeEach/afterEach at it -- rather than a fixed literal path --
// gives every test its own isolated, cleaned-up directory. Needed for real
// this time: Task 5's syncJam test below calls the real loginWithCredentials
// (via endlesssApi.ts), whose persistSession writes a real file under
// app.getPath('userData'), and safeStorage must be mocked too or that call
// throws outright (electron's real safeStorage isn't available under
// Vitest). Matches the exact pattern already established in
// endlesssSync.test.ts/loreWarehouse.test.ts/riffFavourites.test.ts.
let userDataDir: string

vi.mock('electron', () => ({
  app: {
    getPath: () => userDataDir,
    getVersion: () => '0.0.0-test'
  },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(s),
    decryptString: (b: Buffer) => b.toString()
  }
}))

beforeEach(() => {
  userDataDir = mkdtempSync(join(tmpdir(), 'sssketch-lore-warehouse-sync-test-'))
})

afterEach(() => {
  rmSync(userDataDir, { recursive: true, force: true })
})

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
    CREATE TABLE Tags (RiffCID TEXT PRIMARY KEY, OwnerJamCID TEXT NOT NULL, Favour INTEGER NOT NULL DEFAULT 0, Note TEXT);
    CREATE TABLE StemLedger (StemCID TEXT PRIMARY KEY, Type TEXT NOT NULL, Note TEXT);
  `)
  return db
}

function sharedFeedPage(riffCIDs: string[], hasMore: boolean): Record<string, unknown> {
  return {
    data: riffCIDs.map((riffCID, i) => ({
      _id: `shared_${riffCID}`,
      doc_id: riffCID,
      action_timestamp: 1700000000000 + i,
      rifff: {
        _id: riffCID,
        state: {
          bps: 2.0,
          barLength: 4,
          playback: [
            { slot: { current: { on: true, currentLoop: `stem_${riffCID}`, gain: 1 } } },
            ...Array.from({ length: 7 }, () => ({ slot: {} }))
          ]
        },
        userName: 'elling',
        created: 1700000000000 + i,
        root: 0,
        scale: 0
      },
      loops: [
        {
          _id: `stem_${riffCID}`,
          cdn_attachments: {
            oggAudio: { endpoint: 'cdn.example.com', key: `k_${riffCID}`, url: 'unused', length: 1 }
          },
          bps: 2.0,
          length16ths: 64,
          presetName: 'preset',
          creatorUserName: 'elling'
        },
        null,
        null,
        null,
        null,
        null,
        null,
        null
      ]
    })),
    hasMore
  }
}

describe('syncSharedFeed', () => {
  it('walks every page, skeleton-inserts and resolves every riff, and marks the jam complete', async () => {
    const { syncSharedFeed } = await import('./loreWarehouseSync')
    const db = freshDb()
    const fakeFetch = vi.fn(async (url: string) => {
      const isFirstPage = url.includes('from=0')
      const body = isFirstPage ? sharedFeedPage(['r1', 'r2'], true) : sharedFeedPage(['r3'], false)
      return new Response(JSON.stringify({ data: body.data }), { status: 200 })
    })
    // downloadMissingStemsFor issues its own fetch for stem audio bytes --
    // any 200 with a body is fine, this test only asserts on warehouse rows.
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.startsWith('https://cdn.example.com')) {
        return new Response(new ArrayBuffer(8), { status: 200 })
      }
      return fakeFetch(url)
    })
    const progressUpdates: { done: number; total: number }[] = []

    await syncSharedFeed('elling', (p) => progressUpdates.push(p), fetchImpl as typeof fetch, db)

    const riffCount = db.prepare('SELECT COUNT(*) as n FROM Riffs').get() as { n: number }
    expect(riffCount.n).toBe(3)
    const resolvedCount = db.prepare('SELECT COUNT(*) as n FROM Riffs WHERE AppVersion IS NOT NULL').get() as {
      n: number
    }
    expect(resolvedCount.n).toBe(3)
    const jam = db.prepare('SELECT SyncComplete FROM Jams WHERE JamCID = ?').get('shared:elling') as {
      SyncComplete: number
    }
    expect(jam.SyncComplete).toBe(1)
    expect(progressUpdates.length).toBeGreaterThan(0)
  })

  it('a repeat sync with nothing new stops after the first page instead of walking to the end', async () => {
    const { syncSharedFeed } = await import('./loreWarehouseSync')
    const db = freshDb()
    let pageCalls = 0
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.startsWith('https://cdn.example.com')) return new Response(new ArrayBuffer(8), { status: 200 })
      pageCalls++
      // Every call (there should only be one) returns the exact same
      // already-fully-synced riff, with hasMore: true -- if the walk fails
      // to stop early, this fixture would loop forever.
      return new Response(JSON.stringify(sharedFeedPage(['r1'], true)), { status: 200 })
    })

    await syncSharedFeed('elling', () => {}, fetchImpl as typeof fetch, db)
    pageCalls = 0
    await syncSharedFeed('elling', () => {}, fetchImpl as typeof fetch, db)

    expect(pageCalls).toBe(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/loreWarehouseSync.test.ts`
Expected: FAIL with "Cannot find module './loreWarehouseSync'"

- [ ] **Step 3: Write the implementation**

```typescript
// src/main/loreWarehouseSync.ts
import type Database from 'better-sqlite3'
import {
  listSharedFeed,
  peekSharedFeedCache,
  downloadMissingStemsFor,
  type FetchLike
} from './endlesssApi'
import { openOwnWarehouseDb } from './loreWarehouseSchema'
import {
  upsertJam,
  markJamSyncComplete,
  upsertRiffSkeletons,
  writeRiffDetail,
  markStemDownloadFailed
} from './loreWarehouseWriter'

/** Runs `worker` over every item in `items`, with at most `limit` calls in
 * flight at once. Moved here verbatim from the old endlesssSync.ts (which
 * this module replaces) -- same worker-pool shape, same rationale (see its
 * own prior doc comment): a sync run touching hundreds of riffs needs a
 * concurrency cap so it doesn't compete with foreground UI clicks. */
export async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  let cursor = 0
  async function lane(): Promise<void> {
    while (cursor < items.length) {
      const item = items[cursor++]
      await worker(item)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => lane()))
}

export interface SyncProgress {
  done: number
  total: number
}

const SYNC_CONCURRENCY = 3
const SYNC_SHARED_FEED_PAGE_SIZE = 100

const syncsInFlight = new Set<string>()

/** Walks the account's own shared feed from the front (newest first),
 * skeleton-inserting every riff it sees and resolving whichever of each
 * page's riffs aren't already fully resolved (AppVersion IS NULL). Stops
 * once a page arrives where every riff was ALREADY fully resolved before
 * this call started (`pageFullyDone`) -- not merely "already known", which
 * is what the old JSON-index sync used and which could permanently skip a
 * riff that was seen but never resolved (see this plan's own header note
 * and the design spec's Background section). No-ops if a sync for this
 * exact userName is already running. */
export async function syncSharedFeed(
  userName: string,
  onProgress: (progress: SyncProgress) => void,
  fetchImpl: FetchLike = fetch,
  db: Database.Database = openOwnWarehouseDb()
): Promise<void> {
  const key = `shared:${userName}`
  if (syncsInFlight.has(key)) return
  syncsInFlight.add(key)
  try {
    upsertJam(db, key, 'Shared Feed')
    let offset = 0
    let resolvedCount = 0
    for (;;) {
      const page = await listSharedFeed(userName, offset, SYNC_SHARED_FEED_PAGE_SIZE, fetchImpl)
      if (page.riffs.length === 0) {
        markJamSyncComplete(db, key)
        break
      }

      const cids = page.riffs.map((r) => r.riffCID)
      const placeholders = cids.map(() => '?').join(',')
      const alreadyDoneRows = db
        .prepare(`SELECT RiffCID FROM Riffs WHERE RiffCID IN (${placeholders}) AND AppVersion IS NOT NULL`)
        .all(...cids) as { RiffCID: string }[]
      const pageFullyDone = alreadyDoneRows.length === cids.length

      upsertRiffSkeletons(
        db,
        key,
        page.riffs.map((r) => ({ riffCID: r.riffCID, creationTime: r.creationTime }))
      )

      // The shared feed's own listing embeds full riff+stem detail already
      // (see peekSharedFeedCache's doc comment in endlesssApi.ts) -- no
      // second network round trip needed to get metadata, only to fetch
      // stem audio bytes (downloadMissingStemsFor), which IS worth
      // concurrency-capping since it's real per-riff network I/O.
      const pageResolved = [...peekSharedFeedCache(cids)]
      await runWithConcurrency(pageResolved, SYNC_CONCURRENCY, async ([riffCID, baseResolved]) => {
        const resolved = await downloadMissingStemsFor(baseResolved, fetchImpl)
        const summary = page.riffs.find((r) => r.riffCID === riffCID)!
        writeRiffDetail(db, key, { creationTime: summary.creationTime, userName: summary.userName }, resolved)
        for (const stem of resolved.stems) {
          if (stem.path === null && stem.downloadUrl !== null) markStemDownloadFailed(db, stem.stemCID)
        }
        resolvedCount++
        onProgress({ done: resolvedCount, total: resolvedCount })
      })

      if (pageFullyDone || !page.hasMore) {
        markJamSyncComplete(db, key)
        break
      }
      offset = page.nextOffset
    }
  } finally {
    syncsInFlight.delete(key)
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/loreWarehouseSync.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/loreWarehouseSync.ts src/main/loreWarehouseSync.test.ts
git commit -m "$(cat <<'EOF'
Add loreWarehouseSync.ts syncSharedFeed: walk+resolve into the SQL warehouse

Stops once a page is entirely already-resolved (not just already-known),
which is what actually fixes the old JSON-index sync's boundary-stop bug --
a riff seen but never resolved gets picked up again on the next run instead
of being permanently skipped.
EOF
)"
```

---

### Task 5: `loreWarehouseSync.ts` — `syncJam`

**Files:**
- Modify: `src/main/loreWarehouseSync.ts`
- Test: `src/main/loreWarehouseSync.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/main/loreWarehouseSync.test.ts`:

```typescript
function rawRiffListRow(riffCID: string, key: number): Record<string, unknown> {
  return { id: riffCID, key, value: [`stem_${riffCID}`] }
}

function rawJamRiffDoc(riffCID: string): Record<string, unknown> {
  return {
    _id: riffCID,
    state: {
      bps: 2.0,
      barLength: 4,
      playback: [
        { slot: { current: { on: true, currentLoop: `stem_${riffCID}`, gain: 1 } } },
        ...Array.from({ length: 7 }, () => ({ slot: {} }))
      ]
    },
    userName: 'elling',
    created: 1700000000000,
    root: 0,
    scale: 0
  }
}

function rawJamStemDoc(riffCID: string): Record<string, unknown> {
  return {
    _id: `stem_${riffCID}`,
    cdn_attachments: {
      oggAudio: { endpoint: 'cdn.example.com', key: `k_${riffCID}`, url: 'unused', length: 1 }
    },
    bps: 2.0,
    length16ths: 64,
    presetName: 'preset',
    creatorUserName: 'elling'
  }
}

describe('syncJam', () => {
  it('walks the jam, resolves every riff via _all_docs, and marks it complete', async () => {
    vi.resetModules()
    // A logged-in session is required for the private-jam endpoints
    // (listRiffsInJam/resolveJamRiff both call activeSession() internally)
    // -- loginWithCredentials persists it into the same in-memory module
    // state syncJam's own endlesssApi.ts import will read.
    const { loginWithCredentials } = await import('./endlesssApi')
    const { syncJam } = await import('./loreWarehouseSync')
    const db = freshDb()

    const loginFetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ token: 't', password: 'p', user_id: 'u1', expires: Date.now() + 100000 }), {
          status: 200
        })
    )
    await loginWithCredentials('elling', 'hunter2', loginFetch as unknown as typeof fetch)

    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith('https://cdn.example.com')) return new Response(new ArrayBuffer(8), { status: 200 })
      if (url.includes('rifffLoopsByCreateTime')) {
        return new Response(
          JSON.stringify({ total_rows: 1, rows: [rawRiffListRow('r1', 1700000000000)] }),
          { status: 200 }
        )
      }
      if (url.includes('_all_docs') && init?.method === 'POST') {
        const body = JSON.parse(init.body as string) as { keys: string[] }
        const isStemBatch = body.keys[0]?.startsWith('stem_')
        const rows = body.keys.map((id) => ({
          id,
          doc: isStemBatch ? rawJamStemDoc('r1') : rawJamRiffDoc('r1')
        }))
        return new Response(JSON.stringify({ total_rows: rows.length, rows }), { status: 200 })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })

    await syncJam('jam_1', 'Test Jam', () => {}, fetchImpl as unknown as typeof fetch, db)

    const riff = db.prepare('SELECT AppVersion, StemCID_1 FROM Riffs WHERE RiffCID = ?').get('r1') as {
      AppVersion: number
      StemCID_1: string
    }
    expect(riff.AppVersion).toBe(1)
    expect(riff.StemCID_1).toBe('stem_r1')
    const jam = db.prepare('SELECT SyncComplete, PublicName FROM Jams WHERE JamCID = ?').get('jam_1') as {
      SyncComplete: number
      PublicName: string
    }
    expect(jam.SyncComplete).toBe(1)
    expect(jam.PublicName).toBe('Test Jam')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/loreWarehouseSync.test.ts -t "syncJam"`
Expected: FAIL with "syncJam is not a function" (or "Cannot find export")

- [ ] **Step 3: Write the implementation**

Add to `src/main/loreWarehouseSync.ts` — first, extend the imports at the top of the file:

```typescript
import {
  listSharedFeed,
  peekSharedFeedCache,
  downloadMissingStemsFor,
  listRiffsInJam,
  resolveJamRiff,
  type FetchLike
} from './endlesssApi'
```

Then add below `syncSharedFeed`:

```typescript
const SYNC_JAM_PAGE_SIZE = 200 // matches DEFAULT_RIFF_PAGE_SIZE in endlesssApi.ts

/** Same shape as syncSharedFeed, walking a private jam via listRiffsInJam/
 * resolveJamRiff instead -- see syncSharedFeed's own doc comment for the
 * full rationale (pageFullyDone stop condition, why re-discovering an
 * already-done riff is a safe no-op). Unlike the shared feed, a jam's raw
 * listing view carries no per-riff BPM/userName/stem detail at all (see
 * listRiffsInJam's own doc comment in endlesssApi.ts) -- every
 * not-yet-resolved riff genuinely needs its own resolveJamRiff network
 * call, which IS what runWithConcurrency below is capping. */
export async function syncJam(
  jamId: string,
  jamName: string,
  onProgress: (progress: SyncProgress) => void,
  fetchImpl: FetchLike = fetch,
  db: Database.Database = openOwnWarehouseDb()
): Promise<void> {
  if (syncsInFlight.has(jamId)) return
  syncsInFlight.add(jamId)
  try {
    upsertJam(db, jamId, jamName)
    let offset = 0
    let resolvedCount = 0
    for (;;) {
      const page = await listRiffsInJam(jamId, { offset, limit: SYNC_JAM_PAGE_SIZE }, fetchImpl)
      if (page.riffs.length === 0) {
        markJamSyncComplete(db, jamId)
        break
      }

      const cids = page.riffs.map((r) => r.riffCID)
      const placeholders = cids.map(() => '?').join(',')
      const alreadyDoneRows = db
        .prepare(`SELECT RiffCID FROM Riffs WHERE RiffCID IN (${placeholders}) AND AppVersion IS NOT NULL`)
        .all(...cids) as { RiffCID: string }[]
      const alreadyDoneCIDs = new Set(alreadyDoneRows.map((r) => r.RiffCID))
      const pageFullyDone = alreadyDoneCIDs.size === cids.length

      upsertRiffSkeletons(
        db,
        jamId,
        page.riffs.map((r) => ({ riffCID: r.riffCID, creationTime: r.creationTime }))
      )

      const needsResolve = cids.filter((cid) => !alreadyDoneCIDs.has(cid))
      await runWithConcurrency(needsResolve, SYNC_CONCURRENCY, async (riffCID) => {
        const resolved = await resolveJamRiff(jamId, riffCID, fetchImpl)
        if (resolved) {
          const summary = page.riffs.find((r) => r.riffCID === riffCID)!
          // listRiffsInJam's raw view never carries a per-riff userName
          // (see its own doc comment in endlesssApi.ts) -- summary.userName
          // is always '' here, a known, pre-existing limitation of the jam
          // listing endpoint itself, not something introduced by this sync.
          writeRiffDetail(db, jamId, { creationTime: summary.creationTime, userName: summary.userName }, resolved)
          for (const stem of resolved.stems) {
            if (stem.path === null && stem.downloadUrl !== null) markStemDownloadFailed(db, stem.stemCID)
          }
        }
        resolvedCount++
        onProgress({ done: resolvedCount, total: resolvedCount })
      })

      if (pageFullyDone || !page.hasMore) {
        markJamSyncComplete(db, jamId)
        break
      }
      offset = page.nextOffset
    }
  } finally {
    syncsInFlight.delete(jamId)
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/loreWarehouseSync.test.ts`
Expected: PASS (both `syncSharedFeed` and `syncJam` describe blocks)

- [ ] **Step 5: Commit**

```bash
git add src/main/loreWarehouseSync.ts src/main/loreWarehouseSync.test.ts
git commit -m "$(cat <<'EOF'
Add loreWarehouseSync.ts syncJam: same walk+resolve shape for private jams
EOF
)"
```

---

### Task 6: IPC handlers + preload bridge for the new sync

**Files:**
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`

New, additive channels — nothing existing is renamed or removed. `lore-sync-status` reuses
`loreWarehouseWriter.ts`'s `getWarehouseSyncStatus` against the same `openOwnWarehouseDb()`
connection the sync functions default to, so a caller can check status without needing its own
handle to the DB.

This task has no dedicated test file — same convention as the existing `endlesss-*`/`lore-*` IPC
wiring in this codebase (see `SyncImpl` Task 6 in git history), verified via typecheck.

- [ ] **Step 1: Add imports and handlers to `src/main/index.ts`**

Near the existing `import { syncSharedFeed, syncJam } from './endlesssSync'` line, add:

```typescript
import {
  syncSharedFeed as syncSharedFeedToWarehouse,
  syncJam as syncJamToWarehouse
} from './loreWarehouseSync'
import { openOwnWarehouseDb } from './loreWarehouseSchema'
import { getWarehouseSyncStatus } from './loreWarehouseWriter'
```

Immediately after the existing block of `endlesss-start-sync-*`/`endlesss-sync-status-*` handlers
(after the line `ipcMain.handle('endlesss-sync-status-jam', ...)`), add:

```typescript
  ipcMain.handle('lore-sync-start-shared-feed', (event, userName: string) =>
    syncSharedFeedToWarehouse(userName, (progress) => {
      event.sender.send('lore-sync-progress', {
        source: 'shared' as const,
        key: userName,
        ...progress
      })
    })
  )
  ipcMain.handle('lore-sync-start-jam', (event, jamId: string, jamName: string) =>
    syncJamToWarehouse(jamId, jamName, (progress) => {
      event.sender.send('lore-sync-progress', {
        source: 'jam' as const,
        key: jamId,
        ...progress
      })
    })
  )
  ipcMain.handle('lore-sync-status', (_event, jamCID: string) =>
    getWarehouseSyncStatus(openOwnWarehouseDb(), jamCID)
  )
```

- [ ] **Step 2: Add the preload bridge**

In `src/preload/index.ts`, `onEndlesssSyncProgress` (currently the last property in the `api`
object literal, ending in `}` with no trailing comma, immediately followed by the object literal's
own closing `}`) is the last of the existing sync-related entries. Add a comma after its closing
`}` and insert these four new entries directly after it, before the `api` object's own closing
`}`:

```typescript
  loreSyncStartSharedFeed: (userName: string): Promise<void> =>
    ipcRenderer.invoke('lore-sync-start-shared-feed', userName),
  loreSyncStartJam: (jamId: string, jamName: string): Promise<void> =>
    ipcRenderer.invoke('lore-sync-start-jam', jamId, jamName),
  loreSyncStatus: (jamCID: string): Promise<{ riffCount: number; complete: boolean } | null> =>
    ipcRenderer.invoke('lore-sync-status', jamCID),
  onLoreSyncProgress: (
    callback: (progress: {
      source: 'shared' | 'jam'
      key: string
      done: number
      total: number
    }) => void
  ): (() => void) => {
    const listener = (
      _event: unknown,
      progress: { source: 'shared' | 'jam'; key: string; done: number; total: number }
    ): void => callback(progress)
    ipcRenderer.on('lore-sync-progress', listener)
    return () => ipcRenderer.removeListener('lore-sync-progress', listener)
  }
```

This matches the existing `onEndlesssSyncProgress` entry's own parameter-typing style exactly
(same file, directly above where this is inserted) — same inline listener shape, same `unknown`
event type, same cleanup-function return.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add src/main/index.ts src/preload/index.ts
git commit -m "$(cat <<'EOF'
Wire loreWarehouseSync into new lore-sync-* IPC channels

Additive only -- existing endlesss-start-sync-*/endlesss-sync-status-*
channels and the UI that calls them are untouched. Plan 2 will retire the
old channels once the merged browser is wired to this new sync instead.
EOF
)"
```

---

### Task 7: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Full typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: no errors

- [ ] **Step 3: Full test suite**

Run: `npx vitest run`
Expected: all tests pass, including every new file from Tasks 1-5 and the full pre-existing suite
(confirms nothing in `endlesssApi.ts`'s existing behavior regressed from Task 1's additive
interface changes)

- [ ] **Step 4: Manual walkthrough — flag explicitly, don't claim it was done**

This plan's new sync (`lore-sync-start-shared-feed`/`lore-sync-start-jam`) isn't called from any
UI yet — Plan 2 wires that up. A real end-to-end manual walkthrough (log into a real Endlesss
account, trigger a sync via a temporary dev-console `window.rifffApi.loreSyncStartSharedFeed(...)`
call, inspect the resulting `~/Library/Application Support/sssketch/lore-warehouse/cache/common/
warehouse.db3` with a SQLite browser) requires a real logged-in Endlesss account and is worth
doing once this plan lands, but **cannot be completed by an implementer subagent working solo** —
say so explicitly in the final report rather than claiming it was verified.

- [ ] **Step 5: Commit (only if Steps 1-3 required any fixes not already committed)**

```bash
git add -A
git commit -m "$(cat <<'EOF'
Fix verification issues found in full-suite run
EOF
)"
```
