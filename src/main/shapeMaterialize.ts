import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { stretchRatioForStem, STRETCH_RATIO_EPSILON } from '@shared/stretchRatio'
import type {
  ShapeMaterializeRequest,
  ShapeMaterializeResult,
  ShapeMaterializedStem
} from '@shared/shape'
import { renderStretched } from './rubberband'
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
const previewRoots = new Map<string, string>()

function assertFinitePositive(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`Invalid Shape ${label}.`)
}

function inside(root: string, candidate: string): boolean {
  const resolvedRoot = resolve(root)
  const resolvedCandidate = resolve(candidate)
  return resolvedCandidate === resolvedRoot || resolvedCandidate.startsWith(`${resolvedRoot}${sep}`)
}

function removePath(path: string): void {
  try {
    if (existsSync(path)) rmSync(path, { recursive: true, force: true })
  } catch (error) {
    console.error(`shapeMaterialize: failed to remove "${path}":`, error)
  }
}

function throwIfCancelled(jobId: string): void {
  if (cancelledJobs.has(jobId)) throw new Error('Shape render was cancelled.')
}

export function cancelShapeMaterialization(jobId: string): void {
  cancelledJobs.add(jobId)
  const previewRoot = previewRoots.get(jobId)
  if (previewRoot) removePath(previewRoot)
  previewRoots.delete(jobId)
}

export function cleanupShapePreview(paths: readonly string[]): void {
  const root = join(tmpdir(), 'sssketch-shape-preview')
  const jobRoots = new Set<string>()
  for (const path of paths) {
    if (inside(root, path)) jobRoots.add(dirname(path))
  }
  for (const jobRoot of jobRoots) if (inside(root, jobRoot)) removePath(jobRoot)
}

export function cleanupUncommittedShapeAssets(paths: readonly string[], durableRoot: string): void {
  for (const path of paths) {
    if (
      inside(durableRoot, path) &&
      path.toLowerCase().endsWith('.shape.wav') &&
      !basename(path).startsWith('.')
    ) {
      removePath(path)
    }
  }
}

/**
 * Strict, all-or-nothing Shape renderer. A batch is prepared under unpublished
 * names and becomes visible only after every source decoded, stretched and
 * rendered successfully. No source-path fallback is permitted.
 */
export async function materializeShape(
  request: ShapeMaterializeRequest,
  durableRoot: string
): Promise<ShapeMaterializeResult> {
  assertFinitePositive(request.targetBpm, 'tempo')
  assertFinitePositive(request.loopBars, 'length')
  if (!request.jobId || request.lanes.length === 0) throw new Error('Shape render is empty.')

  cancelledJobs.delete(request.jobId)
  const batchId = `${request.jobId}-${randomUUID()}`
  const previewBase = join(tmpdir(), 'sssketch-shape-preview')
  const batchRoot =
    request.mode === 'preview' ? join(previewBase, batchId) : join(durableRoot, `.${batchId}`)
  mkdirSync(batchRoot, { recursive: true })
  if (request.mode === 'preview') previewRoots.set(request.jobId, batchRoot)

  const engine = await spawnEngine()
  const client = new EngineClient()
  const pending: { temporaryPath: string; finalPath: string; stem: ShapeMaterializedStem }[] = []
  let succeeded = false
  try {
    await client.connect(engine.port)
    for (let index = 0; index < request.lanes.length; index += 1) {
      throwIfCancelled(request.jobId)
      const lane = request.lanes[index]
      const source = lane.source
      if (source.oneShot || source.trimStartSec !== undefined || source.trimEndSec !== undefined) {
        throw new Error('Shape Riff does not yet support one-shot or trimmed stems.')
      }
      assertFinitePositive(source.durationSec, 'source duration')
      assertFinitePositive(source.barLength, 'source bar length')

      const ratio = stretchRatioForStem(source.durationSec, source.barLength, request.targetBpm)
      const prepared =
        Math.abs(ratio - 1) < STRETCH_RATIO_EPSILON
          ? { path: source.path, durationSec: source.durationSec }
          : await renderStretched(source.path, ratio)
      throwIfCancelled(request.jobId)

      const finalPath =
        request.mode === 'preview'
          ? join(batchRoot, `${index + 1}.shape-preview.wav`)
          : join(durableRoot, `${randomUUID()}.shape.wav`)
      const temporaryPath =
        request.mode === 'preview' ? finalPath : join(batchRoot, `${index + 1}.rendering.wav`)
      const reply = (await client.sendAndAwaitType(
        'render-shape-stem',
        {
          sourcePath: prepared.path,
          sourceDurationSec: prepared.durationSec,
          sourceBarLength: source.barLength,
          targetBpm: request.targetBpm,
          loopBars: request.loopBars,
          segments: lane.segments,
          outputPath: temporaryPath
        },
        'render-shape-stem-result',
        120_000
      )) as NativeShapeReply
      if (
        reply.success !== true ||
        !reply.durationSec ||
        !reply.sampleRate ||
        !reply.frames ||
        !reply.channels
      ) {
        throw new Error(reply.error || `Shape lane ${index + 1} failed to render.`)
      }
      const expectedFrames = Math.ceil(
        request.loopBars * (240 / request.targetBpm) * reply.sampleRate
      )
      if (
        Math.abs(reply.frames - expectedFrames) > 1 ||
        Math.abs(reply.durationSec - reply.frames / reply.sampleRate) > 1 / reply.sampleRate ||
        !existsSync(temporaryPath) ||
        statSync(temporaryPath).size === 0
      ) {
        throw new Error(`Shape lane ${index + 1} produced invalid audio.`)
      }
      const wav = findWavChunks(new Uint8Array(readFileSync(temporaryPath)))
      const bytesPerFrame = wav.numChannels * (wav.bitsPerSample / 8)
      const actualFrames = bytesPerFrame > 0 ? wav.dataSize / bytesPerFrame : 0
      if (
        wav.audioFormat !== 3 ||
        wav.bitsPerSample !== 32 ||
        wav.sampleRate !== reply.sampleRate ||
        wav.numChannels !== reply.channels ||
        !Number.isInteger(actualFrames) ||
        actualFrames !== reply.frames
      ) {
        throw new Error(`Shape lane ${index + 1} did not produce the promised float WAV.`)
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
      mkdirSync(durableRoot, { recursive: true })
      for (const item of pending) renameSync(item.temporaryPath, item.finalPath)
    }
    succeeded = true
    return { jobId: request.jobId, stems: pending.map((item) => item.stem) }
  } catch (error) {
    for (const item of pending) {
      removePath(item.temporaryPath)
      removePath(item.finalPath)
    }
    throw error
  } finally {
    client.disconnect()
    engine.stop()
    if (request.mode === 'commit' || !succeeded) removePath(batchRoot)
    previewRoots.delete(request.jobId)
    cancelledJobs.delete(request.jobId)
  }
}
