// src/shared/remotePeaks.ts

/** How many buckets a phone row's waveform is drawn from. The desktop's own
 * peaks are 128 (peaksFromChannel, @shared/visuals); a phone row is under
 * 250 css pixels wide, so sending all 128 would be twice the payload for
 * sub-pixel detail. 64 integers is roughly 200 bytes per slot, which at the
 * page's 700ms poll is nothing on a LAN. */
export const REMOTE_PEAK_BUCKETS = 64

/** Downsamples a stem's peaks for the phone: max per window (never an
 * average -- an average of a drum hit and the silence around it draws a
 * quiet drum hit), then whole numbers 0..100.
 *
 * Integers, not floats, because this rides in the state poll and a float
 * costs three times the characters for detail no 18px canvas can show.
 * Never throws; an empty input is null, meaning "this row has no waveform
 * yet", which the page already knows how to draw. */
export function quantiseRemotePeaks(
  peaks: readonly number[],
  buckets: number = REMOTE_PEAK_BUCKETS
): number[] | null {
  if (peaks.length === 0 || buckets <= 0) return null
  const out: number[] = []
  for (let i = 0; i < buckets; i += 1) {
    const a = Math.floor((i * peaks.length) / buckets)
    const b = Math.max(a + 1, Math.floor(((i + 1) * peaks.length) / buckets))
    let max = 0
    for (let j = a; j < b && j < peaks.length; j += 1) {
      const v = peaks[j]
      if (!Number.isFinite(v)) continue
      const abs = v < 0 ? -v : v
      if (abs > max) max = abs
    }
    if (max > 1) max = 1
    out.push(Math.round(max * 100))
  }
  return out
}
