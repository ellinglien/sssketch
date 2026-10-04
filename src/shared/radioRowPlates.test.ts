// The radio view's on-waveform plates (spec 2026-10-03-sssketch-radio-view-design section 4):
// the web's full-mode row render, lifted (radioRowPlates.ts).
import { describe, expect, it } from 'vitest'
import { NO_RADIO_ROW_PLATES, radioRowPlates } from './radioRowPlates'
import type { RadioReadoutRow } from './radioReadout'

function row(over: Partial<RadioReadoutRow> = {}): RadioReadoutRow {
  return {
    rowId: 'r1',
    label: 'drums · heavy',
    age: '1 lap',
    isNext: false,
    nextKind: null,
    nextLabel: null,
    flash: null,
    ...over
  }
}

describe('radioRowPlates', () => {
  it('splits the info plate into the label and a tail kept whole, after a no-break space', () => {
    expect(radioRowPlates(row(), null).info).toEqual({
      label: 'drums · heavy',
      tail: ' · 1 lap'
    })
  })

  it('keeps the role words in the tail, so they are never cut with the label', () => {
    const p = radioRowPlates(row({ age: '3 laps · hook · back in 16 bars' }), null)
    expect(p.info?.tail).toBe(' · 3 laps · hook · back in 16 bars')
  })

  it('has a bare tail with no label, a bare label with no age, and no plate with neither', () => {
    expect(radioRowPlates(row({ label: '' }), null).info).toEqual({ label: '', tail: '1 lap' })
    expect(radioRowPlates(row({ age: '' }), null).info).toEqual({
      label: 'drums · heavy',
      tail: ''
    })
    expect(radioRowPlates(row({ label: '', age: '' }), null).info).toBeNull()
  })

  it('hides the cue with neither a flash nor a next, and shows either alone', () => {
    expect(radioRowPlates(row(), null).cue).toBeNull()
    expect(radioRowPlates(row({ nextLabel: '' }), null).cue).toBeNull()
    expect(radioRowPlates(row({ nextLabel: 'next · filter in' }), null).cue).toEqual({
      flash: null,
      next: 'next · filter in'
    })
    const flashOnly = radioRowPlates(row({ flash: { word: 'throw', t: 0.5 } }), null).cue
    expect(flashOnly?.next).toBeNull()
    expect(flashOnly?.flash?.word).toBe('throw')
    expect(flashOnly?.flash?.opacity).toBeCloseTo(1, 6)
  })

  it('fades the flash in and out over its window', () => {
    const at = (t: number): number | undefined =>
      radioRowPlates(row({ flash: { word: 'wash', t } }), null).cue?.flash?.opacity
    expect(at(0)).toBeCloseTo(0, 6)
    expect(at(0.25)).toBeCloseTo(Math.SQRT1_2, 6)
    expect(at(1)).toBeCloseTo(0, 6)
  })

  it('shows the fold plate only on a folded row', () => {
    expect(radioRowPlates(row(), '7 / 16').fold).toBe('7 / 16')
    expect(radioRowPlates(row(), null).fold).toBeNull()
    expect(radioRowPlates(row(), '').fold).toBeNull()
  })

  it('draws nothing with no readout (radio off) and no fold', () => {
    expect(radioRowPlates(null, null)).toEqual(NO_RADIO_ROW_PLATES)
    // a folded row's plate does not need the readout
    expect(radioRowPlates(null, '3½ / 16')).toEqual({ info: null, cue: null, fold: '3½ / 16' })
  })
})
