// src/renderer/src/components/reOneLane.ts
//
// Layout for one stem's lane in the re-one picker (BeatPicker.tsx). Each
// lane spans the whole riff's bar length; a stem shorter than the riff is
// tiled across it, the same way the arranger tiles a stem across a clip,
// and a loop mark is drawn wherever it starts over.

/** Waveform resolution in the re-one picker. The shared 128-bucket peaks
 * (peakCache.ts) are sized for a clip-sized waveform; spread over a 16-bar
 * stem they give two buckets per beat, which smears every drum hit and note
 * onset into its neighbours. 64 per bar is four per sixteenth note: a hit
 * reads as its own spike at the picker's finest grid. */
export const RE_ONE_BUCKETS_PER_BAR = 64
const MIN_BUCKETS = 128
const MAX_BUCKETS = 8192

export interface ReOneLaneLayout {
  /** One repeat of the stem, as a percentage of the lane's width. */
  tileWidthPct: number
  /** Where the stem starts over, as percentages of the lane's width. The
   * lane's own start is not included (same as the arranger's loop lines). */
  loopMarkPcts: number[]
  /** How many peak buckets to draw one repeat of this stem with. */
  buckets: number
}

export function reOneLaneLayout(stemBars: number, riffBars: number): ReOneLaneLayout {
  if (!(stemBars > 0) || !(riffBars > 0)) {
    return { tileWidthPct: 100, loopMarkPcts: [], buckets: MIN_BUCKETS }
  }
  const tileWidthPct = (stemBars / riffBars) * 100
  const loopMarkPcts: number[] = []
  // Counted by index, not by repeated addition, and with a small tolerance
  // at the end: a restart within float error of the riff's end IS the end.
  for (let k = 1; k * tileWidthPct < 100 - 1e-6; k++) loopMarkPcts.push(k * tileWidthPct)
  const buckets = Math.min(
    MAX_BUCKETS,
    Math.max(MIN_BUCKETS, Math.round(stemBars * RE_ONE_BUCKETS_PER_BAR))
  )
  return { tileWidthPct, loopMarkPcts, buckets }
}
