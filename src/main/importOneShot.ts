// src/main/importOneShot.ts
import { statSync, mkdirSync, copyFileSync, rmSync } from 'fs'
import { join, basename } from 'path'
import { randomUUID } from 'crypto'
import { readWavHeaderBytes, libraryRoot } from './importRifff'
import { readWavDurationSeconds } from '../shared/wavDuration'
import { randomAdjectiveNoun } from './projectFile'
import { snapToWholeBarIfNearlyExact } from '../shared/barLengthSnap'
import { bpmForLoopBars } from '../shared/loopBarGuess'
import type { Rifff, Stem } from '@shared/types'

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
 * Imports a single file dropped directly onto the Shelf as a real,
 * tempo-stretchable, tileable loop -- the user-chosen alternative to
 * importOneShot above, for a dropped file that IS a musical loop rather
 * than a one-shot hit (Shelf.tsx's own import prompt asks which). Real
 * report, 2026-09-16: "it doesn't want to loop... i can't extend it
 * beyond its bound in the timeline, and it is out of time although it is
 * a perfect loop" -- importOneShot's hardcoded bpm:120/barLength:1/
 * oneShot:true is correct for a one-shot hit but wrong for a loop file:
 * oneShot stems are never stretched or tiled, by design (see that
 * function's own doc comment).
 *
 * `barCount` is supplied by the user (via the Shelf import prompt,
 * pre-filled with loopBarGuess.ts's own best-effort suggestion) rather
 * than detected from audio content -- this codebase has no onset/tempo
 * detection anywhere, and asking for bar count (something a loop-pack
 * user typically knows or can see, e.g. "this is a 2-bar break") lets
 * loopBarGuess.ts's bpmForLoopBars back-solve a native bpm from nothing
 * but that + the file's own real measured duration, with no new audio
 * analysis required. oneShot is left unset -- this rifff and its one
 * stem behave exactly like any other tileable, stretch-to-project-tempo
 * loop from here on.
 */
export function importLoop(path: string, barCount: number): Rifff | null {
  const copied = copyIntoLibrary(path, 'importLoop')
  if (!copied) return null
  const { groupId, destPath, durationSec } = copied

  const displayName = basename(path, '.wav')
  const bpm = bpmForLoopBars(durationSec, barCount)
  return {
    groupId,
    name: displayName,
    bpm,
    barLength: barCount,
    folderPath: path,
    stems: [
      {
        slot: 1,
        author: '',
        name: displayName,
        type: 'fx',
        path: destPath,
        durationSec,
        barLength: barCount
      }
    ]
  }
}

/**
 * Imports a recorded take (see docs/superpowers/specs/2026-08-03-loop-recording-design.md)
 * -- shares importOneShot's copyIntoLibrary step above. Two distinct shapes,
 * selected by whether loopBars is passed:
 *
 * - Manual arm/disarm takes (ChannelRow.tsx's own commit flow, loopBars
 *   omitted) behave exactly like a dragged-in one-shot sample: play the
 *   actual recording once from wherever it lands, trimmable via the same
 *   start/end handles a one-shot gets (see CollapsedRifffRow.tsx/
 *   oneShotResize.ts), rather than stretched/tiled to fit a bar grid --
 *   this capture's own real duration is arbitrary (arm-to-disarm, not tied
 *   to any loop length), so tiling it would be meaningless. barLength is
 *   cosmetic (1) since the native engine ignores bpm/barLength for tiling/
 *   resampling purposes whenever a stem's oneShot is set (see Stem's own
 *   doc comment).
 * - Gated-recording takes (App.tsx's lockInGatedRecording, loopBars passed
 *   through from the selected loop region's own length) are, per direct
 *   feedback ("because the rec clips are now loops, they should behave as
 *   other imported rifffs, as loops"), captured to always span EXACTLY
 *   that many bars (see GatedLoopRecorder's own fixed-buffer design and its
 *   loop-seam crossfade blend) -- so unlike a manual take, this one SHOULD
 *   tile/stretch/replicate via handles like any other imported rifff, not
 *   play once and stop. oneShot stays unset and barLength is the real
 *   loopBars value, not the arbitrary-capture placeholder above.
 *
 * bpm is the project's real bpm at record time either way, unlike
 * importOneShot's hardcoded 120 -- for the manual/oneShot case this is
 * purely accurate metadata (nothing reads it for playback once oneShot is
 * set); for the gated/tiled case it's load-bearing, same as any other
 * tiled rifff's own bpm.
 *
 * name is a random "adjective noun" pair (see projectFile.ts's
 * randomAdjectiveNoun, shared with this app's other auto-naming) followed
 * by the record time -- e.g. "groovy sparrow 2:14:07 PM" -- giving the
 * personality of this app's other auto-generated names while still telling
 * two takes recorded close together apart at a glance, per direct feedback
 * asking for the timestamp back alongside the random name.
 */
export function importRecordedTake(path: string, bpm: number, loopBars?: number): Rifff | null {
  const copied = copyIntoLibrary(path, 'importRecordedTake')
  if (!copied) return null
  const { groupId, destPath, durationSec } = copied

  const displayName = `${randomAdjectiveNoun()} ${new Date().toLocaleTimeString()}`
  const barLength = loopBars ?? 1
  return {
    groupId,
    name: displayName,
    bpm,
    barLength,
    folderPath: path,
    stems: [
      {
        slot: 1,
        author: '',
        name: displayName,
        type: 'audioIn',
        path: destPath,
        durationSec,
        barLength,
        oneShot: loopBars === undefined ? true : undefined,
        recordedInApp: true
      }
    ]
  }
}

/**
 * Imports a gated-recording take as a STEM to attach to an existing rifff
 * (App.tsx's useGatedRecordingControls, the double-click-a-rifff path --
 * see docs/superpowers/specs/2026-08-06-rifff-recording-design.md), rather
 * than a whole new Rifff (that's importRecordedTake's job, unchanged, for
 * the manual-Ruler-drag / standalone-channel path). Shares
 * copyIntoLibrary's own "copy the WAV into the library, measure its real
 * duration" step.
 *
 * barLength is NOT loopBars directly -- a rifff's own stems all stretch
 * together by ONE shared ratio (state.bpm / rifff.bpm), but this stem was
 * captured live at the CURRENT project tempo, not at rifffBpm. Naively
 * using loopBars would double-stretch it whenever rifffBpm differs from
 * the live tempo. Instead, barLength is chosen so this stem's own "native
 * tempo" (durationSec/barLength-derived, see buildAlsXml.ts's
 * nativeBpmFor) resolves to EXACTLY rifffBpm -- the rifff's shared stretch
 * ratio then maps that back to the tempo it was actually captured at,
 * correctly, regardless of how far rifffBpm has drifted from the live
 * project tempo:
 *
 *   durationSec = actual captured duration (loopBars * secPerBar at record time)
 *   barLength   = durationSec * rifffBpm / 240
 *
 * When rifffBpm equals the live capture tempo, this reduces to exactly
 * barLength = loopBars (secPerBar = 240/bpm, so durationSec =
 * loopBars*240/bpm, and durationSec*bpm/240 = loopBars) -- i.e. no
 * observable compensation in the common case where the rifff's own tempo
 * already matches. The result is passed through
 * snapToWholeBarIfNearlyExact (imported from ../shared/barLengthSnap)
 * before returning, so that "reduces to exactly" is actually exact rather
 * than merely approximate -- durationSec is measured off a real WAV's real
 * sample count, which introduces tiny floating-point noise around the
 * intended clean integer (see that shared module's comment for a real
 * confirmed example and why it matters, and why the same snap is also
 * applied as a load-time migration in serialize.ts's deserializeProject
 * for projects saved before this source-side fix landed).
 *
 * existingSlots is every OTHER stem's slot already on the target rifff --
 * this stem's own slot is one past the highest of those (or 0 if the
 * rifff has none), just enough to avoid a collision; no attempt to
 * reproduce real Endlesss instrument-slot semantics.
 *
 * loopBars (the caller's intended bar count) is deliberately unread here
 * (renamed with a leading underscore to satisfy this project's
 * noUnusedParameters) -- durationSec, measured straight off the copied
 * WAV by copyIntoLibrary, already reflects the real captured length that
 * loopBars was supposed to describe, and the barLength formula above only
 * needs durationSec + rifffBpm. Kept as a parameter anyway so the call
 * site's intent ("this many bars, at rifffBpm") stays self-documenting
 * and to mirror importRecordedTake's own signature.
 */
export function importRecordedStem(
  path: string,
  rifffBpm: number,
  _loopBars: number,
  existingSlots: number[] = []
): Stem | null {
  const copied = copyIntoLibrary(path, 'importRecordedStem')
  if (!copied) return null
  const { destPath, durationSec } = copied

  const barLength = snapToWholeBarIfNearlyExact((durationSec * rifffBpm) / 240)
  const slot = existingSlots.length === 0 ? 0 : Math.max(...existingSlots) + 1
  const name = `${randomAdjectiveNoun()} ${new Date().toLocaleTimeString()}`

  return {
    slot,
    author: '',
    name,
    type: 'audioIn',
    path: destPath,
    durationSec,
    barLength,
    recordedInApp: true
  }
}
