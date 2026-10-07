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

export function upsertJam(db: Database.Database, jamCID: string, publicName: string): void {
  db.prepare(
    `INSERT INTO Jams (JamCID, PublicName) VALUES (?, ?)
     ON CONFLICT(JamCID) DO UPDATE SET PublicName = excluded.PublicName`
  ).run(jamCID, publicName)
  bumpTableWriteVersion(db, 'Jams')
}

/** Tables whose rows name their jam in OwnerJamCID. The Discover caches are
 * derived, but they are only rebuilt on a row-count change, which a move is
 * not -- so they move too, when they exist (tests build smaller dbs). */
const OWNER_JAM_TABLES = [
  'Riffs',
  'Stems',
  'Tags',
  'DiscoverRiffIndexCache',
  'DiscoverInstrumentRowsCache'
] as const

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
  const tables = OWNER_JAM_TABLES.filter(
    (table) =>
      db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(table) !==
      undefined
  )
  db.transaction(() => {
    for (const variant of variants) {
      db.prepare(
        `INSERT INTO Jams (JamCID, PublicName, SyncComplete) VALUES (?, ?, ?)
         ON CONFLICT(JamCID) DO UPDATE SET SyncComplete = MAX(SyncComplete, excluded.SyncComplete)`
      ).run(key, variant.PublicName, variant.SyncComplete)
      for (const table of tables) {
        db.prepare(`UPDATE ${table} SET OwnerJamCID = ? WHERE OwnerJamCID = ?`).run(
          key,
          variant.JamCID
        )
      }
      db.prepare(`DELETE FROM Jams WHERE JamCID = ?`).run(variant.JamCID)
    }
  })()
  bumpTableWriteVersion(db, 'Jams')
  bumpTableWriteVersion(db, 'Riffs')
  bumpTableWriteVersion(db, 'Stems')
  return variants.length
}

export function markJamSyncComplete(db: Database.Database, jamCID: string): void {
  db.prepare(`UPDATE Jams SET SyncComplete = 1 WHERE JamCID = ?`).run(jamCID)
  // An in-place UPDATE -- invisible to a row count, and precisely the
  // case tableChangeSignal.ts's per-table write counter exists for.
  bumpTableWriteVersion(db, 'Jams')
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
 * `Riffs` -- i.e., nothing in this list is a gap. Used by the sync engine's
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
 * ones still need resolving (not just whether any do). */
export function filterUnresolved(db: Database.Database, riffCIDs: string[]): string[] {
  if (riffCIDs.length === 0) return []
  const placeholders = riffCIDs.map(() => '?').join(',')
  const resolvedRows = db
    .prepare(
      `SELECT RiffCID FROM Riffs WHERE RiffCID IN (${placeholders}) AND AppVersion IS NOT NULL`
    )
    .all(...riffCIDs) as { RiffCID: string }[]
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

  db.transaction(() => {
    deleteExtraStemSlotsForJam(db, jamCID)
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
  /** True once the walk has reached the true end of the feed/jam's history
   * (or a page that's entirely already-resolved) -- NOT a guarantee that
   * every riff in `riffCount` is itself fully resolved. A riff can still be
   * a gap (AppVersion IS NULL) after `complete` is true, e.g. one whose
   * resolveJamRiff/downloadMissingStemsFor call failed on the final walked
   * page -- the next sync run will find and retry it via the same
   * pageFullyDone logic, but this flag alone doesn't promise zero gaps. */
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
