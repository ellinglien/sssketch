import { copyFileSync, mkdirSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { AppState } from '../renderer/src/state/store'
import { stemKey } from '@shared/types'
import { findWavChunks } from '@shared/wavChunks'
import { spawnEngine, type EngineHandle } from './engineProcess'
import { EngineClient } from './engineClient'
import { isWavPath, cachedStemPath, cloneOrCopy, samplesCacheDir } from './projectLibrary'
import { readWavHeaderBytes } from './importRifff'

// Anything outside this set is unsafe (or at least unwelcome) in a filename
// across macOS/Windows/Linux -- matches nativeExport.ts's own
// sanitizeFileNamePart exactly (duplicated rather than imported: it's not
// exported from that module, and it's a five-line pure function -- not worth
// coupling these two independent export features over).
function sanitizeFileNamePart(name: string): string {
  return name.replace(/[/\\:*?"<>|]/g, '_').trim() || 'stem'
}

/** Materializes one stem's audio at `destPath`, via the shared cache (see
 * projectLibrary.ts's cachedStemPath/cloneOrCopy): if this stem's own
 * cache entry already exists (same source path+size+mtime, or same LORE
 * StemCID), it's cloned straight out -- no re-read of the source, no
 * re-decode. Otherwise it's materialized into the cache first (a WAV
 * source is a plain copy; anything else -- a LORE-cached stem, whose
 * actual on-disk bytes are Endlesss's own storage codec, confirmed FLAC --
 * is decoded via the native engine's bake-stem command, which needs
 * `client` to be connected), then cloned out the same way. Returns false
 * (caller should drop this stem from the export) on any failure, including
 * "needed to decode but no engine connection was available". */
export async function materializeStem(
  path: string,
  destPath: string,
  client: EngineClient | null
): Promise<boolean> {
  const cachePath = cachedStemPath(path)
  if (!existsSync(cachePath)) {
    try {
      if (isWavPath(path)) {
        copyFileSync(path, cachePath)
      } else {
        if (!client) return false
        const result = (await client.sendAndAwaitType(
          'bake-stem',
          { path, rotationSec: 0, outputPath: cachePath },
          'bake-stem-result'
        )) as { success: boolean; error?: string }
        if (!result.success) {
          console.error(`materializeStem: native decode failed for ${path}: ${result.error}`)
          // The native side may have left a partial/empty file at
          // outputPath despite reporting failure -- don't let that poison
          // the cache for every future export of this stem (see CLAUDE.md's
          // "cache by path, evict on rejection" convention).
          if (existsSync(cachePath)) rmSync(cachePath)
          return false
        }
      }
    } catch (err) {
      // Same reasoning as above: a copy/decode that threw partway through
      // may still have left a partial file behind. Evict before rethrowing
      // so this failure doesn't silently poison the cache forever.
      if (existsSync(cachePath)) rmSync(cachePath)
      throw err
    }
  }
  cloneOrCopy(cachePath, destPath)
  return true
}

export interface MaterializedStems {
  /** stemKey -> filename (relative to `<outputDir>/Samples/Imported/`) for
   * every stem that materialized successfully. A stem whose copy/decode
   * failed is simply absent -- callers skip it rather than failing the
   * whole export. */
  stemFileNames: Map<string, string>
  /** stemKey -> the ACTUAL materialized file's own sample rate (read back
   * from its real destination file, not the original source) -- only
   * populated for stems present in stemFileNames. */
  stemSampleRates: Map<string, number>
}

/**
 * Materializes every placed stem's source audio into
 * `<outputDir>/Samples/Imported/` (via the shared cache -- see
 * materializeStem above), shared by both the Ableton and Reaper export
 * paths. Does NOT clear `Samples/Imported/` before repopulating -- a
 * caller that owns its outputDir outright and wants stale, removed-from-
 * the-arrangement stems cleaned up first is responsible for clearing it
 * itself before calling this (see exportAbletonToLibrary/
 * exportReaperToLibrary). Throws if no rifff is placed at all (nothing to
 * export).
 */
export async function materializeStemsForExport(
  state: AppState,
  outputDir: string,
  /** Stems the caller has already produced audio for by other means and
   * doesn't want a dry copy of -- the clips a "bake in" export rendered
   * through the toolkit (see exportToolkitAudio.ts). Left out of the returned
   * map as well as of the folder, so an exporter reading only this map still
   * skips them and has to look at the baked map to place them. */
  skipKeys: ReadonlySet<string> = new Set()
): Promise<MaterializedStems> {
  const placed = Object.values(state.rifffs).filter((r) => r.startBar !== undefined)
  if (placed.length === 0) {
    throw new Error('Nothing to export -- no rifffs are placed on the timeline.')
  }

  const samplesDir = join(outputDir, 'Samples', 'Imported')
  mkdirSync(samplesDir, { recursive: true })
  mkdirSync(samplesCacheDir(), { recursive: true })

  const stemFileNames = new Map<string, string>()
  const usedNames = new Map<string, number>()
  function uniqueFileName(rifffName: string, stemName: string): string {
    const base = `${sanitizeFileNamePart(rifffName)}-${sanitizeFileNamePart(stemName)}`
    const count = (usedNames.get(base) ?? 0) + 1
    usedNames.set(base, count)
    return count === 1 ? `${base}.wav` : `${base}-${count}.wav`
  }

  const stemEntries: { key: string; path: string; destPath: string }[] = []
  for (const rifff of placed) {
    for (const stem of rifff.stems) {
      const key = stemKey(rifff.groupId, stem.slot)
      if (skipKeys.has(key)) continue
      const fileName = uniqueFileName(rifff.name, stem.name)
      const entry = {
        key,
        path: stem.path,
        destPath: join(samplesDir, fileName)
      }
      stemEntries.push(entry)
      stemFileNames.set(entry.key, fileName)
    }
  }

  // Only spawn the native engine at all if at least one stem actually needs
  // decoding -- if every stem is already cached from a prior export, this
  // export needs no engine process whatsoever.
  const needsEngine = stemEntries.some(
    ({ path }) => !isWavPath(path) && !existsSync(cachedStemPath(path))
  )
  let client: EngineClient | null = null
  let engineHandle: EngineHandle | null = null
  if (needsEngine) {
    engineHandle = await spawnEngine()
    client = new EngineClient()
    try {
      await client.connect(engineHandle.port)
    } catch (err) {
      // spawnEngine() already resolved, meaning the process is up and
      // running -- if connect() then throws, stop it here so it isn't
      // orphaned (the try/finally below is never reached in that case,
      // since this whole block runs before it).
      engineHandle.stop()
      throw err
    }
  }
  try {
    for (const { key, path, destPath } of stemEntries) {
      try {
        const ok = await materializeStem(path, destPath, client)
        if (!ok) stemFileNames.delete(key)
      } catch (err) {
        stemFileNames.delete(key)
        console.error(`materializeStemsForExport: failed to materialize stem from ${path}:`, err)
      }
    }
  } finally {
    client?.disconnect()
    engineHandle?.stop()
  }

  // Read each successfully-materialized stem's real sample rate from its
  // ACTUAL destination file (not the original source) -- needed to convert
  // fadeInBars/fadeOutBars into buildAlsXml's fade-length unit (see that
  // function's own fadeSecToSampleCount/applyFade doc comments for the
  // unverified hypothesis this depends on). Iterating stemFileNames here
  // (not stemEntries) naturally skips any stem whose materialize failed
  // above (deleted from the map already) -- no separate failure tracking
  // needed.
  const stemSampleRates = new Map<string, number>()
  for (const [key, fileName] of stemFileNames) {
    try {
      const destPath = join(samplesDir, fileName)
      const { sampleRate } = findWavChunks(readWavHeaderBytes(destPath))
      if (sampleRate > 0) stemSampleRates.set(key, sampleRate)
    } catch (err) {
      console.error(`materializeStemsForExport: failed to read sample rate for ${fileName}:`, err)
    }
  }

  return { stemFileNames, stemSampleRates }
}
