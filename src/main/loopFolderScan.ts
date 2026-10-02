// src/main/loopFolderScan.ts
import { readdir, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type Database from 'better-sqlite3'
import { readWavDurationSeconds } from '@shared/wavDuration'
import { guessBpmFromFilename } from '@shared/guessBpmFromFilename'
import { loopTempo, type LoopTempoSource } from '@shared/loopFolderTempo'
import {
  isHiddenEntry,
  isPlayableLoopFile,
  loopDisplayName,
  loopGroupPath
} from '@shared/loopFolderTree'
import type { LoopEntry } from '@shared/loopFolderTypes'
import { readWavHeaderBytes } from './importRifff'
import { loopEntryFromRow, loopIdForPath, normalizeLoopPath, type LoopFileRow } from './loopFolders'

/** The same 8ms slice listLibraryScanTargets uses (discoverLibraryStems.ts,
 * commit 5b0a91b): a clock bounds the slice on any hardware, a file count
 * only on the developer's. On Elling's USB/ExFAT volume a header read is
 * far slower than here. */
export const LOOP_SCAN_SLICE_BUDGET_MS = 8

export interface LoopScanDeps {
  /** The file's length in seconds, or null when this process cannot tell. */
  measureDurationSec: (path: string) => number | null
  now: () => number
  yieldToEventLoop: () => Promise<void>
}

/** WAV only: main has no reader for any other format (importOneShot.ts
 * says the same). One stat plus a 4 KB read, via the existing helpers. */
export function measureWavDurationSec(path: string): number | null {
  if (!path.toLowerCase().endsWith('.wav')) return null
  try {
    const durationSec = readWavDurationSeconds(readWavHeaderBytes(path))
    return durationSec > 0 ? durationSec : null
  } catch {
    return null
  }
}

export const DEFAULT_LOOP_SCAN_DEPS: LoopScanDeps = {
  measureDurationSec: measureWavDurationSec,
  now: () => Date.now(),
  yieldToEventLoop: () => new Promise((resolve) => setImmediate(resolve))
}

export interface FoundLoopFile {
  path: string
  name: string
  groupPath: string[]
}

/** Every playable file under `rootPath`. Async readdir throughout -- a
 * cold readdirSync on his USB volume is one uninterruptible 626ms, which
 * no yield can split. Dot entries are skipped and never descended into.
 * Symlinks are neither files nor directories to a Dirent, so they are
 * skipped too, which also rules out a symlink cycle. An unreadable
 * subfolder is skipped, not fatal. An unreadable ROOT returns null: a drive
 * pulled between the root stat and this readdir is not an empty folder,
 * and must not delete every loop in it. */
export async function walkLoopFolder(rootPath: string): Promise<FoundLoopFile[] | null> {
  const found: FoundLoopFile[] = []
  const pending: string[][] = [[]]
  while (pending.length > 0) {
    const segments = pending.pop()!
    const dir = join(rootPath, ...segments)
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      if (segments.length === 0) return null
      continue
    }
    for (const entry of entries) {
      if (isHiddenEntry(entry.name)) continue
      if (entry.isDirectory()) {
        pending.push([...segments, entry.name])
      } else if (entry.isFile() && isPlayableLoopFile(entry.name)) {
        found.push({
          path: join(dir, entry.name),
          name: loopDisplayName(entry.name),
          groupPath: loopGroupPath(segments)
        })
      }
    }
  }
  return found
}

export interface LoopTempoFields {
  bpm: number | null
  bars: number | null
  source: LoopTempoSource | null
  irregular: boolean
}

/** The folder a person sees a loop in: its last group, or the linked
 * folder itself for a loop at the top. */
export function loopFolderName(groupPath: string[], rootPath: string): string {
  return groupPath.length > 0 ? groupPath[groupPath.length - 1] : basename(rootPath)
}

/** The cascade when the length is known. Before it is (a non-WAV file the
 * renderer has not decoded yet), only a filename tempo can be said. */
export function tempoForLoop(
  name: string,
  folderName: string,
  siblingNames: string[],
  durationSec: number | null,
  projectBpm: number
): LoopTempoFields {
  if (durationSec !== null) {
    return loopTempo({
      fileName: name,
      folderName,
      siblingFileNames: siblingNames,
      durationSec,
      projectBpm
    })
  }
  const fromName = guessBpmFromFilename(name)
  return fromName !== null
    ? { bpm: fromName, bars: null, source: 'filename', irregular: false }
    : { bpm: null, bars: null, source: null, irregular: false }
}

export interface LoopScanSummary {
  rootPath: string
  available: boolean
  /** Loops present after the scan. */
  total: number
  /** Files whose length was read this time: new or changed only. */
  measured: number
  /** Loops that were present before and are gone now. */
  removed: number
}

const inFlight = new Map<string, Promise<LoopScanSummary>>()

/** Rescans one linked folder. Two callers asking at once (IMPORT opening
 * while `rescan` is clicked) share one scan. Deliberately not `async`, so
 * the second caller gets the very same promise. */
export function rescanLoopFolder(
  db: Database.Database,
  rawRootPath: string,
  projectBpm: number,
  deps: LoopScanDeps = DEFAULT_LOOP_SCAN_DEPS
): Promise<LoopScanSummary> {
  const rootPath = normalizeLoopPath(rawRootPath)
  const running = inFlight.get(rootPath)
  if (running) return running
  const scan = doRescan(db, rootPath, projectBpm, deps).finally(() => inFlight.delete(rootPath))
  inFlight.set(rootPath, scan)
  return scan
}

interface StatedFile {
  file: FoundLoopFile
  size: number
  mtimeMs: number
}

async function doRescan(
  db: Database.Database,
  rootPath: string,
  projectBpm: number,
  deps: LoopScanDeps
): Promise<LoopScanSummary> {
  const markUnavailable = (): LoopScanSummary => {
    // An unplugged drive. Its rows are left exactly as they were: greyed,
    // not removed, until it is back.
    db.prepare(`UPDATE LoopFolders SET Available = 0 WHERE RootPath = ?`).run(rootPath)
    return { rootPath, available: false, total: 0, measured: 0, removed: 0 }
  }
  const rootStat = await stat(rootPath).catch(() => null)
  if (!rootStat || !rootStat.isDirectory()) return markUnavailable()

  // Null when the root itself cannot be read -- the same as not there.
  const files = await walkLoopFolder(rootPath)
  if (files === null) return markUnavailable()
  const stated: StatedFile[] = []
  for (const file of files) {
    const fileStat = await stat(file.path).catch(() => null)
    if (fileStat) stated.push({ file, size: fileStat.size, mtimeMs: Math.trunc(fileStat.mtimeMs) })
  }

  // .all(), then the statement is closed before any await below.
  const knownRows = db
    .prepare(`SELECT * FROM LoopFiles WHERE RootPath = ?`)
    .all(rootPath) as LoopFileRow[]
  const known = new Map(knownRows.map((row) => [row.Path, row]))

  let sliceStart = deps.now()
  const maybeYield = async (): Promise<void> => {
    if (deps.now() - sliceStart >= LOOP_SCAN_SLICE_BUDGET_MS) {
      await deps.yieldToEventLoop()
      sliceStart = deps.now()
    }
  }

  let measured = 0
  const durations = new Map<string, number | null>()
  for (const { file, size, mtimeMs } of stated) {
    const prev = known.get(file.path)
    if (prev && prev.SizeBytes === size && prev.MtimeMs === mtimeMs) {
      durations.set(file.path, prev.DurationSec)
    } else {
      durations.set(file.path, deps.measureDurationSec(file.path))
      measured += 1
    }
    await maybeYield()
  }

  // Every guess is recomputed, not just the changed files' -- a sibling
  // added or removed can change the siblings' most common tempo. Pure and
  // cheap, but budgeted all the same.
  const byGroup = new Map<string, StatedFile[]>()
  for (const s of stated) {
    const key = JSON.stringify(s.file.groupPath)
    const members = byGroup.get(key) ?? []
    members.push(s)
    byGroup.set(key, members)
  }
  const rows: Record<string, string | number | null>[] = []
  for (const [groupKey, members] of byGroup) {
    const siblingNames = members.map((m) => m.file.name)
    const folderName = loopFolderName(members[0].file.groupPath, rootPath)
    for (const { file, size, mtimeMs } of members) {
      const durationSec = durations.get(file.path) ?? null
      const tempo = tempoForLoop(file.name, folderName, siblingNames, durationSec, projectBpm)
      rows.push({
        path: file.path,
        loopId: loopIdForPath(file.path),
        rootPath,
        groupPath: groupKey,
        name: file.name,
        size,
        mtimeMs,
        durationSec,
        bpm: tempo.bpm,
        bars: tempo.bars,
        source: tempo.source,
        irregular: tempo.irregular ? 1 : 0
      })
      await maybeYield()
    }
  }

  const seen = new Set(rows.map((row) => row.path as string))
  const gone = knownRows.filter((row) => !seen.has(row.Path))
  const upsert = db.prepare(
    `INSERT INTO LoopFiles (Path, LoopId, RootPath, GroupPath, Name, SizeBytes, MtimeMs,
       DurationSec, Bpm, Bars, TempoSource, Irregular, Present)
     VALUES (@path, @loopId, @rootPath, @groupPath, @name, @size, @mtimeMs,
       @durationSec, @bpm, @bars, @source, @irregular, 1)
     ON CONFLICT(Path) DO UPDATE SET
       LoopId = excluded.LoopId, RootPath = excluded.RootPath, GroupPath = excluded.GroupPath,
       Name = excluded.Name, SizeBytes = excluded.SizeBytes, MtimeMs = excluded.MtimeMs,
       DurationSec = excluded.DurationSec, Bpm = excluded.Bpm, Bars = excluded.Bars,
       TempoSource = excluded.TempoSource, Irregular = excluded.Irregular, Present = 1`
  )
  const deleteRow = db.prepare(`DELETE FROM LoopFiles WHERE Path = ?`)
  const hideRow = db.prepare(`UPDATE LoopFiles SET Present = 0 WHERE Path = ?`)
  const isLinked = db.prepare(`SELECT 1 FROM LoopFolders WHERE RootPath = ?`)
  const markScanned = db.prepare(
    `UPDATE LoopFolders SET Available = 1, LastScannedAt = ? WHERE RootPath = ?`
  )
  const scannedAt = deps.now()

  // One transaction for every write. Re-checks the link inside it: an
  // unlink that landed during the awaits above wins, and nothing is
  // written back for a folder that is no longer linked.
  db.transaction(() => {
    if (!isLinked.get(rootPath)) return
    for (const row of rows) upsert.run(row)
    for (const row of gone) (row.OverrideBpm === null ? deleteRow : hideRow).run(row.Path)
    markScanned.run(scannedAt, rootPath)
  })()

  return {
    rootPath,
    available: true,
    total: rows.length,
    measured,
    removed: gone.filter((row) => row.Present === 1).length
  }
}

/** Every linked folder, one after another. */
export async function rescanAllLoopFolders(
  db: Database.Database,
  projectBpm: number,
  deps: LoopScanDeps = DEFAULT_LOOP_SCAN_DEPS
): Promise<LoopScanSummary[]> {
  const roots = db
    .prepare(`SELECT RootPath FROM LoopFolders ORDER BY Name COLLATE NOCASE`)
    .all() as { RootPath: string }[]
  const summaries: LoopScanSummary[] = []
  for (const { RootPath } of roots) {
    summaries.push(await rescanLoopFolder(db, RootPath, projectBpm, deps))
  }
  return summaries
}

/** The renderer measured a file main could not (a non-WAV it decoded for
 * the waveform). Taken only while the row has no length yet: a header read
 * or an earlier report wins. A rescan keeps it while the file's size and
 * mtime are unchanged. */
export function recordLoopDuration(
  db: Database.Database,
  loopId: string,
  durationSec: number,
  projectBpm: number
): LoopEntry | null {
  if (!(Number.isFinite(durationSec) && durationSec > 0)) return null
  const row = db.prepare(`SELECT * FROM LoopFiles WHERE LoopId = ? AND Present = 1`).get(loopId) as
    LoopFileRow | undefined
  if (!row) return null
  if (row.DurationSec !== null) return loopEntryFromRow(row)

  const siblings = db
    .prepare(`SELECT Name FROM LoopFiles WHERE RootPath = ? AND GroupPath = ? AND Present = 1`)
    .all(row.RootPath, row.GroupPath) as { Name: string }[]
  const folderName = loopFolderName(JSON.parse(row.GroupPath) as string[], row.RootPath)
  const tempo = tempoForLoop(
    row.Name,
    folderName,
    siblings.map((s) => s.Name),
    durationSec,
    projectBpm
  )
  const irregular = tempo.irregular ? 1 : 0
  db.prepare(
    `UPDATE LoopFiles SET DurationSec = ?, Bpm = ?, Bars = ?, TempoSource = ?, Irregular = ?
     WHERE LoopId = ?`
  ).run(durationSec, tempo.bpm, tempo.bars, tempo.source, irregular, loopId)
  return loopEntryFromRow({
    ...row,
    DurationSec: durationSec,
    Bpm: tempo.bpm,
    Bars: tempo.bars,
    TempoSource: tempo.source,
    Irregular: irregular
  })
}
