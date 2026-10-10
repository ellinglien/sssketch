/** One EEEDIT publish at a time, app-wide (App.tsx): add to shelf or timeline, keep, and a
 * departure save's own add to shelf. ShapePanel guards only its own buttons, so a quit, New or
 * header Save during an add to shelf must wait for it rather than render and add the same draft a
 * second time. A real lock: each publish starts only once the one before has settled, so a check
 * made inside `work` ("is this draft already on the shelf?") sees every earlier publish. */
export function createPublishGate(): {
  /** Runs `work` after every publish tracked before it has settled. */
  track: <T>(work: () => Promise<T>) => Promise<T>
  /** Resolves once no publish is in flight or queued, including one queued while it waited.
   * Never rejects: a failed publish has already told the user. */
  settled: () => Promise<void>
} {
  let tail: Promise<unknown> = Promise.resolve()
  return {
    track(work) {
      const run = tail.then(work, work)
      tail = run.catch(() => undefined)
      return run
    },
    async settled() {
      let seen: Promise<unknown>
      do {
        seen = tail
        await seen
      } while (seen !== tail)
    }
  }
}
