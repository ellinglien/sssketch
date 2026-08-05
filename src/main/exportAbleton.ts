import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
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
import { spawnEngine } from './engineProcess'
import { EngineClient } from './engineClient'

// A hard, reliable split rather than a probe/fallback -- matches
// bakeOffset.ts's own isWavPath exactly: a regular drag-and-drop import is
// always a WAV (Endlesss's own native export format), while a LORE-cached
// stem's path is the raw StemCID with no extension at all, and its actual
// on-disk bytes are whatever codec Endlesss originally stored it in (FLAC,
// confirmed empirically -- not a guess -- by inspecting a real LORE-cached
// stem's magic bytes). A naive copyFileSync of a non-WAV source produces a
// file that LOOKS like a .wav (by extension) but Ableton correctly refuses
// to load ("does not appear to be a valid WAV file"), since a straight byte
// copy never transcodes the container format.
function isWavPath(path: string): boolean {
  return path.toLowerCase().endsWith('.wav')
}

// Anything outside this set is unsafe (or at least unwelcome) in a filename
// across macOS/Windows/Linux -- matches nativeExport.ts's own
// sanitizeFileNamePart exactly (duplicated rather than imported: it's not
// exported from that module, and it's a five-line pure function -- not worth
// coupling these two independent export features over).
function sanitizeFileNamePart(name: string): string {
  return name.replace(/[/\\:*?"<>|]/g, '_').trim() || 'stem'
}

/**
 * Copies every placed stem's source audio into `<outputDir>/Samples/Imported/`,
 * builds the .als XML, gzips it, and writes `<outputDir>/<projectName>.als`.
 * A stem whose source file can't be copied/decoded is logged and skipped
 * (its clip is simply absent from the export) rather than failing the whole
 * export -- matching this codebase's existing "don't fail the whole export
 * over one bad piece" convention (see buildEngineProject.ts's
 * rubberband-failure fallback). Throws if no rifff is placed at all
 * (nothing to export) or if the checked-in template can't be read (should
 * never happen in practice).
 *
 * A WAV-sourced stem (regular drag-and-drop import) is a plain
 * `copyFileSync`. A non-WAV-sourced stem (a LORE-cached stem, whose path is
 * the raw StemCID with no extension and whose actual bytes are Endlesss's
 * own storage codec -- FLAC, confirmed empirically) is routed through the
 * native engine's `bake-stem` IPC command instead, which decodes it and
 * writes a real WAV -- confirmed necessary the hard way: a real Ableton
 * load of an early export with a naive copyFileSync produced *"The audio
 * file [...] cannot be read. [This file does not appear to be a valid WAV
 * file.]"*. Mirrors bakeOffset.ts's own isWavPath split and its
 * spawn-once-reuse-for-the-whole-batch shape for native engine calls.
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
  mkdirSync(samplesDir, { recursive: true })

  const stemFileNames = new Map<string, string>()
  const usedNames = new Map<string, number>()
  function uniqueFileName(rifffName: string, stemName: string): string {
    const base = `${sanitizeFileNamePart(rifffName)}-${sanitizeFileNamePart(stemName)}`
    const count = (usedNames.get(base) ?? 0) + 1
    usedNames.set(base, count)
    return count === 1 ? `${base}.wav` : `${base}-${count}.wav`
  }

  const wavStems: { key: string; path: string; destPath: string }[] = []
  const nonWavStems: { key: string; path: string; destPath: string }[] = []
  for (const rifff of placed) {
    for (const stem of rifff.stems) {
      const fileName = uniqueFileName(rifff.name, stem.name)
      const entry = {
        key: stemKey(rifff.groupId, stem.slot),
        path: stem.path,
        destPath: join(samplesDir, fileName)
      }
      ;(isWavPath(stem.path) ? wavStems : nonWavStems).push(entry)
      stemFileNames.set(entry.key, fileName)
    }
  }

  for (const { key, path, destPath } of wavStems) {
    try {
      copyFileSync(path, destPath)
    } catch (err) {
      stemFileNames.delete(key)
      const message = err instanceof Error ? err.message : String(err)
      console.error(`buildAndWriteAlsProject: failed to copy stem from ${path}: ${message}`)
    }
  }

  if (nonWavStems.length > 0) {
    const engineHandle = await spawnEngine()
    const client = new EngineClient()
    try {
      await client.connect(engineHandle.port)
      for (const { key, path, destPath } of nonWavStems) {
        try {
          const result = (await client.sendAndAwaitType(
            'bake-stem',
            { path, rotationSec: 0, outputPath: destPath },
            'bake-stem-result'
          )) as { success: boolean; error?: string }
          if (!result.success) {
            stemFileNames.delete(key)
            console.error(
              `buildAndWriteAlsProject: native decode failed for ${path}: ${result.error}`
            )
          }
        } catch (err) {
          stemFileNames.delete(key)
          console.error(`buildAndWriteAlsProject: native decode failed for ${path}:`, err)
        }
      }
    } finally {
      client.disconnect()
      engineHandle.stop()
    }
  }

  const templateXml = readFileSync(templatePath, 'utf-8')
  const alsXml = buildAlsXml(templateXml, state, outputDir, stemFileNames)
  const gzipped = gzipSync(Buffer.from(alsXml, 'utf-8'))
  writeFileSync(join(outputDir, `${projectName}.als`), gzipped)
}

/**
 * Opens a save dialog (choosing the .als file's own name/location), then
 * builds the whole self-contained project folder around it. Mirrors
 * exportMixToWav's cancel handling (resolves null on a cancelled dialog),
 * but NOT its failure handling: a real failure here throws/rejects rather
 * than being caught and resolved as null, matching nativeExport.ts's own
 * throw-and-let-the-renderer-catch convention (see App.tsx's
 * handleExportMix, which already try/catches + window.alerts for exactly
 * this) -- deliberately not swallowed the way exportMixToWav's write
 * failure is.
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
