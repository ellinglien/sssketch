import { describe, expect, it } from 'vitest'
import {
  newRadioIntensityArc,
  type RadioIntensityArc,
  type RadioIntensityDecided
} from '@shared/radioIntensityArc'
import {
  intensityFlashRows,
  intensityHeldAddGoes,
  intensityNextChange,
  intensityRestsDecided,
  intensityRowsHeld,
  intensityThrowDropDue
} from './radioIntensityGlue'

const arcWith = (o: Partial<RadioIntensityArc>): RadioIntensityArc => ({
  ...newRadioIntensityArc(),
  begun: true,
  phrases: 2,
  ...o
})
const breakdown = (rest: string[]): RadioIntensityDecided => ({
  event: 'breakdown',
  depth: 'full',
  rest,
  throwRowId: rest[0] ?? null,
  throw: null,
  carry: false
})
const drop = (returning: string[], renew: string[] = [], quick = false): RadioIntensityDecided => ({
  event: 'drop',
  returning,
  renew,
  ...(quick && { quick: true as const, forced: true as const })
})

describe('intensityRowsHeld', () => {
  it('is the rests and the decided event rows, once each', () => {
    expect(
      intensityRowsHeld(arcWith({ rests: ['a', 'b'], decided: drop(['a', 'b'], ['b', 'c']) }))
    ).toEqual(['a', 'b', 'c'])
    expect(intensityRowsHeld(arcWith({ decided: breakdown(['d']) }))).toEqual(['d'])
    expect(intensityRowsHeld(arcWith({ decided: { event: 'add' } }))).toEqual([])
  })
})

describe('intensityRestsDecided', () => {
  it('is the decided breakdown rests only', () => {
    expect([...intensityRestsDecided(arcWith({ decided: breakdown(['a', 'b']) }))]).toEqual([
      'a',
      'b'
    ])
    expect(intensityRestsDecided(arcWith({ rests: ['a'], decided: drop(['a']) })).size).toBe(0)
  })
})

describe('intensityNextChange', () => {
  const entries = (m: Record<string, 'rest' | 'return'>) => (id: string) => m[id]
  it('names the breakdown rests at the top, the rest riding it', () => {
    const arc = arcWith({ decided: breakdown(['a', 'b', 'c']) })
    const next = intensityNextChange(arc, null, entries({ a: 'rest', c: 'rest' }), 1, 4)
    expect(next).toEqual({ rowId: 'a', kind: null, barsAway: 3, rests: true, with: ['c'] })
  })
  it('is no rest when none is queued', () => {
    const arc = arcWith({ decided: breakdown(['a']) })
    expect(intensityNextChange(arc, null, entries({}), 1, 4)).toBeNull()
  })
  it('says the drop at the top, with a row coming back when one is queued', () => {
    const arc = arcWith({ phase: 'breakdown', decided: drop(['a', 'b']) })
    expect(intensityNextChange(arc, null, entries({ b: 'return' }), 2, 4)).toEqual({
      rowId: 'b',
      kind: null,
      barsAway: 2,
      drop: true
    })
    // a quick drop brings nothing back
    expect(
      intensityNextChange(arcWith({ decided: drop([], [], true) }), null, entries({}), 0, 4)
    ).toEqual({ rowId: '', kind: null, barsAway: 4, drop: true })
  })
  it('keeps whatever lands before the top, and wins a tie at it', () => {
    const arc = arcWith({ decided: drop([]) })
    const sooner = { rowId: 'x', kind: null, barsAway: 1, leaving: true }
    expect(intensityNextChange(arc, sooner, entries({}), 1, 4)).toBe(sooner)
    const atTop = { rowId: 'y', kind: 'cut' as const, barsAway: 3 }
    expect(intensityNextChange(arc, atTop, entries({}), 1, 4)?.drop).toBe(true)
  })
  it('is the landing as it was with nothing decided, or an add', () => {
    const n = { rowId: 'y', kind: null, barsAway: 3 }
    expect(intensityNextChange(arcWith({}), n, entries({}), 1, 4)).toBe(n)
    expect(intensityNextChange(arcWith({ decided: { event: 'add' } }), n, entries({}), 1, 4)).toBe(
      n
    )
  })
})

describe('intensityFlashRows', () => {
  const o = { arcEntryOf: (id: string) => (id === 'a' ? ('rest' as const) : undefined) }
  it('flashes breakdown on the rests queued, drop on the rows coming back', () => {
    expect(
      intensityFlashRows(arcWith({ decided: breakdown(['a', 'b']) }), { ...o, heard: [], rows: [] })
    ).toEqual({ ids: ['a'], word: 'breakdown' })
    expect(
      intensityFlashRows(arcWith({ decided: drop(['b']) }), { ...o, heard: ['c'], rows: [] })
    ).toEqual({ ids: ['b'], word: 'drop' })
  })
  it('flashes a quick drop on every heard row, a pressed build on every row', () => {
    expect(
      intensityFlashRows(arcWith({ decided: drop([], [], true) }), {
        ...o,
        heard: ['c', 'd'],
        rows: []
      })
    ).toEqual({ ids: ['c', 'd'], word: 'drop' })
    expect(
      intensityFlashRows(arcWith({ decided: { event: 'cycle', strip: true, forced: true } }), {
        ...o,
        heard: [],
        rows: ['a', 'b']
      })
    ).toEqual({ ids: ['a', 'b'], word: 'build' })
  })
  it('flashes nothing for the clock own cycle, an add, or nothing decided', () => {
    const none = { ...o, heard: ['a'], rows: ['a'] }
    expect(intensityFlashRows(arcWith({ decided: { event: 'cycle', strip: false } }), none)).toBe(
      null
    )
    expect(intensityFlashRows(arcWith({ decided: { event: 'add' } }), none)).toBe(null)
    expect(intensityFlashRows(arcWith({}), none)).toBe(null)
  })
})

describe('intensityHeldAddGoes', () => {
  const build = arcWith({ phase: 'build', phrases: 3, done: 0 })
  it('keeps a held add away from a decide wrap', () => {
    expect(intensityHeldAddGoes(build, { decideWrap: false, tookAdd: false })).toBe(false)
  })
  it('keeps it when its decide wrap took it, or the build goes on undecided', () => {
    expect(intensityHeldAddGoes(build, { decideWrap: true, tookAdd: true })).toBe(false)
    expect(intensityHeldAddGoes(build, { decideWrap: true, tookAdd: false })).toBe(false)
  })
  it('lets it go when another event, or a press, has the coming top, or the build is over', () => {
    expect(
      intensityHeldAddGoes(arcWith({ phase: 'build', decided: breakdown([]) }), {
        decideWrap: true,
        tookAdd: false
      })
    ).toBe(true)
    expect(
      intensityHeldAddGoes(arcWith({ phase: 'build', forced: 'drop' }), {
        decideWrap: true,
        tookAdd: false
      })
    ).toBe(true)
    expect(
      intensityHeldAddGoes(arcWith({ phase: 'drop' }), { decideWrap: true, tookAdd: false })
    ).toBe(true)
  })
})

describe('intensityThrowDropDue', () => {
  it('is the breakdown last phrase, or a decided drop', () => {
    expect(intensityThrowDropDue(arcWith({ phase: 'breakdown', phrases: 2, done: 1 }))).toBe(true)
    expect(intensityThrowDropDue(arcWith({ phase: 'breakdown', phrases: 2, done: 0 }))).toBe(false)
    expect(intensityThrowDropDue(arcWith({ phase: 'build', decided: drop([], [], true) }))).toBe(
      true
    )
    expect(intensityThrowDropDue(arcWith({ phase: 'drop' }))).toBe(false)
    expect(intensityThrowDropDue(arcWith({ begun: false, phase: 'breakdown', done: 5 }))).toBe(
      false
    )
  })
})
