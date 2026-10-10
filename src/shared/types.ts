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
  /** Original audio path before a re-one/downbeat correction was baked.
   * Preserved as provenance so a later re-one can create another immutable
   * derivative without mutating audio referenced by older riffs, and so
   * Discover can return to a common unrotated basis while auditioning
   * replacements. */
  phaseSourcePath?: string
  /** Total clockwise rotation already materialized into `path`, measured
   * in musical bars relative to phaseSourcePath. */
  phaseBars?: number
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
  /** Unix seconds -- when this stem's OWN original riff was created on
   * Endlesss (Riffs.CreationTime), not when it was imported/placed here.
   * Direct request, 2026-09-20: "date could be a tooltip on hover.. in
   * discovery and in arranger or sketch." Deliberately per-STEM, not
   * per-riff, even though every stem normally imported from ONE real LORE
   * riff shares the identical value (mirrors Rifff.key's own "riff-level
   * data, only ever populated from a real import" shape) -- a Discover-
   * assembled Rifff (DiscoverPanel.tsx's assembleDiscoverRifff) collages
   * stems from MANY different original riffs into one synthetic Rifff, so
   * only a per-stem field can carry each one's own real provenance date
   * correctly. Undefined for a one-shot/recorded-in-app stem (no
   * originating riff at all) or any import path that predates this field. */
  creationTime?: number
  /** Non-destructive source recipe for a WAV materialized by Shape Riff.
   * Ordinary playback uses this stem's `path`; Shape alone reads this
   * versioned provenance to reopen the editable source fragments. */
  shape?: ShapeStemProvenanceV1 | ShapeStemProvenanceV2
}

export interface ShapeClipTransformV1 {
  /** Coarse duration-preserving pitch shift. */
  pitchSemitones: number
  /** Fine duration-preserving pitch shift. */
  detuneCents: number
  /** Independent spectral-envelope shift in semitones. Missing in early v2
   * recipes means 0. */
  formantSemitones: number
  /** Tape/tracker playback-rate multiple. Changes duration and pitch
   * together; missing in early v2 recipes means 1. */
  rate: number
  /** Original source bounds retained while a slower rate reaches the fixed
   * riff edge. Internal recipe metadata; omitted at normal speed. */
  rateSourceStartBars?: number
  rateSourceEndBars?: number
  /** Smooth is anti-aliased; Raw deliberately preserves tracker-style
   * nearest-neighbour resampling artifacts. */
  character: 'smooth' | 'raw'
  /** At most one editable offline treatment. */
  process?: ShapeClipProcessV1
  /** Latest durable 32-bit-float base created by Bake. The lane's immutable
   * source remains the reset root; this derived base replaces it only for
   * this clip's render recipe. */
  bakedBase?: ShapeBakedClipSource
}

export interface ShapeBakedClipSource {
  path: string
  durationSec: number
  barLength: number
}

export interface ShapeWavefoldProcessV1 {
  type: 'wavefold'
  /** Input multiplication before triangle folding. */
  drive: number
  /** Input offset used to make folds asymmetric. */
  bias: number
  /** Dry/wet blend from 0 to 1. */
  mix: number
}

export interface ShapeSaturationProcessV1 {
  type: 'saturation'
  drive: number
  bias: number
  /** Post-saturation output trim in decibels. */
  outputDb: number
  mix: number
}

export interface ShapeHardClipProcessV1 {
  type: 'hard-clip'
  /** Linear clipping threshold from 0.05 to 1. */
  threshold: number
  /** Positive values clip the positive half sooner; negative values do the reverse. */
  symmetry: number
  mix: number
}

export interface ShapeRectifyProcessV1 {
  type: 'rectify'
  mode: 'half' | 'full'
  drive: number
  mix: number
}

export interface ShapeBitCrushProcessV1 {
  type: 'bit-crush'
  bits: number
  /** Deterministic dither in fractions of one quantization step. */
  dither: number
  mix: number
}

export interface ShapeRateCrushProcessV1 {
  type: 'rate-crush'
  /** Number of samples held per update. */
  factor: number
  /** Deterministic variation in each sample-hold interval. */
  jitter: number
  mix: number
}

export interface ShapeRingModProcessV1 {
  type: 'ring-mod'
  frequencyHz: number
  /** Morphs the carrier from sine (0) to square (1). */
  shape: number
  mix: number
}

export interface ShapeCombProcessV1 {
  type: 'comb'
  delayMs: number
  feedback: number
  damping: number
  mix: number
}

export interface ShapeSmearProcessV1 {
  type: 'smear'
  timeMs: number
  scatter: number
  mix: number
}

export interface ShapeCompandProcessV1 {
  type: 'compand'
  drive: number
  compand: number
  symmetry: number
  outputDb: number
  mix: number
}

export interface ShapeCodecDamageProcessV1 {
  type: 'codec-damage'
  quality: number
  loss: number
  packetMs: number
  bandwidthHz: number
  mix: number
}

export interface ShapeShortRoomProcessV1 {
  type: 'short-room'
  sizeMs: number
  decay: number
  damping: number
  width: number
  mix: number
}

export interface ShapeFrequencyShiftProcessV1 {
  type: 'frequency-shift'
  shiftHz: number
  feedback: number
  stereo: number
  mix: number
}

export interface ShapeChorusProcessV1 {
  type: 'chorus'
  rateHz: number
  depthMs: number
  delayMs: number
  feedback: number
  stereo: number
  mix: number
}

export interface ShapeDjEqProcessV1 {
  type: 'dj-eq'
  lowDb: number
  midDb: number
  highDb: number
  mix: number
}

export interface ShapeToneProcessV1 {
  type: 'tone'
  cutoffHz: number
  resonance: number
  drive: number
  mix: number
}

/** Shape deliberately has one editable treatment slot, not an effects
 * chain. Choosing another member of this union replaces the current one. */
export type ShapeClipProcessV1 =
  | ShapeWavefoldProcessV1
  | ShapeSaturationProcessV1
  | ShapeHardClipProcessV1
  | ShapeRectifyProcessV1
  | ShapeBitCrushProcessV1
  | ShapeRateCrushProcessV1
  | ShapeRingModProcessV1
  | ShapeCombProcessV1
  | ShapeSmearProcessV1
  | ShapeCompandProcessV1
  | ShapeCodecDamageProcessV1
  | ShapeShortRoomProcessV1
  | ShapeFrequencyShiftProcessV1
  | ShapeChorusProcessV1
  | ShapeDjEqProcessV1
  | ShapeToneProcessV1

export interface ShapeFragmentRecipe {
  id: string
  sourceStartBars: number
  sourceEndBars: number
  destStartBars: number
  disabled: boolean
  /** Plays this clip's source interval from end to start. Missing in older
   * Shape recipes means ordinary forward playback. */
  reversed?: boolean
  /** Missing on v1 recipes means the neutral Smooth transform. */
  transform?: ShapeClipTransformV1
}

/** A deliberately non-recursive source snapshot. */
export type ShapeSourceStem = Omit<Stem, 'slot' | 'shape'>

export interface ShapeStemProvenanceV1 {
  version: 1
  source: ShapeSourceStem
  loopBars: number
  laneDisabled: boolean
  gain: number
  fragments: ShapeFragmentRecipe[]
}

/** Version 2 adds per-clip transform recipes. Source and rendered audio
 * remain immutable; reopening Shape reconstructs these editable values. */
export interface ShapeStemProvenanceV2 {
  version: 2
  source: ShapeSourceStem
  loopBars: number
  gain: number
  /** Cumulative whole-lane phase rotation in destination bars. Optional so
   * Shape riffs saved before the Rotate control reopen at the neutral phase. */
  rotationBars?: number
  fragments: ShapeFragmentRecipe[]
}

export interface Rifff {
  groupId: string
  /** Explicit ownership lineage for downbeat/re-one propagation. Rifffs
   * with different lineage ids may point at the same materialized audio
   * file without phase edits leaking between them (Cross offspring are the
   * first such case). Undefined keeps the legacy path-based compatibility
   * behavior for projects saved before this field existed. */
  phaseLinkId?: string
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
