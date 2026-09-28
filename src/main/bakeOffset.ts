import { readFileSync, writeFileSync } from 'fs'
import { blendRotatedWavSeam, rotateWavFrames } from '@shared/rotateWav'
import { LOOP_SEW_WINDOW_FRAMES } from '@shared/loopSewPCM16'
import { findWavChunks } from '@shared/wavChunks'
import { readWavDurationSeconds } from '@shared/wavDuration'
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
  /** The baked file's own real, measured duration — the caller (APPLY_BAKE)
   * must overwrite the stem's existing durationSec with this rather than
   * leaving it as-is. That existing value can be metadata-derived (a LORE
   * stem's durationSec comes from the warehouse database's BPM/Length16s
   * fields, not measured from the actual audio) and disagree with the real
   * baked file by enough to desync the native engine's own tile-boundary
   * scheduling — heard as clicking/stuttering right at tile boundaries. A
   * plain rotation (the WAV path) provably preserves the exact sample
   * count, so this is expected to already match, but it's measured here
   * too rather than assumed, for the same reason buildEngineProject.ts
   * measures a stretched render's real duration instead of trusting the
   * pre-stretch value. */
  durationSec: number
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

// WHY A RE-BAKE MUST NOT BLEND AGAIN, and why one flag is the whole answer.
//
// rotateWavFrames now lays a short equal-power blend across the seam it
// creates (see its own doc comment). Applying that on every bake would stack
// a fresh smeared patch of real audio into the file on every re-pick, which is
// cumulative and invisible until it is bad — so it has to be applied exactly
// once, at the one junction that is genuinely discontinuous.
//
// There is exactly one such junction, and only the ORIGINAL file has it. A
// rotation's seam joins the input's own last frame to its own first frame.
// For an original that pair is the loop wrap — the thing the engine's loop
// sewing exists to declick, i.e. a real discontinuity. For an already-baked
// file it is not: bake 1 rotated by r, so the baked file's last and first
// frames are source[r-1] and source[r], which were adjacent in the recording.
// The real discontinuity is still in there, already blended by bake 1, and a
// further rotation just carries it along (and if a re-pick happens to land the
// seam exactly on it, it is already smooth). So: blend on a first bake, never
// on a re-bake, and the file accumulates nothing.
//
// Deciding that needs no new state, no sidecar and no re-derivation from the
// original: bakedPathFor is already idempotent, so a path it maps to itself IS
// an already-baked file. (A user who imports their own file literally named
// "anything.baked.wav" gets a first bake with no blend. That is the whole cost.)
function bakeWavJob(job: BakeJob): BakeResult | null {
  try {
    const bytes = new Uint8Array(readFileSync(job.path))
    const { sampleRate } = findWavChunks(bytes)
    if (!sampleRate) {
      console.error(`bakeOffset: "${job.path}" has no usable fmt chunk, skipping`)
      return null
    }
    const rotationFrames = Math.round(job.rotationSec * sampleRate)
    const bakedPath = bakedPathFor(job.path)
    const isRebake = bakedPath === job.path
    const rotated = rotateWavFrames(bytes, rotationFrames, {
      seamBlendFrames: isRebake ? 0 : LOOP_SEW_WINDOW_FRAMES
    })
    writeFileSync(bakedPath, rotated)
    return { path: job.path, bakedPath, durationSec: readWavDurationSeconds(rotated) }
  } catch (err) {
    console.error(`bakeOffset: failed to bake "${job.path}":`, err)
    return null
  }
}

/** The same seam blend bakeWavJob gets, applied to the native engine's own
 * bake output after the fact. BakeStem.cpp does a bare circular shift with no
 * blend of any kind and writes a 16-bit WAV, so a LORE-sourced stem otherwise
 * keeps exactly the hard interior splice this whole change is about — and
 * fixing it there would mean a native-engine change and an engine rebuild.
 * Reading the written file back and blending it here is the same edit, in JS,
 * on bytes whose sample rate and frame count are now MEASURED rather than
 * assumed (an Ogg decode's real length need not match any metadata).
 *
 * Always a first bake: a re-bake of one of these goes through bakeWavJob
 * instead, because the output path ends in .wav. Best-effort — a failure here
 * leaves a correctly rotated, merely unblended file, which is exactly the old
 * behaviour, so it must not fail the bake. */
function blendNativeBakeSeam(outputPath: string, rotationSec: number): void {
  try {
    const baked = new Uint8Array(readFileSync(outputPath))
    const { sampleRate } = findWavChunks(baked)
    if (!sampleRate) return
    writeFileSync(outputPath, blendRotatedWavSeam(baked, Math.round(rotationSec * sampleRate)))
  } catch (err) {
    console.error(`bakeOffset: could not blend the seam in "${outputPath}":`, err)
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
        )) as { success: boolean; durationSec?: number; error?: string }
        if (!result.success || result.durationSec === undefined) {
          console.error(`bakeOffset: native bake failed for "${job.path}": ${result.error}`)
          continue
        }
        blendNativeBakeSeam(outputPath, job.rotationSec)
        results.push({ path: job.path, bakedPath: outputPath, durationSec: result.durationSec })
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
