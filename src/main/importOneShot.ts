// src/main/importOneShot.ts
import { statSync, mkdirSync, copyFileSync, rmSync } from 'fs'
import { join, basename } from 'path'
import { randomUUID } from 'crypto'
import { readWavHeaderBytes, libraryRoot } from './importRifff'
import { readWavDurationSeconds } from '../shared/wavDuration'
import type { Rifff } from '@shared/types'

interface CopiedAudioFile {
  groupId: string
  destPath: string
  durationSec: number
}

/**
 * Shared by importOneShot/importRecordedTake below -- both need exactly
 * this "copy a WAV into its own new folder under the library root, measure
 * its real duration" step, differing only in what Rifff/Stem fields they
 * build around the result. WAV only for v1 (see
 * docs/superpowers/specs/2026-08-02-one-shot-sample-import-design.md) --
 * this process has no duration reader for any other format yet. Returns
 * null (never throws) for anything that isn't a readable .wav, matching
 * importRifff's own "can't build a rifff -> return null" convention, and
 * cleans up any partially-created destination folder if a later step
 * fails after the folder was already made.
 */
function copyIntoLibrary(path: string, logLabel: string): CopiedAudioFile | null {
  if (!path.toLowerCase().endsWith('.wav')) return null

  let destDir: string | undefined
  try {
    if (!statSync(path).isFile()) return null

    const durationSec = readWavDurationSeconds(readWavHeaderBytes(path))
    if (durationSec <= 0) return null

    const groupId = randomUUID()
    destDir = join(libraryRoot(), groupId)
    mkdirSync(destDir, { recursive: true })
    const destPath = join(destDir, basename(path))
    copyFileSync(path, destPath)

    return { groupId, destPath, durationSec }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`${logLabel}: failed to import ${path}: ${message}`)
    if (destDir) {
      try {
        rmSync(destDir, { recursive: true, force: true })
      } catch (cleanupErr) {
        console.error(`${logLabel}: failed to clean up partial import at ${destDir}:`, cleanupErr)
      }
    }
    return null
  }
}

/**
 * Imports a single file dropped directly onto the arranger as a one-shot
 * sample -- a single-stem Rifff with oneShot: true on its one stem.
 */
export function importOneShot(path: string): Rifff | null {
  const copied = copyIntoLibrary(path, 'importOneShot')
  if (!copied) return null
  const { groupId, destPath, durationSec } = copied

  const displayName = basename(path, '.wav')
  return {
    groupId,
    name: displayName,
    // Cosmetic for a one-shot -- the native engine ignores bpm/barLength
    // for tiling/resampling purposes whenever a stem's oneShot is set
    // (see Stem's own doc comment). Kept populated because existing
    // serialization/Inspector code expects every Rifff to have them.
    bpm: 120,
    barLength: 1,
    folderPath: path,
    stems: [
      {
        slot: 1,
        author: '',
        name: displayName,
        type: 'fx',
        path: destPath,
        durationSec,
        barLength: 1,
        oneShot: true
      }
    ]
  }
}

/**
 * Imports a recorded take (see docs/superpowers/specs/2026-08-03-loop-recording-design.md)
 * -- shares importOneShot's copyIntoLibrary step above and, per feedback,
 * behaves exactly like a dragged-in one-shot sample: plays the actual
 * recording once from wherever it lands, trimmable via the same start/end
 * handles a one-shot gets (see CollapsedRifffRow.tsx/oneShotResize.ts),
 * rather than stretched/tiled to fit a bar grid. An earlier version derived
 * barLength from the take's own real duration and left oneShot unset so a
 * take would tile/stretch/loop like any other multi-stem rifff -- that's
 * gone now; barLength is cosmetic (1, matching importOneShot's own
 * convention) since the native engine ignores bpm/barLength for tiling/
 * resampling purposes whenever a stem's oneShot is set (see Stem's own doc
 * comment).
 *
 * bpm is still the project's real bpm at record time, unlike importOneShot's
 * hardcoded 120 -- purely accurate metadata (Inspector display etc.),
 * nothing reads it for playback once oneShot is set.
 */
export function importRecordedTake(path: string, bpm: number): Rifff | null {
  const copied = copyIntoLibrary(path, 'importRecordedTake')
  if (!copied) return null
  const { groupId, destPath, durationSec } = copied

  const displayName = `recording ${new Date().toLocaleTimeString()}`
  return {
    groupId,
    name: displayName,
    bpm,
    barLength: 1,
    folderPath: path,
    stems: [
      {
        slot: 1,
        author: '',
        name: displayName,
        type: 'audioIn',
        path: destPath,
        durationSec,
        barLength: 1,
        oneShot: true,
        recordedInApp: true
      }
    ]
  }
}
