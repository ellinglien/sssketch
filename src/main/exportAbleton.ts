import { mkdirSync, readFileSync, writeFileSync, rmSync, statSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { join, basename, dirname } from 'node:path'
import { dialog, shell, BrowserWindow } from 'electron'
import type { AppState } from '../renderer/src/state/store'
// electron-vite's own Node-asset mechanism -- resolves to a real filesystem
// path in both dev and packaged builds, matching this file's own precedent
// (see index.ts's `import icon from '../../resources/icon.png?asset'`).
// Deliberately NOT imported by buildAlsXml.ts or its tests, which take the
// template text as a plain parameter instead -- vitest has no electron-vite
// plugin loaded to understand `?asset`, only the real Electron main build does.
import templatePath from './ableton/template.xml?asset'
import { buildAlsXml } from './ableton/buildAlsXml'
import { sketchAbletonDir, writeSketchMeta } from './projectLibrary'
import { materializeStemsForExport } from './exportAudioMaterialization'

/**
 * Materializes every placed stem's source audio into
 * `<outputDir>/Samples/Imported/` (via materializeStemsForExport -- see
 * exportAudioMaterialization.ts), builds the .als XML, gzips it, and writes
 * `<outputDir>/<projectName>.als`. A stem whose source file can't be
 * copied/decoded is logged and skipped (its clip is simply absent from the
 * export) rather than failing the whole export -- matching this
 * codebase's existing "don't fail the whole export over one bad piece"
 * convention (see buildEngineProject.ts's rubberband-failure fallback).
 * Throws if no rifff is placed at all (nothing to export) or if the
 * checked-in template can't be read (should never happen in practice).
 *
 * Does NOT clear `Samples/Imported/` before repopulating -- `outputDir` may
 * be a folder this codebase doesn't own (the dialog-based exportAbleton
 * lets the user pick anywhere, including an existing folder with unrelated
 * content). A caller that DOES own its outputDir outright and wants stale,
 * removed-from-the-arrangement stems cleaned up first (see
 * exportAbletonToLibrary) is responsible for clearing it itself before
 * calling this.
 */
export async function buildAndWriteAlsProject(
  state: AppState,
  outputDir: string,
  projectName: string
): Promise<void> {
  const { stemFileNames, stemSampleRates } = await materializeStemsForExport(state, outputDir)

  const templateXml = readFileSync(templatePath, 'utf-8')
  const alsXml = buildAlsXml(templateXml, state, outputDir, stemFileNames, stemSampleRates)
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
 *
 * Clears `Ableton/Samples/Imported/` before calling buildAndWriteAlsProject
 * -- safe ONLY here, because `sketchAbletonDir(libraryName)` is a folder
 * sssketch fully owns (unlike the dialog-based exportAbleton below, whose
 * outputDir is wherever the user chose and may contain unrelated content).
 * Otherwise a stem removed from the arrangement since the last export
 * would leave its old copy orphaned there forever.
 *
 * Opens `Ableton/` in Finder once the export finishes -- with routine saves
 * no longer going through a dialog, this is the only on-screen confirmation
 * a user gets that the export actually landed somewhere.
 */
export async function exportAbletonToLibrary(state: AppState, libraryName: string): Promise<void> {
  const abletonDir = sketchAbletonDir(libraryName)
  mkdirSync(abletonDir, { recursive: true })
  rmSync(join(abletonDir, 'Samples', 'Imported'), { recursive: true, force: true })
  await buildAndWriteAlsProject(state, abletonDir, libraryName)
  const alsPath = join(abletonDir, `${libraryName}.als`)
  writeSketchMeta(libraryName, { lastExportAlsMtimeMs: statSync(alsPath).mtimeMs })
  await shell.openPath(abletonDir)
}

/**
 * Same no-dialog, always-named-after-the-project export as
 * exportAbletonToLibrary above, for a sketch that's real and has a known
 * file location but ISN'T a library sketch -- one opened from an external
 * `.sssketchproj` path. Writes into an `Ableton/` folder next to that
 * source file (mirroring the library convention's own `<sketch>/Ableton/`
 * layout, just rooted at the external file's own directory instead of the
 * library root), named identically to the project (its own file name,
 * minus the `.sssketchproj` extension) -- what "the exported project
 * should be... named the same as the project" actually asks for, once
 * there's a real source file to be identical to.
 *
 * Clears `Ableton/Samples/Imported/` first, same reasoning as
 * exportAbletonToLibrary: this specific `Ableton/` folder is one this
 * export owns outright (freshly computed from the source path, not a
 * user-chosen arbitrary folder), so stale removed-stem copies can be
 * safely cleaned up before repopulating.
 */
export async function exportAbletonNextToSource(
  state: AppState,
  sourcePath: string
): Promise<void> {
  const projectName = basename(sourcePath, '.sssketchproj')
  const abletonDir = join(dirname(sourcePath), 'Ableton')
  mkdirSync(abletonDir, { recursive: true })
  rmSync(join(abletonDir, 'Samples', 'Imported'), { recursive: true, force: true })
  await buildAndWriteAlsProject(state, abletonDir, projectName)
  await shell.openPath(abletonDir)
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
 * exportMixToWav's write failure is. Opens the destination folder in
 * Finder on success, matching exportAbletonToLibrary's own behavior.
 * `defaultName` pre-fills the save dialog's filename (no `.als` suffix) --
 * the caller's own project name when one is known (an unsaved project has
 * none, so the dialog falls back to a generic "sssketch-export"). Purely a
 * starting suggestion; the user can still rename it in the dialog.
 */
export async function exportAbleton(
  win: BrowserWindow,
  state: AppState,
  defaultName?: string
): Promise<string | null> {
  const result = await dialog.showSaveDialog(win, {
    filters: [{ name: 'Ableton Live Set', extensions: ['als'] }],
    defaultPath: `${defaultName ?? 'sssketch-export'}.als`
  })
  if (result.canceled || !result.filePath) return null

  const outputDir = dirname(result.filePath)
  const projectName = basename(result.filePath, '.als')
  await buildAndWriteAlsProject(state, outputDir, projectName)
  await shell.openPath(outputDir)
  return result.filePath
}
