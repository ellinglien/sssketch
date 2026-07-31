import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch } from 'react'
import { useAppState, useDispatch, usePlaying } from '../state/StoreContext'
import {
  resolveOffsetKey,
  offsetStepsForBeatIndex,
  rotationSecondsForStem
} from '../state/selectors'
import type { Action, AppState } from '../state/store'
import { sqrtGain } from '@shared/mixGain'
import { getAudioContext } from '../audio/peakCache'
import { stopActivePreview } from '../audio/previewLoop'
import { applyLoopMicroFade } from '../audio/microFade'
import { buildMetronomeBuffer } from '../audio/metronome'
import { SNAP_DIVS } from '../state/store'
import { typeColorVar } from '../theme/typeColor'
import type { Stem } from '@shared/types'
import { computeSpectrogram, type Spectrogram } from '@shared/spectrogram'
import { computePitchContour } from '@shared/pitchContour'
import { octaveGridlines } from '@shared/noteNames'
import { SpectrogramCanvas } from './SpectrogramCanvas'

// Shared frequency range/resolution for every stem's spectrogram lane —
// explicit here (rather than relying on computeSpectrogram's own defaults)
// so the note gridlines and pitch contour overlays, which need this same
// range to place themselves correctly, can't silently drift out of sync
// with it.
const SPECTROGRAM_MIN_FREQ_HZ = 40
const SPECTROGRAM_MAX_FREQ_HZ = 8000
const SPECTROGRAM_NUM_FREQ_BINS = 64
const SPECTROGRAM_DYNAMIC_RANGE_DB = 45
const PITCH_HOP_SIZE = 1024
const NOTE_GRIDLINES = octaveGridlines(SPECTROGRAM_MIN_FREQ_HZ, SPECTROGRAM_MAX_FREQ_HZ)

/** Where a frequency lands vertically within a lane, as a percentage from
 * the top — must match SpectrogramCanvas's own low-frequency-at-the-bottom
 * flip (see its doc comment) for the gridlines/contour to actually line up
 * with the spectrogram bands drawn underneath them. */
function freqToTopPct(freqHz: number): number {
  const logMin = Math.log2(SPECTROGRAM_MIN_FREQ_HZ)
  const logMax = Math.log2(SPECTROGRAM_MAX_FREQ_HZ)
  const frac = (Math.log2(freqHz) - logMin) / (logMax - logMin)
  return (1 - Math.max(0, Math.min(1, frac))) * 100
}

/**
 * Endlesss stems are internally beat-locked, but a rifff's declared bar length can
 * be off by a few beats relative to the timeline's bar boundary. Framed to the user
 * as "re-one" — find the beginning of the loop, not a numeric offset entry: every
 * stem gets its own spectrogram lane (all layers visible at once, not just a
 * combined mix) with a beat grid overlaid, and the user clicks whichever beat is
 * where the loop actually starts. offsetStepsForBeatIndex converts that click into
 * the shift needed to land it on the clip's timeline start.
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

/** Re-bakes whatever downbeat correction a rifff's stems ALREADY have live
 * (state.off, via resolveOffsetKey — handles both a linked rifff's single
 * shared value and an unlinked one's independent per-stem values) without
 * needing to reopen BeatPicker and re-pick. Exists for a rifff whose
 * correction is still sitting as a runtime offset rather than physically
 * baked in — the main case being a LORE-sourced stem picked before
 * bakeOffset.ts gained the ability to bake those at all (see its own doc
 * comment): the offset kept working correctly for playback (SchedulePlayback
 * wraps it), but never actually got baked, so re-selecting this same riff
 * later just reopens the picker instead of committing anything. Called from
 * App.tsx's clip context menu ("re-bake downbeat"), shown only when at least
 * one stem has a nonzero offset. */
// eslint-disable-next-line react-refresh/only-export-components -- shared helper, not a component
export async function rebakeRifff(
  dispatch: Dispatch<Action>,
  state: AppState,
  groupId: string
): Promise<void> {
  const rifff = state.rifffs[groupId]
  if (!rifff) return
  const snapDiv = SNAP_DIVS[state.snapIdx]
  try {
    const jobs = rifff.stems.map((s) => {
      const steps = state.off[resolveOffsetKey(state, groupId, s.slot)] ?? 0
      return { path: s.path, rotationSec: rotationSecondsForStem(steps, snapDiv, s) }
    })
    const results = await window.rifffApi.bakeOffset(jobs)
    dispatch({ type: 'APPLY_BAKE', groupId, results })
  } catch (err) {
    console.error('BeatPicker: failed to re-bake offset into audio files:', err)
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
  isNewImport = false,
  batchGroupIds,
  onNavigate,
  onClose,
  onBaked
}: {
  groupId: string
  /** True when this picker was opened straight off an import (Shelf
   * drag-drop or a LORE library batch) rather than the Inspector's own
   * "re-pick downbeat" button reopening an already-placed rifff for a
   * deliberate correction. Gates commitAndClose's confirmation dialog: a
   * wrong pick on a brand-new import is easy to miss and harder to notice
   * later, so only that path confirms before baking. */
  isNewImport?: boolean
  /** Every riff imported together in the same LORE batch as this one
   * (including this one), in original import order — omitted for a single
   * import or an unrelated re-pick via the Inspector's own button. Presence
   * alone (2+ entries) is what makes the forward/back navigation controls
   * render; onNavigate must be provided whenever this is. */
  batchGroupIds?: string[]
  /** Called with a different batch member's groupId when the back/forward
   * arrows are clicked — lets a caller reuse one open BeatPicker across a
   * whole batch, auditioning whichever riff sounds clearest instead of
   * being stuck with whatever happened to import first. Purely a "look at a
   * different one" gesture: doesn't bake or commit anything for the riff
   * being navigated away from (see the picker's own groupId-keyed effect
   * that stops its preview when this fires). */
  onNavigate?: (groupId: string) => void
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
  // together (the default) needs all of them. Keyed by slot. Tagged with the
  // groupId it was decoded for (rather than just the raw map) so navigating
  // to a different rifff can't accidentally serve up the PREVIOUS rifff's
  // buffers while the new ones are still decoding — see the loading effect
  // below for the bug this fixes.
  const [bufferState, setBufferState] = useState<{
    groupId: string
    map: Record<number, AudioBuffer>
  } | null>(null)
  const buffers = useMemo(
    () => (bufferState?.groupId === rifff?.groupId ? bufferState.map : {}),
    [bufferState, rifff]
  )
  const [previewAll, setPreviewAll] = useState(true)
  // Independent of the main arranger's own metronome toggle (state.
  // metronomeEnabled) — this picker never touches the native engine at all,
  // so it needs its own local Web Audio click track. Off by default, same
  // as the arranger's.
  const [metronomeOn, setMetronomeOn] = useState(false)
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

  // One spectrogram per stem, each spanning the whole rifff's own bar length
  // — not just the identity stem's own (possibly much shorter) native loop.
  // Real bug this fixed (back when this was a single combined waveform):
  // a rifff whose identity stem (stems[0]) was a short 4-bar drum loop, but
  // with other stems running much longer, only ever showed/gridded those 4
  // bars — hiding most of the loop (and wherever ITS downbeat-relevant
  // transients were) from the picker entirely. secPerBar is derived from the
  // identity stem's own known duration/barLength (every stem in a rifff is
  // beat-locked to the same clock, so this is exactly the rifff's own
  // tempo), matching schedulePlayback.ts's identical derivation. Each stem
  // is tiled across that full span by repeating its own buffer from the
  // start (`i % data.length`), the same way computeStemSchedule tiles a
  // shorter stem across a longer rifff — so every lane stays aligned to the
  // same beat grid the picker's gridlines are drawn against. Kept as
  // separate per-stem spectrograms (rather than one combined mix) so the
  // layers are visible together instead of summed into one blur — the whole
  // point of "see where the loops happen in the melody" across all of them
  // at once. A pure derivation of rifff/stem/buffers, so useMemo (not an
  // effect writing to its own state) is the right tool.
  const stemSpectrograms = useMemo<
    | {
        stem: Stem
        spectrogram: Spectrogram
        pitchPathD: string
        /** Where this stem's own native loop repeats within the full
         * rifff-spanning lane, as percentages of the lane's width — one entry
         * per internal repeat boundary (excludes the very start, same as
         * StemWaveformRow's own tileOffsets.slice(1) in the main arranger).
         * Lets the picker show the same "how long is this stem's own loop"
         * markers the arranger already does, since a rifff-length lane here
         * can otherwise make a short stem's frequent tiling invisible. */
        tileBoundaryPcts: number[]
      }[]
    | null
  >(() => {
    if (!rifff || !stem) return null
    const identityBuf = buffers[stem.slot]
    if (!identityBuf) return null
    const secPerBar = stem.durationSec / stem.barLength
    const totalSamples = Math.round(secPerBar * rifff.barLength * identityBuf.sampleRate)
    const results: {
      stem: Stem
      spectrogram: Spectrogram
      pitchPathD: string
      tileBoundaryPcts: number[]
    }[] = []
    for (const s of rifff.stems) {
      const buf = buffers[s.slot]
      if (!buf) continue
      const data = buf.getChannelData(0)
      if (data.length === 0) continue
      const tileBoundaryPcts: number[] = []
      for (let boundary = data.length; boundary < totalSamples; boundary += data.length) {
        tileBoundaryPcts.push((boundary / totalSamples) * 100)
      }
      const tiled = new Float32Array(totalSamples)
      for (let i = 0; i < totalSamples; i++) {
        tiled[i] = data[i % data.length]
      }
      const spectrogram = computeSpectrogram(tiled, buf.sampleRate, {
        minFreqHz: SPECTROGRAM_MIN_FREQ_HZ,
        maxFreqHz: SPECTROGRAM_MAX_FREQ_HZ,
        numFreqBins: SPECTROGRAM_NUM_FREQ_BINS,
        dynamicRangeDb: SPECTROGRAM_DYNAMIC_RANGE_DB
      })

      // A melody-contour line drawn on top of the spectrogram — built as a
      // single SVG path (multiple "M" subpaths at gaps, rather than one
      // <path>/<circle> per frame) so it stays cheap to render even at a
      // long rifff's frame count. Unpitched frames (freqHz 0 — see
      // computePitchContour's own confidence-threshold doc comment) break
      // the line rather than being interpolated across, since a percussive
      // gap really isn't "on" any pitch.
      const pitch = computePitchContour(tiled, buf.sampleRate, { hopSize: PITCH_HOP_SIZE })
      let pitchPathD = ''
      let drawing = false
      for (let t = 0; t < pitch.numFrames; t++) {
        const f = pitch.freqHz[t]
        if (f <= 0) {
          drawing = false
          continue
        }
        const xPct = ((t * PITCH_HOP_SIZE) / totalSamples) * 100
        const yPct = freqToTopPct(f)
        pitchPathD += drawing
          ? ` L ${xPct.toFixed(2)} ${yPct.toFixed(2)}`
          : `M ${xPct.toFixed(2)} ${yPct.toFixed(2)}`
        drawing = true
      }

      results.push({ stem: s, spectrogram, pitchPathD, tileBoundaryPcts })
    }
    return results
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
      setBufferState({ groupId: rifff.groupId, map })
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

  // Navigating to a different batch member (see onNavigate above) keeps
  // this same component instance mounted — groupId just changes — so
  // whatever was previewing for the OLD riff needs to be stopped, or its
  // audio would keep looping underneath the newly-displayed riff's
  // waveform. The buffers/peaks effects below already react to groupId
  // changing on their own (rifff is a fresh object reference per riff), so
  // only the preview-playback side needs this extra nudge. In the cleanup,
  // not the setup body — same reasoning as the playhead-sweep effect
  // below's own identical comment: it fires for the OLD groupId right
  // before the new one's own effects run, and calling setState directly in
  // an effect's setup (rather than its cleanup) trips
  // react-hooks/set-state-in-effect.
  useEffect(() => {
    return () => stopPreview()
  }, [groupId, stopPreview])

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

  // Reactive to metronomeOn/isFreePlaying/previewingBeat directly, rather
  // than only being started once at the top of toggleFreePlay/pickBeat —
  // real bug this fixed: checking/unchecking the metronome box while a
  // preview was already running had no audible effect until the next
  // pick/play, since the click was only ever (re)started at the moment a
  // NEW preview began. Always restarts its own phase (downbeat) at t=0 of
  // whichever effect run started it, rather than trying to line its "1" up
  // with wherever the picked beat falls within the rifff — this is a
  // practice click for judging tempo, not a claim about where the rifff's
  // own downbeat is (that claim is exactly what the picker itself is for).
  useEffect(() => {
    if (!metronomeOn || (!isFreePlaying && previewingBeat === null) || !stem || !rifff) return
    if (!stem.barLength) return
    const ctx = getAudioContext()
    const riffDurationSec = (stem.durationSec / stem.barLength) * rifff.barLength
    const beatsInLoop = rifff.barLength * 4
    const secPerBeat = riffDurationSec / beatsInLoop
    const source = ctx.createBufferSource()
    source.buffer = buildMetronomeBuffer(ctx, riffDurationSec, secPerBeat)
    source.loop = true
    source.loopStart = 0
    source.loopEnd = riffDurationSec
    source.connect(ctx.destination)
    source.start(0)
    return () => {
      try {
        source.stop()
      } catch {
        // already stopped
      }
    }
  }, [metronomeOn, isFreePlaying, previewingBeat, stem, rifff])

  // commitAndClose is a fresh function every render (it closes over onClose/rifff/
  // state), so depending on it directly would re-run this effect — and fire its
  // stopPreview() cleanup — on every unrelated re-render, including the one
  // pickBeat's own SET_OFFSET_STEPS dispatch causes. That was cutting the preview
  // off within a render cycle of it starting, no matter what was picked. Reading
  // the latest version (and markDownbeat, same issue) through a ref keeps the
  // effect itself stable.
  const commitAndCloseRef = useRef<() => void>(() => {})
  const markDownbeatRef = useRef<() => void>(() => {})
  const navigateRef = useRef<(delta: number) => void>(() => {})
  // Space's own behavior depends on whether free-play is already running —
  // first press starts it, every press after that marks the downbeat at
  // the current playhead instead (real bug this fixed: Space used to only
  // ever call markDownbeat, which is a silent no-op while nothing is
  // playing yet, so hitting Space before pressing Play did nothing at all).
  const spaceRef = useRef<() => void>(() => {})
  useEffect(() => {
    commitAndCloseRef.current = () => {
      if (pendingBakeRef.current !== null && rifff) {
        // A wrong pick on a brand-new import is easy to make without
        // realizing (Escape/click-outside is an easy accidental close) and
        // harder to notice/fix later once it's baked into the file — confirm
        // before committing. Re-picks via the Inspector's own button are a
        // deliberate correction the user already meant to make, so those
        // close without asking, same as before this existed.
        if (isNewImport && !window.confirm('Bake this downbeat pick into the audio file?')) {
          return
        }
        const steps = pendingBakeRef.current
        pendingBakeRef.current = null
        bakeStems(dispatch, rifff.groupId, steps, SNAP_DIVS[state.snapIdx], rifff.stems)
        onBaked?.(steps)
      }
      stopPreview()
      onClose()
    }

    // Wraps around at either end — a small batch (however many riffs the
    // LORE import pulled in together) doesn't need dead-end prev/next
    // buttons. Purely a "look at a different one" gesture: doesn't touch
    // pendingBakeRef, so a pick already made on the riff being left behind
    // still bakes (onto whichever riff is current when the picker actually
    // closes — see commitAndCloseRef above) rather than being discarded.
    navigateRef.current = (delta) => {
      if (!batchGroupIds || !onNavigate || batchGroupIds.length < 2) return
      const currentIndex = batchGroupIds.indexOf(groupId)
      if (currentIndex === -1) return
      const nextIndex = (currentIndex + delta + batchGroupIds.length) % batchGroupIds.length
      onNavigate(batchGroupIds[nextIndex])
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

    spaceRef.current = () => {
      if (isFreePlaying) {
        markDownbeatRef.current()
      } else {
        toggleFreePlay()
      }
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
        spaceRef.current()
      }
      if (e.key === 'ArrowLeft') navigateRef.current(-1)
      if (e.key === 'ArrowRight') navigateRef.current(1)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      stopPreview()
    }
  }, [stopPreview])

  if (!rifff || !stem) return null

  const batchIndex = batchGroupIds?.indexOf(groupId) ?? -1
  const canNavigate =
    !!batchGroupIds && !!onNavigate && batchGroupIds.length > 1 && batchIndex !== -1

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
  const LANE_HEIGHT = 68
  const LANE_GAP = 3
  const lanesHeight = stemSpectrograms?.length
    ? stemSpectrograms.length * LANE_HEIGHT + (stemSpectrograms.length - 1) * LANE_GAP
    : 140

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
      const loopEndSec = Math.min(s.durationSec, buf.duration)
      const source = ctx.createBufferSource()
      // A micro fade baked into a copy of the samples (see microFade.ts) —
      // native buffer looping wraps sample-accurately with no per-iteration
      // hook to schedule a fade against, so this is the only way to remove
      // a click at the loop seam for a Web Audio preview.
      source.buffer = applyLoopMicroFade(ctx, buf, loopEndSec)
      source.loop = true
      // Explicit bounds, not the buffer's own natural length (loopEnd's
      // default, 0, means "the whole buffer") — real bug this fixed: two
      // stems that are SUPPOSED to loop at exact bar-multiples of each
      // other can still decode to slightly different raw sample counts
      // (encoder padding, rounding — Ogg vs. WAV especially), so looping
      // each one at its own buffer's natural length drifts them out of
      // phase over many iterations, even though they started perfectly in
      // sync. Locking loopEnd to this stem's own precise, metadata-derived
      // durationSec (the same value the native engine's own tiling math
      // uses) keeps every stem's loop period exactly bar-accurate instead.
      source.loopStart = 0
      source.loopEnd = loopEndSec
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
      const loopEndSec = Math.min(s.durationSec, buf.duration)
      const source = ctx.createBufferSource()
      // Rotated (not the raw buffer with loopStart=offsetSec) so every pick
      // loops the stem's full duration — see rotateBuffer's doc comment.
      // Stems are often short (1-2 bar) loops, so a single play-through can
      // be too brief to judge the downbeat by ear; looping mirrors how it
      // actually sounds once baked and placed in the arranger. stopPreview()
      // (called above, and again on the next pick or on close) is what ends
      // it, since a looped source never stops itself. The micro-fade is
      // applied AFTER rotation, on the rotated result — a rotation can
      // introduce its own new seam wherever the split point landed, on top
      // of whatever seam already existed at the original loop boundary.
      source.buffer = applyLoopMicroFade(ctx, rotateBuffer(ctx, buf, offsetSec), loopEndSec)
      source.loop = true
      // Same fix as toggleFreePlay above, same reason — rotateBuffer
      // preserves the original buffer's raw sample count, which can still
      // differ slightly from this stem's true bar-derived durationSec.
      source.loopStart = 0
      source.loopEnd = loopEndSec
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
          width: 'min(1400px, 94vw)',
          maxWidth: '94vw',
          background: 'var(--ra-bg-bar)',
          border: '1px solid var(--ra-border-strong)',
          borderRadius: 0,
          padding: 16
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span className="ra-eyebrow">re-one — find the beginning of the loop</span>
          {canNavigate && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button
                onClick={() => navigateRef.current(-1)}
                title="previous riff in this batch (←)"
                style={{
                  height: 22,
                  width: 22,
                  borderRadius: 0,
                  padding: 0,
                  fontSize: 10,
                  border: '1px solid var(--ra-border)',
                  background: 'var(--ra-bg-row-active)',
                  color: 'var(--ra-text-2)'
                }}
              >
                ◀
              </button>
              <span style={{ fontSize: 10, color: 'var(--ra-text-3)' }}>
                riff {batchIndex + 1} / {batchGroupIds!.length}
              </span>
              <button
                onClick={() => navigateRef.current(1)}
                title="next riff in this batch (→)"
                style={{
                  height: 22,
                  width: 22,
                  borderRadius: 0,
                  padding: 0,
                  fontSize: 10,
                  border: '1px solid var(--ra-border)',
                  background: 'var(--ra-bg-row-active)',
                  color: 'var(--ra-text-2)'
                }}
              >
                ▶
              </button>
            </div>
          )}
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button
              onClick={() => setMetronomeOn((v) => !v)}
              aria-label="Toggle metronome click"
              title={metronomeOn ? 'metronome click: on' : 'metronome click: off'}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                height: 22,
                width: 22,
                borderRadius: 0,
                padding: 0,
                border: '1px solid var(--ra-border-strong)',
                background: metronomeOn ? 'var(--ra-play-on)' : 'var(--ra-bg-row-active)',
                color: metronomeOn ? 'var(--ra-play-on-ink)' : 'var(--ra-text)'
              }}
            >
              <svg
                width="12"
                height="14"
                viewBox="0 0 12 14"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M2 13h8L7.5 1h-3L2 13z" />
                <line x1="6" y1="10" x2="8.5" y2="2.5" />
              </svg>
            </button>
            <button
              onClick={toggleFreePlay}
              title="click a beat below, or play and hit space where the loop begins"
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
        </div>

        <div
          style={{
            position: 'relative',
            marginTop: 14,
            border: '1px solid var(--ra-border)',
            borderRadius: 0,
            background: 'var(--ra-bg-row)',
            maxHeight: '74vh',
            overflowY: lanesHeight > 400 ? 'auto' : 'hidden'
          }}
        >
          {!stemSpectrograms && (
            <div
              style={{
                position: 'relative',
                height: lanesHeight,
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8
              }}
            >
              {/* A left-to-right filling bar — echoes what's actually
                  happening (decoding + an STFT pass over every stem) as
                  visible progress rather than a generic spinner, and reuses
                  the identity stem's own color so it still reads as "this
                  picker," not a bare loading screen. There's no real
                  discrete progress to report (the decode/STFT work
                  resolves all at once), so it loops rather than tracking
                  actual completion. */}
              <div
                style={{
                  position: 'absolute',
                  left: '20%',
                  right: '20%',
                  bottom: '35%',
                  height: 3,
                  overflow: 'hidden',
                  background: 'var(--ra-border)'
                }}
              >
                <div
                  style={{
                    height: '100%',
                    background: typeColorVar(stem.type),
                    animation: 'ra-loading-fill 1.4s ease-in-out infinite'
                  }}
                />
              </div>
              <span className="ra-eyebrow" style={{ position: 'relative' }}>
                loading…
              </span>
            </div>
          )}
          {stemSpectrograms && (
            <div style={{ position: 'relative', height: lanesHeight }}>
              {stemSpectrograms.map(({ stem: s, spectrogram, pitchPathD, tileBoundaryPcts }, i) => (
                <div
                  key={s.slot}
                  style={{
                    position: 'absolute',
                    top: i * (LANE_HEIGHT + LANE_GAP),
                    left: 0,
                    right: 0,
                    height: LANE_HEIGHT,
                    overflow: 'hidden',
                    borderBottom:
                      i < stemSpectrograms.length - 1 ? '1px solid var(--ra-border)' : 'none'
                  }}
                >
                  <SpectrogramCanvas
                    spectrogram={spectrogram}
                    color={typeColorVar(s.type)}
                    height={LANE_HEIGHT}
                  />
                  {/* One thin line at every point this stem's own native loop
                      repeats — same "how long is the underlying loop"
                      marker StemWaveformRow already draws in the main
                      arranger, just as a percentage of this lane's full
                      rifff-spanning width instead of a pixel offset. */}
                  {/* Cyan rather than white/black — the pitch contour line
                      just below is drawn as a white-on-black halo, and a
                      matching white made the two indistinguishable. */}
                  {tileBoundaryPcts.map((pct) => (
                    <div
                      key={pct}
                      style={{
                        position: 'absolute',
                        top: 0,
                        bottom: 0,
                        left: `${pct}%`,
                        width: 2,
                        background: 'color-mix(in srgb, #5ec8ff 85%, transparent)',
                        pointerEvents: 'none'
                      }}
                    />
                  ))}
                  {NOTE_GRIDLINES.map((g, gi) => (
                    <div
                      key={g.label}
                      style={{
                        position: 'absolute',
                        left: 0,
                        right: 0,
                        top: `${freqToTopPct(g.freqHz)}%`,
                        borderTop: '1px solid color-mix(in srgb, var(--ra-text) 20%, transparent)',
                        pointerEvents: 'none'
                      }}
                    >
                      {gi % 2 === 0 && (
                        <span
                          style={{
                            position: 'absolute',
                            left: 2,
                            top: -6,
                            fontSize: 6,
                            color: 'var(--ra-text-3)',
                            textShadow: '0 0 2px var(--ra-bg-row), 0 0 2px var(--ra-bg-row)'
                          }}
                        >
                          {g.label}
                        </span>
                      )}
                    </div>
                  ))}
                  {pitchPathD && (
                    <svg
                      width="100%"
                      height="100%"
                      viewBox="0 0 100 100"
                      preserveAspectRatio="none"
                      style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
                    >
                      <path
                        d={pitchPathD}
                        stroke="black"
                        strokeOpacity={0.45}
                        strokeWidth={2.2}
                        fill="none"
                        vectorEffect="non-scaling-stroke"
                      />
                      <path
                        d={pitchPathD}
                        stroke="white"
                        strokeOpacity={0.9}
                        strokeWidth={0.9}
                        fill="none"
                        vectorEffect="non-scaling-stroke"
                      />
                    </svg>
                  )}
                  <span
                    style={{
                      position: 'absolute',
                      top: 2,
                      right: 4,
                      fontSize: 8,
                      letterSpacing: 0.4,
                      textTransform: 'uppercase',
                      color: 'var(--ra-text-2)',
                      textShadow: '0 0 3px var(--ra-bg-row), 0 0 3px var(--ra-bg-row)',
                      pointerEvents: 'none'
                    }}
                  >
                    {s.name}
                  </span>
                </div>
              ))}
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
          )}
        </div>

        <div style={{ marginTop: 10, fontSize: 10, color: 'var(--ra-text-3)' }}>
          {stemSpectrograms
            ? `loop begins at beat ${currentBeat + 1} of ${totalBeats}`
            : 'decoding stems and analyzing…'}
        </div>
      </div>
    </div>
  )
}
