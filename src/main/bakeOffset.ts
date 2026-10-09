import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'fs'
import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
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

interface BakeDestination {
  temporaryPath: string
  finalPath: string
}

/** One immutable destination per job. A batch publishes none of these
 * until every stem has baked successfully; UUIDs keep a re-one from ever
 * mutating audio referenced by an older shelf riff or saved project. */
function allocateDestination(outputDir: string): BakeDestination {
  const id = randomUUID()
  return {
    temporaryPath: join(outputDir, `.${id}.baking.wav`),
    // Keep the explicit suffix as durable provenance: a later re-bake must
    // not apply the first-bake seam blend again.
    finalPath: join(outputDir, `${id}.baked.wav`)
  }
}

function isPreviouslyBaked(path: string): boolean {
  return path.toLowerCase().endsWith('.baked.wav')
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
interface PendingBakeResult extends BakeResult {
  temporaryPath: string
}

function bakeWavJob(job: BakeJob, destination: BakeDestination): PendingBakeResult | null {
  try {
    const bytes = new Uint8Array(readFileSync(job.path))
    const { sampleRate } = findWavChunks(bytes)
    if (!sampleRate) {
      console.error(`bakeOffset: "${job.path}" has no usable fmt chunk, skipping`)
      return null
    }
    const rotationFrames = Math.round(job.rotationSec * sampleRate)
    const isRebake = isPreviouslyBaked(job.path)
    const rotated = rotateWavFrames(bytes, rotationFrames, {
      seamBlendFrames: isRebake ? 0 : LOOP_SEW_WINDOW_FRAMES
    })
    writeFileSync(destination.temporaryPath, rotated)
    return {
      path: job.path,
      bakedPath: destination.finalPath,
      temporaryPath: destination.temporaryPath,
      durationSec: readWavDurationSeconds(rotated)
    }
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
async function bakeNativeJobs(
  jobs: { job: BakeJob; destination: BakeDestination }[]
): Promise<PendingBakeResult[]> {
  if (jobs.length === 0) return []
  const results: PendingBakeResult[] = []
  const engineHandle = await spawnEngine()
  const client = new EngineClient()
  try {
    await client.connect(engineHandle.port)
    for (const { job, destination } of jobs) {
      const outputPath = destination.temporaryPath
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
        if (!isPreviouslyBaked(job.path)) blendNativeBakeSeam(outputPath, job.rotationSec)
        results.push({
          path: job.path,
          bakedPath: destination.finalPath,
          temporaryPath: destination.temporaryPath,
          durationSec: result.durationSec
        })
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

export async function bakeOffset(jobs: BakeJob[], outputDir?: string): Promise<BakeResult[]> {
  if (jobs.length === 0) return []
  const durableDir = outputDir ?? join(dirname(jobs[0].path), '.sssketch-bakes')
  const planned = jobs.map((job) => ({ job, destination: allocateDestination(durableDir) }))
  const pending: PendingBakeResult[] = []
  try {
    // Inside the try: a folder that can't be made (the library drive
    // unplugged) is a failed bake like any other, returned as no result,
    // not a throw the renderer's callers would have to catch.
    mkdirSync(durableDir, { recursive: true })
    for (const entry of planned.filter(({ job }) => isWavPath(job.path))) {
      const result = bakeWavJob(entry.job, entry.destination)
      if (result) pending.push(result)
    }
    pending.push(...(await bakeNativeJobs(planned.filter(({ job }) => !isWavPath(job.path)))))

    // A group correction is indivisible. Publishing a subset would leave
    // the successful stems physically rotated while the failed stems still
    // depend on runtime state, the exact mixed representation that caused
    // stems within one riff to drift out of phase.
    if (pending.length !== jobs.length) return []

    for (const result of pending) renameSync(result.temporaryPath, result.bakedPath)
    return pending.map(({ path, bakedPath, durationSec }) => ({ path, bakedPath, durationSec }))
  } catch (err) {
    console.error('bakeOffset: atomic bake failed:', err)
    return []
  } finally {
    // On success the temporary names were renamed and no longer exist. On
    // any failure, remove both unpublished temps and any finals published
    // before a later rename failed; no renderer state can reference them
    // because this call returns no partial result.
    if (pending.length !== jobs.length || pending.some((r) => existsSync(r.temporaryPath))) {
      for (const { destination } of planned) {
        for (const path of [destination.temporaryPath, destination.finalPath]) {
          try {
            if (existsSync(path)) unlinkSync(path)
          } catch (err) {
            console.error(`bakeOffset: could not remove uncommitted "${path}":`, err)
          }
        }
      }
    }
  }
}
