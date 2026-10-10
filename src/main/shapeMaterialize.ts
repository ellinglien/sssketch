import { mkdir, open, readdir, rename, rm, stat, unlink, utimes } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { stretchRatioForStem, STRETCH_RATIO_EPSILON } from '@shared/stretchRatio'
import type {
  ShapeBakeProcessRequest,
  ShapeBakeProcessResult,
  ShapeMaterializeRequest,
  ShapeMaterializeResult,
  ShapeMaterializedStem
} from '@shared/shape'
import type { ShapeClipProcessV1 } from '@shared/types'
import { pathsToEvict, renderShapeFormant, renderShapePitch } from './rubberband'
import { spawnEngine } from './engineProcess'
import { EngineClient } from './engineClient'
import { findWavChunks } from '@shared/wavChunks'

interface NativeShapeReply {
  success?: boolean
  error?: string
  durationSec?: number
  sampleRate?: number
  frames?: number
  channels?: number
}

const cancelledJobs = new Set<string>()
const materializeAbortControllers = new Map<string, AbortController>()
interface MaterializeNativeSession {
  engine: Awaited<ReturnType<typeof spawnEngine>> | null
  client: EngineClient | null
  /** Frees this session's render-engine slot (renderEngines). */
  release?: () => void
}
const materializeNativeSessions = new Map<string, MaterializeNativeSession>()
const previewRoots = new Map<string, string>()
const previewMetadata = new Map<string, ShapeMaterializedStem>()
const MAX_SHAPE_PREVIEW_CACHE_BYTES = 1024 * 1024 * 1024

function assertFinitePositive(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`invalid EEEDIT ${label}.`)
}

function inside(root: string, candidate: string): boolean {
  const resolvedRoot = resolve(root)
  const resolvedCandidate = resolve(candidate)
  return resolvedCandidate === resolvedRoot || resolvedCandidate.startsWith(`${resolvedRoot}${sep}`)
}

// Every file operation here is async: the library is often on a slow USB drive, and the main
// thread must never block on it (AGENTS.md section 6).
async function removePath(path: string): Promise<void> {
  try {
    await rm(path, { recursive: true, force: true })
  } catch (error) {
    console.error(`shapeMaterialize: failed to remove "${path}":`, error)
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

/** A job id names a staging folder: only file-name-safe characters, bounded. */
export function safeJobName(jobId: string): string {
  return jobId.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 96)
}

/** At most this many render engines at once (each is a whole engine process). */
export const MAX_SHAPE_RENDER_ENGINES = 2

/** A small FIFO semaphore: acquire() resolves with a release function once a slot is free. */
export function createSpawnLimiter(max: number): {
  acquire: () => Promise<() => void>
  active: () => number
} {
  let active = 0
  const waiting: (() => void)[] = []
  const release = (): void => {
    const next = waiting.shift()
    if (next) next()
    else active -= 1
  }
  return {
    acquire: () =>
      new Promise((resolve) => {
        let released = false
        const grant = (): void =>
          resolve(() => {
            if (released) return
            released = true
            release()
          })
        if (active < max) {
          active += 1
          grant()
        } else {
          waiting.push(grant)
        }
      }),
    active: () => active
  }
}

const renderEngines = createSpawnLimiter(MAX_SHAPE_RENDER_ENGINES)

/** A custom library root that is away (an unplugged drive) must not be recreated as a stray
 * folder on the system disk: only the default root may be created (bakeOffset's mayCreateRoot). */
async function assertLibraryReachable(durableRoot: string, mayCreateRoot: boolean): Promise<void> {
  if (mayCreateRoot) return
  if (!(await exists(dirname(durableRoot))))
    throw new Error("the project library folder isn't reachable. plug its drive back in.")
}

function throwIfCancelled(jobId: string): void {
  if (cancelledJobs.has(jobId)) throw new Error('the EEEDIT render was cancelled.')
}

function stopNativeSession(session: MaterializeNativeSession): void {
  session.client?.disconnect()
  session.client = null
  session.engine?.stop()
  session.engine = null
  session.release?.()
  session.release = undefined
}

export function shapeLanePreviewCacheKey(
  lane: ShapeMaterializeRequest['lanes'][number],
  targetBpm: number,
  loopBars: number
): string {
  const identity = JSON.stringify({
    algorithm: 'shape-lane-preview-v2',
    targetBpm,
    loopBars,
    source: {
      path: lane.source.path,
      durationSec: lane.source.durationSec,
      barLength: lane.source.barLength
    },
    segments: lane.segments
  })
  return `${createHash('sha1').update(identity).digest('hex')}.shape-preview.wav`
}

export function shapeRawSourceCacheKey(sourcePath: string, rate: number): string {
  const identity = `shape-raw-nearest-v1::${sourcePath}::${rate.toFixed(6)}`
  return `${createHash('sha1').update(identity).digest('hex')}.shape-raw.wav`
}

export function shapeProcessSourceCacheKey(
  sourcePath: string,
  process: ShapeClipProcessV1
): string {
  const identity = `shape-process-v2::${sourcePath}::${JSON.stringify(process)}`
  return `${createHash('sha1').update(identity).digest('hex')}.shape-process.wav`
}

/** Kept as a compatibility helper for existing cache-key callers/tests. */
export function shapeWavefoldSourceCacheKey(
  sourcePath: string,
  drive: number,
  mix: number
): string {
  return shapeProcessSourceCacheKey(sourcePath, { type: 'wavefold', drive, bias: 0, mix })
}

export function nativeShapeProcessPayload(process: ShapeClipProcessV1): {
  processType: ShapeClipProcessV1['type']
  primary: number
  secondary: number
  tertiary: number
  quaternary: number
  quinary: number
  mix: number
} {
  switch (process.type) {
    case 'wavefold':
      return {
        processType: process.type,
        primary: process.drive,
        secondary: process.bias,
        tertiary: 0,
        quaternary: 0,
        quinary: 0,
        mix: process.mix
      }
    case 'saturation':
      return {
        processType: process.type,
        primary: process.drive,
        secondary: process.bias,
        tertiary: process.outputDb,
        quaternary: 0,
        quinary: 0,
        mix: process.mix
      }
    case 'hard-clip':
      return {
        processType: process.type,
        primary: process.threshold,
        secondary: process.symmetry,
        tertiary: 0,
        quaternary: 0,
        quinary: 0,
        mix: process.mix
      }
    case 'rectify':
      return {
        processType: process.type,
        primary: process.mode === 'full' ? 1 : 0,
        secondary: process.drive,
        tertiary: 0,
        quaternary: 0,
        quinary: 0,
        mix: process.mix
      }
    case 'bit-crush':
      return {
        processType: process.type,
        primary: process.bits,
        secondary: process.dither,
        tertiary: 0,
        quaternary: 0,
        quinary: 0,
        mix: process.mix
      }
    case 'rate-crush':
      return {
        processType: process.type,
        primary: process.factor,
        secondary: process.jitter,
        tertiary: 0,
        quaternary: 0,
        quinary: 0,
        mix: process.mix
      }
    case 'ring-mod':
      return {
        processType: process.type,
        primary: process.frequencyHz,
        secondary: process.shape,
        tertiary: 0,
        quaternary: 0,
        quinary: 0,
        mix: process.mix
      }
    case 'comb':
      return {
        processType: process.type,
        primary: process.delayMs,
        secondary: process.feedback,
        tertiary: process.damping,
        quaternary: 0,
        quinary: 0,
        mix: process.mix
      }
    case 'smear':
      return {
        processType: process.type,
        primary: process.timeMs,
        secondary: process.scatter,
        tertiary: 0,
        quaternary: 0,
        quinary: 0,
        mix: process.mix
      }
    case 'compand':
      return {
        processType: process.type,
        primary: process.drive,
        secondary: process.compand,
        tertiary: process.symmetry,
        quaternary: process.outputDb,
        quinary: 0,
        mix: process.mix
      }
    case 'codec-damage':
      return {
        processType: process.type,
        primary: process.quality,
        secondary: process.loss,
        tertiary: process.packetMs,
        quaternary: process.bandwidthHz,
        quinary: 0,
        mix: process.mix
      }
    case 'short-room':
      return {
        processType: process.type,
        primary: process.sizeMs,
        secondary: process.decay,
        tertiary: process.damping,
        quaternary: process.width,
        quinary: 0,
        mix: process.mix
      }
    case 'frequency-shift':
      return {
        processType: process.type,
        primary: process.shiftHz,
        secondary: process.feedback,
        tertiary: process.stereo,
        quaternary: 0,
        quinary: 0,
        mix: process.mix
      }
    case 'chorus':
      return {
        processType: process.type,
        primary: process.rateHz,
        secondary: process.depthMs,
        tertiary: process.delayMs,
        quaternary: process.feedback,
        quinary: process.stereo,
        mix: process.mix
      }
    case 'dj-eq':
      return {
        processType: process.type,
        primary: process.lowDb,
        secondary: process.midDb,
        tertiary: process.highDb,
        quaternary: 0,
        quinary: 0,
        mix: process.mix
      }
    case 'tone':
      return {
        processType: process.type,
        primary: process.cutoffHz,
        secondary: process.resonance,
        tertiary: process.drive,
        quaternary: 0,
        quinary: 0,
        mix: process.mix
      }
  }
}

async function shapePreviewCacheDir(durableRoot: string): Promise<string> {
  const path = join(durableRoot, '.preview-cache')
  await mkdir(path, { recursive: true })
  return path
}

async function touchCacheEntry(path: string): Promise<void> {
  const now = new Date()
  try {
    await utimes(path, now, now)
  } catch {
    // A concurrent eviction only turns this hit into a future miss.
  }
}

async function enforceShapePreviewCacheLimit(dir: string): Promise<void> {
  try {
    const entries: { path: string; size: number; mtimeMs: number }[] = []
    for (const name of await readdir(dir)) {
      const path = join(dir, name)
      try {
        const info = await stat(path)
        if (info.isFile()) entries.push({ path, size: info.size, mtimeMs: info.mtimeMs })
      } catch {
        // gone meanwhile
      }
    }
    for (const path of pathsToEvict(entries, MAX_SHAPE_PREVIEW_CACHE_BYTES)) {
      previewMetadata.delete(path)
      try {
        await unlink(path)
      } catch {
        // gone meanwhile
      }
    }
  } catch (error) {
    console.error('shapeMaterialize: preview cache eviction failed:', error)
  }
}

/** A WAV's format and data size from its header (the first 64 KB) and its size on disk, so a
 * cache hit never reads a whole float file on the main thread. */
async function readWavHeader(
  path: string,
  missing: string
): Promise<{
  audioFormat: number
  bitsPerSample: number
  sampleRate: number
  numChannels: number
  dataSize: number
}> {
  let handle: Awaited<ReturnType<typeof open>>
  try {
    handle = await open(path, 'r')
  } catch {
    throw new Error(missing)
  }
  try {
    const size = (await handle.stat()).size
    if (size === 0) throw new Error(missing)
    const head = Buffer.alloc(Math.min(size, 64 * 1024))
    await handle.read(head, 0, head.length, 0)
    const wav = findWavChunks(new Uint8Array(head.buffer, head.byteOffset, head.length))
    if (wav.dataOffset < 8) return { ...wav, dataSize: 0 }
    // The header read is clamped to 64 KB: take the data size it declares, bounded by the file.
    const declared = head.readUInt32LE(wav.dataOffset - 4)
    return { ...wav, dataSize: Math.min(declared, Math.max(0, size - wav.dataOffset)) }
  } finally {
    await handle.close()
  }
}

async function inspectShapeWav(
  path: string,
  loopBars: number,
  targetBpm: number
): Promise<ShapeMaterializedStem> {
  const wav = await readWavHeader(path, 'an EEEDIT render is missing.')
  const bytesPerFrame = wav.numChannels * (wav.bitsPerSample / 8)
  const frames = bytesPerFrame > 0 ? wav.dataSize / bytesPerFrame : 0
  const expectedFrames = Math.ceil(loopBars * (240 / targetBpm) * wav.sampleRate)
  if (
    wav.audioFormat !== 3 ||
    wav.bitsPerSample !== 32 ||
    wav.sampleRate <= 0 ||
    wav.numChannels <= 0 ||
    !Number.isInteger(frames) ||
    Math.abs(frames - expectedFrames) > 1
  ) {
    throw new Error('an EEEDIT render is incomplete.')
  }
  return {
    path,
    durationSec: frames / wav.sampleRate,
    sampleRate: wav.sampleRate,
    frames,
    channels: wav.numChannels
  }
}

async function inspectShapeSourceWav(path: string): Promise<ShapeMaterializedStem> {
  const wav = await readWavHeader(path, 'an EEEDIT source render is missing.')
  const bytesPerFrame = wav.numChannels * (wav.bitsPerSample / 8)
  const frames = bytesPerFrame > 0 ? wav.dataSize / bytesPerFrame : 0
  if (
    wav.audioFormat !== 3 ||
    wav.bitsPerSample !== 32 ||
    wav.sampleRate <= 0 ||
    wav.numChannels <= 0 ||
    !Number.isInteger(frames) ||
    frames <= 0
  ) {
    throw new Error('an EEEDIT source render is incomplete.')
  }
  return {
    path,
    durationSec: frames / wav.sampleRate,
    sampleRate: wav.sampleRate,
    frames,
    channels: wav.numChannels
  }
}

export function cancelShapeMaterialization(jobId: string): void {
  const activeController = materializeAbortControllers.get(jobId)
  // Only a running job can be cancelled; remembering any other id would leak it (a job clears
  // its own id when it ends).
  if (activeController) cancelledJobs.add(jobId)
  activeController?.abort()
  const nativeSession = materializeNativeSessions.get(jobId)
  if (nativeSession) stopNativeSession(nativeSession)
  const previewRoot = previewRoots.get(jobId)
  // An active native/Rubber Band render may still be unwinding. Let its
  // finally block remove the batch directory so we never delete a file from
  // underneath a writer. Already-finished jobs can be cleaned immediately.
  if (!activeController) {
    if (previewRoot) void removePath(previewRoot)
    previewRoots.delete(jobId)
  }
}

/** For tests: how many job ids the module still holds. */
export function shapeJobStateSizeForTest(): number {
  return cancelledJobs.size + materializeAbortControllers.size + previewRoots.size
}

/** Removes preview staging folders (a dot-named folder directly inside a
 * `.preview-cache`) that hold any of `paths`. Never the cache itself or its
 * shared, LRU-evicted renders: those outlive any one preview. */
export async function cleanupShapePreview(paths: readonly string[]): Promise<void> {
  const stagingRoots = new Set<string>()
  for (const path of paths) {
    const parent = dirname(resolve(path))
    if (basename(parent).startsWith('.') && basename(dirname(parent)) === '.preview-cache')
      stagingRoots.add(parent)
  }
  for (const stagingRoot of stagingRoots) await removePath(stagingRoot)
}

export async function cleanupUncommittedShapeAssets(
  paths: readonly string[],
  durableRoot: string
): Promise<void> {
  for (const path of paths) {
    if (
      inside(durableRoot, path) &&
      (path.toLowerCase().endsWith('.shape.wav') ||
        path.toLowerCase().endsWith('.shape-base.wav')) &&
      !basename(path).startsWith('.')
    ) {
      await removePath(path)
    }
  }
}

/** Atomically promotes Process Clip results to durable 32-bit-float bases.
 * Nothing is published if any item fails validation. */
export async function bakeShapeProcess(
  request: ShapeBakeProcessRequest,
  durableRoot: string,
  options: { mayCreateRoot?: boolean } = {}
): Promise<ShapeBakeProcessResult> {
  if (!request.jobId || request.items.length === 0) throw new Error('nothing to bake.')
  await assertLibraryReachable(durableRoot, options.mayCreateRoot ?? true)
  const batchRoot = join(durableRoot, `.${safeJobName(request.jobId)}-${randomUUID()}`)
  await mkdir(batchRoot, { recursive: true })
  const releaseEngine = await renderEngines.acquire()
  let engine: Awaited<ReturnType<typeof spawnEngine>> | null = null
  let client: EngineClient | null = null
  const pending: Array<{
    fragmentId: string
    temporaryPath: string
    finalPath: string
    durationSec: number
    barLength: number
  }> = []
  try {
    engine = await spawnEngine()
    client = new EngineClient()
    await client.connect(engine.port)
    for (const [index, item] of request.items.entries()) {
      assertFinitePositive(item.source.durationSec, 'bake source duration')
      assertFinitePositive(item.source.barLength, 'bake source bar length')
      const temporaryPath = join(batchRoot, `${index + 1}.baking.wav`)
      const reply = (await client.sendAndAwaitType(
        'render-shape-process-source',
        {
          sourcePath: item.source.path,
          ...nativeShapeProcessPayload(item.process),
          outputPath: temporaryPath
        },
        'render-shape-process-source-result',
        120_000
      )) as NativeShapeReply
      if (
        reply.success !== true ||
        !reply.durationSec ||
        !reply.sampleRate ||
        !reply.frames ||
        !reply.channels
      ) {
        throw new Error(reply.error || 'the bake failed to render.')
      }
      const inspected = await inspectShapeSourceWav(temporaryPath)
      if (
        inspected.sampleRate !== reply.sampleRate ||
        inspected.channels !== reply.channels ||
        inspected.frames !== reply.frames
      ) {
        throw new Error('the bake came back incomplete.')
      }
      pending.push({
        fragmentId: item.fragmentId,
        temporaryPath,
        finalPath: join(durableRoot, `${randomUUID()}.shape-base.wav`),
        durationSec: inspected.durationSec,
        barLength: item.source.barLength
      })
    }
    for (const item of pending) {
      await rename(item.temporaryPath, item.finalPath)
    }
    return {
      jobId: request.jobId,
      bases: pending.map((item) => ({
        fragmentId: item.fragmentId,
        source: {
          path: item.finalPath,
          durationSec: item.durationSec,
          barLength: item.barLength
        }
      }))
    }
  } catch (error) {
    for (const item of pending) await removePath(item.finalPath)
    throw error
  } finally {
    client?.disconnect()
    if (engine) await engine.stop()
    releaseEngine()
    await removePath(batchRoot)
  }
}

/**
 * Strict, all-or-nothing Shape renderer. A batch is prepared under unpublished
 * names and becomes visible only after every source decoded, stretched and
 * rendered successfully. No source-path fallback is permitted.
 */
export async function materializeShape(
  request: ShapeMaterializeRequest,
  durableRoot: string,
  options: { mayCreateRoot?: boolean } = {}
): Promise<ShapeMaterializeResult> {
  assertFinitePositive(request.targetBpm, 'tempo')
  assertFinitePositive(request.loopBars, 'length')
  if (!request.jobId || request.lanes.length === 0) throw new Error('nothing to render.')

  cancelledJobs.delete(request.jobId)
  materializeAbortControllers.get(request.jobId)?.abort()
  const previousNativeSession = materializeNativeSessions.get(request.jobId)
  if (previousNativeSession) stopNativeSession(previousNativeSession)
  const abortController = new AbortController()
  materializeAbortControllers.set(request.jobId, abortController)
  await assertLibraryReachable(durableRoot, options.mayCreateRoot ?? true)
  const batchId = `${safeJobName(request.jobId)}-${randomUUID()}`
  // Staged beside where the results are renamed to (the preview cache, or the
  // library's .shapes for a commit), never in the system temp folder: a rename
  // across volumes fails (EXDEV), and the library is often on a USB drive.
  const batchRoot =
    request.mode === 'preview'
      ? join(await shapePreviewCacheDir(durableRoot), `.${batchId}`)
      : join(durableRoot, `.${batchId}`)
  await mkdir(batchRoot, { recursive: true })
  if (request.mode === 'preview') previewRoots.set(request.jobId, batchRoot)

  const nativeSession: MaterializeNativeSession = { engine: null, client: null }
  materializeNativeSessions.set(request.jobId, nativeSession)
  const ensureClient = async (): Promise<EngineClient> => {
    if (!nativeSession.client) {
      // Queued behind other renders' engines (renderEngines); stopNativeSession frees the slot.
      if (!nativeSession.release) nativeSession.release = await renderEngines.acquire()
      throwIfCancelled(request.jobId)
      nativeSession.engine = await spawnEngine()
      throwIfCancelled(request.jobId)
      nativeSession.client = new EngineClient()
      await nativeSession.client.connect(nativeSession.engine.port)
      throwIfCancelled(request.jobId)
    }
    return nativeSession.client
  }
  const pending: { temporaryPath: string; finalPath: string; stem: ShapeMaterializedStem }[] = []
  const stems: ShapeMaterializedStem[] = []
  try {
    for (let index = 0; index < request.lanes.length; index += 1) {
      throwIfCancelled(request.jobId)
      const lane = request.lanes[index]
      const source = lane.source
      if (source.oneShot || source.trimStartSec !== undefined || source.trimEndSec !== undefined) {
        throw new Error("EEEDIT can't edit one-shot or trimmed stems yet.")
      }
      assertFinitePositive(source.durationSec, 'source duration')
      assertFinitePositive(source.barLength, 'source bar length')

      const previewCachePath =
        request.mode === 'preview'
          ? join(
              await shapePreviewCacheDir(durableRoot),
              shapeLanePreviewCacheKey(lane, request.targetBpm, request.loopBars)
            )
          : null
      if (previewCachePath && (await exists(previewCachePath))) {
        try {
          const cached =
            previewMetadata.get(previewCachePath) ??
            (await inspectShapeWav(previewCachePath, request.loopBars, request.targetBpm))
          previewMetadata.set(previewCachePath, cached)
          await touchCacheEntry(previewCachePath)
          stems.push(cached)
          continue
        } catch {
          previewMetadata.delete(previewCachePath)
          await removePath(previewCachePath)
        }
      }

      const requestedTransforms = [
        ...new Map(
          lane.segments.map((segment) => {
            const rate = segment.rate ?? 1
            const pitchSemitones = segment.pitchSemitones ?? 0
            const formantSemitones = segment.formantSemitones ?? 0
            const character: 'smooth' | 'raw' = segment.character === 'raw' ? 'raw' : 'smooth'
            const process = segment.process
            const base = segment.bakedBase ?? {
              path: source.path,
              durationSec: source.durationSec,
              barLength: source.barLength
            }
            return [
              JSON.stringify({ rate, pitchSemitones, formantSemitones, character, process, base }),
              { rate, pitchSemitones, formantSemitones, character, process, base }
            ]
          })
        ).values()
      ]
      const transforms =
        requestedTransforms.length > 0
          ? requestedTransforms
          : [
              {
                rate: 1,
                pitchSemitones: 0,
                formantSemitones: 0,
                character: 'smooth' as const,
                process: undefined,
                base: {
                  path: source.path,
                  durationSec: source.durationSec,
                  barLength: source.barLength
                }
              }
            ]
      const preparedSources = [] as {
        path: string
        durationSec: number
        barLength: number
        rate: number
        pitchSemitones: number
        formantSemitones: number
        character: 'smooth' | 'raw'
        processKey: string
        baseKey: string
      }[]
      for (const {
        rate,
        pitchSemitones,
        formantSemitones,
        character,
        process,
        base
      } of transforms) {
        assertFinitePositive(rate, 'clip rate')
        assertFinitePositive(base.durationSec, 'clip base duration')
        assertFinitePositive(base.barLength, 'clip base bar length')
        let processPrepared: { path: string; durationSec: number } = {
          path: base.path,
          durationSec: base.durationSec
        }
        if (process) {
          const cacheDir = await shapePreviewCacheDir(durableRoot)
          const processPath = join(
            cacheDir,
            shapeProcessSourceCacheKey(processPrepared.path, process)
          )
          let processed: ShapeMaterializedStem | null = null
          if (await exists(processPath)) {
            try {
              processed = await inspectShapeSourceWav(processPath)
              await touchCacheEntry(processPath)
            } catch {
              await removePath(processPath)
            }
          }
          if (!processed) {
            const temporaryProcessPath = join(batchRoot, `${randomUUID()}.process-rendering.wav`)
            const native = await ensureClient()
            const processReply = (await native.sendAndAwaitType(
              'render-shape-process-source',
              {
                sourcePath: processPrepared.path,
                ...nativeShapeProcessPayload(process),
                outputPath: temporaryProcessPath
              },
              'render-shape-process-source-result',
              120_000
            )) as NativeShapeReply
            throwIfCancelled(request.jobId)
            if (
              processReply.success !== true ||
              !processReply.durationSec ||
              !processReply.sampleRate ||
              !processReply.frames ||
              !processReply.channels
            ) {
              throw new Error(processReply.error || 'a treatment failed to render.')
            }
            const inspectedProcess = await inspectShapeSourceWav(temporaryProcessPath)
            if (
              inspectedProcess.sampleRate !== processReply.sampleRate ||
              inspectedProcess.channels !== processReply.channels ||
              inspectedProcess.frames !== processReply.frames
            ) {
              throw new Error('a treatment came back incomplete.')
            }
            await rename(temporaryProcessPath, processPath)
            processed = { ...inspectedProcess, path: processPath }
          }
          processPrepared = processed
        }
        const formantPrepared =
          Math.abs(formantSemitones) < 0.0001
            ? processPrepared
            : await renderShapeFormant(
                processPrepared.path,
                formantSemitones,
                abortController.signal
              )
        throwIfCancelled(request.jobId)
        const ratio = stretchRatioForStem(
          formantPrepared.durationSec,
          base.barLength,
          request.targetBpm
        )
        const renderedPitch = pitchSemitones + 12 * Math.log2(rate)
        let prepared: { path: string; durationSec: number }
        // The nearest-neighbour Raw route changes source length by the pitch
        // ratio before restoring duration. Beyond five octaves that temporary
        // file would be either sub-frame or impractically huge, so use the
        // staged safe renderer for the deliberately extreme transpose range.
        if (character === 'raw' && Math.abs(renderedPitch) <= 60) {
          const tempoResolved =
            Math.abs(ratio - 1) < STRETCH_RATIO_EPSILON
              ? formantPrepared
              : await renderShapePitch(formantPrepared.path, ratio, 0, abortController.signal)
          throwIfCancelled(request.jobId)
          const rawRate = 2 ** (renderedPitch / 12)
          let rawPrepared = tempoResolved
          if (Math.abs(rawRate - 1) >= STRETCH_RATIO_EPSILON) {
            const cacheDir = await shapePreviewCacheDir(durableRoot)
            const rawPath = join(cacheDir, shapeRawSourceCacheKey(tempoResolved.path, rawRate))
            if (await exists(rawPath)) {
              try {
                rawPrepared = await inspectShapeSourceWav(rawPath)
                await touchCacheEntry(rawPath)
              } catch {
                await removePath(rawPath)
              }
            }
            if (rawPrepared.path !== rawPath) {
              const temporaryRawPath = join(batchRoot, `${randomUUID()}.raw-rendering.wav`)
              const native = await ensureClient()
              const rawReply = (await native.sendAndAwaitType(
                'render-shape-raw-source',
                {
                  sourcePath: tempoResolved.path,
                  rate: rawRate,
                  outputPath: temporaryRawPath
                },
                'render-shape-raw-source-result',
                120_000
              )) as NativeShapeReply
              throwIfCancelled(request.jobId)
              if (
                rawReply.success !== true ||
                !rawReply.durationSec ||
                !rawReply.sampleRate ||
                !rawReply.frames ||
                !rawReply.channels
              ) {
                throw new Error(rawReply.error || 'a raw rate change failed to render.')
              }
              const inspectedRaw = await inspectShapeSourceWav(temporaryRawPath)
              if (
                inspectedRaw.sampleRate !== rawReply.sampleRate ||
                inspectedRaw.channels !== rawReply.channels ||
                inspectedRaw.frames !== rawReply.frames
              ) {
                throw new Error('a raw rate change came back incomplete.')
              }
              await rename(temporaryRawPath, rawPath)
              rawPrepared = { ...inspectedRaw, path: rawPath }
            }
          }
          const compensationRatio = rate / rawRate
          prepared =
            Math.abs(compensationRatio - 1) < STRETCH_RATIO_EPSILON
              ? rawPrepared
              : await renderShapePitch(
                  rawPrepared.path,
                  compensationRatio,
                  0,
                  abortController.signal
                )
        } else {
          prepared =
            Math.abs(ratio * rate - 1) < STRETCH_RATIO_EPSILON && Math.abs(renderedPitch) < 0.0001
              ? formantPrepared
              : await renderShapePitch(
                  formantPrepared.path,
                  ratio * rate,
                  renderedPitch,
                  abortController.signal
                )
        }
        throwIfCancelled(request.jobId)
        preparedSources.push({
          ...prepared,
          barLength: base.barLength / rate,
          rate,
          pitchSemitones,
          formantSemitones,
          character,
          processKey: JSON.stringify(process ?? null),
          baseKey: JSON.stringify(base)
        })
      }
      throwIfCancelled(request.jobId)

      const finalPath = previewCachePath ?? join(durableRoot, `${randomUUID()}.shape.wav`)
      const temporaryPath = join(batchRoot, `${index + 1}.rendering.wav`)
      const native = await ensureClient()
      const reply = (await native.sendAndAwaitType(
        'render-shape-stem',
        {
          sources: preparedSources.map(({ path, durationSec, barLength }) => ({
            path,
            durationSec,
            barLength
          })),
          sourceBarLength: source.barLength,
          targetBpm: request.targetBpm,
          loopBars: request.loopBars,
          segments: lane.segments.map((segment) => {
            const rate = segment.rate ?? 1
            return {
              sourceStartBars: segment.sourceStartBars / rate,
              sourceEndBars: segment.sourceEndBars / rate,
              destStartBars: segment.destStartBars,
              ...(segment.reversed ? { reversed: true } : {}),
              sourceIndex: preparedSources.findIndex(
                (prepared) =>
                  prepared.rate === rate &&
                  prepared.pitchSemitones === (segment.pitchSemitones ?? 0) &&
                  prepared.formantSemitones === (segment.formantSemitones ?? 0) &&
                  prepared.character === (segment.character ?? 'smooth') &&
                  prepared.processKey === JSON.stringify(segment.process ?? null) &&
                  prepared.baseKey ===
                    JSON.stringify(
                      segment.bakedBase ?? {
                        path: source.path,
                        durationSec: source.durationSec,
                        barLength: source.barLength
                      }
                    )
              )
            }
          }),
          outputPath: temporaryPath
        },
        'render-shape-stem-result',
        120_000
      )) as NativeShapeReply
      throwIfCancelled(request.jobId)
      if (
        reply.success !== true ||
        !reply.durationSec ||
        !reply.sampleRate ||
        !reply.frames ||
        !reply.channels
      ) {
        throw new Error(reply.error || `stem ${index + 1} failed to render.`)
      }
      const expectedFrames = Math.ceil(
        request.loopBars * (240 / request.targetBpm) * reply.sampleRate
      )
      if (
        Math.abs(reply.frames - expectedFrames) > 1 ||
        Math.abs(reply.durationSec - reply.frames / reply.sampleRate) > 1 / reply.sampleRate
      ) {
        throw new Error(`stem ${index + 1} came back with invalid audio.`)
      }
      const inspected = await inspectShapeWav(temporaryPath, request.loopBars, request.targetBpm)
      if (
        inspected.sampleRate !== reply.sampleRate ||
        inspected.channels !== reply.channels ||
        inspected.frames !== reply.frames
      ) {
        throw new Error(`stem ${index + 1} came back incomplete.`)
      }
      if (request.mode === 'preview') {
        await rename(temporaryPath, finalPath)
        const stem = { ...inspected, path: finalPath }
        previewMetadata.set(finalPath, stem)
        stems.push(stem)
        await enforceShapePreviewCacheLimit(await shapePreviewCacheDir(durableRoot))
        continue
      }
      pending.push({
        temporaryPath,
        finalPath,
        stem: {
          path: finalPath,
          durationSec: reply.durationSec,
          sampleRate: reply.sampleRate,
          frames: reply.frames,
          channels: reply.channels
        }
      })
    }
    throwIfCancelled(request.jobId)
    if (request.mode === 'commit') {
      await mkdir(durableRoot, { recursive: true })
      for (const item of pending) {
        await rename(item.temporaryPath, item.finalPath)
        stems.push(item.stem)
      }
    }
    return { jobId: request.jobId, stems }
  } catch (error) {
    for (const item of pending) {
      await removePath(item.temporaryPath)
      await removePath(item.finalPath)
    }
    throw error
  } finally {
    stopNativeSession(nativeSession)
    await removePath(batchRoot)
    previewRoots.delete(request.jobId)
    cancelledJobs.delete(request.jobId)
    if (materializeAbortControllers.get(request.jobId) === abortController) {
      materializeAbortControllers.delete(request.jobId)
    }
    if (materializeNativeSessions.get(request.jobId) === nativeSession) {
      materializeNativeSessions.delete(request.jobId)
    }
  }
}
