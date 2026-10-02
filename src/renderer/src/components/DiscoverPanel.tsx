// src/renderer/src/components/DiscoverPanel.tsx
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Compass, Copy, Shuffle, SkipForward, ThumbsDown, ThumbsUp } from '@phosphor-icons/react'
import { RepeatedWaveform } from './RepeatedWaveform'
import { LoopLines } from './LoopLines'
import { LoadingLoader } from './LoadingLoader'
import { DiscoverNearbyPopover } from './DiscoverNearbyPopover'
import { Dial } from './Dial'
import { DiscoverKindPicker } from './DiscoverKindPicker'
import { DiscoverRadioMenu } from './DiscoverRadioMenu'
import { DiscoverReclassifyPicker } from './DiscoverReclassifyPicker'
import { ROLE_LABELS } from '@shared/autoArrangeLabels'
import { BracketToggle } from './BracketToggle'
import { stemColorVar } from '../theme/typeColor'
import { resolveStretchedForPlayback } from '../audio/resolveStretchedForPlayback'
import { warmEngineBuffer } from '../audio/warmEngineBuffer'
import { getPeaks, peekPeaks } from '../audio/peakCache'
import { assembleDiscoverRifff, type DiscoverRifffAssembly } from '../audio/discoverRifffAssembly'
import {
  DISCOVER_SLOT_KIND_LABEL,
  DISCOVER_SLOT_KIND_OPTIONS,
  DISCOVER_TRAIT_SLOT_KINDS,
  discoverSlotKindToArrangeRole,
  isTraitSlotKind,
  normalizeSlotKinds,
  slotKindsKey,
  slotKindsLabel,
  toggleSlotKind,
  type DiscoverSlotKind
} from '@shared/discoverSlotKind'
import {
  DISCOVER_SLOT_MODIFIER_LABEL,
  DISCOVER_SLOT_MODIFIER_OPTIONS,
  DEFAULT_SOURCE_LEAN,
  drawSoundSource,
  slotRollOptions,
  soundSourceForLean,
  toggleSlotModifier,
  type DiscoverSlotModifier
} from '@shared/discoverSlotModifier'
import { instrumentMaskToSoundType } from '@shared/riffLibraryTypes'
import {
  drawManualTransitions,
  mergeStageChanges,
  radioGestureBeats,
  type ManualArrival
} from '@shared/radioManualChanges'
import { guessSoundTypeFromPresetName } from '@shared/presetNames'
import { stemsToAvoid } from '@shared/discoverPickAvoid'
import {
  DENSITY_MIN,
  advanceDensityLeg,
  densityArrival,
  newDensityLeg,
  nextArcKind,
  pickArcRemoval,
  type DensityLeg
} from '@shared/radioDensity'
import { DEFAULT_DISCOVER_CHAOS, rankCandidates, pickReroll } from '@shared/discoverRanking'
import { pickAdjacentCandidate } from '@shared/discoverAdjacentPick'
import { heartFetchLabel } from '@shared/radioHearts'
import { manualChangesUndoneBy, UndoSnapshotSequence } from '@shared/discoverUndoWithdraw'
import { applyTraitBar } from '@shared/traitBar'
import {
  RADIO_PACE_BARS,
  advanceRadioClock,
  radioBarsUntilChange,
  radioChangeDueAtNextWrap,
  radioChangeLandsAtBar,
  createRadioClock,
  isRadioEligibleSlot,
  nextRadioIntervalBarsInWindow,
  pickRadioSlotId,
  radioChangeBars,
  radioGridBars,
  radioDensityOf,
  radioStarterKinds,
  restartRadioInterval,
  type RadioClock,
  type RadioPace,
  type RadioSettings
} from '@shared/radioSchedule'
import {
  NO_RADIO_SLOT_FLAGS,
  forgetRadioSlotFlagOnChange,
  likeRadioSlot,
  pruneRadioSlotFlags,
  radioSlotFlagOf,
  toggleRadioReplaceSoon,
  type RadioSlotFlag,
  type RadioSlotFlags
} from '@shared/radioSlotFlags'
import { buildDropOutCurve, pickDropOutBeats, rollIntervalDropOut } from '@shared/radioDropOut'
import {
  buildBloomCurve,
  buildDuckCurve,
  buildFilterInCurve,
  buildTransitionRiser,
  pickTransition,
  radioArrivalGestureSpent,
  radioChangeWaitsForLoopTop,
  radioGestureLeadsChange,
  type RadioTransitionKind
} from '@shared/radioTransition'
import {
  radioApproachFor,
  radioApproachProgress,
  type RadioApproach,
  type RadioApproachWait
} from '@shared/radioApproach'
import {
  buildMatchMeter,
  discoverRoleLabel,
  reclassifyKindSources,
  MATCH_METER_STEPS
} from '@shared/discoverMatchMeter'
import type { ArrangeRole } from '@shared/stemRole'
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
import { resolvedPlayedBarsFromFields } from '../state/selectors'
import { discoverSweepPct, discoverWindowLayout } from '@shared/discoverWindowLayout'
import { discoverBreath } from '@shared/discoverBreath'
import {
  artistFieldLabel,
  artistMode,
  artistNotice,
  artistTurnoverIds,
  blockedActions,
  isKeepRefused,
  lingeringArtists,
  lingeringNotice,
  listenOnlyTooltip,
  nextTurnoverSlotId,
  normalizeArtistPick,
  pickMatchesSelection,
  rollFilterForArtist,
  tagPickedUnderArtist,
  type ArtistRollFilter,
  type ListenOnlyAction
} from '@shared/discoverArtist'
import { DiscoverArtistPicker } from './DiscoverArtistPicker'
import { announceArtistScanQueued } from '../audio/artistScanQueueEvent'
import { recordStemRoles } from '../state/stemCategoryCapture'
import type { CoachSlotSnapshot } from '@shared/coachClimax'
import {
  remoteStateFromSlots,
  type RemoteCommand,
  type RemoteKeepOutcome,
  type RemoteRadioView,
  type RemoteSlotAction
} from '@shared/remoteState'
import { startPointerDrag } from './dragUtils'
import { type ProjectRef, type SoundType, type Stem, stemKey } from '@shared/types'
import type { DiscoverCandidate } from '../../../main/discoverCandidates'
import { buildEngineProject } from '@shared/buildEngineProject'
import { discoverStemPans } from '@shared/radioPan'
import { normalizeSoundSettings } from '@shared/radioSound'
import { backgroundScanGate } from '../audio/backgroundScanGate'
// TEMPORARY INSTRUMENTATION (2026-09-28) -- remove this import and every
// radioTrace* call below together with src/renderer/src/perf/radioTrace.ts.
import {
  radioTraceBegin,
  radioTraceMark,
  radioTraceMarkPush,
  radioTraceStageApplied,
  radioTraceStageFallback,
  radioTraceStageGate,
  radioTraceStageResult,
  radioTraceStageSent,
  radioTraceTick
} from '../perf/radioTrace'
import { initialState, type AppState } from '../state/store'
import { appSoundDefaultsNow } from '../state/appSoundDefaults'
import {
  neutralCutoff,
  type AutomationPoint,
  type FilterMode,
  type StemAutomation,
  type StemFilterSettings
} from '@shared/toolkit'
import type { RiserClip } from '@shared/riser'
import { masterScaledCurve, masterScaledGains, masterSendsFor } from '@shared/performanceDeck'
import { MASTER_LIVE_PARAM_KEY } from '@shared/liveParam'
import { scheduleLiveParamSync } from './liveParamSync'

export interface ResolvedCandidateStem {
  author: string
  name: string
  type: SoundType
  path: string
  durationSec: number
  barLength: number
  /** The owning riff's own creation time (RiffLibraryResolvedRiff.
   * creationTime, Unix seconds) -- see @shared/types's Stem.creationTime
   * doc comment. Undefined only if the resolved riff itself predates this
   * field (the live Endlesss API path). */
  creationTime?: number
}

// Speed: DiscoverSlotRow's own preview resolve effect and resolveDiscoverRifff
// (called from both addToTimeline and addToShelf) both call resolveCandidateStem
// for the SAME candidate -- a row resolves it once already just to show its
// waveform, then resolveDiscoverRifff re-resolves the identical riffCID/stemCID
// from scratch (a real IPC round trip PLUS, often, the exact download
// riffLibraryDownloadMissingStems just did moments earlier). Cached by promise
// (not just by settled result), same "cache the in-flight promise itself"
// convention peakCache.ts already established -- this also dedupes two
// callers that happen to ask for the same candidate concurrently (row
// preview + a fast add-to-timeline/add-to-shelf click) into one
// real request instead of two. Evicted on a null (failed) result, same
// "don't let a transient failure permanently poison the cache" reasoning
// peakCache.ts's own eviction-on-rejection uses -- resolveCandidateStem
// itself never throws (see its own doc comment), so eviction keys off a
// null return here instead of a caught rejection.
const resolvedCandidateCache = new Map<string, Promise<ResolvedCandidateStem | null>>()
/** The SETTLED half of resolvedCandidateCache, readable without an await.
 *
 * A promise can only be read a microtask later, so a row whose candidate
 * had been resolved a whole interval ago (radio's armRadioPick warms it)
 * still drew its "resolving" placeholder for the first render after the
 * commit, and the new waveform arrived one resolve later -- 20 to 150ms
 * behind a swap the engine had already made on the beat. Same keys, same
 * lifetime: written when the promise settles non-null, dropped with it. */
const settledCandidateStems = new Map<string, ResolvedCandidateStem>()

function peekResolvedCandidateStem(candidate: DiscoverCandidate): ResolvedCandidateStem | null {
  return settledCandidateStems.get(`${candidate.riffCID}:${candidate.stemCID}`) ?? null
}

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
        barLength: stem.barLength,
        creationTime: resolved.creationTime
      }
    } catch (err) {
      console.error('resolveCandidateStem: failed to resolve candidate', candidate.riffCID, err)
      return null
    }
  })()

  resolvedCandidateCache.set(key, promise)
  void promise.then((result) => {
    if (result === null) resolvedCandidateCache.delete(key)
    else settledCandidateStems.set(key, result)
  })
  return promise
}

export interface DiscoverSlot {
  id: string
  /** Combination slots, 2026-09-21: the normalized set of kinds this slot
   * targets (normalizeSlotKinds) -- never empty. A one-click "+ drums" slot
   * is ['drums']. Editable after creation via the kind picker. */
  kinds: DiscoverSlotKind[]
  locked: boolean
  candidate: DiscoverCandidate | null
  /** Match meter (docs/superpowers/specs/2026-09-22-discover-promise-vs-
   * delivery-design.md, Phase 2): the trait bar applyTraitBar actually used
   * when rollForSlot picked `candidate`, so the meter can say when a pick
   * was relaxed. Set in the same setSlots call as `candidate` on every
   * roll. Paired with that exact candidate OBJECT -- any other path that
   * swaps the candidate (nearby, random, seeding, duplicate-then-reroll)
   * just leaves a stale pair, which DiscoverSlotRow ignores by identity
   * rather than every candidate setter having to remember to clear it. */
  pickBar?: { candidate: DiscoverCandidate; barUsed: number | null; barRequested: number }
  /** A reclassify from this slot's match meter (the user confirmed the
   * stem's role from Discover), paired with the candidate it applied to --
   * same identity rule as pickBar. Kept OFF the candidate object itself on
   * purpose: a new candidate object would re-run DiscoverSlotRow's own
   * resolution effect ([slot.candidate]) for the same stem. The meter
   * derives the updated kindSources from this (reclassifyKindSources). */
  reclassified?: { candidate: DiscoverCandidate; role: ArrangeRole }
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
   * really nothing compatible for this kind." Only the reroll call whose
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
  /** Radio laid this row down (the bed on an empty panel) or the density
   * arc added it -- the only rows the arc may remove. A duplicate of one is
   * his, not radio's. */
  radioAdded?: boolean
}

/** What a roll RESOLVED TO, before anything is written to state. Split out
 * of rollForSlot (2026-09-26, radio mode) so radio can choose a candidate a
 * whole interval before it commits it -- picking early is what lets it
 * pre-warm resolveCandidateStem's own module-level cache and then swap the
 * layer in on a loop boundary without a download happening under the
 * downbeat. See docs/superpowers/specs/2026-09-26-radio-mode-design.md. */
interface SlotPick {
  candidate: DiscoverCandidate | null
  barUsed: number | null
  barRequested: number
  /** Not from a ranked roll: an "any stem" draw, a nearby pick, or a
   * duplicate's copied candidate. commitSlotPick then leaves the slot's
   * match-meter fields (pickBar, reclassified) exactly as they are, as
   * those paths' own direct writes always have -- a pickBar paired with a
   * candidate that never had percentiles computed would draw empty trait
   * bars and misreport it as unanalysed (see meterEntries). */
  unranked?: true
}

// Real bug, live-reported 2026-09-17: "i clicked 'lock' on a set of
// five, then tried to add another drum track, but it simultaneously
// changed stem 1 as well as added a new track, and both stems were
// identical" (reproduced a second time against slot 2 instead of slot
// 1). Root cause: this used to be a bare module-level counter
// (`let nextSlotId = 0`, incremented on every call) -- fine as long as
// the module is only ever evaluated once, but Vite's Fast Refresh
// doesn't preserve component state across an edit to this file (this
// function's own eslint-disable below is itself a sign HMR treats this
// export specially) and re-runs `let nextSlotId = 0` on every hot
// reload -- resetting the counter to 0 while React's own `slots` array
// state (owned by the component tree, not this module) survives the
// same reload with slot-1/slot-2/etc. already in it. The next addSlot()
// after any reload then mints an ALREADY-IN-USE id, giving two slot
// objects the same React key -- which index collides just depends on
// how many addSlot() calls happened since the last reload, explaining
// why it hit slot-1 once and slot-2 the next time. crypto.randomUUID()
// (already this app's own convention for every other generated id --
// groupId, channelId, etc.) has no module-level mutable state at all,
// so no reload of any kind can ever repeat one.
// eslint-disable-next-line react-refresh/only-export-components -- shared helper, not a component
export function freshSlotId(): string {
  return `slot-${crypto.randomUUID()}`
}

// The global roll filters' starting state -- see globalModifiers.
const DEFAULT_GLOBAL_MODIFIERS: DiscoverSlotModifier[] = ['mine']

// What radio lays down when it is started on an empty panel -- four,
// because it is the smallest set that sounds like a band rather than like
// a loop. Deliberately not random: a predictable starting bed is easier to
// reason about than a surprising one, and every layer is one click from
// being changed anyway. See docs/superpowers/specs/2026-09-26-radio-mode-
// design.md 3.6.

// Picks one of `options` uniformly at random, for the "+ random"
// slot-creation button (addRandomSlot below). Deliberately NOT
// Math.random() -- this file avoids that specific global inside any
// component-scoped function (see rerollAll's own doc comment on why: it
// trips this codebase's react-hooks purity lint rule) -- so this lives at
// module scope, like freshSlotId above, and uses the Web Crypto API
// instead, the same non-Math.random() convention freshSlotId itself
// already established.
/** How long a row the density arc removes takes to leave: a drop-out over
 * its last two bars (clamped to half the loop by the curve). */
const ARC_EXIT_BEATS = 8

function randomDiscoverSlotKind(options: readonly DiscoverSlotKind[]): DiscoverSlotKind {
  const index = crypto.getRandomValues(new Uint32Array(1))[0] % options.length
  return options[index]
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

/** One gesture as radioGestureRef holds it. */
interface RadioGesture {
  kind: 'drop-out' | RadioTransitionKind
  slotId: string
  beats: number
  lapsLeft: number
  /** For a `duck` armed at a landing: every row that landed at that wrap,
   * none of which it dips -- the live twin of a stage's `changes`. Unset
   * means just `slotId`, which is all radio alone ever lands. */
  spares?: string[]
}

/** One scheduled swap, as buildAndPushPreview needs to see it.
 *
 * `changes` are the substitutions: build the project with EACH stem in its
 * slot instead of whatever is resolved there now. `gestures` are the
 * curves the staged project carries, which are arrival gestures or
 * nothing -- never whatever is armed for the lap that is playing.
 *
 * `atBars` is WHICH boundary the engine should land this on: the bar of
 * the current lap, or undefined for the loop top. Only radio's bare cuts
 * ever name a bar -- see radioChangeLandsAtBar.
 *
 * `label`/`atPos`/`loopBars` are only for the radioTrace line. They are
 * passed in rather than read at send time because by then the build has
 * taken a few milliseconds and the position has moved, and the number
 * worth printing is where in the lap the decision was made. */
interface RadioStageRequest {
  token: number
  /** Every row whose stem changes at this wrap -- radio's own held change
   * and, from Task 3 of the 2026-09-29 manual-changes plan, every manual
   * one. See mergeStageChanges. */
  changes: { slotId: string; stem: ResolvedCandidateStem }[]
  /** Rows not in the live mix yet (added or duplicated while radio ran),
   * joined into the staged member list. */
  joining: string[]
  /** Arrival curves for the project this stage BECOMES -- one per changing
   * row that drew one. Never a leading gesture: that belongs to the lap
   * before the swap and rides the live project (radioGestureRef). */
  gestures: RadioGesture[]
  atBars?: number
  label: string
  atPos: number
  loopBars: number
}

// How close to the wrap a manual change that has just become ready may still
// withdraw the stage that is out, to be re-staged together with it. The
// rebuild is a tick (~33ms) plus a warm build and one IPC, tens of
// milliseconds -- a bar is ~1.8s at the ~130bpm of the 2026-09-29 logs, so
// this is a wide margin on purpose. Closer than this, withdrawing risks the
// stage never getting back out, and then EVERY change in it lands the old,
// late way instead of just the one that was late: it waits for the next
// wrap instead.
const MANUAL_RESTAGE_MIN_BARS = 1

// Backstop for runAfterEngineSync (below): how long a deferred radio arm
// waits for a landing change's own engine push before giving up and arming
// anyway. A committed change whose stem never resolves schedules no sync at
// all, and a pick that is simply never armed makes radio SKIP a change
// outright -- a worse symptom than the late one this whole deferral exists
// to fix. Comfortably under the shortest interval radio can draw (3 bars at
// the "fast" pace, ~6s at 120bpm -- RADIO_PACE_BARS), and comfortably over
// the warm build+send chain it normally waits on (tens of ms).
const AFTER_ENGINE_SYNC_TIMEOUT_MS = 1500

// Backstop for the sync hold (holdSyncUntilResolved, below): how long
// every engine push waits for a just-committed pick to actually resolve
// before going out without it. A commit whose stem never resolves at all
// (a resolve that throws, or -- vanishingly unlikely -- a pick of the
// stem the slot already had, which fires no resolve effect) must not
// wedge the preview: a parked gesture curve arriving a beat late is a
// missed move, a gesture curve that NEVER arrives is a stuck panel.
// Deliberately under AFTER_ENGINE_SYNC_TIMEOUT_MS, so that on the day
// both backstops fire the parked push still goes out before the radio arm
// that is waiting on it gives up -- the same ordering the fast path has.
const SYNC_HOLD_TIMEOUT_MS = 1200

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
  artist,
  onArtistChange,
  discoverConsented,
  traitMatchBar,
  radioSettings,
  onRadioSettingsChange,
  setDiscoverConsented,
  seedBpm,
  onCoachSlotsChange
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
  /** Discover artist mode (2026-10-01): null = me. App.tsx state. */
  artist: string | null
  onArtistChange: (artist: string | null) => void
  /** App.tsx's Frame() own single source of truth for Discover's
   * whole-library-scan consent, threaded down through LibraryBrowser.tsx
   * -- the real scan itself (DiscoverLibraryScan) is mounted once at that
   * same top level, gated on this same value, NOT mounted here anymore
   * (this component unmounts/remounts on every 'browse' <-> 'discover'
   * tab switch, which used to restart the scan's throttled batch loop
   * from its own beginning every time). Read here only to decide whether
   * to show the one-time consent prompt below. */
  discoverConsented: boolean
  /** Settings' "trait match" bar -- how strict trait kinds are
   * (applyTraitBar's `bar`). */
  traitMatchBar: number
  /** Everything the radio menu sets (DiscoverSettings.radio), and its
   * persisting patch setter. See docs/superpowers/specs/2026-09-28-radio-
   * controls-design.md. */
  radioSettings: RadioSettings
  onRadioSettingsChange: (patch: Partial<RadioSettings>) => Promise<void>
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
  /** The kinds sssketchy's current step pre-arms in the add row -- "each
   * step pre-arms the matching kinds in Discover's add row" (spec, phase 1
   * step 3). Declarative on purpose: this panel unmounts on every
   * browse<->discover tab switch, so an imperative arm would be lost every
   * time the user looked at the library. null when no flow is running, or
   * when the current step arms nothing. Must be referentially stable per
   * kind set (App.tsx memoizes it) -- see the effect below. */
  /** Publishes what the guided flow is allowed to know about the slots.
   * This panel is the only place that knows whether a slot has really
   * RESOLVED, whether it is audible, and whether it is mid-roll, so
   * "a step completes when a slot with those kinds resolves" can only be
   * answered from here. Must be referentially stable (useCallback). */
  onCoachSlotsChange?: (slots: CoachSlotSnapshot[]) => void
}): React.JSX.Element {
  // Synchronously-current mirror of the `slots` prop -- same reason
  // previewingSlotIdsRef exists (see its own comment below): rerollAll is a
  // long-running async loop (one IPC round trip per slot, sequential) whose
  // closure over `slots` is fixed to whatever this render's prop value was
  // when the loop started. Combination slots (2026-09-21) let the kind
  // picker (changeSlotKinds) edit a slot's own kinds WHILE a "reroll all"
  // is still mid-flight for an earlier slot -- without this ref, a later
  // iteration would reroll with the STALE kinds/locked flag captured at the
  // loop's start, and a slot removed mid-batch would still get rolled
  // (setSlots' own `s.id === id ? ... : s` map is a no-op for a missing id,
  // but the IPC round trip and its "picked a candidate" state update still
  // happen pointlessly). Written only from an effect below, never during
  // render, matching this file's own established ref-mirroring convention.
  const slotsRef = useRef<DiscoverSlot[]>(slots)
  useEffect(() => {
    slotsRef.current = slots
  }, [slots])

  const dispatch = useDispatch()
  const playing = usePlaying()
  // Real, live engine playback position (bars) -- while a Discover preview
  // is loaded, this IS the preview loop's own position (Transport.cpp wraps
  // it against the loaded project's own loopLengthBars, which equals the
  // preview rifff's own barLength, see syncPreviewToEngine below), not the
  // real arrangement's. Used below to draw a real moving playhead line
  // across the rows' waveforms (one line over every row since 2026-09-30,
  // see sweepLineRef) -- direct report, 2026-09-15: "i don't see the
  // playhead line" after the Web Audio -> native engine preview rewrite
  // removed the old sweepFraction-based one along with the rest of that
  // state machine (its own replacement was explicitly deferred as
  // follow-up work in the design spec's Non-Goals, but a plain "where is
  // the loop right now" line is simple enough to restore immediately using
  // the real position the engine now already reports).
  const pos = usePos()
  const rifffsState = useAppSelector((s) => s.rifffs)
  // Real bug, live-reported 2026-09-17 ("two sections were playing at the
  // same time... i had extended the original loop for the 16 one"):
  // addToTimeline's own "append after the furthest-right clip" math (below)
  // used to compute each clip's own end as `startBar + barLength` --
  // ignoring a resize override (SET_PLAYED_BARS, store.ts), which is what
  // resizing a placed clip's own right edge actually writes, and what both
  // the arranger's own rendered clip width (clipGeometryFromFields,
  // selectors.ts) and the real engine's own tiling bound
  // (buildEngineProject.ts's resolvePlayedBars call) already use. Extend a
  // clip's loop past its own barLength, then "add to timeline" again, and
  // the new clip landed using the OLD, un-extended length -- appearing to
  // append cleanly in the state model, but genuinely overlapping the
  // extended clip's own real (longer) played range, on separate channels,
  // both audible at once. resolvedPlayedBarsFromFields (selectors.ts) is
  // the same played-bars-override-or-barLength-fallback logic
  // resolvePlayedBars uses, factored to take the two fields directly
  // rather than a full AppState -- this component only has the `rifffs`
  // slice (just above) and this narrower playedBars slice, not the whole
  // state, so the fields-based helper is the right fit here.
  const playedBarsState = useAppSelector((s) => s.playedBars)
  const bpm = useAppSelector((s) => s.bpm)

  // Same reason, for the same caller: armRadioPick warms a stem's stretch
  // a whole interval before it is needed, and the stretch cache is keyed
  // on (path, ratio). A stale bpm there would compute a ratio nobody asks
  // for later, warm the wrong file, and leave the real render to happen at
  // commit time -- which is the exact bug the prefetch exists to fix,
  // reintroduced silently.
  const bpmRef = useRef<number>(bpm)
  useEffect(() => {
    bpmRef.current = bpm
  }, [bpm])
  // Purely cosmetic (a border highlight while an external file is
  // dragged over the panel, see handleExternalFileDrop's own doc
  // comment below) -- never read by anything else.
  const [isDraggingOverExternalFile, setIsDraggingOverExternalFile] = useState(false)
  const masterChain = useAppSelector((s) => s.masterChain)
  const channelPlugins = useAppSelector((s) => s.channelPlugins)
  // Copied into the preview so an audition hears the room the project
  // is actually tuned to, not DEFAULT_REVERB -- and so the master reverb
  // send below feeds that same room. See syncPreviewToEngine's own doc
  // comment for what else crosses over and what does not.
  const reverb = useAppSelector((s) => s.reverb)
  // The project's sound settings (native radio sound plan, Task 2), copied
  // the same way: Discover plays with the open project's mastering, room,
  // pump and the rest, and a stage switched off there is off here too.
  const sound = useAppSelector((s) => s.sound)
  const pluginCatalog = usePluginCatalog()
  const flushEngineSyncNow = useFlushEngineSyncNow()
  const {
    claim: claimEngine,
    stillOwn: stillOwnEngine,
    release: releaseEngine
  } = useEngineOwnership()
  const hasUsername = currentUsername.trim() !== ''
  // Direct request, 2026-09-22: the roll filters (prefer faves, my sounds;
  // the endlesss/other pair became the source dial on 2026-09-29) are
  // GLOBAL sticky [x] toggles in their own row under the add row -- after a
  // same-day stint as per-slot modifiers. Every roll and reroll of every
  // slot reads the current set, so toggling one affects all future rolls.
  // In-memory only, like the pre-modifier globals were. 'my sounds' is shown unchecked and
  // disabled -- and slotRollOptions ignores it -- while no username is set.
  const [globalModifiers, setGlobalModifiers] =
    useState<DiscoverSlotModifier[]>(DEFAULT_GLOBAL_MODIFIERS)
  const globalRollOptions = slotRollOptions(globalModifiers, { hasUsername })
  // Artist mode. Mirrored into a ref for the same reason sourceLeanRef is:
  // radio's picks run from long-lived callbacks. Written from an effect,
  // this file's ref-mirroring convention, and synchronously by
  // changeArtist so a pick is in force before the next render lands.
  const artistRef = useRef<string | null>(artist)
  useEffect(() => {
    artistRef.current = artist
  }, [artist])
  const mode = artistMode(artist, currentUsername)
  /** The creator filter as of this render, for children (the nearby
   * popover); rolls read rollFilter() instead, which follows the ref. */
  const artistCreator = rollFilterForArtist(artist, currentUsername, false).artist
  // Listen-only (spec §2): the one list the buttons dim by and main refuses.
  /** The same set as `listenOnly` below, as of NOW (artistRef, slotsRef),
   * for the functions themselves: the phone's keep and long-lived callbacks
   * call them too, and a pick must be in force before the render that dims
   * the buttons -- otherwise an other->own (or own->other) switch has a
   * window where main's mirror and this panel disagree. */
  function refusesNow(action: ListenOnlyAction): boolean {
    const nowMode = artistMode(artistRef.current, currentUsername)
    const still = nowMode === 'own' ? lingeringArtists(slotsRef.current) : []
    return blockedActions(nowMode, still).has(action)
  }
  /** What every roll sends main -- today's values in own mode (rollFilterForArtist). */
  function rollFilter(): ArtistRollFilter {
    return rollFilterForArtist(artistRef.current, currentUsername, globalRollOptions.onlyOwnStems)
  }
  // In `me`, the artists whose stems still play on the rows (picked under
  // artist mode): keep is blocked until they are gone (Elling, 2026-10-01).
  const lingering = mode === 'own' ? lingeringArtists(slots) : []
  const lingeringKey = lingering.join('\n')
  // What the buttons dim by (blockedActions): the whole listen-only list in
  // artist mode; in `me`, keep, star, shelf and timeline while another
  // artist's stems linger (Elling, 2026-10-01).
  const listenOnly = blockedActions(mode, lingering)
  // Main's mirror, for the guards. Re-sent on the own username changing, and
  // on the lingering artists changing (the phone's keep reads it there).
  useEffect(() => {
    void window.rifffApi.discoverSetArtist(
      artist,
      currentUsername,
      lingeringKey === '' ? [] : lingeringKey.split('\n')
    )
  }, [artist, currentUsername, lingeringKey])
  // The source dial (2026-09-29): 0 = endlesss, 100 = other, 50 = half and
  // half. In-memory, like the switches it replaced. Mirrored into a ref
  // because radio's picks run from long-lived callbacks that would
  // otherwise read the value from whenever they were created.
  const [sourceLean, setSourceLean] = useState(DEFAULT_SOURCE_LEAN)
  const sourceLeanRef = useRef(DEFAULT_SOURCE_LEAN)
  function changeSourceLean(lean: number): void {
    sourceLeanRef.current = lean
    setSourceLean(lean)
  }
  const stemFavourites = useStemFavourites()
  const { toggleStemFavourite, reloadStemFavourites } = useStemFavouritesActions()

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
  // TEMPORARY INSTRUMENTATION (2026-09-28) -- "React has actually applied
  // the commit": this is a passive effect on the `slots` prop the commit
  // wrote, so it fires once that render is committed. Remove with
  // radioTrace.ts.
  useEffect(() => {
    radioTraceMark('render')
  }, [slots])
  // Every slot's own real, NATIVE-TEMPO resolved stem (path/durationSec/
  // barLength/author/name/type, exactly what each DiscoverSlotRow reports
  // via reportSlotResolution) -- the ONE source of truth `syncPreviewToEngine`
  // reads from to build a fresh throwaway rifff on every sync.
  // buildEngineProject resolves stretch itself (per call), so unlike the old
  // Web-Audio-backed version there's no separate already-stretched map to
  // keep in sync with this one.
  const resolvedStemsRef = useRef<Map<string, ResolvedCandidateStem>>(new Map())
  // Reactive (unlike resolvedStemsRef) so the row waveforms -- see
  // DiscoverSlotRow's own discoverWindowLayout usage below -- re-render
  // when a slot resolves/re-resolves/clears. Direct report: every slot's
  // waveform used to stretch to fill the same fixed box regardless of the
  // stem's real bar length, making a 1-bar drum hit and an 8-bar bassline
  // look the same length; this tracks each resolved slot's own real
  // barLength so DiscoverPanel can compute the loop's length (maxBarLength
  // below), which places every row's loop-top lines and the one playhead inside
  // the shared fixed window (spec 2026-09-29-discover-fixed-waveform-
  // window-design.md).
  const [resolvedBarLengths, setResolvedBarLengths] = useState<Map<string, number>>(new Map())
  // Synchronously-current mirror of resolvedBarLengths, for the exact same
  // reason previewingSlotIdsRef exists (see its own comment above) --
  // syncPreviewToEngine (below) is a plain function closed over on every
  // render, and reportSlotResolution can invoke it (via
  // scheduleSyncPreviewToEngine's RAF) before React has flushed the
  // setResolvedBarLengths call from THIS SAME reportSlotResolution
  // invocation into a fresh render. Real bug, live-reported 2026-09-17:
  // "it's only playing half of the loop it seems and jumping to the
  // beginning again" -- two slots resolving in close succession (a 1-bar
  // stem then a 2-bar stem) meant the barLengthOverride computed in
  // syncPreviewToEngine (below) was read from a resolvedBarLengths
  // snapshot that was one render behind, still missing the longer stem's
  // own contribution -- the resulting rifff had the LONGER stem's real
  // audio in it, tiled to fill only the SHORTER stem's barLength, so the
  // engine's own loop length was set to half the intended value and
  // wrapped/restarted mid-loop. resolvedBarLengths state itself stays --
  // it's still the right reactive source for the waveform UI
  // (DiscoverSlotRow's own discoverWindowLayout inputs) -- only
  // syncPreviewToEngine's own read switches to this ref.
  const resolvedBarLengthsRef = useRef<Map<string, number>>(new Map())

  // THE ONE PLAYHEAD. Elling, 2026-09-30, looking at an 8-bar loop drawn
  // as four red lines per row: "shouldn't it be one long one moving across
  // all of them?" So there is one line, over every row at once (the
  // overlay drawn above the row list, below), and it sweeps across as many
  // WHOLE laps as fit in the window before returning to the left edge --
  // discoverSweepPct has the rule and its tests.
  //
  // `pos` is the engine's position INSIDE the lap; which lap of the sweep
  // we are on is counted here, one step per wrap (pos going below the last
  // pos -- the same test advanceRadioClock uses, done separately so radio's
  // own clock is left alone). The count goes back to 0 when:
  //   - nothing is previewing (the preview stopped, or is about to be
  //     freshly loaded, which always seeks to 0 -- syncPreviewToEngine);
  //   - the loop length changes, so the new loop starts from the left edge
  //     rather than inheriting a lap count that meant something else;
  //   - the transport is stopped at 0;
  //   - pos goes BACKWARDS without it being a wrap: a seek (to 0 or
  //     anywhere), or a stop putting the transport back to the top. A
  //     pause mid-lap keeps the count, so resuming carries on in place.
  //     A wrap is told apart by where it comes from -- the second half of
  //     a real lap into the first half -- which a seek from the middle of
  //     a lap, or from the real arrangement's far-off position, is not.
  //
  // Written straight to the line's style from a LAYOUT effect, not
  // through state: the count and the position it goes with have to reach
  // the screen in the same frame, or every wrap would paint one frame of
  // the line at the wrong lap (a state update from here would have to be
  // deferred -- this repo errors on a synchronous setState in an effect --
  // and so would land a render late). Reading the ref in render is also
  // flagged, so render never does: it only decides whether the line
  // exists at all.
  const sweepLineRef = useRef<HTMLDivElement>(null)
  // The rows' wrapper, which carries --discover-breath for every row.
  const rowsRef = useRef<HTMLDivElement>(null)
  const sweepLapRef = useRef({ lapIndex: 0, lastPos: 0, loopBars: 0 })
  const previewLoopBars = resolvedBarLengths.size > 0 ? Math.max(...resolvedBarLengths.values()) : 0
  const sweepActive = previewingSlotIds.size > 0 && previewLoopBars > 0
  useLayoutEffect(() => {
    const lap = sweepLapRef.current
    if (!sweepActive) {
      sweepLapRef.current = { lapIndex: 0, lastPos: pos, loopBars: 0 }
      rowsRef.current?.style.setProperty('--discover-breath', '0.5')
      return
    }
    if (lap.loopBars !== previewLoopBars || (!playing && pos <= 1e-6)) {
      // A new loop length, or the transport stopped at the top.
      sweepLapRef.current = { lapIndex: 0, lastPos: pos, loopBars: previewLoopBars }
    } else if (pos < lap.lastPos) {
      const half = previewLoopBars / 2
      const wrapped =
        playing && lap.lastPos >= half && lap.lastPos <= previewLoopBars + 1e-6 && pos < half
      sweepLapRef.current = {
        lapIndex: wrapped ? lap.lapIndex + 1 : 0,
        lastPos: pos,
        loopBars: previewLoopBars
      }
    } else {
      sweepLapRef.current = { ...lap, lastPos: pos }
    }
    // THE BREATH, off the same count (see the row's `background`, below).
    // Absolute bars keep running across the wrap, so a loop that is not a
    // multiple of 4 bars carries its breath through the loop top instead
    // of snapping back to dim there. Held at the midpoint while stopped.
    const breath = playing
      ? discoverBreath(sweepLapRef.current.lapIndex * previewLoopBars + pos)
      : 0.5
    rowsRef.current?.style.setProperty('--discover-breath', breath.toFixed(4))
    const line = sweepLineRef.current
    if (!line) return
    const windowBars = discoverWindowLayout({
      stemBars: previewLoopBars,
      loopBars: previewLoopBars
    }).windowBars
    const pct = discoverSweepPct(sweepLapRef.current.lapIndex, pos, previewLoopBars, windowBars)
    line.style.display = pct === null ? 'none' : 'block'
    if (pct !== null) line.style.left = `${pct}%`
  }, [pos, playing, sweepActive, previewLoopBars])

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
  // The ownership token from the claim the LAST ordinary push made. A
  // staged swap does not claim -- a claim bumps the generation and would
  // invalidate an ordinary push that is mid-await -- so it asks this
  // instead: is the claim this panel already holds still the current one.
  const engineClaimTokenRef = useRef(-1)
  // How many ordinary pushes are between their first line and their
  // socket write. A staged swap must not overtake one: a load-project
  // makes the engine drop whatever is staged (IpcServer.cpp's
  // resolveStagedBefore("load-project")), and the two travel on the same
  // socket in call order, so "no rAF pending" is not enough -- a push can
  // be several awaits deep in buildEngineProject and still be ahead of
  // us. Counted rather than a boolean because toggleSlotPreview and
  // toggleSlotSolo call the sync directly, outside the rAF that coalesces
  // everything else.
  const liveSyncInFlightRef = useRef(0)
  // Set true by the unmount effect below, checked at the top of
  // syncPreviewToEngine -- load-bearing, not defensive fluff:
  // reportSlotResolution can itself trigger a fresh syncPreviewToEngine from
  // a CHILD row's own cleanup effect firing during this SAME unmount pass
  // (e.g. a reroll landing right as the panel closes). Without this guard
  // that straggling call would still kick off a real async build+send with
  // no live component left to ever stop it again once it lands.
  const unmountedRef = useRef(false)

  // Coalesces syncPreviewToEngine calls that land in the same animation
  // frame. reportSlotResolution (below) calls this every time a slot
  // resolves -- for a Shelf-sourced seed, EVERY seeded slot's own
  // seedStem resolves ~synchronously on its own first render, so a whole
  // batch of up to 8 slots can each trigger a call within the same tick.
  // Without coalescing, each call's own async build+send (buildEngineProject
  // + engineLoadProject) can get superseded by the VERY NEXT call's bumped
  // previewSyncGenerationRef before it ever finishes -- meaning NONE of
  // them reliably survive to the point that actually loads/plays anything.
  // Real bug, live-reported 2026-09-16: "right clicking brings up the
  // discovery panel, but it doesn't play the stems." Only the LAST call
  // scheduled within a burst actually runs, using whatever `ids` it was
  // most recently given -- by the time one animation frame has passed, a
  // synchronous resolution burst has always finished landing.
  const pendingSyncRafRef = useRef<number | null>(null)
  // The member set the next sync will be built from. Lives in a ref rather
  // than in the rAF closure so a HOLD (below) can park an already-scheduled
  // sync and still know what to send once the hold lifts.
  const pendingSyncIdsRef = useRef<Set<string> | null>(null)
  function scheduleSyncPreviewToEngine(ids: Set<string>): void {
    pendingSyncIdsRef.current = ids
    if (pendingSyncRafRef.current !== null) {
      cancelAnimationFrame(pendingSyncRafRef.current)
      pendingSyncRafRef.current = null
    }
    // Held: keep the ids, schedule nothing. releaseSyncHold re-schedules.
    if (syncHoldRef.current.size > 0) return
    pendingSyncRafRef.current = requestAnimationFrame(() => {
      pendingSyncRafRef.current = null
      const sending = pendingSyncIdsRef.current
      pendingSyncIdsRef.current = null
      if (sending === null) return
      radioTraceMark('raf') // TEMP (2026-09-28), remove with radioTrace.ts
      // .finally, not .then: syncPreviewToEngine has several early returns
      // (unmounted, no members, a superseded generation, ownership lost)
      // and its own internal try/catch, and a radio arm waiting on this
      // must be released down EVERY one of those paths.
      void syncPreviewToEngine(sending).finally(drainAfterEngineSync)
    })
  }

  // --- the sync hold: a committed change's push carries the change
  //
  // Slots whose radio commit is in `slots` but whose NEW stem has not
  // resolved into resolvedStemsRef yet. While this is non-empty no
  // load-project goes out at all.
  //
  // Measured 2026-09-28: radio changes split cleanly into two populations.
  // One push, 70-168ms; two pushes, 349-829ms -- and it was always the
  // SECOND push that was slow. The shape was always the same. A commit
  // lands, something in the SAME tick schedules a sync, and if that rAF
  // wins the race against the row's own resolve then a load-project goes
  // out carrying the OLD stem; the real swap then has to ride a second
  // push once the resolve lands. When the resolve won the race instead
  // there was one push and the change was fast.
  //
  // Three separate callers put a sync in a commit's own tick, which is why
  // c5612da (dropping the arrival gesture's explicit sync) fixed only part
  // of it:
  //   - clearRadioGesture(), from the wrap's lapsLeft countdown -- the
  //     PREVIOUS lap's gesture coming off in the same tick a new change is
  //     due. This is why plain `due-cut` changes with no gesture of their
  //     own still pushed twice.
  //   - clearRadioGesture() again, from the gesture-led branch, which
  //     fires synchronously in the effect body while the commit it belongs
  //     to is deferred a microtask -- so its rAF was ALREADY pending by
  //     the time the commit ran.
  //   - the standalone drop-out roll, which runs after the commit in the
  //     same microtask and syncs to arm its curve.
  // None of them is wrong to want a sync; all of them are wrong about
  // WHEN. Holding here fixes the class rather than the three call sites,
  // and a fourth caller added later gets the same treatment for free.
  //
  // This also subsumes the `armRadioPick` deferral's own remaining bug
  // (705510a): runAfterEngineSync drains off the push's .finally, so when
  // the only push is the swap's, "the first push" and "the push carrying
  // the swap" are the same thing again. No second mechanism needed.
  const syncHoldRef = useRef<Set<string>>(new Set())
  const syncHoldTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  /** Holds every engine push until `slotId`'s newly-committed pick has
   * resolved. Cancels a sync already scheduled for this frame -- the
   * gesture-led path schedules one BEFORE the commit it precedes. */
  function holdSyncUntilResolved(slotId: string): void {
    syncHoldRef.current.add(slotId)
    if (pendingSyncRafRef.current !== null) {
      cancelAnimationFrame(pendingSyncRafRef.current)
      pendingSyncRafRef.current = null
    }
    if (syncHoldTimerRef.current === null) {
      syncHoldTimerRef.current = setTimeout(() => releaseSyncHold(null), SYNC_HOLD_TIMEOUT_MS)
    }
  }

  /** Lifts the hold for one slot, or (null) for all of them, and lets
   * whatever was parked go out. */
  function releaseSyncHold(slotId: string | null): void {
    if (slotId === null) {
      if (syncHoldRef.current.size === 0) return
      syncHoldRef.current = new Set()
    } else {
      if (!syncHoldRef.current.delete(slotId)) return
      if (syncHoldRef.current.size > 0) return
    }
    if (syncHoldTimerRef.current !== null) {
      clearTimeout(syncHoldTimerRef.current)
      syncHoldTimerRef.current = null
    }
    const parked = pendingSyncIdsRef.current
    if (parked !== null) scheduleSyncPreviewToEngine(parked)
  }

  // Callbacks waiting for the preview sync that a landing change triggers
  // to have finished pushing its project to the engine, and the backstop
  // timer that releases them if no sync ever turns up.
  const afterEngineSyncRef = useRef<(() => void)[]>([])
  const afterEngineSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  /** Runs `fn` once the engine push triggered by a just-committed change
   * has gone out.
   *
   * Measured 2026-09-28 on Elling's own 5,058-jam library: a radio change
   * started about a second after the downbeat it was scheduled for, and
   * four separate prefetch fixes landed the same day -- the download, the
   * rubberband stretch, the engine's own decoded buffer, the waveform peaks
   * -- moved it not at all. None of them was what was late.
   *
   * The commit and `armRadioPick()` ran in the SAME microtask, and
   * pickForSlot fires `get-discover-candidates` before its first await.
   * The commit's own engine push, by contrast, only leaves a frame later:
   * setSlots, a render, the row's resolve effect, reportSlotResolution,
   * then scheduleSyncPreviewToEngine's rAF. So the NEXT pick's 0.3-3.1s of
   * main-process work was already in flight before the CURRENT change's
   * buildEngineProject stretch lookups, setRemoteLoop and engineLoadProject
   * had even been sent -- and Electron's main process is single-threaded,
   * so every one of them queued behind it. The data was warm; the channel
   * was busy. (Why that pick costs seconds at all is a separate problem --
   * see docs/superpowers/specs/2026-09-28-discover-candidate-pool-design.md.)
   *
   * Waiting for the push to COMPLETE rather than merely be dispatched is
   * deliberate, and costs nothing worth having: the chain is tens of
   * milliseconds once warm, against a radio interval of 3 bars at the very
   * fastest. The next pick still gets essentially the whole interval, which
   * is the entire point of arming early.
   *
   * `fn` ALWAYS runs, via the timer if nothing else -- see
   * AFTER_ENGINE_SYNC_TIMEOUT_MS's own doc comment for why a dropped arm
   * would be a worse bug than the one this fixes. */
  function runAfterEngineSync(fn: () => void): void {
    afterEngineSyncRef.current.push(fn)
    if (afterEngineSyncTimerRef.current !== null) return
    afterEngineSyncTimerRef.current = setTimeout(drainAfterEngineSync, AFTER_ENGINE_SYNC_TIMEOUT_MS)
  }

  /** Releases everything runAfterEngineSync is holding. Whichever of the
   * engine push and the backstop timer gets here first wins; the other
   * finds an empty queue and does nothing. */
  function drainAfterEngineSync(): void {
    if (afterEngineSyncTimerRef.current !== null) {
      clearTimeout(afterEngineSyncTimerRef.current)
      afterEngineSyncTimerRef.current = null
    }
    const waiting = afterEngineSyncRef.current
    if (waiting.length === 0) return
    afterEngineSyncRef.current = []
    for (const fn of waiting) fn()
  }

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
    // Direct report: "the arranger clips started playing instead of the
    // discover looper... like it got knocked out of the discover
    // groove." Root cause: this function hands the engine back to the
    // real project (flushEngineSyncNow below) whenever Discover
    // unmounts -- a 'discover' -> 'browse' tab switch, or closing the
    // whole library modal, while a preview is still mid-audition -- but
    // it never touched `playing` itself. StoreContext.tsx's own
    // `[playing]` effect (the one that actually calls
    // engineStop()/enginePlay()) only fires on a true/false TRANSITION:
    // if `playing` was already true here, that effect never re-runs, so
    // the engine's transport just keeps running under whatever project
    // is now loaded. The real project lands a moment later (this very
    // call, or StoreContext's own now-unblocked automatic sync) while
    // the transport was never told to stop -- audibly continuing
    // straight into the real arrangement's own clips, mid-stream, with
    // no explicit play ever asked for. Pausing here (a harmless no-op if
    // already paused -- StoreContext.tsx's own PAUSE case is just
    // `setPlaying(false)`) makes leaving Discover behave like every
    // other "stop auditioning" action in this app: playback actually
    // stops, instead of silently handing off to a different project's
    // audio.
    dispatch({ type: 'PAUSE' })
    void flushEngineSyncNow(undefined, () => !stillOwnEngine(releaseToken))
  }, [dispatch, flushEngineSyncNow, releaseEngine, stillOwnEngine])

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
      // A scheduled-but-not-yet-fired coalesced sync (pendingSyncRafRef)
      // would otherwise still fire its rAF callback after unmount --
      // harmless in practice (syncPreviewToEngine's own unmountedRef
      // check no-ops it), but cancelling outright avoids the wasted
      // build+send entirely.
      if (pendingSyncRafRef.current !== null) {
        cancelAnimationFrame(pendingSyncRafRef.current)
        pendingSyncRafRef.current = null
      }
      pendingSyncIdsRef.current = null
      // Same reasoning for the hold: drop it outright rather than
      // releasing it (releasing would schedule the very rAF just
      // cancelled), and take its backstop timer with it so it cannot fire
      // into a component that is gone -- or, in StrictMode's fake
      // unmount, into one that is about to come back.
      syncHoldRef.current = new Set()
      if (syncHoldTimerRef.current !== null) {
        clearTimeout(syncHoldTimerRef.current)
        syncHoldTimerRef.current = null
      }
      // Drop, don't drain: a waiting radio arm exists to keep radio going,
      // and there is no radio to keep going once the panel is gone. Firing
      // them here would reach pickForSlot's own setState on an unmounted
      // component. The timer has to go with them or it fires into the void
      // (and, in StrictMode's fake unmount, into a component that is about
      // to come back).
      afterEngineSyncRef.current = []
      if (afterEngineSyncTimerRef.current !== null) {
        clearTimeout(afterEngineSyncTimerRef.current)
        afterEngineSyncTimerRef.current = null
      }
      void restorePreviewIfLoaded()
    }
  }, [restorePreviewIfLoaded])

  // --- the master strip (2026-09-28 performance-mode spec, section 4A)
  //
  // One fader and one reverb send over the WHOLE preview mix, so the
  // built-in toolkit reaches Discover and radio the way the master plugin
  // chain already does (section 0.4). The spec hangs this strip off
  // performance mode; performance mode is phase 1 of that plan and is not
  // built yet, so it is shown here whenever a preview is actually loaded
  // (previewingSlotIds.size > 0, the same reactive "is anything sounding"
  // signal the playhead overlay uses). Smallest thing that makes the
  // controls reachable without inventing a mode for them -- when the deck
  // lands, this moves under `performOn`.
  //
  // Both dials are 0-100, which is Dial's own domain (Dial.tsx). The wire
  // and @shared/performanceDeck are 0-1, and the division happens at each
  // push -- three places, listed in performanceDeck.ts's header.
  const [masterLevel, setMasterLevel] = useState(100)
  const masterLevelRef = useRef(100)
  useEffect(() => {
    masterLevelRef.current = masterLevel
  }, [masterLevel])
  // Reverb is NOT continuous, and cannot be: set-live-param accepts only
  // volume/fadeIn/fadeOut (IpcServer.cpp:343-348), so every send change is
  // a whole load-project -- which is exactly what updateSlotGain's own
  // comment exists to keep off a drag tick. Dial already has the right
  // split: onChange is the live half, onCommit fires once per finished
  // gesture (Dial.tsx:61-68). `masterSendDraft` follows the thumb;
  // `masterSend` is what has actually been sent.
  const [masterSend, setMasterSend] = useState(0)
  const [masterSendDraft, setMasterSendDraft] = useState(0)
  const masterSendRef = useRef(0)
  useEffect(() => {
    masterSendRef.current = masterSend
  }, [masterSend])

  /** Write the master fader to every slot in the loaded preview.
   *
   * MUST be called after every syncPreviewToEngine, not just on a drag:
   * load-project calls engine.liveOverrides().clearAll()
   * (IpcServer.cpp:259), so a slot landing, a skip resolving or a mute
   * wipes these overrides and every slot snaps back to its own gain.
   * Re-applying is the difference between a fader that works and one that
   * jumps to unity whenever a layer changes. */
  function pushMasterLevel(): void {
    const mapping = currentPreviewMappingRef.current
    if (!mapping) return
    const slotGains = new Map<string, number>()
    for (const [slotId, slotIndex] of mapping.slotIndexById) {
      const gain = slotsRef.current.find((sl) => sl.id === slotId)?.gain ?? 1
      slotGains.set(stemKey(mapping.groupId, slotIndex), gain)
    }
    for (const [key, value] of masterScaledGains(slotGains, masterLevelRef.current / 100)) {
      scheduleLiveParamSync('volume', key, value)
    }
  }

  // The master FILTER (spec 4A.3) -- the one control here that needed a
  // real engine change, and the reason this is the first native work in any
  // of this line. One ChannelFilter on the summed master pair, not N
  // identical per-clip curves; that alternative is rejected at length in
  // 4A.3 and must not be revived.
  //
  // Both dials are Dial's own 0-100 and the wire is 0-1, same as the two
  // above. `cutoff` is the SAME normalised control the per-clip filter lane
  // draws, mapped onto 20Hz..20kHz logarithmically by exactly one function
  // on the engine side -- so 40 on this dial and lane-height 0.4 on a clip
  // are the same frequency, which is the whole reason the mapping was not
  // re-invented here.
  //
  // Where neutral SITS depends on the mode: a lowpass passes everything at
  // the top of its range, a highpass at the bottom. So the resting position
  // of this dial is 100 in lp and 0 in hp, which is also what the dial's
  // double-click reset goes back to.
  const [masterFilterMode, setMasterFilterMode] = useState<FilterMode>('lowpass')
  const [masterCutoff, setMasterCutoff] = useState(100)
  const [masterResonance, setMasterResonance] = useState(0)
  const masterFilterRef = useRef<StemFilterSettings>({
    mode: 'lowpass',
    cutoff: 1,
    resonance: 0
  })

  /** Write the master filter's two continuous controls straight at the
   * engine, bypassing a project rebuild.
   *
   * A filter you sweep is a hand on a control, so it takes the live-param
   * path (the rule this codebase learned twice; see @shared/liveParam) --
   * a whole load-project per drag frame is exactly what updateSlotGain's
   * own comment exists to avoid.
   *
   * MUST be called after every syncPreviewToEngine, for the identical
   * reason pushMasterLevel must: load-project calls
   * engine.liveOverrides().clearAll(), which drops these two along with
   * every volume override. Unlike the fader, the committed value is ALSO
   * on the wire (previewState.masterFilter below), so a missed re-assert
   * would only lose whatever the current drag had moved since the last
   * sync rather than snapping to unity -- but re-asserting is what makes a
   * sweep survive a layer change landing underneath it. */
  function pushMasterFilter(): void {
    const filter = masterFilterRef.current
    scheduleLiveParamSync('masterFilterCutoff', MASTER_LIVE_PARAM_KEY, filter.cutoff)
    scheduleLiveParamSync('masterFilterResonance', MASTER_LIVE_PARAM_KEY, filter.resonance)
  }

  /** Flip lowpass <-> highpass.
   *
   * Three things happen together, and the order matters. The cutoff snaps
   * to the NEW mode's own neutral end, because a highpass inheriting a
   * lowpass's parked 1.0 is 20kHz -- everything gone -- and a control that
   * can silence the mix on a single click is not one you reach for on
   * stage. The two live overrides are CLEARED rather than rewritten,
   * because the mode itself has no live-param and so still lives a whole
   * load-project behind: an override pushed now would be read against the
   * OLD mode for one round trip, and "neutral for the new mode" is exactly
   * "everything gone" for the old one. Clearing leaves the engine on its
   * last committed values for those few milliseconds, which is simply what
   * it was already doing. Then the sync carries the new mode over. */
  function toggleMasterFilterMode(): void {
    const next: FilterMode = masterFilterMode === 'lowpass' ? 'highpass' : 'lowpass'
    const cutoff = neutralCutoff(next)
    setMasterFilterMode(next)
    setMasterCutoff(cutoff * 100)
    masterFilterRef.current = { mode: next, cutoff, resonance: masterResonance / 100 }
    scheduleLiveParamSync('masterFilterCutoff', MASTER_LIVE_PARAM_KEY, -1)
    scheduleLiveParamSync('masterFilterResonance', MASTER_LIVE_PARAM_KEY, -1)
    const ids = previewingSlotIdsRef.current
    if (ids.size > 0) scheduleSyncPreviewToEngine(new Set(ids))
  }

  /** One send value on every preview stem. Committed on release, not on
   * every drag frame -- see the state's own comment above for why. */
  function commitMasterSend(value: number): void {
    setMasterSend(value)
    masterSendRef.current = value
    setMasterSendDraft(value)
    const ids = previewingSlotIdsRef.current
    if (ids.size > 0) scheduleSyncPreviewToEngine(new Set(ids))
  }

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
   * masterChain/channelPlugins/reverb/sound from the real one (sound: the
   * radio sound's settings; the app-wide defaults if the project has none).
   * A sound settings change is picked up at the next sync, not mid-preview
   * (the native radio sound plan's Task 13 adds the resync).
   *
   * MASTER plugin FX genuinely are applied while auditioning: Transport.cpp
   * runs masterChain.process() on the summed output for whatever project is
   * loaded, load-project never touches master plugins (they have their own
   * load-master-plugin message), and StoreContext's master-chain effect is
   * not ownership-gated -- so editing the chain mid-preview is heard
   * immediately, with each plugin's live parameter state intact.
   *
   * CHANNEL plugin FX are NOT, despite `channelPlugins` being copied here:
   * assembleDiscoverRifff mints a fresh groupId per sync and previewState
   * has no channelOf, so buildEngineProject's `channelOf[groupId] ??
   * groupId` fallback gives this preview a channel id that matches no key
   * in channelPlugins. Copying it is a no-op. Routing them for real would
   * mean giving the preview a stable channel identity -- a different
   * change, deliberately not made here (2026-09-28 performance-mode spec
   * 0.4). */
  /** Builds this panel's preview project and sends it to the engine.
   *
   * Two destinations, one build. Without `stage` this is the ordinary
   * push that has always been here: load-project, live immediately, plus
   * everything that only makes sense for the project that is actually
   * playing (the phone's copy of the loop, the slot-index mapping the
   * live gain drags address through, the master re-assertions, the
   * empty-to-playing transition).
   *
   * With `stage` it is radio's SCHEDULED swap: the same project, built one
   * slot into the future, handed to the engine early and made real by the
   * engine itself exactly at the next loop top. See stepRadioStage for
   * when that is allowed and why it is the only way a radio change can be
   * on time -- the renderer's own chain (commit, render, resolve, rAF,
   * build, IPC) cannot start until the boundary it is aiming at has
   * already passed.
   *
   * The bookkeeping lives out here, in this wrapper, because the body
   * below has a dozen early returns and every one of them has to leave
   * liveSyncInFlightRef where it found it. */
  async function syncPreviewToEngine(ids: Set<string>, stage?: RadioStageRequest): Promise<void> {
    if (stage !== undefined) {
      try {
        await buildAndPushPreview(ids, stage)
      } finally {
        // A build that bailed out before the write left nothing with the
        // engine, so the ref has to let go -- otherwise stepRadioStage
        // would sit there believing a swap was in flight and never push
        // another one for the rest of the session.
        const staged = radioStageRef.current
        if (staged !== null && staged.token === stage.token && !staged.sent) {
          radioStageRef.current = null
        }
      }
      return
    }
    // An ordinary push makes the engine drop whatever radio staged, so
    // the two can never be in flight together -- and the push wins,
    // because it is what is actually true right now and a staged project
    // is only a prediction. The change it was carrying falls back to
    // landing the way it does today: committed at the wrap, pushed after
    // it.
    cancelStagedSwap('load-project')
    liveSyncInFlightRef.current += 1
    try {
      await buildAndPushPreview(ids, undefined)
    } finally {
      liveSyncInFlightRef.current -= 1
    }
  }

  async function buildAndPushPreview(
    ids: Set<string>,
    stage: RadioStageRequest | undefined
  ): Promise<void> {
    if (unmountedRef.current) return
    // A stage does not bump the generation: it is a second message under
    // the claim this panel already holds, not a new claim, and bumping
    // would invalidate an ordinary push that is mid-await.
    const myGeneration = stage
      ? previewSyncGenerationRef.current
      : previewSyncGenerationRef.current + 1
    if (!stage) previewSyncGenerationRef.current = myGeneration
    const engineToken = stage ? engineClaimTokenRef.current : claimEngine('discover-preview')
    if (stage && !stillOwnEngine(engineToken)) return
    if (!stage) engineClaimTokenRef.current = engineToken

    // Direct request, 2026-09-16: "i'd like the tempo to be set to the
    // original imported rifff in discovery." Checked HERE, right after the
    // synchronous claimEngine() above (not after this function's own two
    // awaits below) -- ownership is already correctly held at this exact
    // point, so StoreContext.tsx's scheduleEngineSync own ownership gate
    // already correctly skips the real-project sync when this bpm change
    // lands, same race-free reasoning as before. Moved here specifically
    // because gating it on this function's OWN later success (past
    // buildEngineProject/engineLoadProject) turned out to still be
    // unreliable for a Browse-sourced seed: several slots resolve at
    // staggered real download speeds, each calling this function again
    // with a newer previewSyncGenerationRef -- an early call can keep
    // getting superseded before it ever reaches its own later code,
    // live-reported 2026-09-16 ("via the browse" specifically) as the
    // tempo simply never updating. This check only depends on
    // syncPreviewToEngine having been CALLED at all (which happens
    // reliably, synchronously, from reportSlotResolution on the very
    // first slot to resolve), not on any one specific call surviving to
    // the end -- `!previewLoadedRef.current` naturally stops this from
    // re-firing once some call eventually does win and sets it true;
    // re-dispatching the same bpm on an earlier, ultimately-superseded
    // call is a harmless no-op difference, not a bug.
    //
    // No longer gated on channelOrder.length === 0 -- direct follow-up,
    // 2026-09-16: "discover's tempo seems to not want to take the
    // imported rifff tempo, i have to press the match seed tempo every
    // time." The original "only when empty" restriction (Elling's own
    // earlier call, to avoid silently retuning a project already in
    // progress) turned out to be actively getting in the way once seeding
    // became a routine, repeated action rather than a one-time "start a
    // fresh project" move -- confirmed explicitly: always auto-match now,
    // regardless of existing arranger content. The manual "match seed"
    // button (below) stays as-is, still useful after an individual
    // reroll drifts a slot away from the seed's own tempo.
    // Not for a stage: this is the empty-panel seeding rule, and a stage
    // only ever happens while radio is running on a preview that is
    // already loaded and playing.
    if (!stage && !previewLoadedRef.current && seedBpm !== null) {
      dispatch({ type: 'SET_TEMPO', bpm: Math.round(seedBpm) })
    }

    // Existing ids first, joining ids after: slotIndexById and the stem
    // keys are numbered from this order, so it must stay stable.
    const memberIds = stage ? new Set([...ids, ...stage.joining]) : ids
    const members = [...memberIds]
      .map((id) => {
        // A staged project is built from the mix as it WILL be: every
        // slot about to turn over carries its INCOMING stem,
        // while nothing in the panel's own state has moved yet. That is
        // what lets the commit stay exactly where it is, at the wrap --
        // the row goes on saying "a change is coming" for the lap, the
        // undo stack and the UI are untouched, and the engine is the only
        // thing holding the future.
        const stem =
          stage?.changes.find((c) => c.slotId === id)?.stem ?? resolvedStemsRef.current.get(id)
        if (!stem) return null
        const gain = slots.find((s) => s.id === id)?.gain ?? 1
        return { id, stem, gain }
      })
      .filter((x): x is { id: string; stem: ResolvedCandidateStem; gain: number } => x !== null)

    if (members.length === 0) {
      // A stage with nothing in the mix is not a swap, it is a teardown --
      // and tearing down is the live path's business, not a scheduled
      // one's. Withdraw instead.
      if (stage) return
      void window.rifffApi.setRemoteLoop(null, [])
      await restorePreviewIfLoaded()
      return
    }

    // maxMembers explicitly uncapped (members.length -- i.e. never
    // truncates) -- unlike resolveDiscoverRifff's own call below, THIS rifff is
    // a throwaway preview project, never persisted, with no
    // Riffs.StemCID_1..8 schema to fit into. Real bug, live-reported
    // 2026-09-16: sharing assembleDiscoverRifff's own default 8-stem cap
    // here silently dropped any 9th+ toggled-on slot from the actual
    // engine preview mix (while it still showed as resolved/toggled-on in
    // the UI) -- see assembleDiscoverRifff's own doc comment.
    // barLengthOverride computed from EVERY resolved slot (resolvedBarLengths),
    // not just the currently toggled-on `members` -- real bug, live-reported
    // 2026-09-16: "sometimes soloing or muting causes the discover loop to
    // restart from the beginning." Without this, assembleDiscoverRifff's own
    // default barLength (max of only the currently-included members) shrinks
    // or grows on every mute/solo toggle, and that value is sent straight to
    // the native engine's loop-length setting on every resulting
    // engineLoadProject call -- see assembleDiscoverRifff's own doc comment
    // for the full mechanism. Same computation as the panel's maxBarLength
    // (the loop length the playhead and the rows' loop-top lines use).
    //
    // Reads resolvedBarLengthsRef, NOT the reactive resolvedBarLengths state
    // -- this function is a plain closure re-created every render, and
    // reportSlotResolution can invoke it (via scheduleSyncPreviewToEngine's
    // RAF) before React flushes THIS SAME reportSlotResolution call's own
    // setResolvedBarLengths into a fresh render. Real bug, live-reported
    // 2026-09-17: "it's only playing half of the loop it seems and jumping
    // to the beginning again" -- two slots resolving in close succession (a
    // short stem then a longer one) meant this read a resolvedBarLengths
    // snapshot one render behind, still missing the longer stem's own
    // contribution, so the loop length sent to the engine was half what the
    // actually-included stems needed. See resolvedBarLengthsRef's own doc
    // comment for the full mechanism.
    // The incoming stem's own length goes in for a stage, exactly as it
    // will when the commit lands: it is what the loop wraps at, and a
    // staged project that disagreed with the one that follows it would
    // move the loop point twice in two frames. The engine takes this as
    // the STAGED loop length (Transport::setStagedLoopLengthBars) and
    // adopts it at the same wrap it adopts the project.
    const stagedBarLengths = new Map(resolvedBarLengthsRef.current)
    if (stage) for (const c of stage.changes) stagedBarLengths.set(c.slotId, c.stem.barLength)
    const maxBarLength =
      stagedBarLengths.size > 0 ? Math.max(...stagedBarLengths.values()) : undefined
    const assembly = assembleDiscoverRifff(
      'discover preview',
      members.map(({ stem, gain }) => ({ stem, gain })),
      bpm,
      members.length,
      maxBarLength
    )
    if (!assembly) {
      // Unreachable in practice (members.length > 0 already checked above,
      // and assembleDiscoverRifff only returns null for an empty list), but
      // handled rather than asserted since the function's own return type
      // is nullable.
      void window.rifffApi.setRemoteLoop(null, [])
      await restorePreviewIfLoaded()
      return
    }
    const { rifff, vol } = assembly

    // The armed gesture, as automation curves (and, for a riser, a live
    // noise sweep) in the project itself. This is the ONLY way a gesture
    // can land on the beat in this codebase (spec 0A): the engine holds
    // the curve and performs it per sample, so radio's 30Hz React clock is
    // nowhere in the timed path. Arming is not timing-critical and
    // clearing it is a later sync writing {} here.
    //
    // buildEngineProject reads state.stemAutomation?.[key] and
    // isStemToolkitNeutral drops the whole toolkit key when nothing is
    // drawn, and buildEngineRisers({}) emits an empty array, so EMPTY
    // records make the project byte-identical to what shipped before this
    // feature existed. Do not "simplify" that away -- it is the regression
    // safety property of the whole feature: with transitions off, or
    // between gestures, nothing about the preview has changed.
    //
    // Gated on radioOnRef as well as the ref itself: a curve must never
    // outlive radio, because a volume curve makes that stem's
    // EngineStem.volume inert while it is there (see clearRadioGesture).
    // Belt and braces over the clears in the lap countdown, stopRadio and
    // the unmount teardown.
    //
    // Every VOLUME curve below is pushed through masterScaledCurve first.
    // A non-empty volume curve makes EngineStem.volume inert
    // (PlaybackEngine.cpp:317-329) -- the clip runs at the curve's own
    // value and neither the slot's committed gain nor the master fader's
    // live-param override is read at all. Unscaled, a duck with the master
    // pulled down would slam every other layer back to full for the length
    // of the gesture. So the curve carries the same product the live-param
    // would have: this stem's own gain, times the master. The gesture still
    // wins the SHAPE -- it is transient and the master is persistent -- it
    // just no longer wins the level.
    const stemAutomation: Record<string, StemAutomation> = {}
    const risers: Record<string, RiserClip> = {}
    // A staged project carries the gesture of the project it will BECOME
    // -- an arrival curve for the layer that is about to land, or nothing
    // at all. Never radioGestureRef, which describes the lap that is
    // playing NOW: a `hole` announcing this very change is over by the
    // time the staged project goes live, and carrying it across would
    // punch the gap in the layer that just arrived.
    const gestureList: RadioGesture[] = stage
      ? stage.gestures
      : radioOnRef.current
        ? radioGestureRef.current
        : []
    const masterLevel01 = masterLevelRef.current / 100
    function underMaster(key: string, curve: AutomationPoint[]): AutomationPoint[] {
      return masterScaledCurve(curve, (vol[key] ?? 1) * masterLevel01)
    }
    // One pass per gesture, merging rather than overwriting: with several
    // rows changing at one wrap, a bloom on one row and a duck from another
    // row's change can land on the same stem key.
    for (const gesture of gestureList) {
      if (maxBarLength !== undefined && maxBarLength > 0) {
        const own = members.findIndex((m) => m.id === gesture.slotId) + 1
        // Every gesture measures itself in beats, so one conversion here
        // rather than four different units in the branches. 4/4, as
        // everywhere else in Discover.
        const bars = gesture.beats / 4
        if (gesture.kind === 'drop-out' || gesture.kind === 'hole') {
          // The same curve for both, and deliberately so: a hole IS the
          // drop-out, attached to a change. The difference is entirely in
          // WHOSE stem it lands on and when the change happens -- a
          // drop-out drops an untouched layer and puts it straight back, a
          // hole drops the OUTGOING layer and the new one lands in the
          // space at the wrap (see radioLedChangeRef).
          const curve = buildDropOutCurve(maxBarLength, gesture.beats)
          if (own > 0 && curve.length > 0) {
            const key = stemKey(rifff.groupId, own)
            stemAutomation[key] = { ...stemAutomation[key], volume: underMaster(key, curve) }
          }
        } else if (gesture.kind === 'filter in') {
          const curve = buildFilterInCurve(maxBarLength, bars)
          if (own > 0 && curve.length > 0) {
            const key = stemKey(rifff.groupId, own)
            stemAutomation[key] = { ...stemAutomation[key], filterCutoff: curve }
          }
        } else if (gesture.kind === 'bloom') {
          const curve = buildBloomCurve(maxBarLength, bars)
          if (own > 0 && curve.length > 0) {
            const key = stemKey(rifff.groupId, own)
            stemAutomation[key] = { ...stemAutomation[key], reverbSend: curve }
          }
        } else if (gesture.kind === 'duck') {
          // Every OTHER audible layer dips, so the new one lands in space.
          // "Other" means other than EVERY row changing in this stage, so a
          // duck never dips another arriving stem -- and on the live push
          // that follows a landing, other than every row that landed with
          // it (`spares`), so that push agrees with the stage it follows.
          //
          // And a key that ALREADY carries a volume curve is skipped --
          // ANY volume curve, not only another duck's. A second duck is the
          // obvious case (duck curves are identical, and scaling one under
          // the master twice would be wrong), but a hole or a drop-out
          // written earlier in this loop keeps its stem too: one volume
          // curve per stem, first writer wins. Deliberate -- do not narrow
          // this into a duck-only check.
          const curve = buildDuckCurve(maxBarLength, bars)
          const changing = new Set(
            stage?.changes.map((c) => c.slotId) ?? gesture.spares ?? [gesture.slotId]
          )
          if (curve.length > 0) {
            members.forEach((m, i) => {
              if (!changing.has(m.id)) {
                const key = stemKey(rifff.groupId, i + 1)
                if (!stemAutomation[key]?.volume) {
                  stemAutomation[key] = { ...stemAutomation[key], volume: underMaster(key, curve) }
                }
              }
            })
          }
        } else if (gesture.kind === 'riser') {
          // The preview's one rifff sits on its own groupId channel
          // (buildEngineProject's state.channelOf fallback), so that is the
          // bus this sweep belongs on.
          const riser = buildTransitionRiser(rifff.groupId, maxBarLength, bars)
          if (riser) risers[riser.id] = riser
        }
      }
    }

    // A throwaway single-rifff AppState -- only bpm/masterChain/
    // channelPlugins/reverb/sound are copied from the real project; state.rifffs is
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
      reverb,
      // explicit: initialState has none (absent is today's sound)
      sound: sound ?? appSoundDefaultsNow(),
      rifffs: { [rifff.groupId]: { ...rifff, startBar: 0 } },
      vol,
      // The master reverb: N equal sends into the ONE shared bus, which is
      // what that bus already is (ReverbBus.h:38-58), so nothing here is
      // an approximation the way a faked master filter would be (spec
      // 4A.3). Object.keys(vol) is exactly the stem keys
      // assembleDiscoverRifff just minted for this rifff, so the sends and
      // the stems cannot disagree. At 0 this is {}, so
      // isStemToolkitNeutral drops the toolkit key and the project is
      // bit-identical to one built before this feature existed.
      //
      // A `bloom` gesture draws a reverbSend CURVE on one stem, and a
      // curve beats the static value outright (evaluateAutomation's own
      // fallback argument, PlaybackEngine.cpp:740). So a bloom takes that
      // one layer's send for as long as it runs and the master send
      // resumes on it when the gesture clears -- transient over
      // persistent, same rule as the volume curves above. The other layers
      // keep the master send throughout.
      stemSends: masterSendsFor(Object.keys(vol), masterSendRef.current / 100),
      // The master filter, as the COMMITTED value. The live-param pushed on
      // every drag frame beats this on the engine side, so during a sweep
      // these two disagree by at most one sync -- and the moment a
      // load-project clears the override, this is what the filter falls
      // back to, which is why it is sent at all rather than left entirely
      // to the live path. buildEngineProject drops the key outright when
      // the filter is parked, so a resting master strip is bit-identical
      // to a project built before the field existed
      // (masterFilterForWire, and an engine test that pins it sample for
      // sample).
      //
      // Radio's `filter in` transition writes a PER-CLIP filterCutoff curve
      // on the one layer arriving. That is a different filter in a
      // different place: the clip's own, upstream of its channel, applied
      // before its samples ever reach the master sum. This one is after the
      // whole sum (and after the reverb's wet add). So the two are in
      // series, not in conflict -- a layer sweeping in under a master
      // sweep is heard through both, which is musically what both of them
      // separately promise, and neither can clear or overwrite the other's
      // state.
      masterFilter: masterFilterRef.current,
      stemAutomation,
      risers,
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
      radioTraceMark('assembled') // TEMP (2026-09-28), remove with radioTrace.ts
      // Per-row panning (native radio sound plan, Task 4): over EVERY slot in the panel, by
      // slot id, so a mute, a solo or a swap never moves a row (discoverStemPans).
      // buildEngineProject applies it only while the project's panning is on.
      const stemPans = discoverStemPans(
        slotsRef.current,
        members.map(({ id }) => id),
        rifff.groupId,
        normalizeSoundSettings(previewState.sound).panning.width
      )
      const project = await buildEngineProject(
        previewState,
        resolveStretchedForPlayback,
        pluginCatalog,
        undefined,
        { stemPans }
      )
      radioTraceMark('built') // TEMP
      if (unmountedRef.current || previewSyncGenerationRef.current !== myGeneration) return
      if (stage) {
        // Everything below this point describes the project that is
        // PLAYING -- the phone's copy of the loop, the slot-index mapping
        // the live gain drags address through, the master re-assertions,
        // the empty-to-playing transition, the warm pass over the muted
        // slots. None of it is true of a project that is not live yet, and
        // all of it happens anyway on the load-project that follows the
        // commit at the wrap. So a stage stops here.
        if (!stillOwnEngine(engineToken)) return
        // The last word on whether this swap is still wanted: cancelling
        // clears the ref, so a pick that was locked, muted or removed
        // while this was building never reaches the socket at all.
        if (radioStageRef.current?.token !== stage.token) return
        radioStageRef.current.sent = true
        radioStageRef.current.mapping = {
          groupId: rifff.groupId,
          slotIndexById: new Map(members.map(({ id }, i) => [id, i + 1]))
        }
        radioTraceStageSent(stage.token, stage.label, stage.atPos, stage.loopBars) // TEMP
        await window.rifffApi.engineStageProject(stage.token, project, stage.atBars)
        return
      }
      // The phone gets the loop whether or not the Mac's engine is showing
      // it -- pushed BEFORE the ownership gate below on purpose, so a
      // Discover panel that has lost the engine to something else still has
      // something to hand the sofa. Main strips the plugins, fingerprints it
      // and renders it on demand; nothing here blocks on any of that.
      // `members` carries each slot's own id and is the SAME array, in the
      // same order, that assembleDiscoverRifff numbered slots 1..N from --
      // so this is exactly one slot id per EngineStem, from one snapshot.
      // Main pairs a phone row to its stem's audio from it, and drops the
      // whole pairing if the two lengths ever disagree.
      void window.rifffApi.setRemoteLoop(
        project,
        members.map(function (m) {
          return m.id
        })
      )
      radioTraceMark('remote') // TEMP
      if (!stillOwnEngine(engineToken)) return

      radioTraceMarkPush() // TEMP -- numbers this push for the engine's own line
      await window.rifffApi.engineLoadProject(project)
      radioTraceMark('acked') // TEMP
      if (unmountedRef.current || previewSyncGenerationRef.current !== myGeneration) return
      if (!stillOwnEngine(engineToken)) return

      currentPreviewMappingRef.current = {
        groupId: rifff.groupId,
        slotIndexById: new Map(members.map(({ id }, i) => [id, i + 1]))
      }

      // The mapping is fresh and load-project has just called
      // liveOverrides().clearAll() (IpcServer.cpp:259), so this is the
      // moment to re-assert the master fader -- and the only thing that
      // stops it snapping back to unity on every layer change. It is also
      // what un-sticks it after a duck: while a volume curve is on a stem
      // the override is ignored, and the sync that clears the curve is the
      // sync that writes the override again.
      pushMasterLevel()
      // Same moment, same reason: clearAll() has just dropped the master
      // filter's two live values too, and re-asserting is what keeps a
      // sweep in progress from stepping back to whatever the project this
      // sync happened to carry.
      pushMasterFilter()

      // Warm the engine for every resolved slot that is NOT in the mix --
      // the muted ones.
      //
      // Direct report, 2026-09-28: "channel 3 was muted at start -- the
      // transition is trying to load it just in time, but it should
      // pre-load it." He is right, and a muted slot was doubly cold.
      // radioEligibleSlotIds requires `audible`, so radio never picks a
      // muted layer and its own prefetch never warms one; and a muted
      // slot is left out of `members`, so it never appears in a project
      // either, which is the only other way the engine ever hears about a
      // stem. Unmuting therefore paid a full read+decode inside
      // setProject, on the engine's message thread. Visible in the engine
      // log as the one radio-era `decodes 1 of 4 stems`.
      //
      // Deliberately AFTER the load-project above, never before: this is
      // a hint for a layer nobody is listening to yet, and it must not be
      // able to delay the change someone IS listening to. Idempotent --
      // the engine's buffer cache is keyed by path and never evicted, so
      // a stem already warm costs one no-op message.
      for (const [slotId, stem] of resolvedStemsRef.current) {
        if (ids.has(slotId)) continue
        void warmEngineBuffer(stem, bpm, resolveStretchedForPlayback, (p, durationSec) =>
          window.rifffApi.enginePreloadStem(p, durationSec)
        )
      }

      // Only on the empty-to-non-empty transition -- a later rebuild of an
      // already-loaded preview just keeps playing through it, matching every
      // other "audition something else" flow in this app (no auto-resume once
      // a preview stops).
      if (!previewLoadedRef.current) {
        previewLoadedRef.current = true
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
      radioTraceMark('resolved') // TEMP (2026-09-28), remove with radioTrace.ts
      // The swap this slot's commit was holding every push for has landed.
      // Before the writes below, so the sync they schedule is the one that
      // goes out. The null branch deliberately does NOT release: it is the
      // "mid-reroll, new candidate landed but not resolved yet" window --
      // exactly the window the hold exists to cover.
      releaseSyncHold(id)
      resolvedStemsRef.current.set(id, stem)
      resolvedBarLengthsRef.current = new Map(resolvedBarLengthsRef.current).set(id, stem.barLength)
      setResolvedBarLengths((prev) => {
        const next = new Map(prev)
        next.set(id, stem.barLength)
        return next
      })
      const currentlyPreviewing = previewingSlotIdsRef.current
      if (!currentlyPreviewing.has(id)) {
        scheduleSyncPreviewToEngine(joinPreviewingMix(id))
        return
      }
      scheduleSyncPreviewToEngine(currentlyPreviewing)
      return
    }
    // Direct reports, 2026-09-17: "sometimes it stops the playback, and
    // then starts all of the loops from the beginning" + "sometimes the
    // waveforms blink away, like they're refreshing." Root cause: this
    // row's own resolvedStem effect (DiscoverSlotRow, below) fires
    // onResolvedChange(null) for the ENTIRE "mid-reroll, new candidate
    // landed but not resolved yet" window -- true for EVERY reroll, not
    // just failures/removals. This branch used to delete this slot's own
    // resolvedStemsRef/resolvedBarLengthsRef entry outright whenever that
    // happened, which could (a) drop `members` to empty mid-reroll if this
    // was the only resolved+previewing slot -- triggering
    // restorePreviewIfLoaded's own pause+seek-to-0+play sequence, an
    // audible full restart -- and (b) shrink maxBarLength (the loop length
    // the playhead and every row's loop-top lines are drawn against) for the
    // whole resolve window whenever the rerolling slot
    // happened to be the longest one, snapping the engine's own loop-wrap
    // position back to 0 (Transport.cpp's own `pos >= loopEnd` wrap) and
    // remounting every other row's tiles (see their own key comment above).
    //
    // Now a deliberate no-op: keeps playing/showing this slot's LAST
    // resolved stem through a reroll's own resolve window instead of
    // yanking it out and back -- "imagine it a live composition tool...
    // ensure it's smooth and doesn't interrupt the flow," a direct
    // request. Genuine removal (the one case that really does need this
    // slot's entries gone for good) is handled entirely by removeSlot
    // itself now, not by this branch -- see its own doc comment.
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
      // mutation. (react-hooks/immutability no longer reports it and the
      // eslint-disable that used to sit here became an "unused directive"
      // warning of its own, so it is gone. If the rule starts firing again
      // after some later edit, the paragraph above is the justification for
      // putting it back.)
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
      // Times the master, or dragging one slot while the master is down
      // would push that one slot back up to its unscaled gain.
      scheduleLiveParamSync(
        'volume',
        stemKey(mapping.groupId, slotIndex),
        gain * (masterLevelRef.current / 100)
      )
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

  // --- radio mode (docs/superpowers/specs/2026-09-26-radio-mode-design.md)
  //
  // Radio is Discover with a clock: while the preview plays, one unlocked,
  // audible layer rerolls on its own every so often. Everything schedulable
  // lives in @shared/radioSchedule; what is here is the wiring.
  const [radioOn, setRadioOn] = useState(false)
  // Synchronously-current mirror of radioOn, for the same stale-closure
  // reason previewingSlotIdsRef and slotsRef exist: armRadioPick awaits a
  // real IPC round trip and must see a switch-off that happened during it.
  // Mirrored through an effect, NOT by assigning during render -- this
  // repo's react-hooks/purity rule rejects a render-time ref write, and
  // slotsRef above already establishes the effect form as this file's
  // pattern. stopRadio also sets it synchronously on switch-off, so a
  // stop takes effect before the next tick rather than a render later.
  const radioOnRef = useRef(false)
  useEffect(() => {
    radioOnRef.current = radioOn
  }, [radioOn])

  // Radio holds the ambient background scans off for as long as it runs.
  //
  // Two separate reasons, both measured 2026-09-28 on Elling's own
  // library. The bigger one is memory: DiscoverLibraryScan decodes 3
  // stems every 500ms for the whole session, each costing a whole-file
  // read plus an AudioBuffer -- megabytes apiece -- and the renderer
  // reached a 4GB heap and died of "Ineffective mark-compacts near heap
  // limit" after seven minutes of radio, with ~1s mark-compact pauses on
  // the way up. The smaller one is that those pauses land on the main
  // thread radio needs to get a change out on the downbeat.
  //
  // A hold, not a stop: backgroundScanGate's own contract is that a scan
  // finding the gate closed reschedules the same batch rather than
  // skipping it, so nothing is dropped and the scan resumes exactly where
  // it was the moment radio stops. What this DOES change is when a big
  // library finishes classifying, which is why it is said out loud in the
  // transport menu's own scan row rather than only here.
  useEffect(() => {
    if (!radioOn) return
    return backgroundScanGate.hold()
  }, [radioOn])
  // The live clock. A REF, not state: it is written from the position-tick
  // effect below at ~30Hz and re-rendering the whole panel for each tick
  // would be pointless (the panel already re-renders at that rate for the
  // playhead, and this value is read, not displayed, except through
  // radioProgress below which is derived at render time).
  const radioClockRef = useRef<RadioClock | null>(null)
  // What radio will play next, chosen a whole interval early so
  // resolveCandidateStem's module-level cache has time to warm (spec 2.4).
  //
  // `incomingBars` is that pick's own bar length, filled in by the same
  // warm that downloads it, and null until then. It is what stops the
  // loop-end threshold being decided from the OUTGOING layer alone: a
  // slot holding a 2-bar hat can draw an 8-bar pad next, and dropping
  // that pad in on the hat's 2-bar boundary is exactly the cut 687641a
  // describes. See radioChangeBars.
  /** Bumped by every armRadioPick; see there. */
  const radioArmTokenRef = useRef(0)
  // Rows radio's skip is picking a stem for (skipRadio), before the pick is
  // queued as a manual change -- radio arms nothing meanwhile.
  const radioSkipPickingRef = useRef<Set<string>>(new Set())
  /** Rows still to turn over after a mid-radio artist change -- one per
   * loop top, through skipRadio (@shared/discoverArtist artistTurnoverIds). */
  const artistTurnoverRef = useRef<Set<string>>(new Set())
  // The density arc (@shared/radioDensity): its current leg, the row it is
  // bringing in (still picking, then waiting in the manual queue), the row
  // it is taking out, and a count of loop tops so an exit knows its lap.
  const densityLegRef = useRef<DensityLeg | null>(null)
  const arcAddingRef = useRef<{ slotId: string; picking: boolean } | null>(null)
  const arcExitRef = useRef<{ slotId: string; phase: 'waiting' | 'fading'; lap: number } | null>(
    null
  )
  const arcLapRef = useRef(0)
  const radioPendingRef = useRef<{
    slotId: string
    pick: SlotPick
    incomingBars: number | null
    /** The warmed stem itself, filled in by the same warm that fills in
     * incomingBars, and null until then. Kept alongside the bar length
     * rather than re-derived later because a staged swap has to BUILD a
     * project out of it, and the only other way to get it back is
     * resolveCandidateStem's promise -- which is settled and free when
     * the warm worked, and a whole download when it did not. Null here
     * is therefore also the honest answer to "is this pick cold", which
     * is what stops a stage being aimed at a stem that is not there. */
    stem: ResolvedCandidateStem | null
  } | null>(null)
  // The RENDERABLE half of radioPendingRef: just which slot it names.
  //
  // Direct report, 2026-09-29: "i don't see any preparatory blinking on
  // the channels about to transition... right now it just drops when the
  // loop ends and everything seems cramped for time." The information was
  // already here and had been for a whole interval -- it was simply in a
  // ref, and a ref is invisible to render by construction. This is state
  // so a row can be drawn from it; see setRadioPending just below for why
  // it is a mirror rather than a replacement.
  const [radioArmedSlotId, setRadioArmedSlotId] = useState<string | null>(null)
  /** THE ONLY WAY radioPendingRef IS WRITTEN. The ref stays the source of
   * truth -- it is read synchronously from the 30Hz clock effect and from
   * armRadioPick across a real IPC await, both of which need the CURRENT
   * value and not a render-old one -- and the state is a strictly derived
   * shadow of it that exists only so the row can draw.
   *
   * The state write is deferred through a resolved promise for the reason
   * every other setState this file makes from the clock effect is: this
   * repo ERRORS on a synchronous setState inside an effect
   * (react-hooks/set-state-in-effect), and two of this function's callers
   * are the clock effect's own body. Microtasks are FIFO, so a tick that
   * clears the pending pick and then holds a change still lands those two
   * writes in that order. */
  function setRadioPending(
    next: {
      slotId: string
      pick: SlotPick
      incomingBars: number | null
      stem: ResolvedCandidateStem | null
    } | null
  ): void {
    radioPendingRef.current = next
    const slotId = next?.slotId ?? null
    void Promise.resolve().then(() => setRadioArmedSlotId(slotId))
  }
  // Which slot radio changed last -- so it never changes the same one
  // twice running (pickRadioSlotId).
  const radioLastSlotRef = useRef<string | null>(null)
  // Per-slot recency for `even` turnover, and the turn counter it is
  // measured against. A LOGICAL turn, not wall time: it advances once per
  // committed change, so it stops with the transport for free, exactly the
  // way the clock does.
  //
  // Written in commitSlotPick rather than in radio's own commit branches,
  // which is deliberate and is where the pruning lives too -- see the note
  // there. Refs, not state: they are read synchronously from armRadioPick
  // across a real IPC await, and nothing renders them.
  const radioChangedAtRef = useRef<Map<string, number>>(new Map())
  const radioTurnRef = useRef(0)
  // The row's two radio controls -- hold longer (hook) and change next
  // (replace soon). See
  // src/shared/radioSlotFlags.ts, which owns every rule about it and the
  // reasoning for each one.
  //
  // State AND a ref, the same pairing radioPendingRef/radioArmedSlotId
  // uses just above: the rows render from the state, and armRadioPick
  // reads the ref because it runs from the 30Hz clock effect's closure,
  // which can be a render behind.
  //
  // NOT PERSISTED. Slot ids are minted fresh each session (freshSlotId),
  // so a stored flag would name a slot that does not exist.
  const [radioSlotFlags, setRadioSlotFlags] = useState<RadioSlotFlags>(NO_RADIO_SLOT_FLAGS)
  const radioSlotFlagsRef = useRef<RadioSlotFlags>(NO_RADIO_SLOT_FLAGS)
  useEffect(() => {
    radioSlotFlagsRef.current = radioSlotFlags
  }, [radioSlotFlags])
  // The armed GESTURE -- a standalone drop-out (no stem change) or a
  // transition (one attached to a change). Both are the same thing to the
  // engine: curves written into the preview project, armed a lap early and
  // cleared a lap later. Elling, 2026-09-28: "also make sure to transition
  // on the proper beat... that's key" / "not just the downbeat, the proper
  // start of the loop, i think".
  //
  // A REF, for the same reason radioClockRef is one -- it is written from
  // the 30Hz position effect and nothing renders it.
  //
  // A curve is clip-relative and the transport wraps at loopLengthBars, so
  // it can ONLY be anchored to the top of the loop. The constraint is the
  // requirement, and it is why nothing here reads the clock at the moment
  // the gesture fires: arming is not timing-critical, only the
  // performance is, and the engine already holds the curve by then.
  //
  // `beats` is fixed when the gesture is armed rather than re-drawn on
  // every sync: the curve IS rebuilt on every sync (maxBarLength can
  // change under it when another slot resolves), and a re-drawn length
  // would make one gesture change duration mid-lap.
  //
  // `lapsLeft` counts laps, not milliseconds: the curve fires at the top
  // of the loop it is armed for, so it is cleared on the NEXT wrap after
  // that. Arming early is free (spec 0A); leaving it armed a lap too long
  // is NOT harmless -- the curve repeats every lap, so a second lap would
  // turn one gesture into a rhythm. Hence the countdown in the wrap branch
  // of the clock effect below.
  //
  // A LIST since the manual queue (2026-09-29): several rows landing at one
  // wrap may each carry an arrival curve, and every one of them has to
  // survive the push that follows the commit. Radio alone never puts more
  // than one entry here. At most ONE entry is ever a leading gesture (a
  // hole, a riser or a standalone drop-out) -- every path that arms one
  // checks that none is armed first. Empty is "nothing armed".
  const radioGestureRef = useRef<RadioGesture[]>([])
  // A change that is WAITING for the loop top, because the gesture it
  // carries can only be performed there.
  //
  // Both halves of the palette end up here, for the one reason
  // radioChangeWaitsForLoopTop spells out: every curve in
  // radioTransition.ts is anchored at bar 0 and cannot be anywhere else,
  // so a change carrying ANY gesture has to land at bar 0 or the gesture
  // is not heard. What differs is what is already armed while the change
  // waits:
  //
  //   - a LEADING gesture (`hole`, `riser`) is armed the moment the pick
  //     is held, on the OUTGOING stem, and plays out over the bars before
  //     the wrap -- the gap the new layer lands in, the sweep into the
  //     moment. `arrival` is undefined for these.
  //   - an ARRIVAL gesture (`filter in`, `bloom`, `duck`) is armed AT the
  //     wrap, together with the commit, because its curve belongs to the
  //     stem that is arriving (or, for a duck, to every other layer). It
  //     rides here as `arrival` until then, and nothing is armed in the
  //     meantime -- the lap before a sweep is supposed to be ordinary.
  //
  // An arrival change only lands here when the boundary it came due on
  // was NOT already the loop top; one due at the top commits on the spot
  // through the ordinary path below. And a `cut` never lands here at all.
  // See radioChangeWaitsForLoopTop for why those two carve-outs are what
  // keep the pace where it was tuned.
  //
  // Same shape and the same landing site as radioCourseChangeRef, for the
  // same reason: the transport does not reset for a load-project, so the
  // wrap is the one instant every stem is at its own zero.
  const radioLedChangeRef = useRef<{
    slotId: string
    pick: SlotPick
    arrival?: { kind: RadioTransitionKind; beats: number }
    /** The incoming stem, carried over from the pick so a staged swap can
     * build a project out of it without a second resolve. Null when the
     * warm never landed -- such a change cannot be staged and falls back
     * to today's commit-at-the-wrap. */
    stem: ResolvedCandidateStem | null
    /** True when stepRadioStage DECIDED this change early, rather than
     * the due branch holding it back for a gesture.
     *
     * It is what says who owns the clock. The due branch restarts the
     * interval where it fires, and an early decision has not fired yet --
     * so an early one restarts the clock when it LANDS instead. Without
     * that split the pace would silently quicken by up to a lap per
     * change, which is the one thing this feature is not allowed to
     * change (see DEFAULT_RADIO_LOOP_END_BARS on why the pace is where it
     * is). */
    early?: boolean
    /** The bar of the current lap this change lands on, when that is not
     * the loop top -- radio's bare cuts, turning over on their own 2- or
     * 4-bar boundary (radioChangeLandsAtBar). Undefined is the loop top,
     * which is every other held change and every one there was before
     * the engine could land a swap anywhere else.
     *
     * It is both what goes out with the stage (stage-project's `atBars`)
     * and what the landing branch below watches the playhead cross --
     * they have to be one number, or the engine would swap at a moment
     * the panel commits somewhere else. */
    atBars?: number
  } | null>(null)
  // The renderable half of radioLedChangeRef, exactly as radioArmedSlotId
  // is of radioPendingRef -- and the more urgent of the two to draw: a
  // held change is not "coming", it lands at the very next wrap. See
  // @shared/radioApproach for the two states and why the row reads them
  // as two depths of the same fade rather than as two measurements.
  const [radioHeldSlotId, setRadioHeldSlotId] = useState<string | null>(null)
  /** THE ONLY WAY radioLedChangeRef IS WRITTEN -- same contract, same
   * deferral and the same reason as setRadioPending above. */
  function setRadioLedChange(
    next: {
      slotId: string
      pick: SlotPick
      arrival?: { kind: RadioTransitionKind; beats: number }
      stem: ResolvedCandidateStem | null
      early?: boolean
      atBars?: number
    } | null
  ): void {
    radioLedChangeRef.current = next
    const slotId = next?.slotId ?? null
    void Promise.resolve().then(() => setRadioHeldSlotId(slotId))
  }
  // MANUAL CHANGES WAITING FOR THE LOOP TOP (2026-09-29). While radio runs,
  // a reroll, a nearby pick, an added or duplicated row does not commit on
  // the spot: it waits here, fully warmed, and lands with radio's own
  // change in one staged swap at the next wrap, with a transition. See
  // docs/superpowers/specs/2026-09-29-radio-manual-changes-land-on-the-top-
  // design.md. A REF because the 30Hz clock effect reads it; the Set
  // below is its renderable half, the same split radioLedChangeRef /
  // radioHeldSlotId use.
  const manualChangesRef = useRef<
    Map<
      string,
      {
        pick: SlotPick
        stem: ResolvedCandidateStem | null
        joining: boolean
        arrival: ManualArrival | null
        /** The latest undo sequence number when this was queued -- see
         * markUndoSnapshot. An undo to a snapshot numbered at or below it
         * takes this change back. */
        undoSeq: number
        /** Queued by radio's skip (skipRadio): it lands as radio's change
         * for its row, restarting radio's interval from the landing, and
         * radio arms nothing while it waits. */
        radioSkip?: boolean
      }
    >
  >(new Map())
  // See markUndoSnapshot. An object held in state (created once, never
  // set) rather than counters in refs: ref writes inside pushUndoSnapshot,
  // which the phone's command effect reaches, trip react-hooks/immutability
  // across this whole component (the cascade runSlotAction's comment
  // describes).
  const [undoSequence] = useState(() => new UndoSnapshotSequence())
  const [manualWaitingSlotIds, setManualWaitingSlotIds] = useState<ReadonlySet<string>>(new Set())
  /** THE ONLY WAY manualChangesRef IS WRITTEN -- same deferral and reason
   * as setRadioLedChange. */
  function setManualChanges(next: typeof manualChangesRef.current): void {
    manualChangesRef.current = next
    const ids = new Set(next.keys())
    void Promise.resolve().then(() => setManualWaitingSlotIds(ids))
  }
  // --- the scheduled swap (2026-09-29) ---
  //
  // THE PROBLEM. A radio change was late by construction. Measured on
  // Elling's machine with the engine completely warm (`setProject 0.0 ·
  // decodes 0 of 4 stems · handler 0.6ms`) the project still always
  // arrived AFTER the loop top it was meant for -- 0.020 to 0.065 bar
  // warm, up to 0.222 cold. Nothing in the renderer could fix that,
  // because the renderer only starts work at the boundary: the tick that
  // notices it is already up to 33ms past it, and commit -> render ->
  // resolve -> rAF -> build -> IPC all runs after the instant the stem
  // should have started. Five rounds of optimisation moved it by nothing
  // worth hearing. See the memory note radio-swap-is-late-by-
  // construction.
  //
  // THE ANSWER, which is the engine's: stage-project hands the engine a
  // whole project early and the engine itself swaps to it at the next
  // loop wrap, on the audio thread, sample-exact. The renderer's job is
  // to get the right project there DURING the lap that ends at the right
  // wrap -- a lap early and it would be taken by the wrong wrap, at the
  // wrap itself and we are back where we started.
  //
  // WHICH CHANGES THIS CAN BE. Not all of them, and deliberately so.
  // radioGridBars lets a layer of DEFAULT_RADIO_LOOP_END_BARS bars or
  // shorter turn over on its own 2- or 4-bar boundary, and a `cut`
  // carries no gesture and so is explicitly free to land there -- that
  // is where the eagerness Elling asked for lives ("even fast feels
  // quite slow now.. i think it's the transition rules"). Those keep
  // landing mid-loop on today's load-project. Simulated against these
  // very functions on his own archive's stem-length distribution, that
  // is about one change in twenty; the rest land at a loop top and are
  // staged.
  //
  // WHY IT HAS TO PREDICT. Radio already knows a lap ahead about the
  // changes it deliberately holds for a gesture (radioLedChangeRef), but
  // those are only about a quarter of the ones that land at a loop top.
  // The other three quarters come due AT a wrap and are decided on the
  // tick that discovers it -- no lead time at all, nothing to stage. So
  // stepRadioStage below looks forward instead: radioChangeDueAtNextWrap
  // asks whether the coming wrap is the boundary the next change will
  // come due on, and if it is, the whole decision is brought forward into
  // this lap. That is the difference between a quarter of changes
  // getting better and nineteen in twenty.
  const radioStageRef = useRef<{
    token: number
    /** Every row this stage changes -- radio's own, and every manual one. */
    slotIds: string[]
    /** RADIO's own row in this stage, or null when the stage carries none
     * (manual changes only, or a manual change on radio's row, which
     * wins). The per-tick eligibility withdraw in stepRadioStage checks
     * only this one: a manual change ignores padlock and mute (spec
     * behaviour 6), and only removing its row withdraws it. */
    ledSlotId: string | null
    /** The manual queue ENTRIES this stage carries (slot id -> the entry
     * object itself), or null when it carries none. See
     * radioStageAppliedManualRef. */
    manual: ReadonlyMap<string, object> | null
    /** False between the decision and the socket write. The window is
     * short but it is real -- the staged project still has to be built,
     * which means buildEngineProject's stretch resolution -- and two
     * things depend on telling the two states apart: a withdrawal must
     * not send a cancel for a token the engine has never heard of (it
     * would be ignored, and then the stage would arrive AFTER it and
     * stick), and a build that bails out before sending has to let go of
     * this ref or radio would never stage anything again. */
    sent: boolean
    /** The staged project's own groupId and slot numbering, so the master
     * fader and filter can be re-asserted against the RIGHT stem keys the
     * moment it goes live. A fresh groupId is minted on every build, so
     * the live mapping still describes the outgoing project until then. */
    mapping: { groupId: string; slotIndexById: Map<string, number> } | null
  } | null>(null)
  // Monotonic, never reused. The token exists because EngineClient
  // matches replies by message TYPE rather than by request id, so two
  // swaps in flight would otherwise cross their acks.
  const radioStageTokenRef = useRef(0)
  /** A staged swap the wrap branch has already watched land, still
   * waiting for its project-applied.
   *
   * Two 30Hz streams notice the same wrap: this panel's position ticks,
   * and the engine's own message thread. Which one gets there first is a
   * coin flip, so the ack routinely arrives AFTER the branch below has
   * finished with radioStageRef -- and the ack is what re-asserts the
   * master fader and installs the staged project's slot numbering. This
   * is where the branch leaves those for it. */
  const radioStageLandedRef = useRef<{
    token: number
    mapping: { groupId: string; slotIndexById: Map<string, number> } | null
  } | null>(null)
  /** The held change the engine has ALREADY swapped in, when its
   * project-applied beat the wrap tick here.
   *
   * The other half of the race radioStageLandedRef describes. When the ack
   * wins, it lets go of radioStageRef before the wrap branch has landed the
   * change -- and the position tick that arrives between them is still a
   * pre-wrap one (15.9 of 16), carrying a held change and no stage. Step
   * (3) of stepRadioStage read that as "held, never sent" and staged the
   * very same change a second time. Seen on every other change in the
   * 2026-09-29 gate trace; harmless only because the commit's own push
   * then cancelled it. Compared by identity, so a stale value is inert the
   * moment radioLedChangeRef moves on. */
  const radioStageAppliedLedRef = useRef<object | null>(null)
  /** The same guarantee for the manual queue: the entries a staged swap
   * carried when its project-applied beat the wrap tick. Without it the
   * pre-wrap tick in between would find ready manual changes and no
   * stage, and stage the very same set a second time -- the bug
   * radioStageAppliedLedRef exists for, in its manual form.
   *
   * Per ENTRY, by identity, rather than the whole queue: a stage carries
   * only the entries that were ready, so the queue itself moves on (an
   * entry still resolving becomes ready) while the applied ones are still
   * waiting for the wrap tick. An entry is replaced whenever it changes and
   * leaves the queue when it lands or its row is removed, so a stale value
   * is inert the moment none of its entries is still waiting. Read through
   * appliedManualStillWaiting. */
  const radioStageAppliedManualRef = useRef<ReadonlyMap<string, object> | null>(null)
  function appliedManualStillWaiting(): boolean {
    const applied = radioStageAppliedManualRef.current
    if (applied === null) return false
    for (const [slotId, entry] of applied) {
      if (manualChangesRef.current.get(slotId) === entry) return true
    }
    return false
  }

  /** Withdraws the staged swap, if there is one.
   *
   * Radio re-checks a pick's eligibility late -- the slot may have been
   * locked, muted or removed since the pick was made -- and a stale
   * staged swap must never fire. cancel-staged-project is the engine's
   * side of exactly that.
   *
   * Note what this does NOT guarantee: the audio thread may be taking the
   * staged project at this very moment, in which case the engine answers
   * `applied` rather than `cancelled` and the swap happens anyway. Only
   * the engine can know, which is why every caller here also puts the
   * renderer's own truth back on the wire rather than assuming the
   * withdrawal won. */
  function cancelStagedSwap(reason: string): void {
    const staged = radioStageRef.current
    if (staged === null) return
    radioStageRef.current = null
    radioTraceStageFallback(staged.token, reason) // TEMP (2026-09-29)
    // Only if the engine has actually been told about it. Dropping the
    // ref is what stops the build below from ever sending (it re-reads
    // this ref in the line before the write, with no await in between),
    // so there is nothing out there to withdraw.
    if (staged.sent) void window.rifffApi.engineCancelStagedProject(staged.token)
  }

  // An armed COURSE CHANGE: every eligible layer's next pick, already
  // resolved and warmed, waiting for the next loop top to land together.
  //
  // Elling, 2026-09-28: "otherwise changing course should reset the whole
  // thing. okay to have it be dramatic." A new pace is not a re-tuning of
  // the running clock -- it is a new section. The clock restarts at once
  // (so the progress rule says something happened) and the whole unlocked
  // bed turns over on the next wrap.
  //
  // A REF for the same reason radioClockRef is one: written from an event
  // handler and read from the 30Hz position effect, never rendered.
  const radioCourseChangeRef = useRef<{ slotId: string; pick: SlotPick }[] | null>(null)
  // Takes the armed gesture off the stems and rebuilds the preview without
  // it. Called from every path that ends one -- the lap countdown, a led
  // change landing, radio switching off, the panel unmounting.
  //
  // Load-bearing rather than tidy-up: a `volume` curve makes EngineStem
  // .volume inert (PlaybackEngine.cpp's volumeAutomated branch), so a
  // curve left behind on a stem nothing is gesturing on would quietly stop
  // that slot's gain drag reaching the engine live. A `duck` writes one on
  // every OTHER audible layer at once, so the same mistake there would
  // take the whole bed's gain dials with it. Never leave a curve on a stem
  // that is not mid-gesture.
  function clearRadioGesture(): void {
    if (radioGestureRef.current.length === 0) return
    radioGestureRef.current = []
    scheduleSyncPreviewToEngine(previewingSlotIdsRef.current)
  }
  /** The loop length once these rows have turned over -- the preview's
   * maxBarLength with each landing row's incoming stem in place of its
   * outgoing one, the same substitution syncPreviewToEngine makes for a
   * stage (stagedBarLengths). A row whose incoming length is not known
   * yet keeps the length it has. */
  function loopBarsAfterLanding(
    landing: readonly { slotId: string; bars: number | null | undefined }[]
  ): number {
    const lengths = new Map(resolvedBarLengthsRef.current)
    for (const { slotId, bars } of landing) {
      if (typeof bars === 'number' && bars > 0) lengths.set(slotId, bars)
    }
    return lengths.size > 0 ? Math.max(...lengths.values()) : 0
  }
  /** The interval's one drop-out roll (rollIntervalDropOut), made wherever
   * an interval starts: a held change landing, early or not, and the due
   * branch. `changedSlotId` is the row this interval's change turned over
   * (or was aimed at), which is never the one dropped.
   *
   * Until 2026-09-30 the roll lived in the due branch alone, and the early
   * decision (e5810f4) pre-empts that branch whenever the pick is warm --
   * so drop-outs had all but stopped.
   *
   * No pushUndoSnapshot, for the same reason a radio change takes none: a
   * drop-out is performance, not an edit. */
  function rollRadioDropOut(changedSlotId: string | null, pos: number, loopBars: number): void {
    const clock = radioClockRef.current
    if (clock === null) return
    const roll = rollIntervalDropOut({
      rate: radioSettings.dropOuts,
      audible: slotsRef.current
        .filter((s) => previewingSlotIdsRef.current.has(s.id))
        .map((s) => ({ id: s.id, kinds: s.kinds })),
      changedSlotId,
      gestureArmed: radioGestureRef.current.length > 0,
      clock,
      pos,
      loopBars
    })
    if (roll === null) return
    radioGestureRef.current = [
      { kind: 'drop-out', slotId: roll.slotId, beats: roll.beats, lapsLeft: 1 }
    ]
    scheduleSyncPreviewToEngine(previewingSlotIdsRef.current)
  }
  /** Everything the scheduled swap does on one position tick, in the one
   * order it is safe to do it in. Called from the clock effect below,
   * after the two branches that LAND a change and before the one that
   * decides one.
   *
   * Three jobs, and they are separate on purpose:
   *
   *   1. WITHDRAW a staged swap whose slot has stopped being eligible.
   *      The re-check is per tick rather than only at the wrap because
   *      the audio thread takes a staged project AT the wrap, a good 30ms
   *      before this effect could possibly notice -- by the wrap it is
   *      already too late to stop it.
   *   2. DECIDE a change early, when radioChangeDueAtNextWrap says the
   *      coming wrap is the boundary it will come due on. This is the
   *      predictive half, and the transition has to be drawn HERE rather
   *      than at the wrap: a `hole` or a `riser` makes the change wait
   *      another whole lap, and a staged project cannot be re-aimed once
   *      the audio thread has taken it. Drawing it early costs nothing
   *      musically -- every curve in radioTransition.ts is anchored to
   *      the loop, so arming one earlier in the same lap plays it in
   *      exactly the same place, and a `hole` (buildDropOutCurve, which
   *      leaves at loopBars - dropBars) is actually MORE reliable for it:
   *      one armed at bar 7 of 8 today has its gap already behind the
   *      playhead.
   *   3. PUSH whatever is held and not yet staged. Split from (2) so that
   *      the changes radio was already holding for a gesture get staged
   *      too, and so that a leading gesture's own load-project always
   *      goes out on an earlier tick than the stage that follows it --
   *      a load-project overtaking a stage on the socket makes the engine
   *      drop the stage outright (resolveStagedBefore("load-project")).
   *
   * NOTHING here commits anything. The commit stays exactly where it was,
   * in the wrap branch below, which is what keeps the row's "a change is
   * coming" honest, the undo stack untouched and the fallback free: if
   * the stage is withdrawn, errors, or never goes out at all, the change
   * still lands the way it does today. */
  function stepRadioStage(
    due: boolean,
    pos: number,
    loopBars: number,
    gridBars: number,
    skipStage = false
  ): void {
    const staged = radioStageRef.current
    // RADIO's own row only -- a manual change in the same stage is not
    // withdrawn by a padlock or a mute (spec behaviour 6). Withdrawing
    // the stage still takes the manual rows out with it; step (3)
    // re-stages them on its next tick, without radio's.
    if (
      staged !== null &&
      staged.ledSlotId !== null &&
      !radioEligibleSlotIds().includes(staged.ledSlotId)
    ) {
      cancelStagedSwap('no-longer-eligible')
      setRadioLedChange(null)
      // Same as the wrap branch's own re-check failing: nothing landed,
      // so arm a fresh pick straight away rather than burning an
      // interval. Deferred for the reason every setState out of this
      // effect is -- pickForSlot writes state before its first await.
      void Promise.resolve().then(() => {
        if (radioOnRef.current) void armRadioPick()
      })
      return
    }

    // TEMP (2026-09-29): which gate is holding the swap, so a paste says
    // why a change was staged late. Remove with radioTrace.ts.
    {
      const pending = radioPendingRef.current
      const clock = radioClockRef.current
      const led = radioLedChangeRef.current
      // The first armed gesture still playing, which is what holds (2).
      const gesture =
        radioGestureRef.current.find((g) => !radioArrivalGestureSpent(g, pos, loopBars)) ?? null
      const manual = manualChangesRef.current
      const gate =
        radioStageRef.current !== null
          ? radioStageRef.current.sent
            ? 'staged'
            : 'building'
          : led !== null
            ? led === radioStageAppliedLedRef.current
              ? 'held:engine-already-swapped'
              : led.stem === null
                ? 'held:no-stem'
                : !previewLoadedRef.current
                  ? 'held:preview-not-loaded'
                  : liveSyncInFlightRef.current > 0
                    ? 'held:push-in-flight'
                    : pendingSyncRafRef.current !== null
                      ? 'held:raf-pending'
                      : syncHoldRef.current.size > 0
                        ? 'held:sync-hold'
                        : 'held:ready'
            : manual.size > 0
              ? `manual:${[...manual.values()].filter((m) => m.stem !== null).length}/${manual.size}-ready`
              : due
                ? 'due-now'
                : radioCourseChangeRef.current !== null
                  ? 'course-change'
                  : gesture !== null
                    ? `gesture:${gesture.kind}`
                    : pending === null
                      ? 'no-pending'
                      : pending.stem === null
                        ? 'pending:no-stem'
                        : !radioEligibleSlotIds().includes(pending.slotId)
                          ? 'pending:ineligible'
                          : clock === null
                            ? 'no-clock'
                            : radioChangeDueAtNextWrap(
                                  clock,
                                  pos,
                                  loopBars,
                                  gridBars,
                                  radioSettings.phraseBars
                                ) ||
                                radioChangeLandsAtBar(
                                  clock,
                                  pos,
                                  loopBars,
                                  gridBars,
                                  radioSettings.phraseBars
                                ) !== null
                              ? 'decide'
                              : `not-this-lap(interval ${clock.intervalBars} elapsed ${clock.barsElapsed.toFixed(2)})`
      radioTraceStageGate(gate, pos)
    }

    // (2) Decide early. Never on a tick where a change is already coming
    // due: the due branch below is about to make its own decision, and
    // setting a held change in front of it would make that one skip.
    //
    // Nor while a gesture is still PLAYING -- but an arrival gesture that
    // has finished its curve is only waiting for the wrap to take it off,
    // and blocking on it made every change after a bloom, sweep or duck
    // come due at the wrap and land late on the old path (measured
    // 2026-09-29: 62, 525 and 604ms). See radioArrivalGestureSpent.
    //
    // A stage carrying ONLY manual changes does not hold it (2026-09-29):
    // radio must never lose a change to a manual one. Radio decides over
    // it and withdraws it just below, and step (3) re-stages radio's change
    // and the manual ones together. Unless the engine has already swapped
    // that stage in (its ack won the race) -- then the wrap has happened as
    // far as the engine knows, and deciding now would aim at the wrong one.
    const manualOnlyStage =
      radioStageRef.current !== null && radioStageRef.current.ledSlotId === null
    if (
      !due &&
      (radioStageRef.current === null || manualOnlyStage) &&
      !appliedManualStillWaiting() &&
      radioLedChangeRef.current === null &&
      radioCourseChangeRef.current === null &&
      // EVERY armed gesture spent -- true of an empty list, which is the
      // old "nothing armed". A leading gesture is never spent.
      radioGestureRef.current.every((g) => radioArrivalGestureSpent(g, pos, loopBars))
    ) {
      const pending = radioPendingRef.current
      const clock = radioClockRef.current
      // THE TWO BOUNDARIES A CHANGE CAN LAND ON, asked in that order.
      // The wrap first, always, so the nineteen-in-twenty this already
      // covered keep exactly the path they had; the bar only when the
      // wrap says no. The two can never both answer -- they are pinned
      // to each other by test in radioSchedule.test.ts -- so the
      // ordering is belt and braces rather than the guarantee.
      const dueAtWrap =
        clock !== null &&
        radioChangeDueAtNextWrap(clock, pos, loopBars, gridBars, radioSettings.phraseBars)
      const landsAtBar =
        clock !== null && !dueAtWrap
          ? radioChangeLandsAtBar(clock, pos, loopBars, gridBars, radioSettings.phraseBars)
          : null
      if (
        pending !== null &&
        pending.stem !== null &&
        clock !== null &&
        radioEligibleSlotIds().includes(pending.slotId) &&
        (dueAtWrap || landsAtBar !== null)
      ) {
        // The same draw, the same "never a second gesture while one is
        // armed" rule and the same beats table as the due branch below.
        // Only the moment differs.
        const changing = slotsRef.current.find((sl) => sl.id === pending.slotId)
        const transition = pickTransition(radioSettings.transitions, changing?.kinds ?? [])
        const beats = radioGestureBeats(transition, pickDropOutBeats)
        setRadioPending(null)
        if (radioGestureLeadsChange(transition)) {
          // A hole or a riser announces the change over the bars before
          // the wrap, on the OUTGOING stem, so it has to reach the engine
          // as a live project NOW. The swap is staged on a later tick,
          // once that push has gone -- see (3)'s own gate.
          //
          // REPLACES the list rather than adding to it, exactly as the
          // single ref was overwritten: the gate above lets (2) run only
          // when every armed gesture is a spent arrival, and a spent one
          // has nothing left to play.
          radioGestureRef.current = [
            {
              kind: transition,
              slotId: pending.slotId,
              beats,
              lapsLeft: 1
            }
          ]
          setRadioLedChange({
            slotId: pending.slotId,
            pick: pending.pick,
            stem: pending.stem,
            early: true
          })
          scheduleSyncPreviewToEngine(previewingSlotIdsRef.current)
        } else {
          // A cut, or an arrival gesture. Nothing is armed and nothing is
          // pushed live: a cut has no curve at all, and an arrival curve
          // belongs to the stem that has not arrived yet -- arming it
          // now would sweep or bloom the OUTGOING audio for a lap, which
          // is the bug c5612da fixed. It rides into the staged project
          // instead, where its bar 0 and the wrap are the same instant.
          //
          // WHICH BOUNDARY IT LANDS ON is radioChangeWaitsForLoopTop's
          // rule, spelled out as a field rather than called as a branch,
          // because that is the only thing that differs. A bare cut
          // carries no curve, so it may land on the mid-lap bar it came
          // due on -- and the engine can now put it exactly there
          // instead of taking the load-project 20-65ms later. Every
          // arrival gesture is held to the loop top exactly as before:
          // its curve is anchored at bar 0 and structurally cannot be
          // anywhere else, so one armed for bar 4 would already be
          // behind the playhead. Undefined IS the loop top.
          setRadioLedChange({
            slotId: pending.slotId,
            pick: pending.pick,
            stem: pending.stem,
            early: true,
            arrival: transition === 'cut' ? undefined : { kind: transition, beats },
            atBars: transition === 'cut' && landsAtBar !== null ? landsAtBar : undefined
          })
        }
        // A manual-only stage is out: it now carries the wrong set. Withdraw
        // it; step (3) re-stages radio's change with the manual ones on a
        // later tick (or radio's alone first, if it is a cut at a bar).
        if (manualOnlyStage) cancelStagedSwap('radio-joins')
        return
      }
    }

    // (3) Push it. Once -- radioStageRef is the "already out there" flag
    // -- and only when nothing else is on its way to the engine.
    if (skipStage) return
    //
    // WHAT goes out is radio's held change and every manual change waiting
    // for the loop top, as ONE stage (mergeStageChanges): the engine holds
    // one staged project at a time, and they all land at the same wrap.
    // With the manual queue empty every line below reduces to the single
    // held change this always staged.
    const led = radioLedChangeRef.current
    const manual = manualChangesRef.current
    // The engine has ALREADY swapped a stage in and the wrap tick has not
    // landed it yet -- see radioStageAppliedLedRef and
    // radioStageAppliedManualRef. Nothing is staged in that window: a
    // stage sent now would be aimed at the NEXT wrap, while the landing
    // branch commits everything waiting at this one.
    if (led !== null && led === radioStageAppliedLedRef.current) return
    if (appliedManualStillWaiting()) return
    const readyLed = led !== null && led.stem !== null ? { ...led, stem: led.stem } : null
    // A bare cut radio aimed at a mid-lap bar (atBars) goes out ALONE, at
    // its bar. Manual changes land only at the wrap (spec behaviour 8),
    // and one stage has one landing point -- so they wait for the next
    // stage, after this one has landed. Folding them in and moving radio's
    // cut to the wrap would change radio's pace, which the spec forbids,
    // and would leave the landing branch committing the cut at its bar
    // while the engine swapped at the wrap.
    //
    // Only READY manual changes go out (stem resolved). One still resolving
    // holds nothing back -- not radio's change, not the other manual ones --
    // and stays queued: when it becomes ready, queueManualChange withdraws
    // the stage so the next tick re-stages with it, or it lands at a later
    // wrap if there is no time left for that.
    const manualReadyCount = [...manual.values()].filter((m) => m.stem !== null).length
    const withManual = manualReadyCount > 0 && !(readyLed !== null && readyLed.atBars !== undefined)
    if (
      radioStageRef.current !== null ||
      (readyLed === null && !withManual) ||
      !radioOnRef.current ||
      !previewLoadedRef.current ||
      radioCourseChangeRef.current !== null ||
      liveSyncInFlightRef.current > 0 ||
      pendingSyncRafRef.current !== null ||
      syncHoldRef.current.size > 0
    ) {
      return
    }
    if (withManual) {
      // A transition for every manual change that does not have one yet --
      // drawn ONCE, the first time it is staged, and stored back into the
      // queue so a re-stage (after a withdrawal) cannot re-draw it.
      // Ready ones only: a leading gesture drawn for a change that then is
      // not ready at the wrap would play out with nothing arriving.
      const undrawn = [...manual.entries()].filter(([, m]) => m.arrival === null && m.stem !== null)
      if (undrawn.length > 0) {
        const drawn = drawManualTransitions(
          undrawn.map(([slotId, m]) => ({
            slotId,
            kinds: slotsRef.current.find((s) => s.id === slotId)?.kinds ?? [],
            // A joining row has no outgoing stem for a hole or a riser to
            // play on. It takes a cut, and leaves the lap's one leading
            // gesture for a row that can use it.
            canLead: !m.joining
          })),
          {
            pick: (kinds) => pickTransition(radioSettings.transitions, kinds),
            dropOutBeats: pickDropOutBeats,
            // A hole, a riser or a standalone drop-out -- radio's own or an
            // earlier manual one. At most one leading gesture per lap.
            leadingArmed: radioGestureRef.current.some(
              (g) => g.kind === 'drop-out' || radioGestureLeadsChange(g.kind)
            ),
            barsToWrap: loopBars - pos,
            loopBars
          }
        )
        const next = new Map(manual)
        let leading: { slotId: string; arrival: ManualArrival } | null = null
        for (const [slotId, arrival] of drawn) {
          const entry = next.get(slotId)
          if (!entry) continue
          if (radioGestureLeadsChange(arrival.kind)) {
            // A leading gesture plays NOW, live, on the outgoing stem. It is
            // not part of the stage; the stage carries this row as a cut.
            // (A joining row never draws one -- canLead above -- but it
            // is never armed for one either, as belt and braces.)
            if (!entry.joining) leading = { slotId, arrival }
            next.set(slotId, { ...entry, arrival: { kind: 'cut', beats: 4 } })
          } else {
            next.set(slotId, { ...entry, arrival })
          }
        }
        setManualChanges(next)
        if (leading !== null) {
          radioGestureRef.current = [
            ...radioGestureRef.current,
            {
              kind: leading.arrival.kind,
              slotId: leading.slotId,
              beats: leading.arrival.beats,
              lapsLeft: 1
            }
          ]
          // Same as radio's own leading gesture: it must reach the engine as
          // a live project now, and the stage follows on a later tick
          // (a load-project overtaking a stage drops the stage).
          scheduleSyncPreviewToEngine(previewingSlotIdsRef.current)
          return
        }
      }
    }
    // Re-read: the draw above may have replaced the queue. Its ready
    // entries all carry an arrival now.
    const stagedManual = withManual ? manualChangesRef.current : null
    const readyManual = new Map<
      string,
      { stem: ResolvedCandidateStem; joining: boolean; arrival: ManualArrival | null }
    >()
    // The queue entries themselves, by identity, for the applied guard.
    const stagedEntries = new Map<string, object>()
    if (stagedManual !== null) {
      for (const [slotId, m] of stagedManual) {
        if (m.stem !== null) {
          readyManual.set(slotId, { stem: m.stem, joining: m.joining, arrival: m.arrival })
          stagedEntries.set(slotId, m)
        }
      }
    }
    const merged = mergeStageChanges(
      readyLed !== null
        ? { slotId: readyLed.slotId, stem: readyLed.stem, arrival: readyLed.arrival ?? null }
        : null,
      readyManual
    )
    // Never an empty stage: with nothing changing, a duck would dip every
    // layer in the mix. Unreachable through the gate above; kept as the
    // guarantee.
    if (merged.changes.length === 0) return
    // mergeStageChanges drops radio's change when a manual one is on the
    // same row -- the user pointed at it, radio only drew it.
    const ledInStage = readyLed !== null && !readyManual.has(readyLed.slotId)
    const token = (radioStageTokenRef.current += 1)
    radioStageRef.current = {
      token,
      slotIds: merged.changes.map((c) => c.slotId),
      ledSlotId: ledInStage ? readyLed.slotId : null,
      manual: readyManual.size > 0 ? stagedEntries : null,
      sent: false,
      mapping: null
    }
    const ledLabel =
      readyLed === null
        ? null
        : readyLed.arrival
          ? readyLed.arrival.kind
          : radioGestureRef.current.length > 0
            ? 'led'
            : 'cut'
    void syncPreviewToEngine(previewingSlotIdsRef.current, {
      token,
      changes: merged.changes,
      joining: merged.joining,
      gestures: merged.arrivals.map((a) => ({
        kind: a.kind,
        slotId: a.slotId,
        beats: a.beats,
        lapsLeft: 1
      })),
      // Always the loop top once a manual change is aboard -- and a stage
      // at a bar never carries one (withManual above).
      atBars: readyManual.size > 0 ? undefined : readyLed?.atBars,
      label:
        !ledInStage || ledLabel === null
          ? 'manual'
          : readyManual.size > 0
            ? `${ledLabel}+manual`
            : ledLabel,
      atPos: pos,
      loopBars
    })
  }

  // Fraction of the current interval elapsed, 0..1, for the progress rule
  // under the button. State, not a ref, because it IS displayed -- but
  // written at most once per position tick, which the panel re-renders on
  // anyway.
  const [radioProgress, setRadioProgress] = useState(0)
  // THE ONE WAIT every about-to-change row is measured against -- bars of
  // playback since it began, and bars until the change actually LANDS.
  // Handed straight to radioApproachFor; see @shared/radioApproach for why
  // it is one quantity rather than the interval-then-loop pair that
  // shipped in 46c9ddc.
  //
  // NOT the interval. radioProgress above is the interval clock and is
  // honest about being that -- it is drawn under the radio BUTTON, where
  // "how far through the wait between changes" is the question. A ROW is
  // answering a different question ("when does THIS one turn over"), and
  // the interval only ever said the earliest that could be. See
  // radioBarsUntilChange.
  const [radioChangeWait, setRadioChangeWait] = useState<RadioApproachWait | null>(null)
  // Radio's own controls -- same position/dismissal pattern as the slot
  // row's nearbyMenu and kindMenu. See DiscoverRadioMenu.tsx. Opened by
  // the radio BUTTON while radio is off (the start prompt) and by the
  // chevron while it is on (the full menu).
  const [radioMenu, setRadioMenu] = useState<{ x: number; y: number } | null>(null)
  // Discover artist mode's field and its search popover.
  const [artistMenu, setArtistMenu] = useState<{ x: number; y: number } | null>(null)
  const artistButtonRef = useRef<HTMLButtonElement>(null)
  // "analyse overnight"'s answer for the current artist ("queued 31,013").
  const [analysisQueued, setAnalysisQueued] = useState<string | null>(null)
  /** The artist field's pick. Radio off: the next rolls just use it.
   * Radio on: a course change -- every row not by the new artist turns
   * over, one per loop top (spec §1), through skipRadio. */
  function changeArtist(next: string | null): void {
    if (next === artistRef.current) return
    artistRef.current = next
    onArtistChange(next)
    setAnalysisQueued(null)
    if (!radioOnRef.current) return
    artistTurnoverRef.current = artistTurnoverIds(
      slotsRef.current.map((s) => ({ id: s.id, creator: s.candidate?.creatorUserName ?? null })),
      next,
      currentUsername
    )
    // Never two rows at one loop top: a skip already waiting (or still
    // picking) lands first, and its landing re-arms -- armRadioPick then
    // starts the turnover. A pick still in flight for the OLD artist is
    // dropped by skipRadio itself.
    if (!radioSkipWaiting()) void skipRadio()
  }
  const radioMenuButtonRef = useRef<HTMLButtonElement>(null)
  const radioChevronRef = useRef<HTMLButtonElement>(null)
  // Stable identity -- same playhead-tick re-render reasoning as
  // closeNearbyMenu.
  const closeRadioMenu = useCallback(() => setRadioMenu(null), [])

  // Radio's clock. Driven ONLY by the engine's real position stream -- no
  // setInterval anywhere, on purpose: the engine stops its 33ms timer on
  // "pause" (IpcServer.cpp), so `pos` stops changing and this clock stops
  // and resumes with the transport for free.
  //
  // `due` is true only at a CHANGE-GRID BOUNDARY at or after the interval:
  // a change dropped at bar 7 of an 8-bar loop is a splice; a change
  // dropped on a boundary of the changing stem's own cycle is a new
  // section for that stem. Until 2026-09-28 the only boundary was the
  // whole loop's wrap, which made the effective interval
  // ceil(intervalBars / loopBars) * loopBars -- usually a doubling rather
  // than a rounding. See radioGridBars below.
  //
  // The PHRASE grid (radioSettings.phraseBars) is the gate on top of
  // that: off by default, and when it is on a change may land only on a
  // 16- or 32-bar boundary counted in whole laps from where this clock
  // was created. It never drops a change, only holds it to the next
  // phrase -- see advanceRadioClock.
  //
  // Sits here, directly under radio's own state, rather than up with the
  // other `pos`-adjacent effects: its dependency array is evaluated during
  // render, so it cannot be written above the `const`s it names.
  // (armRadioPick, radioEligibleSlotIds and commitSlotPick are `function`
  // declarations further down this component body, so they are hoisted and
  // available here -- the effect only runs after render regardless.)
  useEffect(() => {
    // TEMPORARY INSTRUMENTATION (2026-09-28) -- the arrival time of this
    // tick is what every later step is measured from, and `pos` here is
    // how far past the boundary the 30Hz stream had already carried us
    // before anything noticed. Remove with radioTrace.ts.
    radioTraceTick(pos)
    if (!radioOn) return
    const clock = radioClockRef.current
    if (!clock) return
    const loopBars =
      resolvedBarLengthsRef.current.size > 0
        ? Math.max(...resolvedBarLengthsRef.current.values())
        : 0
    if (!(loopBars > 0)) return
    // WHERE a change may land -- the menu's `loop end` row
    // (radioSettings.loopEndOverBars, 2026-09-28). A layer at or under the
    // threshold turns over on its own cycle; a longer one waits for the
    // whole loop's wrap. See DEFAULT_RADIO_LOOP_END_BARS' own doc comment
    // for why that boundary is the safe one.
    //
    // The pending pick is what is about to change, so BOTH lengths come
    // from it: the layer being replaced, and the one replacing it. No
    // pending pick (radio just started, nothing was eligible last time,
    // the incoming stem has not resolved yet) falls back to the whole
    // loop, which is what shipped and can never be the worse cut.
    const pendingPick = radioPendingRef.current
    const outgoingBars =
      pendingPick !== null ? (resolvedBarLengthsRef.current.get(pendingPick.slotId) ?? null) : null
    const changeBars = radioChangeBars(outgoingBars, pendingPick?.incomingBars ?? null)
    const gridBars = radioGridBars(radioSettings.loopEndOverBars, loopBars, changeBars)
    const step = advanceRadioClock(clock, pos, loopBars, gridBars, radioSettings.phraseBars)
    radioClockRef.current = step.clock
    // The bar a change detected on this tick was aiming at, so
    // `pos - boundaryBars` is how far past it this tick is. Mirrors
    // advanceRadioClock's own grid arithmetic; a wrap is always bar 0.
    //
    // Began as TEMPORARY INSTRUMENTATION (2026-09-28) for radioTrace.ts,
    // and is now load-bearing: every restartRadioInterval below counts the
    // new interval from this boundary rather than from the tick (see its
    // doc comment). Keep it when radioTrace.ts goes.
    const traceGrid = gridBars > 0 ? gridBars : loopBars
    // THE PLAYHEAD CROSSING A HELD CHANGE'S OWN BAR -- the mid-lap
    // landing, and the second of the two moments a held change can land
    // on. Watched directly against the position rather than taken from
    // `step.due`, and that is not a style choice: the early decision
    // clears radioPendingRef, so from that tick on `gridBars` falls back
    // to the whole loop and advanceRadioClock's `crossed` can only fire
    // at a wrap. The bar the change was aimed at is no longer on the
    // clock's own grid, so the clock cannot be what announces it.
    //
    // `clock.lastPos` is the PREVIOUS tick's position (step.clock's has
    // already moved to `pos`), so this is a genuine crossing rather than
    // "past it", and it can fire at most once. If it somehow does not --
    // a tick dropped over the boundary, a seek -- the wrap branch below
    // is the catch-all it always was, and the change lands there instead.
    const heldBar = radioLedChangeRef.current?.atBars
    const crossedHeldBar =
      heldBar !== undefined && !step.wrapped && pos >= heldBar && clock.lastPos < heldBar
    const boundaryBars = step.wrapped
      ? 0
      : crossedHeldBar
        ? heldBar
        : Math.floor(pos / traceGrid) * traceGrid
    // The density arc gets every tick, before any branch below can return.
    densityTick(step.wrapped, pos, loopBars)
    // A change that was WAITING for its boundary LANDS HERE and only
    // here -- the loop top, or (since the arbitrary-bar swap) the bar a
    // bare cut named for itself.
    //
    // For a leading gesture the gesture has just played out over the
    // closing bars of the lap -- the outgoing layer left a gap, or a noise
    // sweep climbed into this instant -- and the wrap is what it was
    // pointing at. For a held ARRIVAL gesture nothing has happened yet and
    // this is where both the change and its curve begin. Same landing site
    // and the same reason as the course change below: the transport does
    // not reset for a load-project, so the wrap is the one moment every
    // stem is at its own zero.
    //
    // A leading gesture is cleared in the same tick. It has fired; a
    // second lap of it would turn one move into a rhythm, and (for a hole)
    // would punch the gap in the layer that just arrived. For an arrival
    // hold the list is already empty and clearRadioGesture is a no-op -- and
    // so it is for a mid-lap cut, which can only have been decided while
    // nothing was armed.
    //
    // MANUAL CHANGES land here too (2026-09-29), at the WRAP only and never
    // at a held bar -- every waiting one whose stem is ready, together with
    // radio's own held change if there is one, in the same microtask. The
    // branch runs for them even when radio holds nothing. With the queue
    // empty it is exactly the led-only branch it always was.
    //
    // WHICH manual changes land: the ones the engine just swapped in, when
    // it swapped a stage in at all (still staged here, or acked already) --
    // a change that became ready too late for that stage waits for the next
    // wrap rather than dragging in late behind it. When no stage was taken
    // (never sent, withdrawn, errored) every ready one lands the old way, a
    // commit and a push, as radio's own held change does.
    // The rows a manual landing on this tick commits -- a course change
    // landing on the same wrap leaves them alone (the user pointed at them).
    let manualLandedIds: ReadonlySet<string> = new Set()
    const stageTakenAtWrap =
      step.wrapped &&
      (radioStageRef.current !== null ||
        (radioLedChangeRef.current !== null &&
          radioStageAppliedLedRef.current === radioLedChangeRef.current) ||
        appliedManualStillWaiting())
    const takenManual: ReadonlyMap<string, object> | null = !stageTakenAtWrap
      ? null
      : radioStageRef.current !== null
        ? radioStageRef.current.manual
        : appliedManualStillWaiting()
          ? radioStageAppliedManualRef.current
          : null
    const manualToLand = step.wrapped
      ? [...manualChangesRef.current].filter(
          ([slotId, m]) =>
            m.stem !== null &&
            (!stageTakenAtWrap || (takenManual !== null && takenManual.has(slotId)))
        )
      : []
    if (
      (step.wrapped || crossedHeldBar) &&
      (radioLedChangeRef.current !== null || manualToLand.length > 0)
    ) {
      const led = radioLedChangeRef.current
      // The queue is captured and cleared FIRST, before anything below can
      // write to it. Whatever is not landing -- still resolving, or ready
      // too late for the stage the engine took -- goes back into the queue
      // and waits for the next wrap.
      const landingReady: [
        string,
        { pick: SlotPick; joining: boolean; arrival: ManualArrival | null; radioSkip?: boolean }
      ][] = manualToLand
      if (landingReady.length > 0) {
        const landingIds = new Set(landingReady.map(([slotId]) => slotId))
        setManualChanges(
          new Map([...manualChangesRef.current].filter(([slotId]) => !landingIds.has(slotId)))
        )
        manualLandedIds = landingIds
      }
      // Radio's pick is armed by exactly one path on this tick. When radio's
      // own change lands, it is this branch (which returns, as it always
      // has). When only manual changes land, the branches below still run
      // on this tick -- and a course change or a due change arms its own
      // next pick, so this one must not as well.
      const radioArmsBelow = led === null && (step.due || radioCourseChangeRef.current !== null)
      // Taken BEFORE anything else: clearRadioGesture just below pushes a
      // load-project, and an ordinary push withdraws whatever is staged.
      // At this instant the engine has already swapped (the audio thread
      // takes a staged project at the wrap itself, ~30ms before this tick
      // could notice), so a withdrawal would be a lie -- this swap is
      // done, not pending.
      // The engine has already swapped by the time this tick runs --
      // at the wrap, or at the bar, either way on the audio thread some
      // tens of milliseconds ago -- so a withdrawal from here would be a
      // lie. Same reasoning for both boundaries; only the instant
      // differs.
      const stagedHere = radioStageRef.current
      radioStageRef.current = null
      if (stagedHere !== null) radioStageLandedRef.current = stagedHere
      // Whether the engine has already made this swap real, by either
      // route: still staged here (the tick won), or acked (the ack won).
      const engineSwapped =
        stagedHere !== null || (led !== null && radioStageAppliedLedRef.current === led)
      radioStageAppliedLedRef.current = null
      radioStageAppliedManualRef.current = null
      // A manual change on radio's own row wins, the same rule the stage
      // was built with (mergeStageChanges): radio's change for that row
      // is dropped, and the manual commit puts the truth on the wire.
      // queueManualChange already gives radio's held change way at queue
      // time, so this is a defensive fallback that should never fire -- and
      // when it does, radio's change did not land, so the clock is NOT
      // restarted for it.
      const ledOverridden = led !== null && landingReady.some(([id]) => id === led.slotId)
      if (led !== null) {
        // A change DECIDED early has not restarted the clock yet -- the due
        // branch below is what normally does that, and it never ran for
        // this one. Restart it here, at the landing, which is exactly where
        // a change due at a wrap restarts it today. See the `early` field's
        // own doc comment for why that split is what keeps the pace put.
        if (led.early && !ledOverridden) {
          radioClockRef.current = restartRadioInterval(
            step.clock,
            nextRadioIntervalBarsInWindow(radioSettings.paceBars),
            pos,
            boundaryBars
          )
        }
        setRadioLedChange(null)
      }
      clearRadioGesture()
      void Promise.resolve().then(() => {
        if (!radioOnRef.current) return
        // Every arrival curve landing at this wrap, radio's and the manual
        // ones, armed together once the commits below have happened.
        const arriving: RadioGesture[] = []
        // Every row that actually turned over here -- what a duck spares.
        const landedIds: string[] = []
        // Re-checked at the boundary rather than trusted from when the
        // gesture was armed, exactly as the ordinary commit below does:
        // the slot may have been removed, locked or muted in the lap the
        // gesture took, and swapping a layer the user just locked is
        // worse than skipping a change.
        let committed = false
        if (led !== null && !ledOverridden && radioEligibleSlotIds().includes(led.slotId)) {
          // No pushUndoSnapshot, for the same reason nothing else radio
          // does takes one: a transition is performance, not an edit.
          radioTraceBegin(
            boundaryBars,
            bpmRef.current,
            led.arrival
              ? `held-${led.arrival.kind}${landingReady.length > 0 ? '+manual' : ''}`
              : `gesture-led${landingReady.length > 0 ? '+manual' : ''}`
          ) // TEMP
          commitSlotPick(led.slotId, led.pick)
          // Armed HERE rather than when the change was held, and only once
          // the commit has actually happened: an arrival curve belongs to
          // the stem that is arriving, so arming it a lap early would
          // sweep or bloom the OUTGOING audio for a whole lap and then be
          // cleared before the real one ever got it. Same reasoning as the
          // "no sync scheduled here" note on the unheld arrival path
          // below, one step earlier in the chain.
          //
          // No scheduleSyncPreviewToEngine: holdSyncUntilResolved just
          // below parks the push until the new stem has resolved, and the
          // gesture is read out of radioGestureRef at build time, so that
          // one push carries the curve and the stem it decorates together.
          if (led.arrival) {
            arriving.push({
              kind: led.arrival.kind,
              slotId: led.slotId,
              beats: led.arrival.beats,
              lapsLeft: 1
            })
          }
          // The clearRadioGesture() above already scheduled a sync for
          // this frame, and this commit's stem is a render and a promise
          // away -- so that sync would push the OLD stem and the swap
          // would need a second push. Holding cancels it; it goes out
          // once, carrying both.
          holdSyncUntilResolved(led.slotId)
          radioTraceMark('commit') // TEMP
          radioLastSlotRef.current = led.slotId
          landedIds.push(led.slotId)
          committed = true
        }
        if (led !== null && !ledOverridden && !committed && engineSwapped) {
          // The engine may already have made this swap real, while the
          // panel has just decided not to -- the slot was locked, muted
          // or removed inside the last 30ms, too late for the per-tick
          // withdrawal in stepRadioStage to have caught it. Try to stop
          // it anyway, and then put what is actually true back on the
          // wire either way, rather than leaving the engine playing a
          // layer nothing in the UI agrees with.
          cancelStagedSwap('ineligible-at-the-wrap')
          scheduleSyncPreviewToEngine(previewingSlotIdsRef.current)
        }
        // The manual changes. NOT re-checked for eligibility: a padlock or
        // a mute does not withdraw a change the user asked for (spec
        // behaviour 6) -- only removing the row does, and removeSlot takes
        // it out of the queue itself. The existence check is for a row
        // removed in the instant between.
        let manualCommitted = false
        let skipLanded: string | null = null
        for (const [slotId, change] of landingReady) {
          if (!slotsRef.current.some((s) => s.id === slotId)) continue // removed meanwhile
          if (!committed && !manualCommitted) {
            radioTraceBegin(boundaryBars, bpmRef.current, 'manual') // TEMP
          }
          commitSlotPick(slotId, change.pick)
          // One push for the whole landing, as for a course change: the
          // hold lifts when the LAST of them has resolved.
          holdSyncUntilResolved(slotId)
          if (change.joining) joinPreviewingMix(slotId)
          // A cut carries nothing, and a leading gesture already played
          // over the lap that just ended (it was staged as a cut).
          if (
            change.arrival !== null &&
            change.arrival.kind !== 'cut' &&
            !radioGestureLeadsChange(change.arrival.kind)
          ) {
            arriving.push({
              kind: change.arrival.kind,
              slotId,
              beats: change.arrival.beats,
              lapsLeft: 1
            })
          }
          landedIds.push(slotId)
          manualCommitted = true
          if (change.radioSkip) skipLanded = slotId
        }
        if (manualCommitted && !committed) radioTraceMark('commit') // TEMP
        // Radio's skip landed: it was radio's change for that row, so
        // radio's interval starts HERE (as it does where its own change
        // lands) and the row is radio's last. The re-arm below then finds
        // no skip waiting and arms radio's next pick.
        if (skipLanded !== null && radioClockRef.current !== null) {
          radioLastSlotRef.current = skipLanded
          radioClockRef.current = restartRadioInterval(
            radioClockRef.current,
            nextRadioIntervalBarsInWindow(radioSettings.paceBars),
            pos,
            boundaryBars
          )
          setRadioProgress(0)
        }
        // clearRadioGesture() emptied the list at the top of this branch,
        // so this is every curve for the lap that starts here and nothing
        // else. Left alone when nothing arrives, as the single ref was.
        //
        // A duck spares every row that landed, as the stage's did. Radio
        // alone lands one row, the duck's own, so only a landing with
        // manual rows in it needs saying.
        //
        // ADDED to the list rather than replacing it. When radio's change
        // lands the list is empty here (cleared above, and this branch
        // returns), so it is the same thing. When only manual changes land
        // the tick carries on below, and stepRadioStage may already have
        // armed radio's next leading gesture on it -- replacing would drop
        // that and leave its held change waiting with no gesture.
        if (arriving.length > 0) {
          radioGestureRef.current = [
            ...radioGestureRef.current,
            ...(manualCommitted
              ? arriving.map((g) => (g.kind === 'duck' ? { ...g, spares: landedIds } : g))
              : arriving)
          ]
        }
        // Radio's own change landed (or was dropped at the boundary), so its
        // interval starts here -- and this is where the interval's drop-out
        // is rolled, whether the change was decided a lap early or held at
        // its due tick. The due branch below never runs for either, and it
        // rolls whether or not its own change commits, so this does too:
        // once per interval. After the arrivals above, so an arrival curve
        // keeps its lap.
        //
        // Against the loop this landing is ABOUT to be, not the one the
        // tick measured: a 4-bar loop taking an 8-bar stem wraps at 8 from
        // here, and a roll measured against 4 would take a lap the next
        // change can land on.
        if (led !== null && !ledOverridden) {
          rollRadioDropOut(
            led.slotId,
            pos,
            loopBarsAfterLanding([
              ...(committed ? [{ slotId: led.slotId, bars: led.stem?.barLength ?? null }] : []),
              ...landingReady
                .filter(([slotId]) => slotsRef.current.some((sl) => sl.id === slotId))
                .map(([slotId]) => ({
                  slotId,
                  bars: manualToLand.find(([id]) => id === slotId)?.[1].stem?.barLength ?? null
                }))
            ])
          )
        }
        if (committed || manualCommitted) {
          runAfterEngineSync(() => {
            if (!radioOnRef.current) return
            // Radio's own change landed: arm its next one, as always. Only
            // manual ones landed: radio's pick is still armed and warm
            // unless queueManualChange dropped it for one of these rows,
            // and re-picking would throw a warm pick away -- and when a
            // due or course change on this same tick arms one itself
            // (radioArmsBelow), this must not arm a second.
            // Nor while radio HOLDS a change: step (2) may have decided early
            // on this very tick and used up the pick.
            if (
              committed ||
              (!radioArmsBelow &&
                radioPendingRef.current === null &&
                radioLedChangeRef.current === null)
            ) {
              void armRadioPick()
            }
          })
        } else if (led !== null) {
          void armRadioPick()
        }
      })
      // Radio's own change landed: nothing else happens on this tick, as
      // always. Only manual changes landed: FALL THROUGH, so the lap
      // countdown, a course change and radio's own due change still get
      // this tick -- a manual landing must never cost radio a change.
      //
      // The countdown cannot touch the curves this landing arms: they are
      // armed in the microtask above, which runs after this whole effect
      // body, and the countdown below sees only the list
      // clearRadioGesture() just emptied.
      if (led !== null) return
    }
    // A gesture is anchored to the loop top, so its lifetime is counted
    // in laps. One wrap after the lap it fired on, the curve comes off --
    // leaving it armed would repeat the gesture every lap, which is a
    // rhythm rather than a move.
    //
    // Per gesture: each one on its last lap comes off, the rest count down.
    // A rebuild is scheduled only when something actually came off, which
    // for a single gesture is exactly the old clear-or-decrement.
    if (step.wrapped && radioGestureRef.current.length > 0) {
      const armed = radioGestureRef.current
      const surviving = armed
        .filter((g) => g.lapsLeft > 1)
        .map((g) => ({ ...g, lapsLeft: g.lapsLeft - 1 }))
      if (surviving.length === 0) clearRadioGesture()
      else if (surviving.length < armed.length) {
        radioGestureRef.current = surviving
        scheduleSyncPreviewToEngine(previewingSlotIdsRef.current)
      } else radioGestureRef.current = surviving
    }
    // The course change lands HERE and only here -- the top of the loop,
    // for exactly the reason a long stem waits for one (687641a):
    // the transport does not reset for a load-project, so a bed dropped
    // in mid-loop would start every one of its stems at whatever phase
    // the transport happened to be at. At the wrap they all start at
    // their own zero.
    //
    // Every pick was made and warmed when the pace chip was pressed, so
    // this is one batched setSlots -> one render -> one rAF-coalesced
    // sync -> one load-project. Locked and muted layers were never in the
    // batch: radioEligibleSlotIds excluded them, and the padlock has to
    // mean never or it means nothing.
    if (step.wrapped && radioCourseChangeRef.current !== null) {
      const batch = radioCourseChangeRef.current
      radioCourseChangeRef.current = null
      // restartRadioInterval, not createRadioClock: the phrase was
      // anchored when the pace chip was pressed and the transport was
      // seeked to 0 (armRadioCourseChange). This is the batch LANDING a
      // lap or two later, and re-anchoring here would shove the phrase
      // origin forward by however long the slowest stem took to warm.
      radioClockRef.current = restartRadioInterval(
        step.clock,
        nextRadioIntervalBarsInWindow(radioSettings.paceBars),
        pos,
        boundaryBars
      )
      void Promise.resolve().then(() => {
        if (!radioOnRef.current) return
        radioTraceBegin(boundaryBars, bpmRef.current, 'course-change') // TEMP
        for (const { slotId, pick } of batch) {
          // A manual change just landed on this row at this same wrap, and
          // it wins, as it does over radio's own change.
          if (manualLandedIds.has(slotId)) continue
          commitSlotPick(slotId, pick)
          // One push for the whole turnover, not one per layer landing:
          // the hold lifts when the LAST of them has resolved.
          holdSyncUntilResolved(slotId)
        }
        radioTraceMark('commit') // TEMP
        // Nothing "changed last" after a whole-bed turnover, so the
        // not-the-same-one-twice rule starts clean.
        radioLastSlotRef.current = null
        setRadioProgress(0)
        // Behind this batch's own engine push (runAfterEngineSync), for the
        // same reason the single-change branch below is -- more so here,
        // since a course change commits every eligible layer at once and
        // its push is the biggest one radio ever makes.
        runAfterEngineSync(() => {
          if (radioOnRef.current) void armRadioPick()
        })
      })
      return
    }
    // Deferred out of the effect body: this repo ERRORS on a synchronous
    // setState inside an effect (react-hooks/set-state-in-effect), and the
    // established workaround in this codebase is a resolved-promise tick.
    const progress = radioApproachProgress(step.clock.barsElapsed, step.clock.intervalBars)
    // THE ROWS' OWN CLOCK, which is not that one. A row is asking when the
    // change lands, and the interval only ever said the earliest it could:
    // a held change waits for the wrap it is anchored to, and an armed one
    // waits for the first change-grid boundary at or after the interval,
    // which can be most of a lap later. Counting the interval is what put
    // "this bar" on a row that then looped several more times.
    //
    // ONE quantity across both states, so the armed -> held transition can
    // change how the row looks and never what it means. The two readings
    // are the same reading at the moment it flips, too: stepRadioStage
    // only decides early when radioChangeDueAtNextWrap or
    // radioChangeLandsAtBar names the boundary, and both are read out of
    // exactly the arithmetic radioBarsUntilChange is already counting
    // with -- so a held change measures to its OWN boundary (`atBars`,
    // or the wrap when it has none) and the number does not move when
    // the row goes from armed to held.
    const changeWait: RadioApproachWait = {
      elapsedBars: step.clock.barsElapsed,
      barsUntilChange:
        radioLedChangeRef.current !== null
          ? (radioLedChangeRef.current.atBars ?? loopBars) - pos
          : radioBarsUntilChange(step.clock, pos, loopBars, gridBars, radioSettings.phraseBars)
    }
    void Promise.resolve().then(() => {
      setRadioProgress(progress)
      setRadioChangeWait(changeWait)
    })
    // Radio's scheduled swap gets its look at this tick here: after the
    // two branches that LAND a change (both of which return), and before
    // the one that decides one. `step.due` is passed in so an early
    // decision can never get in front of a change that is coming due on
    // this very tick.
    //
    // After a manual-only landing that fell through, step (3) sits this
    // tick out: the landing's commits are still a microtask away, and a
    // stage of the leftovers built now would be built on the old mix.
    stepRadioStage(step.due, pos, loopBars, gridBars, manualLandedIds.size > 0)

    if (!step.due) return

    // Due. Draw a fresh interval and reset the clock FIRST, so a slow
    // commit below cannot fire a second change on the very next tick.
    //
    // restartRadioInterval, not createRadioClock: a change resets the
    // DURATION since the last change, never radio's position in the
    // phrase. Resetting the phrase here would re-anchor it to every
    // change and the 16s would walk.
    radioClockRef.current = restartRadioInterval(
      step.clock,
      nextRadioIntervalBarsInWindow(radioSettings.paceBars),
      pos,
      boundaryBars
    )
    void Promise.resolve().then(() => setRadioProgress(0))

    // A hole or a riser is already announcing a change that has not landed
    // yet. Deciding a second one on top of it would put two changes in one
    // place and neither would read. The clock was restarted just above, so
    // the wait costs one interval and the gesture lands first.
    if (radioLedChangeRef.current !== null) return

    const pending = radioPendingRef.current
    setRadioPending(null)
    // The pick was made a whole interval ago, so the world may have moved:
    // the slot may since have been removed, locked or muted. Re-check, and
    // if it is no longer eligible drop the pick and arm a fresh one --
    // resolving a few hundred milliseconds late is strictly better than
    // swapping a layer the user just locked.
    const eligibleNow = radioEligibleSlotIds()
    // Everything below sets state, and this repo ERRORS on a synchronous
    // setState inside an effect -- commitSlotPick calls setSlots, and
    // armRadioPick reaches pickForSlot's setRolledCount/setRerollingSlotIds
    // BEFORE its first await. Both are deferred through the same
    // resolved-promise tick the progress write above uses.
    void Promise.resolve().then(() => {
      if (!radioOnRef.current) return
      let committed = false
      if (
        pending !== null &&
        eligibleNow.includes(pending.slotId) &&
        // Never over a row a manual change landed on at this same wrap --
        // the user's change wins, and armRadioPick should never have
        // armed it; this is the second guard.
        !manualLandedIds.has(pending.slotId)
      ) {
        // WHICH move this change gets. The menu picks a temperament and
        // the changing layer's own kinds pick the weights inside it, so a
        // drum layer cuts or leaves a hole while a pad sweeps open --
        // per-kind musicality with no per-kind grid to fill in. `off`
        // always answers `cut`, and `cut` arms nothing at all, which is
        // what keeps the project byte-identical to what shipped.
        //
        // Never while another gesture is already armed: two curves in one
        // lap is a wash, and a standalone drop-out that has not finished
        // has as much right to the lap as a transition does.
        const changing = slotsRef.current.find((sl) => sl.id === pending.slotId)
        const transition =
          radioGestureRef.current.length === 0
            ? pickTransition(radioSettings.transitions, changing?.kinds ?? [])
            : 'cut'
        // How long the move takes, in beats. A hole draws from the same
        // weighted 1/2/4 the standalone drop-out does, because it IS one
        // -- a fixed length is a rhythm and a varied one is a gesture. A
        // riser gets two bars, long enough to read as a build; a sweep, a
        // bloom and a duck get one bar, which is the arrival rather than
        // the approach. Everything is clamped to half the loop by the
        // curve builders, so a short loop shortens all of them.
        const beats = radioGestureBeats(transition, pickDropOutBeats)
        // Can this change land on the boundary it came due on, or does it
        // have to wait for the loop top? Every curve in radioTransition.ts
        // is anchored at bar 0 and structurally cannot be anywhere else,
        // so a decorated change landing at bar 2, 4 or 6 arms a curve that
        // is already entirely behind the playhead -- see
        // radioChangeWaitsForLoopTop, which is the whole bug and its
        // reasoning. `cut` and an arrival gesture that is ALREADY at the
        // loop top fall straight through to the ordinary commit below and
        // keep the pace radioGridBars was tuned for.
        if (radioChangeWaitsForLoopTop(transition, step.wrapped)) {
          if (radioGestureLeadsChange(transition)) {
            // The gesture comes FIRST and the change waits for the loop
            // top it ends on -- a hole is the gap the new layer lands in,
            // a riser is the sweep into the moment, and arming either
            // after the commit would put it a whole lap out of place. The
            // layer leaving is the one carrying the gesture, so it is the
            // OUTGOING stem the curve lands on, and it has to reach the
            // engine NOW, a whole lap before its change.
            radioGestureRef.current = [
              {
                kind: transition,
                slotId: pending.slotId,
                beats,
                lapsLeft: 1
              }
            ]
            setRadioLedChange({
              slotId: pending.slotId,
              pick: pending.pick,
              stem: pending.stem
            })
            scheduleSyncPreviewToEngine(previewingSlotIdsRef.current)
          } else {
            // An ARRIVAL gesture due mid-loop. Nothing is armed and
            // nothing is synced here on purpose: the curve belongs to the
            // stem that has not arrived yet, so both it and the commit
            // wait together for the wrap (see radioLedChangeRef). The lap
            // in between is an ordinary lap, which is what it should
            // sound like -- a sweep is an arrival, not an announcement.
            setRadioLedChange({
              slotId: pending.slotId,
              pick: pending.pick,
              stem: pending.stem,
              arrival: { kind: transition, beats }
            })
          }
          // Nothing else this interval: the drop-out roll and the next
          // pick both wait for the change to actually land, and the
          // landing makes them.
          return
        }
        // No pushUndoSnapshot: radio firing every twenty bars would fill
        // the undo stack and make Cmd+Z useless for the edits the user
        // actually made by hand. A radio change is not undoable; the
        // padlock is the tool for "I liked that one" (spec 3.4).
        radioTraceBegin(boundaryBars, bpmRef.current, `due-${transition}`) // TEMP
        commitSlotPick(pending.slotId, pending.pick)
        // Nothing pushes until this pick's stem has resolved -- not the
        // previous lap's gesture coming off at this same wrap, not the
        // drop-out roll below, not this change's own arrival gesture.
        // See holdSyncUntilResolved.
        holdSyncUntilResolved(pending.slotId)
        radioTraceMark('commit') // TEMP
        radioLastSlotRef.current = pending.slotId
        committed = true
        if (transition !== 'cut') {
          // An arrival gesture rides the change it decorates: the curve
          // lands on the stem that just arrived (a sweep and a bloom) or
          // on every other layer (a duck), and comes off at the next wrap.
          //
          // Only reached when this change is AT the loop top -- the guard
          // above sent every other decorated change to radioLedChangeRef
          // to wait for one. So the curve's bar 0 and the playhead are the
          // same instant here, which is the only arrangement in which any
          // of these three is audible at all.
          //
          // A `duck` writes a volume curve on every OTHER audible layer,
          // which makes their EngineStem.volume inert for the lap -- see
          // clearRadioGesture for why that is bounded rather than
          // tolerated.
          radioGestureRef.current = [
            {
              kind: transition,
              slotId: pending.slotId,
              beats,
              lapsLeft: 1
            }
          ]
          // NO sync scheduled here, deliberately -- this used to call
          // scheduleSyncPreviewToEngine and that was the bug.
          //
          // Direct report, 2026-09-28: "that last transition there was a
          // fade in .. or a blip without the top stem." The commit above
          // only writes the slot's new candidate; the new stem is not
          // resolved into resolvedStemsRef until the row's own resolve
          // effect runs, a render and a promise later. Syncing right here
          // raced that: whenever the renderer was busy enough for the
          // animation frame to land first, a load-project went out
          // carrying the arrival gesture applied to the layer's OLD
          // stem -- a curve sweeping or blooming the wrong audio -- and
          // the engine applies a load-project in full, so it was audible.
          // Then the real swap followed as a second push a moment later.
          //
          // The gesture is read out of radioGestureRef at build time, so
          // the sync that reportSlotResolution fires when the new stem
          // lands already carries it. Dropping this call means the
          // gesture and the stem it decorates always reach the engine in
          // the SAME project, which is what "an arrival gesture rides the
          // change it decorates" was supposed to mean. It also halves the
          // load-projects a decorated change costs.
          //
          // The two sync calls nearby are deliberately untouched: the
          // leading-gesture branch above (a hole or a riser) must fire
          // NOW, a whole lap before its change, and the standalone
          // drop-out below is not attached to a change at all.
        }
      }
      // Roll ONCE per interval for a drop-out in the coming one -- no
      // second clock. See rollRadioDropOut; a held change rolls it where it
      // lands instead. Against the loop the commit above makes, as the
      // landing does.
      rollRadioDropOut(
        pending?.slotId ?? null,
        pos,
        committed && pending !== null
          ? loopBarsAfterLanding([{ slotId: pending.slotId, bars: pending.incomingBars }])
          : loopBars
      )
      // Arm the next one whether or not this one landed -- nothing
      // eligible is radio idling, not an error, and it retries here at
      // every boundary.
      //
      // Behind the change's own engine push when something actually landed
      // (runAfterEngineSync's own doc comment: the next pick used to get in
      // front of it and hold the change a whole second late); immediately
      // when nothing did, since then there is no push to get in front of
      // and waiting would only burn the backstop timer.
      if (committed) {
        runAfterEngineSync(() => {
          if (radioOnRef.current) void armRadioPick()
        })
      } else {
        void armRadioPick()
      }
    })
    // `pos` is the only real dependency; every function above is re-created
    // each render and reads through refs on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pos, radioOn, radioSettings])

  // In-flight + just-succeeded tracking for BOTH "add to timeline" and "add
  // to shelf" -- independent per button (clicking one doesn't disable or
  // animate the other), same disabled/label-swap convention as
  // rerollingSlotIds above, just two single booleans instead of a per-slot
  // Set since there's only ever one of each button.
  //
  // Doesn't fix a correctness bug on its own (the groupId fix above already
  // makes a genuine double-click safe from corrupting existing placements),
  // but without it a double-click before the first click's own
  // Promise.all/resolveCandidateStem round trip resolves would still fire
  // TWO separate, fully-valid PLACE_LOOP_ON_TIMELINE dispatches from one
  // intended click -- two full copies of the loop placed back-to-back.
  //
  // Direct report, 2026-09-17: "right now the glow isn't enough to
  // convince someone that something has happened, it just feels like a
  // failed process" -- the box-shadow pulse alone (discover-add-pulse,
  // below -- was discover-plunk-pulse) wasn't legible enough on its own.
  // justAddedToTimeline/justAddedToShelf now ALSO swap the button's own
  // label to "✓ added" for the same 500ms window, which is the primary
  // confirmation signal; the pulse stays as a supplementary accent.
  const [addingToTimeline, setAddingToTimeline] = useState(false)
  const [addingToShelf, setAddingToShelf] = useState(false)
  const [justAddedToTimeline, setJustAddedToTimeline] = useState(false)
  const [justAddedToShelf, setJustAddedToShelf] = useState(false)

  // `keep` is not `add to shelf`. Shelf is "I am using this now"; keep is
  // "I found this, do not lose it." Both can be true, and both buttons
  // stay. One label covers both outcomes: a duplicate save is a no-op that
  // SAYS so rather than leaving him guessing whether it worked.
  const [keeping, setKeeping] = useState(false)
  const [keptLabel, setKeptLabel] = useState<string | null>(null)

  // "fetch radio hearts" -- ell.ing/radio's hearted combos, kept through
  // keep's own save (src/main/radioHeartsImport.ts). Same label-flash as
  // keep, held longer because it carries counts to read, not a tick.
  const [fetchingHearts, setFetchingHearts] = useState(false)
  const [heartsLabel, setHeartsLabel] = useState<string | null>(null)

  // The phone remote's arcade-ish counters. A run is a session -- these live
  // with the panel and reset when it unmounts or the app restarts. No points,
  // no badges, no streaks.
  const [rolledCount, setRolledCount] = useState(0)
  const [keptCount, setKeptCount] = useState(0)
  const [lastKeptName, setLastKeptName] = useState<string | null>(null)

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
  // uses, just parameterized by `kind` directly instead of looked up from
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
  // WHICH WAITING CHANGES AN UNDO TAKES BACK (Elling, 2026-09-29): every
  // change still waiting for the loop top that was queued after the undo
  // point -- see @shared/discoverUndoWithdraw for the rule and why it is a
  // sequence rather than the stack's depth (the stack is capped).
  //
  // Every snapshot this panel pushes gets the next number here, and every
  // queued change records the latest one at the moment it is queued.
  // Keyed by the snapshot array itself, so each push is a fresh copy: the
  // same `slots` array can be pushed twice (a queued change does not touch
  // slots, so two clicks in a row push the same one), and one key cannot
  // carry two numbers. A WeakMap, so a snapshot trimmed off the stack
  // takes its number with it.
  function markUndoSnapshot(current: DiscoverSlot[]): DiscoverSlot[] {
    const snapshot = current.slice()
    undoSequence.mark(snapshot)
    return snapshot
  }
  // Snapshots pushed from OUTSIDE this panel -- LibraryBrowser's seeding,
  // App's reset on a new sketch -- and any already on the stack when the
  // panel mounted are numbered when they are first seen, which is the
  // render right after the push. Anything queued after that numbers
  // higher, so an undo to that snapshot takes it back.
  useEffect(() => {
    for (const snapshot of undoStack) undoSequence.mark(snapshot)
  }, [undoStack, undoSequence])

  // Call at the START of any undoable action, BEFORE mutating `slots` --
  // captures the pre-action snapshot to restore to, and clears the redo
  // stack (standard undo/redo semantics: a fresh action invalidates
  // whatever redo history existed, same as this app's own real undo
  // system). `slots` here is this render's own closure, same convention
  // every other slots-reading function in this file already relies on
  // (see rollForSlot's own doc comment on this).
  function pushUndoSnapshot(): void {
    const snapshot = markUndoSnapshot(slots)
    setUndoStack((prev) => [...prev, snapshot].slice(-DISCOVER_UNDO_LIMIT))
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
    // A change waiting for the loop top on a row the snapshot does not have
    // (undoing an add or a duplicate while radio runs) goes with its row,
    // exactly as removeSlot takes it. One on a row that is still there
    // stays. With radio off nothing ever waits, so this does nothing.
    for (const slotId of [...manualChangesRef.current.keys()]) {
      if (!validIds.has(slotId)) withdrawManualChange(slotId, 'manual-change-undone')
    }
    // forgetSlotResolution (not just resolvedStemsRef.current.delete(id))
    // as of code review, 2026-09-17 -- undo/redo dropping a resolved slot
    // used to leave its own barLength behind in resolvedBarLengthsRef/
    // resolvedBarLengths forever (nothing in `next` could ever remove it
    // again), silently inflating the engine's own loop-length reference.
    // Deleting the CURRENT key while iterating a Map's own .keys() is
    // safe (a key deleted mid-iteration is simply not visited again,
    // per spec) -- this loop already relied on that before this change,
    // just via the narrower resolvedStemsRef.current.delete(id) call.
    let forgotAny = false
    for (const id of resolvedStemsRef.current.keys()) {
      if (!validIds.has(id)) {
        forgetSlotResolution(id)
        forgotAny = true
      }
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
    } else if (forgotAny && previewLoadedRef.current) {
      // A forgotten slot wasn't necessarily part of the preview mix (e.g.
      // muted, or resolved but never toggled on) -- but if it contributed
      // to maxBarLength, the engine still needs a fresh sync to pick up
      // the now-shorter reference even though `pruned` itself, and
      // therefore the branch above, is unchanged. Gated on
      // previewLoadedRef.current (found in code review) -- without it, an
      // undo/redo with nothing currently previewing would still call
      // syncPreviewToEngine, which (via its own `!previewLoadedRef.current
      // && seedBpm !== null` branch) silently retunes the whole project's
      // tempo to the seed bpm even though nothing is playing.
      void syncPreviewToEngine(pruned)
    }
  }

  function undoDiscoverAction(): void {
    if (undoStack.length === 0) return
    const snapshot = undoStack[undoStack.length - 1]
    // Every change still waiting that was queued at or after this point
    // is taken back: its row keeps the stem it has, and nothing lands for
    // it at the top. A change queued before this point stays. With radio
    // off nothing is ever waiting, so this does nothing.
    for (const slotId of manualChangesUndoneBy(
      manualChangesRef.current,
      undoSequence.seqOf(snapshot)
    )) {
      withdrawManualChange(slotId, 'manual-change-undone')
    }
    setRedoStack((prev) => [...prev, slots].slice(-DISCOVER_UNDO_LIMIT))
    setUndoStack((prev) => prev.slice(0, -1))
    applySlotsSnapshot(snapshot)
  }

  // Redo does NOT re-queue a change undo took back: a withdrawn change is
  // gone, and redo restores slots exactly as it always has. (Its entry was
  // never in a snapshot -- a waiting change is not slot state -- so there
  // is nothing for redo to bring back.)
  function redoDiscoverAction(): void {
    if (redoStack.length === 0) return
    const snapshot = redoStack[redoStack.length - 1]
    const undoPoint = markUndoSnapshot(slots)
    setUndoStack((prev) => [...prev, undoPoint].slice(-DISCOVER_UNDO_LIMIT))
    setRedoStack((prev) => prev.slice(0, -1))
    applySlotsSnapshot(snapshot)
  }

  // While radio runs, the new row appears at once but silent, and joins at
  // the loop top: it is not previewing, so its roll queues as `joining`,
  // and with candidate null until the landing's commitSlotPick,
  // reportSlotResolution has nothing to auto-join it on before then.
  function addSlot(kinds: DiscoverSlotKind[], immediate = false, radioAdded = false): void {
    pushUndoSnapshot()
    const id = freshSlotId()
    setSlots((prev) => [
      ...prev,
      {
        id,
        kinds,
        locked: false,
        candidate: null,
        hasRerolled: false,
        gain: 1,
        ...(radioAdded ? { radioAdded: true } : {})
      }
    ])
    const projectIsEmpty = !Object.values(rifffsState).some((r) => r.startBar !== undefined)
    if (projectIsEmpty) {
      void rollRandomForSlot(id, kinds, immediate)
    } else {
      void rollForSlot(id, kinds, immediate)
    }
  }

  // What the guided flow sees. resolvedStemsRef is a ref (it deliberately
  // does not re-render this panel on its own), so this effect depends on
  // resolvedBarLengths instead -- the reactive twin written in the same
  // reportSlotResolution call, which is what makes "this slot has resolved"
  // observable from out here at all. seedStem covers a Shelf-seeded slot,
  // which is already a fully resolved stem and never goes through
  // reportSlotResolution.
  // Hoisted out of the effect below so the phone remote's own push effect
  // can reuse it -- one snapshot construction, not two. `resolvedBarLengths`
  // is in the dep list for the reason the comment above gives (it is the
  // reactive twin of the resolvedStemsRef read inside) even though it is not
  // read here: without it, a slot resolving would not produce a new
  // callback identity and neither consumer would see the stem appear.
  const buildSlotSnapshots = useCallback((): CoachSlotSnapshot[] => {
    void resolvedBarLengths
    return slots.map((slot) => {
      const stem = resolvedStemsRef.current.get(slot.id) ?? slot.seedStem ?? null
      return {
        id: slot.id,
        kinds: normalizeSlotKinds(slot.kinds),
        stem:
          stem === null
            ? null
            : {
                path: stem.path,
                name: stem.name,
                author: stem.author,
                type: stem.type,
                durationSec: stem.durationSec,
                barLength: stem.barLength
              },
        gain: slot.gain,
        audible: previewingSlotIds.has(slot.id),
        rolling: rerollingSlotIds.has(slot.id)
      }
    })
  }, [slots, resolvedBarLengths, previewingSlotIds, rerollingSlotIds])

  useEffect(() => {
    if (!onCoachSlotsChange) return
    onCoachSlotsChange(buildSlotSnapshots())
  }, [buildSlotSnapshots, onCoachSlotsChange])

  // Bumped when a stem's peaks settle AFTER a push has already gone out, so
  // the effect below runs again and the phone's row stops being a flat line.
  // peekPeaks is a synchronous read of peakCache's settled map -- the very
  // same entry this slot's own <RepeatedWaveform> layers populate -- so the common
  // case costs a Map.get and the uncommon one costs a cache hit.
  const [remotePeaksTick, setRemotePeaksTick] = useState(0)

  // WHAT THE PHONE IS TOLD ABOUT RADIO. The same two states the Mac's own
  // rows draw (@shared/radioApproach), pushed so the sofa gets the same
  // "this one is about to change" the desk does -- the phone is a per-stem
  // mixer now and the information is worth as much there.
  //
  // TWO SLOT IDS AND NOTHING ELSE. It carried a `progress` fraction until
  // 2026-09-29, for a 2px rule the phone drew along the bottom of the row;
  // both ends of that are gone (Elling: "can't it be the red playhead
  // indicator instead of a progress bar? that would streamline the ui"),
  // and the phone's own red playhead already sweeps its rows. A field
  // nothing reads is a lie, so it went with the rule.
  //
  // The push below is a dependency-driven effect, not a clock, and this
  // now changes only when radio picks a different row -- a handful of
  // times a minute rather than thirty times a second.
  //
  // useMemo for that identity and nothing else: a fresh object every
  // render would make the effect below a per-render push.
  //
  // HELD is every row waiting for the loop top: radio's own held change and
  // every manual change queued while radio runs, the same rows the desktop
  // breathes as held. Keyed by the joined ids rather than the Set, whose
  // identity changes whenever a waiting entry resolves.
  const manualWaitingKey = [...manualWaitingSlotIds].join('\n')
  const radioRemote = useMemo<RemoteRadioView | null>(() => {
    const manualWaiting = manualWaitingKey === '' ? [] : manualWaitingKey.split('\n')
    const heldSlotIds =
      radioHeldSlotId !== null && !manualWaiting.includes(radioHeldSlotId)
        ? [radioHeldSlotId, ...manualWaiting]
        : manualWaiting
    if (radioArmedSlotId === null && heldSlotIds.length === 0) return null
    return { armedSlotId: radioArmedSlotId, heldSlotIds }
  }, [radioArmedSlotId, radioHeldSlotId, manualWaitingKey])

  // The renderer PUSHES; main only ever answers GET /api/state with the
  // last thing pushed. What he sees on the Mac and what he sees on the
  // phone are the same state because there is only one. remoteStateFromSlots
  // is the whole privacy boundary -- no path, no CID, nothing about the
  // library leaves here.
  useEffect(() => {
    void remotePeaksTick
    const snapshots = buildSlotSnapshots()
    const peaksBySlotId = new Map<string, readonly number[]>()
    let awaiting = false
    for (const snapshot of snapshots) {
      const path = snapshot.stem?.path
      if (path === undefined) continue
      const ready = peekPeaks(path)
      if (ready) peaksBySlotId.set(snapshot.id, ready)
      else awaiting = true
    }
    if (awaiting) {
      // Not a decode of its own in any realistic case -- the row's own
      // <Waveform> is already asking for the same path, and peakCache
      // dedupes by path. A rejection evicts its own entry there, so a
      // transient failure cannot permanently poison a row.
      for (const snapshot of snapshots) {
        const path = snapshot.stem?.path
        if (path === undefined || peekPeaks(path)) continue
        void getPeaks(path)
          .then(() => setRemotePeaksTick((n) => n + 1))
          .catch(() => {})
      }
    }
    // The loop's length in bars, for the phone's handover grid (2026-09-27:
    // "could we set it to update every 4 bars, 8 bars"). This is the SAME
    // expression syncPreviewToEngine uses for the engine's own
    // loopLengthBars and the radio clock uses for its interval, read off
    // resolvedBarLengthsRef rather than the reactive resolvedBarLengths for
    // the reason that ref's own doc comment gives -- so the phone's bar grid
    // and the loop the engine is actually looping are the same grid by
    // construction. This effect already re-runs whenever a slot resolves
    // (buildSlotSnapshots depends on the reactive twin), so the ref read is
    // current every time it matters.
    const loopBars =
      resolvedBarLengthsRef.current.size > 0
        ? Math.max(...resolvedBarLengthsRef.current.values())
        : 0
    void window.rifffApi.setRemoteState(
      remoteStateFromSlots(
        snapshots,
        {
          discoverOpen: true,
          playing,
          kept: keptCount,
          rolled: rolledCount,
          lastKeptName,
          loopBars,
          radio: radioRemote
        },
        peaksBySlotId
      )
    )
  }, [
    buildSlotSnapshots,
    playing,
    keptCount,
    rolledCount,
    lastKeptName,
    remotePeaksTick,
    radioRemote
  ])

  // What the unmount below does with manual changes still waiting. In a
  // ref, refreshed every render, for the reason remoteCommandRef is: the
  // unmount cleanup is registered once and must run THIS render's
  // commitSlotPick.
  const landWaitingOnCloseRef = useRef<() => void>(() => {})
  useEffect(() => {
    landWaitingOnCloseRef.current = (): void => {
      const waiting = manualChangesRef.current
      setManualChanges(new Map())
      for (const [slotId, change] of waiting) {
        if (!slotsRef.current.some((s) => s.id === slotId)) continue
        commitSlotPick(slotId, change.pick)
      }
    }
  })

  // Discover is closed the moment this panel unmounts -- the page then
  // says "open discover on the mac" and offers nothing else.
  useEffect(() => {
    return () => {
      void window.rifffApi.setRemoteLoop(null, [])
      void window.rifffApi.setRemoteState({
        discoverOpen: false,
        playing: false,
        kept: 0,
        rolled: 0,
        lastKeptName: null,
        loopBars: 0,
        radio: null,
        slots: []
      })
      radioClockRef.current = null
      setRadioPending(null)
      // Not clearRadioGesture: scheduling a rebuild of a panel that is
      // unmounting would be a sync into the void (and syncPreviewToEngine
      // returns early on unmountedRef anyway). Dropping the ref is what
      // matters -- nothing can re-arm from a dead panel, and the engine
      // gets a fresh project from whatever claims it next.
      radioGestureRef.current = []
      setRadioLedChange(null)
      // A closed panel has no loop top to wait for, so the waiting changes
      // land now, exactly as stopRadio lands them. Thrown away, a JOINING
      // row would stay blank for good: the slots live in the parent and
      // outlive this panel. The stem resolves and joins the mix when
      // Discover next opens.
      landWaitingOnCloseRef.current()
      radioCourseChangeRef.current = null
      // Unlike the gesture above, this one DOES have to reach the engine:
      // a staged project outlives this panel, and whatever claims the
      // engine next would have its own load-project silently cancelled by
      // it -- or, worse, get Discover's preview dropped on top of it at
      // the next wrap.
      radioStageLandedRef.current = null
      cancelStagedSwap('panel-closed')
    }
  }, [])

  // Commands are performed by calling the EXACT functions this panel's own
  // buttons call. keep is keep. There is no second implementation. Held in
  // a ref for the same stale-closure reason slotsRef exists: the listener
  // below is registered once, and must always run THIS render's functions.
  const remoteCommandRef = useRef<(command: RemoteCommand) => void>(() => {})
  useEffect(() => {
    remoteCommandRef.current = (command: RemoteCommand): void => {
      if (command.kind === 'roll-all') void rerollAll()
      else if (command.kind === 'roll-slot') void rerollSlot(command.slotId)
      else if (command.kind === 'keep') {
        // Answer the phone's own tap id with what the keep came to.
        const keepId = command.keepId
        void keepGroup().then((outcome) => {
          if (keepId !== undefined) void window.rifffApi.reportRemoteKeep(keepId, outcome)
        })
      }
      // addSlot/removeSlot are the SAME functions the add row's chips and a
      // row's own remove button call -- undo snapshot, immediate first
      // roll, preview-mix cleanup and all. The phone cannot produce a slot
      // the Mac would not have produced, because there is only one addSlot.
      // The empty guard is belt-and-braces over the server's own
      // parseRemoteSlotKinds: a slot with no kinds can match nothing and
      // would sit there forever saying "no match".
      else if (command.kind === 'add-slot') {
        if (command.kinds.length > 0) addSlot(normalizeSlotKinds(command.kinds))
      } else if (command.kind === 'remove-slot') removeSlot(command.slotId)
      // The four actions are the four buttons on every desktop slot row,
      // plus that row's own mute and its own solo -- see runSlotAction.
      else if (command.kind === 'slot-action') runSlotAction(command.slotId, command.action)
    }
  })

  useEffect(() => {
    return window.rifffApi.onRemoteCommand((command) => remoteCommandRef.current(command))
  }, [])

  // The two acks of the scheduled-swap contract. Held in a ref and
  // subscribed once, exactly as remoteCommandRef above is and for the
  // same reason: this panel re-renders on every 30Hz position tick, and a
  // subscription with these handlers in its dependency array would tear
  // down and rebuild an IPC listener thirty times a second.
  const stageAckRef = useRef<{
    result: (r: { token: number; status: string; reason?: string }) => void
    applied: (a: { token: number; via: string; atBars: number; deferrals: number }) => void
  }>({ result: () => {}, applied: () => {} })
  useEffect(() => {
    stageAckRef.current = {
      result: (r) => {
        radioTraceStageResult(r.token, r.status, r.reason) // TEMP (2026-09-29)
        // `staged` and `applied` both mean the swap is the engine's
        // problem now and will be answered by a project-applied.
        // `cancelled` and `error` mean it will never play, so the ref has
        // to let go -- otherwise stepRadioStage would sit there thinking
        // a swap was still out there and never push another.
        if (r.status !== 'cancelled' && r.status !== 'error') return
        if (radioStageRef.current?.token === r.token) radioStageRef.current = null
        if (radioStageLandedRef.current?.token === r.token) radioStageLandedRef.current = null
      },
      applied: (a) => {
        radioTraceStageApplied(a.token, a.via, a.atBars, a.deferrals) // TEMP
        // Either ref may be the one holding it -- see
        // radioStageLandedRef for why the ack and the wrap tick race.
        const mine =
          radioStageRef.current?.token === a.token
            ? radioStageRef.current
            : radioStageLandedRef.current?.token === a.token
              ? radioStageLandedRef.current
              : null
        if (mine === null) return
        if (radioStageRef.current?.token === a.token) {
          const applied = radioStageRef.current
          radioStageRef.current = null
          // Radio's held change only when this stage actually carried it --
          // always, unless manual changes rode alone or took its row.
          radioStageAppliedLedRef.current =
            applied.ledSlotId !== null ? radioLedChangeRef.current : null
          radioStageAppliedManualRef.current = applied.manual
        }
        if (radioStageLandedRef.current?.token === a.token) radioStageLandedRef.current = null
        const mapping = mine.mapping
        // The staged project is the live one now, and it has its own
        // groupId -- so the live-param keys the two pushes below address
        // have just changed underneath them. The load-project that
        // follows the commit writes this again with the same numbers.
        if (mapping !== null) currentPreviewMappingRef.current = mapping
        // Publishing a project -- staged or not -- clears every live
        // override on the engine (applyProjectPostPublish ->
        // liveOverrides().clearAll()). The master fader and the master
        // filter live ONLY in an override, so re-assert them here rather
        // than waiting for the load-project that follows the commit,
        // which is a render, a resolve and a build away.
        pushMasterLevel()
        pushMasterFilter()
      }
    }
  })
  useEffect(() => {
    const offResult = window.rifffApi.onEngineProjectStageResult((r) =>
      stageAckRef.current.result(r)
    )
    const offApplied = window.rifffApi.onEngineProjectApplied((a) => stageAckRef.current.applied(a))
    return () => {
      offResult()
      offApplied()
    }
  }, [])

  // Direct request, 2026-09-21 (combination slots), reworked twice on
  // 2026-09-22 -- final shape: a plain click adds a slot right away (single
  // click stays the fast path); shift-click ARMS a chip into this pending
  // selection instead (again to disarm), and the next plain click adds ONE
  // slot with everything armed plus the one clicked ("shift-click drums,
  // click bright = a drums · bright slot"). The row's order never changes,
  // so combining never needs the cursor to move. Esc disarms.
  //
  // Combining was cmd-click until 2026-09-29, when Cmd became "land it
  // right away" on every button that brings in a stem while radio runs
  // (docs/superpowers/specs/2026-09-29-radio-manual-changes-land-on-the-
  // top-design.md). `immediate` goes to whichever addSlot the click makes.
  //
  const [pendingAddKinds, setPendingAddKinds] = useState<DiscoverSlotKind[]>([])

  function handleAddRowKindClick(
    kind: DiscoverSlotKind,
    combine: boolean,
    immediate: boolean
  ): void {
    if (combine) {
      setPendingAddKinds((prev) => toggleSlotKind(prev, kind, { allowEmpty: true }))
      return
    }
    // Armed kinds plus the clicked one (toggleSlotKind adds it and drops a
    // bright/warm opposite; an already-armed kind is simply kept).
    const withClicked = pendingAddKinds.includes(kind)
      ? pendingAddKinds
      : toggleSlotKind(pendingAddKinds, kind, { allowEmpty: true })
    if (withClicked.length === 0) return
    addSlot(withClicked, immediate)
    setPendingAddKinds([])
  }

  const hasPendingAdd = pendingAddKinds.length > 0
  useEffect(() => {
    if (!hasPendingAdd) return
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key !== 'Escape') return
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
      setPendingAddKinds([])
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [hasPendingAdd])

  // Direct request, 2026-09-20: "add + Random to the bottom list" -- an
  // eighth button alongside the 7 kind buttons, for a slot seeded from a
  // genuinely random stem rather than narrowed to any one kind's own pool.
  // Always rolls via rollRandomForSlot (getRandomDiscoverCandidate's own
  // unranked, unfiltered pick -- see that function's own doc comment),
  // unconditionally -- unlike addSlot above, which only takes this path for
  // an EMPTY project; this button's whole point is "skip matching
  // entirely," not "match, unless the project happens to be empty."
  // randomDiscoverSlotKind (module scope, near freshSlotId above) picks
  // which kind label to show/map to a bus with, matching
  // getRandomLibraryCandidate's own "labeled with the caller's kind, not a
  // claim it IS that role" convention. Picks from every kind -- since
  // 2026-09-22 every kind can draw audio-in/mic stems too, and the roll
  // itself still honours the source dial and the my-sounds switch (the
  // kind stays random).
  function addRandomSlot(immediate = false): void {
    pushUndoSnapshot()
    const id = freshSlotId()
    const kinds = [randomDiscoverSlotKind(DISCOVER_SLOT_KIND_OPTIONS)]
    setSlots((prev) => [
      ...prev,
      { id, kinds, locked: false, candidate: null, hasRerolled: false, gain: 1 }
    ])
    void rollRandomForSlot(id, kinds, immediate)
    setPendingAddKinds([])
  }

  // Direct request, 2026-09-18: "drag a loop into discover as an added
  // channel" -- drop target is the whole panel (per Elling's own
  // preference over a narrower add-slot-only target), always treated as
  // a loop (never a one-shot -- no LoopOrOneShotPrompt here, see
  // importDiscoverLoopSeed's own doc comment for why Discover's own
  // slots don't have a meaningful one-shot shape), one new seedStem slot
  // per successfully-imported file. Non-.wav files are silently skipped
  // (pre-filtered here, before ever calling the IPC -- matches
  // importDiscoverLoopSeed's own "reject outright" behavior for anything
  // else, just without the wasted round trip), same as every other
  // failure this function's own IPC call can report (over the 60s length
  // cap, unreadable as a WAV, etc.) -- one bad file in a multi-file drop
  // doesn't abort the rest.
  //
  // ONE pushUndoSnapshot() for the whole drop (not one per file) and ONE
  // setSlots call appending every successfully-imported slot at once --
  // undoing a multi-file drop should undo all of it in one step, and
  // batching avoids a snapshot for a drop that ultimately imported
  // nothing (every file failed/was filtered).
  //
  // Kind: an externally-imported sample has no Endlesss Instrument mask at
  // all (it was never an Endlesss stem), so it can never be a genuine
  // mask-kind (drums/bass/lead) candidate in this model -- only a trait
  // kind. Computing a real trait value on the spot would mean running
  // feature extraction synchronously at import time, real per-file cost
  // this whole model exists to avoid paying casually, so every
  // externally-imported slot defaults to a single fixed trait kind
  // ('bright') below instead -- arbitrary but deterministic, cheap-and-fast
  // over exactly-right-for-every-case.
  // Shared by the drop handler and handlePickSampleImport below -- both
  // ultimately just have a list of real filesystem paths to import as
  // loop-seeded slots, one new seedStem slot per successfully-imported
  // file, matching this codebase's own drop-and-pick pairing convention
  // (Shelf.tsx's own handleDrop/handlePickImport, both funneling into
  // importFromPaths).
  async function importPathsAsLoopSeeds(paths: string[]): Promise<void> {
    if (paths.length === 0) return

    // Captured synchronously, BEFORE the first await below -- code review:
    // pushUndoSnapshot() itself reads the LIVE `slots` closure var, so
    // calling it only at the end (after this function's own multi-file
    // await loop) would capture whatever `slots` happens to be by THEN,
    // not what it was when the import started. This file's background
    // machinery (candidate resolution, autoplay-join) can legitimately
    // mutate `slots` via its own setSlots calls during that same window --
    // an undo snapshot captured late would silently fold those unrelated
    // changes into "what Undo reverts," discarding them with no
    // indication to the user. Every OTHER undoable action in this file
    // calls pushUndoSnapshot() synchronously as its very first line,
    // before any await -- this preserves that same invariant while still
    // only actually pushing the snapshot (see the end of this function)
    // once something real is confirmed to have imported, not on an
    // all-failed import.
    const preImportSlots = slots

    const newSlots: DiscoverSlot[] = []
    for (const path of paths) {
      const result = await window.rifffApi.importDiscoverLoopSeed(path, bpm)
      if (!result) continue

      const seedStem: ResolvedCandidateStem = {
        author: '',
        name: result.name,
        type: 'fx',
        path: result.path,
        durationSec: result.durationSec,
        barLength: result.barLength
      }
      newSlots.push({
        id: freshSlotId(),
        kinds: ['bright'],
        locked: false,
        candidate: null,
        hasRerolled: true,
        gain: 1,
        seedStem
      })
    }

    if (newSlots.length === 0) return
    const undoPoint = markUndoSnapshot(preImportSlots)
    setUndoStack((prev) => [...prev, undoPoint].slice(-DISCOVER_UNDO_LIMIT))
    setRedoStack([])
    setSlots((prev) => [...prev, ...newSlots])
  }

  async function handleExternalFileDrop(files: FileList): Promise<void> {
    const wavFiles = Array.from(files).filter((f) => f.name.toLowerCase().endsWith('.wav'))
    await importPathsAsLoopSeeds(wavFiles.map((f) => window.rifffApi.getPathForFile(f)))
  }

  // Direct request, 2026-09-18 ("took a while for the window to recognize
  // that it was a target [of the drag]... maybe we could have a
  // conventional file import + as well in the list '+ sample'") -- the
  // click-to-pick equivalent of handleExternalFileDrop above, for the
  // "+ sample" button alongside the per-kind "+ {kind}" add-slot buttons
  // below. The main-process picker's own WAV filter (pick-discover-loop-
  // seed-paths) means every path returned here is already the right type,
  // unlike the drop handler which has to filter an arbitrary FileList
  // itself.
  async function handlePickSampleImport(): Promise<void> {
    await importPathsAsLoopSeeds(await window.rifffApi.pickDiscoverLoopSeedPaths())
  }

  // Shared by removeSlot and applySlotsSnapshot (undo/redo) -- both need to
  // permanently forget a slot's own resolution, not just stop showing it.
  // Direct reports, 2026-09-17: this cleanup used to happen implicitly,
  // via reportSlotResolution's own null branch, whenever the affected
  // row's unmount effect fired onResolvedChange(null). That branch is now
  // a deliberate no-op for the (much more common) "mid-reroll, still
  // resolving" case -- see its own doc comment -- so genuine, permanent
  // forgetting (this id is never coming back) can no longer piggyback on
  // it. Clears resolvedStemsRef AND resolvedBarLengthsRef/
  // resolvedBarLengths -- the LATTER matters even for a slot that was
  // never part of the playing mix: syncPreviewToEngine's own
  // barLengthOverride is computed from EVERY entry in
  // resolvedBarLengthsRef, not just currently-previewing ones (see its
  // own doc comment), so a forgotten slot's stale barLength left behind
  // would keep inflating the engine's own loop length forever -- found in
  // code review, reproduced via undo: add a slot, let it resolve, press
  // undo, its barLength survives in both maps with nothing left in
  // `slots` that could ever overwrite or remove it again.
  function forgetSlotResolution(id: string): void {
    // A slot that is gone will never report a resolution, so a hold taken
    // on it would sit out its whole backstop with every push parked
    // behind it. This is the one "that stem is never coming" signal the
    // panel has that isn't a timeout.
    releaseSyncHold(id)
    resolvedStemsRef.current.delete(id)
    if (resolvedBarLengthsRef.current.has(id)) {
      const next = new Map(resolvedBarLengthsRef.current)
      next.delete(id)
      resolvedBarLengthsRef.current = next
    }
    setResolvedBarLengths((prev) => {
      if (!prev.has(id)) return prev
      const next = new Map(prev)
      next.delete(id)
      return next
    })
  }

  // Shared by removeSlot and abandonSlotResolution below -- drops `id`
  // from the previewing mix (if it's currently in it) and re-syncs the
  // engine to match, via the RAF-coalesced scheduler (safe to call from
  // several call sites in quick succession -- e.g. more than one row
  // hitting a terminal failure in the same frame -- without one full
  // build+send per row).
  /** The add half of dropFromPreviewingMix: puts `id` into the previewing
   * mix, ref and state together, and returns the new set. Does NOT sync --
   * reportSlotResolution schedules one itself, and radio's landing holds
   * every push until the joining row's stem has resolved. */
  function joinPreviewingMix(id: string): Set<string> {
    const next = new Set(previewingSlotIdsRef.current).add(id)
    previewingSlotIdsRef.current = next
    setPreviewingSlotIds(next)
    return next
  }

  function dropFromPreviewingMix(id: string): void {
    const currentlyPreviewing = previewingSlotIdsRef.current
    if (!currentlyPreviewing.has(id)) return
    const next = new Set(currentlyPreviewing)
    next.delete(id)
    previewingSlotIdsRef.current = next
    setPreviewingSlotIds(next)
    scheduleSyncPreviewToEngine(next)
  }

  /** Takes a row's waiting manual change out of the queue, and withdraws
   * any stage that may be carrying it; stepRadioStage re-stages whatever
   * else was waiting. A no-op for a row with nothing waiting -- and so
   * always, with radio off, where nothing ever waits. */
  function withdrawManualChange(id: string, reason: string): void {
    if (!manualChangesRef.current.has(id)) return
    const next = new Map(manualChangesRef.current)
    next.delete(id)
    setManualChanges(next)
    cancelStagedSwap(reason)
  }

  function removeSlot(id: string): void {
    // A waiting manual change dies with its row -- the only thing a padlock
    // or a mute cannot do to it (spec behaviour 6) -- and so does any stage
    // carrying it. Step (3) re-stages whatever else was waiting.
    withdrawManualChange(id, 'manual-change-removed')
    pushUndoSnapshot()
    dropSlot(id)
  }

  /** removeSlot without its undo point and its queue withdrawal: the row
   * goes, with everything radio and the mix knew about it. Also how the
   * density arc removes a row (radioRemovesRow), which takes no undo. */
  function dropSlot(id: string): void {
    setSlots((prev) => prev.filter((s) => s.id !== id))
    forgetSlotResolution(id)
    dropFromPreviewingMix(id)
    // Immediately rather than at the next commit's prune, so removing the
    // hooked channel frees the hook now and the next press of another
    // row's control is not silently the SECOND hook. A re-added slot gets
    // a fresh id (freshSlotId) anyway, so nothing can be resurrected.
    radioChangedAtRef.current.delete(id)
    setRadioSlotFlags((prev) => {
      const survivors = new Set(Object.keys(prev))
      survivors.delete(id)
      return pruneRadioSlotFlags(prev, survivors)
    })
  }

  /** The row's 👍 and 👎 (2026-10-01, the web radio's full-mode row
   * buttons). Undo deliberately does not cover them, the same way it does
   * not cover the padlock or mute: they are a statement about what radio
   * should do next (and, for 👍, a favourite), not an edit to the loop.
   *
   * 👍 toggles the star (toggleStemFavourite) and, only when it STARS,
   * turns hold longer on if it is off -- likeRadioSlot decides both. A
   * second 👍 un-stars and leaves the hold as it is. Radio off or a
   * padlocked row: star only. */
  function likeSlot(id: string): void {
    const slot = slots.find((s) => s.id === id)
    if (!slot || slot.candidate === null) return
    const stemCID = slot.candidate.stemCID
    // Listen-only (spec §2): 👍 still holds the row longer, but stars
    // nothing -- always the "would star" branch, never toggleStemFavourite.
    const listening = refusesNow('star')
    const opts = {
      starred: listening ? false : stemFavourites.has(stemCID),
      canHold: radioOn && !slot.locked
    }
    setRadioSlotFlags((prev) => likeRadioSlot(prev, id, opts).flags)
    if (!listening) toggleStemFavourite(stemCID)
  }
  function toggleSlotReplaceSoon(id: string): void {
    setRadioSlotFlags((prev) => toggleRadioReplaceSoon(prev, id))
  }

  // Direct request, 2026-09-20: "add duplicate channel to discover" --
  // clones this slot's own current state (kind, candidate, gain, lock,
  // seedStem) into a brand-new slot appended to the end of the list, with
  // a fresh id (two slots can never share a React key). Doesn't re-roll or
  // touch candidate/hasRerolled at all -- an exact copy of whatever this
  // slot currently shows. The new row resolves and auto-joins the preview
  // mix on its own, same as any other slot with a real candidate (see
  // reportSlotResolution's own auto-join-on-first-resolve behavior) -- no
  // special-casing needed here.
  //
  // While radio runs (and Cmd is not held) the copy appears at once but
  // silent, and joins at the loop top: it is created empty, and the
  // source's CURRENT candidate is queued for it as a joining change -- or,
  // for a source whose own stem is still waiting, that waiting pick. A
  // seeded source (seedStem, no candidate) or one with nothing at all
  // cannot be expressed as a pick, and is duplicated at once, exactly as
  // below.
  function duplicateSlot(id: string, immediate = false): void {
    const slot = slots.find((s) => s.id === id)
    if (!slot) return
    pushUndoSnapshot()
    const candidate = slot.candidate
    // A row that has no stem yet but has one WAITING -- itself added or
    // duplicated while radio ran -- is duplicated as what it is about to
    // be: the copy gets the same waiting pick.
    const waiting = radioOnRef.current ? manualChangesRef.current.get(id) : undefined
    const pick: SlotPick | null =
      candidate !== null
        ? { candidate, barUsed: null, barRequested: traitMatchBar, unranked: true }
        : (waiting?.pick ?? null)
    // Cmd on a row with a stem is today's exact copy, below. Cmd on a row
    // whose stem is still waiting lands that stem on the copy at once --
    // an instant copy of it would be a blank row for good.
    if (radioOnRef.current && pick !== null && (!immediate || candidate === null)) {
      const copyId = freshSlotId()
      setSlots((prev) => [
        ...prev,
        {
          id: copyId,
          kinds: slot.kinds,
          locked: slot.locked,
          candidate: null,
          // The source's own match-meter fields, as an exact copy carries
          // them; an unranked pick leaves them in place when it lands.
          // Meaningless for a waiting source, which has no candidate.
          pickBar: candidate !== null ? slot.pickBar : undefined,
          reclassified: candidate !== null ? slot.reclassified : undefined,
          hasRerolled: false,
          gain: slot.gain
        }
      ])
      if (immediate) commitSlotPick(copyId, pick)
      // Synchronous, straight after this action's own pushUndoSnapshot.
      else queueManualChange(copyId, pick, true, undoSequence.latest())
      return
    }
    setSlots((prev) => [...prev, { ...slot, id: freshSlotId(), radioAdded: undefined }])
  }

  // Direct reports, 2026-09-17, found in code review: a slot whose reroll
  // hit a TERMINAL failure (resolveFailed -- a real candidate was found
  // but couldn't be downloaded/decoded; or noMatchFound -- nothing at all
  // matched this slot's kind) used to keep its OLD stem's audio playing
  // in the mix forever, silently, under a UI that visibly says "failed"/
  // "no match" and hides the mute/solo/favourite controls that would let
  // the user silence it (DiscoverSlotRow's own hasStemToActOn guard).
  // reportSlotResolution's own null branch is now a deliberate no-op for
  // the transient "mid-reroll, still resolving" case (a DIFFERENT fix,
  // same investigation) -- this is the terminal counterpart: called once
  // by DiscoverSlotRow's own dedicated effect when resolveFailed or
  // noMatchFound actually settles, so a genuine dead end really does stop
  // playing and drop out of the mix, same as removeSlot's own cleanup,
  // just without removing the slot itself (the user can still reroll it).
  function abandonSlotResolution(id: string): void {
    forgetSlotResolution(id)
    dropFromPreviewingMix(id)
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
  //
  // While radio runs it waits for the loop top instead, unless `immediate`
  // (Cmd held on the popover pick). The undo snapshot is taken at the
  // click either way, as rerollSlot's is.
  //
  // Returns false only when the pick was IGNORED (a row already waiting),
  // so the popover does not recenter on a pick that never took.
  function swapSlotFromNearby(
    id: string,
    candidate: DiscoverCandidate,
    immediate = false
  ): boolean {
    if (radioOnRef.current && !immediate) {
      if (manualChangesRef.current.has(id)) return false
      pushUndoSnapshot()
      return queueManualChange(
        id,
        // barRequested: the bar a ranked roll would have asked for; a
        // nearby pick applies none, hence barUsed null.
        { candidate, barUsed: null, barRequested: traitMatchBar, unranked: true },
        !previewingSlotIdsRef.current.has(id),
        undoSequence.latest()
      )
    }
    if (immediate) withdrawManualChange(id, 'manual-change-immediate')
    pushUndoSnapshot()
    if (immediate && radioOnRef.current) {
      // See rollRandomForSlot's Cmd branch: commitSlotPick, same slot state.
      commitSlotPick(id, { candidate, barUsed: null, barRequested: traitMatchBar, unranked: true })
      radioYieldsRow(id)
      return true
    }
    setSlots((prev) =>
      prev.map((s) =>
        s.id === id ? { ...s, candidate, hasRerolled: true, seedStem: undefined } : s
      )
    )
    return true
  }

  // The PHONE's one-tap `adjacent` (docs/superpowers/specs/2026-09-27-stem-
  // actions-and-phone-1a-design.md §1.4). The desktop's own `adjacent` is
  // DiscoverNearbyPopover -- a browser -- which does not fit a 2x2 sheet of
  // 64px buttons on a phone. Same IPC, same candidate, same commit
  // (swapSlotFromNearby above, undo snapshot and all); only the choosing is
  // different, and that lives in @shared/discoverAdjacentPick so it can be
  // tested and so Math.random() stays out of this component
  // (react-hooks/purity).
  //
  // Claims a generation BEFORE the await, into the same rerollGenerationRef
  // map pickForSlot and rollRandomForSlot share -- without it, a slower
  // adjacency lookup could land on top of a newer `similar` the user fired
  // afterwards. Does NOT bump setRolledCount: the desktop's popover pick
  // does not either, and the phone's counters should keep meaning what they
  // mean on the Mac.
  async function rollAdjacentForSlot(id: string): Promise<void> {
    const slot = slotsRef.current.find((s) => s.id === id)
    const anchor = slot?.candidate ?? null
    // No anchor is the desktop's "there is no adjacent button at all" state,
    // not an error -- leave the slot exactly as it is.
    if (!slot || !anchor) return
    // A row waiting for the loop top ignores it (swapSlotFromNearby would
    // too) -- checked before the lookup, so it costs nothing.
    if (radioOnRef.current && manualChangesRef.current.has(id)) return
    const myGeneration = (rerollGenerationRef.current.get(id) ?? 0) + 1
    rerollGenerationRef.current.set(id, myGeneration)
    setRerollingSlotIds((prev) => new Set(prev).add(id))
    try {
      const nearbyArtist = rollFilter().artist
      const nearbyRaw = await window.rifffApi.getAdjacentDiscoverCandidates(
        anchor.riffCID,
        slot.kinds,
        soundSourceForLean(sourceLeanRef.current),
        nearbyArtist
      )
      const nearby = {
        older: nearbyRaw.older.map((c) => tagPickedUnderArtist(c, nearbyArtist)),
        newer: nearbyRaw.newer.map((c) => tagPickedUnderArtist(c, nearbyArtist))
      }
      if (rerollGenerationRef.current.get(id) !== myGeneration) return
      const pick = pickAdjacentCandidate(nearby.older, nearby.newer, anchor.stemCID)
      // Nothing nearby: the stem that is already playing is still the right
      // stem. Never blank the row.
      if (pick === null) return
      swapSlotFromNearby(id, pick)
    } catch (err) {
      console.error(`DiscoverPanel: rollAdjacentForSlot(${id}) failed:`, err)
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

  /** The phone's six per-row actions, each one calling the function the
   * desktop row's own button calls -- same undo snapshots, same lack of a
   * lock check (only rerollAll skips a locked slot). mute is the row's own
   * mute button and, like it, is deliberately not undoable. solo is the row's
   * own solo button, added on 2026-09-27 ("could we also add solo? first
   * press is solo, then second press is mute / like double tap") -- the
   * phone sends the verb and toggleSlotSolo decides what it means, including
   * its own restore-the-full-mix on a second solo of an already-sole slot.
   * `adjacent` is the one-tap form of the desktop popover; see
   * rollAdjacentForSlot above.
   *
   * A component-scope function rather than five branches written inline in
   * the remoteCommandRef effect below (which is what the plan for this
   * asked for): calling toggleSlotPreview DIRECTLY from inside that effect
   * makes react-hooks/immutability treat every ref reachable through
   * syncPreviewToEngine as "used in an effect", which then ERRORS on the
   * skipFirstBpmRetuneRef write in the bpm-retune effect above and on ten
   * other pre-existing lines. Reaching it through one plain function is the
   * same shape removeSlot -> dropFromPreviewingMix already has, and lints
   * clean. The mapping itself is unchanged. */
  function runSlotAction(id: string, action: RemoteSlotAction): void {
    if (action === 'mute') toggleSlotPreview(id)
    else if (action === 'solo') toggleSlotSolo(id)
    else if (action === 'similar') void rerollSlot(id)
    else if (action === 'random') void rerollRandomSlot(id)
    else if (action === 'duplicate') duplicateSlot(id)
    else if (action === 'adjacent') void rollAdjacentForSlot(id)
  }

  /** The fetch/dedupe/bar/rank/pick half of a roll. Owns the
   * rerollGenerationRef claim, the rolled counter and the per-slot
   * spinner; returns null when a NEWER call for the same slot superseded
   * this one (the caller must then write nothing) or when the IPC call
   * genuinely failed.
   *
   * `avoidOwnStem`: a RADIO re-pick (armRadioPick, a course change) also
   * steers away from the row's own current stem -- stemsToAvoid's `own`,
   * the web radio's guard. Manual rolls leave it off. */
  async function pickForSlot(
    id: string,
    kinds: DiscoverSlotKind[],
    { avoidOwnStem = false }: { avoidOwnStem?: boolean } = {}
  ): Promise<SlotPick | null> {
    // Claimed BEFORE the first await -- see rerollGenerationRef's own doc
    // comment above. Any earlier call for this SAME slot id that's still
    // awaiting getDiscoverCandidates when THIS call resolves is now stale
    // and must not write its own (older) result over this one.
    const myGeneration = (rerollGenerationRef.current.get(id) ?? 0) + 1
    rerollGenerationRef.current.set(id, myGeneration)
    // The phone's "rolled" counter. Counted in the two functions every roll
    // path funnels through (this and rollRandomForSlot below) rather than at
    // each of addSlot/rerollSlot/rerollAll/changeSlotKinds.
    setRolledCount((n) => n + 1)
    setRerollingSlotIds((prev) => new Set(prev).add(id))
    try {
      // The global [x] toggles under the add row (globalRollOptions). An empty
      // currentUsername means "no known identity," not "filter to the empty
      // string" -- slotRollOptions only sets onlyOwnStems with a username,
      // mirroring LibraryBrowser.tsx's own buildRiffFilters guard. Without
      // that, (onlyOwnStems: true, targetUser: '') would make
      // getDiscoverCandidates' own `CreatorUserName !== targetUser` check
      // exclude essentially every real stem -- zero candidates, forever.
      const rollOptions = globalRollOptions
      // The creator filter (artist mode) -- today's values in own mode.
      const f = rollFilter()
      // TEMPORARY diagnostic log (2026-09-15) -- a live report of rolling
      // staying stuck with no console errors made it impossible to tell,
      // from the outside, whether the IPC call itself was the slow part
      // or something after it. Remove once confirmed. No timing captured
      // here (react-compiler's purity rule rejects performance.now()/
      // Date.now() inside a component-defined function) -- the main
      // process's own matching log (index.ts's get-discover-candidates
      // handler) already reports its own internal timing.
      console.log(
        `DiscoverPanel: pickForSlot(${slotKindsKey(kinds)}) -- calling getDiscoverCandidates`
      )
      // Stems already on OTHER slots right now -- and, for a radio
      // re-pick, this row's own (stemsToAvoid). `slots` here is this
      // function's own closure from whenever it was called (addSlot or
      // rerollSlot) -- a slightly stale read if another slot changed mid-
      // request is an acceptable imprecision for what's fundamentally a
      // variety heuristic, not a correctness guarantee.
      const usedElsewhere = stemsToAvoid(
        slots.map((s) => ({ id: s.id, stemCID: s.candidate?.stemCID ?? null })),
        id,
        { own: avoidOwnStem }
      )
      // The source dial: this roll's source is drawn here, and the other
      // source is tried only if the drawn one has nothing NEW for this slot
      // (never at an end -- see drawSoundSource). A drawn pool made only of
      // stems already on other slots counts as nothing: at the middle of
      // the dial, a small pool (a few audio-in stems for a kind, all in
      // use) would otherwise land a duplicate half the time while the other
      // source has fresh stems to offer.
      const draw = drawSoundSource(sourceLeanRef.current)
      // Tagged with the artist they were rolled under (pickedUnderArtist).
      let candidates = (
        await window.rifffApi.getDiscoverCandidates(
          kinds,
          f.onlyOwnStems,
          f.targetUser,
          draw.first,
          f.artist
        )
      ).map((c) => tagPickedUnderArtist(c, f.artist))
      const drawnHasUnused = candidates.some((c) => !usedElsewhere.has(c.stemCID))
      if (!drawnHasUnused && draw.fallback !== null) {
        if (rerollGenerationRef.current.get(id) !== myGeneration) return null
        const fallbackCandidates = (
          await window.rifffApi.getDiscoverCandidates(
            kinds,
            f.onlyOwnStems,
            f.targetUser,
            draw.fallback,
            f.artist
          )
        ).map((c) => tagPickedUnderArtist(c, f.artist))
        // Switch to the fallback when it has something new, or when the
        // drawn source had nothing at all. Otherwise keep the drawn pool,
        // all duplicates -- the dedupe below then uses it whole, which
        // beats reporting "no match".
        const fallbackHasUnused = fallbackCandidates.some((c) => !usedElsewhere.has(c.stemCID))
        if (fallbackHasUnused || candidates.length === 0) candidates = fallbackCandidates
      }
      console.log(
        `DiscoverPanel: pickForSlot(${slotKindsKey(kinds)}) -- getDiscoverCandidates returned ${candidates.length} candidates`
      )
      if (rerollGenerationRef.current.get(id) !== myGeneration) return null
      // Direct report: adding two or three slots of the same kind (e.g.
      // several "lead" slots) often landed the exact SAME stem in every
      // one -- each slot's own roll is otherwise unaware of what every
      // OTHER slot in this same loop already picked. Prefer a candidate not
      // already used by another slot right now, when one exists; fall back
      // to the full pool otherwise (a small confirmed-candidate pool
      // duplicating across slots is still better than wrongly reporting "no
      // match" for a kind that really does have candidates, just not
      // enough distinct ones for every slot). usedElsewhere is computed
      // above, before the source-dial fallback, which uses it too.
      const deduped = candidates.filter((c) => !usedElsewhere.has(c.stemCID))
      const pool = deduped.length > 0 ? deduped : candidates
      const targetTraits = kinds.filter(isTraitSlotKind)
      // Library-wide trait bar (docs/superpowers/specs/2026-09-22-discover-
      // promise-vs-delivery-design.md, Phase 1): a requested trait needs a
      // top-40% library percentile, relaxing quietly when too few pass;
      // unanalysed stems only when nothing else is left. barUsed rides
      // along with the pick (pickBar) for the slot's match meter.
      const { pool: barred, barUsed } = applyTraitBar(pool, targetTraits, { bar: traitMatchBar })
      const ranked = rankCandidates(barred, {
        targetBpm: bpm,
        // Off in artist mode, where the toggle is dimmed: your stars are
        // not among the artist's stems.
        favouriteStemCIDs:
          rollOptions.preferFavourites && f.artist === undefined ? stemFavourites : undefined,
        // Finding, 2026-09-21: trait kinds were never passed here before,
        // so a "warm" roll ranked by BPM alone. Every trait kind in the set
        // now adds its library percentile (rankCandidates).
        targetTraits
      })
      const picked = pickReroll(ranked, chaos)
      // TEMPORARY diagnostic log (2026-09-15) -- see the matching one
      // above. Remove once confirmed.
      console.log(
        `DiscoverPanel: pickForSlot(${slotKindsKey(kinds)}) -- ranked/picked, returning pick (picked=${picked?.stemCID ?? 'null'})`
      )
      return { candidate: picked, barUsed, barRequested: traitMatchBar }
    } catch (err) {
      // Degrade gracefully, log, don't throw -- same convention as this
      // file's own resolveCandidateStem above and LibraryBrowser.tsx's
      // established try/catch + console.error-with-prefix handlers.
      // getDiscoverCandidates's own real SQL errors are deliberately left
      // to throw (see discoverCandidates.ts's doc comment) rather than
      // silently producing an empty pool, so a genuine failure here is a
      // real one worth surfacing to the console -- just not by crashing the
      // renderer or nulling out a slot's existing candidate.
      console.error(`DiscoverPanel: pickForSlot(${slotKindsKey(kinds)}) failed:`, err)
      return null
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

  /** Writes a pick onto a slot. The ONE place a rolled candidate lands, so
   * every roll path (hand-clicked, reroll-all, radio) produces the same
   * slot shape. No undo snapshot of its own -- every caller decides that
   * for itself (rerollSlot pushes one, rerollAll pushes one for the whole
   * batch, radio pushes none; see the spec's 3.4). */
  function commitSlotPick(id: string, pick: SlotPick): void {
    // A row changed by anyone counts as turned over (changeArtist) -- but
    // only by a pick rolled under the CURRENT selection: a manual reroll or
    // skip still in flight from before the switch lands the old artist's
    // stem, and that row still has to turn over.
    if (pickMatchesSelection(pick.candidate, artistRef.current)) {
      artistTurnoverRef.current.delete(id)
    } else if (pick.candidate !== null && radioOnRef.current) {
      // Rolled under a different selection than the current one -- a
      // density-arc add (or any pick) in flight across a switch: it joins
      // the turnover, so radio replaces it like every other row.
      artistTurnoverRef.current.add(id)
    }
    // THE ONE PLACE A LAYER'S STEM IS REPLACED, whoever asked for it --
    // radio's own turnover, both of its commit branches, the row's
    // similar/adjacent/random buttons, a brand-new slot's first roll and
    // the phone. Radio's recency and the replace-soon flag both describe
    // exactly that event, so they are recorded here rather than in radio's
    // two commit branches: a manual reroll HAS just changed the layer, and
    // a flag on a stem the user replaced by hand is a flag about audio
    // nobody can hear any more.
    radioTurnRef.current += 1
    radioChangedAtRef.current.set(id, radioTurnRef.current)
    // Pruned against the live ids rather than trusting that removeSlot is
    // the only way a slot can vanish -- applySlotsSnapshot (undo/redo) is
    // another -- the same way radioEligibleSlotIds re-reads slotsRef
    // rather than a snapshot. The id being committed is kept regardless:
    // slotsRef can be a render behind a slot that was only just added, and
    // dropping its entry here would be pruning a layer that exists.
    const liveIds = new Set(slotsRef.current.map((s) => s.id))
    liveIds.add(id)
    for (const known of radioChangedAtRef.current.keys()) {
      if (!liveIds.has(known)) radioChangedAtRef.current.delete(known)
    }
    setRadioSlotFlags((prev) => pruneRadioSlotFlags(forgetRadioSlotFlagOnChange(prev, id), liveIds))
    // hasRerolled set true in this same setSlots call, alongside
    // candidate -- see DiscoverSlot's own doc comment above for why this
    // only happens on the generation-guarded path (never for a stale,
    // discarded result) and why a genuine error deliberately leaves it
    // untouched.
    setSlots((prev) =>
      prev.map((s) =>
        s.id === id
          ? {
              ...s,
              candidate: pick.candidate,
              ...(pick.unranked
                ? {}
                : {
                    pickBar: pick.candidate
                      ? {
                          candidate: pick.candidate,
                          barUsed: pick.barUsed,
                          barRequested: pick.barRequested
                        }
                      : undefined,
                    reclassified: undefined
                  }),
              hasRerolled: true,
              seedStem: undefined
            }
          : s
      )
    )
  }

  // Core roll logic, shared by addSlot (a brand-new slot's own first roll)
  // and rerollSlot (an existing slot's later rerolls) -- takes `kind`
  // directly rather than looking it up via `slots.find(...)`, since addSlot
  // needs to roll a slot in the SAME tick it mints it, before that slot has
  // made it into `slots` state (a plain function defined in this render
  // still closes over THIS render's `slots`, which doesn't include it yet).
  //
  // While radio runs, the pick waits for the loop top (queueManualChange)
  // unless `immediate` (Cmd held on the click), which takes exactly the
  // radio-off path. Queueing is decided at the CALL and re-checked when the
  // pick returns: startRadio lays its bed down through addSlot a moment
  // BEFORE it switches radio on, and those first rolls must commit the way
  // they always have -- a row queued to join a mix that is not playing yet
  // would never land. Radio switched off mid-pick means instant again.
  async function rollForSlot(
    id: string,
    kinds: DiscoverSlotKind[],
    immediate = false
  ): Promise<void> {
    const queue = radioOnRef.current && !immediate
    // The undo point this roll belongs to: every caller (rerollSlot,
    // addSlot, changeSlotKinds) pushed it just before calling. Read now,
    // before the pick's await -- see queueManualChange.
    const undoSeq = undoSequence.latest()
    // A row already waiting ignores a second roll -- checked before the
    // pick, so it costs nothing.
    if (queue && manualChangesRef.current.has(id)) return
    const pick = await pickForSlot(id, kinds)
    if (pick === null) return
    if (queue && radioOnRef.current) {
      queueManualChange(id, pick, !previewingSlotIdsRef.current.has(id), undoSeq)
      return
    }
    // Cmd on a row that is already waiting: the waiting change goes
    // first, or the row would land twice.
    if (immediate) withdrawManualChange(id, 'manual-change-immediate')
    commitSlotPick(id, pick)
    // And radio gives the row up, as it does for a queued change -- after
    // the commit, so the row's fresh change time steers the re-arm away.
    if (immediate && radioOnRef.current) radioYieldsRow(id)
  }

  // Match meter reclassify (promise-vs-delivery spec, Phase 2; user
  // choice: reclassify, don't skip): records a role confirmation for the
  // slot's stem through the SAME write path Tidy Up uses (recordStemRoles
  // -- StemCategories + arrangeRole centroid training), source 'discover'.
  // The bare StemCID is passed as the entry's
  // `path`: main resolves a path to a StemCID by its basename
  // (stemCIDForPath), and a StemCID is its own basename -- so this works
  // before the stem has even finished downloading. Does NOT reroll or
  // remove the stem, and works on locked slots (it doesn't change which
  // stem the slot holds). No undo snapshot: slot content is unchanged, and
  // the write itself is a library-level confirmation like Tidy Up's. On a
  // failed write nothing changes in the UI (logged, codebase convention).
  async function reclassifySlot(id: string, role: ArrangeRole): Promise<void> {
    const candidate = slots.find((s) => s.id === id)?.candidate
    if (!candidate) return
    try {
      await recordStemRoles(
        [{ path: candidate.stemCID, arrangeRole: role }],
        'discover',
        currentSketch
      )
    } catch (err) {
      console.error(`DiscoverPanel: reclassifySlot(${candidate.stemCID}, ${role}) failed:`, err)
      return
    }
    setSlots((prev) =>
      prev.map((s) =>
        s.id === id && s.candidate === candidate ? { ...s, reclassified: { candidate, role } } : s
      )
    )
  }

  async function rerollSlot(id: string, immediate = false): Promise<void> {
    const slot = slots.find((s) => s.id === id)
    if (!slot) return
    // A waiting row ignores it (rollForSlot would too) -- checked before
    // the undo snapshot, so an ignored click leaves no empty undo step.
    if (radioOnRef.current && !immediate && manualChangesRef.current.has(id)) return
    pushUndoSnapshot()
    await rollForSlot(id, slot.kinds, immediate)
  }

  // Combination slots, 2026-09-21: the kind picker on a slot's own label.
  // One undo step per change; always rerolls, since the old candidate was
  // drawn for the old kind set.
  function changeSlotKinds(id: string, kinds: DiscoverSlotKind[]): void {
    const slot = slots.find((s) => s.id === id)
    if (!slot) return
    pushUndoSnapshot()
    // A change waiting on this row was drawn for the OLD kinds: it goes,
    // and the roll below queues one for the new kinds (radio on) or lands
    // at once (radio off, where nothing ever waits).
    withdrawManualChange(id, 'manual-change-kinds')
    setSlots((prev) => prev.map((s) => (s.id === id ? { ...s, kinds } : s)))
    void rollForSlot(id, kinds)
  }

  // Direct request, 2026-09-15: "an option to just start with a completely
  // random stem of the user's from their library, then go from there" --
  // bypasses confirmed/embedding/instrument matching entirely (unlike
  // rollForSlot above), for the exact case that prompted it: stuck at
  // "no match" regardless of how loose/confirmed the kind-based pool is.
  // Shares rerollGenerationRef/rerollingSlotIds with rollForSlot -- both
  // ultimately just set `candidate` on the same slot, so they need the
  // SAME stale-response guard against each other (a random roll landing
  // after a NEWER normal reroll for the same slot, or vice versa, must
  // not overwrite it).
  //
  // Queues while radio runs unless `immediate`, decided at the call and
  // re-checked at the result -- see rollForSlot for why both.
  async function rollRandomForSlot(
    id: string,
    kinds: DiscoverSlotKind[],
    immediate = false
  ): Promise<void> {
    const queue = radioOnRef.current && !immediate
    // See rollForSlot: the callers (rerollRandomSlot, addSlot,
    // addRandomSlot) pushed this roll's undo point just before.
    const undoSeq = undoSequence.latest()
    if (queue && manualChangesRef.current.has(id)) return
    const myGeneration = (rerollGenerationRef.current.get(id) ?? 0) + 1
    rerollGenerationRef.current.set(id, myGeneration)
    setRolledCount((n) => n + 1)
    setRerollingSlotIds((prev) => new Set(prev).add(id))
    try {
      // The creator filter (artist mode) -- today's values in own mode.
      const f = rollFilter()
      const draw = drawSoundSource(sourceLeanRef.current)
      // Falls back only on no candidate at all, unlike pickForSlot, which
      // also falls back when everything drawn is already on another slot:
      // this path has never skipped duplicates, so there is nothing to be
      // "all duplicates" of.
      let candidate = await window.rifffApi.getRandomDiscoverCandidate(
        kinds,
        f.onlyOwnStems,
        f.targetUser,
        draw.first
      )
      if (candidate !== null) candidate = tagPickedUnderArtist(candidate, f.artist)
      if (candidate === null && draw.fallback !== null) {
        if (rerollGenerationRef.current.get(id) !== myGeneration) return
        candidate = await window.rifffApi.getRandomDiscoverCandidate(
          kinds,
          f.onlyOwnStems,
          f.targetUser,
          draw.fallback
        )
        if (candidate !== null) candidate = tagPickedUnderArtist(candidate, f.artist)
      }
      if (rerollGenerationRef.current.get(id) !== myGeneration) return
      if (queue && radioOnRef.current) {
        // As a SlotPick, so the landing writes it through commitSlotPick.
        // barRequested is the bar a ranked roll would have asked for; this
        // path applies none, hence barUsed null.
        queueManualChange(
          id,
          { candidate, barUsed: null, barRequested: traitMatchBar, unranked: true },
          !previewingSlotIdsRef.current.has(id),
          undoSeq
        )
        return
      }
      if (immediate) withdrawManualChange(id, 'manual-change-immediate')
      if (immediate && radioOnRef.current) {
        // Cmd while radio runs: through commitSlotPick, so radio's change
        // time and the replace-soon flag see it, and radio's re-arm is
        // steered off this row. The same slot state the write below makes
        // (unranked leaves the match-meter fields alone). Then radio gives
        // the row up -- see rollForSlot.
        commitSlotPick(id, {
          candidate,
          barUsed: null,
          barRequested: traitMatchBar,
          unranked: true
        })
        radioYieldsRow(id)
      } else {
        setSlots((prev) =>
          prev.map((s) =>
            s.id === id ? { ...s, candidate, hasRerolled: true, seedStem: undefined } : s
          )
        )
      }
    } catch (err) {
      console.error(`DiscoverPanel: rollRandomForSlot(${slotKindsKey(kinds)}) failed:`, err)
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

  async function rerollRandomSlot(id: string, immediate = false): Promise<void> {
    const slot = slots.find((s) => s.id === id)
    if (!slot) return
    // See rerollSlot: an ignored click leaves no empty undo step.
    if (radioOnRef.current && !immediate && manualChangesRef.current.has(id)) return
    pushUndoSnapshot()
    await rollRandomForSlot(id, slot.kinds, immediate)
  }

  async function rerollAll(immediate = false): Promise<void> {
    // Direct report, 2026-09-17: "clicking the dice in discover if there
    // are no slots should add a stem" -- an empty loop has nothing for the
    // loop below to iterate over, so this button was a silent no-op on a
    // fresh/empty Discover session. Adds the first kind in the list
    // (matching the "+ drums" button's own usual first pick) rather than a
    // random one -- Math.random() during render/an event handler defined
    // at the component's top level trips this codebase's react-hooks
    // purity lint rule, and a random FIRST kind isn't something the direct
    // report actually asked for.
    if (slots.length === 0) {
      addSlot([DISCOVER_SLOT_KIND_OPTIONS[0]], immediate)
      return
    }
    // One undo snapshot for the WHOLE batch, taken up front -- calls
    // rollForSlot directly below (not the public rerollSlot wrapper, which
    // pushes its OWN snapshot per slot) so "undo" after a "reroll all"
    // restores every slot at once, in a single step, rather than only
    // walking back the last slot rerolled.
    //
    // While radio runs (no Cmd) and every unlocked row is already waiting,
    // the batch would do nothing at all -- so it pushes no undo step either.
    if (
      radioOnRef.current &&
      !immediate &&
      !slots.some((s) => !s.locked && !manualChangesRef.current.has(s.id))
    ) {
      return
    }
    pushUndoSnapshot()
    // Sequential, not Promise.all -- each slot's own reroll is a real IPC
    // round trip; running them one at a time keeps this simple and avoids
    // hammering the main process with N simultaneous full-library scans at
    // once for a loop with many slots. Locked slots are skipped entirely.
    //
    // No try/catch of its own -- rollForSlot itself never throws (it
    // catches and logs internally, above), so one slot failing can't abort
    // this loop and silently leave every LATER unlocked slot untouched.
    //
    // Iterates over the id list captured NOW, but re-reads each slot's own
    // kinds/locked from slotsRef (above) at the START of its own turn, not
    // from the `slots` array this call started with -- combination slots
    // (2026-09-21) let the kind picker edit a slot's kinds mid-batch via
    // changeSlotKinds, and a stale kinds/locked read here would reroll with
    // the WRONG kind set or ignore a lock toggled after this loop began. A
    // slot removed mid-batch (id no longer in slotsRef.current) is skipped
    // outright rather than rolling a candidate nothing will ever show.
    const slotIds = slots.map((s) => s.id)
    // While radio runs (no Cmd) the batch lands on one loop top. The undo
    // snapshot above still covers it: undo applies to the committed state.
    if (radioOnRef.current && !immediate) {
      await rerollAllOnTheTop(slotIds)
      return
    }
    for (const slotId of slotIds) {
      const current = slotsRef.current.find((s) => s.id === slotId)
      if (!current) continue
      // Radio off, or Cmd held: each row lands as its pick returns (Cmd
      // withdraws a waiting change first -- see rollForSlot).
      if (!current.locked) await rollForSlot(current.id, current.kinds, immediate)
    }
  }

  /** rerollAll while radio runs (no Cmd): every pick first, then every
   * queue in ONE tick, so the whole batch waits for -- and lands on -- the
   * same loop top. Queued one by one as each pick returned, a slow library
   * spread the batch over two or three tops.
   *
   * Picks stay sequential, as rerollAll's own are, for the main process's
   * sake. Rows already waiting when the batch reaches them are skipped, as
   * rollForSlot skips them; a row removed or re-kinded while the picks ran
   * is left alone (a re-kinded row's own roll is already on its way). A
   * row that became waiting meanwhile keeps the change it has
   * (queueManualChange declines a second). Radio switched off mid-batch
   * means instant: the picks commit, as rerollAll's radio-off path would
   * have committed them. */
  async function rerollAllOnTheTop(slotIds: string[]): Promise<void> {
    // The batch's ONE undo point, pushed by rerollAll just before -- read
    // before the first pick, so every row carries it however long the
    // picks take and whatever else is pushed meanwhile.
    const undoSeq = undoSequence.latest()
    const picks: { id: string; kindsKey: string; pick: SlotPick }[] = []
    for (const slotId of slotIds) {
      const current = slotsRef.current.find((s) => s.id === slotId)
      if (!current || current.locked) continue
      if (manualChangesRef.current.has(slotId)) continue
      const pick = await pickForSlot(current.id, current.kinds)
      if (pick === null) continue
      picks.push({ id: current.id, kindsKey: slotKindsKey(current.kinds), pick })
    }
    for (const { id, kindsKey, pick } of picks) {
      const now = slotsRef.current.find((s) => s.id === id)
      if (!now || slotKindsKey(now.kinds) !== kindsKey) continue
      if (radioOnRef.current) {
        queueManualChange(id, pick, !previewingSlotIdsRef.current.has(id), undoSeq)
      } else commitSlotPick(id, pick)
    }
  }

  /** Which slots radio is allowed to change right now: unlocked, audible
   * (a muted slot is not part of what you are listening to, so changing it
   * would be a change you cannot hear), already holding a candidate, and
   * not already mid-roll. Read from slotsRef, not `slots`, for the same
   * stale-closure reason rerollAll does -- the position-tick effect above
   * runs from a closure that can be a render behind. */
  function radioEligibleSlotIds(): string[] {
    return slotsRef.current
      .filter((s) =>
        isRadioEligibleSlot({
          locked: s.locked,
          audible: previewingSlotIdsRef.current.has(s.id),
          hasCandidate: s.candidate !== null,
          hasSeedStem: s.seedStem !== undefined,
          rerolling: rerollingSlotIds.has(s.id)
        })
      )
      .map((s) => s.id)
  }

  /** Resolve a pick's stem and warm everything the swap will ask for --
   * the stretch, the engine's decoded buffer, the waveform peaks -- so the
   * landing reads values instead of asking for them. Shared by radio's own
   * pick (armRadioPick) and every manual change. Resolves to null when the
   * candidate cannot be resolved.
   *
   * Warm the cache and deliberately ignore the result -- a null (network
   * hiccup, since-deleted riff) deletes its own cache entry, the slot
   * keeps its previous stem, and radio simply tries again at the next
   * boundary. Same soft degradation every other Discover path takes.
   *
   * Then warm the STRETCH, which is the half that was missing. Reported
   * 2026-09-28: "the transitions are a bit delayed... the actual audio
   * doesn't always start on the loop point, it takes a second to start",
   * and then, correctly, "pre-load?".
   *
   * resolveCandidateStem only downloads. The tempo-stretch happens inside
   * buildEngineProject, which does not run until the change is committed
   * -- so for any stem not recorded at this project's tempo, a rubberband
   * subprocess was spawning AFTER the boundary had already passed. The UI
   * updated from state immediately and the audio waited on a render,
   * which is exactly the split he described.
   *
   * renderStretched is content-keyed on (path, ratio), so doing it here
   * means buildEngineProject finds a hit instead of a job. The ratio MUST
   * be the one it will compute -- a different one warms a file nobody
   * wants and leaves the real render for commit time -- which is why
   * warmEngineBuffer derives it from the shared stretchRatioForStem
   * rather than writing the formula out again.
   *
   * A whole interval of lead time, so this is deliberately not awaited by
   * the caller; a failure leaves the cache cold and costs exactly what
   * today costs. */
  async function resolveAndWarmPick(pick: SlotPick): Promise<ResolvedCandidateStem | null> {
    if (pick.candidate === null) return null
    const stem = await resolveCandidateStem(pick.candidate)
    if (stem === null) return null
    // Three warms, one call. The preview always stretches (previewState
    // sets stretch true for its one rifff) and a Discover candidate is
    // never a one-shot, so the two "don't stretch at all" cases
    // buildEngineProject handles cannot arise here.
    //
    // Through the memoised resolver, NOT renderStretched directly:
    // warming the main-process file cache is only half of it. The other
    // half is that buildEngineProject asks this resolver for the
    // duration at commit time, and a bare IPC call would re-read the
    // whole file from disk to answer -- per stem, on the beat, on a main
    // thread already decoding that same audio for the waveform. Warming
    // it here means the commit reads a value instead of asking for one.
    //
    // And then the last cold thing, added 2026-09-28 after "it doesn't
    // seem to preload still.. it always takes a second for the new stem
    // to play after the loop ends": the native engine's OWN decoded
    // buffer, which until now it could not be told about until it was
    // handed a whole project naming the stem. See warmEngineBuffer.ts --
    // it is what decides whether the stretched file or the native one is
    // the one load-project will actually ask for.
    void warmEngineBuffer(
      stem,
      bpmRef.current,
      resolveStretchedForPlayback,
      (path, durationSec) => void window.rifffApi.enginePreloadStem(path, durationSec)
    )
    // And the picture, which was the last cold thing of all. Reported
    // after the engine preload landed: "it's reaching the end of a loop,
    // and a stem is blinking like it's loading, but it reaches the end
    // and the wave doesn't change until it goes a few moments into the
    // loop again."
    //
    // The row draws <RepeatedWaveform path={resolvedStem.path} />, and peakCache
    // has to DECODE that file to produce peaks. Every other warm above
    // is about the sound; none of them touches this, so the decode still
    // happened at commit -- which is why the wave arrived late even once
    // the audio did not.
    //
    // Deliberately the raw stem path, not the stretched one: the row
    // draws the stem, and peakCache is keyed by path, so warming the
    // stretched file would fill the cache with an entry nothing ever
    // asks for -- the exact mistake the two previous prefetch attempts
    // made in the other direction.
    //
    // Worth more than the picture, too: this is a full decode on the
    // main thread. Doing it here moves it off the boundary, where it was
    // competing with the very commit it was delaying.
    void getPeaks(stem.path).catch(() => {
      // peakCache evicts on rejection itself; a failed warm just means
      // the row decodes at commit, which is today's behaviour.
    })
    return stem
  }

  /** The user has claimed a row radio had spoken for -- by queueing a
   * manual change on it, or by a Cmd-click that lands one right away.
   *
   * Radio's armed (pending) pick for this row is now stale: it is dropped,
   * and radio arms a fresh one at once -- off a waiting row (armRadioPick
   * skips those), and weighted off a just-changed one (commitSlotPick's
   * change time, which is why a Cmd path calls this after its commit).
   *
   * Not covered: an arm whose pick is still IN FLIGHT when the row is
   * claimed. There is no pending pick yet to drop, so nothing here sees
   * it. For a queued change that is harmless -- armRadioPick re-checks for
   * a waiting row when its pick returns -- but a Cmd-clicked row is not
   * waiting, so that arm can still land its pick on it, and radio may turn
   * the row over again at its next change. Weighting only steers a NEW
   * choice; it cannot recall one already made.
   *
   * Radio's HELD change on this very row (the breathing one, so the likely
   * one to be clicked) gives way here, rather than being silently dropped
   * at the landing -- or, for a Cmd-click, landing over the user's stem:
   *   - its held change is cleared and any stage carrying it withdrawn;
   *   - a hole or riser radio armed to announce it comes off -- it would
   *     play on the outgoing stem of a row that is no longer radio's;
   *   - the renderer's truth goes back on the wire (the withdrawal may
   *     lose to the audio thread, or the engine may already have swapped
   *     it in), the same clear-and-push every other withdrawal uses;
   *   - radio re-arms and decides again, on another row.
   * The clock is left alone. An EARLY-decided change has not restarted
   * it yet -- that happens only at its landing, which now never comes --
   * so radio's next change comes when it would have. A change the due
   * branch held had its interval restarted when it came due; that
   * interval is spent, as it is for any change that fails its re-check.
   *
   * With radio off nothing is pending or held, so this does nothing. */
  /** Radio's HELD change is taken back: cleared, any stage carrying it
   * withdrawn, a hole or riser announcing it taken off, and the truth put
   * back on the wire. Re-arming is the caller's. */
  function radioTakesBackLed(led: NonNullable<typeof radioLedChangeRef.current>): void {
    setRadioLedChange(null)
    if (radioStageAppliedLedRef.current === led) radioStageAppliedLedRef.current = null
    cancelStagedSwap('manual-overrides-radio')
    radioGestureRef.current = radioGestureRef.current.filter(
      (g) => !(g.slotId === led.slotId && g.kind !== 'drop-out' && radioGestureLeadsChange(g.kind))
    )
    scheduleSyncPreviewToEngine(previewingSlotIdsRef.current)
  }

  function radioYieldsRow(slotId: string): void {
    let droppedPick = false
    if (radioPendingRef.current?.slotId === slotId) {
      setRadioPending(null)
      droppedPick = true
    }
    const led = radioLedChangeRef.current
    if (led !== null && led.slotId === slotId) {
      radioTakesBackLed(led)
      if (radioOnRef.current) void armRadioPick()
      return
    }
    // Not while radio holds a change elsewhere: a pick armed now could be
    // used up by nothing, and the held change's own landing arms the next.
    if (droppedPick && radioOnRef.current && radioLedChangeRef.current === null) {
      void armRadioPick()
    }
  }

  /** Queue a manual change for the next loop top. Returns false when the
   * row already has one waiting -- a second click on a waiting row is
   * ignored (Elling, 2026-09-29). `joining` is a row that is not in the
   * mix yet (added or duplicated while radio ran).
   *
   * Every way of bringing in a stem routes here while radio runs, unless
   * Cmd was held (`immediate`): rollForSlot, rollRandomForSlot,
   * swapSlotFromNearby and duplicateSlot -- and through them rerollSlot,
   * rerollRandomSlot, rerollAll, addSlot, addRandomSlot, changeSlotKinds and
   * the phone. Radio's own picks never do: they go through pickForSlot and
   * commitSlotPick directly. */
  //
  // `undoSeq` is the undo point of the ACTION that queued this -- read by
  // the caller right after its own pushUndoSnapshot (or, when the caller's
  // caller pushed it, at the caller's start), never here. Picks can take
  // seconds (reroll-all's are sequential), and another action pushing its
  // own point in between must not lend this change its later number: an
  // undo of that other action would then take this one back too.
  function queueManualChange(
    slotId: string,
    pick: SlotPick,
    joining: boolean,
    undoSeq: number,
    radioSkip = false,
    arrival: ManualArrival | null = null
  ): boolean {
    if (manualChangesRef.current.has(slotId)) return false
    const next = new Map(manualChangesRef.current)
    next.set(slotId, { pick, stem: null, joining, arrival, undoSeq, radioSkip })
    setManualChanges(next)
    // NO withdrawal of the stage that is out for this entry itself, on
    // purpose. Its stem is still null, so a re-stage now would carry
    // exactly the same set -- and a click in the last moments of the lap
    // would pull radio's own staged change out too late to get it back,
    // landing it late when it was on time. 'manual-ready' below re-stages
    // once this is ready. (radioYieldsRow withdraws only when radio's own
    // held change is on this row.)
    //
    // Radio's dropped pending pick is re-armed NOW, on another row
    // (armRadioPick skips waiting rows). Waiting for the landing lost radio
    // a whole interval whenever the landing never came -- the row removed,
    // re-kinded, Cmd-clicked, or its pick unresolvable. The landing's own
    // re-arm is guarded on radioPendingRef being null and on no held
    // change, and armRadioPick's latest-wins token covers an arm still in
    // flight, so this can never make two.
    radioYieldsRow(slotId)
    void resolveAndWarmPick(pick).then((stem) => {
      const entry = manualChangesRef.current.get(slotId)
      if (entry === undefined || entry.pick !== pick) return
      if (stem === null) {
        // Unresolvable: drop it. The row keeps what it had -- the same
        // soft degradation every other Discover path takes.
        const dropped = new Map(manualChangesRef.current)
        dropped.delete(slotId)
        setManualChanges(dropped)
        // A JOINING row had nothing to keep: dropping its change alone would
        // leave it blank and silent for good. Commit the pick instead, so it
        // shows "no match" or its failed resolve exactly as it would with
        // radio off. It is not in the mix, so nothing is heard.
        if (entry.joining) commitSlotPick(slotId, pick)
        return
      }
      const ready = new Map(manualChangesRef.current)
      ready.set(slotId, { ...entry, stem })
      setManualChanges(ready)
      // A stage already out was built without this change (it was still
      // resolving). Withdraw it so the next tick re-stages with it --
      // unless the wrap is too close for a rebuild to get there, in which
      // case the stage that is out lands as it is and this one waits for
      // the following wrap (the landing only commits what the engine
      // took). And never a stage radio aimed at a mid-lap bar: that one
      // can never carry a manual change.
      const staged = radioStageRef.current
      if (
        staged !== null &&
        // This manual entry is not in the stage (radio's own row may be).
        (staged.manual === null || !staged.manual.has(slotId)) &&
        radioLedChangeRef.current?.atBars === undefined &&
        radioBarsToWrapNow() >= MANUAL_RESTAGE_MIN_BARS
      ) {
        cancelStagedSwap('manual-ready')
      }
    })
    return true
  }
  /** Bars from the last position tick to the next wrap, or 0 when that is
   * not knowable (no clock, nothing resolved). For decisions made off the
   * position tick, in a promise callback, where `pos` is not in hand. */
  function radioBarsToWrapNow(): number {
    const clock = radioClockRef.current
    const loopBars =
      resolvedBarLengthsRef.current.size > 0
        ? Math.max(...resolvedBarLengthsRef.current.values())
        : 0
    if (clock === null || !(loopBars > 0)) return 0
    return Math.max(0, loopBars - clock.lastPos)
  }

  /** Chooses radio's NEXT change and warms it. Called right after each
   * change lands (and once when radio starts), so the prefetch gets the
   * whole interval -- 12 to 48 bars, long enough for a cold stem to
   * download before it is needed.
   *
   * The warm is the load-bearing half: resolveCandidateStem memoises by
   * `${riffCID}:${stemCID}` in a module-level map, so calling it here and
   * throwing the promise away means DiscoverSlotRow's own resolve effect
   * hits a SETTLED promise when the candidate is finally committed. Without
   * it a radio change would land hundreds of milliseconds -- or a whole
   * download -- after the downbeat it was scheduled for. */
  async function armRadioPick(): Promise<void> {
    // The LATEST arm wins. Several paths re-arm (a landing, a yielded row,
    // an ineligible pick), and one can start while another's pick is still
    // in flight -- when radioPendingRef is still null, so no guard on it can
    // see the first. A superseded arm writes nothing.
    const myArm = (radioArmTokenRef.current += 1)
    setRadioPending(null)
    // Radio's skip is radio's next change: nothing else is armed until it
    // lands (the landing re-arms) or goes (the next due tick re-arms).
    if (radioSkipWaiting()) return
    // Mid-radio artist change: keep turning rows over, one per loop top,
    // before radio's own picking resumes.
    if (
      nextTurnoverSlotId(
        radioEligibleSlotIds().filter((id) => !manualChangesRef.current.has(id)),
        artistTurnoverRef.current
      ) !== null
    ) {
      void skipRadio()
      return
    }
    // Never a row with a manual change waiting: that change wins its row
    // at the landing (mergeStageChanges), so radio's pick for it would be
    // dropped there -- a change radio lost to a manual one.
    const eligible = radioEligibleSlotIds().filter((id) => !manualChangesRef.current.has(id))
    const slotId = pickRadioSlotId(eligible, radioLastSlotRef.current, {
      turnover: radioSettings.turnover,
      changedAt: radioChangedAtRef.current,
      turn: radioTurnRef.current,
      flags: radioSlotFlagsRef.current
    })
    if (slotId === null) return
    const slot = slotsRef.current.find((s) => s.id === slotId)
    if (!slot) return
    const pick = await pickForSlot(slotId, slot.kinds, { avoidOwnStem: true })
    if (radioArmTokenRef.current !== myArm) return
    if (pick === null || pick.candidate === null) return
    if (!radioOnRef.current) return
    // The user queued a manual change on this row while the pick was in
    // flight. That change wins the row, so this pick is stale: discard it
    // and choose again among the rest. Terminates -- the next call filters
    // this row out, and with every eligible row waiting it picks nothing --
    // and only if nothing else has armed radio in the meantime.
    if (manualChangesRef.current.has(slotId)) {
      if (radioPendingRef.current === null) void armRadioPick()
      return
    }
    // Resolve and warm it -- see resolveAndWarmPick for the three warms
    // and the four fixes they record.
    void resolveAndWarmPick(pick).then((stem) => {
      if (stem === null || !radioOnRef.current) return
      // The incoming layer's own bar length, which the boundary decision
      // needs and only a resolved stem knows (a DiscoverCandidate carries
      // no barLength). Guarded against a pick that has since been
      // replaced or committed -- this lands a microtask after the
      // assignment below at the earliest, and a whole interval before the
      // change at the latest.
      if (radioPendingRef.current?.pick === pick) {
        // The stem itself, not just its length. A scheduled swap has to
        // BUILD a project out of it a lap before the commit, and this is
        // the one moment it is known to be warm.
        setRadioPending({ ...radioPendingRef.current, incomingBars: stem.barLength, stem })
      }
    })
    setRadioPending({ slotId, pick, incomingBars: null, stem: null })
  }

  // --- the density arc (2026-10-01; @shared/radioDensity) ---

  function resetDensityArc(): void {
    densityLegRef.current = null
    arcAddingRef.current = null
    arcExitRef.current = null
  }

  /** Every radio tick. At a loop top the leg advances and may start a
   * step; on every tick a row on its way out is moved along. Deferred, as
   * everything in the tick that sets state is. */
  function densityTick(wrapped: boolean, pos: number, loopBars: number): void {
    if (radioDensityOf(radioSettings) !== 'arc') return
    if (wrapped) arcLapRef.current += 1
    void Promise.resolve().then(() => {
      if (!radioOnRef.current) return
      stepArcExit(pos, loopBars)
      if (wrapped) densityAtWrap(loopBars)
    })
  }

  function densityAtWrap(loopBars: number): void {
    const rows = slotsRef.current
    const adding = arcAddingRef.current
    // A joining row is done once its change has landed or gone.
    if (adding !== null && !adding.picking && !manualChangesRef.current.has(adding.slotId)) {
      arcAddingRef.current = null
    }
    const kind = nextArcKind(rows.map((r) => r.kinds))
    const removal = arcRemovalCandidate()
    const { leg, step } = advanceDensityLeg(
      densityLegRef.current ?? newDensityLeg('growing', rows.length),
      {
        count: rows.length,
        loopBars,
        busy: arcAddingRef.current !== null || arcExitRef.current !== null,
        canAdd: kind !== null,
        canRemove: removal !== null
      }
    )
    densityLegRef.current = leg
    if (step === 'add' && kind !== null) void arcAddRow(kind)
    else if (step === 'remove' && removal !== null) {
      arcExitRef.current = { slotId: removal, phase: 'waiting', lap: arcLapRef.current }
    }
  }

  /** The row a thinning arc would remove now (pickArcRemoval), or null. */
  function arcRemovalCandidate(): string | null {
    const lengths = resolvedBarLengthsRef.current
    const longest = lengths.size > 0 ? Math.max(...lengths.values()) : 0
    const atLongest = [...lengths.values()].filter((b) => b === longest).length
    const previewing = previewingSlotIdsRef.current
    const led = radioLedChangeRef.current
    return pickArcRemoval(
      slotsRef.current.map((s) => ({
        id: s.id,
        kinds: s.kinds,
        radioAdded: s.radioAdded === true,
        locked: s.locked,
        soloed: previewing.size === 1 && previewing.has(s.id),
        held: radioSlotFlagsRef.current[s.id] === 'hook',
        busy:
          manualChangesRef.current.has(s.id) ||
          radioSkipPickingRef.current.has(s.id) ||
          led?.slotId === s.id ||
          !lengths.has(s.id),
        shrinksLoop: lengths.get(s.id) === longest && atLongest === 1,
        staleness: radioTurnRef.current - (radioChangedAtRef.current.get(s.id) ?? 0)
      }))
    )
  }

  /** A growing arc adds a row of `kind`: it appears at once, silent, and
   * joins at the loop top through the manual queue (as a row added by hand
   * while radio runs does), arriving with a filter in or a bloom. No undo
   * point: the arc is radio, and radio is performance, not an edit. */
  async function arcAddRow(kind: DiscoverSlotKind): Promise<void> {
    const id = freshSlotId()
    arcAddingRef.current = { slotId: id, picking: true }
    setSlots((prev) => [
      ...prev,
      {
        id,
        kinds: [kind],
        locked: false,
        candidate: null,
        hasRerolled: false,
        gain: 1,
        radioAdded: true
      }
    ])
    // PAN HOOK: when Discover rows can be panned (a native track of its
    // own), a row the arc adds takes its stable place in the stereo field
    // here, as the web radio's panForSlots gives it.
    const pick = await pickForSlot(id, [kind])
    const stillThere = slotsRef.current.some((s) => s.id === id)
    if (pick === null || pick.candidate === null || !stillThere) {
      if (stillThere) dropSlot(id)
      arcAddingRef.current = null
      return
    }
    if (!radioOnRef.current) {
      // Radio stopped meanwhile: it lands at once, as every waiting change
      // does when radio stops.
      commitSlotPick(id, pick)
      arcAddingRef.current = null
      return
    }
    arcAddingRef.current = { slotId: id, picking: false }
    const queued = queueManualChange(
      id,
      pick,
      true,
      undoSequence.latest(),
      false,
      densityArrival(radioSettings.transitions, [kind])
    )
    if (!queued) arcAddingRef.current = null
  }

  /** A thinning arc's row on its way out, moved along each tick:
   *   waiting -> a drop-out is armed on it for the rest of this lap (the
   *              same curve a radio drop-out uses: full, then silent for
   *              its last two bars), when no other leading gesture or
   *              stage has the lap and the drop is still ahead;
   *   fading  -> once the drop has gone silent, the row is removed, in the
   *              silence -- never across the wrap, where the curve comes
   *              back up. A lap missed for any reason starts over.
   * A row that stops being removable (padlocked, soloed, held, changed)
   * is simply kept, and the leg tries again at its next step. */
  function stepArcExit(pos: number, loopBars: number): void {
    const exit = arcExitRef.current
    if (exit === null) return
    const slot = slotsRef.current.find((s) => s.id === exit.slotId)
    const previewing = previewingSlotIdsRef.current
    if (
      !slot ||
      slot.locked ||
      radioSlotFlagsRef.current[slot.id] === 'hook' ||
      (previewing.size === 1 && previewing.has(slot.id)) ||
      manualChangesRef.current.has(slot.id) ||
      radioLedChangeRef.current?.slotId === slot.id
    ) {
      if (exit.phase === 'fading') {
        radioGestureRef.current = radioGestureRef.current.filter(
          (g) => !(g.kind === 'drop-out' && g.slotId === exit.slotId)
        )
        scheduleSyncPreviewToEngine(previewingSlotIdsRef.current)
      }
      arcExitRef.current = null
      return
    }
    // Not heard: nothing to fade.
    if (!previewing.has(slot.id)) {
      radioRemovesRow(slot.id)
      return
    }
    const dropBars = Math.min(ARC_EXIT_BEATS / 4, loopBars / 2)
    const leaveAt = loopBars - dropBars
    if (exit.phase === 'waiting') {
      const leadingArmed = radioGestureRef.current.some(
        (g) => g.kind === 'drop-out' || radioGestureLeadsChange(g.kind)
      )
      // An ordinary push would withdraw a stage that is out.
      if (leadingArmed || radioStageRef.current !== null || pos >= leaveAt - 0.25) return
      radioGestureRef.current = [
        ...radioGestureRef.current,
        { kind: 'drop-out', slotId: slot.id, beats: ARC_EXIT_BEATS, lapsLeft: 1 }
      ]
      arcExitRef.current = { ...exit, phase: 'fading', lap: arcLapRef.current }
      scheduleSyncPreviewToEngine(previewingSlotIdsRef.current)
      return
    }
    const stillArmed = radioGestureRef.current.some(
      (g) => g.kind === 'drop-out' && g.slotId === slot.id
    )
    if (!stillArmed || arcLapRef.current !== exit.lap) {
      arcExitRef.current = { ...exit, phase: 'waiting' }
      return
    }
    // Silent from leaveAt (plus the curve's short ramp); a little margin,
    // and never with a stage out.
    if (pos >= leaveAt + 0.1 && radioStageRef.current === null) radioRemovesRow(slot.id)
  }

  /** The arc removes a row: as removeSlot, but no undo point, and radio's
   * pick for it (if any) goes and is made again among the rest. */
  function radioRemovesRow(id: string): void {
    arcExitRef.current = null
    radioGestureRef.current = radioGestureRef.current.filter((g) => g.slotId !== id)
    withdrawManualChange(id, 'arc-removed')
    dropSlot(id)
    if (radioLastSlotRef.current === id) radioLastSlotRef.current = null
    if (radioPendingRef.current?.slotId === id) {
      setRadioPending(null)
      if (radioLedChangeRef.current === null && !radioSkipWaiting()) void armRadioPick()
    }
  }

  /** A skip picking its stem, or queued and waiting for the loop top. */
  function radioSkipWaiting(): boolean {
    if (radioSkipPickingRef.current.size > 0) return true
    for (const m of manualChangesRef.current.values()) if (m.radioSkip) return true
    return false
  }

  /** RADIO'S SKIP (the web radio's "next", 2026-10-01). Radio chooses ONE
   * row the way it chooses its own (pickRadioSlotId over the eligible rows:
   * turnover, staleness, flags), leaving out rows already waiting, and
   * gives it a same-kind roll that steers off its own stem. It lands by the
   * manual-change rule -- the loop top while radio runs -- and counts as
   * radio's change for that row: the landing restarts radio's interval.
   *
   * Radio's own change, decided on any row, is taken back first (as the
   * web's next does) and its armed pick dropped, and radio arms nothing
   * until the skip has landed -- so it does not change a second row at the
   * same loop top or just after. Undoable like the row's own skip. Another
   * press picks another row. */
  async function skipRadio(): Promise<void> {
    if (!radioOnRef.current) return
    const eligible = radioEligibleSlotIds().filter(
      (id) => !manualChangesRef.current.has(id) && !radioSkipPickingRef.current.has(id)
    )
    // A mid-radio artist change's rows go first (changeArtist).
    const turnoverId = nextTurnoverSlotId(eligible, artistTurnoverRef.current)
    const slotId =
      turnoverId ??
      pickRadioSlotId(eligible, radioLastSlotRef.current, {
        turnover: radioSettings.turnover,
        changedAt: radioChangedAtRef.current,
        turn: radioTurnRef.current,
        flags: radioSlotFlagsRef.current
      })
    if (slotId === null) return
    const slot = slotsRef.current.find((s) => s.id === slotId)
    if (!slot) return
    radioSkipPickingRef.current.add(slotId)
    // The turnover set this pick serves. changeArtist REPLACES the set, so a
    // different object after the await means the artist changed meanwhile:
    // the pick was rolled for the old one.
    const turnoverAtStart = artistTurnoverRef.current
    // Radio's decided change, wherever it is, and its armed pick: taken
    // back. radioYieldsRow does exactly this for its own row; here it is
    // whichever row radio had spoken for. Bumping the arm token drops an
    // arm still in flight.
    const led = radioLedChangeRef.current
    if (led !== null) radioTakesBackLed(led)
    radioArmTokenRef.current += 1
    setRadioPending(null)
    // The undo snapshot is taken only once the pick is real and current: an
    // empty pick (a turnover row with nothing by the new artist) or a stale
    // one (dropped below) changes nothing, so it must not leave an empty
    // undo step behind.
    const pick = await pickForSlot(slotId, slot.kinds, { avoidOwnStem: true })
    radioSkipPickingRef.current.delete(slotId)
    if (artistTurnoverRef.current !== turnoverAtStart) {
      // Rolled under the artist before the switch: dropped, and radio
      // re-arms (the new turnover goes first there).
      if (radioOnRef.current && !radioSkipWaiting() && radioLedChangeRef.current === null) {
        void armRadioPick()
      }
      return
    }
    // One try per row: a row whose kinds have nothing by the new artist keeps
    // its stem rather than being retried at every loop top.
    artistTurnoverRef.current.delete(slotId)
    if (pick !== null) pushUndoSnapshot()
    const undoSeq = undoSequence.latest()
    const queued =
      pick !== null &&
      radioOnRef.current &&
      slotsRef.current.some((s) => s.id === slotId) &&
      queueManualChange(slotId, pick, !previewingSlotIdsRef.current.has(slotId), undoSeq, true)
    // Nothing queued (no pick, radio stopped, the row went or was claimed
    // meanwhile): radio carries on as if the press never happened.
    if (
      !queued &&
      radioOnRef.current &&
      !radioSkipWaiting() &&
      radioLedChangeRef.current === null
    ) {
      void armRadioPick()
    }
  }

  function stopRadio(): void {
    radioOnRef.current = false
    resetDensityArc()
    setRadioOn(false)
    radioClockRef.current = null
    artistTurnoverRef.current = new Set()
    setRadioPending(null)
    radioLastSlotRef.current = null
    // Recency is about how radio has been sharing its turns out, so it
    // belongs to a run of radio and starts again with the next one.
    //
    // THE FLAGS ARE NOT CLEARED. Both halves are statements about the
    // track, not about whether the clock is running: a hook he would have
    // to re-mark every time he stopped to listen is not a hook, and a
    // layer he is tired of is still the layer he is tired of. They are
    // cleared by the things that make them untrue instead -- the change
    // that honours a replace-soon, and removing the slot.
    radioChangedAtRef.current = new Map()
    radioTurnRef.current = 0
    radioCourseChangeRef.current = null
    // A curve left on a stem after radio stops would silently break that
    // slot's gain dial -- EngineStem.volume is inert while a volume curve
    // is present (PlaybackEngine.cpp's volumeAutomated branch), and a
    // duck leaves one on every layer but the changing one.
    // radioOnRef is already false above, so the rebuild this schedules
    // writes an empty stemAutomation either way.
    setRadioLedChange(null)
    // Before clearRadioGesture, which pushes -- and an ordinary push
    // would have the engine drop the stage anyway, silently and a
    // moment later. Withdrawing first says it out loud, in the trace,
    // and leaves no window where the engine could swap to a project
    // radio has already stopped wanting.
    cancelStagedSwap('radio-off')
    clearRadioGesture()
    // AFTER clearRadioGesture, so the release flushes the rebuild it just
    // parked rather than a staler one: stopping radio mid-change would
    // otherwise leave that curve on for the rest of the hold's backstop,
    // and the whole point of clearing it here is that it comes off now.
    releaseSyncHold(null)
    // Radio off means "back to instant", so every change still waiting
    // for the loop top happens NOW rather than never -- committed exactly
    // as it would have been with radio off. A joining row joins the mix
    // the way any new row does: reportSlotResolution adds it when its
    // stem resolves. The stage that carried them was withdrawn above.
    const waiting = manualChangesRef.current
    if (waiting.size > 0) {
      setManualChanges(new Map())
      for (const [slotId, change] of waiting) {
        if (!slotsRef.current.some((s) => s.id === slotId)) continue
        commitSlotPick(slotId, change.pick)
      }
    }
    setRadioProgress(0)
    setRadioChangeWait(null)
  }

  /** Starts radio at a chosen pace. Elling, 2026-09-28: "the initial
   * prompt should be slow mid fast so the app knows how to start
   * everything." -- so the radio button opens DiscoverRadioMenu's `start`
   * mode and a pace chip lands here. The two things that happen at the
   * starting moment are now one gesture: the pace configures the clock and
   * the channel count sizes the bed.
   *
   * Lays down a bed if the panel is empty -- a button that does nothing on
   * a fresh panel is not the thing he asked for, and four layers is the
   * smallest set that sounds like a band rather than like a loop. addSlot
   * does its own first roll per slot, so this is the same clicks the user
   * would otherwise make.
   *
   * Takes the window from RADIO_PACE_BARS rather than radioSettings, on
   * purpose: the menu's own persisting write of {pace, paceBars} is async
   * and this render's radioSettings prop is still the OLD pace. Reading it
   * here would start the clock at the pace he just replaced.
   */
  function startRadio(pace: RadioPace): void {
    if (slotsRef.current.length === 0) {
      // With the density arc on, the bed starts minimal (drums, bass) and
      // the arc grows it; otherwise it is `channels` rows, as before.
      const bed = radioDensityOf(radioSettings) === 'arc' ? DENSITY_MIN : radioSettings.channels
      for (const kind of radioStarterKinds(bed)) addSlot([kind], false, true)
    }
    radioOnRef.current = true
    resetDensityArc()
    // createRadioClock, not restartRadioInterval: switching radio on is
    // where a phrase STARTS. The origin is the loop top radio started
    // inside (lapsSincePhrase counts whole laps, so a switch-on halfway
    // through a lap still puts every phrase boundary on a loop top),
    // which is the only anchor radio can see -- the transport wraps, so
    // there is no absolute bar 0 to count from.
    radioClockRef.current = createRadioClock(
      nextRadioIntervalBarsInWindow(RADIO_PACE_BARS[pace]),
      pos
    )
    radioLastSlotRef.current = null
    radioChangedAtRef.current = new Map()
    radioTurnRef.current = 0
    radioCourseChangeRef.current = null
    setRadioProgress(0)
    setRadioOn(true)
    void armRadioPick()
  }

  /** A pace chip pressed while radio is RUNNING. Elling, 2026-09-28:
   * "changing course should reset the whole thing. okay to have it be
   * dramatic."
   *
   * So this is not a re-tuning of the running clock. Four things happen:
   *   - the clock restarts on the new window, immediately, so the progress
   *     rule under the button visibly says something happened;
   *   - the pending single pick is dropped, because it belonged to the old
   *     section;
   *   - any armed drop-out is cleared, so a half-finished gesture cannot
   *     survive into the new one as a stuck layer;
   *   - every eligible layer is re-picked and warmed now, and the whole
   *     batch lands together on the next loop top (the wrap branch of the
   *     clock effect).
   *
   * LOCKED LAYERS ARE NOT TOUCHED. radioEligibleSlotIds already excludes
   * them, and that is the point: a padlock that a reset overrides is a
   * padlock nobody can trust. Muted layers are out for the same reason
   * they are out of every other radio path -- a change you cannot hear.
   *
   * Stepping a bar edge in the menu deliberately does NOT come through
   * here. A reset per keypress while settling a number would be unusable;
   * a preset is a course change, a stepper is an adjustment. */
  function armRadioCourseChange(pace: RadioPace): void {
    // Restart the loop from its top, immediately, KEEPING the stems that
    // are there. Revised 2026-09-28 after he heard the first version:
    // "oh instead of a dramatic change, just reload the stems that are
    // there currently but fresh?"
    //
    // The first version re-picked every eligible layer, which is dramatic
    // and also destroys the bed he had just spent a few minutes enjoying.
    // A change of pace is a change of pace; it is not a request for
    // different music.
    //
    // Note a plain reload would be SILENT: load-project deliberately never
    // resets the transport (IpcServer.cpp), which is exactly what lets a
    // new bed land without a jump. So the audible part is the seek. Every
    // layer re-triggers together from its own zero, the mix survives, and
    // it is a reset you can actually hear -- which "dramatic" was really
    // asking for.
    //
    // Immediately rather than at the next loop top, on purpose: at the top
    // everything is already at its zero, so a reset there would be
    // inaudible. Snapping back mid-phrase is the whole gesture.
    void window.rifffApi.engineSetPosition(0)
    // lastPos 0, not `pos`: the transport is about to report ~0, and a
    // clock still holding the old mid-loop position would read that as a
    // wrap and bank a whole phantom lap on the very next tick.
    //
    // createRadioClock, so the PHRASE restarts here too. A course change
    // is a new section and it seeks the transport to 0, so bar 0 of the
    // new phrase and bar 0 of the transport are the same instant -- which
    // is the one moment radio gets a phrase origin for free.
    radioClockRef.current = createRadioClock(
      nextRadioIntervalBarsInWindow(RADIO_PACE_BARS[pace]),
      0
    )
    setRadioProgress(0)
    setRadioPending(null)
    radioCourseChangeRef.current = null
    setRadioLedChange(null)
    // A course change turns the whole bed over at the next wrap. A single
    // staged layer aimed at that same wrap is a change from the section
    // that is being left behind.
    cancelStagedSwap('course-change')
    clearRadioGesture()
    void armRadioPick()
  }

  /** Picks and WARMS every eligible layer's next stem, then arms the batch.
   *
   * The warm is awaited here, unlike armRadioPick's fire-and-forget: a
   * course change is supposed to land as one moment, and one cold stem
   * arriving two laps after the others would read as a glitch rather than
   * a section. Cost of awaiting is that a slow download delays the whole
   * gesture to a later wrap, which is the right trade -- late together
   * beats early in pieces.
   *
   * No pushUndoSnapshot: radio is performance, not an edit, and that holds
   * for the dramatic version too. */
  async function collectRadioCourseChange(): Promise<void> {
    const eligible = radioEligibleSlotIds()
    if (eligible.length === 0) {
      void armRadioPick()
      return
    }
    const picks = await Promise.all(
      eligible.map(async (id): Promise<{ slotId: string; pick: SlotPick } | null> => {
        const slot = slotsRef.current.find((s) => s.id === id)
        if (!slot) return null
        const pick = await pickForSlot(id, slot.kinds, { avoidOwnStem: true })
        if (pick === null || pick.candidate === null) return null
        // A null resolve (network hiccup, since-deleted riff) deletes its
        // own cache entry; the pick still commits and that one row simply
        // shows as unresolved, the same soft degradation every other
        // Discover path takes.
        await resolveCandidateStem(pick.candidate)
        return { slotId: id, pick }
      })
    )
    if (!radioOnRef.current) return
    const ready = picks.filter((p): p is { slotId: string; pick: SlotPick } => p !== null)
    radioCourseChangeRef.current = ready.length > 0 ? ready : null
    if (ready.length === 0) void armRadioPick()
  }

  // Shared by addToTimeline and addToShelf below -- resolves every
  // placeable slot's own candidate down to a real stem and assembles them
  // into one Rifff, exactly the "which slots are ready, what's their real
  // gain" logic both actions need identically. Returns null when there's
  // nothing placeable yet (no slots resolved, or every resolve failed --
  // the pass-through null from assembleDiscoverRifff's own empty-members
  // case is unreachable here, since placed.length === 0 already returned
  // above) -- callers early-return on null rather than dispatching an
  // empty rifff.
  async function resolveDiscoverRifff(): Promise<DiscoverRifffAssembly | null> {
    // Direct report, 2026-09-16: "when user plunks to the timeline, the
    // volume levels should be copied over pls" -- root cause traced to
    // something bigger than just gain: this filter used to require a real
    // `candidate`, silently excluding every seedStem-only slot
    // (Shelf-sourced, or anything seeded and never since rerolled) -- not
    // placed at all, so naturally its own gain (along with everything else
    // about it) never made it onto the timeline either. A seedStem is
    // already a real, fully resolved `ResolvedCandidateStem` -- no
    // resolveCandidateStem await needed for it, unlike a candidate-based
    // slot.
    const placeable = slots.filter((s) => s.candidate !== null || s.seedStem !== undefined)
    if (placeable.length === 0) return null

    // Direct report, 2026-09-17: "when adding discover-created rifffs to
    // the arranger, i've noticed that tracks that are muted are not muted
    // in the arrangement .. can we make it so they are, if they are
    // muted?" -- this used to pass every placeable slot's own `gain`
    // (the visible drag-on-waveform slider, 0..1) straight through
    // unconditionally, with no reference to previewingSlotIds at all, so
    // a slot muted in Discover's own mix (excluded from what you hear
    // while auditioning) still landed in the placed rifff at full/whatever
    // gain. Forcing a muted slot's own gain to 0 here -- rather than
    // dropping it from `placeable` outright -- keeps the stem itself
    // present in the resulting rifff (still visible/re-adjustable later
    // via the real arranger's own per-stem gain drag, StemWaveformRow.tsx),
    // just silent, matching what "mute" actually means everywhere else in
    // this app (ChannelRow.tsx's own mute always wins over whatever gain
    // is set underneath it) rather than a one-way, unrecoverable removal.
    const resolved = await Promise.all(
      placeable.map(
        async ({
          id,
          candidate,
          seedStem,
          gain
        }): Promise<{ stem: ResolvedCandidateStem; gain: number } | null> => {
          const stem = candidate ? await resolveCandidateStem(candidate) : (seedStem ?? null)
          return stem ? { stem, gain: previewingSlotIds.has(id) ? gain : 0 } : null
        }
      )
    )
    const placed = resolved.filter(
      (r): r is { stem: ResolvedCandidateStem; gain: number } => r !== null
    )
    if (placed.length === 0) return null

    const kinds = [...new Set(placeable.map((s) => slotKindsLabel(s.kinds)))]
    // Live-reported 2026-09-27: "add to timeline, it doesn't seem to include
    // all of the stems in the discover modal" -- with twelve slots built, four
    // silently vanished. This call used to omit `maxMembers` and so inherited
    // assembleDiscoverRifff's own MAX_STEMS_PER_RIFFF default of 8, which
    // slice(0, 8)'d the rest away without a word.
    //
    // That 8 is the RIFF LIBRARY's limit -- Riffs.StemCID_1..8 in
    // riffLibrarySchema.ts -- and it binds a rifff being written to that
    // table. It does not bind this one. A timeline placement is project
    // state: Rifff.stems is a plain Stem[], projectFile.ts has no StemCID
    // columns, and stemKey(groupId, slot) is arithmetic, not a schema. The
    // cap was inherited by accident rather than chosen.
    //
    // Exactly the same bug, in the other half of this component, was fixed
    // on 2026-09-16 ("i can only hear the last stem if i solo it"): the
    // engine-preview call shared this same default until it was given an
    // explicit members.length. So >8 through buildEngineProject and the
    // native engine is not a hope -- it is the path the preview has taken
    // ever since, which is why he can HEAR all twelve while only eight land.
    //
    // `keep` into the discovered room is the one that really is capped at 8,
    // because it does write that table. Raising it to 20 needs a side table
    // and is its own piece of work.
    return assembleDiscoverRifff(
      `discover: ${kinds.join('+')}`,
      placed.map(({ stem, gain }) => ({ stem, gain })),
      bpm,
      placed.length
    )
  }

  // Commits whatever loop is currently built in Discover onto the real
  // timeline, as ONE UNITED rifff, one undo step -- direct request,
  // 2026-09-15: "when i say plunk into arranger.. it places them there,
  // but i'd like them to be united like a rifff, and to have all of the
  // shorter bits looped so they create a full group." Every slot that
  // currently has a candidate (locked or not: this commits whatever's
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
  // shorter stems to fill the group for free. The actual per-slot resolve
  // (candidate -> real stem) and assembly into that single Rifff happens in
  // resolveDiscoverRifff above (shared with addToShelf below) -- see that
  // helper's own doc comment for that mechanics.
  async function addToTimeline(): Promise<void> {
    if (refusesNow('addToTimeline')) return
    setAddingToTimeline(true)
    try {
      const assembly = await resolveDiscoverRifff()
      if (!assembly) return
      const { rifff, vol } = assembly

      // Appends after the furthest-right currently-placed clip, matching
      // "adds alongside, never replaces" from the design spec's own §8.4 --
      // never touches an existing rifff's own startBar. Each clip's own
      // END is resolvedPlayedBarsFromFields (a resize override, if any,
      // else barLength) -- NOT barLength alone -- see playedBarsState's
      // own doc comment above for why: a clip extended past its own
      // barLength ends later than raw barLength says, and appending
      // against the wrong (shorter) end lands the new clip inside the
      // extended one's own still-playing range instead of after it.
      const placedEnds = Object.values(rifffsState)
        .filter((r) => r.startBar !== undefined)
        .map(
          (r) =>
            (r.startBar ?? 0) +
            resolvedPlayedBarsFromFields(playedBarsState[r.groupId], r.barLength)
        )
      const startBar = placedEnds.length > 0 ? Math.max(...placedEnds) : 0

      dispatch({ type: 'PLACE_LOOP_ON_TIMELINE', stems: [rifff], startBar, vol })

      // Real bug, live-reported 2026-09-17: "i just clicked add to timeline
      // and the last slot started playing the previous instance of that slot
      // (maybe one that i had added to the timeline before?) but the
      // waveform stayed the same."
      //
      // Root cause, in the version of this function that used to live here:
      // it unconditionally called releaseEngine() and reset
      // previewLoadedRef/currentPreviewMappingRef, on the theory that
      // handing the engine back to the real arrangement was the right thing
      // to do after plunking. What that actually produced:
      //   1. PLACE_LOOP_ON_TIMELINE changes state.rifffs, which is a listed
      //      dependency of StoreContext.tsx's own coalesced engine-sync
      //      effect.
      //   2. releaseEngine() dropped the 'discover-preview' claim, so that
      //      effect's own ownership gate no longer skipped -- on the next
      //      animation frame it built and sent the REAL project.
      //   3. Nothing in here touches `playing` or the transport position
      //      (deliberately -- direct request: "when adding to shelf or
      //      timeline... i think we can skip the pausing. the temp alert is
      //      enough"), and load-project never seeks. So the engine kept
      //      playing from the PREVIEW's current bar position (a small
      //      number -- the preview loop is a few bars) but against the real
      //      arrangement, where bar ~0-4 holds whatever was plunked in
      //      EARLIER. That's the report, exactly: you hear the previous
      //      placement.
      //   4. Nothing ever re-triggered syncPreviewToEngine afterwards
      //      (`slots` unchanged, no row re-resolved, bpm unchanged), and the
      //      playhead is gated on previewingSlotIds, not on
      //      previewLoadedRef -- so Discover went on LOOKING like it was
      //      previewing while the engine stayed on the real arrangement
      //      indefinitely. UI current, audio stale.
      //
      // The fix keeps the Discover preview owning the engine instead of
      // handing it back: "imagine it a live composition tool... ensure it's
      // smooth and doesn't interrupt the flow" (direct request, the framing
      // for this whole class of Discover playback-continuity issues).
      // Plunking is an ADDITIVE act -- the user is still building; nothing
      // about it asks for the audition to stop.
      //
      // Why this is race-free, and why it must be a syncPreviewToEngine call
      // rather than "just don't release":
      //   - syncPreviewToEngine claims ownership SYNCHRONOUSLY, at its very
      //     top, before its first await. Calling it here therefore means
      //     ownership is 'discover-preview' continuously, with no window at
      //     all in which StoreContext's coalesced sync could observe a null
      //     owner -- that effect's own check happens inside a rAF callback
      //     that cannot possibly run before this synchronous body finishes.
      //     It goes dirty and re-checks every frame, harmlessly, until
      //     Discover really does release (panel close / last slot toggled
      //     off), at which point the real project -- including what we just
      //     placed -- syncs for free. No ordering assumption about WHICH
      //     rAF was registered first is needed, because we never release.
      //   - claim() bumps the same shared generation release() did, so the
      //     straggling-in-flight-call invalidation the old releaseEngine()
      //     call provided is preserved exactly (an in-flight
      //     syncPreviewToEngine's stillOwnEngine check goes false), as is
      //     the previewSyncGenerationRef guard (syncPreviewToEngine bumps
      //     that itself, at its top, for the same reason).
      //   - And it must be a real resync, not merely holding the claim: the
      //     straggler we just invalidated may have been carrying a NEWER
      //     preview (a reroll that landed mid-flight). Dropping it without
      //     resyncing would leave the engine on the older preview while the
      //     rows show the newer one -- the same UI-current/audio-stale bug,
      //     one layer down.
      //
      // previewLoadedRef is deliberately NOT reset: the preview genuinely IS
      // still loaded (that was only true-by-accident before, when the real
      // sync effect silently overwrote it). Leaving it true is what keeps
      // this resync off syncPreviewToEngine's `!previewLoadedRef.current`
      // branch -- the ONLY place that pauses, seeks to 0 and plays. So the
      // engine swaps in a rebuilt-but-identical preview project underneath a
      // transport that never stops or seeks: no restart from zero, no
      // pause, exactly the same in-place reload every reroll already does
      // while playing.
      if (previewLoadedRef.current) {
        void syncPreviewToEngine(previewingSlotIdsRef.current)
      } else {
        // No preview is loaded, so there's nothing to keep playing and no
        // reason to hold the engine hostage -- hand it back so the
        // coalesced sync effect picks up the rifff we just placed. release()
        // also invalidates any in-flight syncPreviewToEngine that claimed
        // but hasn't loaded anything yet (its stillOwnEngine check goes
        // false after its next await), and the generation bump below does
        // the same at this component's own layer.
        releaseEngine()
        currentPreviewMappingRef.current = null
        previewSyncGenerationRef.current += 1
      }
      setJustAddedToTimeline(true)
      window.setTimeout(() => setJustAddedToTimeline(false), 500)
    } finally {
      setAddingToTimeline(false)
    }
  }

  // Same underlying build as addToTimeline above, but stops after adding
  // the assembled loop to the shelf (ADD_TO_SHELF) instead of placing it on
  // the arranger -- direct request, 2026-09-17: "let's also have a button
  // to Add to Shelf, which just adds it to the shelf and not the
  // arrangement proper." Passes the SAME real per-slot vol map
  // resolveDiscoverRifff() already computed, so ADD_TO_SHELF's own
  // sqrtGain loudness-compensation default (store.ts) never kicks in for
  // these stems -- see that reducer case's own doc comment. No
  // engine-ownership release/ref reset here, unlike addToTimeline: a
  // shelved rifff has no startBar, so it never needs to reach the engine,
  // and the discover preview stays legitimately loaded/owned for
  // continued building.
  async function addToShelf(): Promise<void> {
    if (refusesNow('addToShelf')) return
    setAddingToShelf(true)
    try {
      const assembly = await resolveDiscoverRifff()
      if (!assembly) return
      const { rifff, vol } = assembly
      dispatch({ type: 'ADD_TO_SHELF', rifff, vol })
      setJustAddedToShelf(true)
      window.setTimeout(() => setJustAddedToShelf(false), 500)
    } finally {
      setAddingToShelf(false)
    }
  }

  // Reuses resolveDiscoverRifff() verbatim -- the same helper addToTimeline
  // and addToShelf already share, which is what carries one non-obvious
  // inherited behaviour worth keeping: a slot muted in the preview mix is
  // placed at gain 0, not dropped, so a muted stem is saved as silence,
  // still there, still un-muteable later.
  /** Returns what the keep came to, for the phone's confirmation
   * (RemoteKeepOutcome). The Mac's own button ignores it. */
  async function keepGroup(): Promise<RemoteKeepOutcome> {
    // Inlined rather than refusesNow('keep'): through refusesNow, this line
    // makes the React Compiler reject the whole component (18 lint errors,
    // bisected in review). Same rule, through blockedActions.
    const nowMode = artistMode(artistRef.current, currentUsername)
    const still = nowMode === 'own' ? lingeringArtists(slotsRef.current) : []
    if (blockedActions(nowMode, still).has('keep')) return 'refused'
    setKeeping(true)
    try {
      const assembly = await resolveDiscoverRifff()
      if (!assembly) return 'none'
      const { rifff, vol } = assembly
      const members = rifff.stems.map((stem) => ({
        path: stem.path,
        gain: vol[stemKey(rifff.groupId, stem.slot)] ?? 1,
        name: stem.name,
        author: stem.author,
        barLength: stem.barLength,
        durationSec: stem.durationSec
      }))
      // The rows' lingering artists as of NOW, so main can refuse even if
      // its mirror has not caught up (refusesKeep).
      const saved = await window.rifffApi.saveDiscoveredRifff(
        members,
        bpm,
        rifff.barLength,
        lingeringArtists(slotsRef.current)
      )
      if (!saved) return 'none'
      // Main refused it: Discover is playing another user's stems.
      if (isKeepRefused(saved)) {
        setKeptLabel('listening only')
        window.setTimeout(() => setKeptLabel(null), 1500)
        return 'refused'
      }
      setKeptLabel(saved.duplicate ? 'already kept' : '✓ kept')
      window.setTimeout(() => setKeptLabel(null), 500)
      if (!saved.duplicate) {
        // friendlyRiffName returns "misty kestrel 1a2b3c4d library"; the
        // phone's eyebrow flashes just the pair.
        setKeptCount((n) => n + 1)
        setLastKeptName(saved.name.replace(/ \w{8} library$/, ''))
      }
      return saved.duplicate ? 'already' : 'kept'
    } catch (err) {
      console.error('DiscoverPanel: keep failed:', err)
      return 'none'
    } finally {
      setKeeping(false)
    }
  }

  async function fetchHearts(): Promise<void> {
    if (refusesNow('fetchHearts')) return
    setFetchingHearts(true)
    try {
      const result = await window.rifffApi.fetchRadioHearts()
      if (result.ok && result.favourited > 0) reloadStemFavourites()
      setHeartsLabel(heartFetchLabel(result))
      window.setTimeout(() => setHeartsLabel(null), 2500)
    } catch (err) {
      console.error('DiscoverPanel: fetchRadioHearts failed:', err)
      setHeartsLabel(heartFetchLabel({ ok: false, reason: 'unreachable' }))
      window.setTimeout(() => setHeartsLabel(null), 2500)
    } finally {
      setFetchingHearts(false)
    }
  }

  // What the "match seed" button below actually promises: the seed riff's
  // own tempo, rounded (direct report, 2026-09-17: a raw decimal like
  // "105.01000213623047" was showing up in this button's own label), AND
  // clamped to SET_TEMPO's own [40, 200] range (store.ts) -- without this,
  // a seed riff outside that range would dispatch a value the reducer
  // silently clamps to something OTHER than what this button just displayed
  // and compared against, leaving the button permanently stuck visible
  // (comparing against a bpm the reducer could never actually store).
  // Computed once here and reused everywhere below instead of recomputing
  // the same expression at each of the 4 read sites.
  const seedTempo = seedBpm !== null ? Math.min(200, Math.max(40, Math.round(seedBpm))) : null

  // A lingering row radio will never turn over (locked, or muted out of the
  // mix): the line then says what clears it.
  // Only while lingering stems block anything (blockedActions).
  const lingeringBlocks = lingering.length > 0 && listenOnly.size > 0
  const lingeringStuck =
    lingeringBlocks &&
    slots.some(
      (s) =>
        s.candidate?.pickedUnderArtist !== undefined && (s.locked || !previewingSlotIds.has(s.id))
    )
  const listenOnlyTip =
    mode === 'other' && artist !== null
      ? listenOnlyTooltip(artist)
      : lingeringBlocks
        ? lingeringNotice(lingering, lingeringStuck)
        : undefined

  return (
    <div
      style={{
        padding: 10,
        overflowY: 'auto',
        flex: 1,
        // Cosmetic-only drag-over highlight, see isDraggingOverExternalFile's
        // own doc comment -- an inset outline (not a real border) so it
        // doesn't shift any layout while active.
        outline: isDraggingOverExternalFile ? '2px dashed var(--ra-stretch-on)' : 'none',
        outlineOffset: -2
      }}
      onDragOver={(e) => {
        // Only ever true for a real OS file drag (Finder), never any of
        // this app's own internal HTML5 drags (e.g. the Timeline's own
        // rifff-group-id text payload) -- those never populate
        // dataTransfer.files. preventDefault() is required for onDrop to
        // ever fire at all (the browser default is "reject the drop").
        if (e.dataTransfer.types.includes('Files')) e.preventDefault()
      }}
      onDragEnter={(e) => {
        if (e.dataTransfer.types.includes('Files')) setIsDraggingOverExternalFile(true)
      }}
      onDragLeave={() => setIsDraggingOverExternalFile(false)}
      onDrop={(e) => {
        if (e.dataTransfer.files.length === 0) return
        e.preventDefault()
        setIsDraggingOverExternalFile(false)
        void handleExternalFileDrop(e.dataTransfer.files)
      }}
    >
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
          motion.
          2026-09-29: except the one button that STARTED the roll, which
          now pulses (discover-slot-pulse) -- it replaced the row's
          spinning dice. */}
      <style>{`
        @keyframes discover-slot-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.35; }
        }
        @keyframes discover-dice-spin {
          0% { transform: rotate(0deg); }
          35%, 100% { transform: rotate(360deg); }
        }
        @keyframes discover-slot-working {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
        @keyframes discover-add-pulse {
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

      {/* Two rows -- filters/settings, then actions. Direct report, 2026-09-17:
          "the top area is cluttered with buttons currently, youll need to
          rethink it all" -- the single row (chaos slider, tempo controls, two
          checkboxes, undo/redo, play/stop, reroll-all, plus the add-to-shelf/
          add-to-timeline pair) packed in too much for one line. */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 10,
          marginBottom: 10
        }}
      >
        {/* Direct request, 2026-09-16: "we should add a play/stop button
            for the discover playing, so user can stop it if they wish" --
            same merged play/stop toggle + glyphs as TransportBar.tsx's own
            (`■`/`▶`), dispatching the exact same shared PLAY/PAUSE this
            panel's own syncPreviewToEngine already uses internally. Doesn't
            touch previewingSlotIds (which slots are toggled into the mix)
            -- just starts/stops the transport itself, same as muting
            everything would achieve for audibility but without losing
            track of what was toggled on. Moved to the front of the settings
            row (was the actions row) -- direct request, 2026-09-17. */}
        <button
          onClick={() => dispatch({ type: playing ? 'PAUSE' : 'PLAY' })}
          disabled={previewingSlotIds.size === 0}
          data-tooltip={playing ? 'stop' : 'play'}
          aria-label={playing ? 'stop' : 'play'}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 22,
            height: 22,
            padding: 0,
            fontSize: 11,
            border: '1px solid var(--ra-border-strong)',
            background:
              previewingSlotIds.size === 0
                ? 'var(--ra-bg-row-active)'
                : playing
                  ? 'var(--ra-play-on)'
                  : 'var(--ra-bg-row-active)',
            color:
              previewingSlotIds.size === 0
                ? 'var(--ra-text-4)'
                : playing
                  ? 'var(--ra-play-on-ink)'
                  : 'var(--ra-text)',
            cursor: previewingSlotIds.size === 0 ? 'default' : 'pointer'
          }}
        >
          {playing ? '■' : '▶'}
        </button>
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
        {seedTempo !== null && seedTempo !== bpm && (
          <button
            onClick={() => dispatch({ type: 'SET_TEMPO', bpm: seedTempo })}
            title={`seed tempo ${seedTempo} bpm`}
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
            match seed ({seedTempo})
          </button>
        )}
        <span style={{ width: 1, alignSelf: 'stretch', background: 'var(--ra-border)' }} />
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
          data-tooltip="undo"
          aria-label="undo"
          style={{
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
          data-tooltip="redo"
          aria-label="redo"
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
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <span style={{ marginLeft: 'auto' }} />
        <button
          ref={artistButtonRef}
          onClick={(e) => {
            if (artistMenu) {
              setArtistMenu(null)
              return
            }
            const rect = e.currentTarget.getBoundingClientRect()
            setArtistMenu({ x: rect.left, y: rect.bottom + 4 })
          }}
          aria-expanded={artistMenu !== null}
          data-tooltip="whose stems discover plays"
          style={{
            fontFamily: 'inherit',
            fontSize: 10,
            padding: '6px 10px',
            background: 'transparent',
            border: '1px solid var(--ra-border)',
            color: mode === 'other' ? 'var(--ra-text)' : 'var(--ra-text-2)',
            cursor: 'pointer'
          }}
        >
          {artistFieldLabel(artist, currentUsername)}
        </button>
        {artistMenu && (
          <DiscoverArtistPicker
            x={artistMenu.x}
            y={artistMenu.y}
            artist={artist}
            ownUsername={currentUsername}
            onPick={(next) => changeArtist(normalizeArtistPick(next, currentUsername))}
            onClose={() => setArtistMenu(null)}
            ignoreRef={artistButtonRef}
            footerExtra={
              artist !== null ? (
                <button
                  disabled={!discoverConsented || analysisQueued !== null}
                  data-tooltip={
                    discoverConsented
                      ? "queue this artist's stems for the overnight scan"
                      : 'turn on library analysis first'
                  }
                  onClick={() => {
                    // Disabled while the call runs (the label is non-null).
                    setAnalysisQueued('queueing…')
                    window.rifffApi
                      .discoverQueueArtistAnalysis(artist)
                      .then((r) => {
                        // The whole queue's size: "queued 0" says nothing
                        // when this artist's stems were all queued already.
                        setAnalysisQueued(`${r.size.toLocaleString('en-US')} queued`)
                        announceArtistScanQueued(r.size)
                      })
                      .catch((err: unknown) => {
                        console.error('DiscoverPanel: discoverQueueArtistAnalysis failed:', err)
                        setAnalysisQueued('couldn’t queue')
                        window.setTimeout(() => setAnalysisQueued(null), 2500)
                      })
                  }}
                  style={{
                    fontFamily: 'inherit',
                    fontSize: 9,
                    padding: '2px 6px',
                    background: 'transparent',
                    border: '1px solid var(--ra-border)',
                    color:
                      !discoverConsented || analysisQueued !== null
                        ? 'var(--ra-text-4)'
                        : 'var(--ra-text-2)',
                    cursor: !discoverConsented || analysisQueued !== null ? 'default' : 'pointer'
                  }}
                >
                  {analysisQueued ?? 'analyse overnight'}
                </button>
              ) : undefined
            }
          />
        )}
        {/* Radio -- docs/superpowers/specs/2026-09-26-radio-mode-design.md.
            Lit with --ra-play-on when on, exactly like the play/stop button
            in the settings row above: the transport is audio information
            and so is this. The label is `radio` either way; the lit state
            says the rest. */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <button
            ref={radioMenuButtonRef}
            onClick={(e) => {
              // ON -> off is still one press; the button is the stop.
              if (radioOn) {
                closeRadioMenu()
                stopRadio()
                return
              }
              // OFF -> the start prompt. Elling, 2026-09-28: "the initial
              // prompt should be slow mid fast so the app knows how to
              // start everything." A pace chip is what actually starts
              // radio (startRadio below), so this press only opens the
              // choice -- Escape or a click elsewhere cancels it, which
              // is why it is a popover and not a dialog with an OK.
              if (radioMenu) {
                closeRadioMenu()
                return
              }
              const rect = e.currentTarget.getBoundingClientRect()
              setRadioMenu({ x: rect.left, y: rect.bottom + 4 })
            }}
            aria-expanded={!radioOn && radioMenu !== null}
            data-tooltip={radioOn ? 'stop radio' : 'start radio'}
            style={{
              fontFamily: 'inherit',
              fontSize: 10,
              padding: '6px 14px',
              background: radioOn ? 'var(--ra-play-on)' : 'transparent',
              border: '1px solid var(--ra-border-strong)',
              color: radioOn ? 'var(--ra-play-on-ink)' : 'var(--ra-text)',
              cursor: 'pointer'
            }}
          >
            radio
          </button>
          {/* How far through the current interval. Monochrome on purpose --
              this is chrome, not audio information, and colour in this app
              is spent only on things that carry audio information. A line
              rather than a number because a number that jitters at 30Hz is
              worse than a line that does. */}
          <div
            style={{
              height: 2,
              background: 'var(--ra-border)',
              visibility: radioOn ? 'visible' : 'hidden'
            }}
          >
            <div
              style={{
                height: '100%',
                width: `${Math.round(radioProgress * 100)}%`,
                background: 'var(--ra-text-3)'
              }}
            />
          </div>
        </div>
        {/* Radio's skip (the web radio's "next", 2026-10-01): radio picks a
            row as it would and changes it at the loop top. Square, like
            the settings chevron beside it; only while radio runs. */}
        {radioOn && (
          <button
            onClick={() => void skipRadio()}
            data-tooltip="skip a row"
            aria-label="skip a row"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 22,
              height: 22,
              padding: 0,
              background: 'transparent',
              border: '1px solid var(--ra-border)',
              color: 'var(--ra-text-3)',
              cursor: 'pointer'
            }}
          >
            <SkipForward size={12} />
          </button>
        )}
        {radioOn && (
          <button
            ref={radioChevronRef}
            onClick={(e) => {
              if (radioMenu) {
                closeRadioMenu()
                return
              }
              const rect = e.currentTarget.getBoundingClientRect()
              setRadioMenu({ x: rect.left, y: rect.bottom + 4 })
            }}
            aria-expanded={radioMenu !== null}
            data-tooltip="radio settings"
            aria-label="radio settings"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 22,
              height: 22,
              padding: 0,
              fontFamily: 'inherit',
              fontSize: 9,
              background: 'transparent',
              border: '1px solid var(--ra-border)',
              color: radioMenu ? 'var(--ra-text)' : 'var(--ra-text-3)',
              cursor: 'pointer'
            }}
          >
            v
          </button>
        )}
        {radioMenu && (
          <DiscoverRadioMenu
            x={radioMenu.x}
            y={radioMenu.y}
            mode={radioOn ? 'running' : 'start'}
            settings={radioSettings}
            onChange={(patch) => void onRadioSettingsChange(patch)}
            onNewBed={() => void collectRadioCourseChange()}
            onPace={(pace) => {
              closeRadioMenu()
              if (radioOn) armRadioCourseChange(pace)
              else startRadio(pace)
            }}
            onClose={closeRadioMenu}
            ignoreRef={radioOn ? radioChevronRef : radioMenuButtonRef}
          />
        )}
        <button
          onClick={(e) => void rerollAll(e.metaKey)}
          disabled={rerollingSlotIds.size > 0}
          aria-label={rerollingSlotIds.size > 0 ? 'rerolling…' : 'similar all'}
          data-tooltip={rerollingSlotIds.size > 0 ? 'rerolling…' : 'similar all'}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 30,
            height: 30,
            padding: 0,
            background: 'transparent',
            border: 'none',
            color: rerollingSlotIds.size > 0 ? 'var(--ra-text-4)' : 'var(--ra-stretch-on)',
            cursor: rerollingSlotIds.size > 0 ? 'default' : 'pointer'
          }}
        >
          {/* Direct request, 2026-09-21: "instead of that loader, have the
              dice spin intermittently" -- replaces the LoadingLoader that
              used to swap in here while anything rerolls. */}
          <DiceIcon size={18} spinning={rerollingSlotIds.size > 0} />
        </button>
        <button
          onClick={() => void keepGroup()}
          disabled={keeping || listenOnly.has('keep')}
          data-tooltip={listenOnly.has('keep') ? listenOnlyTip : 'keep this group'}
          style={{
            fontFamily: 'inherit',
            fontSize: 10,
            padding: '6px 14px',
            background: 'transparent',
            border: '1px solid var(--ra-border-strong)',
            color: keeping || listenOnly.has('keep') ? 'var(--ra-text-4)' : 'var(--ra-text)',
            cursor: keeping || listenOnly.has('keep') ? 'default' : 'pointer',
            animation: keptLabel !== null ? 'discover-add-pulse 500ms ease-out' : undefined
          }}
        >
          {keeping ? 'keeping…' : (keptLabel ?? 'keep')}
        </button>
        <button
          onClick={() => void fetchHearts()}
          disabled={fetchingHearts || listenOnly.has('fetchHearts')}
          data-tooltip={listenOnly.has('fetchHearts') ? listenOnlyTip : 'fetch radio hearts'}
          style={{
            fontFamily: 'inherit',
            fontSize: 10,
            padding: '6px 14px',
            background: 'transparent',
            border: '1px solid var(--ra-border-strong)',
            color:
              fetchingHearts || listenOnly.has('fetchHearts')
                ? 'var(--ra-text-4)'
                : 'var(--ra-text)',
            cursor: fetchingHearts || listenOnly.has('fetchHearts') ? 'default' : 'pointer',
            animation: heartsLabel !== null ? 'discover-add-pulse 500ms ease-out' : undefined
          }}
        >
          {fetchingHearts ? 'fetching…' : (heartsLabel ?? 'fetch hearts')}
        </button>
        <button
          onClick={() => void addToShelf()}
          disabled={addingToShelf || listenOnly.has('addToShelf')}
          data-tooltip={listenOnly.has('addToShelf') ? listenOnlyTip : undefined}
          style={{
            fontFamily: 'inherit',
            fontSize: 10,
            padding: '6px 14px',
            background: 'transparent',
            border: '1px solid var(--ra-border-strong)',
            color:
              addingToShelf || listenOnly.has('addToShelf') ? 'var(--ra-text-4)' : 'var(--ra-text)',
            cursor: addingToShelf || listenOnly.has('addToShelf') ? 'default' : 'pointer',
            animation: justAddedToShelf ? 'discover-add-pulse 500ms ease-out' : undefined
          }}
        >
          {addingToShelf ? 'adding…' : justAddedToShelf ? '✓ added' : 'add to shelf'}
        </button>
        <button
          onClick={() => void addToTimeline()}
          disabled={addingToTimeline || listenOnly.has('addToTimeline')}
          data-tooltip={listenOnly.has('addToTimeline') ? listenOnlyTip : undefined}
          style={{
            fontFamily: 'inherit',
            fontSize: 10,
            padding: '6px 14px',
            // A dead button carries no audio information, so no accent.
            background: listenOnly.has('addToTimeline') ? 'transparent' : 'var(--ra-stretch-on-bg)',
            border: listenOnly.has('addToTimeline')
              ? '1px solid var(--ra-border)'
              : '1px solid var(--ra-stretch-on)',
            color:
              addingToTimeline || listenOnly.has('addToTimeline')
                ? 'var(--ra-text-4)'
                : 'var(--ra-stretch-on)',
            cursor: addingToTimeline || listenOnly.has('addToTimeline') ? 'default' : 'pointer',
            animation: justAddedToTimeline ? 'discover-add-pulse 500ms ease-out' : undefined
          }}
        >
          {addingToTimeline ? 'adding…' : justAddedToTimeline ? '✓ added' : 'add to timeline'}
        </button>
      </div>
      {lingeringBlocks && (
        <div
          role="note"
          style={{ fontSize: 9, color: 'var(--ra-text-3)', marginTop: -6, marginBottom: 10 }}
        >
          {lingeringNotice(lingering, lingeringStuck)}
        </div>
      )}
      {mode === 'other' && artist !== null && (
        <div
          role="note"
          style={{ fontSize: 9, color: 'var(--ra-text-3)', marginTop: -6, marginBottom: 10 }}
        >
          {artistNotice(artist)}
        </div>
      )}

      {/* The master strip -- 2026-09-28 performance-mode spec section 4A.
          Shown only while something is actually sounding, because both
          controls address the loaded preview's own stems and mean nothing
          without one. `level` is a live-param and moves continuously;
          `reverb` is a whole project reload and so commits on release
          (Dial's own onCommit). `filter` is a live-param again, because it
          is the one control here you actually SWEEP -- it rides a real
          field on the engine's project (spec 4A.3), with its own
          ChannelFilter over the summed master pair. */}
      {previewingSlotIds.size > 0 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '6px 8px',
            marginBottom: 6,
            background: 'var(--ra-bg-bar)',
            borderTop: '1px solid var(--ra-border)',
            borderBottom: '1px solid var(--ra-border)'
          }}
        >
          <span style={{ fontSize: 'var(--ra-fs-9)', color: 'var(--ra-text-3)' }}>master</span>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
            <Dial
              value={masterLevel}
              onChange={(v): void => {
                // The ref is written here as well as through its effect:
                // pushMasterLevel reads the ref and must see THIS value,
                // not the one from a render ago.
                setMasterLevel(v)
                masterLevelRef.current = v
                pushMasterLevel()
              }}
              defaultValue={100}
              size={30}
              ariaLabel="master level"
              tooltip="whole mix level"
            />
            <span style={{ fontSize: 8, color: 'var(--ra-text-3)', whiteSpace: 'nowrap' }}>
              level
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
            <Dial
              value={masterSendDraft}
              onChange={(v): void => setMasterSendDraft(v)}
              onCommit={(v): void => commitMasterSend(v)}
              defaultValue={0}
              size={30}
              ariaLabel="master reverb"
              tooltip="whole mix reverb"
            />
            <span style={{ fontSize: 8, color: 'var(--ra-text-3)', whiteSpace: 'nowrap' }}>
              reverb
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
            <Dial
              value={masterCutoff}
              onChange={(v): void => {
                // Written into the ref here as well as into state, for the
                // same reason the level dial does: pushMasterFilter reads
                // the ref and must see THIS value, not a render ago's.
                setMasterCutoff(v)
                masterFilterRef.current = {
                  mode: masterFilterMode,
                  cutoff: v / 100,
                  resonance: masterResonance / 100
                }
                pushMasterFilter()
              }}
              // The resting position is the mode's own open end, which is
              // the top for a lowpass and the bottom for a highpass -- so
              // double-click goes back to "nothing is happening" either
              // way, not to a fixed number that means something different
              // in each mode.
              defaultValue={neutralCutoff(masterFilterMode) * 100}
              size={30}
              ariaLabel="master filter cutoff"
              tooltip="whole mix filter"
            />
            <span style={{ fontSize: 8, color: 'var(--ra-text-3)', whiteSpace: 'nowrap' }}>
              filter
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
            <Dial
              value={masterResonance}
              onChange={(v): void => {
                setMasterResonance(v)
                masterFilterRef.current = {
                  mode: masterFilterMode,
                  cutoff: masterCutoff / 100,
                  resonance: v / 100
                }
                pushMasterFilter()
              }}
              defaultValue={0}
              size={30}
              ariaLabel="master filter resonance"
              tooltip="filter resonance"
            />
            <span style={{ fontSize: 8, color: 'var(--ra-text-3)', whiteSpace: 'nowrap' }}>
              res
            </span>
          </div>
          {/* A knob beside the cut, not a lane of its own -- the same shape
              Elling settled on for the per-clip filter and the same shape
              Ableton's Auto Filter has. The mode is a two-state word rather
              than a third dial: it is picked, not performed. */}
          <button
            onClick={toggleMasterFilterMode}
            style={{
              background: 'transparent',
              border: '1px solid var(--ra-border)',
              color: 'var(--ra-text-2)',
              fontSize: 'var(--ra-fs-9)',
              padding: '2px 5px',
              cursor: 'pointer'
            }}
            title={masterFilterMode === 'lowpass' ? 'low pass' : 'high pass'}
          >
            {masterFilterMode === 'lowpass' ? 'lo pass' : 'hi pass'}
          </button>
        </div>
      )}

      {slots.length === 0 && (
        <div style={{ fontSize: 11, color: 'var(--ra-text-2)', padding: 12 }}>
          select one to start
        </div>
      )}

      {/* The longest currently-resolved slot's own barLength -- the loop's
          length, which is what the engine loops the preview at. Rows no
          longer scale their waveform against it: every row shows the same
          fixed window of bars (discoverWindowLayout, spec 2026-09-29-
          discover-fixed-waveform-window-design.md), and this only places
          the loop-top lines inside it (and grows the window past 32 bars
          while a longer loop is in play). 0 while nothing has resolved yet.

          The rows sit in one positioned wrapper so the ONE playhead
          (2026-09-30) can be drawn over all of them as a single line --
          see the overlay after the rows, and sweepLineRef above. */}
      <div ref={rowsRef} style={{ position: 'relative' }}>
        {(() => {
          const maxBarLength = previewLoopBars
          // THE ONE WAIT a row can be on, read once for the whole list
          // rather than per row -- radio names at most one armed and at most
          // one held slot at a time. Written by the clock effect above, off
          // the same tick that drives everything else radio does, so the
          // count and the change cannot come from different clocks. It falls
          // back to "not knowable" rather than to a wrong number: radio has
          // no wait at all until it has ticked once.
          const approachWait: RadioApproachWait = radioChangeWait ?? {
            elapsedBars: 0,
            barsUntilChange: null
          }
          return slots.map((slot) => (
            <DiscoverSlotRow
              key={slot.id}
              slot={slot}
              radioApproach={radioApproachFor({
                slotId: slot.id,
                armedSlotId: radioArmedSlotId,
                // A manual change waiting for the loop top reads exactly
                // like radio's own held one -- the same breathing, spec
                // behaviour 2. Only `state` is drawn, so the wait (radio's
                // own) does not have to describe it.
                heldSlotId: manualWaitingSlotIds.has(slot.id) ? slot.id : radioHeldSlotId,
                wait: approachWait
              })}
              rerolling={rerollingSlotIds.has(slot.id)}
              manualWaiting={manualWaitingSlotIds.has(slot.id)}
              previewing={previewingSlotIds.has(slot.id)}
              soloed={previewingSlotIds.size === 1 && previewingSlotIds.has(slot.id)}
              favourited={slot.candidate !== null && stemFavourites.has(slot.candidate.stemCID)}
              maxBarLength={maxBarLength}
              onToggleLock={() => toggleLock(slot.id)}
              radioFlag={radioSlotFlagOf(radioSlotFlags, slot.id)}
              radioOn={radioOn}
              onLike={() => likeSlot(slot.id)}
              listenOnlyStars={listenOnly.has('star')}
              nearbyCreator={artistCreator}
              onToggleReplaceSoon={() => toggleSlotReplaceSoon(slot.id)}
              onRemove={() => removeSlot(slot.id)}
              onDuplicate={(immediate) => duplicateSlot(slot.id, immediate)}
              onReroll={(immediate) => void rerollSlot(slot.id, immediate)}
              onRerollRandom={(immediate) => void rerollRandomSlot(slot.id, immediate)}
              onTogglePreview={() => toggleSlotPreview(slot.id)}
              onToggleSolo={() => toggleSlotSolo(slot.id)}
              onResolvedChange={(stem) => reportSlotResolution(slot.id, stem)}
              onSlotResolutionAbandoned={() => abandonSlotResolution(slot.id)}
              onGainChange={(gain) => updateSlotGain(slot.id, gain)}
              onSwapFromNearby={(candidate, immediate) =>
                swapSlotFromNearby(slot.id, candidate, immediate)
              }
              onChangeKinds={(kinds) => changeSlotKinds(slot.id, kinds)}
              onReclassify={(role) => void reclassifySlot(slot.id, role)}
              soundSourceEndlesss={soundSourceForLean(sourceLean).endlesss}
              soundSourceAudioIn={soundSourceForLean(sourceLean).audioIn}
            />
          ))
        })()}
        {/* THE ONE PLAYHEAD, over every row at once (Elling, 2026-09-30:
            "shouldn't it be one long one moving across all of them?"). An
            absolutely positioned grid with the rows' own template, gap and
            zero horizontal padding -- DISCOVER_ROW_GRID_COLUMNS and friends
            -- so its column 5 IS every row's waveform column. The line's
            `left` is written by the layout effect beside sweepLineRef (a
            percentage of the window, discoverSweepPct), never by render.
            Only while a preview is loaded -- the same condition the
            per-row playheads it replaces had: `pos` means nothing as a
            loop position otherwise. The same `--ra-playhead` accent
            Playhead.tsx uses on the real timeline. */}
        {sweepActive && (
          <div
            aria-hidden
            style={{
              position: 'absolute',
              inset: 0,
              display: 'grid',
              gridTemplateColumns: DISCOVER_ROW_GRID_COLUMNS,
              gridTemplateRows: '100%',
              columnGap: DISCOVER_ROW_COLUMN_GAP,
              padding: 0,
              pointerEvents: 'none'
            }}
          >
            <div
              style={{
                gridColumn: DISCOVER_WAVEFORM_COLUMN,
                minWidth: DISCOVER_WAVEFORM_MIN_WIDTH,
                position: 'relative'
              }}
            >
              <div
                ref={sweepLineRef}
                style={{
                  position: 'absolute',
                  top: 0,
                  bottom: 0,
                  width: 1,
                  background: 'var(--ra-playhead)',
                  pointerEvents: 'none'
                }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Direct request, 2026-09-17: "can we move them to the middle" --
          first tried centered across the full row width; follow-up --
          "align it middle below the waveforms, not middle of the whole
          width" -- so this centers within the SAME horizontal span the
          waveform track itself occupies in each per-slot row's own grid,
          not the panel's full width. marginLeft/marginRight below mirror
          that grid's own gridTemplateColumns ('18px 18px 18px 18px 18px
          14px 1fr 14px 110px 14px 16px 70px 70px 70px 70px', columnGap: 8)
          -- left = delete+lock+mute+solo+favourite+gap widths (104) + the
          5 gaps between them (40) + the gap before the waveform track (8)
          = 152; right = the gap after the waveform (8) + gap+kind+gap+
          dice+similar+adjacent+random+duplicate widths (434) + the 7 gaps
          between THEM (56) = 498. If that grid template's own column
          widths ever change, these two numbers need updating to match.

          2026-09-22 (mockup "option A"): the tight/loose dial moved here
          from the top row, in its own column right of the chip list. A
          three-column grid with equal-min side tracks keeps the list itself
          centred in that span; the dial column sits right beside it, and
          the empty left track mirrors its width.

          Direct request, 2026-09-22 ("use more of the space below, no need
          to be constrained by wave length"): the waveform-span margins
          (152/498 above) are dropped -- the chip list now centres across the
          panel's full width, so it fits on one line instead of wrapping.

          Direct request, 2026-09-22 (later the same day): the four roll
          filters are global again (two since the 2026-09-29 source dial) --
          [x] toggles in their own row directly under the kinds row (see
          globalModifiers), and "+ random" joins the
          trait group. The dial column is vertically centred beside both
          rows; the hint line sits in a second grid row so it doesn't pull
          the dial off-centre. */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `minmax(${ADD_ROW_DIAL_COLUMN_WIDTH}px, 1fr) auto minmax(${ADD_ROW_DIAL_COLUMN_WIDTH}px, 1fr)`,
          marginTop: 10
        }}
      >
        <div />
        <div
          style={{
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 6
          }}
        >
          <div
            style={{
              display: 'flex',
              gap: 4,
              flexWrap: 'wrap',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            {/* Direct request, 2026-09-22: a bright "add a stem that is:" lead-in. Silkscreen
                renders it in caps, like every other label here. */}
            <span
              style={{
                fontSize: 12,
                color: 'var(--ra-text)',
                marginRight: 4
              }}
            >
              add a stem that is:
            </span>
            {DISCOVER_SLOT_KIND_OPTIONS.map((kind) => {
              const selected = pendingAddKinds.includes(kind)
              return (
                <Fragment key={kind}>
                  {kind === DISCOVER_TRAIT_SLOT_KINDS[0] && <AddRowDivider />}
                  <AddRowChip
                    selected={selected}
                    onClick={(e) => handleAddRowKindClick(kind, e.shiftKey, e.metaKey)}
                  >
                    {DISCOVER_SLOT_KIND_LABEL[kind]}
                  </AddRowChip>
                </Fragment>
              )
            })}
            {/* Direct request, 2026-09-20: "add + Random to the bottom list" --
                a slot seeded from a genuinely random stem rather than any
                one kind's own pool (see addRandomSlot's own doc comment).
                Sits right after warm, in the trait group, since 2026-09-22. */}
            <AddRowChip
              selected={false}
              title="random stem"
              onClick={(e) => addRandomSlot(e.metaKey)}
            >
              + random
            </AddRowChip>
            <AddRowDivider />
            <AddRowChip
              selected={false}
              title="import a wav"
              onClick={() => void handlePickSampleImport()}
            >
              + sample
            </AddRowChip>
          </div>
          {/* Global roll filters -- see globalModifiers. */}
          <div
            style={{
              display: 'flex',
              gap: 8,
              flexWrap: 'wrap',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            {DISCOVER_SLOT_MODIFIER_OPTIONS.map((modifier) => {
              const needsUsername = modifier === 'mine' && !hasUsername
              // Artist mode picks the artist's stems: `my sounds` is moot, and
              // `prefer faves` too -- your stars are not among their stems.
              const overridden = mode === 'other'
              const disabled = needsUsername || overridden
              return (
                <BracketToggle
                  key={modifier}
                  checked={!disabled && globalModifiers.includes(modifier)}
                  onChange={() => setGlobalModifiers((prev) => toggleSlotModifier(prev, modifier))}
                  label={DISCOVER_SLOT_MODIFIER_LABEL[modifier]}
                  disabled={disabled}
                  tooltip={
                    overridden
                      ? `artist mode picks ${artist}'s stems`
                      : needsUsername
                        ? MY_SOUNDS_NEEDS_USERNAME
                        : undefined
                  }
                />
              )
            })}
          </div>
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifySelf: 'start',
            marginLeft: 8,
            paddingLeft: 10,
            borderLeft: '1px solid var(--ra-border)'
          }}
        >
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 3,
              marginRight: 12
            }}
          >
            {/* The source dial (2026-09-29): 0 = endlesss sounds, 100 =
                other sounds, 50 = half and half. The ends are "only". See
                drawSoundSource. */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ fontSize: 7, color: 'var(--ra-text-3)' }}>endlesss</span>
              <Dial
                value={sourceLean}
                onChange={changeSourceLean}
                defaultValue={DEFAULT_SOURCE_LEAN}
                size={30}
                ariaLabel="source"
                tooltip="other clockwise"
              />
              <span style={{ fontSize: 7, color: 'var(--ra-text-3)' }}>other</span>
            </div>
            <span style={{ fontSize: 8, color: 'var(--ra-text-3)', whiteSpace: 'nowrap' }}>
              source
            </span>
          </div>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 3
            }}
          >
            {/* Captioned "matching", so clockwise = MORE matching: the dial
                shows 100 - chaos (chaos itself stays "0 = strictest" for
                pickReroll). Starts at, and double-click returns to, 100 -
                DEFAULT_DISCOVER_CHAOS: about 25 (Elling, 2026-10-01; was
                all the way up, 2026-09-22). */}
            <Dial
              value={100 - chaos}
              onChange={(matching) => setChaos(100 - matching)}
              defaultValue={100 - DEFAULT_DISCOVER_CHAOS}
              size={30}
              ariaLabel="matching"
              tooltip="more matching clockwise"
            />
            <span style={{ fontSize: 8, color: 'var(--ra-text-3)', whiteSpace: 'nowrap' }}>
              matching
            </span>
          </div>
        </div>
        {/* Always rendered (fixed height) so nothing shifts on screen. */}
        <div
          style={{
            gridColumn: 2,
            height: 14,
            marginTop: 6,
            textAlign: 'center',
            fontSize: 9,
            color: 'var(--ra-text-3)'
          }}
        >
          hold shift to combine
        </div>
      </div>
    </div>
  )
}

// Wide enough for the dial column's margin + divider + padding + the source
// dial with its end labels + the "matching" dial; the empty left track
// mirrors it.
const ADD_ROW_DIAL_COLUMN_WIDTH = 200

const MY_SOUNDS_NEEDS_USERNAME = 'needs your username'

function AddRowDivider(): React.JSX.Element {
  return (
    <span
      aria-hidden="true"
      style={{ width: 1, height: 14, margin: '0 4px', background: 'var(--ra-border)' }}
    />
  )
}

// One chip in the add row -- kinds and the + random / + sample actions all
// share this styling (lit while armed).
function AddRowChip({
  selected,
  title,
  onClick,
  children
}: {
  selected: boolean
  title?: string
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      aria-pressed={selected}
      title={title}
      onClick={onClick}
      style={{
        fontFamily: 'inherit',
        fontSize: 11,
        padding: '5px 9px',
        background: selected ? 'var(--ra-bg-row-active)' : 'transparent',
        border: `1px solid ${selected ? 'var(--ra-text)' : 'transparent'}`,
        color: selected ? 'var(--ra-text)' : 'var(--ra-text-2)',
        cursor: 'pointer'
      }}
    >
      {children}
    </button>
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

/** One 18px square on a Discover row. Every new control on the row
 * (2026-09-29, docs/superpowers/specs/2026-09-29-discover-row-icons-and-
 * source-dial-design.md) is one of these, so the states cannot drift
 * between buttons:
 *
 *   `on`: the padlock's own treatment, an inverted fill -- "hold longer".
 *   `soft`: lit but outlined -- "change next", a request that is spent on
 *     the next change and then gone.
 *   `pulsing`: the reroll this button started is still in flight.
 *   `disabled`: the whole button at 0.35 opacity, state styling kept.
 *   `toggle`: an on/off control, so `aria-pressed` is always present
 *     (false when off) -- the role must not change with the state.
 *   `ariaExpanded`: a menu trigger; `soft` there means "open", not
 *     "pressed", so it gets aria-expanded + aria-haspopup instead.
 *
 * Monochrome in every state, per tokens.css: colour on this row is for
 * audio only. */
function RowIconButton({
  gridColumn,
  tooltip,
  onClick,
  children,
  state = 'off',
  disabled = false,
  dimmed = false,
  pulsing = false,
  hidden = false,
  toggle = false,
  ariaExpanded,
  buttonRef
}: {
  gridColumn: number
  tooltip: string
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void
  children: React.ReactNode
  state?: 'off' | 'on' | 'soft'
  disabled?: boolean
  /** Looks disabled but still takes clicks -- a row waiting for the loop
   * top, where a plain click is ignored by the handler but a Cmd-click
   * lands a change right away (2026-09-29). */
  dimmed?: boolean
  pulsing?: boolean
  hidden?: boolean
  toggle?: boolean
  ariaExpanded?: boolean
  buttonRef?: React.Ref<HTMLButtonElement>
}): React.JSX.Element {
  return (
    <button
      ref={buttonRef}
      onClick={onClick}
      disabled={disabled || hidden}
      data-tooltip={tooltip}
      aria-label={tooltip}
      aria-pressed={toggle ? state !== 'off' : undefined}
      aria-expanded={ariaExpanded}
      aria-haspopup={ariaExpanded === undefined ? undefined : 'menu'}
      style={{
        gridColumn,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 18,
        height: 18,
        padding: 0,
        visibility: hidden ? 'hidden' : 'visible',
        pointerEvents: hidden ? 'none' : 'auto',
        background:
          state === 'on'
            ? 'var(--ra-text)'
            : state === 'soft'
              ? 'var(--ra-bg-row-active)'
              : 'transparent',
        border: `1px solid ${state === 'off' ? 'var(--ra-border)' : 'var(--ra-text)'}`,
        color:
          state === 'on'
            ? 'var(--ra-bg-frame)'
            : state === 'soft'
              ? 'var(--ra-text)'
              : 'var(--ra-text-2)',
        // Disabled dims the WHOLE button and keeps its state styling, so a
        // padlocked row that is hooked reads as a dimmed lit hand: the flag
        // is inert but still readable. A pulsing button is also disabled
        // (it started the roll in flight), and its pulse is on opacity, so
        // the animation wins there rather than fighting a fixed value.
        opacity: (disabled || dimmed) && !pulsing ? 0.35 : undefined,
        cursor: disabled ? 'default' : 'pointer',
        animation: pulsing ? 'discover-slot-pulse 900ms ease-in-out infinite' : undefined
      }}
    >
      {children}
    </button>
  )
}

// Hand-drawn dice glyph. It predates @phosphor-icons/react (2026-09-29),
// which is scoped to the six Discover row icons only, so it stays
// hand-drawn. One usage: the toolbar's own "similar all" button, which
// passes size={18}; the default of 12 is a leftover from the row's old
// decorative dice.
// Direct request, 2026-09-21: "instead of that loader, have the dice spin
// intermittently" -- a quick full turn, then a rest (discover-dice-spin's
// own 0-35% / 35-100% split), for as long as a roll is in flight.
function DiceIcon({
  size = 12,
  spinning = false
}: {
  size?: number
  spinning?: boolean
}): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{
        flexShrink: 0,
        animation: spinning ? 'discover-dice-spin 1200ms ease-in-out infinite' : undefined,
        // Direct request, 2026-09-22: "when dice are animated, turn them
        // white to show they are active" -- overrides whatever dim color the
        // surrounding button inherits (stroke/fill use currentColor).
        color: spinning ? 'var(--ra-text)' : undefined
      }}
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

// This row's own waveform button's real pixel height -- the vertical-drag
// gain gesture below divides its own deltaY by this, same
// "deltaY / ROW_HEIGHT" scale StemWaveformRow.tsx's own handleVolumeStart
// uses for its analogous drag on the real timeline.
const DISCOVER_WAVEFORM_HEIGHT = 40

// THE ROW GRID, shared by every DiscoverSlotRow AND by the one-playhead
// overlay DiscoverPanel draws above the row list (2026-09-30). The overlay
// is its own grid with these same tracks, gap and (zero) horizontal
// padding, so its waveform column is the rows' waveform column: every
// track but the 1fr waveform is a fixed pixel width, and the waveform
// cell's min-width is the same in both, so the leftover width the 1fr
// track gets is identical. Change the template HERE, never inline -- see
// the long comment where the row applies it for why each track is what
// it is.
const DISCOVER_ROW_GRID_COLUMNS =
  '18px 18px 18px 18px 1fr 14px 110px 14px 1px 18px 18px 18px 18px 18px 18px'
const DISCOVER_ROW_COLUMN_GAP = 8
const DISCOVER_WAVEFORM_COLUMN = 5
const DISCOVER_WAVEFORM_MIN_WIDTH = 140

function DiscoverSlotRow({
  slot,
  radioApproach,
  rerolling,
  manualWaiting,
  previewing,
  soloed,
  favourited,
  maxBarLength,
  onToggleLock,
  radioFlag,
  radioOn,
  onLike,
  listenOnlyStars,
  nearbyCreator,
  onToggleReplaceSoon,
  onRemove,
  onDuplicate,
  onReroll,
  onRerollRandom,
  onTogglePreview,
  onToggleSolo,
  onResolvedChange,
  onSlotResolutionAbandoned,
  onGainChange,
  onSwapFromNearby,
  onChangeKinds,
  onReclassify,
  soundSourceEndlesss,
  soundSourceAudioIn
}: {
  slot: DiscoverSlot
  /** Set while radio is about to change THIS row, and null otherwise.
   *
   * Direct report, 2026-09-29: "i don't see any preparatory blinking on
   * the channels about to transition... right now it just drops when the
   * loop ends and everything seems cramped for time." Two stages of ONE
   * wait (see @shared/radioApproach): `armed` is a pick chosen and warmed
   * ahead of time, `held` is that same change now decided and waiting
   * only for the next loop top. Only `state` is drawn -- the row breathes
   * at two luminances and the red playhead says when -- but both stages
   * measure the same quantity, so the brightness step cannot move what
   * the row is telling him. */
  radioApproach: RadioApproach | null
  /** True while THIS slot's own rerollSlot call is in flight -- drives the
   * reroll button's disabled/label-swap state, matching
   * LibraryBrowser.tsx's own downloadingRiffCID-driven disabled + label
   * convention. */
  rerolling: boolean
  /** True while a manual change on THIS row waits for radio's next loop
   * top. Same kind, nearby jam and any stem are DIMMED with the look
   * `rerolling` gives them, but not disabled: a plain second click on a
   * waiting row is ignored by the handlers (Elling, 2026-09-29), while a
   * Cmd-click lands a change right away, replacing the waiting one.
   * Duplicate and remove stay live. */
  manualWaiting: boolean
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
   * 2026-09-16, star a stem so the global "prefer faves" toggle can
   * bias future rolls toward it. Persisted (see
   * StoreContext.tsx's useStemFavourites), not per-session. */
  favourited: boolean
  /** The loop's length in bars: the longest currently-resolved slot's own
   * barLength, across every row (DiscoverPanel's own `maxBarLength`). No
   * longer the tiling reference -- every row tiles its stem across the same
   * fixed window (discoverWindowLayout), and this only places the loop-top
   * lines, and grows the window when the loop is longer than 32 bars. 0
   * before anything in the loop has resolved yet. The playhead is no longer
   * the row's: since 2026-09-30 there is ONE, drawn by DiscoverPanel over
   * every row at once (sweepLineRef). */
  maxBarLength: number
  onToggleLock: () => void
  /** What this row has been told about radio's next change: `hook` to hold
   * it, `replace-soon` to hurry it, null for neither. At most one row in
   * the panel carries `hook`; any number can carry `replace-soon`. See
   * src/shared/radioSlotFlags.ts. */
  radioFlag: RadioSlotFlag | null
  /** Whether radio is running. 👎 only means anything while it is, so it
   * is hidden -- but still RENDERED -- when it is not; 👍's hold half is
   * skipped, and its holding look not drawn. */
  radioOn: boolean
  /** The 👍 -- toggles this stem's star and, when starring, turns hold
   * longer on (DiscoverPanel's likeSlot -> likeRadioSlot). */
  onLike: () => void
  /** Discover artist mode, listen only: 👍 holds but stars nothing, and
   * its tooltip says so. The button stays un-dimmed -- it still holds. */
  listenOnlyStars: boolean
  /** Discover artist mode: the nearby popover shows only this creator's
   * stems. Undefined in own mode. */
  nearbyCreator: string | undefined
  /** The 👎 ("change soon", once "change next") -- toggles `replace-soon`
   * on this row (toggleRadioReplaceSoon). */
  onToggleReplaceSoon: () => void
  onRemove: () => void
  /** DiscoverPanel's own duplicateSlot(id) -- clones this slot's current
   * state (kind, candidate, gain, lock, seedStem) into a brand-new slot
   * appended to the end of the list. See duplicateSlot's own doc comment
   * for why the new row needs no special-casing to resolve/auto-join the
   * mix. `immediate` is Cmd held on the click (2026-09-29): while radio
   * runs, the stem lands right away instead of waiting for the loop top --
   * the same flag on onReroll, onRerollRandom and onSwapFromNearby. */
  onDuplicate: (immediate: boolean) => void
  onReroll: (immediate: boolean) => void
  /** DiscoverPanel's own rerollRandomSlot -- bypasses confirmed/embedding/
   * instrument matching entirely, picking any stem from the user's own
   * library at random. Direct request: an escape hatch for exactly the
   * "stuck at no match regardless of chaos/confirmation" case. */
  onRerollRandom: (immediate: boolean) => void
  /** DiscoverPanel's own updateSlotGain -- fires on every tick of a drag
   * directly on this row's own waveform (handleGainDragStart, below),
   * mirroring StemWaveformRow.tsx's own "envelope" volume-drag gesture
   * rather than a separate slider widget. */
  onGainChange: (gain: number) => void
  /** Toggles whether THIS slot is included in DiscoverPanel's own shared
   * playing mix -- the row itself doesn't own any audio state, it only
   * asks the parent to flip its own membership (see DiscoverPanel's own
   * toggleSlotPreview). Originally triggered two ways -- clicking the
   * row's own waveform (doubling as volume-drag via onMouseDown) or a
   * dedicated "mute"/"unmute" button, added 2026-09-15 because the
   * waveform click alone wasn't discoverable as mute -- but the waveform
   * click made it too easy to mute a slot by accident while reaching for
   * the gain drag on the same element. Direct request, 2026-09-20: the
   * dedicated "m" button is now the ONLY way to trigger this; the
   * waveform itself no longer calls it at all. Doesn't render (not merely
   * disabled) until resolvedStem exists -- nothing to add to/remove from
   * the mix before then. */
  onTogglePreview: () => void
  /** Solos THIS slot -- see DiscoverPanel's own toggleSlotSolo for the
   * exact semantics (drop every other slot out of the mix; a second click
   * while already the sole soloed slot restores every resolved slot).
   * Only shown once there's a real stem to solo (matching the mute
   * button's own guard, just below). */
  onToggleSolo: () => void
  /** Reports this row's own effective resolved stem (or null) up to
   * DiscoverPanel every time it changes -- resolved on arrival, invalidated
   * on reroll, cleared on unmount/removal -- so the parent's
   * resolvedStemsRef and any currently-playing mix this slot is part of
   * stay in sync with what's actually showing on screen, rather than
   * DiscoverPanel needing to re-resolve candidates itself. */
  onResolvedChange: (stem: ResolvedCandidateStem | null) => void
  /** DiscoverPanel's own forgetSlotResolution(id) (plus the matching
   * previewing-mix cleanup) -- called once when this row's own resolution
   * hits a TERMINAL failure state (resolveFailed or noMatchFound, both
   * computed locally below), as opposed to onResolvedChange(null) above,
   * which now stays a no-op for the transient "mid-reroll, still
   * resolving" case. See this row's own dedicated effect for why the two
   * are kept separate. */
  onSlotResolutionAbandoned: () => void
  /** DiscoverPanel's own swapSlotFromNearby -- called when the user picks a
   * candidate from this slot's own "explore nearby" popover. An undoable
   * swap, like a reroll: instant with radio off or Cmd held, otherwise
   * waiting for the loop top. Returns false when the pick was ignored (the
   * row already waits), so the popover stays centred where it was. See
   * swapSlotFromNearby's own doc comment in DiscoverPanel. */
  onSwapFromNearby: (candidate: DiscoverCandidate, immediate: boolean) => boolean
  /** DiscoverPanel's own changeSlotKinds -- fired by the kind picker on
   * every chip toggle (the panel rerolls this slot). */
  onChangeKinds: (kinds: DiscoverSlotKind[]) => void
  /** DiscoverPanel's own reclassifySlot -- fired by the match meter's
   * reclassify picker with the chosen role. */
  onReclassify: (role: ArrangeRole) => void
  /** The source dial as a filter (soundSourceForLean) -- passed as two
   * primitive booleans, not one object, so this row's own re-render checks
   * stay cheap; combined into a real DiscoverSoundSourceFilter object only
   * where actually needed below (the "explore nearby" popover). */
  soundSourceEndlesss: boolean
  soundSourceAudioIn: boolean
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
  // Which of this row's own reroll buttons started the roll in flight, so
  // that one pulses and the others only dim. A roll started from anywhere
  // else (radio, the phone, the panel's roll-all) leaves this stale, but it
  // is only read while `rerolling`, and it is cleared the first render
  // `rerolling` is false. That needs a gap between rolls: if radio or the
  // phone starts a second roll on this slot while the first is still in
  // flight, `rerolling` never drops and the first button keeps pulsing for
  // a roll it did not start. Rare and harmless, so accepted as is.
  const [rerollAction, setRerollAction] = useState<'similar' | 'random' | null>(null)
  if (!rerolling && rerollAction !== null) setRerollAction(null)

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
  // Memoized -- direct report, 2026-09-17, root-caused as part of
  // investigating why "sometimes the waveforms blink away" and playback
  // interruptions felt worse on Shelf-seeded loops specifically: an
  // inline object literal here (the version this replaces) gets a NEW
  // identity on every single render, so `resolvedStem` below (derived
  // from `seedResolved` for every seeded slot) also gets a new identity
  // every render -- which re-fires the `[resolvedStem]` effect further
  // down on every render, which calls onResolvedChange, which (via
  // reportSlotResolution) updates resolvedBarLengths/schedules an engine
  // sync, which re-renders this row, which creates a NEW seedResolved
  // object again... a self-sustaining loop with no natural end, pegging
  // the main thread and re-sending a full buildEngineProject/
  // engineLoadProject to the native engine on every animation frame for
  // as long as ANY seeded slot exists. Memoizing on the underlying data
  // (slot.seedStem/slot.candidate) instead of recreating the object every
  // render breaks the loop: the object's identity now only changes when
  // what it actually represents changes.
  const seedResolved = useMemo(
    () =>
      slot.seedStem
        ? {
            candidate: slot.candidate,
            status: 'ready' as const,
            stem: { slot: 1, ...slot.seedStem }
          }
        : null,
    [slot.seedStem, slot.candidate]
  )

  // Already resolved elsewhere (radio warms its pick a whole interval
  // early): read it on THIS render rather than waiting a microtask for
  // the effect above -- see settledCandidateStems. Preferred over
  // `resolved` even once that arrives, so resolvedStem keeps one identity
  // and the [resolvedStem] effect below does not report it twice.
  const peekResolved = useMemo(() => {
    if (!slot.candidate) return null
    const stem = peekResolvedCandidateStem(slot.candidate)
    return stem
      ? { candidate: slot.candidate, status: 'ready' as const, stem: { slot: 1, ...stem } }
      : null
  }, [slot.candidate])

  const resolvedForCurrent =
    seedResolved ?? peekResolved ?? (resolved?.candidate === slot.candidate ? resolved : null)
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
  // A reroll actually COMPLETED but found nothing that matched this slot's
  // kind/constraints at all (rollForSlot/rerollSlot left slot.candidate
  // null) -- distinct from resolveFailed (a real candidate WAS found but
  // couldn't be downloaded/decoded). Direct report, 2026-09-17: "just tried
  // to add a vocal and i think it didn't find an appropriate one... but
  // there was no indication what happened. no failure message" -- the
  // placeholder below used to show a plain neutral-bordered empty box for
  // this exact case, visually identical to a slot that's simply never been
  // touched yet.
  const noMatchFound =
    !rerolling && !resolving && !resolveFailed && slot.candidate === null && slot.hasRerolled
  // Direct report, 2026-09-21: "the dotted outline is good but seems to
  // appear quite late in the process" -- `resolving` alone only covers the
  // download/decode half (a candidate already picked); the candidate SEARCH
  // before it (rerolling, getDiscoverCandidates in flight) left an empty
  // slot's placeholder looking untouched. `working` spans both halves, so
  // the lit outline + loader show from the moment of the click.
  const working = resolving || (rerolling && resolvedStem === null)

  // "Explore nearby" popover state -- position (screen coords, set from the
  // trigger button's own getBoundingClientRect on open) or null when closed.
  // See DiscoverNearbyPopover.tsx.
  const [nearbyMenu, setNearbyMenu] = useState<{ x: number; y: number } | null>(null)
  const nearbyButtonRef = useRef<HTMLButtonElement>(null)
  // Stable across renders (useCallback, empty deps) -- DiscoverNearbyPopover's
  // own outside-click dismissal effect depends on this identity ([onClose,
  // ignoreRef]), and this row re-renders on every playhead tick while
  // anything is previewing (DiscoverPanel re-renders on its own usePos(),
  // and this row with it). An inline `() => setNearbyMenu(null)` closure would be
  // torn down and rebuilt on every one of those ticks, real bug found live:
  // "clicking out of the near panel should close it instead of having to
  // click the near button again" -- the dismiss listener's own
  // setTimeout(0)-delayed (re-)attach never got a settled window to catch a
  // real click while playback kept remounting the effect out from under it.
  const closeNearbyMenu = useCallback(() => setNearbyMenu(null), [])

  // "Kind picker" popover state -- same position/dismissal pattern as
  // nearbyMenu above. See DiscoverKindPicker.tsx.
  const [kindMenu, setKindMenu] = useState<{ x: number; y: number } | null>(null)
  const kindButtonRef = useRef<HTMLButtonElement>(null)
  // Stable identity -- same playhead-tick re-render reasoning as closeNearbyMenu.
  const closeKindMenu = useCallback(() => setKindMenu(null), [])

  // Match meter (docs/superpowers/specs/2026-09-22-discover-promise-vs-
  // delivery-design.md, Phase 2) -- one compact readout per requested kind,
  // under the kind label. Mask kinds say why the stem was admitted
  // (tag/guess/confirmed, from the candidate's kindSources, or the
  // slot's own reclassify); trait kinds show 5-step bars from the stem's
  // library percentile. Trait entries only for a candidate rollForSlot
  // picked (pickBar paired with it): random/nearby/seeded candidates never
  // had percentiles computed, and empty bars there would misreport them as
  // unanalysed. Nothing at all without a candidate.
  const meterEntries = useMemo(() => {
    const candidate = slot.candidate
    if (!candidate) return []
    const fromRoll = slot.pickBar?.candidate === candidate
    const reclassified = slot.reclassified?.candidate === candidate ? slot.reclassified : undefined
    return buildMatchMeter({
      kinds: slot.kinds,
      kindSources: reclassified
        ? reclassifyKindSources(slot.kinds, reclassified.role)
        : (candidate.kindSources ?? {}),
      traitPercentiles: candidate.traitPercentiles ?? {},
      barUsed: fromRoll ? (slot.pickBar?.barUsed ?? null) : null,
      barRequested: slot.pickBar?.barRequested,
      reclassified: reclassified
        ? { role: reclassified.role, label: discoverRoleLabel(reclassified.role, ROLE_LABELS) }
        : undefined
    }).filter((entry) => entry.type === 'mask' || fromRoll)
  }, [slot.candidate, slot.kinds, slot.pickBar, slot.reclassified])

  // Reclassify picker -- same position/dismissal pattern as kindMenu, anchored
  // on whichever meter source word was clicked; the whole meter is the
  // dismissal ignoreRef so clicking another source word just re-anchors.
  const [reclassifyMenu, setReclassifyMenu] = useState<{
    x: number
    y: number
    currentRole: ArrangeRole | null
  } | null>(null)
  const meterRef = useRef<HTMLDivElement>(null)
  const closeReclassifyMenu = useCallback(() => setReclassifyMenu(null), [])

  // Direct request, 2026-09-16: "i imported a batch of rifffs using the
  // import from library feature and attempting to discover the individual
  // riffs i find that i cannot use the adjacent rifffs feature. it should
  // know the adjacent rifffs still, right?" -- a Shelf-sourced slot
  // (seedStem set, candidate null) has no explicit riffCID to anchor
  // adjacency from, but findRiffForStemPath can recover one from the
  // seeded stem's own already-downloaded local path (its basename IS its
  // own StemCID -- see that function's own doc comment). Only attempted
  // for a seedStem-only slot; a slot with a real `candidate` already has
  // everything it needs and skips this entirely (see the null guard
  // clearing seedStemAnchor below, so a later reroll landing a real
  // candidate doesn't leave a stale anchor around).
  // Paired with the seed stem path it was looked up FOR -- same
  // resolved/resolvedForCurrent identity-comparison convention this file
  // (and DiscoverNearbyPopover.tsx) already uses elsewhere, so a stale
  // "candidate went from null back to null via a different seedStem"
  // transition, or the null-when-nothing-to-look-up case, never needs a
  // synchronous setState at the top of the effect body (which
  // react-hooks/set-state-in-effect flags as a cascading-render risk) --
  // it's derived from a key mismatch at render time instead.
  const [seedStemLookup, setSeedStemLookup] = useState<{
    path: string
    anchor: DiscoverCandidate | null
  } | null>(null)
  const seedStemLookupPath = slot.candidate === null ? (slot.seedStem?.path ?? null) : null
  useEffect(() => {
    if (seedStemLookupPath === null) return
    const seedStem = slot.seedStem
    if (!seedStem) return
    let cancelled = false
    window.rifffApi
      .findRiffForStemPath(seedStemLookupPath)
      .then((result) => {
        if (cancelled) return
        setSeedStemLookup({
          path: seedStemLookupPath,
          anchor: result
            ? {
                stemCID: result.stemCID,
                jamCID: result.jamCID,
                riffCID: result.riffCID,
                presetName: seedStem.name,
                creatorUserName: seedStem.author,
                slotKinds: slot.kinds,
                traitValues: {},
                traitPercentiles: {},
                kindSources: {},
                drumSubRole: null,
                riffBpm: result.bpm,
                riffCreationTime: result.creationTime
              }
            : null
        })
      })
      .catch((err) => {
        console.error('DiscoverSlotRow: findRiffForStemPath failed:', err)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- slot.seedStem/slot.kinds are read inside via the closure above, not tracked as deps here; seedStemLookupPath already changes whenever slot.seedStem's own path does (it's derived from it). kinds only change via the picker (Task 6/combination slots), which sets the new kinds synchronously but only rerolls (and thus only lands a real `candidate`, which is what nulls out seedStemLookupPath) once that reroll's own IPC round trip resolves -- so a kinds edit and seedStemLookupPath going null are two SEPARATE updates, not the same one. Harmless, not a bug: the anchor object's own `slotKinds` field is only read for display labeling, and DiscoverNearbyPopover reads slot.kinds directly rather than through this anchor, so a momentarily-stale slotKinds value here is never actually shown. Listing slot.kinds as a dep would only cause a redundant re-lookup of the same path.
  }, [seedStemLookupPath])
  const seedStemAnchor = seedStemLookup?.path === seedStemLookupPath ? seedStemLookup.anchor : null
  // The real candidate always wins when present; a seedStem-only slot
  // falls back to whatever findRiffForStemPath managed to recover (or
  // null, if the stem isn't part of any currently-known jam -- a real
  // possibility for a locally-recorded take or an import unrelated to any
  // Endlesss jam, handled the same as "no candidate" already was: the
  // button just doesn't render).
  const nearbyAnchor: DiscoverCandidate | null = slot.candidate ?? seedStemAnchor

  // Direct request: adjust gain by dragging vertically on the waveform
  // itself -- StemWaveformRow.tsx's own "envelope" volume-drag gesture,
  // reused here (startPointerDrag, same deltaY/ROW_HEIGHT scale) instead of
  // a separate slider widget. Deliberately does NOT call onEnd/check
  // `moved`: unlike the real timeline's SET_VOLUME (an undo-tracked
  // dispatch, only committed once on release), onGainChange writes directly
  // into this component's own pre-placement `slots` state on every tick --
  // there's nothing to "commit" separately, and no undo history to spare
  // from a flood of intermediate values. Direct request, 2026-09-20: the
  // waveform button no longer has an onClick at all (mute moved to the
  // dedicated "m" button only) -- a plain click here is now simply inert,
  // not a toggle.
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

  // Direct reports, 2026-09-17, found in code review of the fix for
  // "sometimes it stops the playback... starts all of the loops from the
  // beginning": onResolvedChange(null) above (via the effect's own
  // cleanup) is now a deliberate no-op in DiscoverPanel for the "mid-
  // reroll, still resolving" case -- necessary so a reroll doesn't
  // transiently drop out of the mix and cause the exact restart/blink bugs
  // that fix addressed. But resolveFailed/noMatchFound are TERMINAL, not
  // transient -- nothing further is coming without the user taking another
  // action (reroll again, or remove the slot) -- so silently keeping the
  // OLD stem's audio playing forever under a UI that says "failed"/"no
  // match" (and, via hasStemToActOn below, HIDES the mute/solo/favourite
  // controls that would let the user silence it) is a real regression, not
  // "doesn't interrupt the flow." This is the one signal DiscoverPanel
  // still needs to treat as a genuine, permanent forget -- separate from
  // the shared resolvedStem effect above, which must stay a no-op-on-null
  // for the transient case.
  //
  // CRITICAL, found in a second round of code review: this first shipped
  // as `if (resolveFailed || noMatchFound) onSlotResolutionAbandoned()`
  // with NO resolvedStem guard, deps `[resolveFailed, noMatchFound,
  // onSlotResolutionAbandoned]`. Two compounding bugs: (1) noMatchFound is
  // TRUE for every Shelf-seeded slot (candidate: null, hasRerolled: true
  // -- see buildSeedSlotsFromStems -- exactly the shape noMatchFound's own
  // definition can't distinguish from "rerolled into nothing"), even
  // though a seeded slot has a perfectly good resolvedStem via
  // seedResolved -- so this effect abandoned every Shelf-seeded slot on
  // mount, forgetting its resolution and dropping it from the mix right
  // after the OTHER effect (above) had just added it, making Shelf-seeded
  // Discover content silently unplayable (and unrecoverable -- toggling
  // the waveform can't re-add a slot whose own resolvedStemsRef entry
  // keeps getting deleted again every render). (2) listing
  // onSlotResolutionAbandoned in the deps -- a fresh closure every
  // DiscoverPanel render, per its own call site -- meant this effect
  // re-ran on every one of THIS component's own ~30Hz playhead-tick
  // re-renders while previewing, not once per transition, exactly the
  // footgun the onResolvedChange effect above already documents avoiding.
  // Fixed by (a) requiring resolvedStem === null too -- a seeded slot's
  // resolvedStem is never null, so this can no longer fire for one
  // regardless of what noMatchFound alone says -- and (b) depending on
  // resolvedStem/resolveFailed/noMatchFound (real values, not a closure
  // identity) instead of the callback prop, matching the sibling effect's
  // own established convention exactly.
  useEffect(() => {
    if (resolvedStem === null && (resolveFailed || noMatchFound)) onSlotResolutionAbandoned()
    // Same reasoning as the onResolvedChange effect above: onSlotResolutionAbandoned
    // is a fresh closure every parent render (wraps abandonSlotResolution with this
    // row's own slot.id) and depending on it would re-fire this effect on every
    // unrelated parent re-render instead of only when THIS row's own
    // resolvedStem/resolveFailed/noMatchFound actually change. Safe to omit:
    // abandonSlotResolution only reads refs (resolvedStemsRef/resolvedBarLengthsRef/
    // previewingSlotIdsRef) plus setState, no stale closed-over state to go wrong.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedStem, resolveFailed, noMatchFound])

  // Direct report, 2026-09-16: "the buttons shouldn't disappear when they
  // are rerolling" -- gating the mute/solo/favourite group on resolvedStem
  // alone meant it vanished the instant a reroll landed a new
  // slot.candidate, since resolvedForCurrent's own identity check (see
  // resolvedStem's own derivation above) immediately stops matching the OLD
  // resolved stem, well before the NEW one's own resolve finishes.
  // slot.candidate itself is set synchronously the moment a roll/reroll
  // lands (rollForSlot's own setSlots call) and stays valid throughout the
  // resolve that follows, so treating either as "there's something real
  // here to act on" keeps the group visible continuously through a reroll,
  // only truly hiding for a slot that's never been rolled at all (both
  // null). resolvedStem alone still covers a seedStem-only slot
  // (Shelf-sourced, no candidate ever, but resolvedStem resolves
  // synchronously via seedResolved).
  const hasStemToActOn = resolvedStem !== null || slot.candidate !== null

  // Direct report, 2026-09-17: "when i open something in discover,
  // sometimes some tracks are already muted." Root cause: the mute
  // button above is gated on hasStemToActOn (candidate OR resolvedStem,
  // widened 2026-09-16 so it doesn't flicker away mid-reroll -- see that
  // button's own comment), but its ON/OFF look was driven by `previewing`
  // alone (previewingSlotIds membership) -- and a slot only ever JOINS
  // previewingSlotIds once reportSlotResolution's success branch fires,
  // i.e. once resolvedStem actually lands. That leaves a real, visible
  // window -- every slot's OWN first roll, or a reroll, however brief --
  // where hasStemToActOn is already true (there's a candidate) but
  // previewing is still false (nothing to preview yet): the mute button
  // rendered in its hard-filled "muted" look even though nothing was ever
  // actually muted, just not resolved yet. Several slots resolving at
  // slightly different speeds after a fresh open/seed (some cached,
  // some genuinely downloading) is exactly when this was most visible --
  // "SOME tracks already muted," not all, and only "sometimes." Fixed by
  // deriving the button's own look from resolution state, not bare
  // previewing: still-resolving reads as its eventual default (about to
  // autoplay, matching the "it all should autoplay" convention
  // elsewhere in this file) rather than a false "muted," while a
  // genuinely terminal resolveFailed keeps the muted look (correct --
  // nothing is ever going to play there without a fresh reroll). Once
  // resolvedStem exists, this is identical to `!previewing`, same as
  // before.
  const showsAsMuted = resolvedStem !== null ? !previewing : resolveFailed
  // The one row radio holds longer, drawn on its 👍 (see that button).
  const holding = radioOn && radioFlag === 'hook'

  return (
    <>
      <div
        style={{
          display: 'grid',
          // 15 tracks, explicit gridColumn on every child below (including
          // conditionally-rendered ones): 1 delete, 2 lock, 3 mute, 4 solo,
          // 5 waveform (1fr), 6 spacer, 7 kind/category label + match
          // meter, 8 spacer, 9 divider, 10 skip (SkipForward, the old
          // "same kind"), 11 nearby jam, 12 any stem, 13 duplicate, 14 👍
          // like, 15 👎 change soon. (2026-10-01, the web radio's row
          // buttons: the star and "hold longer" tracks became one 👍, and
          // 👍/👎 then moved together to the END of the row, after
          // duplicate -- every gridColumn renumbered in one pass each time;
          // the history below uses the numbers of its own day.) Duplicate (direct request, 2026-09-20:
          // "add duplicate channel to discover") was appended as a NEW
          // last track rather than inserted earlier and renumbering
          // everything after it -- this row's own explicit-position
          // discipline (see below) makes a renumber a real risk of an
          // off-by-one somewhere across this many hardcoded gridColumn
          // values, for no real UX benefit over just adding one more
          // track at the end. Mute/solo/favourite moved next to lock and
          // the kind label moved down next to similar/adjacent/random --
          // direct
          // request, 2026-09-17, freeing up much more width for the
          // waveform (now 1fr against only three fixed-width siblings
          // instead of six). Explicit positions matter -- without them, a
          // conditional child that renders NO DOM node (see
          // hasStemToActOn/nearbyAnchor below) makes grid auto-placement
          // shift every LATER item one track left to fill the gap instead
          // of leaving its own column empty, which is exactly the state
          // every freshly-added slot passes through (no candidate/resolved
          // stem yet). Real bug, found in code review.
          // Direct report, 2026-09-17 (screenshot): the last three tracks
          // used to be `auto auto auto` -- fine while every row always
          // rendered all three buttons, but "adjacent" is conditionally
          // rendered (nearbyAnchor !== null), and each slot row is its OWN
          // independent grid (a separate <div> per row, not one shared
          // grid), so an `auto` track's size is computed per-row from
          // ONLY that row's own content. A row missing "adjacent" (e.g. a
          // seedStem-only slot, or one that's never resolved) auto-sizes
          // that column down toward zero, which leaves MORE leftover width
          // for that SAME row's own 1fr waveform/placeholder track to
          // claim -- so its waveform visibly renders wider than every
          // other row's. Fixed pixel widths (matching the old
          // fixed-role-label-width fix for the identical class of bug)
          // make every row's non-1fr tracks identical regardless of which
          // optional buttons happen to render.
          // 2026-09-29, radio controls and the icon row: track 6, once an
          // empty 14px spacer, widened to 18px for "hold longer"; track 11,
          // once the 16px decorative dice, is now 18px for "change next";
          // a new 1px divider track 12 was inserted, so the four rerolls
          // moved from 12-15 (70px text buttons) to 13-16 (18px icon
          // squares). That insert DID renumber every gridColumn after it,
          // done by hand in one pass. Every non-waveform track stays a
          // FIXED pixel width, for the reason above; only the 1fr waveform
          // grows, and it gets all the width the text buttons gave up.
          // The template itself is DISCOVER_ROW_GRID_COLUMNS, shared with
          // the one-playhead overlay above the row list so the two cannot
          // drift apart (2026-09-30).
          gridTemplateColumns: DISCOVER_ROW_GRID_COLUMNS,
          alignItems: 'center',
          columnGap: DISCOVER_ROW_COLUMN_GAP,
          // No horizontal padding: the overlay relies on the rows' column
          // 7 starting where its own does.
          padding: '8px 0',
          // A ROW RADIO IS ABOUT TO CHANGE. The row breathes, slowly,
          // and the red playhead already sweeping it says when -- because
          // a change now lands at the loop top (e5810f4 stages the swap a
          // lap early and the engine applies it at bar 0), so the
          // playhead reaching a loop-top line, or the end of its sweep,
          // IS the moment it happens.
          //
          // Elling, 2026-09-29, after two passes at drawing this as a
          // progress rule with a countdown beside it: "i still don't
          // understand 'this bar'.. i think the fade in and out
          // indication is clear enough that 'something is going to happen
          // on this one soon'" and then "can't it be the red playhead
          // indicator instead of a progress bar? that would streamline
          // the ui". So: no rule, no chip, no words. Both of the things
          // this used to draw are built from something already on screen
          // instead.
          //
          // WHAT IS ACCEPTED HERE, rather than solved: the playhead
          // crosses a loop top every lap (since 2026-09-30 it is one line
          // sweeping several laps, not one per lap), so a change three
          // laps out cannot be read off it as three laps -- the row simply reads "coming" until
          // the lap it lands in. That is the whole intended message.
          // Radio still KNOWS the real number (radioChangeWait above, and
          // @shared/radioApproach, which is still measured and still
          // tested); nothing draws it.
          //
          // LOCKED TO THE MUSIC, since 2026-09-30. The breath used to be a
          // 2600ms CSS animation, kept deliberately unrelated to the tempo
          // and never restarted at the wrap, on the argument that a fade
          // with no beat in it could not be mistaken for something
          // counting. In practice each row's animation started whenever
          // that row began breathing, so two breathing rows drifted in and
          // out of step with each other. Elling: "can the fade be a bit
          // slower, and synchronized across all waves? right now they can
          // be out of sync.. maybe even synced to half the tempo" -- and,
          // given the choice, one full breath (dim -> bright -> dim) every
          // 4 bars. So the breath is now a function of the transport:
          // discoverBreath (@shared/discoverBreath, tested) of the
          // absolute bar count, written once per tick as --discover-breath
          // on the rows' wrapper by the playhead's layout effect (see
          // rowsRef). Every row mixes by the same number, so they move
          // together, and each breath starts dim on a 4-bar line. Still
          // no hard edge: it is cosine-eased at both ends, so it rises and
          // settles rather than ticking, and 4 bars is slower than any
          // beat the playhead is counting. While the transport is stopped
          // it holds still at the midpoint -- a steady half-tint, which
          // still tells armed from held.
          //
          // BACKGROUND, not opacity. discover-slot-working fades the
          // WAVEFORM, and reusing that here would dim audio information
          // for bars at a time and read as "this row is busy" -- the row
          // is not busy, it is next. Chrome carries the message; the stem
          // is left exactly as bright as every other stem. NO HUE: colour
          // is spent on audio only, so both ends of both depths are the
          // panel's own ground and the fills its controls already use.
          //
          // Two depths, luminance only: dimmer while the pick is merely
          // armed (transparent <-> --ra-bg-row-active), brighter once the
          // change is decided and the next wrap is the one
          // (--ra-bg-row-active <-> --ra-border). Same pace either way, so
          // the difference reads as weight rather than as urgency
          // counting down. The 0.5 fallback is the stopped value, for the
          // one frame before the effect has written the variable.
          background:
            radioApproach === null
              ? undefined
              : radioApproach.state === 'held'
                ? 'color-mix(in srgb, var(--ra-bg-row-active), var(--ra-border) calc(var(--discover-breath, 0.5) * 100%))'
                : 'color-mix(in srgb, transparent, var(--ra-bg-row-active) calc(var(--discover-breath, 0.5) * 100%))',
          borderBottom: '1px solid var(--ra-border-soft)'
        }}
      >
        {/* Direct request, 2026-09-15: "an X for remove" -- icon-only, same
          as every other row button now. */}
        <button
          onClick={onRemove}
          data-tooltip="remove"
          aria-label="remove"
          style={{
            gridColumn: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 18,
            height: 18,
            padding: 0,
            fontFamily: 'inherit',
            fontSize: 10,
            background: 'transparent',
            border: '1px solid var(--ra-border)',
            color: 'var(--ra-text-2)',
            cursor: 'pointer'
          }}
        >
          X
        </button>
        <button
          onClick={onToggleLock}
          data-tooltip={slot.locked ? 'unlock' : 'lock'}
          aria-label={slot.locked ? 'unlock' : 'lock'}
          style={{
            gridColumn: 2,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
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
        {/* A single guard around a fragment is safe here (rather than one
            guard per button, as this used to be split) because each button
            below carries its own explicit gridColumn -- omitting all three
            leaves columns 3/4 (and 👍's 14) empty instead of shifting anything after
            them. See hasStemToActOn's own doc comment above for why it's
            "has a candidate OR resolvedStem," not resolvedStem alone. */}
        {hasStemToActOn && (
          <>
            {/* Direct request, 2026-09-15: "can we add a mute for each
                channel" -- toggleSlotPreview already existed (the waveform
                itself was already clickable to the same effect), but wasn't
                discoverable as a mute control -- only a hover tooltip
                explained it. Same handler as the waveform click, so either
                one keeps the other in sync; only shown once there's a real
                stem to mute (matching the waveform toggle's own guard). */}
            <button
              onClick={onTogglePreview}
              data-tooltip={showsAsMuted ? 'unmute' : 'mute'}
              aria-label={showsAsMuted ? 'unmute' : 'mute'}
              style={{
                gridColumn: 3,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 18,
                height: 18,
                padding: 0,
                fontFamily: 'inherit',
                fontSize: 10,
                // Direct request, 2026-09-15: "mute should look exactly
                // like mute on the arrangement view" -- matches
                // ChannelRow.tsx's own muteButtonStyle exactly
                // (background/border/color-by-state, which reads as
                // "inverted" at a glance: a hard filled/colored look
                // when OFF/muted, a plain/transparent look when
                // ON/playing), rather than this row's own earlier ad hoc
                // treatment (transparent-when-off instead of the real
                // `--ra-bg-row-active` fill every other unmuted mute
                // button in this app uses). Driven by showsAsMuted (see
                // its own doc comment above), not bare `previewing` --
                // still-resolving no longer renders as falsely muted.
                background: showsAsMuted ? 'var(--ra-mute-on)' : 'var(--ra-bg-row-active)',
                border: `1px solid ${showsAsMuted ? 'var(--ra-mute-on)' : 'var(--ra-border)'}`,
                color: showsAsMuted ? 'var(--ra-mute-on-ink)' : 'var(--ra-text-2)',
                cursor: 'pointer'
              }}
            >
              {/* Lowercase "m" -- matches ChannelRow.tsx's own mute
                  button glyph exactly (its solo/record siblings are also
                  lowercase single letters), rather than this row's own
                  earlier uppercase "M". */}
              m
            </button>
            {/* Direct request, 2026-09-15 (Upcycle-inspired): a solo
                button next to mute, same M/S pairing Upcycle's own cards use
                and ChannelRow.tsx already has on the real arrangement.
                Matches ChannelRow.tsx's own soloButtonStyle exactly (a soft
                tinted background with the accent color on border/text, not
                a hard fill like mute's). */}
            <button
              onClick={onToggleSolo}
              data-tooltip={soloed ? 'unsolo' : 'solo'}
              aria-label={soloed ? 'unsolo' : 'solo'}
              style={{
                gridColumn: 4,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 18,
                height: 18,
                padding: 0,
                fontFamily: 'inherit',
                fontSize: 10,
                background: soloed ? 'var(--ra-stretch-on-bg)' : 'var(--ra-bg-row-active)',
                border: `1px solid ${soloed ? 'var(--ra-stretch-on)' : 'var(--ra-border)'}`,
                color: soloed ? 'var(--ra-stretch-on)' : 'var(--ra-text-2)',
                cursor: 'pointer'
              }}
            >
              s
            </button>
          </>
        )}
        {/* Direct report, 2026-09-17: "tooltip over the waveforms on
          discover prevents user from dragging the volume, so remove it" --
          this wrapper used to carry a data-tooltip whose own text included
          a live `drag for volume (N%)` readout, updating on every tick of
          a gain drag -- the tooltip box re-rendering/resizing itself right
          above the cursor mid-drag read as actively interfering with the
          drag gesture, not just cosmetically noisy. Removed outright rather
          than trimmed -- the inner button's own aria-label (below) still
          carries a plain accessible name (drag to adjust volume), just
          without the drag hint or the live percentage. */}
        <div
          style={{
            gridColumn: DISCOVER_WAVEFORM_COLUMN,
            minWidth: DISCOVER_WAVEFORM_MIN_WIDTH,
            position: 'relative'
          }}
        >
          {resolvedStem ? (
            // Direct request, 2026-09-20: "clicking on wave shouldn't mute
            // it, leave that to the M button" -- clicking the waveform used
            // to double as mute/unmute (onTogglePreview), same click-the-
            // thumbnail-to-hear-it convention Shelf.tsx's own tiles and
            // ClusterStemsBrowser.tsx's own waveform rows use elsewhere in
            // this app -- but that made it too easy to mute a slot by
            // accident while reaching for the gain-drag gesture on the same
            // element. The dedicated "m" button (below) is now the ONLY way
            // to toggle this slot in/out of the shared mix; the waveform
            // itself only responds to a vertical drag (handleGainDragStart).
            // Direct report, 2026-09-15: the previewing-outline (a near-white
            // `--ra-stretch-on` box around the whole waveform) read as an
            // unwanted white halo -- removed; the dedicated mute button below
            // already carries this row's own on/off state, and the playhead
            // line (drawn over every row by DiscoverPanel) shows real
            // playback directly.
            <button
              onMouseDown={handleGainDragStart}
              aria-label="drag to adjust volume"
              // Direct request, 2026-09-20: "date could be a tooltip on
              // hover.. in discovery and in arranger or sketch" --
              // resolvedStem.creationTime is the OWNING RIFF's own real
              // creation date (see ResolvedCandidateStem's own doc
              // comment), undefined only for content resolved via the
              // live Endlesss API path (not Discover's own, which always
              // reads the local, already-synced library), in which case
              // this simply omits the tooltip rather than showing a wrong
              // date. Same year/month/day format LibraryBrowser.tsx's own
              // date-grouped riff listing already uses.
              data-tooltip={
                resolvedStem.creationTime
                  ? new Date(resolvedStem.creationTime * 1000).toLocaleDateString(undefined, {
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric'
                    })
                  : undefined
              }
              style={{
                position: 'relative',
                width: '100%',
                height: DISCOVER_WAVEFORM_HEIGHT,
                padding: 0,
                background: 'transparent',
                border: 'none',
                overflow: 'hidden',
                cursor: 'ns-resize',
                // Same 2026-09-21 report as `working` above -- a slot that
                // already has a stem keeps showing it while a reroll
                // searches, so the waveform itself breathes until the new
                // pick lands (then it swaps to the dotted placeholder while
                // that pick downloads/decodes).
                animation: rerolling
                  ? 'discover-slot-working 1100ms ease-in-out infinite'
                  : undefined
              }}
            >
              {/* Tiled, not a single stretched-to-fit Waveform -- direct
              report: every slot used to render at the same width regardless
              of its real bar length, making a 1-bar drum hit look the same
              size as an 8-bar bassline. Every row shows the SAME fixed
              window of bars (32, or the loop's length when a longer stem is
              in play -- discoverWindowLayout, spec 2026-09-29-discover-
              fixed-waveform-window-design.md), so a bar is the same width in
              every row and no row rescales when a longer or shorter stem
              arrives elsewhere. The stem repeats from bar 0 to fill the
              window, exactly how it will actually sound once looped, the
              last tile cut off at the window edge (this button's own
              `overflow: hidden` clips it). Restart lines mark each repeat,
              loop-top lines each wrap of the whole loop (the shared
              LoopLines, arrange's own restart line). Everything is a
              PERCENT of the window, which keeps this row's own flex-fluid
              width working without a real DOM measurement.
              Direct request: gain is shown/adjusted directly on the
              waveform (StemWaveformRow.tsx's own "envelope" volume
              treatment), not a separate slider -- a dim gray layer always
              renders full-height underneath; the real-color layer on top is
              clipped from the top down by `gainClipPct`, so a lower gain
              visibly cuts more of the bright waveform away, revealing gray
              underneath (same "gray means quieter" language the real
              envelope uses), with a thin line marking the exact cutoff. */}
              {(() => {
                // The tile cap (DISCOVER_MAX_TILES) lives in the layout
                // module now: a real crash, found live, came from an
                // unbounded tile count, each tile once mounting a real <Waveform>
                // (dozens of SVG rects), twice. Tiles are CSS mask repeats now,
                // but the cap still sets the minimum repeat width a sub-bar
                // one-shot is drawn at.
                const layout = discoverWindowLayout({
                  stemBars: resolvedStem.barLength,
                  loopBars: maxBarLength
                })
                const gainClipPct = (1 - slot.gain) * 100
                return (
                  <>
                    {/* ONE element per layer, not one <Waveform> per tile
                    (Elling, 2026-09-30: "i think it's slowing the app down
                    having so many of them on there"). RepeatedWaveform
                    paints the stem once as a CSS mask and repeats it every
                    tile width, so a 1-bar stem is 2 divs instead of 64 SVGs
                    of ~128 rects each. The tile maths (and its minimum
                    width) still come from discoverWindowLayout. The old
                    per-tile blink (2026-09-17, keys shifting with the shared
                    loop length) cannot recur: there are no per-tile nodes
                    left to remount, and the mask is peeked synchronously
                    from the warm peak cache. */}
                    <RepeatedWaveform
                      path={resolvedStem.path}
                      color="var(--ra-text-4)"
                      tileWidthPct={layout.tiles[0]?.widthPct ?? 100}
                    />
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
                        <RepeatedWaveform
                          path={resolvedStem.path}
                          color={stemColorVar(resolvedStem)}
                          tileWidthPct={layout.tiles[0]?.widthPct ?? 100}
                        />
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
                    <LoopLines lefts={layout.restartLinePcts.map((p) => `${p}%`)} kind="restart" />
                    <LoopLines lefts={layout.loopTopLinePcts.map((p) => `${p}%`)} kind="loopTop" />
                  </>
                )
              })()}
            </button>
          ) : (
            <div
              style={{
                width: '100%',
                height: 40,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'hidden',
                border: `1px dashed ${
                  working
                    ? 'var(--ra-stretch-on)'
                    : resolveFailed || noMatchFound
                      ? 'var(--ra-mute-on)'
                      : 'var(--ra-border)'
                }`,
                // Static (no animation) once settled either way (failed/no-
                // match, or truly empty) -- discover-slot-pulse is still
                // used for both "this stopped" cases, not just resolveFailed
                // -- a rerolled slot that found nothing is equally worth
                // flagging, not a silent dead end.
                animation:
                  resolveFailed || noMatchFound
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
              {/* Direct report, 2026-09-17: bumped this up to size={120} once
                  (read as "a jarring 2px sliver against the 40px-tall
                  waveform it replaces"), then reverted -- "i was fine with
                  it being the dotted line... add 1px to the height," then
                  "i think it needs 1 more px to be stable." size=16 (the
                  original) gave a 2px-tall, 1px-thick bar (LoadingLoader's
                  own height = round(size*9/60) formula); size=24 keeps the
                  same 1px-thick dotted-line look at 4px tall -- +2px total
                  from the original, arrived at over two rounds of "+1px." */}
              {working && <LoadingLoader size={24} />}
              {/* Visible, not just a hover tooltip -- direct report,
                  2026-09-17: rerolling into a genuine no-match dead end
                  ("just tried to add a vocal... no indication what
                  happened, no failure message") needs to read as a real
                  outcome, not just silently stay in the same empty-looking
                  box the slot started in before it was ever touched. */}
              {noMatchFound && (
                <span style={{ fontSize: 9, color: 'var(--ra-mute-on)' }}>no match</span>
              )}
            </div>
          )}
        </div>
        <div style={{ gridColumn: 6 }} />
        {/* Kind label + match meter stacked in the 110px label column --
            see the meter's own comment on meterEntries above. */}
        <div
          style={{
            gridColumn: 7,
            width: 110,
            display: 'flex',
            flexDirection: 'column',
            gap: 3,
            minWidth: 0
          }}
        >
          <button
            ref={kindButtonRef}
            disabled={slot.locked}
            onClick={(e) => {
              if (kindMenu) {
                closeKindMenu()
                return
              }
              const rect = e.currentTarget.getBoundingClientRect()
              setKindMenu({ x: rect.left, y: rect.bottom + 4 })
            }}
            aria-expanded={kindMenu !== null}
            aria-label={`kinds: ${slotKindsLabel(slot.kinds)}`}
            data-tooltip={slot.locked ? 'unlock first' : slotKindsLabel(slot.kinds)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 3,
              width: 110,
              padding: 0,
              fontFamily: 'inherit',
              fontSize: 9,
              textAlign: 'left',
              background: 'transparent',
              border: 'none',
              color: kindMenu ? 'var(--ra-text)' : 'var(--ra-text-3)',
              cursor: slot.locked ? 'default' : 'pointer'
            }}
          >
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {slotKindsLabel(slot.kinds)}
            </span>
            {!slot.locked && <span aria-hidden="true">▾</span>}
          </button>
          {meterEntries.length > 0 && (
            <div
              ref={meterRef}
              aria-label="match"
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                columnGap: 6,
                rowGap: 2,
                fontSize: 8,
                lineHeight: '10px',
                color: 'var(--ra-text-3)'
              }}
            >
              {meterEntries.map((entry) =>
                entry.type === 'mask' ? (
                  <span
                    key={`mask-${entry.kind ?? 'reclassified'}`}
                    style={{ whiteSpace: 'nowrap' }}
                  >
                    {entry.label}:{' '}
                    <button
                      onClick={(e) => {
                        if (reclassifyMenu) {
                          closeReclassifyMenu()
                          return
                        }
                        const rect = e.currentTarget.getBoundingClientRect()
                        setReclassifyMenu({
                          x: rect.left,
                          y: rect.bottom + 4,
                          currentRole:
                            entry.kind !== null
                              ? discoverSlotKindToArrangeRole(entry.kind)
                              : (slot.reclassified?.role ?? null)
                        })
                      }}
                      aria-expanded={reclassifyMenu !== null}
                      aria-label={entry.tooltip}
                      data-tooltip={entry.tooltip}
                      style={{
                        padding: 0,
                        fontFamily: 'inherit',
                        fontSize: 'inherit',
                        lineHeight: 'inherit',
                        background: 'transparent',
                        border: 'none',
                        borderBottom: '1px dotted var(--ra-text-4)',
                        color: reclassifyMenu ? 'var(--ra-text)' : 'var(--ra-text-2)',
                        cursor: 'pointer'
                      }}
                    >
                      {entry.source}
                    </button>
                  </span>
                ) : (
                  <span
                    key={`trait-${entry.kind}`}
                    data-tooltip={entry.tooltip}
                    aria-label={entry.tooltip}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 3,
                      whiteSpace: 'nowrap'
                    }}
                  >
                    {entry.label}
                    {/* CSS cells, not the ▮▯ glyphs: Silkscreen has neither,
                      and a fallback-font glyph would break the pixel look.
                      Grey chrome only -- no new colour. */}
                    <span aria-hidden="true" style={{ display: 'inline-flex', gap: 1 }}>
                      {Array.from({ length: MATCH_METER_STEPS }, (_, i) => (
                        <span
                          key={i}
                          style={{
                            width: 3,
                            height: 6,
                            background: i < entry.filled ? 'var(--ra-text-2)' : 'var(--ra-text-4)'
                          }}
                        />
                      ))}
                    </span>
                  </span>
                )
              )}
            </div>
          )}
        </div>
        <div style={{ gridColumn: 8 }} />
        <div style={{ gridColumn: 9, width: 1, height: 18, background: 'var(--ra-border)' }} />
        {/* The four rerolls, as icons (2026-09-29). The decorative dice that
            used to sit here and spin while a roll was in flight is gone:
            the button that STARTED the roll pulses instead, and the others
            dim, which says the same thing about the right button. */}
        <RowIconButton
          gridColumn={10}
          tooltip="skip"
          onClick={(e) => {
            setRerollAction('similar')
            onReroll(e.metaKey)
          }}
          disabled={rerolling}
          dimmed={manualWaiting}
          pulsing={rerolling && rerollAction === 'similar'}
        >
          <SkipForward size={12} />
        </RowIconButton>
        {nearbyAnchor !== null && (
          <RowIconButton
            gridColumn={11}
            tooltip="nearby jam"
            buttonRef={nearbyButtonRef}
            onClick={(e) => {
              if (nearbyMenu) {
                closeNearbyMenu()
                return
              }
              const rect = e.currentTarget.getBoundingClientRect()
              setNearbyMenu({ x: rect.left, y: rect.bottom + 4 })
            }}
            state={nearbyMenu ? 'soft' : 'off'}
            ariaExpanded={nearbyMenu !== null}
            disabled={rerolling}
            dimmed={manualWaiting}
          >
            <Compass size={12} />
          </RowIconButton>
        )}
        <RowIconButton
          gridColumn={12}
          tooltip="any stem"
          onClick={(e) => {
            setRerollAction('random')
            onRerollRandom(e.metaKey)
          }}
          disabled={rerolling}
          dimmed={manualWaiting}
          pulsing={rerolling && rerollAction === 'random'}
        >
          <Shuffle size={12} />
        </RowIconButton>
        <RowIconButton gridColumn={13} tooltip="duplicate" onClick={(e) => onDuplicate(e.metaKey)}>
          <Copy size={12} />
        </RowIconButton>
        {/* 👍 (2026-10-01, the web radio's full-mode row buttons):
            replaces both the star (direct request, 2026-09-16) and the
            separate "hold longer" hand. With 👎, the last two tracks of
            the row, side by side (Elling, 2026-10-01). It TOGGLES
            the star -- filled ThumbsUp and the star's own
            `--ra-recording-live` treatment while the stem is starred --
            and, when it stars, turns hold longer on if it is off
            (likeRadioSlot). While this row holds, the button takes the
            padlock-style inverted fill the hand used to, so the one
            holding row is still visible. Only shown once there's a
            real stem to like, same guard as mute/solo -- its track stays
            reserved either way, so nothing shifts. */}
        {hasStemToActOn && (
          <button
            onClick={onLike}
            // Listen-only with radio off: no star to give and no hold to
            // take, so 👍 does nothing -- dimmed, like any dead control.
            disabled={listenOnlyStars && !radioOn}
            data-tooltip={
              listenOnlyStars && !radioOn
                ? 'listening only, nothing is starred'
                : listenOnlyStars
                  ? holding
                    ? 'holding · listening only, nothing is starred'
                    : 'hold · listening only, nothing is starred'
                  : holding
                    ? favourited
                      ? 'unlike · holding'
                      : 'like · holding'
                    : favourited
                      ? 'unlike'
                      : 'like'
            }
            aria-label={listenOnlyStars ? 'hold, listening only' : favourited ? 'unlike' : 'like'}
            aria-pressed={favourited}
            aria-description={holding ? 'holding longer' : undefined}
            style={{
              gridColumn: 14,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 18,
              height: 18,
              padding: 0,
              background: holding ? 'var(--ra-text)' : 'var(--ra-bg-row-active)',
              border: `1px solid ${favourited ? 'var(--ra-recording-live)' : holding ? 'var(--ra-text)' : 'var(--ra-border)'}`,
              color: favourited
                ? 'var(--ra-recording-live)'
                : holding
                  ? 'var(--ra-bg-frame)'
                  : listenOnlyStars && !radioOn
                    ? 'var(--ra-text-4)'
                    : 'var(--ra-text-2)',
              cursor: listenOnlyStars && !radioOn ? 'default' : 'pointer'
            }}
          >
            <ThumbsUp size={12} weight={favourited ? 'fill' : 'regular'} />
          </button>
        )}
        {/* 👎, CHANGE SOON -- radio's replace-soon (once "change next",
            renamed with the web radio's row buttons, 2026-10-01): "replace
            this", on radio's clock instead of now. The LAST track, beside
            👍 (Elling, 2026-10-01). Filled while set. Hidden while radio is
            off -- with `visibility`, so its track stays reserved and 👍
            never moves -- and greyed on a padlocked row. */}
        <RowIconButton
          gridColumn={15}
          tooltip="change soon"
          onClick={onToggleReplaceSoon}
          toggle
          state={radioFlag === 'replace-soon' ? 'soft' : 'off'}
          disabled={slot.locked}
          hidden={!radioOn}
        >
          <ThumbsDown size={12} weight={radioFlag === 'replace-soon' ? 'fill' : 'regular'} />
        </RowIconButton>
      </div>
      {nearbyMenu && nearbyAnchor !== null && (
        <DiscoverNearbyPopover
          x={nearbyMenu.x}
          y={nearbyMenu.y}
          startCandidate={nearbyAnchor}
          kinds={slot.kinds}
          soundSource={{ endlesss: soundSourceEndlesss, audioIn: soundSourceAudioIn }}
          onPick={onSwapFromNearby}
          onClose={closeNearbyMenu}
          ignoreRef={nearbyButtonRef}
          creator={nearbyCreator}
        />
      )}
      {reclassifyMenu && slot.candidate && (
        <DiscoverReclassifyPicker
          x={reclassifyMenu.x}
          y={reclassifyMenu.y}
          currentRole={reclassifyMenu.currentRole}
          onPick={onReclassify}
          onClose={closeReclassifyMenu}
          ignoreRef={meterRef}
        />
      )}
      {kindMenu && !slot.locked && (
        <DiscoverKindPicker
          x={kindMenu.x}
          y={kindMenu.y}
          kinds={slot.kinds}
          onChange={onChangeKinds}
          onClose={closeKindMenu}
          ignoreRef={kindButtonRef}
        />
      )}
    </>
  )
}
