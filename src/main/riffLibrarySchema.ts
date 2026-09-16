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

CREATE TABLE IF NOT EXISTS StemCategories (
  StemCID TEXT PRIMARY KEY,
  ArrangeRole TEXT,
  DrumSubRole TEXT,
  BusId TEXT,
  Source TEXT NOT NULL,
  SourceProject TEXT,
  UpdatedAt INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS StemFeatureCache (
  StemCID TEXT PRIMARY KEY,
  FeaturesJSON TEXT NOT NULL,
  ExtractedAt INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS StemEmbeddingCache (
  StemCID TEXT PRIMARY KEY,
  EmbeddingJSON TEXT NOT NULL,
  ExtractedAt INTEGER NOT NULL
);

-- Precomputed ArrangeRole guesses -- direct request 2026-09-15 ("why not
-- just do a prelim scan that pre-categorizes the stems... leave it
-- running overnight"): a background pass (stemAutoClassify.ts) classifies
-- each stem ONCE (via its own cached embedding or feature vector, once
-- either exists) and persists the result here, so Discover's own
-- candidate query (discoverCandidates.ts) becomes a plain fast SELECT
-- against this table instead of re-running the classifier on every roll.
CREATE TABLE IF NOT EXISTS StemAutoCategory (
  StemCID TEXT PRIMARY KEY,
  ArrangeRole TEXT NOT NULL,
  Source TEXT NOT NULL,
  ComputedAt INTEGER NOT NULL
);

-- Per-stem favourites (distinct from Tags.Favour, which favourites a whole
-- RIFF and is part of the LORE-compatible warehouse schema) -- direct
-- request, 2026-09-16: star an individual stem in Discover, then optionally
-- bias rolls/rerolls toward starred stems. sssketch-exclusive, like
-- StemAutoCategory/StemEmbeddingCache/StemFeatureCache above -- only ever
-- lives on the user's own writable db, never an external read-only LORE
-- archive (see discoverCandidates.ts's own repeated notes on why).
CREATE TABLE IF NOT EXISTS StemFavourite (
  StemCID TEXT PRIMARY KEY,
  FavouritedAt INTEGER NOT NULL
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
