/** A practice click track for BeatPicker's re-one stage — entirely separate
 * from the native engine's own metronome (native-engine/Source/Metronome.cpp),
 * since BeatPicker previews audio through Web Audio and never touches the
 * native engine at all. Kept as a deliberate twin anyway: same click
 * synthesis (short decaying sine burst, higher pitch on the downbeat), same
 * pure-function-of-absolute-time shape, for the same reason microFade.ts and
 * LoopSewing.cpp are kept in lockstep — consistent behavior, and a familiar
 * shape to maintain.
 *
 * metronomeSampleAt is a pure function over sample time (no AudioContext/
 * AudioBuffer involved) so it's directly unit-testable; buildMetronomeBuffer
 * below is the thin AudioBuffer-shaped wrapper around it. */

const CLICK_DURATION_SEC = 0.03
const DOWNBEAT_FREQ_HZ = 1600
const OTHER_BEAT_FREQ_HZ = 900
const CLICK_AMPLITUDE = 0.35
const DECAY_RATE = 150

export const METRONOME_BEATS_PER_BAR = 4

/** Sample value of the click track at `sampleTimeSec`, given the tempo
 * (`secPerBeat`) and how many beats make up one bar. Beat 0 (and every
 * `beatsPerBar`th beat after it) gets the higher-pitched downbeat tone; every
 * other beat gets the lower one. Silent everywhere outside each beat's short
 * decaying click window. */
export function metronomeSampleAt(
  sampleTimeSec: number,
  secPerBeat: number,
  beatsPerBar: number = METRONOME_BEATS_PER_BAR
): number {
  if (secPerBeat <= 0 || sampleTimeSec < 0) return 0
  const beatIndex = Math.floor(sampleTimeSec / secPerBeat)
  const timeSinceBeatSec = sampleTimeSec - beatIndex * secPerBeat
  if (timeSinceBeatSec >= CLICK_DURATION_SEC) return 0
  const isDownbeat = beatIndex % beatsPerBar === 0
  const freq = isDownbeat ? DOWNBEAT_FREQ_HZ : OTHER_BEAT_FREQ_HZ
  const envelope = Math.exp(-timeSinceBeatSec * DECAY_RATE)
  return CLICK_AMPLITUDE * envelope * Math.sin(2 * Math.PI * freq * timeSinceBeatSec)
}

/** One loop-length's worth of click track, starting on a downbeat at t=0 —
 * meant to be played with `loop = true, loopStart = 0, loopEnd = durationSec`
 * so it repeats in phase with itself indefinitely, the same way BeatPicker
 * already loops stem preview buffers. */
export function buildMetronomeBuffer(
  ctx: AudioContext,
  durationSec: number,
  secPerBeat: number,
  beatsPerBar: number = METRONOME_BEATS_PER_BAR
): AudioBuffer {
  const sampleRate = ctx.sampleRate
  const length = Math.max(1, Math.round(durationSec * sampleRate))
  const buffer = ctx.createBuffer(1, length, sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < length; i++) {
    data[i] = metronomeSampleAt(i / sampleRate, secPerBeat, beatsPerBar)
  }
  return buffer
}
