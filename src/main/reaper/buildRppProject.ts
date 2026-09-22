// src/main/reaper/buildRppProject.ts
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { AppState } from '../../renderer/src/state/store'
import type { BusId, Rifff, SoundType, Stem } from '@shared/types'
import { stemKey } from '@shared/types'
import { packIntoTracks } from '@shared/packIntoTracks'
import { clipLengthBars, edgeFadeState } from '@shared/automationEdit'
import { busGroupName } from '@shared/busNaming'
import type { AutomationPoint } from '@shared/toolkit'
import { filterResonanceQ, isStemToolkitNeutral, normaliseAutomationCurve } from '@shared/toolkit'
// TYPE-ONLY, deliberately and permanently: exportToolkitAudio.ts spawns the
// native engine and reaches for Electron, and this module is a pure function
// with pure tests. A value import from there would drag a subprocess spawner
// into `vitest run`.
import type { BakedClip, ToolkitExportOptions } from '../exportToolkitAudio'
import { rppField, rppBlock, quote, serializeRpp, type RppNode } from './rppNode'

const PROJECT_BEATS_PER_BAR = 4

function secPerBarFor(bpm: number): number {
  return bpm > 0 ? (60 / bpm) * PROJECT_BEATS_PER_BAR : 0
}

// Same derivation as buildAlsXml.ts's own nativeBpmFor -- see that file's
// doc comment for the full reasoning (why durationSec/barLength, why this
// is meaningless for a one-shot). Reimplemented here, not imported: a
// "wire format twin" (see CLAUDE.md), hand-synced with the Ableton
// export's own copy, not code-shared -- the two targets' unit conventions
// (beats vs seconds) are different enough that sharing the caller-facing
// logic would leak one format's assumptions into the other.
function nativeBpmFor(stem: Stem): number {
  const secPerBar = stem.durationSec / stem.barLength
  return 240 / secPerBar
}

function resolvePlayedBarsFor(state: AppState, groupId: string): number {
  const rifff = state.rifffs[groupId]
  return state.playedBars[groupId] ?? rifff.barLength
}

/**
 * A clip's edge fades, in bars, read back out of that stem's own drawn
 * `volume` automation curve -- the one place a clip's fades live now (see
 * applyEdgeFade/edgeFadeState in src/shared/automationEdit.ts). This used
 * to be state.fadeIn/state.fadeOut, a per-RIFFF pair the old envelope drag
 * wrote; curves are per STEM, so two stems of the same rifff can now export
 * different fades, which is simply what the user drew.
 *
 * Only the fade's LENGTH survives into the exported project: a DAW clip
 * fade always ramps between silence and the clip's own level, so a curve
 * that isn't an edge fade -- a mid-clip dip, a slow rise across the whole
 * clip -- exports as no fade at all and is silently lost here. That is the
 * honest limit of "translate automation into clip fades"; writing real
 * automation envelopes into the target project is section 4 of
 * docs/superpowers/specs/2026-09-22-builtin-sound-toolkit-design.md and has
 * not been built. Exported AUDIO is unaffected either way -- the engine
 * bakes the whole curve when it renders the stems.
 */
function edgeFadesFor(
  state: AppState,
  rifff: Rifff,
  stem: Stem,
  playedBars: number,
  leftCropBars: number
): { fadeInBars: number; fadeOutBars: number } {
  // Optional-chained on the map itself, matching buildEngineProject.ts's own
  // `state.stemAutomation?.[key]`: an AppState that predates the toolkit (or
  // a hand-built one) simply has no such record.
  const curve = state.stemAutomation?.[stemKey(rifff.groupId, stem.slot)]?.volume ?? []
  if (curve.length === 0) return { fadeInBars: 0, fadeOutBars: 0 }
  const lengthBars = clipLengthBars({
    playedBars,
    leftCropBars,
    stretchOn: state.stretch[rifff.groupId] ?? true,
    rifffBpm: rifff.bpm,
    stateBpm: state.bpm
  })
  return {
    fadeInBars: edgeFadeState(curve, 'start', lengthBars).bars,
    fadeOutBars: edgeFadeState(curve, 'end', lengthBars).bars
  }
}

interface AudibleSegment {
  segStartSec: number
  segEndSec: number
}

// Same algorithm as buildAlsXml.ts's subtractMutedRanges, operating in
// project-tempo SECONDS instead of beats -- REAPER's own POSITION/LENGTH
// are seconds natively, so there's no beats round-trip needed here.
function subtractMutedRangesSec(
  clipStartSec: number,
  clipEndSec: number,
  mutedRanges: { startBar: number; endBar: number }[],
  secPerBarProject: number
): AudibleSegment[] {
  const sorted = mutedRanges
    .map((r) => ({
      startSec: r.startBar * secPerBarProject,
      endSec: r.endBar * secPerBarProject
    }))
    .sort((a, b) => a.startSec - b.startSec)
  const segments: AudibleSegment[] = []
  let cursor = clipStartSec
  for (const range of sorted) {
    const rangeStart = Math.max(range.startSec, clipStartSec)
    const rangeEnd = Math.min(range.endSec, clipEndSec)
    if (rangeEnd <= cursor) continue
    if (rangeStart > cursor) segments.push({ segStartSec: cursor, segEndSec: rangeStart })
    cursor = Math.max(cursor, rangeEnd)
  }
  if (cursor < clipEndSec) segments.push({ segStartSec: cursor, segEndSec: clipEndSec })
  return segments
}

function newGuid(): string {
  return `{${randomUUID().toUpperCase()}}`
}

// Sampled from the same real, hand-recolored-in-Ableton reference project
// buildAlsXml.ts's own ABLETON_BUS_COLORS is built from (see that file's
// doc comment) -- these exact hex values are src/renderer/src/theme/
// typeColor.ts's own BUS_COLOR_HEX, the actual source palette both exports
// draw from, including that same file's drums/bass swap (2026-08-21) and
// its aux grey-to-taupe swap (2026-09-01, fixing aux reading as visually
// indistinguishable from a muted clip's own grey -- see that file's own
// longer comment) -- keep this in sync by hand if that table ever changes
// again. Kept as its own copy, not imported from typeColor.ts -- this is
// REAPER-native RGB hex, a genuinely different encoding from Ableton's
// palette-index enum, and main-process code importing a renderer theme
// file would cross this codebase's own process boundary for no real
// benefit (see CLAUDE.md's "wire format twins are hand-synced, not
// code-shared" convention).
const REAPER_BUS_COLORS: Record<BusId, string> = {
  drums: '#4a56ad',
  bass: '#e8929b',
  lead: '#c7a4d2',
  backing: '#7fc98a',
  aux: '#a3937a'
}

// REAPER's native track/item color: the high bit (0x01000000) marks "use
// this custom color, not the default", OR'd with a BGR-packed (not RGB)
// int -- confirmed against REAPER's own SWS extension source
// (Color/Color.cpp's SWS_ColorToNative, which swaps R/B to produce
// Windows-COLORREF-style native colors on every platform), AND confirmed
// against a real export opened in real REAPER (colors, PLAYRATE, and
// tiling all render correctly) -- see the design doc's "Manual
// verification" section.
function colorInt(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return 0x01000000 | (b << 16) | (g << 8) | r
}

/** FADEIN/FADEOUT field: `<applies?> <lengthSec> 0 1 0 0` when there's a
 * real fade to write, else the template-equivalent all-zero default
 * `0 0 0 1 0 0` -- trailing fields (curve/skew-adjacent) copied verbatim
 * from a real REAPER-produced example, not independently derived (see the
 * design doc). Clamped to at most half the segment's own duration,
 * mirroring buildAlsXml.ts's own applyFade -- a fade can't outlast the
 * audible span it's fading. */
function fadeField(
  tag: 'FADEIN' | 'FADEOUT',
  applies: boolean,
  fadeBars: number,
  segmentDurationSec: number,
  secPerBarProject: number
): RppNode {
  if (!applies || fadeBars <= 0) return rppField(tag, 0, 0, 0, 1, 0, 0)
  const maxFadeSec = segmentDurationSec / 2
  const lengthSec = Math.min(fadeBars * secPerBarProject, maxFadeSec)
  return rppField(tag, 1, lengthSec, 0, 1, 0, 0)
}

// ---------------------------------------------------------------------------
// Everything from here to the end of this banner is CAPTURED, not designed.
//
// Its source is `doop.RPP` -- a real REAPER 7.78/macOS-arm64 project Elling
// built by hand for exactly this purpose: one track carrying a volume
// envelope and a ReaEQ with a swept Low Pass band, plus a `reverb bus` track
// carrying a ReaVerbate and a send envelope. It is ground truth, and
// docs/superpowers/references/reaper-automation-mapping.md is the write-up of
// it. The reference doc's own closing warning is the reason none of this is
// invented: "a parameter envelope whose name/index doesn't match the plugin's
// actual parameter silently does nothing" -- there is no error, no missing
// device, just a dead lane the user has no way to notice.
//
// So: copied out of that file verbatim, right down to the base64 state lines
// and the `''` REAPER itself writes for an empty AUXRECV name. Do not
// "tidy" any of it. The one exception is called out at REAEQ_BW_PARAM below.
// ---------------------------------------------------------------------------

/** The `<VST …>` header params for ReaEQ, verbatim from doop.RPP line 154.
 * The `1919247729<5653547265657172656165710…>` token is REAPER's own
 * plugin-identity blob; it contains a `<` and is still a single
 * space-delimited param, which rppNode.ts's splitLine handles because the
 * token has no spaces or quotes in it. */
const REAEQ_VST_PARAMS = [
  '"VST: ReaEQ (Cockos)"',
  'reaeq.vst.dylib',
  '0',
  '""',
  '1919247729<56535472656571726561657100000000>',
  '""'
]

/**
 * ReaEQ's own serialized state, verbatim from doop.RPP lines 155-159.
 *
 * This blob is the whole reason the export works at all. ReaEQ's parameter
 * NAMES follow its band TYPES: the parameter is called `Freq-Low Pass 1`
 * only because band 1 of this saved state is a Low Pass. Synthesising a
 * "blank" ReaEQ would give band 1 ReaEQ's default type and the cutoff
 * envelope would address a parameter that doesn't exist -- which, per the
 * reference doc, fails silently. Decoding it confirms the shape: five bands,
 * 33-byte records of `[int type][int enabled][double freq][double gain]
 * [double bandwidth][byte]`, with band 1 = type 3 (Low Pass), 100 Hz,
 * bandwidth 0.8 octaves.
 *
 * KNOWN LIMITATION, stated here rather than hidden: this captured band is a
 * LOW PASS, and it is the only ReaEQ state we have. A clip whose filter mode
 * is `highpass` therefore exports its cutoff curve onto a low-pass band --
 * the sweep happens, but in the wrong direction. Fixing that needs a SECOND
 * capture (a real REAPER project whose ReaEQ band 1 is a High Pass, giving
 * both a second blob and the `Freq-High Pass 1` parameter name), which
 * cannot be produced from here -- a coding agent has no REAPER. Until then a
 * highpass clip is better served by `bake` mode.
 */
const REAEQ_STATE_LINES = [
  'cWVlcu5e7f4CAAAAAQAAAAAAAAACAAAAAAAAAAIAAAABAAAAAAAAAAIAAAAAAAAAzQAAAAEAAAAAABAA',
  'IQAAAAUAAAADAAAAAQAAACtgJvb//1hAAAAAAAAA8D+amZmZmZnpPwEIAAAAAQAAAAAAAAAAwHJAAAAAAAAA8D8AAAAAAAAAQAEIAAAAAQAAAAAAAAAAQI9AAAAAAAAA',
  '8D8AAAAAAAAAQAEBAAAAAQAAAAAAAAAAiLNAAAAAAAAA8D+amZmZmZnpPwEEAAAAAAAAAAAAAAAAAFlAAAAAAAAA8D8AAAAAAAAAQAEBAAAAAQAAAAAAAAAAAPA/AAAA',
  'AEACAABsAQAAAgABAA==',
  'AAAQAAAA'
]

/** ReaVerbate's `<VST …>` header params and state, verbatim from doop.RPP
 * lines 225-228. Stock REAPER, so it loads with no plugin install on any
 * machine -- the whole point of mapping onto the target DAW's own devices
 * (spec section 4). */
const REAVERBATE_VST_PARAMS = [
  '"VST: ReaVerbate (Cockos)"',
  'reaverbate.vst.dylib',
  '0',
  '""',
  '1920361016<56535472766238726561766572626174>',
  '""'
]

const REAVERBATE_STATE_LINES = [
  'OGJ2cu9e7f4CAAAAAQAAAAAAAAACAAAAAAAAAAIAAAABAAAAAAAAAAIAAAAAAAAAKAAAAAAAAAAAABAA',
  '776t3g3wrd5DAgA/AACAP5eWlj4AAAA/AACAPwAAAAAAAIA/AAAAAA==',
  'AAAQAAAA'
]

/** The cutoff parameter, verbatim from doop.RPP line 163. */
const REAEQ_CUTOFF_PARAM = '0:_Freq_Low_Pass_1'
const REAEQ_CUTOFF_PARAM_LABEL = 'Freq-Low Pass 1 / ReaEQ'

/**
 * The bandwidth (resonance) parameter -- THE ONE THING IN THIS FILE WITH NO
 * CAPTURED GROUND TRUTH BEHIND IT. Say so out loud, because everything
 * around it is copied and this isn't.
 *
 * doop.RPP only ever automated the cutoff, so it contains exactly one
 * PARMENV and therefore exactly one known index/name pair. This one is
 * INFERRED from the decoded ReaEQ state above: each band record carries
 * frequency, then gain, then bandwidth, so band 1's three parameters should
 * be indices 0, 1 and 2, and REAPER's mangling of the display name
 * "Freq-Low Pass 1" into `_Freq_Low_Pass_1` should turn "BW-Low Pass 1" into
 * `_BW_Low_Pass_1`. Both halves of that are a guess.
 *
 * NEEDS CHECKING IN REAL REAPER. If the guess is wrong, REAPER ignores the
 * envelope silently (the reference doc's warning again) and the band keeps
 * the bandwidth baked into the captured state -- so the failure mode is
 * "resonance dial had no effect", not a broken project. That is why this is
 * only written when `resonance > 0`: a clip that never touched the dial must
 * keep ReaEQ's own captured default rather than being overridden by a guess.
 */
const REAEQ_BW_PARAM = '2:_BW_Low_Pass_1'
const REAEQ_BW_PARAM_LABEL = 'BW-Low Pass 1 / ReaEQ'

/** ReaEQ's bandwidth range, in octaves, used only to normalise the resonance
 * dial into the 0..1 a PARMENV wants. Also inferred -- see REAEQ_BW_PARAM.
 * The sanity check that made these plausible: our lowest Q (0.7071,
 * Butterworth, no peak at all) converts to 1.90 octaves, a hair under the
 * 2.0-octave bandwidth the captured state's own non-swept bands sit at. */
const REAEQ_BW_MIN_OCTAVES = 0.01
const REAEQ_BW_MAX_OCTAVES = 4

/**
 * The resonance dial as ReaEQ's own normalised bandwidth parameter.
 *
 * Three conversions stacked, only the first of which is solid:
 * 1. dial -> Q, via filterResonanceQ (@shared/toolkit) -- a deliberate port
 *    of the engine's own mapping, so the exported Q is the Q being heard;
 * 2. Q -> bandwidth in octaves, the standard EQ identity
 *    `N = (2/ln2) * asinh(1/(2Q))` -- bandwidth is the INVERSE of Q, so a
 *    resonant clip exports as a NARROW band, and turning the dial up moves
 *    this number DOWN;
 * 3. octaves -> 0..1 over ReaEQ's own range, linearly -- inferred, see above.
 */
function reaEqBandwidthNormalised(resonance01: number): number {
  const q = filterResonanceQ(resonance01)
  const octaves = (2 / Math.LN2) * Math.asinh(1 / (2 * q))
  const norm = (octaves - REAEQ_BW_MIN_OCTAVES) / (REAEQ_BW_MAX_OCTAVES - REAEQ_BW_MIN_OCTAVES)
  return Math.min(1, Math.max(0, norm))
}

/** The six lines every envelope block in doop.RPP opens with, in its order.
 * `ACT 1 -1` active, `VIS 1 1 1` visible, `ARM 1` armed, `DEFSHAPE 0 -1 -1`
 * linear by default. A fresh EGUID per envelope -- REAPER keys envelopes by
 * it, so two envelopes sharing one is a corrupt project. */
function envelopeHeader(): RppNode[] {
  return [
    rppField('EGUID', newGuid()),
    rppField('ACT', 1, -1),
    rppField('VIS', 1, 1, 1),
    rppField('LANEHEIGHT', 0, 0),
    rppField('ARM', 1),
    rppField('DEFSHAPE', 0, -1, -1)
  ]
}

/** `PT <time in SECONDS> <value> <shape>`, shape 0 = linear. Seconds, not
 * beats: REAPER's whole project state is seconds-native (POSITION and LENGTH
 * already are, a few lines up), which is the single biggest difference from
 * the Ableton export's beat-based envelopes. */
function ptField(timeSec: number, value: number): RppNode {
  return rppField('PT', timeSec, value, 0)
}

/** A clip-relative curve's points as absolute-timeline PT lines.
 *
 * `originSec` is the clip's own left edge in seconds -- the same number the
 * item's POSITION got. Curve bars are CLIP-RELATIVE (bar 0 = the clip's left
 * edge, not the arrangement's; see @shared/toolkit's AutomationPoint), so
 * this conversion is the REAPER-side twin of buildEngineProject.ts's
 * `clipOriginBar`. Taken from the built item's own start rather than
 * re-derived from `startBar + leftCropBars`, deliberately: the one-shot
 * branch of buildStemItems places a clip WITHOUT leftCropBars, so
 * re-deriving would put a one-shot's envelope somewhere its own clip isn't. */
function curveToPoints(
  curve: AutomationPoint[],
  originSec: number,
  secPerBarProject: number,
  valueOf: (value: number) => number = (v) => v
): RppNode[] {
  return curve.map((point) =>
    ptField(originSec + point.bar * secPerBarProject, valueOf(point.value))
  )
}

interface StemItemsResult {
  items: RppNode[]
  trackLabel: string
  soundType: SoundType
  startSec: number
  endSec: number
  /** stemKey(groupId, slot) -- only needed in `automation` mode, where the
   * track this stem lands on has to go looking for that stem's curves. */
  key: string
}

/**
 * Builds the ITEM nodes for one stem -- one per audible segment (see
 * subtractMutedRangesSec) -- mirroring buildAlsXml.ts's own
 * buildStemClips, but in REAPER's seconds-native, playrate-based model
 * instead of Ableton's beats/warp-marker one. Does not build a TRACK --
 * callers combine multiple stems' items onto a shared track via
 * packIntoTracks, same as the Ableton export.
 */
function buildStemItems(
  rifff: Rifff,
  stem: Stem,
  fileName: string,
  leftCropBars: number,
  playedBars: number,
  projectBpm: number,
  muteRegions: AppState['muteRegions'],
  muted: boolean,
  volume: number,
  fadeInBars: number,
  fadeOutBars: number,
  /** Set when this clip's audio is a BAKED render standing in for the dry
   * stem (`bake` mode) -- see the baked branch below. */
  baked: BakedClip | undefined,
  /** Set when a real track volume ENVELOPE is going to be written for this
   * stem (`automation` mode) -- see the branch below. */
  volumeEnvelopeWritten: boolean
): StemItemsResult {
  const secPerBarProject = secPerBarFor(projectBpm)
  const trackLabel = `${rifff.name} - ${stem.name}`
  const key = stemKey(rifff.groupId, stem.slot)

  let clipStartSec: number
  let clipLengthSec: number
  let soffsSec: number
  let playrate: number
  let loop: boolean

  if (stem.oneShot) {
    const trimStart = stem.trimStartSec ?? 0
    const trimEnd = stem.trimEndSec ?? stem.durationSec
    clipStartSec = (rifff.startBar ?? 0) * secPerBarProject
    clipLengthSec = trimEnd - trimStart
    soffsSec = trimStart
    playrate = 1
    loop = false
  } else {
    const nativeBpm = nativeBpmFor(stem)
    const secPerBarNative = secPerBarFor(nativeBpm)
    const wrappedLeftCropBars = ((leftCropBars % stem.barLength) + stem.barLength) % stem.barLength
    clipStartSec = ((rifff.startBar ?? 0) + leftCropBars) * secPerBarProject
    clipLengthSec = (playedBars - leftCropBars) * secPerBarProject
    soffsSec = wrappedLeftCropBars * secPerBarNative
    playrate = projectBpm / nativeBpm
    loop = true
  }

  const clipEndSec = clipStartSec + clipLengthSec
  const muteRegionsForStem = muteRegions[key] ?? []
  const audibleSegments = subtractMutedRangesSec(
    clipStartSec,
    clipEndSec,
    muteRegionsForStem,
    secPerBarProject
  )

  const relativePath = join('Samples', 'Imported', fileName)

  if (baked) {
    // ONE item, and almost every field above is deliberately thrown away.
    //
    // A baked render is this clip played through the same engine graph
    // playback uses, written out on the ARRANGEMENT's own timeline -- bar 0
    // of the file is bar 0 of the arrangement (see renderToolkitAudio's own
    // doc comment on why it wastes the disk to buy this). So the mapping
    // from file time to project time is the identity: POSITION and SOFFS are
    // both just the clip's start, and there is no second coordinate system
    // to keep in step. Hence also PLAYRATE 1 and LOOP 0 -- the render was
    // made at the project's tempo with the tiling already performed, so
    // re-rating or re-looping it would play it twice over.
    //
    // LENGTH reaches past the clip's own end by `tailBars`. That is the room
    // renderToolkitAudio paid to render for a reverb tail; trimming back to
    // clipEndSec would throw away audio that was deliberately produced, and
    // the ring-out would stop dead at the clip edge.
    //
    // VOLPAN gain is 1 and the fades are the all-zero default because BOTH
    // are already in the samples: the render applied the gain dial and the
    // whole drawn volume curve (edge fades included). Applying the dial
    // again here would square it; re-deriving the fades would fade audio
    // that has already faded.
    //
    // No mute-region splitting, for the same reason: the mute regions are
    // baked in as silence. Splitting a baked clip would additionally chop
    // any reverb tail ringing THROUGH a muted gap, which is exactly the
    // sound the user asked for by muting over a wash.
    const lengthSec = clipEndSec + baked.tailBars * secPerBarProject - clipStartSec
    const items = [
      rppBlock(
        'ITEM',
        [],
        [
          rppField('POSITION', clipStartSec),
          rppField('LENGTH', lengthSec),
          rppField('LOOP', 0),
          fadeField('FADEIN', false, 0, lengthSec, secPerBarProject),
          fadeField('FADEOUT', false, 0, lengthSec, secPerBarProject),
          rppField('MUTE', muted ? 1 : 0),
          rppField('IGUID', newGuid()),
          rppField('NAME', quote(trackLabel)),
          rppField('VOLPAN', 1, 0, 1, -1),
          rppField('SOFFS', clipStartSec),
          rppField('PLAYRATE', 1, 1, 0, -1, 0, -1),
          rppField('GUID', newGuid()),
          rppBlock('SOURCE', ['WAVE'], [rppField('FILE', quote(relativePath))])
        ]
      )
    ]
    // endSec stays the clip's own end, NOT the end of the tail: the tail is a
    // ring-out, not new material, and letting it push the packing end out
    // would open a second track just so a decaying reverb could have the
    // first one to itself. REAPER plays overlapping items on one track
    // simultaneously, which is exactly what the tail does in sssketch too.
    return {
      items,
      trackLabel,
      soundType: stem.type,
      startSec: clipStartSec,
      endSec: clipEndSec,
      key
    }
  }
  // One full tile cycle, in native seconds, is exactly the stem's own
  // durationSec -- the same exact (not approximate) relationship
  // nativeBpmFor's own doc comment in buildAlsXml.ts relies on.
  const tileLengthSec = stem.durationSec

  const items = audibleSegments.map((segment, segmentIndex) => {
    const segmentDurationSec = segment.segEndSec - segment.segStartSec
    const elapsedFromClipStart = segment.segStartSec - clipStartSec
    // A segment resuming after a muted gap needs its own source offset
    // advanced by however much time elapsed since the clip's true start,
    // wrapped into one tile cycle for a looped stem -- or the audio would
    // jump back to the tile's very start on every resume (mirrors
    // buildAlsXml.ts's own tilePhaseAtElapsedBeats, in seconds).
    const segSoffsSec = loop
      ? (((soffsSec + elapsedFromClipStart) % tileLengthSec) + tileLengthSec) % tileLengthSec
      : soffsSec + elapsedFromClipStart

    return rppBlock(
      'ITEM',
      [],
      [
        rppField('POSITION', segment.segStartSec),
        rppField('LENGTH', segmentDurationSec),
        rppField('LOOP', loop ? 1 : 0),
        // A real volume envelope supersedes both of these. The fades are
        // derived FROM the volume curve (edgeFadesFor above exists precisely
        // because a clip fade was the only place to put a curve before this
        // mode existed) and the envelope now carries that same shape in
        // full, so keeping the fades would apply the ramp twice. The gain
        // dial is likewise already multiplied through the envelope's values
        // -- see buildVolumeEnvelope.
        fadeField(
          'FADEIN',
          segmentIndex === 0 && !volumeEnvelopeWritten,
          fadeInBars,
          segmentDurationSec,
          secPerBarProject
        ),
        fadeField(
          'FADEOUT',
          segmentIndex === audibleSegments.length - 1 && !volumeEnvelopeWritten,
          fadeOutBars,
          segmentDurationSec,
          secPerBarProject
        ),
        rppField('MUTE', muted ? 1 : 0),
        rppField('IGUID', newGuid()),
        rppField('NAME', quote(trackLabel)),
        rppField('VOLPAN', volumeEnvelopeWritten ? 1 : volume, 0, 1, -1),
        rppField('SOFFS', segSoffsSec),
        rppField('PLAYRATE', playrate, 1, 0, -1, 0, -1),
        rppField('GUID', newGuid()),
        rppBlock('SOURCE', ['WAVE'], [rppField('FILE', quote(relativePath))])
      ]
    )
  })

  return {
    items,
    trackLabel,
    soundType: stem.type,
    startSec: clipStartSec,
    endSec: clipEndSec,
    key
  }
}

const BUS_IDS: BusId[] = ['drums', 'bass', 'lead', 'backing', 'aux']
const DEFAULT_BUS: BusId = 'aux'

/**
 * One clip's toolkit, resolved into exactly the numbers the REAPER side
 * needs. Only built in `automation` mode; `bake` mode's answer to all of
 * this is "it's already in the audio".
 */
interface StemToolkitPlan {
  /** The clip's left edge in seconds -- every curve below is measured from
   * here (see curveToPoints). */
  originSec: number
  /** Already normalised AND already multiplied by the gain dial. Empty means
   * "no volume envelope", which is a different thing from "a flat one". */
  volumeCurve: AutomationPoint[]
  /** The static send, as the AUXRECV line's own gain. */
  sendLevel: number
  sendCurve: AutomationPoint[]
  /** Whether a ReaEQ belongs on this track at all -- a non-neutral static
   * cutoff, or a drawn cutoff curve. */
  filterActive: boolean
  filterCutoffCurve: AutomationPoint[]
  filterStaticCutoff: number
  /** Only written when > 0 -- see REAEQ_BW_PARAM. */
  resonance: number
}

function buildStemToolkitPlan(state: AppState, key: string, originSec: number): StemToolkitPlan {
  // Optional-chained on the maps themselves, matching buildEngineProject.ts's
  // own `state.stemAutomation?.[key]`: a hand-built AppState (every test
  // helper in this file's own spec, for one) simply has no such record.
  const filter = state.stemFilters?.[key]
  const automation = state.stemAutomation?.[key]
  const gain = state.vol[key] ?? 1
  const volumeCurve = normaliseAutomationCurve(automation?.volume ?? [])
  return {
    originSec,
    // The dial times the shape, exactly as buildEngineProject.ts's
    // scaleCurveByGain does on the way to the engine -- the engine
    // MULTIPLIES the two, so an export that wrote only the curve would play
    // back louder than sssketch does for any clip whose dial is below unity.
    // The item's own VOLPAN is set to 1 in that case (see buildStemItems),
    // so the dial is applied exactly once here too.
    volumeCurve: volumeCurve.map((point) => ({ bar: point.bar, value: point.value * gain })),
    sendLevel: state.stemSends?.[key] ?? 0,
    sendCurve: normaliseAutomationCurve(automation?.reverbSend ?? []),
    // Reuses isStemToolkitNeutral rather than re-deriving "is this cutoff at
    // its neutral end", so the export can't drift from the rule the wire
    // format and the engine already share (including its 1e-6 tolerance for
    // a slider that came back from JSON a hair off its end stop). The send
    // and volume arguments are blanked out so this asks about the FILTER
    // only.
    filterActive: !isStemToolkitNeutral(filter, undefined, {
      filterCutoff: automation?.filterCutoff ?? []
    }),
    filterCutoffCurve: normaliseAutomationCurve(automation?.filterCutoff ?? []),
    filterStaticCutoff: filter?.cutoff ?? 1,
    resonance: filter?.resonance ?? 0
  }
}

/** The track's own `<VOLENV2>`. Values are LINEAR GAIN, which is what our
 * [0,1] curve already is (1 = unity = 0 dB; doop.RPP's own capture runs up to
 * 1.90998517 ≈ +5.6 dB, which our curve simply can't reach -- a drawn curve
 * can attenuate but never boost). */
function buildVolumeEnvelope(plan: StemToolkitPlan, secPerBarProject: number): RppNode {
  return rppBlock(
    'VOLENV2',
    [],
    [
      ...envelopeHeader(),
      rppField('VOLTYPE', 1),
      ...curveToPoints(plan.volumeCurve, plan.originSec, secPerBarProject)
    ]
  )
}

/**
 * The track's `<FXCHAIN>`: the captured ReaEQ, its cutoff envelope, and --
 * only when the dial was actually turned up -- a one-point bandwidth
 * envelope standing in for resonance.
 *
 * The cutoff values pass through UNCONVERTED, and that is the interesting
 * part. REAPER's parameter envelopes are NORMALISED 0..1, not real units
 * (docs/superpowers/references/reaper-automation-mapping.md's table says so
 * explicitly, in bold). Our cutoff dial is already a normalised 0..1
 * position on a log frequency scale -- the same shape a DAW's own frequency
 * control uses -- so this is the one conversion in the whole toolkit export
 * that is a genuine no-op. The Ableton export is the opposite case: Auto
 * Filter's Frequency automation is in real Hz, which is what
 * @shared/toolkit's `filterCutoffHz` was ported from the engine to provide.
 *
 * What could NOT be verified from the capture: that ReaEQ's own normalised
 * frequency scale is the same 20Hz..20kHz log scale ours is. doop.RPP's
 * saved band sits at 100 Hz while its envelope reads 0.14143807 at the edit
 * cursor, and those two don't reconcile under a 20Hz..20kHz log mapping --
 * most likely because the saved band value is stale (the envelope was drawn
 * without transport running, so the plugin's own parameter never followed
 * it), but it could also mean ReaEQ normalises over a different range. A
 * mismatch would put the sweep in the right direction at the wrong pitch.
 * Checking it needs real REAPER, which a coding agent does not have.
 */
function buildFilterChain(plan: StemToolkitPlan, secPerBarProject: number): RppNode {
  const cutoffPoints =
    plan.filterCutoffCurve.length > 0
      ? curveToPoints(plan.filterCutoffCurve, plan.originSec, secPerBarProject)
      : // A static, non-neutral cutoff and nothing drawn: one point is a flat
        // envelope, which REAPER holds forever in both directions.
        [ptField(plan.originSec, Math.min(1, Math.max(0, plan.filterStaticCutoff)))]

  const children: RppNode[] = [
    rppField('SHOW', 0),
    rppField('LASTSEL', 0),
    rppField('DOCKED', 0),
    rppField('BYPASS', 0, 0, 0),
    rppBlock(
      'VST',
      REAEQ_VST_PARAMS,
      REAEQ_STATE_LINES.map((line) => rppField(line))
    ),
    rppField('FLOATPOS', 0, 0, 0, 0),
    rppField('FXID', newGuid()),
    rppBlock(
      'PARMENV',
      [REAEQ_CUTOFF_PARAM, 0, 1, 0.5, quote(REAEQ_CUTOFF_PARAM_LABEL)],
      [...envelopeHeader(), ...cutoffPoints]
    )
  ]

  // Resonance is a STATIC device value, not an envelope -- spec section 2c,
  // after Elling used a resonance LANE and found it read as broken (a
  // resonance curve on a clip whose cutoff isn't moving is inaudible). One
  // point, so REAPER holds it flat over the whole project.
  if (plan.resonance > 0) {
    children.push(
      rppBlock(
        'PARMENV',
        [REAEQ_BW_PARAM, 0, 1, 0.5, quote(REAEQ_BW_PARAM_LABEL)],
        [...envelopeHeader(), ptField(plan.originSec, reaEqBandwidthNormalised(plan.resonance))]
      )
    )
  }

  // Makes the swept parameter visible in the track control panel, so the
  // user can see the lane REAPER just loaded rather than having to go
  // hunting for it. Optional per the reference doc; worth it.
  children.push(rppField('PARM_TCP', REAEQ_CUTOFF_PARAM))
  children.push(rppField('WAK', 0, 0))
  return rppBlock('FXCHAIN', [], children)
}

/** One track's send into the shared reverb bus, as the bus track sees it. */
interface ReverbSend {
  /** 0-based index of the SENDING track in the emitted track list -- what
   * AUXRECV's first field names. Captured at push time rather than derived
   * afterwards, because the bus track is appended last and nothing may
   * renumber the tracks in between. */
  sourceTrackIndex: number
  level: number
  curve: AutomationPoint[]
  originSec: number
}

/**
 * The single `reverb bus` track: the captured ReaVerbate, plus one AUXRECV
 * per sending track and, immediately after it, that send's own AUXVOLENV.
 *
 * THE THING THAT IS EASY TO GET BACKWARDS, called out in the reference doc
 * for exactly this reason: a send envelope lives on the RECEIVING track, not
 * on the track doing the sending. So every AUXVOLENV in the project sits
 * here, in this one block, in the same order as the AUXRECV lines it belongs
 * to. Putting them on the source tracks would produce a project that loads
 * cleanly and has no send automation at all.
 *
 * One bus, not one per clip: that mirrors sssketch's own architecture
 * exactly (the engine has ONE shared zita-rev1 fed by per-clip sends -- spec
 * section 1), so the exported project is shaped like the thing it came from.
 */
function buildReverbBusTrack(sends: ReverbSend[], secPerBarProject: number): RppNode {
  const children: RppNode[] = [
    rppField('NAME', quote('reverb bus')),
    rppField('PEAKCOL', colorInt(REAPER_BUS_COLORS[DEFAULT_BUS])),
    rppField('MUTESOLO', 0, 0, 0)
  ]

  for (const send of sends) {
    // Verbatim shape from doop.RPP line 201, including the `''` REAPER
    // writes for an unnamed send. Field 3 is the send's own gain.
    //
    // With a curve, that gain is 1 and the level lives in the envelope --
    // which is exactly what the capture shows REAPER itself doing (its
    // AUXRECV reads 1 while its AUXVOLENV sweeps 0.077 -> 0.588). An active
    // armed envelope overrides the fader anyway, so the alternative would be
    // a number nobody ever hears. Without a curve there IS no envelope, and
    // the static send is the gain.
    const gain = send.curve.length > 0 ? 1 : send.level
    children.push(
      rppField('AUXRECV', send.sourceTrackIndex, 0, gain, 0, 0, 0, 0, 0, 0, '-1:U', 0, -1, "''")
    )
    if (send.curve.length > 0) {
      children.push(
        rppBlock(
          'AUXVOLENV',
          [],
          [
            ...envelopeHeader(),
            rppField('VOLTYPE', 1),
            // Linear gain again, and again a straight pass-through: our send
            // amount is a [0,1] wet level, and 1 is unity on a REAPER send.
            ...curveToPoints(send.curve, send.originSec, secPerBarProject)
          ]
        )
      )
    }
  }

  children.push(
    rppBlock(
      'FXCHAIN',
      [],
      [
        rppField('SHOW', 0),
        rppField('LASTSEL', 0),
        rppField('DOCKED', 0),
        rppField('BYPASS', 0, 0, 0),
        rppBlock(
          'VST',
          REAVERBATE_VST_PARAMS,
          REAVERBATE_STATE_LINES.map((line) => rppField(line))
        ),
        rppField('FLOATPOS', 0, 0, 0, 0),
        rppField('FXID', newGuid()),
        rppField('WAK', 0, 0)
      ]
    )
  )

  return rppBlock('TRACK', [newGuid()], children)
}

/**
 * The `risers` track(s): one ITEM per placed riser, in BOTH export modes.
 *
 * Risers are GENERATED -- there is no source file to reference dry and no
 * device in any DAW that would reproduce one -- so they always come out as
 * rendered audio whichever mode the user picked (Elling's decision, spec
 * section 4). All of them live in ONE rendered file laid out on the
 * arrangement's own timeline, so each item's source offset is simply its own
 * position: the same identity mapping a baked clip uses, for the same
 * reason.
 *
 * Sorted by startBar with `id` as the tiebreak, mirroring
 * buildEngineProject.ts's own riser ordering so a project exports the same
 * bytes across a save/load round trip (Object.values over a record is not a
 * stable order).
 *
 * Two risers that OVERLAP in time go through packIntoTracks onto separate
 * `risers` tracks rather than stacking on one -- REAPER would play both, but
 * they would be drawn on top of each other and be unusable to edit.
 */
function buildRiserTracks(
  state: AppState,
  riserFileName: string,
  secPerBarProject: number
): RppNode[] {
  const risers = Object.values(state.risers ?? {}).sort(
    (a, b) => a.startBar - b.startBar || a.id.localeCompare(b.id)
  )
  if (risers.length === 0) return []

  const placed = risers.map((riser) => {
    const startSec = riser.startBar * secPerBarProject
    const lengthSec = riser.lengthBars * secPerBarProject
    return {
      startSec,
      endSec: startSec + lengthSec,
      item: rppBlock(
        'ITEM',
        [],
        [
          rppField('POSITION', startSec),
          rppField('LENGTH', lengthSec),
          rppField('LOOP', 0),
          fadeField('FADEIN', false, 0, lengthSec, secPerBarProject),
          fadeField('FADEOUT', false, 0, lengthSec, secPerBarProject),
          rppField('MUTE', 0),
          rppField('IGUID', newGuid()),
          rppField('NAME', quote('riser')),
          // The riser's own level dial is already in the rendered swell --
          // it IS the swell -- so the item plays at unity.
          rppField('VOLPAN', 1, 0, 1, -1),
          rppField('SOFFS', startSec),
          rppField('PLAYRATE', 1, 1, 0, -1, 0, -1),
          rppField('GUID', newGuid()),
          rppBlock(
            'SOURCE',
            ['WAVE'],
            [rppField('FILE', quote(join('Samples', 'Imported', riserFileName)))]
          )
        ]
      )
    }
  })

  return packIntoTracks(
    placed,
    (p) => p.startSec,
    (p) => p.endSec
  ).map((group) =>
    rppBlock(
      'TRACK',
      [newGuid()],
      [
        rppField('NAME', quote('risers')),
        // A riser belongs to an arranger ROW, not to a bus -- it has no entry
        // in state.busOf and nothing to derive a sound type from. The aux
        // colour is the honest answer: aux is already where this exporter puts
        // material with no bus of its own (DEFAULT_BUS).
        rppField('PEAKCOL', colorInt(REAPER_BUS_COLORS[DEFAULT_BUS])),
        rppField('MUTESOLO', 0, 0, 0),
        ...group.map((p) => p.item)
      ]
    )
  )
}

/**
 * Builds the finished `.rpp` project text for the current arrangement.
 * Pure: no filesystem access at all (unlike buildAlsXml.ts, there's no
 * template file to read -- every block is built directly). `stemFileNames`
 * (keyed by stemKey(groupId, slot)) tells this function which stems
 * actually have materialized audio to reference and under what filename --
 * a stem missing from the map is skipped entirely. See
 * docs/superpowers/specs/2026-08-13-reaper-export-design.md for the full
 * mapping rationale.
 *
 * `options` is the built-in sound toolkit's half (spec section 4). It
 * defaults to "bake, nothing rendered", which is exactly what a project
 * using none of the toolkit is -- so a call with no `options` produces
 * byte-identical output to the pre-toolkit exporter, and the tests that
 * predate this feature pass unmodified. The two modes:
 *
 * - `bake`: the toolkit is already inside the rendered audio, so this
 *   function's job is only to reference the baked file instead of the dry
 *   stem and get out of the way (see buildStemItems' baked branch).
 * - `automation`: the audio stays dry and the curves are written as REAPER's
 *   own track envelopes onto stock REAPER devices, so the project opens and
 *   plays with nothing to install.
 *
 * Risers are rendered audio in BOTH modes -- they are generated, so there is
 * nothing else they could be.
 */
export function buildRppProject(
  state: AppState,
  stemFileNames: Map<string, string>,
  options: ToolkitExportOptions = { mode: 'bake', toolkitAudio: { bakedClips: new Map() } }
): string {
  const secPerBarProject = secPerBarFor(state.bpm)
  const automationMode = options.mode === 'automation'
  const byBus = new Map<BusId, StemItemsResult[]>()
  for (const busId of BUS_IDS) byBus.set(busId, [])
  const plans = new Map<string, StemToolkitPlan>()

  const placed = Object.values(state.rifffs).filter((r) => r.startBar !== undefined)
  for (const rifff of placed) {
    const playedBars = resolvePlayedBarsFor(state, rifff.groupId)
    const leftCropBars = state.leftCrop[rifff.groupId] ?? 0

    for (const stem of rifff.stems) {
      const key = stemKey(rifff.groupId, stem.slot)
      // The baked render REPLACES the dry stem outright -- it already is
      // this clip, with everything applied -- so it wins over stemFileNames
      // and doesn't require an entry there.
      const baked = options.toolkitAudio.bakedClips.get(key)
      const fileName = baked?.fileName ?? stemFileNames.get(key)
      if (!fileName) continue

      const busId = state.busOf[key] ?? DEFAULT_BUS
      const edgeFades = edgeFadesFor(state, rifff, stem, playedBars, leftCropBars)
      const volumeCurveLength = state.stemAutomation?.[key]?.volume?.length ?? 0
      const result = buildStemItems(
        rifff,
        stem,
        fileName,
        leftCropBars,
        playedBars,
        state.bpm,
        state.muteRegions,
        state.mute[key] ?? false,
        state.vol[key] ?? 1,
        edgeFades.fadeInBars,
        edgeFades.fadeOutBars,
        baked,
        automationMode && volumeCurveLength > 0
      )
      if (result.items.length === 0) continue

      // The plan is built AFTER the items, so it can take the clip's left
      // edge from the item that was actually placed -- see curveToPoints.
      if (automationMode) plans.set(key, buildStemToolkitPlan(state, key, result.startSec))
      byBus.get(busId)!.push(result)
    }
  }

  const trackBlocks: RppNode[] = []
  const sends: ReverbSend[] = []
  for (const busId of BUS_IDS) {
    const entries = byBus.get(busId)!
    if (entries.length === 0) continue

    const color = colorInt(REAPER_BUS_COLORS[busId])
    // ONE TRACK PER STEM in automation mode, packIntoTracks skipped
    // entirely. A REAPER envelope belongs to a whole TRACK, not to an item
    // on it, so two stems sharing a packed track would silently apply the
    // first one's volume, send and filter to the second as well. Sorted by
    // start time so the track order still reads left-to-right, which is
    // what packIntoTracks' own sort would have produced for clips that can
    // never share.
    const packed = automationMode
      ? [...entries].sort((a, b) => a.startSec - b.startSec).map((entry) => [entry])
      : packIntoTracks(
          entries,
          (e) => e.startSec,
          (e) => e.endSec
        )

    packed.forEach((trackEntries, trackIndex) => {
      const allItems = trackEntries.flatMap((e) => e.items)
      // Unlike the Ableton export, a Reaper track has no enclosing
      // GroupTrack/folder to visually convey "this is the drums bus" --
      // this export is deliberately flat (see the design doc's
      // "non-goals": no FOLDERDEPTH nesting). So every track for a bus,
      // not just the first, needs the bus identity baked into its own
      // NAME, or a second/third packed-open track for the same bus would
      // be unlabeled and indistinguishable from any other bus once
      // opened in Reaper.
      const busLabel = busId.toUpperCase()
      // In automation mode every track holds exactly one stem, so they all
      // get the name a single-entry packed track already gets -- naming the
      // first one after the whole bus would be a lie about what is on it.
      const name = automationMode
        ? `${busLabel} - ${trackEntries[0].trackLabel}`
        : trackIndex === 0
          ? busGroupName(busId, entries)
          : trackEntries.length === 1
            ? `${busLabel} - ${trackEntries[0].trackLabel}`
            : `${busLabel} (shared)`

      const toolkitNodes: RppNode[] = []
      if (automationMode) {
        const plan = plans.get(trackEntries[0].key)
        if (plan) {
          if (plan.volumeCurve.length > 0) {
            toolkitNodes.push(buildVolumeEnvelope(plan, secPerBarProject))
          }
          if (plan.filterActive) toolkitNodes.push(buildFilterChain(plan, secPerBarProject))
          if (plan.sendLevel > 0 || plan.sendCurve.length > 0) {
            sends.push({
              // trackBlocks.length is this track's own 0-based index,
              // because it is about to be pushed -- which is what AUXRECV
              // names. Recorded here rather than worked out later: the
              // reverb bus is appended at the very end, so nothing can
              // renumber the tracks in between.
              sourceTrackIndex: trackBlocks.length,
              level: plan.sendLevel,
              curve: plan.sendCurve,
              originSec: plan.originSec
            })
          }
        }
      }

      trackBlocks.push(
        rppBlock(
          'TRACK',
          [newGuid()],
          [
            rppField('NAME', quote(name)),
            rppField('PEAKCOL', color),
            rppField('MUTESOLO', 0, 0, 0),
            ...toolkitNodes,
            ...allItems
          ]
        )
      )
    })
  }

  if (options.toolkitAudio.riserFileName !== undefined) {
    trackBlocks.push(
      ...buildRiserTracks(state, options.toolkitAudio.riserFileName, secPerBarProject)
    )
  }

  // Last, after every track that could send into it -- so that every
  // sourceTrackIndex recorded above is already final.
  if (sends.length > 0) trackBlocks.push(buildReverbBusTrack(sends, secPerBarProject))

  const root = rppBlock(
    'REAPER_PROJECT',
    ['0.1', quote('sssketch'), Math.floor(Date.now() / 1000)],
    [rppField('TEMPO', state.bpm, 4, 4), ...trackBlocks]
  )

  return serializeRpp(root)
}
