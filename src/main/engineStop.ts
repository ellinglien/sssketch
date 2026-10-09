import type { EngineClient } from './engineClient'

/** How long engine-stop waits for the engine's "transport-stopped" reply.
 * The engine answers within the 15 ms halt fade while its device calls back,
 * and at once (or after a ~250 ms stall) while it doesn't (native-engine's
 * HaltAck.h), so this is only reached when the engine itself is unresponsive. */
export const ENGINE_STOP_TIMEOUT_MS = 2000

export interface EngineStopper {
  /** Sends one native stop and resolves once the engine reports silence.
   * Rejects when it reports the stop superseded by a newer Play, or doesn't
   * answer at all. Concurrent callers share one request, which keeps Shelf's
   * explicit handoff and StoreContext's playing-state effect from sending
   * duplicate stops. */
  stop(): Promise<void>
  /** A Play supersedes any stop still fading: the next stop() starts a fresh
   * request instead of joining the old one, whose waiter is answered
   * stopped=false by the engine. */
  supersede(): void
}

function replyToken(payload: unknown): unknown {
  return typeof payload === 'object' && payload !== null
    ? (payload as { token?: unknown }).token
    : undefined
}

export function createEngineStopper(
  getClient: () => Pick<EngineClient, 'sendAndAwaitType'> | undefined,
  timeoutMs = ENGINE_STOP_TIMEOUT_MS
): EngineStopper {
  let lastToken = 0
  let inFlight: Promise<void> | null = null
  return {
    stop(): Promise<void> {
      const client = getClient()
      if (!client) return Promise.resolve()
      if (inFlight) return inFlight
      const token = ++lastToken
      const request = client
        // Only this request's own reply: a late reply to an earlier token
        // (one that timed out, or that a Play superseded) is not this one's.
        .sendAndAwaitType(
          'stop',
          { token },
          'transport-stopped',
          timeoutMs,
          (payload) => replyToken(payload) === token
        )
        .then((payload) => {
          if ((payload as { stopped?: unknown }).stopped !== true) {
            throw new Error('native engine stop was superseded by a newer play')
          }
        })
      const shared = request.finally(() => {
        if (inFlight === shared) inFlight = null
      })
      inFlight = shared
      return shared
    },
    supersede(): void {
      inFlight = null
    }
  }
}
