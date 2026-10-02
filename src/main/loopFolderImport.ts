// src/main/loopFolderImport.ts
import type Database from 'better-sqlite3'
import { barsAtTempo } from '@shared/loopFolderTempo'
import type { Rifff } from '@shared/types'
import { spawnEngine } from './engineProcess'
import { EngineClient } from './engineClient'
import { importLoop, importLoopViaDecoder, type DecodeToWav } from './importOneShot'
import { loopEntryFromRow, type LoopFileRow } from './loopFolders'
import { loopFolderName, tempoForLoop } from './loopFolderScan'

/** Runs `fn` with a decoder, and tears the decoder down afterwards. */
export type RunWithDecoder = <T>(fn: (decode: DecodeToWav) => Promise<T>) => Promise<T>

/** A long MP3 on a slow USB drive can take a while; the engine finishes a
 * decode however long it takes, so the client must outwait it. */
const DECODE_TIMEOUT_MS = 180_000

/** One engine process for the whole batch, the same spawn-connect-act-
 * teardown shape as bakeOffset.ts's bakeNativeJobs. bake-stem with
 * rotationSec 0 is a plain decode to 16-bit WAV
 * (native-engine/Source/BakeStem.cpp). Not bakeOffset itself: its
 * bakedPathFor writes next to the SOURCE, and a linked folder is never
 * written to. */
export const withEngineDecoder: RunWithDecoder = async (fn) => {
  const handle = await spawnEngine()
  const client = new EngineClient()
  try {
    await client.connect(handle.port)
    // Replies are matched by type, not by request. After a timeout or a
    // throw the engine may still answer the abandoned request, and that
    // late reply would be read as the next loop's. So the session is done:
    // the rest of the batch is skipped rather than risk a mismatch.
    let poisoned = false
    return await fn(async (sourcePath, outputPath) => {
      if (poisoned) return null
      try {
        const result = (await client.sendAndAwaitType(
          'bake-stem',
          { path: sourcePath, rotationSec: 0, outputPath },
          'bake-stem-result',
          DECODE_TIMEOUT_MS
        )) as { success: boolean; durationSec?: number; error?: string }
        if (!result.success || result.durationSec === undefined) {
          console.error(`loopFolderImport: decode failed for "${sourcePath}": ${result.error}`)
          return null
        }
        return result.durationSec
      } catch (err) {
        poisoned = true
        console.error(`loopFolderImport: decode failed for "${sourcePath}":`, err)
        return null
      }
    })
  } finally {
    client.disconnect()
    handle.stop()
  }
}

/** SQLite's bind limit is far above any selection, but chunk anyway, as
 * riffStemsExtra.ts does, so nobody has to think about it again. */
const BIND_CHUNK = 900

function rowsForIds(db: Database.Database, loopIds: string[]): LoopFileRow[] {
  const rows: LoopFileRow[] = []
  for (let i = 0; i < loopIds.length; i += BIND_CHUNK) {
    const chunk = loopIds.slice(i, i + BIND_CHUNK)
    const placeholders = chunk.map(() => '?').join(', ')
    rows.push(
      ...(db
        .prepare(`SELECT * FROM LoopFiles WHERE Present = 1 AND LoopId IN (${placeholders})`)
        .all(...chunk) as LoopFileRow[])
    )
  }
  return rows
}

/** A decoded loop's bar count, once its real length is known: the user's
 * tempo if they corrected it, otherwise the cascade with its folder and
 * siblings, exactly as the scan would have worked it out. */
function barsForDecodedLoop(
  db: Database.Database,
  row: LoopFileRow,
  durationSec: number,
  projectBpm: number
): number {
  if (row.OverrideBpm !== null) return barsAtTempo(durationSec, row.OverrideBpm).bars
  // The engine decoded the very length the row was scanned at: keep the bars
  // the row showed, so a changed project tempo cannot import a different count.
  if (
    row.Bars !== null &&
    row.DurationSec !== null &&
    row.DurationSec > 0 &&
    Math.abs(durationSec - row.DurationSec) <= row.DurationSec * 0.01
  ) {
    return row.Bars
  }
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
  return tempo.bars ?? 1
}

function renamed(rifff: Rifff, name: string): Rifff {
  return { ...rifff, name, stems: rifff.stems.map((stem) => ({ ...stem, name })) }
}

/**
 * IMPORT's "import to project" for linked loops: one one-stem loop rifff
 * per loop, built the way `+ sample`'s loop import builds one today
 * (importOneShot.ts's importLoop). An irregular loop imports the same way,
 * at its nearest bar count -- which is also what importDiscoverLoopSeed
 * does with a length it cannot fit. Returned in selection order. A loop
 * that cannot be imported is skipped, never fatal to the rest.
 */
export async function importLinkedLoops(
  db: Database.Database,
  loopIds: string[],
  projectBpm: number,
  runWithDecoder: RunWithDecoder = withEngineDecoder
): Promise<Rifff[]> {
  if (loopIds.length === 0) return []
  const byId = new Map(rowsForIds(db, loopIds).map((row) => [row.LoopId, row]))
  const ordered = loopIds
    .map((id) => byId.get(id))
    .filter((row): row is LoopFileRow => row !== undefined)

  const results = new Map<string, Rifff>()
  const toDecode: LoopFileRow[] = []
  for (const row of ordered) {
    if (!row.Path.toLowerCase().endsWith('.wav')) {
      toDecode.push(row)
      continue
    }
    const { bars } = loopEntryFromRow(row)
    if (bars === null) {
      toDecode.push(row) // our reader can't parse the header; the engine may still
      continue
    }
    const rifff = importLoop(row.Path, bars)
    if (rifff) results.set(row.LoopId, renamed(rifff, row.Name))
    else toDecode.push(row) // the copy could not read it either; the engine may
  }

  if (toDecode.length > 0) {
    try {
      await runWithDecoder(async (decode) => {
        for (const row of toDecode) {
          const rifff = await importLoopViaDecoder(
            row.Path,
            row.Name,
            (durationSec) => barsForDecodedLoop(db, row, durationSec, projectBpm),
            decode
          )
          if (rifff) results.set(row.LoopId, rifff)
        }
      })
    } catch (err) {
      console.error('loopFolderImport: could not start the decoder:', err)
    }
  }

  return ordered
    .map((row) => results.get(row.LoopId))
    .filter((rifff): rifff is Rifff => rifff !== undefined)
}
