/** Runs `worker` over every item in `items`, with at most `limit` calls in
 * flight at once -- a small fixed-size worker pool, not a full queue
 * library. Each of `limit` "lanes" pulls the next unclaimed item off a
 * shared cursor until the list is exhausted. Roughly matches OUROVEON's
 * own per-riff stem-download parallelism (its 8-stems-per-riff cap,
 * further bounded by a shared thread pool) -- see the design spec's
 * Grounding section. Exists specifically because uncapped background
 * fetching already caused one real "competes with foreground clicks"
 * regression this session (see EndlesssLibraryBrowser.tsx's own
 * ownershipInFlightRef) -- a sync run touching hundreds of riffs needs
 * this discipline even more than that did. */
export async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  let cursor = 0
  async function lane(): Promise<void> {
    while (cursor < items.length) {
      const item = items[cursor++]
      await worker(item)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => lane()))
}
