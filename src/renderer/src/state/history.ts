import { reducer, type Action, type AppState } from './store'

export type HistoryAction = Action | { type: 'UNDO' } | { type: 'REDO' }

export interface HistoryState {
  past: AppState[]
  present: AppState
  future: AppState[]
}

// Well past what a user would ever actually walk back through by hand — mostly a
// guard against unbounded memory growth over a very long session, not a
// meaningfully-felt limit.
const MAX_HISTORY = 100

// Transport/playback state, not the arrangement itself — excluded from history so
// playback (which dispatches SET_POS ~18x/sec while playing) doesn't flood the
// undo stack with meaningless checkpoints between real edits.
const TRANSIENT_ACTION_TYPES = new Set<Action['type']>(['SET_POS', 'PLAY', 'PAUSE', 'STOP'])

export function createHistoryState(present: AppState): HistoryState {
  return { past: [], present, future: [] }
}

export function historyReducer(state: HistoryState, action: HistoryAction): HistoryState {
  if (action.type === 'UNDO') {
    if (state.past.length === 0) return state
    const previous = state.past[state.past.length - 1]
    return {
      past: state.past.slice(0, -1),
      present: previous,
      future: [state.present, ...state.future]
    }
  }

  if (action.type === 'REDO') {
    if (state.future.length === 0) return state
    const [next, ...rest] = state.future
    return {
      past: [...state.past, state.present],
      present: next,
      future: rest
    }
  }

  // Loading a different project shouldn't let you undo back into the previous
  // one's state — starts a fresh history.
  if (action.type === 'LOAD_STATE') {
    return createHistoryState(reducer(state.present, action))
  }

  if (TRANSIENT_ACTION_TYPES.has(action.type)) {
    return { ...state, present: reducer(state.present, action) }
  }

  const past = [...state.past, state.present].slice(-MAX_HISTORY)
  return { past, present: reducer(state.present, action), future: [] }
}
