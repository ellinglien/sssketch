import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch } from 'react'
import { useAppState, useDispatch, usePlaying } from '../state/StoreContext'
import {
  resolveOffsetKey,
  offsetStepsForBeatIndex,
  rotationSecondsForStem
} from '../state/selectors'
import type { Action } from '../state/store'
import { linearWave, peaksFromChannel } from '@shared/visuals'
import { sqrtGain } from '@shared/mixGain'
import { getAudioContext } from '../audio/peakCache'
import { stopActivePreview } from '../audio/previewLoop'
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
// and so can't reference anything declared after it. Called once, when the picker
// closes — not on every pick, which would rewrite the file on every exploratory
// click while auditioning candidates, making "the one" a moving target.
//
// Exported so callers driving a batch downbeat-correction flow (e.g. the LORE
// library browser importing several riffs from the same jam at once) can
// apply the same picked offset to sibling riffs directly, without opening
// this picker again for each one — see onBaked below.
// eslint-disable-next-line react-refresh/only-export-components -- shared helper, not a component
export async function bakeStems(
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
/** Returns a copy of `buf` circularly shifted so the sample at `offsetSec`
 * becomes sample 0, preserving every channel — used to preview a picked
 * downbeat as a full-length loop starting exactly there, matching what
 * baking actually produces on disk. Looping just [offsetSec, duration)
 * (the previous approach) meant a beat picked near the end of the loop
 * produced a loop of almost zero length — this always loops the stem's
 * full duration, just rotated. */
function rotateBuffer(ctx: AudioContext, buf: AudioBuffer, offsetSec: number): AudioBuffer {
  const offsetSamples = Math.round(offsetSec * buf.sampleRate)
  if (offsetSamples <= 0 || offsetSamples >= buf.length) return buf
  const rotated = ctx.createBuffer(buf.numberOfChannels, buf.length, buf.sampleRate)
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const src = buf.getChannelData(ch)
    const dst = rotated.getChannelData(ch)
    dst.set(src.subarray(offsetSamples))
    dst.set(src.subarray(0, offsetSamples), buf.length - offsetSamples)
  }
  return rotated
}

export function BeatPicker({
  groupId,
  onClose,
  onBaked
}: {
  groupId: string
  onClose: () => void
  /** Fired once, right after a real bake actually happens (i.e. the user
   * picked/marked a beat and this closed rather than being dismissed with
   * nothing picked) — with the exact snap-grid `steps` offset that was
   * applied. Lets a caller propagate the same correction to sibling riffs
   * it knows share this one's clock phase (see bakeStems above), rather
   * than making the user re-pick the downbeat for every riff individually. */
  onBaked?: (steps: number) => void
}): React.JSX.Element | null {
  const state = useAppState()
  const dispatch = useDispatch()
  const playing = usePlaying()
  const rifff = state.rifffs[groupId]
  const stem = rifff?.stems[0]
  // Every stem is decoded, not just the identity one — previewing the whole rifff
  // together (the default) needs all of them. Keyed by slot.
  const [buffers, setBuffers] = useState<Record<number, AudioBuffer>>({})
  const [previewAll, setPreviewAll] = useState(true)
  const [isFreePlaying, setIsFreePlaying] = useState(false)
  // Which gridline (if any) is the source of the audio currently playing — lets a
  // second click on the same beat act as a stop, rather than every click always
  // (re)starting playback with no way to just silence it via the mouse.
  const [previewingBeat, setPreviewingBeat] = useState<number | null>(null)
  // Sweeps across the waveform in real time while free-playing.
  const [playheadPct, setPlayheadPct] = useState<number | null>(null)
  const previewSourcesRef = useRef<AudioBufferSourceNode[]>([])
  const freeStartTimeRef = useRef(0)
  // The latest un-baked pick (offset steps), or null once baked/if nothing's been
  // picked this session. Only baking on close — not on every pick — means
  // auditioning several candidate beats doesn't rewrite the file each time; only
  // whichever one you actually leave it on when you close does.
  const pendingBakeRef = useRef<number | null>(null)

  // Runs once, right when this picker opens (mount) — real bug this fixed:
  // previewing a riff in the LORE library browser, then importing it, left
  // that preview looping underneath the downbeat picker with no way to hear
  // the picker's own audio over it. BeatPicker's own toggleFreePlay/pickBeat
  // already pause the main arrangement when THEY start playing something,
  // but that's reactive — it does nothing about a preview already running
  // elsewhere (Shelf's tile preview or the LORE browser's own) at the
  // moment this picker takes over the screen. Silencing everything else the
  // instant it opens means the picker's own audio is always what you hear.
  useEffect(() => {
    stopActivePreview()
    if (playing) dispatch({ type: 'PAUSE' })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberately mount-only: re-running on every `playing` change would re-pause every time the main arrangement is resumed while this picker happens to still be open, which is never the intent
  }, [])

  // The waveform shown is the whole rifff mixed together, spanning the whole
  // rifff's own bar length — not just the identity stem's own (possibly much
  // shorter) native loop. Real bug this fixed: a rifff whose identity stem
  // (stems[0]) was a short 4-bar drum loop, but with other stems running much
  // longer, only ever showed/gridded those 4 bars — hiding most of the loop
  // (and wherever ITS downbeat-relevant transients were) from the picker
  // entirely. secPerBar is derived from the identity stem's own known
  // duration/barLength (every stem in a rifff is beat-locked to the same
  // clock, so this is exactly the rifff's own tempo), matching
  // schedulePlayback.ts's identical derivation. Every stem (identity
  // included) is tiled across that full span by repeating its buffer from
  // the start (`i % data.length`), the same way computeStemSchedule tiles a
  // shorter stem across a longer rifff — so the mix stays aligned to the
  // same beat grid the picker's gridlines are drawn against. A pure
  // derivation of rifff/stem/buffers, so useMemo (not an effect writing to
  // its own state) is the right tool.
  const peaks = useMemo<number[] | null>(() => {
    if (!rifff || !stem) return null
    const identityBuf = buffers[stem.slot]
    if (!identityBuf) return null
    const secPerBar = stem.durationSec / stem.barLength
    const totalSamples = Math.round(secPerBar * rifff.barLength * identityBuf.sampleRate)
    const mix = new Float32Array(totalSamples)
    for (const s of rifff.stems) {
      const buf = buffers[s.slot]
      if (!buf) continue
      const data = buf.getChannelData(0)
      if (data.length === 0) continue
      for (let i = 0; i < mix.length; i++) {
        mix[i] += data[i % data.length]
      }
    }
    return peaksFromChannel(mix, 128)
  }, [rifff, stem, buffers])

  // Decoded here (not just getPeaks' 128-bucket summary) since previewing
  // playback and the combined-waveform display above both need the actual samples.
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

  // Sweeps a vertical marker across the waveform whenever anything from this
  // picker is playing — free-play (isFreePlaying) OR a specific clicked beat
  // (previewingBeat) — so where the loop currently is has a visual answer,
  // not just an audible one. Previously only ran for free-play, leaving
  // click-to-pick with no visible playhead at all. Spans the whole rifff
  // (not just the identity stem's own duration) — same reasoning as peaks
  // above, so the sweep matches what's actually drawn. pickBeat's preview
  // plays a buffer ROTATED to start at the clicked beat (see rotateBuffer),
  // so the sweep has to add that beat's own position back in to land on the
  // right spot of the un-rotated waveform being displayed.
  useEffect(() => {
    if ((!isFreePlaying && previewingBeat === null) || !stem || !rifff) return
    const riffDurationSec = (stem.durationSec / stem.barLength) * rifff.barLength
    const totalBeats = rifff.barLength * 4
    const startPositionSec =
      previewingBeat !== null ? previewingBeat * (riffDurationSec / totalBeats) : 0
    let raf: number
    const tick = (): void => {
      const elapsed = getAudioContext().currentTime - freeStartTimeRef.current
      const positionSec = (startPositionSec + elapsed) % riffDurationSec
      setPlayheadPct((positionSec / riffDurationSec) * 100)
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
  }, [isFreePlaying, previewingBeat, stem, rifff])

  // commitAndClose is a fresh function every render (it closes over onClose/rifff/
  // state), so depending on it directly would re-run this effect — and fire its
  // stopPreview() cleanup — on every unrelated re-render, including the one
  // pickBeat's own SET_OFFSET_STEPS dispatch causes. That was cutting the preview
  // off within a render cycle of it starting, no matter what was picked. Reading
  // the latest version (and markDownbeat, same issue) through a ref keeps the
  // effect itself stable.
  const commitAndCloseRef = useRef<() => void>(() => {})
  const markDownbeatRef = useRef<() => void>(() => {})
  useEffect(() => {
    commitAndCloseRef.current = () => {
      if (pendingBakeRef.current !== null && rifff) {
        const steps = pendingBakeRef.current
        pendingBakeRef.current = null
        bakeStems(dispatch, rifff.groupId, steps, SNAP_DIVS[state.snapIdx], rifff.stems)
        onBaked?.(steps)
      }
      stopPreview()
      onClose()
    }

    // Captures the playhead's position within the current free-play loop and marks
    // (but doesn't yet bake) whichever beat that falls on — the tap-along
    // alternative to clicking a specific gridline. Self-contained (re-derives
    // totalBeats/offsetKey/snapDiv from rifff/stem/state rather than closing over
    // the consts declared below the early-return guard) — this effect is
    // registered before that guard, same as every other hook here, so it can't
    // depend on bindings that only exist when the guard doesn't fire.
    markDownbeatRef.current = () => {
      if (!isFreePlaying || !rifff || !stem) return
      // Spans the whole rifff, not just the identity stem's own duration —
      // same reasoning as peaks/totalBeats above.
      const beatsInLoop = rifff.barLength * 4
      const riffDurationSec = (stem.durationSec / stem.barLength) * rifff.barLength
      const elapsed = getAudioContext().currentTime - freeStartTimeRef.current
      const elapsedInLoop = elapsed % riffDurationSec
      const secPerBeatNative = riffDurationSec / beatsInLoop
      const beatIndex = Math.round(elapsedInLoop / secPerBeatNative) % beatsInLoop
      const steps = offsetStepsForBeatIndex(beatIndex, SNAP_DIVS[state.snapIdx])
      dispatch({
        type: 'SET_OFFSET_STEPS',
        key: resolveOffsetKey(state, groupId, stem.slot),
        steps
      })
      pendingBakeRef.current = steps
    }
  })

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        commitAndCloseRef.current()
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
  // Matches peaks' own span (the whole rifff, not just the identity stem's
  // own duration) — see its doc comment for why. Using stem.barLength here
  // instead would mis-space the gridlines against that wider waveform
  // whenever the identity stem is shorter than the rifff (e.g. a 4-bar drum
  // loop identity stem in a 16-bar rifff).
  const totalBeats = rifff.barLength * 4
  const currentBeat = Math.round((-currentSteps * 4) / snapDiv)

  function toggleFreePlay(): void {
    if (isFreePlaying) {
      stopPreview()
      return
    }
    stopPreview()
    // Hearing the main arrangement's own mix at the same time as this
    // preview loop would be an unpleasant, confusing overlap — pause it
    // (not stop: this is an interruption to go audition a beat, not a
    // reason to lose the playhead position) rather than let both play at
    // once.
    if (playing) dispatch({ type: 'PAUSE' })
    const ctx = getAudioContext()
    freeStartTimeRef.current = ctx.currentTime
    const stemsToPreview = previewAll ? rifff.stems : [stem]
    const gain = sqrtGain(stemsToPreview.length)
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
    // Same reasoning as toggleFreePlay: this also starts a looped preview,
    // so pause the main arrangement rather than let both play at once.
    if (playing) dispatch({ type: 'PAUSE' })

    // Defaults to every stem together, not just the identity one: they're all
    // beat-locked to the same clock within a rifff, so hearing the full mix
    // land on the picked beat is what actually confirms the downbeat is right —
    // rotationSecondsForStem gives each stem its own equivalent position, wrapped
    // by its own (possibly shorter, tiling) loop length.
    const stemsToPreview = previewAll ? rifff.stems : [stem]
    const ctx = getAudioContext()
    const gain = sqrtGain(stemsToPreview.length)
    // Marks when THIS pick's playback began, so the playhead sweep (which
    // reads this same ref — see the effect above) tracks from here rather
    // than a stale timestamp left over from a previous pick or free-play.
    freeStartTimeRef.current = ctx.currentTime
    for (const s of stemsToPreview) {
      const buf = buffers[s.slot]
      if (!buf) continue
      const offsetSec = rotationSecondsForStem(steps, snapDiv, s)
      const source = ctx.createBufferSource()
      // Rotated (not the raw buffer with loopStart=offsetSec) so every pick
      // loops the stem's full duration — see rotateBuffer's doc comment.
      // Stems are often short (1-2 bar) loops, so a single play-through can
      // be too brief to judge the downbeat by ear; looping mirrors how it
      // actually sounds once baked and placed in the arranger. stopPreview()
      // (called above, and again on the next pick or on close) is what ends
      // it, since a looped source never stops itself.
      source.buffer = rotateBuffer(ctx, buf, offsetSec)
      source.loop = true
      const gainNode = ctx.createGain()
      gainNode.gain.value = gain
      source.connect(gainNode)
      gainNode.connect(ctx.destination)
      source.start(0)
      previewSourcesRef.current.push(source)
    }
    setPreviewingBeat(beatIndex)
    pendingBakeRef.current = steps
  }

  return (
    <div
      onClick={() => commitAndCloseRef.current()}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        // Higher than LoreLibraryBrowser's own overlay (zIndex 10): after a
        // LORE import, BeatPicker can open while that panel is still open
        // behind it (the panel deliberately stays open across imports so
        // browsing isn't interrupted) — needs to render on top to actually
        // be usable, not just visually present underneath.
        zIndex: 20
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 700,
          maxWidth: '90vw',
          background: 'var(--ra-bg-bar)',
          border: '1px solid var(--ra-border-strong)',
          borderRadius: 0,
          padding: 16
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span className="ra-eyebrow">pick the downbeat</span>
          <button
            onClick={() => commitAndCloseRef.current()}
            style={{
              height: 22,
              borderRadius: 0,
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
            preview all stems
          </label>
          <button
            onClick={toggleFreePlay}
            title="click a beat below, or play and hit space on the downbeat"
            style={{
              height: 22,
              borderRadius: 0,
              padding: '0 10px',
              fontSize: 10,
              border: '1px solid var(--ra-border-strong)',
              background: isFreePlaying ? 'var(--ra-play-on)' : 'var(--ra-bg-row-active)',
              color: isFreePlaying ? 'var(--ra-play-on-ink)' : 'var(--ra-text)'
            }}
          >
            {isFreePlaying ? '■ stop' : '▶ play'}
          </button>
        </div>

        <div
          style={{
            position: 'relative',
            height: 140,
            marginTop: 14,
            border: '1px solid var(--ra-border)',
            borderRadius: 0,
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
              <path d={linearWave(peaks)} fill={color} opacity={0.75} shapeRendering="crispEdges" />
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
          beat {currentBeat + 1} of {totalBeats}
        </div>
      </div>
    </div>
  )
}
