// src/renderer/src/audio/backgroundAnalysisQueue.test.ts
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { StemAnalysisNeeds } from '@shared/stemAnalysisNeeds'

// The module's singleton wires the real analysis in; these tests inject their own.
vi.mock('./analyzeStemOnce', () => ({
  analyzeStemOnce: vi.fn(),
  fetchStemAnalysisNeeds: vi.fn()
}))

import {
  BATCH_DELAY_MS,
  BATCH_SIZE,
  IDLE_REST_MS,
  createBackgroundAnalysisQueue,
  type AnalysisSource,
  type AnalysisWorkItem
} from './backgroundAnalysisQueue'

const NEEDY: StemAnalysisNeeds = { peaks: true, features: true, embedding: true, zeroShot: false }
const NOTHING: StemAnalysisNeeds = {
  peaks: false,
  features: false,
  embedding: false,
  zeroShot: false
}

interface Harness {
  queue: ReturnType<typeof createBackgroundAnalysisQueue>
  analyzed: string[]
  inFlight: () => number
  maxInFlight: () => number
  needsCalls: string[][]
  gateOpen: { value: boolean }
  /** Resolves every analysis in flight (when `manual`). */
  finishAll: () => void
}

function harness(
  options: {
    manual?: boolean
    needs?: (paths: string[]) => Promise<StemAnalysisNeeds[]>
  } = {}
): Harness {
  const analyzed: string[] = []
  let inFlight = 0
  let maxInFlight = 0
  const pending: (() => void)[] = []
  const needsCalls: string[][] = []
  const gateOpen = { value: true }
  const queue = createBackgroundAnalysisQueue({
    analyze: async (path) => {
      analyzed.push(path)
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      if (options.manual) await new Promise<void>((resolve) => pending.push(resolve))
      inFlight -= 1
    },
    fetchNeeds: (paths) => {
      needsCalls.push(paths)
      return options.needs ? options.needs(paths) : Promise.resolve(paths.map(() => NEEDY))
    },
    gate: { mayRun: () => gateOpen.value },
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    now: () => Date.now()
  })
  return {
    queue,
    analyzed,
    inFlight: () => inFlight,
    maxInFlight: () => maxInFlight,
    needsCalls,
    gateOpen,
    finishAll: () => pending.splice(0).forEach((resolve) => resolve())
  }
}

/** A source over a fixed list; `withNeeds` attaches NEEDY to every item. */
function listSource(
  keys: string[],
  withNeeds: boolean
): { next: Mock<AnalysisSource['next']>; done: Mock<AnalysisSource['done']> } {
  const items: AnalysisWorkItem[] = keys.map((key) => ({
    key,
    path: `/lib/${key}`,
    ...(withNeeds && { needs: NEEDY })
  }))
  return {
    next: vi.fn<AnalysisSource['next']>(async (n) =>
      items.length === 0 ? 'done' : items.splice(0, n)
    ),
    done: vi.fn<AnalysisSource['done']>()
  }
}

async function run(ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms)
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('backgroundAnalysisQueue (background scan audit 7)', () => {
  it('runs at most 3 analyses at once across all tiers', async () => {
    const h = harness({ manual: true })
    h.queue.setPlaced(['/p/1', '/p/2', '/p/3', '/p/4'])
    h.queue.setSource('library', listSource(['l1', 'l2', 'l3', 'l4', 'l5'], true))
    h.queue.setSource('artist', listSource(['a1', 'a2'], false))
    for (let i = 0; i < 10; i++) {
      await run(BATCH_DELAY_MS)
      expect(h.inFlight()).toBeLessThanOrEqual(BATCH_SIZE)
      h.finishAll()
    }
    expect(h.maxInFlight()).toBe(BATCH_SIZE)
    expect(h.analyzed).toHaveLength(11)
  })

  it('placed stems go before library items queued earlier', async () => {
    const h = harness()
    h.gateOpen.value = false
    h.queue.setSource('library', listSource(['l1', 'l2', 'l3'], true))
    await run(BATCH_DELAY_MS)
    h.queue.setPlaced(['/p/1', '/p/2'])
    h.gateOpen.value = true
    await run(BATCH_DELAY_MS * 4)
    expect(h.analyzed).toEqual(['/p/1', '/p/2', '/lib/l1', '/lib/l2', '/lib/l3'])
  })

  it('a placed set that arrives mid-scan goes next', async () => {
    const h = harness()
    h.queue.setSource('library', listSource(['l1', 'l2', 'l3', 'l4', 'l5', 'l6'], true))
    await run(0)
    expect(h.analyzed).toEqual(['/lib/l1', '/lib/l2', '/lib/l3'])
    h.queue.setPlaced(['/p/1'])
    await run(BATCH_DELAY_MS)
    expect(h.analyzed.slice(3)).toEqual(['/p/1'])
  })

  it('the artist queue goes before the library', async () => {
    const h = harness()
    h.gateOpen.value = false
    h.queue.setSource('library', listSource(['l1', 'l2'], true))
    h.queue.setSource('artist', listSource(['a1', 'a2'], false))
    h.gateOpen.value = true
    await run(BATCH_DELAY_MS * 4)
    expect(h.analyzed).toEqual(['/lib/a1', '/lib/a2', '/lib/l1', '/lib/l2'])
  })

  it('the gate defers and never skips', async () => {
    const h = harness()
    h.gateOpen.value = false
    h.queue.setPlaced(['/p/1', '/p/2', '/p/3', '/p/4'])
    await run(BATCH_DELAY_MS * 10)
    expect(h.analyzed).toEqual([])
    expect(h.needsCalls).toEqual([])
    h.gateOpen.value = true
    await run(BATCH_DELAY_MS * 4)
    expect(h.analyzed).toEqual(['/p/1', '/p/2', '/p/3', '/p/4'])
  })

  it('removing the library source mid-batch lets the batch finish and stops further work', async () => {
    const h = harness({ manual: true })
    const library = listSource(['l1', 'l2', 'l3', 'l4', 'l5', 'l6'], true)
    h.queue.setSource('library', library)
    await run(0)
    expect(h.inFlight()).toBe(3)
    h.queue.setSource('library', null)
    h.finishAll()
    await run(BATCH_DELAY_MS * 10)
    expect(h.analyzed).toEqual(['/lib/l1', '/lib/l2', '/lib/l3'])
    expect(library.done).toHaveBeenCalledWith(['l1', 'l2', 'l3'])
    expect(library.next).toHaveBeenCalledTimes(1)
  })

  it('an item that comes with its needs asks for none', async () => {
    const h = harness()
    h.queue.setSource('library', listSource(['l1', 'l2', 'l3', 'l4'], true))
    await run(BATCH_DELAY_MS * 4)
    expect(h.analyzed).toHaveLength(4)
    expect(h.needsCalls).toEqual([])
  })

  it('one needs call per batch for items without them; placed paths once each', async () => {
    const h = harness({
      needs: async (paths) => paths.map((p) => (p.endsWith('2') ? NOTHING : NEEDY))
    })
    h.queue.setPlaced(['/p/1', '/p/2', '/p/3', '/p/4', '/p/5'])
    await run(BATCH_DELAY_MS * 4)
    expect(h.needsCalls).toEqual([['/p/1', '/p/2', '/p/3', '/p/4', '/p/5']])
    expect(h.analyzed).toEqual(['/p/1', '/p/3', '/p/4', '/p/5'])
    const artist = listSource(['a1', 'a2', 'a3'], false)
    h.queue.setSource('artist', artist)
    await run(BATCH_DELAY_MS * 2)
    expect(h.needsCalls.slice(1)).toEqual([['/lib/a1', '/lib/a2', '/lib/a3']])
    // a2 needs nothing: finished all the same, never decoded
    expect(artist.done).toHaveBeenCalledWith(expect.arrayContaining(['a1', 'a2', 'a3']))
    expect(h.analyzed.slice(4)).toEqual(['/lib/a1', '/lib/a3'])
  })

  it('a rejected needs fetch for placed stems leaves them retryable', async () => {
    let fail = true
    const h = harness({
      needs: async (paths) => {
        if (fail) throw new Error('ipc down')
        return paths.map(() => NEEDY)
      }
    })
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    h.queue.setPlaced(['/p/1', '/p/2'])
    await run(BATCH_DELAY_MS * 4)
    expect(h.analyzed).toEqual([])
    fail = false
    h.queue.setPlaced(['/p/1', '/p/2'])
    await run(BATCH_DELAY_MS * 4)
    expect(h.analyzed).toEqual(['/p/1', '/p/2'])
    error.mockRestore()
  })

  it('a path analysed once is not analysed again, in any tier', async () => {
    const h = harness()
    h.queue.setPlaced(['/lib/l1'])
    await run(BATCH_DELAY_MS)
    const library = listSource(['l1', 'l2'], true)
    h.queue.setSource('library', library)
    h.queue.setPlaced(['/lib/l1'])
    await run(BATCH_DELAY_MS * 4)
    expect(h.analyzed).toEqual(['/lib/l1', '/lib/l2'])
    // l1 counts as done for its source without a second analysis
    expect(library.done).toHaveBeenCalledWith(['l1', 'l2'])
  })

  it('an idle source rests 30 s; a wake ends the rest', async () => {
    const h = harness()
    let ready: AnalysisWorkItem[] = []
    const artist: AnalysisSource = {
      next: vi.fn(async (n: number) => (ready.length === 0 ? 'idle' : ready.splice(0, n))),
      done: vi.fn()
    }
    h.queue.setSource('artist', artist)
    await run(0)
    expect(artist.next).toHaveBeenCalledTimes(1)
    await run(IDLE_REST_MS - 1000)
    expect(artist.next).toHaveBeenCalledTimes(1)
    await run(1000)
    expect(artist.next).toHaveBeenCalledTimes(2)
    ready = [{ key: 'a1', path: '/lib/a1', needs: NEEDY }]
    h.queue.wake('artist')
    await run(0)
    expect(h.analyzed).toEqual(['/lib/a1'])
  })

  it('a placed set that lands while a step waits on a source is not lost', async () => {
    const h = harness()
    let answer: (value: 'idle') => void = () => {}
    const artist: AnalysisSource = {
      next: vi.fn(() => new Promise<'idle'>((resolve) => (answer = resolve))),
      done: vi.fn()
    }
    h.queue.setSource('artist', artist)
    await run(0)
    expect(artist.next).toHaveBeenCalledTimes(1)
    h.queue.setPlaced(['/p/1'])
    answer('idle')
    await run(BATCH_DELAY_MS)
    expect(h.analyzed).toEqual(['/p/1'])
  })

  it('reports placed progress down to 0', async () => {
    const h = harness({ manual: true })
    const reports: number[] = []
    h.queue.onProgress((kind, left) => {
      if (kind === 'placed') reports.push(left)
    })
    h.queue.setPlaced(['/p/1', '/p/2', '/p/3', '/p/4'])
    await run(0)
    expect(reports.at(-1)).toBe(4)
    h.finishAll()
    await run(BATCH_DELAY_MS)
    expect(reports.at(-1)).toBe(1)
    h.finishAll()
    await run(BATCH_DELAY_MS)
    expect(reports.at(-1)).toBe(0)
  })

  // Review of T7: `void step()` had no catch -- a throw stopped the loop for
  // the session and left placed paths counted as in flight forever.
  it('a step that throws is logged, its in-flight count undone, its paths kept, and the loop goes on', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const h = harness()
    const reports: number[] = []
    let thrown = false
    h.queue.onProgress((_kind, left) => {
      reports.push(left)
      if (left === 4 && !thrown) {
        thrown = true // the report as the first batch starts
        throw new Error('listener')
      }
    })
    h.queue.setPlaced(['/p/1', '/p/2', '/p/3', '/p/4'])
    await run(0)
    expect(thrown).toBe(true)
    expect(errors).toHaveBeenCalledTimes(1)
    expect(h.analyzed).toEqual([])
    await run(BATCH_DELAY_MS * 4)
    expect(h.analyzed).toEqual(['/p/1', '/p/2', '/p/3', '/p/4'])
    expect(reports.at(-1)).toBe(0)
    errors.mockRestore()
  })

  it('a gate that throws is logged and asked again after the batch gap', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const analyzed: string[] = []
    let calls = 0
    const queue = createBackgroundAnalysisQueue({
      analyze: async (path) => {
        analyzed.push(path)
      },
      fetchNeeds: async (paths) => paths.map(() => NEEDY),
      gate: {
        mayRun: () => {
          calls += 1
          if (calls === 1) throw new Error('gate')
          return true
        }
      },
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
      now: () => Date.now()
    })
    queue.setPlaced(['/p/1'])
    await run(BATCH_DELAY_MS - 1)
    expect(errors).toHaveBeenCalledTimes(1)
    expect(analyzed).toEqual([])
    await run(1)
    expect(analyzed).toEqual(['/p/1'])
    errors.mockRestore()
  })
})
