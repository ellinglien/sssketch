import { describe, expect, it } from 'vitest'
import { radioNextLanding, type RadioNextLandingInput } from './radioNextLanding'
import { radioReadout } from './radioReadout'

const input = (over: Partial<RadioNextLandingInput> = {}): RadioNextLandingInput => ({
  pos: 1,
  loopBars: 8,
  course: null,
  led: null,
  pending: null,
  manual: [],
  arc: null,
  ...over
})

type Arc = NonNullable<RadioNextLandingInput['arc']>
const arc = (over: Partial<Arc> = {}): Arc => ({
  adding: null,
  exit: null,
  exitBeats: 8,
  leg: null,
  count: 3,
  canAdd: true,
  removal: null,
  ...over
})

describe('radioNextLanding: radio alone', () => {
  it('names nothing with nothing coming', () => {
    expect(radioNextLanding(input())).toBeNull()
  })

  it('names radio’s armed pick at its own wait', () => {
    expect(radioNextLanding(input({ pending: { rowId: 'a', barsUntil: 23 } }))).toEqual({
      rowId: 'a',
      kind: null,
      barsAway: 23
    })
  })

  it('names a held change at the top, or at its own bar', () => {
    expect(radioNextLanding(input({ led: { rowId: 'a', kind: 'bloom' } }))?.barsAway).toBe(7)
    expect(radioNextLanding(input({ led: { rowId: 'a', kind: 'cut', atBars: 4 } }))?.barsAway).toBe(
      3
    )
  })
})

describe('radioNextLanding: the manual queue and a course change', () => {
  it('a warm queued change lands at the top, before radio’s change a phrase away', () => {
    const n = radioNextLanding(
      input({
        pending: { rowId: 'a', barsUntil: 15 },
        manual: [{ rowId: 'b', kind: 'filter in', ready: true }]
      })
    )
    expect(n).toEqual({ rowId: 'b', kind: 'filter in', barsAway: 7 })
  })

  it('a cold one is named only with nothing else (bar unknown)', () => {
    const cold = [{ rowId: 'b', kind: null, ready: false }]
    expect(
      radioNextLanding(input({ pending: { rowId: 'a', barsUntil: 15 }, manual: cold }))?.rowId
    ).toBe('a')
    expect(radioNextLanding(input({ manual: cold }))).toEqual({
      rowId: 'b',
      kind: null,
      barsAway: null
    })
  })

  it('on the same top radio’s change is named over a queued one', () => {
    const n = radioNextLanding(
      input({
        led: { rowId: 'a', kind: 'riser' },
        manual: [{ rowId: 'b', kind: 'bloom', ready: true }]
      })
    )
    expect(n?.rowId).toBe('a')
  })

  it('a course change turns the bed over at the top, and radio’s pick waits behind it', () => {
    const n = radioNextLanding(
      input({ course: ['a', 'b', 'c'], pending: { rowId: 'a', barsUntil: 3 } })
    )
    expect(n).toEqual({ rowId: 'a', kind: 'cut', barsAway: 7, course: ['a', 'b', 'c'] })
  })
})

describe('radioNextLanding: the density arc', () => {
  const exit = (over: Partial<NonNullable<Arc['exit']>> = {}): NonNullable<Arc['exit']> => ({
    rowId: 'c',
    phase: 'waiting',
    thisLap: false,
    heldBack: false,
    heard: true,
    ...over
  })

  it('a waiting exit leaves at its drop this lap, before radio’s change at the top', () => {
    // 8 beats: silent from bar 6 of 8
    const n = radioNextLanding(
      input({ led: { rowId: 'a', kind: 'cut' }, arc: arc({ exit: exit() }) })
    )
    expect(n).toEqual({ rowId: 'c', kind: null, barsAway: 5, leaving: true })
  })

  it('an exit held back (a lead-in has the lap), or too late in the lap, leaves the lap after', () => {
    const held = radioNextLanding(
      input({ led: { rowId: 'a', kind: 'hole' }, arc: arc({ exit: exit({ heldBack: true }) }) })
    )
    expect(held?.rowId).toBe('a')
    expect(
      radioNextLanding(input({ arc: arc({ exit: exit({ heldBack: true }) }) }))?.barsAway
    ).toBe(13)
    expect(radioNextLanding(input({ pos: 5.9, arc: arc({ exit: exit() }) }))?.barsAway).toBeCloseTo(
      8.1
    )
  })

  it('a fading exit leaves at its drop; one not heard goes at once', () => {
    expect(
      radioNextLanding(
        input({ pos: 6.05, arc: arc({ exit: exit({ phase: 'fading', thisLap: true }) }) })
      )?.barsAway
    ).toBe(0)
    expect(
      radioNextLanding(
        input({
          pending: { rowId: 'a', barsUntil: 0.5 },
          arc: arc({ exit: exit({ heard: false }) })
        })
      )?.rowId
    ).toBe('c')
  })

  it('a joining row is a new row, with its arrival once queued; same top as radio: the arc’s', () => {
    const n = radioNextLanding(
      input({
        led: { rowId: 'a', kind: 'cut' },
        manual: [{ rowId: 'n', kind: 'filter in', ready: true }],
        arc: arc({ adding: { rowId: 'n' } })
      })
    )
    expect(n).toEqual({ rowId: 'n', kind: 'filter in', barsAway: 7, adding: true })
  })

  it('a row still picking is not named over anything with a bar', () => {
    const n = radioNextLanding(
      input({ pending: { rowId: 'a', barsUntil: 30 }, arc: arc({ adding: { rowId: 'n' } }) })
    )
    expect(n?.rowId).toBe('a')
  })

  it('foresees a growing leg’s add: it appears at the top its bars complete, joins the next', () => {
    const leg = { phase: 'growing' as const, target: 5, bars: 0, stepBars: 20 }
    // 20 bars in 8-bar laps: the third top from here (wrap 2), joining at wrap 3
    const n = radioNextLanding(input({ pending: { rowId: 'a', barsUntil: 40 }, arc: arc({ leg }) }))
    expect(n).toEqual({ rowId: '', kind: null, barsAway: 7 + 24, adding: true })
    // radio's change first
    expect(
      radioNextLanding(input({ pending: { rowId: 'a', barsUntil: 15 }, arc: arc({ leg }) }))?.rowId
    ).toBe('a')
    // at its target, or with nothing to add, it turns round instead
    expect(radioNextLanding(input({ arc: arc({ leg, count: 5 }) }))).toBeNull()
    expect(radioNextLanding(input({ arc: arc({ leg, canAdd: false }) }))).toBeNull()
  })

  it('foresees a thinning leg’s removal: its drop in the lap the step’s top starts', () => {
    const leg = { phase: 'thinning' as const, target: 2, bars: 10, stepBars: 12 }
    const n = radioNextLanding(input({ arc: arc({ leg, count: 4, removal: 'c' }) }))
    // completes at wrap 0, drops at bar 6 of the next lap
    expect(n).toEqual({ rowId: 'c', kind: null, barsAway: 7 + 6, leaving: true })
    expect(radioNextLanding(input({ arc: arc({ leg, count: 4, removal: null }) }))).toBeNull()
  })

  it('reads in the shared readout as the web radio’s does', () => {
    const rows = ['a', 'n'].map((rowId) => ({ rowId, kinds: ['drums' as const], laps: 1 }))
    const r = radioReadout({
      bars: { intoPhrase: 1, phraseBars: 0, loopBars: 8 },
      nextChange: radioNextLanding(
        input({
          manual: [{ rowId: 'n', kind: 'bloom', ready: true }],
          arc: arc({ adding: { rowId: 'n' } })
        })
      ),
      armedTurnaround: null,
      arc: { state: 'off', count: 2, target: 2 },
      rows
    })
    expect(r.statusLine).toBe('next: a new row → bloom · 7 bars')
    expect(r.rows[1].nextLabel).toBe('next · bloom')
  })
})
