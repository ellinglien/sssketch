import { reducer, type Action, type AppState } from './store'

export type HistoryAction =
  | Action
  | { type: 'UNDO' }
  | { type: 'REDO' }
  // Applies every action in `actions`, in order, but pushes exactly ONE
  // `past` checkpoint for the whole group -- for any caller that dispatches
  // several real edits as one logical operation (e.g. buildArrangeReplaceActions'
  // own PASTE_RIFFF-per-clip-copy-plus-one-DELETE_RIFFFS output) and wants
  // undo to treat it as one step, not N. `reducer`/`Action` itself never
  // needs to know this exists -- entirely a history-layer concept, same as
  // UNDO/REDO/LOAD_STATE below.
  | { type: 'BATCH'; actions: Action[] }

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
  'SET_ARRANGER_MODE',
  // Which parameter a clip's automation lane is currently showing --
  // "what am I looking at," not an edit, same category as
  // SET_ARRANGER_MODE directly above. The real edits are
  // SET_STEM_AUTOMATION / SET_GROUP_AUTOMATION, which are NOT in this set:
  // the lane dispatches exactly one of those per completed gesture (see
  // their own comments in store.ts), so a freehand drag is one undo step.
  'SET_AUTOMATION_PARAM',
  'TOGGLE_INSPECTOR_COLLAPSED',
  'TOGGLE_METRONOME',
  'ARM_RECORDING_CHANNEL',
  'DISARM_RECORDING_CHANNEL',
  // Rotates on every gated-recording lock-in (see App.tsx's
  // lockInGatedRecording) -- "how I'm currently working" bookkeeping for
  // where the NEXT take will land, same category as ARM/DISARM_RECORDING_
  // CHANNEL above, not a user edit worth its own undo checkpoint.
  'SET_GATED_RECORDING_CHANNEL',
  // Same "how I'm currently working" bookkeeping category as
  // SET_GATED_RECORDING_CHANNEL just above -- pinning/clearing which
  // rifff a lock-in will land on isn't itself a user edit worth an undo
  // checkpoint. ADD_STEM_TO_RIFFF (the actual lock-in) is NOT in this
  // set -- that one really is an edit.
  'SET_GATED_RECORDING_TARGET',
  // Whether the "lock in the most recent recording pass?" confirm dialog
  // (LockInConfirmDialog.tsx) is currently showing -- same "how I'm
  // currently working" bookkeeping category as SET_GATED_RECORDING_TARGET
  // just above, not a user edit worth its own undo checkpoint.
  'SET_PENDING_LOCK_IN_CONFIRM',
  // A pure IPC-fetch side effect (App.tsx's input-device dropdown re-fetches
  // on every focus while the list is still empty), not a user edit worth an
  // undo checkpoint -- same "how I'm currently working" category as
  // SET_ARRANGER_MODE/metronomeEnabled above, not the arrangement itself.
  'SET_AVAILABLE_INPUT_DEVICES',
  // Fired on every mousemove of a volume/length/crop drag (see AppState's
  // own dragVol/etc. field comments) -- an undo checkpoint per mousemove
  // would flood the undo stack meaninglessly; the REAL edit is whatever
  // commit action (SET_VOLUME, SET_PLAYED_BARS, ...) fires once on release,
  // which is NOT in this set.
  'SET_DRAG_PREVIEW',
  'SET_DRAG_PREVIEW_GROUP_VOLUME',
  // The in-progress/pending region selection -- same "not a real edit"
  // treatment as SET_DRAG_PREVIEW; the real edits are ADD_MUTE_REGION/
  // REMOVE_MUTE_REGION, dispatched once Delete/Backspace actually commits.
  'SET_REGION_SELECTION',
  // Where you are in the guided flow -- "what am I being walked through
  // right now," the same category as SET_ARRANGER_MODE at the top of this
  // set, not an arrangement edit. Undo must walk back through the clips
  // sssketchy helped place, never through the fact that he moved on to the
  // next step -- and a coach step that fell off the undo stack partway
  // through a flow would leave the flow pointing at work that no longer
  // exists.
  'COACH_START',
  'COACH_RESUME',
  'COACH_ADVANCE',
  'COACH_MINIMISE',
  'COACH_RESTORE',
  'COACH_DISMISS',
  'COACH_LOCK_CLIMAX',
  // Phase two's own flow bookkeeping -- same category as every other
  // COACH_* entry above: where sssketchy is, not an edit to the project.
  'COACH_START_SECTION',
  'COACH_SET_SECTION_NAME',
  'COACH_TOGGLE_SECTION_STEM',
  // The arrangement map's own answers and measurement (2026-09-23). Same
  // category as every other COACH_* entry: where the flow is and what the
  // user told it, not an edit to the project. COACH_BUILD_MAP is the one
  // that writes `sections`, and like COACH_PLACE_SECTION it is listed here
  // so a stray direct dispatch pushes no checkpoint of its own -- in real
  // use it arrives inside the BATCH that also places the clips.
  'COACH_SET_PHRASE_READING',
  'COACH_SET_PHRASE',
  'COACH_SET_LOOP_ANSWER',
  'COACH_SET_SHAPE',
  'COACH_BUILD_MAP',
  'COACH_NUDGE_SECTION_PASSES',
  'COACH_TOGGLE_SECTION_CELL',
  // COACH_PLACE_SECTION is listed here so a stray direct dispatch cannot
  // push a checkpoint of its own -- but in real use it is ALWAYS dispatched
  // inside the same BATCH as the arranger actions that place the section's
  // clips (SssketchySectionPanel.tsx). The BATCH branch above runs before
  // this set is consulted, so that group gets exactly one checkpoint --
  // "one undo step per section" (spec) meaning the section's CLIPS come off
  // the timeline in one go -- and the flow's own record of that section
  // comes off with them. `coach` is pinned across UNDO/REDO EXCEPT for
  // `sections` and `tension`, the two fields that name real timeline
  // material, precisely so an undone section cannot leave a record pointing
  // at groups that are gone (see the UNDO branch below).
  'COACH_PLACE_SECTION',
  // Phase three's own flow bookkeeping -- same category, and the same
  // arrangement, as COACH_PLACE_SECTION directly above: listed here so a
  // stray direct dispatch cannot push a checkpoint of its own, while in
  // real use all three always arrive inside the BATCH that carries the
  // actual edit (SssketchyTensionPanel.tsx, and ProjectMenu's export paths
  // for the v1 mark, which records a file on disk rather than an edit).
  'COACH_APPLY_TENSION',
  'COACH_CLEAR_TENSION',
  'COACH_MARK_V1_EXPORTED'
])

export function createHistoryState(present: AppState): HistoryState {
  return { past: [], present, future: [] }
}

export function historyReducer(state: HistoryState, action: HistoryAction): HistoryState {
  if (action.type === 'UNDO') {
    if (state.past.length === 0) return state
    const previous = state.past[state.past.length - 1]
    // Pinned in every respect BUT the two fields that describe real
    // TIMELINE MATERIAL, which have to walk back with the clips they name.
    //
    // `sections`: a section placement is deliberately an ordinary undoable
    // edit (see COACH_PLACE_SECTION's note above), so pinning `sections`
    // wholesale left the flow claiming a section whose clips had just been
    // removed -- and since the next section's start bar is computed from
    // that list, the following section would land in the gap the undo had
    // just opened.
    //
    // `tension` (phase three) is the same case and gets the same answer:
    // each entry names a curve written onto a section's clips or a riser
    // clip on the timeline, applied in the same BATCH as the
    // COACH_APPLY_TENSION that records it. Undoing that batch takes the
    // material off, so a pinned `tension` would leave the panel showing a
    // toggle ON over a curve that is no longer there, with no way to
    // re-apply it except switching it off and on again.
    //
    // `v1ExportedAt` is deliberately NOT in this group, even though it is
    // also phase three's: it records a file that was written to disk, and
    // no undo of an in-app edit can take that back off disk. It stays
    // pinned with the rest of the flow.
    //
    // The map's four new fields (phraseReading, phrase, loopIs, shape) ride
    // along on the PINNED side by construction, and that is right: a
    // measurement of a file and an answer the user typed are not timeline
    // material, and undoing a clip edit must not un-answer "what is this
    // loop?". `sections` stays on the snapshot side as before -- it is the
    // one part of the flow that IS the work, cells and all.
    //
    // Taking both from the snapshot being restored (and the empty value
    // when the snapshot predates the flow entirely) keeps the record honest
    // about what is actually on the timeline, while the step, the two
    // answers, the locked climax and the v1 mark still survive, which is
    // the whole point of pinning.
    const liveCoach = state.present.coach
    const pinnedCoach =
      liveCoach === null
        ? null
        : {
            ...liveCoach,
            sections: previous.coach?.sections ?? [],
            tension: previous.coach?.tension ?? []
          }
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
      //
      // `coach` is pinned for exactly the same reason, and it is the more
      // expensive one to get wrong. Every COACH_* action above is
      // transient, which only stops THEIR OWN dispatches from pushing a
      // checkpoint -- `coach` is still an ordinary AppState field riding
      // inside every snapshot any OTHER action pushes. Left alone, undoing
      // an ordinary edit made during a guided flow (placing a clip, nudging
      // a tempo, and in phase two every section placement, which is by
      // design an ordinary undoable edit) would rewind sssketchy to
      // whichever step that checkpoint happened to capture -- throwing away
      // the locked climax, the answer to melodic-or-groove, and every
      // section already carved; undoing back past the moment the flow
      // started would set it to null outright and make him vanish
      // mid-flow. Undo must walk back through the WORK he helped make,
      // never through the flow itself -- except for `sections`, the one
      // part of the flow that IS the work, which walks back with the clips
      // it describes (see pinnedCoach above).
      present: { ...previous, armedChannelId: state.present.armedChannelId, coach: pinnedCoach },
      future: [state.present, ...state.future]
    }
  }

  if (action.type === 'REDO') {
    if (state.future.length === 0) return state
    const [next, ...rest] = state.future
    return {
      past: [...state.past, state.present],
      present: {
        ...next,
        armedChannelId: state.present.armedChannelId,
        // Same rule as UNDO, in the other direction: the flow is pinned to
        // where the user actually is, while `sections` and `tension` come
        // from the state being redone into, so redoing a section placement
        // or a tension toggle brings its record back along with its clips.
        coach:
          state.present.coach === null
            ? null
            : {
                ...state.present.coach,
                sections: next.coach?.sections ?? [],
                tension: next.coach?.tension ?? []
              }
      },
      future: rest
    }
  }

  // Loading a different project shouldn't let you undo back into the previous
  // one's state — starts a fresh history.
  if (action.type === 'LOAD_STATE') {
    return createHistoryState(reducer(state.present, action))
  }

  if (action.type === 'BATCH') {
    const past = [...state.past, state.present].slice(-MAX_HISTORY)
    const present = action.actions.reduce((s, a) => reducer(s, a), state.present)
    return { past, present, future: [] }
  }

  if (TRANSIENT_ACTION_TYPES.has(action.type)) {
    return { ...state, present: reducer(state.present, action) }
  }

  const past = [...state.past, state.present].slice(-MAX_HISTORY)
  return { past, present: reducer(state.present, action), future: [] }
}
