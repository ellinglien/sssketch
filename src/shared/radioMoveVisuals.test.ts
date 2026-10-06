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
  pruneRadioMoveVisuals,
  radioGestureVisuals,
  radioMoveVisualsSounding,
  radioRestVisual,
  radioRowVisualAt,
  radioRowVisualSteady,
  radioRowVisualVars,
  radioThrowVisual,
  radioTurnaroundVisuals,
  radioVisualBrightness,
  reopenRadioRestVisuals,
  type RadioMoveVisual,
  type RadioRowVisual
} from './radioMoveVisuals'
import {
  TURNAROUND_DIP_FLOOR,
  TURNAROUND_LIFT_TOP,
  turnaroundDipCurve,
  turnaroundDropCurve,
  turnaroundLiftCurve,
  turnaroundWashCurve,
  type TurnaroundPlan
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
