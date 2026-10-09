export const DEFAULT_METRONOME_VOLUME = 1.5
export const MAX_METRONOME_VOLUME = 2
export const METRONOME_VOLUME_DRAG_PX_PER_UNIT = 80

export function clampMetronomeVolume(value: number): number {
  return Math.max(0, Math.min(MAX_METRONOME_VOLUME, value))
}

/** Up is louder, down is quieter. The result is rounded so a long drag does
 * not leave noisy floating-point tails in state or the UI tooltip. */
export function metronomeVolumeFromDrag(start: number, deltaY: number): number {
  return (
    Math.round(clampMetronomeVolume(start - deltaY / METRONOME_VOLUME_DRAG_PX_PER_UNIT) * 100) / 100
  )
}
