/**
 * Standard approximation for keeping combined perceived loudness roughly constant
 * as more sources join a mix, without attenuating a single solo source at all.
 * Used both to seed a rifff's stems with an initial per-stem volume that won't
 * clip when they all play together, and to attenuate the beat-picker's preview
 * playback the same way.
 */
export function sqrtGain(sourceCount: number): number {
  return sourceCount > 1 ? 1 / Math.sqrt(sourceCount) : 1
}
