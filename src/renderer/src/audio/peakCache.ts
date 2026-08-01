import { peaksFromChannel, zcrFromChannel } from '@shared/visuals'

interface WaveformAnalysis {
  peaks: number[]
  /** Per-bucket zero-crossing-rate brightness (see zcrFromChannel) — same
   * 128-bucket resolution as peaks, computed from the same decode so a
   * consumer wanting both (e.g. Waveform.tsx's brightness treatment)
   * doesn't pay for a second read+decode of the same file. */
  brightness: number[]
}

const cache = new Map<string, Promise<WaveformAnalysis>>()
let sharedContext: AudioContext | null = null

function getContext(): AudioContext {
  if (!sharedContext) sharedContext = new AudioContext()
  return sharedContext
}

function getAnalysis(path: string): Promise<WaveformAnalysis> {
  const cached = cache.get(path)
  if (cached) return cached

  const promise = (async () => {
    try {
      const bytes = await window.rifffApi.readAudioFile(path)
      // Defensive copy: bytes.buffer may be a larger backing ArrayBuffer than the
      // Uint8Array's own view (e.g. depending on how it was reconstituted across the
      // IPC boundary), so slice out exactly this view's byte range rather than
      // handing decodeAudioData the raw (possibly oversized) backing buffer.
      const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
      const audioBuffer = await getContext().decodeAudioData(arrayBuffer as ArrayBuffer)
      const channel = audioBuffer.getChannelData(0)
      return { peaks: peaksFromChannel(channel, 128), brightness: zcrFromChannel(channel, 128) }
    } catch (err) {
      // Don't let a transient failure (mid-copy read, permission hiccup, corrupt
      // file) permanently blacklist this path — evict so a future call retries
      // instead of reusing a forever-rejected promise.
      cache.delete(path)
      throw err
    }
  })()

  cache.set(path, promise)
  return promise
}

export function getPeaks(path: string): Promise<number[]> {
  return getAnalysis(path).then((a) => a.peaks)
}

/** Per-bucket "how much high-frequency content is here" — see
 * zcrFromChannel's own doc comment. Used by Waveform.tsx's brightness
 * treatment to make hi-hats/transients read brighter than sustained bass,
 * without a second decode of the same file getPeaks already triggered. */
export function getBrightness(path: string): Promise<number[]> {
  return getAnalysis(path).then((a) => a.brightness)
}

export function getAudioContext(): AudioContext {
  return getContext()
}
