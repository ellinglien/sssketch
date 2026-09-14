export type SoundType =
  'drums' | 'notes' | 'bass' | 'extInst' | 'sampler' | 'fx' | 'extFx' | 'audioIn'

export const TYPE_ORDER: readonly SoundType[] = [
  'drums',
  'notes',
  'bass',
  'extInst',
  'sampler',
  'fx',
  'extFx',
  'audioIn'
]

export const TYPE_CSS_VAR: Record<SoundType, string> = {
  drums: '--ra-type-drums',
  notes: '--ra-type-notes',
  bass: '--ra-type-bass',
  extInst: '--ra-type-ext-inst',
  sampler: '--ra-type-sampler',
  fx: '--ra-type-fx',
  extFx: '--ra-type-ext-fx',
  audioIn: '--ra-type-audio-in'
}

/** Which mix bus a stem is assigned to, for Ableton export track reduction
 * -- a DIFFERENT axis from SoundType (which describes what Endlesss device
 * produced a stem, not where it belongs in a mix). Deliberately NOT added
 * as a SoundType variant -- see
 * docs/superpowers/specs/2026-08-05-stem-bus-clustering-design.md for why
 * conflating the two would be wrong (SoundType resolves to 'audioIn' for
 * ~90% of live-recorded material, which carries no mix-placement
 * information at all). Five buses is the deliberately chosen starting
 * set -- few enough to label by ear quickly. */
export type BusId = 'drums' | 'bass' | 'lead' | 'backing' | 'aux'

/** Serializable reference to "which currently-open project" a forward-
 * captured StemCategories write came from -- crosses the IPC boundary as
 * plain data. Structurally identical to App.tsx's own local `CurrentSketch`
 * state (kept as a separate declaration here rather than imported from
 * App.tsx, since main-process code needs this same shape without pulling in
 * any renderer-only module, and TypeScript's structural typing means a
 * `CurrentSketch` value assigns into a `ProjectRef`-typed prop with no cast
 * needed). null means nothing has been saved/opened yet -- the resulting
 * StemCategories row's SourceProject is null in that case. */
export type ProjectRef =
  { kind: 'library'; name: string } | { kind: 'external'; path: string } | null

export interface Stem {
  slot: number
  author: string
  name: string
  type: SoundType
  path: string
  durationSec: number
  barLength: number
  /** True for a one-shot sample dropped directly from Finder onto the
   * arranger (see docs/superpowers/specs/2026-08-02-one-shot-sample-import-design.md)
   * -- never tiled/looped, never auto-resampled to match project bpm.
   * Undefined/false for every normal LORE/folder-import-derived stem. */
  oneShot?: boolean
  /** Only meaningful when oneShot is true. How far into the source file
   * playback starts, in seconds. Undefined means 0 (play from the very
   * start). */
  trimStartSec?: number
  /** Only meaningful when oneShot is true. Where playback stops, in
   * seconds, measured from the same origin as trimStartSec (the source
   * file's own start -- NOT relative to trimStartSec). Undefined means
   * durationSec (play to the natural end). */
  trimEndSec?: number
  /** True only for a take captured via this app's own loop-record feature
   * (see importRecordedTake in src/main/importOneShot.ts) -- an orthogonal
   * provenance flag, not a SoundType, deliberately kept separate from
   * `type: 'audioIn'` (which also covers LORE's own mic-instrument
   * imports, not ours to visually claim). Drives stemColorVar
   * (theme/typeColor.ts) to color a committed recorded take with
   * --ra-recording-live instead of --ra-type-audio-in's own color,
   * everywhere a stem's identity color is shown -- per feedback, a
   * recording should read as its own distinct category, not just another
   * audio-in-typed clip. Undefined/false for every other stem. */
  recordedInApp?: boolean
}

export interface Rifff {
  groupId: string
  name: string
  bpm: number
  barLength: number
  folderPath: string
  stems: Stem[]
  /** undefined until dragged from the shelf onto the timeline */
  startBar?: number
  /** e.g. "E Minor (Aeolian)" -- only ever populated for riffs imported
   * from the LORE library (see LoreLibraryBrowser.tsx's importResolvedRiff),
   * which is the only import path with access to this metadata at all.
   * Purely informational (Inspector display); nothing in playback/
   * tiling/stretch reads it. */
  key?: string
}

export function stemKey(groupId: string, slot: number): string {
  return `${groupId}:${slot}`
}
