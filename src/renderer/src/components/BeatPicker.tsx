import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch } from 'react'
import { useAppState, useDispatch, usePlaying } from '../state/StoreContext'
import { offsetStepsForBeatIndex, rotationSecondsForStem } from '../state/selectors'
import type { Action, AppState } from '../state/store'
import { getAudioContext } from '../audio/peakCache'
import { stopActivePreview } from '../audio/previewLoop'
import { applyLoopMicroFade } from '../audio/microFade'
import { buildMetronomeBuffer } from '../audio/metronome'
import { SNAP_DIVS } from '../state/store'
import { stemColorVar } from '../theme/typeColor'
import { stemKey, type Stem } from '@shared/types'
import { placedClipsSharingStems } from '@shared/bakePropagation'
import { evictStemAnalysis } from '../audio/evictStemAnalysis'
import { computeSpectrogram, type Spectrogram } from '@shared/spectrogram'
import { computePitchContour } from '@shared/pitchContour'
import { octaveGridlines } from '@shared/noteNames'
import { SpectrogramCanvas } from './SpectrogramCanvas'
import { LoadingLoader } from './LoadingLoader'

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
//
// Takes no groupId: a bake is scoped by the PATHS it rewrote, and APPLY_BAKE
// moves every clip made of one of those files (see its own reducer comment).
// eslint-disable-next-line react-refresh/only-export-components -- shared helper, not a component
export async function bakeStems(
  dispatch: Dispatch<Action>,
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
    evictStemAnalysis(results.map((r) => r.bakedPath))
    dispatch({ type: 'APPLY_BAKE', results })
  } catch (err) {
    console.error('BeatPicker: failed to bake offset into audio files:', err)
  }
}

/** Re-bakes whatever downbeat correction a rifff's stems ALREADY have live
 * (state.off, keyed by groupId) without
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
      const steps = state.off[groupId] ?? 0
      return { path: s.path, rotationSec: rotationSecondsForStem(steps, snapDiv, s) }
    })
    const results = await window.rifffApi.bakeOffset(jobs)
    evictStemAnalysis(results.map((r) => r.bakedPath))
    dispatch({ type: 'APPLY_BAKE', results })
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
  // The latest clicked-but-not-yet-confirmed pick (offset steps), or null
  // whenever nothing's staged. Deliberately NOT dispatched to state.off (or
  // baked) the moment a beat is clicked — only confirmPending below does
  // that — so auditioning several candidate beats doesn't touch live state
  // at all until the user explicitly commits to one via "confirm change",
  // and "cancel" is a true no-op when nothing was ever confirmed. See
  // docs/superpowers/specs/2026-08-10-beatpicker-confirm-cancel-design.md
  // -- ok if that doc doesn't exist, this comment is the design record.
  const [pendingSteps, setPendingSteps] = useState<number | null>(null)
  // What state.off[groupId] was the moment this picker started showing THIS
  // riff (captured once per groupId, below) — cancelPending's revert
  // target. Deliberately captured once per groupId, not re-read on every
  // render: a confirm earlier in this same visit changes state.off, and
  // cancelPending needs to know the value from BEFORE that confirm, not
  // "whatever's current," to be able to undo it too (see cancelPending's
  // own doc comment).
  const initialStepsRef = useRef(0)
  // Guards confirmPending/cancelPending against a rapid double-click
  // re-entering mid-flight (same reasoning/pattern as ChannelRow.tsx's own
  // togglingArm) — both are async (native bake round-trip), and both
  // mutate state.off, so two overlapping calls could race and leave it on
  // neither value cleanly.
  const [applying, setApplying] = useState(false)

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
  // at once.
  //
  // Computed via an effect (not useMemo) specifically so each stem's work
  // can be chunked with a real yield between stems: computeSpectrogram and
  // computePitchContour are both plain synchronous nested loops (see their
  // own files under src/shared/), and a rifff with several stems running
  // all of them back-to-back in one synchronous pass blocks the main thread
  // long enough to visibly stutter the "loading…" animation below —
  // confirmed live. `await new Promise((r) => setTimeout(r, 0))` between
  // stems hands control back to the browser to paint/animate before the
  // next stem's computation starts; a microtask (Promise.resolve().then)
  // would NOT do this, since only a macrotask actually yields to rendering.
  const [stemSpectrograms, setStemSpectrograms] = useState<
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
  >(null)
  useEffect(() => {
    let cancelled = false
    // Reset deferred through a microtask (not called directly) so this
    // doesn't read as a synchronous setState-in-effect -- same established
    // workaround as EndlesssLibraryBrowser.tsx's own sync-status effects.
    void Promise.resolve().then(() => {
      if (!cancelled) setStemSpectrograms(null)
    })
    if (!rifff || !stem) return
    const identityBuf = buffers[stem.slot]
    if (!identityBuf) return
    const secPerBar = stem.durationSec / stem.barLength
    const totalSamples = Math.round(secPerBar * rifff.barLength * identityBuf.sampleRate)
    const results: {
      stem: Stem
      spectrogram: Spectrogram
      pitchPathD: string
      tileBoundaryPcts: number[]
    }[] = []
    ;(async () => {
      for (const s of rifff.stems) {
        if (cancelled) return
        const buf = buffers[s.slot]
        if (buf) {
          const data = buf.getChannelData(0)
          if (data.length > 0) {
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
        }
        await new Promise((resolve) => setTimeout(resolve, 0))
      }
      if (!cancelled) setStemSpectrograms(results)
    })()
    return () => {
      cancelled = true
    }
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

  // Discards any unconfirmed pick and re-captures this visit's revert
  // baseline whenever groupId changes — covers both a fresh mount AND
  // navigating within a batch (see navigateRef below). Real gap this
  // closes: without this, an unconfirmed pick on riff A would silently
  // carry over and still be sitting there (pendingSteps still set) if the
  // user navigates to riff B without confirming or cancelling it first —
  // navigating away is meant to abandon it, same as never having picked
  // anything. Deliberately keyed only on [groupId], not state.off — this
  // is meant to capture "what state.off[groupId] was the moment THIS visit
  // to this riff began," once, not track it live as it changes (which
  // would corrupt cancelPending's own "revert to before this visit" target
  // into "revert to whatever's current" the moment a confirm changes it).
  useEffect(() => {
    initialStepsRef.current = state.off[groupId] ?? 0
    // Deferred through a microtask (not called directly) so this doesn't
    // read as a synchronous setState-in-effect -- same established
    // workaround as this file's own stemSpectrograms reset effect above.
    let cancelled = false
    void Promise.resolve().then(() => {
      if (!cancelled) setPendingSteps(null)
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberately keyed only on groupId, not state.off -- see this effect's own doc comment above
  }, [groupId])

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

  // Shared by confirmPendingRef/cancelPendingRef below — dispatches the
  // target steps value live, then (unless it's already what's live, e.g.
  // re-confirming an unchanged pick) bakes it for real. Async because
  // bakeStems is a native round-trip; callers own the `applying` guard
  // around it (see that state's own doc comment above) since both callers
  // need slightly different behavior around it (cancel also needs to skip
  // the bake entirely when nothing was ever confirmed this visit).
  async function applyOffset(target: number, before: number): Promise<void> {
    dispatch({ type: 'SET_OFFSET_STEPS', key: groupId, steps: target })
    if (target !== before && rifff) {
      await bakeStems(dispatch, target, SNAP_DIVS[state.snapIdx], rifff.stems)
    }
  }

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
  const confirmPendingRef = useRef<() => void>(() => {})
  const cancelPendingRef = useRef<() => void>(() => {})
  // Escape and click-outside both route through this rather than straight
  // to commitAndCloseRef — with a pick staged but not yet resolved, they
  // should cancel it (same "back out of what I was doing" convention as
  // RegionMute's own Escape-to-cancel), not silently do nothing (blocked)
  // or silently bake it (implicit confirm) — see this feature's own design
  // discussion.
  const escapeRef = useRef<() => void>(() => {})
  // Space's own behavior depends on whether free-play is already running —
  // first press starts it, every press after that marks the downbeat at
  // the current playhead instead (real bug this fixed: Space used to only
  // ever call markDownbeat, which is a silent no-op while nothing is
  // playing yet, so hitting Space before pressing Play did nothing at all).
  const spaceRef = useRef<() => void>(() => {})
  useEffect(() => {
    // Close only when nothing's staged — a pick sitting unconfirmed forces
    // an explicit confirm or cancel first (see confirmPendingRef/
    // cancelPendingRef below) rather than letting continue/close silently
    // carry it through or silently drop it. The bottom "continue"/"close"
    // button mirrors this same guard in its own disabled state.
    commitAndCloseRef.current = () => {
      if (pendingSteps !== null && pendingSteps !== (state.off[groupId] ?? 0)) return
      stopPreview()
      onClose()
    }

    // Wraps around at either end — a small batch (however many riffs the
    // LORE import pulled in together) doesn't need dead-end prev/next
    // buttons. Purely a "look at a different one" gesture: an unconfirmed
    // pick on the riff being left behind is discarded, not carried over —
    // see the [groupId]-keyed reset effect above.
    navigateRef.current = (delta) => {
      if (!batchGroupIds || !onNavigate || batchGroupIds.length < 2) return
      const currentIndex = batchGroupIds.indexOf(groupId)
      if (currentIndex === -1) return
      const nextIndex = (currentIndex + delta + batchGroupIds.length) % batchGroupIds.length
      onNavigate(batchGroupIds[nextIndex])
    }

    // Captures the playhead's position within the current free-play loop and marks
    // (but doesn't yet confirm) whichever beat that falls on — the tap-along
    // alternative to clicking a specific gridline. Self-contained (re-derives
    // totalBeats/offsetKey/snapDiv from rifff/stem/state rather than closing over
    // the consts declared below the early-return guard) — this effect is
    // registered before that guard, same as every other hook here, so it can't
    // depend on bindings that only exist when the guard doesn't fire.
    markDownbeatRef.current = () => {
      if (applying || !isFreePlaying || !rifff || !stem) return
      // Spans the whole rifff, not just the identity stem's own duration —
      // same reasoning as peaks/totalBeats above. Matches the click grid's
      // own resolution (see Task 1's subdivisionsPerBeat) so tapping along
      // and clicking a gridline stay consistent with each other -- see
      // docs/superpowers/specs/2026-08-02-beatpicker-grid-resolution-design.md.
      const snapDivNow = SNAP_DIVS[state.snapIdx]
      const subdivisionsPerBeatNow = snapDivNow / 4
      const subdivisionsInLoop = rifff.barLength * 4 * subdivisionsPerBeatNow
      const riffDurationSec = (stem.durationSec / stem.barLength) * rifff.barLength
      const elapsed = getAudioContext().currentTime - freeStartTimeRef.current
      const elapsedInLoop = elapsed % riffDurationSec
      const secPerSubdivision = riffDurationSec / subdivisionsInLoop
      const subdivisionIndex = Math.round(elapsedInLoop / secPerSubdivision) % subdivisionsInLoop
      const beatIndex = subdivisionIndex / subdivisionsPerBeatNow
      setPendingSteps(offsetStepsForBeatIndex(beatIndex, snapDivNow))
    }

    // "confirm change" — commits pendingSteps for real (live state + baked
    // to disk). Guarded by `applying` against a rapid double-click
    // re-entering mid-flight (same pattern as ChannelRow.tsx's own
    // togglingArm), since this is async (native bake round-trip).
    //
    // For a fresh import, a successful confirm closes the picker itself
    // (stopPreview + onClose) instead of just clearing pendingSteps and
    // leaving the modal open on a second screen -- real bug this fixed: with
    // hasPendingChange flipping false the moment the bake resolved, the
    // button row swapped from cancel/confirm-change to continue/close(+
    // cancel import), which read as a SECOND picker having appeared (same
    // spectrogram, different buttons), forcing a second click to actually
    // finish -- and clicking "cancel import" there, thinking it was this
    // "new" screen's cancel, deleted the rifff that had just been correctly
    // baked. Scoped to isNewImport only: editing an already-placed rifff's
    // loop start (Inspector's re-pick) has no cancel-import button to
    // mis-click and wasn't part of what broke, so it keeps its existing
    // explicit close step.
    confirmPendingRef.current = () => {
      if (applying || pendingSteps === null) return
      const target = pendingSteps
      const before = state.off[groupId] ?? 0
      if (target === before) {
        // Nothing actually changed (e.g. re-clicking the already-confirmed
        // beat) -- just clear the stale pending marker, no bake needed.
        setPendingSteps(null)
        return
      }
      setApplying(true)
      void applyOffset(target, before)
        .then(() => {
          onBaked?.(target)
          if (isNewImport) {
            stopPreview()
            onClose()
            return
          }
          setPendingSteps(null)
        })
        .finally(() => {
          setApplying(false)
        })
    }

    // "cancel" — reverts all the way to initialStepsRef.current, the value
    // in effect when this visit to THIS riff began (see that ref's own doc
    // comment), not just "undo the latest click." If an earlier pick this
    // same visit was already confirmed (state.off no longer equals
    // initialStepsRef.current), this re-bakes back to it too -- "cancel"
    // discards the whole editing session, not just the newest unconfirmed
    // click, per this feature's own design discussion.
    cancelPendingRef.current = () => {
      if (applying) return
      stopPreview()
      setPendingSteps(null)
      const before = state.off[groupId] ?? 0
      const target = initialStepsRef.current
      if (target === before) return // nothing was actually confirmed this visit -- true no-op
      setApplying(true)
      void applyOffset(target, before).finally(() => setApplying(false))
    }

    escapeRef.current = () => {
      if (pendingSteps !== null) {
        cancelPendingRef.current()
      } else {
        commitAndCloseRef.current()
      }
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
        escapeRef.current()
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
  const offsetKey = groupId
  const currentSteps = state.off[offsetKey] ?? 0
  // A pick that's been clicked but not yet confirmed (see pendingSteps'
  // own doc comment) previews as if it were already picked -- the grid
  // highlight and "loop begins at beat X" line below both read this,
  // falling back to currentSteps once nothing's staged.
  const displaySteps = pendingSteps ?? currentSteps
  const hasPendingChange = pendingSteps !== null && pendingSteps !== currentSteps
  // How many placed clips this pick will move -- APPLY_BAKE is scoped by the
  // paths a bake rewrote, so every clip made of this rifff's audio moves
  // together (shared/bakePropagation.ts). Usually 1; after an auto-arrange
  // it is however many windows the build carved out of this rifff.
  const sharedClipCount = placedClipsSharingStems(state.rifffs, groupId)
  // Matches peaks' own span (the whole rifff, not just the identity stem's
  // own duration) — see its doc comment for why. Using stem.barLength here
  // instead would mis-space the gridlines against that wider waveform
  // whenever the identity stem is shorter than the rifff (e.g. a 4-bar drum
  // loop identity stem in a 16-bar rifff).
  const totalBeats = rifff.barLength * 4
  // How many clickable grid positions make up one quarter-note beat, driven
  // by this same modal's own "grid" selector below (SNAP_DIVS =
  // [1, 2, 4, 8, 16], always a divisor or multiple of 4) -- see
  // docs/superpowers/specs/2026-08-02-beatpicker-grid-resolution-design.md.
  // 0.25 at snapDiv=1 (whole-bar grid) up to 4 at snapDiv=16 -- always <1
  // for the two coarse additions, meaning each clickable cell spans several
  // beats rather than subdividing one; totalSubdivisions below still comes
  // out as a whole number since totalBeats is always a multiple of 4.
  const subdivisionsPerBeat = snapDiv / 4
  const totalSubdivisions = totalBeats * subdivisionsPerBeat
  // One offsetSteps unit IS one subdivision by definition (both are exactly
  // 1/snapDiv of a bar), so recovering which subdivision is currently picked
  // needs no scaling -- just sign-flip and round defensively.
  const currentSubdivisionIndex = Math.round(-displaySteps)
  // Fractional quarter-note-equivalent value for display (e.g. 3.5) --
  // separate from currentSubdivisionIndex, which is what the grid's
  // highlight comparison below actually uses.
  const currentBeat = currentSubdivisionIndex / subdivisionsPerBeat
  const LANE_HEIGHT = 68
  const LANE_GAP = 3
  const lanesHeight = stemSpectrograms?.length
    ? stemSpectrograms.length * LANE_HEIGHT + (stemSpectrograms.length - 1) * LANE_GAP
    : 140

  /** The "cancel import" button's handler (isNewImport only — see its render
   * site below). Unlike commitAndCloseRef/onClose, this discards the rifff(s)
   * entirely rather than leaving them on the shelf: real gap this fixed, the
   * picker previously had no way to back out of an import at all, only close
   * (which kept whatever was imported sitting on the shelf regardless of
   * whether the user actually wanted it). Removes every rifff in the batch,
   * not just the one currently shown — a batch import is one decision ("import
   * these together"), so backing out of it is a batch-level undo too, not a
   * per-riff one. */
  function cancelImport(): void {
    const idsToRemove = batchGroupIds && batchGroupIds.length > 1 ? batchGroupIds : [groupId]
    stopPreview()
    dispatch({ type: 'DELETE_RIFFFS', groupIds: idsToRemove })
    onClose()
  }

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
      // state.vol[stemKey(...)] already has sqrtGain's stem-count headroom
      // normalization baked in from import time (see store.ts's
      // ADD_TO_SHELF/ADD_STEM_TO_RIFFF reducer cases) — exactly the same
      // value buildEngineProject.ts sends the native engine for real
      // arranger playback, applied here directly with no further sqrtGain
      // multiplication. This used to also compute a fresh
      // sqrtGain(stemsToPreview.length) and multiply it in on top,
      // double-applying the same headroom factor and making this preview
      // measurably quieter than the arranger's own playback of the same
      // rifff (worse the more stems it has).
      gainNode.gain.value = state.vol[stemKey(rifff.groupId, s.slot)] ?? 1
      source.connect(gainNode)
      gainNode.connect(ctx.destination)
      source.start(0)
      previewSourcesRef.current.push(source)
    }
    setIsFreePlaying(true)
  }

  /** The play/stop button's own click handler — separate from toggleFreePlay
   * because "stop" needs to cover BOTH ways this picker can be making noise:
   * free-play (isFreePlaying) and a specific beat preview (previewingBeat,
   * started by clicking a gridline). Before this, the button only ever
   * reflected/controlled isFreePlaying — clicking it while a beat preview
   * was looping did nothing to silence it, it just started a NEW free-play
   * loop instead (stopPreview() runs first, so no overlap, but there was no
   * way to just go quiet short of re-clicking the exact same thin gridline
   * button again). Real gap this fixed: no obvious way to stop the audio at
   * all once a beat pick was playing. */
  function handlePlayStopClick(): void {
    if (isFreePlaying || previewingBeat !== null) {
      stopPreview()
      return
    }
    toggleFreePlay()
  }

  function pickBeat(beatIndex: number): void {
    // Blocked while a previous pick is still being confirmed/cancelled
    // (native bake round-trip in flight) -- picking a new beat mid-flight
    // would stage a value the in-flight dispatch/bake knows nothing about.
    if (applying) return
    // A second click on the currently-playing beat just stops it — the
    // pending pick from the first click is untouched (still staged, still
    // needs confirm/cancel), nothing new to do here.
    const wasPlayingThis = previewingBeat === beatIndex
    stopPreview()
    if (wasPlayingThis) return

    const steps = offsetStepsForBeatIndex(beatIndex, snapDiv)
    // Staged locally, not dispatched -- see pendingSteps' own doc comment.
    // The preview below plays the rotated audio directly from `steps`, so
    // nothing about auditioning this pick actually needs state.off to be
    // set at all; only confirmPendingRef commits it for real.
    setPendingSteps(steps)
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
      // Same per-stem volume, no redundant sqrtGain multiplication, as
      // toggleFreePlay above (and Shelf.tsx's tile preview) — see its
      // comment.
      gainNode.gain.value = state.vol[stemKey(rifff.groupId, s.slot)] ?? 1
      source.connect(gainNode)
      gainNode.connect(ctx.destination)
      source.start(0)
      previewSourcesRef.current.push(source)
    }
    setPreviewingBeat(beatIndex)
  }

  return (
    <div
      onClick={() => escapeRef.current()}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--ra-backdrop)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        // Above LibraryBrowser's own overlay (--ra-z-fullscreen): after a
        // LORE import, BeatPicker opens while that panel is still open
        // behind it (the panel deliberately stays open across imports so
        // browsing isn't interrupted) — needs to render on top to actually
        // be usable, not just mounted-but-invisible underneath. Real bug
        // this fixed: LibraryBrowser's own zIndex grew from 10 to 1000 at
        // some point (see its own root style) without this getting bumped
        // to match, so the picker silently opened UNDER the library panel
        // -- clicking import looked like nothing happened at all. Uses the
        // same tier as a full-screen popover (--ra-z-fullscreen-popover)
        // rather than a new one-off value, since the real requirement is
        // just "above the fullscreen tier."
        zIndex: 'var(--ra-z-fullscreen-popover)'
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
                title="previous riff (←)"
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
                title="next riff (→)"
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
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginTop: 10
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
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
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ fontSize: 10, color: 'var(--ra-text-3)' }}>grid</span>
              {SNAP_DIVS.map((div, idx) => (
                <button
                  key={div}
                  onClick={() =>
                    dispatch({ type: 'SET_SNAP_IDX', snapIdx: idx as 0 | 1 | 2 | 3 | 4 })
                  }
                  title={`1/${div} notes`}
                  style={{
                    height: 22,
                    minWidth: 30,
                    borderRadius: 0,
                    padding: '0 6px',
                    fontSize: 10,
                    border: '1px solid var(--ra-border-strong)',
                    background:
                      state.snapIdx === idx ? 'var(--ra-play-on)' : 'var(--ra-bg-row-active)',
                    color: state.snapIdx === idx ? 'var(--ra-play-on-ink)' : 'var(--ra-text)'
                  }}
                >
                  1/{div}
                </button>
              ))}
            </div>
          </div>
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
              onClick={handlePlayStopClick}
              title={
                isFreePlaying || previewingBeat !== null ? 'stop preview audio' : 'play the loop'
              }
              style={{
                height: 22,
                borderRadius: 0,
                padding: '0 10px',
                fontSize: 10,
                border: '1px solid var(--ra-border-strong)',
                background:
                  isFreePlaying || previewingBeat !== null
                    ? 'var(--ra-play-on)'
                    : 'var(--ra-bg-row-active)',
                color:
                  isFreePlaying || previewingBeat !== null
                    ? 'var(--ra-play-on-ink)'
                    : 'var(--ra-text)'
              }}
            >
              {isFreePlaying || previewingBeat !== null ? '■ stop' : '▶ play'}
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
              <LoadingLoader size={64} />
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
                    // A full border (not just a bottom rule) reads as a
                    // distinct clip boundary per stem, rather than one
                    // continuous strip loosely divided into rows.
                    border: '1px solid var(--ra-border-strong)'
                  }}
                >
                  <SpectrogramCanvas
                    spectrogram={spectrogram}
                    color={stemColorVar(s)}
                    height={LANE_HEIGHT}
                  />
                  {/* One thin line at every point this stem's own native loop
                      repeats — same "how long is the underlying loop"
                      marker StemWaveformRow already draws in the main
                      arranger, just as a percentage of this lane's full
                      rifff-spanning width instead of a pixel offset. */}
                  {tileBoundaryPcts.map((pct) => (
                    <div
                      key={pct}
                      style={{
                        position: 'absolute',
                        top: 0,
                        bottom: 0,
                        left: `${pct}%`,
                        width: 2,
                        background: 'color-mix(in srgb, white 80%, transparent)',
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
                        stroke="#5ec8ff"
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
              {Array.from({ length: totalSubdivisions }, (_, i) => i).map((i) => (
                <button
                  key={i}
                  onClick={() => pickBeat(i / subdivisionsPerBeat)}
                  title={`beat ${i / subdivisionsPerBeat + 1}`}
                  style={{
                    position: 'absolute',
                    top: 0,
                    bottom: 0,
                    left: `${(i / totalSubdivisions) * 100}%`,
                    width: `${100 / totalSubdivisions}%`,
                    border: 'none',
                    borderLeft:
                      i % snapDiv === 0
                        ? '1px solid var(--ra-border-strong)'
                        : '1px solid var(--ra-grid-minor)',
                    background:
                      i === currentSubdivisionIndex
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
            ? hasPendingChange
              ? `loop would begin at beat ${currentBeat + 1} of ${totalBeats} — confirm to apply`
              : `loop begins at beat ${currentBeat + 1} of ${totalBeats}`
            : 'decoding stems and analyzing…'}
        </div>

        {/* The answer to "is there a way to adjust all of the clips at once"
            (2026-09-23), said where the adjustment happens rather than left
            for the user to discover. Auto-arrange spreads one rifff over many
            clips that all share its audio, and a bake now moves every one of
            them -- so the count is worth stating, and only when there is more
            than one to state. */}
        {sharedClipCount > 1 && (
          <div style={{ marginTop: 4, fontSize: 10, color: 'var(--ra-text-3)' }}>
            moves {sharedClipCount} clips made of this audio
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
          {isNewImport && (
            <button
              onClick={cancelImport}
              disabled={applying}
              title="discard this import"
              style={{
                height: 34,
                borderRadius: 0,
                padding: '0 20px',
                fontSize: 13,
                border: '2px solid var(--ra-border-strong)',
                background: 'var(--ra-bg-row-active)',
                color: 'var(--ra-text-2)',
                opacity: applying ? 0.3 : 1,
                cursor: applying ? 'not-allowed' : 'pointer'
              }}
            >
              cancel import
            </button>
          )}
          {hasPendingChange ? (
            // Replaces continue/close entirely while a pick is staged but
            // not yet resolved -- forces an explicit choice rather than
            // letting continue/close silently carry it through (blocked,
            // see commitAndCloseRef) or leaving no way to back out.
            <>
              <button
                onClick={() => cancelPendingRef.current()}
                disabled={applying}
                title="discard this pick"
                style={{
                  height: 34,
                  borderRadius: 0,
                  padding: '0 20px',
                  fontSize: 13,
                  border: '2px solid var(--ra-border-strong)',
                  background: 'var(--ra-bg-row-active)',
                  color: 'var(--ra-text-2)',
                  opacity: applying ? 0.3 : 1,
                  cursor: applying ? 'not-allowed' : 'pointer'
                }}
              >
                cancel
              </button>
              <button
                onClick={() => confirmPendingRef.current()}
                disabled={applying}
                title="bake this pick"
                style={{
                  height: 34,
                  borderRadius: 0,
                  padding: '0 20px',
                  fontSize: 13,
                  border: '2px solid var(--ra-play-on)',
                  background: 'var(--ra-play-on)',
                  color: 'var(--ra-play-on-ink)',
                  opacity: applying ? 0.3 : 1,
                  cursor: applying ? 'not-allowed' : 'pointer'
                }}
              >
                {applying ? 'confirming…' : 'confirm change'}
              </button>
            </>
          ) : (
            <button
              onClick={() => commitAndCloseRef.current()}
              style={{
                height: 34,
                borderRadius: 0,
                padding: '0 20px',
                fontSize: 13,
                border: '2px solid var(--ra-border-strong)',
                background: 'var(--ra-bg-row-active)',
                color: 'var(--ra-text)'
              }}
            >
              {isNewImport ? 'continue' : 'close'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
