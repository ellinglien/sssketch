import { TYPE_ORDER, stemKey, type Rifff, type SoundType } from '@shared/types'
import { sqrtGain } from '@shared/mixGain'

export const SNAP_DIVS = [4, 8, 16, 32] as const

// A played length of 0 would never schedule any audio (and risks a divide-
// by-zero downstream) — unlike a stem position of 0, which is meaningful.
// Exported so the arranger row's drag-time preview clamp can share this
// exact value instead of duplicating the literal.
export const MIN_PLAYED_BARS = 0.25

export interface AppState {
  playing: boolean
  pos: number
  bpm: number
  snapIdx: 0 | 1 | 2 | 3
  vol: Record<string, number>
  mute: Record<string, boolean>
  off: Record<string, number>
  stretch: Record<string, boolean>
  unlinked: Record<string, boolean>
  /** Independent position for an unlinked stem, keyed by stemKey. Only consulted
   * while that stem's group is unlinked — a linked stem always follows its
   * group's own startBar, same as before unlinking existed. */
  stemStart: Record<string, number>
  /** Fade in/out length, in bars, keyed by groupId. Applies at the clip's overall
   * start/end (not at each internal tiling repetition) during both live playback
   * and export. */
  fadeIn: Record<string, number>
  fadeOut: Record<string, number>
  /** This stem's own played length, in bars — the tiling loop's bound for this
   * specific stem, resolved via resolveOffsetKey (shared while linked, per-stem
   * once unlinked). Unset means "use rifff.barLength" — today's implicit
   * behavior, unchanged for a project with no resize edits. */
  playedBars: Record<string, number>
  sel: string | null
  exp: Record<string, boolean>
  /** Global interaction mode for the expanded waveform's open body: false (default)
   * drags the clip, true repurposes the same drag to adjust volume instead. Toggled
   * by the V key — see App.tsx's Frame component. Not persisted (see serialize.ts). */
  volumeDragMode: boolean
  /** Global arrangement-wide view mode: false (default) is today's per-rifff
   * collapsed/expanded rendering, true replaces every rifff's row with a
   * small fixed-size tile at its real timeline position (CompactRifffBlock).
   * Toggled by the Tab key, Ableton-style — see App.tsx's Frame component.
   * Not persisted (see serialize.ts). */
  compactMode: boolean
  rifffs: Record<string, Rifff>
}

export const initialState: AppState = {
  playing: false,
  pos: 0,
  bpm: 80,
  snapIdx: 2,
  vol: {},
  mute: {},
  off: {},
  stretch: {},
  unlinked: {},
  stemStart: {},
  fadeIn: {},
  fadeOut: {},
  playedBars: {},
  sel: null,
  exp: {},
  volumeDragMode: false,
  compactMode: false,
  rifffs: {}
}

export type Action =
  | { type: 'ADD_TO_SHELF'; rifff: Rifff }
  | { type: 'PLACE_ON_TIMELINE'; groupId: string; startBar: number }
  | { type: 'SELECT'; groupId: string }
  | { type: 'SET_TEMPO'; bpm: number }
  | { type: 'CYCLE_SNAP' }
  | { type: 'NUDGE_OFFSET'; key: string; delta: number }
  | { type: 'ZERO_OFFSET'; key: string }
  | { type: 'SET_OFFSET_STEPS'; key: string; steps: number }
  | { type: 'REMOVE_FROM_TIMELINE'; groupId: string }
  | { type: 'SET_STEM_START'; key: string; startBar: number }
  | { type: 'SET_PLAYED_BARS'; key: string; bars: number }
  | { type: 'RESIZE_LEFT'; groupId: string; slot: number; bars: number; startBar: number }
  | { type: 'SET_FADE_IN'; groupId: string; bars: number }
  | { type: 'SET_FADE_OUT'; groupId: string; bars: number }
  | { type: 'APPLY_BAKE'; groupId: string; results: { path: string; bakedPath: string }[] }
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
  | { type: 'SET_GROUP_VOLUME'; groupId: string; volume: number }
  | { type: 'TOGGLE_STRETCH'; groupId: string }
  | { type: 'UNLINK'; groupId: string }
  | { type: 'RELINK'; groupId: string }
  | { type: 'CYCLE_TYPE'; groupId: string; slot: number }
  | { type: 'SET_STEM_TYPE'; groupId: string; slot: number; soundType: SoundType }
  | { type: 'TOGGLE_EXPAND'; groupId: string }
  | { type: 'TOGGLE_VOLUME_DRAG_MODE' }
  | { type: 'TOGGLE_COMPACT_MODE' }
  | { type: 'PLAY' }
  | { type: 'PAUSE' }
  | { type: 'STOP' }
  | { type: 'SET_POS'; pos: number }
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
      const rifff = state.rifffs[action.groupId]
      // The very first clip placed on an otherwise-empty timeline sets the
      // project's tempo, rather than leaving it at the app's arbitrary default —
      // repositioning that same clip, or placing a second one alongside it,
      // shouldn't retrigger this.
      const isFirstPlacement =
        rifff.startBar === undefined &&
        !Object.values(state.rifffs).some(
          (r) => r.groupId !== action.groupId && r.startBar !== undefined
        )
      return {
        ...state,
        rifffs: {
          ...state.rifffs,
          [action.groupId]: { ...rifff, startBar: Math.max(0, action.startBar) }
        },
        bpm: isFirstPlacement ? rifff.bpm : state.bpm,
        sel: action.groupId,
        stretch: { ...state.stretch, [action.groupId]: true }
      }
    }

    case 'SELECT':
      return { ...state, sel: action.groupId }

    case 'SET_TEMPO':
      return { ...state, bpm: Math.min(200, Math.max(40, action.bpm)) }

    case 'CYCLE_SNAP':
      return { ...state, snapIdx: ((state.snapIdx + 1) % 4) as AppState['snapIdx'] }

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

    case 'SET_STEM_START':
      return {
        ...state,
        stemStart: { ...state.stemStart, [action.key]: Math.max(0, action.startBar) }
      }

    case 'SET_PLAYED_BARS':
      return {
        ...state,
        playedBars: { ...state.playedBars, [action.key]: Math.max(MIN_PLAYED_BARS, action.bars) }
      }

    // Dragging the LEFT resize handle: playedBars and the stem's start move
    // together in one atomic edit (one undo step, not two) so the clip's
    // right edge — where the loop currently ends — stays exactly in place
    // while the loop extends backward. Same linked/unlinked resolution as
    // SET_PLAYED_BARS/SET_STEM_START individually: shared across the group's
    // own startBar while linked, independent per-stem once unlinked.
    case 'RESIZE_LEFT': {
      const playedBarsKey = state.unlinked[action.groupId]
        ? stemKey(action.groupId, action.slot)
        : action.groupId
      const playedBars = {
        ...state.playedBars,
        [playedBarsKey]: Math.max(MIN_PLAYED_BARS, action.bars)
      }
      if (state.unlinked[action.groupId]) {
        return {
          ...state,
          playedBars,
          stemStart: {
            ...state.stemStart,
            [stemKey(action.groupId, action.slot)]: Math.max(0, action.startBar)
          }
        }
      }
      const rifff = state.rifffs[action.groupId]
      return {
        ...state,
        playedBars,
        rifffs: {
          ...state.rifffs,
          [action.groupId]: { ...rifff, startBar: Math.max(0, action.startBar) }
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
      return {
        ...state,
        rifffs: { ...state.rifffs, [action.groupId]: { ...rifff, startBar: undefined } },
        sel: state.sel === action.groupId ? null : state.sel
      }
    }

    // Repoints each stem at its freshly-rotated file (a new path, so
    // Waveform's path-keyed cache picks up the corrected audio automatically —
    // no manual cache eviction needed) and resets offset to 0, since the
    // correction that offset was compensating for is now baked into the audio
    // itself. Resets both the group key and every per-stem key, covering linked
    // and unlinked groups alike.
    case 'APPLY_BAKE': {
      const rifff = state.rifffs[action.groupId]
      const pathMap = new Map(action.results.map((r) => [r.path, r.bakedPath]))
      const stems = rifff.stems.map((s) => ({ ...s, path: pathMap.get(s.path) ?? s.path }))
      const off = { ...state.off, [action.groupId]: 0 }
      for (const s of rifff.stems) off[stemKey(action.groupId, s.slot)] = 0
      return {
        ...state,
        rifffs: { ...state.rifffs, [action.groupId]: { ...rifff, stems } },
        off
      }
    }

    // Adds a fresh, independent rifff instance (new groupId, same stem file paths
    // — no audio is actually duplicated on disk) built by pasteRifffAction. Always
    // lands linked, regardless of the source's unlinked state: replaying a
    // hand-diverged per-stem arrangement onto a new position/groupId gets messy
    // fast, so the paste starts clean and the user can re-unlink from there if
    // they want that again.
    case 'PASTE_RIFFF':
      return {
        ...state,
        rifffs: { ...state.rifffs, [action.rifff.groupId]: action.rifff },
        vol: { ...state.vol, ...action.vol },
        mute: { ...state.mute, ...action.mute },
        off: { ...state.off, ...action.off },
        stretch: { ...state.stretch, [action.rifff.groupId]: action.stretch },
        sel: action.rifff.groupId
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

    case 'UNLINK': {
      const rifff = state.rifffs[action.groupId]
      const groupOffset = state.off[action.groupId] ?? 0
      const off = { ...state.off }
      const stemStart = { ...state.stemStart }
      for (const stem of rifff.stems) {
        const key = stemKey(action.groupId, stem.slot)
        off[key] = groupOffset
        // Seeded to the group's current position so nothing visually jumps at the
        // moment of unlinking — dragging a stem afterward is what actually makes
        // it diverge.
        stemStart[key] = rifff.startBar ?? 0
      }
      // The group-level off[groupId] entry is intentionally left in place (unused while
      // unlinked) rather than deleted — resolveOffsetKey always reads the per-stem key
      // when unlinked, and RELINK makes the group key authoritative again.
      return { ...state, unlinked: { ...state.unlinked, [action.groupId]: true }, off, stemStart }
    }

    case 'RELINK':
      return { ...state, unlinked: { ...state.unlinked, [action.groupId]: false } }

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

    case 'TOGGLE_EXPAND':
      return { ...state, exp: { ...state.exp, [action.groupId]: !state.exp[action.groupId] } }

    case 'TOGGLE_VOLUME_DRAG_MODE':
      return { ...state, volumeDragMode: !state.volumeDragMode }

    case 'TOGGLE_COMPACT_MODE':
      return { ...state, compactMode: !state.compactMode }

    case 'PLAY':
      return { ...state, playing: true }

    case 'PAUSE':
      return { ...state, playing: false }

    case 'STOP':
      return { ...state, playing: false, pos: 0 }

    case 'SET_POS':
      return { ...state, pos: action.pos }

    case 'LOAD_STATE':
      return action.state

    default: {
      const _exhaustive: never = action
      return _exhaustive
    }
  }
}
