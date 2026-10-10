import { execFile } from 'child_process'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  utimesSync
} from 'fs'
import { rename, stat } from 'fs/promises'
import { join } from 'path'
import { createHash, randomUUID } from 'crypto'
import { app } from 'electron'
import { promisify } from 'util'
import { readWavDurationSeconds } from '../shared/wavDuration'
import { wavDurationSeconds } from './wavHeader'
import type { StretchedStem } from '../shared/buildEngineProject'
import { StemNotDownloadedError } from '../shared/stemNotDownloaded'
import { isUsableStemFile } from './stemFile'

const execFileAsync = promisify(execFile)

const CANDIDATE_PATHS = [
  '/opt/homebrew/bin/rubberband',
  '/usr/local/bin/rubberband',
  'rubberband' // fall back to PATH
]

/** Packaged mode: prefer the vendored, self-contained copy shipped as an
 * extraResource (see electron-builder.yml + scripts/vendor-rubberband.sh) —
 * mirrors engineProcess.ts's own dev-vs-packaged defaultBinaryPath()
 * pattern exactly. Falls back to CANDIDATE_PATHS's Homebrew lookup if the
 * vendored copy is somehow missing (e.g. a local unsigned --dir build that
 * skipped the vendor step) rather than hard-failing. */
function findRubberband(): string {
  if (app.isPackaged) {
    const bundled = join(process.resourcesPath, 'rubberband', 'bin', 'rubberband')
    if (existsSync(bundled)) return bundled
  }
  for (const path of CANDIDATE_PATHS) {
    if (path === 'rubberband' || existsSync(path)) return path
  }
  return 'rubberband'
}

function cacheDir(): string {
  const dir = join(app.getPath('userData'), 'stretch-cache')
  mkdirSync(dir, { recursive: true })
  return dir
}

// A fixed constant rather than user-configurable, matching this codebase's
// existing convention for tuning knobs like STEM_DOWNLOAD_RETRIES in
// endlesssApi.ts.
const MAX_STRETCH_CACHE_BYTES = 1024 * 1024 * 1024 // 1GB
const MAX_SHAPE_PITCH_STAGE_SEMITONES = 48

/** Rubber Band's resampler rejects extreme frequency ratios even though its
 * CLI accepts the semitone value. Divide an extreme Shape transpose into
 * equal, duration-preserving passes whose individual ratios stay comfortably
 * inside the underlying resampler's supported range. */
export function shapePitchStages(pitchSemitones: number): number[] {
  if (!Number.isFinite(pitchSemitones)) return []
  if (Math.abs(pitchSemitones) < 0.0001) return []
  const count = Math.max(1, Math.ceil(Math.abs(pitchSemitones) / MAX_SHAPE_PITCH_STAGE_SEMITONES))
  const stage = pitchSemitones / count
  return Array.from({ length: count }, () => stage)
}

interface CacheEntry {
  path: string
  size: number
  mtimeMs: number
}

/** Pure sizing logic, kept separate from the real fs scan in
 * enforceStretchCacheLimit below so it's testable without touching disk --
 * given a cache's current entries and a byte cap, returns which paths to
 * delete (oldest mtime first) to bring the total back under the cap. */
export function pathsToEvict(entries: CacheEntry[], maxBytes: number): string[] {
  const sorted = [...entries].sort((a, b) => a.mtimeMs - b.mtimeMs)
  let total = entries.reduce((sum, e) => sum + e.size, 0)
  const toEvict: string[] = []
  for (const entry of sorted) {
    if (total <= maxBytes) break
    toEvict.push(entry.path)
    total -= entry.size
  }
  return toEvict
}

function enforceStretchCacheLimit(dir: string): void {
  const entries: CacheEntry[] = readdirSync(dir).flatMap((name) => {
    // Final stretch-cache objects are SHA-1 WAV names. Hidden/UUID files are
    // active render intermediates and must never be selected for eviction.
    if (!/^[0-9a-f]{40}\.wav$/i.test(name)) return []
    const path = join(dir, name)
    try {
      const stat = statSync(path)
      return stat.isFile() ? [{ path, size: stat.size, mtimeMs: stat.mtimeMs }] : []
    } catch {
      // Another render/eviction may have won the race.
      return []
    }
  })
  for (const path of pathsToEvict(entries, MAX_STRETCH_CACHE_BYTES)) {
    try {
      unlinkSync(path)
    } catch {
      // Concurrent cache maintenance may already have removed it.
    }
  }
}

// Marks a cache HIT as recently used. Without this, LRU-by-mtime would
// evict frequently-reused-but-never-re-rendered files first, since their
// mtime never updates on a hit -- backwards from correct LRU behavior.
function touchCacheEntry(path: string): void {
  const now = new Date()
  try {
    utimesSync(path, now, now)
  } catch {
    // A concurrent eviction only turns this hit into a future miss.
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  throw signal.reason instanceof Error
    ? signal.reason
    : new Error('the audio render was cancelled.')
}

/** Publish only complete, readable WAVs under shared cache names. Every
 * renderer owns its unique temporary path, so cancellation can never unlink
 * another concurrent render's finished result. */
async function publishCacheWav(
  temporaryPath: string,
  outPath: string,
  signal?: AbortSignal
): Promise<number> {
  // From the header alone, asynchronously: never a whole WAV read on main's thread.
  const durationSec = await wavDurationSeconds(temporaryPath)
  throwIfAborted(signal)
  try {
    await stat(outPath)
  } catch {
    await rename(temporaryPath, outPath)
  }
  return durationSec
}

// Exported for testing — pure, no fs/process access.
export function cacheKey(stemPath: string, ratio: number): string {
  // toFixed(4) deliberately quantizes more coarsely than the 6-decimal precision
  // passed to the actual --tempo invocation below: two ratios differing only past
  // the 4th decimal share a cache entry (and reuse whichever rendered first). The
  // resulting pitch/tempo difference is inaudible; this keeps the cache from growing
  // one entry per floating-point rounding artifact of a live tempo drag.
  const hash = createHash('sha1')
    .update(`${stemPath}::${ratio.toFixed(4)}`)
    .digest('hex')
  return `${hash}.wav`
}

/** Content key for Shape's duration-preserving Smooth pitch renders. The
 * algorithm tag deliberately makes later renderer tuning non-aliasing with
 * audio produced by this first R3 implementation. */
export function shapePitchCacheKey(
  stemPath: string,
  tempoRatio: number,
  pitchSemitones: number
): string {
  const hash = createHash('sha1')
    .update(
      `shape-pitch-r3-v1::${stemPath}::${tempoRatio.toFixed(6)}::${pitchSemitones.toFixed(4)}`
    )
    .digest('hex')
  return `${hash}.wav`
}

/** Content key for Shape's independent spectral-envelope shift. The
 * algorithm tag identifies the two-pass R3 construction used because the
 * bundled Rubber Band CLI exposes formant preservation but not its library's
 * independent setFormantScale control. */
export function shapeFormantCacheKey(stemPath: string, formantSemitones: number): string {
  const hash = createHash('sha1')
    .update(`shape-formant-r3-twopass-v1::${stemPath}::${formantSemitones.toFixed(4)}`)
    .digest('hex')
  return `${hash}.wav`
}

/**
 * Renders a tempo-stretched, pitch-preserved copy of stemPath at the given ratio
 * (projectBpm / rifffBpm) and returns the rendered file's absolute path plus its
 * actual real-world duration (measured from the file itself, not assumed via
 * arithmetic on the ratio — rubberband's exact output length isn't a simple
 * formula of the input length, matching the precedent already established for
 * this same measurement in the native-engine stretch-ratio parity test).
 * Results are cached by (path, ratio) so repeated tempo settings don't re-render.
 */
export async function renderStretched(
  stemPath: string,
  ratio: number,
  signal?: AbortSignal
): Promise<StretchedStem> {
  // A missing or 0-byte input (an unfinished LORE download's placeholder,
  // 2026-10-01) is a stem not downloaded yet, not something to hand
  // rubberband ("Format not recognised") or the WAV reader. One stat per
  // stretched stem; callers already fall back per stem on a rejection.
  if (!isUsableStemFile(stemPath)) throw new StemNotDownloadedError(stemPath)
  if (Math.abs(ratio - 1) < 0.001) {
    // native tempo, nothing to render — still measure rather than trust
    // whatever duration metadata the caller has on hand, so this function's
    // contract (durationSec is always the real duration of the returned
    // file) holds unconditionally, not just on the stretched path.
    return { path: stemPath, durationSec: readWavDurationSeconds(readFileSync(stemPath)) }
  }

  const dir = cacheDir()
  const outPath = join(dir, cacheKey(stemPath, ratio))
  if (existsSync(outPath)) {
    touchCacheEntry(outPath)
  } else {
    const binary = findRubberband()
    const temporaryPath = join(dir, `.${randomUUID()}.stretch-complete.wav`)
    // --tempo <X> means "change tempo by multiple X": X>1 speeds up (shorter output),
    // X<1 slows down (longer output) — confirmed against the real installed binary
    // (rubberband --help) and verified end-to-end against a real fixture stem: passing
    // --tempo 0.666667 on a 12.8s file produced a 19.2s file (12.8/0.667), matching
    // ratio = projectBpm/rifffBpm exactly (project slower than native → longer output).
    // -q suppresses rubberband's per-pass percentage progress output (confirmed this
    // still exits 0 and produces correct output; keeps the main process's execFile
    // buffer small regardless of how long a stem's render takes).
    try {
      await execFileAsync(
        binary,
        ['-q', '--tempo', ratio.toFixed(6), stemPath, temporaryPath],
        signal ? { signal } : {}
      )
      await publishCacheWav(temporaryPath, outPath, signal)
    } finally {
      if (existsSync(temporaryPath)) unlinkSync(temporaryPath)
    }
    enforceStretchCacheLimit(dir)
  }
  return { path: outPath, durationSec: readWavDurationSeconds(readFileSync(outPath)) }
}

/** Tempo-resolves a Shape source and shifts pitch without changing the
 * tempo-resolved duration. R3 is intentionally selected for the Smooth
 * character; clips using the same source/tempo/pitch share this render. */
export async function renderShapePitch(
  stemPath: string,
  tempoRatio: number,
  pitchSemitones: number,
  signal?: AbortSignal
): Promise<StretchedStem> {
  if (!isUsableStemFile(stemPath)) throw new StemNotDownloadedError(stemPath)
  if (!Number.isFinite(tempoRatio) || tempoRatio <= 0 || !Number.isFinite(pitchSemitones)) {
    throw new Error('invalid EEEDIT pitch settings.')
  }
  if (Math.abs(pitchSemitones) < 0.0001) return renderStretched(stemPath, tempoRatio, signal)

  const dir = cacheDir()
  const outPath = join(dir, shapePitchCacheKey(stemPath, tempoRatio, pitchSemitones))
  if (existsSync(outPath)) {
    touchCacheEntry(outPath)
  } else {
    const binary = findRubberband()
    const stages = shapePitchStages(pitchSemitones)
    const temporaryStages: string[] = []
    try {
      let inputPath = stemPath
      for (let index = 0; index < stages.length; index += 1) {
        const stagePath = join(dir, `.${randomUUID()}.shape-pitch-stage.wav`)
        temporaryStages.push(stagePath)
        await execFileAsync(
          binary,
          [
            '-q',
            '--fine',
            '--tempo',
            (index === 0 ? tempoRatio : 1).toFixed(6),
            '--pitch',
            stages[index].toFixed(4),
            inputPath,
            stagePath
          ],
          signal ? { signal } : {}
        )
        inputPath = stagePath
      }
      await publishCacheWav(inputPath, outPath, signal)
    } finally {
      for (const path of temporaryStages) {
        if (existsSync(path)) unlinkSync(path)
      }
    }
    enforceStretchCacheLimit(dir)
  }
  return { path: outPath, durationSec: await wavDurationSeconds(outPath) }
}

/** Shifts only the spectral envelope while retaining pitch and duration.
 * Pass one shifts pitch and formants together; pass two returns pitch by the
 * opposite interval with formant preservation enabled, leaving the envelope
 * at the requested offset. Listening QA may later replace this with a small
 * library helper using setFormantScale, without aliasing this cache version. */
export async function renderShapeFormant(
  stemPath: string,
  formantSemitones: number,
  signal?: AbortSignal
): Promise<StretchedStem> {
  if (!isUsableStemFile(stemPath)) throw new StemNotDownloadedError(stemPath)
  if (!Number.isFinite(formantSemitones) || Math.abs(formantSemitones) > 12) {
    throw new Error('invalid EEEDIT formant settings.')
  }
  if (Math.abs(formantSemitones) < 0.0001) {
    return { path: stemPath, durationSec: await wavDurationSeconds(stemPath) }
  }

  const dir = cacheDir()
  const outPath = join(dir, shapeFormantCacheKey(stemPath, formantSemitones))
  if (existsSync(outPath)) {
    touchCacheEntry(outPath)
  } else {
    const binary = findRubberband()
    const suffix = randomUUID()
    const shiftedPath = join(dir, `.${suffix}.formant-shifted.wav`)
    const completedPath = join(dir, `.${suffix}.formant-complete.wav`)
    try {
      await execFileAsync(
        binary,
        ['-q', '--fine', '--pitch', formantSemitones.toFixed(4), stemPath, shiftedPath],
        signal ? { signal } : {}
      )
      await execFileAsync(
        binary,
        [
          '-q',
          '--fine',
          '--formant',
          '--pitch',
          (-formantSemitones).toFixed(4),
          shiftedPath,
          completedPath
        ],
        signal ? { signal } : {}
      )
      await publishCacheWav(completedPath, outPath, signal)
      enforceStretchCacheLimit(dir)
    } finally {
      if (existsSync(shiftedPath)) unlinkSync(shiftedPath)
      if (existsSync(completedPath)) unlinkSync(completedPath)
    }
  }
  return { path: outPath, durationSec: await wavDurationSeconds(outPath) }
}
