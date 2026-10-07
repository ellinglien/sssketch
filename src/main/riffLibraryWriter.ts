import type Database from 'better-sqlite3'
import type { RiffLibraryResolvedRiff } from '@shared/riffLibraryTypes'
import {
  LORE_STEM_COLUMN_COUNT,
  MAX_RIFFF_STEM_SLOTS,
  STEM_SLOT_COLUMNS,
  splitStemSlots
} from '@shared/riffStemSlots'
import {
  deleteExtraStemSlotsForJam,
  extraStemCIDsForJam,
  hasExtraStemSlotsTable,
  writeExtraStemSlots
} from './riffStemsExtra'
import { bumpTableWriteVersion } from './tableWriteVersion'
import { normalizeEndlesssUsername } from '@shared/endlesssUsername'
import { MIGRATION_DONE_STAMP, recordSeen, seenStamp } from './startupBackfillGate'
import { DISCOVERED_JAM_CID } from '@shared/discoveredRoom'

export function upsertJam(db: Database.Database, jamCID: string, publicName: string): void {
  db.prepare(
    `INSERT INTO Jams (JamCID, PublicName) VALUES (?, ?)
     ON CONFLICT(JamCID) DO UPDATE SET PublicName = excluded.PublicName`
  ).run(jamCID, publicName)
  bumpTableWriteVersion(db, 'Jams')
}

/** Tables whose rows name their jam in OwnerJamCID. */
const OWNER_JAM_TABLES = ['Riffs', 'Stems', 'Tags', 'RiffSyncFailures'] as const

/** The Discover caches are derived, but they are only rebuilt on a row-count
 * change, which a move is not -- so they move too, when they exist (tests
 * build smaller dbs). They hold every source db's rows, keyed by
 * (SourceDbKey, StemCID): only this db's are moved (review of 0e27db79),
 * which also reads just its primary-key range -- on Elling's own db ~82k of
 * each table's ~0.9M rows, the rest the archive's. Measured on a copy of it
 * (5,163 stems, 844 riffs moved): the whole fold ~200 ms before, ~105 ms
 * after, ~45 ms of that the commit of the rows it rewrites, which no index
 * would remove. It runs once per capitalised feed ever; every later sync
 * pays only the 0.1 ms variant check. */
const OWNER_JAM_CACHE_TABLES = ['DiscoverRiffIndexCache', 'DiscoverInstrumentRowsCache'] as const

/** The artist picker's saved (jam, user) pairs (discoverJamUserPairsStore.ts)
 * name the jam as JamCID, keyed (SourceDbKey, JamCID, User): moved, not
 * dropped, since dropping them would re-walk the own db's whole Stems table
 * for rows a rename can't change. A pair both spellings already hold
 * collides; that copy is the one deleted. Their watermark (the meta row)
 * stays right, as the fold moves no Stems row. The pairs held in memory
 * (discoverArtistIndex.ts) keep the old name until a relaunch, which nothing
 * sees: jammedWithFromPairs leaves out every `shared:` jam. */
const JAM_USER_PAIRS_TABLE = 'DiscoverJamUserPairs'

/** Folds every other spelling of the shared feed `key` (`shared:elling`) --
 * one synced under a login typed with a capital, `shared:Elling`, before
 * 2026-10-07 -- into `key`: all its rows move over, in one transaction, and
 * its Jams row goes. A sync of `key` alone would only re-own the first page
 * (it stops at a page it has already resolved), leaving two "Shared Feed"s.
 * Returns how many variants were folded (0 once done, so it runs once). */
export function mergeSharedFeedCaseVariants(db: Database.Database, key: string): number {
  const variants = (
    db
      .prepare(`SELECT JamCID, PublicName, SyncComplete FROM Jams WHERE JamCID LIKE 'shared:%'`)
      .all() as { JamCID: string; PublicName: string; SyncComplete: number }[]
  ).filter(
    (jam) =>
      jam.JamCID !== key &&
      `shared:${normalizeEndlesssUsername(jam.JamCID.slice('shared:'.length))}` === key
  )
  if (variants.length === 0) return 0
  const exists = (table: string): boolean =>
    db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(table) !==
    undefined
  const tables = OWNER_JAM_TABLES.filter(exists)
  const cacheTables = OWNER_JAM_CACHE_TABLES.filter(exists)
  const hasPairs = exists(JAM_USER_PAIRS_TABLE)
  db.transaction(() => {
    for (const variant of variants) {
      // MIN: the folded feed has been walked to its end only if both had
      // (review of b18e27fb) -- MAX marked it complete with the other
      // spelling's unwalked riffs still behind it.
      db.prepare(
        `INSERT INTO Jams (JamCID, PublicName, SyncComplete) VALUES (?, ?, ?)
         ON CONFLICT(JamCID) DO UPDATE SET SyncComplete = MIN(SyncComplete, excluded.SyncComplete)`
      ).run(key, variant.PublicName, variant.SyncComplete)
      for (const table of tables) {
        db.prepare(`UPDATE ${table} SET OwnerJamCID = ? WHERE OwnerJamCID = ?`).run(
          key,
          variant.JamCID
        )
      }
      for (const table of cacheTables) {
        db.prepare(
          `UPDATE ${table} SET OwnerJamCID = ? WHERE SourceDbKey = ? AND OwnerJamCID = ?`
        ).run(key, db.name, variant.JamCID)
      }
      if (hasPairs) {
        db.prepare(
          `UPDATE OR IGNORE ${JAM_USER_PAIRS_TABLE} SET JamCID = ? WHERE SourceDbKey = ? AND JamCID = ?`
        ).run(key, db.name, variant.JamCID)
        db.prepare(`DELETE FROM ${JAM_USER_PAIRS_TABLE} WHERE SourceDbKey = ? AND JamCID = ?`).run(
          db.name,
          variant.JamCID
        )
      }
      db.prepare(`DELETE FROM Jams WHERE JamCID = ?`).run(variant.JamCID)
    }
  })()
  bumpTableWriteVersion(db, 'Jams')
  bumpTableWriteVersion(db, 'Riffs')
  bumpTableWriteVersion(db, 'Stems')
  bumpTableWriteVersion(db, 'Tags')
  return variants.length
}

export function markJamSyncComplete(db: Database.Database, jamCID: string): void {
  db.prepare(`UPDATE Jams SET SyncComplete = 1 WHERE JamCID = ?`).run(jamCID)
  // An in-place UPDATE -- invisible to a row count, and precisely the
  // case tableChangeSignal.ts's per-table write counter exists for.
  bumpTableWriteVersion(db, 'Jams')
}

/** Takes back markJamSyncComplete, so the next sync walks the whole jam again
 * (riffLibrarySync.ts): set before a catch-up of a complete jam resolves new
 * riffs, which it can't promise to finish. */
export function markJamSyncIncomplete(db: Database.Database, jamCID: string): void {
  db.prepare(`UPDATE Jams SET SyncComplete = 0 WHERE JamCID = ?`).run(jamCID)
  bumpTableWriteVersion(db, 'Jams')
}

export function isJamSyncComplete(db: Database.Database, jamCID: string): boolean {
  const jam = db.prepare(`SELECT SyncComplete FROM Jams WHERE JamCID = ?`).get(jamCID) as
    { SyncComplete: number } | undefined
  return jam?.SyncComplete === 1
}

/** Whether any of the jam's riffs was listed but never resolved -- a jam
 * marked complete with one has not really been walked to its end (the old
 * rule took a failed page for the end, and went past a riff that failed). One
 * the sync has given up on (recordRiffSyncFailure) is not one: it would have
 * the whole jam walked again on every sync. One probe of
 * idx_riffs_needs_detail, and of the failures' primary key per riff it
 * finds. */
export function hasUnresolvedRiffs(db: Database.Database, jamCID: string): boolean {
  ensureRiffSyncFailuresSchema(db)
  return (
    db
      .prepare(
        `SELECT 1 FROM Riffs r WHERE r.OwnerJamCID = ? AND r.AppVersion IS NULL
           AND NOT EXISTS (SELECT 1 FROM RiffSyncFailures f
                           WHERE f.RiffCID = r.RiffCID AND ${GIVEN_UP})
         LIMIT 1`
      )
      .get(jamCID) !== undefined
  )
}

/** A riff whose resolve has failed this many times is given up on. */
export const RIFF_SYNC_GIVE_UP_ATTEMPTS = 5

/** Why a riff's resolve failed, as RiffSyncFailures records it: `error`
 * (anything worth asking again: a 5xx, a timeout, a short answer),
 * `missing` (Endlesss says a record is gone -- given up at once), or
 * `not-in-feed` (a shared feed listed it, but its listing held no detail for
 * it). A cancel, a 429 or a lost session is not the riff's doing, and is not
 * recorded. */
export type RiffSyncFailureReason = 'error' | 'missing' | 'not-in-feed'

/** A RiffSyncFailures row the sync has given up on. */
const GIVEN_UP = `(Attempts >= ${RIFF_SYNC_GIVE_UP_ATTEMPTS} OR LastReason = 'missing')`

const riffSyncFailuresReady = new WeakSet<Database.Database>()

/** RiffSyncFailures: the riffs whose resolve has failed, by riff (review of
 * 97eb9189: one that can never resolve kept its jam unfinished for good, and
 * every sync walked the jam to it again). JamRewalkExcess: how far a jam's
 * Endlesss total may stay above the riffs held here without a re-walk
 * (riffLibrarySync.ts). Both created on first use, in the own db only --
 * the sync never writes anywhere else. */
function ensureRiffSyncFailuresSchema(db: Database.Database): void {
  if (riffSyncFailuresReady.has(db)) return
  db.exec(`
    CREATE TABLE IF NOT EXISTS RiffSyncFailures (
      RiffCID TEXT PRIMARY KEY,
      OwnerJamCID TEXT NOT NULL,
      Attempts INTEGER NOT NULL,
      LastReason TEXT NOT NULL,
      LastAttemptAt INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_riffsyncfailures_jam ON RiffSyncFailures(OwnerJamCID);
    CREATE TABLE IF NOT EXISTS JamRewalkExcess (
      JamCID TEXT PRIMARY KEY,
      Excess INTEGER NOT NULL
    );
  `)
  if (!db.inTransaction) riffSyncFailuresReady.add(db)
}

/** Records one failed resolve of `riffCID` (the sync calls this at most once
 * per riff per run) and returns whether the riff is now given up on: after
 * RIFF_SYNC_GIVE_UP_ATTEMPTS, or at once when Endlesss says it is gone. A
 * riff given up on reads as done to areAllResolved, filterUnresolved and
 * hasUnresolvedRiffs, so its jam can be complete; it is never asked for
 * again, unless the jam is un-synced (deleteJamRows). */
export function recordRiffSyncFailure(
  db: Database.Database,
  jamCID: string,
  riffCID: string,
  reason: RiffSyncFailureReason
): boolean {
  ensureRiffSyncFailuresSchema(db)
  const row = db
    .prepare(
      `INSERT INTO RiffSyncFailures (RiffCID, OwnerJamCID, Attempts, LastReason, LastAttemptAt)
       VALUES (?, ?, 1, ?, ?)
       ON CONFLICT(RiffCID) DO UPDATE SET
         OwnerJamCID = excluded.OwnerJamCID, Attempts = Attempts + 1,
         LastReason = excluded.LastReason, LastAttemptAt = excluded.LastAttemptAt
       RETURNING ${GIVEN_UP} AS givenUp`
    )
    .get(riffCID, jamCID, reason, Date.now()) as { givenUp: number }
  return row.givenUp === 1
}

/** Forgets a riff's failures: it resolved. */
export function clearRiffSyncFailure(db: Database.Database, riffCID: string): void {
  ensureRiffSyncFailuresSchema(db)
  db.prepare(`DELETE FROM RiffSyncFailures WHERE RiffCID = ?`).run(riffCID)
}

/** How many more riffs the jam's Endlesss total may name than are held here
 * before a sync walks the whole jam again (riffLibrarySync.ts): what was
 * left over the last time a walk reached the jam's end with nothing failing.
 * 0 until then. */
export function jamRewalkExcess(db: Database.Database, jamCID: string): number {
  ensureRiffSyncFailuresSchema(db)
  const row = db.prepare(`SELECT Excess FROM JamRewalkExcess WHERE JamCID = ?`).get(jamCID) as
    { Excess: number } | undefined
  return row?.Excess ?? 0
}

export function setJamRewalkExcess(db: Database.Database, jamCID: string, excess: number): void {
  ensureRiffSyncFailuresSchema(db)
  db.prepare(
    `INSERT INTO JamRewalkExcess (JamCID, Excess) VALUES (?, ?)
     ON CONFLICT(JamCID) DO UPDATE SET Excess = excluded.Excess`
  ).run(jamCID, excess)
}

/** How many riffs of the jam are held here, resolved or not. */
export function countJamRiffs(db: Database.Database, jamCID: string): number {
  return (
    db.prepare(`SELECT COUNT(*) AS n FROM Riffs WHERE OwnerJamCID = ?`).get(jamCID) as {
      n: number
    }
  ).n
}

/** StartupBackfillGate's marker row for healStemlessRiffs. */
export const STEMLESS_RIFF_HEAL_MARKER = 'heal:stemless-jam-riffs'

/** Once per db: every resolved riff of a private jam with no stem in any
 * slot goes back to unresolved, and its jam's complete is taken back, so the
 * next sync of that jam walks to it and fetches it again.
 *
 * Why (review of b18e27fb): resolveJamRiff's stem lookup came back as no
 * stems on any failure -- a cancel, a 429, a timeout, a 5xx -- and the riff
 * was saved as resolved with none, for good: 160 riffs across 19 jams in
 * Elling's own library (98 of them in Jazztronics). That lookup now fails
 * the riff instead, so nothing new is saved this way.
 *
 * Whether a riff had active slots is not in the db: a stemless row holds no
 * slot, and its GainsJSON is '{}', exactly as a riff with no active slots
 * would be saved. So all of them are fetched again; a real empty riff costs
 * one riff-doc request, once, and is saved again as it was (resolveJamRiff
 * resolves a riff with no active slots) -- which is why this runs once, not
 * on every sync. A shared feed's riffs are left alone: its listing carries
 * every stem, so none was built from a failed lookup. So is the discovered
 * room's (DISCOVERED_JAM_CID): kept from Discover, never synced. A stem in
 * slot 9+ (RiffStemsExtra) is a stem. */
export function healStemlessRiffs(db: Database.Database): { riffs: number; jams: number } {
  if (seenStamp(db, STEMLESS_RIFF_HEAL_MARKER) === MIGRATION_DONE_STAMP) {
    return { riffs: 0, jams: 0 }
  }
  const noSlot = STEM_SLOT_COLUMNS.map((column) => `${column} IS NULL`).join(' AND ')
  const noExtra = hasExtraStemSlotsTable(db)
    ? ` AND NOT EXISTS (SELECT 1 FROM RiffStemsExtra x WHERE x.RiffCID = Riffs.RiffCID)`
    : ''
  const stemless =
    `AppVersion IS NOT NULL AND substr(OwnerJamCID, 1, 7) != 'shared:' ` +
    `AND OwnerJamCID != @discovered AND ${noSlot}` +
    noExtra
  const params = { discovered: DISCOVERED_JAM_CID }
  let healed = { riffs: 0, jams: 0 }
  db.transaction(() => {
    const jams = (
      db.prepare(`SELECT DISTINCT OwnerJamCID FROM Riffs WHERE ${stemless}`).all(params) as {
        OwnerJamCID: string
      }[]
    ).map((row) => row.OwnerJamCID)
    const riffs = db
      .prepare(`UPDATE Riffs SET AppVersion = NULL WHERE ${stemless}`)
      .run(params).changes
    const incomplete = db.prepare(`UPDATE Jams SET SyncComplete = 0 WHERE JamCID = ?`)
    for (const jam of jams) incomplete.run(jam)
    recordSeen(db, STEMLESS_RIFF_HEAL_MARKER, MIGRATION_DONE_STAMP)
    healed = { riffs, jams: jams.length }
  })()
  if (healed.riffs > 0) {
    bumpTableWriteVersion(db, 'Riffs')
    bumpTableWriteVersion(db, 'Jams')
  }
  return healed
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
export function upsertRiffSkeletons(
  db: Database.Database,
  jamCID: string,
  riffs: RiffSkeleton[]
): void {
  const insert = db.prepare(
    `INSERT INTO Riffs (RiffCID, OwnerJamCID, CreationTime) VALUES (@riffCID, @jamCID, @creationTime)
     ON CONFLICT(RiffCID) DO NOTHING`
  )
  const txn = db.transaction((rows: RiffSkeleton[]) => {
    for (const row of rows)
      insert.run({ riffCID: row.riffCID, jamCID, creationTime: row.creationTime })
  })
  txn(riffs)
  bumpTableWriteVersion(db, 'Riffs')
}

interface RiffDetailMeta {
  creationTime: number
  userName: string
}

/** Persists a fully-resolved riff (and every one of its stems) as real rows
 * -- AppVersion = 1 on the Riffs row is what marks it "no longer a gap" for
 * findRiffsNeedingDetail. Also skeleton-inserts (INSERT ... DO NOTHING) each
 * referenced stem before filling in its detail, so a stem shared across
 * riffs that hasn't been seen via any OTHER riff yet still gets a row.
 *
 * The Riffs upsert and the Stems skeleton+detail loop are wrapped in ONE
 * db.transaction so the whole function is all-or-nothing: if the process is
 * interrupted (crash/force-quit) or any statement throws partway through,
 * nothing commits -- AppVersion stays NULL and findRiffsNeedingDetail will
 * correctly pick this riff up again next pass. Splitting this into two
 * separately-committing operations would let AppVersion = 1 commit while
 * some/all of this riff's Stems rows are still bare (uninitialized)
 * skeletons, which is indistinguishable from "done" to every reader. */
export function writeRiffDetail(
  db: Database.Database,
  jamCID: string,
  meta: RiffDetailMeta,
  resolved: RiffLibraryResolvedRiff
): void {
  const upsertRiffRow = db.prepare(
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
  )
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
      riffCID: riff.riffCID,
      jamCID,
      creationTime: meta.creationTime,
      root: riff.root ?? null,
      scale: riff.scale ?? null,
      bpm: riff.bpm,
      barLength: riff.barLength,
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

    // Inside the same transaction as the Riffs row, and delete-then-insert
    // inside itself, so an upsert that SHRINKS a rifff cannot leave a
    // stale slot-12 row pointing at a stem the riff no longer has.
    writeExtraStemSlots(db, riff.riffCID, extraStems)

    for (const stem of riff.stems) {
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
  txn(resolved)
  // Both in place: the Riffs row is a skeleton being filled in
  // (AppVersion NULL -> 1), and the Stems rows are upserted detail. A row
  // count sees neither, which is why both are announced here.
  bumpTableWriteVersion(db, 'Riffs')
  bumpTableWriteVersion(db, 'Stems')
}

/** The whole resumability mechanism: a riff whose AppVersion is still NULL
 * has been seen (skeleton-inserted) but never had writeRiffDetail called
 * for it -- whether because this is the first time it's being processed, or
 * because a prior sync run was interrupted before it got there. Batched
 * (`limit`) so a single call can't try to resolve an unbounded backlog at
 * once. Not currently called by syncSharedFeed/syncJam (loreWarehouseSync.ts) --
 * they check per-page candidate sets via areAllResolved/filterUnresolved
 * instead, since they already have the page's riffCIDs in hand. This
 * function is here for a future standalone "resume without re-walking"
 * pass or UI-facing "N riffs still need syncing" query, which don't have a
 * candidate set to check against and need to scan for gaps directly. */
export function findRiffsNeedingDetail(
  db: Database.Database,
  jamCID: string,
  limit: number
): string[] {
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

/** True iff every one of `riffCIDs` already has a non-NULL AppVersion in
 * `Riffs`, or is given up on (recordRiffSyncFailure) -- i.e., nothing in this
 * list is a gap. Used by the sync engine's
 * per-page "is there anything left to do here" stop-check, distinct from
 * findRiffsNeedingDetail (which returns the gaps themselves, not a
 * yes/no over a specific candidate set). Delegates to filterUnresolved
 * rather than issuing its own copy of the same query, so the two can't
 * silently drift apart. */
export function areAllResolved(db: Database.Database, riffCIDs: string[]): boolean {
  return filterUnresolved(db, riffCIDs).length === 0
}

/** Which of `riffCIDs` do NOT yet have a resolved (non-NULL AppVersion)
 * Riffs row -- the complement of areAllResolved, but returning the actual
 * subset rather than a single boolean, for callers that need to know WHICH
 * ones still need resolving (not just whether any do). A riff the sync has
 * given up on (recordRiffSyncFailure) needs none. */
export function filterUnresolved(db: Database.Database, riffCIDs: string[]): string[] {
  if (riffCIDs.length === 0) return []
  ensureRiffSyncFailuresSchema(db)
  const placeholders = riffCIDs.map(() => '?').join(',')
  const resolvedRows = db
    .prepare(
      `SELECT RiffCID FROM Riffs WHERE RiffCID IN (${placeholders}) AND AppVersion IS NOT NULL
       UNION
       SELECT RiffCID FROM RiffSyncFailures WHERE RiffCID IN (${placeholders}) AND ${GIVEN_UP}`
    )
    .all(...riffCIDs, ...riffCIDs) as { RiffCID: string }[]
  const resolvedSet = new Set(resolvedRows.map((r) => r.RiffCID))
  return riffCIDs.filter((cid) => !resolvedSet.has(cid))
}

/** Deletes a jam's own warehouse rows (Riffs, Tags, and the Jams row
 * itself) and returns whichever of its stems' StemCIDs are now safe to
 * also delete from disk -- these are Stems rows removed here too. A stem
 * can be "born" under one jam (Stems.OwnerJamCID is whichever jam's
 * writeRiffDetail call happened to insert its skeleton row first -- see
 * that function's own comment) yet still be genuinely referenced by a riff
 * in a completely different jam, since Endlesss stems are real
 * content-addressed audio, not scoped to a single jam. Deleting by
 * Stems.OwnerJamCID alone would silently break playback for anything else
 * still pointing at the same audio, so this instead walks every
 * Riffs.StemCID_1..8 slot AND every RiffStemsExtra row -- together, the
 * actual source of truth for "is this stem still needed by ANY jam" --
 * checked only after this jam's own Riffs rows
 * are already gone, so a stem this jam happened to discover first but that
 * a different jam's riff also references is correctly kept. Returns []
 * (having still deleted the jam's own rows) if nothing was synced for this
 * jamCID to begin with. */
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

  ensureRiffSyncFailuresSchema(db)
  db.transaction(() => {
    deleteExtraStemSlotsForJam(db, jamCID)
    // A re-sync starts afresh: riffs given up on are asked for again.
    db.prepare(`DELETE FROM RiffSyncFailures WHERE OwnerJamCID = ?`).run(jamCID)
    db.prepare(`DELETE FROM JamRewalkExcess WHERE JamCID = ?`).run(jamCID)
    db.prepare(`DELETE FROM Riffs WHERE OwnerJamCID = ?`).run(jamCID)
    db.prepare(`DELETE FROM Tags WHERE OwnerJamCID = ?`).run(jamCID)
    db.prepare(`DELETE FROM Jams WHERE JamCID = ?`).run(jamCID)
  })()
  bumpTableWriteVersion(db, 'Riffs')
  bumpTableWriteVersion(db, 'Jams')

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
    bumpTableWriteVersion(db, 'Stems')
  }
  return orphanedStemCIDs
}

export interface WarehouseSyncStatus {
  riffCount: number
  /** True once a walk has reached the true end of the feed/jam's history
   * (or, catching up, a page that's entirely already-resolved) with no riff
   * failing on the way -- a run in which one failed leaves this false, so
   * the next sync walks to it (riffLibrarySync.ts). A jam marked complete
   * before that rule (review of b18e27fb) can still hold a gap; its next
   * sync finds it and walks the jam again. */
  complete: boolean
}

export function getWarehouseSyncStatus(
  db: Database.Database,
  jamCID: string
): WarehouseSyncStatus | null {
  const jam = db.prepare(`SELECT SyncComplete FROM Jams WHERE JamCID = ?`).get(jamCID) as
    { SyncComplete: number } | undefined
  if (!jam) return null
  const { n } = db.prepare(`SELECT COUNT(*) as n FROM Riffs WHERE OwnerJamCID = ?`).get(jamCID) as {
    n: number
  }
  return { riffCount: n, complete: jam.SyncComplete === 1 }
}

/** Every currently-favourited riffCID, in no particular order -- the
 * renderer sorts/displays them however it needs. */
export function listWarehouseFavourites(db: Database.Database): string[] {
  const rows = db.prepare(`SELECT RiffCID FROM Tags WHERE Favour = 1`).all() as {
    RiffCID: string
  }[]
  return rows.map((r) => r.RiffCID)
}

/** Toggles one riff's favourite status and returns the updated full list,
 * matching riffFavourites.ts's old toggleFavouriteRiff contract exactly (so
 * the IPC handler/renderer side needs no changes beyond which function it
 * calls). Looks up the riff's OwnerJamCID from Riffs if it's already synced
 * -- if it's not (e.g. favourited via the old on-demand browsing path that
 * never got warehouse-synced), OwnerJamCID is left NULL rather than
 * blocking the favourite; Tags.OwnerJamCID is nullable for exactly this
 * reason. */
export function toggleWarehouseFavourite(db: Database.Database, riffCID: string): string[] {
  const existing = db.prepare(`SELECT Favour FROM Tags WHERE RiffCID = ?`).get(riffCID) as
    { Favour: number } | undefined
  if (existing?.Favour === 1) {
    db.prepare(`UPDATE Tags SET Favour = 0 WHERE RiffCID = ?`).run(riffCID)
  } else {
    const jamRow = db.prepare(`SELECT OwnerJamCID FROM Riffs WHERE RiffCID = ?`).get(riffCID) as
      { OwnerJamCID: string } | undefined
    db.prepare(
      `INSERT INTO Tags (RiffCID, OwnerJamCID, Favour) VALUES (?, ?, 1)
       ON CONFLICT(RiffCID) DO UPDATE SET Favour = 1, OwnerJamCID = excluded.OwnerJamCID`
    ).run(riffCID, jamRow?.OwnerJamCID ?? null)
  }
  return listWarehouseFavourites(db)
}
