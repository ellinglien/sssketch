/* Rifff Arranger v1 — drawing helpers, ported from the prototype (rifff-visuals.js).
 * Framework-agnostic: both functions take a peak array (0..1) and return an SVG path string.
 *
 *   linearWave(peaks)                      -> path for a clip waveform
 *                                             render in <svg viewBox="0 0 128 100" preserveAspectRatio="none">
 *   polarGlyph(peaks, r0, amp, points)     -> path for one petal ring of a rifff glyph
 *                                             render in <svg viewBox="0 0 100 100">
 *
 * Rifff glyph = one polarGlyph ring per stem, layered:
 *   ring i:  r0   = 17 + i * 2.5
 *            amp  = 10 + 15 * Math.min(1, stemVolume + 0.1)
 *            pts  = 13 + i * 2
 *            fill = that stem's sound-type color, opacity 0.55, NO blend mode
 *   sort rings by amp descending (largest painted first / behind)
 *   then a core disc: <circle cx=50 cy=50 r=9 fill={rifffIdentityColor} opacity=0.85 />
 *
 * Peaks come from max-abs bucketing the decoded stem: 128 buckets is plenty.
 */

const TAU = Math.PI * 2

export function peaksFromChannel(samples: Float32Array, buckets = 128): number[] {
  const out: number[] = []
  for (let i = 0; i < buckets; i++) {
    const a = Math.floor((i * samples.length) / buckets)
    const b = Math.floor(((i + 1) * samples.length) / buckets)
    let m = 0
    for (let j = a; j < b; j += 7) {
      const v = Math.abs(samples[j])
      if (v > m) m = v
    }
    out.push(m)
  }
  return out
}

export function downsample(arr: number[], n: number): number[] {
  const out: number[] = []
  for (let i = 0; i < n; i++) {
    const a = Math.floor((i * arr.length) / n)
    const b = Math.floor(((i + 1) * arr.length) / n)
    let sum = 0
    let c = 0
    for (let j = a; j < Math.max(b, a + 1); j++) {
      sum += arr[j] || 0
      c++
    }
    out.push(sum / c)
  }
  return out
}

/** mirrored, normalised waveform filling a 128x100 box */
export function linearWave(peaks: number[]): string {
  const n = peaks.length
  const mx = Math.max.apply(null, peaks) || 1
  let up = ''
  let down = ''
  for (let i = 0; i < n; i++) {
    const h = (peaks[i] / mx) * 45
    const x = ((i * 128) / (n - 1)).toFixed(1)
    up += (i ? 'L' : 'M') + x + ',' + (50 - h).toFixed(1)
    down = 'L' + x + ',' + (50 + h).toFixed(1) + down
  }
  return up + down + 'Z'
}

/** one petal ring in a 100x100 box, centred on 50,50 */
export function polarGlyph(peaks: number[], r0 = 17, amp = 20, points = 16): string {
  const arr = downsample(peaks, points)
  const n = arr.length
  const mx = Math.max.apply(null, arr) || 1
  const pt = (a: number, r: number): string =>
    (50 + Math.cos(a) * r).toFixed(1) + ',' + (50 + Math.sin(a) * r).toFixed(1)
  let d = 'M' + pt(0, r0)
  for (let i = 0; i < n; i++) {
    const aMid = ((i + 0.5) / n) * TAU
    const aNext = ((i + 1) / n) * TAU
    d += 'Q' + pt(aMid, r0 + (arr[i] / mx) * amp) + ' ' + pt(aNext, r0)
  }
  return d + 'Z'
}

/* ——— readouts used across the UI ——— */

export function dbLabel(v: number): string {
  if (v <= 0.001) return '−inf'
  const d = 20 * Math.log10(v)
  return d >= -0.05 ? '0.0' : d.toFixed(1).replace('-', '−')
}

export interface OffsetLabels {
  grid: string
  ms: string
  msPerStep: string
}

/** offset is stored in grid steps; snapDiv is 4 | 8 | 16 | 32 */
export function offsetLabels(steps: number, snapDiv: number, bpm: number): OffsetLabels {
  const msPerStep = ((60 / bpm) * 4 * 1000) / snapDiv
  const ms = steps * msPerStep
  return {
    grid: steps ? (steps > 0 ? '+' : '−') + Math.abs(steps) + '/' + snapDiv : '0',
    ms: ms ? (ms > 0 ? '+' : '−') + Math.abs(ms).toFixed(0) + ' ms' : 'dead on',
    msPerStep: msPerStep.toFixed(1) + ' ms/step'
  }
}

/** bar.beat.16th, 1-indexed, bar zero-padded to 3 */
export function positionLabel(posInBars: number): string {
  const beat = Math.floor((posInBars % 1) * 4) + 1
  const sixteenth = Math.floor((posInBars % 0.25) * 16) + 1
  return String(Math.floor(posInBars) + 1).padStart(3, '0') + '.' + beat + '.' + sixteenth
}
