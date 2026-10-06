import { describe, expect, it } from 'vitest'
import {
  dropRadioFlashes,
  placeRadioGestureFlash,
  pruneRadioFlashes,
  radioAgeLabel,
  radioFlashOpacity,
  radioFlashShown,
  radioGestureFlashWord,
  radioReadout,
  radioReadoutArc,
  radioReadoutBars,
  radioRulerCells,
  radioRowLabel,
  type RadioFlash,
  type RadioReadoutInput,
  type RadioReadoutRowInput
} from './radioReadout'

const row = (rowId: string, over: Partial<RadioReadoutRowInput> = {}): RadioReadoutRowInput => ({
  rowId,
  kinds: ['drums'],
  laps: 1,
  ...over
})

const input = (over: Partial<RadioReadoutInput> = {}): RadioReadoutInput => ({
  bars: { intoPhrase: 5.5, phraseBars: 16, loopBars: 4 },
  nextChange: null,
  armedTurnaround: null,
  arc: { state: 'off', count: 3, target: 3 },
  rows: [row('a'), row('b', { kinds: ['bass'] }), row('c', { kinds: ['lead'] })],
  ...over
})

describe('radioReadout: the status line', () => {
  it('says where the arc is heading, for each state', () => {
    expect(radioReadout(input({ arc: { state: 'growing', count: 3, target: 5 } })).statusLine).toBe(
      'building ↑ 3 → 5'
    )
    expect(
      radioReadout(input({ arc: { state: 'thinning', count: 5, target: 3 } })).statusLine
    ).toBe('thinning ↓ 5 → 3')
    expect(radioReadout(input({ arc: { state: 'steady', count: 4, target: 4 } })).statusLine).toBe(
      'steady · 4 rows'
    )
    expect(radioReadout(input({ arc: { state: 'steady', count: 1, target: 1 } })).statusLine).toBe(
      'steady · 1 row'
    )
    expect(radioReadout(input()).statusLine).toBe('')
  })

  it('adds the next change: its row number, how it arrives, and whole bars away', () => {
    const r = radioReadout(
      input({
        arc: { state: 'growing', count: 3, target: 5 },
        nextChange: { rowId: 'b', kind: 'filter in', barsAway: 5.2 }
      })
    )
    expect(r.statusLine).toBe('building ↑ 3 → 5 · next: row 2 → filter in · 6 bars')
  })

  it('leaves the arrival out while it is only armed, and says 1 bar in the singular', () => {
    const r = radioReadout(input({ nextChange: { rowId: 'c', kind: null, barsAway: 0.4 } }))
    expect(r.statusLine).toBe('next: row 3 · 1 bar')
  })

  it('says next: soon when the bar is not known yet', () => {
    const r = radioReadout(
      input({
        arc: { state: 'steady', count: 3, target: 3 },
        nextChange: { rowId: 'a', kind: 'cut', barsAway: null }
      })
    )
    expect(r.statusLine).toBe('steady · 3 rows · next: soon')
  })

  it('names a row not on the bed yet as a new row', () => {
    const r = radioReadout(input({ nextChange: { rowId: 'z', kind: 'bloom', barsAway: 4 } }))
    expect(r.statusLine).toBe('next: a new row → bloom · 4 bars')
  })

  it('says a row the arc takes out leaves, with no arrival', () => {
    const r = radioReadout(
      input({
        arc: { state: 'thinning', count: 3, target: 2 },
        nextChange: { rowId: 'b', kind: null, barsAway: 3.5, leaving: true }
      })
    )
    expect(r.statusLine).toBe('thinning ↓ 3 → 2 · next: row 2 leaves · 4 bars')
    expect(r.rows[1]).toMatchObject({ isNext: true, nextKind: null, nextLabel: 'next · leaves' })
  })

  it('the arc’s new row reads as a new row even while drawn as one (sssketch)', () => {
    const r = radioReadout(
      input({ nextChange: { rowId: 'c', kind: 'filter in', barsAway: 2, adding: true } })
    )
    expect(r.statusLine).toBe('next: a new row → filter in · 2 bars')
    expect(r.rows[2]).toMatchObject({ isNext: true, nextLabel: 'next · filter in' })
  })

  it('a course change names itself, and every row it turns over reads next', () => {
    const r = radioReadout(
      input({ nextChange: { rowId: 'a', kind: 'cut', barsAway: 3, course: ['a', 'c'] } })
    )
    expect(r.statusLine).toBe('next: course change · 3 bars')
    expect(r.rows.map((x) => x.nextLabel)).toEqual(['next · cut', null, 'next · cut'])
  })

  it('held: the arc reads held, with no direction, and a change already on its way still shows', () => {
    const held = (over: Partial<RadioReadoutInput>): string =>
      radioReadout(input({ held: true, ...over })).statusLine
    expect(held({ arc: { state: 'growing', count: 3, target: 5 } })).toBe('held · 3 rows')
    expect(held({ arc: { state: 'thinning', count: 1, target: 0 } })).toBe('held · 1 row')
    expect(held({})).toBe('held')
    expect(
      held({
        arc: { state: 'thinning', count: 3, target: 2 },
        nextChange: { rowId: 'c', kind: null, barsAway: 1, leaving: true }
      })
    ).toBe('held · 3 rows · next: row 3 leaves · 1 bar')
  })
})

describe('radioReadout: the phrase ruler', () => {
  it('one tick per bar, the whole bars played filled, no end label with nothing armed', () => {
    expect(radioReadout(input()).ruler).toEqual({ ticks: 16, filled: 5, end: null })
  })

  it("a phrase end's turnaround is its move's label; a turn is turn: <move>", () => {
    expect(
      radioReadout(input({ armedTurnaround: { move: 'drum drop', isTurn: false } })).ruler.end
    ).toBe('drums out')
    expect(radioReadout(input({ armedTurnaround: { move: 'wash', isTurn: true } })).ruler.end).toBe(
      'turn: wash'
    )
    expect(radioReadout(input({ armedTurnaround: { move: null, isTurn: true } })).ruler.end).toBe(
      'turn'
    )
  })

  it('never fills past its ticks', () => {
    const r = radioReadout(input({ bars: { intoPhrase: 99, phraseBars: 16, loopBars: 4 } }))
    expect(r.ruler.filled).toBe(16)
  })
})

describe('radioReadoutBars', () => {
  it('counts the turnaround phrase (16 bars with no phrase grid) from the clock', () => {
    expect(radioReadoutBars(2, 1.5, 4, 0)).toEqual({ intoPhrase: 9.5, phraseBars: 16, loopBars: 4 })
    expect(radioReadoutBars(5, 0, 4, 16)).toEqual({ intoPhrase: 4, phraseBars: 16, loopBars: 4 })
    expect(radioReadoutBars(undefined, 2, 8, 32)).toEqual({
      intoPhrase: 2,
      phraseBars: 32,
      loopBars: 8
    })
    expect(radioReadoutBars(0, 1, 0, 16)).toEqual({ intoPhrase: 0, phraseBars: 0, loopBars: 0 })
  })
})

describe('radioReadoutArc', () => {
  it('off with the arc off; otherwise the direction from the leg', () => {
    expect(radioReadoutArc(null, 3, false)).toEqual({ state: 'off', count: 3, target: 3 })
    expect(radioReadoutArc({ phase: 'growing', target: 5 }, 3, true)).toEqual({
      state: 'growing',
      count: 3,
      target: 5
    })
    expect(radioReadoutArc({ phase: 'growing', target: 5 }, 5, true).state).toBe('steady')
    expect(radioReadoutArc({ phase: 'thinning', target: 2 }, 4, true).state).toBe('thinning')
    expect(radioReadoutArc(null, 4, true)).toEqual({ state: 'steady', count: 4, target: 4 })
  })
})

describe('radioRowLabel', () => {
  it('the first mask kind and the trait it was picked for', () => {
    expect(radioRowLabel(row('a', { kinds: ['bright', 'drums'] }))).toBe('drums · bright')
    expect(radioRowLabel(row('a', { kinds: ['lead', 'bass', 'warm'] }))).toBe('bass · warm')
    expect(radioRowLabel(row('a', { kinds: ['drums', 'bassHeavy'] }))).toBe('drums · heavy')
  })

  it("a mask kind alone takes the stem's dominant trait, if it has one", () => {
    expect(
      radioRowLabel(row('a', { kinds: ['drums'], traits: { bright: 0.9, rhythmic: 0.7 } }))
    ).toBe('drums · bright')
    expect(radioRowLabel(row('a', { kinds: ['drums'], traits: { bright: 0.3, warm: 0.5 } }))).toBe(
      'drums'
    )
    expect(radioRowLabel(row('a', { kinds: ['bass'], traits: { warm: null } }))).toBe('bass')
  })

  it('no mask kind: the trait alone (picked for, else strongest)', () => {
    expect(radioRowLabel(row('a', { kinds: ['rhythmic'] }))).toBe('rhythmic')
    expect(radioRowLabel(row('a', { kinds: [], traits: { warm: 0.8, rhythmic: 0.65 } }))).toBe(
      'warm'
    )
  })

  it('nothing else: the stem type; nothing at all: empty', () => {
    expect(radioRowLabel(row('a', { kinds: [], stemType: 'audioIn' }))).toBe('audio in')
    expect(radioRowLabel(row('a', { kinds: [] }))).toBe('')
  })

  it('appends the author when known', () => {
    expect(radioRowLabel(row('a', { kinds: ['drums', 'bright'], author: 'elling' }))).toBe(
      'drums · bright — elling'
    )
    expect(radioRowLabel(row('a', { kinds: [], author: 'elling' }))).toBe('elling')
    expect(radioRowLabel(row('a', { kinds: ['lead'], author: '  ' }))).toBe('lead')
  })
})

describe('radioAgeLabel', () => {
  it('laps, with 1 lap in the singular', () => {
    expect(radioAgeLabel(1)).toBe('1 lap')
    expect(radioAgeLabel(12)).toBe('12 laps')
    expect(radioAgeLabel(0)).toBe('0 laps')
    expect(radioAgeLabel(2.9)).toBe('2 laps')
    expect(radioAgeLabel(Number.NaN)).toBe('0 laps')
  })
})

describe('radioReadout: rows', () => {
  it('labels and ages each row; marks the next one with how it arrives; passes the flash on', () => {
    const r = radioReadout(
      input({
        nextChange: { rowId: 'b', kind: 'filter in', barsAway: 3 },
        rows: [
          row('a', { laps: 12, flash: { word: 'wash', t: 0.5 } }),
          row('b', { kinds: ['bass'], laps: 1, author: 'elling' })
        ]
      })
    )
    expect(r.rows).toEqual([
      {
        rowId: 'a',
        label: 'drums',
        age: '12 laps',
        isNext: false,
        nextKind: null,
        nextLabel: null,
        flash: { word: 'wash', t: 0.5 }
      },
      {
        rowId: 'b',
        label: 'bass — elling',
        age: '1 lap',
        isNext: true,
        nextKind: 'filter in',
        nextLabel: 'next · filter in',
        flash: null
      }
    ])
  })

  it('reads plain next while the arrival is not drawn', () => {
    const r = radioReadout(input({ nextChange: { rowId: 'a', kind: null, barsAway: 8 } }))
    expect(r.rows[0].nextLabel).toBe('next')
  })
})

describe('the gesture flash', () => {
  const log: RadioFlash[] = [
    { rowId: 'a', word: 'hole', at: 10, key: 'k1' },
    { rowId: 'a', word: 'throw', at: 10.5, key: 'k2' },
    { rowId: 'b', word: 'wash', at: 12, key: 'k3' }
  ]

  it('a word shows from when it sounds, for one window, the latest winning', () => {
    expect(radioFlashShown(log, 'a', 9.9, 2)).toBeNull()
    expect(radioFlashShown(log, 'a', 10.25, 2)).toEqual({ word: 'hole', t: 0.125 })
    expect(radioFlashShown(log, 'a', 11.5, 2)).toEqual({ word: 'throw', t: 0.5 })
    expect(radioFlashShown(log, 'a', 12.5, 2)).toBeNull()
    expect(radioFlashShown(log, 'b', 11, 2)).toBeNull()
    expect(radioFlashShown(log, 'b', 12, 2)).toEqual({ word: 'wash', t: 0 })
    expect(radioFlashShown(log, 'a', 10.5, 0)).toBeNull()
  })

  it('pruning drops words past their window, and words not sounding yet that were taken back', () => {
    expect(pruneRadioFlashes(log, 12.2, 2).map((f) => f.key)).toEqual(['k2', 'k3'])
    expect(pruneRadioFlashes(log, 11, 2, new Set(['k1'])).map((f) => f.key)).toEqual(['k1', 'k2'])
    expect(pruneRadioFlashes(log, 11, 2, new Set(['k3'])).map((f) => f.key)).toEqual([
      'k1',
      'k2',
      'k3'
    ])
  })

  it('dropping takes back every word one key armed', () => {
    expect(dropRadioFlashes(log, 'k2').map((f) => f.key)).toEqual(['k1', 'k3'])
  })

  it('a cut and the arc exit flash nothing; every other gesture its own name', () => {
    expect(radioGestureFlashWord('cut')).toBeNull()
    expect(radioGestureFlashWord('drop-out')).toBeNull()
    expect(radioGestureFlashWord('filter in')).toBe('filter in')
    expect(radioGestureFlashWord('riser')).toBe('riser')
  })

  it('fades in and out over its window', () => {
    expect(radioFlashOpacity(0)).toBe(0)
    expect(radioFlashOpacity(0.5)).toBeCloseTo(1, 9)
    expect(radioFlashOpacity(1)).toBeCloseTo(0, 9)
    expect(radioFlashOpacity(Number.NaN)).toBe(0)
  })
})

describe("the pace slider: companions riding radio's change", () => {
  const rows = ['a', 'b', 'c', 'd'].map((rowId) => ({ rowId, kinds: ['drums' as const], laps: 1 }))
  const mk = (nextChange: RadioReadoutInput['nextChange']): ReturnType<typeof radioReadout> =>
    radioReadout(input({ rows, nextChange }))
  it('the status line counts them; each reads next · cut', () => {
    const r = mk({ rowId: 'b', kind: 'bloom', barsAway: 1, with: ['c', 'd'] })
    expect(r.statusLine).toBe('next: row 2 +2 → bloom · 1 bar')
    expect(r.rows.map((x) => x.nextLabel)).toEqual([
      null,
      'next · bloom',
      'next · cut',
      'next · cut'
    ])
  })
  it('none, or an empty list, reads as before', () => {
    const r = mk({ rowId: 'b', kind: null, barsAway: 3, with: [] })
    expect(r.statusLine).toBe('next: row 2 · 3 bars')
  })
})

describe('the pace slider companions: edge cases', () => {
  const rows = ['a', 'b', 'c'].map((rowId) => ({ rowId, kinds: ['drums' as const], laps: 1 }))
  const mk = (nextChange: RadioReadoutInput['nextChange']): ReturnType<typeof radioReadout> =>
    radioReadout(input({ rows, nextChange }))
  it('counts distinct rows, not the led row, not unknown ids', () => {
    const r = mk({ rowId: 'a', kind: 'cut', barsAway: 1, with: ['b', 'b', 'a', 'zz'] })
    expect(r.statusLine).toBe('next: row 1 +1 → cut · 1 bar')
    expect(r.rows.map((x) => x.nextLabel)).toEqual(['next · cut', 'next · cut', null])
  })
  it('a leaving row does not make its companions leave', () => {
    const r = mk({ rowId: 'a', kind: null, leaving: true, barsAway: 1, with: ['b'] })
    expect(r.statusLine).toBe('next: row 1 +1 leaves · 1 bar')
    expect(r.rows[0].nextLabel).not.toBe('next · cut')
    expect(r.rows[1].nextLabel).toBe('next · cut')
  })
  it('a course change ignores with', () => {
    const r = mk({ rowId: 'a', kind: 'bloom', barsAway: 1, course: ['a', 'b'], with: ['c'] })
    expect(r.statusLine).toBe('next: course change · 1 bar')
    expect(r.rows[2].nextLabel).toBeNull()
  })
})

describe('radioRulerCells', () => {
  it('marks played, the bar in progress, and the bars ahead', () => {
    const cells = radioRulerCells({ ticks: 16, filled: 4, end: null })
    expect(cells).toHaveLength(16)
    expect(cells.slice(0, 4)).toEqual(['played', 'played', 'played', 'played'])
    expect(cells[4]).toBe('now')
    expect(cells.slice(5, 8)).toEqual(['ahead', 'ahead', 'ahead'])
    expect(cells[8]).toBe('ahead-bar')
    expect(cells[12]).toBe('ahead-bar')
    expect(cells[15]).toBe('ahead')
  })
  it('is all played when every bar has played', () => {
    expect(radioRulerCells({ ticks: 8, filled: 8, end: null })).toEqual(Array(8).fill('played'))
  })
  it('is empty with no ticks', () => {
    expect(radioRulerCells({ ticks: 0, filled: 0, end: null })).toEqual([])
  })
})

describe("a gesture's word placed on the lap as it is now, every tick (as its visuals are)", () => {
  const other: RadioFlash = { rowId: 'b', word: 'throw', at: 66, key: 'k9' }
  const place = (
    log: readonly RadioFlash[],
    kind: 'hole' | 'riser' | 'filter in' | 'duck' | 'cut' | 'drop-out',
    loopBars: number,
    beats = 8
  ): RadioFlash[] =>
    placeRadioGestureFlash(log, { kind, rowId: 'a', beats, lapStart: 64, loopBars, key: 'g1' })

  it("a lead-in's word over its beats before the wrap ending the lap, on until the wrap", () => {
    expect(place([other], 'hole', 8)).toEqual([
      other,
      { rowId: 'a', word: 'hole', at: 70, key: 'g1', until: 72 }
    ])
  })

  it('a loop learned longer moves it to the wrap that ends the lap now, once', () => {
    const log = place(place([other], 'riser', 8), 'riser', 16)
    expect(log).toEqual([other, { rowId: 'a', word: 'riser', at: 78, key: 'g1', until: 80 }])
  })

  it("an arrival's from the lap top, on until its curve ends (half the loop at most, as it is now)", () => {
    expect(place([], 'filter in', 4, 16)).toEqual([
      { rowId: 'a', word: 'filter in', at: 64, key: 'g1', until: 66 }
    ])
    expect(place(place([], 'filter in', 4, 16), 'filter in', 8, 16)).toEqual([
      { rowId: 'a', word: 'filter in', at: 64, key: 'g1', until: 68 }
    ])
  })

  it('a cut and the arc exit say nothing', () => {
    expect(place([other], 'cut', 8)).toEqual([other])
    expect(place([other], 'drop-out', 8)).toEqual([other])
  })
})
