// src/renderer/src/components/DiscoverPanel.tsx
import { useCallback, useEffect, useRef, useState } from 'react'
import { Waveform } from './Waveform'
import { stemColorVar } from '../theme/typeColor'
import { getAudioContext } from '../audio/peakCache'
import {
  startPreviewLoop,
  stopPreviewSources,
  registerActivePreview,
  unregisterActivePreview
} from '../audio/previewLoop'
import { ARRANGE_ROLE_OPTIONS, type ArrangeRole } from '@shared/stemRole'
import { instrumentMaskToSoundType } from '@shared/riffLibraryTypes'
import { guessSoundTypeFromPresetName } from '@shared/presetNames'
import { rankCandidates, pickReroll } from '@shared/discoverRanking'
import { useAppSelector, useDispatch, usePlaying } from '../state/StoreContext'
import type { ProjectRef, Rifff, SoundType, Stem } from '@shared/types'
import type { DiscoverCandidate } from '../../../main/discoverCandidates'

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
async function resolveCandidateStem(candidate: DiscoverCandidate): Promise<{
  author: string
  name: string
  type: SoundType
  path: string
  durationSec: number
  barLength: number
} | null> {
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
  const resolvedStemsRef = useRef<Map<string, { path: string; durationSec: number }>>(new Map())
  const previewSourcesRef = useRef<AudioBufferSourceNode[]>([])
  const previewGenerationRef = useRef(0)
  const previewTokenRef = useRef(0)
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
    stopPreviewSources(previewSourcesRef.current)
    previewSourcesRef.current = []
    unregisterActivePreview(previewTokenRef.current)
  }, [])

  useEffect(() => {
    return () => {
      // Bumping the generation here (not just stopping current sources) is
      // load-bearing: reportSlotResolution below can itself trigger a fresh
      // restartMix (e.g. a row's own report-up effect cleanup firing during
      // this SAME unmount pass, right as a reroll lands). Without this, that
      // straggling restartMix's async decode has no generation bump ahead
      // of it to invalidate it once it resolves -- it would still push
      // sources, .start() them, and register them as the active preview
      // with no component left alive to ever stop them again. Caught by
      // independent review, not observed directly.
      previewGenerationRef.current += 1
      stopSlotPreview()
    }
  }, [stopSlotPreview])

  const restartMix = useCallback(
    (ids: Set<string>, pauseTransportIfPlaying: boolean) => {
      previewGenerationRef.current += 1
      const generation = previewGenerationRef.current
      stopSlotPreview()
      const stems = [...ids]
        .map((id) => resolvedStemsRef.current.get(id))
        .filter((s): s is { path: string; durationSec: number } => s !== undefined)
      if (stems.length === 0) {
        setMixStartTime(null)
        return
      }
      // Same "don't let a preview and the real arranger transport play at
      // once" courtesy Shelf.tsx's own tile-click preview already gives --
      // auditioning a Discover loop while the project is mid-playback would
      // otherwise layer a second, unrelated loop on top. Only for a direct
      // user toggle, though (pauseTransportIfPlaying) -- reportSlotResolution
      // below also calls restartMix, but purely to swap a landed reroll's
      // audio into an already-playing mix, with no click of the user's own
      // to explain a sudden transport pause; gating this to the explicit
      // toggle path keeps that background swap silent on the transport.
      if (pauseTransportIfPlaying && playing) dispatch({ type: 'PAUSE' })
      void startPreviewLoop(
        getAudioContext(),
        stems,
        () => previewGenerationRef.current !== generation
      ).then((sources) => {
        if (previewGenerationRef.current !== generation) {
          stopPreviewSources(sources)
          return
        }
        previewSourcesRef.current.push(...sources)
        if (sources.length > 0) {
          previewTokenRef.current = registerActivePreview(stopSlotPreview)
          // Approximate, not sample-accurate -- good enough for a visual
          // lap indicator, off by at most the time this .then() callback
          // took to run after the sources' own .start(0) calls inside
          // startPreviewLoop (same microtask tick, no await between).
          setMixStartTime(getAudioContext().currentTime)
        }
      })
    },
    [stopSlotPreview, playing, dispatch]
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
  function reportSlotResolution(
    id: string,
    stem: { path: string; durationSec: number } | null
  ): void {
    if (stem) resolvedStemsRef.current.set(id, stem)
    else resolvedStemsRef.current.delete(id)
    if (previewingSlotIds.has(id)) restartMix(previewingSlotIds, false)
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

  function addSlot(role: ArrangeRole): void {
    setSlots((prev) => [
      ...prev,
      { id: freshSlotId(), role, locked: false, candidate: null, hasRerolled: false }
    ])
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

  async function rerollSlot(id: string): Promise<void> {
    const slot = slots.find((s) => s.id === id)
    if (!slot) return
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
      const candidates = await window.rifffApi.getDiscoverCandidates(
        slot.role,
        effectiveOnlyOwnStems,
        currentUsername
      )
      if (rerollGenerationRef.current.get(id) !== myGeneration) return
      const ranked = rankCandidates(candidates, { targetBpm: bpm })
      const picked = pickReroll(ranked, chaos)
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
      console.error(`DiscoverPanel: rerollSlot(${slot.role}) failed:`, err)
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

  // Commits whatever loop is currently built in Discover onto the real
  // timeline, as one undo step -- every slot that currently has a
  // candidate (locked or not: "plunk" commits whatever's visible right
  // now, the same loop the slot rows' own Waveform previews are already
  // showing, not a filtered subset). Each slot becomes its own fresh
  // single-stem Rifff; resolveCandidateStem (above, also used by the slot
  // rows themselves) does the real download/resolve work, since a
  // Discover candidate isn't necessarily cached locally yet. It never
  // throws/rejects -- only ever resolves to null on failure -- so a plain
  // Promise.all here already gives the same "one bad stem doesn't block
  // the others" resilience useStemFeatureScan.ts gets from
  // Promise.allSettled, without needing that API.
  async function plunkInArranger(): Promise<void> {
    setPlacing(true)
    try {
      const placeable = slots.filter(
        (s): s is DiscoverSlot & { candidate: DiscoverCandidate } => s.candidate !== null
      )
      if (placeable.length === 0) return

      const resolvedStems = await Promise.all(
        placeable.map(async ({ candidate, role }): Promise<Rifff | null> => {
          const stem = await resolveCandidateStem(candidate)
          if (!stem) return null
          return {
            // crypto.randomUUID(), matching buildRifff.ts's own established
            // convention for minting a brand-new rifff's groupId -- NOT
            // deterministic from candidate content. A second "plunk in
            // arranger" click with the same slots still showing (nothing
            // clears `slots` after a successful plunk, so re-plunking the
            // same loop further along the timeline is normal usage) must
            // mint fresh groupIds, since PLACE_LOOP_ON_TIMELINE's reducer
            // case writes `rifffs[rifff.groupId] = {...}` -- a deterministic
            // id recomputed from the same candidates would silently
            // overwrite (relocate) the first placement instead of adding a
            // second copy alongside it, contradicting this feature's own
            // "adds alongside, never replaces" guarantee (design spec §8.4).
            groupId: crypto.randomUUID(),
            name: `discover: ${role}`,
            bpm: candidate.riffBpm,
            barLength: stem.barLength,
            folderPath: '',
            stems: [{ slot: 1, ...stem }]
          }
        })
      )
      const rifffs = resolvedStems.filter((r): r is Rifff => r !== null)
      if (rifffs.length === 0) return

      // Appends after the furthest-right currently-placed clip, matching
      // "adds alongside, never replaces" from the design spec's own §8.4 --
      // never touches an existing rifff's own startBar.
      const placedEnds = Object.values(rifffsState)
        .filter((r) => r.startBar !== undefined)
        .map((r) => (r.startBar ?? 0) + r.barLength)
      const startBar = placedEnds.length > 0 ? Math.max(...placedEnds) : 0

      dispatch({ type: 'PLACE_LOOP_ON_TIMELINE', stems: rifffs, startBar })
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
          already uses. A rotating dashed RING made sense while this
          placeholder matched PolarGlyph's own circular footprint; now that
          it matches the linear Waveform's rectangular one (this session's
          own radial-to-linear swap), an opacity pulse reads as "in
          progress" without the visual oddity of a rotating rectangle. */}
      <style>{`
        @keyframes discover-slot-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.35; }
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

      {slots.map((slot) => (
        <DiscoverSlotRow
          key={slot.id}
          slot={slot}
          rerolling={rerollingSlotIds.has(slot.id)}
          previewing={previewingSlotIds.has(slot.id)}
          mixStartTime={mixStartTime}
          onToggleLock={() => toggleLock(slot.id)}
          onRemove={() => removeSlot(slot.id)}
          onReroll={() => void rerollSlot(slot.id)}
          onTogglePreview={() => toggleSlotPreview(slot.id)}
          onResolvedChange={(stem) => reportSlotResolution(slot.id, stem)}
        />
      ))}

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

function DiscoverSlotRow({
  slot,
  rerolling,
  previewing,
  mixStartTime,
  onToggleLock,
  onRemove,
  onReroll,
  onTogglePreview,
  onResolvedChange
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
  onToggleLock: () => void
  onRemove: () => void
  onReroll: () => void
  /** Toggles whether THIS slot is included in DiscoverPanel's own shared
   * playing mix -- the row itself doesn't own any audio state, it only
   * asks the parent to flip its own membership (see DiscoverPanel's own
   * toggleSlotPreview). The button that triggers this is entirely absent
   * (not merely disabled) until resolvedStem exists -- nothing to add to
   * the mix before then. */
  onTogglePreview: () => void
  /** Reports this row's own effective resolved stem (or null) up to
   * DiscoverPanel every time it changes -- resolved on arrival, invalidated
   * on reroll, cleared on unmount/removal -- so the parent's
   * resolvedStemsRef and any currently-playing mix this slot is part of
   * stay in sync with what's actually showing on screen, rather than
   * DiscoverPanel needing to re-resolve candidates itself. */
  onResolvedChange: (stem: { path: string; durationSec: number } | null) => void
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
          fontFamily: 'inherit',
          fontSize: 9,
          padding: '3px 6px',
          background: slot.locked ? 'var(--ra-stretch-on-bg)' : 'transparent',
          border: `1px solid ${slot.locked ? 'var(--ra-stretch-on)' : 'var(--ra-border)'}`,
          color: slot.locked ? 'var(--ra-stretch-on)' : 'var(--ra-text-2)',
          cursor: 'pointer'
        }}
      >
        {slot.locked ? 'locked' : 'unlocked'}
      </button>
      <span style={{ fontSize: 9, color: 'var(--ra-text-3)', width: 64 }}>{slot.role}</span>
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
          title={
            previewing
              ? 'playing in the loop -- click to remove'
              : 'click to add to the loop preview'
          }
          style={{
            position: 'relative',
            width: 56,
            height: 28,
            flexShrink: 0,
            padding: 0,
            background: 'transparent',
            border: 'none',
            outline: previewing ? '1px solid var(--ra-stretch-on)' : 'none',
            outlineOffset: -1,
            cursor: 'pointer'
          }}
        >
          <Waveform path={resolvedStem.path} color={stemColorVar(resolvedStem)} opacity={1} />
          {sweepFraction !== null && (
            <div
              style={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                left: `${sweepFraction * 100}%`,
                width: 1,
                background: 'var(--ra-playhead)',
                pointerEvents: 'none'
              }}
            />
          )}
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
            width: 56,
            height: 28,
            flexShrink: 0,
            border: `1px dashed ${
              resolving
                ? 'var(--ra-stretch-on)'
                : resolveFailed
                  ? 'var(--ra-mute-on)'
                  : 'var(--ra-border)'
            }`,
            animation: resolving ? 'discover-slot-pulse 900ms ease-in-out infinite' : undefined
          }}
        />
      )}
      <span style={{ fontSize: 9, color: resolveFailed ? 'var(--ra-mute-on)' : 'var(--ra-text)' }}>
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
      <button
        onClick={onReroll}
        disabled={rerolling}
        style={{
          marginLeft: 'auto',
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
