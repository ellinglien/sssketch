import { useCallback, useEffect, useRef, useState, type Dispatch } from 'react'
import { useAppState, useDispatch } from '../state/StoreContext'
import {
  resolveOffsetKey,
  offsetStepsForBeatIndex,
  rotationSecondsForStem
} from '../state/selectors'
import type { Action } from '../state/store'
import { linearWave } from '@shared/visuals'
import { getPeaks, getAudioContext } from '../audio/peakCache'
import { SNAP_DIVS } from '../state/store'
import { typeColorVar } from '../theme/typeColor'
import type { Stem } from '@shared/types'

/**
 * Endlesss stems are internally beat-locked, but a rifff's declared bar length can
 * be off by a few beats relative to the timeline's bar boundary. Rather than a
 * numeric offset entry, this shows the identity stem's full waveform with a beat
 * grid overlaid and lets the user click whichever beat is the true downbeat —
 * offsetStepsForBeatIndex converts that click into the shift needed to land it on
 * the clip's timeline start.
 */

// Module-level (not a closure over component state) so it can be called safely
// from markDownbeatRef's effect, which is registered before the early-return guard
// and so can't reference anything declared after it. Bakes every stem in the group
// immediately on pick — this picker is opened right after import now, not after
// placement, so "processed and usable right away" means the audio itself is
// corrected here, not left as a still-pending offset.
async function bakeStems(
  dispatch: Dispatch<Action>,
  groupId: string,
  steps: number,
  snapDiv: number,
  stems: Stem[]
): Promise<void> {
  try {
    const jobs = stems.map((s) => ({
      path: s.path,
      rotationSec: rotationSecondsForStem(steps, snapDiv, s)
    }))
    const results = await window.rifffApi.bakeOffset(jobs)
    dispatch({ type: 'APPLY_BAKE', groupId, results })
  } catch (err) {
    console.error('BeatPicker: failed to bake offset into audio files:', err)
  }
}
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
  // Every stem is decoded, not just the identity one — previewing the whole rifff
  // together (the default) needs all of them. Keyed by slot.
  const [buffers, setBuffers] = useState<Record<number, AudioBuffer>>({})
  const [previewAll, setPreviewAll] = useState(true)
  const [isFreePlaying, setIsFreePlaying] = useState(false)
  // Which gridline (if any) is the source of the audio currently playing — lets a
  // second click on the same beat act as a stop, rather than every click always
  // (re)starting playback with no way to just silence it via the mouse.
  const [previewingBeat, setPreviewingBeat] = useState<number | null>(null)
  // Sweeps across the waveform in real time while free-playing, and separately
  // tracks the pick→baking→baked lifecycle so a beat that resets to 0 after baking
  // (correct — the file itself now starts on the beat) doesn't look like an
  // unexplained jump back to the start.
  const [playheadPct, setPlayheadPct] = useState<number | null>(null)
  const [pickStatus, setPickStatus] = useState<{ beat: number; status: 'baking' | 'baked' } | null>(
    null
  )
  const previewSourcesRef = useRef<AudioBufferSourceNode[]>([])
  const freeStartTimeRef = useRef(0)
  const pickStatusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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
    if (!rifff) return
    let cancelled = false
    Promise.all(
      rifff.stems.map(async (s) => {
        try {
          const bytes = await window.rifffApi.readAudioFile(s.path)
          const arrayBuffer = bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength
          )
          const decoded = await getAudioContext().decodeAudioData(arrayBuffer as ArrayBuffer)
          return [s.slot, decoded] as const
        } catch (err) {
          console.error(`BeatPicker: failed to decode audio for preview playback: ${s.path}`, err)
          return null
        }
      })
    ).then((results) => {
      if (cancelled) return
      const map: Record<number, AudioBuffer> = {}
      for (const r of results) if (r) map[r[0]] = r[1]
      setBuffers(map)
    })
    return () => {
      cancelled = true
    }
  }, [rifff])

  const stopPreview = useCallback(() => {
    for (const source of previewSourcesRef.current) {
      try {
        source.stop()
      } catch {
        // already stopped
      }
    }
    previewSourcesRef.current = []
    setIsFreePlaying(false)
    setPreviewingBeat(null)
    setPlayheadPct(null)
  }, [])

  // Sweeps a vertical marker across the waveform while free-playing, so where the
  // loop currently is has a visual answer, not just an audible one.
  useEffect(() => {
    if (!isFreePlaying || !stem) return
    let raf: number
    const tick = (): void => {
      const elapsed = getAudioContext().currentTime - freeStartTimeRef.current
      setPlayheadPct(((elapsed % stem.durationSec) / stem.durationSec) * 100)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    // Cleanup (not the setup body) is where the reset belongs — it only actually
    // runs once a raf loop was really started, and the react-hooks/set-state-in-effect
    // rule specifically targets synchronous setState in the setup path, not here.
    return () => {
      cancelAnimationFrame(raf)
      setPlayheadPct(null)
    }
  }, [isFreePlaying, stem])

  useEffect(() => {
    return () => {
      if (pickStatusTimeoutRef.current) clearTimeout(pickStatusTimeoutRef.current)
    }
  }, [])

  // onClose is a fresh arrow function from the parent on every render (it closes
  // over setState), so depending on it directly would re-run this effect — and
  // fire its stopPreview() cleanup — on every unrelated re-render, including the
  // one pickBeat's own SET_OFFSET_STEPS dispatch causes. That was cutting the
  // preview off within a render cycle of it starting, no matter what was picked.
  // Reading the latest onClose (and markDownbeat, same issue) through a ref keeps
  // the effect itself stable.
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })

  // Captures the playhead's position within the current free-play loop and locks
  // the offset to whichever beat that falls on — the tap-along alternative to
  // clicking a specific gridline. Re-synced every render (cheap) so it always sees
  // the latest isFreePlaying/stem/dispatch without making the keydown effect below
  // depend on them directly.
  // Self-contained (re-derives totalBeats/offsetKey/snapDiv from rifff/stem/state
  // rather than closing over the consts declared below the early-return guard) —
  // this effect is registered before that guard, same as every other hook here,
  // so it can't depend on bindings that only exist when the guard doesn't fire.
  const markDownbeatRef = useRef<() => void>(() => {})
  useEffect(() => {
    markDownbeatRef.current = () => {
      if (!isFreePlaying || !rifff || !stem) return
      const beatsInLoop = stem.barLength * 4
      const elapsed = getAudioContext().currentTime - freeStartTimeRef.current
      const elapsedInLoop = elapsed % stem.durationSec
      const secPerBeatNative = stem.durationSec / beatsInLoop
      const beatIndex = Math.round(elapsedInLoop / secPerBeatNative) % beatsInLoop
      const snapDivNow = SNAP_DIVS[state.snapIdx]
      const steps = offsetStepsForBeatIndex(beatIndex, snapDivNow)
      dispatch({
        type: 'SET_OFFSET_STEPS',
        key: resolveOffsetKey(state, groupId, stem.slot),
        steps
      })
      // announcePick is a hoisted function declaration (defined below, after the
      // early-return guard) — safe to call here despite that, since function
      // declarations (unlike the const bindings this same file already had to work
      // around) aren't subject to the TDZ that bit onClose/markDownbeat earlier.
      announcePick(beatIndex, bakeStems(dispatch, groupId, steps, snapDivNow, rifff.stems))
    }
  })

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        onCloseRef.current()
        return
      }
      if (e.code === 'Space') {
        e.preventDefault() // otherwise also "clicks" whatever button has focus
        markDownbeatRef.current()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      stopPreview()
    }
  }, [stopPreview])

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

  // Playing several stems through the same destination sums their amplitudes —
  // at unity gain each, more than one or two together clips. sqrt(N) is a standard
  // approximation for keeping combined perceived loudness roughly constant as more
  // sources join, without attenuating a single solo stem at all.
  function previewGain(stemCount: number): number {
    return stemCount > 1 ? 1 / Math.sqrt(stemCount) : 1
  }

  // Shows "picked beat X" immediately, then "baked" once the file's actually
  // rewritten, fading out after a beat. Without this, a pick's offset silently
  // resetting to 0 after baking (correct — the file itself now starts on the
  // beat) just looked like an unexplained jump back to the start.
  function announcePick(beatIndex: number, bakePromise: Promise<void>): void {
    if (pickStatusTimeoutRef.current) clearTimeout(pickStatusTimeoutRef.current)
    setPickStatus({ beat: beatIndex, status: 'baking' })
    bakePromise.then(() => {
      setPickStatus({ beat: beatIndex, status: 'baked' })
      pickStatusTimeoutRef.current = setTimeout(() => setPickStatus(null), 1600)
    })
  }

  function toggleFreePlay(): void {
    if (isFreePlaying) {
      stopPreview()
      return
    }
    stopPreview()
    const ctx = getAudioContext()
    freeStartTimeRef.current = ctx.currentTime
    const stemsToPreview = previewAll ? rifff.stems : [stem]
    const gain = previewGain(stemsToPreview.length)
    for (const s of stemsToPreview) {
      const buf = buffers[s.slot]
      if (!buf) continue
      const source = ctx.createBufferSource()
      source.buffer = buf
      source.loop = true // loops the whole buffer from its own start, repeatedly
      const gainNode = ctx.createGain()
      gainNode.gain.value = gain
      source.connect(gainNode)
      gainNode.connect(ctx.destination)
      source.start(0)
      previewSourcesRef.current.push(source)
    }
    setIsFreePlaying(true)
  }

  function pickBeat(beatIndex: number): void {
    // A second click on the currently-playing beat just stops it — commit/bake
    // already happened on the first click, nothing new to do.
    const wasPlayingThis = previewingBeat === beatIndex
    stopPreview()
    if (wasPlayingThis) return

    const steps = offsetStepsForBeatIndex(beatIndex, snapDiv)
    dispatch({ type: 'SET_OFFSET_STEPS', key: offsetKey, steps })

    // Defaults to every stem together, not just the identity one: they're all
    // beat-locked to the same clock within a rifff, so hearing the full mix
    // land on the picked beat is what actually confirms the downbeat is right —
    // rotationSecondsForStem gives each stem its own equivalent position, wrapped
    // by its own (possibly shorter, tiling) loop length.
    const stemsToPreview = previewAll ? rifff.stems : [stem]
    const ctx = getAudioContext()
    const gain = previewGain(stemsToPreview.length)
    for (const s of stemsToPreview) {
      const buf = buffers[s.slot]
      if (!buf) continue
      const offsetSec = rotationSecondsForStem(steps, snapDiv, s)
      if (offsetSec >= buf.duration) continue
      const source = ctx.createBufferSource()
      source.buffer = buf
      // Loops the picked-beat-to-end segment continuously — stems are often short
      // (1-2 bar) loops, so a single play-through can be too brief to judge the
      // downbeat by ear. Looping mirrors how it actually sounds once placed in the
      // arranger. stopPreview() (called above, and again on the next pick or on
      // close) is what ends it, since a looped source never stops itself.
      source.loop = true
      source.loopStart = offsetSec
      source.loopEnd = buf.duration
      const gainNode = ctx.createGain()
      gainNode.gain.value = gain
      source.connect(gainNode)
      gainNode.connect(ctx.destination)
      source.start(0, offsetSec)
      previewSourcesRef.current.push(source)
    }
    setPreviewingBeat(beatIndex)
    announcePick(beatIndex, bakeStems(dispatch, rifff.groupId, steps, snapDiv, rifff.stems))
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
              click a beat in {stem.name}, or play the loop and hit space on the downbeat
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
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginTop: 10
          }}
        >
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 10,
              color: 'var(--ra-text-2)'
            }}
          >
            <input
              type="checkbox"
              checked={previewAll}
              onChange={(e) => setPreviewAll(e.target.checked)}
            />
            preview all stems together (they’re beat-locked to the same clock)
          </label>
          <button
            onClick={toggleFreePlay}
            style={{
              height: 22,
              borderRadius: 6,
              padding: '0 10px',
              fontSize: 10,
              border: '1px solid var(--ra-border-strong)',
              background: isFreePlaying ? 'var(--ra-play-on)' : 'var(--ra-bg-row-active)',
              color: isFreePlaying ? 'var(--ra-play-on-ink)' : 'var(--ra-text)'
            }}
          >
            {isFreePlaying ? '■ stop · space to mark the beat' : '▶ play loop'}
          </button>
        </div>

        {pickStatus && (
          <div
            style={{
              marginTop: 8,
              fontSize: 11,
              fontWeight: 700,
              color: pickStatus.status === 'baking' ? 'var(--ra-text-2)' : 'var(--ra-play-on)'
            }}
          >
            {pickStatus.status === 'baking'
              ? `picked beat ${pickStatus.beat + 1} — baking into the audio…`
              : `✓ beat ${pickStatus.beat + 1} baked — the audio itself now starts on the beat (so it shows as beat 1 above)`}
          </div>
        )}

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
                  pickStatus?.beat === beatIndex
                    ? 'color-mix(in srgb, var(--ra-play-on) 35%, transparent)'
                    : beatIndex === currentBeat
                      ? 'color-mix(in srgb, var(--ra-text) 18%, transparent)'
                      : 'transparent',
                cursor: 'pointer'
              }}
            />
          ))}
          {playheadPct !== null && (
            <div
              style={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                left: `${playheadPct}%`,
                width: 2,
                background: 'var(--ra-playhead)',
                pointerEvents: 'none'
              }}
            />
          )}
        </div>

        <div style={{ marginTop: 10, fontSize: 10, color: 'var(--ra-text-3)' }}>
          beat {currentBeat + 1} of {totalBeats} — baked into the audio automatically on pick. click
          the playing beat again to stop it.
        </div>
      </div>
    </div>
  )
}
