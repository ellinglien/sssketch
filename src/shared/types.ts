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
}

export function stemKey(groupId: string, slot: number): string {
  return `${groupId}:${slot}`
}

export interface ExportedStem {
  fileName: string
  bytes: Uint8Array
}
