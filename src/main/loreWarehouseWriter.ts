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

export interface WarehouseSyncStatus {
  riffCount: number
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
