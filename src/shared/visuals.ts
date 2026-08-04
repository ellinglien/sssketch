/* sssketch v1 — drawing helpers, ported from the prototype (rifff-visuals.js).
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

/** mirrored, normalised waveform filling a 128x100 box — stepped/blocky
 * (flat top per bucket, square corners between buckets) rather than smooth
 * diagonal interpolation between peak centers, for a slightly pixelated
 * look closer to the imported 6b mockup's own crisp-edged waveforms.
 * Combine with shape-rendering="crispEdges" on the consuming <path> to
 * finish the effect (disables anti-aliasing on top of this path shape). */
export function linearWave(peaks: number[]): string {
  const n = peaks.length
  const mx = Math.max.apply(null, peaks) || 1
  const stepWidth = 128 / n
  let up = ''
  let down = ''
  for (let i = 0; i < n; i++) {
    const h = (peaks[i] / mx) * 45
    const x0 = (i * stepWidth).toFixed(1)
    const x1 = ((i + 1) * stepWidth).toFixed(1)
    up += (i ? 'L' : 'M') + x0 + ',' + (50 - h).toFixed(1) + 'L' + x1 + ',' + (50 - h).toFixed(1)
    down = 'L' + x1 + ',' + (50 + h).toFixed(1) + 'L' + x0 + ',' + (50 + h).toFixed(1) + down
  }
  return up + down + 'Z'
}

/** one petal ring in a 100x100 box, centred on 50,50 — flat-topped, faceted
 * segments (straight chord across each bucket's angular span, at that
 * bucket's own radius) rather than smooth quadratic-bezier bulges, for the
 * same slightly-pixelated effect as linearWave above. */
export function polarGlyph(peaks: number[], r0 = 17, amp = 20, points = 16): string {
  const arr = downsample(peaks, points)
  const n = arr.length
  const mx = Math.max.apply(null, arr) || 1
  const pt = (a: number, r: number): string =>
    (50 + Math.cos(a) * r).toFixed(1) + ',' + (50 + Math.sin(a) * r).toFixed(1)
  let d = ''
  for (let i = 0; i < n; i++) {
    const aStart = (i / n) * TAU
    const aEnd = ((i + 1) / n) * TAU
    const r = r0 + (arr[i] / mx) * amp
    d += (i ? 'L' : 'M') + pt(aStart, r) + 'L' + pt(aEnd, r)
  }
  return d + 'Z'
}

export interface WaveformBar {
  x: number
  width: number
  y: number
  height: number
}

/** Same geometry linearWave draws (128-wide box, centered at y=50, height
 * scaled relative to the peak array's own max), but returned as one
 * rectangle per bucket instead of a single filled path — needed wherever a
 * bucket needs its own fill (e.g. opacity keyed to that bucket's spectral
 * brightness), which a single <path> can't express. */
export function linearWaveBars(peaks: number[]): WaveformBar[] {
  const n = peaks.length
  if (n === 0) return []
  const mx = Math.max.apply(null, peaks) || 1
  const stepWidth = 128 / n
  return peaks.map((p, i) => {
    const h = (p / mx) * 45
    return { x: i * stepWidth, width: stepWidth, y: 50 - h, height: h * 2 }
  })
}

/** Same geometry as linearWaveBars, but each bar's height is normalized
 * against the running max of every peak up to and including its OWN
 * index, not the whole array's max -- needed for a live, growing peaks
 * array (ChannelRow.tsx's capture overlay) where re-deriving the divisor
 * from the WHOLE array on every poll would retroactively rescale (and
 * visibly reshape) bars already drawn, every time a louder bucket showed
 * up later in the take. Bar i's height depends only on peaks[0..i] --
 * values that, once present, never change again (see peaksFixedWindow's
 * own append-only doc comment on the native side) -- so recomputing it
 * on a later, longer array always reproduces the exact same result.
 * Trades exact parity with the finished clip's own whole-file
 * normalization (a quiet moment recorded before the take's eventual
 * loudest one reads shorter live than it will in the committed clip,
 * since the live view can't know about a louder moment that hasn't
 * happened yet) for the "already-drawn bars never change" behavior a
 * live meter needs and a whole-file normalization fundamentally can't
 * give it. */
export function linearWaveBarsRunningMax(peaks: number[]): WaveformBar[] {
  const n = peaks.length
  if (n === 0) return []
  const stepWidth = 128 / n
  let runningMax = 0
  return peaks.map((p, i) => {
    runningMax = Math.max(runningMax, p)
    const mx = runningMax || 1
    const h = (p / mx) * 45
    return { x: i * stepWidth, width: stepWidth, y: 50 - h, height: h * 2 }
  })
}

/** Cheap zero-crossing-rate brightness proxy, bucketed the same way
 * peaksFromChannel is — a rough "how much high-frequency content is in
 * this bucket" without running an FFT: high-frequency content crosses zero
 * far more often per sample than a sustained bass note does. Each bucket's
 * value is crossings / (samples in bucket - 1), so it's naturally bounded
 * to [0, 1] with no separate normalization pass needed. */
export function zcrFromChannel(samples: Float32Array, buckets = 128): number[] {
  const out: number[] = []
  for (let i = 0; i < buckets; i++) {
    const a = Math.floor((i * samples.length) / buckets)
    const b = Math.floor(((i + 1) * samples.length) / buckets)
    let crossings = 0
    let count = 0
    let prevSign = 0
    for (let j = a; j < b; j++) {
      const sign = samples[j] > 0 ? 1 : samples[j] < 0 ? -1 : 0
      if (sign !== 0 && prevSign !== 0 && sign !== prevSign) crossings++
      if (sign !== 0) prevSign = sign
      count++
    }
    out.push(count > 1 ? crossings / (count - 1) : 0)
  }
  return out
}

/** Traces a guessed pitch contour (see pitchContour.ts's computePitchContour
 * — 0 means "unpitched," not "silence at 0Hz") as a stroke-only path around
 * a ring, log-frequency mapped to radius within [r0, r0+amp] — the polar
 * analog of BeatPicker.tsx's own linear melody-contour overlay. Breaks into
 * a new subpath (M) at every unpitched frame rather than interpolating
 * across it, same as BeatPicker's: a percussive gap isn't "on" any pitch. */
export function polarPitchLine(
  freqHz: readonly number[],
  r0: number,
  amp: number,
  minFreqHz: number,
  maxFreqHz: number
): string {
  const n = freqHz.length
  if (n === 0) return ''
  const logMin = Math.log2(minFreqHz)
  const logMax = Math.log2(maxFreqHz)
  let d = ''
  let drawing = false
  for (let i = 0; i < n; i++) {
    const f = freqHz[i]
    if (!(f > 0)) {
      drawing = false
      continue
    }
    const frac = Math.max(0, Math.min(1, (Math.log2(f) - logMin) / (logMax - logMin)))
    const r = r0 + frac * amp
    const angle = (i / n) * TAU - Math.PI / 2
    const x = (50 + Math.cos(angle) * r).toFixed(1)
    const y = (50 + Math.sin(angle) * r).toFixed(1)
    d += drawing ? `L${x},${y}` : `M${x},${y}`
    drawing = true
  }
  return d
}

/** Linear counterpart to polarPitchLine, in the same 128x100 box
 * linearWave/linearWaveBars use — higher pitch nearer the top, matching
 * BeatPicker.tsx's own freqToTopPct convention (and the spectrogram's
 * low-frequency-at-the-bottom orientation). Kept off the very top/bottom
 * edge (5-95 instead of 0-100) so an extreme pitch doesn't draw flush
 * against the waveform lane's border. */
export function linearPitchLine(
  freqHz: readonly number[],
  minFreqHz: number,
  maxFreqHz: number
): string {
  const n = freqHz.length
  if (n === 0) return ''
  const logMin = Math.log2(minFreqHz)
  const logMax = Math.log2(maxFreqHz)
  let d = ''
  let drawing = false
  for (let i = 0; i < n; i++) {
    const f = freqHz[i]
    if (!(f > 0)) {
      drawing = false
      continue
    }
    const frac = Math.max(0, Math.min(1, (Math.log2(f) - logMin) / (logMax - logMin)))
    const x = ((i / n) * 128).toFixed(1)
    const y = ((1 - frac) * 90 + 5).toFixed(1)
    d += drawing ? `L${x},${y}` : `M${x},${y}`
    drawing = true
  }
  return d
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

/**
 * m:ss.d elapsed-time readout for the transport bar. Derived from the playhead's
 * bar position and project tempo, not a separate running clock — it resets every
 * loop pass along with posInBars, matching the bar.beat.16th readout's own cycle
 * (both wrap at the same 32-bar loop boundary).
 */
export function elapsedLabel(posInBars: number, bpm: number): string {
  const secPerBar = (60 / bpm) * 4
  const totalSeconds = posInBars * secPerBar
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toFixed(1).padStart(4, '0')}`
}
