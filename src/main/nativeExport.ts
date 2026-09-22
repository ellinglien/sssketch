import { readFileSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, basename } from 'node:path'
import { randomUUID } from 'node:crypto'
import { BrowserWindow, dialog, shell } from 'electron'
import type { AppState } from '../renderer/src/state/store'
import { buildEngineProject } from '@shared/buildEngineProject'
import { stemKey, type BusId } from '@shared/types'
import { packIntoTracks } from '@shared/packIntoTracks'
import { resolveStretchedForExport } from './resolveStretchedForExport'
import { spawnEngine } from './engineProcess'
import { EngineClient } from './engineClient'
import { loadCatalog } from './pluginCatalog'
import { sketchStemsDir } from './projectLibrary'
import { buildPluginStatesMap, type RawPluginStatesCapture } from '@shared/pluginStates'

// Anything outside this set is unsafe (or at least unwelcome) in a filename
// across macOS/Windows/Linux -- matches exportAudioMaterialization.ts's own
// sanitizeFileNamePart exactly (duplicated rather than imported: it's not
// exported from that module, and it's a five-line pure function -- not worth
// coupling these two independent export features over). Needed here only by
// renderStemTracksToDir, since its filenames embed the free-text project
// name; the bus-mixdown renderStemsToDir below never did, because BusId
// values are already safe fixed identifiers.
function sanitizeFileNamePart(name: string): string {
  return name.replace(/[/\\:*?"<>|]/g, '_').trim() || 'stem'
}

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
//
// Risers count towards the end, exactly as they do over there -- and for a
// sharper reason here. This number is the render's own DURATION: a riser
// parked past the last clip (the likeliest place to put one, right before a
// drop that hasn't been arranged yet) used to be cut off mid-sweep in every
// exported mixdown and stems file, while playing in full during playback,
// because the render simply stopped before it. Found by re-reading this
// against selectors.ts while building the toolkit's export step, not by ear.
export function loopLengthBarsFor(state: AppState): number {
  const DEFAULT_LOOP_BARS = 32
  const ends: number[] = []
  for (const rifff of Object.values(state.rifffs)) {
    if (rifff.startBar === undefined) continue
    const playedBars = state.playedBars[rifff.groupId] ?? rifff.barLength
    ends.push(rifff.startBar + playedBars)
  }
  for (const riser of Object.values(state.risers ?? {})) {
    ends.push(riser.startBar + riser.lengthBars)
  }
  return ends.length === 0 ? DEFAULT_LOOP_BARS : Math.max(...ends)
}

/**
 * The same project with no risers in it at all.
 *
 * Needed by every render that isolates PART of the arrangement, because
 * soloState's muting reaches stems only: a riser is a source with no stem
 * behind it (spec section 2d), so it went on sounding in every isolated
 * render. Concretely, before this, each of the five per-bus stems files
 * carried a full copy of every riser, and re-summing those files in another
 * DAW stacked each riser five times over -- a real bug, found by reading
 * buildEngineProject's unconditional `risers:` against soloState rather than
 * by listening.
 */
export function withoutRisers(state: AppState): AppState {
  return { ...state, risers: {} }
}

/** The risers ALONE: every stem muted, the master chain zeroed (same
 * reasoning as soloState's own), the risers left as they are. Risers get one
 * file of their own rather than being folded into a bus, because they belong
 * to no bus -- a riser sits on an arranger channel and has no stem, so there
 * is no bus assignment to read (state.busOf is keyed by stemKey). One
 * `risers.wav` beside the bus files is the honest shape: re-summing every
 * exported file still reconstructs the mix exactly once. */
export function riserOnlyState(state: AppState, allKeys: string[]): AppState {
  return soloState(state, new Set(), allKeys)
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
export async function nativeExport(
  state: AppState,
  rawPluginStates: RawPluginStatesCapture | null
): Promise<Uint8Array> {
  const pluginStates =
    rawPluginStates !== null
      ? buildPluginStatesMap(rawPluginStates, state.masterChain, state.channelPlugins)
      : {}
  const project = await buildEngineProject(
    state,
    resolveStretchedForExport,
    loadCatalog(),
    pluginStates
  )
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
 * Renders one mixed-down WAV per bus that has at least one placed stem on
 * it — i.e. "export the tidied tracks", the same shape as soloing each bus
 * in Ableton and exporting that selection, not a file per individual stem.
 * Every stem assigned to a bus (via state.busOf, falling back to
 * DEFAULT_STEMS_BUS) is soloed together for that bus's render — reuses
 * soloState's existing multi-target support (see its own "a bus solo, not
 * just a single stem" doc comment), so within-bus balance (relative volume/
 * fades/placement) is preserved exactly as tidied, just isolated from every
 * OTHER bus for this one file. A bus with nothing assigned to it produces
 * no file at all, rather than an empty/silent one. Named directly
 * `<busId>.wav` in destDir -- BusId's own values are already safe, fixed,
 * lowercase identifiers, so no sanitization or disambiguation is needed the
 * way per-stem filenames used to require.
 *
 * Reuses the same engine process and render-export command as nativeExport,
 * just called once per bus instead of once for the whole mixdown. Writes
 * each bus's WAV STRAIGHT to its final path inside destDir — never reads
 * the rendered bytes back into the main process, let alone across IPC (see
 * git history for why: an earlier per-stem design that round-tripped bytes
 * through IPC reproducibly crashed Electron on a large project). Returns
 * the filenames actually written, in bus order (BUS_ORDER, not discovery
 * order).
 */
const DEFAULT_STEMS_BUS: BusId = 'aux'
const BUS_ORDER: BusId[] = ['drums', 'bass', 'lead', 'backing', 'aux']

/** One placed (rifff, stem) pair assigned to a bus, with its occupied time
 * span (in bars) -- the span ignores leftCrop (which only trims audio from
 * within, never extends beyond the rifff's own placed bounds), so this is a
 * safe, slightly-conservative approximation of buildAlsXml.ts's own
 * beat-accurate packIntoTracks input, not a byte-identical replica (same
 * "wire format twin" spirit as buildRppProject.ts). Good enough for both of
 * this file's own uses: grouping by bus (span unused) and, in
 * renderStemTracksToDir, deciding which same-bus stems may safely share one
 * rendered track. */
type StemEntry = { key: string; startBar: number; endBar: number }

function stemEntriesByBus(state: AppState): Map<BusId, StemEntry[]> {
  const placed = Object.values(state.rifffs).filter((r) => r.startBar !== undefined)
  const byBus = new Map<BusId, StemEntry[]>()
  for (const busId of BUS_ORDER) byBus.set(busId, [])

  for (const rifff of placed) {
    const playedBars = state.playedBars[rifff.groupId] ?? rifff.barLength
    const startBar = rifff.startBar!
    const endBar = startBar + playedBars
    for (const stem of rifff.stems) {
      const key = stemKey(rifff.groupId, stem.slot)
      const busId = state.busOf[key] ?? DEFAULT_STEMS_BUS
      byBus.get(busId)!.push({ key, startBar, endBar })
    }
  }

  return byBus
}

export async function renderStemsToDir(
  state: AppState,
  destDir: string,
  rawPluginStates: RawPluginStatesCapture | null = null
): Promise<string[]> {
  assertHasPlacedRifffs(state)
  const keysByBus = stemEntriesByBus(state)
  const allKeys = [...keysByBus.values()].flat().map((e) => e.key)
  const durationBars = loopLengthBarsFor(state)
  const engineHandle = await spawnEngine()
  const client = new EngineClient()
  const fileNames: string[] = []
  const pluginCatalog = loadCatalog()
  // soloState below always zeroes masterChain (a solo render never goes
  // through the master chain, see soloState's own doc comment), so only
  // channelPlugins entries in pluginStates can ever actually apply here --
  // still built from the full, un-soloed `state` so channel insert plugin
  // identity/state lookups aren't affected by which bus is being isolated.
  const pluginStates =
    rawPluginStates !== null
      ? buildPluginStatesMap(rawPluginStates, state.masterChain, state.channelPlugins)
      : {}

  try {
    await client.connect(engineHandle.port)

    for (const busId of BUS_ORDER) {
      const busEntries = keysByBus.get(busId)!
      if (busEntries.length === 0) continue
      const busKeys = busEntries.map((e) => e.key)

      const busState = withoutRisers(soloState(state, new Set(busKeys), allKeys))
      const project = await buildEngineProject(
        busState,
        resolveStretchedForExport,
        pluginCatalog,
        pluginStates
      )
      const fileName = `${busId}.wav`
      const outputPath = join(destDir, fileName)

      client.send('load-project', project)
      const result = (await client.sendAndAwaitType(
        'render-export',
        { outputPath, durationBars },
        'render-export-result',
        RENDER_EXPORT_TIMEOUT_MS
      )) as { success: boolean; error?: string }

      if (!result.success) {
        throw new Error(
          `native export failed for bus "${busId}": ${result.error ?? 'unknown error'}`
        )
      }

      fileNames.push(fileName)
    }

    const riserFileName = await renderRisersIfAny(client, state, allKeys, destDir, 'risers.wav')
    if (riserFileName) fileNames.push(riserFileName)

    return fileNames
  } finally {
    client.disconnect()
    engineHandle.stop()
  }
}

/**
 * Renders every placed riser into ONE file of its own beside the bus/track
 * files, or does nothing (returning undefined) when the project has no
 * risers -- see riserOnlyState for why risers get their own file rather than
 * landing in a bus. Takes an already-connected client, so it costs nothing
 * more than one extra render on a project that has risers and literally
 * nothing on one that doesn't.
 */
async function renderRisersIfAny(
  client: EngineClient,
  state: AppState,
  allKeys: string[],
  destDir: string,
  fileName: string
): Promise<string | undefined> {
  if (Object.keys(state.risers ?? {}).length === 0) return undefined
  const project = await buildEngineProject(
    riserOnlyState(state, allKeys),
    resolveStretchedForExport,
    loadCatalog()
  )
  client.send('load-project', project)
  const result = (await client.sendAndAwaitType(
    'render-export',
    { outputPath: join(destDir, fileName), durationBars: loopLengthBarsFor(state) },
    'render-export-result',
    RENDER_EXPORT_TIMEOUT_MS
  )) as { success: boolean; error?: string }
  if (!result.success) {
    throw new Error(`native export failed for risers: ${result.error ?? 'unknown error'}`)
  }
  return fileName
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
  state: AppState,
  rawPluginStates: RawPluginStatesCapture | null = null
): Promise<string | null> {
  const result = await dialog.showOpenDialog(win, {
    properties: ['openDirectory', 'createDirectory'],
    title: 'Choose a folder for the exported stems'
  })
  if (result.canceled || result.filePaths.length === 0) return null

  const dir = result.filePaths[0]
  await renderStemsToDir(state, dir, rawPluginStates)
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
export async function exportStemsToLibrary(
  state: AppState,
  libraryName: string,
  rawPluginStates: RawPluginStatesCapture | null = null
): Promise<void> {
  assertHasPlacedRifffs(state) // before the rmSync below -- see its own comment
  const stemsDir = sketchStemsDir(libraryName)
  rmSync(stemsDir, { recursive: true, force: true })
  mkdirSync(stemsDir, { recursive: true })
  await renderStemsToDir(state, stemsDir, rawPluginStates)
  await shell.openPath(stemsDir)
}

/**
 * Same no-dialog, always-in-a-Stems-subfolder export as
 * exportStemsToLibrary above, for a sketch with a known external file
 * location but not in the library.
 */
export async function exportStemsNextToSource(
  state: AppState,
  sourcePath: string,
  rawPluginStates: RawPluginStatesCapture | null = null
): Promise<void> {
  assertHasPlacedRifffs(state) // before the rmSync below -- see its own comment
  const stemsDir = join(dirname(sourcePath), 'Stems')
  rmSync(stemsDir, { recursive: true, force: true })
  mkdirSync(stemsDir, { recursive: true })
  await renderStemsToDir(state, stemsDir, rawPluginStates)
  await shell.openPath(stemsDir)
}

/**
 * Renders one WAV per physical TRACK within each bus, not one per bus --
 * "as if you'd exported the tidied Ableton project and rendered each track
 * individually", for a user who wants to adjust individual layers rather
 * than accept a frozen bus mixdown. Each bus's stems are partitioned into
 * the same minimum-track-count grouping buildAlsXml.ts's own Ableton export
 * already uses (see packIntoTracks): stems that don't overlap in time can
 * share one physical track/file, stems that DO overlap are forced onto
 * separate ones. Every stem on a given track is soloed together for that
 * track's render, same multi-target soloState reuse as renderStemsToDir.
 * Named `<projectName> - <busId> <n>.wav`, always numbered (even a bus with
 * only one track) so the number consistently means "track index within this
 * bus" regardless of how many tracks a given bus actually needed -- flat in
 * destDir, no subfolders, same as renderStemsToDir, so these still drag
 * straight into another DAW in one motion.
 */
export async function renderStemTracksToDir(
  state: AppState,
  destDir: string,
  projectName: string,
  rawPluginStates: RawPluginStatesCapture | null = null
): Promise<string[]> {
  assertHasPlacedRifffs(state)
  const entriesByBus = stemEntriesByBus(state)
  const allKeys = [...entriesByBus.values()].flat().map((e) => e.key)
  const sanitizedProjectName = sanitizeFileNamePart(projectName)
  const durationBars = loopLengthBarsFor(state)
  const engineHandle = await spawnEngine()
  const client = new EngineClient()
  const fileNames: string[] = []
  const pluginCatalog = loadCatalog()
  // Same soloState-zeroes-masterChain reasoning as renderStemsToDir above --
  // only channelPlugins entries in pluginStates can ever actually apply.
  const pluginStates =
    rawPluginStates !== null
      ? buildPluginStatesMap(rawPluginStates, state.masterChain, state.channelPlugins)
      : {}

  try {
    await client.connect(engineHandle.port)

    for (const busId of BUS_ORDER) {
      const busEntries = entriesByBus.get(busId)!
      if (busEntries.length === 0) continue

      const packed = packIntoTracks(
        busEntries,
        (e) => e.startBar,
        (e) => e.endBar
      )
      for (let i = 0; i < packed.length; i++) {
        const trackKeys = new Set(packed[i].map((e) => e.key))
        const trackState = withoutRisers(soloState(state, trackKeys, allKeys))
        const project = await buildEngineProject(
          trackState,
          resolveStretchedForExport,
          pluginCatalog,
          pluginStates
        )
        const fileName = `${sanitizedProjectName} - ${busId} ${i + 1}.wav`
        const outputPath = join(destDir, fileName)

        client.send('load-project', project)
        const result = (await client.sendAndAwaitType(
          'render-export',
          { outputPath, durationBars },
          'render-export-result',
          RENDER_EXPORT_TIMEOUT_MS
        )) as { success: boolean; error?: string }

        if (!result.success) {
          throw new Error(
            `native export failed for bus "${busId}" track ${i + 1}: ${result.error ?? 'unknown error'}`
          )
        }

        fileNames.push(fileName)
      }
    }

    const riserFileName = await renderRisersIfAny(
      client,
      state,
      allKeys,
      destDir,
      `${sanitizedProjectName} - risers.wav`
    )
    if (riserFileName) fileNames.push(riserFileName)

    return fileNames
  } finally {
    client.disconnect()
    engineHandle.stop()
  }
}

/** Mirrors nativeExportStemsToDisk above, for the per-track variant. */
export async function nativeExportStemTracksToDisk(
  win: BrowserWindow,
  state: AppState,
  projectName: string,
  rawPluginStates: RawPluginStatesCapture | null = null
): Promise<string | null> {
  const result = await dialog.showOpenDialog(win, {
    properties: ['openDirectory', 'createDirectory'],
    title: 'Choose a folder for the exported stem tracks'
  })
  if (result.canceled || result.filePaths.length === 0) return null

  const dir = result.filePaths[0]
  await renderStemTracksToDir(state, dir, projectName, rawPluginStates)
  await shell.openPath(dir)
  return dir
}

/** Mirrors exportStemsToLibrary above, for the per-track variant -- shares
 * the same Stems/ folder (each export type fully replaces whatever was
 * there before, same as re-running exportStemsToLibrary itself does). */
export async function exportStemTracksToLibrary(
  state: AppState,
  libraryName: string,
  rawPluginStates: RawPluginStatesCapture | null = null
): Promise<void> {
  assertHasPlacedRifffs(state) // before the rmSync below -- see its own comment
  const stemsDir = sketchStemsDir(libraryName)
  rmSync(stemsDir, { recursive: true, force: true })
  mkdirSync(stemsDir, { recursive: true })
  await renderStemTracksToDir(state, stemsDir, libraryName, rawPluginStates)
  await shell.openPath(stemsDir)
}

/** Mirrors exportStemsNextToSource above, for the per-track variant. The
 * project name comes from the source file's own basename -- there's no
 * separate "sketch name" for an externally-located sketch, this is what's
 * shown for it everywhere else in the app (see App.tsx's
 * basenameWithoutProjectExt). */
export async function exportStemTracksNextToSource(
  state: AppState,
  sourcePath: string,
  rawPluginStates: RawPluginStatesCapture | null = null
): Promise<void> {
  assertHasPlacedRifffs(state) // before the rmSync below -- see its own comment
  const stemsDir = join(dirname(sourcePath), 'Stems')
  rmSync(stemsDir, { recursive: true, force: true })
  mkdirSync(stemsDir, { recursive: true })
  const projectName = basename(sourcePath).replace(/\.sssketchproj$/i, '')
  await renderStemTracksToDir(state, stemsDir, projectName, rawPluginStates)
  await shell.openPath(stemsDir)
}
