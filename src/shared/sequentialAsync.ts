/** Runs async tasks strictly one at a time, in call order -- a second call
 * to `run` never starts its own task until the first call's task has fully
 * settled (resolved or rejected). Extracted out of
 * StoreContext.tsx's own flushEngineSyncNow (see docs/superpowers/specs/
 * 2026-09-16-engine-preview-ownership-design.md and the commit that added
 * this) -- real bug, found by review: two different callers could each
 * independently kick off their own build+send work through that function
 * at once, and whichever's own async work happened to finish LAST silently
 * won, regardless of which call was actually more recent/intended. This is
 * the general-purpose fix: each call's own task is chained onto the
 * previous call's own completion, so two callers' work can never
 * physically run concurrently. Each call's own returned promise still
 * reflects ONLY that call's own result -- a rejecting task doesn't corrupt
 * or block later calls (a separate handler keeps the internal queue alive
 * without swallowing the caller-facing rejection). */
export interface SequentialRunner {
  run<T>(task: () => Promise<T>): Promise<T>
}

export function createSequentialRunner(): SequentialRunner {
  let queue: Promise<void> = Promise.resolve()
  return {
    run<T>(task: () => Promise<T>): Promise<T> {
      const run = queue.then(task)
      // Keeps the queue alive even if THIS task rejects, without
      // swallowing that rejection for the caller -- `run` (returned
      // below, unmodified) still rejects normally; only the copy stored
      // back into `queue` is caught, so it doesn't wedge every future
      // call behind a permanently-rejected promise.
      queue = run.then(
        () => undefined,
        () => undefined
      )
      return run
    }
  }
}
