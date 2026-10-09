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
})
