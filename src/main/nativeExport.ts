import { readFileSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { BrowserWindow, dialog, shell } from 'electron'
import type { AppState } from '../renderer/src/state/store'
import { buildEngineProject } from '@shared/buildEngineProject'
import { stemKey, type BusId } from '@shared/types'
import { resolveStretchedForExport } from './resolveStretchedForExport'
import { spawnEngine } from './engineProcess'
import { EngineClient } from './engineClient'
import { loadCatalog } from './pluginCatalog'
import { sketchStemsDir } from './projectLibrary'

// EngineClient.sendAndAwaitType's own default (30000ms) is right for the
// fast control round-trips it's normally used for (position queries, arm/
// disarm, etc.) but wrong here: render-export runs the WHOLE offline mix
// synchronously in the engine, block by block through every channel's
// plugin chain, with no progress reporting or cancellation and no cap tied
// to project size -- a real user hit "timed out waiting for
// render-export-result after 30000ms" on export, and reading
// RenderExport.cpp/PlaybackEngine::renderBlock found no obvious hang, just
// real synchronous work that scales with project length x channel count x
// plugin cost. 30s is simply too short a ceiling for that; this is
// generous enough to cover a genuinely large/complex project while still
// eventually surfacing an error if the engine really is wedged.
const RENDER_EXPORT_TIMEOUT_MS = 10 * 60 * 1000

// Mirrors src/renderer/src/state/selectors.ts's loopLengthBars (re-implemented
// here rather than imported wholesale, since that module also exports React-
// adjacent selectors that assume renderer context).
export function loopLengthBarsFor(state: AppState): number {
  const DEFAULT_LOOP_BARS = 32
  const ends: number[] = []
  for (const rifff of Object.values(state.rifffs)) {
    if (rifff.startBar === undefined) continue
    const playedBars = state.playedBars[rifff.groupId] ?? rifff.barLength
    ends.push(rifff.startBar + playedBars)
  }
  return ends.length === 0 ? DEFAULT_LOOP_BARS : Math.max(...ends)
}

/**
 * Builds the per-target solo state used to isolate one or more stems for a
 * solo render: every stem NOT in `targetKeys` muted, and the master chain
 * zeroed out. A solo render is for auditioning a stem/bus on its own, not
 * through the mix's own limiter/mastering chain -- without this, an
 * isolated stem WAV was previously rendered through the FULL master chain
 * individually, which won't sum correctly with the real mixdown (each
 * stem hits the limiter on its own, N times, instead of the limiter
 * seeing the summed mix once). See
 * docs/superpowers/specs/2026-08-05-stem-bus-clustering-design.md.
 * `allKeys` must include every stemKey that could sound in this project --
 * anything not in `targetKeys` gets muted, so an incomplete list would
 * leave an unrelated stem audible.
 */
export function soloState(state: AppState, targetKeys: Set<string>, allKeys: string[]): AppState {
  const soloMute: Record<string, boolean> = {}
  for (const key of allKeys) soloMute[key] = !targetKeys.has(key)
  return { ...state, mute: soloMute, masterChain: [null, null, null, null] }
}

/**
 * Renders the full arrangement to a WAV via the native engine — the app's only
 * mixdown/export path, running entirely in the main process (spawn engine,
 * load-project, render-export to a temp file, read it back, tear down). Live
 * playback now goes through the native engine too, via a separate persistent
 * engine process spawned at app startup (see src/main/playbackEngineLifecycle.ts)
 * — this function only handles the export path.
 */
export async function nativeExport(state: AppState): Promise<Uint8Array> {
  const project = await buildEngineProject(state, resolveStretchedForExport, loadCatalog())
  const durationBars = loopLengthBarsFor(state)

  const engineHandle = await spawnEngine()
  const client = new EngineClient()
  const tempPath = join(tmpdir(), `sssketch-export-${randomUUID()}.wav`)

  try {
    await client.connect(engineHandle.port)
    client.send('load-project', project)
    const result = (await client.sendAndAwaitType(
      'render-export',
      { outputPath: tempPath, durationBars },
      'render-export-result',
      RENDER_EXPORT_TIMEOUT_MS
    )) as { success: boolean; error?: string }

    if (!result.success) {
      throw new Error(`native export failed: ${result.error ?? 'unknown error'}`)
    }

    return readFileSync(tempPath)
  } finally {
    client.disconnect()
    engineHandle.stop()
    rmSync(tempPath, { force: true })
  }
}

// Anything outside this set is unsafe (or at least unwelcome) in a filename
// across macOS/Windows/Linux — path separators, reserved Windows characters,
// etc. Everything else (spaces, unicode names from Endlesss authors) is left
// alone.
function sanitizeFileNamePart(name: string): string {
  return name.replace(/[/\\:*?"<>|]/g, '_').trim() || 'stem'
}

// Mirrors exportAudioMaterialization.ts's materializeStemsForExport's own
// "nothing placed" guard (same message, so App.tsx's runExportProject shows
// an identical alert regardless of which export format the user picked) --
// without this, an empty/untidied-away project silently produced a
// zero-file "successful" stems export instead of failing loud like the
// Ableton/Reaper paths do. Called at the START of every entry point that
// can destructively clear a folder before rendering (exportStemsToLibrary,
// exportStemsNextToSource), not just inside renderStemsToDir itself --
// a check placed only inside renderStemsToDir would fire too late for
// those two, after their own rmSync already ran.
function assertHasPlacedRifffs(state: AppState): void {
  const anyPlaced = Object.values(state.rifffs).some((r) => r.startBar !== undefined)
  if (!anyPlaced) {
    throw new Error('Nothing to export -- no rifffs are placed on the timeline.')
  }
}

/**
 * Renders each stem across the whole arrangement to its own WAV, soloed —
 * i.e. every OTHER stem muted for that render, regardless of its current
 * mute state in `state` (the point is isolating each stem, not reproducing
 * today's mix). Reuses the same engine process and render-export command as
 * nativeExport, just called once per stem instead of once for the mixdown.
 *
 * Writes each stem STRAIGHT to its final path inside destDir — never reads
 * the rendered bytes back into the main process, let alone across IPC. This
 * replaces an earlier design that rendered every stem to a temp file, read
 * ALL of them into memory as Uint8Arrays, sent the whole batch to the
 * renderer over IPC, and then had the renderer immediately send the exact
 * same bytes straight back to main to write to disk — a completely
 * pointless double round-trip (the bytes never needed to leave the main
 * process) that reproducibly crashed Electron on a real large multi-stem
 * project: root-caused via crash report analysis to EXC_BREAKPOINT inside
 * v8::ValueSerializer::WriteValue, consistent with structured-clone
 * choking on the combined size of every stem's raw audio in one IPC
 * message. Returns the filenames actually written, in render order.
 */
const DEFAULT_STEMS_BUS: BusId = 'aux'

export async function renderStemsToDir(state: AppState, destDir: string): Promise<string[]> {
  assertHasPlacedRifffs(state)
  const placed = Object.values(state.rifffs).filter((r) => r.startBar !== undefined)
  const targets: { key: string; rifffName: string; stemName: string; busId: BusId }[] = []
  for (const rifff of placed) {
    for (const stem of rifff.stems) {
      const key = stemKey(rifff.groupId, stem.slot)
      targets.push({
        key,
        rifffName: rifff.name,
        stemName: stem.name,
        busId: state.busOf[key] ?? DEFAULT_STEMS_BUS
      })
    }
  }

  const usedNames = new Map<string, number>()
  function uniqueFileName(rifffName: string, stemName: string): string {
    const base = `${sanitizeFileNamePart(rifffName)}-${sanitizeFileNamePart(stemName)}`
    const count = (usedNames.get(base) ?? 0) + 1
    usedNames.set(base, count)
    return count === 1 ? `${base}.wav` : `${base}-${count}.wav`
  }

  const durationBars = loopLengthBarsFor(state)
  const engineHandle = await spawnEngine()
  const client = new EngineClient()
  const fileNames: string[] = []
  const pluginCatalog = loadCatalog()

  try {
    await client.connect(engineHandle.port)

    const allKeys = targets.map((t) => t.key)
    for (const target of targets) {
      const targetState = soloState(state, new Set([target.key]), allKeys)

      const project = await buildEngineProject(
        targetState,
        resolveStretchedForExport,
        pluginCatalog
      )
      const fileName = uniqueFileName(target.rifffName, target.stemName)
      const busDir = join(destDir, target.busId)
      mkdirSync(busDir, { recursive: true })
      const outputPath = join(busDir, fileName)

      client.send('load-project', project)
      const result = (await client.sendAndAwaitType(
        'render-export',
        { outputPath, durationBars },
        'render-export-result',
        RENDER_EXPORT_TIMEOUT_MS
      )) as { success: boolean; error?: string }

      if (!result.success) {
        throw new Error(
          `native export failed for stem "${target.stemName}": ${result.error ?? 'unknown error'}`
        )
      }

      fileNames.push(fileName)
    }

    return fileNames
  } finally {
    client.disconnect()
    engineHandle.stop()
  }
}

/**
 * Opens a folder picker, then renders every stem straight into it via
 * renderStemsToDir — mirrors exportMixToWav/exportStemsToWavs's own
 * cancel/failure handling (resolves null on a cancelled dialog) and opens
 * the destination in Finder on success. Asking for the destination BEFORE
 * rendering (rather than after, which the old bytes-over-IPC design did)
 * also means a cancelled dialog costs nothing — no wasted render time.
 */
export async function nativeExportStemsToDisk(
  win: BrowserWindow,
  state: AppState
): Promise<string | null> {
  const result = await dialog.showOpenDialog(win, {
    properties: ['openDirectory', 'createDirectory'],
    title: 'Choose a folder for the exported stems'
  })
  if (result.canceled || result.filePaths.length === 0) return null

  const dir = result.filePaths[0]
  await renderStemsToDir(state, dir)
  await shell.openPath(dir)
  return dir
}

/**
 * Routine, no-dialog stems export for a library-resident sketch: writes
 * bus-grouped stems straight into that sketch's own `Stems/` folder,
 * clearing it first (fully owned by this sketch, safe to clear -- same
 * reasoning as exportAbletonToLibrary/exportReaperToLibrary's own
 * Samples/Imported clearing), then opens it in Finder.
 */
export async function exportStemsToLibrary(state: AppState, libraryName: string): Promise<void> {
  assertHasPlacedRifffs(state) // before the rmSync below -- see its own comment
  const stemsDir = sketchStemsDir(libraryName)
  rmSync(stemsDir, { recursive: true, force: true })
  mkdirSync(stemsDir, { recursive: true })
  await renderStemsToDir(state, stemsDir)
  await shell.openPath(stemsDir)
}

/**
 * Same no-dialog, always-in-a-Stems-subfolder export as
 * exportStemsToLibrary above, for a sketch with a known external file
 * location but not in the library.
 */
export async function exportStemsNextToSource(state: AppState, sourcePath: string): Promise<void> {
  assertHasPlacedRifffs(state) // before the rmSync below -- see its own comment
  const stemsDir = join(dirname(sourcePath), 'Stems')
  rmSync(stemsDir, { recursive: true, force: true })
  mkdirSync(stemsDir, { recursive: true })
  await renderStemsToDir(state, stemsDir)
  await shell.openPath(stemsDir)
}
