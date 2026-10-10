// src/main/exportReaper.ts
import { writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join, basename, dirname } from 'node:path'
import { dialog, shell, BrowserWindow } from 'electron'
import type { AppState } from '../renderer/src/state/store'
import { buildRppProject } from './reaper/buildRppProject'
import { materializeStemsForExport } from './exportAudioMaterialization'
import { renderToolkitAudio } from './exportToolkitAudio'
import { sketchReaperDir } from './projectLibrary'
import { ensureReonedCopiesForState } from './reonedRebuild'
import type { ToolkitExportMode } from '@shared/toolkit'
import { createStemExportFileNameAllocator, externalDawExportLocation } from './exportFileNames'

/**
 * Materializes every placed stem's source audio into
 * `<outputDir>/Samples/Imported/` (via materializeStemsForExport -- same
 * shared cache and Samples folder layout the Ableton export uses), builds
 * the .rpp text, and writes `<outputDir>/<projectName>.rpp`. No gzip (RPP
 * is REAPER's own plain-text format, unlike Ableton's gzipped XML) and no
 * checked-in template (see buildRppProject.ts's own doc comment). Mirrors
 * exportAbleton.ts's buildAndWriteAlsProject exactly otherwise, including
 * NOT clearing Samples/Imported/ first -- a caller that owns its outputDir
 * outright is responsible for that (see exportReaperToLibrary/
 * exportReaperNextToSource below).
 */
export async function buildAndWriteRppProject(
  state: AppState,
  outputDir: string,
  projectName: string,
  /** The export dialog's bake/automation choice -- see
   * buildAndWriteAlsProject's own note; this path mirrors it exactly. */
  toolkitMode: ToolkitExportMode = 'bake'
): Promise<void> {
  // Rebuild any re-oned copy this project names that has gone missing (cleaned up, or never
  // made on this machine), so the export renders the riff as it plays.
  state = await ensureReonedCopiesForState(state)
  // Before materializing, same as the Ableton path: a baked clip gets no dry
  // copy.
  const uniqueFileName = createStemExportFileNameAllocator()
  const toolkitAudio = await renderToolkitAudio(state, outputDir, toolkitMode, uniqueFileName)
  const { stemFileNames } = await materializeStemsForExport(
    state,
    outputDir,
    new Set(toolkitAudio.bakedClips.keys()),
    uniqueFileName
  )
  const rppText = buildRppProject(state, stemFileNames, { mode: toolkitMode, toolkitAudio })
  writeFileSync(join(outputDir, `${projectName}.rpp`), rppText, 'utf-8')
}

/**
 * Routine, no-dialog Reaper export for a library-resident sketch: writes
 * into that sketch's own `Reaper/` folder in place, then opens it in
 * Finder. Mirrors exportAbletonToLibrary exactly, minus the
 * shouldWarnBeforeOverwrite/lastExportAlsMtimeMs tracking -- that
 * modified-outside-sssketch warning is specific to Ableton's own
 * established workflow (mixing directly in Ableton after export); no
 * equivalent has been requested for Reaper, so this simply overwrites.
 */
export async function exportReaperToLibrary(
  state: AppState,
  libraryName: string,
  toolkitMode: ToolkitExportMode = 'bake'
): Promise<void> {
  const reaperDir = sketchReaperDir(libraryName)
  mkdirSync(reaperDir, { recursive: true })
  rmSync(join(reaperDir, 'Samples', 'Imported'), { recursive: true, force: true })
  await buildAndWriteRppProject(state, reaperDir, libraryName, toolkitMode)
  await shell.openPath(reaperDir)
}

/**
 * Same no-dialog, always-named-after-the-project export as
 * exportReaperToLibrary above, for a sketch that's real and has a known
 * file location but isn't a library sketch -- an external .sssketchproj
 * path. Each source gets its own
 * `<source directory>/Reaper/<project name>/` folder. As on the Ableton
 * path, it is not recursively cleared without proof of directory ownership.
 */
export async function exportReaperNextToSource(
  state: AppState,
  sourcePath: string,
  toolkitMode: ToolkitExportMode = 'bake'
): Promise<void> {
  const { projectName, outputDir: reaperDir } = externalDawExportLocation(sourcePath, 'Reaper')
  mkdirSync(reaperDir, { recursive: true })
  await buildAndWriteRppProject(state, reaperDir, projectName, toolkitMode)
  await shell.openPath(reaperDir)
}

/**
 * Opens a save dialog (choosing the .rpp file's own name/location), then
 * builds the whole self-contained project folder around it -- the
 * "export a copy elsewhere" escape hatch for an unsaved project. Mirrors
 * exportAbleton exactly.
 */
export async function exportReaper(
  win: BrowserWindow,
  state: AppState,
  defaultName?: string,
  toolkitMode: ToolkitExportMode = 'bake'
): Promise<string | null> {
  const result = await dialog.showSaveDialog(win, {
    filters: [{ name: 'Reaper Project', extensions: ['rpp'] }],
    defaultPath: `${defaultName ?? 'sssketch-export'}.rpp`
  })
  if (result.canceled || !result.filePath) return null

  const outputDir = dirname(result.filePath)
  const projectName = basename(result.filePath, '.rpp')
  await buildAndWriteRppProject(state, outputDir, projectName, toolkitMode)
  await shell.openPath(outputDir)
  return result.filePath
}
