// src/renderer/src/components/DiscoverPanel.tsx
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Dial } from './Dial'
import { RadioMixActions, RadioStrip, type RadioMixBundle } from './RadioStrip'
import type { RadioStripContext } from '@shared/radioStripModel'
import { radioViewTopIds, type RadioView } from '@shared/radioView'
import { RadioTopLine, RedoIcon, UndoIcon } from './RadioTopLine'
import { DiceIcon } from './DiceIcon'
import { RadioStartPrompt } from './RadioStartPrompt'
import { BracketToggle } from './BracketToggle'
import { resolveStretchedForPlayback } from '../audio/resolveStretchedForPlayback'
import { warmEngineBuffer } from '../audio/warmEngineBuffer'
import { getPeaks, peekPeaks } from '../audio/peakCache'
import { assembleDiscoverRifff, type DiscoverRifffAssembly } from '../audio/discoverRifffAssembly'
import {
  DISCOVER_SLOT_KIND_LABEL,
  DISCOVER_SLOT_KIND_OPTIONS,
  DISCOVER_TRAIT_SLOT_KINDS,
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
import {
  drawManualTransitions,
  mergeStageChanges,
  radioGestureBeats,
  type ManualArrival
} from '@shared/radioManualChanges'
import { stemsToAvoid } from '@shared/discoverPickAvoid'
import {
  DENSITY_MAX,
  DENSITY_MIN,
  advanceDensityLeg,
  arcExitingRow,
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
  advanceRadioClock,
  radioBarsUntilChange,
  radioChangeDueAtNextWrap,
  radioChangeLandsAtBar,
  createRadioClock,
  isRadioEligibleSlot,
  nextRadioIntervalBarsInWindow,
  pickRadioSlotId,
  pickRadioSlotIds,
  radioCadenceOf,
  RADIO_BAR_STAGE_LEAD_BARS,
  radioBarLandingAim,
  radioBarReaim,
  radioCadenceTransition,
  radioLandsMidLoop,
  radioClockForPace,
  radioPhraseNeedsReanchor,
  radioPhraseReanchored,
  type RadioPhraseAnchor,
  radioPaceGridBars,
  radioDensityOf,
  radioDramaOf,
  radioEnergyOf,
  radioStarterKinds,
  restartRadioInterval,
  type RadioClock,
  type RadioSettings,
  radioFavesOf,
  radioPaceLevelOf,
  radioSizedBuildsOf
} from '@shared/radioSchedule'
import {
  NO_CHANGE_FORECAST,
  NO_RADIO_BUILDS,
  advanceRadioBuildClock,
  noteRadioBuild,
  radioArcStepWaits,
  radioBuildArc,
  radioBuildSize,
  radioDistinctStemRows,
  radioForecastWithArcAdd,
  radioForecastWithRows,
  radioNoteTurnaround,
  radioPayoffDecidesNow,
  radioPayoffInReach,
  radioPayoffOf,
  radioPayoffShortfall,
  radioPhraseEndBuild,
  radioTurnaroundPayoffNeed,
  type RadioBuildClock,
  type RadioBuildSize,
  type RadioChangeForecast,
  type RadioPayoff
} from '@shared/radioBuildSize'
import {
  NO_RADIO_HOOKS,
  NO_RADIO_LANDINGS,
  RADIO_DIG_WORD,
  RADIO_HOOK_BACK_WORD,
  RADIO_HOOK_OUT_WORD,
  bringRadioHookBack,
  radioHookBarsToReturn,
  radioRoleWords,
  toggleRadioHookStem,
  advanceRadioLandingWindow,
  forgetRadioHookOnManualChange,
  likeRadioStem,
  noteRadioLandings,
  pruneRadioHooks,
  radioHookInRow,
  radioHookInRowNext,
  radioHookOf,
  radioHookPaceScale,
  radioHookReservesRow,
  radioHookStemsAway,
  radioHookTurnoverExcluded,
  radioHooksStarted,
  radioHooksStopped,
  radioLandingsInPhrase,
  releaseRadioHook,
  returnRadioHookByHand,
  stepRadioHooks,
  withdrawRadioHookEvent,
  type RadioHook,
  type RadioHookThrow,
  type RadioHooksState,
  type RadioLandingWindow
} from '@shared/radioHooks'
import { radioForecastWithUncertainRows, radioWrapBeforeLastLap } from '@shared/radioBuildForecast'
import {
  DIG_NEAR_PER_DIRECTION,
  NO_NEAR_FITS,
  digNearDraw,
  learnRadioDigNear,
  pruneRadioDig,
  radioDigAnchorCandidate,
  radioDigAnchorOf,
  radioDigNearOf,
  radioDigNearPool,
  rankDigOf,
  toggleRadioDig,
  type RadioDigAnchor,
  type RadioDigNearKnown
} from '@shared/radioDig'
import {
  DEFAULT_FAVES,
  FAVES_LABEL,
  FAVES_TOOLTIP,
  NO_FAVE_FITS,
  favesBoostScale,
  favesDraw
} from '@shared/discoverFaves'
import { shouldFlickerLanding, type RadioLandingSource } from '@shared/radioLanding'
import {
  NO_RADIO_SLOT_FLAGS,
  forgetRadioSlotFlagOnChange,
  likeRadioSlot,
  pruneRadioSlotFlags,
  radioSlotFlagOf,
  toggleRadioReplaceSoon,
  type RadioSlotFlags
} from '@shared/radioSlotFlags'
import { buildDropOutCurve, pickDropOutBeats } from '@shared/radioDropOut'
import {
  combineRadioCurves,
  radioTransitionUnderTurnaround,
  radioTurnaroundGate,
  rememberTurnaround,
  rollTurnaround,
  TURNAROUND_MOVES,
  turnaroundArc,
  turnaroundDraw,
  turnaroundDropGapChance,
  turnaroundFitsLoop,
  turnaroundDropCurve,
  turnaroundFlashes,
  turnaroundGapLateRowIds,
  turnaroundMoveCanSound,
  turnaroundPhraseLaps,
  turnaroundPlanMoves,
  turnaroundToLoopBars,
  turnaroundTurnBeats,
  turnaroundWashSend,
  type RadioTurnaroundGate,
  type TurnaroundInput,
  type TurnaroundMemory,
  type TurnaroundMove,
  type TurnaroundPlan,
  type TurnaroundRow
} from '@shared/radioTurnaround'
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
  type RadioApproachWait
} from '@shared/radioApproach'
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
  blockedActions,
  isKeepRefused,
  lingeringArtists,
  lingeringNotice,
  listenOnlyTooltip,
  nextTurnoverSlotId,
  tagPickedUnderArtist,
  type ArtistRollFilter,
  type ListenOnlyAction
} from '@shared/discoverArtist'
import {
  artistSelectionKey,
  artistSelectionLabel,
  artistSelectionNotice,
  artistSelectionTooltip,
  artistSkipWord,
  isCombined,
  memberOfPick,
  pickMatchesArtistSelection,
  selectionCreatorFilter,
  selectionHasMe,
  selectionMode,
  selectionOthers,
  selectionTurnoverIds,
  selectionsEqual,
  memberKey,
  tagByCreator,
  type ArtistSelection
} from '@shared/artistSelection'
import {
  EMPTY_ARTIST_MEMO,
  EMPTY_ARTIST_SHARE,
  reconcileArtistShare,
  artistKnownEmpty,
  artistPickAttempts,
  beginArtistTurn,
  endArtistTurn,
  landArtistTurn,
  noteArtistEmpty,
  type ArtistEmptyMemo,
  type ArtistShareLedger
} from '@shared/artistShare'
import { wallClockMs } from '../audio/wallClock'
import { DiscoverArtistPicker } from './DiscoverArtistPicker'
import { announceArtistScanQueued } from '../audio/artistScanQueueEvent'
import { recordStemRoles } from '../state/stemCategoryCapture'
import type { CoachSlotSnapshot } from '@shared/coachClimax'
import {
  remoteStateFromSlots,
  type RemoteCommand,
  type RemoteKeepOutcome,
  type RemoteRadioView,
  type RemoteSlotAction,
  type RemoteTurnView
} from '@shared/remoteState'
import { type ProjectRef, stemKey } from '@shared/types'
import type { DiscoverCandidate } from '../../../main/discoverCandidates'
import { buildEngineProject, withoutDubThrows } from '@shared/buildEngineProject'
import {
  createRadioFold,
  radioFoldBarCompanions,
  radioFoldChangeCarries,
  radioFoldIntervalBars,
  radioFoldLand,
  radioFoldLandReleases,
  radioFoldStaleFor,
  radioFoldRestartAt,
  radioFoldRestartStep,
  radioFoldTurnaroundRate,
  stepRadioFold,
  type RadioFoldRow,
  type RadioFoldState,
  type RadioFoldStep
} from '@shared/radioFold'
import {
  FOLD_DRIFT_ECHO,
  radioFoldCycleRows,
  radioFoldDriftCurves,
  radioFoldEngineRows,
  radioFoldRowsAt,
  radioFoldSound,
  radioFoldStepLine,
  type RadioFoldLanding
} from '@shared/radioFoldLanes'
import {
  radioFoldBeatsIn,
  radioFoldPhaseDot,
  radioFoldRowLabel,
  radioFoldStatus,
  radioFoldTransportMove,
  type RadioFoldStatusRow
} from '@shared/radioFoldStatus'
import {
  RADIO_THROW_WORD,
  pruneRadioFlashes,
  radioFlashShown,
  radioGestureFlashWord,
  radioReadout,
  radioReadoutArc,
  radioReadoutBars,
  radioReadoutIntensityArc,
  type RadioFlash,
  type RadioReadout
} from '@shared/radioReadout'
import { radioNextLanding } from '@shared/radioNextLanding'
import { applyIntensityBand, radioIntensityRankOf } from '@shared/radioIntensity'
import {
  intensityArcRemote,
  intensityArcShown,
  intensityDropThrowStep,
  intensityFlashRows,
  intensityHeldAddGoes,
  intensityLapAfterLandings,
  intensityMayPickAdd,
  intensityNextChange,
  intensityPressNow,
  intensityRestSweep,
  intensityRestsDecided,
  intensityRowsHeld,
  intensityThrowDropDue,
  sameArcShown,
  type RadioArcShown
} from './radioIntensityGlue'
import {
  RADIO_ARC_REST_SHORT,
  RADIO_ARC_REST_WORD,
  newRadioIntensityArc,
  radioCarryKind,
  radioIntensityAddComing,
  radioIntensityArcRole,
  radioIntensityBend,
  radioIntensityDropInBars,
  radioIntensityHookInputs,
  radioIntensityStarted,
  radioIntensityStopped,
  radioIntensityTarget,
  radioIntensityTargets,
  radioIntensityTurnaroundArc,
  releaseRadioIntensityRest,
  stepRadioIntensityArc,
  type RadioIntensityAction,
  type RadioIntensityArc,
  type RadioIntensityDecided,
  type RadioIntensityRoom,
  type RadioIntensityRow
} from '@shared/radioIntensityArc'
import {
  CLASH_LOWPASS_CUTOFF,
  CLASH_TRAITS,
  radioClashAmount,
  radioClashBed,
  radioClashLowpassRow
} from '@shared/radioClash'
import { discoverStemPans } from '@shared/radioPan'
import { discoverStemPumpRoles } from '@shared/radioPump'
import { normalizeSoundSettings, throwEveryBars } from '@shared/radioSound'
import { drawThrowBeats, drawThrowEcho } from '@shared/radioThrows'
import {
  armDiscoverAimedThrow,
  armDiscoverExitThrow,
  discoverThrowSends,
  discoverThrowAim,
  initialDiscoverThrowState,
  pickDiscoverAimedThrowRow,
  stepDiscoverThrows,
  throwOutlivesLanding,
  throwYieldsToLeadIn,
  withdrawDiscoverExitThrow,
  type DiscoverThrowState
} from '@shared/discoverThrows'
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
import { radioPaceRowsThisChange } from '@shared/radioPace'
import {
  radioChangeLengths,
  radioCompanionCap,
  radioCompanionsRiding,
  radioHeldCompanionsKept,
  radioUsableCompanionPicks
} from '@shared/radioCompanions'
import { DiscoverSlotRow } from './DiscoverSlotRow'
import { radioRowPlates } from '@shared/radioRowPlates'
import { resolveCandidateStem, type ResolvedCandidateStem } from './discoverCandidateStem'
import {
  DISCOVER_ROW_GRID_COLUMNS,
  DISCOVER_ROW_COLUMN_GAP,
  DISCOVER_WAVEFORM_COLUMN,
  DISCOVER_WAVEFORM_MIN_WIDTH,
  RADIO_ROW_INSET_LEFT,
  RADIO_ROW_INSET_RIGHT,
  RADIO_VIEW_FRAME,
  RADIO_VIEW_MAX_WIDTH
} from './discoverRowGrid'

export type { ResolvedCandidateStem } from './discoverCandidateStem'

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
  /** The faves dial drew favourites-only and none fit, so this is a normal pick
   * (@shared/discoverFaves). Logged; the web radio's readout shows it as `no fave fits`. */
  favesFallback?: true
}

/** A row riding radio's armed pick (the pace slider's rows per change, from 70; see
 * ./radioCompanions): its own pick, and its stem and length once warmed (null until then). */
interface RadioPendingCompanion {
  slotId: string
  pick: SlotPick
  stem: ResolvedCandidateStem | null
  incomingBars: number | null
}
/** A row riding radio's HELD change: ready, and staged inside it (mergeStageChanges' companions)
 * as a cut, so it lands or is taken back with it. */
interface RadioHeldCompanion {
  slotId: string
  pick: SlotPick
  stem: ResolvedCandidateStem
  /** Its change carries its row's fold (fold's bar band, radioFoldChangeCarriesNow): the stage
   * names the row for this stem, and the landing re-points the machine (radioFoldLandNow). */
  foldCarry?: boolean
}
/** Sized builds (spec 2026-10-03-radio-anointed-stems-design 4.7): a spare pick, for a row radio
 * may change, picked at a phrase start and warmed (`stem`, null until then), so a turnaround's
 * wrap can be paid off with more rows than radio's own change brings. At most RADIO_SPARES_MAX. */
interface RadioSpare {
  slotId: string
  pick: SlotPick
  stem: ResolvedCandidateStem | null
  /** The row's kinds, and the selection and my sounds it was picked under (slotKindsKey,
   * artistSelectionKey): a spare whose row was re-kinded, or picked under another selection or
   * filter, is stale. */
  kindsKey: string
  filterKey: string
}
const RADIO_SPARES_MAX = 2
/** What could pay off a turnaround's wrap beyond what already lands there (radioPayoffSparesNow),
 * in the order a payoff takes it: radio's armed pick (pulled forward) with its riding companions,
 * then the warm spares. `count` is every row of it. */
interface RadioPayoffSpare {
  pending: {
    slotId: string
    pick: SlotPick
    stem: ResolvedCandidateStem
    companions: RadioHeldCompanion[]
  } | null
  spares: RadioHeldCompanion[]
  count: number
}
/** A payoff assembled for the turnaround armed as `armId` (assembleRadioPayoff), owed until
 * stepRadioPayoff decides it: `pull`, radio's change for the wrap decided early (its armed pick,
 * or a spare when that is not there), and `extra`, rows riding radio's change as companions. */
interface RadioPayoffOwed {
  armId: string
  pull: (RadioHeldCompanion & { fromPending: boolean; companions: RadioHeldCompanion[] }) | null
  extra: RadioHeldCompanion[]
  /** The build size of the change the payoff makes (its per-change draw). */
  size: RadioBuildSize
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
  /** Minted once when the gesture is armed (newArmId), and carried across the lap
   * countdown by the `{ ...g, lapsLeft }` copy. A riser uses it as its identity
   * (buildTransitionRiser's armId): every rebuild mints a fresh groupId, so without
   * it the riser's character, engine voice and noise would change on any re-sync
   * during the armed lap (native radio sound plan, Task 6 review). */
  armId: string
}

/** A fresh RadioGesture.armId: unique per arming, for the session. */
function newArmId(): string {
  return crypto.randomUUID()
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
  /** Rows leaving the mix at this wrap (a hook's resting exit, plan Task 11): left out of the
   * staged member list. Absent: none. */
  leaving?: string[]
  /** Arrival curves for the project this stage BECOMES -- one per changing
   * row that drew one. Never a leading gesture: that belongs to the lap
   * before the swap and rides the live project (radioGestureRef). */
  gestures: RadioGesture[]
  atBars?: number
  /** Fold's bar band (phase 2): the changing rows whose change carries the row's fold
   * (foldCarry). The build names them for their incoming stems (radioFoldCycleRows' `carried`),
   * so the engine's running cycle plays on with the new stem. */
  carried?: string[]
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
// to fix. Comfortably under the shortest interval radio could draw when this
// was set (3 bars at the "fast" pace, ~6s at 120bpm -- RADIO_PACE_BARS), and
// comfortably over the warm build+send chain it normally waits on (tens of
// ms). The pace slider (2026-10-03) draws down to 1 bar above fast, ~2s at
// 120bpm and 1.5s at 160, so at the top of the slider this backstop is no
// longer well under an interval -- it only fires when a commit never
// resolves, so it stays as is, but a skipped change at ludicrous could be it.
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

/** How close to the half of the lap a deferred phrase-turnaround roll may still run, in bars
 * (radioTurnaroundAtWrap): no move starts before the half, and the push carrying it needs time
 * to land -- tens to a couple of hundred ms, measured (holdSyncUntilResolved). A beat is that
 * at any tempo radio plays. */
const TURNAROUND_ROLL_LATE_BARS = 0.25

/** One line per fold step on the console (radioFoldStepLine), so a walkthrough can tell a mode
 * with nothing to fold from one that is broken. Dev builds only, never under vitest: the flag
 * perf/radioTrace.ts and perf/workCounters.ts gate on. */
const FOLD_DEV_LOG = import.meta.env.DEV && import.meta.env.MODE !== 'test'

/** The phrase end's roll while it is owed (radioTurnaroundAtWrap): the loop at its wrap, and
 * every row landing there with the bar length the roll should read -- null when that is not
 * known until the stem resolves, and the roll waits for it. */
interface TurnaroundRollOwed {
  loopBars: number
  landed: Map<string, number | null>
  /** The wrap starts a phrase's last lap: the phrase end's own roll. False for a roll owed only
   * because a turn was waiting (radioTurnPendingRef). */
  phraseEnd: boolean
}

/** A turn's lead, in beats (turnaroundTurnBeats): the push carrying it must reach the engine
 * before its move starts -- tens to a couple of hundred ms, measured (holdSyncUntilResolved), so
 * a beat at any tempo radio plays, as TURNAROUND_ROLL_LATE_BARS is. */
const TURN_LEAD_BEATS = TURNAROUND_ROLL_LATE_BARS * 4

/** The intensity arc's quick drop (the drop button while building or riding): the planner's low
 * drop, at most two bars (spec 2026-10-05-radio-intensity-arc-design 6). */
const INTENSITY_QUICK_DROP_BEATS = 8

/** Discover's rows as the turnaround planner sees them (@shared/radioTurnaround TurnaroundRow):
 * heard when previewing and resolved, and not the row a thinning arc is taking out (`exiting`). */
function discoverTurnaroundRows(
  slots: readonly DiscoverSlot[],
  o: {
    previewing: ReadonlySet<string>
    lengths: ReadonlyMap<string, number>
    loopBars: number
    /** Radio's hooks: `hooked` is a hook IN on the row; `exiting`, a hook whose exit is decided
     * for this wrap (its echo throw ends on it: the planner silences nothing on that row). */
    hooks: RadioHooksState
    exiting: string | null
    filteringIn: (slotId: string) => boolean
    /** The intensity arc's breakdown decided for this wrap: the rows it rests there leave as a
     * hook's exit does (spec 2026-10-05-radio-intensity-arc-design 4.3). Absent: none. */
    arcExiting?: ReadonlySet<string>
  }
): TurnaroundRow[] {
  return slots.map((s) => ({
    id: s.id,
    kinds: s.kinds,
    hooked: radioHookInRow(o.hooks, s.id),
    ...((radioHookOf(o.hooks, s.id)?.decided?.event === 'exit' ||
      o.arcExiting?.has(s.id) === true) && { exiting: true }),
    audible: o.previewing.has(s.id) && o.lengths.has(s.id) && s.id !== o.exiting,
    inFilterIn: o.filteringIn(s.id),
    barLength: o.lengths.get(s.id) ?? o.loopBars
  }))
}

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
  artists,
  onArtistsChange,
  discoverConsented,
  traitMatchBar,
  radioSettings,
  onRadioSettingsChange,
  radioView,
  onRadioViewChange,
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
  /** Discover artist mode (2026-10-01), now the chosen artists (combine artists, 2026-10-06):
   * `[null]` = me. App.tsx state. */
  artists: ArtistSelection
  onArtistsChange: (next: ArtistSelection) => void
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
  /** Every radio setting (DiscoverSettings.radio: the start prompt and the radio strip), and its
   * persisting patch setter. See docs/superpowers/specs/2026-09-28-radio-
   * controls-design.md. */
  radioSettings: RadioSettings
  onRadioSettingsChange: (patch: Partial<RadioSettings>) => Promise<void>
  /** The radio view's simple / advanced switch (spec 2026-10-05-radio-simple-view-design), and
   * its persisting setter (App's DiscoverSettings.radioView). What shows, never what radio does:
   * nothing radio runs reads it. */
  radioView: RadioView
  onRadioViewChange: (view: RadioView) => Promise<void>
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
  // The same, normalized against the app defaults (the radio strip's sound group reads it).
  const soundNow = useMemo(() => normalizeSoundSettings(sound ?? appSoundDefaultsNow()), [sound])
  const pluginCatalog = usePluginCatalog()
  const flushEngineSyncNow = useFlushEngineSyncNow()
  const {
    claim: claimEngine,
    stillOwn: stillOwnEngine,
    release: releaseEngine
  } = useEngineOwnership()
  const hasUsername = currentUsername.trim() !== ''
  // Direct request, 2026-09-22: the roll filters (my sounds -- prefer faves
  // became the faves dial on 2026-10-03; the endlesss/other pair became the
  // source dial on 2026-09-29) are GLOBAL sticky
  // [x] toggles in their own row under the add row -- after a
  // same-day stint as per-slot modifiers. Every roll and reroll of every
  // slot reads the current set, so toggling one affects all future rolls.
  // In-memory only, like the pre-modifier globals were. 'my sounds' is shown unchecked and
  // disabled -- and slotRollOptions ignores it -- while no username is set.
  const [globalModifiers, setGlobalModifiers] =
    useState<DiscoverSlotModifier[]>(DEFAULT_GLOBAL_MODIFIERS)
  const globalRollOptions = slotRollOptions(globalModifiers, { hasUsername })
  // Artist mode, now a selection (combine artists, spec 2026-10-06-combine-artists-design).
  // Mirrored into a ref for the same reason sourceLeanRef is: radio's picks run from long-lived
  // callbacks. Written from an effect, this file's ref-mirroring convention, and synchronously by
  // changeArtists so a pick is in force before the next render lands.
  const artistsRef = useRef<ArtistSelection>(artists)
  useEffect(() => {
    artistsRef.current = artists
  }, [artists])
  const mode = selectionMode(artists, currentUsername)
  const combined = isCombined(artists)
  /** The creator filter as of this render, for children (the nearby popover): today's single
   * creator for one artist, every member's name for a combination. */
  const artistCreator = selectionCreatorFilter(artists, currentUsername)
  /** The others' names, for the single-name tooltips (one other artist: that name). */
  const othersLabel = selectionOthers(artists).join(' + ')
  /** Combine artists' even share (@shared/artistShare): turns landed and picks in flight per
   * member, this session. Reconciled on every selection change (changeArtists). */
  const artistShareRef = useRef<ArtistShareLedger>(
    reconcileArtistShare(EMPTY_ARTIST_SHARE, artists)
  )
  /** Members known to have nothing for a row's kinds (noteArtistEmpty), for 5 minutes. */
  const artistEmptyRef = useRef<ArtistEmptyMemo>(EMPTY_ARTIST_MEMO)
  /** The ledger's landed turns as of the last change, for the picker's `turns:` line (render
   * never reads the ref). */
  const [artistTurnsShown, setArtistTurnsShown] = useState<Readonly<Record<string, number>>>(
    () => artistShareRef.current.landed
  )
  // Listen-only (spec §2): the one list the buttons dim by and main refuses.
  /** The same set as `listenOnly` below, as of NOW (artistsRef, slotsRef),
   * for the functions themselves: the phone's keep and long-lived callbacks
   * call them too, and a pick must be in force before the render that dims
   * the buttons -- otherwise an other->own (or own->other) switch has a
   * window where main's mirror and this panel disagree. */
  function refusesNow(action: ListenOnlyAction): boolean {
    const nowMode = selectionMode(artistsRef.current, currentUsername)
    const still = nowMode === 'own' ? lingeringArtists(slotsRef.current) : []
    return blockedActions(nowMode, still).has(action)
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
  // `artist` is the single member (today's push, for an older main); `artists`
  // the whole selection. Keyed by JSON so a new array with the same members
  // does not re-push.
  const artistsKey = JSON.stringify(artists)
  useEffect(() => {
    const sel = JSON.parse(artistsKey) as (string | null)[]
    void window.rifffApi.discoverSetArtist(
      sel.length === 1 ? sel[0] : (sel.find((m) => m !== null) ?? null),
      currentUsername,
      lingeringKey === '' ? [] : lingeringKey.split('\n'),
      sel
    )
  }, [artistsKey, currentUsername, lingeringKey])
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
  // The faves dial (@shared/discoverFaves, 2026-10-03), where `prefer faves` was: 0..100, how
  // often a roll draws only starred stems and how much the rest lean to them. Persisted in the
  // radio settings (the radio strip's `faves` dial is the same value). A drag previews locally and
  // persists once, on the gesture's end (Dial's onCommit). Mirrored into a ref like sourceLeanRef:
  // radio's picks run from long-lived callbacks.
  const faves = radioFavesOf(radioSettings)
  const [favesDraft, setFavesDraft] = useState<number | null>(null)
  const favesShown = favesDraft ?? faves
  const favesRef = useRef(faves)
  useEffect(() => {
    favesRef.current = faves
  }, [faves])
  function previewFaves(value: number): void {
    favesRef.current = value
    setFavesDraft(value)
  }
  function commitFaves(value: number): void {
    favesRef.current = value
    void onRadioSettingsChange({ faves: value }).finally(() => setFavesDraft(null))
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
  // FOLD MODE'S READOUT (v2, @shared/radioFoldStatus): the folded rows of the lap playing, as its
  // step left them -- the phase dots read it below, straight to the DOM like the line -- and the
  // machine's state with that step, for the status line and each row's `7 / 16` (render reads
  // these, so they are state, set a microtask after the step: radioFoldAtWrap). `laps` is the
  // loop tops radioFoldMoveRef had counted when the rows were read: the step runs a couple of
  // microtasks after the wrap, so the wrap's first frame still holds the previous lap's rows, and
  // the dots add the difference.
  const radioFoldDotsRef = useRef<{ rows: RadioFoldStatusRow[]; laps: number }>({
    rows: [],
    laps: 0
  })
  // What the playhead last did, as the engine's lap clock sees it (radioFoldTransportMove): the
  // position and play state of the last tick, and the loop tops played through, never reset. A
  // restart (playing again, a seek, a snap) restarts every folded cycle in the engine, so it
  // restarts the fold machine's origins too (restartRadioFold).
  const radioFoldMoveRef = useRef({ pos: 0, playing: false, laps: 0 })
  const [radioFoldView, setRadioFoldView] = useState<{
    state: RadioFoldState
    step: RadioFoldStep | null
  } | null>(null)
  // Radio mode is on (see "radio mode" below, where its wiring lives). Declared here because the
  // sweep layout effect just below re-runs on it: the radio view moves the waveforms (Task 7).
  const [radioOn, setRadioOn] = useState(false)
  // The rows' wrapper, which carries --discover-breath for every row.
  const rowsRef = useRef<HTMLDivElement>(null)
  const sweepLapRef = useRef({ lapIndex: 0, lastPos: 0, loopBars: 0 })
  const previewLoopBars = resolvedBarLengths.size > 0 ? Math.max(...resolvedBarLengths.values()) : 0
  const sweepActive = previewingSlotIds.size > 0 && previewLoopBars > 0
  useLayoutEffect(() => {
    const moved = radioFoldMoveRef.current
    const move = radioFoldTransportMove(moved, pos, playing, previewLoopBars)
    radioFoldMoveRef.current = { pos, playing, laps: moved.laps + (move === 'wrap' ? 1 : 0) }
    // a move back is a wrap to radio's clock, so its fold step is about to run
    if (move === 'restart') restartRadioFold(pos < moved.pos)
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
    // FOLD MODE'S PHASE DOTS, off the same position: each folded row's dot goes round its cycle
    // and sits at the left end, the downbeat, when the row realigns (radioFoldPhaseDot).
    const dots = radioFoldDotsRef.current
    const lapsSinceDots = radioFoldMoveRef.current.laps - dots.laps
    rowsRef.current?.querySelectorAll<HTMLElement>('[data-fold-dot]').forEach((dot) => {
      const r = dots.rows.find((x) => x.rowId === dot.dataset.foldDot)
      dot.style.display = r !== undefined && playing ? 'block' : 'none'
      if (r === undefined || !playing) return
      const frac = radioFoldPhaseDot(
        r.cycleBeats,
        r.phaseBeats,
        radioFoldBeatsIn(r, previewLoopBars, pos, lapsSinceDots)
      )
      dot.style.left = `${(frac * 100).toFixed(2)}%`
    })
    const line = sweepLineRef.current
    if (!line) return
    const windowBars = discoverWindowLayout({
      stemBars: previewLoopBars,
      loopBars: previewLoopBars
    }).windowBars
    const pct = discoverSweepPct(sweepLapRef.current.lapIndex, pos, previewLoopBars, windowBars)
    line.style.display = pct === null ? 'none' : 'block'
    if (pct !== null) line.style.left = `${pct}%`
    // radioOn: the line is re-placed when the radio layout switches, even with the transport paused.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- restartRadioFold is re-created each render and reads the fold machine through refs on purpose
  }, [pos, playing, sweepActive, previewLoopBars, radioOn])

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
    // ...and the sound-settings resync's, below, for the same reason.
    skipFirstSoundResyncRef.current = true
    return () => {
      unmountedRef.current = true
      // Fold mode's cycle table lives in the engine, not here: clear it at once, so no row stays
      // folded after the panel is gone.
      void window.rifffApi.engineStageCycles([], true)
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

  /** The master level dial, live (the master strip's and the radio strip's). The ref is
   * written here as well as through its effect: pushMasterLevel reads the ref and must see
   * THIS value, not the one from a render ago. */
  function setMasterLevelLive(v: number): void {
    setMasterLevel(v)
    masterLevelRef.current = v
    pushMasterLevel()
  }

  /** The master filter's cutoff dial, live. Written into the ref as well as into state, for
   * the same reason the level dial does: pushMasterFilter reads the ref and must see THIS
   * value, not a render ago's. */
  function setMasterCutoffLive(v: number): void {
    setMasterCutoff(v)
    masterFilterRef.current = {
      mode: masterFilterMode,
      cutoff: v / 100,
      resonance: masterResonance / 100
    }
    pushMasterFilter()
  }

  /** The master filter's resonance dial, live; as setMasterCutoffLive. */
  function setMasterResonanceLive(v: number): void {
    setMasterResonance(v)
    masterFilterRef.current = {
      mode: masterFilterMode,
      cutoff: masterCutoff / 100,
      resonance: v / 100
    }
    pushMasterFilter()
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
   * A sound settings change resyncs the preview (the sound-resync effect,
   * next to the bpm-retune one), so it is heard within a sync.
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
    const memberIds = stage
      ? new Set([...ids, ...stage.joining].filter((id) => !(stage.leaving ?? []).includes(id)))
      : ids
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
    // VOLUME SHAPES per stem, multiplied together (combineRadioCurves) and put under the master
    // ONCE, at the end of this block -- scaling each under the master first and then multiplying
    // would apply the master twice. Multiplying is the turnarounds spec's rule (section 3): a
    // turnaround's drop never cancels a hole, a duck or the arc's exit; it stacks on them. Until
    // 2026-10-02 the first volume curve on a stem won and every later one was dropped.
    const volumeShapes = new Map<string, AutomationPoint[]>()
    function addVolume(key: string, curve: AutomationPoint[]): void {
      volumeShapes.set(key, combineRadioCurves(volumeShapes.get(key) ?? [], curve, 'volume'))
    }
    // A stem still ducks ONCE: two ducks landing at one wrap are one dip, not a deeper one.
    const ducked = new Set<string>()
    // A turnaround's lift switches its stems' filter to high-pass for the lap.
    const stemFilters: Record<string, StemFilterSettings> = {}
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
          if (own > 0 && curve.length > 0) addVolume(stemKey(rifff.groupId, own), curve)
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
            stemAutomation[key] = {
              ...stemAutomation[key],
              reverbSend: combineRadioCurves(
                stemAutomation[key]?.reverbSend ?? [],
                curve,
                'reverbSend'
              )
            }
          }
        } else if (gesture.kind === 'duck') {
          // Every OTHER audible layer dips, so the new one lands in space.
          // "Other" means other than EVERY row changing in this stage, so a
          // duck never dips another arriving stem -- and on the live push
          // that follows a landing, other than every row that landed with
          // it (`spares`), so that push agrees with the stage it follows.
          //
          // A duck MULTIPLIES with any other volume curve on the stem (a
          // hole, the arc's exit, a turnaround's drop) -- but a stem ducks
          // once: a second duck at the same wrap is the same dip.
          const curve = buildDuckCurve(maxBarLength, bars)
          const changing = new Set(
            stage?.changes.map((c) => c.slotId) ?? gesture.spares ?? [gesture.slotId]
          )
          if (curve.length > 0) {
            members.forEach((m, i) => {
              if (!changing.has(m.id)) {
                const key = stemKey(rifff.groupId, i + 1)
                if (!ducked.has(key)) {
                  ducked.add(key)
                  addVolume(key, curve)
                }
              }
            })
          }
        } else if (gesture.kind === 'riser') {
          // The preview's one rifff sits on its own groupId channel
          // (buildEngineProject's state.channelOf fallback), so that is the
          // bus this sweep belongs on.
          //
          // With the project's riser variety on (native radio sound plan,
          // Task 6) it draws a character -- Q, colour, stereo, sweep, level
          // and a send into the room -- seeded from its id, as the web
          // radio's risers do. Off, it is today's riser exactly.
          const riser = buildTransitionRiser(rifff.groupId, maxBarLength, bars, {
            variety: normalizeSoundSettings(sound ?? appSoundDefaultsNow()).riserVariety.on,
            armId: gesture.armId
          })
          if (riser) risers[riser.id] = riser
        }
      }
    }
    // THE PHRASE TURNAROUND (@shared/radioTurnaround), as lanes on the lap it plays in: the live
    // project, and a stage landing at a BAR inside that lap (it replaces the live project there,
    // so it must carry the move or the move would vanish mid-lap). Never a stage landing at the
    // wrap: the turnaround ends on that wrap. Its curves are in beats before the wrap;
    // turnaroundToLoopBars puts them on the lap, so they end exactly on the loop top.
    //
    // A plan that no longer fits THIS loop (turnaroundFitsLoop: a landing changed the loop after
    // it was rolled) is dropped whole, as is a filter move left with no row to filter (every
    // target already in a change's filter in): either way nothing plays, so the phrase end is
    // forgotten too -- a silent move must not be "repeated" by a diminution at the next one. A
    // turn's leaves the memory alone (plan point 5): it never wrote it, and one replacing a phrase
    // end's has already cleared it.
    const turnaround =
      radioOnRef.current && (!stage || stage.atBars !== undefined)
        ? radioTurnaroundRef.current
        : null
    if (
      turnaround !== null &&
      maxBarLength !== undefined &&
      maxBarLength > 0 &&
      !turnaroundFitsLoop(turnaround.plan, maxBarLength)
    ) {
      if (turnaround.turn === null) radioTurnaroundMemoryRef.current = null
    } else if (turnaround !== null && maxBarLength !== undefined && maxBarLength > 0) {
      const ownSend = masterSendRef.current / 100
      let filtered = 0
      for (const curves of turnaround.plan.rows) {
        const own = members.findIndex((m) => m.id === curves.rowId) + 1
        if (own === 0) continue
        const key = stemKey(rifff.groupId, own)
        if (curves.volume) addVolume(key, turnaroundToLoopBars(curves.volume, maxBarLength))
        if (curves.reverbSend) {
          // from the stem's own send (the master send, stemSends below) up to the peak
          const wash = turnaroundToLoopBars(
            turnaroundWashSend(curves.reverbSend, ownSend),
            maxBarLength
          )
          stemAutomation[key] = {
            ...stemAutomation[key],
            reverbSend: combineRadioCurves(
              stemAutomation[key]?.reverbSend ?? [],
              wash,
              'reverbSend'
            )
          }
        }
        if (curves.filter) {
          // A stem already in a change's filter in keeps it, and its low-pass: one filter, one
          // mode, one lap (combineRadioCurves keeps the curve already there).
          const had = stemAutomation[key]?.filterCutoff ?? []
          if (had.length === 0) {
            filtered += 1
            stemAutomation[key] = {
              ...stemAutomation[key],
              filterCutoff: combineRadioCurves(
                had,
                turnaroundToLoopBars(curves.filter.cutoff, maxBarLength),
                'filterCutoff'
              )
            }
            if (curves.filter.mode === 'highpass') {
              stemFilters[key] = {
                mode: 'highpass',
                cutoff: neutralCutoff('highpass'),
                resonance: 0
              }
            }
          }
        }
      }
      // A row the roll never saw -- joined mid-lap (joinPreviewingMix) or resolved after the roll --
      // is not in plan.rows: silenced through the gap with the same drop, so only the keeper plays
      // through it (turnaroundGapLateRowIds; the throws keep off it the same way).
      const gapBeats = turnaround.plan.gapBeats ?? 0
      const late = turnaroundGapLateRowIds(
        turnaround.plan,
        members.map((m) => m.id)
      )
      if (late.length > 0) {
        const gapDrop = turnaroundToLoopBars(
          turnaroundDropCurve(maxBarLength, gapBeats),
          maxBarLength
        )
        if (gapDrop.length > 0) {
          for (const id of late) {
            const own = members.findIndex((m) => m.id === id) + 1
            if (own > 0) addVolume(stemKey(rifff.groupId, own), gapDrop)
          }
        }
      }
      if (
        turnaround.turn === null &&
        (turnaround.plan.move === 'lift' || turnaround.plan.move === 'dip') &&
        // a combined plan's other parts still sounded: the phrase end stands
        turnaroundPlanMoves(turnaround.plan).length === 1 &&
        filtered === 0
      ) {
        radioTurnaroundMemoryRef.current = null
      }
      if (turnaround.plan.riserBars !== undefined) {
        const riser = buildTransitionRiser(rifff.groupId, maxBarLength, turnaround.plan.riserBars, {
          variety: normalizeSoundSettings(sound ?? appSoundDefaultsNow()).riserVariety.on,
          armId: turnaround.armId,
          // A riser with a gap (spec 2026-10-03-radio-turnaround-combos-design section 3) ends
          // where the gap starts: its tail (an eighth of a bar) and, with riser variety on, its
          // send ring on into the gap while the bed's lanes above hold silent to the one. With
          // variety off it has no send, so the gap holds only the noise tail and the rows' own
          // room (spec flag 5). The return on the one is the engine's 15 ms volume smoother.
          endBeforeBars: (turnaround.plan.gapBeats ?? 0) / 4
        })
        if (riser) risers[riser.id] = riser
      }
    }
    for (const [key, shape] of volumeShapes) {
      stemAutomation[key] = { ...stemAutomation[key], volume: underMaster(key, shape) }
    }

    // RADIO FOLD MODE (@shared/radioFold): which stems name their row for the engine's cycle
    // table (a fold decided for one stem never folds another, and a row a stage is replacing is
    // never named), the drift's lanes over the lap, and the clash's low-pass. A stage landing on
    // the next top carries the next lap's drift; one landing mid-lap (stage.atBars set, a bare
    // cut) plays out the current lap, so it keeps the current lap's, as the turnaround does. After every gesture and turnaround above: a
    // filter already on a stem keeps it (no drift cutoff there), and sends take the max. The mode
    // going off keeps the lap playing as it is until the next top (radioFoldNowRef is put away
    // there, by radioFoldAtWrap): the rows unfold, and the drift and the lean leave, on the top.
    const foldOn =
      radioOnRef.current && (radioSettings.foldMode || radioFoldNowRef.current !== null)
    // A push carried the mode's sound (the clash low-pass, the lean): the wrap that puts the mode
    // away pushes again even when no step was ever played (radioFoldAtWrap).
    if (foldOn) radioFoldSoundedRef.current = true
    const foldStep = !foldOn
      ? null
      : !stage || stage.atBars !== undefined
        ? radioFoldNowRef.current
        : radioFoldNextRef.current
    const stemCycleRows = new Map<string, string>()
    const foldDubSends = new Map<string, AutomationPoint[]>()
    if (foldOn) {
      const slotById = new Map(slotsRef.current.map((s) => [s.id, s]))
      // A stage's carried rows (fold's bar band, phase 2) are named for their incoming stems: the
      // engine's cycle for the row (keyed by row, CycleTable) runs on with the new stem, from the
      // bar or the top it lands on, and the cycles already staged for the next top apply to it.
      const named = radioFoldCycleRows(
        [radioFoldNowRef.current, radioFoldNextRef.current],
        members.map((m) => ({ id: m.id, stemId: slotById.get(m.id)?.candidate?.stemCID ?? null })),
        new Set(stage?.changes.map((c) => c.slotId) ?? []),
        new Set(stage?.carried ?? [])
      )
      const clashRow = radioClashLowpassRow(
        members.map((m) => ({
          id: m.id,
          bright: slotById.get(m.id)?.candidate?.traitPercentiles?.bright
        })),
        radioClashAmount(true, radioSettings.clash)
      )
      const ownSend = masterSendRef.current / 100
      members.forEach((m, i) => {
        const key = stemKey(rifff.groupId, i + 1)
        if (named.has(m.id)) stemCycleRows.set(key, m.id)
        const filtered =
          stemFilters[key] !== undefined || (stemAutomation[key]?.filterCutoff ?? []).length > 0
        if (m.id === clashRow && !filtered) {
          stemFilters[key] = { mode: 'lowpass', cutoff: CLASH_LOWPASS_CUTOFF, resonance: 0 }
        }
        const lap = foldStep?.drift[m.id]
        if (!lap || maxBarLength === undefined || !(maxBarLength > 0)) return
        const curves = radioFoldDriftCurves(lap, maxBarLength, ownSend)
        if (m.id !== clashRow && !filtered) {
          stemAutomation[key] = { ...stemAutomation[key], filterCutoff: curves.cutoff }
        }
        stemAutomation[key] = {
          ...stemAutomation[key],
          reverbSend: combineRadioCurves(
            stemAutomation[key]?.reverbSend ?? [],
            curves.send,
            'reverbSend'
          )
        }
        foldDubSends.set(key, curves.dub)
      })
    }

    // The armed dub throw (native radio sound plan, Task 11; @shared/discoverThrows), as a
    // `dubSend` curve on its row's stem, anchored at the loop top like the gestures above and
    // cleared by the radio clock once the throw has closed (radioThrowTick). Gated on radioOnRef
    // the same way. A STAGED project carries it only if the throw is still open when the stage
    // lands (throwOutlivesLanding): one that closes before then belongs to the project playing
    // now, and carried it would play again a lap later; one in the next lap would be lost with
    // the swap. buildEngineProject sends it only while the project's throws are on, scaled by
    // their level.
    //
    // And a hole, riser or drop-out armed after the throw was planned takes the throw back
    // when it has not started and this push lands first (throwYieldsToLeadIn): no throw over
    // a lead-in, which the web only checks when it plans one. So does a phrase turnaround,
    // which has its lap as a lead-in does: its roll is a microtask behind the wrap tick that
    // may have armed a throw (radioTurnaroundAtWrap).
    let throwState = radioThrowRef.current
    if (
      stage === undefined &&
      ((radioOnRef.current && radioTurnaroundRef.current !== null) ||
        gestureList.some((g) => g.kind === 'drop-out' || radioGestureLeadsChange(g.kind))) &&
      throwYieldsToLeadIn(throwState)
    ) {
      throwState = { ...throwState, armed: null }
      radioThrowRef.current = throwState
    }
    const throwArmed =
      radioOnRef.current && (stage === undefined || throwOutlivesLanding(throwState, stage.atBars))
        ? throwState.armed
        : null
    const dubThrows =
      maxBarLength !== undefined && maxBarLength > 0
        ? discoverThrowSends(
            throwArmed,
            members.map(({ id }) => id),
            rifff.groupId,
            maxBarLength,
            (4 * 60) / bpm
          )
        : undefined
    // A drift's dub sends join the throw's, on its echo; with no throw armed they open into
    // FOLD_DRIFT_ECHO. A throwing row keeps its throw.
    const dubSent =
      foldDubSends.size === 0
        ? dubThrows
        : {
            echo: dubThrows?.echo ?? FOLD_DRIFT_ECHO,
            sends: new Map([...foldDubSends, ...(dubThrows?.sends ?? [])])
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
      // fold mode's clash leans the master glue and saturation in (radioFoldSound)
      sound: radioFoldSound(sound ?? appSoundDefaultsNow(), foldOn, radioSettings.clash),
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
      // A turnaround's lift: the stems it high-passes for the lap (a cutoff curve rising from 0,
      // above). Empty otherwise, which is initialState's own {}, so nothing else changes.
      stemFilters,
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
      // The drum-keyed pump's roles (Task 9), by each member's slot kinds: drums key it, bass
      // is left alone, the rest are pumped. buildEngineProject applies them only while the
      // project's pump is on.
      const stemPumpRoles = discoverStemPumpRoles(
        slotsRef.current,
        members.map(({ id }) => id),
        rifff.groupId
      )
      const project = await buildEngineProject(
        previewState,
        resolveStretchedForPlayback,
        pluginCatalog,
        undefined,
        { stemPans, stemPumpRoles, dubThrows: dubSent, stemCycleRows }
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
      //
      // Without the dub throw (Task 11): a throw is a one-off, and the phone plays its loop on
      // repeat -- it would echo there every lap, and every throw would re-render the loop twice.
      // The gestures do go to the phone; they belong to the layer changes, which change the loop
      // anyway.
      void window.rifffApi.setRemoteLoop(
        dubSent !== undefined ? withoutDubThrows(project) : project,
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
      // A project without a throw curve is now live, so a clear owed for an ended throw
      // (radioThrowClearOwedRef) has been paid by this push: no extra one after a stage lands.
      if (dubThrows === undefined) radioThrowClearOwedRef.current = false

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
    else {
      next.add(id)
      // a row radio is resting, put back in the mix by hand: its hook's return, now
      radioRestReturnsByHand(id)
    }
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
    // Un-solo brings back every resolved row but those radio is resting: its rest is not the
    // user's mute, and un-soloing does not end it. Soloing a resting row puts it back in the mix
    // by hand: its hook's return, now.
    const next = alreadySoleSoloed
      ? new Set([...resolvedStemsRef.current.keys()].filter((k) => !radioRestingRef.current.has(k)))
      : new Set([id])
    if (!alreadySoleSoloed) radioRestReturnsByHand(id)
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
      // A phrase turnaround's roll waiting on this stem's length rolls now, before the push
      // below, so the push carries it (radioTurnaroundAtWrap).
      turnaroundRollOnResolve(id, stem.barLength)
      // and the hook step owed at that wrap, if it has not run yet, aims its exit throw at it
      // (it runs within the wrap's microtasks, so this is rare: a stem still unresolved then
      // leaves the exit dry)
      const hooksOwed = radioHooksStepOwedRef.current
      if (hooksOwed !== null && hooksOwed.landed.get(id) === null) {
        hooksOwed.landed.set(id, stem.barLength)
      }
      // the drop's owed throw, waiting on that length, can arm at its next tick
      const dropOwed = intensityDropThrowRef.current
      if (dropOwed !== null && dropOwed.landed.get(id) === null) {
        dropOwed.landed.set(id, stem.barLength)
      }
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

  // Re-syncs the preview when the project's sound settings change (native radio sound plan, Task
  // 13, carried over from Task 2's review): previewState copies `sound` only when it syncs, so
  // without this a switch flipped in the sound panel (or undone, or a project opened) mid-preview
  // would not be heard until the next unrelated sync. The bpm effect's shape: skip the first run
  // (the mount; reset by the mount effect above for the same StrictMode reason). Only while a
  // preview is loaded or being built -- with nothing previewing there is nothing of Discover's in
  // the engine to update, and a sync would only claim the engine to release it again. One
  // SET_SOUND_SETTINGS per committed change (the panel's sliders commit on release), so this is
  // one load-project per change, never one per drag frame.
  const skipFirstSoundResyncRef = useRef(true)
  useEffect(() => {
    if (skipFirstSoundResyncRef.current) {
      skipFirstSoundResyncRef.current = false
      return
    }
    const ids = previewingSlotIdsRef.current
    if (ids.size === 0 && !previewLoadedRef.current) return
    void syncPreviewToEngine(ids)
    // syncPreviewToEngine: see the bpm effect above; only a sound change should resync.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sound])

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
  // lives in @shared/radioSchedule; what is here is the wiring. radioOn itself is declared
  // above the playhead's sweep layout effect, which re-runs on it (radio view plan Task 7).
  // Synchronously-current mirror of radioOn, for the same stale-closure
  // reason previewingSlotIdsRef and slotsRef exist: armRadioPick awaits a
  // real IPC round trip and must see a switch-off that happened during it.
  // Mirrored through an effect, NOT by assigning during render -- this
  // repo's react-hooks/purity rule rejects a render-time ref write, and
  // slotsRef above already establishes the effect form as this file's
  // pattern. stopRadio also sets it synchronously on switch-off, so a
  // stop takes effect before the next tick rather than a render later.
  const radioOnRef = useRef(false)
  // THE LANDING FLICKER (radio view plan Task 12, spec 2): when the last flicker was, and how many
  // there have been (the strip's `skip` is keyed by the count, so each one restarts it).
  const radioLandingAtRef = useRef<number | null>(null)
  const [radioSkipFlicker, setRadioSkipFlicker] = useState(0)
  /** The strip's `skip` flickers once per landing moment (@shared/radioLanding). */
  function noteRadioLanding(source: RadioLandingSource): void {
    if (!radioOnRef.current) return
    const at = performance.now()
    if (!shouldFlickerLanding(radioLandingAtRef.current, at, source)) return
    radioLandingAtRef.current = at
    setRadioSkipFlicker((n) => n + 1)
  }
  useEffect(() => {
    radioOnRef.current = radioOn
  }, [radioOn])
  // Everything that sets radio's cadence, from the pace slider and the strip's `phrase` (and fold
  // mode's override): the interval window, the CHANGE phrase, the TURNAROUND phrase (never moved by
  // the slider), mid-loop bar lines and rows per change (@shared/radioSchedule radioCadenceOf,
  // spec 2026-10-03-radio-pace-slider-design). Per render, so the clock effect and everything it
  // calls read this render's settings, as they read radioSettings.
  const radioCadence = radioCadenceOf(radioSettings)

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
  /** The token of the armRadioPick awaiting its pick, or null. It is the LIVE arm only while it
   * still equals radioArmTokenRef (radioArmInFlight). */
  const radioArmInFlightRef = useRef<number | null>(null)
  // Rows radio's skip is picking a stem for (skipRadio), before the pick is
  // queued as a manual change -- radio arms nothing meanwhile.
  const radioSkipPickingRef = useRef<Set<string>>(new Set())
  /** Rows still to turn over after a mid-radio artist change -- one per
   * loop top, through skipRadio (@shared/artistSelection selectionTurnoverIds). */
  const artistTurnoverRef = useRef<Set<string>>(new Set())
  // The density arc (@shared/radioDensity): its current leg, the row it is
  // bringing in (still picking, then waiting in the manual queue), the row
  // it is taking out, and a count of loop tops so an exit knows its lap.
  const densityLegRef = useRef<DensityLeg | null>(null)
  // `kinds`: the joining row's, known from the arc's decision (the row reaches slotsRef a render
  // later), for sized builds' forecast (the low end returning).
  // `held` (sized builds): an add decided a lap before the phrase end's roll, its pick waiting to
  // be queued at that roll's wrap so it joins on the phrase start; `warm` once its stem is (the
  // roll then counts it as a sure, large change).
  const arcAddingRef = useRef<{
    slotId: string
    picking: boolean
    kinds?: readonly DiscoverSlotKind[]
    held?: { pick: SlotPick }
    warm?: boolean
  } | null>(null)
  const arcExitRef = useRef<{ slotId: string; phase: 'waiting' | 'fading'; lap: number } | null>(
    null
  )
  const arcLapRef = useRef(0)
  // THE INTENSITY ARC (@shared/radioIntensityArc; spec 2026-10-05-radio-intensity-arc-design):
  // the machine, null unless radio runs with density intensity. Stepped at every wrap in
  // densityTick's microtask, where the density arc steps (intensityAtWrap).
  const intensityArcRef = useRef<RadioIntensityArc | null>(null)
  /** The breakdown's carry row (a lead, or a warm row with a lead on the bed: radioCarryKind),
   * picked and warmed when prepared; it joins on the breakdown's one when the decision says. Its
   * row is not on the panel until then (`slotId` is fresh). */
  const intensityCarryRef = useRef<{
    slotId: string
    kind: DiscoverSlotKind
    pick: SlotPick | null
    stem: ResolvedCandidateStem | null
  } | null>(null)
  /** Fresh picks for the drop's returning drums and bass rows (rowId -> its warm pick), prepared
   * a phrase ahead, leaned to the top target at full weight. */
  const intensityRenewRef = useRef(
    new Map<string, { pick: SlotPick | null; stem: ResolvedCandidateStem | null }>()
  )
  /** Rows the arc put on the panel (its adds, the carry row) that are not on its bed yet: silent
   * until their event lands. The machine's `count` leaves them out (it adds the landing row
   * itself at the wrap it lands). */
  const intensityJoiningRef = useRef(new Set<string>())
  /** The row the decided add or carry brings in, counted from the wrap it lands. */
  const intensityJoinDecidedRef = useRef<string | null>(null)
  /** The breakdown's echo throw, owed until the decide wrap's landings have run (the lap it ends
   * on is the one they make): its row, its shape, and the rows landing at that wrap
   * (noteTurnaroundLanding). */
  const intensityThrowOwedRef = useRef<{
    rowId: string
    shape: RadioHookThrow
    landed: Map<string, number | null>
  } | null>(null)
  /** The build and drop presses, as THIS render has them (Task 11 wires the strip and the phone),
   * for the reason turnRadioRef is. */
  const intensityPressRef = useRef<(action: RadioIntensityAction) => void>(() => {})
  /** Counts the arc's decisions: a flash is keyed by the one it shows (intensityFlashesNow). */
  const intensityDecidedSeqRef = useRef(0)
  /** The drop's own aimed throw, owed from the decision (intensityDropThrowOwed) until armed or
   * given up: the decision it is for (intensityDecidedSeqRef), the lap it was owed in (the
   * readout's radioPlayRef: given up once that lap ends, i.e. on the drop's own top), the rows
   * landing at the decide wrap (noteTurnaroundLanding; the lap it ends on is the one they make,
   * as the breakdown echo's and a hook exit's), and what it last waited on (for the log). */
  const intensityDropThrowRef = useRef<{
    seq: number
    lap: number
    landed: Map<string, number | null>
    waited: string | null
  } | null>(null)
  /** With a one-lap phrase, the add after the one just decided (every wrap is a decide wrap, so
   * the lap-early pick has no lap): picked and warmed now, on the panel and silent, and moved into
   * arcAddingRef once the earlier add has landed (intensityAtWrap). */
  const intensityNextAddRef = useRef<{
    slotId: string
    kinds: readonly DiscoverSlotKind[]
    pick: SlotPick | null
    warm: boolean
  } | null>(null)
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
    /** The rows riding this change (the pace slider's rows per change, from 70), each picked
     * and warmed alongside it. Empty at or below 70. See ./radioCompanions. */
    companions: RadioPendingCompanion[]
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
      companions: RadioPendingCompanion[]
    } | null
  ): void {
    radioPendingRef.current = next
    const slotId = next?.slotId ?? null
    // The ready ones at once; the clock tick narrows it to the riding set (eligible, under the
    // cap) in radioReadoutFrom's microtask -- reading that here would tie this function to
    // render state, and the unmount effect calls it.
    const companionKey =
      next?.companions
        .filter((k) => k.stem !== null)
        .map((k) => k.slotId)
        .join('\n') ?? ''
    void Promise.resolve().then(() => {
      setRadioArmedSlotId(slotId)
      setRadioArmedCompanionKey(companionKey)
    })
  }
  // The rows riding the armed pick and the held change (rows per change), drawn as that change
  // is: the same approach on every row it turns over. Joined ids, so an unchanged set is no
  // re-render.
  const [radioArmedCompanionKey, setRadioArmedCompanionKey] = useState('')
  const [radioHeldCompanionKey, setRadioHeldCompanionKey] = useState('')
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
  // The row's change next (replace soon). See src/shared/radioSlotFlags.ts,
  // which owns every rule about it and the reasoning for each one. (Its
  // other flag, the hook, is a stem now: radioHooksRef, @shared/radioHooks.)
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
  // RADIO'S HOOKS (@shared/radioHooks; spec 2026-10-03-radio-anointed-stems-design section 2): a
  // hooked STEM on its row, leaving on a line with an echo throw and coming back on a phrase
  // start. The successor to the `hook` slot flag (no longer set). State for the rows' render, a
  // ref for the clock effect (written first, by updateRadioHooks only). Not persisted.
  const [radioHooks, setRadioHooks] = useState<RadioHooksState>(NO_RADIO_HOOKS)
  const radioHooksRef = useRef<RadioHooksState>(NO_RADIO_HOOKS)
  /** The away hooks' stem names by row, for the row's dimmed name (set with the hooks). */
  const [radioHookAwayNames, setRadioHookAwayNames] = useState<ReadonlyMap<string, string>>(
    new Map()
  )
  /** The hooked stem's pick by row: what a return queues. Set with the hook. */
  const radioHookPicksRef = useRef(new Map<string, SlotPick>())
  /** The hooked stem warmed for its return (prepare), by row; null while warming. */
  const radioHookWarmRef = useRef(new Map<string, ResolvedCandidateStem | null>())
  /** An exit's substitute, picked and warmed at `prepare`, by row; stem null while warming. */
  const radioHookSubsRef = useRef(
    new Map<
      string,
      { pick: SlotPick | null; stem: ResolvedCandidateStem | null; kindsKey: string }
    >()
  )
  /** Rows a hook is resting on (a resting exit, plan Task 11): radio took them out of the
   * previewing mix at the exit's line, and their hook's return joins them again. Radio's own
   * silence, told apart from a mute: the hook may still return there (the step's `eligible`), the
   * arc's last-of-its-kind does not count them, and radio off puts them back in the mix. A row the
   * user puts back in the mix himself is no longer radio's to rest. */
  // Its owner: `hook` (a hook's resting exit) or `arc` (the intensity arc's breakdown rests the
  // row until its drop: spec 2026-10-05-radio-intensity-arc-design 4.2).
  const radioRestingRef = useRef(new Map<string, 'hook' | 'arc'>())
  /** Row landings per lap over the last phrase (the hook's calm wait). */
  const radioLandingsRef = useRef<RadioLandingWindow>(NO_RADIO_LANDINGS)
  // RADIO'S DIG (@shared/radioDig; spec anointed-stems section 3): the one dug row, or null. The
  // anchor is read fresh at each pick (radioDigAnchorNow), so it follows the row. State for the
  // rows' render, a ref for pickForSlot and the clock (written first, by updateRadioDig only). Kept,
  // inert and hidden, while radio is off (spec 3.1); gone with its row. Not persisted.
  const [radioDig, setRadioDig] = useState<string | null>(null)
  const radioDigRef = useRef<string | null>(null)
  /** The anchor riff's neighbours, learned from the near draw's adjacency calls: the ranking reads
   * them as near in time (rankDigOf). Another anchor riff starts again. */
  const radioDigNearRef = useRef<RadioDigNearKnown | null>(null)
  /** The hook step owed at this wrap (radioHooksAtWrap): run in the fold step's deferred slot,
   * queued first, or by whichever of the fold step and the roll runs earlier. */
  const radioHooksStepOwedRef = useRef<{
    loopBars: number
    lap: number
    /** Rows landing at its wrap and their bar lengths (null: not known until the stem resolves),
     * laid over the resolved ones for the exit throw's lap, as the roll's are. */
    landed: Map<string, number | null>
  } | null>(null)
  // The armed GESTURE -- the density arc's exit drop-out (no stem change) or
  // a transition (one attached to a change). Both are the same thing to the
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
  // hole, a riser or the arc's exit drop-out) -- every path that arms one
  // checks that none is armed first. Empty is "nothing armed". The phrase
  // turnaround, which also has its lap, is not in this list
  // (radioTurnaroundRef, below).
  const radioGestureRef = useRef<RadioGesture[]>([])
  // The phrase turnaround armed for the lap that is playing (@shared/radioTurnaround; spec
  // 2026-10-02-radio-turnarounds-design). Rolled at the wrap that starts a phrase's last lap
  // (radioTurnaroundAtWrap), read by syncPreviewToEngine into the LIVE project (and a mid-lap
  // stage, which replaces it inside the lap) -- never a stage landing at the wrap -- and taken
  // off at the next wrap. Its own ref rather than an entry in radioGestureRef, deliberately:
  // every gesture in that list holds radio's early decision until it is spent, and with a phrase
  // grid the turnaround's lap is exactly the lap the next change is staged in. `armId` keys its
  // riser (buildTransitionRiser), as a gesture's does.
  // `turn`: armed by a turn (radioTurnPendingRef) rather than a phrase end, with the undo sequence
  // it was pressed at (withdrawRadioTurn).
  // `large`: a phrase end rolled at the build size `large` (sized builds), for the build clock
  // (radioNoteTurnaround) once it has played.
  const radioTurnaroundRef = useRef<{
    plan: TurnaroundPlan
    armId: string
    turn: { undoSeq: number } | null
    large?: boolean
  } | null>(null)
  // What the last phrase end fired (rememberTurnaround): never two in a row, except diminution.
  const radioTurnaroundMemoryRef = useRef<TurnaroundMemory | null>(null)
  // SIZED BUILDS (@shared/radioBuildSize; spec 2026-10-03-radio-anointed-stems-design section 4),
  // all gated on radioSizedBuildsOf(radioSettings), so with it off none of this is read or written:
  // - the build clock: bars since the last riser and the last large turnaround, advanced at every
  //   wrap the clock effect sees (so a paused transport stops it), noted where a riser plays;
  // - the spare picks (at most two, picked and warmed from each phrase start; radioSparesWantedRef
  //   asks for them, a tick with no arm in flight picks them) a payoff may add;
  // - the payoff owed to the turnaround armed for this lap, until stepRadioPayoff decides it;
  // - the grid the last tick's clock used, which the forecast's "radio's change is due at the
  //   coming wrap" reads off the tick (a roll runs in a microtask after it).
  const radioBuildClockRef = useRef<RadioBuildClock>(NO_RADIO_BUILDS)
  const radioSparesRef = useRef<RadioSpare[]>([])
  const radioSparesWantedRef = useRef(false)
  const radioPayoffRef = useRef<RadioPayoffOwed | null>(null)
  const radioGridBarsRef = useRef(0)
  // Sized builds switched off mid-run: nothing owed, no spares, the clock from scratch -- so off
  // is today's radio from the next tick, and switching back on starts clean.
  const sizedBuildsOn = radioSizedBuildsOf(radioSettings)
  useEffect(() => {
    if (sizedBuildsOn) return
    radioPayoffRef.current = null
    radioSparesRef.current = []
    radioSparesWantedRef.current = false
    radioBuildClockRef.current = NO_RADIO_BUILDS
  }, [sizedBuildsOn])
  // True from the wrap that starts a phrase's last lap until its roll (a microtask later) has
  // run: the early decision and the manual draw wait it out (radioTurnaroundAtWrap).
  const radioTurnaroundRollPendingRef = useRef(false)
  // The phrase end's roll while it is owed (TurnaroundRollOwed); null when nothing is owed.
  const radioTurnaroundRollRef = useRef<TurnaroundRollOwed | null>(null)
  // A TURN pressed and not rolled yet (docs/superpowers/specs/2026-10-02-radio-turn-button-
  // design.md): a chip's `move`, absent for the planner's choice, and the undo sequence it was
  // pressed at. The latest press wins. See radioTurnTick.
  // `drop`: the intensity arc's drop button armed it for the drop's top (intensityDropTurn): it
  // rolls with the drop's gap chance and a large payoff (spec 2026-10-05-radio-intensity-arc-
  // design 5.6, 6).
  const radioTurnPendingRef = useRef<{
    move?: TurnaroundMove
    undoSeq: number
    drop?: true
  } | null>(null)
  // turnRadio, as THIS render has it, for the listeners registered once (`t`, the phone): set
  // every render, for the reason remoteCommandRef is.
  const turnRadioRef = useRef<(move?: TurnaroundMove) => void>(() => {})
  // What the turn button shows: null at rest; otherwise a turn waits for the top (pressed, or
  // armed and playing into it), and `move` is the chip it holds -- a chip's move, or the move
  // rolled for the planner's choice (null until then).
  const [radioTurnShown, setRadioTurnShown] = useState<{ move: TurnaroundMove | null } | null>(null)
  // The turn button's flash (`nothing to turn`), for a couple of seconds.
  const [radioTurnFlash, setRadioTurnFlash] = useState<string | null>(null)
  // Which turns could sound now, refreshed by the clock effect (refreshRadioTurnCan): the
  // planner's (`canTurn`) and each chip's (`moves`; the rest are dimmed). Null with radio off.
  const [radioTurnCan, setRadioTurnCan] = useState<{
    canTurn: boolean
    moves: TurnaroundMove[]
  } | null>(null)
  // What the strip's (and the phone's) build and drop show (radioIntensityGlue intensityArcShown):
  // the phase, the labels (`building` / `dropping` while a press waits) and whether each can act
  // now. Null unless radio runs with density intensity. Refreshed where the arc changes (a
  // wrap's step, a press) and on every clock tick (the rows decide what a press can do), kept
  // when unchanged (refreshRadioArcShown), so a tick re-renders nothing.
  const [radioArcShown, setRadioArcShown] = useState<RadioArcShown | null>(null)
  // The dub throws (native radio sound plan, Task 11): the web radio's own rule
  // (@shared/radioThrows stepThrows) on a clock of bars played, and the one throw armed
  // as a `dubSend` curve in the preview project, if any. See radioThrowTick. A REF, like
  // radioGestureRef: the 30Hz clock writes it and buildAndPushPreview reads it.
  const radioThrowRef = useRef<DiscoverThrowState>(initialDiscoverThrowState())
  // A throw closed while a staged swap was pending: the push that would clear its curve
  // waits until the stage is gone (a push withdraws a stage). See radioThrowTick.
  const radioThrowClearOwedRef = useRef(false)
  // THE RADIO READOUT (docs/superpowers/specs/2026-10-03-radio-readout-design.md, @shared/
  // radioReadout): its own clock of laps and bars played since radio started (advanced at every
  // wrap the clock effect sees), the lap each row's stem landed on (commitSlotPick: the row's
  // age), the gesture flash log on that clock (radioFlashTick) and the armIds it has logged, and
  // the readout itself -- state, as it is drawn; written once per tick (radioReadoutFrom).
  const radioPlayRef = useRef<{ lap: number; startBars: number }>({ lap: 0, startBars: 0 })
  const radioRowSinceRef = useRef<Map<string, number>>(new Map())
  const radioFlashLogRef = useRef<RadioFlash[]>([])
  const radioFlashSeenRef = useRef<Set<string>>(new Set())
  const [radioReadoutNow, setRadioReadoutNow] = useState<RadioReadout | null>(null)
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
    /** The rows riding this change (the pace slider's rows per change), ready ones only,
     * decided with it. They go out inside its stage as cuts and commit right after it, so every
     * path that takes this change back takes them too. */
    companions?: RadioHeldCompanion[]
    /** Fold's bar band (phase 2): this change carries its row's fold (radioFoldChangeCarriesNow),
     * decided with it and refreshed at the stage (stepRadioStage (3), once the wrap's fold step
     * is in). The stage names the row for the incoming stem, and the landing re-points the
     * machine to it (radioFoldLandNow); a change taken back before it lands leaves the machine
     * as it was. */
    foldCarry?: boolean
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
      companions?: RadioHeldCompanion[]
      foldCarry?: boolean
    } | null
  ): void {
    radioLedChangeRef.current = next
    const slotId = next?.slotId ?? null
    const companionKey = next?.companions?.map((k) => k.slotId).join('\n') ?? ''
    void Promise.resolve().then(() => {
      setRadioHeldSlotId(slotId)
      setRadioHeldCompanionKey(companionKey)
    })
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
        /** A hook's own landing (@shared/radioHooks), queued by the hook step a lap ahead: the
         * exit's substitute (a cut: the echo throw is its gesture) or the hooked stem coming back.
         * Never a manual change: it clears no hook and no replace-soon elsewhere, is never undone
         * (undoSeq -Infinity), and gives way to any manual change for its row
         * (withdrawRadioHookEvent: it is tried again at the next line or phrase start). */
        hook?: 'exit' | 'return'
        /** A resting exit (plan Task 11): no substitute -- `pick`/`stem` are the row's own, and at
         * the wrap the row LEAVES the mix (the stage's `leaving`), its echo ringing on; the row is
         * then resting (radioRestingRef) until its hook's return joins it again. */
        rest?: true
        /** The intensity arc's own landing (intensityDecided): its breakdown resting the row
         * (`rest`, with `rest: true` as a hook's resting exit) or its drop bringing it back
         * (`return`: its own stem or a renewal). Treated as a hook's landing everywhere one is:
         * never a manual change, never undone, and it gives way to any manual change for its
         * row (the arc lets the row go: releaseRadioIntensityRest). */
        arc?: 'rest' | 'return'
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
  /** The turnaround at a wrap, from the clock effect. The one that played comes off (and a roll
   * still owed from the lap that just ended is given up: nothing fired there); the wrap that
   * starts a phrase's last lap owes the next roll (radioTurnaroundRollRef).
   *
   * THE ROLL COMES AFTER THE LANDINGS, as the web radio's does (step.ts rolls after land()). A
   * change landing on this wrap -- the landing branch's held and manual changes, the due
   * branch's commit, a course change -- turns its row over in a microtask queued later in this
   * same tick, and resolvedBarLengthsRef only learns the new stem's length when it resolves, a
   * render and a promise after that. Rolled first (as it was until 2026-10-02), the roll saw the
   * OLD loop, the old row lengths and none of the rows joining: a plan capped against the old
   * loop could run past half a shorter new one, and a row joining here played through a stop.
   * So the roll is queued TWO microtasks deep: the outer one runs after densityTick's (the arc's
   * exit at this wrap is decided first, and the roll leaves that row alone), and by then every
   * first-level microtask this tick queued -- every landing's commit -- is already on the queue,
   * so the inner one runs after all of them. Each landing notes its row and the length it knows
   * (noteTurnaroundLanding: the incoming stem's barLength, which the warmed stem carries), and
   * the roll reads the loop as it will be. A landing whose length is not known yet (a cold stem,
   * a course change's batch) DEFERS the roll to that stem's resolution (reportSlotResolution),
   * which is also when the push carrying the stem goes out, so the plan rides that same push.
   *
   * WHY THE TIME IS THERE: every move is at most half the loop (turnaroundCapBeats), so the
   * earliest any curve starts is the lap's midpoint, and the roll needs only to have reached the
   * engine by then. Undeferred, it runs microseconds after the wrap tick and rides the landing's
   * own push (tens to a couple of hundred ms, measured). Deferred, it is given up once the
   * playhead is within TURNAROUND_ROLL_LATE_BARS of the half (radioTurnaroundOverdue, every tick,
   * and the same check when the stem resolves): a move that cannot be on the engine before it
   * would start is not played at all, never played from its middle.
   *
   * What runs SYNCHRONOUSLY in this tick still decides before the roll: stepRadioStage's early
   * decision and its manual draw. So the roll is marked pending here, and while it is
   * (radioTurnaroundGate's 'wait') those two decide on a later tick instead -- they are a lap
   * early, so a tick (or a deferral) costs nothing. Left unmarked, a hole or riser drawn on this
   * tick would arm first, and the roll keeps an armed lead-in: the turnaround would lose the wrap
   * the two most often share. The due branch, a microtask, rolls inline before arming a lead-in
   * (see there). */
  function radioTurnaroundAtWrap(lapStarts: boolean, loopBars: number): void {
    const had = radioTurnaroundRef.current !== null
    // A turn that played into this top is over: the button goes back to `turn` -- unless a later
    // tap is already waiting, which the button is showing.
    if (radioTurnaroundRef.current?.turn != null && radioTurnPendingRef.current === null) {
      setRadioTurnShown(null)
    }
    if (radioSizedBuildsOf(radioSettings)) {
      // Sized builds: the turnaround that played into this top is a build (a riser in it counts
      // for the spacing; one rolled at large resets the large count, riser or not; spec 4.2).
      const played = radioTurnaroundRef.current
      if (played !== null) {
        radioBuildClockRef.current = radioNoteTurnaround(
          radioBuildClockRef.current,
          played.plan,
          played.large === true
        )
      }
      // A payoff still owed at its wrap was never decided: the build played without it (spec
      // 4.6: logged, never larger than today).
      if (radioPayoffRef.current !== null) {
        console.log('[radio-build] oversold: the payoff was not decided in time')
      }
      // Spares are picked from each phrase start, on a tick with no arm in flight
      // (radioSparesTick), so each is warm by the phrase's last lap.
      if (radioClockRef.current?.turnaroundLap === 0) radioSparesWantedRef.current = true
    }
    radioPayoffRef.current = null
    radioTurnaroundRef.current = null
    if (radioTurnaroundRollRef.current !== null) {
      // given up: nothing fired at that phrase end (a roll owed only for a turn remembers nothing)
      if (radioTurnaroundRollRef.current.phraseEnd) radioTurnaroundMemoryRef.current = null
      radioTurnaroundRollRef.current = null
    }
    radioTurnaroundRollPendingRef.current = false
    // A turn waiting is rolled here too, in the same deferred slot as a phrase end's roll -- after
    // this wrap's landings -- and in its place (rollRadioTurnaround).
    if (!lapStarts && radioTurnPendingRef.current === null) {
      if (had) scheduleSyncPreviewToEngine(previewingSlotIdsRef.current)
      return
    }
    radioTurnaroundRollPendingRef.current = true
    radioTurnaroundRollRef.current = { loopBars, landed: new Map(), phraseEnd: lapStarts }
    void Promise.resolve().then(() =>
      Promise.resolve().then(() => {
        const armed = rollOwedRadioTurnaround()
        if (radioOnRef.current && (had || armed)) {
          scheduleSyncPreviewToEngine(previewingSlotIdsRef.current)
        }
      })
    )
  }
  /** A row turning over while the phrase end's roll is owed (radioTurnaroundAtWrap): the roll
   * reads it at `barLength`, null when that is not known until the stem resolves. A no-op once
   * the roll has run. */
  function noteTurnaroundLanding(slotId: string, barLength: number | null): void {
    radioTurnaroundRollRef.current?.landed.set(slotId, barLength)
    // the breakdown's echo throw owed at this wrap ends on the lap these landings make
    intensityThrowOwedRef.current?.landed.set(slotId, barLength)
    // the hook step owed at this wrap aims an exit throw at the lap these landings make
    radioHooksStepOwedRef.current?.landed.set(slotId, barLength)
    // and so does the drop's own throw, owed from the decide wrap
    intensityDropThrowRef.current?.landed.set(slotId, barLength)
  }
  /** The row lengths and the loop the owed roll would see: the resolved ones, with every landed
   * row's known length over its old one. */
  function turnaroundRollLengths(owed: TurnaroundRollOwed): {
    lengths: Map<string, number>
    loopBars: number
  } {
    const lengths = new Map(resolvedBarLengthsRef.current)
    for (const [id, bars] of owed.landed) if (bars !== null && bars > 0) lengths.set(id, bars)
    return { lengths, loopBars: lengths.size > 0 ? Math.max(...lengths.values()) : owed.loopBars }
  }
  /** Whether the owed roll is too late to reach the engine before its move could start: the
   * playhead (the last tick's position) within TURNAROUND_ROLL_LATE_BARS of the half of the
   * shorter of the loop it was owed on and the loop it would roll in. */
  function turnaroundRollTooLate(owed: TurnaroundRollOwed): boolean {
    const at = radioClockRef.current?.lastPos ?? 0
    const loopBars = Math.min(owed.loopBars, turnaroundRollLengths(owed).loopBars)
    return at >= loopBars / 2 - TURNAROUND_ROLL_LATE_BARS
  }
  /** Gives the owed roll up: nothing fires at this phrase end. A turn waiting stays waiting:
   * radioTurnTick rolls it, clamped to what is left of the lap. */
  function giveUpTurnaroundRoll(): void {
    if (radioTurnaroundRollRef.current?.phraseEnd !== false) {
      radioTurnaroundMemoryRef.current = null
    }
    radioTurnaroundRollRef.current = null
    radioTurnaroundRollPendingRef.current = false
  }
  /** The owed roll, once every landed row's length is known. True when it armed a turnaround
   * (the caller pushes). False with nothing owed, while it waits for a stem, or when given up. */
  function rollOwedRadioTurnaround(): boolean {
    const owed = radioTurnaroundRollRef.current
    if (owed === null) return false
    if ([...owed.landed.values()].some((b) => b === null)) return false
    radioTurnaroundRollRef.current = null
    radioTurnaroundRollPendingRef.current = false
    if (!radioOnRef.current) return false
    rollRadioTurnaround(owed)
    return radioTurnaroundRef.current !== null
  }
  /** A stem resolved: a deferred roll waiting on it rolls now -- or is given up when the lap is
   * too far on for its move (turnaroundRollTooLate). Before the caller's push, so it carries it. */
  function turnaroundRollOnResolve(slotId: string, barLength: number): void {
    const owed = radioTurnaroundRollRef.current
    if (owed === null || owed.landed.get(slotId) !== null) return
    owed.landed.set(slotId, barLength)
    if ([...owed.landed.values()].some((b) => b === null)) return
    if (turnaroundRollTooLate(owed)) giveUpTurnaroundRoll()
    else rollOwedRadioTurnaround()
  }
  /** Every tick but a wrap: a deferred roll still waiting once its move could no longer reach the
   * engine in time is given up, so the early decision and the manual draw stop waiting on it. */
  function radioTurnaroundOverdue(): void {
    const owed = radioTurnaroundRollRef.current
    if (owed !== null && turnaroundRollTooLate(owed)) giveUpTurnaroundRoll()
  }
  /** The phrase end's roll (rollTurnaround), on the rows and the loop as the landings at its wrap
   * left them (radioTurnaroundAtWrap). Math.random is passed, not called here (this repo's
   * react-hooks/purity rule). No pushUndoSnapshot: a turnaround is performance, not an edit. A
   * change's own lead-in already armed for this lap keeps it: no roll, and the next phrase end is
   * not "after a turnaround". */
  function rollRadioTurnaround(owed: TurnaroundRollOwed): void {
    // The rate below reads the coming top's realignment: a fold step still owed runs first,
    // wherever this roll runs from (the wrap's deferred slot, the due branch's inline roll, a
    // stem resolving) -- and the hook step before it (runOwedRadioFoldStep runs it), so the
    // forecast counts a return and the planner keeps off an exiting row.
    runOwedRadioFoldStep()
    const leadArmed = radioGestureRef.current.some(
      (g) => g.kind !== 'drop-out' && radioGestureLeadsChange(g.kind)
    )
    if (leadArmed) {
      // a turn waiting keeps waiting: the lead-in has this top, the turn takes the next
      if (owed.phraseEnd) radioTurnaroundMemoryRef.current = null
      return
    }
    const { lengths, loopBars } = turnaroundRollLengths(owed)
    const input = turnaroundInputNow(lengths, loopBars)
    const turn = radioTurnPendingRef.current
    // Sized builds: what lands at the coming top already, and what could be added there (spec
    // 4.7). Read once, before anything below arms; null with sized builds off.
    const sized = radioSizedBuildsOf(radioSettings)
    const pos = radioClockRef.current?.lastPos ?? 0
    const forecast = sized ? radioForecastNow(loopBars, pos) : null
    // a turn was asked for: everything that could change is offered; a phrase end below the
    // pace's bar band only what radio was about to change anyway (radioPayoffInReach)
    const spare =
      forecast !== null ? radioPayoffSparesNow(loopBars, pos, forecast, turn === null) : null
    if (turn !== null) {
      const turnPlan = rollTurnaround({
        ...input,
        rate: radioSettings.turnarounds,
        random: Math.random,
        lastPhrase: null,
        force:
          turn.move === undefined
            ? {}
            : {
                move: turn.move,
                // the quick drop's low drop is at most two bars (spec 6)
                ...(turn.drop === true &&
                  turn.move === 'low drop' && { maxBeats: INTENSITY_QUICK_DROP_BEATS })
              },
        // a turn brings a payoff too: a gap only when a large one can be assembled
        ...(forecast !== null &&
          spare !== null && {
            payoff: radioPayoffOf(radioForecastWithRows(forecast.f, spare.count))
          }),
        // the drop's turn, or a turn on the drop's top: merged with the drop (spec 5.6)
        ...intensityTurnDrop(turn)
      })
      armRadioTurn(turnPlan, turn.undoSeq)
      if (turnPlan !== null && forecast !== null && spare !== null) {
        assembleRadioPayoff(forecast.f, spare, turnPlan, loopBars, pos, forecast.radio)
      }
      // A TURN takes this top: the phrase end's own roll stands down and remembers nothing, so a
      // turn never starts or extends a diminution. A turn that cannot sound here (it flashed
      // `nothing to turn`) costs the phrase end nothing: its own roll goes ahead below.
      if (turnPlan !== null) {
        if (owed.phraseEnd) radioTurnaroundMemoryRef.current = null
        return
      }
    }
    // A roll owed only for a turn that was withdrawn since (undo): nothing to roll.
    if (!owed.phraseEnd) return
    // a phrase ending on a fold's realignment top prefers a turnaround
    const rate = radioFoldTurnaroundRate(
      radioSettings.turnarounds,
      radioSettings.foldMode && radioFoldNextRef.current?.marked === true
    )
    // the phrase end's own offer, in reach of radio's pace (a turn above offered everything)
    const endSpare =
      forecast === null
        ? null
        : turn === null
          ? spare
          : radioPayoffSparesNow(loopBars, pos, forecast, true)
    // The intensity arc's drop lands at this phrase end: the riser leads at its longest (at
    // large) and the gap is drawn at the drop's chance (spec 4.4). Absent otherwise.
    const dropRoll = intensityDropRoll()
    if (forecast === null || endSpare === null) {
      // sized builds off: today, exactly -- but the intensity arc's drop with the low end coming
      // back is rolled at large (spec 4.4: its riser leads at its longest; a swell's is not)
      const dropLarge =
        dropRoll.drop !== undefined && radioForecastNow(loopBars, pos).f.lowEndReturn
      const plan = rollTurnaround({
        ...input,
        rate,
        random: Math.random,
        lastPhrase: radioTurnaroundMemoryRef.current,
        ...dropRoll,
        ...(dropLarge && { size: 'large' as const })
      })
      radioTurnaroundMemoryRef.current = rememberTurnaround(plan)
      radioTurnaroundRef.current = plan === null ? null : { plan, armId: newArmId(), turn: null }
      return
    }
    // SIZED BUILDS (spec 4.4, 4.7): no payoff possible, no turnaround (and no draw); otherwise
    // rolled at the forecast's tier raised to medium, after the budget, with a gap only when a
    // large payoff can follow -- and when it fires, the payoff is assembled.
    // the build's arc: a growing mix earns its gap sooner (radioPhraseEndBuild's promotion)
    const buildArc = radioBuildArc(forecast.f, input.arc)
    const build = radioPhraseEndBuild(forecast.f, endSpare.count, {
      ...radioBuildBudgetNow(loopBars, pos),
      arc: buildArc
    })
    if (build.skip) {
      radioTurnaroundMemoryRef.current = null
      radioTurnaroundRef.current = null
      console.log('[radio-build] no payoff: no turnaround at this phrase end')
      return
    }
    const plan = rollTurnaround({
      ...input,
      arc: buildArc,
      size: build.size,
      payoff: build.payoff,
      rate,
      random: Math.random,
      lastPhrase: radioTurnaroundMemoryRef.current,
      ...dropRoll
    })
    radioTurnaroundMemoryRef.current = rememberTurnaround(plan)
    radioTurnaroundRef.current =
      plan === null
        ? null
        : { plan, armId: newArmId(), turn: null, ...(build.size === 'large' && { large: true }) }
    if (plan !== null) {
      assembleRadioPayoff(forecast.f, endSpare, plan, loopBars, pos, forecast.radio)
    }
  }
  /** What a roll reads now, but the rate, the randomness and the memory: the rows at `lengths`
   * (a landing's known length over the old one), on `loopBars`.
   *
   * The landings at this wrap have run: a joining row is in the previewing mix
   * (joinPreviewingMix), and an arrival gesture landing with its row is on radioGestureRef -- a
   * filter in there is `inFilterIn`, so the planner never aims a lift or a dip at a row the lane
   * builder would then skip.
   *
   * The row a thinning arc is taking out (stepArcExit) is left out of the turnaround, as if
   * unheard, but only when its exit fades in this lap: an 8-beat drop-out (ARC_EXIT_BEATS, at
   * most half the loop) that goes silent before the wrap and removes the row in the silence, so a
   * move ending on the wrap -- a wash above all -- would land on a row already gone. An exit held
   * back (arcExitHeldBack: a stage out, a drop-out or lead-in armed) is not leaving at this wrap:
   * the row plays on, so it stays in, and a stop or low drop silences it as any other. No
   * `leavingRowId` either way: the planner's wash takes the non-drums bed. (The web radio's
   * leaving row goes silent before the wrap too -- the same 8-beat exit hole -- and its roll
   * leaves it out the same way.) */
  function turnaroundInputNow(
    lengths: ReadonlyMap<string, number>,
    loopBars: number
  ): Omit<TurnaroundInput, 'rate' | 'random' | 'lastPhrase'> {
    const exiting = arcExitingRowNow()
    const intensity = intensityOn() ? intensityArcRef.current : null
    return {
      loopBars,
      rows: discoverTurnaroundRows(slotsRef.current, {
        previewing: previewingSlotIdsRef.current,
        lengths,
        loopBars,
        hooks: radioHooksRef.current,
        exiting,
        filteringIn: (slotId) =>
          radioGestureRef.current.some((g) => g.slotId === slotId && g.kind === 'filter in'),
        // the breakdown's rests decided for this wrap leave as a hook's exit does (spec 4.3)
        ...(intensity !== null && { arcExiting: intensityRestsDecided(intensity) })
      }),
      arc:
        intensity !== null
          ? radioIntensityTurnaroundArc(intensity)
          : radioDensityOf(radioSettings) === 'arc'
            ? turnaroundArc(densityLegRef.current, slotsRef.current.length)
            : 'steady',
      leavingRowId: null,
      moves: radioSettings.turnaroundMoves,
      depth: radioSettings.turnaroundDepth,
      // layered moves and the riser's gap (spec 2026-10-03-radio-turnaround-combos-design):
      // phrase ends, turns and chips alike (a chip is the lead; the planner may layer onto it)
      combine: true
    }
  }
  // --- sized builds (spec 2026-10-03-radio-anointed-stems-design section 4; @shared/
  // radioBuildSize). Every caller gates on radioSizedBuildsOf(radioSettings). ---

  /** What changes at the coming loop top, as the panel knows it now (spec 4.1): radio's held change
   * landing there (not a mid-loop cut, which lands before it) with its kept companions, or else its
   * armed pick, warm and due at that wrap, with its riding companions; every ready manual change;
   * the density arc's row joining (radioForecastWithArcAdd: a large change once its stem is ready,
   * at most a medium one while it is still picking -- it is, at the phrase end's roll) or its exit;
   * a course change; a hook's return decided for that top (hookReturn, lowEndReturn on drums or
   * bass), never its exit. `rowIds` are the rows counted, `stems` the stems they bring; `radio`
   * says radio's own change is among them. */
  function radioForecastNow(
    loopBars: number,
    pos: number
  ): { f: RadioChangeForecast; rowIds: Set<string>; stems: Set<string>; radio: boolean } {
    const rowIds = new Set<string>()
    const stems = new Set<string>()
    const add = (slotId: string, pick: SlotPick): void => {
      rowIds.add(slotId)
      if (pick.candidate !== null) stems.add(pick.candidate.stemCID)
    }
    const led = radioLedChangeRef.current
    const pending = radioPendingRef.current
    const clock = radioClockRef.current
    let radio = false
    if (led !== null) {
      if (led.atBars === undefined) {
        radio = true
        add(led.slotId, led.pick)
        for (const k of radioStagedCompanions(led)) add(k.slotId, k.pick)
      }
    }
    // Radio's armed pick due at that wrap: warm, it and its warm riding companions are sure rows;
    // still warming (it or a companion), they count as uncertain ones -- medium at most
    // (radioForecastWithUncertainRows), as they may not be ready in time.
    let uncertain = 0
    if (
      led === null &&
      pending !== null &&
      clock !== null &&
      radioEligibleSlotIds().includes(pending.slotId) &&
      radioChangeDueAtNextWrap(
        clock,
        pos,
        loopBars,
        radioGridBarsRef.current > 0 ? radioGridBarsRef.current : loopBars,
        radioCadence.phraseBars
      )
    ) {
      radio = true
      const eligible = radioEligibleSlotIds()
      const coldCompanions = pending.companions.filter(
        (k) =>
          k.stem === null && eligible.includes(k.slotId) && !manualChangesRef.current.has(k.slotId)
      )
      if (pending.stem !== null) {
        add(pending.slotId, pending.pick)
        for (const k of radioPendingCompanionsNow(pending)) add(k.slotId, k.pick)
      } else {
        rowIds.add(pending.slotId)
        uncertain += 1
      }
      for (const k of coldCompanions) rowIds.add(k.slotId)
      uncertain += coldCompanions.length
    }
    // A hook coming back at that top (decided at the wrap that started this lap, binding): a row,
    // and how long it was away; on a drums or bass row the low end returning (planning
    // decision 2). An exit is a dub exit: no row, no build.
    let hookReturn: RadioChangeForecast['hookReturn'] = null
    let lowEndReturn = false
    for (const h of radioHooksRef.current.hooks) {
      const d = h.decided
      // (a row radio's change or a companion also names counts once: the return wins it)
      // only while its entry is still queued: once it landed, the row is just playing
      if (d === null || d.event !== 'return') continue
      if (manualChangesRef.current.get(h.rowId)?.hook !== 'return') continue
      rowIds.add(h.rowId)
      stems.add(h.stemId)
      if (hookReturn === null || d.awayBars > hookReturn.awayBars) {
        hookReturn = { awayBars: d.awayBars }
      }
      const kinds = slotsRef.current.find((s) => s.id === h.rowId)?.kinds ?? []
      if (kinds.some((k) => k === 'drums' || k === 'bass')) lowEndReturn = true
    }
    const adding = arcAddingRef.current
    for (const [slotId, m] of manualChangesRef.current) {
      if (
        m.stem !== null &&
        m.hook !== 'exit' &&
        // the breakdown's rests are not changes (spec 5.1): a decided breakdown counts no rows
        m.arc !== 'rest' &&
        slotId !== adding?.slotId &&
        !rowIds.has(slotId)
      ) {
        add(slotId, m.pick)
      }
      // the drop's rows coming back: the low end returning when one has drums or bass
      if (m.arc === 'return') {
        const kinds = slotsRef.current.find((s) => s.id === slotId)?.kinds ?? []
        if (kinds.some((k) => k === 'drums' || k === 'bass')) lowEndReturn = true
      }
    }
    // The intensity arc's role for the coming phrase end (radioIntensityArcRole). Absent under
    // any other density: the forecast is today's.
    const intensity = intensityOn() ? intensityArcRef.current : null
    let f: RadioChangeForecast = radioForecastWithUncertainRows(
      {
        ...NO_CHANGE_FORECAST,
        ...(intensity !== null && { arcRole: radioIntensityArcRole(intensity) }),
        hookReturn,
        lowEndReturn,
        rows: rowIds.size - uncertain,
        arcStep: arcExitingRowNow() !== null ? 'remove' : null,
        course: radioCourseChangeRef.current !== null
      },
      uncertain
    )
    if (adding !== null) {
      // Ready: its stem warm (a held add, decided a lap early) or its queued entry's. Still
      // picking: a medium change at most (radioForecastWithArcAdd).
      const entry = manualChangesRef.current.get(adding.slotId)
      const ready =
        adding.warm === true || (!adding.picking && entry !== undefined && entry.stem !== null)
      const pick = entry?.pick ?? adding.held?.pick
      const kinds =
        adding.kinds ?? slotsRef.current.find((s) => s.id === adding.slotId)?.kinds ?? []
      f = radioForecastWithArcAdd(f, {
        ready,
        lowEnd: kinds.some((k) => k === 'drums' || k === 'bass')
      })
      if (ready && pick !== undefined) add(adding.slotId, pick)
      else rowIds.add(adding.slotId)
    }
    return { f, rowIds, stems, radio }
  }
  /** A spare's pick still fits its row: the row is there with the kinds it was picked for, and the
   * selection and my sounds (artistSelectionKey) are the ones it was picked under. */
  function radioSpareFits(k: RadioSpare): boolean {
    const slot = slotsRef.current.find((s) => s.id === k.slotId)
    return (
      slot !== undefined &&
      slotKindsKey(slot.kinds) === k.kindsKey &&
      artistSelectionKey(artistsRef.current, globalRollOptions.onlyOwnStems) === k.filterKey
    )
  }
  /** What could be added at the coming top for a payoff (spec 4.7), each warm and eligible, in the
   * order a payoff takes it: radio's armed pick when it is not already landing there (nor landing
   * on a mid-loop bar before it), with its riding companions; then the spares. Never a row in
   * `rowIds` (already changing there), a row with a manual change, radio's held change's or armed
   * pick's rows, or the row the arc is taking out; never a stem already playing, landing there
   * (`stems`) or brought by an earlier row (radioDistinctStemRows).
   *
   * `reach` (a phrase end below the bar band, radioPayoffInReach): when radio's next change is not
   * due within a phrase of the top, nothing is offered -- neither its pick nor the spares -- so a
   * payoff never adds a change radio was not about to make. */
  function radioPayoffSparesNow(
    loopBars: number,
    pos: number,
    landing: { rowIds: ReadonlySet<string>; stems: ReadonlySet<string> },
    reach: boolean
  ): RadioPayoffSpare {
    const none: RadioPayoffSpare = { pending: null, spares: [], count: 0 }
    const clock = radioClockRef.current
    if (
      reach &&
      !radioPayoffInReach({
        barBand: radioCadence.barEvery !== null,
        barsToDue: clock === null ? Number.NaN : clock.intervalBars - clock.barsElapsed,
        aheadBars: loopBars - pos,
        phraseBars: turnaroundPhraseLaps(radioCadence.turnaroundPhraseBars, loopBars) * loopBars
      })
    ) {
      return none
    }
    const eligible = radioEligibleSlotIds()
    const manual = manualChangesRef.current
    const led = radioLedChangeRef.current
    const now = radioPendingRef.current
    const taken = new Set(landing.rowIds)
    if (led !== null) {
      taken.add(led.slotId)
      for (const k of led.companions ?? []) taken.add(k.slotId)
    }
    const exiting = arcExitingRowNow()
    if (exiting !== null) taken.add(exiting)
    // stems already heard or landing at the top: never brought a second time
    const stems = new Set(landing.stems)
    for (const s of slotsRef.current) if (s.candidate !== null) stems.add(s.candidate.stemCID)
    const stemOf = (k: { pick: SlotPick }): string | null => k.pick.candidate?.stemCID ?? null
    let pending: RadioPayoffSpare['pending'] = null
    if (
      led === null &&
      now !== null &&
      now.stem !== null &&
      now.pick.candidate !== null &&
      clock !== null &&
      !taken.has(now.slotId) &&
      !manual.has(now.slotId) &&
      eligible.includes(now.slotId) &&
      !radioHookTurnoverExcluded(radioHooksRef.current, now.slotId) &&
      !stems.has(now.pick.candidate.stemCID) &&
      radioChangeLandsAtBar(
        clock,
        pos,
        loopBars,
        radioGridBarsRef.current > 0 ? radioGridBarsRef.current : loopBars,
        radioCadence.phraseBars
      ) === null
    ) {
      const stem = now.stem
      stems.add(now.pick.candidate.stemCID)
      const companions = radioDistinctStemRows(
        radioHeldCompanionsFrom(now)
          .filter(
            (k) =>
              !taken.has(k.slotId) && !radioHookTurnoverExcluded(radioHooksRef.current, k.slotId)
          )
          .map((k) => ({ ...k, stemCID: stemOf(k) })),
        stems
      ).map(({ stemCID, ...k }) => {
        if (stemCID !== null) stems.add(stemCID)
        return k
      })
      pending = { slotId: now.slotId, pick: now.pick, stem, companions }
    }
    if (now !== null) {
      taken.add(now.slotId)
      for (const k of now.companions) taken.add(k.slotId)
    }
    const spares = radioDistinctStemRows(
      radioSparesRef.current.flatMap((k) =>
        k.stem === null ||
        taken.has(k.slotId) ||
        manual.has(k.slotId) ||
        !eligible.includes(k.slotId) ||
        radioHookTurnoverExcluded(radioHooksRef.current, k.slotId) ||
        !radioSpareFits(k)
          ? []
          : [{ slotId: k.slotId, pick: k.pick, stem: k.stem, stemCID: stemOf(k) }]
      ),
      stems
    ).map(({ slotId, pick, stem }) => ({ slotId, pick, stem }))
    return {
      pending,
      spares,
      count: (pending !== null ? 1 + pending.companions.length : 0) + spares.length
    }
  }
  /** The build budget for a top `loopBars - pos` bars away (radioApplyBuildBudget). */
  function radioBuildBudgetNow(
    loopBars: number,
    pos: number
  ): { hookScale: number; clock: RadioBuildClock; aheadBars: number; phraseBars: number } {
    return {
      hookScale: radioHookPaceScale(radioPaceLevelOf(radioSettings)),
      clock: radioBuildClockRef.current,
      aheadBars: Math.max(0, loopBars - pos),
      phraseBars: turnaroundPhraseLaps(radioCadence.turnaroundPhraseBars, loopBars) * loopBars
    }
  }
  /** The build size of a change decided now (spec 4.3) whose rows are `rows`, landing at the
   * coming top with whatever else lands there (radioForecastNow), after the budget. Undefined with
   * sized builds off: the draws are today's. A riser is the only gesture the size reweights, and
   * it always leads into the coming top, so that is the top it is measured at. */
  function radioChangeSizeNow(
    rows: readonly string[],
    loopBars: number,
    pos: number
  ): RadioBuildSize | undefined {
    if (!radioSizedBuildsOf(radioSettings)) return undefined
    const { f, rowIds } = radioForecastNow(loopBars, pos)
    const more = new Set(rows.filter((id) => !rowIds.has(id))).size
    return radioBuildSize(radioForecastWithRows(f, more), radioBuildBudgetNow(loopBars, pos))
  }
  /** A turnaround just armed (`plan`, the phrase end's or a turn's) is paid off (spec 4.7): the
   * rows its wrap still needs (radioPayoffShortfall of radioTurnaroundPayoffNeed) are taken from
   * `spare` -- radio's armed pick pulled forward (an EARLY decision, so radio's interval restarts
   * from its landing: a payoff never adds a change on top of radio's own) with its companions,
   * then spares riding radio's change as companions. With radio's own change already landing
   * there, only spares, joining it. With no armed pick to pull, the first spare is radio's change.
   * Owed (radioPayoffRef) until stepRadioPayoff decides it, late in the lap. */
  function assembleRadioPayoff(
    f: RadioChangeForecast,
    spare: RadioPayoffSpare,
    plan: TurnaroundPlan,
    loopBars: number,
    pos: number,
    radioInForecast: boolean
  ): void {
    const armed = radioTurnaroundRef.current
    if (armed === null || armed.plan !== plan) return
    const need: RadioPayoff = radioTurnaroundPayoffNeed(plan)
    let n = radioPayoffShortfall(f, need)
    if (n <= 0) return
    const spares = [...spare.spares]
    let pull: RadioPayoffOwed['pull'] = null
    if (!radioInForecast) {
      if (spare.pending !== null) {
        pull = { ...spare.pending, fromPending: true }
        n -= 1 + spare.pending.companions.length
      } else {
        const first = spares.shift()
        if (first !== undefined) {
          pull = { ...first, fromPending: false, companions: [] }
          n -= 1
        }
      }
    }
    const extra: RadioHeldCompanion[] = []
    for (const k of spares) {
      if (n <= 0) break
      extra.push(k)
      n -= 1
    }
    if (pull === null && extra.length === 0) {
      console.log(`[radio-build] payoff short: nothing to add (${need})`)
      return
    }
    const added = (pull !== null ? 1 + pull.companions.length : 0) + extra.length
    radioPayoffRef.current = {
      armId: armed.armId,
      pull,
      extra,
      size: radioBuildSize(radioForecastWithRows(f, added), radioBuildBudgetNow(loopBars, pos))
    }
    console.log(
      `[radio-build] payoff +${added} (${need}${n > 0 ? `, short ${n}` : ''}): ` +
        [
          ...(pull !== null ? [pull.slotId, ...pull.companions.map((k) => k.slotId)] : []),
          ...extra.map((k) => k.slotId)
        ].join(' ')
    )
  }
  /** The payoff owed to this lap's turnaround, decided on the clock's tick from stepRadioStage,
   * before its early decision and with the same gates (spec 4.7). True when it decided radio's
   * change (the caller returns, as after (2)); step (3) stages it on a later tick.
   * - Radio's change already lands at the top (held, not a mid-loop cut): the extra rows join it as
   *   companions at once; a stage already out is withdrawn and re-staged with them, unless the
   *   wrap is too close (MANUAL_RESTAGE_MIN_BARS) or the engine already took it -- then it is
   *   oversold.
   * - Otherwise radio's change is decided LATE in the lap (radioPayoffDecidesNow: the stage's lead
   *   and a margin before the top), so a throw aimed at the turnaround can still arm first (a held
   *   change stops throws arming): the pulled pick (or the first usable spare) with its companions
   *   and the extras, its gesture drawn at the payoff's size and kept to an arrival under the
   *   turnaround. Early decision, so its interval restarts at the landing. It waits while (2)
   *   would: a change due on this tick, a stage carrying radio's change, a course change, the roll
   *   still owed, a gesture playing, a mid-loop cut still to land.
   * No stem twice: a row bringing a stem already playing, landing, or brought by an earlier row
   * is left out (radioDistinctStemRows).
   * Dropped when the turnaround it pays off is no longer the armed one (a turn replaced it, undo). */
  function stepRadioPayoff(due: boolean, pos: number, loopBars: number): boolean {
    const owed = radioPayoffRef.current
    if (owed === null) return false
    if (radioTurnaroundRef.current?.armId !== owed.armId || !radioOnRef.current) {
      radioPayoffRef.current = null
      return false
    }
    const eligible = radioEligibleSlotIds()
    const manual = manualChangesRef.current
    const led = radioLedChangeRef.current
    const exiting = arcExitingRowNow()
    const ledRows = new Set(
      led === null ? [] : [led.slotId, ...(led.companions ?? []).map((k) => k.slotId)]
    )
    const usable = (k: { slotId: string }): boolean =>
      eligible.includes(k.slotId) &&
      !manual.has(k.slotId) &&
      // a hook set since the payoff was assembled keeps its row
      !radioHookTurnoverExcluded(radioHooksRef.current, k.slotId) &&
      !ledRows.has(k.slotId) &&
      k.slotId !== exiting
    // stems heard now, or landing at the top with radio's held change or a manual change
    const heard = new Set<string>()
    for (const s of slotsRef.current) if (s.candidate !== null) heard.add(s.candidate.stemCID)
    for (const k of [...(led !== null ? [led] : []), ...(led?.companions ?? [])]) {
      if (k.pick.candidate !== null) heard.add(k.pick.candidate.stemCID)
    }
    for (const m of manual.values())
      if (m.pick.candidate !== null) heard.add(m.pick.candidate.stemCID)
    const distinct = <T extends { pick: SlotPick }>(rows: readonly T[], taken: Set<string>): T[] =>
      radioDistinctStemRows(
        rows.map((row) => ({ row, stemCID: row.pick.candidate?.stemCID ?? null })),
        taken
      ).map((r) => r.row)
    const takeSpares = (rows: readonly { slotId: string }[]): void => {
      const used = new Set(rows.map((k) => k.slotId))
      radioSparesRef.current = radioSparesRef.current.filter((k) => !used.has(k.slotId))
    }
    if (led !== null && led.atBars === undefined) {
      radioPayoffRef.current = null
      const extra = distinct(
        [
          ...(owed.pull !== null && !owed.pull.fromPending ? [owed.pull] : []),
          ...owed.extra
        ].filter(usable),
        heard
      )
      if (extra.length === 0) return false
      if (led === radioStageAppliedLedRef.current) {
        console.log('[radio-build] oversold: the stage was already taken')
        return false
      }
      if (radioStageRef.current !== null) {
        if (loopBars - pos < MANUAL_RESTAGE_MIN_BARS) {
          console.log('[radio-build] oversold: too close to the top to re-stage')
          return false
        }
        cancelStagedSwap('payoff')
      }
      takeSpares(extra)
      setRadioLedChange({
        ...led,
        companions: [
          ...(led.companions ?? []),
          ...radioFoldCarryCompanionsNow(
            extra.map((k) => ({ slotId: k.slotId, pick: k.pick, stem: k.stem }))
          )
        ]
      })
      return false
    }
    // Radio's own change was counted as landing at the top but is not decided yet: (2) decides
    // it, and the extras join it on a later tick (above).
    if (owed.pull === null) return false
    // Late in the lap, so an aimed throw can arm first; a stage still has its lead and a margin.
    const stageLead =
      (radioCadence.barEvery !== null ? RADIO_BAR_STAGE_LEAD_BARS : 0) + MANUAL_RESTAGE_MIN_BARS
    if (!radioPayoffDecidesNow(loopBars - pos, stageLead)) return false
    const manualOnlyStage =
      radioStageRef.current !== null && radioStageRef.current.ledSlotId === null
    if (
      led !== null ||
      due ||
      (radioStageRef.current !== null && !manualOnlyStage) ||
      appliedManualStillWaiting() ||
      radioCourseChangeRef.current !== null ||
      turnaroundGateNow() === 'wait' ||
      !gesturesSpentAt(pos, loopBars)
    ) {
      return false
    }
    const pull = owed.pull
    const pendingNow = radioPendingRef.current
    const pulled =
      pull.fromPending && pendingNow !== null && pendingNow.pick === pull.pick && usable(pull)
        ? { ...pull, companions: radioHeldCompanionsFrom(pendingNow).filter(usable) }
        : !pull.fromPending && usable(pull)
          ? pull
          : null
    const rest = owed.extra.filter(usable)
    const candidates = distinct(
      [
        ...(pulled !== null ? [pulled] : []),
        ...(pulled !== null ? pulled.companions : []),
        ...rest
      ],
      heard
    )
    radioPayoffRef.current = null
    const [first, ...riding] = candidates
    if (first === undefined) {
      console.log('[radio-build] oversold: nothing left to pull')
      return false
    }
    const fromPending = pulled !== null && first === pulled
    const changing = slotsRef.current.find((sl) => sl.id === first.slotId)
    const drawn = radioCadenceTransition(
      radioCadence,
      pickTransition(radioSettings.transitions, changing?.kinds ?? [], Math.random, {
        size: owed.size
      }),
      true
    )
    const transition = radioTransitionUnderTurnaround(drawn)
    const beats = radioGestureBeats(transition, pickDropOutBeats, owed.size)
    if (fromPending) setRadioPending(null)
    takeSpares(candidates)
    setRadioLedChange({
      slotId: first.slotId,
      pick: first.pick,
      stem: first.stem,
      early: true,
      arrival: transition === 'cut' ? undefined : { kind: transition, beats },
      companions: [
        ...radioFoldCarryCompanionsNow(
          riding.map((k) => ({ slotId: k.slotId, pick: k.pick, stem: k.stem }))
        )
      ],
      foldCarry: radioFoldChangeCarriesNow(first.slotId, first.pick, first.stem)
    })
    if (manualOnlyStage) cancelStagedSwap('radio-joins')
    // The gates held it past the stage's own lead: its stage may reach the engine late.
    if (loopBars - pos < stageLead) {
      console.log(
        `[radio-build] late: payoff decided ${(loopBars - pos).toFixed(2)} bars before the top`
      )
    }
    console.log(`[radio-build] payoff decided: ${first.slotId} +${riding.length} (${transition})`)
    return true
  }
  /** Every tick but a wrap: the spares asked for at a phrase start (radioSparesWantedRef) are
   * picked on the first later tick with no arm of radio's in flight -- checked again in the
   * deferred pick itself, since an arm can start in between (an arc removal re-arms). The spares'
   * picks yield to everyone's anyway (pickForSlot's `yieldRow`). */
  function radioSparesTick(wrapped: boolean): void {
    if (!radioSparesWantedRef.current || wrapped) return
    if (!radioSizedBuildsOf(radioSettings)) {
      radioSparesWantedRef.current = false
      return
    }
    if (radioArmInFlight()) return
    radioSparesWantedRef.current = false
    // deferred: the picks below must not run inside the clock effect's body
    void Promise.resolve().then(() => {
      if (!radioOnRef.current) return
      if (radioArmInFlight()) {
        radioSparesWantedRef.current = true
        return
      }
      armRadioSpares()
    })
  }
  /** Keeps up to RADIO_SPARES_MAX spare picks (spec 4.7): drops one whose row is gone or re-kinded,
   * picked under another roll filter, or whose stem now plays on a row, then picks the missing
   * rows as armRadioPick picks (pickRadioSlotIds) among the eligible rows radio is not already
   * changing (its armed pick and held change and their companions, a manual change, the arc's
   * joining or leaving row, a skip picking), and warms each. Each pick yields its row
   * (pickForSlot's `yieldRow`): it bumps nothing, shows nothing, and gives up when anyone else
   * picks for that row meanwhile. */
  function armRadioSpares(): void {
    const live = new Map(slotsRef.current.map((s) => [s.id, s]))
    const playing = new Set(
      slotsRef.current.flatMap((s) => (s.candidate !== null ? [s.candidate.stemCID] : []))
    )
    radioSparesRef.current = radioSparesRef.current.filter(
      (k) =>
        live.has(k.slotId) &&
        radioSpareFits(k) &&
        k.pick.candidate !== null &&
        !playing.has(k.pick.candidate.stemCID)
    )
    const missing = RADIO_SPARES_MAX - radioSparesRef.current.length
    if (missing <= 0) return
    const taken = new Set(radioSparesRef.current.map((k) => k.slotId))
    const pending = radioPendingRef.current
    if (pending !== null) {
      taken.add(pending.slotId)
      for (const k of pending.companions) taken.add(k.slotId)
    }
    const led = radioLedChangeRef.current
    if (led !== null) {
      taken.add(led.slotId)
      for (const k of led.companions ?? []) taken.add(k.slotId)
    }
    for (const id of manualChangesRef.current.keys()) taken.add(id)
    for (const id of radioSkipPickingRef.current) taken.add(id)
    if (arcAddingRef.current !== null) taken.add(arcAddingRef.current.slotId)
    if (arcExitRef.current !== null) taken.add(arcExitRef.current.slotId)
    const eligible = radioEligibleSlotIds().filter(
      (id) => !taken.has(id) && !radioHookTurnoverExcluded(radioHooksRef.current, id)
    )
    const ids = pickRadioSlotIds(eligible, radioLastSlotRef.current, missing, {
      turnover: radioSettings.turnover,
      changedAt: radioChangedAtRef.current,
      turn: radioTurnRef.current,
      flags: radioSlotFlagsRef.current
    })
    const filterKey = artistSelectionKey(artistsRef.current, globalRollOptions.onlyOwnStems)
    for (const id of ids) {
      const slot = live.get(id)
      if (slot === undefined) continue
      const kindsKey = slotKindsKey(slot.kinds)
      void pickForSlot(id, slot.kinds, { avoidOwnStem: true, yieldRow: true }).then((pick) => {
        if (pick === null || pick.candidate === null || !radioOnRef.current) return
        const spares = radioSparesRef.current
        if (spares.length >= RADIO_SPARES_MAX || spares.some((k) => k.slotId === id)) return
        radioSparesRef.current = [...spares, { slotId: id, pick, stem: null, kindsKey, filterKey }]
        void resolveAndWarmPick(pick).then((stem) => {
          radioSparesRef.current = radioSparesRef.current.flatMap((k) =>
            k.pick !== pick ? [k] : stem === null ? [] : [{ ...k, stem }]
          )
        })
      })
    }
  }
  /** The loop as it plays now: every resolved row's length, and the longest. */
  function turnaroundLoopNow(): { lengths: Map<string, number>; loopBars: number } {
    const lengths = new Map(resolvedBarLengthsRef.current)
    return { lengths, loopBars: lengths.size > 0 ? Math.max(...lengths.values()) : 0 }
  }
  /** A turn's roll, armed: it has the lap, as a phrase end's does (radioTurnaroundGate, the
   * throws). Null is nothing to turn: the button says so, and goes on showing an earlier turn
   * still armed for this top (it plays, and undo can still take it back). No push here -- the
   * caller's. */
  function armRadioTurn(plan: TurnaroundPlan | null, undoSeq: number): void {
    radioTurnPendingRef.current = null
    if (plan === null) {
      const armed = radioTurnaroundRef.current
      setRadioTurnShown(armed?.turn != null ? { move: armed.plan.move } : null)
      flashRadioTurn('nothing to turn')
      return
    }
    radioTurnaroundRef.current = { plan, armId: newArmId(), turn: { undoSeq } }
    setRadioTurnShown({ move: plan.move })
  }
  /** The turn button's flash, for two seconds. */
  function flashRadioTurn(text: string): void {
    setRadioTurnFlash(text)
    window.setTimeout(() => setRadioTurnFlash((f) => (f === text ? null : f)), 2000)
  }
  /** Every tick but a wrap: a turn waiting rolls as soon as the coming top can take it, its move
   * clamped to the time left (turnaroundTurnBeats, less TURN_LEAD_BEATS). It waits -- for a later
   * tick, or the next wrap's roll (radioTurnaroundAtWrap) -- while:
   * - the wrap's own roll is still owed (radioTurnaroundRollRef): that roll takes the turn;
   * - a change's lead-in (a hole, a riser) has this top: it keeps it;
   * - a move already armed into this top has started, or starts within the lead: it is not cut;
   * - under 1 beat plus the lead is left;
   * - a stage is out that cannot be re-staged in time (a mid-lap cut at a bar, or under
   *   MANUAL_RESTAGE_MIN_BARS to the wrap). Otherwise the stage is withdrawn -- once the roll has
   *   a plan, before the push carrying it -- and re-staged on a later tick (an ordinary push
   *   withdraws a stage anyway). A roll that finds nothing leaves the stage alone.
   * A turnaround armed for this lap -- a phrase end's, or an earlier turn's -- is replaced: the
   * latest decision wins. Replacing a phrase end's means nothing fired there, so the memory goes.
   * No pushUndoSnapshot: a turn is performance, not an edit (withdrawRadioTurn). */
  function radioTurnTick(pos: number, loopBars: number): void {
    const turn = radioTurnPendingRef.current
    if (turn === null || radioTurnaroundRollRef.current !== null || !(loopBars > 0)) return
    if (
      radioGestureRef.current.some((g) => g.kind !== 'drop-out' && radioGestureLeadsChange(g.kind))
    ) {
      return
    }
    const toTopBeats = (loopBars - pos) * 4
    const armed = radioTurnaroundRef.current
    if (armed !== null && toTopBeats - armed.plan.beats < TURN_LEAD_BEATS) return
    const fits = turnaroundTurnBeats(toTopBeats, TURN_LEAD_BEATS)
    if (fits === null) return
    // the quick drop's low drop is at most two bars (spec 6)
    const maxBeats =
      turn.drop === true && turn.move === 'low drop'
        ? Math.min(fits, INTENSITY_QUICK_DROP_BEATS)
        : fits
    if (
      radioStageRef.current !== null &&
      (radioLedChangeRef.current?.atBars !== undefined || loopBars - pos < MANUAL_RESTAGE_MIN_BARS)
    ) {
      return
    }
    const { lengths } = turnaroundLoopNow()
    // Sized builds: a turn brings a payoff too (spec 4.7), a gap only when a large one can follow.
    const forecast = radioSizedBuildsOf(radioSettings) ? radioForecastNow(loopBars, pos) : null
    const spare = forecast !== null ? radioPayoffSparesNow(loopBars, pos, forecast, false) : null
    const plan = rollTurnaround({
      ...turnaroundInputNow(lengths, loopBars),
      rate: radioSettings.turnarounds,
      random: Math.random,
      lastPhrase: null,
      force: turn.move === undefined ? { maxBeats } : { move: turn.move, maxBeats },
      ...(forecast !== null &&
        spare !== null && {
          payoff: radioPayoffOf(radioForecastWithRows(forecast.f, spare.count))
        }),
      // the drop's turn, or a turn on the drop's top: merged with the drop (spec 5.6)
      ...intensityTurnDrop(turn)
    })
    if (plan === null) {
      armRadioTurn(null, turn.undoSeq)
      return
    }
    // withdrawn only now there is something to push, and before that push
    cancelStagedSwap('turn')
    if (armed !== null && armed.turn === null) radioTurnaroundMemoryRef.current = null
    armRadioTurn(plan, turn.undoSeq)
    if (forecast !== null && spare !== null) {
      assembleRadioPayoff(forecast.f, spare, plan, loopBars, pos, forecast.radio)
    }
    scheduleSyncPreviewToEngine(previewingSlotIdsRef.current)
  }
  /** Which turns could sound now (radioTurnCan), from the clock effect: kept when unchanged, so
   * a tick re-renders nothing. */
  function refreshRadioTurnCan(): void {
    const { lengths, loopBars } = turnaroundLoopNow()
    const input = turnaroundInputNow(lengths, loopBars)
    const next = {
      canTurn: turnaroundDraw(input).length > 0,
      moves: TURNAROUND_MOVES.filter((m) => turnaroundMoveCanSound(input, m))
    }
    setRadioTurnCan((prev) =>
      prev !== null && prev.canTurn === next.canTurn && prev.moves.join() === next.moves.join()
        ? prev
        : next
    )
  }
  /** What build and drop show (radioArcShown), from the machine and the rows now: kept when
   * unchanged, so a tick re-renders nothing. `canDrop` asks the quick drop's `low drop` as
   * intensityPress does. Null unless radio runs the intensity arc. */
  function refreshRadioArcShown(): void {
    const arc = radioOnRef.current && intensityOn() ? intensityArcRef.current : null
    let next: RadioArcShown | null = null
    const { lengths, loopBars } =
      arc !== null ? turnaroundLoopNow() : { lengths: null, loopBars: 0 }
    // No landing's length yet: intensityPress bails too, so nothing can act (and the phrase is
    // never asked of a 0-bar loop).
    if (arc !== null && lengths !== null && loopBars > 0) {
      next = intensityArcShown(arc, {
        lap: radioClockRef.current?.turnaroundLap ?? 0,
        phraseLaps: turnaroundPhraseLaps(radioCadence.turnaroundPhraseBars, loopBars),
        room: intensityRoomNow(),
        quickDropCanSound: turnaroundMoveCanSound(turnaroundInputNow(lengths, loopBars), 'low drop')
      })
    }
    setRadioArcShown((prev) => (sameArcShown(prev, next) ? prev : next))
  }
  /** A TURN pressed: the desktop's `turn` and chips, `t`, and the phone (remoteCommandRef). A
   * press that cannot sound now -- the chip's guards, or nothing the planner could draw -- says
   * `nothing to turn` and waits for nothing. Otherwise it waits for the top (radioTurnTick, or
   * the next wrap's roll); a later press replaces it. Turnarounds `off` stops only the phrase
   * ends: a turn still works. */
  function turnRadio(move?: TurnaroundMove): void {
    if (!radioOnRef.current) return
    const { lengths, loopBars } = turnaroundLoopNow()
    const input = turnaroundInputNow(lengths, loopBars)
    const can =
      move !== undefined ? turnaroundMoveCanSound(input, move) : turnaroundDraw(input).length > 0
    if (!can) {
      flashRadioTurn('nothing to turn')
      return
    }
    const undoSeq = undoSequence.latest()
    radioTurnPendingRef.current = move === undefined ? { undoSeq } : { move, undoSeq }
    setRadioTurnShown({ move: move ?? null })
  }
  /** Undo's first stop: a turn pressed after the latest undo point is taken back on its own, as
   * the newest thing done (a turn pushes no snapshot -- it is not slot state). A turn waiting is
   * dropped; one armed is taken off only while its move has not begun, by TURN_LEAD_BEATS. True
   * when it took one back. A turn pressed BEFORE the latest undo point waits: that snapshot's
   * edit is undone first, then the turn on the next undo. */
  function withdrawRadioTurn(): boolean {
    const pending = radioTurnPendingRef.current
    const armed = radioTurnaroundRef.current?.turn != null ? radioTurnaroundRef.current : null
    const undoSeq = pending?.undoSeq ?? armed?.turn?.undoSeq
    if (undoSeq === undefined) return false
    const top = undoStack[undoStack.length - 1]
    const topSeq = top === undefined ? undefined : undoSequence.seqOf(top)
    if (topSeq !== undefined && undoSeq < topSeq) return false
    if (pending !== null) {
      radioTurnPendingRef.current = null
      setRadioTurnShown(armed === null ? null : { move: armed.plan.move })
      return true
    }
    if (armed === null) return false
    const { loopBars } = turnaroundLoopNow()
    const at = radioClockRef.current?.lastPos ?? 0
    if ((loopBars - at) * 4 - armed.plan.beats < TURN_LEAD_BEATS) return false
    radioTurnaroundRef.current = null
    setRadioTurnShown(null)
    scheduleSyncPreviewToEngine(previewingSlotIdsRef.current)
    return true
  }
  /** radioTurnaroundGate for a decision made now. */
  function turnaroundGateNow(): RadioTurnaroundGate {
    return radioTurnaroundGate(
      radioTurnaroundRollPendingRef.current,
      radioTurnaroundRef.current !== null
    )
  }
  /** RADIO FOLD MODE (@shared/radioFold): the machine's state, and its decisions for the lap
   * playing now and for the next one -- it decides a lap ahead, at every wrap, so the engine can
   * take each lap's cycles exactly on its top (engineStageCycles; CycleTable.h). */
  const radioFoldRef = useRef<RadioFoldState | null>(null)
  const radioFoldNowRef = useRef<RadioFoldStep | null>(null)
  const radioFoldNextRef = useRef<RadioFoldStep | null>(null)
  /** A wrap's step, owed until it runs (radioFoldAtWrap): the loop at the wrap, and every row
   * landing there with the stem it brings (noteFoldLanding). */
  const radioFoldStepOwedRef = useRef<{
    loopBars: number
    landed: Map<string, RadioFoldLanding>
  } | null>(null)
  /** A push has carried the mode's sound since fold mode was last put away (resetRadioFold). */
  const radioFoldSoundedRef = useRef(false)
  /** The row the density arc is taking out before the next top (arcExitingRow), or null. */
  function arcExitingRowNow(): string | null {
    return arcExitingRow(arcExitRef.current, arcLapRef.current, arcExitHeldBack())
  }
  /** A row turning over at this wrap while its fold step is owed: the step reads it with this
   * stem (its length null while unresolved, and the row unheard). A no-op once the step ran. */
  function noteFoldLanding(
    slotId: string,
    pick: SlotPick,
    stem: ResolvedCandidateStem | null
  ): void {
    radioFoldStepOwedRef.current?.landed.set(slotId, {
      stemId: pick.candidate?.stemCID ?? null,
      barLength: stem !== null && stem.barLength > 0 ? stem.barLength : null,
      percussive: stem?.type === 'drums'
    })
  }
  // --- radio's hooks (@shared/radioHooks; spec anointed-stems section 2) ---

  /** THE ONE WAY the hooks are written: the ref first (the clock effect's closures read it), then
   * the state the rows render from. */
  function updateRadioHooks(next: RadioHooksState): void {
    if (next === radioHooksRef.current) return
    radioHooksRef.current = next
    setRadioHooks(next)
    const away = new Map<string, string>()
    for (const h of next.hooks) {
      const name = radioHookPicksRef.current.get(h.rowId)?.candidate?.presetName
      if (h.state !== 'in' && name !== undefined) away.set(h.rowId, name)
    }
    setRadioHookAwayNames(away)
  }
  /** The row's hook toggle (track 16, the phone's `hook`): releases its hook in any state (an away
   * hook's return is cancelled, the substitute stays), or hooks the playing stem (the cap releases
   * the oldest). Radio on and the row unlocked only. */
  function toggleSlotHook(id: string): void {
    const slot = slotsRef.current.find((s) => s.id === id)
    if (!radioOnRef.current || slot === undefined) return
    if (radioHookOf(radioHooksRef.current, id) === null) {
      likeRadioHook(slot, !slot.locked)
      return
    }
    if (slot.candidate === null) return
    const r = toggleRadioHookStem(radioHooksRef.current, {
      rowId: id,
      stemId: slot.candidate.stemCID,
      rowCount: slotsRef.current.length,
      paceLevel: radioPaceLevelOf(radioSettings),
      random: Math.random
    })
    updateRadioHooks(r.state)
    radioHooksReleased(r.released)
  }
  /** Tapping an away hook's dimmed name (the phone's `back`): it comes back at the next phrase
   * start whose decision is still to come, with no calm wait. */
  function bringSlotHookBack(id: string): void {
    updateRadioHooks(bringRadioHookBack(radioHooksRef.current, id))
  }
  // --- radio's dig (@shared/radioDig; spec anointed-stems section 3) ---

  /** THE ONE WAY the dug row is written: the ref first (pickForSlot reads it), then the state. */
  function updateRadioDig(next: string | null): void {
    if (next === radioDigRef.current) return
    radioDigRef.current = next
    setRadioDig(next)
  }
  /** The row's dig toggle (track 17, the phone's `dig`): dig this row, move the dig here from
   * another, or (tapped again) stop. Radio on only; a padlocked row may be dug (it is the anchor,
   * and the anchor need not change). `dig` flashes on the row it is set on. */
  function toggleSlotDig(id: string): void {
    if (!radioOnRef.current || !slotsRef.current.some((s) => s.id === id)) return
    const next = toggleRadioDig(radioDigRef.current, id)
    updateRadioDig(next)
    if (next !== null) {
      const now = radioPlayRef.current.startBars + (radioClockRef.current?.lastPos ?? 0)
      radioFlashLogRef.current = [
        ...radioFlashLogRef.current,
        { rowId: next, word: RADIO_DIG_WORD, at: now, key: `dig@${next}@${now}` }
      ]
    }
  }
  /** The dug row's anchor now (spec 3.1): the stem the row plays, or its hook's (in or away) when
   * it has one, as radioDigAnchorOf builds it. Null with no dig, radio off, the row gone or
   * playing nothing. Read at each pick, so the dig follows the row. */
  function radioDigAnchorNow(): RadioDigAnchor | null {
    const dug = radioDigRef.current
    if (dug === null || !radioOnRef.current) return null
    const slot = slotsRef.current.find((s) => s.id === dug)
    if (slot === undefined) return null
    const h = radioHookOf(radioHooksRef.current, dug)
    const c = radioDigAnchorCandidate(
      slot.candidate,
      h === null
        ? null
        : { stemId: h.stemId, candidate: radioHookPicksRef.current.get(dug)?.candidate ?? null }
    )
    return c === null ? null : radioDigAnchorOf(dug, c)
  }

  /** A row's role now, for its words (the readout's age, the phone): the hook's state and, while
   * away, bars until its planned return, and whether it is dug. Null with no role. Off the clock's
   * refs: never in render. */
  function radioRoleNow(
    rowId: string,
    narrow: boolean
  ): {
    hook: RadioHook['state'] | null
    dig: boolean
    barsToReturn: number | null
    words: string | null
  } | null {
    const h = radioHookOf(radioHooksRef.current, rowId)
    const dig = radioDigRef.current === rowId
    if (h === null) {
      return dig
        ? {
            hook: null,
            dig,
            barsToReturn: null,
            words: radioRoleWords({ hook: null, dig, narrow })
          }
        : null
    }
    const clock = radioClockRef.current
    const lengths = [...resolvedBarLengthsRef.current.values()]
    const loopBars = lengths.length > 0 ? Math.max(...lengths) : 0
    const barsToReturn =
      clock === null
        ? null
        : radioHookBarsToReturn(h, {
            lap: clock.turnaroundLap ?? 0,
            phraseLaps: turnaroundPhraseLaps(radioCadence.turnaroundPhraseBars, loopBars),
            loopBars,
            pos: clock.lastPos
          })
    return {
      hook: h.state,
      dig,
      barsToReturn,
      words: radioRoleWords({
        hook: { state: h.state, decided: h.decided?.event ?? null, barsToReturn },
        dig,
        narrow
      })
    }
  }
  /** What the panel keeps for a hook's row (its pick, the warm return, the substitute) goes. */
  function forgetRadioHookRow(rowId: string): void {
    radioHookPicksRef.current.delete(rowId)
    radioHookWarmRef.current.delete(rowId)
    radioHookSubsRef.current.delete(rowId)
  }
  /** Hooks let go (a release, the cap, 👎): what was kept for them goes, and a landing of theirs
   * still queued is withdrawn -- an away hook's substitute stays on its row (spec 2.7). */
  function radioHooksReleased(released: readonly RadioHook[]): void {
    for (const h of released) {
      forgetRadioHookRow(h.rowId)
      if (manualChangesRef.current.get(h.rowId)?.hook !== undefined) {
        withdrawManualChange(h.rowId, 'hook-released')
      }
      // a resting row: a fresh pick (spec 2.7)
      radioRestEnds(h.rowId)
    }
  }
  /** A row radio rested that is no longer its hook's to rest (the hook let go, or gone): a fresh
   * radio pick for its kinds joins the mix as a cut at the next top (spec 2.7); with no pick, or
   * radio off, the row joins the mix again with its own stem. Nothing when the row is back in the
   * mix already (the user put it there) or radio is not resting it. */
  function radioRestEnds(rowId: string): void {
    // the arc's rests are its own: its drop ends them (or a hand: releaseIntensityRow)
    if (radioRestingRef.current.get(rowId) !== 'hook') return
    radioRestingRef.current.delete(rowId)
    const slot = slotsRef.current.find((s) => s.id === rowId)
    if (slot === undefined || previewingSlotIdsRef.current.has(rowId)) return
    const rejoin = (): void => {
      if (previewingSlotIdsRef.current.has(rowId)) return
      if (!slotsRef.current.some((s) => s.id === rowId)) return
      scheduleSyncPreviewToEngine(joinPreviewingMix(rowId))
    }
    if (!radioOnRef.current) {
      rejoin()
      return
    }
    void pickForSlot(rowId, slot.kinds, { avoidOwnStem: true }).then((pick) => {
      if (
        previewingSlotIdsRef.current.has(rowId) ||
        !slotsRef.current.some((s) => s.id === rowId) ||
        manualChangesRef.current.has(rowId) ||
        radioHookOf(radioHooksRef.current, rowId) !== null
      ) {
        return
      }
      const queued =
        pick !== null &&
        pick.candidate !== null &&
        radioOnRef.current &&
        queueManualChange(rowId, pick, true, Number.NEGATIVE_INFINITY, false, {
          kind: 'cut',
          beats: 4
        })
      if (!queued) rejoin()
    })
  }
  /** A row radio is resting, put back in the mix by hand (unmuted, or soloed): that IS its hook's
   * return, now (returnRadioHookByHand). The row still holds the hooked stem, so it plays at once
   * with the caller's push; the hook is in with a fresh stay, and a return decided or queued for it
   * is withdrawn (its warm stem let go). Nothing for a row radio is not resting. */
  function radioRestReturnsByHand(rowId: string): void {
    // A row the intensity arc rests, put back by hand: it plays at once and is the arc's no
    // longer (spec 4.2); the drop still lands for the others.
    if (radioRestingRef.current.get(rowId) === 'arc') {
      // a hook's return queued to come back with the drop (it replaced the arc's): withdrawn, the
      // row plays what it has (the hook tries again at its next phrase start)
      if (manualChangesRef.current.get(rowId)?.hook === 'return') {
        withdrawManualChange(rowId, 'hook-returned-by-hand')
      }
      // the caller puts the row in the mix and pushes
      releaseIntensityRow(rowId, false)
      console.log(`[radio-intensity] ${rowId} back by hand: it leaves the arc`)
      return
    }
    if (!radioRestingRef.current.delete(rowId)) return
    if (manualChangesRef.current.get(rowId)?.hook === 'return') {
      withdrawManualChange(rowId, 'hook-returned-by-hand')
    }
    radioHookWarmRef.current.delete(rowId)
    updateRadioHooks(
      returnRadioHookByHand(radioHooksRef.current, {
        rowId,
        paceLevel: radioPaceLevelOf(radioSettings),
        random: Math.random
      })
    )
    console.log(`[radio-hook] back on ${rowId} by hand`)
  }
  /** The pick a hook's return queues: the slot's playing stem, with its match-meter bar when the
   * slot has one for it, else unranked (commitSlotPick then leaves the meter as it is). */
  function radioHookPickOf(slot: DiscoverSlot & { candidate: DiscoverCandidate }): SlotPick {
    const bar = slot.pickBar
    return bar !== undefined && bar.candidate === slot.candidate
      ? { candidate: slot.candidate, barUsed: bar.barUsed, barRequested: bar.barRequested }
      : { candidate: slot.candidate, barUsed: null, barRequested: traitMatchBar, unranked: true }
  }
  /** 👍's hold: hooks the row's playing stem (likeRadioStem: radio on, the row unlocked and without
   * a hook; the cap releases the oldest). Radio's change or pick on the row gives way (a hook in is
   * out of radio's turnover), and the row's replace-soon goes, as the old hold took it. */
  function likeRadioHook(slot: DiscoverSlot, canHold: boolean): void {
    if (slot.candidate === null) return
    const r = likeRadioStem(radioHooksRef.current, {
      rowId: slot.id,
      stemId: slot.candidate.stemCID,
      rowCount: slotsRef.current.length,
      paceLevel: radioPaceLevelOf(radioSettings),
      random: Math.random,
      canHold
    })
    if (r.state === radioHooksRef.current) return
    updateRadioHooks(r.state)
    radioHooksReleased(r.released)
    radioHookPicksRef.current.set(slot.id, radioHookPickOf({ ...slot, candidate: slot.candidate }))
    radioSparesRef.current = radioSparesRef.current.filter((k) => k.slotId !== slot.id)
    setRadioSlotFlags((prev) =>
      prev[slot.id] === 'replace-soon' ? toggleRadioReplaceSoon(prev, slot.id) : prev
    )
    radioYieldsRow(slot.id)
  }
  /** An exit's substitute is warm and still fits: its row has the kinds it was picked for, and its
   * stem plays on no row. One that no longer fits is dropped (picked again at the next wrap). */
  function radioHookSubReady(rowId: string): boolean {
    const sub = radioHookSubsRef.current.get(rowId)
    if (sub === undefined || sub.stem === null || sub.pick?.candidate == null) return false
    const stemId = sub.pick.candidate.stemCID
    const slot = slotsRef.current.find((s) => s.id === rowId)
    const fits =
      slot !== undefined &&
      slotKindsKey(slot.kinds) === sub.kindsKey &&
      !slotsRef.current.some((s) => s.candidate?.stemCID === stemId)
    if (!fits) radioHookSubsRef.current.delete(rowId)
    return fits
  }
  /** Picks and warms an exit's substitute (prepare): radio's ordinary pick for the row's kinds,
   * off the hooked stem (avoidOwnStem) and every away hook's (pickForSlot). It yields the row to
   * any other pick for it. A failed pick is asked for again at the next wrap. */
  function armRadioHookSub(rowId: string): void {
    const slot = slotsRef.current.find((s) => s.id === rowId)
    if (slot === undefined || radioHookSubsRef.current.has(rowId)) return
    const sub: {
      pick: SlotPick | null
      stem: ResolvedCandidateStem | null
      kindsKey: string
    } = { pick: null, stem: null, kindsKey: slotKindsKey(slot.kinds) }
    radioHookSubsRef.current.set(rowId, sub)
    const gone = (): boolean => radioHookSubsRef.current.get(rowId) !== sub
    void pickForSlot(rowId, slot.kinds, { avoidOwnStem: true, yieldRow: true }).then((pick) => {
      if (gone()) return
      if (pick === null || pick.candidate === null || !radioOnRef.current) {
        radioHookSubsRef.current.delete(rowId)
        return
      }
      sub.pick = pick
      void resolveAndWarmPick(pick).then((stem) => {
        if (gone()) return
        if (stem === null) radioHookSubsRef.current.delete(rowId)
        else sub.stem = stem
      })
    })
  }
  /** Warms the hooked stem for its return (prepare): resolved, stretched, decoded. A failed warm
   * is asked for again at the next wrap. */
  function warmRadioHookStem(rowId: string): void {
    const pick = radioHookPicksRef.current.get(rowId)
    if (pick === undefined || radioHookWarmRef.current.has(rowId)) return
    radioHookWarmRef.current.set(rowId, null)
    void resolveAndWarmPick(pick).then((stem) => {
      if (radioHookWarmRef.current.get(rowId) !== null) return
      if (radioHookPicksRef.current.get(rowId) !== pick) return
      if (stem === null) radioHookWarmRef.current.delete(rowId)
      else radioHookWarmRef.current.set(rowId, stem)
    })
  }
  /** Every wrap while radio runs: a new lap in the landing window (the calm wait reads it), and,
   * with hooks set, the hook step is owed -- queued in the fold step's deferred slot (two
   * microtasks on) BEFORE the fold step and the turnaround roll, so it runs after densityTick's
   * microtask and this tick's landings and before the two that read it (spec section 10, risk 1):
   * the fold step sees a decided return as hooked, the roll counts it and keeps off an exiting
   * row. Either of those running early (the roll inline, a stem resolving) runs it first. */
  function radioHooksAtWrap(loopBars: number, lap: number): void {
    if (!radioOnRef.current) return
    radioLandingsRef.current = advanceRadioLandingWindow(
      radioLandingsRef.current,
      turnaroundPhraseLaps(radioCadence.turnaroundPhraseBars, loopBars)
    )
    if (radioHooksRef.current.hooks.length === 0) return
    radioHooksStepOwedRef.current = { loopBars, lap, landed: new Map() }
    void Promise.resolve().then(() => Promise.resolve().then(() => runOwedRadioHooksStep()))
  }
  /** The owed hook step (stepRadioHooks): events decided at the last wrap have landed (the manual
   * path landed them) and flip; the hook clock adds the lap; returns are decided on phrase starts
   * and at most one exit on a line, each queued now as a hook-marked manual change for the next
   * wrap (its stem already warm); an exit's echo throw is armed live, at once. A no-op with
   * nothing owed. */
  function runOwedRadioHooksStep(): void {
    const owed = radioHooksStepOwedRef.current
    if (owed === null) return
    radioHooksStepOwedRef.current = null
    if (!radioOnRef.current) return
    const { loopBars, lap } = owed
    const slots = slotsRef.current
    // a decided event whose landing is still waiting (its stem not ready at its line): it lands at
    // the first wrap after it is ready; the step flips it here regardless
    for (const h of radioHooksRef.current.hooks) {
      if (h.decided !== null && manualChangesRef.current.get(h.rowId)?.hook !== undefined) {
        console.log(`[radio-hook] late: ${h.decided.event} on ${h.rowId} still waiting at its line`)
      }
    }
    const live = new Set(slots.map((s) => s.id))
    for (const h of radioHooksRef.current.hooks) if (!live.has(h.rowId)) forgetRadioHookRow(h.rowId)
    let state = pruneRadioHooks(radioHooksRef.current, live)
    // a dug row that is gone (a project swap) takes the dig with it
    updateRadioDig(pruneRadioDig(radioDigRef.current, live))
    // A hook in whose stem is no longer on its row and is not on its way back there (a project
    // swap, a change no rule saw), or one with nothing to come back with: gone.
    for (const h of state.hooks) {
      if (h.decided !== null || manualChangesRef.current.get(h.rowId)?.hook !== undefined) continue
      const stale =
        !radioHookPicksRef.current.has(h.rowId) ||
        (h.state === 'in' && slots.find((s) => s.id === h.rowId)?.candidate?.stemCID !== h.stemId)
      if (stale) {
        state = releaseRadioHook(state, h.rowId).state
        forgetRadioHookRow(h.rowId)
      }
    }
    // Rows radio is resting: still its hook's (resting, or its rest landing at this wrap), and not
    // put back in the mix by hand. Any other is radio's no longer: a fresh pick (radioRestEnds).
    for (const [id, owner] of [...radioRestingRef.current]) {
      // the arc's rests are the arc's: its drop ends them
      if (owner === 'arc') continue
      const h = radioHookOf(state, id)
      const restingHere =
        h !== null &&
        (h.state === 'resting' || (h.decided?.event === 'exit' && h.decided.rest)) &&
        live.has(id) &&
        !previewingSlotIdsRef.current.has(id)
      if (!restingHere) radioRestEnds(id)
    }
    const eligible = new Set(radioEligibleSlotIds())
    // Heard in the lap after this wrap: in the mix, and not the row the arc is taking out (decided
    // at this wrap, before this step) -- a rest never leaves the bed without its drums or its bass.
    const arcOut = arcExitRef.current?.slotId ?? null
    const heard = slots.filter((s) => previewingSlotIdsRef.current.has(s.id) && s.id !== arcOut)
    const lowHeard = (kind: DiscoverSlotKind): number =>
      heard.filter((s) => s.kinds.includes(kind)).length
    const pos = radioClockRef.current?.lastPos ?? 0
    const coming = radioForecastNow(loopBars, pos).f
    const leg = densityLegRef.current
    // The intensity arc (spec 2026-10-05-radio-intensity-arc-design 5.2): the drop pulls a return
    // to it, a breakdown holds returns for it, and a row it rests stops its hook's clock. Absent
    // under any other density: the step's input is today's.
    const intensity = intensityOn() ? intensityArcRef.current : null
    const arcRests = intensity === null ? null : intensityRestsDecided(intensity)
    const r = stepRadioHooks(state, {
      loopBars,
      lap,
      phraseLaps: turnaroundPhraseLaps(radioCadence.turnaroundPhraseBars, loopBars),
      paceLevel: radioPaceLevelOf(radioSettings),
      held: false,
      ...(intensity !== null && radioIntensityHookInputs(intensity)),
      rows: slots.map((s) => ({
        id: s.id,
        stemId: s.candidate?.stemCID ?? null,
        kinds: s.kinds,
        ...(arcRests !== null && {
          arcResting: radioRestingRef.current.get(s.id) === 'arc' || arcRests.has(s.id)
        }),
        // radio's own rest silence does not make the row ineligible for its hook's return
        eligible:
          (eligible.has(s.id) ||
            (radioRestingRef.current.has(s.id) &&
              isRadioEligibleSlot({
                locked: s.locked,
                audible: true,
                hasCandidate: s.candidate !== null,
                hasSeedStem: s.seedStem !== undefined,
                rerolling: rerollingSlotIds.has(s.id)
              }))) &&
          // the arc's own landing on the row is no manual change: a hook's return due with the
          // drop replaces the arc's return there (queueManualChange)
          !(
            manualChangesRef.current.has(s.id) &&
            manualChangesRef.current.get(s.id)?.arc !== 'return'
          ),
        lastLowHeard:
          previewingSlotIdsRef.current.has(s.id) &&
          ((s.kinds.includes('drums') && lowHeard('drums') === 1) ||
            (s.kinds.includes('bass') && lowHeard('bass') === 1))
      })),
      ready: (rowId, event) =>
        event === 'exit'
          ? radioHookSubReady(rowId)
          : (radioHookWarmRef.current.get(rowId) ?? null) !== null,
      changeAtNextWrap: coming.rows > 0 || coming.arcStep !== null || coming.course,
      calmLandings: radioLandingsInPhrase(radioLandingsRef.current),
      arcThinning:
        radioDensityOf(radioSettings) === 'arc' &&
        leg !== null &&
        leg.phase === 'thinning' &&
        slots.length > leg.target,
      // resting exits (plan Task 11): the row leaves the mix at a line (the stage's `leaving`)
      // and its return joins it again -- never the last row heard (an empty preview is torn down)
      canRest: heard.length > 1,
      random: Math.random
    })
    updateRadioHooks(r.state)
    for (const p of r.prepare) {
      if (p.event === 'exit') armRadioHookSub(p.rowId)
      else {
        warmRadioHookStem(p.rowId)
        // the row is out of radio's turnover from here: its pick or change there gives way
        radioYieldsRow(p.rowId)
      }
    }
    // a prepare whose pick or warm failed is asked for again
    for (const h of r.state.hooks) {
      if (!h.prepared || h.decided !== null) continue
      if (h.state === 'in') armRadioHookSub(h.rowId)
      else warmRadioHookStem(h.rowId)
    }
    for (const d of r.decided) {
      // a resting exit takes no substitute: its entry carries the row's own pick and stem, and the
      // row leaves the mix at the line
      const rest = d.event === 'exit' && d.rest
      const sub = radioHookSubsRef.current.get(d.rowId)
      const pick = d.event === 'exit' && !rest ? sub?.pick : radioHookPicksRef.current.get(d.rowId)
      const stem = rest
        ? (resolvedStemsRef.current.get(d.rowId) ?? null)
        : d.event === 'exit'
          ? sub?.stem
          : (radioHookWarmRef.current.get(d.rowId) ?? null)
      // a return onto a resting row joins the mix again
      const joining =
        d.event === 'return' &&
        radioRestingRef.current.has(d.rowId) &&
        !previewingSlotIdsRef.current.has(d.rowId)
      // binding once queued; a row with a manual change waiting keeps it, and the event is tried
      // again at the next line (an exit) or phrase start (a return)
      const queued =
        pick != null &&
        stem != null &&
        queueManualChange(
          d.rowId,
          pick,
          joining,
          Number.NEGATIVE_INFINITY,
          false,
          // the exit's substitute lands as a cut: the echo throw is its gesture. The return's
          // arrival is drawn when it is staged, sized, with no filter in or bloom.
          d.event === 'exit' ? { kind: 'cut', beats: 4 } : null,
          { hook: d.event, stem, ...(rest && { rest: true as const }) }
        )
      if (!queued) {
        updateRadioHooks(withdrawRadioHookEvent(radioHooksRef.current, d.rowId))
        continue
      }
      if (d.event === 'return') {
        radioHookWarmRef.current.delete(d.rowId)
        console.log(`[radio-hook] back on ${d.rowId} (away ${d.awayBars} bars)`)
        continue
      }
      radioHookSubsRef.current.delete(d.rowId)
      // The echo throw, armed live now as a lead-in is: its push goes out at once and the
      // substitute's stage follows on a later tick. Dry when it cannot start a bar ahead, another
      // throw is armed, the project's throws are off, or the row has bass (d.throw null).
      let thrown = false
      const throws = normalizeSoundSettings(sound ?? appSoundDefaultsNow()).throws
      // the lap the throw ends on: this wrap's landings' lengths over the resolved ones; one not
      // known yet (its stem still resolving) makes the line unknown, and the exit dry
      const lapKnown = [...owed.landed.values()].every((b) => b !== null)
      if (d.throw !== null && throws.on && throws.level > 0 && lapKnown) {
        const lengths = new Map(resolvedBarLengthsRef.current)
        for (const [id, b] of owed.landed) if (b !== null && b > 0) lengths.set(id, b)
        const armed = armDiscoverExitThrow(radioThrowRef.current, {
          slotId: d.rowId,
          shape: d.throw,
          pos,
          loopBars: lengths.size > 0 ? Math.max(...lengths.values()) : loopBars,
          bpm: bpmRef.current
        })
        if (armed !== null) {
          radioThrowRef.current = armed
          scheduleSyncPreviewToEngine(previewingSlotIdsRef.current)
          thrown = true
        }
      }
      console.log(
        `[radio-hook] out on ${d.rowId} (${rest ? 'rest, ' : ''}${thrown && d.throw !== null ? `echo ${d.throw.beats} beats` : 'dry'}, away ${d.awayBars} bars)`
      )
    }
  }
  /** Every wrap while radio runs: the step is owed, and runs two microtasks on (the turnaround's
   * slot, radioTurnaroundAtWrap -- queued first, so it runs first there): after densityTick's
   * microtask (the arc's exit decided at this wrap) and after every landing this tick commits, so
   * it decides from the rows as the next lap will have them, as the web's foldRows does. With the
   * mode or radio off, a fold still around -- or the mode's sound on a push -- is put away. */
  function radioFoldAtWrap(loopBars: number): void {
    if (!radioOnRef.current || !radioSettings.foldMode) {
      if (
        radioFoldRef.current !== null ||
        radioFoldNowRef.current !== null ||
        radioFoldSoundedRef.current
      ) {
        resetRadioFold()
      }
      return
    }
    radioFoldStepOwedRef.current = { loopBars, landed: new Map() }
    void Promise.resolve().then(() => Promise.resolve().then(() => runOwedRadioFoldStep()))
  }
  /** The owed step: the lap starting at the wrap plays what was decided a lap ago, the machine
   * decides the next lap from the rows as the wrap's landings leave them (the arc's exiting row
   * unheard), and the engine gets that lap's cycles to take at its top -- still a lap early. A new
   * seed starts a new machine. A no-op with nothing owed: the turnaround's roll calls it first
   * (rollRadioTurnaround), so a roll that runs early (the due branch's) reads this step too. */
  function runOwedRadioFoldStep(): void {
    // the hook step decides first: a return decided for the next lap reads as hooked here
    runOwedRadioHooksStep()
    const owed = radioFoldStepOwedRef.current
    if (owed === null) return
    radioFoldStepOwedRef.current = null
    if (!radioOnRef.current || !radioSettings.foldMode) return
    radioFoldNowRef.current = radioFoldNextRef.current
    const was = radioFoldRef.current
    const state =
      was !== null && was.seed === radioSettings.foldSeed
        ? was
        : createRadioFold(radioSettings.foldSeed)
    const lengths = new Map(resolvedBarLengthsRef.current)
    for (const [id, l] of owed.landed) if (l.barLength !== null) lengths.set(id, l.barLength)
    const loopBars = lengths.size > 0 ? Math.max(...lengths.values()) : owed.loopBars
    const previewing = previewingSlotIdsRef.current
    const rows = radioFoldRowsAt(
      slotsRef.current.map((s) => ({
        id: s.id,
        stemId: s.candidate?.stemCID ?? null,
        kinds: s.kinds,
        barLength: resolvedBarLengthsRef.current.get(s.id) ?? null,
        // the step decides the NEXT lap: a hook in and not leaving, or coming back
        hooked: radioHookInRowNext(radioHooksRef.current, s.id),
        previewing: previewing.has(s.id),
        percussive: resolvedStemsRef.current.get(s.id)?.type === 'drums'
      })),
      owed.landed,
      arcExitingRowNow()
    )
    // the pace slider above 70 hurries the machine (radioCadence.foldHurry, this render's, as
    // radioSettings.fold is); none below, where the input is exactly what it always was
    const hurry = radioCadence.foldHurry
    // the intensity arc bends the fold by its target (spec 5.3); any other density, as ever
    const intensity = intensityOn() ? intensityArcRef.current : null
    const step = stepRadioFold(state, {
      rows,
      loopBars,
      bpm,
      fold:
        intensity === null
          ? radioSettings.fold
          : radioIntensityBend(
              radioSettings.fold,
              radioDramaOf(radioSettings),
              radioIntensityTarget(
                intensity,
                radioEnergyOf(radioSettings),
                radioDramaOf(radioSettings)
              )
            ),
      ...(hurry > 0 && { hurry })
    })
    radioFoldRef.current = step.state
    radioFoldNextRef.current = step
    const status = publishRadioFoldStatus(loopBars)
    if (FOLD_DEV_LOG) console.log(`${radioFoldStepLine(step, rows)} · ${status?.summary ?? ''}`)
    void window.rifffApi.engineStageCycles(radioFoldEngineRows(step), false)
    // the lap now playing has its own drift lanes
    scheduleSyncPreviewToEngine(previewingSlotIdsRef.current)
  }
  /** The readout of the lap now playing (the step that decided it ran a lap ago), for the dots
   * now and the status line and the rows' readouts on the next render. */
  function publishRadioFoldStatus(loopBars: number): ReturnType<typeof radioFoldStatus> {
    const state = radioFoldRef.current
    const now = radioFoldNowRef.current
    const status = radioFoldStatus(state, now, loopBars, radioSettings.fold, null)
    radioFoldDotsRef.current = { rows: status?.rows ?? [], laps: radioFoldMoveRef.current.laps }
    void Promise.resolve().then(() =>
      setRadioFoldView(state === null ? null : { state, step: now })
    )
    return status
  }
  /** Playback restarted (radioFoldTransportMove: playing again, a seek, a snap). The engine starts
   * a new lap clock and every folded cycle restarts from the top of the lap it restarted in
   * (CycleTable::originFor), so the machine's origins move there too (radioFoldRestartAt): its
   * realignment tops, and the dots, then count from where the engine's cycles do. `atWrap`: radio's
   * clock saw this move as a wrap, so the step it owes decides from the lap being entered -- as it
   * does while a step is already owed. */
  function restartRadioFold(atWrap: boolean): void {
    const state = radioFoldRef.current
    if (state === null) return
    const lap = atWrap || radioFoldStepOwedRef.current !== null ? state.lap : state.lap - 1
    radioFoldRef.current = radioFoldRestartAt(state, lap)
    const next = radioFoldNextRef.current
    if (next !== null) radioFoldNextRef.current = radioFoldRestartStep(next, lap)
    const now = radioFoldNowRef.current
    if (now !== null) radioFoldNowRef.current = radioFoldRestartStep(now, lap)
    publishRadioFoldStatus(previewLoopBars)
  }
  /** Fold mode in the slider's bar band (fold following pace, spec
   * 2026-10-03-radio-fold-follows-pace-design section 3, phase 2): every row takes the band's
   * mid-loop lines, the folded ones too -- a change on a row the fold holds carries the fold when
   * its stem can (radioFoldChangeCarriesNow), else cuts straight and releases it
   * (radioFoldLandNow). */
  function radioFoldBandActive(): boolean {
    return radioCadence.fold && radioCadence.barEvery !== null
  }
  /** `slotId` as the fold machine would see it with `stem` (`pick`'s) in it, as runOwedRadioFoldStep
   * builds a row (radioFoldRowsAt): heard, its kinds and hook, the stem's length and type. */
  function radioFoldIncomingRow(
    slotId: string,
    pick: SlotPick,
    stem: ResolvedCandidateStem
  ): RadioFoldRow {
    return {
      id: slotId,
      stemId: pick.candidate?.stemCID ?? null,
      kinds: slotsRef.current.find((s) => s.id === slotId)?.kinds ?? [],
      barLength: stem.barLength,
      hooked: radioHookInRowNext(radioHooksRef.current, slotId),
      audible: true,
      percussive: stem.type === 'drums'
    }
  }
  /** Whether a change bringing `pick` (`stem`) onto `slotId` carries the row's fold NOW
   * (radioFoldChangeCarries): fold's bar band, a row the fold holds in the lap playing or the
   * next, and radioFoldCanCarry against the machine's latest state. A cold stem never does. On a
   * wrap tick whose step is still owed the next lap's decision is not in yet: the stage waits for
   * it (stepRadioStage (3)) and decides again there. */
  function radioFoldChangeCarriesNow(
    slotId: string,
    pick: SlotPick,
    stem: ResolvedCandidateStem | null
  ): boolean {
    if (stem === null || !radioFoldBandActive()) return false
    return radioFoldChangeCarries(
      radioFoldRef.current,
      radioFoldNowRef.current,
      radioFoldNextRef.current,
      radioFoldIncomingRow(slotId, pick, stem),
      true
    )
  }
  /** Held companions with their carry decided now (radioFoldChangeCarriesNow); the same objects
   * where nothing changes, and the same array when no companion's changes. */
  function radioFoldCarryCompanionsNow(
    companions: readonly RadioHeldCompanion[]
  ): readonly RadioHeldCompanion[] {
    let changed = false
    const out = companions.map((k) => {
      const foldCarry = radioFoldChangeCarriesNow(k.slotId, k.pick, k.stem)
      if (foldCarry === (k.foldCarry === true)) return k
      changed = true
      return { ...k, foldCarry }
    })
    return changed ? out : companions
  }
  /** The companions that may ride a mid-loop bar line now (radioFoldBarCompanions): all of them
   * outside fold's bar band; in it, a companion on a row the fold holds rides only when its change
   * carries the fold (radioFoldChangeCarriesNow) -- one that would cut a fold straight is left
   * off the line, and its row goes back to radio. A loop-top landing takes them all. */
  function radioFoldBarCompanionsNow<
    T extends { slotId: string; pick: SlotPick; stem: ResolvedCandidateStem | null }
  >(companions: readonly T[]): readonly T[] {
    const byId = new Map(companions.map((k) => [k.slotId, k]))
    return radioFoldBarCompanions(
      companions,
      radioFoldNowRef.current,
      radioFoldNextRef.current,
      radioFoldBandActive(),
      (slotId) => {
        const k = byId.get(slotId)
        return k !== undefined && radioFoldChangeCarriesNow(slotId, k.pick, k.stem)
      }
    )
  }
  /** A change has just been COMMITTED on `slotId` -- the moment the engine plays it (a stage it
   * already swapped in, or the push this commit makes), never when it was decided, so a change
   * taken back before it lands leaves the machine as it was. Called in the same microtask as the
   * commit, which at a wrap is before that wrap's owed fold step (radioFoldAtWrap, two microtasks
   * on), so the step reads the machine as the landing left it (radioFoldLand):
   *   - `carry` (the decision that went out with the change): the machine follows the new stem,
   *     the cycle running on (radioFoldCarry; released instead, everywhere, should the fold have
   *     outgrown the stem);
   *   - otherwise a row the fold holds is released at once (radioFoldRelease) by the rule both
   *     radios share (radioFoldLandReleases): anywhere in fold's bar band; above 50
   *     (radioCadence.foldPaced) when it landed mid-loop (a loop-end own-cycle cut, spec gate 15,
   *     a Cmd change) or on a top the fold step did not anticipate -- the step for the lap it
   *     plays in still folds the row for the old stem (radioFoldStaleFor: decided after that
   *     step went out, a manual change, a new bed). That step is the next one while this wrap's
   *     step is owed, else the one playing. At 50 and below it is left to the wrap's own step,
   *     which lets the row go as it always has (exactly as before, spec decision 1).
   * Then the readout follows (the row's `7 / 16` stays, or clears). Manual changes (the wrap's
   * queue, Cmd, a new bed) land through here too, straight, as the web's swap-nows do. */
  function radioFoldLandNow(
    slotId: string,
    pick: SlotPick,
    stem: ResolvedCandidateStem | null,
    carry: boolean,
    midLoop: boolean,
    loopBars: number
  ): void {
    const m = {
      state: radioFoldRef.current,
      now: radioFoldNowRef.current,
      next: radioFoldNextRef.current
    }
    const stemId = pick.candidate?.stemCID ?? null
    // the machine's decision for the lap this landing plays in
    const landingLap = radioFoldStepOwedRef.current !== null ? m.next : m.now
    const out = radioFoldLand(m, slotId, {
      stemId: stemId ?? '',
      barLength: stem?.barLength ?? 0,
      carry: carry && stemId !== null && stem !== null && stem.barLength > 0,
      release: radioFoldLandReleases(radioCadence, {
        midLoop,
        stale: radioFoldStaleFor(landingLap, slotId, stemId)
      })
    })
    if (out === m) return
    radioFoldRef.current = out.state
    radioFoldNowRef.current = out.now
    radioFoldNextRef.current = out.next
    publishRadioFoldStatus(loopBars)
  }
  /** A Cmd change, committed at once while radio runs: a straight cut mid-loop (its stem still
   * resolving), so the fold machine follows as for the web's swap-now at a bar line
   * (radioFoldLandNow; at 50 and below nothing). */
  function radioFoldCmdLandNow(slotId: string, pick: SlotPick): void {
    if (radioOnRef.current) radioFoldLandNow(slotId, pick, null, false, true, previewLoopBars)
  }
  /** A Cmd change, committed at once while radio runs: the fold follows (radioFoldCmdLandNow),
   * radio gives the row up (radioYieldsRow), and a row the intensity arc rests is the user's now:
   * it leaves the arc and plays at once, with the stem just committed (spec 4.2). */
  function radioCmdLanded(id: string, pick: SlotPick): void {
    radioFoldCmdLandNow(id, pick)
    radioYieldsRow(id)
    if (radioRestingRef.current.get(id) === 'arc') releaseIntensityRow(id)
  }
  /** Fold mode put away at once: every row full length from the next block, no drift, no lean. */
  function resetRadioFold(): void {
    const had =
      radioFoldRef.current !== null ||
      radioFoldNowRef.current !== null ||
      radioFoldSoundedRef.current
    radioFoldRef.current = null
    radioFoldNowRef.current = null
    radioFoldNextRef.current = null
    radioFoldStepOwedRef.current = null
    radioFoldSoundedRef.current = false
    radioFoldDotsRef.current = { rows: [], laps: radioFoldMoveRef.current.laps }
    void Promise.resolve().then(() => setRadioFoldView(null))
    void window.rifffApi.engineStageCycles([], true)
    if (had) scheduleSyncPreviewToEngine(previewingSlotIdsRef.current)
  }
  /** A change's interval: the cadence's window (radioCadenceOf: fold mode's 8-32 bars at fast and
   * below, the slider's above), moved to a realignment top when one is near while fold mode is on
   * (radioFoldIntervalBars, with radioCadence.foldPreferWaitLaps: 2 laps at fast and below, none
   * above 70); the pace window otherwise. Counted from `boundaryBars`, the bar
   * restartRadioInterval counts it from (the fold's realignment tops are counted from the lap's
   * top, so a sub-loop grid restart mid-lap shifts them). A landing at a wrap restarts it before
   * that wrap's step has run: the machine's tops are then a lap behind (radioFoldIntervalBars'
   * stepOwed). */
  function radioNextIntervalBars(loopBars: number, boundaryBars: number): number {
    const drawn = nextRadioIntervalBarsInWindow(radioCadence.window)
    return radioSettings.foldMode
      ? radioFoldIntervalBars(
          radioFoldRef.current,
          drawn,
          loopBars,
          boundaryBars,
          radioFoldStepOwedRef.current !== null,
          radioCadence.foldPreferWaitLaps
        )
      : drawn
  }
  // The mode switched while radio runs. The running interval was drawn from the other window (the
  // pace's, or fold mode's 8-32 bars), so it is drawn again from the one that now applies
  // (radioCadence.window), counted from the last tick, as the web's foldModeInterval does: nothing
  // else of radio's moves. Going off, every row goes back to full length at the next loop top (an
  // empty table staged for it); the drift, the low-pass and the lean leave with the wrap's push
  // (radioFoldAtWrap).
  const radioFoldModeWasRef = useRef(radioSettings.foldMode)
  useEffect(() => {
    if (radioFoldModeWasRef.current === radioSettings.foldMode) return
    radioFoldModeWasRef.current = radioSettings.foldMode
    const clock = radioClockRef.current
    if (radioOnRef.current && clock !== null) {
      const lengths = resolvedBarLengthsRef.current
      const loopBars = lengths.size > 0 ? Math.max(...lengths.values()) : 0
      const at = clock.lastPos
      radioClockRef.current = restartRadioInterval(
        clock,
        radioNextIntervalBars(loopBars, at),
        at,
        at
      )
    }
    if (radioSettings.foldMode) return
    radioFoldStepOwedRef.current = null
    // the readout goes with the mode, at once (the folds themselves unfold at the next top)
    radioFoldDotsRef.current = { rows: [], laps: radioFoldMoveRef.current.laps }
    void Promise.resolve().then(() => setRadioFoldView(null))
    if (radioFoldRef.current === null) return
    radioFoldRef.current = null
    radioFoldNextRef.current = null
    void window.rifffApi.engineStageCycles([], false)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only the switch itself restarts the interval; radioNextIntervalBars reads this render's settings
  }, [radioSettings.foldMode])
  // The pace slider released while radio runs (spec 2026-10-03-radio-pace-slider-design section
  // 4). NOT a course change: the clock alone moves (radioClockForPace) -- an interval now longer
  // than the new window is redrawn, and the change phrase is re-anchored on the turnaround's.
  // The pick, a held or staged change, the turnaround, fold and the transport are all left alone.
  // Declared BEFORE the clock effect on purpose: React runs a commit's effects in order, so the
  // tick that first sees the new cadence already has the re-anchored phrase.
  const radioPaceLevelWasRef = useRef(radioSettings.paceLevel)
  // The change phrase, turnaround phrase and loop the clock last ticked under. When one moves
  // without a pace move -- fold mode switched (its cadence has the base phrase), the `phrase` chip
  // changed, the loop grew or shrank -- and the two phrases differ, the clock effect re-anchors
  // the change phrase on the turnaround's before its tick (radioPhraseNeedsReanchor). Null until
  // radio's first tick, and again at every start (a fresh clock is anchored already).
  const radioPhraseAnchorRef = useRef<RadioPhraseAnchor | null>(null)
  useEffect(() => {
    if (radioPaceLevelWasRef.current === radioSettings.paceLevel) return
    radioPaceLevelWasRef.current = radioSettings.paceLevel
    const clock = radioClockRef.current
    if (!radioOnRef.current || clock === null) return
    const lengths = resolvedBarLengthsRef.current
    const loopBars = lengths.size > 0 ? Math.max(...lengths.values()) : 0
    radioClockRef.current = radioClockForPace(clock, radioCadence, loopBars)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only the level itself moves the clock; radioCadence is this render's
  }, [radioSettings.paceLevel])
  /** Radio off or a course change: the armed turnaround comes off, and the next phrase end
   * starts fresh. Wherever drop-outs were cleared (clearRadioGesture outside the clock). */
  function clearRadioTurnaround(): void {
    radioTurnaroundMemoryRef.current = null
    // the payoff owed to it goes with it (sized builds)
    radioPayoffRef.current = null
    radioTurnaroundRollPendingRef.current = false
    radioTurnaroundRollRef.current = null
    // a turn waiting goes too (radio off, a course change)
    radioTurnPendingRef.current = null
    setRadioTurnShown(null)
    if (!radioOnRef.current) setRadioTurnCan(null)
    if (radioTurnaroundRef.current === null) return
    radioTurnaroundRef.current = null
    scheduleSyncPreviewToEngine(previewingSlotIdsRef.current)
  }
  /** Takes the armed throw's curve off the preview: a push now, or -- while a staged swap
   * is pending, which an ordinary push would withdraw -- once it is gone. Whatever happens
   * to the stage puts a project on the wire anyway (its landing's commit, a cancel's
   * re-push), built without the throw; the owed push is the backstop for a stage that
   * just goes away (a build that bailed out). The echo itself rings on: the engine's dub
   * bus keeps its tail whatever the project says. */
  function clearRadioThrowCurve(): void {
    if (radioStageRef.current !== null) {
      radioThrowClearOwedRef.current = true
      return
    }
    radioThrowClearOwedRef.current = false
    scheduleSyncPreviewToEngine(previewingSlotIdsRef.current)
  }
  /** Starts the throws afresh (radio on, radio off, the panel closing), clearing an armed
   * throw's curve when `clear` says to. */
  function resetRadioThrows(clear: boolean): void {
    const hadArmed = radioThrowRef.current.armed !== null
    radioThrowRef.current = initialDiscoverThrowState()
    if (clear && hadArmed) clearRadioThrowCurve()
  }
  /** One radio tick for the dub throws (native radio sound plan, Task 11). The rules are
   * the web radio's (stepThrows, through @shared/discoverThrows stepDiscoverThrows, which
   * unrolls the looping playhead into bars played and picks where a throw may start): now
   * and then one heard row that is neither drums nor bass opens its send into the echo for
   * a beat or two -- never while stopped, never over a hole, riser or drop-out, at the
   * project's rate (throwEveryBars). One near an armed phrase turnaround is AIMED at its wrap
   * (2026-10-03): it ends on the one, never on a row the turnaround drops, and the turnaround
   * does not take it back (throwYieldsToLeadIn). The armed throw goes out as a curve on the next push,
   * at least a bar ahead; once it has closed its curve is cleared, long before the lap
   * comes back round to it.
   *
   * Nothing is armed while a staged swap is pending, or a change waits to be staged:
   * arming pushes, and an ordinary push withdraws the stage (a due throw just waits). A
   * stage built while a throw is armed carries it when it must (buildAndPushPreview).
   *
   * With the project's throws off (or at level 0, which sends nothing) an armed throw is
   * cleared and the rule starts again from scratch when they come back on. */
  function radioThrowTick(pos: number, loopBars: number): void {
    // An owed clear, once the stage is gone -- unless a push is already on its way, which is
    // built without the throw and pays it (buildAndPushPreview).
    if (
      radioThrowClearOwedRef.current &&
      radioStageRef.current === null &&
      liveSyncInFlightRef.current === 0 &&
      pendingSyncRafRef.current === null
    )
      clearRadioThrowCurve()
    const throws = normalizeSoundSettings(sound ?? appSoundDefaultsNow()).throws
    if (!throws.on || !(throws.level > 0)) {
      resetRadioThrows(true)
      return
    }
    // the intensity arc's drop throw, owed until it can be armed (a no-op with none owed): before
    // the step, so it has the lap first; it arms at the throw clock's last position (lastPos),
    // the one its elapsed bars count to, which the step below then carries on from
    intensityDropThrowTick()
    const step = stepDiscoverThrows(
      radioThrowRef.current,
      {
        pos,
        loopBars,
        bpm: bpmRef.current,
        playing,
        // Nor while a change waits for the loop top (radio's held one, or manual ones):
        // it is about to be staged, and a throw's push would only hold that up.
        canArm:
          radioStageRef.current === null &&
          radioLedChangeRef.current === null &&
          manualChangesRef.current.size === 0 &&
          previewLoadedRef.current &&
          !radioThrowClearOwedRef.current,
        // A turnaround has the lap, as a hole, a riser or a drop-out does.
        leadingArmed:
          radioTurnaroundRef.current !== null ||
          radioGestureRef.current.some(
            (g) => g.kind === 'drop-out' || radioGestureLeadsChange(g.kind)
          ),
        // ...and a throw near it is AIMED at its wrap (it ends on the one) or, with a riser gap,
        // at where the gap starts (its echoes ring through the silence) -- discoverThrowAim:
        // never on a row silent before that point, nor on a drop-out's or hole's row sharing the
        // lap (an arc exit). The turnaround is the one transition a throw can aim at here: a
        // decided change is staged, and arming a throw pushes, which would withdraw the stage
        // (canArm above).
        ...(discoverThrowAim(
          radioTurnaroundRef.current?.plan,
          radioGestureRef.current,
          loopBars - pos,
          previewingSlotIdsRef.current
        ) ?? {}),
        // ...or, in the breakdown's last phrase, at the intensity arc's drop (or its gap: spec
        // 5.5). Absent under any other density.
        ...intensityThrowDrop(pos, loopBars),
        rows: slotsRef.current.map((s) => ({
          slot: s.id,
          kinds: s.kinds,
          audible: previewingSlotIdsRef.current.has(s.id)
        })),
        everyBars: throwEveryBars(throws.rate)
      },
      Math.random
    )
    radioThrowRef.current = step.state
    if (step.change === 'armed') scheduleSyncPreviewToEngine(previewingSlotIdsRef.current)
    else if (step.change === 'ended') clearRadioThrowCurve()
  }
  /** The readout's clock and logs back to nothing: radio starting or stopping. */
  function resetRadioReadout(): void {
    radioPlayRef.current = { lap: 0, startBars: 0 }
    radioRowSinceRef.current = new Map()
    radioFlashLogRef.current = []
    radioFlashSeenRef.current = new Set()
    setRadioReadoutNow(null)
  }
  /** THE GESTURE FLASH (spec 2026-10-03-radio-readout-design section 1). Each gesture armed into
   * the preview project goes in the log once, with the bar it starts SOUNDING at on the readout's
   * clock (radioPlayRef: bars played): a lead-in (hole, riser) over the beats before the wrap of
   * the lap it is armed in; an arrival (filter in, bloom, duck) from the top of the lap it is armed
   * at; a turnaround's or a turn's move, on each row it plays on, over its last beats; a throw from
   * its own start. Read off what is armed, every tick, rather than at each of the places that arm
   * one. A word not sounding yet whose gesture has been taken back goes with it. */
  function radioFlashTick(pos: number, loopBars: number): void {
    const lapStart = radioPlayRef.current.startBars
    const now = lapStart + pos
    const seen = radioFlashSeenRef.current
    const live = new Set<string>()
    const log = [...radioFlashLogRef.current]
    for (const g of radioGestureRef.current) {
      live.add(g.armId)
      const word = radioGestureFlashWord(g.kind)
      if (seen.has(g.armId) || word === null) continue
      const leads = g.kind !== 'drop-out' && radioGestureLeadsChange(g.kind)
      log.push({
        rowId: g.slotId,
        word,
        at: lapStart + (leads ? loopBars - g.beats / 4 : 0),
        key: g.armId
      })
    }
    const ta = radioTurnaroundRef.current
    if (ta !== null) {
      live.add(ta.armId)
      if (!seen.has(ta.armId)) {
        // each row its moves' words from where each starts, and `gap` where the gap starts
        for (const f of turnaroundFlashes(ta.plan)) {
          log.push({
            rowId: f.rowId,
            word: f.word,
            at: lapStart + loopBars - f.beats / 4,
            key: ta.armId
          })
        }
      }
    }
    const throws = radioThrowRef.current
    if (throws.armed !== null) {
      const key = `throw@${throws.armed.startBars}`
      live.add(key)
      if (!seen.has(key)) {
        log.push({
          rowId: throws.armed.slotId,
          word: RADIO_THROW_WORD,
          at: now + (throws.armed.startBars - throws.elapsedBars),
          key
        })
      }
    }
    // A hook's landing: `hook out` / `hook back` on its row from the top it lands on.
    for (const [rowId, m] of manualChangesRef.current) {
      if (m.hook === undefined) continue
      const key = `hook-${m.hook}@${rowId}@${m.pick.candidate?.stemCID ?? ''}`
      live.add(key)
      if (seen.has(key)) continue
      log.push({
        rowId,
        word: m.hook === 'exit' ? RADIO_HOOK_OUT_WORD : RADIO_HOOK_BACK_WORD,
        at: lapStart + loopBars,
        key
      })
    }
    // The intensity arc's event at the coming top: `breakdown` on the rows it rests, `drop` on the
    // rows coming back (every heard row for a quick drop), `build` on every row at a pressed
    // build's top. Keyed by the decision, so a take-back drops them.
    for (const f of intensityFlashesNow()) {
      live.add(f.key)
      if (seen.has(f.key)) continue
      log.push({ ...f, at: lapStart + loopBars })
    }
    radioFlashLogRef.current = pruneRadioFlashes(log, now, 1, live)
    radioFlashSeenRef.current = live
  }
  /** What the readout says now, from radio's refs (the clock tick's microtask only):
   * `barsUntilChange` is the rows' own wait (radioChangeWait). `next` is whatever lands first
   * (@shared/radioNextLanding): the arc's step, a course change, radio's change or a queued one. */
  function radioReadoutFrom(
    pos: number,
    loopBars: number,
    barsUntilChange: number | null
  ): RadioReadout {
    const led = radioLedChangeRef.current
    const pending = radioPendingRef.current
    const rows = slotsRef.current
    // a held change lands with its arrival, or the lead-in armed on its row, or as a cut
    const lead =
      led === null
        ? undefined
        : radioGestureRef.current.find(
            (g) =>
              g.slotId === led.slotId && g.kind !== 'drop-out' && radioGestureLeadsChange(g.kind)
          )
    const leadKind = lead !== undefined && lead.kind !== 'drop-out' ? lead.kind : null
    const exit = arcExitRef.current
    const intensity = intensityOn() ? intensityArcRef.current : null
    // the intensity arc adds and strips rows by the density arc's paths: read them as it does,
    // with no leg (its steps are the machine's, decided a lap ahead)
    const arcOn = radioDensityOf(radioSettings) === 'arc' || intensity !== null
    const landingNext = radioNextLanding({
      pos,
      loopBars,
      course: radioCourseChangeRef.current?.map((c) => c.slotId) ?? null,
      // with: the rows riding radio's change (the pace slider's rows per change)
      led:
        led === null
          ? null
          : {
              rowId: led.slotId,
              kind: led.arrival?.kind ?? leadKind ?? 'cut',
              atBars: led.atBars,
              with: radioStagedCompanions(led).map((k) => k.slotId)
            },
      pending:
        pending === null
          ? null
          : {
              rowId: pending.slotId,
              barsUntil: barsUntilChange,
              // as its landing will take them: fold's bar band leaves a companion that would cut
              // a held row's fold straight off a mid-loop line (radioPendingRidersAt)
              with: radioPendingRidersAt(
                pending,
                radioLandsMidLoop(pos, barsUntilChange, loopBars)
              ).map((k) => k.slotId)
            },
      manual: [...manualChangesRef.current].map(([rowId, m]) => ({
        rowId,
        kind: m.arrival?.kind ?? null,
        ready: m.stem !== null,
        // a hook's own landing reads as one (next: row 2 → hook back)
        ...(m.hook !== undefined && {
          hook: m.hook === 'exit' ? ('out' as const) : ('back' as const)
        })
      })),
      arc: !arcOn
        ? null
        : {
            adding: arcAddingRef.current && { rowId: arcAddingRef.current.slotId },
            exit: exit && {
              rowId: exit.slotId,
              phase: exit.phase,
              thisLap: exit.lap === arcLapRef.current,
              heldBack: arcExitHeldBack(),
              heard: previewingSlotIdsRef.current.has(exit.slotId)
            },
            exitBeats: ARC_EXIT_BEATS,
            leg: intensity !== null ? null : densityLegRef.current,
            count: rows.length,
            canAdd: nextArcKind(rows.map((r) => r.kinds)) !== null,
            removal: arcAddingRef.current === null && exit === null ? arcRemovalCandidate() : null
          }
    })
    // the arc's breakdown or drop at the coming top, unless something lands before it
    const nextChange =
      intensity === null
        ? landingNext
        : intensityNextChange(
            intensity,
            landingNext,
            (id) => manualChangesRef.current.get(id)?.arc,
            pos,
            loopBars
          )
    const turnWaiting = radioTurnPendingRef.current
    const armed = radioTurnaroundRef.current
    const lap = radioPlayRef.current.lap
    const now = radioPlayRef.current.startBars + pos
    const readout = radioReadout({
      bars: radioReadoutBars(
        radioClockRef.current?.turnaroundLap,
        pos,
        loopBars,
        radioCadence.turnaroundPhraseBars
      ),
      nextChange,
      armedTurnaround:
        turnWaiting !== null
          ? { move: turnWaiting.move ?? null, isTurn: true }
          : armed !== null
            ? {
                move: armed.plan.move,
                isTurn: armed.turn !== null,
                parts: turnaroundPlanMoves(armed.plan),
                gap: (armed.plan.gapBeats ?? 0) > 0
              }
            : null,
      arc:
        intensity !== null
          ? radioReadoutIntensityArc(
              intensity,
              rows.length,
              radioIntensityDropInBars(intensity, {
                lap: radioClockRef.current?.turnaroundLap ?? 0,
                phraseLaps: turnaroundPhraseLaps(radioCadence.turnaroundPhraseBars, loopBars),
                loopBars,
                pos
              })
            )
          : radioReadoutArc(
              densityLegRef.current,
              rows.length,
              radioDensityOf(radioSettings) === 'arc'
            ),
      rows: rows.map((s) => ({
        rowId: s.id,
        kinds: s.kinds,
        traits: s.candidate?.traitPercentiles ?? null,
        author: s.candidate?.creatorUserName ?? null,
        laps: lap - (radioRowSinceRef.current.get(s.id) ?? 0) + 1,
        flash: radioFlashShown(radioFlashLogRef.current, s.id, now, 1)
      }))
    })
    // a row's role (its hook) after its age: `3 laps · hook · back in 16 bars`
    return {
      ...readout,
      rows: readout.rows.map((r) => {
        // a row the breakdown rests: `rests till the drop`
        const words =
          radioRestingRef.current.get(r.rowId) === 'arc'
            ? RADIO_ARC_REST_WORD
            : (radioRoleNow(r.rowId, false)?.words ?? null)
        return words === null ? r : { ...r, age: r.age === '' ? words : `${r.age} · ${words}` }
      })
    }
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
    // A COMPANION's row padlocked or muted (or removed) after the decision: it is stopped too --
    // a padlock means never. It leaves the held change and any stage carrying it is withdrawn;
    // the next tick re-stages radio's change without it (re-aimed if its bar is now too close).
    // When the engine already took that stage (its ack won), the applied marker follows the
    // held change, and the landing leaves the row out and pushes its truth back.
    const heldNow = radioLedChangeRef.current
    if (heldNow !== null && heldNow.companions !== undefined && heldNow.companions.length > 0) {
      const kept = radioHeldCompanionsKept(heldNow.companions, radioEligibleSlotIds())
      if (kept !== heldNow.companions) {
        const next = { ...heldNow, companions: [...kept] }
        if (radioStageAppliedLedRef.current === heldNow) radioStageAppliedLedRef.current = next
        setRadioLedChange(next)
        if (staged !== null && staged.ledSlotId !== null) {
          cancelStagedSwap('companion-no-longer-eligible')
          return
        }
      }
    }

    // Sized builds: the payoff owed to this lap's turnaround (stepRadioPayoff), before (2) and
    // with its gates. Nothing is ever owed with sized builds off.
    if (stepRadioPayoff(due, pos, loopBars)) return

    // TEMP (2026-09-29): which gate is holding the swap, so a paste says
    // why a change was staged late. Remove with radioTrace.ts.
    {
      const pending = radioPendingRef.current
      const clock = radioClockRef.current
      const led = radioLedChangeRef.current
      // The first armed gesture still playing, which is what holds (2) -- below the bar band. In
      // it (80+) a playing gesture holds (2) only when it is not spent by the landing bar, which
      // is decided below; so there it is not a gate here, only a note on the line
      // (`+gesture:<kind>`): a 'decide' with that note decides early only if the gesture is
      // spent by the landing bar, and otherwise the change goes down the due branch (`due-cut`).
      const playingGesture =
        radioGestureRef.current.find((g) => !radioArrivalGestureSpent(g, pos, loopBars)) ?? null
      const gesture = radioCadence.barEvery === null ? playingGesture : null
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
                                  radioCadence.phraseBars
                                ) ||
                                radioChangeLandsAtBar(
                                  clock,
                                  pos,
                                  loopBars,
                                  gridBars,
                                  radioCadence.phraseBars
                                ) !== null
                              ? 'decide'
                              : `not-this-lap(interval ${clock.intervalBars} elapsed ${clock.barsElapsed.toFixed(2)})`
      radioTraceStageGate(
        radioCadence.barEvery !== null && playingGesture !== null
          ? `${gate}+gesture:${playingGesture.kind}`
          : gate,
        pos
      )
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
      // Not on the tick whose phrase turnaround is still to be rolled (radioTurnaroundAtWrap).
      turnaroundGateNow() !== 'wait' &&
      // EVERY armed gesture spent -- true of an empty list, which is the
      // old "nothing armed". A leading gesture is never spent. In the pace
      // slider's bar band, spent BY THE BAR the change lands on is enough
      // (checked below, once that bar is known).
      (radioCadence.barEvery !== null || gesturesSpentAt(pos, loopBars))
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
        radioChangeDueAtNextWrap(clock, pos, loopBars, gridBars, radioCadence.phraseBars)
      const landsAtBar =
        clock !== null && !dueAtWrap
          ? radioChangeLandsAtBar(clock, pos, loopBars, gridBars, radioCadence.phraseBars)
          : null
      // Where a mid-loop cut would be staged (radioBarLandingAim: a beat ahead at least, in the
      // bar band), and whether the gestures playing now are done by then. At 94+ a loop-top
      // landing's one-bar arrival (a filter in, a bloom, a duck) plays through bar 1, the very
      // line the next change comes due on: waiting for it to be spent NOW kept every such change
      // undecided until the due branch, which sent it as an immediate load-project, late, after
      // every arrival. An arrival curve holds its resting value once spent (radioArrivalGestureSpent),
      // and a stage at a bar replaces the live project there, so a stage landing after the curve
      // ends drops nothing that is still moving. A leading gesture is never spent, so a lap
      // closing on a hole or a riser still decides nothing early. The wrap keeps its old rule.
      const barAim =
        landsAtBar !== null
          ? radioBarLandingAim(
              landsAtBar,
              pos,
              gridBars,
              loopBars,
              radioCadence.barEvery !== null ? RADIO_BAR_STAGE_LEAD_BARS : 0
            )
          : undefined
      const gesturesDone =
        gesturesSpentAt(pos, loopBars) ||
        (radioCadence.barEvery !== null &&
          barAim !== undefined &&
          gesturesSpentAt(barAim, loopBars))
      if (
        gesturesDone &&
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
        // In the pace slider's bar band (80+) a change landing mid-loop is a cut
        // (radioCadenceTransition): an arrival would be held to the top and a lead-in needs the
        // lap before a wrap, and either would give the pace back. A loop-top landing keeps its
        // draw. Below the band this is the draw, as before.
        //
        // A turnaround armed for this lap ends on the wrap this change waits for: it is the
        // change's lead-in, so the change keeps only an arrival (spec section 3).
        //
        // Sized builds: the draw is sized to the change (spec 4.3): this row and its riding
        // companions, with whatever else lands at the top (radioChangeSizeNow). Undefined off.
        const size = radioChangeSizeNow(
          [pending.slotId, ...radioPendingCompanionsNow(pending).map((k) => k.slotId)],
          loopBars,
          pos
        )
        const drawnTransition = radioCadenceTransition(
          radioCadence,
          pickTransition(
            radioSettings.transitions,
            changing?.kinds ?? [],
            Math.random,
            size === undefined ? undefined : { size }
          ),
          landsAtBar === null
        )
        const transition =
          turnaroundGateNow() === 'arrival'
            ? radioTransitionUnderTurnaround(drawnTransition)
            : drawnTransition
        const beats = radioGestureBeats(transition, pickDropOutBeats, size)
        // The rows riding this change, decided with it: the ones the grid above saw, ready. A cut
        // aimed at a mid-loop bar in fold's bar band leaves a companion on a row the fold holds
        // off it unless its change carries the fold (radioFoldBarCompanionsNow): its row goes back
        // to radio. Each one's carry, and radio's own (foldCarry), are decided here and again at
        // the stage, once the wrap's fold step is in (stepRadioStage (3)).
        const companionsAll = radioHeldCompanionsFrom(pending)
        const atBar = transition === 'cut' && landsAtBar !== null && barAim !== undefined
        const companions = [
          ...radioFoldCarryCompanionsNow(
            atBar ? radioFoldBarCompanionsNow(companionsAll) : companionsAll
          )
        ]
        const foldCarry = radioFoldChangeCarriesNow(pending.slotId, pending.pick, pending.stem)
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
              lapsLeft: 1,
              armId: newArmId()
            }
          ]
          setRadioLedChange({
            slotId: pending.slotId,
            pick: pending.pick,
            stem: pending.stem,
            early: true,
            companions,
            foldCarry
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
          //
          // In the bar band the bar is kept only while a stage can still reach it
          // (radioBarLandingAim): at a line every bar, a pick whose stem resolves in the last
          // beat before one is the ordinary case, and a stage arriving after its bar is applied
          // at once by the engine, late, mid-bar. So it is aimed at the next line instead (or
          // the top, still a cut), and its interval counts from there when it lands. Below the
          // band the bar is kept as named, exactly as before.
          setRadioLedChange({
            slotId: pending.slotId,
            pick: pending.pick,
            stem: pending.stem,
            early: true,
            arrival: transition === 'cut' ? undefined : { kind: transition, beats },
            atBars: transition === 'cut' && landsAtBar !== null ? barAim : undefined,
            companions,
            foldCarry
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
    // Nor on the wrap tick whose fold step is still owed (radioFoldAtWrap): a stage for the next
    // top carries that step's drift and cycle rows. Staged a tick later, still a lap early.
    if (radioFoldStepOwedRef.current !== null) return
    //
    // WHAT goes out is radio's held change and every manual change waiting
    // for the loop top, as ONE stage (mergeStageChanges): the engine holds
    // one staged project at a time, and they all land at the same wrap.
    // With the manual queue empty every line below reduces to the single
    // held change this always staged.
    let led = radioLedChangeRef.current
    const manual = manualChangesRef.current
    // The engine has ALREADY swapped a stage in and the wrap tick has not
    // landed it yet -- see radioStageAppliedLedRef and
    // radioStageAppliedManualRef. Nothing is staged in that window: a
    // stage sent now would be aimed at the NEXT wrap, while the landing
    // branch commits everything waiting at this one.
    if (led !== null && led === radioStageAppliedLedRef.current) return
    if (appliedManualStillWaiting()) return
    // A held mid-loop bar, checked again while no stage carries it: the lead was checked when it
    // was decided, but a push in flight holds the stage back (the gate below), a re-stage after
    // an overtaking load-project comes later still, and the loop may have changed under it (a
    // row turned over, shrinking it, or the change would now shorten it). Too close, past the
    // loop's end, or with no mid-loop line left for it at all (its grid is now the whole loop):
    // re-aimed at the next line far enough ahead, or the top (radioBarLandingAim), and written
    // back before anything is staged -- the stage and the landing branch read the same number. A
    // bar merely off a grid that has changed (a pace move) is kept, as a decided change is (spec
    // section 4). Below the bar band the lead is 0, so only a bar the loop no longer has moves.
    //
    // Fold mode in the bar band (phase 2): this runs only once the wrap's owed fold step is in
    // (the gate just above), so it reads the fold's decision for the next lap. A change on a row
    // the fold holds lands where it was aimed, as any change does: its carry (foldCarry) and each
    // companion's are decided again here against the machine as it is now -- the last step before
    // the landing, a fold it took or let go since the decision included -- and written back with
    // the stage, so the stage's naming and the landing's re-point read one decision. A companion
    // on a held row that would cut its fold straight is left off a mid-loop line
    // (radioFoldBarCompanionsNow); a change moved to the top keeps them all.
    if (led !== null && radioStageRef.current === null) {
      let atBars = led.atBars
      let companions = led.companions
      if (led.atBars !== undefined) {
        const lead = radioCadence.barEvery !== null ? RADIO_BAR_STAGE_LEAD_BARS : 0
        // Every row the stage will carry, companions included (radioChangeLengths).
        const lengths = radioChangeLengths(
          [
            { slotId: led.slotId, incomingBars: led.stem?.barLength ?? null },
            ...radioFoldBarCompanionsNow(radioStagedCompanions(led)).map((k) => ({
              slotId: k.slotId,
              incomingBars: k.stem.barLength
            }))
          ],
          resolvedBarLengthsRef.current
        )
        const grid = radioPaceGridBars(
          radioCadence.barEvery,
          radioSettings.loopEndOverBars,
          loopBars,
          lengths.outgoingBars,
          lengths.incomingBars,
          lengths.loopBarsAfter
        )
        atBars =
          led.atBars - pos < lead || led.atBars >= loopBars || grid >= loopBars
            ? radioBarReaim(led.atBars, pos, grid, loopBars, lead, false)
            : led.atBars
        if (atBars !== undefined && companions !== undefined) {
          companions = [...radioFoldBarCompanionsNow(companions)]
          if (companions.length === led.companions?.length) companions = led.companions
        }
      }
      if (companions !== undefined) {
        const carried = radioFoldCarryCompanionsNow(companions)
        if (carried !== companions) companions = [...carried]
      }
      const foldCarry = radioFoldChangeCarriesNow(led.slotId, led.pick, led.stem)
      if (
        atBars !== led.atBars ||
        companions !== led.companions ||
        foldCarry !== (led.foldCarry === true)
      ) {
        led = { ...led, atBars, companions, foldCarry }
        setRadioLedChange(led)
      }
    }
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
      // A draw waits out the tick whose phrase turnaround is still to be rolled
      // (radioTurnaroundAtWrap): staged a tick later, still a lap early.
      if (undrawn.length > 0 && turnaroundGateNow() === 'wait') return
      if (undrawn.length > 0) {
        // Sized builds: every row landing at this top draws at the size of all that lands there
        // (spec 4.3). Undefined off: today's draws.
        const size = radioChangeSizeNow(
          undrawn.map(([slotId]) => slotId),
          loopBars,
          pos
        )
        const drawn = drawManualTransitions(
          undrawn.map(([slotId, m]) => ({
            slotId,
            kinds: slotsRef.current.find((s) => s.id === slotId)?.kinds ?? [],
            // A joining row has no outgoing stem for a hole or a riser to
            // play on. It takes a cut, and leaves the lap's one leading
            // gesture for a row that can use it.
            canLead: !m.joining,
            ...(size !== undefined && { size }),
            // a hook coming back: no filter in or bloom (it returns whole, as the drop)
            ...(m.hook === 'return' && { hookReturn: true })
          })),
          {
            pick: (kinds, row) =>
              pickTransition(
                radioSettings.transitions,
                kinds,
                Math.random,
                row.size === undefined && row.hookReturn !== true
                  ? undefined
                  : {
                      ...(row.size !== undefined && { size: row.size }),
                      ...(row.hookReturn === true && { hookReturn: true })
                    }
              ),
            dropOutBeats: pickDropOutBeats,
            // A hole, a riser or a drop-out -- radio's own or an earlier
            // manual one -- or this lap's turnaround, which is the lap's
            // lead-in. At most one leading gesture per lap.
            leadingArmed:
              turnaroundGateNow() === 'arrival' ||
              radioGestureRef.current.some(
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
              lapsLeft: 1,
              armId: newArmId()
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
    // A hook's resting exit changes no stem: its row leaves the staged mix (plan Task 11).
    const leaving: string[] = []
    if (stagedManual !== null) {
      for (const [slotId, m] of stagedManual) {
        if (m.stem !== null) {
          if (m.rest === true) leaving.push(slotId)
          else readyManual.set(slotId, { stem: m.stem, joining: m.joining, arrival: m.arrival })
          stagedEntries.set(slotId, m)
        }
      }
    }
    // Radio's companions ride inside its change, as cuts: they land with it or are taken back
    // with it, and a manual change on one's row wins that row (mergeStageChanges). The stage's
    // slotIds below are the merged changes, so they include them.
    const merged = mergeStageChanges(
      readyLed !== null
        ? {
            slotId: readyLed.slotId,
            stem: readyLed.stem,
            arrival: readyLed.arrival ?? null,
            companions: radioStagedCompanions(readyLed).map((k) => ({
              slotId: k.slotId,
              stem: k.stem
            }))
          }
        : null,
      readyManual
    )
    // Never an empty stage: with nothing changing, a duck would dip every
    // layer in the mix. Unreachable through the gate above (a rest alone changes the mix: no duck
    // rides it); kept as the guarantee.
    if (merged.changes.length === 0 && leaving.length === 0) return
    // mergeStageChanges drops radio's change when a manual one is on the
    // same row -- the user pointed at it, radio only drew it.
    const ledInStage = readyLed !== null && !readyManual.has(readyLed.slotId)
    const token = (radioStageTokenRef.current += 1)
    radioStageRef.current = {
      token,
      slotIds: merged.changes.map((c) => c.slotId),
      ledSlotId: ledInStage ? readyLed.slotId : null,
      manual: stagedEntries.size > 0 ? stagedEntries : null,
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
      ...(leaving.length > 0 && { leaving }),
      gestures: merged.arrivals.map((a) => ({
        kind: a.kind,
        slotId: a.slotId,
        beats: a.beats,
        lapsLeft: 1,
        armId: newArmId()
      })),
      // Always the loop top once a manual change is aboard -- and a stage
      // at a bar never carries one (withManual above).
      atBars: stagedEntries.size > 0 ? undefined : readyLed?.atBars,
      // Fold's bar band (phase 2): radio's rows whose change carries their fold, as the held
      // change says (refreshed just above, before this stage); never a row a manual change won.
      carried:
        readyLed === null || !ledInStage
          ? []
          : [
              ...(readyLed.foldCarry === true ? [readyLed.slotId] : []),
              ...radioStagedCompanions(readyLed)
                .filter((k) => k.foldCarry === true && !readyManual.has(k.slotId))
                .map((k) => k.slotId)
            ],
      label:
        !ledInStage || ledLabel === null
          ? 'manual'
          : stagedEntries.size > 0
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
  // Radio's start prompt (RadioStartPrompt.tsx) -- same position/dismissal
  // pattern as the slot row's nearbyMenu and kindMenu. Opened by the header's
  // radio BUTTON while radio is off. While radio runs every setting is in the
  // strip (RadioStrip), so there is nothing to open.
  const [radioPrompt, setRadioPrompt] = useState<{ x: number; y: number } | null>(null)
  // Discover artist mode's field and its search popover.
  const [artistMenu, setArtistMenu] = useState<{ x: number; y: number } | null>(null)
  const artistButtonRef = useRef<HTMLButtonElement>(null)
  // A view switch closes the picker: simple unmounts the strip's artist button it is anchored on
  // (and its ignoreRef with it). Adjusted while rendering, not in an effect.
  const [artistMenuView, setArtistMenuView] = useState(radioView)
  if (artistMenuView !== radioView) {
    setArtistMenuView(radioView)
    setArtistMenu(null)
  }
  // "analyse overnight"'s answer for the current artist ("queued 31,013").
  const [analysisQueued, setAnalysisQueued] = useState<string | null>(null)
  /** The artist field's pick. Radio off: the next rolls just use it. Radio on: a course change --
   * every row by nobody chosen turns over, one per loop top (spec §4), through skipRadio. One
   * artist to one artist is today's switch exactly; a combination skips only when something has
   * to turn over, so adding an artist changes no row (the share brings them in). */
  function changeArtists(next: ArtistSelection): void {
    const prev = artistsRef.current
    if (selectionsEqual(next, prev)) return
    artistsRef.current = next
    artistShareRef.current = reconcileArtistShare(artistShareRef.current, next)
    artistEmptyRef.current = EMPTY_ARTIST_MEMO
    setArtistTurnsShown(artistShareRef.current.landed)
    onArtistsChange(next)
    setAnalysisQueued(null)
    const added = selectionOthers(next).filter((m) => !prev.includes(m))
    if (added.length > 0) void window.rifffApi.discoverPrewarmArtists(added)
    if (!radioOnRef.current) return
    artistTurnoverRef.current = selectionTurnoverIds(
      slotsRef.current.map((s) => ({ id: s.id, creator: s.candidate?.creatorUserName ?? null })),
      next,
      currentUsername
    )
    const bothSingle = prev.length === 1 && next.length === 1
    if (!bothSingle && artistTurnoverRef.current.size === 0) return
    // Never two rows at one loop top: a skip already waiting (or still
    // picking) lands first, and its landing re-arms -- armRadioPick then
    // starts the turnover. A pick still in flight for the OLD selection is
    // dropped by skipRadio itself.
    if (!radioSkipWaiting()) void skipRadio()
  }
  /** A fresh pick landed on a row: it counts as a turn for its member (spec §3). Only in a
   * combination; a one-artist selection keeps no score. */
  function noteArtistLanding(candidate: DiscoverCandidate | null): void {
    const sel = artistsRef.current
    if (!isCombined(sel)) return
    const member = memberOfPick(candidate, sel)
    if (member === undefined) return
    artistShareRef.current = landArtistTurn(artistShareRef.current, member)
    setArtistTurnsShown(artistShareRef.current.landed)
  }
  const radioMenuButtonRef = useRef<HTMLButtonElement>(null)
  // The top line's `radio` (the stop), while radio runs.
  const radioTopButtonRef = useRef<HTMLButtonElement>(null)
  // Stable identity -- same playhead-tick re-render reasoning as
  // closeNearbyMenu.
  const closeRadioPrompt = useCallback(() => setRadioPrompt(null), [])
  // FOCUS FOLLOWS THE SWITCH (radio view plan, decision 14): the radio button a press used goes
  // away with the layout it was in, so the press that starts radio focuses the top line's
  // `radio`, and the one that stops it the header's. Set only by those two presses: a start or
  // stop from the phone never steals focus.
  const focusAfterSwitchRef = useRef<'top' | 'header' | null>(null)
  useEffect(() => {
    const target = focusAfterSwitchRef.current
    if (target === null) return
    focusAfterSwitchRef.current = null
    ;(target === 'top' ? radioTopButtonRef : radioMenuButtonRef).current?.focus()
  }, [radioOn])

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
  // The PHRASE grid (radioCadence.phraseBars) is the gate on top of
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
    const clockWas = radioClockRef.current
    if (!clockWas) return
    const loopBars =
      resolvedBarLengthsRef.current.size > 0
        ? Math.max(...resolvedBarLengthsRef.current.values())
        : 0
    if (!(loopBars > 0)) return
    // The change phrase back on the turnaround's when a phrase or the loop moved under the clock
    // (radioPhraseAnchorRef), BEFORE this tick's advance -- as the pace effect, which runs ahead of
    // this one, does for a pace move. A no-op wherever the two phrases are one number.
    const anchor: RadioPhraseAnchor = {
      phraseBars: radioCadence.phraseBars,
      turnaroundPhraseBars: radioCadence.turnaroundPhraseBars,
      loopBars
    }
    const clock = radioPhraseNeedsReanchor(radioPhraseAnchorRef.current, anchor)
      ? radioPhraseReanchored(clockWas, radioCadence, loopBars)
      : clockWas
    radioPhraseAnchorRef.current = anchor
    // WHERE a change may land -- the strip's `loop end` chips
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
    // Rows per change (from 70): every row riding the pick counts -- the longest outgoing and
    // incoming lengths, unknown while any is, and the loop with all of them swapped in, so a
    // companion with a long stem, or one whose change would shrink the loop, holds the whole
    // change to the top exactly as radio's own row would (radioChangeLengths). One row: exactly
    // that row's lengths, as before. In fold's bar band a companion on a held row that would cut
    // its fold straight is left off a mid-loop line (radioFoldBarCompanionsNow), so it holds
    // nothing back there; a loop-top landing still takes it. Radio's own row takes the band
    // whether the fold holds it or not (phase 2: carried, or cut straight and released).
    const changeLengths =
      pendingPick !== null
        ? radioChangeLengths(
            [
              { slotId: pendingPick.slotId, incomingBars: pendingPick.incomingBars },
              ...radioFoldBarCompanionsNow(radioPendingCompanionsNow(pendingPick))
            ],
            resolvedBarLengthsRef.current
          )
        : null
    // In the pace slider's bar band (80+) the grid is also its bar lines, for any incoming stem no
    // longer than the loop, whatever the two lengths: the incoming stem enters at its matching
    // position (the engine tiles every stem from the loop top), the outgoing one is cut
    // (radioPaceGridBars). Below the band this is exactly radioGridBars of the two lengths, as
    // before. No pending pick, or one whose stem has not resolved: the whole loop, as before.
    const gridBars = radioPaceGridBars(
      radioCadence.barEvery,
      radioSettings.loopEndOverBars,
      loopBars,
      changeLengths?.outgoingBars ?? null,
      changeLengths?.incomingBars ?? null,
      changeLengths?.loopBarsAfter ?? null
    )
    const step = advanceRadioClock(
      clock,
      pos,
      loopBars,
      gridBars,
      radioCadence.phraseBars,
      radioCadence.turnaroundPhraseBars
    )
    radioClockRef.current = step.clock
    radioGridBarsRef.current = gridBars
    // The readout's clock (radioPlayRef): a lap more, and the bars of the lap that ended.
    if (step.wrapped) {
      radioPlayRef.current = {
        lap: radioPlayRef.current.lap + 1,
        startBars: radioPlayRef.current.startBars + loopBars
      }
    }
    // Sized builds' clock (spec 4.2): the lap that ended, then a riser that played into this top
    // -- radio's lead-in or a manual one, still armed until the landing below clears it -- is a
    // build. (The turnaround's is noted in radioTurnaroundAtWrap.)
    if (step.wrapped && radioSizedBuildsOf(radioSettings)) {
      radioBuildClockRef.current = advanceRadioBuildClock(radioBuildClockRef.current, loopBars)
      if (radioGestureRef.current.some((g) => g.kind === 'riser')) {
        radioBuildClockRef.current = noteRadioBuild(radioBuildClockRef.current, false)
      }
    }
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
    densityTick(
      step.wrapped,
      pos,
      loopBars,
      step.turnaroundLapStarts,
      step.clock.turnaroundLap ?? 0
    )
    // The phrase turnaround: off at every wrap, rolled on the wrap that starts a phrase's last
    // lap -- after densityTick's microtask (the arc's removal at this wrap) and after every
    // landing this tick commits (radioTurnaroundAtWrap). Between wraps, a roll still waiting on a
    // stem is given up once its move could no longer reach the engine in time.
    // Fold mode decides the next lap in that same deferred slot, queued first so it decides
    // first: after the arc's exit and this tick's landings, before the roll, which reads whether
    // its phrase ends on a realignment top (radioFoldTurnaroundRate). Still before the top the
    // decided cycles are staged for.
    // Radio's hooks step at every wrap in that same slot, queued before both (spec anointed-stems
    // section 10, risk 1): after this tick's landings, before the fold step and the roll.
    if (step.wrapped) radioHooksAtWrap(loopBars, step.clock.turnaroundLap ?? 0)
    if (step.wrapped) radioFoldAtWrap(loopBars)
    if (step.wrapped) radioTurnaroundAtWrap(step.turnaroundLapStarts, loopBars)
    else {
      radioTurnaroundOverdue()
      // A turn waiting rolls as soon as this lap's top can take it (radioTurnTick).
      radioTurnTick(pos, loopBars)
    }
    // Spares asked for at a phrase start, once no arm of radio's is in flight (sized builds).
    radioSparesTick(step.wrapped)
    // What the turn button and its chips can do now; so build and drop.
    refreshRadioTurnCan()
    refreshRadioArcShown()
    // So do the dub throws (Task 11).
    radioThrowTick(pos, loopBars)
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
    // hold the list is already empty and clearRadioGesture is a no-op. A
    // mid-lap cut below 80 was decided while nothing was armed, so the same;
    // in the pace slider's bar band (80+) it may have been decided while a
    // loop-top arrival was still armed but spent by this bar, and then this
    // takes that curve off for real -- its push folded into the landing's one
    // by holdSyncUntilResolved below.
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
        {
          pick: SlotPick
          stem: ResolvedCandidateStem | null
          joining: boolean
          arrival: ManualArrival | null
          radioSkip?: boolean
          hook?: 'exit' | 'return'
          rest?: true
          arc?: 'rest' | 'return'
        }
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
            radioNextIntervalBars(loopBars, boundaryBars),
            pos,
            boundaryBars
          )
        }
        setRadioLedChange(null)
      }
      clearRadioGesture()
      void Promise.resolve().then(() => {
        if (!radioOnRef.current) return
        // The strip's flicker, here in the microtask (a setState) rather than the effect body,
        // and only for a change that lands: radio's own (not overridden by a manual change on its
        // row, its row still eligible -- the same test as its commit below), else a hook's exit or
        // return, else the arc's row, else a manual change that waited for the top. A Cmd change
        // commits elsewhere and never flickers.
        const ledLands =
          led !== null && !ledOverridden && radioEligibleSlotIds().includes(led.slotId)
        if (ledLands || landingReady.length > 0)
          noteRadioLanding(
            ledLands
              ? 'radio'
              : landingReady.some(([, m]) => m.hook !== undefined)
                ? 'hook'
                : landingReady.some(
                      ([slotId, m]) =>
                        m.arc !== undefined || arcAddingRef.current?.slotId === slotId
                    )
                  ? 'arc'
                  : 'manual-wait'
          )
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
        let companionsLanded: string[] = []
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
          // The phrase end's roll, if this wrap owes one, runs after this and reads this row at
          // its incoming length (radioTurnaroundAtWrap).
          noteTurnaroundLanding(led.slotId, led.stem?.barLength ?? null)
          noteFoldLanding(led.slotId, led.pick, led.stem)
          // The fold machine follows the landing, now that the engine plays it: carried as the
          // stage named it (foldCarry), or released (radioFoldLandNow). At a wrap this runs
          // before that wrap's owed fold step, which then reads the row as the landing left it.
          radioFoldLandNow(
            led.slotId,
            led.pick,
            led.stem,
            led.foldCarry === true,
            !step.wrapped,
            loopBars
          )
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
              lapsLeft: 1,
              armId: newArmId()
            })
          }
          // The clearRadioGesture() above already scheduled a sync for
          // this frame, and this commit's stem is a render and a promise
          // away -- so that sync would push the OLD stem and the swap
          // would need a second push. Holding cancels it; it goes out
          // once, carrying both.
          holdSyncUntilResolved(led.slotId)
          // Its companions, right after it -- the stage carried them as cuts, so the engine
          // swapped them with it. A manual change landing on one's row at this wrap won it.
          const companionsToLand = radioStagedCompanions(led).filter(
            (k) => !manualLandedIds.has(k.slotId)
          )
          companionsLanded = landRadioCompanions(companionsToLand, !step.wrapped, loopBars)
          // A companion the engine swapped in with the stage but the panel just left out (its
          // row locked, muted or removed in the last ~30 ms, too late for stepRadioStage's
          // withdrawal): put the truth back on the wire, deterministically, rather than relying
          // on the commit's own push. Parked behind the hold above, so it goes out once, with it.
          if (
            engineSwapped &&
            (led.companions ?? []).some(
              (k) => !manualLandedIds.has(k.slotId) && !companionsLanded.includes(k.slotId)
            )
          ) {
            scheduleSyncPreviewToEngine(previewingSlotIdsRef.current)
          }
          radioTraceMark('commit') // TEMP
          radioLastSlotRef.current = led.slotId
          landedIds.push(led.slotId, ...companionsLanded)
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
          // A hook's resting exit: no stem changes -- the row leaves the mix here (the stage left
          // it out; without one, this push takes it out, after the line) and rests until its
          // hook's return joins it again. Not a change of the row: nothing committed.
          if (change.rest === true) {
            // Every other row muted since it was decided: resting would empty the preview (torn
            // down). The rest is withdrawn (the hook stays in, and tries again at its next line),
            // and the row plays on: the truth goes back on the wire.
            const mix = previewingSlotIdsRef.current
            if (change.arc === 'rest') {
              // The intensity arc's breakdown (spec 4.1-4.2): the same guard, and a row the user
              // muted since it was decided is his mute, not the arc's rest -- either way the arc
              // lets the row go (the drop still lands for the others).
              if ((mix.size === 1 && mix.has(slotId)) || !mix.has(slotId)) {
                const arc = intensityArcRef.current
                if (arc !== null) intensityArcRef.current = releaseRadioIntensityRest(arc, slotId)
                if (mix.has(slotId)) scheduleSyncPreviewToEngine(mix)
                console.log(
                  `[radio-intensity] ${slotId} keeps ${mix.has(slotId) ? 'playing: the last row in the mix' : 'its mute: not rested'}`
                )
                continue
              }
              radioRestingRef.current.set(slotId, 'arc')
              dropFromPreviewingMix(slotId)
              console.log(`[radio-intensity] ${slotId} rests till the drop`)
              continue
            }
            if (mix.size === 1 && mix.has(slotId)) {
              updateRadioHooks(withdrawRadioHookEvent(radioHooksRef.current, slotId))
              scheduleSyncPreviewToEngine(mix)
              console.log(`[radio-hook] ${slotId} keeps playing: the last row in the mix`)
              continue
            }
            radioRestingRef.current.set(slotId, 'hook')
            dropFromPreviewingMix(slotId)
            console.log(`[radio-hook] ${slotId} rests`)
            continue
          }
          if (!committed && !manualCommitted) {
            radioTraceBegin(boundaryBars, bpmRef.current, 'manual') // TEMP
          }
          // A manual change landing on a row the intensity arc rests: the row is the user's now,
          // and the arc's no longer (spec 4.2) -- it joins the mix with the change (joining).
          if (
            change.hook === undefined &&
            change.arc === undefined &&
            radioRestingRef.current.get(slotId) === 'arc'
          ) {
            releaseIntensityRow(slotId, false)
            // in the mix with the change, whatever its caller thought (the commit's push)
            if (!change.joining) joinPreviewingMix(slotId)
          }
          // a hook's (or the intensity arc's) own landing is not a manual change: it clears no hook
          commitSlotPick(slotId, change.pick, change.hook !== undefined || change.arc !== undefined)
          noteTurnaroundLanding(slotId, change.stem?.barLength ?? null)
          noteFoldLanding(slotId, change.pick, change.stem)
          // A manual change is a straight cut: on a row the fold holds, the machine follows by
          // radio's own rule (radioFoldLandNow), as the web's swap-nows do. Before the wrap's
          // owed fold step, as radio's own landing.
          radioFoldLandNow(slotId, change.pick, change.stem, false, false, loopBars)
          // A hook coming back to a row it rested on: the same stem the row still has, so no
          // resolve will report it -- it joins the mix with a push of its own, holding nothing up.
          // (the intensity arc's drop brings its rested rows back the same way)
          const returns = change.hook === 'return' || change.arc === 'return'
          if (returns) radioRestingRef.current.delete(slotId)
          const sameStem =
            returns &&
            change.stem !== null &&
            resolvedStemsRef.current.get(slotId)?.path === change.stem.path
          // One push for the whole landing, as for a course change: the
          // hold lifts when the LAST of them has resolved.
          if (!sameStem) holdSyncUntilResolved(slotId)
          if (change.joining) {
            const mix = joinPreviewingMix(slotId)
            if (sameStem) scheduleSyncPreviewToEngine(mix)
          }
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
              lapsLeft: 1,
              armId: newArmId()
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
            radioNextIntervalBars(loopBars, boundaryBars),
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
            ...(manualCommitted || companionsLanded.length > 0
              ? arriving.map((g) => (g.kind === 'duck' ? { ...g, spares: landedIds } : g))
              : arriving)
          ]
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
    // Every pick was made and warmed when `new bed` was pressed (or, until
    // 2026-10-03, a pace chip), so this is one batched setSlots -> one
    // render -> one rAF-coalesced sync -> one load-project. Locked and muted layers were never in the
    // batch: radioEligibleSlotIds excluded them, and the padlock has to
    // mean never or it means nothing.
    if (step.wrapped && radioCourseChangeRef.current !== null) {
      const batch = radioCourseChangeRef.current
      radioCourseChangeRef.current = null
      // restartRadioInterval, not createRadioClock: the phrase keeps its
      // anchor (`new bed` re-anchors nothing; the pace chip that used to
      // seek to 0 and restart it went 2026-10-03). This is the batch
      // LANDING a lap or two later, and re-anchoring here would shove the
      // phrase origin forward by however long the slowest stem took to warm.
      radioClockRef.current = restartRadioInterval(
        step.clock,
        radioNextIntervalBars(loopBars, boundaryBars),
        pos,
        boundaryBars
      )
      void Promise.resolve().then(() => {
        if (!radioOnRef.current) return
        noteRadioLanding('course')
        radioTraceBegin(boundaryBars, bpmRef.current, 'course-change') // TEMP
        for (const { slotId, pick } of batch) {
          // A manual change just landed on this row at this same wrap, and
          // it wins, as it does over radio's own change.
          if (manualLandedIds.has(slotId)) continue
          commitSlotPick(slotId, pick)
          // No stem carried: a roll this wrap owes waits for these to resolve.
          noteTurnaroundLanding(slotId, null)
          noteFoldLanding(slotId, pick, null)
          // straight, as a manual change: the fold machine follows (radioFoldLandNow)
          radioFoldLandNow(slotId, pick, null, false, false, loopBars)
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
          : radioBarsUntilChange(step.clock, pos, loopBars, gridBars, radioCadence.phraseBars)
    }
    void Promise.resolve().then(() => {
      setRadioProgress(progress)
      setRadioChangeWait(changeWait)
      // the readout, from this tick: the flash log first, then what it all says
      if (!radioOnRef.current) return
      radioFlashTick(pos, loopBars)
      setRadioReadoutNow(radioReadoutFrom(pos, loopBars, changeWait.barsUntilChange))
      // the armed companions as they ride now: one warmed, locked or muted since the last write,
      // or (fold's bar band) left off the mid-loop line the change will land on
      setRadioArmedCompanionKey(
        radioArmedCompanionKeyOf(
          radioPendingRef.current,
          radioLandsMidLoop(pos, changeWait.barsUntilChange, loopBars)
        )
      )
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
      radioNextIntervalBars(loopBars, boundaryBars),
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
    // The rows riding this change (from 70), decided here, on the tick whose grid saw them:
    // ready ones only. They land with it -- held with it, or committed right after it.
    const companionsNow = pending !== null ? radioHeldCompanionsFrom(pending) : []
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
        // lap is a wash, and the arc's exit drop-out that has not finished
        // has as much right to the lap as a transition does. (A phrase
        // turnaround is handled just below: the change keeps an arrival.)
        const changing = slotsRef.current.find((sl) => sl.id === pending.slotId)
        // The bar band: a change due on a mid-loop line is a cut (radioCadenceTransition), so
        // radioChangeWaitsForLoopTop below lets it land where it came due -- an immediate
        // load-project, 20-65 ms late, as a below-80 own-cycle cut not decided early is. Most
        // are decided early (step 2) and staged at their bar.
        // Sized builds: sized to this change and its riding companions, at the top a riser would
        // lead into (radioChangeSizeNow). Undefined off: today's draw.
        const size = radioChangeSizeNow(
          [pending.slotId, ...companionsNow.map((k) => k.slotId)],
          loopBars,
          pos
        )
        const drawnTransition = radioCadenceTransition(
          radioCadence,
          radioGestureRef.current.length === 0
            ? pickTransition(
                radioSettings.transitions,
                changing?.kinds ?? [],
                Math.random,
                size === undefined ? undefined : { size }
              )
            : 'cut',
          step.wrapped
        )
        // On the wrap that owes the phrase end's roll, that roll comes after this microtask
        // (radioTurnaroundAtWrap) -- but a lead-in drawn here would arm first and keep the lap,
        // and the turnaround would lose the wrap the two share. So the roll runs NOW, as if this
        // change lands here as a cut (which it does if a turnaround comes up), with every landing
        // before it in this tick already noted. A cold pick has no length to roll with: the
        // lead-in keeps the lap, and the roll stands down when it runs.
        // The rows landing with it, without one a manual change took at this wrap.
        const companions = companionsNow.filter((k) => !manualLandedIds.has(k.slotId))
        if (
          turnaroundGateNow() === 'wait' &&
          radioGestureLeadsChange(drawnTransition) &&
          pending.stem !== null
        ) {
          noteTurnaroundLanding(pending.slotId, pending.stem.barLength)
          noteFoldLanding(pending.slotId, pending.pick, pending.stem)
          for (const k of companions) {
            noteTurnaroundLanding(k.slotId, k.stem.barLength)
            noteFoldLanding(k.slotId, k.pick, k.stem)
          }
          // (The roll runs the owed fold step first, with these landings noted: a held row whose
          // stem changes is let go there, so a change committed below on this path never carries
          // its fold -- by design, the step already decided that row straight.)
          rollOwedRadioTurnaround()
        }
        // Under this lap's turnaround a lead-in would land on its wrap: the turnaround is the
        // change's lead-in, so it keeps only an arrival (spec section 3).
        const transition =
          radioTurnaroundRef.current !== null
            ? radioTransitionUnderTurnaround(drawnTransition)
            : drawnTransition
        // How long the move takes, in beats. A hole draws from the same
        // weighted 1/2/4 a turnaround's drum drop does, because it IS one
        // -- a fixed length is a rhythm and a varied one is a gesture. A
        // riser gets two bars, long enough to read as a build; a sweep, a
        // bloom and a duck get one bar, which is the arrival rather than
        // the approach. Everything is clamped to half the loop by the
        // curve builders, so a short loop shortens all of them.
        const beats = radioGestureBeats(transition, pickDropOutBeats, size)
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
                lapsLeft: 1,
                armId: newArmId()
              }
            ]
            setRadioLedChange({
              slotId: pending.slotId,
              pick: pending.pick,
              stem: pending.stem,
              companions: [...radioFoldCarryCompanionsNow(companions)],
              foldCarry: radioFoldChangeCarriesNow(pending.slotId, pending.pick, pending.stem)
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
              arrival: { kind: transition, beats },
              companions: [...radioFoldCarryCompanionsNow(companions)],
              foldCarry: radioFoldChangeCarriesNow(pending.slotId, pending.pick, pending.stem)
            })
          }
          // Nothing else this interval: the next pick waits for the change
          // to actually land, and the landing makes it.
          return
        }
        // No pushUndoSnapshot: radio firing every twenty bars would fill
        // the undo stack and make Cmd+Z useless for the edits the user
        // actually made by hand. A radio change is not undoable; the
        // padlock is the tool for "I liked that one" (spec 3.4).
        radioTraceBegin(boundaryBars, bpmRef.current, `due-${transition}`) // TEMP
        // Fold's bar band (phase 2): the carries, decided here against the machine as it is (no
        // stage went out, so the push this commit makes carries whatever the machine then says),
        // and the companions that ride: on a mid-loop line, one on a held row only when it
        // carries (radioFoldBarCompanionsNow).
        const ledCarries = radioFoldChangeCarriesNow(pending.slotId, pending.pick, pending.stem)
        const ridingCompanions = radioFoldCarryCompanionsNow(
          step.wrapped ? companions : radioFoldBarCompanionsNow(companions)
        )
        commitSlotPick(pending.slotId, pending.pick)
        noteTurnaroundLanding(pending.slotId, pending.stem?.barLength ?? null)
        noteFoldLanding(pending.slotId, pending.pick, pending.stem)
        radioFoldLandNow(
          pending.slotId,
          pending.pick,
          pending.stem,
          ledCarries,
          !step.wrapped,
          loopBars
        )
        // Nothing pushes until this pick's stem has resolved -- not the
        // previous lap's gesture coming off at this same wrap, not the
        // phrase turnaround rolled after this landing, not this change's
        // own arrival gesture.
        // See holdSyncUntilResolved.
        holdSyncUntilResolved(pending.slotId)
        // Its companions, in the same microtask, folded into the same held push (the riding ones
        // above).
        const landedCompanions = landRadioCompanions(ridingCompanions, !step.wrapped, loopBars)
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
              lapsLeft: 1,
              armId: newArmId(),
              // A duck spares every row that turned over here, its companions too.
              ...(landedCompanions.length > 0 && {
                spares: [pending.slotId, ...landedCompanions]
              })
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
          // The sync call nearby is deliberately untouched: the
          // leading-gesture branch above (a hole or a riser) must fire
          // NOW, a whole lap before its change. (The standalone drop-out
          // roll that followed here went with the turnarounds, 2026-10-02.)
        }
      }
      // Arm the next one whether or not this one landed -- nothing
      // eligible is radio idling, not an error, and it retries here at
      // every boundary.
      //
      // Behind the change's own engine push when something actually landed
      // (runAfterEngineSync's own doc comment: the next pick used to get in
      // front of it and hold the change a whole second late); immediately
      // when nothing did, since then there is no push to get in front of
      // and waiting would only burn the backstop timer.
      //
      // Not while an arm is still waiting for its pick (radioArmInFlight): the latest arm wins, so
      // re-arming here would supersede it, and with an interval shorter than a pick takes (1 bar
      // above fast, 2026-10-03) every due tick would cancel the one before and radio would never
      // change. The arm in flight lands its pick as usual; the next due tick takes it.
      if (committed) {
        runAfterEngineSync(() => {
          if (radioOnRef.current) void armRadioPick()
        })
      } else if (!radioArmInFlight()) {
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
    // a hook on a row the snapshot does not have goes with it
    for (const h of radioHooksRef.current.hooks)
      if (!validIds.has(h.rowId)) forgetRadioHookRow(h.rowId)
    updateRadioHooks(pruneRadioHooks(radioHooksRef.current, validIds))
    // and so does a dig on one
    updateRadioDig(pruneRadioDig(radioDigRef.current, validIds))
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
    // A turn waiting for the loop top, pressed since the latest undo point, is the newest thing
    // done: it alone is taken back (withdrawRadioTurn).
    if (withdrawRadioTurn()) return
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
  const radioArmedCompanionIds = useMemo(
    () => new Set(radioArmedCompanionKey === '' ? [] : radioArmedCompanionKey.split('\n')),
    [radioArmedCompanionKey]
  )
  const radioHeldCompanionIds = useMemo(
    () => new Set(radioHeldCompanionKey === '' ? [] : radioHeldCompanionKey.split('\n')),
    [radioHeldCompanionKey]
  )
  const radioRemote = useMemo<RemoteRadioView | null>(() => {
    const manualWaiting = manualWaitingKey === '' ? [] : manualWaitingKey.split('\n')
    // radio's held row and its companions, then the manual ones, each once
    const radioHeld = [
      ...(radioHeldSlotId !== null ? [radioHeldSlotId] : []),
      ...(radioHeldCompanionKey === '' ? [] : radioHeldCompanionKey.split('\n'))
    ]
    const heldSlotIds = [...new Set([...radioHeld, ...manualWaiting])]
    if (radioArmedSlotId === null && heldSlotIds.length === 0) return null
    return { armedSlotId: radioArmedSlotId, heldSlotIds }
  }, [radioArmedSlotId, radioHeldSlotId, radioHeldCompanionKey, manualWaitingKey])
  // Radio's turn as the phone sees it (@shared/remoteState RemoteTurnView): what the desktop's
  // turn button and chips show, and what POST /api/turn answers from. Null with radio off.
  const radioTurnRemote = useMemo<RemoteTurnView | null>(
    () =>
      radioOn
        ? {
            waiting: radioTurnShown !== null,
            move: radioTurnShown?.move ?? null,
            // Not measured yet (before the first clock tick): allow, as the desktop's
            // chips do, rather than dim every chip and answer `nothing to turn`.
            canTurn: radioTurnCan?.canTurn ?? true,
            moves: radioTurnCan?.moves ?? [...TURNAROUND_MOVES]
          }
        : null,
    [radioOn, radioTurnShown, radioTurnCan]
  )
  // The intensity arc's build and drop as the phone sees them (@shared/remoteState
  // RemoteArcView): what the strip shows, and what POST /api/arc answers from. Null unless radio
  // runs with density intensity.
  const radioArcRemote = useMemo(
    () => (radioOn ? intensityArcRemote(radioArcShown) : null),
    [radioOn, radioArcShown]
  )

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
          radio: radioRemote,
          // fold mode's switch, while radio runs (the phone's one radio setting)
          fold: radioOn ? radioSettings.foldMode : null,
          turn: radioTurnRemote,
          arc: radioArcRemote,
          // radio's roles while it runs: the hook's state, bars away, the phone's words; a row
          // the intensity arc rests says `rests` (the short form of `rests till the drop`)
          ...(radioOn && {
            roles: new Map(
              [
                ...new Set([
                  ...radioHooks.hooks.map((h) => h.rowId),
                  ...(radioDig !== null ? [radioDig] : []),
                  ...[...radioRestingRef.current].flatMap(([id, owner]) =>
                    owner === 'arc' ? [id] : []
                  )
                ])
              ].flatMap((rowId) => {
                const role = radioRoleNow(rowId, true)
                if (radioRestingRef.current.get(rowId) === 'arc') {
                  // the words are the rest's; a hook the row holds stays its own, so the
                  // phone's action sheet still offers its release
                  return [
                    [
                      rowId,
                      {
                        hook: role?.hook ?? null,
                        dig: role?.dig ?? radioDigRef.current === rowId,
                        hookBarsAway: role?.barsToReturn ?? null,
                        words: RADIO_ARC_REST_SHORT
                      }
                    ] as const
                  ]
                }
                return role === null
                  ? []
                  : [
                      [
                        rowId,
                        {
                          hook: role.hook,
                          dig: role.dig,
                          hookBarsAway: role.barsToReturn,
                          words: role.words
                        }
                      ] as const
                    ]
              })
            )
          })
        },
        peaksBySlotId
      )
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps -- radioRoleNow is re-created each render and reads the hooks and the clock through refs on purpose
  }, [
    buildSlotSnapshots,
    playing,
    keptCount,
    rolledCount,
    lastKeptName,
    remotePeaksTick,
    radioRemote,
    radioOn,
    radioSettings.foldMode,
    radioTurnRemote,
    radioArcRemote,
    radioHooks,
    radioDig
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
        if (change.hook !== undefined || change.arc !== undefined) continue
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
      radioTurnaroundRef.current = null
      radioTurnaroundMemoryRef.current = null
      radioTurnaroundRollPendingRef.current = false
      radioTurnaroundRollRef.current = null
      radioTurnPendingRef.current = null
      radioThrowRef.current = initialDiscoverThrowState()
      radioThrowClearOwedRef.current = false
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
      // Fold mode's switch (2026-10-02): the same setter the radio strip's fold switch calls.
      else if (command.kind === 'fold') void onRadioSettingsChange({ foldMode: command.on })
      // The desktop's own turn (turnRadio): the server forwards only a turn it answered
      // `turning` to.
      else if (command.kind === 'turn') turnRadioRef.current(command.move)
      // The intensity arc's build and drop (intensityPress): forwarded only when POST /api/arc
      // answered `building` or `dropping`.
      else if (command.kind === 'arc') intensityPressRef.current(command.action)
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

  // `t` turns (the turn button), while radio runs. Nothing else claims a plain `t`: App's
  // shortcuts are Delete/Backspace, Escape, Space, Tab, Cmd/Ctrl-Z, Ctrl-Y, Cmd-0, Cmd-S, `\`
  // and `/`; no component binds a letter. Not in a text field, not with a modifier (Cmd-T and
  // friends belong to the system), and not a held key's repeats. In a ref, refreshed every
  // render (turnRadioRef), for the reason remoteCommandRef is.
  useEffect(() => {
    turnRadioRef.current = turnRadio
    intensityPressRef.current = intensityPress
  })
  useEffect(() => {
    if (!radioOn) return
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key !== 't' || e.repeat || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return
      const target = e.target as HTMLElement | null
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return
      }
      e.preventDefault()
      turnRadioRef.current()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [radioOn])
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
    const entry = manualChangesRef.current.get(id)
    if (entry === undefined) return
    const next = new Map(manualChangesRef.current)
    next.delete(id)
    setManualChanges(next)
    cancelStagedSwap(reason)
    // A hook's landing taken out of the queue (a manual change won its row, undo, the row
    // removed, Cmd): its decision is withdrawn, to be tried again at the next line.
    if (entry.hook !== undefined) {
      updateRadioHooks(withdrawRadioHookEvent(radioHooksRef.current, id))
    }
    // The intensity arc's landing taken out of the queue (a manual change won its row, the row
    // removed): the arc lets the row go (releaseRadioIntensityRest) -- a rest not taken leaves it
    // playing, a return not taken leaves it to what won the row.
    if (entry.arc !== undefined) {
      const arc = intensityArcRef.current
      if (arc !== null) intensityArcRef.current = releaseRadioIntensityRest(arc, id)
    }
    // An exit withdrawn takes its echo back with it (withdrawDiscoverExitThrow: not one under way),
    // so no echo rings at the line over a row that stays. (The breakdown's rest, likewise.)
    if (entry.hook === 'exit' || entry.arc === 'rest') {
      const throws = withdrawDiscoverExitThrow(radioThrowRef.current, id)
      if (throws !== null) {
        radioThrowRef.current = throws
        clearRadioThrowCurve()
        console.log(
          `${entry.arc === 'rest' ? '[radio-intensity] rest' : '[radio-hook] exit'} on ${id} withdrawn: its echo taken back`
        )
      }
    }
  }
  /** A manual change (not a hook's own landing) waits for the loop top on this row: a second
   * click there is ignored. A hook's landing waiting there gives way instead
   * (queueManualChange). */
  function manualWaitingOn(id: string): boolean {
    const m = manualChangesRef.current.get(id)
    return m !== undefined && m.hook === undefined && m.arc === undefined
  }

  function removeSlot(id: string): void {
    // A waiting manual change dies with its row -- the only thing a padlock
    // or a mute cannot do to it (spec behaviour 6) -- and so does any stage
    // carrying it. Step (3) re-stages whatever else was waiting.
    withdrawManualChange(id, 'manual-change-removed')
    // the intensity arc lets a removed row go (its rests, its decided lists, its renewal)
    if (intensityArcRef.current !== null) releaseIntensityRow(id, false)
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
    // its hook goes with it, in any state (spec 2.7)
    updateRadioHooks(
      pruneRadioHooks(
        radioHooksRef.current,
        new Set(radioHooksRef.current.hooks.map((h) => h.rowId).filter((r) => r !== id))
      )
    )
    forgetRadioHookRow(id)
    // the dig goes with its row (spec 3.1: the anchor is that row's stem)
    if (radioDigRef.current === id) updateRadioDig(null)
  }

  /** The row's 👍 and 👎 (2026-10-01, the web radio's full-mode row
   * buttons). Undo deliberately does not cover them, the same way it does
   * not cover the padlock or mute: they are a statement about what radio
   * should do next (and, for 👍, a favourite), not an edit to the loop.
   *
   * 👍 toggles the star (toggleStemFavourite) and, only when it STARS,
   * hooks the playing stem if the row has no hook (likeRadioSlot decides the
   * star, likeRadioStem the hook). A second 👍 un-stars and leaves the hook
   * as it is. Radio off or a padlocked row: star only. */
  function likeSlot(id: string): void {
    const slot = slots.find((s) => s.id === id)
    if (!slot || slot.candidate === null) return
    const stemCID = slot.candidate.stemCID
    // Listen-only (spec §2): 👍 still holds the row longer, but stars
    // nothing -- always the "would star" branch, never toggleStemFavourite.
    const listening = refusesNow('star')
    // The star half stays likeRadioSlot's (the flags are left as they are: likeRadioHook clears
    // change soon). The hold is a HOOK on the playing stem now (likeRadioStem, spec anointed-stems
    // 2.7): when it stars, with radio on and the row unlocked; it never un-hooks, and on a row
    // whose hook is away it stars the substitute only.
    const stars = likeRadioSlot(radioSlotFlagsRef.current, {
      starred: listening ? false : stemFavourites.has(stemCID)
    }).starred
    if (stars) likeRadioHook(slot, radioOn && !slot.locked)
    if (!listening) toggleStemFavourite(stemCID)
  }
  function toggleSlotReplaceSoon(id: string): void {
    // 👎 on a row whose hook is in releases the hook first (spec 2.7); on an away row it marks the
    // substitute and the hook is untouched.
    if (radioHookInRow(radioHooksRef.current, id)) {
      const r = releaseRadioHook(radioHooksRef.current, id)
      updateRadioHooks(r.state)
      if (r.released !== null) radioHooksReleased([r.released])
    }
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
    const copyId = freshSlotId()
    // An instant copy while radio runs lands now: its age starts here (the radio readout), as
    // commitSlotPick's does.
    if (radioOnRef.current) radioRowSinceRef.current.set(copyId, radioPlayRef.current.lap)
    setSlots((prev) => [...prev, { ...slot, id: copyId, radioAdded: undefined }])
    // A duplicate is a turn: that artist now holds another row (combine artists, decision 5).
    noteArtistLanding(candidate)
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
    // A row padlocked while the intensity arc holds it (rested, or about to be, or renewed): the
    // arc lets it go, and a resting one comes back with its own stem at the next top (spec 4.2;
    // planning decision 15).
    const locking = slotsRef.current.find((s) => s.id === id)?.locked === false
    if (locking && intensityArcRef.current !== null) intensityEndRest(id)
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
      if (manualWaitingOn(id)) return false
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
      const pick: SlotPick = {
        candidate,
        barUsed: null,
        barRequested: traitMatchBar,
        unranked: true
      }
      commitSlotPick(id, pick)
      radioCmdLanded(id, pick)
      return true
    }
    setSlots((prev) =>
      prev.map((s) =>
        s.id === id ? { ...s, candidate, hasRerolled: true, seedStem: undefined } : s
      )
    )
    // The direct write (radio off): a turn for its member, as commitSlotPick counts one.
    noteArtistLanding(candidate)
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
    if (radioOnRef.current && manualWaitingOn(id)) return
    const myGeneration = (rerollGenerationRef.current.get(id) ?? 0) + 1
    rerollGenerationRef.current.set(id, myGeneration)
    setRerollingSlotIds((prev) => new Set(prev).add(id))
    try {
      // One artist: today's creator (or none) and tag. A combination: any member, tagged by
      // creator (combine artists).
      const sel = artistsRef.current
      const nearbyArtist = selectionCreatorFilter(sel, currentUsername)
      const nearbyRaw = await window.rifffApi.getAdjacentDiscoverCandidates(
        anchor.riffCID,
        slot.kinds,
        soundSourceForLean(sourceLeanRef.current),
        nearbyArtist
      )
      const tagNear = <T extends DiscoverCandidate>(c: T): T =>
        typeof nearbyArtist === 'object'
          ? tagByCreator(c, sel, currentUsername)
          : tagPickedUnderArtist(c, nearbyArtist)
      const nearby = { older: nearbyRaw.older.map(tagNear), newer: nearbyRaw.newer.map(tagNear) }
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
    // radio's roles (spec anointed-stems 5): the hook toggle, bring back, and the dig toggle
    else if (action === 'hook') toggleSlotHook(id)
    else if (action === 'back') bringSlotHookBack(id)
    else if (action === 'dig') toggleSlotDig(id)
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
    {
      avoidOwnStem = false,
      yieldRow = false,
      intensity
    }: {
      avoidOwnStem?: boolean
      /** A pick that yields its row to every other (sized builds' spares, armRadioSpares): it
       * claims no generation, so it never makes anyone's pick for the row stale, and gives up
       * (null) as soon as anyone else picks for it; and it shows nothing (no rolling state, not
       * counted on the phone). */
      yieldRow?: boolean
      /** The intensity arc's lean (spec 2026-10-05-radio-intensity-arc-design 2.3): the target
       * and the drama it leans by. Absent: while radio runs with density intensity, the arc's
       * target now (intensityLeanNow); otherwise none, and the pick is today's. */
      intensity?: { target: number; drama: number }
    } = {}
  ): Promise<SlotPick | null> {
    // read before the first await: the arc's target when the pick was asked for
    const lean = intensity ?? intensityLeanNow()
    // Claimed BEFORE the first await -- see rerollGenerationRef's own doc
    // comment above. Any earlier call for this SAME slot id that's still
    // awaiting getDiscoverCandidates when THIS call resolves is now stale
    // and must not write its own (older) result over this one. A yielding
    // pick claims nothing: it holds the generation as it is, so any later
    // claim makes IT the stale one.
    const myGeneration = (rerollGenerationRef.current.get(id) ?? 0) + (yieldRow ? 0 : 1)
    // A yielding pick on a row never picked for has no entry yet: seed it at 0, so the staleness
    // checks below (get(id) !== myGeneration) compare 0 with 0 rather than undefined with 0.
    if (yieldRow && !rerollGenerationRef.current.has(id)) rerollGenerationRef.current.set(id, 0)
    if (!yieldRow) {
      rerollGenerationRef.current.set(id, myGeneration)
      // The phone's "rolled" counter. Counted in the two functions every roll
      // path funnels through (this and rollRandomForSlot below) rather than at
      // each of addSlot/rerollSlot/rerollAll/changeSlotKinds.
      setRolledCount((n) => n + 1)
      setRerollingSlotIds((prev) => new Set(prev).add(id))
    }
    // Combine artists (@shared/artistShare): who this pick asks, in order. One artist: one
    // attempt, today's filter, and no random draw (artistShare.test.ts). The turn begun here ends
    // in the finally below, for whichever member the pick ended on.
    const selection = artistsRef.current
    const kindsKeyNow = slotKindsKey(kinds)
    const attempts = artistPickAttempts(
      selection,
      artistShareRef.current,
      Math.random,
      currentUsername,
      globalRollOptions.onlyOwnStems,
      artistKnownEmpty(artistEmptyRef.current, selection, kindsKeyNow, wallClockMs())
    )
    let attempt = 0
    artistShareRef.current = beginArtistTurn(artistShareRef.current, attempts[0].member)
    try {
      // The global [x] toggles under the add row (globalRollOptions). An empty
      // currentUsername means "no known identity," not "filter to the empty
      // string" -- slotRollOptions only sets onlyOwnStems with a username,
      // mirroring LibraryBrowser.tsx's own buildRiffFilters guard. Without
      // that, (onlyOwnStems: true, targetUser: '') would make
      // getDiscoverCandidates' own `CreatorUserName !== targetUser` check
      // exclude essentially every real stem -- zero candidates, forever.
      // The creator filter (artist mode) -- today's values in own mode. The first member asked
      // (combine artists); a pass-on below fetches under the next member's filter.
      const f = attempts[0].filter
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
      // an away hook's stem is used: it is coming back to its row
      for (const stem of radioHookStemsAway(radioHooksRef.current)) usedElsewhere.add(stem)
      // The source dial: this roll's source is drawn here, and the other
      // source is tried only if the drawn one has nothing NEW for this slot
      // (never at an end -- see drawSoundSource). A drawn pool made only of
      // stems already on other slots counts as nothing: at the middle of
      // the dial, a small pool (a few audio-in stems for a kind, all in
      // use) would otherwise land a duplicate half the time while the other
      // source has fresh stems to offer.
      const draw = drawSoundSource(sourceLeanRef.current)
      // Fold mode's clash (@shared/radioClash), while radio runs: every candidate carries its
      // rhythm and brightness percentiles, and the ranking turns away from the bed's.
      const clashAmount = radioOnRef.current
        ? radioClashAmount(radioSettings.foldMode, radioSettings.clash)
        : 0
      const alsoTraits = clashAmount > 0 ? [...CLASH_TRAITS] : undefined
      const unused = (c: DiscoverCandidate): boolean => !usedElsewhere.has(c.stemCID)
      // the lean reads each candidate's intensity score (main attaches it only when asked)
      const alsoIntensity = lean !== null ? true : undefined
      /** One source-dial roll: the drawn source, then the other when the drawn one has nothing
       * new. `only` restricts it to those stems, before main's sample (the faves dial's
       * favourites-only draw). `ff` is the filter it fetches under: the first member's unless a
       * pass-on gives the next one's. Tagged with the artist they were rolled under
       * (pickedUnderArtist). Null when a newer roll for this slot took over meanwhile. */
      const fetchPool = async (
        only?: string[],
        ff: ArtistRollFilter = f
      ): Promise<DiscoverCandidate[] | null> => {
        let pool = (
          await window.rifffApi.getDiscoverCandidates(
            kinds,
            ff.onlyOwnStems,
            ff.targetUser,
            draw.first,
            ff.artist,
            alsoTraits,
            only,
            alsoIntensity
          )
        ).map((c) => tagPickedUnderArtist(c, ff.artist))
        if (!pool.some(unused) && draw.fallback !== null) {
          if (rerollGenerationRef.current.get(id) !== myGeneration) return null
          const fallbackPool = (
            await window.rifffApi.getDiscoverCandidates(
              kinds,
              ff.onlyOwnStems,
              ff.targetUser,
              draw.fallback,
              ff.artist,
              alsoTraits,
              only,
              alsoIntensity
            )
          ).map((c) => tagPickedUnderArtist(c, ff.artist))
          // Switch to the fallback when it has something new, or when the
          // drawn source had nothing at all. Otherwise keep the drawn pool,
          // all duplicates -- the dedupe below then uses it whole, which
          // beats reporting "no match".
          if (fallbackPool.some(unused) || pool.length === 0) pool = fallbackPool
        }
        return pool
      }
      // The faves dial (@shared/discoverFaves): with probability faves/100 this roll draws only
      // starred stems, under every other rule of the slot; when none fits (none starred, none of
      // this kind or source, or all already on other rows) it rolls as usual and says so. Off in
      // artist mode, where the dial is dimmed: your stars are not among the artist's stems.
      const faves = f.artist === undefined ? favesRef.current : 0
      // `no fave fits` / `no near fits` flash on the row while radio runs, as on the web (spec 2):
      // the readout's flash path shows them. Nothing about the pick changes.
      const flashPickFallback = (word: string, tag: string): void => {
        if (!radioOnRef.current) return
        const now = radioPlayRef.current.startBars + (radioClockRef.current?.lastPos ?? 0)
        radioFlashLogRef.current = [
          ...radioFlashLogRef.current,
          { rowId: id, word, at: now, key: `${tag}@${id}@${myGeneration}` }
        ]
      }
      let favesFallback = false
      let candidates: DiscoverCandidate[] | null = null
      if (favesDraw(faves) === 'only') {
        const favePool = stemFavourites.size > 0 ? await fetchPool([...stemFavourites]) : []
        if (favePool === null) return null
        if (favePool.some(unused)) candidates = favePool
        else favesFallback = true
      }
      // Radio's dig (@shared/radioDig, spec anointed-stems 3.2), for every row's pick while radio
      // runs and a row is dug: after the faves draw, and only when it did not go favourites-only,
      // one draw makes a third of picks near-only -- the dug stem's riff neighbours
      // (getAdjacentDiscoverCandidates: this row's kinds, the drawn source then the other, the
      // creator filter keeping artist mode inside the artist; own-stems-only as getDiscover-
      // Candidates applies it). 8 per direction, nothing downloaded (resolveCandidateStem fetches
      // only the stem picked, so the near draw never makes a swap late), and with library trait
      // percentiles for the slot's traits, the clash's and the anchor's, so the trait bar, fold's
      // clash and dig's closeness read the near pool as they read a normal one. None unused: a
      // normal pick, logged `no near fits`; an anchor with no riff (nothing to walk): `dig: no
      // riff`. What the call found is learned as the anchor riff's neighbours, for the ranking.
      const digAnchor = radioDigAnchorNow()
      if (candidates === null && digAnchor !== null && digNearDraw(true)) {
        const anchorRiff = digAnchor.riffCID
        const percentileTraits = [
          ...new Set([
            ...(alsoTraits ?? []),
            ...DISCOVER_TRAIT_SLOT_KINDS.filter(isTraitSlotKind).filter(
              (k) => digAnchor.traits[k] != null
            )
          ])
        ]
        // Combine artists (decision 9): the near draw spans the whole selection, each neighbour
        // tagged by its creator, and the ledger charges whoever lands. One artist: today's.
        const nearCombined = isCombined(selection)
        const nearFrom = async (source: typeof draw.first): Promise<DiscoverCandidate[] | null> => {
          if (anchorRiff === undefined) return null
          const raw = await window.rifffApi.getAdjacentDiscoverCandidates(
            anchorRiff,
            kinds,
            source,
            nearCombined ? selectionCreatorFilter(selection, currentUsername) : f.artist,
            {
              matchesPerDirection: DIG_NEAR_PER_DIRECTION,
              skipDownload: true,
              percentileTraits,
              ...(lean !== null && { intensity: true })
            }
          )
          // a combination's creator list already restricts the creators
          const own = (c: DiscoverCandidate): boolean =>
            nearCombined ||
            !f.onlyOwnStems ||
            f.targetUser === '' ||
            c.creatorUserName === f.targetUser
          const tagNear = (c: DiscoverCandidate): DiscoverCandidate =>
            nearCombined
              ? tagByCreator(c, selection, currentUsername)
              : tagPickedUnderArtist(c, f.artist)
          const near = {
            newer: raw.newer.filter(own).map(tagNear),
            older: raw.older.filter(own).map(tagNear)
          }
          radioDigNearRef.current = learnRadioDigNear(
            radioDigNearRef.current,
            anchorRiff,
            [...near.newer, ...near.older].map((c) => c.riffCID)
          )
          return radioDigNearPool(near, unused)
        }
        candidates = await nearFrom(draw.first)
        if (rerollGenerationRef.current.get(id) !== myGeneration) return null
        if (candidates === null && draw.fallback !== null) {
          candidates = await nearFrom(draw.fallback)
          if (rerollGenerationRef.current.get(id) !== myGeneration) return null
        }
        if (anchorRiff === undefined) {
          console.log(`DiscoverPanel: pickForSlot(${slotKindsKey(kinds)}) -- dig: no riff`)
        } else if (candidates === null) {
          console.log(`DiscoverPanel: pickForSlot(${slotKindsKey(kinds)}) -- ${NO_NEAR_FITS}`)
          flashPickFallback(NO_NEAR_FITS, 'near')
        }
      }
      if (candidates === null) {
        if (rerollGenerationRef.current.get(id) !== myGeneration) return null
        candidates = await fetchPool()
        if (candidates === null) return null
        // Combine artists: a member with nothing new for this row passes its turn on to the next
        // (never silent: logged, and flashed on the row while radio runs). An EMPTY pool is
        // remembered for these kinds; one that is all duplicates is not (that changes pick to
        // pick). Nobody with anything new: the first non-empty pool, whole -- duplicates beat
        // nothing, as today. One artist: one attempt, so this never loops.
        let firstNonEmpty: DiscoverCandidate[] | null = candidates.length > 0 ? candidates : null
        while (!candidates.some(unused) && attempt + 1 < attempts.length) {
          const skipped = attempts[attempt].member
          if (candidates.length === 0) {
            artistEmptyRef.current = noteArtistEmpty(
              artistEmptyRef.current,
              skipped,
              kindsKeyNow,
              wallClockMs()
            )
          }
          const word = artistSkipWord(skipped, currentUsername)
          console.log(`[artist-share] pickForSlot(${kindsKeyNow}) -- ${word}`)
          flashPickFallback(word, `artist-${attempt}`)
          artistShareRef.current = endArtistTurn(artistShareRef.current, skipped)
          attempt += 1
          artistShareRef.current = beginArtistTurn(artistShareRef.current, attempts[attempt].member)
          if (rerollGenerationRef.current.get(id) !== myGeneration) return null
          const next = await fetchPool(undefined, attempts[attempt].filter)
          if (next === null) return null
          candidates = next
          if (firstNonEmpty === null && next.length > 0) firstNonEmpty = next
        }
        if (!candidates.some(unused) && firstNonEmpty !== null) candidates = firstNonEmpty
      }
      if (favesFallback) {
        console.log(`DiscoverPanel: pickForSlot(${slotKindsKey(kinds)}) -- ${NO_FAVE_FITS}`)
        flashPickFallback(NO_FAVE_FITS, 'fave')
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
      const { pool: traitBarred, barUsed } = applyTraitBar(pool, targetTraits, {
        bar: traitMatchBar
      })
      // The intensity arc's band draw (one number, after dig's near draw: the picker's draw order
      // is faves, dig, band), and its ranking term against the pool before the band (its `ranks`).
      // No lean: no draw, and the pool is the trait bar's.
      const band =
        lean === null
          ? null
          : applyIntensityBand(traitBarred, {
              target: lean.target,
              kinds,
              drama: lean.drama,
              random: Math.random
            })
      if (band?.backedOff === true) {
        console.log(`[radio-intensity] band too small for ${slotKindsKey(kinds)}: the whole pool`)
      }
      const barred = band === null ? traitBarred : band.pool
      const ranked = rankCandidates(barred, {
        targetBpm: bpm,
        // The faves dial's lean: faves/100 of the favourites boost (0 in artist mode, above).
        favouriteStemCIDs: faves > 0 ? stemFavourites : undefined,
        favouriteScale: favesBoostScale(faves),
        // Finding, 2026-09-21: trait kinds were never passed here before,
        // so a "warm" roll ranked by BPM alone. Every trait kind in the set
        // now adds its library percentile (rankCandidates).
        targetTraits,
        ...(clashAmount > 0
          ? {
              clash: {
                amount: clashAmount,
                bed: radioClashBed(
                  slotsRef.current
                    .filter((s) => s.id !== id && previewingSlotIdsRef.current.has(s.id))
                    .map((s) => s.candidate?.traitPercentiles ?? {})
                )
              }
            }
          : {}),
        // dig's lean (spec 3.3): every candidate toward the dug stem, the anchor riff's learned
        // neighbours counting as near in time. No dig: no term.
        ...(digAnchor !== null
          ? {
              dig: rankDigOf(
                digAnchor,
                digAnchor.riffCID !== undefined
                  ? radioDigNearOf(radioDigNearRef.current, digAnchor.riffCID)
                  : undefined
              )
            }
          : {}),
        // the intensity arc's term (spec 2.3): no lean, no term
        ...(lean !== null && band !== null
          ? { intensity: radioIntensityRankOf(lean.target, kinds, lean.drama, band.ranks) }
          : {})
      })
      const picked = pickReroll(ranked, chaos)
      // TEMPORARY diagnostic log (2026-09-15) -- see the matching one
      // above. Remove once confirmed.
      console.log(
        `DiscoverPanel: pickForSlot(${slotKindsKey(kinds)}) -- ranked/picked, returning pick (picked=${picked?.stemCID ?? 'null'})`
      )
      return {
        candidate: picked,
        barUsed,
        barRequested: traitMatchBar,
        ...(favesFallback ? { favesFallback: true as const } : {})
      }
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
      artistShareRef.current = endArtistTurn(artistShareRef.current, attempts[attempt].member)
      if (!yieldRow && rerollGenerationRef.current.get(id) === myGeneration) {
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
  function commitSlotPick(id: string, pick: SlotPick, hookLanding = false): void {
    // the row's age starts again (the radio readout)
    radioRowSinceRef.current.set(id, radioPlayRef.current.lap)
    // A landing of any kind, for the hooks' calm wait (radioLandingsInPhrase).
    if (radioOnRef.current) {
      radioLandingsRef.current = noteRadioLandings(radioLandingsRef.current, 1)
    }
    // A change on a row whose hook is IN, other than the hook's own landing, clears the hook: the
    // hooked stem is gone, and a hook is about that stem (spec Decided 1). Radio's own turnover
    // never reaches such a row, so this is a manual change (similar, adjacent, random, swap, Cmd,
    // the phone). On an away row it replaced the substitute: the hook still comes back.
    if (!hookLanding) {
      const h = radioHookOf(radioHooksRef.current, id)
      if (h !== null && h.state === 'in' && pick.candidate?.stemCID !== h.stemId) {
        updateRadioHooks(forgetRadioHookOnManualChange(radioHooksRef.current, id))
        forgetRadioHookRow(id)
      }
    }
    // A row changed by anyone counts as turned over (changeArtists) -- but
    // only by a pick rolled under the CURRENT selection: a manual reroll or
    // skip still in flight from before the switch lands the old artist's
    // stem, and that row still has to turn over.
    // A fresh pick landing is a turn for its member (combine artists); a hook's or the arc's own
    // landing is a stem coming back, not a turn.
    if (!hookLanding) noteArtistLanding(pick.candidate)
    if (pickMatchesArtistSelection(pick.candidate, artistsRef.current)) {
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
    if (queue && manualWaitingOn(id)) return
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
    if (immediate && radioOnRef.current) radioCmdLanded(id, pick)
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
    if (radioOnRef.current && !immediate && manualWaitingOn(id)) return
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
    if (queue && manualWaitingOn(id)) return
    const myGeneration = (rerollGenerationRef.current.get(id) ?? 0) + 1
    rerollGenerationRef.current.set(id, myGeneration)
    setRolledCount((n) => n + 1)
    setRerollingSlotIds((prev) => new Set(prev).add(id))
    // Combine artists: the same plan as pickForSlot's (one artist: one attempt, no random draw).
    const selection = artistsRef.current
    const attempts = artistPickAttempts(
      selection,
      artistShareRef.current,
      Math.random,
      currentUsername,
      globalRollOptions.onlyOwnStems,
      artistKnownEmpty(artistEmptyRef.current, selection, slotKindsKey(kinds), wallClockMs())
    )
    let attempt = 0
    artistShareRef.current = beginArtistTurn(artistShareRef.current, attempts[0].member)
    try {
      const draw = drawSoundSource(sourceLeanRef.current)
      let candidate: DiscoverCandidate | null = null
      for (;;) {
        // The creator filter (artist mode) -- today's values in own mode; the member asked now.
        const f = attempts[attempt].filter
        // Falls back only on no candidate at all, unlike pickForSlot, which
        // also falls back when everything drawn is already on another slot:
        // this path has never skipped duplicates, so there is nothing to be
        // "all duplicates" of. The same holds for passing the turn on.
        candidate = await window.rifffApi.getRandomDiscoverCandidate(
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
        if (candidate !== null || attempt + 1 >= attempts.length) break
        if (rerollGenerationRef.current.get(id) !== myGeneration) return
        const skipped = attempts[attempt].member
        console.log(
          `[artist-share] rollRandomForSlot -- ${artistSkipWord(skipped, currentUsername)}`
        )
        artistShareRef.current = endArtistTurn(artistShareRef.current, skipped)
        attempt += 1
        artistShareRef.current = beginArtistTurn(artistShareRef.current, attempts[attempt].member)
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
        const pick: SlotPick = {
          candidate,
          barUsed: null,
          barRequested: traitMatchBar,
          unranked: true
        }
        commitSlotPick(id, pick)
        radioCmdLanded(id, pick)
      } else {
        setSlots((prev) =>
          prev.map((s) =>
            s.id === id ? { ...s, candidate, hasRerolled: true, seedStem: undefined } : s
          )
        )
        noteArtistLanding(candidate)
      }
    } catch (err) {
      console.error(`DiscoverPanel: rollRandomForSlot(${slotKindsKey(kinds)}) failed:`, err)
    } finally {
      artistShareRef.current = endArtistTurn(artistShareRef.current, attempts[attempt].member)
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
    if (radioOnRef.current && !immediate && manualWaitingOn(id)) return
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
      !slots.some((s) => !s.locked && !manualWaitingOn(s.id))
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
      if (manualWaitingOn(slotId)) continue
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
    } else dropRadioPendingCompanion(slotId)
    const led = radioLedChangeRef.current
    if (led !== null && led.slotId === slotId) {
      radioTakesBackLed(led)
      if (radioOnRef.current) void armRadioPick()
      return
    }
    // A companion of radio's held change on this row. QUEUED (the manual change is waiting):
    // left in place -- the manual change wins the row in the stage once it is ready
    // (mergeStageChanges) and at the landing, and until then the stage out lands as it is, as it
    // does for any manual change too late for it (queueManualChange). COMMITTED at once (Cmd):
    // the row is the user's now, so the companion leaves the held change and any stage carrying
    // it is withdrawn (the commit's own push would withdraw it anyway); the next tick re-stages
    // radio's change without it. When the engine had already taken that stage (its ack won the
    // race), the applied marker follows the held change, as nothing is to be staged again: the
    // landing commits the rest and its push puts this row's truth back.
    if (
      led !== null &&
      !manualChangesRef.current.has(slotId) &&
      (led.companions ?? []).some((k) => k.slotId === slotId)
    ) {
      const next = { ...led, companions: (led.companions ?? []).filter((k) => k.slotId !== slotId) }
      if (radioStageAppliedLedRef.current === led) radioStageAppliedLedRef.current = next
      setRadioLedChange(next)
      cancelStagedSwap('manual-overrides-companion')
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
    arrival: ManualArrival | null = null,
    /** A hook's own landing (the hook step): `stem` is its stem, already warm, so the entry is
     * ready at once and the turnaround's roll in this same deferred slot counts it. */
    opts: {
      hook?: 'exit' | 'return'
      stem?: ResolvedCandidateStem
      rest?: true
      /** The intensity arc's own landing (intensityDecided). */
      arc?: 'rest' | 'return'
    } = {}
  ): boolean {
    const waiting = manualChangesRef.current.get(slotId)
    // A hook's return due with the drop on a row the drop brings back: the hook's stem comes back
    // in place of the arc's (spec 5.2: returns pulled to the drop land with it).
    const hookOverArc = waiting?.arc === 'return' && opts.hook === 'return'
    if (hookOverArc) {
      // The arc's return may already ride a stage: the engine would swap its stem in, not the
      // hook's. Withdrawn while it can be re-staged; too late, or already taken, the hook gives
      // way (it is tried again at its next phrase start).
      const staged = radioStageRef.current?.manual?.has(slotId) === true
      const taken = radioStageAppliedManualRef.current?.has(slotId) === true
      if (taken || (staged && radioBarsToWrapNow() < MANUAL_RESTAGE_MIN_BARS)) return false
      if (staged) cancelStagedSwap('hook-over-arc')
    }
    if (waiting !== undefined && !hookOverArc) {
      // A hook's landing gives way to any manual change for its row (spec 2.7): withdrawn, it is
      // tried again at the next line or phrase start. A hook never displaces anything. The
      // intensity arc's landing gives way the same (the arc lets the row go), and displaces
      // nothing.
      const landing = waiting.hook !== undefined || waiting.arc !== undefined
      if (!landing || opts.hook !== undefined || opts.arc !== undefined) return false
      withdrawManualChange(
        slotId,
        waiting.hook !== undefined ? 'hook-yields-to-manual' : 'arc-yields-to-manual'
      )
    }
    const next = new Map(manualChangesRef.current)
    const preset = opts.stem ?? null
    next.set(slotId, {
      pick,
      stem: preset,
      joining,
      arrival,
      undoSeq,
      radioSkip,
      ...(opts.hook !== undefined && { hook: opts.hook }),
      ...(opts.rest === true && { rest: true as const }),
      ...(opts.arc !== undefined && { arc: opts.arc })
    })
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
    if (preset !== null) {
      manualChangeReady(slotId)
      return true
    }
    void resolveAndWarmPick(pick).then((stem) => {
      const entry = manualChangesRef.current.get(slotId)
      if (entry === undefined || entry.pick !== pick) return
      if (stem === null) {
        // Unresolvable: drop it. The row keeps what it had -- the same
        // soft degradation every other Discover path takes.
        const dropped = new Map(manualChangesRef.current)
        dropped.delete(slotId)
        setManualChanges(dropped)
        if (entry.hook !== undefined) {
          updateRadioHooks(withdrawRadioHookEvent(radioHooksRef.current, slotId))
        }
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
      manualChangeReady(slotId)
    })
    return true
  }
  /** A queued manual change just became ready (its stem resolved). A stage already out was built
   * without it (it was still resolving): withdraw it so the next tick re-stages with it --
   * unless the wrap is too close for a rebuild to get there, in which case the stage that is out
   * lands as it is and this one waits for the following wrap (the landing only commits what the
   * engine took). And never a stage radio aimed at a mid-lap bar: that one can never carry a
   * manual change. */
  function manualChangeReady(slotId: string): void {
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

  /** Every armed gesture spent by `bar` of this lap (radioArrivalGestureSpent) -- true of an
   * empty list. A leading gesture never is. */
  function gesturesSpentAt(bar: number, loopBars: number): boolean {
    return radioGestureRef.current.every((g) => radioArrivalGestureSpent(g, bar, loopBars))
  }

  /** The held change's companions whose rows are still eligible (radioHeldCompanionsKept): what
   * the stage carries and the landing commits. A padlock or a mute set after the decision stops
   * one, as it stops radio's own row -- stepRadioStage (1) takes it out of the held change and
   * withdraws the stage; this is the same rule at the stage build and at the landing (a lock in
   * the last 30 ms before a wrap: not committed, and the landing's push puts the row back). */
  function radioStagedCompanions(led: {
    companions?: RadioHeldCompanion[]
  }): readonly RadioHeldCompanion[] {
    return radioHeldCompanionsKept(led.companions ?? [], radioEligibleSlotIds())
  }

  /** Commits radio's companions right after its own change has committed, in the same
   * microtask: each a cut, its push folded into the change's held one (holdSyncUntilResolved),
   * noted for the turnaround's and fold's rolls as any landing is. A row removed meanwhile is
   * skipped. The caller leaves out any a manual change won at this landing. Returns the rows
   * that landed. radioLastSlotRef stays radio's own row. */
  function landRadioCompanions(
    companions: readonly RadioHeldCompanion[],
    midLoop: boolean,
    loopBars: number
  ): string[] {
    const landed: string[] = []
    for (const k of companions) {
      if (!slotsRef.current.some((s) => s.id === k.slotId)) continue
      commitSlotPick(k.slotId, k.pick)
      noteTurnaroundLanding(k.slotId, k.stem.barLength)
      noteFoldLanding(k.slotId, k.pick, k.stem)
      // the fold machine follows it, carried or released, as radio's own row (radioFoldLandNow)
      radioFoldLandNow(k.slotId, k.pick, k.stem, k.foldCarry === true, midLoop, loopBars)
      holdSyncUntilResolved(k.slotId)
      landed.push(k.slotId)
    }
    return landed
  }

  /** Whether `slotId` rides radio's held change or its armed pick as a companion. */
  function radioCompanionOf(slotId: string): boolean {
    return (
      (radioLedChangeRef.current?.companions ?? []).some((k) => k.slotId === slotId) ||
      (radioPendingRef.current?.companions ?? []).some((k) => k.slotId === slotId)
    )
  }

  /** A row radio's armed pick had as a companion is someone else's now (claimed, removed): it
   * leaves the pick; radio's own row and the other companions stay armed. */
  function dropRadioPendingCompanion(slotId: string): void {
    const pending = radioPendingRef.current
    if (pending === null || !pending.companions.some((k) => k.slotId === slotId)) return
    setRadioPending({
      ...pending,
      companions: pending.companions.filter((k) => k.slotId !== slotId)
    })
  }

  /** The rows riding radio's armed pick NOW (radioCompanionsRiding: READY ones only, this tick's
   * eligibility, the manual queue, the cadence's cap -- fold mode's too, the slider's rows above
   * fast). One still warming is not in the change: dropped, never waited for (spec section 3).
   * The ONE set the clock's
   * grid reads, a decision holds, the readout counts and the rows breathe with, so a decision
   * holds exactly what the grid saw. */
  function radioPendingCompanionsNow(pending: {
    slotId: string
    companions: RadioPendingCompanion[]
  }): (RadioPendingCompanion & { stem: ResolvedCandidateStem })[] {
    if (pending.companions.length === 0) return []
    return radioCompanionsRiding<ResolvedCandidateStem, RadioPendingCompanion>(pending.companions, {
      primarySlotId: pending.slotId,
      eligible: radioEligibleSlotIds(),
      manual: manualChangesRef.current,
      max: radioCompanionCap(radioCadence)
    })
  }
  /** The companions a decision holds with radio's change (radioPendingCompanionsNow). */
  function radioHeldCompanionsFrom(pending: {
    slotId: string
    companions: RadioPendingCompanion[]
  }): RadioHeldCompanion[] {
    return radioPendingCompanionsNow(pending).map((k) => ({
      slotId: k.slotId,
      pick: k.pick,
      stem: k.stem
    }))
  }
  /** The rows riding radio's armed pick as its landing will take them: on a mid-loop bar line
   * (`midLoop`) fold's bar band leaves off a companion on a held row that would cut its fold
   * straight (radioFoldBarCompanionsNow), as the decision does; a loop-top landing takes every
   * riding one (radioPendingCompanionsNow). What the readout names and the rows breathe with. */
  function radioPendingRidersAt(
    pending: { slotId: string; companions: RadioPendingCompanion[] },
    midLoop: boolean
  ): readonly { slotId: string }[] {
    const riding = radioPendingCompanionsNow(pending)
    return midLoop ? radioFoldBarCompanionsNow(riding) : riding
  }
  /** The armed rows the rows breathe with: the riding set as its landing will take them
   * (radioPendingRidersAt), joined (see radioArmedCompanionKey). */
  function radioArmedCompanionKeyOf(
    pending: { slotId: string; companions: RadioPendingCompanion[] } | null,
    midLoop: boolean
  ): string {
    return pending === null
      ? ''
      : radioPendingRidersAt(pending, midLoop)
          .map((k) => k.slotId)
          .join('\n')
  }

  /** An armRadioPick is awaiting its pick and has not been superseded (a superseded one writes
   * nothing, so it does not count). */
  function radioArmInFlight(): boolean {
    return (
      radioArmInFlightRef.current !== null &&
      radioArmInFlightRef.current === radioArmTokenRef.current
    )
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
        radioEligibleSlotIds().filter(
          (id) =>
            !manualChangesRef.current.has(id) &&
            !radioHookTurnoverExcluded(radioHooksRef.current, id)
        ),
        artistTurnoverRef.current
      ) !== null
    ) {
      void skipRadio()
      return
    }
    // Never a row with a manual change waiting: that change wins its row
    // at the landing (mergeStageChanges), so radio's pick for it would be
    // dropped there -- a change radio lost to a manual one.
    // Fold mode's folded rows are picked like any other (phase 2 of fold following pace, spec
    // 2026-10-03-radio-fold-follows-pace-design section 3): in its bar band a change on one
    // carries the fold when its stem can, else cuts straight and releases it (radioFoldLandNow).
    // Nor a row a hook keeps (radioHookTurnoverExcluded: a hook in, an event decided on it, or a
    // return being prepared): only the hook's own cycle changes it. So never a companion either.
    const eligible = radioEligibleSlotIds().filter(
      (id) =>
        !manualChangesRef.current.has(id) && !radioHookTurnoverExcluded(radioHooksRef.current, id)
    )
    // Rows per change (the pace slider, from 70, fold mode too; @shared/radioPace): no draw while
    // it is one, and the first row is exactly pickRadioSlotId's. The rest ride radio's change as
    // companions.
    const rows = radioPaceRowsThisChange(radioCadence, Math.random)
    const [slotId, ...more] = pickRadioSlotIds(eligible, radioLastSlotRef.current, rows, {
      turnover: radioSettings.turnover,
      changedAt: radioChangedAtRef.current,
      turn: radioTurnRef.current,
      flags: radioSlotFlagsRef.current
    })
    if (slotId === undefined) return
    const slot = slotsRef.current.find((s) => s.id === slotId)
    if (!slot) return
    const moreSlots = more.flatMap((id) => {
      const s = slotsRef.current.find((x) => x.id === id)
      return s ? [s] : []
    })
    // ONE in-flight token for the whole set: every pick is awaited together (in parallel, so a
    // companion costs no extra wait), and the arm is either current when they have all returned
    // or writes nothing. A slow pick holds the arm back as a slow primary always has -- the due
    // branch leaves an arm in flight alone, and nothing is pending meanwhile, so nothing can land
    // late on its account.
    radioArmInFlightRef.current = myArm
    let pick: Awaited<ReturnType<typeof pickForSlot>>
    let morePicks: Awaited<ReturnType<typeof pickForSlot>>[]
    try {
      ;[pick, ...morePicks] = await Promise.all([
        pickForSlot(slotId, slot.kinds, { avoidOwnStem: true }),
        ...moreSlots.map((s) => pickForSlot(s.id, s.kinds, { avoidOwnStem: true }))
      ])
    } finally {
      if (radioArmInFlightRef.current === myArm) radioArmInFlightRef.current = null
    }
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
    // The companions worth keeping: a pick, a row no manual change has claimed meanwhile, and a
    // stem nobody else drew (radioUsableCompanionPicks).
    const companions: RadioPendingCompanion[] = radioUsableCompanionPicks(
      pick.candidate.stemCID,
      moreSlots.map((s, i) => ({ slotId: s.id, pick: morePicks[i] })),
      manualChangesRef.current
    ).map((k) => ({ slotId: k.slotId, pick: k.pick, stem: null, incomingBars: null }))
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
    setRadioPending({ slotId, pick, incomingBars: null, stem: null, companions })
    // Each companion warmed as radio's own pick is, and written back only while that pick is
    // still the pending one. One that cannot resolve leaves: a length never known would hold
    // the whole change to the loop top (radioChangeLengths) for nothing.
    for (const k of companions) {
      void resolveAndWarmPick(k.pick).then((stem) => {
        const now = radioPendingRef.current
        if (now === null || now.pick !== pick || !radioOnRef.current) return
        setRadioPending({
          ...now,
          companions: now.companions.flatMap((c) =>
            c.pick !== k.pick
              ? [c]
              : stem === null
                ? []
                : [{ ...c, stem, incomingBars: stem.barLength }]
          )
        })
      })
    }
  }

  // --- the density arc (2026-10-01; @shared/radioDensity) ---

  function resetDensityArc(): void {
    // An add held for the phrase start (sized builds) is a row already on the panel: it lands now
    // (radio off), as every waiting change does when radio stops -- or joins at the next top.
    const held = arcAddingRef.current
    if (held?.held !== undefined && slotsRef.current.some((s) => s.id === held.slotId)) {
      if (radioOnRef.current) queueHeldArcAdd()
      else commitSlotPick(held.slotId, held.held.pick)
    }
    densityLegRef.current = null
    arcAddingRef.current = null
    arcExitRef.current = null
    resetIntensityArc()
  }

  /** Every radio tick. At a loop top the leg advances and may start a
   * step; on every tick a row on its way out is moved along. Deferred, as
   * everything in the tick that sets state is. */
  function densityTick(
    wrapped: boolean,
    pos: number,
    loopBars: number,
    lapStarts: boolean,
    lap: number
  ): void {
    const density = radioDensityOf(radioSettings)
    // Density left `intensity` while radio runs: the arc's rests come back at the next top.
    if (density !== 'intensity' && intensityArcRef.current !== null) {
      const was = intensityArcRef.current
      intensityArcRef.current = null
      void Promise.resolve().then(() => intensityLeft(was))
    } else if (density !== 'intensity' && radioRestingRef.current.size > 0) {
      // the arc gone: a rest of its that is back in the mix (by hand, or a return that landed
      // late) is no rest; one with nothing queued to end it (its bring-back lost to a hand change
      // since withdrawn) comes back at the next top with its own stem, as intensityAtWrap's
      // "rests for nothing" -- deferred, as everything in the tick that sets state is
      const sweep = intensityRestSweep([...radioRestingRef.current], {
        live: new Set(slotsRef.current.map((s) => s.id)),
        holds: new Set(),
        queued: (id) => manualChangesRef.current.has(id),
        inMix: (id) => previewingSlotIdsRef.current.has(id)
      })
      for (const id of sweep.gone) radioRestingRef.current.delete(id)
      if (sweep.back.length > 0) {
        void Promise.resolve().then(() => {
          if (!radioOnRef.current || intensityOn()) return
          for (const id of sweep.back) {
            if (
              radioRestingRef.current.get(id) !== 'arc' ||
              manualChangesRef.current.has(id) ||
              previewingSlotIdsRef.current.has(id)
            ) {
              continue
            }
            console.log(`[radio-intensity] ${id} rests for nothing (arc off): back at the next top`)
            intensityBringBack(id, null)
          }
        })
      }
    }
    if (density === 'intensity') {
      if (wrapped) arcLapRef.current += 1
      // Switched to `intensity` while radio runs: a machine that begins at the next phrase start
      // (spec 5.7); an add the density arc held for its phrase start joins at the next top, as
      // when it switches off.
      const switched = intensityArcRef.current === null
      if (switched) {
        intensityArcRef.current = newRadioIntensityArc()
        densityLegRef.current = null
      }
      void Promise.resolve().then(() => {
        if (!radioOnRef.current) return
        if (switched && arcAddingRef.current?.held !== undefined) queueHeldArcAdd()
        stepArcExit(pos, loopBars)
        if (wrapped) {
          intensityAtWrap(loopBars, lap)
          refreshRadioArcShown()
        }
      })
      return
    }
    if (density !== 'arc') {
      // the arc switched off with an add held for the phrase start: it joins at the next top
      if (arcAddingRef.current?.held !== undefined) {
        void Promise.resolve().then(() => {
          if (radioOnRef.current) queueHeldArcAdd()
        })
      }
      return
    }
    if (wrapped) arcLapRef.current += 1
    void Promise.resolve().then(() => {
      if (!radioOnRef.current) return
      stepArcExit(pos, loopBars)
      if (wrapped) densityAtWrap(loopBars, lapStarts)
    })
  }

  /** `lapStarts`: this wrap starts a phrase's last lap (the clock's turnaroundLapStarts), so a
   * step decided here lands on the phrase start. With sized builds a ready step waits for that
   * wrap, at most a phrase past ready (radioArcStepWaits; spec 4.5). */
  function densityAtWrap(loopBars: number, lapStarts: boolean): void {
    const rows = slotsRef.current
    // An add held for the phrase start (sized builds) is queued at the wrap that starts the
    // phrase's last lap -- before this wrap's roll, which counts it -- so it joins on the phrase
    // start.
    if (lapStarts && arcAddingRef.current?.held !== undefined) queueHeldArcAdd()
    const adding = arcAddingRef.current
    // A joining row is done once its change has landed or gone.
    if (
      adding !== null &&
      !adding.picking &&
      adding.held === undefined &&
      !manualChangesRef.current.has(adding.slotId)
    ) {
      arcAddingRef.current = null
    }
    const kind = nextArcKind(rows.map((r) => r.kinds))
    const removal = arcRemovalCandidate()
    const legWas = densityLegRef.current ?? newDensityLeg('growing', rows.length)
    // Sized builds: an add is decided a lap before the phrase end's roll (radioWrapBeforeLastLap),
    // picked and warmed through that lap, and held until the roll's wrap (queueHeldArcAdd), so the
    // roll counts it as ready and it joins on the phrase start; a removal at the roll's wrap, as
    // its exit fades over the last lap.
    const sized = radioSizedBuildsOf(radioSettings)
    const addEarly =
      sized &&
      legWas.phase === 'growing' &&
      radioWrapBeforeLastLap(
        radioClockRef.current?.turnaroundLap ?? 0,
        turnaroundPhraseLaps(radioCadence.turnaroundPhraseBars, loopBars)
      )
    const { leg, step } = advanceDensityLeg(legWas, {
      count: rows.length,
      loopBars,
      busy: arcAddingRef.current !== null || arcExitRef.current !== null,
      canAdd: kind !== null,
      canRemove: removal !== null,
      waits: radioArcStepWaits({
        sized,
        decidesForPhraseStart: legWas.phase === 'growing' && sized ? addEarly : lapStarts,
        overdueBars: legWas.bars + loopBars - legWas.stepBars,
        phraseBars: turnaroundPhraseLaps(radioCadence.turnaroundPhraseBars, loopBars) * loopBars
      })
    })
    densityLegRef.current = leg
    if (step === 'add' && kind !== null) void arcAddRow(kind, addEarly)
    else if (step === 'remove' && removal !== null) {
      arcExitRef.current = { slotId: removal, phase: 'waiting', lap: arcLapRef.current }
    }
  }

  /** A hook rests on the row, or its rest is decided for the coming wrap. */
  function radioRestingNow(id: string): boolean {
    if (radioRestingRef.current.has(id)) return true
    const d = radioHookOf(radioHooksRef.current, id)?.decided
    return d?.event === 'exit' && d.rest
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
        // a hook's home, in any state: reserved for it
        held: radioHookReservesRow(radioHooksRef.current, s.id),
        // a row a hook rests on (or will, from the coming wrap) is not heard: it does not count as
        // the drums or bass that lets another go. (Absent otherwise: as before.)
        ...(radioRestingNow(s.id) && { heard: false }),
        busy:
          manualChangesRef.current.has(s.id) ||
          radioSkipPickingRef.current.has(s.id) ||
          led?.slotId === s.id ||
          // a row riding radio's change, held or armed: never taken out mid-change
          radioCompanionOf(s.id) ||
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
  async function arcAddRow(kind: DiscoverSlotKind, hold = false): Promise<void> {
    const id = freshSlotId()
    arcAddingRef.current = { slotId: id, picking: true, kinds: [kind] }
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
    if (hold) {
      // Sized builds: decided a lap before the phrase end's roll -- warmed now, queued at the
      // roll's wrap (queueHeldArcAdd, densityAtWrap), so it is ready there and joins on the phrase
      // start. One that cannot resolve is queued at once, where the manual queue's own failure
      // path deals with it.
      arcAddingRef.current = { slotId: id, picking: false, kinds: [kind], held: { pick } }
      void resolveAndWarmPick(pick).then((stem) => {
        const now = arcAddingRef.current
        if (now === null || now.slotId !== id || now.held?.pick !== pick) return
        if (stem === null) {
          if (radioOnRef.current) queueHeldArcAdd()
          return
        }
        arcAddingRef.current = { ...now, warm: true }
      })
      return
    }
    arcAddingRef.current = { slotId: id, picking: false, kinds: [kind] }
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

  /** Queues the arc's add held for the phrase start (arcAddRow's `hold`) as a joining manual
   * change: it lands at the next top. Its warm flag stays, so the roll counts it as ready. */
  function queueHeldArcAdd(): void {
    const a = arcAddingRef.current
    if (a === null || a.held === undefined) return
    if (!slotsRef.current.some((s) => s.id === a.slotId)) {
      arcAddingRef.current = null
      return
    }
    const kinds = [...(a.kinds ?? [])]
    arcAddingRef.current = {
      slotId: a.slotId,
      picking: false,
      kinds,
      ...(a.warm === true && { warm: true })
    }
    const queued = queueManualChange(
      a.slotId,
      a.held.pick,
      true,
      undoSequence.latest(),
      false,
      densityArrival(radioSettings.transitions, kinds)
    )
    if (!queued) arcAddingRef.current = null
  }

  // --- the intensity arc (spec 2026-10-05-radio-intensity-arc-design; @shared/radioIntensityArc) ---
  //
  // Density `intensity` runs the machine where the density arc ran (densityTick's microtask, the
  // first slot of a wrap: before the hook step, the fold step and the turnaround's roll, which
  // read what it decides). It adds and strips rows by the density arc's own paths (arcAddRow held
  // and warmed a lap early, queueHeldArcAdd, arcExitRef), rests rows by the hooks' resting
  // landing (a manual-queue entry with `rest`, the stage's `leaving`, radioRestingRef owned by
  // `arc`) and brings them back the same way (`return`: a joining cut, its own stem or a renewal
  // warmed a phrase ahead). Under any other density nothing here runs.

  /** Radio's density is `intensity` (the panel's setting; the machine is intensityArcRef). */
  function intensityOn(): boolean {
    return radioDensityOf(radioSettings) === 'intensity'
  }

  /** Radio starting or stopping: no machine, nothing prepared. */
  function resetIntensityArc(): void {
    intensityArcRef.current = null
    setRadioArcShown(null)
    intensityDropThrowRef.current = null
    dropIntensityNextAdd()
    intensityCarryRef.current = null
    intensityRenewRef.current = new Map()
    intensityJoiningRef.current = new Set()
    intensityJoinDecidedRef.current = null
    intensityThrowOwedRef.current = null
  }

  /** Density left `intensity` while radio ran (densityTick): a rest still queued is withdrawn
   * (the row plays on), every row the arc rests comes back with its own stem at the next top (a
   * joining arc return), and what it prepared is let go (radioIntensityStopped). Radio off
   * meanwhile: stopRadio put the rows back. */
  function intensityLeft(was: RadioIntensityArc): void {
    const { unrest } = radioIntensityStopped(was)
    setRadioArcShown(null)
    intensityDropThrowRef.current = null
    dropIntensityNextAdd()
    intensityCarryRef.current = null
    intensityRenewRef.current = new Map()
    intensityJoiningRef.current = new Set()
    intensityJoinDecidedRef.current = null
    intensityThrowOwedRef.current = null
    if (!radioOnRef.current) return
    const resting = [...radioRestingRef.current].flatMap(([id, owner]) =>
      owner === 'arc' ? [id] : []
    )
    for (const id of new Set([...unrest, ...resting])) {
      if (manualChangesRef.current.get(id)?.arc === 'rest') withdrawManualChange(id, 'arc-off')
      if (radioRestingRef.current.get(id) === 'arc') intensityBringBack(id, null)
    }
    console.log('[radio-intensity] off: its rests come back')
  }

  /** The bed as the machine counts it (the rows the arc added and not landed yet are left out),
   * and its rows (RadioIntensityRow): sounding is heard and not resting (a hook's or the arc's,
   * or a hook's rest landing at the coming wrap) nor the row the density arc's exit takes out;
   * restable (spec 4.1's never-rested list) is unlocked, not the soloed row, no change waiting
   * on it (a manual change, a hook's or the arc's landing, a skip picking), not riding or
   * carrying radio's change. */
  function intensityRowsNow(): { bed: DiscoverSlot[]; rows: RadioIntensityRow[] } {
    const joining = intensityJoiningRef.current
    const bed = slotsRef.current.filter((s) => !joining.has(s.id))
    const previewing = previewingSlotIdsRef.current
    const arcOut = arcExitRef.current?.slotId ?? null
    const rows = bed.map((s): RadioIntensityRow => {
      const sounding = previewing.has(s.id) && !radioRestingNow(s.id) && s.id !== arcOut
      return {
        id: s.id,
        kinds: s.kinds,
        score: s.candidate?.intensity ?? null,
        staleness: radioTurnRef.current - (radioChangedAtRef.current.get(s.id) ?? 0),
        sounding,
        restable:
          sounding &&
          !s.locked &&
          !(previewing.size === 1 && previewing.has(s.id)) &&
          s.candidate !== null &&
          resolvedStemsRef.current.has(s.id) &&
          !manualChangesRef.current.has(s.id) &&
          !radioSkipPickingRef.current.has(s.id) &&
          radioLedChangeRef.current?.slotId !== s.id &&
          !radioCompanionOf(s.id)
      }
    })
    return { bed, rows }
  }

  /** What a button's event may do with the rows now (planning decision 8): an add when the arc's
   * held add is warm or one can be picked, a strip when a row can go. */
  function intensityRoomNow(): RadioIntensityRoom {
    const { bed } = intensityRowsNow()
    const adding = arcAddingRef.current
    return {
      count: bed.length,
      max: DENSITY_MAX,
      canAdd:
        (adding?.held !== undefined &&
          adding.warm === true &&
          slotsRef.current.some((s) => s.id === adding.slotId)) ||
        (intensityMayPickAdd({
          adding: adding !== null,
          nextAdd: intensityNextAddRef.current !== null
        }) &&
          nextArcKind(bed.map((s) => s.kinds)) !== null),
      canStrip: arcExitRef.current === null && arcRemovalCandidate() !== null
    }
  }

  /** The arc lets a row go (spec 4.2; planning decision 15): out of its rests and its decided
   * lists, its renewal and any landing of the arc's on it dropped, and -- resting -- out of
   * radio's rests, back in the mix at once when `rejoin` (else the caller puts it there). The
   * drop still lands for the others. */
  function releaseIntensityRow(rowId: string, rejoin = true): void {
    const arc = intensityArcRef.current
    if (arc !== null) intensityArcRef.current = releaseRadioIntensityRest(arc, rowId)
    intensityRenewRef.current.delete(rowId)
    if (manualChangesRef.current.get(rowId)?.arc !== undefined) {
      withdrawManualChange(rowId, 'arc-released')
    }
    if (radioRestingRef.current.get(rowId) !== 'arc') return
    radioRestingRef.current.delete(rowId)
    if (
      rejoin &&
      slotsRef.current.some((s) => s.id === rowId) &&
      !previewingSlotIdsRef.current.has(rowId)
    ) {
      scheduleSyncPreviewToEngine(joinPreviewingMix(rowId))
    }
  }

  /** The arc puts a row on the panel (arcAddRow, held for its phrase start or queued at once):
   * not on its bed until its event lands. */
  function intensityAddRow(kind: DiscoverSlotKind, hold: boolean): string | null {
    void arcAddRow(kind, hold)
    const id = arcAddingRef.current?.slotId ?? null
    if (id !== null) intensityJoiningRef.current.add(id)
    return id
  }

  /** The arc's step at a wrap (densityTick's microtask, after the clock's lap bookkeeping and
   * before the hook step, the fold step and the roll: timing risk 1). In order: rows gone are let
   * go; the step (the event decided at the last wrap lands in the machine: its rows land through
   * the manual queue at this wrap); what landed; what is prepared (a phrase ahead) and decided
   * (binding, for the next wrap); then, a lap before a decide wrap, the add it will want, picked
   * and warmed (planning decision 14; after the step, so a phrase start's count is in). */
  function intensityAtWrap(loopBars: number, lap: number): void {
    let arc = intensityArcRef.current
    if (arc === null) return
    // rows gone (removed, an undo, a project swap): let go
    const live = new Set(slotsRef.current.map((s) => s.id))
    for (const id of intensityRowsHeld(arc)) {
      if (!live.has(id)) arc = releaseRadioIntensityRest(arc, id)
    }
    // A row resting for the arc that the arc no longer holds, with nothing queued to bring it
    // back (its return given up to a manual change since withdrawn, a release that left it
    // resting): back at the next top with its own stem. Read before the step, so the rows a drop
    // landing at this wrap brings back are still the arc's.
    const sweep = intensityRestSweep([...radioRestingRef.current], {
      live,
      holds: new Set(intensityRowsHeld(arc)),
      queued: (id) => manualChangesRef.current.has(id)
    })
    for (const id of sweep.gone) radioRestingRef.current.delete(id)
    for (const id of sweep.back) {
      console.log(`[radio-intensity] ${id} rests for nothing: back at the next top`)
      intensityBringBack(id, null)
    }
    for (const id of [...intensityJoiningRef.current]) {
      if (!live.has(id) && !(intensityJoinDecidedRef.current === id)) {
        intensityJoiningRef.current.delete(id)
      }
    }
    for (const id of [...intensityRenewRef.current.keys()]) {
      if (!live.has(id)) intensityRenewRef.current.delete(id)
    }
    // the arc's joining row is done once its change has landed or gone (as densityAtWrap)
    const adding = arcAddingRef.current
    if (
      adding !== null &&
      !adding.picking &&
      adding.held === undefined &&
      !manualChangesRef.current.has(adding.slotId)
    ) {
      arcAddingRef.current = null
    }
    // the next add (a one-lap phrase's), picked, takes the held slot once the earlier has landed
    const nx = intensityNextAddRef.current
    if (arcAddingRef.current === null && nx !== null && nx.pick !== null) {
      intensityNextAddRef.current = null
      if (slotsRef.current.some((s) => s.id === nx.slotId)) {
        arcAddingRef.current = {
          slotId: nx.slotId,
          picking: false,
          kinds: [...nx.kinds],
          held: { pick: nx.pick },
          ...(nx.warm && { warm: true })
        }
      } else intensityJoiningRef.current.delete(nx.slotId)
    }
    const phraseLaps = turnaroundPhraseLaps(radioCadence.turnaroundPhraseBars, loopBars)
    const { bed, rows } = intensityRowsNow()
    const held = arcAddingRef.current
    const carry = intensityCarryRef.current
    const r = stepRadioIntensityArc(arc, {
      energy: radioEnergyOf(radioSettings),
      drama: radioDramaOf(radioSettings),
      loopBars,
      lap,
      phraseLaps,
      // the desktop's clock stops on pause: the arc counts only the wraps it sees (timing risk 5)
      held: false,
      count: bed.length,
      min: DENSITY_MIN,
      max: DENSITY_MAX,
      rows,
      canAdd:
        held?.held !== undefined &&
        held.warm === true &&
        slotsRef.current.some((s) => s.id === held.slotId),
      canStrip: arcExitRef.current === null && arcRemovalCandidate() !== null,
      carryReady: carry !== null && carry.pick !== null && carry.stem !== null,
      renewReady: (id) => (intensityRenewRef.current.get(id)?.stem ?? null) !== null,
      random: Math.random
    })
    intensityArcRef.current = r.state
    if (r.overran) console.log('[radio-intensity] breakdown overran')
    if (r.applied !== null) intensityApplied(r.applied)
    if (r.prepare !== null) intensityPrepare(r.prepare, r.state)
    const P = Math.max(1, Math.floor(phraseLaps))
    const decideWrap = ((Math.floor(lap) % P) + P) % P === P - 1
    // An add held for a phrase start its decide wrap did not take (not warm, or another event
    // came): kept while the build goes on, else it goes (a silent row with nothing to join).
    // Before the decision is carried out, so a breakdown's carry row is the arc's joining row.
    const a = arcAddingRef.current
    if (
      a !== null &&
      a.held !== undefined &&
      intensityHeldAddGoes(r.state, { decideWrap, tookAdd: r.decided?.event === 'add' })
    ) {
      arcAddingRef.current = null
      intensityJoiningRef.current.delete(a.slotId)
      if (slotsRef.current.some((s) => s.id === a.slotId)) dropSlot(a.slotId)
    }
    if (r.decided !== null) intensityDecided(r.decided)
    const now = intensityArcRef.current
    // A one-lap phrase decides at every wrap, so the add after the one just decided has no lap to
    // be picked in: picked and warmed now, as if that add had landed (its phrase counted), and
    // held for the next decide wrap (intensityNextAddRef).
    if (P === 1 && r.decided?.event === 'add' && arcAddingRef.current !== null) {
      const { bed: after } = intensityRowsNow()
      const landed = { ...now, decided: null, done: now.done + 1 }
      if (radioIntensityAddComing(landed, after.length + 1)) {
        const kind = nextArcKind([...after.map((s) => s.kinds), arcAddingRef.current.kinds ?? []])
        if (kind !== null) intensityPickNextAdd(kind)
      }
    }
    // a lap early: the add the coming decide wrap will want -- not while a one-lap phrase's next
    // add is still picking (it takes the held slot once picked: this would be a second silent row)
    if (
      intensityMayPickAdd({
        adding: arcAddingRef.current !== null,
        nextAdd: intensityNextAddRef.current !== null
      }) &&
      radioWrapBeforeLastLap(lap, phraseLaps)
    ) {
      const { bed: after } = intensityRowsNow()
      if (radioIntensityAddComing(now, after.length)) {
        const kind = nextArcKind(after.map((s) => s.kinds))
        if (kind !== null) intensityAddRow(kind, true)
      }
    }
  }

  /** The next add for a one-lap phrase (intensityAtWrap): a silent row on the panel at once
   * (the arc's joining row), picked and warmed; it takes the held slot once the earlier add has
   * landed. One that cannot be picked goes. */
  function intensityPickNextAdd(kind: DiscoverSlotKind): void {
    if (intensityNextAddRef.current !== null) return
    const next: {
      slotId: string
      kinds: readonly DiscoverSlotKind[]
      pick: SlotPick | null
      warm: boolean
    } = {
      slotId: freshSlotId(),
      kinds: [kind],
      pick: null,
      warm: false
    }
    const id = next.slotId
    intensityNextAddRef.current = next
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
    intensityJoiningRef.current.add(id)
    void pickForSlot(id, [kind]).then((pick) => {
      if (intensityNextAddRef.current !== next) return
      if (pick === null || pick.candidate === null || !radioOnRef.current) {
        dropIntensityNextAdd()
        return
      }
      next.pick = pick
      void resolveAndWarmPick(pick).then((stem) => {
        if (stem === null) {
          if (intensityNextAddRef.current === next) dropIntensityNextAdd()
          return
        }
        next.warm = true
        // taken into the held slot meanwhile: warm there too (the decide wrap's canAdd)
        const a = arcAddingRef.current
        if (a !== null && a.slotId === id && a.held !== undefined) {
          arcAddingRef.current = { ...a, warm: true }
        }
      })
    })
    console.log(`[radio-intensity] the next add (${kind}) picked a phrase early on ${id}`)
  }

  /** The next add let go: radio off with its pick, it lands as a held add does
   * (resetDensityArc); otherwise its silent row goes. */
  function dropIntensityNextAdd(): void {
    const next = intensityNextAddRef.current
    if (next === null) return
    intensityNextAddRef.current = null
    intensityJoiningRef.current.delete(next.slotId)
    if (!slotsRef.current.some((s) => s.id === next.slotId)) return
    if (!radioOnRef.current && next.pick !== null) commitSlotPick(next.slotId, next.pick)
    else dropSlot(next.slotId)
  }

  /** The drop's own throw (spec 5.5), owed from the decision: the regular throws cannot aim into
   * it (the returns queued for the drop keep them from arming, and they are not loosened for it),
   * so it is armed live as the breakdown's echo is, two microtasks on -- after the wrap's landings
   * and the phrase end's roll, whose gap it reads -- and, while a roll or a turn for the drop's
   * top is still to come, on the ticks after (intensityDropThrowTick), never with a stage out. */
  function intensityDropThrowOwed(): void {
    intensityDropThrowRef.current = {
      seq: intensityDecidedSeqRef.current,
      lap: radioPlayRef.current.lap,
      landed: new Map(),
      waited: null
    }
    void Promise.resolve().then(() => Promise.resolve().then(() => intensityDropThrowTick()))
  }

  /** The drop's owed throw, armed when it can be: on one heard row that may take a throw (never
   * drums or bass, never one silenced before it closes), ending on the drop's top or, with a riser
   * gap armed, where the gap starts (discoverThrowAim), its shape drawn here. Waits while the
   * roll or a turn for that top is still to come, or a stage is out (arming pushes, and a push
   * withdraws a stage), or a length landed at the decide wrap is not known yet; given up once its
   * lap has ended (the drop's own top: it would end a lap late), it no longer fits the lap, or with
   * nothing to throw (intensityDropThrowStep). The lap is the one the decide wrap's landings make
   * (intensityLapAfterLandings: resolvedBarLengthsRef learns them only a render later), and the
   * position the throw clock's own (its lastPos, which its elapsed bars count to: this runs
   * before radioThrowTick steps it). */
  function intensityDropThrowTick(): void {
    const owed = intensityDropThrowRef.current
    if (owed === null) return
    const arc = intensityOn() ? intensityArcRef.current : null
    const giveUp = (why: string | null): void => {
      intensityDropThrowRef.current = null
      if (why !== null) console.log(`[radio-intensity] the drop's throw: ${why}`)
    }
    if (
      !radioOnRef.current ||
      arc === null ||
      arc.decided?.event !== 'drop' ||
      intensityDecidedSeqRef.current !== owed.seq
    ) {
      giveUp(null)
      return
    }
    const throws = normalizeSoundSettings(sound ?? appSoundDefaultsNow()).throws
    if (!throws.on || !(throws.level > 0)) {
      giveUp(null)
      return
    }
    const step = intensityDropThrowStep({
      owedLap: owed.lap,
      lap: radioPlayRef.current.lap,
      waited: owed.waited,
      waitingOn:
        radioTurnaroundRollRef.current !== null
          ? 'the roll'
          : radioTurnPendingRef.current !== null
            ? 'the turn'
            : radioStageRef.current !== null
              ? 'a stage'
              : null,
      loopBars: intensityLapAfterLandings(
        resolvedBarLengthsRef.current,
        owed.landed,
        turnaroundLoopNow().loopBars
      ),
      pos: radioThrowRef.current.lastPos
    })
    if (step.act === 'give-up') {
      giveUp(step.why)
      return
    }
    if (step.act === 'wait') {
      owed.waited = step.on
      return
    }
    const { loopBars, pos } = step
    const previewing = previewingSlotIdsRef.current
    const aim = discoverThrowAim(
      radioTurnaroundRef.current?.plan,
      radioGestureRef.current,
      loopBars - pos,
      previewing
    )
    const slotId = pickDiscoverAimedThrowRow(
      slotsRef.current.map((s) => ({
        slot: s.id,
        kinds: s.kinds,
        audible:
          previewing.has(s.id) &&
          !radioRestingRef.current.has(s.id) &&
          manualChangesRef.current.get(s.id)?.rest !== true
      })),
      aim?.silenced ?? [],
      Math.random
    )
    if (slotId === null) {
      giveUp('dry (no row to throw)')
      return
    }
    const shape = { beats: drawThrowBeats(Math.random), ...drawThrowEcho(Math.random) }
    const armed = armDiscoverAimedThrow(radioThrowRef.current, {
      slotId,
      shape,
      pos,
      loopBars,
      endInBars: aim?.changeInBars ?? loopBars - pos,
      bpm: bpmRef.current
    })
    if (armed === null) {
      giveUp('dry (no room in the lap, or a throw already armed)')
      return
    }
    radioThrowRef.current = armed
    scheduleSyncPreviewToEngine(previewing)
    giveUp(
      `on ${slotId}, ${shape.beats} beats, ending on the ${(aim?.changeInBars ?? loopBars - pos) < loopBars - pos - 1e-6 ? 'gap' : 'drop'}`
    )
  }

  /** The arc ends a row's rest (a course change, the padlock): it lets the row go and brings it
   * back at the next top with its own stem, as the drop would; a landing of the arc's still
   * queued is withdrawn (a rest: the row plays on; a renewal: the row keeps its stem). */
  function intensityEndRest(rowId: string): void {
    const arc = intensityArcRef.current
    if (arc !== null) intensityArcRef.current = releaseRadioIntensityRest(arc, rowId)
    intensityRenewRef.current.delete(rowId)
    // a rest not landed: the row plays on; a return (perhaps a renewal): its own stem instead
    if (manualChangesRef.current.get(rowId)?.arc !== undefined) {
      withdrawManualChange(rowId, 'arc-rest-ended')
    }
    if (radioRestingRef.current.get(rowId) === 'arc') intensityBringBack(rowId, null)
  }

  /** The event decided at the last wrap landed in the machine (its rows land through the manual
   * queue at this same wrap): the row it brought in is on the bed from here, a drop's turn not
   * rolled by now goes, the breakdown's carry is spent. */
  function intensityApplied(d: RadioIntensityDecided): void {
    const joined = intensityJoinDecidedRef.current
    if (joined !== null && (d.event === 'add' || (d.event === 'breakdown' && d.carry))) {
      intensityJoiningRef.current.delete(joined)
      intensityJoinDecidedRef.current = null
    }
    if (d.event === 'breakdown') intensityCarryRef.current = null
    if (d.event === 'drop' && radioTurnPendingRef.current?.drop === true) {
      radioTurnPendingRef.current = null
      setRadioTurnShown(null)
    }
    const arc = intensityArcRef.current
    if (arc !== null && d.event !== 'add') {
      console.log(
        `[radio-intensity] ${arc.phase}${arc.big ? ' (bigger peak)' : ''}: ${arc.phrases} phrase${arc.phrases === 1 ? '' : 's'}`
      )
    }
  }

  /** A phrase ahead of a phase change (the step's prepare): the breakdown's carry row picked and
   * warmed, when nothing melodic would carry it; fresh picks for the drop's returning drums and
   * bass rows, leaned to the top target at full weight. Each yields its row to any other pick
   * (pickForSlot's yieldRow, the spares' way); one that fails is simply not ready at the decide
   * wrap (the own stem comes back; no carry row). */
  function intensityPrepare(p: { carry: boolean; renew: string[] }, arc: RadioIntensityArc): void {
    if (p.carry) {
      const kind = radioCarryKind(intensityRowsNow().bed)
      const carry: NonNullable<typeof intensityCarryRef.current> = {
        slotId: freshSlotId(),
        kind,
        pick: null,
        stem: null
      }
      intensityCarryRef.current = carry
      void pickForSlot(carry.slotId, [kind], { yieldRow: true }).then((pick) => {
        if (intensityCarryRef.current !== carry) return
        if (pick === null || pick.candidate === null || !radioOnRef.current) {
          intensityCarryRef.current = null
          return
        }
        carry.pick = pick
        void resolveAndWarmPick(pick).then((stem) => {
          if (intensityCarryRef.current !== carry) return
          if (stem === null) intensityCarryRef.current = null
          else carry.stem = stem
        })
      })
    }
    if (p.renew.length === 0) return
    const hi = radioIntensityTargets(
      radioEnergyOf(radioSettings),
      radioDramaOf(radioSettings),
      arc.big
    ).hi
    for (const id of p.renew) {
      const slot = slotsRef.current.find((s) => s.id === id)
      if (slot === undefined || slot.locked) continue
      const entry: { pick: SlotPick | null; stem: ResolvedCandidateStem | null } = {
        pick: null,
        stem: null
      }
      intensityRenewRef.current.set(id, entry)
      void pickForSlot(id, slot.kinds, {
        avoidOwnStem: true,
        yieldRow: true,
        intensity: { target: hi, drama: 100 }
      }).then((pick) => {
        if (intensityRenewRef.current.get(id) !== entry) return
        if (pick === null || pick.candidate === null || !radioOnRef.current) {
          intensityRenewRef.current.delete(id)
          return
        }
        entry.pick = pick
        void resolveAndWarmPick(pick).then((stem) => {
          if (intensityRenewRef.current.get(id) !== entry) return
          if (stem === null) intensityRenewRef.current.delete(id)
          else entry.stem = stem
        })
      })
    }
    console.log(
      `[radio-intensity] prepares ${[p.carry ? 'a carry row' : '', p.renew.length > 0 ? `renewals for ${p.renew.join(', ')}` : ''].filter((w) => w !== '').join(' and ')}`
    )
  }

  /** A row's warm renewal, when its stem still plays on no row. */
  function intensityRenewalOf(
    rowId: string
  ): { pick: SlotPick; stem: ResolvedCandidateStem } | null {
    const r = intensityRenewRef.current.get(rowId)
    if (r === undefined || r.pick === null || r.stem === null || r.pick.candidate === null) {
      return null
    }
    const stemId = r.pick.candidate.stemCID
    if (slotsRef.current.some((s) => s.candidate?.stemCID === stemId)) return null
    return { pick: r.pick, stem: r.stem }
  }

  /** The drop brings a row back at the next top (or renews a playing one): an arc `return`, a
   * cut, joining when the row rests -- with its renewal, or its own stem. A row that cannot be
   * queued (a manual change waits there: it wins the row, and its landing lets the arc go) stays
   * as it is; one with nothing to come back with joins the mix now. True when queued. */
  function intensityBringBack(
    rowId: string,
    renew: { pick: SlotPick; stem: ResolvedCandidateStem } | null
  ): boolean {
    const slot = slotsRef.current.find((s) => s.id === rowId)
    if (slot === undefined) return false
    const resting = radioRestingRef.current.get(rowId) === 'arc'
    const own = resolvedStemsRef.current.get(rowId)
    const back =
      renew ??
      (slot.candidate !== null && own !== undefined
        ? { pick: radioHookPickOf({ ...slot, candidate: slot.candidate }), stem: own }
        : null)
    const queued =
      back !== null &&
      queueManualChange(
        rowId,
        back.pick,
        resting && !previewingSlotIdsRef.current.has(rowId),
        Number.NEGATIVE_INFINITY,
        false,
        { kind: 'cut', beats: 4 },
        { arc: 'return', stem: back.stem }
      )
    if (!queued && resting && !manualChangesRef.current.has(rowId)) {
      radioRestingRef.current.delete(rowId)
      scheduleSyncPreviewToEngine(joinPreviewingMix(rowId))
    }
    return queued
  }

  /** What the arc decided for the next wrap (the step's, or a button's at once): carried out now,
   * so it lands at that wrap with everything else (the manual queue, the stage, the roll). */
  function intensityDecided(d: RadioIntensityDecided): void {
    intensityDecidedSeqRef.current += 1
    switch (d.event) {
      case 'cycle': {
        // the strip-back: the density arc's removal path (its exit fades over the lap)
        let stripped: string | null = null
        if (d.strip && arcExitRef.current === null) {
          stripped = arcRemovalCandidate()
          if (stripped !== null) {
            arcExitRef.current = { slotId: stripped, phase: 'waiting', lap: arcLapRef.current }
          }
        }
        console.log(
          `[radio-intensity] ${d.forced === true ? 'build pressed: ' : ''}a new cycle${d.next?.big === true ? ', a bigger peak' : ''}${stripped !== null ? `: strips ${stripped}` : ''}`
        )
        return
      }
      case 'add': {
        const a = arcAddingRef.current
        let id: string | null = null
        if (a?.held !== undefined) {
          id = a.slotId
          queueHeldArcAdd()
          if (arcAddingRef.current?.slotId !== id) id = null
        } else if (a !== null) id = a.slotId
        else if (
          intensityMayPickAdd({ adding: false, nextAdd: intensityNextAddRef.current !== null })
        ) {
          // a button's add with nothing held: picked now, joining at the first top it is ready
          // (not while a one-lap phrase's next add is still picking: intensityRoomNow)
          const kind = nextArcKind(intensityRowsNow().bed.map((s) => s.kinds))
          if (kind !== null) id = intensityAddRow(kind, false)
        }
        intensityJoinDecidedRef.current = id
        console.log(
          `[radio-intensity] ${d.forced === true ? 'build pressed: ' : ''}adds ${id ?? 'nothing (no row to add)'}`
        )
        return
      }
      case 'breakdown': {
        // the carry row first, so the landing loop joins it before any rest's last-row guard
        const carry = intensityCarryRef.current
        let carried = false
        if (d.carry && carry !== null && carry.pick !== null && carry.stem !== null) {
          carried = intensityCarryJoins(carry.slotId, carry.kind, carry.pick, carry.stem)
        }
        const rested: string[] = []
        for (const id of d.rest) {
          if (intensityRestRow(id)) rested.push(id)
          else {
            const arc = intensityArcRef.current
            if (arc !== null) intensityArcRef.current = releaseRadioIntensityRest(arc, id)
          }
        }
        // the first drums row leaves with an echo throw ending on the line (as a hook's exit)
        if (d.throwRowId !== null && d.throw !== null && rested.includes(d.throwRowId)) {
          intensityThrowOwed(d.throwRowId, d.throw)
        }
        console.log(
          `[radio-intensity] breakdown ${d.depth}: rests ${rested.length > 0 ? rested.join(', ') : 'nothing'}${carried ? `, ${carry?.slotId} carries it` : ''}`
        )
        return
      }
      case 'drop': {
        const back: string[] = []
        const renewed: string[] = []
        for (const id of d.returning) {
          // given back by hand, or its rest never landed: nothing to bring back
          if (radioRestingRef.current.get(id) !== 'arc') continue
          const renew = d.renew.includes(id) ? intensityRenewalOf(id) : null
          if (intensityBringBack(id, renew)) {
            back.push(id)
            if (renew !== null) renewed.push(id)
          }
        }
        // swell depth: the sounding drums and bass rows come back renewed
        for (const id of d.renew) {
          if (d.returning.includes(id)) continue
          const slot = slotsRef.current.find((s) => s.id === id)
          const renew = intensityRenewalOf(id)
          if (
            renew !== null &&
            slot !== undefined &&
            !slot.locked &&
            previewingSlotIdsRef.current.has(id) &&
            intensityBringBack(id, renew)
          ) {
            renewed.push(id)
          }
        }
        intensityRenewRef.current = new Map()
        // a button's drop rolls its own turn: a riser after a breakdown, the quick drop's low drop
        if (d.forced === true) intensityDropTurn(d.quick === true)
        // and its own aimed throw, ending on the drop (or its gap)
        intensityDropThrowOwed()
        console.log(
          `[radio-intensity] ${d.quick === true ? 'quick ' : ''}drop: back ${back.length > 0 ? back.join(', ') : 'nothing'}, renewed ${renewed.length > 0 ? renewed.join(', ') : 'nothing'}`
        )
        return
      }
    }
  }

  /** The breakdown rests a row at the next top: an arc `rest` (its own pick and stem; the stage
   * leaves it out). False when it cannot be queued (a change waits on the row). */
  function intensityRestRow(rowId: string): boolean {
    const slot = slotsRef.current.find((s) => s.id === rowId)
    const stem = resolvedStemsRef.current.get(rowId)
    if (slot === undefined || slot.candidate === null || stem === undefined) return false
    return queueManualChange(
      rowId,
      radioHookPickOf({ ...slot, candidate: slot.candidate }),
      false,
      Number.NEGATIVE_INFINITY,
      false,
      { kind: 'cut', beats: 4 },
      { arc: 'rest', rest: true, stem }
    )
  }

  /** The breakdown's carry row joins on its one: on the panel now, silent, and queued (warm) to
   * join at the top with the density arc's arrival. It is the arc's joining row there. */
  function intensityCarryJoins(
    slotId: string,
    kind: DiscoverSlotKind,
    pick: SlotPick,
    stem: ResolvedCandidateStem
  ): boolean {
    setSlots((prev) => [
      ...prev,
      {
        id: slotId,
        kinds: [kind],
        locked: false,
        candidate: null,
        hasRerolled: false,
        gain: 1,
        radioAdded: true
      }
    ])
    intensityJoiningRef.current.add(slotId)
    intensityJoinDecidedRef.current = slotId
    if (arcAddingRef.current === null) {
      arcAddingRef.current = { slotId, picking: false, kinds: [kind], warm: true }
    }
    const queued = queueManualChange(
      slotId,
      pick,
      true,
      Number.NEGATIVE_INFINITY,
      false,
      densityArrival(radioSettings.transitions, [kind]),
      { stem }
    )
    if (!queued) {
      if (arcAddingRef.current?.slotId === slotId) arcAddingRef.current = null
      dropSlot(slotId)
    }
    return queued
  }

  /** The breakdown's echo throw on its first resting drums row, owed until this wrap's landings
   * have run (one microtask on: after the landing's): it ends on the line, on the lap those
   * landings make, as a hook exit's does. Dry when it cannot start a bar ahead, another throw is
   * armed, the project's throws are off, or a landing's length is not known yet. */
  function intensityThrowOwed(rowId: string, shape: RadioHookThrow): void {
    const owed = { rowId, shape, landed: new Map<string, number | null>() }
    intensityThrowOwedRef.current = owed
    void Promise.resolve().then(() => {
      if (intensityThrowOwedRef.current !== owed) return
      intensityThrowOwedRef.current = null
      if (!radioOnRef.current || manualChangesRef.current.get(rowId)?.arc !== 'rest') return
      const throws = normalizeSoundSettings(sound ?? appSoundDefaultsNow()).throws
      const lapKnown = [...owed.landed.values()].every((b) => b !== null)
      let thrown = false
      if (throws.on && throws.level > 0 && lapKnown) {
        const lengths = new Map(resolvedBarLengthsRef.current)
        for (const [id, b] of owed.landed) if (b !== null && b > 0) lengths.set(id, b)
        const armed = armDiscoverExitThrow(radioThrowRef.current, {
          slotId: rowId,
          shape,
          pos: radioClockRef.current?.lastPos ?? 0,
          loopBars: lengths.size > 0 ? Math.max(...lengths.values()) : turnaroundLoopNow().loopBars,
          bpm: bpmRef.current
        })
        if (armed !== null) {
          radioThrowRef.current = armed
          scheduleSyncPreviewToEngine(previewingSlotIdsRef.current)
          thrown = true
        }
      }
      console.log(
        `[radio-intensity] ${rowId} leaves ${thrown ? `with an echo of ${shape.beats} beats` : 'dry'}`
      )
    })
  }

  /** A button's drop rolls its own turn for the drop's top (spec 6): a riser after a breakdown,
   * the quick drop's low drop (at most two bars), with the drop's gap and a large payoff
   * (intensityTurnDrop). The latest turn wins, as a pressed turn's does. */
  function intensityDropTurn(quick: boolean): void {
    const move: TurnaroundMove = quick ? 'low drop' : 'riser'
    radioTurnPendingRef.current = { move, undoSeq: undoSequence.latest(), drop: true }
    setRadioTurnShown({ move })
  }

  /** What a turn's roll adds for the drop (spec 5.6): the drop button's own turn, or a turn
   * pressed for the top the drop lands on, takes the drop's gap chance and a large payoff. */
  function intensityTurnDrop(turn: {
    drop?: true
  }): Partial<Pick<TurnaroundInput, 'drop' | 'payoff'>> {
    const arc = intensityOn() ? intensityArcRef.current : null
    if (arc === null || (turn.drop !== true && arc.decided?.event !== 'drop')) return {}
    return {
      drop: { gapChance: turnaroundDropGapChance(radioDramaOf(radioSettings)) },
      payoff: 'large'
    }
  }

  /** What a phrase end's roll adds when the drop lands on its top (spec 4.4). */
  function intensityDropRoll(): Partial<Pick<TurnaroundInput, 'drop'>> {
    const arc = intensityOn() ? intensityArcRef.current : null
    if (arc === null || radioIntensityArcRole(arc) !== 'drop') return {}
    return { drop: { gapChance: turnaroundDropGapChance(radioDramaOf(radioSettings)) } }
  }

  /** The throws' aim at the drop (spec 5.5): bars to it in the breakdown's last phrase, or with
   * the drop decided. */
  function intensityThrowDrop(pos: number, loopBars: number): { dropInBars?: number } {
    const arc = intensityOn() ? intensityArcRef.current : null
    if (arc === null || !intensityThrowDropDue(arc)) return {}
    const bars = radioIntensityDropInBars(arc, {
      lap: radioClockRef.current?.turnaroundLap ?? 0,
      phraseLaps: turnaroundPhraseLaps(radioCadence.turnaroundPhraseBars, loopBars),
      loopBars,
      pos
    })
    return bars === null ? {} : { dropInBars: bars }
  }

  /** The arc's event at the coming top, as flashes (radioFlashTick): `breakdown` on the rows it
   * rests, `drop` on the rows coming back (every heard row for a quick drop), `build` on every
   * row at a pressed build's top. Keyed by the decision. */
  function intensityFlashesNow(): { rowId: string; word: string; key: string }[] {
    const arc = intensityOn() ? intensityArcRef.current : null
    const f =
      arc === null
        ? null
        : intensityFlashRows(arc, {
            arcEntryOf: (id) => manualChangesRef.current.get(id)?.arc,
            heard: [...previewingSlotIdsRef.current],
            rows: slotsRef.current.map((s) => s.id)
          })
    if (arc === null || f === null) return []
    const tag = `arc-${arc.decided?.event ?? ''}@${intensityDecidedSeqRef.current}`
    return f.ids.map((rowId) => ({ rowId, word: f.word, key: `${tag}@${rowId}` }))
  }

  /** The lean on a pick asked for now (pickForSlot's default): the arc's target, while radio runs
   * with density intensity; null otherwise (no lean: today's pick). */
  function intensityLeanNow(): { target: number; drama: number } | null {
    const arc = intensityOn() && radioOnRef.current ? intensityArcRef.current : null
    if (arc === null) return null
    const drama = radioDramaOf(radioSettings)
    return { target: radioIntensityTarget(arc, radioEnergyOf(radioSettings), drama), drama }
  }

  /** BUILD and DROP (spec 6), pressed: the strip's and the phone's (Task 11, through
   * intensityPressRef). Nothing unless radio runs the intensity arc, it has begun, and the press
   * does something (intensityPressNow: a late press whose event would do nothing is refused, as an
   * early one is, so a press acts exactly when its button says it can). `late` is the turn's own
   * rule (too late in the lap to arm): the press then takes the top after, as one whose top is
   * spoken for does. A press that decides a new event carries it out at once (intensityDecided):
   * a drop arms its turn there. A quick drop needs a row to keep sounding under its low drop. */
  function intensityPress(action: RadioIntensityAction): void {
    const arc = intensityOn() ? intensityArcRef.current : null
    if (!radioOnRef.current || arc === null) return
    const { lengths, loopBars } = turnaroundLoopNow()
    if (!(loopBars > 0)) return
    const clock = radioClockRef.current
    const pos = clock?.lastPos ?? 0
    if (
      action === 'drop' &&
      arc.phase !== 'breakdown' &&
      arc.decided?.event !== 'drop' &&
      !turnaroundMoveCanSound(turnaroundInputNow(lengths, loopBars), 'low drop')
    ) {
      console.log('[radio-intensity] drop pressed: not now (nothing to drop)')
      return
    }
    const next = intensityPressNow(arc, action, {
      lap: clock?.turnaroundLap ?? 0,
      phraseLaps: turnaroundPhraseLaps(radioCadence.turnaroundPhraseBars, loopBars),
      late: turnaroundTurnBeats((loopBars - pos) * 4, TURN_LEAD_BEATS) === null,
      can: intensityRoomNow()
    })
    if (next === null) {
      console.log(`[radio-intensity] ${action} pressed: not now`)
      return
    }
    intensityArcRef.current = next
    refreshRadioArcShown()
    if (next.decided !== null && next.decided !== arc.decided) intensityDecided(next.decided)
    else if (next.forced !== null) {
      console.log(`[radio-intensity] ${action} pressed: waits for the top after`)
    } else
      console.log(
        `[radio-intensity] ${action} pressed: ${next.phrases} phrase${next.phrases === 1 ? '' : 's'} now`
      )
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
      radioHookReservesRow(radioHooksRef.current, slot.id) ||
      (previewing.size === 1 && previewing.has(slot.id)) ||
      manualChangesRef.current.has(slot.id) ||
      radioLedChangeRef.current?.slotId === slot.id ||
      // riding radio's held change (an armed pick riding it gives way: radioRemovesRow)
      (radioLedChangeRef.current?.companions ?? []).some((k) => k.slotId === slot.id)
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
      if (arcExitHeldBack() || pos >= leaveAt - 0.25) return
      radioGestureRef.current = [
        ...radioGestureRef.current,
        { kind: 'drop-out', slotId: slot.id, beats: ARC_EXIT_BEATS, lapsLeft: 1, armId: newArmId() }
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

  /** Whether a waiting arc exit is held back from arming now: a drop-out or a change's lead-in
   * already leads the lap, or a stage is out (an ordinary push would withdraw it). */
  function arcExitHeldBack(): boolean {
    return (
      radioStageRef.current !== null ||
      radioGestureRef.current.some((g) => g.kind === 'drop-out' || radioGestureLeadsChange(g.kind))
    )
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
    } else dropRadioPendingCompanion(id)
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
      (id) =>
        !manualChangesRef.current.has(id) &&
        !radioSkipPickingRef.current.has(id) &&
        !radioHookTurnoverExcluded(radioHooksRef.current, id)
    )
    // A mid-radio artist change's rows go first (changeArtists).
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
    // The turnover set this pick serves. changeArtists REPLACES the set, so a
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
    // Sized builds belong to a run of radio: the build clock and the spares start again with the
    // next one (the payoff goes with clearRadioTurnaround below).
    radioBuildClockRef.current = NO_RADIO_BUILDS
    radioSparesRef.current = []
    radioSparesWantedRef.current = false
    // Hooks in are kept, inert (a fresh stay is drawn when radio starts); away hooks are dropped
    // and their rows keep what they play (radioHooksStopped, spec 2.7). Nothing armed for them
    // survives, and a hook landing still queued is dropped below, not committed.
    radioHooksStepOwedRef.current = null
    radioHookWarmRef.current = new Map()
    radioHookSubsRef.current = new Map()
    radioLandingsRef.current = NO_RADIO_LANDINGS
    // A row a hook was resting on joins the mix again, with the stem it rested with (its hook is
    // dropped below); the pushes this stop makes carry it.
    // (The intensity arc's rests too: radioIntensityStopped's rows, all of them resting here or
    // about to -- a rest still queued is dropped with the waiting changes below.)
    for (const id of radioRestingRef.current.keys()) {
      if (slotsRef.current.some((s) => s.id === id)) joinPreviewingMix(id)
    }
    radioRestingRef.current = new Map()
    {
      const kept = radioHooksStopped(radioHooksRef.current)
      for (const h of radioHooksRef.current.hooks) {
        if (!kept.hooks.some((k) => k.rowId === h.rowId)) radioHookPicksRef.current.delete(h.rowId)
      }
      updateRadioHooks(kept)
    }
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
    clearRadioTurnaround()
    resetRadioFold()
    // An armed throw's curve comes off too (radioOnRef is false, so the rebuild carries
    // none); its echo rings out in the engine.
    resetRadioThrows(true)
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
        // a hook's landing belongs to radio's run: dropped (radioHooksStopped above undid it), and
        // so does the intensity arc's (its rested rows joined the mix above)
        if (change.hook !== undefined || change.arc !== undefined) continue
        commitSlotPick(slotId, change.pick)
      }
    }
    setRadioProgress(0)
    setRadioChangeWait(null)
    resetRadioReadout()
  }

  /** Starts radio at a chosen pace. Elling, 2026-09-28: "the initial
   * prompt should be slow mid fast so the app knows how to start
   * everything." -- so the radio button opens RadioStartPrompt, and its `start` chip lands here with the pace slider's level
   * (three pace chips did until 2026-10-03). The two things that happen at the
   * starting moment are now one gesture: the pace configures the clock and
   * the channel count sizes the bed.
   *
   * Lays down a bed if the panel is empty -- a button that does nothing on
   * a fresh panel is not the thing he asked for, and four layers is the
   * smallest set that sounds like a band rather than like a loop. addSlot
   * does its own first roll per slot, so this is the same clicks the user
   * would otherwise make.
   *
   * Takes the level as an argument rather than from radioSettings, on
   * purpose: the start prompt's own persisting write of paceLevel is async and this
   * render's radioSettings prop is still the OLD pace. Reading it here would
   * start the clock at the pace he just replaced.
   */
  function startRadio(level: number): void {
    if (slotsRef.current.length === 0) {
      // With the density arc on, the bed starts minimal (drums, bass) and
      // the arc grows it; otherwise it is `channels` rows, as before.
      const bed = radioDensityOf(radioSettings) !== 'off' ? DENSITY_MIN : radioSettings.channels
      for (const kind of radioStarterKinds(bed)) addSlot([kind], false, true)
    }
    radioOnRef.current = true
    radioLandingAtRef.current = null
    // Back to 0: a count left from the last run would give the strip's skip the flicker class
    // the moment it mounts.
    setRadioSkipFlicker(0)
    resetDensityArc()
    // The intensity arc begins at radio's start (its first draws, spec 3.5): its first build grows
    // from the bed as it is -- DENSITY_MIN on an empty panel, whose rows reach slotsRef a render
    // later.
    if (radioDensityOf(radioSettings) === 'intensity') {
      intensityArcRef.current = radioIntensityStarted({
        energy: radioEnergyOf(radioSettings),
        min: DENSITY_MIN,
        max: DENSITY_MAX,
        count: slotsRef.current.length > 0 ? slotsRef.current.length : DENSITY_MIN,
        random: Math.random
      })
    }
    resetRadioThrows(false)
    resetRadioReadout()
    // hooks kept from the last run start a fresh stay from here
    radioLandingsRef.current = NO_RADIO_LANDINGS
    radioHooksStepOwedRef.current = null
    updateRadioHooks(
      radioHooksStarted(radioHooksRef.current, {
        paceLevel: radioPaceLevelOf({ ...radioSettings, paceLevel: level }),
        random: Math.random
      })
    )
    // createRadioClock, not restartRadioInterval: switching radio on is
    // where a phrase STARTS. The origin is the loop top radio started
    // inside (lapsSincePhrase counts whole laps, so a switch-on halfway
    // through a lap still puts every phrase boundary on a loop top),
    // which is the only anchor radio can see -- the transport wraps, so
    // there is no absolute bar 0 to count from.
    radioClockRef.current = createRadioClock(
      nextRadioIntervalBarsInWindow(radioCadenceOf({ ...radioSettings, paceLevel: level }).window),
      pos
    )
    radioPhraseAnchorRef.current = null
    radioLastSlotRef.current = null
    radioChangedAtRef.current = new Map()
    radioTurnRef.current = 0
    radioCourseChangeRef.current = null
    setRadioProgress(0)
    setRadioOn(true)
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
    // a row a hook keeps stays out of radio's turnover, a course change included
    const eligible = radioEligibleSlotIds().filter(
      (id) => !radioHookTurnoverExcluded(radioHooksRef.current, id)
    )
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
    // A new bed ends the intensity arc's rests: its rows come back with it, at the next top.
    const arc = intensityOn() ? intensityArcRef.current : null
    if (ready.length > 0 && arc !== null) {
      const resting = [...radioRestingRef.current].flatMap(([id, o]) => (o === 'arc' ? [id] : []))
      const ended = [...new Set([...intensityRestsDecided(arc), ...arc.rests, ...resting])]
      for (const id of ended) intensityEndRest(id)
      if (ended.length > 0) console.log(`[radio-intensity] a new bed: ${ended.join(', ')} back`)
    }
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
    const nowMode = selectionMode(artistsRef.current, currentUsername)
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
    mode === 'other'
      ? listenOnlyTooltip(othersLabel)
      : lingeringBlocks
        ? lingeringNotice(lingering, lingeringStuck)
        : undefined

  // FOLD MODE'S STATUS (v2, @shared/radioFoldStatus): the line in the radio bar and each folded
  // row's readout, only while radio runs with the mode on. The next change is the rows' own count
  // (radioChangeWait), so the line says what the rows show.
  // radioFoldTrack: fold's status shows (radio runs with the mode on). It no longer feeds a grid
  // track: the folded rows' readouts are the radio layout's plates (radioFoldReadouts).
  const radioFoldTrack = radioOn && radioSettings.foldMode
  const radioFoldStatusNow =
    radioFoldTrack && radioFoldView !== null
      ? radioFoldStatus(
          radioFoldView.state,
          radioFoldView.step,
          previewLoopBars,
          radioSettings.fold,
          radioChangeWait?.barsUntilChange ?? null
        )
      : null
  // THE RADIO READOUT on each row (radioReadoutNow), only while radio runs.
  const radioReadoutRows = new Map(
    (radioOn && radioReadoutNow !== null ? radioReadoutNow.rows : []).map((r) => [r.rowId, r])
  )
  const radioFoldReadouts = new Map(
    (radioFoldStatusNow?.rows ?? []).map((r) => [
      r.rowId,
      radioFoldRowLabel(r.cycleBeats, previewLoopBars * 4)
    ])
  )

  // What the radio view draws (spec 2026-10-05-radio-simple-view-design): the strip model's
  // groups through the view. The strip builds them from this context, the settings and the view;
  // the top line's mix asks the view alone (its ids depend on nothing else).
  const radioStripCtx: RadioStripContext = {
    artistMode: mode === 'other',
    artistsIncludeMe: combined && selectionHasMe(artists),
    hasUsername,
    sound: soundNow,
    sounding: previewingSlotIds.size > 0
  }
  // The mix ids depend on the view alone (radioViewTopIds), so no strip model per render here.
  const radioMixShown: ReadonlySet<string> = useMemo(
    () => new Set(radioOn ? radioViewTopIds(radioView) : []),
    [radioOn, radioView]
  )

  // The mix actions (similar all, fetch hearts, add to shelf, add to timeline, keep): drawn by the
  // radio top line while radio runs. Built once, here, so the JSX below stays a plain tree.
  const radioMix: RadioMixBundle = {
    rolling: rerollingSlotIds.size > 0,
    onSimilarAll: (immediate) => void rerollAll(immediate),
    keep: {
      label: keeping ? 'keeping…' : (keptLabel ?? 'keep'),
      disabled: keeping || listenOnly.has('keep'),
      tooltip: listenOnly.has('keep') ? listenOnlyTip : 'keep this group',
      pulse: keptLabel !== null,
      onClick: () => void keepGroup()
    },
    hearts: {
      label: fetchingHearts ? 'fetching…' : (heartsLabel ?? 'fetch hearts'),
      disabled: fetchingHearts || listenOnly.has('fetchHearts'),
      tooltip: listenOnly.has('fetchHearts') ? listenOnlyTip : 'fetch radio hearts',
      pulse: heartsLabel !== null,
      onClick: () => void fetchHearts()
    },
    shelf: {
      label: addingToShelf ? 'adding…' : justAddedToShelf ? '✓ added' : 'add to shelf',
      disabled: addingToShelf || listenOnly.has('addToShelf'),
      tooltip: listenOnly.has('addToShelf') ? listenOnlyTip : undefined,
      pulse: justAddedToShelf,
      onClick: () => void addToShelf()
    },
    timeline: {
      label: addingToTimeline ? 'adding…' : justAddedToTimeline ? '✓ added' : 'add to timeline',
      disabled: addingToTimeline || listenOnly.has('addToTimeline'),
      tooltip: listenOnly.has('addToTimeline') ? listenOnlyTip : undefined,
      pulse: justAddedToTimeline,
      onClick: () => void addToTimeline()
    }
  }

  return (
    <div
      style={{
        // No top or bottom padding while radio runs: the sticky top line and live bar sit flush
        // with the scroll area's edges, so nothing scrolls visibly through a 10px gap around them.
        padding: radioOn ? '0 10px' : 10,
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
        .radio-plate-away { color: var(--ra-text-2); }
        .radio-plate-away:hover { color: var(--ra-text); }
        .radio-fire:active { background: var(--ra-text); color: var(--ra-bg-page); }
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
        @keyframes radio-landing-flicker { 50% { color: var(--ra-playhead); } }
        .radio-landing-flicker { animation: radio-landing-flicker 600ms ease-in-out; }
        .discover-pending { animation: discover-slot-pulse 900ms ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) {
          .radio-landing-flicker { animation: none; }
          [data-radio-view] .discover-pending { animation: none; opacity: 0.45; }
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

      {/* THE HEADER. While radio runs: the top line (radio view plan Task 10, spec 1.1), sticky.
          Otherwise the two rows below. One expression, so the rows wrapper's place among the
          panel's children never moves (plan Task 7). */}
      {radioOn ? (
        <RadioTopLine
          playing={playing}
          canPlay={previewingSlotIds.size > 0}
          onPlayToggle={() => dispatch({ type: playing ? 'PAUSE' : 'PLAY' })}
          onStopRadio={() => {
            focusAfterSwitchRef.current = 'header'
            stopRadio()
          }}
          radioButtonRef={radioTopButtonRef}
          progress={radioProgress}
          readout={radioReadoutNow}
          foldSummary={radioFoldStatusNow?.summary ?? null}
          actions={<RadioMixActions mix={radioMix} shown={radioMixShown} />}
          view={radioView}
          onViewChange={(v) => void onRadioViewChange(v)}
          canUndo={undoStack.length > 0 || radioTurnShown !== null}
          canRedo={redoStack.length > 0}
          onUndo={undoDiscoverAction}
          onRedo={redoDiscoverAction}
        />
      ) : (
        <>
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
              disabled={undoStack.length === 0 && radioTurnShown === null}
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
                color:
                  undoStack.length === 0 && radioTurnShown === null
                    ? 'var(--ra-text-4)'
                    : 'var(--ra-text-2)',
                cursor: undoStack.length === 0 && radioTurnShown === null ? 'default' : 'pointer'
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
            {/* While radio runs the artist button is the strip's (one artistButtonRef, one button at
                a time); the picker below the strip serves both. */}
            {!radioOn && (
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
                data-tooltip={artistSelectionTooltip(artists, currentUsername)}
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
                {artistSelectionLabel(artists, currentUsername)}
              </button>
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
                  // Radio off only (the top line's `radio` is the stop): the start prompt. Elling, 2026-09-28: "the initial
                  // prompt should be slow mid fast so the app knows how to
                  // start everything." The prompt's `start` chip is what
                  // actually starts radio, at the pace slider's position
                  // (startRadio below; three pace chips did it until
                  // 2026-10-03), so this press only opens the choice --
                  // Escape or a click elsewhere cancels it, which is why it is
                  // a popover and not a dialog with an OK.
                  if (radioPrompt) {
                    closeRadioPrompt()
                    return
                  }
                  const rect = e.currentTarget.getBoundingClientRect()
                  setRadioPrompt({ x: rect.left, y: rect.bottom + 4 })
                }}
                aria-expanded={radioPrompt !== null}
                data-tooltip="start radio"
                style={{
                  fontFamily: 'inherit',
                  fontSize: 10,
                  padding: '6px 14px',
                  background: 'transparent',
                  border: '1px solid var(--ra-border-strong)',
                  color: 'var(--ra-text)',
                  cursor: 'pointer'
                }}
              >
                radio
              </button>
              {/* The interval line's room (RadioTopLine draws it while radio runs), kept so the
                  row is the height it always was. */}
              <div style={{ height: 2 }} />
            </div>
            {radioPrompt && (
              <RadioStartPrompt
                x={radioPrompt.x}
                y={radioPrompt.y}
                settings={radioSettings}
                onChange={(patch) => void onRadioSettingsChange(patch)}
                onStart={(level) => {
                  closeRadioPrompt()
                  focusAfterSwitchRef.current = 'top'
                  startRadio(level)
                }}
                onClose={closeRadioPrompt}
                ignoreRef={radioMenuButtonRef}
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
                  addingToShelf || listenOnly.has('addToShelf')
                    ? 'var(--ra-text-4)'
                    : 'var(--ra-text)',
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
                background: listenOnly.has('addToTimeline')
                  ? 'transparent'
                  : 'var(--ra-stretch-on-bg)',
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
        </>
      )}
      {lingeringBlocks && (
        <div
          role="note"
          // -6 tucks it under the header rows' marginBottom; the sticky top line has none.
          style={{
            fontSize: 9,
            color: 'var(--ra-text-3)',
            marginTop: radioOn ? 0 : -6,
            marginBottom: 10,
            ...(radioOn ? RADIO_VIEW_FRAME : {})
          }}
        >
          {lingeringNotice(lingering, lingeringStuck)}
        </div>
      )}
      {artistSelectionNotice(artists, currentUsername) !== null && (
        <div
          role="note"
          // -6 tucks it under the header rows' marginBottom; the sticky top line has none.
          style={{
            fontSize: 9,
            color: 'var(--ra-text-3)',
            marginTop: radioOn ? 0 : -6,
            marginBottom: 10,
            ...(radioOn ? RADIO_VIEW_FRAME : {})
          }}
        >
          {artistSelectionNotice(artists, currentUsername)}
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
      {/* While radio runs these dials are the strip's sound group (radio view plan Task 9). */}
      {previewingSlotIds.size > 0 && !radioOn && (
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
              onChange={setMasterLevelLive}
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
              onChange={setMasterCutoffLive}
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
              onChange={setMasterResonanceLive}
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
      {/* Radio view plan Task 7: the SAME wrapper element in both modes (its style switches,
          never the element), so no row remounts when radio toggles. While radio runs the rows
          are capped at 1200px and centred, the playhead overlay inside with them;
          data-radio-view scopes the radio view's CSS. */}
      <div
        ref={rowsRef}
        data-radio-view={radioOn ? '' : undefined}
        style={
          radioOn
            ? {
                position: 'relative',
                maxWidth: RADIO_VIEW_MAX_WIDTH,
                margin: '0 auto',
                width: '100%'
              }
            : { position: 'relative' }
        }
      >
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
          return slots.map((slot, i) => (
            <DiscoverSlotRow
              key={slot.id}
              slot={slot}
              radioApproach={radioApproachFor({
                slotId: slot.id,
                // A companion reads as radio's own row: it turns over with it.
                armedSlotId: radioArmedCompanionIds.has(slot.id) ? slot.id : radioArmedSlotId,
                // A manual change waiting for the loop top reads exactly
                // like radio's own held one -- the same breathing, spec
                // behaviour 2. Only `state` is drawn, so the wait (radio's
                // own) does not have to describe it.
                heldSlotId:
                  manualWaitingSlotIds.has(slot.id) || radioHeldCompanionIds.has(slot.id)
                    ? slot.id
                    : radioHeldSlotId,
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
              hookIn={radioHookInRow(radioHooks, slot.id)}
              hookSet={radioHookOf(radioHooks, slot.id) !== null}
              hookAwayName={radioHookAwayNames.get(slot.id) ?? null}
              onToggleHook={() => toggleSlotHook(slot.id)}
              onBringHookBack={() => bringSlotHookBack(slot.id)}
              dug={radioDig === slot.id}
              onToggleDig={() => toggleSlotDig(slot.id)}
              onLike={() => likeSlot(slot.id)}
              listenOnlyStars={listenOnly.has('star')}
              nearbyCreator={artistCreator}
              ownUsername={currentUsername}
              creatorInTooltip={combined}
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
              layout={radioOn ? 'radio' : 'grid'}
              radioView={radioView}
              rowNumber={i + 1}
              plates={
                radioOn
                  ? radioRowPlates(
                      radioReadoutRows.get(slot.id) ?? null,
                      radioFoldReadouts.get(slot.id) ?? null
                    )
                  : null
              }
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
          // Radio view plan Task 7: the same three elements in both layouts, only their styles
          // switch, so the line (sweepLineRef) never changes parent. In the radio layout the
          // waveform is the row's width less its border and margins (DiscoverSlotRow's radio
          // assembly), so the box is inset by RADIO_ROW_INSET_LEFT/RIGHT and the cell fills it.
          <div
            aria-hidden
            style={
              radioOn
                ? {
                    position: 'absolute',
                    top: 0,
                    bottom: 0,
                    left: RADIO_ROW_INSET_LEFT,
                    right: RADIO_ROW_INSET_RIGHT,
                    pointerEvents: 'none'
                  }
                : {
                    position: 'absolute',
                    inset: 0,
                    display: 'grid',
                    gridTemplateColumns: DISCOVER_ROW_GRID_COLUMNS,
                    gridTemplateRows: '100%',
                    columnGap: DISCOVER_ROW_COLUMN_GAP,
                    padding: 0,
                    pointerEvents: 'none'
                  }
            }
          >
            <div
              style={
                radioOn
                  ? { position: 'absolute', inset: 0 }
                  : {
                      gridColumn: DISCOVER_WAVEFORM_COLUMN,
                      minWidth: DISCOVER_WAVEFORM_MIN_WIDTH,
                      position: 'relative'
                    }
              }
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

      {/* THE STRIP (radio view plan Task 8, spec 1.3): every radio setting, under the rows, while
          radio runs. Its groups come from @shared/radioStripModel; every handler is this
          panel's own, the header's and the add row's. */}
      {radioOn && (
        <RadioStrip
          settings={radioSettings}
          onSettingsChange={(p) => void onRadioSettingsChange(p)}
          ctx={radioStripCtx}
          view={radioView}
          play={{
            tempoText,
            onTempoText: setTempoText,
            onTempoFocus: () => setTempoFocused(true),
            onTempoCommit: commitTempo,
            onTempoStep: (delta) => dispatch({ type: 'SET_TEMPO', bpm: bpm + delta }),
            seedTempo,
            bpm,
            onMatchSeed: () => {
              if (seedTempo !== null) dispatch({ type: 'SET_TEMPO', bpm: seedTempo })
            },
            onSkip: () => void skipRadio(),
            onNewBed: () => void collectRadioCourseChange(),
            skipFlicker: radioSkipFlicker
          }}
          picks={{
            faves: favesShown,
            onFavesPreview: previewFaves,
            onFavesCommit: commitFaves,
            favesTooltip:
              mode === 'other' && !selectionHasMe(artists)
                ? `artist mode picks ${othersLabel}'s stems`
                : combined
                  ? 'faves act on your turns'
                  : FAVES_TOOLTIP,
            source: sourceLean,
            onSource: changeSourceLean,
            matching: 100 - chaos,
            onMatching: (matching) => setChaos(100 - matching),
            artistLabel: artistSelectionLabel(artists, currentUsername),
            artistTooltip: artistSelectionTooltip(artists, currentUsername),
            artistActive: mode === 'other',
            artistOpen: artistMenu !== null,
            artistButtonRef,
            onArtistButton: (e) => {
              if (artistMenu) {
                setArtistMenu(null)
                return
              }
              const rect = e.currentTarget.getBoundingClientRect()
              setArtistMenu({ x: rect.left, y: rect.bottom + 4 })
            },
            mySounds: globalModifiers.includes('mine'),
            onMySounds: () => setGlobalModifiers((prev) => toggleSlotModifier(prev, 'mine')),
            mySoundsTooltip: combined
              ? 'combined: me is your own stems'
              : mode === 'other'
                ? `artist mode picks ${othersLabel}'s stems`
                : !hasUsername
                  ? MY_SOUNDS_NEEDS_USERNAME
                  : undefined
          }}
          sound={{
            level: masterLevel,
            onLevel: setMasterLevelLive,
            reverb: masterSendDraft,
            onReverbDraft: setMasterSendDraft,
            onReverbCommit: commitMasterSend,
            cutoff: masterCutoff,
            onCutoff: setMasterCutoffLive,
            resonance: masterResonance,
            onResonance: setMasterResonanceLive,
            filterMode: masterFilterMode,
            onFilterMode: toggleMasterFilterMode,
            // SoundSettingsPanel's project-mode commit: undoable, saved with the project; the
            // [sound] effect resyncs the preview once per release.
            onSoundPatch: (patch) => dispatch({ type: 'SET_SOUND_SETTINGS', settings: patch })
          }}
          turn={{
            shown: radioTurnShown,
            can: radioTurnCan,
            flash: radioTurnFlash,
            onTurn: (move) => turnRadio(move)
          }}
          arc={{
            shown: radioArcShown,
            onPress: (action) => intensityPressRef.current(action)
          }}
        />
      )}
      {/* The artist picker, opened from the header's artist button (radio off) or the strip's
          (radio on). Fixed-position, so where it sits in the tree changes nothing. */}
      {artistMenu && (
        <DiscoverArtistPicker
          x={artistMenu.x}
          y={artistMenu.y}
          selection={artists}
          ownUsername={currentUsername}
          onChange={changeArtists}
          onClose={() => setArtistMenu(null)}
          ignoreRef={artistButtonRef}
          turns={
            combined
              ? `turns: ${artists
                  .map(
                    (m) =>
                      `${m ?? (currentUsername.trim() || 'me')} ${artistTurnsShown[memberKey(m)] ?? 0}`
                  )
                  .join(' · ')}`
              : null
          }
          footerExtra={
            selectionOthers(artists).length > 0 ? (
              <button
                disabled={!discoverConsented || analysisQueued !== null}
                data-tooltip={
                  discoverConsented
                    ? combined
                      ? "queue these artists' stems for the overnight scan"
                      : "queue this artist's stems for the overnight scan"
                    : 'turn on library analysis first'
                }
                onClick={() => {
                  // Disabled while the call runs (the label is non-null).
                  setAnalysisQueued('queueing…')
                  // Every named artist, one after another (combine artists; `me` is never
                  // queued). One artist: today's one call.
                  const names = selectionOthers(artists)
                  const queueAll = async (): Promise<number> => {
                    let size = 0
                    for (const name of names) {
                      size = (await window.rifffApi.discoverQueueArtistAnalysis(name)).size
                    }
                    return size
                  }
                  queueAll()
                    .then((size) => {
                      // The whole queue's size: "queued 0" says nothing
                      // when this artist's stems were all queued already.
                      setAnalysisQueued(`${size.toLocaleString('en-US')} queued`)
                      announceArtistScanQueued(size)
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
      {/* Hidden while radio runs (Elling, 2026-10-04: the design pass drops it; rows still change
          via skip and the kinds menu). It owns no ref and no popover, so it unmounts; its state
          (pendingAddKinds, the modifiers) lives in the panel and is back with radio off. */}
      {!radioOn && (
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
            {/* Global roll filters -- see globalModifiers -- and the faves dial where `prefer
              faves` sat (@shared/discoverFaves): 0 no lean, 100 only starred stems (a roll with
              none that fits rolls as usual). Dimmed in artist mode: your stars are not among
              the artist's stems. */}
            {/* The faves dial and my sounds toggle (the add row only shows with radio off). */}
            <div
              style={{
                display: 'flex',
                gap: 8,
                flexWrap: 'wrap',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              <span
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  opacity: mode === 'other' && !selectionHasMe(artists) ? 0.4 : 1
                }}
              >
                <Dial
                  value={favesShown}
                  onChange={previewFaves}
                  onCommit={commitFaves}
                  defaultValue={DEFAULT_FAVES}
                  size={22}
                  ariaLabel={FAVES_LABEL}
                  tooltip={
                    mode === 'other' && !selectionHasMe(artists)
                      ? `artist mode picks ${othersLabel}'s stems`
                      : combined
                        ? 'faves act on your turns'
                        : FAVES_TOOLTIP
                  }
                />
                <span style={{ fontSize: 8, color: 'var(--ra-text-3)' }}>{FAVES_LABEL}</span>
              </span>
              {DISCOVER_SLOT_MODIFIER_OPTIONS.map((modifier) => {
                const needsUsername = modifier === 'mine' && !hasUsername
                // Artist mode picks the artist's stems: `my sounds` is moot.
                const overridden = mode === 'other'
                const disabled = needsUsername || overridden
                return (
                  <BracketToggle
                    key={modifier}
                    checked={!disabled && globalModifiers.includes(modifier)}
                    onChange={() =>
                      setGlobalModifiers((prev) => toggleSlotModifier(prev, modifier))
                    }
                    label={DISCOVER_SLOT_MODIFIER_LABEL[modifier]}
                    disabled={disabled}
                    tooltip={
                      combined
                        ? 'combined: me is your own stems'
                        : overridden
                          ? `artist mode picks ${othersLabel}'s stems`
                          : needsUsername
                            ? MY_SOUNDS_NEEDS_USERNAME
                            : undefined
                    }
                  />
                )
              })}
            </div>
          </div>
          {/* Source and matching dials. */}
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
      )}
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
