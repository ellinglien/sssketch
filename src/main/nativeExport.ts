import { readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { BrowserWindow, dialog, shell } from 'electron'
import type { AppState } from '../renderer/src/state/store'
import { buildEngineProject } from '@shared/buildEngineProject'
import { stemKey } from '@shared/types'
import { resolveStretchedForExport } from './resolveStretchedForExport'
import { spawnEngine } from './engineProcess'
import { EngineClient } from './engineClient'
import { loadCatalog } from './pluginCatalog'

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
      'render-export-result'
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
export async function renderStemsToDir(state: AppState, destDir: string): Promise<string[]> {
  const placed = Object.values(state.rifffs).filter((r) => r.startBar !== undefined)
  const targets: { key: string; rifffName: string; stemName: string }[] = []
  for (const rifff of placed) {
    for (const stem of rifff.stems) {
      targets.push({
        key: stemKey(rifff.groupId, stem.slot),
        rifffName: rifff.name,
        stemName: stem.name
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
      const outputPath = join(destDir, fileName)

      client.send('load-project', project)
      const result = (await client.sendAndAwaitType(
        'render-export',
        { outputPath, durationBars },
        'render-export-result'
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
