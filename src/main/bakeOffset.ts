import { readFileSync, writeFileSync } from 'fs'
import { rotateWavFrames } from '@shared/rotateWav'
import { findWavChunks } from '@shared/wavChunks'
import { spawnEngine } from './engineProcess'
import { EngineClient } from './engineClient'

export interface BakeJob {
  path: string
  /** Where the true downbeat sits within this file's own audio, in seconds. */
  rotationSec: number
}

export interface BakeResult {
  /** The job's original path, so the renderer can map results back to stems. */
  path: string
  bakedPath: string
}

// Re-baking (picking a different beat after already baking once) rotates whatever
// is currently at `path`, which may itself already be a `.baked.wav` — write back
// to that same file rather than growing the filename further, so pristine.wav (or,
// for a LORE-sourced stem, the original warehouse file) is always left untouched
// as an implicit original/backup no matter how many times baking is repeated.
//
// LORE-cached stems have no file extension at all (see loreWarehouse.ts's
// resolveStemPath — the path is just the raw StemCID) — appending rather than
// replacing lands the baked copy right alongside the original in the SAME
// warehouse directory, same sibling convention as a regular WAV import, rather
// than needing a separate cache location elsewhere. The original file is only
// ever read, never overwritten — LORE's own sync/indexing keys off the exact
// StemCID filename, so this sibling is invisible to it either way.
function bakedPathFor(path: string): string {
  if (path.toLowerCase().endsWith('.baked.wav')) return path
  if (path.toLowerCase().endsWith('.wav')) return path.replace(/\.wav$/i, '.baked.wav')
  return `${path}.baked.wav`
}

// A hard, reliable split rather than a probe/fallback: a regular drag-and-drop
// import is always a WAV (Endlesss's own native export format), while a
// LORE-cached stem's path is the raw StemCID with no extension — the two
// never overlap.
function isWavPath(path: string): boolean {
  return path.toLowerCase().endsWith('.wav')
}

function bakeWavJob(job: BakeJob): BakeResult | null {
  try {
    const bytes = new Uint8Array(readFileSync(job.path))
    const { sampleRate } = findWavChunks(bytes)
    if (!sampleRate) {
      console.error(`bakeOffset: "${job.path}" has no usable fmt chunk, skipping`)
      return null
    }
    const rotationFrames = Math.round(job.rotationSec * sampleRate)
    const rotated = rotateWavFrames(bytes, rotationFrames)
    const bakedPath = bakedPathFor(job.path)
    writeFileSync(bakedPath, rotated)
    return { path: job.path, bakedPath }
  } catch (err) {
    console.error(`bakeOffset: failed to bake "${job.path}":`, err)
    return null
  }
}

/** Bakes every non-WAV (LORE-sourced) job through the native engine's
 * bake-stem command (native-engine/Source/BakeStem.cpp), which can actually
 * decode Ogg Vorbis — the JS-side rotateWavFrames above only understands raw
 * WAV bytes. One engine process is spawned and reused for every job in this
 * batch (typically one rifff's worth of stems, up to 8), not one per stem —
 * mirrors nativeExport.ts's own spawn-connect-act-teardown shape for a
 * one-off native operation. */
async function bakeNativeJobs(jobs: BakeJob[]): Promise<BakeResult[]> {
  if (jobs.length === 0) return []
  const results: BakeResult[] = []
  const engineHandle = await spawnEngine()
  const client = new EngineClient()
  try {
    await client.connect(engineHandle.port)
    for (const job of jobs) {
      const outputPath = bakedPathFor(job.path)
      try {
        const result = (await client.sendAndAwaitType(
          'bake-stem',
          { path: job.path, rotationSec: job.rotationSec, outputPath },
          'bake-stem-result'
        )) as { success: boolean; error?: string }
        if (!result.success) {
          console.error(`bakeOffset: native bake failed for "${job.path}": ${result.error}`)
          continue
        }
        results.push({ path: job.path, bakedPath: outputPath })
      } catch (err) {
        console.error(`bakeOffset: native bake failed for "${job.path}":`, err)
      }
    }
  } finally {
    client.disconnect()
    engineHandle.stop()
  }
  return results
}

export async function bakeOffset(jobs: BakeJob[]): Promise<BakeResult[]> {
  const wavResults = jobs
    .filter((j) => isWavPath(j.path))
    .map(bakeWavJob)
    .filter((r): r is BakeResult => r !== null)
  const nativeResults = await bakeNativeJobs(jobs.filter((j) => !isWavPath(j.path)))
  return [...wavResults, ...nativeResults]
}
