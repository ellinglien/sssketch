import { describe, expect, it } from 'vitest'
import { drawManualTransitions, mergeStageChanges } from './radioManualChanges'
import type { RadioTransitionKind } from './radioTransition'

/** A pick that returns the given kind for every row. */
const always = (kind: RadioTransitionKind) => (): RadioTransitionKind => kind

describe('drawManualTransitions', () => {
  const rows = [
    { slotId: 'a', kinds: ['drums' as const] },
    { slotId: 'b', kinds: ['bass' as const] }
  ]

  it('gives every row an arrival gesture when that is what is drawn', () => {
    const out = drawManualTransitions(rows, {
      pick: always('bloom'),
      dropOutBeats: () => 2,
      leadingArmed: false,
      barsToWrap: 8
    })
    expect(out.get('a')).toEqual({ kind: 'bloom', beats: 4 })
    expect(out.get('b')).toEqual({ kind: 'bloom', beats: 4 })
  })

  it('allows at most one leading gesture, and cuts the rest', () => {
    const out = drawManualTransitions(rows, {
      pick: always('riser'),
      dropOutBeats: () => 2,
      leadingArmed: false,
      barsToWrap: 8
    })
    expect(out.get('a')).toEqual({ kind: 'riser', beats: 8 })
    expect(out.get('b')).toEqual({ kind: 'cut', beats: 4 })
  })

  it('draws no leading gesture when one is already armed this lap', () => {
    const out = drawManualTransitions(rows, {
      pick: always('hole'),
      dropOutBeats: () => 2,
      leadingArmed: true,
      barsToWrap: 8
    })
    expect(out.get('a')?.kind).toBe('cut')
    expect(out.get('b')?.kind).toBe('cut')
  })

  it('draws no leading gesture when there is not room for it before the wrap', () => {
    // A riser is 8 beats = 2 bars; a hole of 4 beats = 1 bar.
    const riser = drawManualTransitions([rows[0]], {
      pick: always('riser'),
      dropOutBeats: () => 4,
      leadingArmed: false,
      barsToWrap: 1.5
    })
    expect(riser.get('a')?.kind).toBe('cut')
    const hole = drawManualTransitions([rows[0]], {
      pick: always('hole'),
      dropOutBeats: () => 4,
      leadingArmed: false,
      barsToWrap: 1.5
    })
    expect(hole.get('a')).toEqual({ kind: 'hole', beats: 4 })
  })

  it('allows a leading gesture whose bars exactly equal the bars to the wrap', () => {
    const out = drawManualTransitions([rows[0]], {
      pick: always('riser'),
      dropOutBeats: () => 2,
      leadingArmed: false,
      barsToWrap: 2
    })
    expect(out.get('a')).toEqual({ kind: 'riser', beats: 8 })
  })

  it('uses the drop-out beats for a hole', () => {
    const out = drawManualTransitions([rows[0]], {
      pick: always('hole'),
      dropOutBeats: () => 2,
      leadingArmed: false,
      barsToWrap: 8
    })
    expect(out.get('a')).toEqual({ kind: 'hole', beats: 2 })
  })

  it('passes a cut straight through', () => {
    const out = drawManualTransitions(rows, {
      pick: always('cut'),
      dropOutBeats: () => 2,
      leadingArmed: false,
      barsToWrap: 8
    })
    expect(out.get('a')).toEqual({ kind: 'cut', beats: 4 })
  })
})

describe('mergeStageChanges', () => {
  const led = { slotId: 'a', stem: 'stem-a', arrival: { kind: 'bloom' as const, beats: 4 } }

  it('carries radio’s held change on its own', () => {
    expect(mergeStageChanges(led, new Map())).toEqual({
      changes: [{ slotId: 'a', stem: 'stem-a' }],
      joining: [],
      arrivals: [{ slotId: 'a', kind: 'bloom', beats: 4 }]
    })
  })

  it('carries manual changes alongside, joining rows listed separately', () => {
    const manual = new Map([
      ['b', { stem: 'stem-b', joining: false, arrival: null }],
      ['c', { stem: 'stem-c', joining: true, arrival: { kind: 'filter in' as const, beats: 4 } }]
    ])
    expect(mergeStageChanges(led, manual)).toEqual({
      changes: [
        { slotId: 'a', stem: 'stem-a' },
        { slotId: 'b', stem: 'stem-b' },
        { slotId: 'c', stem: 'stem-c' }
      ],
      joining: ['c'],
      arrivals: [
        { slotId: 'a', kind: 'bloom', beats: 4 },
        { slotId: 'c', kind: 'filter in', beats: 4 }
      ]
    })
  })

  it('lets a manual change on the same row as radio’s win', () => {
    const manual = new Map([['a', { stem: 'mine', joining: false, arrival: null }]])
    expect(mergeStageChanges(led, manual)).toEqual({
      changes: [{ slotId: 'a', stem: 'mine' }],
      joining: [],
      arrivals: []
    })
  })

  it('works with no radio change at all', () => {
    const manual = new Map([['b', { stem: 'stem-b', joining: false, arrival: null }]])
    expect(mergeStageChanges(null, manual).changes).toEqual([{ slotId: 'b', stem: 'stem-b' }])
  })

  it('carries radio’s own cut arrival as no arrival', () => {
    const cutLed = { slotId: 'a', stem: 's', arrival: { kind: 'cut' as const, beats: 4 } }
    expect(mergeStageChanges(cutLed, new Map()).arrivals).toEqual([])
  })

  it('carries a cut as no arrival', () => {
    const cut = { slotId: 'a', stem: 's', arrival: undefined }
    expect(mergeStageChanges(cut, new Map()).arrivals).toEqual([])
  })
})
