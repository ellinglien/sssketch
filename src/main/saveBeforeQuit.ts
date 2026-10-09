export type SaveBeforeQuitResult = 'saved' | 'failed' | 'timeout'

/**
 * Waits for the renderer's save result without treating silence as success.
 * The subscription is installed before the request is sent so even an
 * immediate reply cannot be missed, and is always removed on settlement.
 */
export function awaitSaveBeforeQuit(
  requestId: string,
  sendRequest: (requestId: string) => void,
  subscribe: (complete: (requestId: string, success: boolean) => void) => () => void,
  timeoutMs = 120000
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
      finish('failed')
    }
  })
}
