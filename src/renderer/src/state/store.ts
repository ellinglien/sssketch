import { TYPE_ORDER, stemKey, type Rifff } from '@shared/types'

export const SNAP_DIVS = [4, 8, 16, 32] as const

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
  sel: string | null
  exp: Record<string, boolean>
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
  sel: null,
  exp: {},
  rifffs: {}
}

export type Action =
  | { type: 'ADD_TO_SHELF'; rifff: Rifff }
  | { type: 'PLACE_ON_TIMELINE'; groupId: string; startBar: number }
  | { type: 'SELECT'; groupId: string }
  | { type: 'TOGGLE_EXPAND'; groupId: string }
  | { type: 'SET_TEMPO'; bpm: number }
  | { type: 'CYCLE_SNAP' }
  | { type: 'NUDGE_OFFSET'; key: string; delta: number }
  | { type: 'ZERO_OFFSET'; key: string }
  | { type: 'SET_OFFSET_STEPS'; key: string; steps: number }
  | { type: 'REMOVE_FROM_TIMELINE'; groupId: string }
  | { type: 'SET_VOLUME'; stemKey: string; volume: number }
  | { type: 'TOGGLE_MUTE'; stemKey: string }
  | { type: 'TOGGLE_STRETCH'; groupId: string }
  | { type: 'UNLINK'; groupId: string }
  | { type: 'RELINK'; groupId: string }
  | { type: 'CYCLE_TYPE'; groupId: string; slot: number }
  | { type: 'PLAY' }
  | { type: 'PAUSE' }
  | { type: 'STOP' }
  | { type: 'SET_POS'; pos: number }
  | { type: 'LOAD_STATE'; state: AppState }

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'ADD_TO_SHELF':
      return { ...state, rifffs: { ...state.rifffs, [action.rifff.groupId]: action.rifff } }

    case 'PLACE_ON_TIMELINE':
      return {
        ...state,
        rifffs: {
          ...state.rifffs,
          [action.groupId]: { ...state.rifffs[action.groupId], startBar: action.startBar }
        },
        sel: action.groupId,
        exp: { ...state.exp, [action.groupId]: true },
        stretch: { ...state.stretch, [action.groupId]: true }
      }

    case 'SELECT':
      return { ...state, sel: action.groupId }

    case 'TOGGLE_EXPAND':
      return { ...state, exp: { ...state.exp, [action.groupId]: !state.exp[action.groupId] } }

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

    case 'REMOVE_FROM_TIMELINE': {
      const rifff = state.rifffs[action.groupId]
      return {
        ...state,
        rifffs: { ...state.rifffs, [action.groupId]: { ...rifff, startBar: undefined } },
        sel: state.sel === action.groupId ? null : state.sel
      }
    }

    case 'SET_VOLUME':
      return { ...state, vol: { ...state.vol, [action.stemKey]: action.volume } }

    case 'TOGGLE_MUTE':
      return { ...state, mute: { ...state.mute, [action.stemKey]: !state.mute[action.stemKey] } }

    case 'TOGGLE_STRETCH':
      return {
        ...state,
        stretch: { ...state.stretch, [action.groupId]: !state.stretch[action.groupId] }
      }

    case 'UNLINK': {
      const rifff = state.rifffs[action.groupId]
      const groupOffset = state.off[action.groupId] ?? 0
      const off = { ...state.off }
      for (const stem of rifff.stems) {
        off[stemKey(action.groupId, stem.slot)] = groupOffset
      }
      // The group-level off[groupId] entry is intentionally left in place (unused while
      // unlinked) rather than deleted — resolveOffsetKey always reads the per-stem key
      // when unlinked, and RELINK makes the group key authoritative again.
      return { ...state, unlinked: { ...state.unlinked, [action.groupId]: true }, off }
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
