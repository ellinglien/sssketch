// src/main/exportToolkitAudio.ts
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import type { AppState } from '../renderer/src/state/store'
import { buildEngineProject } from '@shared/buildEngineProject'
import { stemKey } from '@shared/types'
import { isStemToolkitNeutral, type ToolkitExportMode } from '@shared/toolkit'
import { spawnEngine } from './engineProcess'
import { EngineClient } from './engineClient'
import { resolveStretchedForExport } from './resolveStretchedForExport'
import { loopLengthBarsFor, riserOnlyState, soloState, withoutRisers } from './nativeExport'

// Same ceiling nativeExport.ts uses for a render-export round trip, and for
// the same reason -- see RENDER_EXPORT_TIMEOUT_MS's own comment there.
const RENDER_EXPORT_TIMEOUT_MS = 10 * 60 * 1000

// Duplicated from exportAudioMaterialization.ts/nativeExport.ts, matching
// their own note to each other: a five-line pure function neither module
// exports, not worth coupling three independent export features over.
function sanitizeFileNamePart(name: string): string {
  return name.replace(/[/\\:*?"<>|]/g, '_').trim() || 'stem'
}

/** Ports of reverbDecaySecondsFor/reverbPreDelaySecondsFor in
 * native-engine/Source/ReverbBus.cpp, and of the 1.5x decay allowance its own
 * tail-runout uses. Only ever used to decide how much EXTRA time a baked clip
 * needs rendered past its own end so its reverb tail isn't chopped off -- a
 * generous over-estimate here costs a little silence at the end of one file,
 * an under-estimate audibly truncates the tail. */
const REVERB_MIN_DECAY_SEC = 0.5
const REVERB_MAX_DECAY_SEC = 8

function reverbTailSeconds(roomSize01: number, preDelayMs: number): number {
  const v = Number.isFinite(roomSize01) ? Math.min(1, Math.max(0, roomSize01)) : 0.5
  const decay =
    REVERB_MIN_DECAY_SEC * Math.pow(REVERB_MAX_DECAY_SEC / REVERB_MIN_DECAY_SEC, v) * 1.5
  const preDelay = Number.isFinite(preDelayMs) ? Math.max(0, preDelayMs) / 1000 : 0
  return decay + preDelay
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

/** Every placed clip whose toolkit actually does something, in a stable
 * order. A fully muted clip is left out: it renders silent, so baking it
 * would spend a whole render producing silence, and the existing dry path
 * already exports it at volume 0 (which is what lets it be brought back with
 * one fader move in the other DAW). */
function clipsToBake(
  state: AppState
): { key: string; rifffName: string; stemName: string; endBar: number; hasSend: boolean }[] {
  const out: {
    key: string
    rifffName: string
    stemName: string
    endBar: number
    hasSend: boolean
  }[] = []
  for (const rifff of Object.values(state.rifffs)) {
    if (rifff.startBar === undefined) continue
    const playedBars = state.playedBars[rifff.groupId] ?? rifff.barLength
    for (const stem of rifff.stems) {
      const key = stemKey(rifff.groupId, stem.slot)
      if (state.mute[key]) continue
      const filter = state.stemFilters?.[key]
      const send = state.stemSends?.[key]
      const automation = state.stemAutomation?.[key]
      if (isStemToolkitNeutral(filter, send, automation)) continue
      out.push({
        key,
        rifffName: rifff.name,
        stemName: stem.name,
        endBar: rifff.startBar + playedBars,
        hasSend: (send ?? 0) > 0 || (automation?.reverbSend?.length ?? 0) > 0
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
  const baking = mode === 'bake' ? clipsToBake(state) : []
  const hasRisers = Object.keys(state.risers ?? {}).length > 0
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
  const tailBarsFor = (hasSend: boolean): number => {
    if (!hasSend || secPerBar <= 0) return 0
    return Math.ceil(
      reverbTailSeconds(reverb?.roomSize ?? 0.5, reverb?.preDelayMs ?? 20) / secPerBar
    )
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
      const tailBars = tailBarsFor(clip.hasSend)

      // Risers are rendered separately (they belong to a channel, not to any
      // one clip), so they're taken out here -- otherwise every baked clip
      // would carry a full copy of every riser.
      const clipState = dryOfPlugins(withoutRisers(soloState(state, new Set([clip.key]), allKeys)))
      const project = await buildEngineProject(clipState, resolveStretchedForExport, pluginCatalog)
      client.send('load-project', project)
      const result = (await client.sendAndAwaitType(
        'render-export',
        { outputPath: join(samplesDir, fileName), durationBars: clip.endBar + tailBars },
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
          durationBars: loopLengthBarsFor(state)
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
