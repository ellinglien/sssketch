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

/** Returns a COPY of `buf` (never mutates the original — callers may reuse
 * it elsewhere, e.g. BeatPicker's spectrogram analysis) with the loop-sewing
 * blend applied to every channel, ending exactly at `loopEndSec`. `windowSec`
 * defaults to ~2.9ms (128 samples at 44.1kHz, matching LoopSewing.cpp's own
 * default) — far too short to read as a musical fade, just enough to remove
 * the discontinuity. */
export function applyLoopMicroFade(
  ctx: AudioContext,
  buf: AudioBuffer,
  loopEndSec: number,
  windowSec = 128 / 44100
): AudioBuffer {
  const loopEndSample = Math.round(loopEndSec * buf.sampleRate)
  const windowSamples = Math.round(windowSec * buf.sampleRate)
  const out = ctx.createBuffer(buf.numberOfChannels, buf.length, buf.sampleRate)
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const dst = out.getChannelData(ch)
    dst.set(buf.getChannelData(ch))
    applyLoopMicroFadeToChannel(dst, loopEndSample, windowSamples)
  }
  return out
}
