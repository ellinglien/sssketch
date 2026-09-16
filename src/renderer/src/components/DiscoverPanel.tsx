// src/renderer/src/components/DiscoverPanel.tsx
import { useCallback, useEffect, useRef, useState } from 'react'
import { Waveform } from './Waveform'
import { LoadingLoader } from './LoadingLoader'
import { DiscoverNearbyPopover } from './DiscoverNearbyPopover'
import { stemColorVar } from '../theme/typeColor'
import { resolveStretchedForPlayback } from '../audio/resolveStretchedForPlayback'
import { assembleDiscoverRifff } from '../audio/discoverRifffAssembly'
import { ARRANGE_ROLE_OPTIONS, type ArrangeRole } from '@shared/stemRole'
import { instrumentMaskToSoundType } from '@shared/riffLibraryTypes'
import { guessSoundTypeFromPresetName } from '@shared/presetNames'
import { rankCandidates, pickReroll } from '@shared/discoverRanking'
import {
  useAppSelector,
  useDispatch,
  useEngineOwnership,
  usePlaying,
  usePos,
  useFlushEngineSyncNow,
  usePluginCatalog,
  useStemFavourites,
  useStemFavouritesActions
} from '../state/StoreContext'
import { tileOffsetsPx } from '../state/selectors'
import { startPointerDrag } from './dragUtils'
import { type ProjectRef, type SoundType, type Stem, stemKey } from '@shared/types'
import type { DiscoverCandidate } from '../../../main/discoverCandidates'
import { buildEngineProject } from '@shared/buildEngineProject'
import { initialState, type AppState } from '../state/store'
import { scheduleLiveParamSync } from './liveParamSync'

export interface ResolvedCandidateStem {
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
  /** An already-resolved stem this slot should start showing immediately,
   * bypassing `candidate`-based resolution entirely -- set only by seeding
   * Discover from an existing riff's stems that are ALREADY local/resolved
   * (a Shelf-sourced riff's own real Stem data has no riffCID/stemCID to
   * build a DiscoverCandidate from at all; see
   * docs/superpowers/specs/2026-09-16-discover-seed-stems-design.md).
   * Browse-sourced seeding does NOT use this field -- it sets `candidate`
   * instead, going through the normal (lazy, per-row) resolution path, so
   * a Browse-seeded slot shows the same "downloading + analyzing…" state a
   * fresh roll already does. Always `undefined` for a normally-rolled
   * slot. Cleared back to `undefined` the moment this slot is rerolled (see
   * `rollForSlot`/`rollRandomForSlot` below) -- a reroll always fully
   * supersedes whatever this slot started as. */
  seedStem?: ResolvedCandidateStem
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
   * carried into the shared preview mix (read fresh by syncPreviewToEngine
   * every sync) AND, on "plunk in arranger", written into the real placed
   * rifff's state.vol so the same
   * balance the user set while building the loop survives onto the
   * timeline (PLACE_LOOP_ON_TIMELINE's own `vol` field, store.ts). Direct
   * request: a volume control per stem "which will determine the envelope
   * once it's placed in the arrangement." Defaults to 1 (full), matching
   * the universal `state.vol[key] ?? 1` read convention used everywhere
   * else in this codebase. */
  gain: number
}

let nextSlotId = 0
// eslint-disable-next-line react-refresh/only-export-components -- shared helper, not a component
export function freshSlotId(): string {
  nextSlotId += 1
  return `slot-${nextSlotId}`
}

// Undo/redo for Discover's own slot-CONTENT actions (add/remove slot,
// reroll one, random-reroll one, reroll all, and seeding -- see
// docs/superpowers/plans/2026-09-16-discover-seed-stems.md) -- deliberately
// excludes lock/mute/solo toggles and gain drags, see undoStack's own doc
// comment on this component's props below. Capped so a very long Discover
// session doesn't grow an unbounded history in memory. Exported so
// LibraryBrowser.tsx's own seed-triggering handlers (which own the lifted
// undoStack/setUndoStack state directly) can push a snapshot using the
// exact same cap, rather than duplicating this number in a second file.
export const DISCOVER_UNDO_LIMIT = 20

export function DiscoverPanel({
  currentSketch,
  slots,
  setSlots,
  chaos,
  setChaos,
  undoStack,
  setUndoStack,
  redoStack,
  setRedoStack,
  currentUsername,
  discoverConsented,
  setDiscoverConsented,
  seedBpm
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
  /** Undo/redo history for slot-content actions (add/remove slot, reroll
   * one, random-reroll one, reroll all) -- lifted up into LibraryBrowser.tsx
   * for the same reason `slots` itself is (see its own doc comment just
   * above): DiscoverPanel unmounts on every tab switch, so history kept
   * locally here would vanish on every 'browse' <-> 'discover' round trip.
   * Each entry is a full `slots` snapshot taken just before the action that
   * pushed it ran -- restoring one is a plain `setSlots(snapshot)`.
   * Deliberately does NOT cover lock/mute/solo toggles or gain drags (a
   * drag alone would spam the stack with one entry per pixel of movement;
   * toggling lock/mute/solo isn't "content" the way swapping/adding/
   * removing a candidate is). */
  undoStack: DiscoverSlot[][]
  setUndoStack: React.Dispatch<React.SetStateAction<DiscoverSlot[][]>>
  redoStack: DiscoverSlot[][]
  setRedoStack: React.Dispatch<React.SetStateAction<DiscoverSlot[][]>>
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
  /** The most recently seeded riff's own bpm (LibraryBrowser.tsx's
   * discoverSeedBpm, lifted up for the same reason slots/undoStack are --
   * this component unmounts on every tab switch) -- null until a seed
   * action has happened this LibraryBrowser session. Drives the "match
   * seed tempo" button below, direct request 2026-09-16: "maybe a button
   * next to the tempo adjust to set it to the original rifff tempo?" */
  seedBpm: number | null
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
  // Real, live engine playback position (bars) -- while a Discover preview
  // is loaded, this IS the preview loop's own position (Transport.cpp wraps
  // it against the loaded project's own loopLengthBars, which equals the
  // preview rifff's own barLength, see syncPreviewToEngine below), not the
  // real arrangement's. Used below to draw a real moving playhead line on
  // each row's own waveform -- direct report, 2026-09-15: "i don't see the
  // playhead line" after the Web Audio -> native engine preview rewrite
  // removed the old sweepFraction-based one along with the rest of that
  // state machine (its own replacement was explicitly deferred as
  // follow-up work in the design spec's Non-Goals, but a plain "where is
  // the loop right now" line is simple enough to restore immediately using
  // the real position the engine now already reports).
  const pos = usePos()
  const rifffsState = useAppSelector((s) => s.rifffs)
  const bpm = useAppSelector((s) => s.bpm)
  // Read only for the seed-tempo-follow below (syncPreviewToEngine) --
  // whether the real arranger timeline has anything placed on it yet.
  const channelOrder = useAppSelector((s) => s.channelOrder)
  const masterChain = useAppSelector((s) => s.masterChain)
  const channelPlugins = useAppSelector((s) => s.channelPlugins)
  const pluginCatalog = usePluginCatalog()
  const flushEngineSyncNow = useFlushEngineSyncNow()
  const {
    claim: claimEngine,
    stillOwn: stillOwnEngine,
    release: releaseEngine
  } = useEngineOwnership()
  const [onlyOwnStems, setOnlyOwnStems] = useState(true)
  const hasUsername = currentUsername.trim() !== ''
  // Direct request, 2026-09-16: "a setting to prefer favourite stems when
  // randomizing" -- defaults OFF (unlike onlyOwnStems, an existing
  // preference) since this is a brand-new feature nobody has favourited
  // anything for yet; opt-in rather than silently changing existing roll
  // behavior the moment this ships. A SOFT boost when on (see
  // discoverRanking.ts's own FAVOURITE_BOOST), not a hard filter -- same
  // reasoning as "only my stems" own near-impossible-odds bug fixed
  // earlier this session, deliberately not repeated here.
  const [preferFavourites, setPreferFavourites] = useState(false)
  const stemFavourites = useStemFavourites()
  const { toggleStemFavourite } = useStemFavouritesActions()

  // Direct request, 2026-09-15: "it'd be nice to be able to adjust the
  // track tempo from the discover section" -- a real scope reversal of
  // this feature's own original design spec (§8.7 explicitly listed "no
  // independent BPM/Key controls on the Discover tab" as a non-goal, on
  // the assumption the project's own tempo would always be set elsewhere
  // first). Dispatches the exact same SET_TEMPO action TransportBar.tsx's
  // own tempo field already uses (its reducer case clamps to [40, 200]),
  // not a second tempo mechanism -- the bpm-retune effect below re-syncs the
  // whole preview to the new value on every change, so nudging tempo here
  // re-syncs the whole preview mix to the new value, not just future rolls.
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
  // the timeline -- NOT useStemPreviewPlayback.ts (that hook drives the
  // native engine for stems ALREADY placed in this project's own timeline --
  // a Discover candidate is neither, until this section's own throwaway
  // project sends it there). Direct report: Discover shipped with no way to
  // hear a candidate before plunking it in, which this closes.
  //
  // Toggled-on slots play TOGETHER, looped, like the Upcycle reference this
  // whole screen is modeled on -- not one-at-a-time. `previewingSlotIds` is
  // the set of slots currently included in the mix; `resolvedStemsRef` (a
  // ref, not state -- syncing the mix doesn't need to trigger a
  // DiscoverPanel re-render on its own) tracks whichever real, locally-
  // resolved, NATIVE-TEMPO stem each row last reported for itself
  // (reportSlotResolution below, called from each row's own resolve effect)
  // -- DiscoverPanel doesn't resolve candidates itself, resolveCandidateStem
  // lives in each row.
  //
  // As of docs/superpowers/specs/2026-09-15-discover-native-engine-preview-
  // design.md, the preview is no longer plain Web Audio -- it's a throwaway,
  // single-rifff EngineProject (assembleDiscoverRifff + buildEngineProject)
  // sent to the REAL native engine, the exact same pipeline the real
  // arrangement/Tidy Up's own preview already use. `syncPreviewToEngine`
  // (below) is the one place that actually builds/sends that project:
  // called on every toggle AND whenever a toggled-on slot's own resolution
  // changes (a reroll landing while that slot is playing swaps its
  // contribution in). There's no separate "stretch ahead of time" step
  // anymore -- buildEngineProject resolves each stem's own stretch ratio
  // fresh, every call.
  const [previewingSlotIds, setPreviewingSlotIds] = useState<Set<string>>(new Set())
  // Mirrors `previewingSlotIds` for reportSlotResolution (below) to read --
  // that callback is invoked from each DiscoverSlotRow's own resolve effect,
  // which deliberately doesn't depend on this closure, so it can be invoked
  // with a stale `previewingSlotIds` snapshot from an earlier render. With
  // candidate resolution fast enough that two slots can resolve within the
  // same tick, reading AND writing this ref synchronously there means each
  // call unions onto the true current set rather than a stale one missing
  // another slot's just-landed membership. See reportSlotResolution's own
  // comment for the full race this fixes.
  const previewingSlotIdsRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    previewingSlotIdsRef.current = previewingSlotIds
  }, [previewingSlotIds])
  // Every slot's own real, NATIVE-TEMPO resolved stem (path/durationSec/
  // barLength/author/name/type, exactly what each DiscoverSlotRow reports
  // via reportSlotResolution) -- the ONE source of truth `syncPreviewToEngine`
  // reads from to build a fresh throwaway rifff on every sync.
  // buildEngineProject resolves stretch itself (per call), so unlike the old
  // Web-Audio-backed version there's no separate already-stretched map to
  // keep in sync with this one.
  const resolvedStemsRef = useRef<Map<string, ResolvedCandidateStem>>(new Map())
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

  // True once a Discover preview project is actually loaded+playing in the
  // real engine -- the empty-to-non-empty transition (see
  // syncPreviewToEngine below) is the ONLY time the real transport gets
  // paused/seeked/played on this preview's behalf; every later rebuild of
  // an already-loaded preview just keeps playing through it.
  const previewLoadedRef = useRef(false)
  // The CURRENTLY live preview project's own groupId, and which 1-indexed
  // slot number each Discover slot id currently occupies within it -- a
  // fresh groupId is minted on every syncPreviewToEngine call (assembleDiscoverRifff),
  // so this is what lets a live gain-drag update (updateSlotGain, below)
  // address the right `stemKey(groupId, slot)` without waiting for a full
  // rebuild. Null while no preview is loaded.
  const currentPreviewMappingRef = useRef<{
    groupId: string
    slotIndexById: Map<string, number>
  } | null>(null)
  // Per-call generation counter guarding syncPreviewToEngine's own async
  // build-and-send chain (candidate resolve already happened by the time
  // this runs; this guards buildEngineProject's own stretch-resolution
  // await and the engineLoadProject send after it) -- same
  // stale-response-discarded pattern this file already uses for
  // rerollGenerationRef, just for the preview sync itself now that it's a
  // real async round trip to the native engine instead of a synchronous Web
  // Audio call.
  const previewSyncGenerationRef = useRef(0)
  // Set true by the unmount effect below, checked at the top of
  // syncPreviewToEngine -- load-bearing, not defensive fluff:
  // reportSlotResolution can itself trigger a fresh syncPreviewToEngine from
  // a CHILD row's own cleanup effect firing during this SAME unmount pass
  // (e.g. a reroll landing right as the panel closes). Without this guard
  // that straggling call would still kick off a real async build+send with
  // no live component left to ever stop it again once it lands.
  const unmountedRef = useRef(false)

  // "Hands control back" to the real arrangement -- stops treating a
  // Discover preview as loaded and pushes the real, unmodified project back
  // to the engine via the existing, already-exported flushEngineSyncNow()
  // (no snapshot/undo machinery needed: the engine has no persistent memory
  // of its own, so "restoring" is just "send the real project again," see
  // design doc). useCallback (not a plain function) specifically so it can
  // be safely listed in the unmount effect's own dependency array below
  // without an eslint-disable.
  const restorePreviewIfLoaded = useCallback(async (): Promise<void> => {
    // Hands ownership back to the real project's own automatic sync
    // (StoreContext.tsx), UNCONDITIONALLY, before the previewLoadedRef
    // guard below -- real bug, found by review: syncPreviewToEngine
    // claims ownership ('discover-preview') unconditionally, before it
    // even knows whether it has anything to actually preview (its own two
    // early-return paths -- an empty member set, or assembleDiscoverRifff
    // returning null -- both route through this function). If release()
    // only ran behind the `!previewLoadedRef.current` guard below, a
    // claim taken on one of those early-return paths (nothing was ever
    // successfully loaded) would never be released, silently gating off
    // the automatic real-project sync forever. release() is a harmless
    // no-op when nothing is currently held, so calling it unconditionally
    // here covers every caller of this function uniformly.
    const releaseToken = releaseEngine()
    if (!previewLoadedRef.current) return
    previewLoadedRef.current = false
    currentPreviewMappingRef.current = null
    void flushEngineSyncNow(undefined, () => !stillOwnEngine(releaseToken))
  }, [flushEngineSyncNow, releaseEngine, stillOwnEngine])

  useEffect(() => {
    // Real bug, found live 2026-09-15 ("it loads them into the discover
    // section fine but they are not playing at all"). This app runs under
    // <StrictMode> (main.tsx), which in development mounts every component
    // with an extra synchronous setup -> cleanup -> setup cycle -- the exact
    // same gotcha useStemPreviewPlayback.ts's own cancelledRef already has
    // to guard against. Without resetting the ref back to false HERE, in the
    // setup body, the first fake "cleanup" flips unmountedRef.current to
    // true and NOTHING ever flipped it back -- the following fake "setup"
    // re-run re-registers this same cleanup closure but never touches the
    // ref, so syncPreviewToEngine's own `if (unmountedRef.current) return`
    // guard silently no-opped EVERY real call for the rest of this
    // component's life.
    unmountedRef.current = false
    // Same StrictMode double-invoke gotcha as unmountedRef immediately
    // above, applied to the bpm-retune effect's own "skip the very first
    // run" ref below: without resetting it back to true HERE, the fake
    // setup -> cleanup -> setup cycle would flip it to false on the first
    // (fake) run and never flip it back, so the second (real) run wrongly
    // treats itself as "not the first mount anymore" and fires a real
    // syncPreviewToEngine call. Harmless today (nothing's previewing yet at
    // mount), but the same bug class as unmountedRef's -- fixed for
    // consistency/defense-in-depth.
    skipFirstBpmRetuneRef.current = true
    return () => {
      unmountedRef.current = true
      void restorePreviewIfLoaded()
    }
  }, [restorePreviewIfLoaded])

  /** Syncs the playing preview to exactly `ids` -- builds a throwaway,
   * single-rifff EngineProject from every id in `ids` that has a resolved
   * stem, and sends it to the real native engine, replacing whatever
   * preview (or nothing) was loaded before. Called on every toggle AND
   * whenever a toggled-on slot's own resolution changes (a reroll landing,
   * a bpm retune). See docs/superpowers/specs/2026-09-15-discover-native-
   * engine-preview-design.md.
   *
   * The real arrangement's own state (`state.rifffs`/`vol`/etc.) is never
   * touched -- the thrown-together AppState here only copies bpm/
   * masterChain/channelPlugins from the real one, so master/channel FX are
   * audibly applied while auditioning too (a natural consequence of going
   * through the engine's own mixer, not a separate feature). */
  async function syncPreviewToEngine(ids: Set<string>): Promise<void> {
    if (unmountedRef.current) return
    const myGeneration = previewSyncGenerationRef.current + 1
    previewSyncGenerationRef.current = myGeneration
    const engineToken = claimEngine('discover-preview')

    const members = [...ids]
      .map((id) => {
        const stem = resolvedStemsRef.current.get(id)
        if (!stem) return null
        const gain = slots.find((s) => s.id === id)?.gain ?? 1
        return { id, stem, gain }
      })
      .filter((x): x is { id: string; stem: ResolvedCandidateStem; gain: number } => x !== null)

    if (members.length === 0) {
      await restorePreviewIfLoaded()
      return
    }

    const assembly = assembleDiscoverRifff(
      'discover preview',
      members.map(({ stem, gain }) => ({ stem, gain })),
      bpm
    )
    if (!assembly) {
      // Unreachable in practice (members.length > 0 already checked above,
      // and assembleDiscoverRifff only returns null for an empty list), but
      // handled rather than asserted since the function's own return type
      // is nullable.
      await restorePreviewIfLoaded()
      return
    }
    const { rifff, vol } = assembly

    // A throwaway single-rifff AppState -- only bpm/masterChain/
    // channelPlugins are copied from the real project; state.rifffs is
    // ENTIRELY replaced by this one preview rifff, never merged with the
    // real state.rifffs. `startBar: 0` (buildEngineProject's own `placed`
    // filter requires a defined startBar to include a rifff at all) is what
    // makes this preview's own loopLengthBars equal exactly the rifff's own
    // barLength, so the transport loops just this one loop.
    const previewState: AppState = {
      ...initialState,
      bpm,
      masterChain,
      channelPlugins,
      rifffs: { [rifff.groupId]: { ...rifff, startBar: 0 } },
      vol,
      stretch: { [rifff.groupId]: true }
    }

    // Real IPC/async round trip to the native engine -- wrapped in its own
    // try/catch, matching this file's own established convention elsewhere
    // (resolveCandidateStem, rollForSlot) of never letting a real async
    // call fail as a silent unhandled rejection. On a genuine failure,
    // nothing was actually loaded into the engine, so previewLoadedRef/
    // currentPreviewMappingRef are deliberately left untouched here rather
    // than updated -- they should keep describing whatever preview (or
    // lack of one) was really last loaded successfully.
    try {
      const project = await buildEngineProject(
        previewState,
        resolveStretchedForPlayback,
        pluginCatalog
      )
      if (unmountedRef.current || previewSyncGenerationRef.current !== myGeneration) return
      if (!stillOwnEngine(engineToken)) return

      await window.rifffApi.engineLoadProject(project)
      if (unmountedRef.current || previewSyncGenerationRef.current !== myGeneration) return
      if (!stillOwnEngine(engineToken)) return

      currentPreviewMappingRef.current = {
        groupId: rifff.groupId,
        slotIndexById: new Map(members.map(({ id }, i) => [id, i + 1]))
      }

      // Only on the empty-to-non-empty transition -- a later rebuild of an
      // already-loaded preview just keeps playing through it, matching every
      // other "audition something else" flow in this app (no auto-resume once
      // a preview stops).
      if (!previewLoadedRef.current) {
        previewLoadedRef.current = true
        // Direct request, 2026-09-16: "i'd like the tempo to be set to
        // the original imported rifff in discovery." An earlier attempt
        // dispatched this at SEED time, in LibraryBrowser.tsx -- but
        // state.bpm is one of StoreContext.tsx's scheduleEngineSync's own
        // listed dependencies, and ownership wasn't claimed yet at that
        // point, so it raced the automatic real-project sync into loading
        // (and, since state.playing could already be true, audibly
        // playing) the real project right as Discover's own preview was
        // also loading -- the real cause of a live "multiple versions of
        // the rifff playing" report (root-caused and reverted same day,
        // see LibraryBrowser.tsx's own seedDiscoverFromBrowseRiff). Doing
        // it HERE instead is race-free: this line only runs once
        // `claimEngine`/`stillOwnEngine` above have already confirmed
        // Discover holds engine ownership, so scheduleEngineSync's own
        // ownership gate correctly skips the real-project sync when this
        // bpm change lands. Only when the real arranger has nothing
        // placed on it yet (channelOrder), same as before -- never
        // retunes an already-populated project. This block already only
        // ever runs once per seed (DiscoverPanel is freshly mounted for
        // every seed action, and this is gated on the same
        // empty-to-non-empty previewLoadedRef transition as the PLAY
        // dispatch below), so no extra "already applied" tracking is
        // needed.
        if (seedBpm !== null && channelOrder.length === 0) {
          dispatch({ type: 'SET_TEMPO', bpm: seedBpm })
        }
        if (playing) dispatch({ type: 'PAUSE' })
        void window.rifffApi.engineSetPosition(0)
        dispatch({ type: 'PLAY' })
      }
    } catch (err) {
      console.error('DiscoverPanel: syncPreviewToEngine failed:', err)
      // A failed build/send must not leave this claim dangling forever --
      // but UNLIKE useStemPreviewPlayback.ts's own equivalent fix, whether
      // it's safe to release here depends on `previewLoadedRef.current`:
      //
      // - If nothing was EVER successfully loaded under this claim yet
      //   (previewLoadedRef.current is still false -- this was the FIRST
      //   attempt, or every attempt so far has failed), the engine still
      //   has whatever was loaded before this claim started (most likely
      //   the real project). Releasing is correct and necessary here --
      //   otherwise StoreContext's automatic real-project sync stays
      //   gated off forever even though nothing Discover-related ever
      //   actually reached the engine.
      // - If a PREVIOUS call already got a discover-preview project into
      //   the engine and it's currently loaded/playing
      //   (previewLoadedRef.current is true), the engine STILL has that
      //   last-successfully-sent project loaded -- THIS failed resync
      //   attempt (e.g. a reroll landing) didn't change what's actually
      //   audible. Releasing in that case would be WRONG: it would hand
      //   control to the automatic real-project sync, which would then
      //   silently overwrite/kill the still-playing preview the user
      //   never asked to stop. Keep the claim in that case.
      if (!previewLoadedRef.current && stillOwnEngine(engineToken)) releaseEngine()
    }
  }

  function toggleSlotPreview(id: string): void {
    const next = new Set(previewingSlotIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    previewingSlotIdsRef.current = next
    setPreviewingSlotIds(next)
    void syncPreviewToEngine(next)
  }

  // Direct request, 2026-09-15 (Upcycle-inspired): solo THIS slot -- drop
  // every other slot out of the mix, leaving just this one audible.
  // Deliberately NOT a separate persisted "soloed slot id": mirrors
  // store.ts's own SOLO_GROUP/SOLO_CHANNEL convention exactly (computed
  // fresh from current state, toggle-back-to-full-mix on a second click of
  // the SAME already-sole slot, rather than trying to snapshot/restore
  // whatever the mix looked like before soloing -- "solo is normally a
  // temporary A/B listen, not a state worth preserving precisely," same
  // reasoning documented on SOLO_GROUP in store.ts). "Full mix" here means
  // every currently-RESOLVED slot (resolvedStemsRef's own keys), matching
  // this panel's own existing autoplay convention (a freshly resolved slot
  // joins the mix automatically) rather than trying to recall which
  // slots happened to be included right before the solo.
  function toggleSlotSolo(id: string): void {
    const alreadySoleSoloed = previewingSlotIds.size === 1 && previewingSlotIds.has(id)
    const next = alreadySoleSoloed ? new Set(resolvedStemsRef.current.keys()) : new Set([id])
    previewingSlotIdsRef.current = next
    setPreviewingSlotIds(next)
    void syncPreviewToEngine(next)
  }

  // Called by each DiscoverSlotRow whenever its OWN resolved stem changes
  // (a fresh resolution lands, a reroll invalidates the old one, or the
  // slot unmounts/gets removed) -- keeps `resolvedStemsRef` accurate and,
  // if this particular slot is currently part of the playing preview,
  // re-syncs it so the audible loop actually reflects what's now showing on
  // screen.
  //
  // Direct request: "it all should autoplay" -- a slot that just landed a
  // real, playable stem (its first-ever roll on addSlot, or a later reroll)
  // joins the shared preview automatically here rather than requiring an
  // explicit click on its own waveform first.
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
  // already built for exactly this class of bug -- this reads/writes it
  // synchronously for exactly that reason.
  //
  // There's no separate async stretch step anymore -- buildEngineProject
  // (via syncPreviewToEngine) resolves that internally, every call.
  function reportSlotResolution(id: string, stem: ResolvedCandidateStem | null): void {
    if (stem) {
      resolvedStemsRef.current.set(id, stem)
      setResolvedBarLengths((prev) => {
        const next = new Map(prev)
        next.set(id, stem.barLength)
        return next
      })
      const currentlyPreviewing = previewingSlotIdsRef.current
      if (!currentlyPreviewing.has(id)) {
        const next = new Set(currentlyPreviewing).add(id)
        previewingSlotIdsRef.current = next
        setPreviewingSlotIds(next)
        void syncPreviewToEngine(next)
        return
      }
      void syncPreviewToEngine(currentlyPreviewing)
      return
    }
    resolvedStemsRef.current.delete(id)
    setResolvedBarLengths((prev) => {
      if (!prev.has(id)) return prev
      const next = new Map(prev)
      next.delete(id)
      return next
    })
    const currentlyPreviewing = previewingSlotIdsRef.current
    if (currentlyPreviewing.has(id)) void syncPreviewToEngine(currentlyPreviewing)
  }

  // Re-tunes every currently-resolved slot when the project's own bpm
  // changes (TransportBar's +/- buttons, its own tempo field, loading a
  // different project, OR the tempo control this panel itself adds below)
  // -- direct request, 2026-09-15: "it'd be nice to be able to adjust the
  // track tempo from the discover section." Without this, a slot already
  // playing/resolved would keep its OLD stretch ratio baked into the
  // currently-loaded preview project until its next reroll -- silently
  // drifting out of sync with a bpm change made right here on the same
  // panel. A single syncPreviewToEngine call re-resolves EVERY currently-
  // included stem's own stretch ratio against the new bpm at once (since
  // buildEngineProject recomputes each stem's ratio fresh every call) --
  // no per-id loop needed. Skips the very first run (component mount/tab
  // open) -- reportSlotResolution already resolves each slot once at its
  // own native pace; re-resolving everything again immediately on mount
  // would just be redundant work.
  const skipFirstBpmRetuneRef = useRef(true)
  useEffect(() => {
    if (skipFirstBpmRetuneRef.current) {
      // this ref is also reset (back to true) by the mount effect above,
      // for the exact same StrictMode double-invoke reasoning as
      // unmountedRef there. The linter reads that as "used previously in
      // an effect function," but the two effects deliberately coordinate
      // on this ref by design -- it's not an accidental cross-effect
      // mutation.
      // eslint-disable-next-line react-hooks/immutability
      skipFirstBpmRetuneRef.current = false
      return
    }
    void syncPreviewToEngine(previewingSlotIdsRef.current)
    // syncPreviewToEngine is a plain function re-created every render (not
    // memoized), not a real reactive dependency; only an actual bpm change
    // should retune.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bpm])

  // Live-updates a slot's own committed gain -- both in `slots` state (so
  // the volume slider itself, and "plunk in arranger" later, read the
  // current value) and, if this slot is part of the currently-loaded
  // preview, pushed straight to the real engine via scheduleLiveParamSync
  // -- the same rAF-coalesced, full-reload-bypassing path the real
  // arranger's own volume sliders already use -- instead of a full project
  // rebuild per drag tick.
  //
  // Direct request, 2026-09-15: "dragging envelope/volume shouldn't
  // retrigger start of samples... should not affect playhead."
  function updateSlotGain(id: string, gain: number): void {
    setSlots((prev) => prev.map((s) => (s.id === id ? { ...s, gain } : s)))
    const mapping = currentPreviewMappingRef.current
    const slotIndex = mapping?.slotIndexById.get(id)
    if (mapping && slotIndex !== undefined) {
      scheduleLiveParamSync('volume', stemKey(mapping.groupId, slotIndex), gain)
    }
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
  // Direct report, 2026-09-16: "plunk in arranger doesn't have much of a
  // confirmation thing.. can we indicate it works somehow? maybe a subtle
  // microanimation" -- a brief, one-shot ring pulse on the button itself
  // right after a successful placement, matching this session's own
  // established "subtle quick microanimation" preference and reusing the
  // exact pattern ClusterStemsBrowser.tsx's own celebratingRow already
  // uses for the same purpose (a box-shadow ring, 500ms ease-out, cleared
  // by its own timeout rather than an animationend round-trip).
  const [justPlunked, setJustPlunked] = useState(false)

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
  // Call at the START of any undoable action, BEFORE mutating `slots` --
  // captures the pre-action snapshot to restore to, and clears the redo
  // stack (standard undo/redo semantics: a fresh action invalidates
  // whatever redo history existed, same as this app's own real undo
  // system). `slots` here is this render's own closure, same convention
  // every other slots-reading function in this file already relies on
  // (see rollForSlot's own doc comment on this).
  function pushUndoSnapshot(): void {
    setUndoStack((prev) => [...prev, slots].slice(-DISCOVER_UNDO_LIMIT))
    setRedoStack([])
  }

  // Restores a snapshot from an undo/redo pop -- besides setSlots itself,
  // reconciles `previewingSlotIds`/`resolvedStemsRef` against whatever ids
  // the snapshot actually contains, so a slot that the snapshot doesn't
  // have (e.g. undoing an addSlot) doesn't linger in either as a stale,
  // pointless entry for a slot that no longer exists -- same cleanup
  // removeSlot itself already does, just generalized to "whatever changed"
  // rather than one specific known id. A slot the snapshot brings BACK
  // (e.g. undoing a removeSlot) needs no special-casing here: its row
  // simply remounts and resolves/rejoins the mix on its own, the same
  // autoplay path every fresh slot already goes through.
  function applySlotsSnapshot(next: DiscoverSlot[]): void {
    setSlots(next)
    const validIds = new Set(next.map((s) => s.id))
    for (const id of resolvedStemsRef.current.keys()) {
      if (!validIds.has(id)) resolvedStemsRef.current.delete(id)
    }
    // Reads/writes previewingSlotIdsRef synchronously (not a functional
    // setState updater) for the same reason reportSlotResolution above
    // does -- side effects (syncPreviewToEngine) don't belong inside a
    // setState updater, which React may invoke more than once.
    const current = previewingSlotIdsRef.current
    const pruned = new Set([...current].filter((id) => validIds.has(id)))
    if (pruned.size !== current.size) {
      previewingSlotIdsRef.current = pruned
      setPreviewingSlotIds(pruned)
      void syncPreviewToEngine(pruned)
    }
  }

  function undoDiscoverAction(): void {
    if (undoStack.length === 0) return
    const snapshot = undoStack[undoStack.length - 1]
    setRedoStack((prev) => [...prev, slots].slice(-DISCOVER_UNDO_LIMIT))
    setUndoStack((prev) => prev.slice(0, -1))
    applySlotsSnapshot(snapshot)
  }

  function redoDiscoverAction(): void {
    if (redoStack.length === 0) return
    const snapshot = redoStack[redoStack.length - 1]
    setUndoStack((prev) => [...prev, slots].slice(-DISCOVER_UNDO_LIMIT))
    setRedoStack((prev) => prev.slice(0, -1))
    applySlotsSnapshot(snapshot)
  }

  function addSlot(role: ArrangeRole): void {
    pushUndoSnapshot()
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
    pushUndoSnapshot()
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

  // Commits a candidate picked from a slot's own "explore nearby" popover
  // -- same instant, undoable swap as a normal reroll landing (rollForSlot's
  // own final setSlots call, mirrored exactly here), just skipping the
  // fetch/rank/pick machinery since the popover already handed us a real,
  // specific candidate to use. Direct request, 2026-09-16 (temporal
  // adjacency exploration) -- see docs/superpowers/specs/2026-09-16-
  // discover-temporal-adjacency-design.md.
  function swapSlotFromNearby(id: string, candidate: DiscoverCandidate): void {
    pushUndoSnapshot()
    setSlots((prev) =>
      prev.map((s) =>
        s.id === id ? { ...s, candidate, hasRerolled: true, seedStem: undefined } : s
      )
    )
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
      const ranked = rankCandidates(pool, {
        targetBpm: bpm,
        favouriteStemCIDs: preferFavourites ? stemFavourites : undefined
      })
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
        prev.map((s) =>
          s.id === id ? { ...s, candidate: picked, hasRerolled: true, seedStem: undefined } : s
        )
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
    pushUndoSnapshot()
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
        prev.map((s) =>
          s.id === id ? { ...s, candidate, hasRerolled: true, seedStem: undefined } : s
        )
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
    pushUndoSnapshot()
    await rollRandomForSlot(id, slot.role)
  }

  async function rerollAll(): Promise<void> {
    // One undo snapshot for the WHOLE batch, taken up front -- calls
    // rollForSlot directly below (not the public rerollSlot wrapper, which
    // pushes its OWN snapshot per slot) so "undo" after a "reroll all"
    // restores every slot at once, in a single step, rather than only
    // walking back the last slot rerolled.
    pushUndoSnapshot()
    // Sequential, not Promise.all -- each slot's own reroll is a real IPC
    // round trip; running them one at a time keeps this simple and avoids
    // hammering the main process with N simultaneous full-library scans at
    // once for a loop with many slots. Locked slots are skipped entirely.
    //
    // No try/catch of its own -- rollForSlot itself never throws (it
    // catches and logs internally, above), so one slot failing can't abort
    // this loop and silently leave every LATER unlocked slot untouched.
    for (const slot of slots) {
      if (!slot.locked) await rollForSlot(slot.id, slot.role)
    }
  }

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
      const placeable = slots.filter(
        (s): s is DiscoverSlot & { candidate: DiscoverCandidate } => s.candidate !== null
      )
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

      const roles = [...new Set(placeable.map((s) => s.role))]
      const assembly = assembleDiscoverRifff(
        `discover: ${roles.join('+')}`,
        placed.map(({ stem, gain }) => ({ stem, gain })),
        bpm
      )
      if (!assembly) return // placed.length === 0 already returned earlier; unreachable in practice
      const { rifff, vol } = assembly

      // Appends after the furthest-right currently-placed clip, matching
      // "adds alongside, never replaces" from the design spec's own §8.4 --
      // never touches an existing rifff's own startBar.
      const placedEnds = Object.values(rifffsState)
        .filter((r) => r.startBar !== undefined)
        .map((r) => (r.startBar ?? 0) + r.barLength)
      const startBar = placedEnds.length > 0 ? Math.max(...placedEnds) : 0

      dispatch({ type: 'PLACE_LOOP_ON_TIMELINE', stems: [rifff], startBar, vol })
      // Deliberately NOT restorePreviewIfLoaded()/flushEngineSyncNow() here
      // -- the dispatch above already changes state.rifffs, which the
      // existing, separate coalesced engine-sync effect in StoreContext.tsx
      // picks up and re-sends on its own. Just resetting these two refs
      // means the NEXT slot change (if the user keeps building right after
      // plunking) correctly starts a fresh preview rather than assuming a
      // still-loaded one that the real sync effect already silently
      // overwrote.
      //
      // releaseEngine() IS still required here, though (added after code
      // review): that automatic coalesced sync effect now SKIPS its own
      // send entirely while something holds engine ownership (see
      // StoreContext.tsx's own scheduleEngineSync gating, added earlier in
      // this same plan) -- without releasing here, this function's own
      // 'discover-preview' claim (from whatever syncPreviewToEngine call
      // last ran) stays held, and the automatic sync's state.rifffs-change
      // pickup described above would silently no-op instead of actually
      // reaching the engine. This also closes the SAME straggling-call
      // race the previewSyncGenerationRef bump just below already guards
      // against, belt-and-suspenders: an in-flight syncPreviewToEngine
      // call that claimed ownership before this function ran will find its
      // own token stale (stillOwnEngine returns false) the moment it
      // resumes after its own await, since release() here bumps the same
      // shared generation.
      releaseEngine()
      previewLoadedRef.current = false
      currentPreviewMappingRef.current = null
      // Real bug, found by review: an already-in-flight syncPreviewToEngine
      // call (e.g. kicked off moments ago by a bpm change or a reroll
      // landing) is still awaiting buildEngineProject/engineLoadProject
      // right now, and its own generation was still valid as of the top of
      // THIS function -- resetting the tracking refs above does nothing to
      // stop it from landing right after PLACE_LOOP_ON_TIMELINE and
      // clobbering the real project we just placed with its now-stale
      // throwaway preview one (plus possibly re-triggering the empty-to-
      // non-empty pause/seek/play sequence and leaving
      // currentPreviewMappingRef pointing at stale data). Bumping the SAME
      // generation ref syncPreviewToEngine itself checks after each of its
      // own awaits makes that straggling call's post-await check fail, so
      // it bails out harmlessly instead.
      previewSyncGenerationRef.current += 1
      setJustPlunked(true)
      window.setTimeout(() => setJustPlunked(false), 500)
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
          the FAILED state -- a static "this stopped" cue.
          Direct report, 2026-09-15 (v3): the previous versions of this
          screen's own "still working" animations (a spinning dice/shuffle
          icon, a scrolling multi-waveform reel) read as too busy. The
          resolving placeholder now uses the shared LoadingLoader component
          (the same four-bar bounce BeatPicker.tsx/ClusterStemsBrowser.tsx/
          LibraryBrowser.tsx already use for "still working"). The per-slot
          reroll/random buttons tried LoadingLoader (too small to read
          legibly at 22x22) then a small icon-jump bounce -- direct
          follow-up report, 2026-09-16: remove the button animation
          entirely. The disabled/rolling state now reads purely through the
          existing dimmed color + default cursor + title tooltip, no
          motion. */}
      <style>{`
        @keyframes discover-slot-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.35; }
        }
        @keyframes discover-plunk-pulse {
          0% { box-shadow: 0 0 0 0 var(--ra-stretch-on); }
          35% { box-shadow: 0 0 0 3px var(--ra-stretch-on); }
          100% { box-shadow: 0 0 0 0 transparent; }
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
        {seedBpm !== null && seedBpm !== bpm && (
          <button
            onClick={() => dispatch({ type: 'SET_TEMPO', bpm: seedBpm })}
            title={`Match seeded riff's own tempo (${seedBpm} bpm)`}
            aria-label="Match seeded riff's own tempo"
            style={{
              height: 18,
              padding: '0 6px',
              fontSize: 9,
              border: '1px solid var(--ra-border)',
              background: 'var(--ra-bg-row-active)',
              color: 'var(--ra-text)',
              cursor: 'pointer'
            }}
          >
            match seed ({seedBpm})
          </button>
        )}
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
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            fontSize: 10,
            color: 'var(--ra-text-2)'
          }}
        >
          <input
            type="checkbox"
            checked={preferFavourites}
            title="favourited stems (star icon on a resolved slot) are weighted more likely to come up on roll/reroll -- never the only ones that can, just more often"
            onChange={(e) => setPreferFavourites(e.target.checked)}
          />
          prefer favourites
        </label>
        {/* Undo/redo for slot-content actions (add/remove slot, reroll one,
            random-reroll one, reroll all) -- direct request, 2026-09-15,
            inspired by Upcycle's own toolbar undo/redo arrows. Button-only
            (no keyboard shortcut): this app already binds Cmd+Z globally to
            the REAL arrangement's own undo system, and Discover's slots
            aren't part of that reducer's state at all -- a second Cmd+Z
            meaning here would either silently do nothing useful most of the
            time or, worse, race/compete with the real one. */}
        <button
          onClick={undoDiscoverAction}
          disabled={undoStack.length === 0}
          title="undo"
          style={{
            marginLeft: 'auto',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 22,
            height: 22,
            padding: 0,
            background: 'transparent',
            border: '1px solid var(--ra-border)',
            color: undoStack.length === 0 ? 'var(--ra-text-4)' : 'var(--ra-text-2)',
            cursor: undoStack.length === 0 ? 'default' : 'pointer'
          }}
        >
          <UndoIcon />
        </button>
        <button
          onClick={redoDiscoverAction}
          disabled={redoStack.length === 0}
          title="redo"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 22,
            height: 22,
            padding: 0,
            background: 'transparent',
            border: '1px solid var(--ra-border)',
            color: redoStack.length === 0 ? 'var(--ra-text-4)' : 'var(--ra-text-2)',
            cursor: redoStack.length === 0 ? 'default' : 'pointer'
          }}
        >
          <RedoIcon />
        </button>
        <button
          onClick={() => void rerollAll()}
          disabled={rerollingSlotIds.size > 0}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 5,
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
          {rerollingSlotIds.size > 0 ? <LoadingLoader size={11} /> : <ShuffleIcon />}
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
            cursor: placing ? 'default' : 'pointer',
            animation: justPlunked ? 'discover-plunk-pulse 500ms ease-out' : undefined
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
        // `pos` only means something as a loop position while a preview is
        // actually loaded (previewingSlotIds.size > 0 <=> previewLoadedRef
        // is true, see syncPreviewToEngine/restorePreviewIfLoaded above) --
        // otherwise it's just wherever the REAL arrangement's own playhead
        // happens to sit, which has nothing to do with this loop.
        const playheadPct =
          previewingSlotIds.size > 0 && maxBarLength > 0
            ? Math.max(0, Math.min(100, (pos / maxBarLength) * 100))
            : null
        return slots.map((slot) => (
          <DiscoverSlotRow
            key={slot.id}
            slot={slot}
            rerolling={rerollingSlotIds.has(slot.id)}
            previewing={previewingSlotIds.has(slot.id)}
            soloed={previewingSlotIds.size === 1 && previewingSlotIds.has(slot.id)}
            favourited={slot.candidate !== null && stemFavourites.has(slot.candidate.stemCID)}
            maxBarLength={maxBarLength}
            playheadPct={playheadPct}
            onToggleLock={() => toggleLock(slot.id)}
            onRemove={() => removeSlot(slot.id)}
            onReroll={() => void rerollSlot(slot.id)}
            onRerollRandom={() => void rerollRandomSlot(slot.id)}
            onTogglePreview={() => toggleSlotPreview(slot.id)}
            onToggleSolo={() => toggleSlotSolo(slot.id)}
            onToggleFavourite={() => {
              if (slot.candidate) toggleStemFavourite(slot.candidate.stemCID)
            }}
            onResolvedChange={(stem) => reportSlotResolution(slot.id, stem)}
            onGainChange={(gain) => updateSlotGain(slot.id, gain)}
            onSwapFromNearby={(candidate) => swapSlotFromNearby(slot.id, candidate)}
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

// Hand-drawn die-face glyph, styled after Phosphor's DiceFive icon -- same
// "drawn directly as inline SVG, no icon package" convention as LockGlyph
// just above. Direct request, 2026-09-15: an icon-only button (no text
// label) for "random" -- skips role-matching entirely and picks a genuinely
// random stem, so a literal die reads correctly for exactly that one
// action (see ShuffleIcon just below for "reroll," which is a DIFFERENT,
// ranked-pool action and got its own distinct glyph after direct feedback
// that dice-for-both was ambiguous once the text labels came off).
// No longer takes a `rolling` prop -- direct report, 2026-09-15 (v3): the
// previous spin-while-rolling animation read as too busy. Callers now show
// a small LoadingLoader in this icon's place while a roll is in flight
// instead (see DiscoverSlotRow's own random/reroll buttons, below) --
// same "still working" indicator, just borrowed from the app's own
// existing brand-consistent loading animation instead of a custom one.
function DiceIcon(): React.JSX.Element {
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
      style={{ flexShrink: 0 }}
    >
      <rect x="2" y="2" width="12" height="12" rx="2.5" />
      {/* Five pips (a DiceFive face) -- doesn't need to represent any real
          rolled value, it's decorative either way, and five reads clearly
          at this size where six pips would blur together. */}
      <circle cx="5" cy="5" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="11" cy="5" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="8" cy="8" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="5" cy="11" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="11" cy="11" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  )
}

// Hand-drawn shuffle glyph (two crossing arrows), styled after Phosphor's
// own Shuffle icon -- same "no icon package" convention as every other
// glyph in this file. Direct request, 2026-09-15: "instead of a dice for
// the reroll... let's use shuffle arrows" -- reroll picks from a real,
// ranked candidate pool (see rankCandidates/pickReroll), a meaningfully
// different action from "random"'s own literal dice-roll, so it earns a
// visually distinct icon now that the text labels are gone. No longer
// takes a `rolling` prop -- see DiceIcon's own doc comment just above for
// why.
function ShuffleIcon(): React.JSX.Element {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0 }}
    >
      {/* Two crossing lanes, each with its own arrowhead at the far end --
          the classic "shuffle" read (two streams swapping places), not a
          single loop/refresh arrow. */}
      <path d="M1.5 4.5 H5 a3 3 0 0 1 2.2 1 l3.6 4 a3 3 0 0 0 2.2 1 h1.5" />
      <path d="M13 8.5 l2 2 l-2 2" />
      <path d="M1.5 11.5 H5 a3 3 0 0 0 2.2 -1 l1 -1.1" />
      <path d="M13 3.5 l2 2 l-2 2" />
      <path d="M9.6 6.6 l0.8 -0.9 a3 3 0 0 1 2.2 -1 h1.5" />
    </svg>
  )
}

// Hand-drawn undo/redo glyphs (a curved "back" arrow, redo is the exact
// same shape mirrored horizontally rather than a second hand-derived
// coordinate set) -- same "no icon package" convention as every other
// glyph in this file. Direct request, 2026-09-15 (Upcycle-inspired):
// undo/redo for Discover's own reroll/add/remove actions.
function UndoIcon(): React.JSX.Element {
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
      style={{ flexShrink: 0 }}
    >
      <path d="M13 6 H7 a4 4 0 0 0 -4 4 v1" />
      <path d="M5.5 8 l-2.5 2 l2.5 2" />
    </svg>
  )
}

function RedoIcon(): React.JSX.Element {
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
      style={{ flexShrink: 0 }}
    >
      <g transform="scale(-1,1) translate(-16,0)">
        <path d="M13 6 H7 a4 4 0 0 0 -4 4 v1" />
        <path d="M5.5 8 l-2.5 2 l2.5 2" />
      </g>
    </svg>
  )
}

// Hand-drawn five-point star, styled after Phosphor's own Star icon -- same
// "no icon package" convention as every other glyph in this file. Direct
// request, 2026-09-16: star a stem to favourite it. Filled when favourited
// (currentColor fill), outline-only otherwise -- same filled-means-active
// convention every other on/off glyph in this app already uses (e.g.
// CollapsedRifffRow.tsx's own mute dot doc comment).
function StarIcon({ favourited }: { favourited: boolean }): React.JSX.Element {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill={favourited ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinejoin="round"
      style={{ flexShrink: 0 }}
    >
      <path d="M8 1.5 L9.53 5.9 L14.18 5.99 L10.47 8.8 L11.82 13.26 L8 10.6 L4.18 13.26 L5.53 8.8 L1.82 5.99 L6.47 5.9 Z" />
    </svg>
  )
}

// Three connected waypoints -- "browse nearby points along this jam's own
// timeline." Same hand-drawn, monochrome-via-currentColor convention as
// LockGlyph/ShuffleIcon/DiceIcon/StarIcon just above -- no icon library.
function NearbyIcon(): React.JSX.Element {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
    >
      <circle cx="3" cy="8" r="1.6" />
      <circle cx="8" cy="3" r="1.6" />
      <circle cx="8" cy="13" r="1.6" />
      <circle cx="13" cy="8" r="1.6" />
      <line x1="4.3" y1="7.3" x2="6.7" y2="4.3" />
      <line x1="4.3" y1="8.7" x2="6.7" y2="11.7" />
      <line x1="9.3" y1="4.3" x2="11.7" y2="7.3" />
      <line x1="9.3" y1="11.7" x2="11.7" y2="8.7" />
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
  soloed,
  favourited,
  maxBarLength,
  playheadPct,
  onToggleLock,
  onRemove,
  onReroll,
  onRerollRandom,
  onTogglePreview,
  onToggleSolo,
  onToggleFavourite,
  onResolvedChange,
  onGainChange,
  onSwapFromNearby
}: {
  slot: DiscoverSlot
  /** True while THIS slot's own rerollSlot call is in flight -- drives the
   * reroll button's disabled/label-swap state, matching
   * LibraryBrowser.tsx's own downloadingRiffCID-driven disabled + label
   * convention. */
  rerolling: boolean
  /** True while THIS slot is currently included in the playing mix
   * (DiscoverPanel's own `previewingSlotIds`). Toggled-on slots play
   * TOGETHER, looped, like the Upcycle reference this screen is modeled on
   * -- not a one-at-a-time solo. */
  previewing: boolean
  /** True while THIS slot is the ONLY one currently in the playing mix
   * (DiscoverPanel's own `previewingSlotIds.size === 1 && ...has(slot.id)`)
   * -- drives the "S" button's active state, matching ChannelRow.tsx's own
   * `soloed` computed-fresh-from-mute-state convention (not a separately
   * persisted "which slot is soloed" flag). Direct request, 2026-09-15
   * (Upcycle-inspired). */
  soloed: boolean
  /** True when this slot's own resolved candidate's stemCID is in
   * DiscoverPanel's own `stemFavourites` set -- direct request,
   * 2026-09-16, star a stem so "prefer favourites" (the panel's own
   * toolbar checkbox) can bias future rolls toward it. Persisted (see
   * StoreContext.tsx's useStemFavourites), not per-session. */
  favourited: boolean
  /** The longest currently-resolved slot's own barLength, library-wide
   * across every row (DiscoverPanel's own `maxBarLength`) -- this row's own
   * waveform tiles/scales its own resolvedStem.barLength against this SAME
   * shared reference, so the whole loop's rows read as proportional to each
   * other (a 1-bar stem visibly repeats 8x next to an 8-bar one) instead of
   * every stem stretching to fill the same fixed box regardless of its real
   * length. 0 before anything in the loop has resolved yet. */
  maxBarLength: number
  /** This row's own waveform-relative playhead position, 0-100 (percent of
   * `maxBarLength`), or null while nothing in the loop is currently
   * previewing (DiscoverPanel's own `previewingSlotIds` is empty, so the
   * real engine position doesn't refer to this loop at all -- see
   * DiscoverPanel's own `playheadPct` computation). Direct report,
   * 2026-09-15: the playhead line was lost when the preview backend moved
   * from Web Audio to the real engine; this reuses the engine's own live
   * position instead of reintroducing a separate elapsed-time sweep. */
  playheadPct: number | null
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
  /** Solos THIS slot -- see DiscoverPanel's own toggleSlotSolo for the
   * exact semantics (drop every other slot out of the mix; a second click
   * while already the sole soloed slot restores every resolved slot).
   * Only shown once there's a real stem to solo (matching the mute
   * button's own guard, just below). */
  onToggleSolo: () => void
  /** Toggles this slot's own resolved candidate's favourite status
   * (DiscoverPanel's own toggleStemFavourite -> the shared, persisted
   * stemFavourites set). Only shown once there's a real stem to favourite,
   * same guard as mute/solo. */
  onToggleFavourite: () => void
  /** Reports this row's own effective resolved stem (or null) up to
   * DiscoverPanel every time it changes -- resolved on arrival, invalidated
   * on reroll, cleared on unmount/removal -- so the parent's
   * resolvedStemsRef and any currently-playing mix this slot is part of
   * stay in sync with what's actually showing on screen, rather than
   * DiscoverPanel needing to re-resolve candidates itself. */
  onResolvedChange: (stem: ResolvedCandidateStem | null) => void
  /** DiscoverPanel's own swapSlotFromNearby -- called when the user picks a
   * candidate from this slot's own "explore nearby" popover. Same instant,
   * undoable swap as a normal reroll landing; see swapSlotFromNearby's own
   * doc comment in DiscoverPanel. */
  onSwapFromNearby: (candidate: DiscoverCandidate) => void
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

  // A seeded slot (see DiscoverSlot's own seedStem doc comment) is already
  // resolved -- there is nothing to fetch, so this is derived at render time
  // rather than pushed into `resolved` via setState in the effect above
  // (same react-hooks/set-state-in-effect reasoning as the comment above the
  // effect: avoid a synchronous setState in an effect body when the value
  // can just be computed directly instead). `candidate: slot.candidate` here
  // is always `null` for a seeded slot (seedStem and candidate are mutually
  // exclusive -- see rollForSlot/rollRandomForSlot's own seedStem-clearing
  // below), which is also why the effect above never needs its own
  // seedStem branch: `!slot.candidate` already short-circuits it whenever
  // this row is seeded.
  const seedResolved = slot.seedStem
    ? {
        candidate: slot.candidate,
        status: 'ready' as const,
        stem: { slot: 1, ...slot.seedStem }
      }
    : null

  const resolvedForCurrent =
    seedResolved ?? (resolved?.candidate === slot.candidate ? resolved : null)
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

  // "Explore nearby" popover state -- position (screen coords, set from the
  // trigger button's own getBoundingClientRect on open) or null when closed.
  // See DiscoverNearbyPopover.tsx.
  const [nearbyMenu, setNearbyMenu] = useState<{ x: number; y: number } | null>(null)
  const nearbyButtonRef = useRef<HTMLButtonElement>(null)

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
    <>
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
            width: 18,
            height: 18,
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
          // Direct report, 2026-09-15: the previewing-outline (a near-white
          // `--ra-stretch-on` box around the whole waveform) read as an
          // unwanted white halo -- removed; the dedicated mute button below
          // already carries this row's own on/off state, and the playhead
          // line (also below) now shows real playback directly.
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
              const rawStemBarLength =
                resolvedStem.barLength > 0 ? resolvedStem.barLength : loopBars
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
                  {/* Full-color layer on top -- suppressed entirely while
                    muted (not currently in the preview mix), same "mute
                    always wins" convention StemWaveformRow.tsx's own
                    real-arrangement waveform uses (its own `{!muted && ...}`
                    guard just above). Direct report, 2026-09-15: "when
                    muted, a waveform should be grey" -- muted rows here
                    used to still show the full-color layer (just clipped by
                    gain), reading as "playing, just quiet" rather than
                    "off," unlike every other muted waveform in this app. */}
                  {previewing && (
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
                  )}
                  {previewing && (
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
                  )}
                  {/* Real playhead, driven by the actual engine position while
                    this loop is previewing -- same `--ra-playhead` accent
                    Playhead.tsx uses on the real timeline. Only this row's
                    own resolved-and-tiled width is relevant (loopBars ===
                    maxBarLength, the shared reference every row ties its
                    tiling to), so `playheadPct` is already directly usable
                    as a left offset with no further per-row math. */}
                  {playheadPct !== null && (
                    <div
                      style={{
                        position: 'absolute',
                        top: 0,
                        bottom: 0,
                        left: `${playheadPct}%`,
                        width: 1,
                        background: 'var(--ra-playhead)',
                        pointerEvents: 'none'
                      }}
                    />
                  )}
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
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden',
              border: `1px dashed ${
                resolving
                  ? 'var(--ra-stretch-on)'
                  : resolveFailed
                    ? 'var(--ra-mute-on)'
                    : 'var(--ra-border)'
              }`,
              // Static (no animation) once settled either way (failed or
              // truly empty) -- discover-slot-pulse is still used for the
              // FAILED state, a static "this stopped" cue.
              animation: resolveFailed
                ? 'discover-slot-pulse 900ms ease-in-out infinite'
                : undefined
            }}
          >
            {/* Direct report, 2026-09-15 (v3): the previous scrolling-
              waveform reel read as too busy -- replaced with the shared
              LoadingLoader component (the same "still working" indicator
              BeatPicker.tsx/ClusterStemsBrowser.tsx already use), small
              and subtle, for brand consistency instead of a custom
              animation. */}
            {resolving && <LoadingLoader size={16} />}
          </div>
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
                : resolvedStem
                  ? resolvedStem.name
                  : slot.hasRerolled
                    ? 'no match for this role yet'
                    : 'no candidate yet'}
        </span>
        {resolvedStem && (
          <>
            {/* Direct request, 2026-09-15: "can we add a mute for each
              channel" -- toggleSlotPreview already existed (the waveform
              itself was already clickable to the same effect), but wasn't
              discoverable as a mute control -- only a hover tooltip
              explained it. Same handler as the waveform click, so either one
              keeps the other in sync; only shown once there's a real stem to
              mute (matching the waveform toggle's own guard). */}
            <button
              onClick={onTogglePreview}
              title={
                previewing ? 'playing in the loop -- click to mute' : 'muted -- click to unmute'
              }
              style={{
                marginLeft: 'auto',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 18,
                height: 18,
                padding: 0,
                fontFamily: 'inherit',
                fontSize: 10,
                fontWeight: 700,
                // Direct request, 2026-09-15: "mute should look exactly like
                // mute on the arrangement view" -- matches ChannelRow.tsx's
                // own muteButtonStyle exactly (background/border/color-by-
                // state), rather than this row's own earlier ad hoc treatment
                // (transparent-when-off instead of the real
                // `--ra-bg-row-active` fill every other unmuted mute button in
                // this app uses).
                background: previewing ? 'var(--ra-bg-row-active)' : 'var(--ra-mute-on)',
                border: `1px solid ${previewing ? 'var(--ra-border)' : 'var(--ra-mute-on)'}`,
                color: previewing ? 'var(--ra-text-2)' : 'var(--ra-mute-on-ink)',
                cursor: 'pointer'
              }}
            >
              {/* Lowercase "m" -- matches ChannelRow.tsx's own mute button
                glyph exactly (its solo/record siblings are also lowercase
                single letters), rather than this row's own earlier
                uppercase "M". */}
              m
            </button>
            {/* Direct request, 2026-09-15 (Upcycle-inspired): a solo button
              next to mute, same M/S pairing Upcycle's own cards use and
              ChannelRow.tsx already has on the real arrangement. Matches
              ChannelRow.tsx's own soloButtonStyle exactly (a soft tinted
              background with the accent color on border/text, not a hard
              fill like mute's). */}
            <button
              onClick={onToggleSolo}
              title={soloed ? 'soloed -- click to hear everything again' : 'solo this slot'}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 18,
                height: 18,
                padding: 0,
                fontFamily: 'inherit',
                fontSize: 10,
                fontWeight: 700,
                background: soloed ? 'var(--ra-stretch-on-bg)' : 'var(--ra-bg-row-active)',
                border: `1px solid ${soloed ? 'var(--ra-stretch-on)' : 'var(--ra-border)'}`,
                color: soloed ? 'var(--ra-stretch-on)' : 'var(--ra-text-2)',
                cursor: 'pointer'
              }}
            >
              s
            </button>
            {/* Direct request, 2026-09-16: star a stem to favourite it, then
              optionally bias future rolls toward favourites (the panel's
              own "prefer favourites" toolbar checkbox). Reuses
              `--ra-recording-live` for the filled/active state -- the same
              token RiffCircle.tsx already uses for its own "favourited"
              semantic, just applied to a literal star glyph here instead
              of a circle fill. */}
            <button
              onClick={onToggleFavourite}
              title={favourited ? 'favourited -- click to unfavourite' : 'favourite this stem'}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 18,
                height: 18,
                padding: 0,
                background: 'var(--ra-bg-row-active)',
                border: `1px solid ${favourited ? 'var(--ra-recording-live)' : 'var(--ra-border)'}`,
                color: favourited ? 'var(--ra-recording-live)' : 'var(--ra-text-2)',
                cursor: 'pointer'
              }}
            >
              <StarIcon favourited={favourited} />
            </button>
            {slot.candidate !== null && (
              <button
                ref={nearbyButtonRef}
                onClick={(e) => {
                  if (nearbyMenu) {
                    setNearbyMenu(null)
                    return
                  }
                  const rect = e.currentTarget.getBoundingClientRect()
                  setNearbyMenu({ x: rect.left, y: rect.bottom + 4 })
                }}
                title="explore riffs recorded near this one in the same jam"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 18,
                  height: 18,
                  padding: 0,
                  background: nearbyMenu ? 'var(--ra-stretch-on-bg)' : 'var(--ra-bg-row-active)',
                  border: `1px solid ${nearbyMenu ? 'var(--ra-stretch-on)' : 'var(--ra-border)'}`,
                  color: nearbyMenu ? 'var(--ra-stretch-on)' : 'var(--ra-text-2)',
                  cursor: 'pointer'
                }}
              >
                <NearbyIcon />
              </button>
            )}
          </>
        )}
        <button
          onClick={onReroll}
          disabled={rerolling}
          // "roll" for a slot's first pick, "reroll" once it already has a
          // candidate -- an empty slot has never been rolled, so "rerolling"
          // was never the correct verb for it. Icon-only (direct request,
          // 2026-09-15). No "still working" animation on this button
          // (direct follow-up report, 2026-09-16, after trying both
          // LoadingLoader and an icon-jump bounce first) -- the dimmed
          // color/default cursor plus the title tooltip below are the only
          // in-flight cues now.
          title={
            rerolling
              ? slot.candidate
                ? 'rerolling…'
                : 'rolling…'
              : slot.candidate
                ? 'reroll'
                : 'roll'
          }
          style={{
            marginLeft: resolvedStem ? 0 : 'auto',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 18,
            height: 18,
            padding: 0,
            background: 'transparent',
            border: '1px solid var(--ra-border)',
            color: rerolling ? 'var(--ra-text-4)' : 'var(--ra-text-2)',
            cursor: rerolling ? 'default' : 'pointer'
          }}
        >
          <ShuffleIcon />
        </button>
        <button
          onClick={onRerollRandom}
          disabled={rerolling}
          title="random -- skip role matching, pick any random stem from your own library"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 18,
            height: 18,
            padding: 0,
            background: 'transparent',
            border: '1px solid var(--ra-border)',
            color: rerolling ? 'var(--ra-text-4)' : 'var(--ra-text-2)',
            cursor: rerolling ? 'default' : 'pointer'
          }}
        >
          <DiceIcon />
        </button>
        <button
          onClick={onRemove}
          title="remove"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 18,
            height: 18,
            padding: 0,
            fontFamily: 'inherit',
            fontSize: 10,
            fontWeight: 700,
            background: 'transparent',
            border: '1px solid var(--ra-border)',
            color: 'var(--ra-text-2)',
            cursor: 'pointer'
          }}
        >
          {/* Direct request, 2026-09-15: "an X for remove" -- icon-only, same
            as every other row button now. */}
          X
        </button>
      </div>
      {nearbyMenu && slot.candidate !== null && (
        <DiscoverNearbyPopover
          x={nearbyMenu.x}
          y={nearbyMenu.y}
          startCandidate={slot.candidate}
          role={slot.role}
          onPick={onSwapFromNearby}
          onClose={() => setNearbyMenu(null)}
          ignoreRef={nearbyButtonRef}
        />
      )}
    </>
  )
}
