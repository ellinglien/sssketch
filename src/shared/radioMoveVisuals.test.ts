// Radio's moves shown while they sound (spec 2026-10-05-radio-move-visuals-design): the shared
// helper against known plan curves, on both radios' clocks (the web's seconds, sssketch's bars).
import { describe, expect, it } from 'vitest'
import {
  RADIO_ROW_VISUAL_REST,
  RADIO_VISUAL_DIM_FLOOR,
  RADIO_VISUAL_ECHO_FLOOR,
  RADIO_VISUAL_STEADY_CUT,
  closeRadioRestVisuals,
  dropRadioMoveVisuals,
  placeRadioRestVisual,
  pruneRadioMoveVisuals,
  radioGestureVisuals,
  radioMoveVisualsSounding,
  radioRestVisual,
  radioRowVisualAt,
  radioRowVisualSteady,
  radioMoveVisualValueAt,
  radioRowVisualVars,
  radioThrowVisual,
  radioTurnaroundVisuals,
  radioVisualBrightness,
  reopenRadioRestVisuals,
  type RadioMoveVisual,
  type RadioRowVisual
} from './radioMoveVisuals'
import {
  TURNAROUND_DEPTH,
  TURNAROUND_DIP_FLOOR,
  TURNAROUND_LIFT_TOP,
  TURNAROUND_WASH_PEAK,
  rollTurnaround,
  turnaroundDipCurve,
  turnaroundDropCurve,
  turnaroundLiftCurve,
  turnaroundWashCurve,
  type TurnaroundPlan,
  type TurnaroundPoint,
  type TurnaroundRow
} from './radioTurnaround'

// sssketch's clock: bars played since radio started; one beat is a quarter bar
const BARS = { unitsPerBeat: 0.25 }
// the web's: AudioContext seconds at 120 bpm, half a second a beat
const SEC = { unitsPerBeat: 0.5 }
const at = (
  v: readonly RadioMoveVisual[],
  row: string | null,
  t: number,
  fade = 0
): RadioRowVisual => radioRowVisualAt(v, row, t, fade)

describe('a drop (drums out, low out, stop)', () => {
  // an 8-bar loop, drums out for the last 4 beats, ending on the wrap at bar 64
  const plan: TurnaroundPlan = {
    move: 'drum drop',
    beats: 4,
    halvings: 0,
    rows: [{ rowId: 'drums', volume: turnaroundDropCurve(8, 4) }]
  }
  const v = radioTurnaroundVisuals(plan, { wrapAt: 64, loopBars: 8, key: 'ta', ...BARS })

  it('is level 1 before, 0 while it sounds, and 1 on the one', () => {
    expect(at(v, 'drums', 62).level).toBe(1)
    expect(at(v, 'drums', 63).level).toBe(1) // the drop leaves at bar 63
    expect(at(v, 'drums', 63.5).level).toBe(0)
    expect(at(v, 'drums', 63.999).level).toBe(0)
    expect(at(v, 'drums', 64).level).toBe(1)
    expect(at(v, 'drums', 65).level).toBe(1)
  })

  it('touches no other row', () => {
    expect(at(v, 'bass', 63.5)).toEqual(RADIO_ROW_VISUAL_REST)
    expect(at(v, null, 63.5)).toEqual(RADIO_ROW_VISUAL_REST)
  })

  it('dims over the fade (never quicker), and is back on the one at once', () => {
    // the drop's own ramp is 0.02 bars; a 0.05-bar fade (0.1 s at 120 bpm) stretches it
    const fade = 0.05
    expect(at(v, 'drums', 63.025, fade).level).toBeCloseTo(0.5, 6)
    expect(at(v, 'drums', 63.05, fade).level).toBe(0)
    expect(at(v, 'drums', 63.999, fade).level).toBe(0)
    expect(at(v, 'drums', 64, fade).level).toBe(1)
  })

  it('lands on the web clock the same way (seconds before the wrap)', () => {
    const w = radioTurnaroundVisuals(plan, { wrapAt: 100, loopBars: 8, key: 'ta', ...SEC })
    expect(at(w, 'drums', 97.9).level).toBe(1) // leaves 2 s (4 beats) before
    expect(at(w, 'drums', 99).level).toBe(0)
    expect(at(w, 'drums', 100).level).toBe(1)
  })
})

describe('lift and dip', () => {
  const plan: TurnaroundPlan = {
    move: 'lift',
    beats: 8,
    halvings: 0,
    rows: [
      { rowId: 'pad', filter: turnaroundLiftCurve(8) },
      { rowId: 'lead', filter: turnaroundDipCurve(8) }
    ]
  }
  const v = radioTurnaroundVisuals(plan, { wrapAt: 32, loopBars: 8, key: 'ta', ...BARS })

  it('a lift thins the low end with the high-pass: 0 at its start, half way, all of it into the one', () => {
    expect(at(v, 'pad', 30).lowCut).toBe(0)
    expect(at(v, 'pad', 31).lowCut).toBeCloseTo(0.5, 9)
    expect(at(v, 'pad', 31.999).lowCut).toBeCloseTo(1, 2)
    expect(at(v, 'pad', 32).lowCut).toBe(0)
    expect(at(v, 'pad', 31).highCut).toBe(0)
    expect(at(v, 'pad', 31).level).toBe(1)
  })

  it('a dip thins the top with the low-pass, the same way', () => {
    expect(at(v, 'lead', 30).highCut).toBe(0)
    expect(at(v, 'lead', 31).highCut).toBeCloseTo(0.5, 9)
    expect(at(v, 'lead', 31.999).highCut).toBeCloseTo(1, 2)
    expect(at(v, 'lead', 32).highCut).toBe(0)
    expect(at(v, 'lead', 31).lowCut).toBe(0)
  })

  it('a subtle lift or dip thins less', () => {
    const subtle = radioTurnaroundVisuals(
      {
        ...plan,
        rows: [
          { rowId: 'pad', filter: turnaroundLiftCurve(8, 0.35) },
          { rowId: 'lead', filter: turnaroundDipCurve(8, 0.6) }
        ]
      },
      { wrapAt: 32, loopBars: 8, key: 'ta', ...BARS }
    )
    expect(at(subtle, 'pad', 31.999).lowCut).toBeCloseTo(0.35 / TURNAROUND_LIFT_TOP, 2)
    expect(at(subtle, 'lead', 31.999).highCut).toBeCloseTo(0.4 / (1 - TURNAROUND_DIP_FLOOR), 2)
  })
})

describe('the wash', () => {
  it('grows to its peak into the one, and clears on it', () => {
    const plan: TurnaroundPlan = {
      move: 'wash',
      beats: 8,
      halvings: 0,
      rows: [{ rowId: 'pad', reverbSend: turnaroundWashCurve(8) }]
    }
    const v = radioTurnaroundVisuals(plan, { wrapAt: 32, loopBars: 8, key: 'ta', ...BARS })
    expect(at(v, 'pad', 30).wash).toBe(0)
    expect(at(v, 'pad', 31).wash).toBeCloseTo(0.5, 9)
    expect(at(v, 'pad', 31.999).wash).toBeCloseTo(1, 2)
    expect(at(v, 'pad', 32).wash).toBe(0)
  })

  it('held from the gap: the peak where the row goes silent, held to the one', () => {
    // materialize's holdFrom: a wash on a gapped row peaks at the gap's start (2 beats out)
    const plan: TurnaroundPlan = {
      move: 'riser',
      beats: 8,
      halvings: 0,
      gapBeats: 2,
      riserBars: 1.5,
      rows: [
        {
          rowId: 'pad',
          reverbSend: {
            peak: 0.85,
            points: [
              { beats: 8, value: 0 },
              { beats: 2, value: 1 },
              { beats: 0, value: 1 },
              { beats: 0, value: 0 }
            ]
          },
          volume: turnaroundDropCurve(8, 2)
        }
      ],
      parts: [
        { move: 'riser', beats: 8, rowIds: [] },
        { move: 'wash', beats: 8, rowIds: ['pad'] }
      ]
    }
    const v = radioTurnaroundVisuals(plan, { wrapAt: 32, loopBars: 8, key: 'ta', ...BARS })
    expect(at(v, 'pad', 31.5).wash).toBeCloseTo(1, 9) // the gap's start
    expect(at(v, 'pad', 31.9).wash).toBe(1)
    expect(at(v, 'pad', 31.9).level).toBe(0) // silent in the gap, still washed
    expect(at(v, 'pad', 32)).toEqual(RADIO_ROW_VISUAL_REST)
  })
})

describe('a riser into a gap', () => {
  // riser + drums out, a 2-beat gap: the riser sounds 1.5 bars and stops where the gap starts;
  // every row but the keeper is silent through the gap
  const plan: TurnaroundPlan = {
    move: 'riser',
    beats: 8,
    halvings: 0,
    riserBars: 1.5,
    gapBeats: 2,
    keeperId: 'pad',
    rows: [
      { rowId: 'drums', volume: turnaroundDropCurve(8, 4) },
      { rowId: 'bass', volume: turnaroundDropCurve(8, 2) }
    ],
    parts: [
      { move: 'riser', beats: 8, rowIds: [] },
      { move: 'drum drop', beats: 4, rowIds: ['drums'] }
    ]
  }
  const v = radioTurnaroundVisuals(plan, {
    wrapAt: 32,
    loopBars: 8,
    key: 'ta',
    lateRowIds: ['late'],
    ...BARS
  })

  it('draws the riser on the mix, from its start to the gap', () => {
    expect(at(v, null, 29.9).riser).toBe(0)
    expect(at(v, null, 30).riser).toBe(0) // starts 2 bars out
    expect(at(v, null, 30.75).riser).toBeCloseTo(0.5, 9)
    expect(at(v, null, 31.499).riser).toBeCloseTo(1, 2)
    expect(at(v, null, 31.5).riser).toBe(0) // the gap
    expect(at(v, 'drums', 30.75).riser).toBe(0) // never on a row
  })

  it('dims every silenced row through the gap, the keeper heard, and the one brings all back', () => {
    for (const row of ['drums', 'bass', 'late']) expect(at(v, row, 31.75).level).toBe(0)
    expect(at(v, 'pad', 31.75).level).toBe(1)
    for (const row of ['drums', 'bass', 'late', 'pad']) expect(at(v, row, 32).level).toBe(1)
    expect(at(v, 'drums', 31.25).level).toBe(0) // its own longer drop
    expect(at(v, 'bass', 31.25).level).toBe(1)
  })
})

describe('gestures', () => {
  const lap = { loopBars: 8, unitsPerBar: 1 }
  const base = { rowId: 'r1', wrapAt: 64, before: lap, after: lap, key: 'r1@64' }

  it('a cut is nothing', () => {
    expect(radioGestureVisuals({ ...base, kind: 'cut', beats: 0 })).toEqual([])
  })

  it('a hole dims the outgoing row into the wrap; the new stem is full on it', () => {
    const v = radioGestureVisuals({ ...base, kind: 'hole', beats: 8 })
    expect(at(v, 'r1', 61.9).level).toBe(1)
    expect(at(v, 'r1', 63).level).toBe(0)
    expect(at(v, 'r1', 64).level).toBe(1)
  })

  it('the arc exit drop-out the same, on the row leaving', () => {
    const v = radioGestureVisuals({ ...base, kind: 'drop-out', beats: 8 })
    expect(v[0].move).toBe('drop-out')
    expect(at(v, 'r1', 63).level).toBe(0)
  })

  it('a filter in arrives closed and opens over its beats', () => {
    const v = radioGestureVisuals({ ...base, kind: 'filter in', beats: 4 })
    expect(at(v, 'r1', 63.9).highCut).toBe(0)
    expect(at(v, 'r1', 64).highCut).toBe(1) // stacked, no fade: closed on the wrap
    expect(at(v, 'r1', 64.05, 0.05).highCut).toBe(1) // with the fade, closed once it has faded in
    expect(at(v, 'r1', 64.5).highCut).toBeCloseTo(0.5 / (1 - TURNAROUND_DIP_FLOOR), 9)
    expect(at(v, 'r1', 65).highCut).toBe(0)
  })

  it('a bloom arrives washed and clears', () => {
    const v = radioGestureVisuals({ ...base, kind: 'bloom', beats: 4 })
    expect(at(v, 'r1', 64).wash).toBe(1)
    expect(at(v, 'r1', 64.5).wash).toBeCloseTo(0.5, 9)
    expect(at(v, 'r1', 65).wash).toBe(0)
  })

  it('a duck dips every other row for its beats, not the arriving one', () => {
    const v = radioGestureVisuals({ ...base, kind: 'duck', beats: 4, duckRowIds: ['r2', 'r3'] })
    expect(at(v, 'r1', 64).level).toBe(1)
    expect(at(v, 'r2', 64).level).toBeCloseTo(0.45, 9)
    expect(at(v, 'r3', 64.5).level).toBeCloseTo(0.725, 9)
    expect(at(v, 'r2', 65).level).toBe(1)
  })

  it("a change's riser is drawn on the row it announces, ending on the wrap", () => {
    const v = radioGestureVisuals({ ...base, kind: 'riser', beats: 8 })
    expect(at(v, 'r1', 61.9).riser).toBe(0)
    expect(at(v, 'r1', 63).riser).toBeCloseTo(0.5, 9)
    expect(at(v, 'r1', 64).riser).toBe(0)
    expect(at(v, null, 63).riser).toBe(0)
  })

  it('a lead-in measures in the lap before the wrap, an arrival in the lap after (a tempo change on the wrap)', () => {
    const v = radioGestureVisuals({
      ...base,
      kind: 'hole',
      beats: 4,
      wrapAt: 100,
      before: { loopBars: 4, unitsPerBar: 2 },
      after: { loopBars: 4, unitsPerBar: 1.5 }
    })
    expect(at(v, 'r1', 97.9).level).toBe(1)
    expect(at(v, 'r1', 99).level).toBe(0)
    const d = radioGestureVisuals({
      ...base,
      kind: 'duck',
      beats: 4,
      wrapAt: 100,
      duckRowIds: ['r2'],
      before: { loopBars: 4, unitsPerBar: 2 },
      after: { loopBars: 4, unitsPerBar: 1.5 }
    })
    expect(at(d, 'r2', 101.5).level).toBe(1) // one bar of 1.5 s after the wrap
  })
})

describe('a throw', () => {
  // 120 bpm on the web: a quarter-note echo (0.5 s), the send open a beat, feedback 0.5
  const v = radioThrowVisual({
    rowId: 'pad',
    at: 10,
    open: 0.5,
    delay: 0.5,
    feedback: 0.5,
    shiftBars: 0.25,
    key: 'throw@10'
  })!

  it('ghosts the row from its first repeat, fading with each one, and trails it by a delay', () => {
    expect(at([v], 'pad', 10.4).ghost).toBe(0)
    expect(at([v], 'pad', 10.6).ghost).toBe(1)
    expect(at([v], 'pad', 10.6).ghostShiftBars).toBe(0.25)
    expect(at([v], 'pad', 11.5).ghost).toBeCloseTo(0.5, 9)
    expect(at([v], 'pad', 12).ghost).toBeCloseTo(0.25, 9)
    expect(at([v], 'pad', 30).ghost).toBe(0)
    expect(at([v], 'pad', 10.6).level).toBe(1) // never dims the row
  })

  it('ends once a repeat is under the floor', () => {
    const last = v.points[v.points.length - 1]
    expect(last.value).toBe(0)
    expect(v.points[v.points.length - 2].value).toBeGreaterThanOrEqual(RADIO_VISUAL_ECHO_FLOOR)
  })

  it('is nothing for a throw that cannot echo', () => {
    expect(
      radioThrowVisual({
        rowId: 'p',
        at: 0,
        open: 0,
        delay: 1,
        feedback: 0.5,
        shiftBars: 0,
        key: 'k'
      })
    ).toBeNull()
    expect(
      radioThrowVisual({
        rowId: 'p',
        at: 0,
        open: 1,
        delay: 1,
        feedback: 1,
        shiftBars: 0,
        key: 'k'
      })
    ).toBeNull()
  })
})

describe('rests: hooks and the intensity arc, with the drop', () => {
  // the breakdown rests drums and bass from bar 32; a hook rests the lead from 40; the drop at
  // bar 64 brings drums and bass back under a riser and a gap that silences pad (no keeper)
  const drop: TurnaroundPlan = {
    move: 'riser',
    beats: 16,
    halvings: 0,
    riserBars: 3.5,
    gapBeats: 2,
    rows: [{ rowId: 'pad', volume: turnaroundDropCurve(8, 2) }],
    parts: [{ move: 'riser', beats: 16, rowIds: [] }]
  }
  const open = [
    radioRestVisual({ rowId: 'drums', from: 32, until: null, key: 'arc@32' }),
    radioRestVisual({ rowId: 'bass', from: 32, until: null, key: 'arc@32' }),
    radioRestVisual({ rowId: 'lead', from: 40, until: null, key: 'lead@40' })
  ]

  it('a rest dims its row from its line, and holds while it is open', () => {
    expect(at(open, 'drums', 31.9).level).toBe(1)
    expect(at(open, 'drums', 32).level).toBe(0)
    expect(at(open, 'drums', 500).level).toBe(0)
    expect(at(open, 'lead', 39).level).toBe(1)
    expect(radioMoveVisualsSounding(open, 500)).toBe(true)
  })

  it('fades in over the fade', () => {
    expect(at(open, 'drums', 32.025, 0.05).level).toBeCloseTo(0.5, 9)
    expect(at(open, 'drums', 32.05, 0.05).level).toBe(0)
  })

  it('the drop: the rests close on its one, the gap dims the rest, and the one brings everything back at once', () => {
    let v = closeRadioRestVisuals(open, 'drums', 64)
    v = closeRadioRestVisuals(v, 'bass', 64)
    v = [...v, ...radioTurnaroundVisuals(drop, { wrapAt: 64, loopBars: 8, key: 'ta@64', ...BARS })]
    expect(at(v, 'drums', 63.9).level).toBe(0)
    expect(at(v, 'bass', 63.9).level).toBe(0)
    expect(at(v, 'pad', 63.9).level).toBe(0) // the gap
    expect(at(v, 'pad', 63).level).toBe(1)
    expect(at(v, null, 62).riser).toBeGreaterThan(0)
    for (const row of ['drums', 'bass', 'pad']) expect(at(v, row, 64).level).toBe(1)
    expect(at(v, 'lead', 64).level).toBe(0) // the hook's rest is its own
  })

  it('a duck on a resting row multiplies: still silent', () => {
    const v = [
      ...open,
      ...radioGestureVisuals({
        kind: 'duck',
        rowId: 'pad',
        beats: 4,
        wrapAt: 48,
        before: { loopBars: 8, unitsPerBar: 1 },
        after: { loopBars: 8, unitsPerBar: 1 },
        duckRowIds: ['drums', 'lead'],
        key: 'pad@48'
      })
    ]
    expect(at(v, 'drums', 48).level).toBe(0)
  })

  it('a return taken back opens the rest again', () => {
    const closed = closeRadioRestVisuals(open, 'lead', 56)
    expect(at(closed, 'lead', 57).level).toBe(1)
    const again = reopenRadioRestVisuals(closed, 'lead', 56)
    expect(at(again, 'lead', 57).level).toBe(0)
    expect(again).toEqual(open)
  })

  it('a rest closed where it began is gone', () => {
    expect(closeRadioRestVisuals(open, 'lead', 40).filter((v) => v.rowId === 'lead')).toEqual([])
  })

  it('a closed rest from the start: silent between, heard after', () => {
    const v = [radioRestVisual({ rowId: 'r', from: 8, until: 16, key: 'k' })]
    expect(at(v, 'r', 12).level).toBe(0)
    expect(at(v, 'r', 16).level).toBe(1)
  })
})

describe('the log', () => {
  const plan: TurnaroundPlan = {
    move: 'drum drop',
    beats: 4,
    halvings: 0,
    rows: [{ rowId: 'drums', volume: turnaroundDropCurve(8, 4) }]
  }
  const ta = radioTurnaroundVisuals(plan, { wrapAt: 64, loopBars: 8, key: 'ta@64', ...BARS })
  const rest = radioRestVisual({ rowId: 'lead', from: 40, until: null, key: 'rest@lead' })

  it('a take-back drops its key', () => {
    expect(dropRadioMoveVisuals([...ta, rest], 'ta@64')).toEqual([rest])
  })

  it('prunes what is over, keeps what is to come and what holds', () => {
    expect(pruneRadioMoveVisuals([...ta, rest], 64.5)).toEqual([rest])
    expect(pruneRadioMoveVisuals([...ta, rest], 50)).toEqual([...ta, rest])
  })

  it('given the live keys: a move whose key is gone goes, sounding or not; an echo already ringing rings on', () => {
    const none = new Set<string>()
    expect(pruneRadioMoveVisuals([...ta, rest], 50, none)).toEqual([])
    expect(pruneRadioMoveVisuals([...ta, rest], 63.5, none)).toEqual([])
    expect(pruneRadioMoveVisuals([...ta, rest], 63.5, new Set(['rest@lead']))).toEqual([rest])
    const echo = radioThrowVisual({
      rowId: 'pad',
      at: 60,
      open: 0.25,
      delay: 0.1875,
      feedback: 0.5,
      shiftBars: 0.1875,
      key: 'throw@60'
    })!
    expect(pruneRadioMoveVisuals([echo], 60.1, none)).toEqual([]) // withdrawn before it rang
    expect(pruneRadioMoveVisuals([echo], 60.5, none)).toEqual([echo])
    expect(pruneRadioMoveVisuals([echo], 70, none)).toEqual([])
  })

  it("is sounding only between a move's first and last points", () => {
    expect(radioMoveVisualsSounding(ta, 62)).toBe(false) // the drop's first point is at 63
    expect(radioMoveVisualsSounding(ta, 63.5)).toBe(true)
    expect(radioMoveVisualsSounding(ta, 64)).toBe(false)
    expect(radioMoveVisualsSounding([], 1)).toBe(false)
  })
})

describe('drawing it', () => {
  it('brightness: the floor when silent, full when heard', () => {
    expect(radioVisualBrightness(0)).toBe(RADIO_VISUAL_DIM_FLOOR)
    expect(radioVisualBrightness(1)).toBe(1)
    expect(radioVisualBrightness(0.45)).toBeCloseTo(0.5875, 9)
  })

  it('the CSS custom properties, the ghost trailing by a share of the window', () => {
    expect(
      radioRowVisualVars(
        {
          level: 0,
          lowCut: 0.5,
          highCut: 0,
          wash: 0.25,
          riser: 1,
          ghost: 0.5,
          ghostShiftBars: 0.25
        },
        { windowBars: 32 }
      )
    ).toEqual({
      '--mv-bright': '0.250',
      '--mv-low': '0.500',
      '--mv-high': '0.000',
      '--mv-wash': '0.250',
      '--mv-riser': '1.000',
      '--mv-ghost': '0.500',
      '--mv-ghost-shift': '0.78%'
    })
    expect(radioRowVisualVars(RADIO_ROW_VISUAL_REST)['--mv-bright']).toBe('1.000')
  })

  it('reduced motion: steady states, no sweeps or glows', () => {
    const v = {
      level: 0.3,
      lowCut: 0.1,
      highCut: 0,
      wash: 0.8,
      riser: 0.5,
      ghost: 1,
      ghostShiftBars: 1
    }
    expect(radioRowVisualSteady(v)).toEqual({
      level: 0,
      lowCut: RADIO_VISUAL_STEADY_CUT,
      highCut: 0,
      wash: 0,
      riser: 0,
      ghost: 0,
      ghostShiftBars: 0
    })
    expect(radioRowVisualSteady({ ...RADIO_ROW_VISUAL_REST })).toEqual(RADIO_ROW_VISUAL_REST)
    const vars = radioRowVisualVars(v, { reducedMotion: true, windowBars: 32 })
    expect(vars['--mv-bright']).toBe('0.250')
    expect(vars['--mv-wash']).toBe('0.000')
    expect(vars['--mv-riser']).toBe('0.000')
    expect(vars['--mv-ghost']).toBe('0.000')
  })
})

describe('review minors', () => {
  it('a point that is not a number leaves the row at rest, not silent', () => {
    const v: RadioMoveVisual = {
      key: 'k',
      rowId: 'r',
      param: 'volume',
      move: 'drop',
      points: [
        { at: 0, value: 1 },
        { at: 1, value: Number.NaN },
        { at: 2, value: 1 }
      ]
    }
    expect(radioMoveVisualValueAt(v, 0.5)).toBe(1)
    expect(radioMoveVisualValueAt(v, 1.5)).toBe(1)
    expect(at([v], 'r', 0.5).level).toBe(1)
    const held: RadioMoveVisual = { ...v, points: [{ at: 0, value: Number.NaN }], holds: true }
    expect(radioMoveVisualValueAt(held, 5)).toBe(1)
    const wash: RadioMoveVisual = { ...v, param: 'wash', move: 'wash' }
    expect(radioMoveVisualValueAt(wash, 0.5)).toBe(0)
  })

  it('reopening leaves a rest logged closed from the start alone (only a closed-open one opens)', () => {
    const fixed = radioRestVisual({ rowId: 'r', from: 8, until: 16, key: 'k' })
    expect(reopenRadioRestVisuals([fixed], 'r', 16)).toEqual([fixed])
    const open = radioRestVisual({ rowId: 'r', from: 8, until: null, key: 'k' })
    const closed = closeRadioRestVisuals([open], 'r', 16)
    expect(closed[0].closed).toBe(true)
    expect(reopenRadioRestVisuals(closed, 'r', 16)).toEqual([open])
    expect(reopenRadioRestVisuals(closed, 'r', 12)).toEqual(closed) // closed elsewhere
  })

  it('a wash is drawn at its depth: subtle less washed than bold', () => {
    const wash = (peak: number): RadioMoveVisual[] =>
      radioTurnaroundVisuals(
        {
          move: 'wash',
          beats: 4,
          halvings: 0,
          rows: [{ rowId: 'pad', reverbSend: turnaroundWashCurve(4, peak) }]
        },
        { wrapAt: 32, loopBars: 8, key: 'ta', ...BARS }
      )
    const bold = wash(TURNAROUND_DEPTH.bold.washPeak)
    const subtle = wash(TURNAROUND_DEPTH.subtle.washPeak)
    expect(at(bold, 'pad', 31.999).wash).toBeCloseTo(1, 2)
    expect(at(subtle, 'pad', 31.999).wash).toBeCloseTo(
      TURNAROUND_DEPTH.subtle.washPeak / TURNAROUND_WASH_PEAK,
      2
    )
    expect(at(subtle, 'pad', 31.5).wash).toBeCloseTo(
      (0.5 * TURNAROUND_DEPTH.subtle.washPeak) / TURNAROUND_WASH_PEAK,
      9
    )
    expect(at(subtle, 'pad', 32).wash).toBe(0)
  })

  it('two volume moves on one row multiply, each on its own span', () => {
    // a half-level duck over bars 2..4 and a drop to 0.5 over bars 3..5
    const duck: RadioMoveVisual = {
      key: 'a',
      rowId: 'r',
      param: 'volume',
      move: 'duck',
      points: [
        { at: 2, value: 0.5 },
        { at: 4, value: 0.5 }
      ]
    }
    const drop: RadioMoveVisual = {
      key: 'b',
      rowId: 'r',
      param: 'volume',
      move: 'drop',
      points: [
        { at: 3, value: 0.5 },
        { at: 5, value: 0.5 }
      ]
    }
    const v = [duck, drop]
    expect(at(v, 'r', 1).level).toBe(1)
    expect(at(v, 'r', 2.5).level).toBe(0.5)
    expect(at(v, 'r', 3.5).level).toBe(0.25)
    expect(at(v, 'r', 4.5).level).toBe(0.5)
    expect(at(v, 'r', 5).level).toBe(1)
    // a gesture's duck and a turnaround's drop, from their own builders, on one row
    const built = [
      ...radioGestureVisuals({
        kind: 'duck',
        rowId: 'new',
        beats: 4,
        wrapAt: 56,
        before: { loopBars: 8, unitsPerBar: 1 },
        after: { loopBars: 8, unitsPerBar: 1 },
        duckRowIds: ['drums'],
        key: 'new@56'
      }),
      ...radioTurnaroundVisuals(
        {
          move: 'drum drop',
          beats: 4,
          halvings: 0,
          rows: [{ rowId: 'drums', volume: turnaroundDropCurve(8, 4) }]
        },
        { wrapAt: 64, loopBars: 8, key: 'ta@64', ...BARS }
      )
    ]
    const duckOnly = radioMoveVisualValueAt(built[0], 56.5)
    expect(duckOnly).toBeLessThan(1)
    expect(at(built, 'drums', 56.5).level).toBeCloseTo(duckOnly, 9)
    expect(at(built, 'drums', 63.5).level).toBe(0)
    expect(at(built, 'drums', 64).level).toBe(1)
  })
})

describe("the planner's own combined turnaround (rollTurnaround, combine on)", () => {
  /** mulberry32: the same run every time. */
  const mulberry32 = (seed: number): (() => number) => {
    let a = seed >>> 0
    return (): number => {
      a = (a + 0x6d2b79f5) >>> 0
      let t = a
      t = Math.imul(t ^ (t >>> 15), t | 1)
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }
  const row = (id: string, kind: TurnaroundRow['kinds'][number]): TurnaroundRow => ({
    id,
    kinds: [kind],
    hooked: false,
    audible: true,
    inFilterIn: false,
    barLength: 4
  })
  const bed = [row('d', 'drums'), row('b', 'bass'), row('l', 'lead'), row('w', 'warm')]
  // the first seeded riser turn that layers a move with volume and leaves a gap
  let plan: TurnaroundPlan | null = null
  for (let seed = 1; seed < 2000 && plan === null; seed++) {
    const p = rollTurnaround({
      rate: 'often',
      random: mulberry32(seed),
      loopBars: 8,
      lastPhrase: null,
      rows: bed,
      arc: 'steady',
      leavingRowId: null,
      combine: true,
      depth: 'bold',
      force: { move: 'riser' }
    })
    if (
      p !== null &&
      (p.parts?.length ?? 0) > 1 &&
      (p.gapBeats ?? 0) > 0 &&
      p.riserBars !== undefined &&
      p.rows.some((r) => r.volume !== undefined) &&
      p.rows.some((r) => r.filter !== undefined || r.reverbSend !== undefined)
    ) {
      plan = p
    }
  }
  const WRAP = 64
  const UPB = BARS.unitsPerBeat

  /** A plan curve (beats before the wrap) at `t`, off its breakpoints: linear, rest outside. */
  const curveAt = (pts: readonly TurnaroundPoint[], t: number, rest: number): number => {
    const b = (WRAP - t) / UPB
    if (pts.length === 0 || b > pts[0].beats || b < pts[pts.length - 1].beats) return rest
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i - 1]
      const q = pts[i]
      if (b <= p.beats && b > q.beats) {
        return p.value + ((q.value - p.value) * (p.beats - b)) / (p.beats - q.beats)
      }
    }
    return rest
  }

  it('the roll gives one (a riser leading layered moves, with a gap)', () => {
    expect(plan).not.toBeNull()
  })

  it("every row's look follows its merged curves, the riser stops at the gap, the one brings all back", () => {
    const p = plan!
    const v = radioTurnaroundVisuals(p, { wrapAt: WRAP, loopBars: 8, key: 'ta', ...BARS })
    const beats = Math.max(p.beats, ...p.rows.flatMap((r) => r.volume?.map((x) => x.beats) ?? []))
    let checked = 0
    for (const r of p.rows) {
      // every breakpoint, sampled between them (a step's two sides differ only on it)
      const bps = [
        ...(r.volume ?? []),
        ...(r.filter?.cutoff ?? []),
        ...(r.reverbSend?.points ?? [])
      ].map((x) => WRAP - x.beats * UPB)
      const ts = [...new Set([WRAP - beats * UPB - 1, ...bps, WRAP])].sort((a, b) => a - b)
      for (let i = 1; i < ts.length; i++) {
        for (const f of [0.25, 0.5, 0.75]) {
          const t = ts[i - 1] + (ts[i] - ts[i - 1]) * f
          const look = at(v, r.rowId, t)
          expect(look.level).toBeCloseTo(r.volume ? curveAt(r.volume, t, 1) : 1, 9)
          if (r.filter?.mode === 'highpass')
            expect(look.lowCut).toBeCloseTo(curveAt(r.filter.cutoff, t, 0) / TURNAROUND_LIFT_TOP, 9)
          if (r.filter?.mode === 'lowpass')
            expect(look.highCut).toBeCloseTo(
              (1 - curveAt(r.filter.cutoff, t, 1)) / (1 - TURNAROUND_DIP_FLOOR),
              9
            )
          if (r.reverbSend)
            expect(look.wash).toBeCloseTo(
              (curveAt(r.reverbSend.points, t, 0) * r.reverbSend.peak) / TURNAROUND_WASH_PEAK,
              9
            )
          checked++
        }
      }
      expect(at(v, r.rowId, WRAP)).toEqual(RADIO_ROW_VISUAL_REST)
    }
    expect(checked).toBeGreaterThan(0)
    const gapStart = WRAP - p.gapBeats! * UPB
    expect(at(v, null, gapStart - 0.01).riser).toBeGreaterThan(0.9)
    expect(at(v, null, gapStart).riser).toBe(0)
    expect(at(v, null, WRAP)).toEqual(RADIO_ROW_VISUAL_REST)
    // through the gap only the keeper (if any) is heard
    for (const r of p.rows) {
      if (r.rowId === p.keeperId) continue
      expect(at(v, r.rowId, WRAP - 0.01).level).toBe(0)
    }
  })
})

describe('as the runtime laid it down (plan Task 6 note: only what plays)', () => {
  // a combined lift with a drop: pad and lead lifted, drums dropped, the bass washed
  const plan: TurnaroundPlan = {
    move: 'lift',
    beats: 8,
    halvings: 0,
    rows: [
      { rowId: 'pad', filter: turnaroundLiftCurve(8) },
      { rowId: 'lead', filter: turnaroundLiftCurve(8), volume: turnaroundDropCurve(8, 4) },
      { rowId: 'drums', volume: turnaroundDropCurve(8, 4) },
      { rowId: 'bass', reverbSend: turnaroundWashCurve(8) }
    ]
  }
  const base = { wrapAt: 32, loopBars: 8, key: 'ta', ...BARS }

  it('a row whose filter the lane build skipped (a change filter in had it) shows no lift, its volume still', () => {
    const v = radioTurnaroundVisuals(plan, { ...base, filterSkippedRowIds: ['lead'] })
    expect(at(v, 'lead', 31.5).lowCut).toBe(0)
    expect(at(v, 'lead', 31.5).level).toBe(0)
    expect(at(v, 'pad', 31).lowCut).toBeCloseTo(0.5, 9)
    expect(v.some((x) => x.rowId === 'lead' && x.param === 'highpass')).toBe(false)
  })

  it('a lone lift with every row skipped lays down nothing, and shows nothing', () => {
    const lone: TurnaroundPlan = {
      move: 'lift',
      beats: 8,
      halvings: 0,
      rows: [
        { rowId: 'pad', filter: turnaroundLiftCurve(8) },
        { rowId: 'lead', filter: turnaroundLiftCurve(8) }
      ]
    }
    expect(radioTurnaroundVisuals(lone, { ...base, filterSkippedRowIds: ['pad', 'lead'] })).toEqual(
      []
    )
  })

  it('a plan row the runtime does not play (not in the mix) shows nothing; the rest as before', () => {
    const v = radioTurnaroundVisuals(plan, { ...base, heardRowIds: ['pad', 'bass'] })
    expect(v.some((x) => x.rowId === 'drums' || x.rowId === 'lead')).toBe(false)
    expect(at(v, 'pad', 31).lowCut).toBeCloseTo(0.5, 9)
    expect(at(v, 'bass', 31.99).wash).toBeGreaterThan(0)
  })

  it('without either, every row as planned (the web, unchanged)', () => {
    const all = radioTurnaroundVisuals(plan, base)
    expect(radioTurnaroundVisuals(plan, { ...base, heardRowIds: undefined })).toEqual(all)
    expect(new Set(all.map((x) => x.rowId))).toEqual(new Set(['pad', 'lead', 'drums', 'bass']))
  })
})

describe('a row ducks once at a wrap (review of 1a060a2f, minor 4)', () => {
  const lap = { loopBars: 8, unitsPerBar: 1 }
  const duck = (slot: string, wrapAt: number, beats = 4): RadioMoveVisual[] =>
    radioGestureVisuals({
      kind: 'duck',
      rowId: slot,
      beats,
      wrapAt,
      before: lap,
      after: lap,
      duckRowIds: ['drums', 'pad'].filter((id) => id !== slot),
      key: `${slot}@${wrapAt}`
    })

  it('two ducks landing at one wrap are one dip, not a deeper one (as the lane build ducks a stem once)', () => {
    const one = duck('a', 64)
    const two = [...one, ...duck('b', 64)]
    for (const t of [64, 64.25, 64.5, 64.9, 65]) {
      expect(at(two, 'drums', t).level).toBeCloseTo(at(one, 'drums', t).level, 9)
    }
    expect(at(two, 'drums', 64).level).toBeCloseTo(0.45, 9)
  })

  it('the first logged duck is the dip (the lane build keeps the first)', () => {
    const v = [...duck('a', 64, 4), ...duck('b', 64, 2)]
    for (const t of [64, 64.25, 64.75]) {
      expect(at(v, 'drums', t).level).toBeCloseTo(at(duck('a', 64, 4), 'drums', t).level, 9)
    }
    expect(at(v, 'drums', 64.75).level).toBeLessThan(1)
  })

  it('ducks at different wraps each dip, and a duck still multiplies with a drop', () => {
    const v = [...duck('a', 64), ...duck('b', 72)]
    expect(at(v, 'drums', 64).level).toBeCloseTo(0.45, 9)
    expect(at(v, 'drums', 72).level).toBeCloseTo(0.45, 9)
    const drop: RadioMoveVisual = {
      key: 'ta',
      rowId: 'drums',
      param: 'volume',
      move: 'drop',
      points: [
        { at: 64, value: 0.5 },
        { at: 65, value: 0.5 }
      ]
    }
    expect(at([...v, ...duck('c', 64), drop], 'drums', 64).level).toBeCloseTo(0.225, 9)
  })
})

describe('a rest placed where it lands, each tick until it does (review of 1a060a2f, minor 5)', () => {
  const other = radioRestVisual({ rowId: 'pad', from: 8, until: null, key: 'rest@pad' })
  const place = (
    v: readonly RadioMoveVisual[],
    landed: boolean,
    now: number,
    wrapAt: number
  ): RadioMoveVisual[] =>
    placeRadioRestVisual(v, { rowId: 'drums', key: 'rest@drums', landed, now, wrapAt })

  it('a decided rest is placed on the coming wrap; the row is heard until it', () => {
    const v = place([other], false, 12, 16)
    expect(at(v, 'drums', 15.9).level).toBe(1)
    expect(at(v, 'drums', 16).level).toBe(0)
    expect(at(v, 'pad', 12).level).toBe(0) // another row's rest untouched
  })

  it('one that slips a wrap is placed again on the next: heard through the lap it did not land on', () => {
    let v = place([other], false, 12, 16)
    v = place(v, false, 16.05, 24) // the wrap at 16 passed, the rest still decided
    expect(at(v, 'drums', 16.5).level).toBe(1)
    expect(at(v, 'drums', 23.9).level).toBe(1)
    expect(at(v, 'drums', 24).level).toBe(0)
    expect(v.filter((x) => x.key === 'rest@drums')).toHaveLength(1)
  })

  it('landed where it was placed: kept as it is (its fade, a close)', () => {
    const placed = place([other], false, 12, 16)
    expect(place(placed, true, 16.05, 24)).toEqual(placed)
    const closed = closeRadioRestVisuals(placed, 'drums', 32)
    expect(place(closed, true, 20, 24)).toEqual(closed)
  })

  it('landed ahead of where it was placed (a line inside the lap): silent from now', () => {
    const v = place(place([other], false, 12, 16), true, 13, 16)
    expect(at(v, 'drums', 13).level).toBe(0)
    expect(at(v, 'drums', 15).level).toBe(0)
    expect(v.filter((x) => x.key === 'rest@drums')).toHaveLength(1)
  })

  it('a close passed while the row still rests (its return slipped): silent again from now', () => {
    const closed = closeRadioRestVisuals(place([other], true, 13, 16), 'drums', 24)
    expect(place(closed, true, 23, 24)).toEqual(closed)
    const v = place(closed, true, 24.02, 32)
    expect(at(v, 'drums', 24.02).level).toBe(0)
    expect(at(v, 'drums', 31.9).level).toBe(0)
    expect(v.filter((x) => x.key === 'rest@drums')).toHaveLength(1)
  })

  it('landed with none logged: silent from now', () => {
    const v = place([other], true, 13, 16)
    expect(at(v, 'drums', 12.9).level).toBe(1)
    expect(at(v, 'drums', 13).level).toBe(0)
    expect(at(v, 'drums', 40).level).toBe(0)
  })
})
