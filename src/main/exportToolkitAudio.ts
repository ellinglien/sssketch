// src/main/exportToolkitAudio.ts
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import type { AppState } from '../renderer/src/state/store'
import { buildEngineProject, timelineStemPans } from '@shared/buildEngineProject'
import { stemKey } from '@shared/types'
import { isStemToolkitNeutral, type ToolkitExportMode } from '@shared/toolkit'
import { audibleRisers } from '@shared/riser'
import { spawnEngine } from './engineProcess'
import { EngineClient } from './engineClient'
import { resolveStretchedForExport } from './resolveStretchedForExport'
import { riserOnlyState, riserRenderBarsFor, soloState, withoutRisers } from './nativeExport'
import { normalizeSoundSettings, REVERB_IR, type ReverbRoom } from '@shared/radioSound'
import { throwDelaySec, throwTailSec } from '@shared/radioThrows'
import {
  timelineDubThrows,
  timelineThrowPlan,
  type ArrangementThrowPlan
} from '@shared/timelineThrows'

// Same ceiling nativeExport.ts uses for a render-export round trip, and for
// the same reason -- see RENDER_EXPORT_TIMEOUT_MS's own comment there.
const RENDER_EXPORT_TIMEOUT_MS = 10 * 60 * 1000

// Duplicated from exportAudioMaterialization.ts/nativeExport.ts, matching
// their own note to each other: a five-line pure function neither module
// exports, not worth coupling three independent export features over.
function sanitizeFileNamePart(name: string): string {
  return name.replace(/[/\\:*?"<>|]/g, '_').trim() || 'stem'
}

/** How long the project's reverb rings after the last thing sent to it, in seconds. Only ever
 * used to decide how much EXTRA time a baked clip needs rendered past its own end so its reverb
 * tail isn't chopped off -- a generous over-estimate here costs a little silence at the end of
 * one file, an under-estimate audibly truncates the tail.
 *
 * - `cavern` (the radio sound's room, native-engine/Source/CavernReverb.h): its impulse is the
 *   pre-delay plus the longest T60 of REVERB_IR (5 s) long, and the convolver's output ends
 *   exactly there, so that is the tail.
 * - `zita`: ports of reverbDecaySecondsFor/reverbPreDelaySecondsFor in
 *   native-engine/Source/ReverbBus.cpp, and of the 1.5x decay allowance its own tail-runout
 *   uses. */
const REVERB_MIN_DECAY_SEC = 0.5
const REVERB_MAX_DECAY_SEC = 8

export function reverbTailSeconds(
  roomSize01: number,
  preDelayMs: number,
  room: ReverbRoom = 'zita'
): number {
  if (room === 'cavern') {
    return REVERB_IR.preDelaySec + Math.max(...REVERB_IR.t60.map(([, t60]) => t60))
  }
  const v = Number.isFinite(roomSize01) ? Math.min(1, Math.max(0, roomSize01)) : 0.5
  const decay =
    REVERB_MIN_DECAY_SEC * Math.pow(REVERB_MAX_DECAY_SEC / REVERB_MIN_DECAY_SEC, v) * 1.5
  const preDelay = Number.isFinite(preDelayMs) ? Math.max(0, preDelayMs) / 1000 : 0
  return decay + preDelay
}

/** The dub echo's loop at its peak (DubDelay.h kDubLoopPeakGain: the decibel-Q filters' +1.74 dB
 * near 2.65 kHz, twice) and the native feedback guard (kDubStableFeedback). Mirrored here only
 * to size bake tails; a little over is harmless. */
const DUB_LOOP_PEAK_GAIN = 1.23
const DUB_STABLE_FEEDBACK = 0.77
/** Chrome's render quantum, added per round trip of the echo (DubDelay.h), at the bakes' rate. */
const DUB_DRIFT_SEC_PER_ROUND_TRIP = 128 / 44100

/** How long a throw's echo rings after its send closes, in seconds, to -60 dB -- sized at the
 * loop's PEAK gain, not the nominal feedback (Task 10's pointer: the 2.65 kHz resonance rings
 * well past the nominal -60 dB; at 0.6, ~22 passes instead of ~13): the first repeat a delay
 * later at full level, then a pass per delay each `feedback x 1.23` as loud, plus Chrome's
 * 128-sample drift every round trip. The echo feeds the room (0.15), so a bake adds the room's
 * own tail after this. */
export function dubTailSeconds(delaySec: number, feedback: number): number {
  if (!(delaySec > 0)) return 0
  const fb = Number.isFinite(feedback) ? Math.min(DUB_STABLE_FEEDBACK, Math.max(0, feedback)) : 0
  const peak = fb * DUB_LOOP_PEAK_GAIN
  const passes = peak > 0 ? throwTailSec(delaySec, peak) / delaySec : 0
  return delaySec * (1 + passes) + Math.ceil(passes / 2) * DUB_DRIFT_SEC_PER_ROUND_TRIP
}

/** One clip rendered with its toolkit already applied. */
export interface BakedClip {
  /** File name inside `<outputDir>/Samples/Imported/`. */
  fileName: string
  /** How far past the clip's own end this render reaches, in bars -- the
   * room left for a reverb tail (0 when the clip has no send). The exporters
   * extend the placed clip by exactly this, or the tail they paid to render
   * would be trimmed off again by the clip's own edge. */
  tailBars: number
}

/**
 * The audio a DAW-project export needs that isn't just a copy of a source
 * stem: clips rendered with the toolkit baked in, and the risers (which are
 * generated, so they have no source file at all and ALWAYS have to be
 * rendered -- Elling's decision, in both export modes).
 */
export interface ToolkitAudio {
  /** stemKey -> the baked render standing in for that clip's source audio.
   * Empty in `automation` mode, where the audio stays dry on purpose. */
  bakedClips: Map<string, BakedClip>
  /** The single file every placed riser was rendered into, laid out on the
   * arrangement's own timeline (so a riser at bar 12 is at bar 12 in the
   * file), or undefined when the project has no risers. */
  riserFileName?: string
}

export const EMPTY_TOOLKIT_AUDIO: ToolkitAudio = { bakedClips: new Map() }

/** What the two project exporters need to know about the toolkit: which mode
 * the user picked, and what audio was rendered for it. Both take this as ONE
 * optional argument that defaults to "bake, nothing rendered" -- which is
 * exactly what a project using none of the toolkit is, so nothing about such
 * a project's export changes.
 *
 * Imported by buildAlsXml.ts/buildRppProject.ts as a TYPE only: this module
 * spawns engines and reaches for Electron, and those two are pure functions
 * with pure tests. */
export interface ToolkitExportOptions {
  mode: ToolkitExportMode
  toolkitAudio: ToolkitAudio
}

/** Every placed clip whose toolkit actually does something, or which the
 * project's per-row panning puts off centre (native radio sound plan, Task 4:
 * a DAW export's stems carry their per-stem stages, pan among them -- Elling's
 * ruling, 2026-10-01), in a stable order. The bake renders the pan into the
 * audio by the engine's own StereoPannerNode law, so the clip sounds as it
 * does here; the `automation` mode instead leaves the audio dry and sets the
 * stem's own track pan (buildAlsXml / buildRppProject). A fully muted clip is
 * left out: it renders silent, so baking it would spend a whole render
 * producing silence, and the existing dry path already exports it at volume 0
 * (which is what lets it be brought back with one fader move in the other
 * DAW). */
export interface ClipToBake {
  key: string
  rifffName: string
  stemName: string
  endBar: number
  hasSend: boolean
  /** Where this clip's last planned throw closes, in absolute bars, when it throws (native radio
   * sound plan, Task 12): its echo, and the room the echo feeds, ring on from there. */
  lastThrowEndBar?: number
}

export function clipsToBake(
  state: AppState,
  /** The timeline's planned throws (timelineThrowPlan), when the project throws: a throwing clip
   * is baked too, since the automation mode has no echo. */
  throwPlan: ArrangementThrowPlan | undefined = timelineThrowPlan(state)
): ClipToBake[] {
  const out: ClipToBake[] = []
  const pans = timelineStemPans(state)
  const lastThrowEnd = new Map<string, number>()
  for (const t of throwPlan?.throws ?? []) {
    lastThrowEnd.set(
      t.stemKey,
      Math.max(lastThrowEnd.get(t.stemKey) ?? -Infinity, t.atBar + t.beats / 4)
    )
  }
  for (const rifff of Object.values(state.rifffs)) {
    if (rifff.startBar === undefined) continue
    const playedBars = state.playedBars[rifff.groupId] ?? rifff.barLength
    for (const stem of rifff.stems) {
      const key = stemKey(rifff.groupId, stem.slot)
      if (state.mute[key]) continue
      const filter = state.stemFilters?.[key]
      const send = state.stemSends?.[key]
      const automation = state.stemAutomation?.[key]
      const throwEnd = lastThrowEnd.get(key)
      if (
        isStemToolkitNeutral(filter, send, automation) &&
        !pans.has(key) &&
        throwEnd === undefined
      )
        continue
      out.push({
        key,
        rifffName: rifff.name,
        stemName: stem.name,
        endBar: rifff.startBar + playedBars,
        hasSend: (send ?? 0) > 0 || (automation?.reverbSend?.length ?? 0) > 0,
        ...(throwEnd !== undefined ? { lastThrowEndBar: throwEnd } : {})
      })
    }
  }
  return out
}

/**
 * Renders whatever a `.als`/`.rpp` export can't express as a plain copy of a
 * source file, into `<outputDir>/Samples/Imported/`:
 *
 * - in `bake` mode, one WAV per clip whose toolkit does something, rendered
 *   through the same engine path playback uses (so filter, send-into-the-
 *   shared-reverb, drawn volume, gain dial and mute regions are all already
 *   in the audio);
 * - in BOTH modes, one WAV holding every placed riser.
 *
 * Every render is laid out on the ARRANGEMENT's own timeline -- a clip at bar
 * 12 sits at bar 12 in its file, after twelve bars of silence. That wastes a
 * little disk and buys the thing that matters: the exporters can reference
 * these files with a source offset that is simply the clip's own start time,
 * with no second coordinate system to keep in step (see buildAlsXml.ts's
 * baked-clip branch, which falls out to `LoopStart = CurrentStart`).
 *
 * Costs one engine subprocess and one offline render per baked clip. A
 * project using none of the toolkit renders nothing and never spawns an
 * engine at all, which is what keeps its export exactly as fast as it was.
 */
export async function renderToolkitAudio(
  state: AppState,
  outputDir: string,
  mode: ToolkitExportMode
): Promise<ToolkitAudio> {
  // The timeline's throws (Task 12): planned once, from the whole project, and given to every
  // clip's render (a clip's own solo state would plan other throws). Only baked clips carry them:
  // the automation mode leaves the audio dry and has no echo (neither DAW session has the bus).
  const throwPlan = mode === 'bake' ? timelineThrowPlan(state) : undefined
  const dubThrows = timelineDubThrows(state, throwPlan)
  const baking = mode === 'bake' ? clipsToBake(state, throwPlan) : []
  // Muted risers are already absent from what the engine would render, so a
  // project whose only risers are muted must not spend a whole extra engine
  // render producing a silent risers.wav nothing references.
  const hasRisers = audibleRisers(state.risers ?? {}).length > 0
  if (baking.length === 0 && !hasRisers) return { bakedClips: new Map() }

  const samplesDir = join(outputDir, 'Samples', 'Imported')
  mkdirSync(samplesDir, { recursive: true })

  const allKeys: string[] = []
  for (const rifff of Object.values(state.rifffs)) {
    if (rifff.startBar === undefined) continue
    for (const stem of rifff.stems) allKeys.push(stemKey(rifff.groupId, stem.slot))
  }

  const secPerBar = state.bpm > 0 ? (60 / state.bpm) * 4 : 0
  const reverb = state.reverb
  // The project's room: a bake keeps it (soloState's stemExportSound), and a project with no
  // sound settings plays zita, as the wire does (buildEngineSound).
  const room: ReverbRoom = state.sound ? normalizeSoundSettings(state.sound).reverb.room : 'zita'
  const roomTailSec = (): number =>
    reverbTailSeconds(reverb?.roomSize ?? 0.5, reverb?.preDelayMs ?? 20, room)
  const tailBarsFor = (clip: ClipToBake): number => {
    if (secPerBar <= 0) return 0
    const sendBars = clip.hasSend ? Math.ceil(roomTailSec() / secPerBar) : 0
    if (clip.lastThrowEndBar === undefined || !throwPlan) return sendBars
    // A throw: its echo rings from where the send closes, and feeds the room, which rings after
    // the last repeat (the echo opens the room whether the clip has a send or not).
    const echoSec =
      dubTailSeconds(throwDelaySec(state.bpm, throwPlan.echo.timing), throwPlan.echo.feedback) +
      roomTailSec()
    const throwBars = clip.lastThrowEndBar - clip.endBar + echoSec / secPerBar
    return Math.max(sendBars, Math.ceil(throwBars))
  }

  // NO plugins in a bake: not the master chain (soloState already zeroes it,
  // for the reason its own doc comment gives) and not the channel chains
  // either. That second one is a deliberate choice rather than an oversight.
  // A .als/.rpp export has never carried plugin processing at all -- it
  // references audio and leaves the effects to the other DAW -- so baking a
  // channel's plugin into the handful of clips that happen to use the toolkit
  // would make exactly those clips sound different from their neighbours on
  // the same channel, and would double up the moment the user loaded that
  // plugin on the track over there. The honest shape is: the bake carries the
  // TOOLKIT, consistently, and plugins stay the user's to re-add. Called out
  // in the export dialog's own note about what each mode loses.
  const dryOfPlugins = (input: AppState): AppState => ({ ...input, channelPlugins: {} })
  const pluginCatalog = { plugins: [] }

  const bakedClips = new Map<string, BakedClip>()
  let riserFileName: string | undefined

  const engineHandle = await spawnEngine()
  const client = new EngineClient()
  try {
    await client.connect(engineHandle.port)

    const usedNames = new Map<string, number>()
    for (const clip of baking) {
      const base = `${sanitizeFileNamePart(clip.rifffName)}-${sanitizeFileNamePart(clip.stemName)}-toolkit`
      const count = (usedNames.get(base) ?? 0) + 1
      usedNames.set(base, count)
      const fileName = count === 1 ? `${base}.wav` : `${base}-${count}.wav`
      const tailBars = tailBarsFor(clip)

      // Risers are rendered separately (they belong to a channel, not to any
      // one clip), so they're taken out here -- otherwise every baked clip
      // would carry a full copy of every riser.
      const clipState = dryOfPlugins(withoutRisers(soloState(state, new Set([clip.key]), allKeys)))
      const project = await buildEngineProject(
        clipState,
        resolveStretchedForExport,
        pluginCatalog,
        {},
        { dubThrows }
      )
      client.send('load-project', project)
      const result = (await client.sendAndAwaitType(
        'render-export',
        {
          outputPath: join(samplesDir, fileName),
          durationBars: clip.endBar + tailBars,
          // Float, not 16-bit: a bake has no master stage, and a panned row's near side is
          // louder than its source (StemPan.h), so 16 bits could clip it.
          sampleFormat: 'float32'
        },
        'render-export-result',
        RENDER_EXPORT_TIMEOUT_MS
      )) as { success: boolean; error?: string }
      if (!result.success) {
        throw new Error(`failed to bake clip "${clip.key}": ${result.error ?? 'unknown error'}`)
      }
      bakedClips.set(clip.key, { fileName, tailBars })
    }

    if (hasRisers) {
      riserFileName = 'risers.wav'
      const project = await buildEngineProject(
        dryOfPlugins(riserOnlyState(state, allKeys)),
        resolveStretchedForExport,
        pluginCatalog
      )
      client.send('load-project', project)
      const result = (await client.sendAndAwaitType(
        'render-export',
        {
          outputPath: join(samplesDir, riserFileName),
          // riserRenderBarsFor, not loopLengthBarsFor: the clips cropped out
          // of this file run to each riser's SOUNDING end, tail included, so
          // the file has to reach that -- see its own doc comment.
          durationBars: riserRenderBarsFor(state)
        },
        'render-export-result',
        RENDER_EXPORT_TIMEOUT_MS
      )) as { success: boolean; error?: string }
      if (!result.success) {
        throw new Error(`failed to render risers: ${result.error ?? 'unknown error'}`)
      }
    }
  } finally {
    client.disconnect()
    engineHandle.stop()
  }

  return { bakedClips, riserFileName }
}
