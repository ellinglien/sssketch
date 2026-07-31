/** Web Audio's native looping (source.loop = true, loopStart/loopEnd) wraps
 * sample-accurately with no per-iteration hook a JS-scheduled GainNode
 * automation could target — there's no callback fired each time a loop
 * repeats. The only way to fix a click at that seam for a Web Audio preview
 * is to bake a fix directly into the buffer's own sample data before
 * playback starts.
 *
 * Blends the tail toward the loop's own start value with an equal-power
 * (constant-power) crossfade, rather than fading both ends independently
 * toward silence — a silence-dip fade is audible as a "breath" on a
 * sustained/continuous tone even at a few milliseconds, since it briefly
 * loses energy right at the seam; this keeps perceived loudness constant
 * through the transition instead, and lands the very last sample exactly on
 * the very first sample's value, so there's no discontinuity at all at the
 * wrap point. Ported from OUROVEON's Stem::applyLoopSewingBlend
 * (src/r3.endlesss/endlesss/live.stem.cpp, github.com/OUROcorp/OUROVEON) —
 * a real, shipping Endlesss client already solving this exact problem for
 * the same class of content — and kept in lockstep with the native engine's
 * own port of the same algorithm, LoopSewing.cpp.
 *
 * Applies in place, to a single channel's raw samples — kept as a pure
 * function over Float32Array (no AudioContext/AudioBuffer involved) so it's
 * directly unit-testable; applyLoopMicroFade below is the thin
 * AudioBuffer-shaped wrapper around it. */
export function applyLoopMicroFadeToChannel(
  data: Float32Array,
  loopEndSample: number,
  windowSamples: number
): void {
  const clampedLoopEnd = Math.max(0, Math.min(loopEndSample, data.length))
  const clampedWindow = Math.max(0, Math.min(windowSamples, Math.floor(clampedLoopEnd / 2)))
  if (clampedWindow <= 0) return
  const startSample = data[0]
  for (let i = 0; i < clampedWindow; i++) {
    const endIndex = clampedLoopEnd - 1 - i
    if (endIndex < 0 || endIndex >= data.length) continue
    // Equal-power crossfade coefficient: 1.0 at the seam itself (i=0, blends
    // fully to startSample) down toward 0.0 as i approaches the window size
    // (leaves the original tail content untouched further from the seam).
    const t = -1.0 + (i / clampedWindow) * 2.0
    const coeff = Math.sqrt(0.5 * (1.0 - t))
    data[endIndex] = data[endIndex] + (startSample - data[endIndex]) * coeff
  }
}

const LOOP_SEWING_MIN_WINDOW_SAMPLES = 512
const LOOP_SEWING_MAX_WINDOW_SAMPLES = 2048

/** Chooses a loop-sewing blend window, in samples, from how "bassy" the
 * content right before `loopEndSample` is — estimated via zero-crossing
 * rate over the last `LOOP_SEWING_MAX_WINDOW_SAMPLES` samples (or fewer, if
 * the loop is shorter), a cheap FFT-free proxy for dominant frequency:
 * fewer crossings per second means a lower tone. A low tone doesn't
 * complete even one full cycle within a short fixed window, forcing the
 * blend to bend its own phase to land on the head's value — audible as a
 * tick/warble rather than a resolved discontinuity. A bassy seam gets a
 * wider window, giving the blend more room to land smoothly; a bright/
 * percussive one keeps the narrower minimum, since a wide window there
 * would needlessly smear a transient sitting close to the loop point.
 *
 * Mirrors LoopSewing.cpp's own adaptiveLoopSewingWindow exactly (same
 * thresholds, same log-frequency interpolation) — kept as a pure function
 * over Float32Array so it's directly unit-testable, same as
 * applyLoopMicroFadeToChannel above. */
export function adaptiveLoopSewingWindowSamples(
  data: Float32Array,
  loopEndSample: number,
  sampleRate: number
): number {
  const clampedLoopEnd = Math.max(0, Math.min(loopEndSample, data.length))
  const analysisWindow = Math.min(LOOP_SEWING_MAX_WINDOW_SAMPLES, clampedLoopEnd)
  if (analysisWindow < 2 || sampleRate <= 0) return LOOP_SEWING_MIN_WINDOW_SAMPLES
  const startIndex = clampedLoopEnd - analysisWindow
  let crossings = 0
  for (let i = startIndex + 1; i < clampedLoopEnd; i++) {
    if (data[i - 1] < 0 !== data[i] < 0) crossings++
  }
  const windowDurationSec = analysisWindow / sampleRate
  const estimatedFreqHz = crossings / 2 / windowDurationSec
  const kBassyFreqHz = 150
  const kBrightFreqHz = 1000
  if (estimatedFreqHz <= kBassyFreqHz) return LOOP_SEWING_MAX_WINDOW_SAMPLES
  if (estimatedFreqHz >= kBrightFreqHz) return LOOP_SEWING_MIN_WINDOW_SAMPLES
  const logLow = Math.log(kBassyFreqHz)
  const logHigh = Math.log(kBrightFreqHz)
  const t = (Math.log(estimatedFreqHz) - logLow) / (logHigh - logLow)
  return Math.round(
    LOOP_SEWING_MAX_WINDOW_SAMPLES +
      t * (LOOP_SEWING_MIN_WINDOW_SAMPLES - LOOP_SEWING_MAX_WINDOW_SAMPLES)
  )
}

/** Returns a COPY of `buf` (never mutates the original — callers may reuse
 * it elsewhere, e.g. BeatPicker's spectrogram analysis) with the loop-sewing
 * blend applied to every channel, ending exactly at `loopEndSec`. `windowSec`
 * defaults to an adaptive, bass-aware window (see
 * adaptiveLoopSewingWindowSamples above) computed once from channel 0 and
 * applied to every channel — matching LoopSewing.cpp's own "compute once,
 * apply uniformly" — rather than a single fixed size; pass an explicit
 * value to opt back into a fixed window (e.g. for a caller with its own,
 * already-known-good size). */
export function applyLoopMicroFade(
  ctx: AudioContext,
  buf: AudioBuffer,
  loopEndSec: number,
  windowSec?: number
): AudioBuffer {
  const loopEndSample = Math.round(loopEndSec * buf.sampleRate)
  const windowSamples =
    windowSec !== undefined
      ? Math.round(windowSec * buf.sampleRate)
      : adaptiveLoopSewingWindowSamples(buf.getChannelData(0), loopEndSample, buf.sampleRate)
  const out = ctx.createBuffer(buf.numberOfChannels, buf.length, buf.sampleRate)
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const dst = out.getChannelData(ch)
    dst.set(buf.getChannelData(ch))
    applyLoopMicroFadeToChannel(dst, loopEndSample, windowSamples)
  }
  return out
}
