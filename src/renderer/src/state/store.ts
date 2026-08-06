import { TYPE_ORDER, stemKey, type BusId, type Rifff, type SoundType } from '@shared/types'
import { sqrtGain } from '@shared/mixGain'

// Capped at 1/16 -- 1/32 existed here before but was finer than anyone
// actually needed in practice (per direct user feedback: "it can get so
// fine but it doesn't need to be").
export const SNAP_DIVS = [4, 8, 16] as const

// A played length of 0 would never schedule any audio (and risks a divide-
// by-zero downstream) — unlike a stem position of 0, which is meaningful.
// Exported so the arranger row's drag-time preview clamp can share this
// exact value instead of duplicating the literal.
export const MIN_PLAYED_BARS = 0.25

// True if some placed clip still has channelOf pointing at channelId — used
// to decide whether a channel that just lost a clip (moved elsewhere,
// removed, or deleted) still has anything left on it, or should drop out of
// channelOrder entirely. A channel is never a persisted, independently
// "created"/"deleted" thing — it exists exactly as long as something is on
// it (see channelOrder's own doc comment).
function channelHasAnyClip(channelOf: Record<string, string>, channelId: string): boolean {
  return Object.values(channelOf).includes(channelId)
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

export type ArrangerMode = 'normal' | 'sketch'

export type LoopRegion = { startBar: number; endBar: number } | null

export interface AppState {
  bpm: number
  snapIdx: 0 | 1 | 2
  vol: Record<string, number>
  mute: Record<string, boolean>
  off: Record<string, number>
  stretch: Record<string, boolean>
  /** Fade in/out length, in bars, keyed by groupId. Applies at the clip's overall
   * start/end (not at each internal tiling repetition) during both live playback
   * and export. */
  fadeIn: Record<string, number>
  fadeOut: Record<string, number>
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
   * populated on every mousemove of a volume/fade/length/crop drag,
   * cleared on release. Transient (see history.ts's TRANSIENT_ACTION_TYPES)
   * -- these are UI/audio previews, never real edits worth an undo
   * checkpoint. Shared store state (not per-component useState) so every
   * component reading the same key -- e.g. every StemWaveformRow instance
   * sharing a groupId -- sees the SAME in-progress value live, not just the
   * one row actually being dragged. See
   * docs/superpowers/specs/2026-08-04-live-drag-preview-design.md. */
  dragVol: Record<string, number>
  dragFadeIn: Record<string, number>
  dragFadeOut: Record<string, number>
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
  /** Global interaction mode for the expanded waveform's open body: false (default)
   * drags the clip, true repurposes the same drag to adjust volume instead. Toggled
   * by the V key — see App.tsx's Frame component. Not persisted (see serialize.ts). */
  volumeDragMode: boolean
  /** Global arrangement-wide view mode. 'normal' is today's per-rifff
   * collapsed/expanded rendering. 'sketch' replaces the whole Timeline with
   * a single gapless sequence strip (SketchStrip) — only reachable when
   * isSketchEligible(state) (see selectors.ts). Cycled by the Tab key via
   * selectors.ts's nextArrangerMode — see App.tsx's Frame component. Not
   * persisted (see serialize.ts). */
  mode: ArrangerMode
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
   * same "how I'm currently working" treatment as volumeDragMode. */
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
   * a save/reload, matching volumeDragMode's own "how I'm currently
   * working" convention. */
  armedChannelId: string | null
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
  rifffs: Record<string, Rifff>
}

export const initialState: AppState = {
  bpm: 80,
  snapIdx: 2,
  vol: {},
  mute: {},
  off: {},
  stretch: {},
  fadeIn: {},
  fadeOut: {},
  playedBars: {},
  leftCrop: {},
  muteRegions: {},
  dragVol: {},
  dragFadeIn: {},
  dragFadeOut: {},
  dragPlayedBars: {},
  dragLeftCropBars: {},
  sel: null,
  channelOrder: [],
  channelOf: {},
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
  volumeDragMode: false,
  mode: 'sketch',
  inspectorCollapsed: false,
  tidiedView: false,
  regionSelection: null,
  metronomeEnabled: false,
  masterChain: [null, null, null, null],
  channelPlugins: {},
  rifffs: {}
}

// PLAY/PAUSE/STOP/SET_POS deliberately aren't part of this union — they live
// as StoreContext.tsx's own TransportAction/usePos()/usePlaying() instead,
// entirely outside this undo-tracked reducer. Position updates at ~30Hz
// while playing; keeping it here meant every useAppState() consumer across
// the app (most components) re-rendered on every tick, whether or not it
// read state.pos at all. See StoreContext.tsx's module doc comment.
export type Action =
  | { type: 'ADD_TO_SHELF'; rifff: Rifff }
  | { type: 'PLACE_ON_TIMELINE'; groupId: string; startBar: number }
  | { type: 'MOVE_TO_CHANNEL'; groupId: string; startBar: number; channelId: string }
  | { type: 'ASSIGN_TO_BUS'; stemKey: string; busId: BusId }
  | { type: 'ASSIGN_STEMS_TO_BUS'; stemKeys: string[]; busId: BusId }
  | { type: 'SEQUENCE_RIFFFS'; groupIds: string[] }
  | { type: 'SELECT'; groupId: string }
  | { type: 'SET_TEMPO'; bpm: number }
  | { type: 'CYCLE_SNAP' }
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
      field: 'volume' | 'fadeIn' | 'fadeOut' | 'playedBars' | 'leftCropBars'
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
  | { type: 'SET_FADE_IN'; groupId: string; bars: number }
  | { type: 'SET_FADE_OUT'; groupId: string; bars: number }
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
  | { type: 'SET_GROUP_VOLUME'; groupId: string; volume: number }
  | { type: 'TOGGLE_STRETCH'; groupId: string }
  | { type: 'UNGROUP'; groupId: string }
  | { type: 'CYCLE_TYPE'; groupId: string; slot: number }
  | { type: 'SET_STEM_TYPE'; groupId: string; slot: number; soundType: SoundType }
  | { type: 'RENAME_RIFFF'; groupId: string; name: string }
  | { type: 'RENAME_STEM'; groupId: string; slot: number; name: string }
  | { type: 'TOGGLE_EXPAND'; groupId: string }
  | { type: 'TOGGLE_VOLUME_DRAG_MODE' }
  | { type: 'SET_VOLUME_DRAG_MODE'; enabled: boolean }
  | { type: 'SET_ARRANGER_MODE'; mode: ArrangerMode }
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
  | { type: 'SET_GATED_RECORDING_ENABLED'; enabled: boolean }
  | { type: 'SET_GATED_RECORDING_CHANNEL'; channelId: string | null }
  | { type: 'SET_GATED_RECORDING_TARGET'; groupId: string | null }
  | { type: 'ADD_STEM_TO_RIFFF'; groupId: string; stem: Rifff['stems'][number] }
  | { type: 'SET_AVAILABLE_INPUT_DEVICES'; devices: string[] }
  | { type: 'SET_SELECTED_INPUT_DEVICE'; device: string | null }
  | { type: 'LOAD_STATE'; state: AppState }

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'ADD_TO_SHELF': {
      // Seeds each stem's initial volume so a rifff with several stems doesn't
      // clip the moment it's placed and they all sum together at unity gain —
      // sliders are still the ongoing control from here, this only sets where
      // they start. Never overwrites an existing entry, so re-importing (the
      // Inspector's re-import-from-folder flow reuses this same action) doesn't
      // clobber volumes the user already adjusted.
      const gain = sqrtGain(action.rifff.stems.length)
      const vol = { ...state.vol }
      for (const stem of action.rifff.stems) {
        const key = stemKey(action.rifff.groupId, stem.slot)
        if (vol[key] === undefined) vol[key] = gain
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
        !channelHasAnyClip(channelOf, previousChannelId) &&
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

    case 'ASSIGN_TO_BUS':
      return { ...state, busOf: { ...state.busOf, [action.stemKey]: action.busId } }

    // Batched counterpart to ASSIGN_TO_BUS, for the "cluster stems"
    // labelling UI's own per-cluster bus assignment -- a cluster can have
    // many member stems, and assigning them all in one click should be
    // ONE undo step, not one per stem (same reasoning as SET_GROUP_MUTE
    // above).
    case 'ASSIGN_STEMS_TO_BUS': {
      const busOf = { ...state.busOf }
      for (const key of action.stemKeys) busOf[key] = action.busId
      return { ...state, busOf }
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
      return { ...state, rifffs, stretch, channelOf, channelOrder: action.groupIds }
    }

    case 'SELECT':
      // Clicking a clip/rifff title to select it should always bring the
      // inspector back if it's currently collapsed -- selecting something
      // you can't see the details of is never useful.
      return { ...state, sel: action.groupId, inspectorCollapsed: false }

    case 'SET_TEMPO':
      return { ...state, bpm: Math.min(200, Math.max(40, action.bpm)) }

    case 'CYCLE_SNAP':
      return { ...state, snapIdx: ((state.snapIdx + 1) % 3) as AppState['snapIdx'] }

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
          fadeIn: 'dragFadeIn',
          fadeOut: 'dragFadeOut',
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

    // Upper-bounded loosely here (a sane ceiling, not the real constraint) —
    // the actual "can't exceed half the clip's own duration" clamp happens where
    // the fade is applied (the native engine), since that's the only place
    // that knows the clip's actual length in seconds.
    case 'SET_FADE_IN':
      return { ...state, fadeIn: { ...state.fadeIn, [action.groupId]: Math.max(0, action.bars) } }

    case 'SET_FADE_OUT':
      return { ...state, fadeOut: { ...state.fadeOut, [action.groupId]: Math.max(0, action.bars) } }

    case 'REMOVE_FROM_TIMELINE': {
      const rifff = state.rifffs[action.groupId]
      const previousChannelId = state.channelOf[action.groupId]
      const channelOf = { ...state.channelOf }
      delete channelOf[action.groupId]
      const channelBecameEmpty =
        previousChannelId !== undefined &&
        !channelHasAnyClip(channelOf, previousChannelId) &&
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
        (id) => channelHasAnyClip(channelOf, id) || state.recordingChannelIds[id]
      )
      const channelPlugins = { ...state.channelPlugins }
      for (const channelId of Object.keys(channelPlugins)) {
        if (!channelHasAnyClip(channelOf, channelId) && !state.recordingChannelIds[channelId])
          delete channelPlugins[channelId]
      }
      return {
        ...state,
        rifffs,
        vol: omitStems(state.vol),
        mute: omitStems(state.mute),
        muteRegions: omitStems(state.muteRegions),
        busOf: omitStems(state.busOf),
        off: omitGroups(state.off),
        playedBars: omitGroups(state.playedBars),
        stretch: omitGroups(state.stretch),
        fadeIn: omitGroups(state.fadeIn),
        fadeOut: omitGroups(state.fadeOut),
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
        off: { ...state.off, ...action.off },
        stretch: { ...state.stretch, [action.rifff.groupId]: action.stretch },
        sel: action.rifff.groupId,
        // Every pasted/duplicated clip is a fresh groupId that's never had a
        // channel before, so this always ADDS a new one-clip channel — same
        // "own groupId as channel id" default as a first-time PLACE_ON_TIMELINE.
        channelOf: { ...state.channelOf, [action.rifff.groupId]: action.rifff.groupId },
        channelOrder: [...state.channelOrder, action.rifff.groupId]
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
      return { ...state, mute }
    }

    case 'SOLO_CHANNEL': {
      const rifffList = Object.values(state.rifffs).filter((r) => r.startBar !== undefined)
      const channelOfRifff = (r: Rifff): string => state.channelOf[r.groupId] ?? r.groupId
      const alreadySoloed = rifffList.every((rifff) =>
        rifff.stems.every((stem) => {
          const expectedMuted = channelOfRifff(rifff) !== action.channelId
          return !!state.mute[stemKey(rifff.groupId, stem.slot)] === expectedMuted
        })
      )
      const mute = { ...state.mute }
      for (const rifff of rifffList) {
        for (const stem of rifff.stems) {
          mute[stemKey(rifff.groupId, stem.slot)] = alreadySoloed
            ? false
            : channelOfRifff(rifff) !== action.channelId
        }
      }
      return { ...state, mute }
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
    case 'SOLO_STEMS': {
      const targetKeys = new Set(action.stemKeys)
      const rifffList = Object.values(state.rifffs).filter((r) => r.startBar !== undefined)
      const mute = { ...state.mute }
      for (const rifff of rifffList) {
        for (const stem of rifff.stems) {
          const key = stemKey(rifff.groupId, stem.slot)
          mute[key] = !targetKeys.has(key)
        }
      }
      return { ...state, mute }
    }

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
      const groupFadeIn = state.fadeIn[action.groupId] ?? 0
      const groupFadeOut = state.fadeOut[action.groupId] ?? 0
      const groupStretch = state.stretch[action.groupId] ?? true

      const rifffs = { ...state.rifffs }
      delete rifffs[action.groupId]
      const vol = { ...state.vol }
      const mute = { ...state.mute }
      const off = { ...state.off }
      const playedBars = { ...state.playedBars }
      const fadeIn = { ...state.fadeIn }
      const fadeOut = { ...state.fadeOut }
      const stretch = { ...state.stretch }
      const channelOf = { ...state.channelOf }
      // The parent's own group-level entries are gone once it's deleted below
      // — nothing left to reference them.
      delete off[action.groupId]
      delete playedBars[action.groupId]
      delete fadeIn[action.groupId]
      delete fadeOut[action.groupId]
      delete stretch[action.groupId]
      delete channelOf[action.groupId]

      const newGroupIds: string[] = []
      for (const stem of rifff.stems) {
        const newGroupId = crypto.randomUUID()
        newGroupIds.push(newGroupId)
        rifffs[newGroupId] = {
          groupId: newGroupId,
          name: stem.name,
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
        off[newGroupId] = groupOff
        fadeIn[newGroupId] = groupFadeIn
        fadeOut[newGroupId] = groupFadeOut
        stretch[newGroupId] = groupStretch
        channelOf[newGroupId] = channelId
      }

      return {
        ...state,
        rifffs,
        vol,
        mute,
        off,
        playedBars,
        fadeIn,
        fadeOut,
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

    case 'TOGGLE_VOLUME_DRAG_MODE':
      return { ...state, volumeDragMode: !state.volumeDragMode }

    // Explicit-set counterpart to TOGGLE_VOLUME_DRAG_MODE above — used by
    // the Option-key hold gesture (App.tsx), which needs to force a known
    // value (true while held, then restore to whatever it was before the
    // key went down) rather than blindly toggle, since a toggle-based
    // approach can't correctly "restore to normal" if a hold's keydown/keyup
    // pair races with the V-key's own toggle.
    case 'SET_VOLUME_DRAG_MODE':
      return { ...state, volumeDragMode: action.enabled }

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

    case 'TOGGLE_INSPECTOR_COLLAPSED':
      return { ...state, inspectorCollapsed: !state.inspectorCollapsed }

    case 'TOGGLE_TIDIED_VIEW':
      return { ...state, tidiedView: !state.tidiedView }

    case 'SET_LOOP_REGION':
      return { ...state, loopRegion: action.region }

    case 'ADD_RECORDING_CHANNEL':
      return {
        ...state,
        channelOrder: [...state.channelOrder, action.channelId],
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

    case 'SET_GATED_RECORDING_ENABLED':
      return { ...state, gatedRecordingEnabled: action.enabled }

    case 'SET_GATED_RECORDING_CHANNEL':
      return { ...state, gatedRecordingChannelId: action.channelId }

    case 'SET_GATED_RECORDING_TARGET':
      return { ...state, gatedRecordingTargetGroupId: action.groupId }

    case 'ADD_STEM_TO_RIFFF': {
      const rifff = state.rifffs[action.groupId]
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
        }
      }
    }

    case 'SET_AVAILABLE_INPUT_DEVICES':
      return { ...state, availableInputDevices: action.devices }

    case 'SET_SELECTED_INPUT_DEVICE':
      return { ...state, selectedInputDevice: action.device }

    case 'LOAD_STATE':
      return action.state

    default: {
      const _exhaustive: never = action
      return _exhaustive
    }
  }
}
