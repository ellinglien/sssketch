/** One EEEDIT publish at a time, app-wide (App.tsx): add to shelf or timeline, keep, and a
 * departure save's own add to shelf. ShapePanel guards only its own buttons, so a quit, New or
 * header Save during an add to shelf must wait for it (`settled`) rather than render and add the
 * same draft a second time. */
export function createPublishGate(): {
  /** Runs `work` as the publish in flight. */
  track: <T>(work: () => Promise<T>) => Promise<T>
  /** Resolves once no publish is in flight, including one started while it waited. Never
   * rejects: a failed publish has already told the user. */
  settled: () => Promise<void>
} {
  let inFlight: Promise<unknown> | null = null
  return {
    track(work) {
      const tracked = work().finally(() => {
        if (inFlight === tracked) inFlight = null
      })
      inFlight = tracked
      return tracked
    },
    async settled() {
      while (inFlight) await inFlight.catch(() => undefined)
    }
  }
}
