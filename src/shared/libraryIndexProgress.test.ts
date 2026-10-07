// src/shared/libraryIndexProgress.test.ts
import { describe, expect, it } from 'vitest'
import {
  createEtaTracker,
  createLibraryProgressView,
  createLoadStageTracker,
  describeLibraryProgressCount,
  describeStartupStatus,
  estimateRemainingMs,
  etaSampleOf,
  formatTimeLeft,
  libraryProgressUnit,
  type LibraryIndexProgress
} from './libraryIndexProgress'

const base: LibraryIndexProgress = {
  phase: 'instrumentRows',
  dbIndex: 0,
  dbCount: 1,
  completed: 0,
  total: 0
}

describe('libraryProgressUnit', () => {
  it('a riff walk counts riffs; a riff-index load counts its entries, one per stem', () => {
    expect(libraryProgressUnit({ ...base, phase: 'riffIndex' })).toBe('riffs')
    expect(libraryProgressUnit({ ...base, phase: 'riffIndex', loading: true })).toBe('stems')
    expect(libraryProgressUnit({ ...base, phase: 'instrumentRows' })).toBe('stems')
    expect(libraryProgressUnit({ ...base, phase: 'instrumentRows', loading: true })).toBe('stems')
    expect(libraryProgressUnit({ ...base, phase: 'ownStems' })).toBe('stems')
  })
})

describe('describeLibraryProgressCount', () => {
  it('says n of m in the unit both count', () => {
    expect(
      describeLibraryProgressCount({ ...base, loading: true, completed: 412000, total: 891062 })
    ).toBe('412,000 of 891,062 stems')
    expect(
      describeLibraryProgressCount({ ...base, phase: 'riffIndex', completed: 1200, total: 900041 })
    ).toBe('1,200 of 900,041 riffs')
  })

  it('never shows a total below the count (a stale saved total)', () => {
    expect(describeLibraryProgressCount({ ...base, completed: 900, total: 800 })).toBe(
      '900 of 900 stems'
    )
  })

  it('a running count when there is no total, nothing before the first item', () => {
    expect(describeLibraryProgressCount({ ...base, phase: 'ownStems', completed: 12000 })).toBe(
      '12,000 stems'
    )
    expect(describeLibraryProgressCount(base)).toBeNull()
  })
})

describe('describeStartupStatus', () => {
  it('the engine first, then the library', () => {
    expect(describeStartupStatus(false, null)).toBe('starting engine…')
    expect(describeStartupStatus(true, null)).toBe('loading library…')
  })

  it('a saved copy loading: its count, and which step of how many', () => {
    expect(
      describeStartupStatus(true, {
        ...base,
        phase: 'riffIndex',
        loading: true,
        completed: 412000,
        total: 761929,
        stage: { part: 1, parts: 4, completed: 412000, total: 1814000 }
      })
    ).toBe('loading library · 412,000 of 761,929 stems · step 1 of 4')
    // One step: no step count.
    expect(
      describeStartupStatus(true, {
        ...base,
        loading: true,
        completed: 1000,
        total: 2000,
        stage: { part: 1, parts: 1, completed: 1000, total: 2000 }
      })
    ).toBe('loading library · 1,000 of 2,000 stems')
    // No total known yet (a copy saved before totals were kept).
    expect(
      describeStartupStatus(true, { ...base, phase: 'riffIndex', loading: true, completed: 5000 })
    ).toBe('loading library · 5,000 stems')
  })

  it('the own index first: a running count', () => {
    expect(describeStartupStatus(true, { ...base, phase: 'ownStems', completed: 3000 })).toBe(
      'indexing your stems first · 3,000 stems'
    )
    expect(describeStartupStatus(true, { ...base, phase: 'ownStems' })).toBe(
      'indexing your stems first…'
    )
  })

  it('a walk: indexing, n of m, and which db of several', () => {
    expect(
      describeStartupStatus(true, {
        ...base,
        phase: 'riffIndex',
        completed: 1000,
        total: 900041,
        dbCount: 2
      })
    ).toBe('indexing library · 1,000 of 900,041 riffs · db 1 of 2')
  })
})

describe('estimateRemainingMs', () => {
  it('from the rate since the first sample, not since zero', () => {
    // An extension starts near the end: 880,000 of 900,000 riffs walked
    // before this launch. 2,000 more in 2 s is 1,000/s: 18 s left.
    expect(
      estimateRemainingMs({ at: 0, completed: 880000 }, { at: 2000, completed: 882000 }, 900000)
    ).toBe(18000)
  })

  it('no estimate before there is a rate', () => {
    expect(estimateRemainingMs({ at: 0, completed: 0 }, { at: 500, completed: 10 }, 100)).toBeNull()
    expect(estimateRemainingMs({ at: 0, completed: 5 }, { at: 5000, completed: 5 }, 100)).toBeNull()
    expect(
      estimateRemainingMs({ at: 0, completed: 0 }, { at: 5000, completed: 100 }, 100)
    ).toBeNull()
    expect(estimateRemainingMs({ at: 0, completed: 0 }, { at: 5000, completed: 10 }, 0)).toBeNull()
  })
})

describe('formatTimeLeft', () => {
  it('rough, lowercase', () => {
    expect(formatTimeLeft(3000)).toBe('a few seconds left')
    expect(formatTimeLeft(12_000)).toBe('about 10 s left')
    expect(formatTimeLeft(43_000)).toBe('about 45 s left')
    expect(formatTimeLeft(59_000)).toBe('about 1 min left')
    expect(formatTimeLeft(150_000)).toBe('about 3 min left')
    expect(formatTimeLeft(59 * 60_000)).toBe('about 59 min left')
    expect(formatTimeLeft(80 * 60_000)).toBe('about 1 h 20 min left')
    expect(formatTimeLeft(120 * 60_000)).toBe('about 2 h left')
  })
})

describe('createEtaTracker', () => {
  it('measures each key from its own first sample, and restarts on a new key', () => {
    const eta = createEtaTracker()
    expect(eta.update({ key: 'a', completed: 0, total: 100 }, 0)).toBeNull()
    expect(eta.update({ key: 'a', completed: 50, total: 100 }, 5000)).toBe(5000)
    // A new phase: no rate yet.
    expect(eta.update({ key: 'b', completed: 500, total: 1000 }, 6000)).toBeNull()
    expect(eta.update({ key: 'b', completed: 600, total: 1000 }, 7000)).toBe(4000)
    expect(eta.update(null, 8000)).toBeNull()
  })
})

describe('createEtaTracker: interleaved phases (review of dc07ec69)', () => {
  it('two keys reporting in turn each keep their own rate', () => {
    const eta = createEtaTracker()
    expect(eta.update({ key: 'load', completed: 0, total: 1000 }, 0)).toBeNull()
    expect(eta.update({ key: 'walk', completed: 880, total: 900 }, 100)).toBeNull()
    expect(eta.update({ key: 'load', completed: 200, total: 1000 }, 2000)).toBe(8000)
    expect(eta.update({ key: 'walk', completed: 890, total: 900 }, 2100)).toBe(2000)
    expect(eta.update({ key: 'load', completed: 400, total: 1000 }, 4000)).toBe(6000)
  })

  it('a key that went backwards, or was quiet a while, starts a new rate', () => {
    const eta = createEtaTracker()
    eta.update({ key: 'a', completed: 0, total: 100 }, 0)
    expect(eta.update({ key: 'a', completed: 50, total: 100 }, 5000)).toBe(5000)
    // A new walk of the same table, from the start.
    expect(eta.update({ key: 'a', completed: 10, total: 100 }, 6000)).toBeNull()
    expect(eta.update({ key: 'a', completed: 20, total: 100 }, 7000)).toBe(8000)
    // Quiet for a minute, then again: the idle time is not part of the rate.
    expect(eta.update({ key: 'a', completed: 30, total: 100 }, 67_000)).toBeNull()
  })

  it('a running count (no sample) leaves every rate alone', () => {
    const eta = createEtaTracker()
    eta.update({ key: 'a', completed: 0, total: 100 }, 0)
    expect(eta.update(null, 1000)).toBeNull()
    expect(eta.update({ key: 'a', completed: 50, total: 100 }, 5000)).toBe(5000)
  })
})

describe('createLibraryProgressView (review of dc07ec69)', () => {
  const load = (completed: number): LibraryIndexProgress => ({
    ...base,
    phase: 'riffIndex',
    loading: true,
    completed,
    total: 1000,
    stage: { part: 1, parts: 2, completed, total: 2000 }
  })
  const walk = (completed: number): LibraryIndexProgress => ({
    ...base,
    phase: 'instrumentRows',
    completed,
    total: 900
  })

  it('a walk reporting during a load does not take the line: it stays on the load, with its time left', () => {
    const view = createLibraryProgressView()
    const shown: string[] = []
    const lefts: (number | null)[] = []
    const steps: [LibraryIndexProgress, number][] = [
      [load(0), 0],
      [walk(880), 100],
      [load(200), 1000],
      [walk(885), 1100],
      [load(400), 2000],
      [walk(890), 2100]
    ]
    for (const [progress, at] of steps) {
      const out = view.update(progress, at)
      shown.push(describeStartupStatus(true, out.progress))
      lefts.push(out.timeLeftMs)
    }
    expect(new Set(shown.map((line) => line.split(' · ')[0]))).toEqual(new Set(['loading library']))
    expect(lefts).toEqual([null, null, 9000, 9000, 8000, 8000])
  })

  it('once the load is done, or quiet, the walk shows with its own time left', () => {
    const view = createLibraryProgressView()
    view.update(load(0), 0)
    view.update(walk(800), 100)
    view.update(load(2000), 1000)
    // The load reached its stage total: the walk takes the line at once.
    const done = view.update(walk(850), 1100)
    expect(done.progress?.phase).toBe('instrumentRows')
    expect(done.progress?.loading).toBeUndefined()
    expect(done.timeLeftMs).toBe(1000)

    const quiet = createLibraryProgressView()
    quiet.update(load(0), 0)
    quiet.update(load(100), 1000)
    // A step that rebuilt instead never reports its load again.
    expect(quiet.update(walk(10), 2000).progress?.loading).toBe(true)
    expect(quiet.update(walk(20), 10_000).progress?.phase).toBe('instrumentRows')
  })

  it('the own-stems count is never hidden behind a load', () => {
    const view = createLibraryProgressView()
    view.update(load(100), 0)
    const own = view.update({ ...base, phase: 'ownStems', completed: 500 }, 100)
    expect(own.progress?.phase).toBe('ownStems')
    expect(own.timeLeftMs).toBeNull()
  })

  it('null clears the line', () => {
    const view = createLibraryProgressView()
    view.update(load(100), 0)
    expect(view.update(null, 100)).toEqual({ progress: null, timeLeftMs: null })
  })
})

describe('etaSampleOf', () => {
  it('a load is timed over the whole loading stage, a walk over its own phase', () => {
    expect(
      etaSampleOf({
        ...base,
        loading: true,
        completed: 10,
        total: 100,
        stage: { part: 2, parts: 3, completed: 110, total: 300 }
      })
    ).toEqual({ key: 'load', completed: 110, total: 300 })
    expect(
      etaSampleOf({ ...base, phase: 'riffIndex', dbIndex: 1, completed: 10, total: 100 })
    ).toEqual({
      key: 'riffIndex:1',
      completed: 10,
      total: 100
    })
    // A running count has no end to time.
    expect(etaSampleOf({ ...base, phase: 'ownStems', completed: 10 })).toBeNull()
    expect(etaSampleOf(null)).toBeNull()
  })
})

describe('createLoadStageTracker', () => {
  it('weights a step whose entries load slower, for the time left', () => {
    const stage = createLoadStageTracker([
      { key: 'riffIndex:0', planned: 100, weight: 2 },
      { key: 'instrumentRows:0', planned: 100 }
    ])
    expect(stage.report('riffIndex:0', 50)).toEqual({
      part: 1,
      parts: 2,
      completed: 100,
      total: 300
    })
    stage.finish('riffIndex:0')
    expect(stage.report('instrumentRows:0', 50)).toEqual({
      part: 2,
      parts: 2,
      completed: 250,
      total: 300
    })
  })

  it('adds up the copies to load, in order, and counts a step that loaded nothing as done', () => {
    const stage = createLoadStageTracker([
      { key: 'riffIndex:0', planned: 700 },
      { key: 'instrumentRows:0', planned: 900 },
      { key: 'riffIndex:1', planned: 0 }, // nothing saved: no load
      { key: 'instrumentRows:1', planned: 100 }
    ])
    expect(stage.report('riffIndex:0', 300)).toEqual({
      part: 1,
      parts: 3,
      completed: 300,
      total: 1700
    })
    stage.finish('riffIndex:0')
    expect(stage.report('instrumentRows:0', 2000)).toEqual({
      part: 2,
      parts: 3,
      completed: 1600, // clamped to what was planned for it
      total: 1700
    })
    // Decided to rebuild instead of loading: its share is done at once.
    stage.finish('instrumentRows:0')
    expect(stage.report('instrumentRows:1', 50)).toEqual({
      part: 3,
      parts: 3,
      completed: 1650,
      total: 1700
    })
    expect(stage.report('riffIndex:1', 5)).toBeUndefined()
  })
})
