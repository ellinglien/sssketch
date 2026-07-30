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

// PLAY/PAUSE/STOP/SET_POS used to need an entry here (transport state, not
// the arrangement — dispatched ~18x/sec while playing, which would've
// flooded the undo stack with meaningless checkpoints) but no longer reach
// this reducer at all now that they live in StoreContext.tsx's own
// TransportAction, entirely outside history. What's left are UI-mode
// toggles that still go through this reducer (so useAppState() consumers
// see them) but shouldn't themselves be undo-able edits.
const TRANSIENT_ACTION_TYPES = new Set<Action['type']>([
  'TOGGLE_VOLUME_DRAG_MODE',
  'TOGGLE_COMPACT_MODE',
  'TOGGLE_INSPECTOR_COLLAPSED'
])

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
