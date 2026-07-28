import { readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { AppState } from '../renderer/src/state/store'
import { buildEngineProject } from '@shared/buildEngineProject'
import { resolveStretchedForExport } from './resolveStretchedForExport'
import { spawnEngine } from './engineProcess'
import { EngineClient } from './engineClient'

// Mirrors src/renderer/src/state/selectors.ts's loopLengthBars but re-implemented
// here rather than imported, since that module is renderer-only (imports React-side
// selectors that assume renderer context) — this is the one piece of duplicated
// logic this task introduces; see a later task's retirement step for the cleanup this
// enables (once the renderer-side exportMix.ts is deleted, loopLengthBars itself
// could move to src/shared if a future task wants to de-duplicate this further).
function loopLengthBarsFor(state: AppState): number {
  const DEFAULT_LOOP_BARS = 32
  const ends: number[] = []
  for (const rifff of Object.values(state.rifffs)) {
    if (rifff.startBar === undefined) continue
    ends.push(rifff.startBar + rifff.barLength)
  }
  return ends.length === 0 ? DEFAULT_LOOP_BARS : Math.max(...ends)
}

/**
 * Renders the full arrangement via the native engine and returns the WAV bytes
 * — the native-engine equivalent of src/renderer/src/audio/exportMix.ts's
 * renderMixToWav, but running entirely in the main process (spawn engine,
 * load-project, render-export to a temp file, read it back, tear down).
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
