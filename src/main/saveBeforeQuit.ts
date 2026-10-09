import { shouldClearRecoveryOnCleanQuit, type RecoveryFileState } from './recoveryFileTracker'

/** 'failed': the renderer answered that the save didn't land (it has already
 * told the user why). 'unreachable': there was no renderer to ask. */
export type SaveBeforeQuitResult = 'saved' | 'failed' | 'timeout' | 'unreachable'

export interface SaveBeforeQuitNotice {
  message: string
  detail: string
}

/** What the quit prompt's Save does once the renderer has answered (or couldn't).
 * 'quit' re-issues the quit as one that follows the prompt's Save, which keeps
 * the recovery file (shouldClearRecoveryOnCleanQuit): a save that landed has
 * cleared it itself, and with no renderer to ask ('unreachable') it may be the
 * only copy of the work, which is what quitting did before the prompt waited
 * for an answer. 'stay' keeps the app open, never silently: 'failed' is
 * explained by the renderer right after it replies ("Save failed: ...", or the
 * changed-while-saving notice; saveOutcomeNotice in saveSerialization.ts).
 * No notice recommends Don't Save, which deletes the recovery file. */
export function afterSaveBeforeQuit(result: SaveBeforeQuitResult): {
  action: 'quit' | 'stay'
  notice: SaveBeforeQuitNotice | null
} {
  switch (result) {
    case 'saved':
      return { action: 'quit', notice: null }
    case 'failed':
      return { action: 'stay', notice: null }
    case 'timeout':
      return {
        action: 'stay',
        notice: {
          message: 'The project is still saving.',
          detail: 'sssketch stayed open so no unsaved work was discarded. Please try Save again.'
        }
      }
    case 'unreachable':
      return {
        action: 'quit',
        notice: {
          message: "The project couldn't be saved.",
          detail:
            'There was no open window to save it from. sssketch will quit and keep any recovery copy of it, to offer the next time it opens.'
        }
      }
  }
}

export interface BeforeQuitState {
  /** The renderer's last 'set-dirty-state'; index.ts resets it when the window closes. */
  rendererDirty: boolean
  /** A window whose renderer can be asked to save. */
  windowLive: boolean
  recovery: RecoveryFileState
  /** This quit was re-issued by the quit prompt's Save. */
  quittingAfterSavePrompt: boolean
}

/** Whether a quit asks Save / Don't Save / Cancel, and if not, whether it may
 * delete the recovery file. Only a live window's unsaved work is asked about:
 * on macOS a window can close with unsaved edits whose only copy is the
 * recovery file, and a prompt then could save nothing, while its Don't Save
 * would delete that copy. Without the prompt, the file is cleared only by the
 * same rule as any clean quit (recoveryFileTracker.ts), which a dirty flag
 * still keeps from clearing. */
export function beforeQuitPlan(
  state: BeforeQuitState
): { kind: 'prompt' } | { kind: 'quit'; clearRecovery: boolean } {
  if (state.rendererDirty && state.windowLive) return { kind: 'prompt' }
  return {
    kind: 'quit',
    clearRecovery: shouldClearRecoveryOnCleanQuit(state.recovery, {
      rendererDirty: state.rendererDirty,
      quittingAfterSavePrompt: state.quittingAfterSavePrompt
    })
  }
}

/**
 * Waits for the renderer's save result without treating silence as success.
 * The subscription is installed before the request is sent so even an
 * immediate reply cannot be missed, and is always removed on settlement.
 */
export function awaitSaveBeforeQuit(
  requestId: string,
  sendRequest: (requestId: string) => void,
  subscribe: (complete: (requestId: string, success: boolean) => void) => () => void,
  timeoutMs = 5000
): Promise<SaveBeforeQuitResult> {
  return new Promise((resolve) => {
    let settled = false
    let unsubscribe = (): void => {}
    const timer: { current?: ReturnType<typeof setTimeout> } = {}

    const finish = (result: SaveBeforeQuitResult): void => {
      if (settled) return
      settled = true
      if (timer.current !== undefined) clearTimeout(timer.current)
      unsubscribe()
      resolve(result)
    }

    unsubscribe = subscribe((completedRequestId, success) => {
      if (completedRequestId === requestId) finish(success ? 'saved' : 'failed')
    })
    // A test double (or future synchronous bridge) may complete while
    // subscribe itself is still returning its cleanup function.
    if (settled) {
      unsubscribe()
      return
    }
    timer.current = setTimeout(() => finish('timeout'), timeoutMs)
    try {
      sendRequest(requestId)
    } catch {
      finish('unreachable')
    }
  })
}
