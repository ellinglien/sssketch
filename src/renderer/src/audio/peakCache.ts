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
    const bytes = await window.rifffApi.readAudioFile(path)
    const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    const audioBuffer = await getContext().decodeAudioData(arrayBuffer as ArrayBuffer)
    return peaksFromChannel(audioBuffer.getChannelData(0), 128)
  })()

  cache.set(path, promise)
  return promise
}

export function getAudioContext(): AudioContext {
  return getContext()
}
