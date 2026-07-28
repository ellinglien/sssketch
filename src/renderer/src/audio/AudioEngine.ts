import { computeStemSchedule } from '@shared/schedulePlayback'
import type { Rifff } from '@shared/types'
import { getAudioContext } from './peakCache'

interface EngineDeps {
  getRifffs: () => Rifff[]
  getOffsetSteps: (groupId: string, slot: number) => number
  getSnapDiv: () => number
  getVolume: (stemKey: string) => number
  isMuted: (stemKey: string) => boolean
  getProjectBpm: () => number
}

const bufferCache = new Map<string, Promise<AudioBuffer>>()

async function loadBuffer(path: string): Promise<AudioBuffer> {
  const cached = bufferCache.get(path)
  if (cached) return cached
  const promise = (async () => {
    try {
      const bytes = await window.rifffApi.readAudioFile(path)
      const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
      return await getAudioContext().decodeAudioData(arrayBuffer as ArrayBuffer)
    } catch (err) {
      // Don't let a transient failure (mid-copy read, permission hiccup, corrupt
      // file, moved/deleted file) permanently blacklist this path — evict so a
      // later play() call retries instead of reusing a forever-rejected promise.
      bufferCache.delete(path)
      throw err
    }
  })()
  bufferCache.set(path, promise)
  return promise
}

export class AudioEngine {
  private deps: EngineDeps
  private activeSources: AudioBufferSourceNode[] = []
  private gainNodes = new Map<string, GainNode>()
  private startContextTime = 0
  private startPos = 0
  private secPerBar = 0
  // play() has two await points (ctx.resume(), loadBuffer() per stem). Since play()
  // can now be called again before an earlier call has finished (loop-wrap reschedule,
  // live offset/tempo/snap/unlink reschedule, and a plain rapid play/pause/play both
  // race a stale call resuming), a stale continuation must not call stopSources() or
  // schedule sources using its own now-overwritten startContextTime/secPerBar — that
  // would either kill the newer call's freshly-started sources or schedule audio at
  // the wrong time. Each play()/stop() call claims a new generation; a continuation
  // that finds it's no longer current abandons itself instead of touching shared state.
  private generation = 0

  constructor(deps: EngineDeps) {
    this.deps = deps
  }

  private gainFor(stemKeyStr: string): GainNode {
    let node = this.gainNodes.get(stemKeyStr)
    if (!node) {
      node = getAudioContext().createGain()
      node.connect(getAudioContext().destination)
      this.gainNodes.set(stemKeyStr, node)
    }
    this.applyGain(stemKeyStr, node)
    return node
  }

  private applyGain(stemKeyStr: string, node: GainNode): void {
    const muted = this.deps.isMuted(stemKeyStr)
    node.gain.value = muted ? 0 : this.deps.getVolume(stemKeyStr)
  }

  updateLiveGains(): void {
    for (const [key, node] of this.gainNodes) this.applyGain(key, node)
  }

  async play(fromPos: number): Promise<void> {
    const myGeneration = ++this.generation
    const ctx = getAudioContext()
    await ctx.resume()
    // A newer play()/stop() call already claimed the engine while we were awaiting
    // resume() — don't call stopSources() (it would kill that newer call's sources)
    // and don't schedule anything using our now-stale fromPos/timing.
    if (myGeneration !== this.generation) return
    this.stopSources()

    const bpm = this.deps.getProjectBpm()
    this.secPerBar = (60 / bpm) * 4
    this.startContextTime = ctx.currentTime
    this.startPos = fromPos

    const rifffs = this.deps.getRifffs().filter((r) => r.startBar !== undefined)
    for (const rifff of rifffs) {
      for (const stem of rifff.stems) {
        // Each stem is scheduled independently so a load/decode failure for one stem
        // (corrupt file, moved/deleted path, permission hiccup) doesn't abort
        // scheduling for the rest of this rifff or any other rifff on the timeline —
        // same failure-isolation pattern as peakCache.ts's getPeaks (Task 12).
        try {
          const stemKeyStr = `${rifff.groupId}:${stem.slot}`
          const offsetSteps = this.deps.getOffsetSteps(rifff.groupId, stem.slot)
          const segments = computeStemSchedule(rifff, stem, {
            offsetSteps,
            snapDiv: this.deps.getSnapDiv(),
            projectPos: fromPos,
            projectBpm: bpm
          })
          if (segments.length === 0) continue

          const buffer = await loadBuffer(stem.path)
          // Superseded mid-load: a newer call has already scheduled its own sources
          // (possibly for this very stem) using fresh timing — abandon this one
          // rather than double-schedule or use our stale startContextTime/secPerBar.
          if (myGeneration !== this.generation) return
          const gain = this.gainFor(stemKeyStr)

          for (const seg of segments) {
            const source = ctx.createBufferSource()
            source.buffer = buffer
            source.connect(gain)
            const barsFromNow = seg.startBarInTimeline - fromPos
            const when = this.startContextTime + Math.max(0, barsFromNow) * this.secPerBar
            const bufferOffset = barsFromNow < 0 ? -barsFromNow * this.secPerBar : 0
            const duration = seg.durationSec - bufferOffset
            if (duration <= 0) continue
            source.start(when, seg.bufferOffsetSec + bufferOffset, duration)
            this.activeSources.push(source)
          }
        } catch (err) {
          console.error(`AudioEngine: failed to load/schedule stem "${stem.path}"`, err)
        }
      }
    }
  }

  stop(): void {
    // Claim a new generation so an in-flight play() continuation (paused at an
    // await when stop() is called) finds itself stale and abandons rather than
    // scheduling audio after the user asked for silence.
    this.generation++
    this.stopSources()
  }

  private stopSources(): void {
    for (const source of this.activeSources) {
      try {
        source.stop()
      } catch {
        // already stopped
      }
    }
    this.activeSources = []
  }

  currentPos(loopBars: number): number {
    // secPerBar is 0 until play()'s ctx.resume() resolves (async gap on the very
    // first play, before startContextTime/secPerBar are set) — dividing by it then
    // would produce NaN. A poll landing in that narrow window just reports the
    // position play() was called with; the next poll (after resume() settles)
    // reports the real elapsed time.
    if (this.secPerBar === 0) return this.startPos

    const ctx = getAudioContext()
    const elapsedBars = (ctx.currentTime - this.startContextTime) / this.secPerBar
    return (this.startPos + elapsedBars) % loopBars
  }
}
