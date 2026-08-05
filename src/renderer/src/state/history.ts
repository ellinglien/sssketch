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
  'SET_VOLUME_DRAG_MODE',
  'SET_ARRANGER_MODE',
  'TOGGLE_INSPECTOR_COLLAPSED',
  'TOGGLE_METRONOME',
  'ARM_RECORDING_CHANNEL',
  'DISARM_RECORDING_CHANNEL',
  // A pure IPC-fetch side effect (App.tsx's input-device dropdown re-fetches
  // on every focus while the list is still empty), not a user edit worth an
  // undo checkpoint -- same "how I'm currently working" category as
  // volumeDragMode/metronomeEnabled above, not the arrangement itself.
  'SET_AVAILABLE_INPUT_DEVICES',
  // Fired on every mousemove of a volume/fade/length/crop drag (see
  // AppState's own dragVol/etc. field comments) -- an undo checkpoint per
  // mousemove would flood the undo stack meaninglessly; the REAL edit is
  // whatever commit action (SET_VOLUME, SET_FADE_IN, ...) fires once on
  // release, which is NOT in this set.
  'SET_DRAG_PREVIEW',
  'SET_DRAG_PREVIEW_GROUP_VOLUME',
  // The in-progress/pending region selection -- same "not a real edit"
  // treatment as SET_DRAG_PREVIEW; the real edits are ADD_MUTE_REGION/
  // REMOVE_MUTE_REGION, dispatched once Delete/Backspace actually commits.
  'SET_REGION_SELECTION'
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
      // armedChannelId rides along inside every pushed snapshot (it's an
      // ordinary AppState field, read via useAppSelector), but ARM/
      // DISARM_RECORDING_CHANNEL being transient only stops THEIR OWN
      // dispatches from being pushed -- any later, ordinary tracked action
      // still snapshots whatever armedChannelId happened to be at that
      // moment. Left alone, undoing back past such a snapshot would
      // silently re-arm a channel that isn't what the engine is actually
      // capturing into -- and since disarm-recording takes no channelId
      // parameter (it just disarms whatever the engine's one recorder
      // slot currently is), a subsequent disarm click would then commit
      // the REAL armed channel's audio onto the WRONG (stale-armed)
      // channel's row. Pinning this field to the current value across
      // undo/redo keeps it truthful to the engine's real state, matching
      // why PLAY/PAUSE/SET_POS were pulled out of this reducer entirely
      // (see this file's own header comment) -- armedChannelId is the
      // same category of "live now" state, just harder to fully extract
      // since ChannelRow reads it as ordinary AppState.
      present: { ...previous, armedChannelId: state.present.armedChannelId },
      future: [state.present, ...state.future]
    }
  }

  if (action.type === 'REDO') {
    if (state.future.length === 0) return state
    const [next, ...rest] = state.future
    return {
      past: [...state.past, state.present],
      present: { ...next, armedChannelId: state.present.armedChannelId },
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
