// src/main/exportReaper.ts
import { writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join, basename, dirname } from 'node:path'
import { dialog, shell, BrowserWindow } from 'electron'
import type { AppState } from '../renderer/src/state/store'
import { buildRppProject } from './reaper/buildRppProject'
import { materializeStemsForExport } from './exportAudioMaterialization'
import { sketchReaperDir } from './projectLibrary'

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
  projectName: string
): Promise<void> {
  const { stemFileNames } = await materializeStemsForExport(state, outputDir)
  const rppText = buildRppProject(state, stemFileNames)
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
export async function exportReaperToLibrary(state: AppState, libraryName: string): Promise<void> {
  const reaperDir = sketchReaperDir(libraryName)
  mkdirSync(reaperDir, { recursive: true })
  rmSync(join(reaperDir, 'Samples', 'Imported'), { recursive: true, force: true })
  await buildAndWriteRppProject(state, reaperDir, libraryName)
  await shell.openPath(reaperDir)
}

/**
 * Same no-dialog, always-named-after-the-project export as
 * exportReaperToLibrary above, for a sketch that's real and has a known
 * file location but isn't a library sketch -- an external .sssketchproj
 * path. Mirrors exportAbletonNextToSource exactly.
 */
export async function exportReaperNextToSource(state: AppState, sourcePath: string): Promise<void> {
  const projectName = basename(sourcePath, '.sssketchproj')
  const reaperDir = join(dirname(sourcePath), 'Reaper')
  mkdirSync(reaperDir, { recursive: true })
  rmSync(join(reaperDir, 'Samples', 'Imported'), { recursive: true, force: true })
  await buildAndWriteRppProject(state, reaperDir, projectName)
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
  defaultName?: string
): Promise<string | null> {
  const result = await dialog.showSaveDialog(win, {
    filters: [{ name: 'Reaper Project', extensions: ['rpp'] }],
    defaultPath: `${defaultName ?? 'sssketch-export'}.rpp`
  })
  if (result.canceled || !result.filePath) return null

  const outputDir = dirname(result.filePath)
  const projectName = basename(result.filePath, '.rpp')
  await buildAndWriteRppProject(state, outputDir, projectName)
  await shell.openPath(outputDir)
  return result.filePath
}
