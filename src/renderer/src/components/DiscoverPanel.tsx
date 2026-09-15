// src/renderer/src/components/DiscoverPanel.tsx
import { useCallback, useEffect, useRef, useState } from 'react'
import { Waveform } from './Waveform'
import { stemColorVar } from '../theme/typeColor'
import { getAudioContext } from '../audio/peakCache'
import {
  startPreviewLoopWithGain,
  stopPreviewSources,
  registerActivePreview,
  unregisterActivePreview,
  type PreviewSourceWithGain,
  type PreviewStemInput
} from '../audio/previewLoop'
import { resolveStretchedForPlayback } from '../audio/resolveStretchedForPlayback'
import { ARRANGE_ROLE_OPTIONS, type ArrangeRole } from '@shared/stemRole'
import { instrumentMaskToSoundType } from '@shared/riffLibraryTypes'
import { guessSoundTypeFromPresetName } from '@shared/presetNames'
import { rankCandidates, pickReroll } from '@shared/discoverRanking'
import { useAppSelector, useDispatch, usePlaying } from '../state/StoreContext'
import { tileOffsetsPx } from '../state/selectors'
import { startPointerDrag } from './dragUtils'
import { stemKey, type ProjectRef, type Rifff, type SoundType, type Stem } from '@shared/types'
import type { DiscoverCandidate } from '../../../main/discoverCandidates'

interface ResolvedCandidateStem {
  author: string
  name: string
  type: SoundType
  path: string
  durationSec: number
  barLength: number
}

// Speed: DiscoverSlotRow's own preview resolve effect and plunkInArranger
// both call resolveCandidateStem for the SAME candidate -- a row resolves
// it once already just to show its waveform, then plunk re-resolves the
// identical riffCID/stemCID from scratch (a real IPC round trip PLUS,
// often, the exact download riffLibraryDownloadMissingStems just did
// moments earlier). Cached by promise (not just by settled result), same
// "cache the in-flight promise itself" convention peakCache.ts already
// established -- this also dedupes two callers that happen to ask for the
// same candidate concurrently (row preview + a fast plunk click) into one
// real request instead of two. Evicted on a null (failed) result, same
// "don't let a transient failure permanently poison the cache" reasoning
// peakCache.ts's own eviction-on-rejection uses -- resolveCandidateStem
// itself never throws (see its own doc comment), so eviction keys off a
// null return here instead of a caught rejection.
const resolvedCandidateCache = new Map<string, Promise<ResolvedCandidateStem | null>>()

/** Resolves one Discover candidate down to a real, locally-downloaded
 * `Stem` -- reused verbatim by both this component's own slot-preview
 * rendering (Step 1 below) and Task 11's "plunk in arranger" placement,
 * since both need exactly the same download-then-resolve step, just for
 * different reasons (a waveform preview vs. a real placed clip).
 * Downloads the candidate's own riff's missing stems on demand (same
 * `riffLibraryDownloadMissingStems` call `LibraryBrowser.tsx`'s own
 * `ensureStemsDownloaded` already makes) -- a candidate isn't guaranteed
 * to be cached locally just because it's in the library-wide index (Task
 * 1's own query reads DB metadata only, never touches the filesystem).
 * Returns null (never throws) for a riff that fails to resolve/download
 * (network hiccup, since-deleted riff) -- callers treat that the same as
 * "no candidate yet" rather than surfacing an error for what's ultimately
 * a soft, retryable failure (reroll picks something else regardless). */
function resolveCandidateStem(candidate: DiscoverCandidate): Promise<ResolvedCandidateStem | null> {
  const key = `${candidate.riffCID}:${candidate.stemCID}`
  const cached = resolvedCandidateCache.get(key)
  if (cached) return cached

  const promise = (async (): Promise<ResolvedCandidateStem | null> => {
    try {
      const resolved = await window.rifffApi.riffLibraryResolveRiff(candidate.riffCID)
      if (!resolved) return null
      const withStems = resolved.stems.some((s) => s.path === null)
        ? ((await window.rifffApi.riffLibraryDownloadMissingStems(candidate.riffCID)) ?? resolved)
        : resolved
      const stem = withStems.stems.find((s) => s.stemCID === candidate.stemCID)
      if (!stem || stem.path === null) return null
      return {
        author: stem.creatorUserName,
        name: stem.presetName,
        type:
          instrumentMaskToSoundType(stem.instrumentMask) ??
          guessSoundTypeFromPresetName(stem.presetName) ??
          'fx',
        path: stem.path,
        durationSec: stem.durationSec,
        barLength: stem.barLength
      }
    } catch (err) {
      console.error('resolveCandidateStem: failed to resolve candidate', candidate.riffCID, err)
      return null
    }
  })()

  resolvedCandidateCache.set(key, promise)
  void promise.then((result) => {
    if (result === null) resolvedCandidateCache.delete(key)
  })
  return promise
}

export interface DiscoverSlot {
  id: string
  role: ArrangeRole
  locked: boolean
  candidate: DiscoverCandidate | null
  /** True once this slot's own rerollSlot has actually resolved at least
   * once (regardless of outcome -- a genuinely empty result sets this same
   * as a found one does), so DiscoverSlotRow below can distinguish "nobody
   * has clicked reroll on this slot yet" from "rerolled, and there's
   * really nothing compatible for this role." Only the reroll call whose
   * result actually lands (i.e. survives rerollSlot's own generation-guard
   * check) sets this -- a superseded/stale call's result is discarded
   * wholesale, this field included, same as `candidate` itself. Left
   * unset (stays false) on a genuine error (the catch path below) rather
   * than treated as "resolved empty" -- a thrown IPC/SQL error never
   * actually completed a search, so marking it "no match" would misreport
   * an error as a confirmed-empty result; leaving it false keeps the slot
   * reading as retriable ("no candidate yet") instead of falsely
   * conclusive. */
  hasRerolled: boolean
  /** This slot's own committed gain (0-1), set by dragging vertically on
   * its own waveform in DiscoverSlotRow below (handleGainDragStart) --
   * carried into the shared preview mix
   * (resolvedStemsRef's own `gain` field, restartMix) AND, on "plunk in
   * arranger", written into the real placed rifff's state.vol so the same
   * balance the user set while building the loop survives onto the
   * timeline (PLACE_LOOP_ON_TIMELINE's own `vol` field, store.ts). Direct
   * request: a volume control per stem "which will determine the envelope
   * once it's placed in the arrangement." Defaults to 1 (full), matching
   * the universal `state.vol[key] ?? 1` read convention used everywhere
   * else in this codebase. */
  gain: number
}

let nextSlotId = 0
function freshSlotId(): string {
  nextSlotId += 1
  return `slot-${nextSlotId}`
}

export function DiscoverPanel({
  currentSketch,
  slots,
  setSlots,
  chaos,
  setChaos,
  currentUsername,
  discoverConsented,
  setDiscoverConsented
}: {
  currentSketch: ProjectRef
  /** Lifted up into LibraryBrowser.tsx (the parent, which does NOT unmount
   * on a `libraryMode` tab switch) rather than owned here -- this component
   * itself DOES unmount/remount on every 'discover' <-> 'browse' switch
   * (LibraryBrowser renders it conditionally, as a sibling of the 'browse'
   * block), so state owned internally here would be wiped on every switch.
   * Controlled from above so the in-progress loop survives switching tabs
   * within one open LibraryBrowser session, per
   * docs/superpowers/specs/2026-09-14-library-wide-discover-design.md
   * §8.1. */
  slots: DiscoverSlot[]
  setSlots: React.Dispatch<React.SetStateAction<DiscoverSlot[]>>
  chaos: number
  setChaos: React.Dispatch<React.SetStateAction<number>>
  /** The real, live "who am I" for this codebase -- LibraryBrowser.tsx's
   * own `riffLibraryUsername` state (seeded from localStorage via
   * loadStoredRiffLibraryUsername, editable through its own "your
   * username" field, already the value its 'browse' tab's own
   * `filters.targetUser` uses). `@shared/riffLibraryTypes`'s
   * `RIFF_LIBRARY_USERNAME` is only that loader's compile-time fallback
   * ('elling') for a machine that's never set a username -- NOT itself
   * the live value -- so it's deliberately not used here; passing the
   * real per-machine value down keeps "only own stems" rerolls scoped to
   * whoever is actually using this install. */
  currentUsername: string
  /** App.tsx's Frame() own single source of truth for Discover's
   * whole-library-scan consent, threaded down through LibraryBrowser.tsx
   * -- the real scan itself (DiscoverLibraryScan) is mounted once at that
   * same top level, gated on this same value, NOT mounted here anymore
   * (this component unmounts/remounts on every 'browse' <-> 'discover'
   * tab switch, which used to restart the scan's throttled batch loop
   * from its own beginning every time). Read here only to decide whether
   * to show the one-time consent prompt below. */
  discoverConsented: boolean
  /** Persists + updates the shared consent value above (App.tsx's
   * setDiscoverConsented) -- the "yes, analyze" button below calls this
   * directly with `true` rather than maintaining its own independently
   * persisted copy, which used to mean toggling consent from the
   * settings menu while Discover was already open didn't affect the
   * already-mounted scan until this panel next remounted. */
  setDiscoverConsented: (value: boolean) => Promise<void>
}): React.JSX.Element {
  // Unused -- accepted here because this component's real consumer
  // (LibraryBrowser.tsx) already passes it. Task 11 ("plunk in arranger")
  // turned out not to need it after all: PLACE_LOOP_ON_TIMELINE takes a
  // flat startBar computed from the timeline's own existing rifffs, not
  // anything scoped to the current sketch. This `void` is only to satisfy
  // this project's tsconfig noUnusedParameters / @typescript-eslint/no-
  // unused-vars until a real use turns up.
  void currentSketch

  const dispatch = useDispatch()
  const playing = usePlaying()
  const rifffsState = useAppSelector((s) => s.rifffs)
  const bpm = useAppSelector((s) => s.bpm)
  const [onlyOwnStems, setOnlyOwnStems] = useState(true)
  const hasUsername = currentUsername.trim() !== ''

  // Direct request, 2026-09-15: "it'd be nice to be able to adjust the
  // track tempo from the discover section" -- a real scope reversal of
  // this feature's own original design spec (§8.7 explicitly listed "no
  // independent BPM/Key controls on the Discover tab" as a non-goal, on
  // the assumption the project's own tempo would always be set elsewhere
  // first). Dispatches the exact same SET_TEMPO action TransportBar.tsx's
  // own tempo field already uses (its reducer case clamps to [40, 200]),
  // not a second tempo mechanism -- every currently-previewing slot picks
  // this up automatically the next time its own resolvePreviewAudio effect
  // reruns (it already re-stretches against `bpm` on every change, see
  // that function's own doc comment), so nudging tempo here re-syncs the
  // whole preview mix to the new value, not just future rolls.
  //
  // Decoupled from state.bpm while focused, same reasoning as
  // TransportBar's own tempoText: SET_TEMPO clamps to [40, 200], and a
  // controlled input that snaps back to the clamped value on every
  // keystroke makes multi-digit typing impossible. Free-type locally, only
  // committing (and clamping, via the reducer) on blur/Enter.
  const [tempoText, setTempoText] = useState(String(bpm))
  const [tempoFocused, setTempoFocused] = useState(false)
  if (!tempoFocused && tempoText !== String(bpm)) setTempoText(String(bpm))

  function commitTempo(): void {
    setTempoFocused(false)
    const nextBpm = Number(tempoText)
    if (!Number.isNaN(nextBpm) && tempoText.trim() !== '') {
      dispatch({ type: 'SET_TEMPO', bpm: nextBpm })
    } else {
      setTempoText(String(bpm))
    }
  }

  // Click-to-preview a slot's own resolved stem, before it's ever placed on
  // the timeline -- reuses previewLoop.ts's own plain-Web-Audio mechanism
  // (Shelf.tsx/LibraryBrowser.tsx's established convention for auditioning
  // audio that isn't part of the current project yet), NOT
  // useStemPreviewPlayback.ts (that hook drives the native engine for stems
  // ALREADY placed in this project's own timeline -- a Discover candidate
  // is neither). Direct report: Discover shipped with no way to hear a
  // candidate before plunking it in, which this closes.
  //
  // Direct follow-up: toggled-on slots play TOGETHER, looped, like the
  // Upcycle reference this whole screen is modeled on -- not Shelf.tsx's
  // own one-at-a-time "starting a new preview stops the old one" model.
  // `previewingSlotIds` is the set of slots currently included in the
  // mix; `resolvedStemsRef` (a ref, not state -- restarting the mix
  // doesn't need to trigger a DiscoverPanel re-render on its own) tracks
  // whichever real, locally-resolved stem each row last reported for
  // itself (reportSlotResolution below, called from each row's own
  // resolve effect) -- DiscoverPanel doesn't resolve candidates itself,
  // Task 7's resolveCandidateStem lives in each row. `restartMix` is the
  // one place that actually starts/stops audio: called on every toggle
  // AND whenever a toggled-on slot's own resolution changes (a reroll
  // landing while that slot is playing swaps its contribution in, rather
  // than freezing on whatever was playing at toggle-on time).
  //
  // The underlying registerActivePreview/unregisterActivePreview registry
  // (previewLoop.ts) is a single-active-preview-anywhere mechanism --
  // still exactly right for "something previewed elsewhere in the app
  // (Shelf, LibraryBrowser's own browse tab, BeatPicker) stops this whole
  // mix," just not used per-slot anymore. `restartMix` registers/
  // unregisters the CURRENT mix as one unit; re-registering the same
  // `stopSlotPreview` reference on every restart is safe -- `stopSlotPreview`
  // itself already ran synchronously a few lines above THIS SAME restartMix
  // call, which unregisters it (nulling previewLoop.ts's own `activeStop`)
  // before the later re-registration -- so `registerActivePreview`'s own
  // `activeStop?.()` never fires against this call's freshly-started
  // sources, only ever against whatever a genuinely different, earlier
  // preview left behind.
  const [previewingSlotIds, setPreviewingSlotIds] = useState<Set<string>>(new Set())
  // Mirrors `previewingSlotIds` for updateSlotGain's own debounced restart
  // below to read -- real bug caught by independent review: that debounce
  // closes over `previewingSlotIds` at the moment a gain drag STARTS, and
  // without this ref it would still use that now-stale value when the
  // timer actually fires ~150ms later. If the user drags slot A's gain
  // then, within that window, clicks to remove slot A from the mix, the
  // stale-closure restart would silently resurrect it (or the symmetric
  // case: drop a just-added slot back out) once the timer fired. Reading
  // this ref instead of the closed-over state value at fire time fixes it.
  const previewingSlotIdsRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    previewingSlotIdsRef.current = previewingSlotIds
  }, [previewingSlotIds])
  const resolvedStemsRef = useRef<Map<string, { path: string; durationSec: number; gain: number }>>(
    new Map()
  )
  // Every slot's own RAW, native-tempo resolved stem (path/durationSec/
  // barLength, exactly what each DiscoverSlotRow reports via
  // reportSlotResolution) -- distinct from resolvedStemsRef above, which
  // holds the already-STRETCHED preview audio actually in the mix. Kept so
  // the tempo control (below) can re-run resolvePreviewAudio for every
  // currently-resolved slot when the project's own bpm changes: that
  // function needs the stem's real native tempo (durationSec/barLength) to
  // compute a fresh stretch ratio against the new bpm, which
  // resolvedStemsRef's already-stretched values can't provide.
  const rawResolvedStemsRef = useRef<
    Map<string, { path: string; durationSec: number; barLength: number }>
  >(new Map())
  // Every slot CURRENTLY in the playing mix, keyed by slot id -- one
  // {source, gainNode, stem} triple per slot, the same shape
  // startPreviewLoopWithGain itself returns. Direct request, 2026-09-15:
  // "dragging envelope/volume shouldn't retrigger start of samples...
  // should not affect playhead" and, a second real bug found live right
  // after: "any button press on there triggers the samples to start from
  // the beginning... it's not just the envelope adjust." Root cause of
  // BOTH: restartMix (below) used to unconditionally stop EVERY currently-
  // playing source and rebuild the whole mix from scratch on every single
  // call -- muting one slot, a reroll landing for one slot, anything --
  // audible as every OTHER already-playing slot's own loop position
  // jumping back to 0, not just the one that actually changed. Keyed by id
  // (not a flat array) so restartMix can diff "what's already correctly
  // playing" against "what should be playing" and touch only the slots
  // that actually changed -- see restartMix's own doc comment below for
  // the full incremental-sync design. updateSlotGain also reads this
  // directly (`.get(id)?.gainNode`) to set `.gain.value` live without
  // going through restartMix at all.
  const mixPairsRef = useRef<Map<string, PreviewSourceWithGain>>(new Map())
  // Per-slot generation counter for restartMix's own async joins, mirroring
  // stretchGenerationRef's already-established pattern -- since restartMix
  // no longer rebuilds the WHOLE mix on every call (see mixPairsRef's own
  // doc comment), a single shared "generation" would wrongly cancel an
  // unrelated slot's still-in-flight join the moment any OTHER slot's own
  // restartMix call came in. Scoped per id instead: only a NEWER join for
  // THE SAME slot supersedes an older one.
  const mixJoinGenerationRef = useRef<Map<string, number>>(new Map())
  // Set true by the unmount effect below, checked at the top of restartMix
  // -- load-bearing, not defensive fluff: reportSlotResolution can itself
  // trigger a fresh restartMix from a CHILD row's own cleanup effect firing
  // during this SAME unmount pass (e.g. a reroll landing right as the panel
  // closes). Without this guard that straggling call would still kick off
  // a real async decode/start with no live component left to ever stop it
  // again once it lands -- the exact leak previewGenerationRef used to
  // guard against under the old single-shared-generation design, before
  // restartMix became incremental/per-id (mixJoinGenerationRef, above) and
  // a single generation stopped being the right tool for that job.
  const unmountedRef = useRef(false)
  const previewTokenRef = useRef(0)
  // Reactive (unlike resolvedStemsRef) so the row waveforms' own tiled
  // width -- see DiscoverSlotRow's own `loopBars`/tileOffsetsPx usage below
  // -- re-renders when a slot resolves/re-resolves/clears. Direct report:
  // every slot's waveform used to stretch to fill the same fixed box
  // regardless of the stem's real bar length, making a 1-bar drum hit and
  // an 8-bar bassline look the same length; this tracks each resolved
  // slot's own real barLength so DiscoverPanel can compute the shared
  // "longest slot" reference (maxBarLength below) every row's own tiling
  // scales against, matching how the real arranger sizes/tiles clips
  // proportionally (StemWaveformRow.tsx/CollapsedRifffRow.tsx's own
  // tileOffsetsPx) rather than showing every stem as if it's the same
  // length.
  const [resolvedBarLengths, setResolvedBarLengths] = useState<Map<string, number>>(new Map())
  // AudioContext.currentTime the CURRENT mix generation's sources actually
  // started at -- null while nothing is playing. Every source in a mix is
  // started together in one synchronous pass (startPreviewLoop's own doc
  // comment), so one shared timestamp is enough for every row's own
  // playhead sweep (DiscoverSlotRow, below) to compute its own
  // elapsed-time-mod-its-own-durationSec lap, the same "sweep across a
  // waveform" convention ClusterStemsBrowser.tsx's own thumbnail playhead
  // already established -- just driven off wall-clock/AudioContext time
  // here instead of the project's own playhead, since this preview mix
  // isn't going through the native engine at all.
  const [mixStartTime, setMixStartTime] = useState<number | null>(null)

  const stopSlotPreview = useCallback(() => {
    stopPreviewSources([...mixPairsRef.current.values()].map((p) => p.source))
    mixPairsRef.current = new Map()
    setMixStartTime(null)
    unregisterActivePreview(previewTokenRef.current)
  }, [])

  useEffect(() => {
    // Real bug, found live 2026-09-15 ("it loads them into the discover
    // section fine but they are not playing at all," confirmed via the
    // temporary diagnostic logging above/in restartMix -- resolvePreviewAudio
    // always reached and called restartMix, but restartMix's own log never
    // printed, meaning it bailed at its very first line every time). This
    // app runs under <StrictMode> (main.tsx), which in development mounts
    // every component with an extra synchronous setup -> cleanup -> setup
    // cycle -- the exact same gotcha useStemPreviewPlayback.ts's own
    // cancelledRef already has to guard against (see that file's own doc
    // comment). Without resetting the ref back to false HERE, in the setup
    // body, the first fake "cleanup" flips unmountedRef.current to true and
    // NOTHING ever flipped it back -- the following fake "setup" re-run
    // re-registers this same cleanup closure but never touches the ref, so
    // restartMix's own `if (unmountedRef.current) return` guard silently
    // no-opped EVERY real call for the rest of this component's life: a
    // slot's own candidate resolved, its waveform rendered fine, but the
    // mix never actually joined/played anything.
    unmountedRef.current = false
    return () => {
      unmountedRef.current = true
      stopSlotPreview()
    }
  }, [stopSlotPreview])

  /** Syncs the playing mix to exactly `ids` -- INCREMENTALLY, not a full
   * stop-everyone/restart-everyone rebuild. Direct request, 2026-09-15,
   * found live right after the gain-drag fix above: "any button press on
   * there triggers the samples to start from the beginning... it's not
   * just the envelope adjust." The old version unconditionally called
   * stopSlotPreview() (stopping EVERY currently-playing source) before
   * rebuilding the whole mix from `ids` -- so muting one slot, a reroll
   * landing for one slot, or a slot being removed all reset every OTHER
   * already-playing slot's own loop position back to 0, the exact same
   * class of bug the gain fix addressed for volume drags specifically.
   *
   * Now: diff `ids` (what SHOULD be playing) against `mixPairsRef.current`
   * (what IS playing) and only touch what actually changed --
   *   - a currently-playing id no longer in `ids`, or whose own resolved
   *     stem's path changed underneath it (a reroll landed different
   *     audio for that slot) -> stop THAT ONE source only.
   *   - an id in `ids` with no currently-playing source (newly muted-in,
   *     or a reroll that changed its path) -> start a NEW source for JUST
   *     that slot.
   *   - an id in `ids` whose currently-playing source's own stem path is
   *     unchanged -> left completely untouched, source/gainNode/playhead
   *     all exactly as they were.
   * Matched by `stem.path`, not object identity -- resolvedStemsRef gets a
   * FRESH object on every land (including a gain-only update, via
   * updateSlotGain), so identity would falsely treat every call as "this
   * slot's audio changed."
   *
   * A newly-joining source is phase-aligned to the REST of the mix, not
   * started at its own buffer position 0 -- every Discover stem is already
   * tempo-synced to the same project tempo (see resolvePreviewAudio's own
   * doc comment), so unmuting/rerolling one slot should sound like it's
   * joining an in-progress, in-the-pocket loop, not retriggering from
   * scratch out of phase with everyone else. `mixStartTime` is the shared
   * anchor every row's own playhead sweep already reads (DiscoverSlotRow,
   * below) -- reused here as "how far into its own loop should a NEW
   * source start" (elapsed-time-mod-its-own-durationSec, same formula the
   * sweep itself uses). */
  const restartMix = useCallback(
    (ids: Set<string>, pauseTransportIfPlaying: boolean) => {
      if (unmountedRef.current) return
      if (pauseTransportIfPlaying && playing) dispatch({ type: 'PAUSE' })

      const currentPairs = mixPairsRef.current
      for (const [id, pair] of [...currentPairs]) {
        const stem = ids.has(id) ? resolvedStemsRef.current.get(id) : undefined
        if (!stem || stem.path !== pair.stem.path) {
          stopPreviewSources([pair.source])
          currentPairs.delete(id)
        }
      }
      // Captured BEFORE the async join below lands -- whether this call's
      // new source(s) will be the ONLY thing playing once they land, i.e.
      // whether this component needs to (re-)register itself as the
      // active preview. registerActivePreview() unconditionally stops
      // whatever was PREVIOUSLY registered before installing the new stop
      // function -- fine under the old full-rebuild design (its own
      // explicit stopSlotPreview() at the top had already cleared the
      // registry every time), but real bug found while writing this
      // incremental version: re-registering on every subsequent
      // incremental join (this component's OWN stopSlotPreview already
      // being the registered one from an earlier join) would immediately
      // invoke that same stopSlotPreview and stop the sources this exact
      // call just added. Only register once, when the mix is transitioning
      // from empty to non-empty.
      const hadNoSources = currentPairs.size === 0

      const toStart = [...ids]
        .map((id) => {
          if (currentPairs.has(id)) return null // already playing this exact audio, untouched
          const stem = resolvedStemsRef.current.get(id)
          return stem ? { id, stem } : null
        })
        .filter(
          (x): x is { id: string; stem: { path: string; durationSec: number; gain: number } } =>
            x !== null
        )

      // TEMPORARY diagnostic log (2026-09-15) -- see reportSlotResolution's
      // own matching log above. Remove once confirmed.
      console.log(
        `DiscoverPanel: restartMix -- ids=${[...ids].join(',')} toStart=${toStart.length} hadNoSources=${hadNoSources}`
      )
      if (toStart.length === 0) {
        if (currentPairs.size === 0) setMixStartTime(null)
        return
      }

      const ctx = getAudioContext()
      const anchor = mixStartTime
      const myGenerations = new Map(
        toStart.map(({ id }) => [id, (mixJoinGenerationRef.current.get(id) ?? 0) + 1])
      )
      for (const [id, gen] of myGenerations) mixJoinGenerationRef.current.set(id, gen)

      const stemsToStart = toStart.map(({ stem }) => ({
        ...stem,
        startOffsetSec:
          anchor !== null && stem.durationSec > 0
            ? (((ctx.currentTime - anchor) % stem.durationSec) + stem.durationSec) %
              stem.durationSec
            : 0
      }))
      // Object IDENTITY, not path/id string matching -- each stem object
      // above is constructed exactly once, right here, so comparing by
      // reference is safe and avoids assuming stem.path is unique (two
      // slots could in principle resolve the same candidate).
      const stemToId = new Map<PreviewStemInput, string>(
        toStart.map(({ id }, i) => [stemsToStart[i], id])
      )

      void startPreviewLoopWithGain(
        ctx,
        stemsToStart,
        () =>
          unmountedRef.current ||
          [...myGenerations].every(([id, gen]) => mixJoinGenerationRef.current.get(id) !== gen)
      ).then((pairs) => {
        // TEMPORARY diagnostic log (2026-09-15) -- see reportSlotResolution's
        // own matching log above. Remove once confirmed.
        console.log(
          `DiscoverPanel: restartMix -- startPreviewLoopWithGain resolved with ${pairs.length}/${stemsToStart.length} pairs`
        )
        if (unmountedRef.current) {
          stopPreviewSources(pairs.map((p) => p.source))
          return
        }
        let joined = false
        for (const pair of pairs) {
          const id = stemToId.get(pair.stem)
          if (!id || mixJoinGenerationRef.current.get(id) !== myGenerations.get(id)) {
            // Superseded (a newer restartMix call already replaced this
            // specific slot) -- stop just this one stale source.
            stopPreviewSources([pair.source])
            continue
          }
          mixPairsRef.current.set(id, pair)
          joined = true
        }
        if (joined) {
          // See hadNoSources's own doc comment above -- only register (and
          // thus only stop whatever ELSE was previously active) the first
          // time this mix goes from empty to non-empty, never on a later
          // incremental join into an already-registered, already-playing
          // mix.
          if (hadNoSources) previewTokenRef.current = registerActivePreview(stopSlotPreview)
          // First-ever source in the mix sets the shared phase anchor --
          // `prev ?? ctx.currentTime` (not an unconditional set) so a
          // later join can never stomp the anchor everyone else is already
          // playing against.
          setMixStartTime((prev) => prev ?? ctx.currentTime)
        } else if (mixPairsRef.current.size === 0) {
          setMixStartTime(null)
        }
      })
    },
    [stopSlotPreview, playing, dispatch, mixStartTime]
  )

  function toggleSlotPreview(id: string): void {
    const next = new Set(previewingSlotIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setPreviewingSlotIds(next)
    restartMix(next, true)
  }

  // Called by each DiscoverSlotRow whenever its OWN resolved stem changes
  // (a fresh resolution lands, a reroll invalidates the old one, or the
  // slot unmounts/gets removed) -- keeps `resolvedStemsRef` accurate and,
  // if this particular slot is currently part of the playing mix, restarts
  // it so the audible loop actually reflects what's now showing on screen.
  //
  // Direct request: "it all should autoplay" -- a slot that just landed a
  // real, playable stem (its first-ever roll on addSlot, or a later reroll)
  // joins the shared mix automatically here rather than requiring an
  // explicit click on its own waveform first. `slots.find` reads this
  // render's own current gain for the slot (the volume slider's value at
  // the moment resolution lands) -- `resolvedStemsRef` doesn't otherwise
  // track gain on its own, updateSlotGain below is what keeps it in sync
  // with LATER slider drags on an already-resolved slot.
  //
  // Real bug, found live (root cause of "stems aren't playing together
  // anymore, just the new one" and "muting one slot affects a different
  // one"): this function is invoked from EACH ROW's own useEffect, which
  // deliberately does NOT depend on onResolvedChange itself (only on
  // resolvedStem, see DiscoverSlotRow's own effect below) -- so the
  // CLOSURE this callback runs with is whichever one was captured the
  // last time THIS row's resolvedStem changed, not necessarily the most
  // recent DiscoverPanel render. With real rolls now taking many seconds
  // (a slow, still-being-optimized IPC round trip), it's very likely for
  // ANOTHER slot to be added/resolved in the meantime -- a resolution
  // landing through a stale closure read a STALE `previewingSlotIds`
  // (missing whatever joined since), then wrote its own smaller/wrong
  // set back over the real one via setPreviewingSlotIds, silently
  // dropping other slots from the mix. previewingSlotIdsRef (below) was
  // already built for exactly this class of bug -- updateSlotGain's own
  // debounced restart already uses it -- this just applies the SAME fix
  // here, the other place a real staleness window exists.
  function reportSlotResolution(
    id: string,
    stem: { path: string; durationSec: number; barLength: number } | null
  ): void {
    if (stem) {
      // TEMPORARY diagnostic log (2026-09-15) -- live report: "it loads
      // them into the discover section fine but they are not playing at
      // all," with zero console errors anywhere in the chain. Traces the
      // resolve-audio pipeline this function kicks off, since nothing in
      // it currently logs at all. Remove once confirmed.
      console.log(`DiscoverPanel: reportSlotResolution(${id}) -- stem resolved, path=${stem.path}`)
      rawResolvedStemsRef.current.set(id, stem)
      setResolvedBarLengths((prev) => {
        const next = new Map(prev)
        next.set(id, stem.barLength)
        return next
      })
      // Direct request, 2026-09-15: "we will need to sync these stems to
      // the same tempo... i don't think we need to reinvent the wheel...
      // imported loops sync very well in the main arranger" -- reuses the
      // EXACT SAME stretch resolver buildEngineProject.ts already uses
      // for real arranger playback (resolveStretchedForPlayback ->
      // window.rifffApi.renderStretched, cached by (path, ratio) on the
      // main-process side -- see rubberband.ts's own doc comment -- so
      // repeated preview restarts at the same tempo never re-render), not
      // a second stretch mechanism invented just for this preview. Same
      // ratio formula too: measured native tempo (durationSec/barLength),
      // never a declared bpm field, against the CURRENT project tempo.
      // Async, so joining the mix/updating resolvedStemsRef can't happen
      // synchronously here -- resolvePreviewAudio (below) does both once
      // the stretch resolves (or immediately, for the common case where
      // no stretch is needed at all).
      void resolvePreviewAudio(id, stem)
      return
    }
    // Invalidates any in-flight resolvePreviewAudio call for this id --
    // real bug this guards against: a slot removed WHILE its own stretch
    // resolution is still awaiting the main process would otherwise have
    // that stretch land AFTER this cleanup runs and write the removed
    // slot's audio right back into resolvedStemsRef/the mix, undoing the
    // removal. `stretchGenerationRef` is declared below (still safe to
    // reference here -- by the time this function is actually CALLED,
    // render has already run and the ref exists).
    stretchGenerationRef.current.set(id, (stretchGenerationRef.current.get(id) ?? 0) + 1)
    resolvedStemsRef.current.delete(id)
    rawResolvedStemsRef.current.delete(id)
    setResolvedBarLengths((prev) => {
      if (!prev.has(id)) return prev
      const next = new Map(prev)
      next.delete(id)
      return next
    })
    const currentlyPreviewing = previewingSlotIdsRef.current
    if (currentlyPreviewing.has(id)) restartMix(currentlyPreviewing, false)
  }

  // Real bug, found live: this file's own stretchGenerationRef, mirroring
  // rerollGenerationRef's already-established pattern -- resolvePreviewAudio
  // is async (a real IPC round trip to render/read a stretched file), so a
  // SLOWER stretch for an OLDER candidate landing AFTER a newer reroll for
  // the SAME slot already resolved must not overwrite it. Bumped
  // synchronously before the first await, checked again after.
  const stretchGenerationRef = useRef<Map<string, number>>(new Map())

  /** Resolves a just-landed candidate's own PREVIEW audio -- stretched to
   * the current project tempo when its native tempo differs meaningfully,
   * via the exact same resolver (resolveStretchedForPlayback) and ratio
   * formula buildEngineProject.ts already uses for real arranger playback
   * (see reportSlotResolution's own doc comment for why this reuses that
   * mechanism rather than inventing a second one). Completes the "join
   * the mix" work reportSlotResolution itself can't do synchronously.
   * `stem.path`/`durationSec` here are the UNSTRETCHED, native-tempo
   * values (Stem.durationSec/barLength) -- resolveStretchedForPlayback's
   * own result is what actually goes into resolvedStemsRef and the
   * preview mix, never the raw ones, once a real stretch was needed. */
  async function resolvePreviewAudio(
    id: string,
    stem: { path: string; durationSec: number; barLength: number }
  ): Promise<void> {
    const myGeneration = (stretchGenerationRef.current.get(id) ?? 0) + 1
    stretchGenerationRef.current.set(id, myGeneration)

    let previewPath = stem.path
    let previewDurationSec = stem.durationSec
    // stem.oneShot equivalent: DiscoverPanel's own resolved stems have no
    // such flag (Discover only ever deals in loop-length candidates, not
    // one-shots), so no ratio===1-for-one-shots special case is needed
    // here the way buildEngineProject.ts's own per-stem loop has one.
    const secPerBarAtProjectTempo = (60 / bpm) * 4
    const stemNativeSecPerBar = stem.durationSec / stem.barLength
    const ratio = stemNativeSecPerBar / secPerBarAtProjectTempo
    if (Math.abs(ratio - 1) >= 0.001) {
      try {
        const resolved = await resolveStretchedForPlayback(stem.path, ratio)
        if (stretchGenerationRef.current.get(id) !== myGeneration) return // superseded
        previewPath = resolved.path
        previewDurationSec = resolved.durationSec
      } catch (err) {
        // Missing rubberband or a bad render shouldn't block the preview
        // entirely -- same fallback buildEngineProject.ts's own stretch
        // step already uses -- just fall back to native-tempo preview
        // audio for this one slot.
        console.error(
          `DiscoverPanel: resolvePreviewAudio: stretch failed for "${stem.path}" at ratio ${ratio}, falling back to native tempo`,
          err
        )
      }
    }
    if (stretchGenerationRef.current.get(id) !== myGeneration) return // superseded

    const gain = slots.find((s) => s.id === id)?.gain ?? 1
    resolvedStemsRef.current.set(id, { path: previewPath, durationSec: previewDurationSec, gain })
    // TEMPORARY diagnostic log (2026-09-15) -- see reportSlotResolution's
    // own matching log above. Remove once confirmed.
    console.log(
      `DiscoverPanel: resolvePreviewAudio(${id}) -- landed, previewPath=${previewPath}, calling restartMix`
    )
    const currentlyPreviewing = previewingSlotIdsRef.current
    if (!currentlyPreviewing.has(id)) {
      const next = new Set(currentlyPreviewing).add(id)
      // Real regression, found live right after the discoverCandidates.ts
      // perf fixes landed: "loading stems is much faster now! but when
      // they are loaded they are not playing automatically." Root cause:
      // previewingSlotIdsRef only used to update via the mirroring
      // useEffect below (`previewingSlotIdsRef.current = previewingSlotIds`),
      // which runs AFTER React commits the render following
      // setPreviewingSlotIds -- fine when candidate resolution was slow
      // enough that two slots' own resolvePreviewAudio calls essentially
      // never landed in the same render batch, but now that resolution is
      // fast, multiple slots routinely finish within the same tick. The
      // SECOND slot's own call read this same stale (pre-effect) ref,
      // computed `next` as just ITS OWN id (missing the first slot's,
      // which hadn't reached the ref yet), and restartMix's own diff (see
      // its doc comment above) then STOPPED the first slot's just-started
      // source since it wasn't in this narrower `next` -- only the last
      // slot to resolve in a batch ever ended up actually playing. Writing
      // the ref synchronously here (not waiting for the mirroring effect)
      // means the next concurrent call always unions onto the truth, not a
      // stale snapshot.
      previewingSlotIdsRef.current = next
      setPreviewingSlotIds(next)
      restartMix(next, false)
      return
    }
    restartMix(currentlyPreviewing, false)
  }

  // Re-tunes every currently-resolved slot when the project's own bpm
  // changes (TransportBar's +/- buttons, its own tempo field, loading a
  // different project, OR the new tempo control this panel itself adds
  // below) -- direct request, 2026-09-15: "it'd be nice to be able to
  // adjust the track tempo from the discover section." Without this, a
  // slot already playing/resolved would keep its OLD stretch ratio baked
  // in (computed once, back when reportSlotResolution first landed it)
  // until its next reroll -- silently drifting out of sync with a bpm
  // change made right here on the same panel. Re-runs the exact same
  // resolvePreviewAudio pipeline reportSlotResolution itself calls,
  // against each slot's own cached RAW (native-tempo) stem
  // (rawResolvedStemsRef, above) -- correctly recomputes the ratio, re-
  // renders a stretch only if the new ratio actually needs one (cached by
  // (path, ratio), same as every other stretch call), and rejoins the
  // live mix via restartMix's own incremental diff (path-based, so an
  // unchanged ratio for one slot -- e.g. it was already exactly on tempo
  // -- leaves that slot's own source completely untouched even while
  // siblings retune). Skips the very first run (component mount/tab open)
  // -- reportSlotResolution already resolves each slot once at its own
  // native pace; re-resolving everything again immediately on mount would
  // just be redundant work.
  const skipFirstBpmRetuneRef = useRef(true)
  useEffect(() => {
    if (skipFirstBpmRetuneRef.current) {
      skipFirstBpmRetuneRef.current = false
      return
    }
    for (const [id, stem] of rawResolvedStemsRef.current) {
      void resolvePreviewAudio(id, stem)
    }
    // resolvePreviewAudio is a plain function re-created every render (not
    // memoized), not a real reactive dependency; only an actual bpm change
    // should retune.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bpm])

  // Live-updates a slot's own committed gain -- both in `slots` state (so
  // the volume slider itself, and "plunk in arranger" later, read the
  // current value) and, if this slot already has a resolved stem tracked,
  // in `resolvedStemsRef` too.
  //
  // Direct request, 2026-09-15: "dragging envelope/volume shouldn't
  // retrigger start of samples... should not affect playhead" -- this used
  // to debounce into a full restartMix (stop + re-decode + re-start every
  // source in the mix), audible as every OTHER currently-playing slot's own
  // loop position jumping back to 0, not just the one being dragged. Now
  // that startPreviewLoopWithGain exposes each source's own GainNode
  // (mixPairsRef, populated by restartMix), a drag just writes
  // `.gain.value` directly on this one slot's node -- genuinely live,
  // zero-latency, and touches nothing else's playback position.
  function updateSlotGain(id: string, gain: number): void {
    setSlots((prev) => prev.map((s) => (s.id === id ? { ...s, gain } : s)))
    const existing = resolvedStemsRef.current.get(id)
    if (existing) resolvedStemsRef.current.set(id, { ...existing, gain })
    const gainNode = mixPairsRef.current.get(id)?.gainNode
    if (gainNode) gainNode.gain.value = gain
  }

  // Per-slot in-flight tracking for rerollSlot -- same stale-response-wins
  // race LibraryBrowser.tsx's useStemPreviewPlayback.ts's own
  // callGenerationRef was built (this same session) to fix, adapted to a
  // per-slot shape (a Map keyed by slot id, rather than a single ref) since
  // several DIFFERENT slots can legitimately have their own rerolls in
  // flight at once -- a click on slot A's reroll must not be superseded by
  // an unrelated click on slot B, only by a NEWER click on slot A itself.
  // Bumped synchronously before rerollSlot's own first await; checked again
  // after it resolves, and the (now-stale) result is discarded rather than
  // written into `setSlots` if a newer call for the same slot has since
  // started. `rerollingSlotIds` is the paired UI-visible half -- which
  // slot's own reroll button should render disabled/"rerolling…" right now.
  const rerollGenerationRef = useRef<Map<string, number>>(new Map())
  const [rerollingSlotIds, setRerollingSlotIds] = useState<Set<string>>(new Set())

  // In-flight tracking for plunkInArranger -- same disabled/label-swap
  // convention as rerollingSlotIds above, just a single boolean rather than
  // a per-slot Set since there's only ever one "plunk in arranger" button.
  // Doesn't fix a correctness bug on its own (the groupId fix above already
  // makes a genuine double-click safe from corrupting existing placements),
  // but without it a double-click before the first click's own
  // Promise.all/resolveCandidateStem round trip resolves would still fire
  // TWO separate, fully-valid PLACE_LOOP_ON_TIMELINE dispatches from one
  // intended click -- two full copies of the loop placed back-to-back.
  const [placing, setPlacing] = useState(false)

  // One-time consent prompt for the whole-library background scan (Task
  // 10) -- gates ONLY that scan, not candidate fetching itself (see the
  // prompt's own copy below and rerollSlot above, which reads existing
  // StemCategories rows regardless of consent). `discoverConsented` itself
  // is owned by App.tsx (threaded down as a prop, see this component's own
  // prop doc comment) -- only whether to currently SHOW this prompt is
  // local here, and it's fine for that to reset on every remount: that's
  // the intentional "ask again" behavior for a decline (declineScanConsent
  // below never persists anything).
  // Lazy initializer (runs once, at mount, not a synced-via-effect value) --
  // deliberately NOT re-derived from `discoverConsented` on every render:
  // reacting to it changing later (e.g. the settings-menu toggle, flipped
  // while this panel happens to be open) would fight with a user who just
  // explicitly clicked "not now" in this same session. By the time this
  // panel can mount at all, App.tsx's own getDiscoverSettings() fetch (its
  // Frame(), on app startup) has long since resolved, so this reads the
  // real persisted value, not a stale default.
  const [showConsentPrompt, setShowConsentPrompt] = useState(() => !discoverConsented)

  function acceptScanConsent(): void {
    setShowConsentPrompt(false)
    void setDiscoverConsented(true)
  }

  function declineScanConsent(): void {
    setShowConsentPrompt(false)
    // consentedToLibraryScan stays false -- nothing persisted here, so the
    // prompt shows again next time Discover opens, matching "ask again
    // rather than silently remember a decline forever."
  }

  // Direct request: adding a slot used to require a second, separate click
  // on its own "roll" button before it showed anything -- this rolls it
  // immediately, same generation-guarded IPC round trip rerollSlot already
  // uses, just parameterized by `role` directly instead of looked up from
  // `slots` state (a slot minted THIS SAME tick isn't in that state's own
  // closure yet -- see rollForSlot's own doc comment below).
  //
  // Direct request, 2026-09-15: "the initial sample load is still too
  // slow.. it should be more random than finding the best fit... because
  // the project doesn't have anything in it yet! it should just be a
  // random drum" -- rollForSlot's own ranked pipeline (rankCandidates
  // against targetBpm, on top of getDiscoverCandidates' own real query
  // cost) exists to pick the BEST-matching candidate for an established
  // arrangement -- meaningless work when nothing is placed yet, since
  // there's no existing tempo/key/content to match against at all. An
  // EMPTY project (no rifff with a real startBar anywhere) uses
  // rollRandomForSlot instead for a slot's own FIRST roll -- the exact
  // same fast, unranked path the row's own "random" button already
  // exposes manually (getRandomDiscoverCandidate: one random jam, one
  // random stem within it, no confirmed/classified pool scan at all).
  // Only gates the very FIRST roll of a brand-new slot -- once anything is
  // placed (including the first thing plunked in from an empty project),
  // later addSlot calls go back through the normal ranked pipeline, since
  // by then there IS a real arrangement worth matching against.
  function addSlot(role: ArrangeRole): void {
    const id = freshSlotId()
    setSlots((prev) => [
      ...prev,
      { id, role, locked: false, candidate: null, hasRerolled: false, gain: 1 }
    ])
    const projectIsEmpty = !Object.values(rifffsState).some((r) => r.startBar !== undefined)
    if (projectIsEmpty) {
      void rollRandomForSlot(id, role)
    } else {
      void rollForSlot(id, role)
    }
  }

  function removeSlot(id: string): void {
    setSlots((prev) => prev.filter((s) => s.id !== id))
    // The removed row's own unmount effect already reports its resolution
    // as null (clearing resolvedStemsRef and restarting the mix without
    // it, if it was part of one) -- this just also drops the id from
    // `previewingSlotIds` itself, so it doesn't sit there forever as a
    // stale, harmless-but-pointless member of a Set for a slot that no
    // longer exists.
    resolvedStemsRef.current.delete(id)
    setPreviewingSlotIds((prev) => {
      if (!prev.has(id)) return prev
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  }

  function toggleLock(id: string): void {
    setSlots((prev) => prev.map((s) => (s.id === id ? { ...s, locked: !s.locked } : s)))
  }

  // Core roll logic, shared by addSlot (a brand-new slot's own first roll)
  // and rerollSlot (an existing slot's later rerolls) -- takes `role`
  // directly rather than looking it up via `slots.find(...)`, since addSlot
  // needs to roll a slot in the SAME tick it mints it, before that slot has
  // made it into `slots` state (a plain function defined in this render
  // still closes over THIS render's `slots`, which doesn't include it yet).
  async function rollForSlot(id: string, role: ArrangeRole): Promise<void> {
    // Claimed BEFORE the first await -- see rerollGenerationRef's own doc
    // comment above. Any earlier call for this SAME slot id that's still
    // awaiting getDiscoverCandidates when THIS call resolves is now stale
    // and must not write its own (older) result over this one.
    const myGeneration = (rerollGenerationRef.current.get(id) ?? 0) + 1
    rerollGenerationRef.current.set(id, myGeneration)
    setRerollingSlotIds((prev) => new Set(prev).add(id))
    try {
      // An empty currentUsername means "no known identity," not "filter to
      // the empty string" -- mirrors LibraryBrowser.tsx's own
      // buildRiffFilters guard (`riffLibraryUsername.trim() !== ''`) around
      // its `filters.targetUser` assignment. Without this, a cleared
      // username field combined with the checkbox left checked silently
      // passes (onlyOwnStems: true, targetUser: '') to
      // getDiscoverCandidates, whose own `CreatorUserName !== targetUser`
      // check then excludes essentially every real stem -- zero candidates,
      // forever, with no error and no hint why.
      const effectiveOnlyOwnStems = onlyOwnStems && hasUsername
      // TEMPORARY diagnostic log (2026-09-15) -- a live report of rolling
      // staying stuck with no console errors made it impossible to tell,
      // from the outside, whether the IPC call itself was the slow part
      // or something after it. Remove once confirmed. No timing captured
      // here (react-compiler's purity rule rejects performance.now()/
      // Date.now() inside a component-defined function) -- the main
      // process's own matching log (index.ts's get-discover-candidates
      // handler) already reports its own internal timing.
      console.log(`DiscoverPanel: rollForSlot(${role}) -- calling getDiscoverCandidates`)
      const candidates = await window.rifffApi.getDiscoverCandidates(
        role,
        effectiveOnlyOwnStems,
        currentUsername
      )
      console.log(
        `DiscoverPanel: rollForSlot(${role}) -- getDiscoverCandidates returned ${candidates.length} candidates`
      )
      if (rerollGenerationRef.current.get(id) !== myGeneration) return
      // Direct report: adding two or three slots of the same role (e.g.
      // several "lead" slots) often landed the exact SAME stem in every
      // one -- each slot's own roll is otherwise unaware of what every
      // OTHER slot in this same loop already picked. Prefer a candidate not
      // already used by another slot right now, when one exists; fall back
      // to the full pool otherwise (a small confirmed-candidate pool
      // duplicating across slots is still better than wrongly reporting "no
      // match" for a role that really does have candidates, just not
      // enough distinct ones for every slot). `slots` here is this
      // function's own closure from whenever it was called (addSlot or
      // rerollSlot) -- a slightly stale read if another slot changed mid-
      // request is an acceptable imprecision for what's fundamentally a
      // variety heuristic, not a correctness guarantee.
      const usedElsewhere = new Set(
        slots.filter((s) => s.id !== id && s.candidate).map((s) => s.candidate?.stemCID)
      )
      const deduped = candidates.filter((c) => !usedElsewhere.has(c.stemCID))
      const pool = deduped.length > 0 ? deduped : candidates
      const ranked = rankCandidates(pool, { targetBpm: bpm })
      const picked = pickReroll(ranked, chaos)
      // TEMPORARY diagnostic log (2026-09-15) -- see the matching one
      // above. Remove once confirmed.
      console.log(
        `DiscoverPanel: rollForSlot(${role}) -- ranked/picked, calling setSlots (picked=${picked?.stemCID ?? 'null'})`
      )
      // hasRerolled set true in this same setSlots call, alongside
      // candidate -- see DiscoverSlot's own doc comment above for why this
      // only happens on the generation-guarded path (never for a stale,
      // discarded result) and why the catch block below deliberately
      // leaves it untouched on a real error.
      setSlots((prev) =>
        prev.map((s) => (s.id === id ? { ...s, candidate: picked, hasRerolled: true } : s))
      )
    } catch (err) {
      // Degrade gracefully, log, don't throw -- same convention as this
      // file's own resolveCandidateStem above and LibraryBrowser.tsx's
      // established try/catch + console.error-with-prefix handlers.
      // getDiscoverCandidates's own real SQL errors are deliberately left
      // to throw (see discoverCandidates.ts's doc comment) rather than
      // silently producing an empty pool, so a genuine failure here is a
      // real one worth surfacing to the console -- just not by crashing the
      // renderer or nulling out a slot's existing candidate.
      console.error(`DiscoverPanel: rollForSlot(${role}) failed:`, err)
    } finally {
      if (rerollGenerationRef.current.get(id) === myGeneration) {
        setRerollingSlotIds((prev) => {
          const next = new Set(prev)
          next.delete(id)
          return next
        })
      }
    }
  }

  async function rerollSlot(id: string): Promise<void> {
    const slot = slots.find((s) => s.id === id)
    if (!slot) return
    await rollForSlot(id, slot.role)
  }

  // Direct request, 2026-09-15: "an option to just start with a completely
  // random stem of the user's from their library, then go from there" --
  // bypasses confirmed/embedding/instrument matching entirely (unlike
  // rollForSlot above), for the exact case that prompted it: stuck at
  // "no match" regardless of how loose/confirmed the role-based pool is.
  // Shares rerollGenerationRef/rerollingSlotIds with rollForSlot -- both
  // ultimately just set `candidate` on the same slot, so they need the
  // SAME stale-response guard against each other (a random roll landing
  // after a NEWER normal reroll for the same slot, or vice versa, must
  // not overwrite it).
  async function rollRandomForSlot(id: string, role: ArrangeRole): Promise<void> {
    const myGeneration = (rerollGenerationRef.current.get(id) ?? 0) + 1
    rerollGenerationRef.current.set(id, myGeneration)
    setRerollingSlotIds((prev) => new Set(prev).add(id))
    try {
      const effectiveOnlyOwnStems = onlyOwnStems && hasUsername
      const candidate = await window.rifffApi.getRandomDiscoverCandidate(
        role,
        effectiveOnlyOwnStems,
        currentUsername
      )
      if (rerollGenerationRef.current.get(id) !== myGeneration) return
      setSlots((prev) =>
        prev.map((s) => (s.id === id ? { ...s, candidate, hasRerolled: true } : s))
      )
    } catch (err) {
      console.error(`DiscoverPanel: rollRandomForSlot(${role}) failed:`, err)
    } finally {
      if (rerollGenerationRef.current.get(id) === myGeneration) {
        setRerollingSlotIds((prev) => {
          const next = new Set(prev)
          next.delete(id)
          return next
        })
      }
    }
  }

  async function rerollRandomSlot(id: string): Promise<void> {
    const slot = slots.find((s) => s.id === id)
    if (!slot) return
    await rollRandomForSlot(id, slot.role)
  }

  async function rerollAll(): Promise<void> {
    // Sequential, not Promise.all -- each slot's own reroll is a real IPC
    // round trip; running them one at a time keeps this simple and avoids
    // hammering the main process with N simultaneous full-library scans at
    // once for a loop with many slots. Locked slots are skipped entirely.
    //
    // No try/catch of its own -- rerollSlot itself never throws (it catches
    // and logs internally, above), so one slot failing can't abort this
    // loop and silently leave every LATER unlocked slot untouched.
    for (const slot of slots) {
      if (!slot.locked) await rerollSlot(slot.id)
    }
  }

  // Real-Rifff.stems can only ever address 8 slots (StemCID_1..8 is the
  // schema every OTHER rifff in this app -- LORE-imported or hand-built --
  // is already bound by, see riffLibrarySchema.ts), so a plunk with more
  // placeable Discover slots than that caps at the first 8 (in their
  // current on-screen order) rather than silently producing a Rifff no
  // other part of this codebase's own wire format could represent.
  const MAX_STEMS_PER_RIFFF = 8

  // Commits whatever loop is currently built in Discover onto the real
  // timeline, as ONE UNITED rifff, one undo step -- direct request,
  // 2026-09-15: "when i say plunk into arranger.. it places them there,
  // but i'd like them to be united like a rifff, and to have all of the
  // shorter bits looped so they create a full group." Every slot that
  // currently has a candidate (locked or not: "plunk" commits whatever's
  // visible right now, the same loop the slot rows' own Waveform previews
  // are already showing, not a filtered subset) becomes ONE stem (its own
  // slot number, 1-indexed in on-screen order) inside a SINGLE new Rifff,
  // not its own separate single-stem Rifff -- this used to place N
  // separate rifffs, each on its own timeline row, which is what actually
  // caused BOTH halves of the report above: no shared grouping (so
  // nothing tiled/looped together as a group the way a real multi-stem
  // rifff does), and a confusing row-per-slot layout that read as gaps/
  // silence even where the timeline itself had none.
  //
  // "shorter bits looped to fill the group" needs no new tiling logic of
  // its own: the rifff's own barLength is set to the LONGEST included
  // stem's barLength (same as this panel's own maxBarLength reference,
  // above), while each STEM keeps its own real, unstretched barLength --
  // exactly the shape a normal multi-bar-length rifff already has, so the
  // SAME tiling machinery every other placed rifff already uses
  // (StemWaveformRow.tsx/CollapsedRifffRow.tsx's tileOffsetsPx on the
  // display side, LoopSewing.cpp on the native engine side) tiles the
  // shorter stems to fill the group for free.
  //
  // resolveCandidateStem (above, also used by the slot rows themselves)
  // does the real download/resolve work, since a Discover candidate isn't
  // necessarily cached locally yet. It never throws/rejects -- only ever
  // resolves to null on failure -- so a plain Promise.all here already
  // gives the same "one bad stem doesn't block the others" resilience
  // useStemFeatureScan.ts gets from Promise.allSettled, without needing
  // that API.
  async function plunkInArranger(): Promise<void> {
    setPlacing(true)
    try {
      const placeable = slots
        .filter((s): s is DiscoverSlot & { candidate: DiscoverCandidate } => s.candidate !== null)
        .slice(0, MAX_STEMS_PER_RIFFF)
      if (placeable.length === 0) return

      const resolved = await Promise.all(
        placeable.map(
          async ({
            candidate,
            gain
          }): Promise<{
            stem: ResolvedCandidateStem
            candidate: DiscoverCandidate
            gain: number
          } | null> => {
            const stem = await resolveCandidateStem(candidate)
            return stem ? { stem, candidate, gain } : null
          }
        )
      )
      const placed = resolved.filter(
        (r): r is { stem: ResolvedCandidateStem; candidate: DiscoverCandidate; gain: number } =>
          r !== null
      )
      if (placed.length === 0) return

      // crypto.randomUUID(), matching buildRifff.ts's own established
      // convention for minting a brand-new rifff's groupId -- NOT
      // deterministic from candidate content. A second "plunk in arranger"
      // click with the same slots still showing (nothing clears `slots`
      // after a successful plunk, so re-plunking the same loop further
      // along the timeline is normal usage) must mint a fresh groupId,
      // since PLACE_LOOP_ON_TIMELINE's reducer case writes
      // `rifffs[rifff.groupId] = {...}` -- a deterministic id recomputed
      // from the same candidates would silently overwrite (relocate) the
      // first placement instead of adding a second copy alongside it,
      // contradicting this feature's own "adds alongside, never replaces"
      // guarantee (design spec §8.4).
      const groupId = crypto.randomUUID()
      const barLength = Math.max(...placed.map((p) => p.stem.barLength))
      const roles = [...new Set(placeable.map((s) => s.role))]
      const rifff: Rifff = {
        groupId,
        name: `discover: ${roles.join('+')}`,
        bpm,
        barLength,
        folderPath: '',
        stems: placed.map(({ stem }, i) => ({ slot: i + 1, ...stem }))
      }

      // Appends after the furthest-right currently-placed clip, matching
      // "adds alongside, never replaces" from the design spec's own §8.4 --
      // never touches an existing rifff's own startBar.
      const placedEnds = Object.values(rifffsState)
        .filter((r) => r.startBar !== undefined)
        .map((r) => (r.startBar ?? 0) + r.barLength)
      const startBar = placedEnds.length > 0 ? Math.max(...placedEnds) : 0

      // Direct request: each slot's own volume slider "will determine the
      // envelope once it's placed in the arrangement" -- carries the
      // Discover-time gain straight into state.vol, keyed the same way
      // every other placed stem's own gain already is (stemKey(groupId,
      // slot)).
      const vol: Record<string, number> = {}
      placed.forEach(({ gain }, i) => {
        vol[stemKey(groupId, i + 1)] = gain
      })

      dispatch({ type: 'PLACE_LOOP_ON_TIMELINE', stems: [rifff], startBar, vol })
    } finally {
      setPlacing(false)
    }
  }

  return (
    <div style={{ padding: 10, overflowY: 'auto', flex: 1 }}>
      {/* One-time keyframes for a resolving slot's own placeholder box
          (DiscoverSlotRow, below) -- injected once here rather than per-row,
          same "one <style> tag for the whole list" convention
          ClusterStemsBrowser.tsx's own row-assignment pulse animation
          already uses. discover-slot-pulse (opacity-only) is still used for
          the FAILED state -- a static "this stopped" cue. Direct request
          ("like a slot machine loading animation until a new waveform
          appears"): the RESOLVING state instead gets discover-slot-reel, a
          striped bar pattern sliding horizontally -- no real waveform data
          exists yet to show, so this fakes the shape of one spinning past,
          same spirit as Upcycle's own reel animation, drawn with this
          app's existing dim/bright tokens rather than a literal fruit-reel
          graphic. */}
      <style>{`
        @keyframes discover-slot-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.35; }
        }
        @keyframes discover-slot-reel {
          from { background-position: 0 0; }
          to { background-position: -28px 0; }
        }
      `}</style>
      {showConsentPrompt && (
        <div
          style={{
            border: '1px solid var(--ra-border-strong)',
            padding: 12,
            marginBottom: 10,
            fontSize: 10,
            color: 'var(--ra-text-2)'
          }}
        >
          <p style={{ margin: '0 0 8px' }}>
            discover can analyze your whole synced library in the background to find compatible
            stems -- for a large library this can take hours to fully finish, running quietly and
            throttled so it doesn&apos;t compete with normal use. analyze now?
          </p>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={acceptScanConsent}
              style={{ fontFamily: 'inherit', fontSize: 9, padding: '4px 8px' }}
            >
              yes, analyze
            </button>
            <button
              onClick={declineScanConsent}
              style={{ fontFamily: 'inherit', fontSize: 9, padding: '4px 8px' }}
            >
              not now
            </button>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <span style={{ fontSize: 9, color: 'var(--ra-text-3)' }}>tight</span>
        <input
          type="range"
          min={0}
          max={100}
          value={chaos}
          onChange={(e) => setChaos(Number(e.target.value))}
        />
        <span style={{ fontSize: 9, color: 'var(--ra-text-3)' }}>loose</span>
        <span style={{ width: 1, alignSelf: 'stretch', background: 'var(--ra-border)' }} />
        {/* Direct request, 2026-09-15: "it'd be nice to be able to adjust
            the track tempo from the discover section" -- same SET_TEMPO
            dispatch, same free-type-until-blur pattern, and the same
            [40, 200] clamp (enforced by the reducer, not re-checked here)
            as TransportBar.tsx's own tempo field, just placed here so
            retuning the loop doesn't require leaving the tab. */}
        <span style={{ fontSize: 9, color: 'var(--ra-text-3)' }}>tempo</span>
        <button
          onClick={() => dispatch({ type: 'SET_TEMPO', bpm: bpm - 1 })}
          aria-label="Decrease tempo"
          style={{
            width: 18,
            height: 18,
            padding: 0,
            fontSize: 10,
            border: '1px solid var(--ra-border)',
            background: 'var(--ra-bg-row-active)',
            color: 'var(--ra-text)',
            cursor: 'pointer'
          }}
        >
          −
        </button>
        <input
          type="number"
          value={tempoText}
          onFocus={() => setTempoFocused(true)}
          onChange={(e) => setTempoText(e.target.value)}
          onBlur={commitTempo}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
          }}
          aria-label="Tempo (BPM)"
          style={{
            fontSize: 10,
            fontWeight: 700,
            width: 36,
            textAlign: 'center',
            background: 'var(--ra-bg-row-active)',
            color: 'var(--ra-text)',
            border: '1px solid var(--ra-border)',
            height: 18,
            padding: 0,
            WebkitAppearance: 'none',
            MozAppearance: 'textfield'
          }}
        />
        <button
          onClick={() => dispatch({ type: 'SET_TEMPO', bpm: bpm + 1 })}
          aria-label="Increase tempo"
          style={{
            width: 18,
            height: 18,
            padding: 0,
            fontSize: 10,
            border: '1px solid var(--ra-border)',
            background: 'var(--ra-bg-row-active)',
            color: 'var(--ra-text)',
            cursor: 'pointer'
          }}
        >
          +
        </button>
        <span style={{ fontSize: 9, color: 'var(--ra-text-3)' }}>bpm</span>
        <span style={{ width: 1, alignSelf: 'stretch', background: 'var(--ra-border)' }} />
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            fontSize: 10,
            color: hasUsername ? 'var(--ra-text-2)' : 'var(--ra-text-4)'
          }}
        >
          <input
            type="checkbox"
            checked={onlyOwnStems}
            disabled={!hasUsername}
            title={
              hasUsername
                ? undefined
                : 'set "your username" in the browse tab first -- an empty username can\'t filter to "only mine"'
            }
            onChange={(e) => setOnlyOwnStems(e.target.checked)}
          />
          only my stems
        </label>
        <button
          onClick={() => void rerollAll()}
          disabled={rerollingSlotIds.size > 0}
          style={{
            marginLeft: 'auto',
            fontFamily: 'inherit',
            fontSize: 9,
            padding: '4px 10px',
            background: 'var(--ra-stretch-on-bg)',
            border: '1px solid var(--ra-stretch-on)',
            color: rerollingSlotIds.size > 0 ? 'var(--ra-text-4)' : 'var(--ra-stretch-on)',
            fontWeight: 700,
            cursor: rerollingSlotIds.size > 0 ? 'default' : 'pointer'
          }}
        >
          {rerollingSlotIds.size > 0 ? 'rerolling…' : 'reroll all'}
        </button>
        <button
          onClick={() => void plunkInArranger()}
          disabled={placing}
          style={{
            fontFamily: 'inherit',
            fontSize: 10,
            padding: '6px 14px',
            background: 'var(--ra-stretch-on-bg)',
            border: '1px solid var(--ra-stretch-on)',
            color: placing ? 'var(--ra-text-4)' : 'var(--ra-stretch-on)',
            fontWeight: 700,
            cursor: placing ? 'default' : 'pointer'
          }}
        >
          {placing ? 'placing…' : 'plunk in arranger'}
        </button>
      </div>

      {slots.length === 0 && (
        <div style={{ fontSize: 11, color: 'var(--ra-text-2)', padding: 12 }}>
          add a slot below to start building a loop
        </div>
      )}

      {/* The longest currently-resolved slot's own barLength -- every row's
          own waveform tiles/scales against this SAME shared reference (see
          DiscoverSlotRow below), so the whole row of thumbnails reads as
          one proportional "loop," the shortest stems visibly repeating to
          fill it, exactly like the real arranger would show them once
          placed. 0 while nothing has resolved yet (no rows render tiled
          content in that state anyway). */}
      {(() => {
        const maxBarLength =
          resolvedBarLengths.size > 0 ? Math.max(...resolvedBarLengths.values()) : 0
        return slots.map((slot) => (
          <DiscoverSlotRow
            key={slot.id}
            slot={slot}
            rerolling={rerollingSlotIds.has(slot.id)}
            previewing={previewingSlotIds.has(slot.id)}
            mixStartTime={mixStartTime}
            maxBarLength={maxBarLength}
            onToggleLock={() => toggleLock(slot.id)}
            onRemove={() => removeSlot(slot.id)}
            onReroll={() => void rerollSlot(slot.id)}
            onRerollRandom={() => void rerollRandomSlot(slot.id)}
            onTogglePreview={() => toggleSlotPreview(slot.id)}
            onResolvedChange={(stem) => reportSlotResolution(slot.id, stem)}
            onGainChange={(gain) => updateSlotGain(slot.id, gain)}
          />
        ))
      })()}

      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 10 }}>
        {ARRANGE_ROLE_OPTIONS.map((role) => (
          <button
            key={role}
            onClick={() => addSlot(role)}
            style={{
              fontFamily: 'inherit',
              fontSize: 9,
              padding: '4px 8px',
              background: 'transparent',
              border: '1px dashed var(--ra-border-strong)',
              color: 'var(--ra-text-2)',
              cursor: 'pointer'
            }}
          >
            + {role}
          </button>
        ))}
      </div>
    </div>
  )
}

// Hand-drawn padlock glyph (open/closed shackle), styled after Phosphor's
// Lock/LockOpen icons -- but drawn directly as inline SVG geometry rather
// than pulling in an icon library, matching TransportBar.tsx's own
// MetronomeIcon/SettingsGearIcon convention and its "no emoji in chrome"
// design-system rule (CLAUDE.md): this codebase deliberately avoids an icon
// package. Monochrome via currentColor so it inherits the lock button's own
// state color (same as every other hand-drawn glyph in this app).
function LockGlyph({ locked }: { locked: boolean }): React.JSX.Element {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="7" width="10" height="7" rx="1.2" />
      {/* Shackle arc -- closed drops all the way to the body's top edge on
          both sides; open stops short on the right, same "lifted latch"
          read as Phosphor's own LockOpen. */}
      <path d={locked ? 'M5.5 7 V5 a2.5 2.5 0 0 1 5 0 V7' : 'M5.5 7 V5 a2.5 2.5 0 0 1 5 0'} />
      <circle cx="8" cy="10.2" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  )
}

// This row's own waveform button's real pixel height -- the vertical-drag
// gain gesture below divides its own deltaY by this, same
// "deltaY / ROW_HEIGHT" scale StemWaveformRow.tsx's own handleVolumeStart
// uses for its analogous drag on the real timeline.
const DISCOVER_WAVEFORM_HEIGHT = 40

function DiscoverSlotRow({
  slot,
  rerolling,
  previewing,
  mixStartTime,
  maxBarLength,
  onToggleLock,
  onRemove,
  onReroll,
  onRerollRandom,
  onTogglePreview,
  onResolvedChange,
  onGainChange
}: {
  slot: DiscoverSlot
  /** True while THIS slot's own rerollSlot call is in flight -- drives the
   * reroll button's disabled/label-swap state, matching
   * LibraryBrowser.tsx's own downloadingRiffCID-driven disabled + label
   * convention. */
  rerolling: boolean
  /** True while THIS slot is currently included in the playing mix
   * (DiscoverPanel's own `previewingSlotIds`) -- drives the glyph's own
   * "now playing" outline. Toggled-on slots play TOGETHER, looped, like
   * the Upcycle reference this screen is modeled on -- not a one-at-a-time
   * solo. */
  previewing: boolean
  /** AudioContext.currentTime the shared preview mix's CURRENT generation
   * started at (DiscoverPanel's own `mixStartTime`), or null while nothing
   * is playing -- this row's own orbiting position dot below is derived
   * from it. */
  mixStartTime: number | null
  /** The longest currently-resolved slot's own barLength, library-wide
   * across every row (DiscoverPanel's own `maxBarLength`) -- this row's own
   * waveform tiles/scales its own resolvedStem.barLength against this SAME
   * shared reference, so the whole loop's rows read as proportional to each
   * other (a 1-bar stem visibly repeats 8x next to an 8-bar one) instead of
   * every stem stretching to fill the same fixed box regardless of its real
   * length. 0 before anything in the loop has resolved yet. */
  maxBarLength: number
  onToggleLock: () => void
  onRemove: () => void
  onReroll: () => void
  /** DiscoverPanel's own rerollRandomSlot -- bypasses confirmed/embedding/
   * instrument matching entirely, picking any stem from the user's own
   * library at random. Direct request: an escape hatch for exactly the
   * "stuck at no match regardless of chaos/confirmation" case. */
  onRerollRandom: () => void
  /** DiscoverPanel's own updateSlotGain -- fires on every tick of a drag
   * directly on this row's own waveform (handleGainDragStart, below),
   * mirroring StemWaveformRow.tsx's own "envelope" volume-drag gesture
   * rather than a separate slider widget. */
  onGainChange: (gain: number) => void
  /** Toggles whether THIS slot is included in DiscoverPanel's own shared
   * playing mix -- the row itself doesn't own any audio state, it only
   * asks the parent to flip its own membership (see DiscoverPanel's own
   * toggleSlotPreview). Triggered two ways: clicking the row's own
   * waveform (the original gesture, doubling as volume-drag via
   * onMouseDown), and a dedicated "mute"/"unmute" button (direct request,
   * 2026-09-15 -- the waveform click alone wasn't discoverable as mute,
   * only a hover tooltip explained it). Both call the exact same handler,
   * so muting via either one keeps the other in sync. Neither renders
   * (not merely disabled) until resolvedStem exists -- nothing to
   * add to/remove from the mix before then. */
  onTogglePreview: () => void
  /** Reports this row's own effective resolved stem (or null) up to
   * DiscoverPanel every time it changes -- resolved on arrival, invalidated
   * on reroll, cleared on unmount/removal -- so the parent's
   * resolvedStemsRef and any currently-playing mix this slot is part of
   * stay in sync with what's actually showing on screen, rather than
   * DiscoverPanel needing to re-resolve candidates itself. */
  onResolvedChange: (stem: { path: string; durationSec: number; barLength: number } | null) => void
}): React.JSX.Element {
  // Resolves the slot's own candidate down to a real, locally-downloaded
  // Stem (resolveCandidateStem, defined above) -- Waveform needs a real
  // on-disk path to decode (getPeaks/getBrightness both read the file
  // directly), and a DiscoverCandidate carries no local path of its own
  // until resolved. Re-resolves whenever `slot.candidate` itself changes
  // identity (a fresh reroll) -- `cancelled` guards against a stale,
  // slower-resolving previous candidate's download completing AFTER a
  // newer reroll has already replaced it, same stale-response guard
  // convention as this session's own useStemFeatureScan.ts. An empty slot,
  // or one whose candidate hasn't resolved yet (still downloading, or
  // resolution failed), renders a plain placeholder box instead of calling
  // Waveform with nothing to decode.
  //
  // `resolved` is paired with the candidate it was resolved FOR (rather
  // than reset to null synchronously at the top of the effect below,
  // which react-hooks/set-state-in-effect flags as a cascading-render
  // risk) -- `resolvedStem` below derives the "not ready yet" placeholder
  // state by comparing `resolved.candidate` against the CURRENT
  // `slot.candidate` identity, so a fresh reroll reads as unresolved
  // immediately (same visible behavior as an explicit reset) without ever
  // calling setState synchronously in the effect body.
  //
  // Real, reported bug this tri-state status fixes: resolveCandidateStem
  // returns null (never throws) for its own documented, EXPECTED failure
  // modes (a since-deleted riff, a download that doesn't actually contain
  // the target stem, ...) -- a plain {candidate, stem} pair had no way to
  // represent that outcome, so a failed resolution left `resolved` (and
  // therefore the "resolving" spinner below) stuck exactly where it
  // started: indistinguishable from "still genuinely in progress," forever.
  // That's the identical "looks hung, no indication anything happened"
  // symptom this whole loading-state feature was added to fix, just moved
  // onto the failure path instead of the loading path. `status: 'failed'`
  // gives the failure path its own real, terminal, visually distinct
  // state instead.
  const [resolved, setResolved] = useState<
    | { candidate: DiscoverCandidate; status: 'ready'; stem: Stem }
    | { candidate: DiscoverCandidate; status: 'failed' }
    | null
  >(null)

  useEffect(() => {
    let cancelled = false
    if (!slot.candidate) return
    const candidate = slot.candidate
    void resolveCandidateStem(candidate).then((stem) => {
      if (cancelled) return
      setResolved(
        stem
          ? { candidate, status: 'ready', stem: { slot: 1, ...stem } }
          : { candidate, status: 'failed' }
      )
    })
    return () => {
      cancelled = true
    }
  }, [slot.candidate])

  const resolvedForCurrent = resolved?.candidate === slot.candidate ? resolved : null
  const resolvedStem = resolvedForCurrent?.status === 'ready' ? resolvedForCurrent.stem : null
  const resolveFailed = resolvedForCurrent?.status === 'failed'
  // A candidate exists but hasn't SETTLED yet either way (no ready stem,
  // no confirmed failure) -- genuinely in flight (downloading/decoding via
  // resolveCandidateStem above), not "empty" and not "failed." Direct
  // report: without this distinction the placeholder ring looked identical
  // whether a slot had nothing at all, was actively working, or had
  // already failed for good (e.g. a since-deleted riff) -- reading as
  // stuck/broken in every one of those cases, including the one where the
  // spinner would otherwise have kept insisting it was still working.
  const resolving = slot.candidate !== null && resolvedStem === null && !resolveFailed

  // Direct request: adjust gain by dragging vertically on the waveform
  // itself -- StemWaveformRow.tsx's own "envelope" volume-drag gesture,
  // reused here (startPointerDrag, same deltaY/ROW_HEIGHT scale) instead of
  // a separate slider widget. Deliberately does NOT call onEnd/check
  // `moved`: unlike the real timeline's SET_VOLUME (an undo-tracked
  // dispatch, only committed once on release), onGainChange writes directly
  // into this component's own pre-placement `slots` state on every tick --
  // there's nothing to "commit" separately, and no undo history to spare
  // from a flood of intermediate values. A plain click (no movement) still
  // toggles preview normally afterward: startPointerDrag's own
  // suppressNextSyntheticClick only fires when a real drag happened, so the
  // button's existing onClick is untouched by a mousedown that never moved.
  function handleGainDragStart(e: React.MouseEvent): void {
    const startGain = slot.gain
    startPointerDrag(e, (_dx, deltaY) => {
      onGainChange(Math.max(0, Math.min(1, startGain - deltaY / DISCOVER_WAVEFORM_HEIGHT)))
    })
  }

  // Playhead sweep across this row's own linear Waveform, mirroring
  // ClusterStemsBrowser.tsx's own thumbnail playhead line (same absolutely-
  // positioned 1px `var(--ra-playhead)` bar at `left: fraction*100%`) and
  // BeatPicker.tsx's own AudioContext-time-driven sweep -- but read-only (no
  // drag/scrub; this is a passive preview, not a transport) and keyed off
  // `mixStartTime` (AudioContext.currentTime the shared mix last (re)started
  // at) rather than the project's own playhead, since this preview never
  // touches the native engine. Direct report: multi-slot looping preview
  // shipped with no visual indication of playback position, leaving no way
  // to tell the loop was actually running versus stalled.
  //
  // Each row sweeps at its OWN lap speed (its own resolvedStem.durationSec),
  // since two stems in the same mix can have different loop lengths.
  const [sweepFraction, setSweepFraction] = useState<number | null>(null)
  useEffect(() => {
    // No setState here on the "nothing to animate" path -- same
    // early-return-with-no-setState shape BeatPicker.tsx's own sweep effect
    // uses, since setState synchronously in an effect body (even guarded)
    // trips this codebase's react-hooks/set-state-in-effect rule. The reset
    // instead lives in the cleanup below, which only ever runs once a raf
    // loop was actually started.
    if (!previewing || mixStartTime === null || !resolvedStem || resolvedStem.durationSec <= 0) {
      return
    }
    const durationSec = resolvedStem.durationSec
    let raf: number
    const tick = (): void => {
      const elapsed = getAudioContext().currentTime - mixStartTime
      setSweepFraction((((elapsed % durationSec) + durationSec) % durationSec) / durationSec)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      setSweepFraction(null)
    }
  }, [previewing, mixStartTime, resolvedStem])

  // Reports the effective resolved stem up to DiscoverPanel every time it
  // changes -- on the way in (a fresh resolution lands), on the way out (a
  // reroll invalidates the old one, this row unmounts/gets removed). Does
  // NOT depend on `onResolvedChange` itself: that's a fresh closure every
  // DiscoverPanel render (it wraps reportSlotResolution with this row's own
  // slot.id), and depending on it would re-fire this effect -- and
  // potentially restart a playing mix -- on every unrelated parent
  // re-render instead of only when THIS row's own resolvedStem actually
  // changes.
  useEffect(() => {
    onResolvedChange(resolvedStem)
    return () => onResolvedChange(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see comment above
  }, [resolvedStem])

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 0',
        borderBottom: '1px solid var(--ra-border-soft)'
      }}
    >
      <button
        onClick={onToggleLock}
        title={slot.locked ? 'locked -- survives reroll all' : 'unlocked'}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          width: 22,
          height: 22,
          padding: 0,
          background: slot.locked ? 'var(--ra-stretch-on-bg)' : 'transparent',
          border: `1px solid ${slot.locked ? 'var(--ra-stretch-on)' : 'var(--ra-border)'}`,
          color: slot.locked ? 'var(--ra-stretch-on)' : 'var(--ra-text-2)',
          cursor: 'pointer'
        }}
      >
        <LockGlyph locked={slot.locked} />
      </button>
      <span style={{ fontSize: 9, color: 'var(--ra-text-3)', width: 64, flexShrink: 0 }}>
        {slot.role}
      </span>
      {resolvedStem ? (
        // Clicking the glyph toggles this slot in/out of the shared,
        // looping mix -- same click-the-thumbnail-to-hear-it convention
        // Shelf.tsx's own tiles and ClusterStemsBrowser.tsx's own waveform
        // rows already use elsewhere in this app, adapted so multiple
        // slots play TOGETHER (Upcycle-style) rather than one at a time.
        // The bright outline while `previewing` mirrors ClusterRow's own
        // `rowIsPreviewing` treatment.
        <button
          onClick={onTogglePreview}
          onMouseDown={handleGainDragStart}
          title={
            (previewing
              ? 'playing in the loop -- click to remove'
              : 'click to add to the loop preview') +
            ` · drag to adjust volume (${Math.round(slot.gain * 100)}%)`
          }
          style={{
            position: 'relative',
            flex: '1 1 auto',
            minWidth: 140,
            height: DISCOVER_WAVEFORM_HEIGHT,
            padding: 0,
            background: 'transparent',
            border: 'none',
            outline: previewing ? '1px solid var(--ra-stretch-on)' : 'none',
            outlineOffset: -1,
            overflow: 'hidden',
            cursor: 'ns-resize'
          }}
        >
          {/* Tiled, not a single stretched-to-fit Waveform -- direct
              report: every slot used to render at the same width regardless
              of its real bar length, making a 1-bar drum hit look the same
              size as an 8-bar bassline. `loopBars` is every row's own SAME
              shared reference (DiscoverPanel's own maxBarLength, the
              longest currently-resolved slot) -- a stem shorter than that
              repeats to fill this box, exactly how it will actually sound
              once looped in the real arranger (tileOffsetsPx, the same
              helper StemWaveformRow.tsx/CollapsedRifffRow.tsx already use
              for this). `100` here is a PERCENT reference, not real pixels
              -- tileOffsetsPx's math is linear/proportional, so feeding it
              100 and rendering each offset/width as a `%` keeps this row's
              own flex-fluid width working without a real DOM measurement.
              The playhead sweep reuses the SAME tileOffsets/tileWidthPct --
              the underlying audio only ever loops once every
              resolvedStem.durationSec (previewLoop.ts's own source.loop),
              so `sweepFraction` (0-1 through ONE repetition) is drawn once
              PER TILE rather than swept across the whole box, showing every
              repetition moving in sync -- matching what's actually playing.
              Direct request: gain is shown/adjusted directly on the
              waveform (StemWaveformRow.tsx's own "envelope" volume
              treatment), not a separate slider -- a dim gray layer always
              renders full-height underneath; the real-color layer on top is
              clipped from the top down by `gainClipPct`, so a lower gain
              visibly cuts more of the bright waveform away, revealing gray
              underneath (same "gray means quieter" language the real
              envelope uses), with a thin line marking the exact cutoff. */}
          {(() => {
            const loopBars = maxBarLength > 0 ? maxBarLength : resolvedStem.barLength
            const rawStemBarLength = resolvedStem.barLength > 0 ? resolvedStem.barLength : loopBars
            // Real crash, found live: tileOffsetsPx's own tile count is
            // Math.ceil(loopBars / stemBarLength) with NO upper bound.
            // Every OTHER caller (StemWaveformRow.tsx/CollapsedRifffRow.tsx)
            // tiles a rifff against ITS OWN stem's barLength -- both numbers
            // come from the same already-authored, already-coherent riff,
            // so their ratio is naturally bounded in practice. Discover's
            // own loopBars is a DIFFERENT slot's barLength entirely (the
            // longest one currently resolved anywhere in the loop) -- an
            // arbitrary one-shot hi-hat (a tiny barLength) sitting next to
            // an unrelated 32-bar backing loop can drive that ratio into
            // the hundreds or thousands, each tile mounting a real
            // <Waveform> (itself dozens of SVG rects) -- enough of those at
            // once genuinely hung/crashed the renderer. Clamping the
            // EFFECTIVE stem bar length to loopBars/MAX_TILES caps the tile
            // count outright; past that point the tiling is an
            // approximation (fewer, slightly wider tiles than the stem's
            // true native loop length), which is a fully acceptable
            // trade-off for "doesn't crash."
            const MAX_TILES = 24
            const stemBarLength = Math.max(rawStemBarLength, loopBars / MAX_TILES)
            const tileOffsets = tileOffsetsPx(100, stemBarLength, loopBars, 0)
            const tileWidthPct = 100 * (stemBarLength / loopBars)
            const gainClipPct = (1 - slot.gain) * 100
            return (
              <>
                {tileOffsets.map((leftPct) => (
                  <div
                    key={`dim-${leftPct}`}
                    style={{
                      position: 'absolute',
                      top: 0,
                      bottom: 0,
                      left: `${leftPct}%`,
                      width: `${tileWidthPct}%`
                    }}
                  >
                    <Waveform path={resolvedStem.path} color="var(--ra-text-4)" opacity={1} />
                  </div>
                ))}
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    clipPath: `inset(${gainClipPct}% 0 0 0)`
                  }}
                >
                  {tileOffsets.map((leftPct) => (
                    <div
                      key={leftPct}
                      style={{
                        position: 'absolute',
                        top: 0,
                        bottom: 0,
                        left: `${leftPct}%`,
                        width: `${tileWidthPct}%`
                      }}
                    >
                      <Waveform
                        path={resolvedStem.path}
                        color={stemColorVar(resolvedStem)}
                        opacity={1}
                      />
                    </div>
                  ))}
                </div>
                <div
                  style={{
                    position: 'absolute',
                    left: 0,
                    right: 0,
                    top: `${gainClipPct}%`,
                    height: 1,
                    background: 'var(--ra-text)',
                    pointerEvents: 'none'
                  }}
                />
                {sweepFraction !== null &&
                  tileOffsets.map((leftPct) => (
                    <div
                      key={`sweep-${leftPct}`}
                      style={{
                        position: 'absolute',
                        top: 0,
                        bottom: 0,
                        left: `${leftPct + sweepFraction * tileWidthPct}%`,
                        width: 1,
                        background: 'var(--ra-playhead)',
                        pointerEvents: 'none'
                      }}
                    />
                  ))}
              </>
            )
          })()}
        </button>
      ) : (
        <div
          title={
            resolving
              ? 'downloading + analyzing…'
              : resolveFailed
                ? "couldn't load this stem -- try reroll"
                : undefined
          }
          style={{
            flex: '1 1 auto',
            minWidth: 140,
            height: 40,
            border: `1px dashed ${
              resolving
                ? 'var(--ra-stretch-on)'
                : resolveFailed
                  ? 'var(--ra-mute-on)'
                  : 'var(--ra-border)'
            }`,
            // Slot-machine reel while genuinely resolving -- a striped bar
            // pattern sliding horizontally, since there's no real waveform
            // to show yet. Static (no background/animation) once settled
            // either way (failed or truly empty).
            backgroundImage: resolving
              ? 'repeating-linear-gradient(90deg, var(--ra-text-4) 0px, var(--ra-text-4) 2px, transparent 2px, transparent 7px, var(--ra-stretch-on) 7px, var(--ra-stretch-on) 9px, transparent 9px, transparent 14px, var(--ra-text-4) 14px, var(--ra-text-4) 17px, transparent 17px, transparent 28px)'
              : undefined,
            animation: resolving
              ? 'discover-slot-reel 700ms linear infinite'
              : resolveFailed
                ? 'discover-slot-pulse 900ms ease-in-out infinite'
                : undefined
          }}
        />
      )}
      {/* Direct request, 2026-09-15: "waveforms should have a fixed area
          they occupy... right now the different names change the width of
          the thing as well." Root cause: this span had no width of its own,
          so as a plain flex sibling of the waveform's `flex: 1 1 auto` box
          it took exactly as much room as its own text needed -- a long
          preset name ("hybrid cine") ate into the waveform's remaining
          flex space, a short one ("fiin") didn't, so every row's waveform
          rendered at a different width even though every row uses the SAME
          maxBarLength/tileOffsetsPx proportional-tiling math above. A fixed
          width (with ellipsis overflow, same convention as the role label
          span just above) keeps this span's own footprint constant across
          every row, so the waveform's flex-grow area -- and therefore its
          tile width -- is identical row to row regardless of name length. */}
      <span
        style={{
          fontSize: 9,
          color: resolveFailed ? 'var(--ra-mute-on)' : 'var(--ra-text)',
          width: 110,
          flexShrink: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap'
        }}
      >
        {rerolling
          ? slot.candidate
            ? 'rerolling…'
            : 'rolling…'
          : resolveFailed
            ? "couldn't load -- try again"
            : slot.candidate
              ? slot.candidate.presetName
              : slot.hasRerolled
                ? 'no match for this role yet'
                : 'no candidate yet'}
      </span>
      {resolvedStem && (
        // Direct request, 2026-09-15: "can we add a mute for each
        // channel" -- toggleSlotPreview already existed (the waveform
        // itself was already clickable to the same effect), but wasn't
        // discoverable as a mute control -- only a hover tooltip
        // explained it. Same handler as the waveform click, so either one
        // keeps the other in sync; only shown once there's a real stem to
        // mute (matching the waveform toggle's own guard).
        <button
          onClick={onTogglePreview}
          title={previewing ? 'playing in the loop -- click to mute' : 'muted -- click to unmute'}
          style={{
            marginLeft: 'auto',
            fontFamily: 'inherit',
            fontSize: 9,
            padding: '3px 8px',
            background: previewing ? 'transparent' : 'var(--ra-mute-on)',
            border: `1px solid ${previewing ? 'var(--ra-border)' : 'var(--ra-mute-on)'}`,
            color: previewing ? 'var(--ra-text-2)' : 'var(--ra-mute-on-ink)',
            cursor: 'pointer'
          }}
        >
          {previewing ? 'mute' : 'muted'}
        </button>
      )}
      <button
        onClick={onReroll}
        disabled={rerolling}
        style={{
          marginLeft: resolvedStem ? 0 : 'auto',
          fontFamily: 'inherit',
          fontSize: 9,
          padding: '3px 8px',
          background: 'transparent',
          border: '1px solid var(--ra-border)',
          color: rerolling ? 'var(--ra-text-4)' : 'var(--ra-text-2)',
          cursor: rerolling ? 'default' : 'pointer'
        }}
      >
        {/* "roll" for a slot's first pick, "reroll" once it already has a
            candidate -- an empty slot has never been rolled, so
            "rerolling" was never the correct verb for it. */}
        {rerolling
          ? slot.candidate
            ? 'rerolling…'
            : 'rolling…'
          : slot.candidate
            ? 'reroll'
            : 'roll'}
      </button>
      <button
        onClick={onRerollRandom}
        disabled={rerolling}
        title="skip role matching -- pick any random stem from your own library"
        style={{
          fontFamily: 'inherit',
          fontSize: 9,
          padding: '3px 8px',
          background: 'transparent',
          border: '1px solid var(--ra-border)',
          color: rerolling ? 'var(--ra-text-4)' : 'var(--ra-text-2)',
          cursor: rerolling ? 'default' : 'pointer'
        }}
      >
        random
      </button>
      <button
        onClick={onRemove}
        style={{
          fontFamily: 'inherit',
          fontSize: 9,
          padding: '3px 8px',
          background: 'transparent',
          border: '1px solid var(--ra-border)',
          color: 'var(--ra-text-2)',
          cursor: 'pointer'
        }}
      >
        remove
      </button>
    </div>
  )
}
