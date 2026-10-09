// Discover's candidate alignments, gathered into shared bakes. Each bakeOffset call that has an
// Ogg (LORE) stem to render spawns its own engine process (~0.4 s before it renders anything,
// measured 2026-10-09), and the `.bakes` lock runs the calls one at a time. A roll of 8 rows from
// the seed's jam used to make 8 calls, so 8 spawns in a row; gathered, it is one or two.
import { matchBakeResults, type ReoneBakeJob } from './reonedRotation'

export type BakeBatchResult = { path: string; bakedPath: string; durationSec: number }

/** A bake of one job at a time, with each job's result or null, that sends `bake` batches: the
 * jobs that arrive within `windowMs` of the first, and then every job that arrived while that
 * batch baked, as the next batch. bakeOffset is all or nothing, so a batch that fails is baked
 * again one job at a time, and a stem that can't be baked fails only itself. */
export function createBakeBatcher<R extends BakeBatchResult>(
  bake: (jobs: ReoneBakeJob[]) => Promise<R[]>,
  windowMs = 30
): (job: ReoneBakeJob) => Promise<R | null> {
  let queue: { job: ReoneBakeJob; resolve: (result: R | null) => void }[] = []
  let timer: ReturnType<typeof setTimeout> | null = null
  let baking = false

  async function bakeAll(jobs: ReoneBakeJob[]): Promise<R[] | null> {
    try {
      return matchBakeResults(
        jobs.map((job) => job.path),
        await bake(jobs)
      )
    } catch (err) {
      console.error('bakeBatcher: bake failed:', err)
      return null
    }
  }

  async function flush(): Promise<void> {
    timer = null
    const batch = queue
    queue = []
    baking = true
    try {
      const results = await bakeAll(batch.map((entry) => entry.job))
      if (results) {
        batch.forEach((entry, i) => entry.resolve(results[i]))
      } else if (batch.length === 1) {
        batch[0].resolve(null)
      } else {
        for (const entry of batch) entry.resolve((await bakeAll([entry.job]))?.[0] ?? null)
      }
    } finally {
      baking = false
      schedule()
    }
  }

  function schedule(): void {
    if (timer !== null || baking || queue.length === 0) return
    timer = setTimeout(() => void flush(), windowMs)
  }

  return (job) =>
    new Promise((resolve) => {
      queue.push({ job, resolve })
      schedule()
    })
}
