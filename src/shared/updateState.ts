/** Consolidated auto-update state, pushed to the renderer as a single IPC
 * payload on every change (see main/index.ts's update-state-changed push)
 * rather than one event per field -- so the renderer never has to
 * reconcile partial updates arriving out of order. `idle` is both the
 * starting state and where every terminal action (dismiss, a fresh
 * update-not-available) returns to. */
export type UpdateState =
  | { state: 'idle' }
  | { state: 'available'; version: string }
  | { state: 'downloading'; version: string; percent: number }
  | { state: 'installing'; version: string }
  | { state: 'error'; error: string }

/** Mirrors the electron-updater events (plus the two user-driven actions,
 * confirm-install/dismiss) that can move this state machine. main/index.ts
 * maps each real electron-updater callback onto one of these before calling
 * nextUpdateState -- see that file's own pushUpdateState helper. */
export type UpdateEvent =
  | { type: 'update-available'; version: string }
  | { type: 'download-progress'; percent: number }
  | { type: 'update-downloaded' }
  | { type: 'error'; error: string }
  | { type: 'confirm-install' }
  | { type: 'dismiss' }

/** Pure reducer: given the current state and one event, returns the next
 * state. Guards each transition against firing from the wrong current
 * state (e.g. confirm-install only does anything from 'available') rather
 * than trusting every caller to only ever dispatch events in the "right"
 * order -- electron-updater's own events aren't under this app's control,
 * so defensive no-ops here are cheaper than trying to prevent an
 * out-of-order call at every call site. */
export function nextUpdateState(current: UpdateState, event: UpdateEvent): UpdateState {
  switch (event.type) {
    case 'update-available':
      // A second update-available mid-download/mid-install (e.g. the
      // periodic timer's own next tick somehow still fired) must not
      // reset progress -- see this file's own test on this exact case.
      if (current.state === 'downloading' || current.state === 'installing') return current
      return { state: 'available', version: event.version }
    case 'confirm-install':
      if (current.state !== 'available') return current
      return { state: 'downloading', version: current.version, percent: 0 }
    case 'download-progress':
      if (current.state !== 'downloading') return current
      return { state: 'downloading', version: current.version, percent: event.percent }
    case 'update-downloaded':
      if (current.state !== 'downloading') return current
      return { state: 'installing', version: current.version }
    case 'error':
      return { state: 'error', error: event.error }
    case 'dismiss':
      return { state: 'idle' }
    default:
      return current
  }
}
