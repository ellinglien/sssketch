import { execFile } from 'child_process'
import { existsSync, mkdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { createHash } from 'crypto'
import { app } from 'electron'
import { promisify } from 'util'
import { readWavDurationSeconds } from '../shared/wavDuration'
import type { StretchedStem } from '../shared/buildEngineProject'

const execFileAsync = promisify(execFile)

const CANDIDATE_PATHS = [
  '/opt/homebrew/bin/rubberband',
  '/usr/local/bin/rubberband',
  'rubberband' // fall back to PATH
]

function findRubberband(): string {
  for (const path of CANDIDATE_PATHS) {
    if (path === 'rubberband' || existsSync(path)) return path
  }
  return 'rubberband'
}

function cacheDir(): string {
  // No eviction policy — like the imported-stem library, this grows unbounded across
  // a session (every distinct tempo experiment x every stem = one more uncompressed
  // WAV). Acceptable v1 simplification, consistent with the rest of the app, but
  // worth revisiting before this ships broadly.
  const dir = join(app.getPath('userData'), 'stretch-cache')
  mkdirSync(dir, { recursive: true })
  return dir
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

/**
 * Renders a tempo-stretched, pitch-preserved copy of stemPath at the given ratio
 * (projectBpm / rifffBpm) and returns the rendered file's absolute path plus its
 * actual real-world duration (measured from the file itself, not assumed via
 * arithmetic on the ratio — rubberband's exact output length isn't a simple
 * formula of the input length, matching the precedent already established for
 * this same measurement in the native-engine stretch-ratio parity test).
 * Results are cached by (path, ratio) so repeated tempo settings don't re-render.
 */
export async function renderStretched(stemPath: string, ratio: number): Promise<StretchedStem> {
  if (Math.abs(ratio - 1) < 0.001) {
    // native tempo, nothing to render — still measure rather than trust
    // whatever duration metadata the caller has on hand, so this function's
    // contract (durationSec is always the real duration of the returned
    // file) holds unconditionally, not just on the stretched path.
    return { path: stemPath, durationSec: readWavDurationSeconds(readFileSync(stemPath)) }
  }

  const outPath = join(cacheDir(), cacheKey(stemPath, ratio))
  if (!existsSync(outPath)) {
    const binary = findRubberband()
    // --tempo <X> means "change tempo by multiple X": X>1 speeds up (shorter output),
    // X<1 slows down (longer output) — confirmed against the real installed binary
    // (rubberband --help) and verified end-to-end against a real fixture stem: passing
    // --tempo 0.666667 on a 12.8s file produced a 19.2s file (12.8/0.667), matching
    // ratio = projectBpm/rifffBpm exactly (project slower than native → longer output).
    // -q suppresses rubberband's per-pass percentage progress output (confirmed this
    // still exits 0 and produces correct output; keeps the main process's execFile
    // buffer small regardless of how long a stem's render takes).
    await execFileAsync(binary, ['-q', '--tempo', ratio.toFixed(6), stemPath, outPath])
  }
  return { path: outPath, durationSec: readWavDurationSeconds(readFileSync(outPath)) }
}
