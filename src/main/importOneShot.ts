// src/main/importOneShot.ts
import { statSync, mkdirSync, copyFileSync, rmSync } from 'fs'
import { join, basename } from 'path'
import { randomUUID } from 'crypto'
import { readWavHeaderBytes, libraryRoot } from './importRifff'
import { readWavDurationSeconds } from '../shared/wavDuration'
import type { Rifff } from '@shared/types'

/**
 * Imports a single file dropped directly onto the arranger as a one-shot
 * sample -- a single-stem Rifff with oneShot: true on its one stem. WAV
 * only for v1 (see docs/superpowers/specs/2026-08-02-one-shot-sample-import-design.md)
 * -- this process has no duration reader for any other format yet. Returns
 * null (never throws) for anything that isn't a readable .wav, matching
 * importRifff's own "can't build a rifff -> return null" convention.
 */
export function importOneShot(path: string): Rifff | null {
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
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`importOneShot: failed to import ${path}: ${message}`)
    if (destDir) {
      try {
        rmSync(destDir, { recursive: true, force: true })
      } catch (cleanupErr) {
        console.error(`importOneShot: failed to clean up partial import at ${destDir}:`, cleanupErr)
      }
    }
    return null
  }
}
