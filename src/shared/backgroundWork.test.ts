// src/shared/backgroundWork.test.ts
import { describe, expect, it, vi } from 'vitest'
import {
  createBackgroundWorkRegistry,
  describeBackgroundWork,
  formatCount,
  summarizeBackgroundWork
} from './backgroundWork'

describe('formatCount', () => {
  it('groups thousands with commas', () => {
    expect(formatCount(0)).toBe('0')
    expect(formatCount(12)).toBe('12')
    expect(formatCount(999)).toBe('999')
    expect(formatCount(1240)).toBe('1,240')
    expect(formatCount(52493)).toBe('52,493')
    expect(formatCount(1234567)).toBe('1,234,567')
  })

  it('rounds and never goes negative', () => {
    expect(formatCount(12.6)).toBe('13')
    expect(formatCount(-4)).toBe('0')
  })
})

describe('describeBackgroundWork', () => {
  it('says how many stems are left, and that it may slow things down', () => {
    expect(describeBackgroundWork({ kind: 'stemAnalysis', left: 1240 })).toBe(
      'analysing stems · 1,240 left · may slow things down'
    )
  })

  it('carries a note after the progress (the own-only index served while the library index rebuilds)', () => {
    expect(
      describeBackgroundWork({
        kind: 'libraryIndex',
        done: 1200,
        total: 900000,
        note: 'your stems ready'
      })
    ).toBe('indexing library · 1,200 of 900,000 · your stems ready · may slow things down')
  })

  it('names the unit and the time left for the library index (2026-10-07)', () => {
    expect(
      describeBackgroundWork({
        kind: 'libraryIndex',
        done: 400000,
        total: 900041,
        unit: 'riffs',
        timeLeft: 'about 3 min left'
      })
    ).toBe('indexing library · 400,000 of 900,041 riffs · about 3 min left · may slow things down')
  })

  it('a saved copy loading says loading, not indexing', () => {
    expect(
      describeBackgroundWork({
        kind: 'libraryIndex',
        verb: 'loading library',
        done: 1000,
        total: 891062,
        unit: 'stems'
      })
    ).toBe('loading library · 1,000 of 891,062 stems · may slow things down')
    expect(describeBackgroundWork({ kind: 'libraryIndex', verb: 'loading library' })).toBe(
      'loading library · may slow things down'
    )
  })

  it('counts done of total when both are known', () => {
    expect(describeBackgroundWork({ kind: 'pluginScan', done: 12, total: 80 })).toBe(
      'scanning plugins · 12 of 80'
    )
  })

  it('falls back to an ellipsis with no numbers', () => {
    expect(describeBackgroundWork({ kind: 'librarySync' })).toBe('syncing library…')
    expect(describeBackgroundWork({ kind: 'pluginScan' })).toBe('scanning plugins…')
  })

  it('counts riffs for a sync, which has no known total', () => {
    expect(describeBackgroundWork({ kind: 'librarySync', done: 2400 })).toBe(
      'syncing library · 2,400 riffs'
    )
  })

  it('says paused instead of the slow-down warning', () => {
    expect(describeBackgroundWork({ kind: 'stemAnalysis', left: 30, paused: true })).toBe(
      'analysing stems · 30 left · paused'
    )
  })
})

describe('summarizeBackgroundWork', () => {
  it('is null when nothing is active', () => {
    expect(summarizeBackgroundWork([])).toBeNull()
    expect(summarizeBackgroundWork([null, undefined])).toBeNull()
  })

  it('shows a single process as its own label, with nothing extra', () => {
    const summary = summarizeBackgroundWork([{ kind: 'librarySync' }])
    expect(summary).toEqual({
      kind: 'librarySync',
      label: 'syncing library…',
      more: null,
      title: 'syncing library…',
      paused: false,
      pausable: false
    })
  })

  it('leads with the most expensive process and counts the rest', () => {
    const summary = summarizeBackgroundWork([
      { kind: 'librarySync' },
      { kind: 'autoClassify', left: 300 },
      { kind: 'stemAnalysis', left: 1240, pausable: true }
    ])
    expect(summary?.kind).toBe('stemAnalysis')
    expect(summary?.label).toBe('analysing stems · 1,240 left · may slow things down')
    expect(summary?.more).toBe('+2')
    // Every process named on hover, most expensive first.
    expect(summary?.title).toBe(
      [
        'analysing stems · 1,240 left · may slow things down',
        'categorizing stems · 300 left',
        'syncing library…'
      ].join('\n')
    )
    expect(summary?.pausable).toBe(true)
  })

  it('leads with a running process over a more expensive paused one', () => {
    const summary = summarizeBackgroundWork([
      { kind: 'stemAnalysis', left: 50, paused: true, pausable: true },
      { kind: 'pluginScan', done: 3, total: 9 }
    ])
    expect(summary?.kind).toBe('pluginScan')
    expect(summary?.more).toBe('+1')
    expect(summary?.paused).toBe(false)
  })

  it('shows a paused label when everything left is paused', () => {
    const summary = summarizeBackgroundWork([
      { kind: 'stemAnalysis', left: 50, paused: true, pausable: true }
    ])
    expect(summary?.label).toBe('analysing stems · 50 left · paused')
    expect(summary?.paused).toBe(true)
    expect(summary?.pausable).toBe(true)
  })
})

describe('createBackgroundWorkRegistry', () => {
  it('starts empty and keeps a stable snapshot until something changes', () => {
    const registry = createBackgroundWorkRegistry()
    const first = registry.snapshot()
    expect(first).toEqual([])
    expect(registry.snapshot()).toBe(first)
  })

  it('reports, replaces and clears one entry per kind, notifying subscribers', () => {
    const registry = createBackgroundWorkRegistry()
    const listener = vi.fn()
    const unsubscribe = registry.subscribe(listener)

    registry.report('stemAnalysis', { kind: 'stemAnalysis', left: 10 })
    registry.report('stemAnalysis', { kind: 'stemAnalysis', left: 9 })
    expect(registry.snapshot()).toEqual([{ kind: 'stemAnalysis', left: 9 }])

    registry.report('stemAnalysis', null)
    expect(registry.snapshot()).toEqual([])
    expect(listener).toHaveBeenCalledTimes(3)

    // Clearing what is already clear changes nothing.
    registry.report('stemAnalysis', null)
    expect(listener).toHaveBeenCalledTimes(3)

    unsubscribe()
    registry.report('placedAnalysis', { kind: 'placedAnalysis', left: 1 })
    expect(listener).toHaveBeenCalledTimes(3)
  })
})
