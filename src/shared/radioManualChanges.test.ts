import { describe, expect, it, vi } from 'vitest'
import { drawManualTransitions, mergeStageChanges, radioGestureBeats } from './radioManualChanges'
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
      barsToWrap: 8,
      loopBars: 16
    })
    expect(out.get('a')).toEqual({ kind: 'bloom', beats: 4 })
    expect(out.get('b')).toEqual({ kind: 'bloom', beats: 4 })
  })

  it('allows at most one leading gesture, and cuts the rest', () => {
    const out = drawManualTransitions(rows, {
      pick: always('riser'),
      dropOutBeats: () => 2,
      leadingArmed: false,
      barsToWrap: 8,
      loopBars: 16
    })
    expect(out.get('a')).toEqual({ kind: 'riser', beats: 8 })
    expect(out.get('b')).toEqual({ kind: 'cut', beats: 4 })
  })

  it('draws no leading gesture when one is already armed this lap', () => {
    const out = drawManualTransitions(rows, {
      pick: always('hole'),
      dropOutBeats: () => 2,
      leadingArmed: true,
      barsToWrap: 8,
      loopBars: 16
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
      barsToWrap: 1.5,
      loopBars: 16
    })
    expect(riser.get('a')?.kind).toBe('cut')
    const hole = drawManualTransitions([rows[0]], {
      pick: always('hole'),
      dropOutBeats: () => 4,
      leadingArmed: false,
      barsToWrap: 1.5,
      loopBars: 16
    })
    expect(hole.get('a')).toEqual({ kind: 'hole', beats: 4 })
  })

  it('allows a leading gesture whose bars exactly equal the bars to the wrap', () => {
    const out = drawManualTransitions([rows[0]], {
      pick: always('riser'),
      dropOutBeats: () => 2,
      leadingArmed: false,
      barsToWrap: 2,
      loopBars: 16
    })
    expect(out.get('a')).toEqual({ kind: 'riser', beats: 8 })
  })

  it('gives an empty map for no rows', () => {
    const out = drawManualTransitions([], {
      pick: always('riser'),
      dropOutBeats: () => 2,
      leadingArmed: false,
      barsToWrap: 8,
      loopBars: 16
    })
    expect(out.size).toBe(0)
  })

  it('still grants arrival gestures when a leading gesture is armed', () => {
    const out = drawManualTransitions(rows, {
      pick: always('bloom'),
      dropOutBeats: () => 2,
      leadingArmed: true,
      barsToWrap: 8,
      loopBars: 16
    })
    expect(out.get('a')).toEqual({ kind: 'bloom', beats: 4 })
    expect(out.get('b')).toEqual({ kind: 'bloom', beats: 4 })
  })

  it('cuts a hole that has no room before the wrap', () => {
    const out = drawManualTransitions([rows[0]], {
      pick: always('hole'),
      dropOutBeats: () => 8,
      leadingArmed: false,
      barsToWrap: 1.5,
      loopBars: 16
    })
    expect(out.get('a')).toEqual({ kind: 'cut', beats: 4 })
  })

  it('hands each row’s kinds to pick', () => {
    const pick = vi.fn((): RadioTransitionKind => 'cut')
    drawManualTransitions(rows, {
      pick,
      dropOutBeats: () => 2,
      leadingArmed: false,
      barsToWrap: 8,
      loopBars: 16
    })
    expect(pick).toHaveBeenCalledTimes(2)
    expect(pick).toHaveBeenNthCalledWith(1, ['drums'], rows[0])
    expect(pick).toHaveBeenNthCalledWith(2, ['bass'], rows[1])
  })

  it('fits a riser by its half-loop clamp: 2 bars on a 2-bar loop is 1 bar', () => {
    const out = drawManualTransitions([rows[0]], {
      pick: always('riser'),
      dropOutBeats: () => 2,
      leadingArmed: false,
      barsToWrap: 1,
      loopBars: 2
    })
    expect(out.get('a')).toEqual({ kind: 'riser', beats: 8 })
  })

  it.each([NaN, 0, -1, Infinity])('cuts a leading gesture when barsToWrap is %s', (bars) => {
    const out = drawManualTransitions([rows[0]], {
      pick: always('riser'),
      dropOutBeats: () => 2,
      leadingArmed: false,
      barsToWrap: bars,
      loopBars: 16
    })
    expect(out.get('a')).toEqual({ kind: 'cut', beats: 4 })
  })

  it.each([NaN, 0, -1, Infinity])('cuts a leading gesture when loopBars is %s', (bars) => {
    const out = drawManualTransitions([rows[0]], {
      pick: always('hole'),
      dropOutBeats: () => 2,
      leadingArmed: false,
      barsToWrap: 8,
      loopBars: bars
    })
    expect(out.get('a')).toEqual({ kind: 'cut', beats: 4 })
  })

  it('uses the drop-out beats for a hole', () => {
    const out = drawManualTransitions([rows[0]], {
      pick: always('hole'),
      dropOutBeats: () => 2,
      leadingArmed: false,
      barsToWrap: 8,
      loopBars: 16
    })
    expect(out.get('a')).toEqual({ kind: 'hole', beats: 2 })
  })

  it('cuts a row that cannot lead WITHOUT spending the lap’s leading gesture', () => {
    const out = drawManualTransitions(
      [
        { slotId: 'joining', kinds: ['drums' as const], canLead: false },
        { slotId: 'b', kinds: ['bass' as const] }
      ],
      {
        pick: always('riser'),
        dropOutBeats: () => 2,
        leadingArmed: false,
        barsToWrap: 8,
        loopBars: 16
      }
    )
    expect(out.get('joining')).toEqual({ kind: 'cut', beats: 4 })
    expect(out.get('b')).toEqual({ kind: 'riser', beats: 8 })
  })

  it('treats a row without canLead as able to lead', () => {
    const out = drawManualTransitions([{ slotId: 'a', kinds: ['drums' as const] }], {
      pick: always('riser'),
      dropOutBeats: () => 2,
      leadingArmed: false,
      barsToWrap: 8,
      loopBars: 16
    })
    expect(out.get('a')).toEqual({ kind: 'riser', beats: 8 })
  })

  it('still grants a row that cannot lead its arrival gesture', () => {
    const out = drawManualTransitions(
      [{ slotId: 'a', kinds: ['drums' as const], canLead: false }],
      {
        pick: always('bloom'),
        dropOutBeats: () => 2,
        leadingArmed: false,
        barsToWrap: 8,
        loopBars: 16
      }
    )
    expect(out.get('a')).toEqual({ kind: 'bloom', beats: 4 })
  })

  it('passes a cut straight through', () => {
    const out = drawManualTransitions(rows, {
      pick: always('cut'),
      dropOutBeats: () => 2,
      leadingArmed: false,
      barsToWrap: 8,
      loopBars: 16
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

  it('a manual cut arrival is dropped', () => {
    const manual = new Map([
      ['b', { stem: 'x', joining: false, arrival: { kind: 'cut' as const, beats: 4 } }]
    ])
    expect(mergeStageChanges(null, manual).arrivals).toEqual([])
  })

  it('never carries a manual leading gesture as an arrival', () => {
    const manual = new Map([
      ['b', { stem: 'x', joining: false, arrival: { kind: 'riser' as const, beats: 8 } }]
    ])
    const out = mergeStageChanges(null, manual)
    expect(out.arrivals).toEqual([])
    expect(out.changes).toEqual([{ slotId: 'b', stem: 'x' }])
  })

  it('never carries radio’s leading gesture as an arrival', () => {
    const holeLed = { slotId: 'a', stem: 's', arrival: { kind: 'hole' as const, beats: 2 } }
    const out = mergeStageChanges(holeLed, new Map())
    expect(out.arrivals).toEqual([])
    expect(out.changes).toEqual([{ slotId: 'a', stem: 's' }])
  })

  it('gives all-empty for no radio change and no manual changes', () => {
    expect(mergeStageChanges(null, new Map())).toEqual({ changes: [], joining: [], arrivals: [] })
  })

  it('a change with no arrival carries none', () => {
    const cut = { slotId: 'a', stem: 's', arrival: null }
    expect(mergeStageChanges(cut, new Map()).arrivals).toEqual([])
  })
})

describe('radioGestureBeats', () => {
  it('is the one beats table', () => {
    expect(radioGestureBeats('hole', () => 2)).toBe(2)
    expect(radioGestureBeats('riser', () => 2)).toBe(8)
    expect(radioGestureBeats('bloom', () => 2)).toBe(4)
    expect(radioGestureBeats('cut', () => 2)).toBe(4)
  })
})

describe('mergeStageChanges: the pace slider companions', () => {
  it("ride radio's change as cuts; a manual change on a companion row wins it", () => {
    const led = {
      slotId: 'a',
      stem: 'A',
      arrival: { kind: 'bloom' as RadioTransitionKind, beats: 4 },
      companions: [
        { slotId: 'b', stem: 'B' },
        { slotId: 'c', stem: 'C' }
      ]
    }
    const manual = new Map([['c', { stem: 'C2', joining: false, arrival: null }]])
    expect(mergeStageChanges(led, manual)).toEqual({
      changes: [
        { slotId: 'a', stem: 'A' },
        { slotId: 'b', stem: 'B' },
        { slotId: 'c', stem: 'C2' }
      ],
      joining: [],
      arrivals: [{ slotId: 'a', kind: 'bloom', beats: 4 }]
    })
  })

  it('none, or no radio change, is as before', () => {
    expect(mergeStageChanges(null, new Map()).changes).toEqual([])
    expect(
      mergeStageChanges({ slotId: 'a', stem: 'A', arrival: null, companions: [] }, new Map())
        .changes
    ).toEqual([{ slotId: 'a', stem: 'A' }])
  })

  it('dedupes companions (first wins) and a companion equal to the led row', () => {
    const led = {
      slotId: 'a',
      stem: 'A',
      arrival: null,
      companions: [
        { slotId: 'b', stem: 'B' },
        { slotId: 'b', stem: 'B2' },
        { slotId: 'a', stem: 'A2' }
      ]
    }
    expect(mergeStageChanges(led, new Map()).changes).toEqual([
      { slotId: 'a', stem: 'A' },
      { slotId: 'b', stem: 'B' }
    ])
  })

  it("a manual change on the led row withdraws radio's companions too", () => {
    const led = {
      slotId: 'a',
      stem: 'A',
      arrival: null,
      companions: [{ slotId: 'b', stem: 'B' }]
    }
    const manual = new Map([['a', { stem: 'A2', joining: false, arrival: null }]])
    expect(mergeStageChanges(led, manual).changes).toEqual([{ slotId: 'a', stem: 'A2' }])
  })
})
