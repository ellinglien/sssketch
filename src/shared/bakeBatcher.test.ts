import { afterEach, describe, expect, it, vi } from 'vitest'
import { createBakeBatcher } from './bakeBatcher'
import type { ReoneBakeJob } from './reonedRotation'

type Result = { path: string; bakedPath: string; durationSec: number }

const job = (path: string): ReoneBakeJob => ({ path, rotationSec: 1 })
const baked = (path: string): Result => ({ path, bakedPath: `${path}.baked.wav`, durationSec: 8 })

/** A bake whose calls are recorded and settled by hand. */
function manualBake(): {
  bake: (jobs: ReoneBakeJob[]) => Promise<Result[]>
  calls: { jobs: ReoneBakeJob[]; settle: (results: Result[]) => void }[]
} {
  const calls: { jobs: ReoneBakeJob[]; settle: (results: Result[]) => void }[] = []
  return {
    calls,
    bake: (jobs) => new Promise((settle) => calls.push({ jobs, settle }))
  }
}

const tick = (ms = 0): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

afterEach(() => vi.restoreAllMocks())

describe('createBakeBatcher', () => {
  it('bakes the jobs that arrive within the window as one batch, each to its own result', async () => {
    const { bake, calls } = manualBake()
    const bakeOne = createBakeBatcher(bake, 5)
    const a = bakeOne(job('/a'))
    const b = bakeOne(job('/b'))
    await tick(10)
    expect(calls.map((call) => call.jobs)).toEqual([[job('/a'), job('/b')]])
    // Out of job order, as the baker returns WAVs before LORE stems.
    calls[0].settle([baked('/b'), baked('/a')])
    expect(await a).toEqual(baked('/a'))
    expect(await b).toEqual(baked('/b'))
  })

  it('collects the jobs that arrive while a batch bakes into the next one', async () => {
    const { bake, calls } = manualBake()
    const bakeOne = createBakeBatcher(bake, 5)
    const first = bakeOne(job('/a'))
    await tick(10)
    const later = ['/b', '/c', '/d'].map((path) => bakeOne(job(path)))
    await tick(10)
    expect(calls).toHaveLength(1)
    calls[0].settle([baked('/a')])
    await first
    await tick(10)
    expect(calls.map((call) => call.jobs.map((j) => j.path))).toEqual([['/a'], ['/b', '/c', '/d']])
    calls[1].settle(['/b', '/c', '/d'].map(baked))
    expect(await Promise.all(later)).toEqual(['/b', '/c', '/d'].map(baked))
  })

  it('a failed batch bakes each job alone, so one bad stem fails only itself', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const sent: string[][] = []
    const bakeOne = createBakeBatcher(async (jobs) => {
      sent.push(jobs.map((j) => j.path))
      // The baker is all or nothing: any batch holding the bad stem comes back empty.
      return jobs.some((j) => j.path === '/bad') ? [] : jobs.map((j) => baked(j.path))
    }, 0)
    const results = await Promise.all(['/a', '/bad', '/c'].map((path) => bakeOne(job(path))))
    expect(results).toEqual([baked('/a'), null, baked('/c')])
    expect(sent).toEqual([['/a', '/bad', '/c'], ['/a'], ['/bad'], ['/c']])
  })

  it('a lone job that fails, or a bake that throws, gives null without a retry', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    let calls = 0
    const empty = createBakeBatcher(async () => {
      calls++
      return []
    }, 0)
    expect(await empty(job('/a'))).toBeNull()
    expect(calls).toBe(1)
    const throwing = createBakeBatcher(async () => {
      throw new Error('ipc down')
    }, 0)
    expect(await throwing(job('/a'))).toBeNull()
  })

  it('a multi-job batch whose bake throws bakes each job alone', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const sent: string[][] = []
    const bakeOne = createBakeBatcher(async (jobs) => {
      sent.push(jobs.map((j) => j.path))
      if (jobs.length > 1) throw new Error('engine crashed')
      if (jobs[0].path === '/bad') throw new Error('engine crashed')
      return [baked(jobs[0].path)]
    }, 0)
    const results = await Promise.all(['/a', '/bad', '/c'].map((path) => bakeOne(job(path))))
    expect(results).toEqual([baked('/a'), null, baked('/c')])
    expect(sent).toEqual([['/a', '/bad', '/c'], ['/a'], ['/bad'], ['/c']])
  })

  it('two jobs on the same path in one batch each get their own result', async () => {
    const { bake, calls } = manualBake()
    const bakeOne = createBakeBatcher(bake, 5)
    const first = bakeOne({ path: '/a', rotationSec: 1 })
    const second = bakeOne({ path: '/a', rotationSec: 2 })
    await tick(10)
    expect(calls).toHaveLength(1)
    expect(calls[0].jobs).toEqual([
      { path: '/a', rotationSec: 1 },
      { path: '/a', rotationSec: 2 }
    ])
    const one = { path: '/a', bakedPath: '/a.r1.wav', durationSec: 8 }
    const two = { path: '/a', bakedPath: '/a.r2.wav', durationSec: 8 }
    calls[0].settle([one, two])
    expect(await first).toEqual(one)
    expect(await second).toEqual(two)
  })

  describe('cancel', () => {
    it('drops the jobs still waiting for their window, without baking them', async () => {
      const { bake, calls } = manualBake()
      const bakeOne = createBakeBatcher(bake, 5)
      const a = bakeOne(job('/a'))
      const b = bakeOne(job('/b'))
      bakeOne.cancel()
      expect(await a).toBeNull()
      expect(await b).toBeNull()
      await tick(10)
      expect(calls).toHaveLength(0)
    })

    it('lets the batch already baking finish, and drops the ones queued behind it', async () => {
      const { bake, calls } = manualBake()
      const bakeOne = createBakeBatcher(bake, 5)
      const inFlight = bakeOne(job('/a'))
      await tick(10)
      const queued = bakeOne(job('/b'))
      bakeOne.cancel()
      expect(await queued).toBeNull()
      calls[0].settle([baked('/a')])
      expect(await inFlight).toEqual(baked('/a'))
      await tick(10)
      expect(calls).toHaveLength(1)
    })

    it('starts no one-at-a-time retries for an in-flight batch that fails after a cancel', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      const { bake, calls } = manualBake()
      const bakeOne = createBakeBatcher(bake, 5)
      const results = Promise.all([bakeOne(job('/a')), bakeOne(job('/b'))])
      await tick(10)
      bakeOne.cancel()
      calls[0].settle([])
      expect(await results).toEqual([null, null])
      expect(calls).toHaveLength(1)
    })

    it('still bakes jobs that arrive after the cancel', async () => {
      const { bake, calls } = manualBake()
      const bakeOne = createBakeBatcher(bake, 5)
      void bakeOne(job('/a'))
      bakeOne.cancel()
      const later = bakeOne(job('/b'))
      await tick(10)
      expect(calls.map((call) => call.jobs)).toEqual([[job('/b')]])
      calls[0].settle([baked('/b')])
      expect(await later).toEqual(baked('/b'))
    })
  })
})
