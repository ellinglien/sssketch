// src/shared/libraryIndexProgress.test.ts
import { describe, expect, it } from 'vitest'
import {
  createEtaTracker,
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
