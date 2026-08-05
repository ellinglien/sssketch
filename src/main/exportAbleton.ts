import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  rmSync,
  statSync
} from 'node:fs'
import { gzipSync } from 'node:zlib'
import { join, basename, dirname } from 'node:path'
import { dialog, BrowserWindow } from 'electron'
import type { AppState } from '../renderer/src/state/store'
import { stemKey } from '@shared/types'
// electron-vite's own Node-asset mechanism -- resolves to a real filesystem
// path in both dev and packaged builds, matching this file's own precedent
// (see index.ts's `import icon from '../../resources/icon.png?asset'`).
// Deliberately NOT imported by buildAlsXml.ts or its tests, which take the
// template text as a plain parameter instead -- vitest has no electron-vite
// plugin loaded to understand `?asset`, only the real Electron main build does.
import templatePath from './ableton/template.xml?asset'
import { buildAlsXml } from './ableton/buildAlsXml'
import { spawnEngine, type EngineHandle } from './engineProcess'
import { EngineClient } from './engineClient'
import {
  isWavPath,
  cachedStemPath,
  cloneOrCopy,
  samplesCacheDir,
  sketchAbletonDir,
  writeSketchMeta
} from './projectLibrary'

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
async function materializeStem(
  path: string,
  destPath: string,
  client: EngineClient | null
): Promise<boolean> {
  const cachePath = cachedStemPath(path)
  if (!existsSync(cachePath)) {
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
        return false
      }
    }
  }
  cloneOrCopy(cachePath, destPath)
  return true
}

/**
 * Materializes every placed stem's source audio into
 * `<outputDir>/Samples/Imported/` (via the shared cache -- see
 * materializeStem), builds the .als XML, gzips it, and writes
 * `<outputDir>/<projectName>.als`. A stem whose source file can't be
 * copied/decoded is logged and skipped (its clip is simply absent from the
 * export) rather than failing the whole export -- matching this
 * codebase's existing "don't fail the whole export over one bad piece"
 * convention (see buildEngineProject.ts's rubberband-failure fallback).
 * Throws if no rifff is placed at all (nothing to export) or if the
 * checked-in template can't be read (should never happen in practice).
 *
 * `Samples/Imported/` is cleared before repopulating -- otherwise a stem
 * removed from the arrangement since the last export into this SAME
 * outputDir would leave its old copy orphaned there forever. This only
 * touches this one export's own destination folder, never the shared
 * cache itself (other sketches/versions may still reference those cached
 * files).
 */
export async function buildAndWriteAlsProject(
  state: AppState,
  outputDir: string,
  projectName: string
): Promise<void> {
  const placed = Object.values(state.rifffs).filter((r) => r.startBar !== undefined)
  if (placed.length === 0) {
    throw new Error('Nothing to export -- no rifffs are placed on the timeline.')
  }

  const samplesDir = join(outputDir, 'Samples', 'Imported')
  rmSync(samplesDir, { recursive: true, force: true })
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
      const fileName = uniqueFileName(rifff.name, stem.name)
      const entry = {
        key: stemKey(rifff.groupId, stem.slot),
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
    await client.connect(engineHandle.port)
  }
  try {
    for (const { key, path, destPath } of stemEntries) {
      try {
        const ok = await materializeStem(path, destPath, client)
        if (!ok) stemFileNames.delete(key)
      } catch (err) {
        stemFileNames.delete(key)
        console.error(`buildAndWriteAlsProject: failed to materialize stem from ${path}:`, err)
      }
    }
  } finally {
    client?.disconnect()
    engineHandle?.stop()
  }

  const templateXml = readFileSync(templatePath, 'utf-8')
  const alsXml = buildAlsXml(templateXml, state, outputDir, stemFileNames)
  const gzipped = gzipSync(Buffer.from(alsXml, 'utf-8'))
  writeFileSync(join(outputDir, `${projectName}.als`), gzipped)
}

/**
 * Routine, no-dialog Ableton export for a library-resident sketch: writes
 * into that sketch's own `Ableton/` folder in place, then records the
 * freshly-written .als's mtime (see projectLibrary.ts's writeSketchMeta)
 * so the next export can detect whether it's been touched outside
 * sssketch since (shouldWarnBeforeOverwrite) -- the caller is expected to
 * have already checked that and confirmed with the user BEFORE calling
 * this, the same way App.tsx's handleNew owns its own window.confirm
 * rather than pushing that into the main process.
 */
export async function exportAbletonToLibrary(state: AppState, libraryName: string): Promise<void> {
  const abletonDir = sketchAbletonDir(libraryName)
  mkdirSync(abletonDir, { recursive: true })
  await buildAndWriteAlsProject(state, abletonDir, libraryName)
  const alsPath = join(abletonDir, `${libraryName}.als`)
  writeSketchMeta(libraryName, { lastExportAlsMtimeMs: statSync(alsPath).mtimeMs })
}

/**
 * Opens a save dialog (choosing the .als file's own name/location), then
 * builds the whole self-contained project folder around it -- the
 * "export a copy elsewhere" escape hatch, for sharing a fully standalone
 * copy outside the library. Mirrors exportMixToWav's cancel handling
 * (resolves null on a cancelled dialog), but NOT its failure handling: a
 * real failure here throws/rejects rather than being caught and resolved
 * as null, matching nativeExport.ts's own throw-and-let-the-renderer-catch
 * convention (see App.tsx's handleExportMix, which already try/catches +
 * window.alerts for exactly this) -- deliberately not swallowed the way
 * exportMixToWav's write failure is.
 */
export async function exportAbleton(win: BrowserWindow, state: AppState): Promise<string | null> {
  const result = await dialog.showSaveDialog(win, {
    filters: [{ name: 'Ableton Live Set', extensions: ['als'] }],
    defaultPath: 'sssketch-export.als'
  })
  if (result.canceled || !result.filePath) return null

  const outputDir = dirname(result.filePath)
  const projectName = basename(result.filePath, '.als')
  await buildAndWriteAlsProject(state, outputDir, projectName)
  return result.filePath
}
