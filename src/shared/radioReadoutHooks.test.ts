// The readout names a hook's own landing (spec 2026-10-03-radio-anointed-stems-design section 6).
import { describe, expect, it } from 'vitest'
import { pickArcRemoval, type ArcRow } from './radioDensity'
import { radioNextLanding } from './radioNextLanding'
import { radioReadout, type RadioReadoutInput } from './radioReadout'

const rows = ['a', 'b', 'c'].map((rowId) => ({ rowId, kinds: ['drums' as const], laps: 1 }))
const input = (nextChange: RadioReadoutInput['nextChange']): RadioReadoutInput => ({
  bars: { intoPhrase: 0, phraseBars: 16, loopBars: 4 },
  nextChange,
  armedTurnaround: null,
  arc: { state: 'off', count: 3, target: 3 },
  rows
})

describe('a hook in the readout', () => {
  it('next names it; the row reads next · hook back', () => {
    const r = radioReadout(input({ rowId: 'b', kind: 'riser', barsAway: 4, hook: 'back' }))
    expect(r.statusLine).toBe('next: row 2 → hook back · 4 bars')
    expect(r.rows[1].nextLabel).toBe('next · hook back')
    const out = radioReadout(input({ rowId: 'c', kind: 'cut', barsAway: 3.5, hook: 'out' }))
    expect(out.statusLine).toBe('next: row 3 → hook out · 4 bars')
  })

  it('radioNextLanding passes a queued hook landing through', () => {
    const n = radioNextLanding({
      pos: 1,
      loopBars: 4,
      course: null,
      led: null,
      pending: null,
      manual: [{ rowId: 'b', kind: 'cut', ready: true, hook: 'back' }],
      arc: null
    })
    expect(n).toEqual({ rowId: 'b', kind: 'cut', barsAway: 3, hook: 'back' })
  })
})

describe('the arc and a resting hook', () => {
  const r = (id: string, o: Partial<ArcRow> = {}): ArcRow => ({
    id,
    kinds: ['drums'],
    radioAdded: true,
    locked: false,
    soloed: false,
    held: false,
    busy: false,
    shrinksLoop: false,
    staleness: 1,
    ...o
  })
  it('an unheard drums row does not count: the heard one is the last of its kind', () => {
    expect(pickArcRemoval([r('d1', { staleness: 5 }), r('d2')])).toBe('d1')
    expect(
      pickArcRemoval([r('d1', { staleness: 5 }), r('d2', { heard: false, held: true })])
    ).toBeNull()
  })
})
