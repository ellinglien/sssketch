import { TYPE_ORDER, stemKey, type BusId, type Rifff, type SoundType } from '@shared/types'
import { sqrtGain } from '@shared/mixGain'
import {
  DEFAULT_REVERB,
  defaultFilterSettings,
  normaliseAutomationCurve,
  type AutomationParam,
  type AutomationPoint,
  type ProjectReverbSettings,
  type StemAutomation,
  type StemFilterSettings
} from '@shared/toolkit'
import { MIN_RISER_LENGTH_BARS, nextRiserName, normaliseRiser, type RiserClip } from '@shared/riser'
import { nextBusClipName, originalNameFromBusName } from '@shared/busNaming'
import { buildCoachMapSections, resizeCoachMapToPhrase } from '@shared/coachMapTemplate'
import type { CoachPhrase, LoopPhraseReading } from '@shared/coachPhrase'
import type { CoachLoopAnswer, CoachShapeId } from '@shared/coachShapes'
import {
  advanceCoach,
  dismissCoach,
  lockCoachClimax,
  minimiseCoach,
  restoreCoach,
  resumeCoach,
  startCoach,
  type CoachOutcome,
  type CoachState
} from '@shared/coach'
import { endCoachWalk, startCoachWalk, walkCoachTo } from '@shared/coachWalk'
import { applyCoachTension, clearCoachTension, markCoachV1Exported } from '@shared/coachPhase3'
import type { CoachSection } from '@shared/coachSections'
import type { CoachTensionKind } from '@shared/coachTension'
import type { CoachSlotSnapshot, LockedClimax } from '@shared/coachClimax'

// Capped at 1/16 on the fine end -- 1/32 existed here before but was finer
// than anyone actually needed in practice (per direct user feedback: "it
// can get so fine but it doesn't need to be"). 1 and 2 (whole-bar/half-bar)
// were added on the coarse end so BeatPicker's grid can cover a rifff where
// beat-level precision is unnecessary noise -- a long ambient loop where
// only "which bar" matters, not "which sixteenth." Same array both drives
// BeatPicker's own click grid AND (via SNAP_DIVS[state.snapIdx] at every
// other read site: clipGeometry, drag handlers, Inspector's nudge) how
// EVERY clip's offsetSteps is currently interpreted -- see this file's own
// snapIdx doc comment.
export const SNAP_DIVS = [1, 2, 4, 8, 16] as const

// A played length of 0 would never schedule any audio (and risks a divide-
// by-zero downstream) — unlike a stem position of 0, which is meaningful.
// Exported so the arranger row's drag-time preview clamp can share this
// exact value instead of duplicating the literal.
export const MIN_PLAYED_BARS = 0.25

// True if some placed clip OR some riser still points at channelId — used
// to decide whether a channel that just lost a clip (moved elsewhere,
// removed, or deleted) still has anything left on it, or should drop out of
// channelOrder entirely. A channel is never a persisted, independently
// "created"/"deleted" thing — it exists exactly as long as something is on
// it (see channelOrder's own doc comment).
//
// Risers count, and have to: a riser is a placed element of the arrangement
// with no Rifff behind it (see @shared/riser), so a row holding only risers
// would otherwise be evicted from channelOrder the moment its last clip left
// — silently taking the risers off screen while the engine went on playing
// them. Mirrored by selectors.ts's channelsInOrder, which includes riser
// channels for exactly the same reason.
function channelHasAnyClip(
  channelOf: Record<string, string>,
  risers: Record<string, RiserClip>,
  channelId: string
): boolean {
  if (Object.values(channelOf).includes(channelId)) return true
  return Object.values(risers).some((riser) => riser.channelId === channelId)
}

/** Every riser on one channel, muted or unmuted together. Returns the SAME
 * record when nothing changed, so a mute on a riserless row cannot trigger
 * StoreContext's engine-sync effect (which depends on state.risers) for
 * nothing. */
function setRisersMutedOnChannel(
  risers: Record<string, RiserClip>,
  channelId: string,
  muted: boolean
): Record<string, RiserClip> {
  let changed = false
  const next: Record<string, RiserClip> = {}
  for (const [id, riser] of Object.entries(risers)) {
    if (riser.channelId === channelId && riser.muted !== muted) {
      next[id] = { ...riser, muted }
      changed = true
    } else {
      next[id] = riser
    }
  }
  return changed ? next : risers
}

/**
 * Writes one parameter's curve onto every given clip, normalising it first.
 *
 * An emptied curve is REMOVED, not stored as []. "Absent" and "present but
 * empty" both mean not automated to isStemToolkitNeutral, but only absence
 * lets a clip go back to being fully neutral and drop off the wire entirely
 * (buildEngineProject.ts) -- which is what makes clearing a lane actually
 * restore the pre-toolkit render path rather than leaving the clip
 * permanently in the toolkit's stage. Same reason the whole clip entry goes
 * when its last curve does.
 */
function writeCurve(
  all: Record<string, StemAutomation>,
  keys: string[],
  param: AutomationParam,
  rawPoints: AutomationPoint[]
): Record<string, StemAutomation> {
  const points = normaliseAutomationCurve(rawPoints)
  const next = { ...all }
  for (const key of keys) {
    const clip: StemAutomation = { ...next[key] }
    if (points.length === 0) delete clip[param]
    else clip[param] = points
    if (Object.keys(clip).length === 0) delete next[key]
    else next[key] = clip
  }
  return next
}

/**
 * Writes one resonance value onto every given clip's filter settings,
 * leaving the mode and cutoff alone.
 *
 * Resonance is the only part of StemFilterSettings anything currently
 * writes (the dial in the filter lane's corner -- see AutomationLane.tsx),
 * which is why this is resonance-shaped rather than a general filter write:
 * a wider action would have to invent an answer for two fields with no UI.
 *
 * A clip whose settings end up back at the untouched default is REMOVED
 * rather than stored, exactly like writeCurve above and for the same
 * reason -- only absence lets the clip drop off the wire entirely and take
 * the engine's pre-toolkit path (buildEngineProject.ts). Turning the dial
 * down to zero therefore really does undo it, rather than leaving a
 * `{ mode: 'lowpass', cutoff: 1, resonance: 0 }` fossil in the saved file.
 */
function writeFilterResonance(
  all: Record<string, StemFilterSettings>,
  keys: string[],
  resonance: number
): Record<string, StemFilterSettings> {
  const safe = Number.isFinite(resonance) ? Math.min(1, Math.max(0, resonance)) : 0
  const next = { ...all }
  for (const key of keys) {
    const settings: StemFilterSettings = {
      ...(next[key] ?? defaultFilterSettings()),
      resonance: safe
    }
    // Only the fully-default shape is dropped -- a deliberately exact
    // compare including the MODE, so an entry that exists solely to
    // remember a non-default mode survives the dial going back to zero.
    const untouched = defaultFilterSettings()
    if (
      settings.mode === untouched.mode &&
      settings.cutoff === untouched.cutoff &&
      settings.resonance === untouched.resonance
    ) {
      delete next[key]
    } else {
      next[key] = settings
    }
  }
  return next
}

// Shared by PLACE_ON_TIMELINE and MOVE_TO_CHANNEL — everything about placing
// a clip in TIME (as opposed to which channel it lands on, which each of
// those two actions decides differently). The very first clip placed on an
// otherwise-empty timeline adopts its own bpm as the project tempo, rather
// than leaving it at the app's arbitrary default — repositioning that same
// clip, or placing a second one alongside it, doesn't retrigger this.
function placeOnTimeline(state: AppState, groupId: string, startBar: number): AppState {
  const rifff = state.rifffs[groupId]
  const isFirstPlacement =
    rifff.startBar === undefined &&
    !Object.values(state.rifffs).some((r) => r.groupId !== groupId && r.startBar !== undefined)
  return {
    ...state,
    rifffs: { ...state.rifffs, [groupId]: { ...rifff, startBar: Math.max(0, startBar) } },
    bpm: isFirstPlacement ? rifff.bpm : state.bpm,
    sel: groupId,
    stretch: { ...state.stretch, [groupId]: true }
  }
}

export type ArrangerMode = 'normal' | 'sketch' | 'automation'

export type LoopRegion = { startBar: number; endBar: number } | null

export interface AppState {
  bpm: number
  // Index into SNAP_DIVS -- a single GLOBAL setting, not scoped to whichever
  // BeatPicker session happens to be open. Every offsetSteps value in the
  // project (state.off) is expressed in units of 1/SNAP_DIVS[snapIdx] of a
  // bar and re-interpreted against whatever this CURRENTLY is (see
  // clipGeometryFromFields's offsetPx and rotationSecondsForStem) -- an
  // already-baked clip is immune (APPLY_BAKE always resets its off entry to
  // exactly 0), but a still-unbaked offset (mid-pick, or a legacy
  // never-baked LORE offset -- see BeatPicker.tsx's rebakeRifff doc
  // comment) would render/bake against the wrong grid if this changes out
  // from under it. Pre-existing property of this field, not something
  // widening SNAP_DIVS changes.
  snapIdx: 0 | 1 | 2 | 3 | 4
  vol: Record<string, number>
  mute: Record<string, boolean>
  off: Record<string, number>
  stretch: Record<string, boolean>
  /** A rifff's own played length, in bars — the tiling loop's bound, keyed by
   * groupId. Unset means "use rifff.barLength" — today's implicit behavior,
   * unchanged for a project with no resize edits. */
  playedBars: Record<string, number>
  /** Bars cropped from a tiled clip's own LEFT edge, keyed by groupId. Default
   * 0 (no crop). Together with playedBars, defines the visible/audible
   * window as [startBar + leftCropBars, startBar + playedBars) -- startBar
   * and offsetSteps never move for a resize; cropping is purely a windowing
   * operation over a loop whose own phase anchor stays fixed. See
   * docs/superpowers/specs/2026-08-04-tiled-clip-crop-trim-design.md. */
  leftCrop: Record<string, number>
  /** One stem's own muted spans, keyed by stemKey(groupId, slot) -- absolute
   * arrangement-bar positions, the same coordinate space rifff.startBar
   * already lives in. Real arrangement data (persists normally, like
   * leftCrop), not a UI-mode toggle. See
   * docs/superpowers/specs/2026-08-05-clip-region-mute-design.md. */
  muteRegions: Record<string, { startBar: number; endBar: number }[]>
  /** In-progress preview values for an active drag, keyed the same way as
   * their committed counterpart (dragVol/stemKey, the rest/groupId) --
   * populated on every mousemove of a volume/length/crop drag,
   * cleared on release. Transient (see history.ts's TRANSIENT_ACTION_TYPES)
   * -- these are UI/audio previews, never real edits worth an undo
   * checkpoint. Shared store state (not per-component useState) so every
   * component reading the same key -- e.g. every StemWaveformRow instance
   * sharing a groupId -- sees the SAME in-progress value live, not just the
   * one row actually being dragged. See
   * docs/superpowers/specs/2026-08-04-live-drag-preview-design.md. */
  dragVol: Record<string, number>
  dragPlayedBars: Record<string, number>
  dragLeftCropBars: Record<string, number>
  sel: string | null
  /** Visual top-to-bottom row order, as channel IDs — a fresh channel joins
   * the end of this list the moment a clip first lands on it (placed from
   * the shelf, pasted, or dragged off another channel), and drops out again
   * once nothing references it any more. Multiple clips can share one
   * channel (see channelOf below) — that's the whole point: this is what
   * makes "drag a clip onto another channel" and "two clips on the same
   * line" possible, replacing the old trackOrder, which was always
   * exactly one row per rifff, permanently. Read via selectors.ts's
   * channelsInOrder/placedRifffsInOrder, which fall back to object order
   * for any placed rifff missing a channel assignment (keeps old saves —
   * see serialize.ts's migration step — and any placed rifff that somehow
   * never got a channel, rendering sensibly instead of vanishing). */
  channelOrder: string[]
  /** Which channel a placed rifff currently renders on, keyed by groupId.
   * Set automatically to the rifff's own groupId the moment it's first
   * placed or pasted (so the common "one clip, one row" case needs no
   * explicit choice) — only ever set to something ELSE via MOVE_TO_CHANNEL,
   * dispatched when a clip is deliberately dragged onto a different
   * existing channel or off to a brand new one. Purely a rendering/
   * organizational concern — the native engine (buildEngineProject.ts)
   * never reads this field at all; playback doesn't care which row a clip
   * is drawn on. */
  channelOf: Record<string, string>
  /** Which mix bus a stem is assigned to for Ableton export track reduction,
   * keyed by stemKey(groupId, slot) -- mirrors channelOf's own shape, just
   * per-stem instead of per-rifff (two stems in the same rifff can belong
   * to different buses). A stem absent from this map has no assignment
   * yet -- buildAlsXml.ts falls back to the 'aux' bus for those, so export
   * is useful immediately, before any labelling UI exists. Export-time
   * grouping only; never reaches EngineProject or the native engine. See
   * docs/superpowers/specs/2026-08-05-stem-bus-clustering-design.md. */
  busOf: Record<string, BusId>
  exp: Record<string, boolean>
  /** Global arrangement-wide view mode. 'normal' is today's per-rifff
   * collapsed/expanded rendering. 'sketch' replaces the whole Timeline with
   * a single gapless sequence strip (SketchStrip) — only reachable when
   * isSketchEligible(state) (see selectors.ts). 'automation' keeps the
   * normal Timeline exactly as it is but lays a drawable automation lane
   * over each placed clip's own waveform rect (AutomationLane.tsx) --
   * purely a view/interaction mode, so entering and leaving it never
   * touches the arrangement. Cycled by the Tab key via selectors.ts's
   * nextArrangerMode — see App.tsx's Frame component. Not persisted (see
   * serialize.ts). */
  mode: ArrangerMode
  /**
   * Whether the arranger is showing the MAP rather than the timeline.
   *
   * Deliberately NOT a fourth ArrangerMode. `mode` is about how clips are
   * drawn and edited, is cycled by Tab, and gates on isSketchEligible; the
   * map is a different VIEW of the same arrangement, with the same clips
   * underneath and the same edits reaching them. Folding it into `mode`
   * would put "which view am I in" and "how do clips behave" behind one
   * three-way cycle that already has two meanings.
   *
   * Like `mode`: not persisted (serialize.ts drops it) and not undoable
   * (history.ts lists SET_MAP_VIEW transient). A view toggle is not an edit.
   */
  mapView: boolean
  /** Which parameter each automation lane is currently editing, keyed by
   * that lane's own id -- a stemKey for an expanded clip's per-stem lane, a
   * groupId for a collapsed clip's whole-rifff lane (see AutomationLane.tsx's
   * `laneId`). A lane absent from this record edits AUTOMATION_PARAMS[0].
   * Session state, deliberately: it's "what am I looking at right now," the
   * same category as mode/tidiedView above, so it isn't persisted
   * (serialize.ts) and isn't undoable (history.ts) -- only the curves
   * themselves are real edits. */
  automationParamOf: Record<string, AutomationParam>
  /** Hides the Inspector panel entirely, giving its width back to the
   * arranger. Toggled from TransportBar. Not persisted (see serialize.ts). */
  inspectorCollapsed: boolean
  /** View-only arranger overlay: when true, selectors.ts's channelsInOrder
   * recomputes rows by packing placed rifffs onto shared tracks per bus
   * (busOf + packIntoTracks) instead of today's one-row-per-clip layout --
   * a preview of how the Ableton export will group things. Toggled from
   * TransportBar. Not persisted (see serialize.ts) -- always starts off,
   * same as every other "how I'm currently viewing this" toggle here.
   * Editing (drag-to-move/reassign channel) is disabled while this is on
   * -- see App.tsx's resolveDrop -- since the rows shown are computed, not
   * real channel assignments; flip back off to edit. */
  tidiedView: boolean
  /** The in-progress or pending-delete region selection -- null when
   * nothing is selected. `mode: 'mute'` means Delete/Backspace should mute
   * this span (it was dragged over raw/unmuted audio); `mode: 'unmute'`
   * means it exactly matches an existing muted region and Delete/Backspace
   * should remove that mute instead. Not persisted (see serialize.ts) --
   * "how I'm currently working" state, not part of the arrangement. */
  regionSelection: {
    stemKeys: string[]
    startBar: number
    endBar: number
    mode: 'mute' | 'unmute'
  } | null
  /** A 4/4 click track, higher-pitched on beat 1 of each bar — a practice/
   * reference aid, not part of the actual arrangement. Toggled from
   * TransportBar; StoreContext.tsx pushes the current value to the native
   * engine (engineSetMetronome) whenever it changes. Not persisted (see
   * serialize.ts) — always starts off, matching every other "how I'm
   * currently working" toggle in this app. */
  metronomeEnabled: boolean
  /** masterChain[i] is a scanned plugin catalog id (see src/main/pluginCatalog.ts)
   * or null for an empty slot. Persists normally -- real arrangement data, not
   * transient UI state. See docs/superpowers/specs/2026-07-31-plugin-scan-favourites-design.md. */
  masterChain: [string | null, string | null, string | null, string | null]
  /** channelPlugins[channelId] is a 2-slot chain of catalog ids or null,
   * exactly mirroring masterChain's own shape and convention -- see
   * docs/superpowers/specs/2026-08-01-channel-plugin-inserts-design.md. A
   * channelId absent from this record has no plugins on it (the correct
   * default for both a fresh channel and an old save from before this
   * feature existed). Deleted in lockstep with channelOrder's own cleanup
   * in REMOVE_FROM_TIMELINE, DELETE_RIFFFS, and MOVE_TO_CHANNEL -- never a
   * separate pass. */
  channelPlugins: Record<string, [string | null, string | null]>
  /** The built-in sound toolkit's per-CLIP filter, keyed by
   * stemKey(groupId, slot) -- the same key vol/mute/muteRegions/busOf
   * already use. A clip absent from this record has no filter -- identical
   * to one present with defaultFilterSettings() (parked at its mode's
   * neutral end), which is also what every project saved before the toolkit
   * existed loads as. Real arrangement data: persists normally. See
   * docs/superpowers/specs/2026-09-22-builtin-sound-toolkit-design.md,
   * section 2b for why this is per clip rather than the per-channel shape it
   * briefly had. */
  stemFilters: Record<string, StemFilterSettings>
  /** How much of each clip goes to the one shared reverb (0..1), keyed by
   * stemKey. Absent or 0 = no send, and a project where every clip is 0
   * costs the engine nothing at all (the reverb isn't even constructed). */
  stemSends: Record<string, number>
  /** Drawn automation curves, keyed by stemKey then by parameter, with each
   * curve's bars measured RELATIVE to its own clip's start -- so moving or
   * duplicating a clip carries its automation, and a point can never sit
   * past the audio it belongs to. An absent/empty curve means "not
   * automated" -- the clip's own static setting above is used instead.
   * Written by the automation-mode free-draw lane (AutomationLane.tsx),
   * which is laid over exactly one clip's waveform rect. */
  stemAutomation: Record<string, StemAutomation>
  /** The one shared reverb's settings -- project-level, not per channel.
   * Only ever audible once some channel actually sends to it. */
  reverb: ProjectReverbSettings
  /** Placed noise risers, keyed by their own id -- see @shared/riser and
   * step 4 of docs/superpowers/specs/2026-09-22-builtin-sound-toolkit-design.md.
   *
   * Deliberately its own record rather than a synthetic entry in
   * state.rifffs: a riser has no file, no stems and no slot, so every
   * stemKey-keyed record in this file (vol/mute/muteRegions/busOf/
   * stemFilters/stemSends/stemAutomation) would need a "what does this mean
   * for a thing with no stems" answer it doesn't have. Keeping risers
   * separate means the clip machinery is untouched and the riser carries its
   * own few numbers, which is also exactly the shape the engine consumes.
   *
   * Real arrangement data: persists normally (serialize.ts), and a project
   * saved before this existed loads with an empty record via initialState. */
  risers: Record<string, RiserClip>
  /** The loop-recording region, in bars — null until the user first drags
   * one out on the Ruler. Independent of loopLengthBars (the whole
   * project's own wrap point, computed from placed clips) -- this can be
   * shorter, longer, or positioned anywhere. Persists normally -- real
   * arrangement data, not a transient UI mode. See
   * docs/superpowers/specs/2026-08-03-loop-recording-design.md. */
  loopRegion: LoopRegion
  /** Channels created via "+ rec channel" -- everywhere else, a channel
   * with no entry here is a normal one. Unlike every other channel (which
   * only exists as long as channelOf points a clip at it -- see
   * channelHasAnyClip), a recording channel's lifecycle is independent of
   * clip membership: it can sit empty, waiting to be armed. See
   * docs/superpowers/specs/2026-08-03-loop-recording-design.md. */
  recordingChannelIds: Record<string, true>
  /** Which recording channel, if any, is currently armed and capturing.
   * At most one at a time. Not persisted -- armed state shouldn't survive
   * a save/reload, the same "how I'm currently working" convention the
   * arranger mode itself follows. */
  armedChannelId: string | null
  /** Which recording channel, if any, should currently show a brief "arm
   * me" nudge -- set when the user presses "/" (App.tsx's keydown handler)
   * while an existing empty, unarmed recording channel is already sitting
   * there rather than creating ANOTHER one, per direct feedback that having
   * to separately create a channel THEN arm it felt like an extra manual
   * step. Cleared by the same handler's own timeout a couple seconds later
   * -- purely a transient visual pointer at ChannelRow.tsx's own rec-dot,
   * not a persisted or otherwise meaningful piece of state. Not persisted,
   * same "how I'm currently working" convention as armedChannelId above. */
  recordingArmReminderChannelId: string | null
  /** Populated once from a list-input-devices IPC round-trip when the
   * input device dropdown first opens -- not fetched proactively on every
   * app launch. Not persisted -- devices can change between sessions. */
  availableInputDevices: string[]
  /** Which of availableInputDevices to record from -- null means "not
   * chosen yet" (arming is disabled until something is selected). Not
   * persisted, same reasoning as availableInputDevices itself. */
  selectedInputDevice: string | null
  /** Endlesss-style threshold-gated ("always listening") recording mode --
   * see GatedLoopRecorder's own doc comment (native-engine) and App.tsx's
   * \ key handler. True between successfully enabling it (requires a
   * selected loopRegion of <=16 bars) and either explicitly disabling it
   * (the rec dot, clicked while on) or a failed engine call -- locking in a
   * take (\ while already on) does NOT turn this back off, so repeated \
   * presses can grab successive takes across multiple loop passes. Purely a
   * UI-state mirror of the engine's own armed/not-armed state, not the
   * source of truth -- the \ handler always awaits the real engine IPC
   * result before dispatching this. Not persisted, same "how I'm currently
   * working" convention as armedChannelId above. */
  gatedRecordingEnabled: boolean
  /** Which recording channel the NEXT gated-recording lock-in will land on
   * -- set once when gated recording is enabled (reusing an existing empty
   * recording channel if one exists, else creating one -- see App.tsx's
   * enableGatedRecording), then rotated to a freshly-created empty channel
   * after each successful lock-in (see lockInGatedRecording), so it always
   * points at whichever channel is currently "pending" a take. This is also
   * what ChannelRow.tsx's live waveform overlay binds to -- an earlier
   * version instead searched channelOrder for "the first recording
   * channel," which broke the moment lock-in started minting a NEW channel
   * per take instead of reusing one (see that task's own history): the
   * overlay got stuck on the original, permanently-empty invariant channel
   * forever, on the wrong row, never clearing after a commit. null while
   * gated recording isn't enabled. Not persisted, same "how I'm currently
   * working" convention as armedChannelId/gatedRecordingEnabled above. */
  gatedRecordingChannelId: string | null
  /** Which rifff (by groupId), if any, the NEXT gated-recording lock-in
   * will attach a new STEM to -- set by double-clicking a placed rifff
   * (RifffBlockRow.tsx/SketchStrip.tsx, via useGatedRecordingControls'
   * targetRifffForRecording), mutually exclusive with
   * gatedRecordingChannelId above (enabling recording via either path
   * clears the other -- see targetRifffForRecording's own doc comment).
   * null while nothing is targeted. Not persisted, same "how I'm
   * currently working" convention as gatedRecordingChannelId. See
   * docs/superpowers/specs/2026-08-06-rifff-recording-design.md. */
  gatedRecordingTargetGroupId: string | null
  /** True while the "lock in the most recent recording pass?" confirm
   * dialog (LockInConfirmDialog.tsx) should be showing. Set by
   * useGatedRecordingControls.ts's confirmLockInIfRecording -- multiple
   * components each call that hook independently (App.tsx,
   * RifffBlockRow.tsx), so each gets its OWN local hook state; this field
   * lives here, in the single shared reducer, instead, so no matter which
   * hook instance triggers a confirm, there's still only ever ONE physical
   * dialog rendered (mounted once, unconditionally, from App.tsx's Frame).
   * The dialog's own "which choice did the user make" plumbing is a
   * separate, deliberately-not-reducer-state module-level promise resolver
   * (see useGatedRecordingControls.ts's own pendingLockInResolve) -- this
   * boolean only ever answers "is it visible," never "what was chosen."
   * Not persisted, same "how I'm currently working" convention as
   * gatedRecordingTargetGroupId above. */
  pendingLockInConfirm: boolean
  /** The guided track-design flow's own state (sssketchy) -- null until the
   * user starts a flow from the project menu's own button, and never set by
   * anything else: "sssketchy never appears on his own, not even on an empty
   * project" (docs/superpowers/specs/
   * 2026-09-22-sssketchy-guided-track-design.md, "Starting the flow").
   *
   * Real persisted project data, so a half-finished guided track resumes --
   * it is deliberately NOT in serialize.ts's transient Omit list. What does
   * not survive a load is his VISIBILITY and his CLOCK: deserializeProject
   * runs the whole thing through sanitiseLoadedCoach, which forces a loaded
   * flow to 'dismissed' with a stopped clock, so reopening a project never
   * makes him appear and never fires a ten-minute nudge for time spent
   * with the app closed. Everything about where the user actually got to
   * (step, done/skipped, banked per-phase time) comes back untouched.
   *
   * Not undoable -- all eight COACH_* actions are in history.ts's
   * TRANSIENT_ACTION_TYPES, the same category as SET_ARRANGER_MODE: where
   * you are in the flow is not an arrangement edit. */
  coach: CoachState | null
  rifffs: Record<string, Rifff>
}

export const initialState: AppState = {
  bpm: 80,
  // Index 0 = SNAP_DIVS[0] = 1 (1/1, the coarsest option) -- default grid
  // per explicit user request, so re-one starts at whole-bar precision
  // rather than the previous 1/16 default.
  snapIdx: 0,
  vol: {},
  mute: {},
  off: {},
  stretch: {},
  playedBars: {},
  leftCrop: {},
  muteRegions: {},
  dragVol: {},
  dragPlayedBars: {},
  dragLeftCropBars: {},
  sel: null,
  channelOrder: [],
  channelOf: {},
  recordingArmReminderChannelId: null,
  busOf: {},
  exp: {},
  loopRegion: null,
  recordingChannelIds: {},
  armedChannelId: null,
  availableInputDevices: [],
  selectedInputDevice: null,
  gatedRecordingEnabled: false,
  gatedRecordingChannelId: null,
  gatedRecordingTargetGroupId: null,
  pendingLockInConfirm: false,
  mode: 'sketch',
  mapView: false,
  automationParamOf: {},
  inspectorCollapsed: false,
  tidiedView: false,
  regionSelection: null,
  metronomeEnabled: false,
  masterChain: [null, null, null, null],
  channelPlugins: {},
  stemFilters: {},
  stemSends: {},
  stemAutomation: {},
  reverb: DEFAULT_REVERB,
  risers: {},
  coach: null,
  rifffs: {}
}

// PLAY/PAUSE/STOP/SET_POS deliberately aren't part of this union — they live
// as StoreContext.tsx's own TransportAction/usePos()/usePlaying() instead,
// entirely outside this undo-tracked reducer. Position updates at ~30Hz
// while playing; keeping it here meant every useAppState() consumer across
// the app (most components) re-rendered on every tick, whether or not it
// read state.pos at all. See StoreContext.tsx's module doc comment.
export type Action =
  | {
      type: 'ADD_TO_SHELF'
      rifff: Rifff
      /** Each stem's own committed gain (DiscoverPanel's own per-slot volume
       * slider), keyed by stemKey(groupId, slot) -- optional, and applied
       * only for stems in THIS rifff where state.vol has no entry yet,
       * unlike PLACE_LOOP_ON_TIMELINE's own vol field (an unconditional
       * spread that also clobbers existing entries). When a key is present
       * here, it wins over this case's own sqrtGain loudness-compensation
       * default below -- Discover's own per-slot gains are already real,
       * user-adjusted values (see discoverRifffAssembly.ts), so blindly
       * re-compensating them a second time would make them quieter than
       * intended. Every existing caller omits this field and keeps today's
       * sqrtGain-default behavior unchanged. */
      vol?: Record<string, number>
    }
  | { type: 'PLACE_ON_TIMELINE'; groupId: string; startBar: number }
  | { type: 'MOVE_TO_CHANNEL'; groupId: string; startBar: number; channelId: string }
  | { type: 'ASSIGN_TO_BUS'; stemKey: string; busId: BusId }
  | { type: 'ASSIGN_STEMS_TO_BUS'; stemKeys: string[]; busId: BusId }
  | {
      type: 'PLACE_LOOP_ON_TIMELINE'
      /** Every slot's own full Rifff -- one groupId per Discover slot, each
       * carrying exactly one Stem (a Discover slot is always a single
       * stem, never a multi-stem group of its own). */
      stems: Rifff[]
      startBar: number
      /** Each placed rifff's own committed gain (DiscoverPanel's own
       * per-slot volume slider), keyed by stemKey(groupId, 1) -- optional
       * and merged into state.vol same as PASTE_RIFFF's own `vol` field,
       * so every existing call site (including this action's own pre-
       * volume-slider tests) that omits it keeps reading the universal
       * `state.vol[key] ?? 1` default unchanged. */
      vol?: Record<string, number>
    }
  | { type: 'SEQUENCE_RIFFFS'; groupIds: string[] }
  | { type: 'SELECT'; groupId: string }
  | { type: 'SET_TEMPO'; bpm: number }
  | { type: 'CYCLE_SNAP' }
  | { type: 'SET_SNAP_IDX'; snapIdx: 0 | 1 | 2 | 3 | 4 }
  | { type: 'NUDGE_OFFSET'; key: string; delta: number }
  | { type: 'ZERO_OFFSET'; key: string }
  | { type: 'SET_OFFSET_STEPS'; key: string; steps: number }
  | { type: 'REMOVE_FROM_TIMELINE'; groupId: string }
  | { type: 'DELETE_RIFFFS'; groupIds: string[] }
  | { type: 'SET_PLAYED_BARS'; key: string; bars: number }
  | { type: 'SET_LEFT_CROP_BARS'; groupId: string; bars: number }
  | { type: 'ADD_MUTE_REGION'; stemKeys: string[]; startBar: number; endBar: number }
  | { type: 'REMOVE_MUTE_REGION'; stemKey: string; startBar: number; endBar: number }
  | {
      type: 'SET_REGION_SELECTION'
      selection: {
        stemKeys: string[]
        startBar: number
        endBar: number
        mode: 'mute' | 'unmute'
      } | null
    }
  | {
      type: 'SET_DRAG_PREVIEW'
      field: 'volume' | 'playedBars' | 'leftCropBars'
      key: string
      value: number | undefined
    }
  | { type: 'SET_DRAG_PREVIEW_GROUP_VOLUME'; groupId: string; value: number | undefined }
  | {
      type: 'SET_ONE_SHOT_TRIM'
      groupId: string
      trimStartSec: number
      trimEndSec: number
      startBar: number
    }
  | {
      type: 'SET_ONE_SHOT_STRETCHED'
      groupId: string
      path: string
      durationSec: number
      startBar: number
    }
  | {
      type: 'APPLY_BAKE'
      groupId: string
      results: { path: string; bakedPath: string; durationSec: number }[]
    }
  | {
      type: 'PASTE_RIFFF'
      rifff: Rifff
      vol: Record<string, number>
      mute: Record<string, boolean>
      /** The source clip's drawn toolkit curves, re-keyed onto the new
       * groupId's own stemKeys -- omitted (and treated as {}) by every
       * caller that has nothing to carry. Curves are clip-RELATIVE, so a
       * duplicate needs no re-timing at all: the same points mean the same
       * shape wherever the copy lands. */
      stemAutomation?: Record<string, StemAutomation>
      off: Record<string, number>
      stretch: boolean
    }
  | { type: 'SET_VOLUME'; stemKey: string; volume: number }
  | { type: 'TOGGLE_MUTE'; stemKey: string }
  | { type: 'SET_GROUP_MUTE'; groupId: string; muted: boolean }
  | { type: 'SOLO_GROUP'; groupId: string }
  | { type: 'SET_CHANNEL_MUTE'; channelId: string; muted: boolean }
  | { type: 'SOLO_CHANNEL'; channelId: string }
  | { type: 'SOLO_STEMS'; stemKeys: string[] }
  | { type: 'RESTORE_MUTE'; mute: Record<string, boolean> }
  | { type: 'RESTORE_VOL'; vol: Record<string, number> }
  | { type: 'SET_GROUP_VOLUME'; groupId: string; volume: number }
  | { type: 'TOGGLE_STRETCH'; groupId: string }
  | { type: 'UNGROUP'; groupId: string }
  | { type: 'CYCLE_TYPE'; groupId: string; slot: number }
  | { type: 'SET_STEM_TYPE'; groupId: string; slot: number; soundType: SoundType }
  | { type: 'RENAME_RIFFF'; groupId: string; name: string }
  | { type: 'RENAME_STEM'; groupId: string; slot: number; name: string }
  | { type: 'TOGGLE_EXPAND'; groupId: string }
  | { type: 'SET_ARRANGER_MODE'; mode: ArrangerMode }
  | { type: 'SET_AUTOMATION_PARAM'; laneId: string; param: AutomationParam }
  /** One whole free-draw gesture's result on ONE clip -- a stroke, a ramp,
   * an inserted point, a moved point, a deleted point, or a cleared lane
   * (`points: []`). `points` are in CLIP-RELATIVE bars. Deliberately the
   * ONLY way a curve changes, and deliberately coarse: the lane component
   * keeps its in-progress gesture in local state and dispatches exactly one
   * of these on release, so a drag that sampled two hundred positions is one
   * undo step, not two hundred. Same split the volume/fade drags already use
   * (SET_DRAG_PREVIEW during, SET_VOLUME once on commit), minus the
   * transient half -- an automation gesture's preview never needs to be
   * shared with another component. */
  | {
      type: 'SET_STEM_AUTOMATION'
      stemKey: string
      param: AutomationParam
      points: AutomationPoint[]
    }
  /** The same gesture, dispatched by a COLLAPSED clip's lane: one curve
   * applied identically to every stem in the rifff. A collapsed clip draws
   * its stems as one block and already treats them as one thing for volume
   * (SET_GROUP_VOLUME) and mute (SET_GROUP_MUTE) -- its lane follows the
   * same rule rather than inventing a third convention, and expanding the
   * clip afterwards reveals per-stem lanes that can then diverge. */
  | {
      type: 'SET_GROUP_AUTOMATION'
      groupId: string
      param: AutomationParam
      points: AutomationPoint[]
    }
  /** One finished turn of the resonance dial in a clip's filter lane.
   * Resonance is a stored per-clip SETTING, not a curve (see
   * AUTOMATION_PARAMS in @shared/toolkit): one filter lane you draw, with
   * its resonance as a knob in the corner. Dispatched once per gesture,
   * from the Dial's own onCommit, so a drag is one undo step -- the same
   * split every other live-audible drag here uses, minus the transient
   * preview half (the dial keeps its in-progress value locally; nothing
   * outside the lane needs to see it). */
  | { type: 'SET_STEM_FILTER_RESONANCE'; stemKey: string; resonance: number }
  /** The same turn, on a COLLAPSED clip's lane: one value written to every
   * stem in the rifff, the whole-rifff treatment SET_GROUP_VOLUME /
   * SET_GROUP_MUTE / SET_GROUP_AUTOMATION already give the collapsed view.
   * Stored per stem either way, so expanding afterwards lets them diverge. */
  | { type: 'SET_GROUP_FILTER_RESONANCE'; groupId: string; resonance: number }
  /** Drops a fully-formed riser onto a channel -- the caller builds it with
   * @shared/riser's createRiser (which is where the defaults live), so this
   * action carries no policy of its own beyond normalising what it is
   * handed. */
  | { type: 'ADD_RISER'; riser: RiserClip }
  /** One riser's position. `channelId` is optional so a plain horizontal
   * drag doesn't have to restate the row it is already on. */
  | { type: 'MOVE_RISER'; id: string; startBar: number; channelId?: string }
  /** An edge drag. Resizing from the LEFT moves startBar and lengthBars
   * together, which is why both are here rather than reusing MOVE_RISER. */
  | { type: 'RESIZE_RISER'; id: string; startBar: number; lengthBars: number }
  /** The drawn sweep, from the riser's own automation lane. An EMPTY list is
   * a real, meaningful value here (unlike a stem's cleared curve, which is
   * deleted): it means "play the declared startCutoffValue -> endCutoffValue
   * ramp" -- see RiserClip.curve. */
  | { type: 'SET_RISER_CURVE'; id: string; points: AutomationPoint[] }
  | { type: 'SET_RISER_LEVEL'; id: string; level: number }
  /** This riser's row label. A blank rename is ignored rather than leaving
   * an unlabelled row -- EditableText already discards one, this is the
   * belt-and-braces half. */
  | { type: 'RENAME_RISER'; id: string; name: string }
  /** This riser's own mute. A riser has no stems, so state.mute cannot hold
   * it; muting is what keeps it off the wire entirely (audibleRisers). */
  | { type: 'SET_RISER_MUTE'; id: string; muted: boolean }
  | { type: 'REMOVE_RISER'; id: string }
  | { type: 'TOGGLE_INSPECTOR_COLLAPSED' }
  | { type: 'TOGGLE_TIDIED_VIEW' }
  | { type: 'TOGGLE_METRONOME' }
  | { type: 'SET_MASTER_CHAIN_PLUGIN'; slot: 0 | 1 | 2 | 3; pluginId: string | null }
  | { type: 'SET_CHANNEL_CHAIN_PLUGIN'; channelId: string; slot: 0 | 1; pluginId: string | null }
  | { type: 'SET_LOOP_REGION'; region: LoopRegion }
  | { type: 'ADD_RECORDING_CHANNEL'; channelId: string }
  | { type: 'REMOVE_RECORDING_CHANNEL'; channelId: string }
  | { type: 'ARM_RECORDING_CHANNEL'; channelId: string }
  | { type: 'DISARM_RECORDING_CHANNEL' }
  | { type: 'SET_RECORDING_ARM_REMINDER'; channelId: string | null }
  | { type: 'SET_GATED_RECORDING_ENABLED'; enabled: boolean }
  | { type: 'SET_GATED_RECORDING_CHANNEL'; channelId: string | null }
  | { type: 'SET_GATED_RECORDING_TARGET'; groupId: string | null }
  | { type: 'SET_PENDING_LOCK_IN_CONFIRM'; pending: boolean }
  | { type: 'ADD_STEM_TO_RIFFF'; groupId: string; stem: Rifff['stems'][number] }
  | { type: 'SET_AVAILABLE_INPUT_DEVICES'; devices: string[] }
  | { type: 'SET_SELECTED_INPUT_DEVICE'; device: string | null }
  /** Which VIEW the arranger is showing -- the map or the timeline. Not an
   * ArrangerMode and not an edit; see AppState.mapView. */
  | { type: 'SET_MAP_VIEW'; on: boolean }
  // Every coach action carries `now` rather than letting the reducer read
  // the clock, so the machine stays pure and its tests stay deterministic
  // (see @shared/coach's own module doc). COACH_MINIMISE is the one
  // exception: minimising does not move the clock.
  | { type: 'COACH_START'; now: number }
  | { type: 'COACH_RESUME'; now: number }
  | { type: 'COACH_ADVANCE'; now: number; outcome: CoachOutcome }
  | { type: 'COACH_MINIMISE' }
  | { type: 'COACH_RESTORE'; now: number }
  | { type: 'COACH_DISMISS'; now: number }
  // Carries the Discover slots as a plain snapshot rather than reading them
  // from AppState, because Discover's slots are App.tsx's own React state,
  // not reducer state. Its own step (p1-lock) went with phase one on
  // 2026-09-23; the auto-arranger dispatches this in the map plan.
  | { type: 'COACH_LOCK_CLIMAX'; now: number; slots: readonly CoachSlotSnapshot[]; bpm: number }
  // The auto-arranger's own lock-in. COACH_LOCK_CLIMAX directly above
  // freezes DISCOVER's slots and derives each stem's role from the kinds
  // Discover tagged; this one takes a climax that is already built, because
  // the auto-arranger's material comes off the timeline with a role the user
  // confirmed BY HAND (lockClimaxFromArrangeRoles), and re-deriving that role
  // from kinds would throw the hand-made half away. Both are transient: a
  // lock is where the flow is, not an edit to the project.
  | { type: 'COACH_SET_CLIMAX'; climax: LockedClimax }
  // The arrangement map (2026-09-23). COACH_SET_PHRASE_READING records what
  // the app MEASURED; COACH_SET_PHRASE records what the USER ANSWERED. They
  // are two actions rather than one on purpose: a measurement must never be
  // able to size anything by itself (spec, "The phrase pass, and who
  // decides" -- a direct instruction from Elling). Only the second one
  // re-sizes the map, and only a click dispatches it.
  | { type: 'COACH_SET_PHRASE_READING'; reading: LoopPhraseReading }
  | { type: 'COACH_SET_PHRASE'; phrase: CoachPhrase }
  | { type: 'COACH_SET_LOOP_ANSWER'; loopIs: CoachLoopAnswer }
  | { type: 'COACH_SET_SHAPE'; shape: CoachShapeId }
  /** Fills `sections` from the shape template. Needs a locked climax, a
   * phrase and both answers; without all four it is a no-op rather than a
   * half-built map. `firstStartBar` is placedTimelineSpanBars(state),
   * measured by the caller, so the map lands after anything already down. */
  | { type: 'COACH_BUILD_MAP'; firstStartBar: number }
  /** What the map REALLY placed, recorded right after the clips go down and
   * inside the same BATCH -- the same "record what happened rather than
   * recompute it" rule COACH_PLACE_SECTION followed. Keyed by section id
   * (not index) so a later reorder cannot shift a section's lanes onto its
   * neighbour. */
  | { type: 'COACH_RECORD_MAP_PLACEMENT'; placedGroupIds: Record<string, Record<string, string>> }
  /** The section walk: which column he is standing on. Nulling it LEAVES
   * THE MAP EXACTLY AS IT IS (spec) -- see @shared/coachWalk. */
  | { type: 'COACH_START_WALK'; now: number }
  | { type: 'COACH_WALK_TO'; now: number; index: number }
  | { type: 'COACH_END_WALK'; now: number }
  // Phase three's own bookkeeping. Every one of these is dispatched inside
  // the SAME BATCH as the real edits it records -- the SET_GROUP_AUTOMATION
  // calls that write a curve, or the ADD_RISER / REMOVE_RISER that place or
  // lift a riser (SssketchyTensionPanel.tsx) -- so the arrangement change
  // and the flow's record of it undo together. That is what "one undo step"
  // means here, and it is the same arrangement COACH_PLACE_SECTION has.
  //
  // `riserId` is the id of the riser that was really placed, for the
  // 'riser' kind only, so switching the toggle back off removes exactly
  // that riser and not one the user dropped by hand.
  | {
      type: 'COACH_APPLY_TENSION'
      sectionIndex: number
      kind: CoachTensionKind
      riserId: string | null
    }
  | { type: 'COACH_CLEAR_TENSION'; sectionIndex: number; kind: CoachTensionKind }
  /** An export really wrote a file -- "the project is marked 'V1
   * exported'" (spec). Dispatched from ProjectMenu's own export paths, and
   * only when one of them actually produced something (the dialog-based
   * IPC calls return null when the save panel was cancelled). */
  | { type: 'COACH_MARK_V1_EXPORTED'; now: number }
  | { type: 'LOAD_STATE'; state: AppState }

// Hand-synced copy of selectors.ts's own TIDIED_BUS_ORDER -- store.ts can't
// import from selectors.ts (selectors.ts already imports Action/AppState
// FROM this file, so the reverse import would be circular). Only used for
// the same majority-bus tie-break selectors.ts's busForRifff does, below.
const BUS_ORDER: BusId[] = ['drums', 'bass', 'lead', 'backing', 'aux']

/** After a bus assignment, renames every newly-affected rifff to "{bus}
 * {n}" -- e.g. "drums 1" -- so a tidied project reads at a glance. Per
 * Elling's own explicit call (2026-08-22): unconditional, not just for
 * clips still at a generic default -- most pre-tidy names (raw stem
 * names like "Highpass", "Delay") were "meaningless almost" anyway, so
 * this always overwrites, including a name the user already typed by
 * hand. `busOf` must already reflect the assignment this call is
 * reacting to (the reducer cases below build it first, then pass it in
 * here) so the majority-bus tie-break sees the new assignment, not the
 * stale one. Mirrors busForRifff's own tie-break exactly, duplicated
 * rather than imported (see BUS_ORDER above) -- a rifff with stems split
 * across buses gets named for whichever bus most of its stems are
 * actually on, same as tidied view's own row-grouping logic. */
function renameRifffsForBusAssignment(
  rifffs: Record<string, Rifff>,
  busOf: Record<string, BusId>,
  affectedStemKeys: Iterable<string>
): Record<string, Rifff> {
  const affected = new Set(affectedStemKeys)
  const affectedGroupIds = new Set<string>()
  for (const rifff of Object.values(rifffs)) {
    if (rifff.stems.some((stem) => affected.has(stemKey(rifff.groupId, stem.slot)))) {
      affectedGroupIds.add(rifff.groupId)
    }
  }
  if (affectedGroupIds.size === 0) return rifffs

  const result = { ...rifffs }
  for (const groupId of affectedGroupIds) {
    const rifff = result[groupId]
    const counts: Partial<Record<BusId, number>> = {}
    for (const stem of rifff.stems) {
      const bus = busOf[stemKey(groupId, stem.slot)] ?? 'aux'
      counts[bus] = (counts[bus] ?? 0) + 1
    }
    let bestBus: BusId = 'aux'
    let bestCount = -1
    for (const bus of BUS_ORDER) {
      const count = counts[bus] ?? 0
      if (count > bestCount) {
        bestCount = count
        bestBus = bus
      }
    }
    // Reads Object.values(result) (not the original `rifffs`) so multiple
    // renames within this same batch get sequential numbers instead of
    // all colliding on the same "{bus} 1 — ...". originalNameFromBusName
    // strips any PRIOR "{bus} {n} — " prefix first, so re-tidying an
    // already-renamed clip into a different bus renames cleanly instead
    // of nesting ("bass 2 — drums 1 — Highpass").
    const newName = nextBusClipName(
      Object.values(result).map((r) => r.name),
      bestBus,
      originalNameFromBusName(rifff.name)
    )
    result[groupId] = { ...rifff, name: newName }
  }
  return result
}

/** The mute map SOLO_STEMS produces: every stem of every PLACED rifff
 * muted except exactly `targetStemKeys` -- extracted as its own pure
 * function (not just inlined in the reducer case) so a caller that needs
 * to know the resulting mute state SYNCHRONOUSLY, before it's actually
 * been dispatched/rendered, can compute it directly. Concretely:
 * ClusterStemsBrowser.tsx's startPreview dispatches SOLO_STEMS then
 * immediately wants to flush the corrected mute state to the engine
 * before playing -- but reading it back via a dispatch+rerender+ref
 * round trip isn't synchronous (React batches the dispatch; the ref
 * mirroring `state` only updates after the next render's effects run),
 * so it computes the SAME mute map here instead and passes it straight
 * to useFlushEngineSyncNow's override, guaranteeing the engine sees it
 * immediately rather than racing a later coalesced sync. */
export function soloStemsMute(
  rifffs: Record<string, Rifff>,
  currentMute: Record<string, boolean>,
  targetStemKeys: string[]
): Record<string, boolean> {
  const targetKeys = new Set(targetStemKeys)
  const rifffList = Object.values(rifffs).filter((r) => r.startBar !== undefined)
  const mute = { ...currentMute }
  for (const rifff of rifffList) {
    for (const stem of rifff.stems) {
      const key = stemKey(rifff.groupId, stem.slot)
      mute[key] = !targetKeys.has(key)
    }
  }
  return mute
}

/**
 * What an AUDITION overrides on the real project, for the one engine load
 * that plays it -- Tidy Up's cluster browser and Auto Arrange's role step,
 * both through useStemPreviewPlayback.
 *
 * Two things, and the second is the point. It SOLOS the target (every other
 * placed stem muted, so starting one audition stops whatever the last one
 * was) and lifts the target to its own preview gain (sqrtGain, the same
 * headroom math ADD_TO_SHELF seeds a fresh rifff with) rather than whatever
 * the arrangement has it mixed at -- a stem quietly mixed in the arrangement
 * still auditions at a useful level.
 *
 * And it hands the engine a project with NO TOOLKIT: no filter curve, no
 * resonance, no reverb send, no volume curve, no mute regions, no
 * in-progress gain drag, and no risers. Direct report, 2026-09-23: "tidy up
 * often plays multiple stems at once... they should play individually.
 * (Playing them in tidy up should ignore any automation as well)". Those are
 * one bug, not two -- an audition was rendering through the whole
 * arrangement, so a reverb send drawn on a clip carried its tail straight
 * across the seek into the next audition (a previous stem still sounding
 * over the current one), a filter sweep coloured a stem being judged on its
 * own, and a riser kept playing over all of it. Tidy Up is for deciding what
 * a stem IS, so it has to sound like the file, not like the arrangement.
 *
 * Returned as an overrides object applied to ONE engine build (see
 * StoreContext's flushEngineSyncNow) and never dispatched: the arrangement's
 * real toolkit is untouched and comes straight back the moment the audition
 * is over. `state` is read, never mutated.
 */
export function stemPreviewOverrides(
  state: Pick<AppState, 'rifffs' | 'mute' | 'vol'>,
  targetStemKeys: string[]
): Pick<
  AppState,
  | 'mute'
  | 'vol'
  | 'dragVol'
  | 'stemFilters'
  | 'stemSends'
  | 'stemAutomation'
  | 'muteRegions'
  | 'risers'
> {
  const previewGain = sqrtGain(targetStemKeys.length)
  const vol = { ...state.vol }
  for (const key of targetStemKeys) vol[key] = previewGain
  return {
    mute: soloStemsMute(state.rifffs, state.mute, targetStemKeys),
    vol,
    dragVol: {},
    stemFilters: {},
    stemSends: {},
    stemAutomation: {},
    muteRegions: {},
    risers: {}
  }
}

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'ADD_TO_SHELF': {
      // Seeds each stem's initial volume so a rifff with several stems doesn't
      // clip the moment it's placed and they all sum together at unity gain —
      // sliders are still the ongoing control from here, this only sets where
      // they start. Never overwrites an existing entry, so re-importing (the
      // Inspector's re-import-from-folder flow reuses this same action) doesn't
      // clobber volumes the user already adjusted. action.vol lets a caller
      // with already-real per-stem gains (Discover) override the sqrtGain
      // default outright, still subject to that same never-clobber rule.
      const gain = sqrtGain(action.rifff.stems.length)
      const vol = { ...state.vol }
      for (const stem of action.rifff.stems) {
        const key = stemKey(action.rifff.groupId, stem.slot)
        if (vol[key] === undefined) vol[key] = action.vol?.[key] ?? gain
      }
      return {
        ...state,
        rifffs: { ...state.rifffs, [action.rifff.groupId]: action.rifff },
        vol
      }
    }

    case 'PLACE_ON_TIMELINE': {
      // Auto-assigns a clip its own channel (reusing its own groupId as the
      // channel's id) the moment it's first placed — every OTHER dispatcher
      // of this action (existing tests, SketchStrip.tsx) keeps working with
      // zero changes, since this only ever ADDS a channel, never removes
      // one. Repositioning an already-placed clip leaves its channel exactly
      // as it was — moving it to a DIFFERENT channel is MOVE_TO_CHANNEL's
      // job, not this one's.
      const channelId = state.channelOf[action.groupId] ?? action.groupId
      const placed = placeOnTimeline(state, action.groupId, action.startBar)
      return {
        ...placed,
        channelOf: { ...state.channelOf, [action.groupId]: channelId },
        channelOrder: state.channelOrder.includes(channelId)
          ? state.channelOrder
          : [...state.channelOrder, channelId]
      }
    }

    // Dispatched when a clip is dragged onto a SPECIFIC channel — either an
    // existing one (another ChannelRow's own onDrop) or a brand new one (a
    // ghost row, with the caller minting a fresh crypto.randomUUID() before
    // dispatching), or even a first-ever placement landing directly on a
    // specific existing channel — see App.tsx's Timeline, which uses this
    // for every drop that has a specific channel target, reserving plain
    // PLACE_ON_TIMELINE for dispatchers that don't care (tests,
    // SketchStrip.tsx). Shares placeOnTimeline's bpm/stretch/select logic
    // with PLACE_ON_TIMELINE — the only difference is this ALWAYS sets
    // channelOf explicitly, and cleans up the channel a clip just left if
    // nothing else is on it any more.
    case 'MOVE_TO_CHANNEL': {
      const previousChannelId = state.channelOf[action.groupId]
      const placed = placeOnTimeline(state, action.groupId, action.startBar)
      const channelOf = { ...state.channelOf, [action.groupId]: action.channelId }
      let channelOrder = state.channelOrder.includes(action.channelId)
        ? state.channelOrder
        : [...state.channelOrder, action.channelId]
      let channelPlugins = state.channelPlugins
      if (
        previousChannelId !== undefined &&
        previousChannelId !== action.channelId &&
        !channelHasAnyClip(channelOf, state.risers, previousChannelId) &&
        !state.recordingChannelIds[previousChannelId]
      ) {
        channelOrder = channelOrder.filter((id) => id !== previousChannelId)
        if (previousChannelId in channelPlugins) {
          channelPlugins = { ...channelPlugins }
          delete channelPlugins[previousChannelId]
        }
      }
      return { ...placed, channelOf, channelOrder, channelPlugins }
    }

    case 'ASSIGN_TO_BUS': {
      const busOf = { ...state.busOf, [action.stemKey]: action.busId }
      const rifffs = renameRifffsForBusAssignment(state.rifffs, busOf, [action.stemKey])
      return { ...state, busOf, rifffs }
    }

    // Batched counterpart to ASSIGN_TO_BUS, for the "cluster stems"
    // labelling UI's own per-cluster bus assignment -- a cluster can have
    // many member stems, and assigning them all in one click should be
    // ONE undo step, not one per stem (same reasoning as SET_GROUP_MUTE
    // above).
    case 'ASSIGN_STEMS_TO_BUS': {
      const busOf = { ...state.busOf }
      for (const key of action.stemKeys) busOf[key] = action.busId
      const rifffs = renameRifffsForBusAssignment(state.rifffs, busOf, action.stemKeys)
      return { ...state, busOf, rifffs }
    }

    // Repacks every rifff in groupIds into contiguous bar positions, in that
    // order, starting at bar 0 — the only way rifffs get reordered/inserted
    // in sketch mode (dragging to reorder, or dropping a new rifff in at
    // some position). groupIds must be the COMPLETE set of currently-placed
    // rifffs in their new order: sketch mode only ever calls this with
    // exactly that (isSketchEligible guarantees there's nothing else placed
    // to leave out). One dispatch, one undo entry, regardless of how many
    // rifffs shifted position. trackOrder is replaced outright to match —
    // sketch mode's left-to-right sequence and Normal/Compact mode's
    // top-to-bottom row order stay in sync with each other.
    case 'SEQUENCE_RIFFFS': {
      const rifffs = { ...state.rifffs }
      const stretch = { ...state.stretch }
      const channelOf = { ...state.channelOf }
      let cursor = 0
      for (const groupId of action.groupIds) {
        const rifff = rifffs[groupId]
        rifffs[groupId] = { ...rifff, startBar: cursor }
        // A sketch tile's own playedBars trim (set via SketchStrip's
        // right-click menu) shortens/lengthens how much timeline space it
        // actually occupies in the sequence — not selectors.ts's
        // resolvePlayedBars (importing it here would be circular; every
        // sketch-eligible rifff is linked, so this direct groupId lookup is
        // the same value that helper would resolve to anyway).
        cursor += state.playedBars[groupId] ?? rifff.barLength
        // Sketch mode's tiles always play stretched to project tempo (see
        // the sketch-mode design decision), and this packs positions using
        // each rifff's raw, unstretched barLength — so stretch must be
        // forced on here too, or a rifff carried in with stretch off (e.g.
        // pasted from an existing stretch-off clip) renders at a different
        // width than the position it was just packed at once viewed back in
        // Normal/Compact mode, leaving a visible gap or overlap.
        stretch[groupId] = true
        // One channel per clip, matching sequence order — a sketch-eligible
        // arrangement is always 1:1 clip:channel (see isSketchEligible's own
        // contiguity check, which already rejects multiple channels or
        // overlapping clips).
        channelOf[groupId] = groupId
      }
      // De-duped while preserving first-occurrence order -- defense-in-depth
      // matching ADD_RECORDING_CHANNEL's own guard above. No known caller
      // legitimately passes a duplicate groupId (a rifff can only occupy one
      // sketch-sequence slot), but assigning action.groupIds verbatim would
      // otherwise let one slip straight into channelOrder, which
      // channelsInOrder (selectors.ts) would then render as two literal
      // <ChannelRow> elements for the same clip.
      return {
        ...state,
        rifffs,
        stretch,
        channelOf,
        channelOrder: Array.from(new Set(action.groupIds))
      }
    }

    case 'SELECT':
      // Clicking a clip/rifff title to select it should always bring the
      // inspector back if it's currently collapsed -- selecting something
      // you can't see the details of is never useful.
      return { ...state, sel: action.groupId, inspectorCollapsed: false }

    case 'SET_TEMPO':
      return { ...state, bpm: Math.min(200, Math.max(40, action.bpm)) }

    case 'CYCLE_SNAP':
      return { ...state, snapIdx: ((state.snapIdx + 1) % 5) as AppState['snapIdx'] }

    case 'SET_SNAP_IDX':
      return { ...state, snapIdx: action.snapIdx }

    case 'NUDGE_OFFSET': {
      const current = state.off[action.key] ?? 0
      const next = Math.min(8, Math.max(-8, current + action.delta))
      return { ...state, off: { ...state.off, [action.key]: next } }
    }

    case 'ZERO_OFFSET':
      return { ...state, off: { ...state.off, [action.key]: 0 } }

    // Unlike NUDGE_OFFSET's incremental ±8-step clamp (tuned for the small nudge
    // buttons), this sets an exact value computed elsewhere (the beat-picker) and
    // isn't clamped to that same small range — a stem's true downbeat can legitimately
    // be many bars into its own audio.
    case 'SET_OFFSET_STEPS':
      return { ...state, off: { ...state.off, [action.key]: action.steps } }

    case 'SET_PLAYED_BARS':
      return {
        ...state,
        playedBars: { ...state.playedBars, [action.key]: Math.max(MIN_PLAYED_BARS, action.bars) }
      }

    // Dragging the LEFT resize handle -- unlike the old RESIZE_LEFT this
    // replaces, this never touches startBar or offsetSteps. Cropping is
    // purely a windowing operation: [startBar + leftCropBars, startBar +
    // playedBars) is the visible/audible window, and neither endpoint of
    // that window's own ANCHOR (startBar, offsetSteps) moves -- only how
    // much of the loop is windowed away from the left. See
    // docs/superpowers/specs/2026-08-04-tiled-clip-crop-trim-design.md.
    case 'SET_LEFT_CROP_BARS':
      return {
        ...state,
        leftCrop: { ...state.leftCrop, [action.groupId]: action.bars }
      }

    case 'ADD_MUTE_REGION': {
      const muteRegions = { ...state.muteRegions }
      for (const stemKey of action.stemKeys) {
        const existing = muteRegions[stemKey] ?? []
        muteRegions[stemKey] = [...existing, { startBar: action.startBar, endBar: action.endBar }]
      }
      return { ...state, muteRegions }
    }

    case 'REMOVE_MUTE_REGION': {
      const existing = state.muteRegions[action.stemKey] ?? []
      const next = existing.filter(
        (r) => !(r.startBar === action.startBar && r.endBar === action.endBar)
      )
      return { ...state, muteRegions: { ...state.muteRegions, [action.stemKey]: next } }
    }

    case 'SET_REGION_SELECTION':
      return { ...state, regionSelection: action.selection }

    // Live, in-progress preview for a drag still in flight -- see AppState's
    // own dragVol/etc. field comments. Each field maps to its own slice;
    // value: undefined deletes the key entirely (falls back to the
    // committed value everywhere it's read) rather than storing an
    // undefined placeholder.
    case 'SET_DRAG_PREVIEW': {
      const sliceKey = (
        {
          volume: 'dragVol',
          playedBars: 'dragPlayedBars',
          leftCropBars: 'dragLeftCropBars'
        } as const
      )[action.field]
      const next = { ...state[sliceKey] }
      if (action.value === undefined) delete next[action.key]
      else next[action.key] = action.value
      return { ...state, [sliceKey]: next }
    }

    // Group-level counterpart to SET_DRAG_PREVIEW's 'volume' field, mirroring
    // SET_GROUP_VOLUME's own fan-out -- the collapsed view's envelope drag
    // controls every stem in the rifff together, so its live preview must
    // fan out to every stem's own dragVol entry the same way, not just one.
    case 'SET_DRAG_PREVIEW_GROUP_VOLUME': {
      const rifff = state.rifffs[action.groupId]
      const dragVol = { ...state.dragVol }
      for (const stem of rifff.stems) {
        const key = stemKey(action.groupId, stem.slot)
        if (action.value === undefined) delete dragVol[key]
        else dragVol[key] = action.value
      }
      return { ...state, dragVol }
    }

    case 'SET_ONE_SHOT_TRIM': {
      const rifff = state.rifffs[action.groupId]
      const stem = rifff.stems[0]
      return {
        ...state,
        rifffs: {
          ...state.rifffs,
          [action.groupId]: {
            ...rifff,
            startBar: Math.max(0, action.startBar),
            stems: [{ ...stem, trimStartSec: action.trimStartSec, trimEndSec: action.trimEndSec }]
          }
        }
      }
    }

    // Fired once rubberband's offline render resolves (see the ctrl+drag
    // stretch flow in CollapsedRifffRow.tsx) -- replaces the stem's own
    // audio, clearing any prior trim (the drag that produced this new
    // duration already represents the desired final length; a stale trim
    // from before the stretch has no coherent meaning against it).
    case 'SET_ONE_SHOT_STRETCHED': {
      const rifff = state.rifffs[action.groupId]
      const stem = rifff.stems[0]
      return {
        ...state,
        rifffs: {
          ...state.rifffs,
          [action.groupId]: {
            ...rifff,
            startBar: Math.max(0, action.startBar),
            stems: [
              {
                ...stem,
                path: action.path,
                durationSec: action.durationSec,
                trimStartSec: undefined,
                trimEndSec: undefined
              }
            ]
          }
        }
      }
    }

    case 'REMOVE_FROM_TIMELINE': {
      const rifff = state.rifffs[action.groupId]
      const previousChannelId = state.channelOf[action.groupId]
      const channelOf = { ...state.channelOf }
      delete channelOf[action.groupId]
      const channelBecameEmpty =
        previousChannelId !== undefined &&
        !channelHasAnyClip(channelOf, state.risers, previousChannelId) &&
        !state.recordingChannelIds[previousChannelId]
      const channelOrder = channelBecameEmpty
        ? state.channelOrder.filter((id) => id !== previousChannelId)
        : state.channelOrder
      let channelPlugins = state.channelPlugins
      if (channelBecameEmpty && previousChannelId! in channelPlugins) {
        channelPlugins = { ...channelPlugins }
        delete channelPlugins[previousChannelId!]
      }
      return {
        ...state,
        rifffs: { ...state.rifffs, [action.groupId]: { ...rifff, startBar: undefined } },
        sel: state.sel === action.groupId ? null : state.sel,
        channelOf,
        channelOrder,
        channelPlugins
      }
    }

    // Removes rifffs from the project entirely — the library/shelf's own
    // Delete-key handling (Shelf.tsx), for rifffs that were never placed
    // (a placed one is REMOVE_FROM_TIMELINE's job, which only unplaces it;
    // it stays in the library). Unlike REMOVE_FROM_TIMELINE, this actually
    // deletes the rifff and scrubs every per-stem/per-group field that
    // might reference it, rather than just clearing startBar. Takes a list
    // (not a single groupId) so a multi-select batch delete is one dispatch
    // — one undo entry — regardless of how many rifffs were selected.
    case 'DELETE_RIFFFS': {
      const ids = new Set(action.groupIds)
      const rifffs = { ...state.rifffs }
      const stemKeysToStrip = new Set<string>()
      for (const groupId of ids) {
        const rifff = rifffs[groupId]
        if (!rifff) continue
        for (const stem of rifff.stems) stemKeysToStrip.add(stemKey(groupId, stem.slot))
        delete rifffs[groupId]
      }
      const omitGroups = <T>(rec: Record<string, T>): Record<string, T> => {
        const next = { ...rec }
        for (const groupId of ids) delete next[groupId]
        return next
      }
      const omitStems = <T>(rec: Record<string, T>): Record<string, T> => {
        const next = { ...rec }
        for (const key of stemKeysToStrip) delete next[key]
        return next
      }
      const channelOf = omitGroups(state.channelOf)
      const channelOrder = state.channelOrder.filter(
        (id) => channelHasAnyClip(channelOf, state.risers, id) || state.recordingChannelIds[id]
      )
      const channelPlugins = { ...state.channelPlugins }
      for (const channelId of Object.keys(channelPlugins)) {
        if (
          !channelHasAnyClip(channelOf, state.risers, channelId) &&
          !state.recordingChannelIds[channelId]
        )
          delete channelPlugins[channelId]
      }
      return {
        ...state,
        rifffs,
        vol: omitStems(state.vol),
        mute: omitStems(state.mute),
        muteRegions: omitStems(state.muteRegions),
        busOf: omitStems(state.busOf),
        // The toolkit is per clip now, so its three records are cleaned
        // exactly like vol/mute/muteRegions above -- a deleted clip must not
        // leave a curve behind for a future clip that happens to land on the
        // same groupId:slot (which a re-import genuinely can).
        stemFilters: omitStems(state.stemFilters),
        stemSends: omitStems(state.stemSends),
        stemAutomation: omitStems(state.stemAutomation),
        off: omitGroups(state.off),
        playedBars: omitGroups(state.playedBars),
        stretch: omitGroups(state.stretch),
        exp: omitGroups(state.exp),
        channelOf,
        channelOrder,
        channelPlugins,
        sel: state.sel && ids.has(state.sel) ? null : state.sel,
        // Deleting the rifff a gated recording is currently targeted at
        // (double-click path, see useGatedRecordingControls.ts) would
        // otherwise leave gatedRecordingTargetGroupId dangling -- a
        // subsequent lock-in would silently drop the captured take. Clear
        // it proactively so that can't happen.
        gatedRecordingTargetGroupId:
          state.gatedRecordingTargetGroupId && ids.has(state.gatedRecordingTargetGroupId)
            ? null
            : state.gatedRecordingTargetGroupId
      }
    }

    // Repoints each stem at its freshly-rotated file (a new path, so
    // Waveform's path-keyed cache picks up the corrected audio automatically —
    // no manual cache eviction needed) and resets offset to 0, since the
    // correction that offset was compensating for is now baked into the audio
    // itself. Only for stems that actually got a bakedPath back: bakeOffset
    // silently skips any source it can't rotate in place (e.g. a LORE-sourced
    // stem — an Ogg Vorbis file it has no way to rewrite, and shouldn't
    // anyway, since those are read-only references into Elling's warehouse,
    // never copies). Resetting a stem's offset when it was never actually
    // baked would silently throw away the correction — the runtime offset is
    // the ONLY place it's captured for a stem baking can't reach, so it has
    // to survive this action untouched. The group-level key only resets if
    // every stem in the riff baked successfully — a linked group reads that
    // single key for every stem (see resolveOffsetKey), so zeroing it while
    // even one stem is still relying on the runtime shift would un-correct
    // that stem too.
    case 'APPLY_BAKE': {
      const rifff = state.rifffs[action.groupId]
      const pathMap = new Map(action.results.map((r) => [r.path, r.bakedPath]))
      // durationSec is the baked file's own real, measured length — not
      // necessarily equal to whatever this stem's durationSec already was
      // (a LORE stem's is metadata-derived, not measured from the actual
      // audio; see bakeOffset.ts's BakeResult doc comment). Leaving it stale
      // desyncs the native engine's own tile-boundary scheduling from the
      // real baked file, heard as clicking/stuttering.
      const durationMap = new Map(action.results.map((r) => [r.path, r.durationSec]))
      const stems = rifff.stems.map((s) => ({
        ...s,
        path: pathMap.get(s.path) ?? s.path,
        durationSec: durationMap.get(s.path) ?? s.durationSec
      }))
      const off = { ...state.off }
      if (rifff.stems.every((s) => pathMap.has(s.path))) off[action.groupId] = 0
      for (const s of rifff.stems) {
        if (pathMap.has(s.path)) off[stemKey(action.groupId, s.slot)] = 0
      }
      return {
        ...state,
        rifffs: { ...state.rifffs, [action.groupId]: { ...rifff, stems } },
        off
      }
    }

    // Adds a fresh, independent rifff instance (new groupId, same stem file paths
    // — no audio is actually duplicated on disk) built by pasteRifffAction.
    case 'PASTE_RIFFF':
      return {
        ...state,
        rifffs: { ...state.rifffs, [action.rifff.groupId]: action.rifff },
        vol: { ...state.vol, ...action.vol },
        mute: { ...state.mute, ...action.mute },
        stemAutomation: { ...state.stemAutomation, ...(action.stemAutomation ?? {}) },
        off: { ...state.off, ...action.off },
        stretch: { ...state.stretch, [action.rifff.groupId]: action.stretch },
        sel: action.rifff.groupId,
        // Every pasted/duplicated clip is a fresh groupId that's never had a
        // channel before, so this always ADDS a new one-clip channel — same
        // "own groupId as channel id" default as a first-time PLACE_ON_TIMELINE.
        channelOf: { ...state.channelOf, [action.rifff.groupId]: action.rifff.groupId },
        channelOrder: [...state.channelOrder, action.rifff.groupId]
      }

    // Batched counterpart to PASTE_RIFFF, for placing an entire Discover
    // loop (one fresh whole rifff per slot) onto the timeline at once --
    // same "N items, one undo step" reasoning as ASSIGN_STEMS_TO_BUS above,
    // just for adding brand-new rifffs instead of mutating existing ones.
    // Each slot's rifff gets its own fresh channel, same "own groupId as
    // channel id" treatment PASTE_RIFFF gives a single pasted clip.
    case 'PLACE_LOOP_ON_TIMELINE': {
      const rifffs = { ...state.rifffs }
      const channelOf = { ...state.channelOf }
      const channelOrder = [...state.channelOrder]
      const stretch = { ...state.stretch }
      for (const rifff of action.stems) {
        rifffs[rifff.groupId] = { ...rifff, startBar: action.startBar }
        channelOf[rifff.groupId] = rifff.groupId
        // Same duplicate guard PLACE_ON_TIMELINE/MOVE_TO_CHANNEL already use --
        // channelOrder must never gain a repeated entry (see its own doc
        // comment and channelsInOrder's fallback dedup in selectors.ts, which
        // is documented as a safety net only, not something reducers may rely
        // on). No real caller exists yet (the Discover UI that mints these
        // groupIds is a later task), so nothing today guarantees every
        // action.stems entry -- or every entry against prior state -- is
        // actually unique.
        if (!channelOrder.includes(rifff.groupId)) channelOrder.push(rifff.groupId)
        // Matches placeOnTimeline/PASTE_RIFFF's own "freshly placed rifff
        // defaults to stretch on" behavior -- without this, TOGGLE_STRETCH's
        // own naked `!state.stretch[action.groupId]` negation (no `?? true`
        // fallback) reads `undefined`, so the first toggle after a Discover
        // placement silently writes `true` right back instead of turning
        // stretch off.
        stretch[rifff.groupId] = true
      }
      return {
        ...state,
        rifffs,
        channelOf,
        channelOrder,
        stretch,
        vol: { ...state.vol, ...action.vol }
      }
    }

    case 'SET_VOLUME':
      return {
        ...state,
        vol: { ...state.vol, [action.stemKey]: Math.max(0, Math.min(1, action.volume)) }
      }

    case 'TOGGLE_MUTE':
      return { ...state, mute: { ...state.mute, [action.stemKey]: !state.mute[action.stemKey] } }

    // Sets every stem in the rifff to the same mute state in one atomic edit
    // (one undo step, not one per stem) — the collapsed view's single
    // group-mute button, which mutes/unmutes the whole rifff together rather
    // than exposing each stem's own mute individually.
    case 'SET_GROUP_MUTE': {
      const rifff = state.rifffs[action.groupId]
      const mute = { ...state.mute }
      for (const stem of rifff.stems) {
        mute[stemKey(action.groupId, stem.slot)] = action.muted
      }
      return { ...state, mute }
    }

    // Cmd/Ctrl+right-click on a clip, from any view (expanded, collapsed,
    // sketch) — mutes every stem in every OTHER PLACED rifff and
    // unmutes every stem in this one. A second SOLO_GROUP for the SAME
    // groupId while it's already the only unmuted one toggles back to fully
    // unmuted, rather than needing a separate "un-solo" action or having to
    // snapshot the exact prior per-stem mute state (which stem was
    // individually muted before soloing is usually not what you want
    // restored anyway — "solo" is normally a temporary A/B listen, not a
    // state worth preserving precisely).
    //
    // Scoped to PLACED rifffs only — real bug this fixes: iterating every
    // rifff in state.rifffs (unfiltered) also mutated stems belonging to
    // rifffs still sitting unplaced in the shelf, which never plays and so
    // has no business being touched by "solo." A rifff sitting in the shelf
    // during ANY solo action elsewhere would silently pick up a muted stem
    // it was never actually muted on, surfacing later as "why is this brand
    // new clip already muted" the moment it's dragged onto the timeline.
    case 'SOLO_GROUP': {
      const rifffList = Object.values(state.rifffs).filter((r) => r.startBar !== undefined)
      const alreadySoloed = rifffList.every((rifff) =>
        rifff.stems.every((stem) => {
          const expectedMuted = rifff.groupId !== action.groupId
          return !!state.mute[stemKey(rifff.groupId, stem.slot)] === expectedMuted
        })
      )
      const mute = { ...state.mute }
      for (const rifff of rifffList) {
        for (const stem of rifff.stems) {
          mute[stemKey(rifff.groupId, stem.slot)] = alreadySoloed
            ? false
            : rifff.groupId !== action.groupId
        }
      }
      return { ...state, mute }
    }

    // Channel-level counterpart to SET_GROUP_MUTE/SOLO_GROUP above, for the
    // ChannelRow's own M/S buttons (DAW mode: a channel can host several
    // rifffs sharing one row) — mutes/solos every rifff currently assigned
    // to this channel together, same channelOf lookup channelsInOrder uses.
    case 'SET_CHANNEL_MUTE': {
      const rifffs = Object.values(state.rifffs).filter(
        (r) =>
          r.startBar !== undefined && (state.channelOf[r.groupId] ?? r.groupId) === action.channelId
      )
      const mute = { ...state.mute }
      for (const rifff of rifffs) {
        for (const stem of rifff.stems) {
          mute[stemKey(rifff.groupId, stem.slot)] = action.muted
        }
      }
      // A riser has no stems, so state.mute has nothing to key it by: its
      // own `muted` flag is the other half of this row's m button. Without
      // this, a riser-only row's m button renders, lights up, and changes
      // nothing audible.
      const risers = setRisersMutedOnChannel(state.risers, action.channelId, action.muted)
      return { ...state, mute, risers }
    }

    case 'SOLO_CHANNEL': {
      const rifffList = Object.values(state.rifffs).filter((r) => r.startBar !== undefined)
      const channelOfRifff = (r: Rifff): string => state.channelOf[r.groupId] ?? r.groupId
      const riserList = Object.values(state.risers)
      // Risers join the "is this already the only thing audible" scan on the
      // same terms the clips do -- otherwise soloing a riser-only row would
      // look like a no-op to the toggle and never turn back off.
      const alreadySoloed =
        rifffList.every((rifff) =>
          rifff.stems.every((stem) => {
            const expectedMuted = channelOfRifff(rifff) !== action.channelId
            return !!state.mute[stemKey(rifff.groupId, stem.slot)] === expectedMuted
          })
        ) && riserList.every((riser) => riser.muted === (riser.channelId !== action.channelId))
      const mute = { ...state.mute }
      for (const rifff of rifffList) {
        for (const stem of rifff.stems) {
          mute[stemKey(rifff.groupId, stem.slot)] = alreadySoloed
            ? false
            : channelOfRifff(rifff) !== action.channelId
        }
      }
      // Same identity guard as setRisersMutedOnChannel's: a project with no
      // risers must not get a fresh (equal) record and a needless engine
      // reload out of every solo press.
      let risers = state.risers
      if (riserList.length > 0) {
        risers = {}
        for (const riser of riserList) {
          risers[riser.id] = {
            ...riser,
            muted: alreadySoloed ? false : riser.channelId !== action.channelId
          }
        }
      }
      return { ...state, mute, risers }
    }

    // Solos an arbitrary SET of stems that may span multiple different
    // rifffs -- unlike SOLO_GROUP (whole rifff) or SOLO_CHANNEL (whole
    // channel), the "cluster stems" labelling UI needs to solo just the
    // member stems of one cluster, which can come from anywhere in the
    // project. DELIBERATELY NOT a toggle, unlike SOLO_GROUP/SOLO_CHANNEL
    // above -- this is dispatched repeatedly and idempotently as the user
    // clicks around auditioning different stems/clusters, and a real bug
    // this fixed: with toggle-back-when-already-soloed semantics (this
    // action's original design, copied from SOLO_GROUP), clicking the SAME
    // thumbnail twice in a row (e.g. to scrub to a different point in the
    // same clip) landed on the exact same stemKeys set both times, so the
    // second click matched "already soloed" and silently un-soloed
    // everything back to the full mix -- reported as "clicking around... I
    // hear everything come back." Always solos EXACTLY `action.stemKeys`,
    // every time, no matter what was soloed before. Scoped to placed
    // rifffs only, for the same reason documented on SOLO_GROUP above.
    case 'SOLO_STEMS':
      return { ...state, mute: soloStemsMute(state.rifffs, state.mute, action.stemKeys) }

    // Restores a full mute snapshot verbatim -- used by ClusterStemsBrowser
    // to undo whatever temporary SOLO_STEMS preview-auditioning it did while
    // open, the moment it closes. SOLO_STEMS (like SOLO_GROUP/SOLO_CHANNEL)
    // deliberately discards the exact prior per-stem mute state on solo
    // (documented on SOLO_GROUP above: "solo is normally a temporary A/B
    // listen, not a state worth preserving precisely") -- fine for those
    // in-context solo toggles, but the cluster browser's own preview
    // shouldn't leak into the real arrangement's mute state once you've
    // closed it and gone back to just play the project normally.
    case 'RESTORE_MUTE':
      return { ...state, mute: action.mute }

    // Replaces the whole vol map verbatim -- the volume equivalent of
    // RESTORE_MUTE above, added for useStemPreviewPlayback.ts's own preview-
    // volume boost (2026-09-14: previewing a stem in Tidy Up/Auto-Arrange
    // should let you actually hear it regardless of how quiet it's mixed in
    // the real rifff/arrangement -- see that hook's own doc comment). Used
    // BOTH directions there: applying the temporary full-volume-ish preview
    // override, and restoring the real vol map once that preview's own
    // caller closes/unmounts. Not mute-specific in name or shape on
    // purpose -- a plain "set the whole map" primitive, same as RESTORE_MUTE
    // already is in practice even though only one caller uses it today.
    case 'RESTORE_VOL':
      return { ...state, vol: action.vol }

    // Sets every stem in the rifff to the same volume in one atomic edit —
    // the collapsed view's own envelope drag, which (like SET_GROUP_MUTE)
    // controls the whole rifff together rather than exposing each stem's own
    // volume individually.
    case 'SET_GROUP_VOLUME': {
      const rifff = state.rifffs[action.groupId]
      const vol = { ...state.vol }
      const volume = Math.max(0, Math.min(1, action.volume))
      for (const stem of rifff.stems) {
        vol[stemKey(action.groupId, stem.slot)] = volume
      }
      return { ...state, vol }
    }

    case 'TOGGLE_STRETCH':
      return {
        ...state,
        stretch: { ...state.stretch, [action.groupId]: !state.stretch[action.groupId] }
      }

    // Splits every stem in a linked, multi-stem rifff into its own
    // independent one-stem rifff, immediately and permanently — matching the
    // user's own "grouping/ungrouping" framing. There's deliberately no
    // reverse action (RELINK doesn't exist any more): once split, each stem
    // is an ordinary placed rifff like any other, with nothing left
    // connecting it back to its old siblings except that they all land on
    // the same channel, at the same startBar, as the parent did — stacked
    // exactly on top of each other (channels already allow overlap; see
    // channelHasAnyClip's own doc comment), so dragging them apart is the
    // very next, obvious thing to do.
    case 'UNGROUP': {
      const rifff = state.rifffs[action.groupId]
      const channelId = state.channelOf[action.groupId]
      const groupOff = state.off[action.groupId] ?? 0
      const groupPlayedBars = state.playedBars[action.groupId] ?? rifff.barLength
      const groupStretch = state.stretch[action.groupId] ?? true

      const rifffs = { ...state.rifffs }
      delete rifffs[action.groupId]
      const vol = { ...state.vol }
      const mute = { ...state.mute }
      const busOf = { ...state.busOf }
      // The toolkit is per CLIP, and ungrouping turns one clip into N clips
      // that each keep their own audio -- so each stem's curves/filter/send
      // ride along to its new groupId, exactly like vol/mute below. Without
      // this, ungrouping would silently wipe every drawn curve in the rifff.
      const stemFilters = { ...state.stemFilters }
      const stemSends = { ...state.stemSends }
      const stemAutomation = { ...state.stemAutomation }
      const off = { ...state.off }
      const playedBars = { ...state.playedBars }
      const stretch = { ...state.stretch }
      const channelOf = { ...state.channelOf }
      // The parent's own group-level entries are gone once it's deleted below
      // — nothing left to reference them.
      delete off[action.groupId]
      delete playedBars[action.groupId]
      delete stretch[action.groupId]
      delete channelOf[action.groupId]

      const newGroupIds: string[] = []
      for (const stem of rifff.stems) {
        const newGroupId = crypto.randomUUID()
        newGroupIds.push(newGroupId)
        // A tidy-up bus assignment is keyed by groupId:slot -- without
        // carrying it over to the new groupId below, a previously-tidied
        // stem would silently lose its bus (falling back to the neutral
        // aux/grey color, and its name reverting to the bare stem name)
        // the instant it got ungrouped, even though nothing about its
        // actual categorization changed. Reported 2026-08-22: "when i
        // tidy... and then ungroup, they appear grey... still have the
        // original stem names."
        const oldBusKey = stemKey(action.groupId, stem.slot)
        const newBusKey = stemKey(newGroupId, stem.slot)
        const bus = state.busOf[oldBusKey]
        if (bus !== undefined) busOf[newBusKey] = bus
        delete busOf[oldBusKey]
        // Only rename if this stem actually has a real bus assignment --
        // never fabricate a "aux 1 — " prefix on something that was
        // simply never tidied. originalNameFromBusName guards against
        // nesting if the PARENT rifff's own name already carried a prior
        // bus prefix (e.g. it was tidied, then had more stems added,
        // then got ungrouped again).
        const name =
          bus === undefined
            ? stem.name
            : nextBusClipName(
                Object.values(rifffs).map((r) => r.name),
                bus,
                originalNameFromBusName(stem.name)
              )
        rifffs[newGroupId] = {
          groupId: newGroupId,
          name,
          bpm: rifff.bpm,
          // The group's own CURRENT resolved length (reflecting any active
          // resize), not stem.barLength — matches pasteStemAction's own
          // "duplicate it, or a trimmed portion of it" convention.
          barLength: groupPlayedBars,
          folderPath: rifff.folderPath,
          startBar: rifff.startBar,
          stems: [{ ...stem }]
        }
        const oldKey = stemKey(action.groupId, stem.slot)
        const newKey = stemKey(newGroupId, stem.slot)
        if (state.vol[oldKey] !== undefined) vol[newKey] = state.vol[oldKey]
        if (state.mute[oldKey] !== undefined) mute[newKey] = state.mute[oldKey]
        delete vol[oldKey]
        delete mute[oldKey]
        if (state.stemFilters[oldKey] !== undefined) stemFilters[newKey] = state.stemFilters[oldKey]
        if (state.stemSends[oldKey] !== undefined) stemSends[newKey] = state.stemSends[oldKey]
        if (state.stemAutomation[oldKey] !== undefined)
          stemAutomation[newKey] = state.stemAutomation[oldKey]
        delete stemFilters[oldKey]
        delete stemSends[oldKey]
        delete stemAutomation[oldKey]
        off[newGroupId] = groupOff
        stretch[newGroupId] = groupStretch
        channelOf[newGroupId] = channelId
      }

      return {
        ...state,
        rifffs,
        vol,
        mute,
        busOf,
        stemFilters,
        stemSends,
        stemAutomation,
        off,
        playedBars,
        stretch,
        channelOf,
        sel: newGroupIds[0] ?? null,
        // Ungrouping the rifff a gated recording is currently targeted at
        // (double-click path, see useGatedRecordingControls.ts) would
        // otherwise leave gatedRecordingTargetGroupId dangling -- a
        // subsequent lock-in would silently drop the captured take. Clear
        // it proactively so that can't happen.
        gatedRecordingTargetGroupId:
          state.gatedRecordingTargetGroupId === action.groupId
            ? null
            : state.gatedRecordingTargetGroupId
      }
    }

    case 'CYCLE_TYPE': {
      const rifff = state.rifffs[action.groupId]
      const stems = rifff.stems.map((s) =>
        s.slot === action.slot
          ? { ...s, type: TYPE_ORDER[(TYPE_ORDER.indexOf(s.type) + 1) % TYPE_ORDER.length] }
          : s
      )
      return { ...state, rifffs: { ...state.rifffs, [action.groupId]: { ...rifff, stems } } }
    }

    // Set directly (as opposed to CYCLE_TYPE's click-to-advance), for the
    // auto-guessed type from a quick heuristic analysis run once at import —
    // only applied while the stem is still at the untouched default ('fx'), so a
    // guess that resolves after the user's already corrected a stem by hand (or
    // after an earlier guess already landed) never clobbers it.
    case 'SET_STEM_TYPE': {
      const rifff = state.rifffs[action.groupId]
      const stems = rifff.stems.map((s) =>
        s.slot === action.slot && s.type === 'fx' ? { ...s, type: action.soundType } : s
      )
      return { ...state, rifffs: { ...state.rifffs, [action.groupId]: { ...rifff, stems } } }
    }

    // Trimmed and rejected-if-blank at the call site (Inspector's EditableText),
    // not here — mirrors SET_TEMPO's own "revert rather than commit garbage"
    // handling, keeping the reducer itself a pure, unconditional write.
    case 'RENAME_RIFFF': {
      const rifff = state.rifffs[action.groupId]
      return {
        ...state,
        rifffs: { ...state.rifffs, [action.groupId]: { ...rifff, name: action.name } }
      }
    }

    case 'RENAME_STEM': {
      const rifff = state.rifffs[action.groupId]
      const stems = rifff.stems.map((s) =>
        s.slot === action.slot ? { ...s, name: action.name } : s
      )
      return { ...state, rifffs: { ...state.rifffs, [action.groupId]: { ...rifff, stems } } }
    }

    case 'TOGGLE_EXPAND':
      return { ...state, exp: { ...state.exp, [action.groupId]: !state.exp[action.groupId] } }

    case 'TOGGLE_METRONOME':
      return { ...state, metronomeEnabled: !state.metronomeEnabled }

    case 'SET_MASTER_CHAIN_PLUGIN': {
      const masterChain = [...state.masterChain] as AppState['masterChain']
      masterChain[action.slot] = action.pluginId
      return { ...state, masterChain }
    }

    case 'SET_CHANNEL_CHAIN_PLUGIN': {
      const existing = state.channelPlugins[action.channelId] ?? [null, null]
      const slots = [...existing] as [string | null, string | null]
      slots[action.slot] = action.pluginId
      return { ...state, channelPlugins: { ...state.channelPlugins, [action.channelId]: slots } }
    }

    case 'SET_ARRANGER_MODE':
      return { ...state, mode: action.mode }

    case 'SET_MAP_VIEW':
      return state.mapView === action.on ? state : { ...state, mapView: action.on }

    case 'SET_AUTOMATION_PARAM':
      return {
        ...state,
        automationParamOf: { ...state.automationParamOf, [action.laneId]: action.param }
      }

    case 'SET_STEM_AUTOMATION':
      return {
        ...state,
        stemAutomation: writeCurve(
          state.stemAutomation,
          [action.stemKey],
          action.param,
          action.points
        )
      }

    case 'SET_GROUP_AUTOMATION': {
      const rifff = state.rifffs[action.groupId]
      if (!rifff) return state
      return {
        ...state,
        stemAutomation: writeCurve(
          state.stemAutomation,
          rifff.stems.map((stem) => stemKey(action.groupId, stem.slot)),
          action.param,
          action.points
        )
      }
    }

    case 'SET_STEM_FILTER_RESONANCE':
      return {
        ...state,
        stemFilters: writeFilterResonance(state.stemFilters, [action.stemKey], action.resonance)
      }

    case 'SET_GROUP_FILTER_RESONANCE': {
      const rifff = state.rifffs[action.groupId]
      if (!rifff) return state
      return {
        ...state,
        stemFilters: writeFilterResonance(
          state.stemFilters,
          rifff.stems.map((stem) => stemKey(action.groupId, stem.slot)),
          action.resonance
        )
      }
    }

    case 'ADD_RISER': {
      const normalised = normaliseRiser(action.riser)
      // An unnamed riser is numbered HERE rather than in createRiser,
      // because this is the only place that can see the other risers -- and
      // the only place that stays correct inside a BATCH adding several at
      // once (history.ts re-enters this reducer per action, so the second
      // riser already sees the first one's name taken).
      const riser =
        normalised.name === '' ? { ...normalised, name: nextRiserName(state.risers) } : normalised
      // A riser keeps its own row alive (see channelHasAnyClip), so a riser
      // landing on a channel nobody has placed a clip on yet has to put that
      // channel into channelOrder itself -- otherwise channelsInOrder would
      // render it in first-seen fallback position rather than where the user
      // dropped it.
      const channelOrder = state.channelOrder.includes(riser.channelId)
        ? state.channelOrder
        : [...state.channelOrder, riser.channelId]
      return {
        ...state,
        channelOrder,
        risers: { ...state.risers, [riser.id]: riser }
      }
    }

    case 'MOVE_RISER': {
      const existing = state.risers[action.id]
      if (!existing) return state
      const channelId = action.channelId ?? existing.channelId
      const riser = normaliseRiser({ ...existing, startBar: action.startBar, channelId })
      const channelOrder = state.channelOrder.includes(channelId)
        ? state.channelOrder
        : [...state.channelOrder, channelId]
      const risers = { ...state.risers, [action.id]: riser }
      // Same "did the row this just left run out of content" cleanup
      // MOVE_TO_CHANNEL does for clips -- computed against the NEW risers
      // record, so a riser dragged onto another row can't leave a ghost row
      // behind it.
      const leftBehind = existing.channelId
      const stillOccupied =
        leftBehind === channelId ||
        channelHasAnyClip(state.channelOf, risers, leftBehind) ||
        !!state.recordingChannelIds[leftBehind]
      return {
        ...state,
        risers,
        channelOrder: stillOccupied ? channelOrder : channelOrder.filter((id) => id !== leftBehind)
      }
    }

    case 'RESIZE_RISER': {
      const existing = state.risers[action.id]
      if (!existing) return state
      return {
        ...state,
        risers: {
          ...state.risers,
          [action.id]: normaliseRiser({
            ...existing,
            startBar: action.startBar,
            lengthBars: Math.max(MIN_RISER_LENGTH_BARS, action.lengthBars)
          })
        }
      }
    }

    case 'SET_RISER_CURVE': {
      const existing = state.risers[action.id]
      if (!existing) return state
      return {
        ...state,
        risers: {
          ...state.risers,
          [action.id]: normaliseRiser({ ...existing, curve: action.points })
        }
      }
    }

    case 'SET_RISER_LEVEL': {
      const existing = state.risers[action.id]
      if (!existing) return state
      return {
        ...state,
        risers: {
          ...state.risers,
          [action.id]: normaliseRiser({ ...existing, level: action.level })
        }
      }
    }

    case 'RENAME_RISER': {
      const existing = state.risers[action.id]
      if (!existing) return state
      const name = action.name.trim()
      if (name === '') return state
      return { ...state, risers: { ...state.risers, [action.id]: { ...existing, name } } }
    }

    case 'SET_RISER_MUTE': {
      const existing = state.risers[action.id]
      if (!existing) return state
      if (existing.muted === action.muted) return state
      return {
        ...state,
        risers: { ...state.risers, [action.id]: { ...existing, muted: action.muted } }
      }
    }

    case 'REMOVE_RISER': {
      const existing = state.risers[action.id]
      if (!existing) return state
      const risers = { ...state.risers }
      delete risers[action.id]
      const stillOccupied =
        channelHasAnyClip(state.channelOf, risers, existing.channelId) ||
        !!state.recordingChannelIds[existing.channelId]
      return {
        ...state,
        risers,
        channelOrder: stillOccupied
          ? state.channelOrder
          : state.channelOrder.filter((id) => id !== existing.channelId)
      }
    }

    case 'TOGGLE_INSPECTOR_COLLAPSED':
      return { ...state, inspectorCollapsed: !state.inspectorCollapsed }

    case 'TOGGLE_TIDIED_VIEW':
      return { ...state, tidiedView: !state.tidiedView }

    case 'SET_LOOP_REGION':
      return { ...state, loopRegion: action.region }

    case 'ADD_RECORDING_CHANNEL':
      return {
        ...state,
        channelOrder: state.channelOrder.includes(action.channelId)
          ? state.channelOrder
          : [...state.channelOrder, action.channelId],
        recordingChannelIds: { ...state.recordingChannelIds, [action.channelId]: true }
      }

    case 'REMOVE_RECORDING_CHANNEL': {
      const recordingChannelIds = { ...state.recordingChannelIds }
      delete recordingChannelIds[action.channelId]
      // Un-place (not delete) any clip still on this channel, mirroring
      // REMOVE_FROM_TIMELINE's own treatment of a channel that's about to
      // disappear -- a committed take landing here is the normal case (see
      // ChannelRow's handleToggleArm commit flow), so removing the channel
      // it's parked on must not silently orphan it: invisible in the UI
      // (channelOf would point at a channelId no longer in channelOrder)
      // but still present in rifffsMap, with unclear serialization/export
      // behavior.
      const channelOf = { ...state.channelOf }
      const rifffs = { ...state.rifffs }
      for (const groupId of Object.keys(channelOf)) {
        if (channelOf[groupId] === action.channelId) {
          delete channelOf[groupId]
          rifffs[groupId] = { ...rifffs[groupId], startBar: undefined }
        }
      }
      let channelPlugins = state.channelPlugins
      if (action.channelId in channelPlugins) {
        channelPlugins = { ...channelPlugins }
        delete channelPlugins[action.channelId]
      }
      // Guards against a dangling gatedRecordingChannelId -- if the user
      // manually removes the exact channel currently pinned as the
      // gated-recording target (see its own doc comment), the next lock-in
      // would otherwise try to place a take on a channelId no longer in
      // recordingChannelIds. Cleared rather than re-picked here since
      // there's no live loop region context in this reducer to validate a
      // replacement against -- App.tsx's enableGatedRecording already
      // handles "no target pinned yet" by picking/creating one fresh.
      const gatedRecordingChannelId =
        state.gatedRecordingChannelId === action.channelId ? null : state.gatedRecordingChannelId
      return {
        ...state,
        channelOrder: state.channelOrder.filter((id) => id !== action.channelId),
        recordingChannelIds,
        gatedRecordingChannelId,
        channelOf,
        rifffs,
        channelPlugins,
        armedChannelId: state.armedChannelId === action.channelId ? null : state.armedChannelId
      }
    }

    case 'ARM_RECORDING_CHANNEL':
      return { ...state, armedChannelId: action.channelId }

    case 'DISARM_RECORDING_CHANNEL':
      return { ...state, armedChannelId: null }

    case 'SET_RECORDING_ARM_REMINDER':
      return { ...state, recordingArmReminderChannelId: action.channelId }

    case 'SET_GATED_RECORDING_ENABLED':
      return { ...state, gatedRecordingEnabled: action.enabled }

    case 'SET_GATED_RECORDING_CHANNEL':
      return { ...state, gatedRecordingChannelId: action.channelId }

    case 'SET_GATED_RECORDING_TARGET':
      return { ...state, gatedRecordingTargetGroupId: action.groupId }

    case 'SET_PENDING_LOCK_IN_CONFIRM':
      return { ...state, pendingLockInConfirm: action.pending }

    case 'ADD_STEM_TO_RIFFF': {
      const rifff = state.rifffs[action.groupId]
      // Defense-in-depth: a caller can legitimately race a dispatch against
      // a groupId that's already gone by the time this reducer runs (see
      // lockInGatedRecording's stale-closure race in
      // useGatedRecordingControls.ts -- fixed there by re-reading live
      // state before dispatching, but this guard means ANY future caller
      // mistake, not just that one, can't corrupt the state tree by
      // spreading `undefined`). No-op rather than throw.
      if (!rifff) return state
      // Seed the new stem's own vol entry so it doesn't sum in at unity
      // gain against siblings that are already headroom-scaled (the bug:
      // a stem added here previously fell back to buildEngineProject.ts's
      // default of 1 when no vol entry existed, clipping the mix). Scale
      // by the rifff's total stem count INCLUDING the new one -- the same
      // ballpark ADD_TO_SHELF would have used had this stem been part of
      // the original import. Existing stems' entries are never touched:
      // some may already be user-adjusted away from their original seed,
      // and re-normalizing everyone else's volume is a bigger behavior
      // change than this fix is about.
      const key = stemKey(action.groupId, action.stem.slot)
      const vol = { ...state.vol, [key]: sqrtGain(rifff.stems.length + 1) }
      return {
        ...state,
        rifffs: {
          ...state.rifffs,
          [action.groupId]: {
            ...rifff,
            stems: [...rifff.stems, action.stem],
            // Mirrors buildRifff.ts's own "a rifff's own barLength is the
            // max across its stems" convention -- only extends, never
            // shrinks (a shorter new stem doesn't truncate its siblings).
            barLength: Math.max(rifff.barLength, action.stem.barLength)
          }
        },
        vol
      }
    }

    case 'SET_AVAILABLE_INPUT_DEVICES':
      return { ...state, availableInputDevices: action.devices }

    case 'SET_SELECTED_INPUT_DEVICE':
      return { ...state, selectedInputDevice: action.device }

    // COACH_START is the only one that works with no flow in progress --
    // it is what the project-menu button dispatches the first time, and
    // again after a flow has finished (a finished flow has nowhere left to
    // resume to, so pressing the button starts a fresh one). Every other
    // coach action is a no-op without a flow, so a stray dispatch can never
    // conjure sssketchy onto the screen.
    case 'COACH_START':
      return { ...state, coach: startCoach(action.now) }

    case 'COACH_RESUME':
      return state.coach === null
        ? state
        : { ...state, coach: resumeCoach(state.coach, action.now) }

    case 'COACH_ADVANCE':
      return state.coach === null
        ? state
        : { ...state, coach: advanceCoach(state.coach, action.now, action.outcome) }

    case 'COACH_MINIMISE':
      return state.coach === null ? state : { ...state, coach: minimiseCoach(state.coach) }

    case 'COACH_RESTORE':
      return state.coach === null
        ? state
        : { ...state, coach: restoreCoach(state.coach, action.now) }

    case 'COACH_DISMISS':
      return state.coach === null
        ? state
        : { ...state, coach: dismissCoach(state.coach, action.now) }

    case 'COACH_LOCK_CLIMAX':
      return state.coach === null
        ? state
        : {
            ...state,
            coach: lockCoachClimax(state.coach, action.now, action.slots, action.bpm)
          }

    // RECORDS a measurement and does nothing else. It must never be able to
    // size anything by itself -- that is COACH_SET_PHRASE below, and only a
    // click dispatches that one.
    case 'COACH_SET_CLIMAX':
      return state.coach === null
        ? state
        : { ...state, coach: { ...state.coach, lockedClimax: action.climax } }

    case 'COACH_SET_PHRASE_READING':
      return state.coach === null
        ? state
        : { ...state, coach: { ...state.coach, phraseReading: action.reading } }

    case 'COACH_SET_PHRASE': {
      if (state.coach === null) return state
      const from = state.coach.phrase?.bars ?? action.phrase.bars
      return {
        ...state,
        coach: {
          ...state.coach,
          phrase: action.phrase,
          // RE-SIZES, never rebuilds -- names, types, ids and every cell
          // edit survive a change of mind about the phrase length (spec).
          sections: resizeCoachMapToPhrase(state.coach.sections, from, action.phrase.bars)
        }
      }
    }

    case 'COACH_SET_LOOP_ANSWER':
      return state.coach === null
        ? state
        : { ...state, coach: { ...state.coach, loopIs: action.loopIs } }

    case 'COACH_SET_SHAPE':
      return state.coach === null
        ? state
        : { ...state, coach: { ...state.coach, shape: action.shape } }

    case 'COACH_BUILD_MAP': {
      const coach = state.coach
      if (coach === null) return state
      // All four or nothing: a half-built map is worse than no map, and
      // every one of these comes from a gesture the user has or has not
      // made yet.
      if (coach.lockedClimax === null) return state
      if (coach.phrase === null || coach.loopIs === null || coach.shape === null) return state
      return {
        ...state,
        coach: {
          ...coach,
          sections: buildCoachMapSections({
            shape: coach.shape,
            loopIs: coach.loopIs,
            phraseBars: coach.phrase.bars,
            climax: coach.lockedClimax,
            firstStartBar: action.firstStartBar
          })
        }
      }
    }

    case 'COACH_RECORD_MAP_PLACEMENT': {
      if (state.coach === null) return state
      return {
        ...state,
        coach: {
          ...state.coach,
          sections: state.coach.sections.map((section): CoachSection => {
            const placed = action.placedGroupIds[section.id]
            return placed === undefined ? section : { ...section, placedGroupIds: placed }
          })
        }
      }
    }

    case 'COACH_START_WALK':
      return state.coach === null
        ? state
        : { ...state, coach: startCoachWalk(state.coach, action.now) }

    case 'COACH_WALK_TO':
      return state.coach === null
        ? state
        : { ...state, coach: walkCoachTo(state.coach, action.now, action.index) }

    case 'COACH_END_WALK':
      return state.coach === null
        ? state
        : { ...state, coach: endCoachWalk(state.coach, action.now) }

    case 'COACH_APPLY_TENSION':
      return state.coach === null
        ? state
        : {
            ...state,
            coach: applyCoachTension(state.coach, action.sectionIndex, action.kind, action.riserId)
          }

    case 'COACH_CLEAR_TENSION':
      return state.coach === null
        ? state
        : { ...state, coach: clearCoachTension(state.coach, action.sectionIndex, action.kind) }

    case 'COACH_MARK_V1_EXPORTED':
      return state.coach === null
        ? state
        : { ...state, coach: markCoachV1Exported(state.coach, action.now) }

    case 'LOAD_STATE':
      return action.state

    default: {
      const _exhaustive: never = action
      return _exhaustive
    }
  }
}
