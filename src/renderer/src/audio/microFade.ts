/** Web Audio's native looping (source.loop = true, loopStart/loopEnd) wraps
 * sample-accurately with no per-iteration hook a JS-scheduled GainNode
 * automation could target — unlike the native engine's own per-tile
 * rendering (see FadeGain.cpp), there's no callback fired each time a loop
 * repeats. The only way to fix a click at that seam for a Web Audio preview
 * is to bake a short fade directly into the buffer's own sample data before
 * playback starts, at both the very beginning (the loop's landing point) and
 * right before loopEnd (where it wraps back around).
 *
 * Applies in place, to a single channel's raw samples — kept as a pure
 * function over Float32Array (no AudioContext/AudioBuffer involved) so it's
 * directly unit-testable; applyLoopMicroFade below is the thin
 * AudioBuffer-shaped wrapper around it. */
export function applyLoopMicroFadeToChannel(
  data: Float32Array,
  loopEndSample: number,
  fadeSamples: number
): void {
  const clampedLoopEnd = Math.max(0, Math.min(loopEndSample, data.length))
  const clampedFade = Math.max(0, Math.min(fadeSamples, Math.floor(clampedLoopEnd / 2)))
  for (let i = 0; i < clampedFade; i++) {
    const gain = i / clampedFade
    data[i] *= gain
    const tailIndex = clampedLoopEnd - clampedFade + i
    if (tailIndex >= 0 && tailIndex < data.length) {
      data[tailIndex] *= 1 - gain
    }
  }
}

/** Returns a COPY of `buf` (never mutates the original — callers may reuse
 * it elsewhere, e.g. BeatPicker's spectrogram analysis) with a short
 * (`fadeSec`, default 3ms — far too short to read as a musical fade, just
 * enough to remove a click) linear fade-in at the very start and fade-out
 * ending exactly at `loopEndSec`, on every channel. */
export function applyLoopMicroFade(
  ctx: AudioContext,
  buf: AudioBuffer,
  loopEndSec: number,
  fadeSec = 0.003
): AudioBuffer {
  const loopEndSample = Math.round(loopEndSec * buf.sampleRate)
  const fadeSamples = Math.round(fadeSec * buf.sampleRate)
  const out = ctx.createBuffer(buf.numberOfChannels, buf.length, buf.sampleRate)
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const dst = out.getChannelData(ch)
    dst.set(buf.getChannelData(ch))
    applyLoopMicroFadeToChannel(dst, loopEndSample, fadeSamples)
  }
  return out
}
