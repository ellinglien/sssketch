/** 'failed': the renderer answered that the save didn't land (it has already
 * told the user why). 'unreachable': there was no renderer to ask. */
export type SaveBeforeQuitResult = 'saved' | 'failed' | 'timeout' | 'unreachable'

/** What the quit prompt's Save says when it can't go on and quit. Every
 * outcome but 'saved' keeps the app open; this makes sure none of them does
 * so silently. Null for 'saved', and for 'failed', whose renderer has already
 * shown its own message right after replying ("Save failed: ...", or the
 * changed-while-saving notice; saveOutcomeNotice in saveSerialization.ts). */
export function saveBeforeQuitNotice(
  result: SaveBeforeQuitResult
): { message: string; detail: string } | null {
  switch (result) {
    case 'saved':
    case 'failed':
      return null
    case 'timeout':
      return {
        message: 'The project is still saving.',
        detail: 'sssketch stayed open so no unsaved work was discarded. Please try Save again.'
      }
    case 'unreachable':
      return {
        message: "The project couldn't be saved.",
        detail:
          "sssketch stayed open so no unsaved work was discarded. To quit without saving, quit again and choose Don't Save."
      }
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
