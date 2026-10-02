// src/main/remoteStemRenderer.ts
import { execFile } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { app } from 'electron'
import type { EngineProject, EngineStem } from '@shared/buildEngineProject'
import { phoneStemAudioId } from '@shared/phoneLoop'
import { sewLoopPCM16 } from '@shared/loopSewPCM16'

const execFileAsync = promisify(execFile)

/** Part of macOS since forever, and this app is macOS-only, ships a vendored
 * rubberband binary it already spawns, and is not sandboxed
 * (build/entitlements.mac.plist carries only the three JIT/dyld keys). */
const AFCONVERT = '/usr/bin/afconvert'

/** 48000 because that is what an iPhone's AudioContext runs at. Material that
 * arrives at the context's own rate is not resampled, so buffer.length on the
 * phone is EXACTLY the frame count encoded here -- which is what makes the
 * loop point exact without any duration travelling on the wire. */
export const PHONE_STEM_SAMPLE_RATE = 48000

/** TWO CHANNELS. Elling asked for stereo ("stereo ideally", 2026-09-27) over
 * the spec's mono, and this is the one line that decides it -- everything
 * downstream (sewLoopPCM16, the phone's decoded buffer, the memory budget)
 * follows from the file's own channel count rather than from a second
 * assumption written somewhere else.
 *
 * WHAT IT TRADES: float32 in the iOS tab, at 48kHz, is
 * `seconds x 48000 x channels x 4`. Stereo is 6.14 MB per 16-second stem
 * against mono's 3.07 -- 122.9 MB at twenty stems rather than 61.4. It also
 * doubles the bytes over tailscale (~7.7 MB -> ~15 MB for a first load of
 * twelve) and doubles the decode work when twelve stems land at once.
 *
 * IF HIS PHONE CANNOT HOLD IT -- the tab reloading itself mid-listen is the
 * symptom, and it happens with no console to read -- change this to 1 and
 * halve STEM_BUDGET_BYTES in remotePage.ts. Nothing else needs to move:
 * afconvert downmixes, sewLoopPCM16 reads the channel count off the file it
 * is given, and the phone reads it off the decoded buffer. */
export const PHONE_STEM_CHANNELS = 2

/** ALAC in an .m4a. Lossless, and afinfo reports `0 priming` -- an AAC at
 * a quarter the size reports 2112 priming frames, which is 44ms of silence
 * bolted to the front of every stem if WebKit's decodeAudioData does not
 * apply the container's edit list. Twelve sources sample-locked to one clock
 * cannot take that bet. FLAC measures within 1% and is more universal; ALAC
 * is Apple's codec in Apple's container and every browser on iOS is WebKit,
 * so ALAC is the surer decode on the only client there is.
 *
 * IF A REAL IPHONE CANNOT DECODE IT: this is the one line to change. WAV
 * (`['-f', 'WAVE', '-d', 'LEI16']`, content type 'audio/wav') is guaranteed
 * and costs 2.4x the bytes. */
const OUTPUT_ARGS = ['-f', 'm4af', '-d', 'alac']
export const PHONE_STEM_CONTENT_TYPE = 'audio/mp4'

/** Not nativeExport's ten minutes and not even remoteLoopRenderer's thirty
 * seconds. This is two afconvert passes over a few seconds of audio;
 * anything past ten seconds is a hang, and somebody in another room holding
 * a phone cannot wait it out. */
const TRANSCODE_TIMEOUT_MS = 10_000

interface HeldStem {
  resolvedPath: string
  durationSec: number
  volume: number
  /** The row's pan (EngineStem.pan), baked in with the gain. 0 when absent. */
  pan: number
}

export interface RemoteStemRenderer {
  /** Discover slot id -> the 16-hex id of the stem in it. Empty when there
   * is no loop, and empty (deliberately) when the slot ids and the engine
   * stems disagree -- see setLoop. */
  stemIdsBySlotId(): ReadonlyMap<string, string>
  /** Replace the held loop, or clear it. `slotIds` must be one id per
   * EngineStem, in the same order. */
  setLoop(project: EngineProject | null, slotIds: readonly string[]): void
  /** The stem's bytes, transcoding if they are not cached. Null when this
   * id is not in the held loop. Rejects when the transcode failed. */
  bytes(stemId: string): Promise<Buffer | null>
  /** Tests only. */
  cachedIds(): string[]
  stop(): void
}

export function createRemoteStemRenderer(): RemoteStemRenderer {
  const dir = join(app.getPath('temp'), 'sssketch-phone-stems')
  // Sweep anything a previous crash left behind.
  rmSync(dir, { recursive: true, force: true })

  let held = new Map<string, HeldStem>()
  let bySlot = new Map<string, string>()
  const cache = new Map<string, Buffer>()
  const inFlight = new Map<string, Promise<Buffer>>()
  let stopped = false

  async function transcode(stemId: string, stem: HeldStem): Promise<Buffer> {
    mkdirSync(dir, { recursive: true })
    const rawPath = join(dir, `${stemId}.raw.wav`)
    const sewnPath = join(dir, `${stemId}.sewn.wav`)
    const outPath = join(dir, `${stemId}.out`)
    try {
      // Pass 1: whatever it is (ogg / flac / wav / a stretch-cache wav) ->
      // 16-bit at the phone's own rate and channel count. NEVER branch on
      // the extension: a LORE stem's path is a bare StemCID with no
      // extension at all.
      await execFileAsync(
        AFCONVERT,
        [
          '-f',
          'WAVE',
          '-d',
          `LEI16@${PHONE_STEM_SAMPLE_RATE}`,
          '-c',
          String(PHONE_STEM_CHANNELS),
          stem.resolvedPath,
          rawPath
        ],
        { timeout: TRANSCODE_TIMEOUT_MS }
      )
      // Trim to the loop the engine would read, bake the gain and the row's pan, sew the seam.
      const frames = Math.round(stem.durationSec * PHONE_STEM_SAMPLE_RATE)
      writeFileSync(sewnPath, sewLoopPCM16(readFileSync(rawPath), frames, stem.volume, stem.pan))
      // Pass 2: the lossless container the phone decodes.
      await execFileAsync(AFCONVERT, [...OUTPUT_ARGS, sewnPath, outPath], {
        timeout: TRANSCODE_TIMEOUT_MS
      })
      return readFileSync(outPath)
    } finally {
      // The cache holds BYTES, not paths. Nothing this route serves is ever
      // read off disk after this returns, and no temp file outlives the
      // transcode that made it -- a failed pass's partial file included.
      rmSync(rawPath, { force: true })
      rmSync(sewnPath, { force: true })
      rmSync(outPath, { force: true })
    }
  }

  return {
    stemIdsBySlotId: (): ReadonlyMap<string, string> => bySlot,

    setLoop: (project: EngineProject | null, slotIds: readonly string[]): void => {
      if (project === null || stopped) {
        held = new Map()
        bySlot = new Map()
        cache.clear()
        return
      }
      const stems: EngineStem[] = []
      for (const rifff of project.rifffs) for (const stem of rifff.stems) stems.push(stem)

      const nextHeld = new Map<string, HeldStem>()
      const nextBySlot = new Map<string, string>()
      for (let i = 0; i < stems.length; i++) {
        const stem = stems[i]
        const stemId = phoneStemAudioId(stem)
        nextHeld.set(stemId, {
          resolvedPath: stem.resolvedPath,
          durationSec: stem.durationSec,
          volume: stem.volume,
          pan: stem.pan ?? 0
        })
        // FAIL CLOSED. A row that says one stem's name while the phone plays
        // another is the worst bug available here, so a length disagreement
        // gives up the whole map rather than pairing by a guess. The audio
        // simply does not appear, which is visible; a mis-pairing is not.
        if (slotIds.length === stems.length) nextBySlot.set(slotIds[i], stemId)
      }
      if (slotIds.length !== stems.length) {
        console.error(
          `remoteStemRenderer: ${slotIds.length} slot ids for ${stems.length} stems, dropping the map`
        )
      }
      held = nextHeld
      bySlot = nextBySlot
      // A roll changes ONE stem. Everything still in the loop keeps its
      // bytes, so eleven of twelve are never re-rendered and never
      // re-downloaded; only what left is dropped.
      for (const id of [...cache.keys()]) if (!held.has(id)) cache.delete(id)
    },

    bytes: async (stemId: string): Promise<Buffer | null> => {
      if (stopped) return null
      const stem = held.get(stemId)
      if (stem === undefined) return null
      const cached = cache.get(stemId)
      if (cached !== undefined) return cached
      const running = inFlight.get(stemId)
      if (running !== undefined) return await running
      const promise = transcode(stemId, stem)
      inFlight.set(stemId, promise)
      try {
        const buffer = await promise
        // Only cache it if the loop still wants it -- a roll can land while
        // afconvert is running, and caching a stem nobody holds would leak.
        if (!stopped && held.has(stemId)) cache.set(stemId, buffer)
        return buffer
      } finally {
        inFlight.delete(stemId)
      }
    },

    cachedIds: (): string[] => [...cache.keys()],

    stop: (): void => {
      stopped = true
      held = new Map()
      bySlot = new Map()
      cache.clear()
      rmSync(dir, { recursive: true, force: true })
    }
  }
}
