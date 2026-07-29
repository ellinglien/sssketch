import { readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { AppState } from '../renderer/src/state/store'
import { stemStartBar } from '../renderer/src/state/selectors'
import { buildEngineProject } from '@shared/buildEngineProject'
import { stemKey, type ExportedStem } from '@shared/types'
import { resolveStretchedForExport } from './resolveStretchedForExport'
import { spawnEngine } from './engineProcess'
import { EngineClient } from './engineClient'

// Mirrors src/renderer/src/state/selectors.ts's loopLengthBars (re-implemented here
// rather than imported wholesale, since that module also exports React-adjacent
// selectors that assume renderer context — but stemStartBar itself is plain
// arithmetic over AppState with no React/DOM dependency, so it's imported directly
// rather than duplicated a second time). An unlinked stem dragged out past its
// group's own span must count too, or the native render's duration would be cut
// short and truncate that stem's tail — see loopLengthBars's own comment for the
// same reasoning.
export function loopLengthBarsFor(state: AppState): number {
  const DEFAULT_LOOP_BARS = 32
  const ends: number[] = []
  for (const rifff of Object.values(state.rifffs)) {
    if (rifff.startBar === undefined) continue
    if (state.unlinked[rifff.groupId]) {
      for (const stem of rifff.stems) {
        ends.push(stemStartBar(state, rifff.groupId, stem.slot) + rifff.barLength)
      }
    } else {
      ends.push(rifff.startBar + rifff.barLength)
    }
  }
  return ends.length === 0 ? DEFAULT_LOOP_BARS : Math.max(...ends)
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
  const project = await buildEngineProject(state, resolveStretchedForExport)
  const durationBars = loopLengthBarsFor(state)

  const engineHandle = await spawnEngine()
  const client = new EngineClient()
  const tempPath = join(tmpdir(), `ssstitch-export-${randomUUID()}.wav`)

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
 */
export async function nativeExportStems(state: AppState): Promise<ExportedStem[]> {
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
  const results: ExportedStem[] = []

  try {
    await client.connect(engineHandle.port)

    for (const target of targets) {
      const soloMute: Record<string, boolean> = {}
      for (const other of targets) soloMute[other.key] = other.key !== target.key
      const soloState: AppState = { ...state, mute: soloMute }

      const project = await buildEngineProject(soloState, resolveStretchedForExport)
      const tempPath = join(tmpdir(), `ssstitch-export-${randomUUID()}.wav`)

      client.send('load-project', project)
      const result = (await client.sendAndAwaitType(
        'render-export',
        { outputPath: tempPath, durationBars },
        'render-export-result'
      )) as { success: boolean; error?: string }

      if (!result.success) {
        rmSync(tempPath, { force: true })
        throw new Error(
          `native export failed for stem "${target.stemName}": ${result.error ?? 'unknown error'}`
        )
      }

      const bytes = readFileSync(tempPath)
      rmSync(tempPath, { force: true })
      results.push({ fileName: uniqueFileName(target.rifffName, target.stemName), bytes })
    }

    return results
  } finally {
    client.disconnect()
    engineHandle.stop()
  }
}
