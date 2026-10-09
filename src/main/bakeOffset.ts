import { access, mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import type { FileHandle } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import { blendRotatedWavSeam, rotateWavFrames } from '@shared/rotateWav'
import { LOOP_SEW_WINDOW_FRAMES } from '@shared/loopSewPCM16'
import { findWavChunks } from '@shared/wavChunks'
import { readWavDurationSeconds } from '@shared/wavDuration'
import { spawnEngine } from './engineProcess'
import { EngineClient } from './engineClient'
import { resolveRecipe, type ResolvedRecipe } from './reonedRecipe'
import { noteIssuedCopy, withReonedCopiesLock } from './reonedCopiesSession'

export interface BakeJob {
  /** The stem's current file. Results come back keyed by it (APPLY_BAKE matches on it). */
  path: string
  /** Where the true downbeat sits within this file's own audio, in seconds. What the baker
   * renders when there is no `recipe`, or when the recipe's original can't be read. */
  rotationSec: number
  /** Bake from the stem's original by its total rotation instead (src/shared/reonedRotation.ts's
   * reoneJob), so the copy is named, reused and rebuilt by its recipe. Absent when `path` is
   * the original. When the original is away (an unplugged LORE drive) the bake falls back to
   * rotating `path` by `rotationSec`, still recipe-named from the file it was really made from. */
  recipe?: { sourcePath: string; rotationSec: number }
  /** No fallback: when the recipe's original can't be read, the job fails. A rebuild
   * (reonedRebuild.ts) sets it, because its `path` is the missing copy, and rotating that by 0
   * under a new name if it reappeared would repoint the project for nothing. */
  recipeOnly?: boolean
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

/** One job, planned: the copy it maps to, by recipe (src/main/reonedRecipe.ts), so the same
 * original rotated by the same amount always lands on one file. A copy is still never mutated
 * once published: a different rotation is a different name. */
interface PlannedJob {
  job: BakeJob
  /** What is actually rendered: the original by the total rotation, or (fallback) the job's own
   * file by this step's rotation. */
  recipe: ResolvedRecipe
  finalPath: string
  /** Unique per call, so two bakes of one recipe never share a temporary. */
  temporaryPath: string
  /** Set when a whole copy is already there: reused, never rendered. */
  reusedDurationSec: number | null
  /** A file was at `finalPath` before this call (whole or not). Never deleted here, even if
   * this call renders over it and the batch then fails. */
  existedBefore: boolean
}

async function planJob(job: BakeJob, dir: string): Promise<PlannedJob> {
  let recipe: ResolvedRecipe
  if (job.recipe) {
    try {
      recipe = await resolveRecipe(job.recipe.sourcePath, job.recipe.rotationSec)
    } catch (err) {
      if (job.recipeOnly) throw err
      // The original is away (an unplugged LORE drive): today's chain from the current
      // file, still recipe-named, from what it was really made from.
      recipe = await resolveRecipe(job.path, job.rotationSec)
    }
  } else {
    recipe = await resolveRecipe(job.path, job.rotationSec)
  }
  const finalPath = join(dir, recipe.name)
  return {
    job,
    recipe,
    finalPath,
    temporaryPath: join(dir, `.${recipe.name}.${randomUUID()}.baking.wav`),
    reusedDurationSec: await existingCopyDuration(finalPath),
    existedBefore: await exists(finalPath)
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

/** One turn of the event loop. Between stems, so a riff's renders and publishes (0.5-2.5 s on a
 * USB library) never block the main thread in one piece (AGENTS.md section 6). */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

/** The duration of a whole copy at `path`, or null when there is none to reuse. A copy is only
 * ever published by rename after a full, synced write, so one that is there is normally whole.
 * Reads the header only. A header that won't parse, or a data chunk that runs past the end of
 * the file (cut short), counts as absent, and the copy is rendered over. */
async function existingCopyDuration(path: string): Promise<number | null> {
  let handle: FileHandle
  try {
    handle = await open(path, 'r')
  } catch {
    return null
  }
  try {
    const fileSize = (await handle.stat()).size
    const header = Buffer.alloc(Math.min(fileSize, 4096))
    const { bytesRead } = await handle.read(header, 0, header.length, 0)
    const bytes = new Uint8Array(header.buffer, header.byteOffset, bytesRead)
    const { dataOffset, sampleRate, numChannels, bitsPerSample } = findWavChunks(bytes)
    const bytesPerSecond = sampleRate * numChannels * (bitsPerSample / 8)
    if (dataOffset < 8 || !bytesPerSecond) return null
    const declaredDataBytes = header.readUInt32LE(dataOffset - 4)
    if (dataOffset + declaredDataBytes > fileSize) return null
    return declaredDataBytes / bytesPerSecond
  } catch {
    return null
  } finally {
    await handle.close()
  }
}

/** Flushes a rendered temporary to the disk before it is renamed into place, so a published
 * copy is whole even after a power cut (the reuse check trusts a published copy). */
async function syncToDisk(path: string): Promise<void> {
  const handle = await open(path, 'r+')
  try {
    await handle.sync()
  } finally {
    await handle.close()
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
// original: every copy this baker publishes ends in .baked.wav, so a source
// that does IS an already-baked file. (A user who imports their own file
// literally named "anything.baked.wav" gets a first bake with no blend. That
// is the whole cost.)
//
// Since copies are named by recipe, a re-one of an already re-oned stem
// normally bakes from the ORIGINAL by the total rotation (BakeJob.recipe), so
// it is a first bake with its one blend. A re-bake of a copy only happens when
// the original is away, and then the rule above applies unchanged.

/** Renders `recipe.sourcePath` rotated by `recipe.rotationSec` into `temporaryPath`, and returns
 * the rendered file's measured duration, or null on failure. */
async function bakeWavJob(recipe: ResolvedRecipe, temporaryPath: string): Promise<number | null> {
  try {
    const bytes = new Uint8Array(await readFile(recipe.sourcePath))
    const { sampleRate } = findWavChunks(bytes)
    if (!sampleRate) {
      console.error(`bakeOffset: "${recipe.sourcePath}" has no usable fmt chunk, skipping`)
      return null
    }
    const rotationFrames = Math.round(recipe.rotationSec * sampleRate)
    const isRebake = isPreviouslyBaked(recipe.sourcePath)
    const rotated = rotateWavFrames(bytes, rotationFrames, {
      seamBlendFrames: isRebake ? 0 : LOOP_SEW_WINDOW_FRAMES
    })
    await writeFile(temporaryPath, rotated)
    return readWavDurationSeconds(rotated)
  } catch (err) {
    console.error(`bakeOffset: failed to bake "${recipe.sourcePath}":`, err)
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
 * instead, because the output path ends in .wav. A failure here fails the job:
 * the copy's recipe name promises the blend, and a published copy is reused
 * from then on, so an unblended one would never be replaced. */
async function blendNativeBakeSeam(outputPath: string, rotationSec: number): Promise<boolean> {
  try {
    const baked = new Uint8Array(await readFile(outputPath))
    const { sampleRate } = findWavChunks(baked)
    if (!sampleRate) throw new Error('no usable fmt chunk')
    await writeFile(outputPath, blendRotatedWavSeam(baked, Math.round(rotationSec * sampleRate)))
    return true
  } catch (err) {
    console.error(`bakeOffset: could not blend the seam in "${outputPath}":`, err)
    return false
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
  renders: { recipe: ResolvedRecipe; temporaryPath: string }[]
): Promise<Map<string, number>> {
  const durations = new Map<string, number>()
  if (renders.length === 0) return durations
  const engineHandle = await spawnEngine()
  const client = new EngineClient()
  try {
    await client.connect(engineHandle.port)
    for (const { recipe, temporaryPath } of renders) {
      const outputPath = temporaryPath
      try {
        const result = (await client.sendAndAwaitType(
          'bake-stem',
          { path: recipe.sourcePath, rotationSec: recipe.rotationSec, outputPath },
          'bake-stem-result'
        )) as { success: boolean; durationSec?: number; error?: string }
        if (!result.success || result.durationSec === undefined) {
          console.error(
            `bakeOffset: native bake failed for "${recipe.sourcePath}": ${result.error}`
          )
          continue
        }
        if (
          !isPreviouslyBaked(recipe.sourcePath) &&
          !(await blendNativeBakeSeam(outputPath, recipe.rotationSec))
        ) {
          continue
        }
        durations.set(recipe.name, result.durationSec)
      } catch (err) {
        console.error(`bakeOffset: native bake failed for "${recipe.sourcePath}":`, err)
      }
    }
  } finally {
    client.disconnect()
    engineHandle.stop()
  }
  return durations
}

export interface BakeOptions {
  /** May the library root (`outputDir`'s parent) be created when it is not there? Only for the
   * default root, which a fresh install hasn't made until its first save. A custom root that
   * is missing is an unplugged drive or a moved folder: the bake fails rather than make a
   * stray, empty library there (decision D17). No effect without `outputDir`. */
  mayCreateRoot?: boolean
}

/** Why a batch produced nothing. `source-unreadable`: an original (or, without a recipe, the
 * job's own file) can't be read, or the library folder is away; it can work once that is back.
 * `render-failed`: everything was readable and a render or a publish failed. */
export type BakeFailure = 'source-unreadable' | 'render-failed'

export type BakeOutcome = { ok: true; results: BakeResult[] } | { ok: false; reason: BakeFailure }

/** Bakes one riff's jobs as one all-or-nothing batch, under the `.bakes` lock
 * (reonedCopiesSession.ts), so no cleanup can delete a copy between this finding it and handing
 * it out. Results come back one per job, in job order, keyed by each job's own `path`; a failed
 * batch gives none. */
export async function bakeOffset(
  jobs: BakeJob[],
  outputDir?: string,
  options: BakeOptions = {}
): Promise<BakeResult[]> {
  const outcome = await bakeOffsetDetailed(jobs, outputDir, options)
  return outcome.ok ? outcome.results : []
}

/** bakeOffset, saying why a batch failed: a rebuild retries only what may work later. */
export async function bakeOffsetDetailed(
  jobs: BakeJob[],
  outputDir?: string,
  options: BakeOptions = {}
): Promise<BakeOutcome> {
  if (jobs.length === 0) return { ok: true, results: [] }
  return withReonedCopiesLock(() => bakeOffsetLocked(jobs, outputDir, options))
}

async function bakeOffsetLocked(
  jobs: BakeJob[],
  outputDir: string | undefined,
  options: BakeOptions
): Promise<BakeOutcome> {
  const durableDir = outputDir ?? join(dirname(jobs[0].path), '.sssketch-bakes')
  // Only what this call wrote. A failure removes these and nothing else: a copy that was there
  // before (reused, or shared with other projects) is never deleted here.
  const temporaries: string[] = []
  const published: string[] = []
  let committed = false
  const failed = (reason: BakeFailure): BakeOutcome => ({ ok: false, reason })
  try {
    if (outputDir !== undefined && !options.mayCreateRoot && !(await exists(dirname(outputDir)))) {
      console.error(`bakeOffset: the library folder ${dirname(outputDir)} is not there; not baking`)
      return failed('source-unreadable')
    }
    // Inside the try: a folder that can't be made is a failed bake like any other, returned as
    // no result, not a throw the renderer's callers would have to catch.
    try {
      await mkdir(durableDir, { recursive: true })
    } catch (err) {
      console.error(`bakeOffset: could not make ${durableDir}:`, err)
      return failed('render-failed')
    }

    let planned: PlannedJob[]
    try {
      planned = await Promise.all(jobs.map((job) => planJob(job, durableDir)))
    } catch (err) {
      // Neither the original nor the job's own file is readable.
      console.error('bakeOffset: a source could not be read:', err)
      return failed('source-unreadable')
    }

    // One render per distinct recipe that isn't already on disk.
    const renders = new Map<string, PlannedJob>()
    for (const entry of planned) {
      if (entry.reusedDurationSec === null && !renders.has(entry.recipe.name)) {
        renders.set(entry.recipe.name, entry)
      }
    }
    const rendered = new Map<string, number>()
    for (const entry of renders.values()) {
      if (!isWavPath(entry.recipe.sourcePath)) continue
      await yieldToEventLoop()
      temporaries.push(entry.temporaryPath)
      const durationSec = await bakeWavJob(entry.recipe, entry.temporaryPath)
      if (durationSec !== null) rendered.set(entry.recipe.name, durationSec)
    }
    const native = [...renders.values()].filter((entry) => !isWavPath(entry.recipe.sourcePath))
    // A WAV that failed already fails the batch: don't spawn an engine for the rest.
    if (rendered.size !== renders.size - native.length) return failed('render-failed')
    temporaries.push(...native.map((entry) => entry.temporaryPath))
    for (const [name, durationSec] of await bakeNativeJobs(native)) rendered.set(name, durationSec)

    // A group correction is indivisible. Publishing a subset would leave
    // the successful stems physically rotated while the failed stems still
    // depend on runtime state, the exact mixed representation that caused
    // stems within one riff to drift out of phase.
    if (rendered.size !== renders.size) return failed('render-failed')

    for (const entry of renders.values()) {
      await yieldToEventLoop()
      await syncToDisk(entry.temporaryPath)
      await rename(entry.temporaryPath, entry.finalPath)
      // A file that was already there (unreadable, so rendered over) isn't this call's to
      // delete: same recipe, same bytes, and another project may name it.
      if (!entry.existedBefore) published.push(entry.finalPath)
    }
    const results = planned.map((entry) => ({
      path: entry.job.path,
      bakedPath: entry.finalPath,
      durationSec: entry.reusedDurationSec ?? rendered.get(entry.recipe.name)!
    }))
    for (const result of results) noteIssuedCopy(result.bakedPath)
    committed = true
    return { ok: true, results }
  } catch (err) {
    console.error('bakeOffset: atomic bake failed:', err)
    return failed('render-failed')
  } finally {
    // On success the temporaries were renamed and no longer exist. On any failure, remove
    // this call's unpublished temporaries and any finals it published before a later rename
    // failed; no renderer state can reference them because this call returns no partial result.
    // Still under the lock: nothing can reuse a final between its publish and this delete.
    if (!committed) {
      for (const path of [...temporaries, ...published]) {
        try {
          await unlink(path)
        } catch (err) {
          if ((err as { code?: string }).code !== 'ENOENT') {
            console.error(`bakeOffset: could not remove uncommitted "${path}":`, err)
          }
        }
      }
    }
  }
}
