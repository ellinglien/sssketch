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
