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

/** The metronome button's tooltip: on or off, the volume, and the gesture. */
export function metronomeButtonTitle(enabled: boolean, volume: number): string {
  return `metronome: ${enabled ? 'on' : 'off'} · ${Math.round(volume * 100)}% · drag up/down for volume`
}

/** The button's volume bar is drawn inside a 26px button; 22px is its full height. */
export const METRONOME_VOLUME_BAR_MAX_PX = 22

export function metronomeVolumeBarPx(volume: number): number {
  return Math.round(
    (clampMetronomeVolume(volume) / MAX_METRONOME_VOLUME) * METRONOME_VOLUME_BAR_MAX_PX
  )
}
