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
