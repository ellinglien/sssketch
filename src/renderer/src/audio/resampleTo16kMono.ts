// src/renderer/src/audio/resampleTo16kMono.ts

/** YAMNet's own required input sample rate (verified against the vendored
 * model's input spec). */
export const YAMNET_SAMPLE_RATE = 16000

/** Resamples an already-decoded AudioBuffer to 16kHz mono, via
 * OfflineAudioContext -- the standard browser-native way to resample
 * (render the buffer through a context created at the TARGET sample rate).
 * Only YAMNet extraction needs this; every other analysis in this codebase
 * works directly at the source sample rate, so this is deliberately its own
 * small module rather than folded into peakCache.ts/stemFeaturesCache.ts's
 * own decode path. Downmixes to mono by averaging all channels (simple,
 * standard approach -- YAMNet's own training data is mono, so there's no
 * "correct" stereo-to-mono weighting to preserve). */
export async function resampleTo16kMono(audioBuffer: AudioBuffer): Promise<Float32Array> {
  const durationSec = audioBuffer.duration
  const targetLength = Math.ceil(durationSec * YAMNET_SAMPLE_RATE)
  const offlineCtx = new OfflineAudioContext(1, targetLength, YAMNET_SAMPLE_RATE)

  // Downmix every source channel into one mono buffer BEFORE feeding it to
  // the OfflineAudioContext -- simplest way to guarantee mono output
  // regardless of how many channels the source has, without relying on the
  // destination's own implicit channel-count behavior (which downmixes by
  // a different, non-simple-average formula for stereo->mono).
  const monoSamples = new Float32Array(audioBuffer.length)
  const numChannels = audioBuffer.numberOfChannels
  for (let ch = 0; ch < numChannels; ch++) {
    const channelData = audioBuffer.getChannelData(ch)
    for (let i = 0; i < channelData.length; i++) monoSamples[i] += channelData[i] / numChannels
  }

  const monoBuffer = offlineCtx.createBuffer(1, audioBuffer.length, audioBuffer.sampleRate)
  monoBuffer.copyToChannel(monoSamples, 0)

  const source = offlineCtx.createBufferSource()
  source.buffer = monoBuffer
  source.connect(offlineCtx.destination)
  source.start()

  const rendered = await offlineCtx.startRendering()
  return rendered.getChannelData(0)
}
