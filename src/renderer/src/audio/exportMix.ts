import { computeStemSchedule } from '@shared/schedulePlayback'
import { encodeWavPCM16 } from '@shared/encodeWav'
import { stemKey } from '@shared/types'
import { resolveOffsetKey, stemStartBar, loopLengthBars } from '../state/selectors'
import { SNAP_DIVS, type AppState } from '../state/store'
import { applyFade } from './fadeGain'

const EXPORT_SAMPLE_RATE = 44100

/**
 * Loads a stem's audio for offline rendering — the same stretch-then-decode
 * pipeline AudioEngine.loadBuffer uses for live playback, but decoding into
 * whichever BaseAudioContext is passed in (an OfflineAudioContext here) rather
 * than always the shared live AudioContext, and without that function's
 * playback-cache (a one-shot render has no reason to keep buffers around after).
 */
async function loadBufferForExport(
  ctx: OfflineAudioContext,
  path: string,
  ratio: number
): Promise<AudioBuffer> {
  let resolvedPath = path
  if (Math.abs(ratio - 1) >= 0.001) {
    try {
      resolvedPath = await window.rifffApi.renderStretched(path, ratio)
    } catch (err) {
      console.error(
        `exportMix: rubberband render failed for "${path}" at ratio ${ratio}, using native tempo`,
        err
      )
      resolvedPath = path
    }
  }
  const bytes = await window.rifffApi.readAudioFile(resolvedPath)
  const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  return ctx.decodeAudioData(arrayBuffer as ArrayBuffer)
}

/**
 * Renders the full arrangement (one pass through the loop) offline — faster than
 * real-time, and without needing actual audio output — and encodes the result as
 * a 16-bit WAV. Reuses computeStemSchedule (the same segment math live playback
 * uses) so the export matches what you'd actually hear, including offset,
 * per-stem stretch, mute, volume, and unlinked/dragged stem positions.
 */
export async function renderMixToWav(state: AppState): Promise<Uint8Array> {
  const loopBars = loopLengthBars(state)
  const secPerBar = (60 / state.bpm) * 4
  const totalSec = loopBars * secPerBar
  const ctx = new OfflineAudioContext(
    2,
    Math.max(1, Math.ceil(totalSec * EXPORT_SAMPLE_RATE)),
    EXPORT_SAMPLE_RATE
  )

  const placed = Object.values(state.rifffs).filter((r) => r.startBar !== undefined)
  for (const rifff of placed) {
    const stretchOn = state.stretch[rifff.groupId] ?? true
    const ratio = stretchOn ? state.bpm / rifff.bpm : 1

    for (const stem of rifff.stems) {
      const key = stemKey(rifff.groupId, stem.slot)
      if (state.mute[key]) continue
      const volume = state.vol[key] ?? 1
      if (volume <= 0) continue

      try {
        const offsetSteps = state.off[resolveOffsetKey(state, rifff.groupId, stem.slot)] ?? 0
        const segments = computeStemSchedule(rifff, stem, {
          offsetSteps,
          snapDiv: SNAP_DIVS[state.snapIdx],
          projectPos: 0,
          projectBpm: state.bpm,
          startBarOverride: stemStartBar(state, rifff.groupId, stem.slot)
        })
        if (segments.length === 0) continue

        const buffer = await loadBufferForExport(ctx, stem.path, ratio)
        const gain = ctx.createGain()
        gain.gain.value = volume
        gain.connect(ctx.destination)
        const fadeConfig = {
          fadeInBars: state.fadeIn[rifff.groupId] ?? 0,
          fadeOutBars: state.fadeOut[rifff.groupId] ?? 0,
          secPerBar
        }

        segments.forEach((seg, i) => {
          if (seg.durationSec <= 0) return
          const source = ctx.createBufferSource()
          source.buffer = buffer
          // A dedicated per-segment gain node carries the fade envelope, kept
          // separate from `gain` (the stem's overall volume) — see AudioEngine.play()
          // for the same split, which this export is meant to match.
          const segGain = ctx.createGain()
          source.connect(segGain)
          segGain.connect(gain)
          const when = Math.max(0, seg.startBarInTimeline) * secPerBar
          applyFade(
            segGain.gain,
            when,
            seg.durationSec,
            i === 0,
            i === segments.length - 1,
            true, // export always starts each segment fresh — there's no live resume case
            fadeConfig
          )
          source.start(when, seg.bufferOffsetSec, seg.durationSec)
        })
      } catch (err) {
        // One stem failing to render (corrupt file, moved/deleted path) shouldn't
        // abort the whole export — same failure-isolation pattern AudioEngine.play()
        // already uses for live playback.
        console.error(`exportMix: failed to render stem "${stem.path}"`, err)
      }
    }
  }

  const rendered = await ctx.startRendering()
  const channels: Float32Array[] = []
  for (let ch = 0; ch < rendered.numberOfChannels; ch++) {
    channels.push(rendered.getChannelData(ch))
  }
  return encodeWavPCM16(channels, rendered.sampleRate)
}
