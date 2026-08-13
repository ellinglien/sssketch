// src/main/reaper/buildRppProject.ts
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { AppState } from '../../renderer/src/state/store'
import type { BusId, Rifff, SoundType, Stem } from '@shared/types'
import { stemKey } from '@shared/types'
import { packIntoTracks } from '@shared/packIntoTracks'
import { busGroupName } from '@shared/busNaming'
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
// typeColor.ts's own BUS_COLORS, the actual source palette both exports
// draw from. Kept as its own copy, not imported from typeColor.ts -- this
// is REAPER-native RGB hex, a genuinely different encoding from Ableton's
// palette-index enum, and main-process code importing a renderer theme
// file would cross this codebase's own process boundary for no real
// benefit (see CLAUDE.md's "wire format twins are hand-synced, not
// code-shared" convention).
const REAPER_BUS_COLORS: Record<BusId, string> = {
  drums: '#e8929b',
  bass: '#4a56ad',
  lead: '#c7a4d2',
  backing: '#7fc98a',
  aux: '#8a97a3'
}

// REAPER's native track/item color: the high bit (0x01000000) marks "use
// this custom color, not the default", OR'd with a BGR-packed (not RGB)
// int -- confirmed against REAPER's own SWS extension source
// (Color/Color.cpp's SWS_ColorToNative, which swaps R/B to produce
// Windows-COLORREF-style native colors on every platform). Flagged for
// manual confirmation once a real export can be opened in REAPER -- see
// the design doc's "Manual verification" section.
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

interface StemItemsResult {
  items: RppNode[]
  trackLabel: string
  soundType: SoundType
  startSec: number
  endSec: number
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
  fadeOutBars: number
): StemItemsResult {
  const secPerBarProject = secPerBarFor(projectBpm)
  const trackLabel = `${rifff.name} - ${stem.name}`

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
  const muteRegionsForStem = muteRegions[stemKey(rifff.groupId, stem.slot)] ?? []
  const audibleSegments = subtractMutedRangesSec(
    clipStartSec,
    clipEndSec,
    muteRegionsForStem,
    secPerBarProject
  )

  const relativePath = join('Samples', 'Imported', fileName)
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
        fadeField('FADEIN', segmentIndex === 0, fadeInBars, segmentDurationSec, secPerBarProject),
        fadeField(
          'FADEOUT',
          segmentIndex === audibleSegments.length - 1,
          fadeOutBars,
          segmentDurationSec,
          secPerBarProject
        ),
        rppField('MUTE', muted ? 1 : 0),
        rppField('IGUID', newGuid()),
        rppField('NAME', quote(trackLabel)),
        rppField('VOLPAN', 1, 0, volume, -1),
        rppField('SOFFS', segSoffsSec),
        rppField('PLAYRATE', playrate, 1, 0, -1, 0, -1),
        rppField('GUID', newGuid()),
        rppBlock('SOURCE', ['WAVE'], [rppField('FILE', quote(relativePath))])
      ]
    )
  })

  return { items, trackLabel, soundType: stem.type, startSec: clipStartSec, endSec: clipEndSec }
}

const BUS_IDS: BusId[] = ['drums', 'bass', 'lead', 'backing', 'aux']
const DEFAULT_BUS: BusId = 'aux'

/**
 * Builds the finished `.rpp` project text for the current arrangement.
 * Pure: no filesystem access at all (unlike buildAlsXml.ts, there's no
 * template file to read -- every block is built directly). `stemFileNames`
 * (keyed by stemKey(groupId, slot)) tells this function which stems
 * actually have materialized audio to reference and under what filename --
 * a stem missing from the map is skipped entirely. See
 * docs/superpowers/specs/2026-08-13-reaper-export-design.md for the full
 * mapping rationale.
 */
export function buildRppProject(state: AppState, stemFileNames: Map<string, string>): string {
  const byBus = new Map<BusId, StemItemsResult[]>()
  for (const busId of BUS_IDS) byBus.set(busId, [])

  const placed = Object.values(state.rifffs).filter((r) => r.startBar !== undefined)
  for (const rifff of placed) {
    const playedBars = resolvePlayedBarsFor(state, rifff.groupId)
    const leftCropBars = state.leftCrop[rifff.groupId] ?? 0

    for (const stem of rifff.stems) {
      const key = stemKey(rifff.groupId, stem.slot)
      const fileName = stemFileNames.get(key)
      if (!fileName) continue

      const busId = state.busOf[key] ?? DEFAULT_BUS
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
        state.fadeIn[rifff.groupId] ?? 0,
        state.fadeOut[rifff.groupId] ?? 0
      )
      if (result.items.length === 0) continue

      byBus.get(busId)!.push(result)
    }
  }

  const trackBlocks: RppNode[] = []
  for (const busId of BUS_IDS) {
    const entries = byBus.get(busId)!
    if (entries.length === 0) continue

    const color = colorInt(REAPER_BUS_COLORS[busId])
    const packed = packIntoTracks(
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
      const name =
        trackIndex === 0
          ? busGroupName(busId, entries)
          : trackEntries.length === 1
            ? `${busLabel} - ${trackEntries[0].trackLabel}`
            : `${busLabel} (shared)`
      trackBlocks.push(
        rppBlock(
          'TRACK',
          [newGuid()],
          [
            rppField('NAME', quote(name)),
            rppField('PEAKCOL', color),
            rppField('MUTESOLO', 0, 0, 0),
            ...allItems
          ]
        )
      )
    })
  }

  const root = rppBlock(
    'REAPER_PROJECT',
    ['0.1', quote('sssketch'), Math.floor(Date.now() / 1000)],
    [rppField('TEMPO', state.bpm, 4, 4), ...trackBlocks]
  )

  return serializeRpp(root)
}
