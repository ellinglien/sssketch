import { useEffect, useRef, useState } from 'react'
import { useAppState, useDispatch } from '../state/StoreContext'
import { resolveOffsetKey, offsetStepsForBeatIndex } from '../state/selectors'
import { linearWave } from '@shared/visuals'
import { getPeaks, getAudioContext } from '../audio/peakCache'
import { SNAP_DIVS } from '../state/store'
import { typeColorVar } from '../theme/typeColor'

/**
 * Endlesss stems are internally beat-locked, but a rifff's declared bar length can
 * be off by a few beats relative to the timeline's bar boundary. Rather than a
 * numeric offset entry, this shows the identity stem's full waveform with a beat
 * grid overlaid and lets the user click whichever beat is the true downbeat —
 * offsetStepsForBeatIndex converts that click into the shift needed to land it on
 * the clip's timeline start.
 */
export function BeatPicker({
  groupId,
  onClose
}: {
  groupId: string
  onClose: () => void
}): React.JSX.Element | null {
  const state = useAppState()
  const dispatch = useDispatch()
  const rifff = state.rifffs[groupId]
  const stem = rifff?.stems[0]
  const [peaks, setPeaks] = useState<number[] | null>(null)
  const [buffer, setBuffer] = useState<AudioBuffer | null>(null)
  const previewSourceRef = useRef<AudioBufferSourceNode | null>(null)

  useEffect(() => {
    if (!stem) return
    let cancelled = false
    getPeaks(stem.path).then((p) => {
      if (!cancelled) setPeaks(p)
    })
    return () => {
      cancelled = true
    }
  }, [stem])

  // Decoded separately from getPeaks (which only keeps a 128-bucket summary) since
  // previewing playback needs the actual samples, not just their downsampled peaks.
  useEffect(() => {
    if (!stem) return
    let cancelled = false
    ;(async () => {
      try {
        const bytes = await window.rifffApi.readAudioFile(stem.path)
        const arrayBuffer = bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength
        )
        const decoded = await getAudioContext().decodeAudioData(arrayBuffer as ArrayBuffer)
        if (!cancelled) setBuffer(decoded)
      } catch (err) {
        console.error(`BeatPicker: failed to decode audio for preview playback: ${stem.path}`, err)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [stem])

  function stopPreview(): void {
    try {
      previewSourceRef.current?.stop()
    } catch {
      // already stopped
    }
    previewSourceRef.current = null
  }

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      stopPreview()
    }
  }, [onClose])

  if (!rifff || !stem) return null

  const color = typeColorVar(stem.type)
  const snapDiv = SNAP_DIVS[state.snapIdx]
  const offsetKey = resolveOffsetKey(state, groupId, stem.slot)
  const currentSteps = state.off[offsetKey] ?? 0
  // The waveform/peaks span exactly this stem's own duration, not the rifff's — using
  // rifff.barLength here would mis-space the gridlines whenever the identity stem is
  // shorter than the rifff (e.g. a 2-bar stem tiled across an 8-bar rifff).
  const totalBeats = stem.barLength * 4
  const currentBeat = Math.round((-currentSteps * 4) / snapDiv)

  function pickBeat(beatIndex: number): void {
    dispatch({
      type: 'SET_OFFSET_STEPS',
      key: offsetKey,
      steps: offsetStepsForBeatIndex(beatIndex, snapDiv)
    })

    if (!buffer || !stem) return
    stopPreview()
    const secPerBeatNative = stem.durationSec / totalBeats
    const offsetSec = beatIndex * secPerBeatNative
    if (offsetSec >= buffer.duration) return
    const source = getAudioContext().createBufferSource()
    source.buffer = buffer
    source.connect(getAudioContext().destination)
    // Loops the picked-beat-to-end segment continuously — the identity stem is
    // often a short (1-2 bar) loop, so a single play-through can be too brief to
    // judge the downbeat by ear. Looping mirrors how it actually sounds once
    // placed in the arranger. stopPreview() (called above, and again on the next
    // pick or on close) is what ends it, since a looped source never stops itself.
    source.loop = true
    source.loopStart = offsetSec
    source.loopEnd = buffer.duration
    source.start(0, offsetSec)
    previewSourceRef.current = source
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 700,
          maxWidth: '90vw',
          background: 'var(--ra-bg-bar)',
          border: '1px solid var(--ra-border-strong)',
          borderRadius: 8,
          padding: 16
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <div>
            <span className="ra-eyebrow">pick the downbeat</span>
            <div style={{ fontSize: 11, color: 'var(--ra-text-2)', marginTop: 4 }}>
              click the beat in {stem.name} that should land on bar 1 — offset locks to that beat
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              height: 22,
              borderRadius: 6,
              padding: '0 10px',
              fontSize: 10,
              border: '1px solid var(--ra-border)',
              background: 'var(--ra-bg-row-active)',
              color: 'var(--ra-text-2)'
            }}
          >
            close
          </button>
        </div>

        <div
          style={{
            position: 'relative',
            height: 140,
            marginTop: 14,
            border: '1px solid var(--ra-border)',
            borderRadius: 6,
            overflow: 'hidden',
            background: 'var(--ra-bg-row)'
          }}
        >
          {peaks && (
            <svg
              width="100%"
              height="100%"
              viewBox="0 0 128 100"
              preserveAspectRatio="none"
              style={{ position: 'absolute', inset: 0 }}
            >
              <path d={linearWave(peaks)} fill={color} opacity={0.75} />
            </svg>
          )}
          {Array.from({ length: totalBeats }, (_, i) => i).map((beatIndex) => (
            <button
              key={beatIndex}
              onClick={() => pickBeat(beatIndex)}
              title={`beat ${beatIndex + 1}`}
              style={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                left: `${(beatIndex / totalBeats) * 100}%`,
                width: `${100 / totalBeats}%`,
                border: 'none',
                borderLeft:
                  beatIndex % 4 === 0
                    ? '1px solid var(--ra-border-strong)'
                    : '1px solid var(--ra-grid-minor)',
                background:
                  beatIndex === currentBeat
                    ? 'color-mix(in srgb, var(--ra-text) 18%, transparent)'
                    : 'transparent',
                cursor: 'pointer'
              }}
            />
          ))}
        </div>

        <div style={{ marginTop: 10, fontSize: 10, color: 'var(--ra-text-3)' }}>
          currently locked to beat {currentBeat + 1} of {totalBeats}
        </div>
      </div>
    </div>
  )
}
