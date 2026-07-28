import { peaksFromChannel } from '@shared/visuals'

const cache = new Map<string, Promise<number[]>>()
let sharedContext: AudioContext | null = null

function getContext(): AudioContext {
  if (!sharedContext) sharedContext = new AudioContext()
  return sharedContext
}

export function getPeaks(path: string): Promise<number[]> {
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
      return peaksFromChannel(audioBuffer.getChannelData(0), 128)
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

export function getAudioContext(): AudioContext {
  return getContext()
}
