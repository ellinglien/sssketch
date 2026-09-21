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
  UpdatedAt INTEGER NOT NULL,
  SubcategoryNote TEXT
);

CREATE TABLE IF NOT EXISTS StemFeatureCache (
  StemCID TEXT PRIMARY KEY,
  FeaturesJSON TEXT NOT NULL,
  ExtractedAt INTEGER NOT NULL
);

-- Direct request, 2026-09-21 ("can prep work for the audio-resolve step
-- be done in advance, clustered with overall scans? ... lets do it....
-- to make it all snappy"): persists peakCache.ts's own per-stem waveform
-- decode (peaks + zero-crossing brightness, 128 buckets each) across
-- sessions, mirroring StemFeatureCache's exact shape/pattern above. The
-- renderer's own background feature scan already calls getBrightness (a
-- dependency of getStemFeatures) for every stem it visits -- this table
-- just gives that already-happening decode somewhere durable to land, so
-- a LATER session's first Discover roll / re-one open / Tidy Up browse of
-- an already-scanned stem renders its waveform instantly instead of
-- paying a fresh decode.
CREATE TABLE IF NOT EXISTS StemPeaksCache (
  StemCID TEXT PRIMARY KEY,
  PeaksJSON TEXT NOT NULL,
  BrightnessJSON TEXT NOT NULL,
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

-- One row per stem once a YAMNet zero-shot classification has been
-- ATTEMPTED (see src/renderer/src/audio/stemEmbeddingCache.ts's own
-- ensureYamnetZeroShotClassified) -- regardless of whether that attempt
-- actually produced a StemAutoCategory row. getOrExtractStemEmbedding is
-- cache-hit-first (StemEmbeddingCache), so a stem embedded before the
-- zero-shot classification code existed would otherwise never get a
-- chance to run it (see yamnetZeroShotRetroactiveScan.ts's own doc
-- comment). Separately, most stems' own top AudioSet class will never map
-- to anything in audiosetClasses.ts's deliberately narrow table -- without
-- a record of "already tried, regardless of outcome," those stems would
-- get re-decoded and re-inferred on every future scan pass, forever, for
-- no benefit. Direct report, 2026-09-17 ("in discover it wasn't really as
-- accurate honestly"), root-caused to this exact gap: the signal had
-- never actually written anything for Elling's real library.
CREATE TABLE IF NOT EXISTS StemYamnetZeroShotAttempted (
  StemCID TEXT PRIMARY KEY,
  AttemptedAt INTEGER NOT NULL
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

-- Persisted counterpart to discoverCandidates.ts's own in-memory
-- riffIndexCache/instrumentRowsCache -- direct report, 2026-09-18: those
-- caches are process-lifetime-only (a plain WeakMap keyed to the live db
-- connection object), so a full ~4-5 minute rescan of a large external
-- LORE archive (372,297 riffs on Elling's own real library) ran on EVERY
-- app launch, not just the first. Keyed by SourceDbKey (the scanned db's
-- own file path -- better-sqlite3's Database#name, stable across
-- restarts, and distinct between sssketch's own warehouse and any
-- external archive) so a cache for the external archive can live here
-- even though that db itself is read-only. Freshness is checked via the
-- separate *CacheMeta tables below (a cheap COUNT(*) against the row
-- count stored there) rather than any timestamp/mtime -- the archive
-- doesn't change on its own; only a real sync run adds/removes rows, so
-- "row count changed" is a reliable-enough signal for when to rebuild,
-- matching this codebase's own established "good enough, not exhaustive"
-- cache-invalidation philosophy (see LIMIT/OFFSET pagination's own
-- accepted imperfections elsewhere in this file's siblings).
--
-- One row per (SourceDbKey, StemCID) -- already the fully-resolved,
-- deduped shape discoverCandidates.ts's own buildRiffIndex computes (a
-- riff's 8 stem slots flattened into one row per stem), so loading from
-- here skips that function's own nested per-riff slot loop entirely, not
-- just the disk I/O.
CREATE TABLE IF NOT EXISTS DiscoverRiffIndexCache (
  SourceDbKey TEXT NOT NULL,
  StemCID TEXT NOT NULL,
  RiffCID TEXT NOT NULL,
  OwnerJamCID TEXT NOT NULL,
  BPMrnd REAL NOT NULL,
  CreationTime INTEGER,
  PRIMARY KEY (SourceDbKey, StemCID)
);

CREATE TABLE IF NOT EXISTS DiscoverRiffIndexCacheMeta (
  SourceDbKey TEXT PRIMARY KEY,
  RiffCount INTEGER NOT NULL,
  ComputedAt INTEGER NOT NULL
);

-- Same persisted-cache reasoning as DiscoverRiffIndexCache above, for
-- discoverCandidates.ts's own getInstrumentRowsForDb (the Stems table's
-- own StemCID/Instrument/OwnerJamCID columns, used by the instrument-mask
-- candidate path). A separate meta table (StemCount, not RiffCount) --
-- deliberately NOT one shared meta table with the riff index cache above,
-- since the two caches are populated/invalidated independently (one scan
-- can finish while the other is still cold) and a shared row would need
-- partial-upsert-with-NULL handling for no real benefit.
CREATE TABLE IF NOT EXISTS DiscoverInstrumentRowsCache (
  SourceDbKey TEXT NOT NULL,
  StemCID TEXT NOT NULL,
  Instrument INTEGER,
  OwnerJamCID TEXT NOT NULL,
  PRIMARY KEY (SourceDbKey, StemCID)
);

CREATE TABLE IF NOT EXISTS DiscoverInstrumentRowsCacheMeta (
  SourceDbKey TEXT PRIMARY KEY,
  StemCount INTEGER NOT NULL,
  ComputedAt INTEGER NOT NULL
);
`

let cachedDb: Database.Database | null = null

// Direct request, 2026-09-20 ("date could be a tooltip on hover"):
// DiscoverRiffIndexCache predates its own CreationTime column -- unlike
// every other column here, CREATE TABLE IF NOT EXISTS can't retroactively
// add a column to a table that already exists on a real, already-used db
// (this app's first time needing that). Safe to just DROP and let CREATE
// TABLE IF NOT EXISTS below recreate it fresh rather than a real ALTER
// TABLE migration, since this table is a PURE, always-rebuildable derived
// cache (discoverCandidates.ts's own buildRiffIndex can always recompute
// it from a live scan) -- costs one rescan, the exact same cost this
// table already pays on its very first-ever cold start. Its own Meta
// sibling (DiscoverRiffIndexCacheMeta, tracking the RiffCount the cache
// was last saved with) MUST be dropped in the same breath: leaving a
// stale RiffCount behind would make a later freshness check wrongly read
// the now-EMPTY data table as still up to date (the live count hasn't
// changed, even though the cached rows have all vanished), skipping the
// rescan that would otherwise repopulate it. Checked on every open
// (cheap: one PRAGMA query) so it self-heals even after a future revert
// of this column.
function ensureDiscoverRiffIndexCacheHasCreationTime(db: Database.Database): void {
  const columns = db.prepare(`PRAGMA table_info(DiscoverRiffIndexCache)`).all() as {
    name: string
  }[]
  if (columns.length === 0 || columns.some((c) => c.name === 'CreationTime')) return
  db.exec(`DROP TABLE DiscoverRiffIndexCache; DROP TABLE IF EXISTS DiscoverRiffIndexCacheMeta;`)
}

// Direct request, 2026-09-21 ("i think you can guess about tidy up
// subcats.......but in the meantime just log the subcat but keep them
// the same for centroid for the moment"): StemCategories predates its
// own SubcategoryNote column too -- but UNLIKE DiscoverRiffIndexCache
// above, this table holds real, irreplaceable data (weeks of real Tidy
// Up assignments, feeding live centroid training) -- dropping and
// recreating it would destroy that. A genuine, non-destructive ALTER
// TABLE ADD COLUMN instead: SQLite has supported this reliably for
// decades for a nullable column with no default-value backfill needed
// (every existing row simply reads NULL for it, correctly meaning "no
// note recorded yet"). This app's first ALTER TABLE migration against
// real user data -- checked on every open (cheap: one PRAGMA query) so
// it self-heals even after a future revert of this column.
function ensureStemCategoriesHasSubcategoryNote(db: Database.Database): void {
  const columns = db.prepare(`PRAGMA table_info(StemCategories)`).all() as { name: string }[]
  if (columns.length === 0 || columns.some((c) => c.name === 'SubcategoryNote')) return
  db.exec(`ALTER TABLE StemCategories ADD COLUMN SubcategoryNote TEXT`)
}

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
  ensureDiscoverRiffIndexCacheHasCreationTime(db)
  ensureStemCategoriesHasSubcategoryNote(db)
  db.exec(SCHEMA_SQL)
  cachedDb = db
  return db
}

export function closeOwnRiffLibraryDb(): void {
  cachedDb?.close()
  cachedDb = null
}
