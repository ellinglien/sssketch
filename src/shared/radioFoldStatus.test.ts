import { describe, expect, it } from 'vitest'
import {
  createRadioFold,
  radioFoldRestartAt,
  radioFoldRestartStep,
  stepRadioFold,
  type RadioFoldInput,
  type RadioFoldRow,
  type RadioFoldState,
  type RadioFoldStep
} from './radioFold'
import {
  radioFoldBeatsIn,
  radioFoldBeatsLabel,
  radioFoldPhaseDot,
  radioFoldRowLabel,
  radioFoldStatus,
  radioFoldTransportMove
} from './radioFoldStatus'

const row = (id: string, over: Partial<RadioFoldRow> = {}): RadioFoldRow => ({
  id,
  stemId: `${id}-stem`,
  kinds: ['rhythmic'],
  barLength: 2,
  hooked: false,
  audible: true,
  percussive: false,
  ...over
})

const BAND: RadioFoldRow[] = [
  row('drums', { kinds: ['drums'], barLength: 4 }),
  row('hats', { kinds: ['drums'], barLength: 1 }),
  row('perc', { kinds: ['rhythmic'], barLength: 2 }),
  row('lead', { kinds: ['lead'], barLength: 4 })
]

const input = (fold: number): RadioFoldInput => ({ rows: BAND, loopBars: 4, bpm: 120, fold })

/** perc settled at 7 beats from lap 0 on a 16-beat loop, decided up to `lap`: it realigns every
 * 7 laps (112 beats). */
const settled = (lap: number): RadioFoldState => ({
  ...createRadioFold('k3x9pq'),
  lap,
  loopBeats: 16,
  bpm: 120,
  stretch: 'folded',
  stretchEndsLap: 1000,
  rows: [
    {
      rowId: 'perc',
      stemId: 'perc-stem',
      fullBeats: 8,
      targetBeats: 7,
      cycleBeats: 7,
      phaseBeats: 0,
      originLap: 0,
      path: [],
      walk: [7],
      mode: 'settled',
      unfoldSince: null,
      serial: 1,
      realigns: 0,
      rotateAfter: 4
    }
  ]
})

function run(seed: string, wraps: number, fold: number): RadioFoldStep[] {
  const out: RadioFoldStep[] = []
  let s = createRadioFold(seed)
  for (let i = 0; i < wraps; i++) {
    const step = stepRadioFold(s, input(fold))
    out.push(step)
    s = step.state
  }
  return out
}

describe('radioFoldStatus', () => {
  it('is null with no machine, or one that has not stepped', () => {
    expect(radioFoldStatus(null, null, 4, 40, 12)).toBeNull()
    expect(radioFoldStatus(createRadioFold('k3x9pq'), null, 4, 40, 12)).toBeNull()
  })

  it('folded: the rows, the next realignment and the next change, in one line', () => {
    const now = stepRadioFold(settled(4), input(40)) // decides lap 5, which plays next
    const next = stepRadioFold(now.state, input(40)) // decides lap 6; lap 5 plays
    const st = radioFoldStatus(next.state, now, 4, 40, 19.6)!
    expect(st.stretch).toBe('folded')
    expect(st.rows).toEqual([
      { rowId: 'perc', cycleBeats: 7, fullBeats: 8, phaseBeats: 0, mode: 'settled', lapsIn: 5 }
    ])
    // lap 7 is its realignment: two tops on from lap 5's
    expect(st.realignsInLaps).toBe(2)
    expect(st.nextChangeBars).toBe(20)
    expect(st.summary).toBe('folded · 1 row · realigns in 2 laps · next change ~20 bars')
  })

  it("the decided lap's own top marked is a realignment in 1 lap", () => {
    const now = stepRadioFold(settled(5), input(40)) // decides lap 6
    const next = stepRadioFold(now.state, input(40)) // decides lap 7: marked
    expect(next.marked).toBe(true)
    const st = radioFoldStatus(next.state, now, 4, 40, null)!
    expect(st.realignsInLaps).toBe(1)
    expect(st.summary).toBe('folded · 1 row · realigns in 1 lap')
  })

  it('folded with nothing that may fold says so', () => {
    const rows = [
      row('drums', { kinds: ['drums'], barLength: 4 }),
      row('lead', { kinds: ['lead'] })
    ]
    const a = stepRadioFold(createRadioFold('k3x9pq'), { ...input(40), rows })
    const b = stepRadioFold(a.state, { ...input(40), rows })
    expect(radioFoldStatus(b.state, a, 4, 40, 8)!.summary).toBe(
      'folded · nothing to fold · next change ~8 bars'
    )
  })

  it('straight: when the next folded stretch starts, or just straight at bend 0', () => {
    let seen = 0
    const steps = run('k3x9pq', 300, 40)
    for (let i = 1; i < steps.length; i++) {
      const now = steps[i - 1]
      if (now.stretch !== 'straight' || now.cycles.length > 0) continue
      const st = radioFoldStatus(steps[i].state, now, 4, 40, 12)!
      const laps = Math.max(1, steps[i].state.stretchEndsLap - now.lap)
      expect(st.summary).toBe(`straight · folding in ${laps} lap${laps === 1 ? '' : 's'}`)
      seen++
    }
    expect(seen).toBeGreaterThan(0)
    const zero = run('k3x9pq', 20, 0)
    expect(radioFoldStatus(zero[19].state, zero[18], 4, 0, 12)!.summary).toBe('straight')
  })

  it('straight while folds still walk back reads unfolding', () => {
    const steps = run('k3x9pq', 300, 40)
    const i = steps.findIndex((s, k) => k > 0 && s.stretch === 'straight' && s.cycles.length > 0)
    expect(i).toBeGreaterThan(0)
    expect(radioFoldStatus(steps[i + 1].state, steps[i], 4, 40, 12)!.summary).toBe(
      'straight · unfolding'
    )
  })
})

describe('the row readout and the phase dot', () => {
  it('a cycle against the loop in beats, a half as ½', () => {
    expect(radioFoldRowLabel(7, 16)).toBe('7 / 16')
    expect(radioFoldRowLabel(3.5, 16)).toBe('3½ / 16')
    expect(radioFoldRowLabel(5.5, 8)).toBe('5½ / 8')
    expect(radioFoldBeatsLabel(0.5)).toBe('½')
  })

  it('the dot goes round the cycle and sits on the downbeat at realignment', () => {
    expect(radioFoldPhaseDot(7, 0, 0)).toBe(0)
    expect(radioFoldPhaseDot(7, 0, 3.5)).toBeCloseTo(0.5, 12)
    // 7 against 16 realigns after 112 beats: seven laps
    expect(radioFoldPhaseDot(7, 0, 112)).toBe(0)
    expect(radioFoldPhaseDot(7, 0, 16)).toBeCloseTo(2 / 7, 12)
    // a phase offset: the cycle starts that much later
    expect(radioFoldPhaseDot(7, 0.25, 0.25)).toBe(0)
    expect(radioFoldPhaseDot(7, 0.25, 0)).toBeCloseTo(6.75 / 7, 12)
    expect(radioFoldPhaseDot(0, 0, 3)).toBe(0)
  })

  it('beats in: whole laps since its origin plus the position in the lap playing', () => {
    const r = {
      rowId: 'p',
      cycleBeats: 7,
      fullBeats: 8,
      phaseBeats: 0,
      mode: 'settled' as const,
      lapsIn: 6
    }
    expect(radioFoldBeatsIn(r, 4, 0)).toBe(96)
    expect(radioFoldBeatsIn(r, 4, 4)).toBe(112)
    expect(radioFoldPhaseDot(7, 0, radioFoldBeatsIn({ ...r, lapsIn: 7 }, 4, 0))).toBe(0)
  })
})

describe('a restart (a play after a pause, a seek, a snap)', () => {
  it('beats in carries the tops passed since the rows were read', () => {
    const r = {
      rowId: 'p',
      cycleBeats: 7,
      fullBeats: 8,
      phaseBeats: 0,
      mode: 'settled' as const,
      lapsIn: 6
    }
    // the wrap's first frame, before the step: still lap 6's rows, a top on
    expect(radioFoldBeatsIn(r, 4, 0.5, 1)).toBe(114)
    expect(radioFoldBeatsIn(r, 4, 0.5, -2)).toBe(radioFoldBeatsIn(r, 4, 0.5))
  })

  it('restarts every cycle that began before the lap, on its top, and draws nothing', () => {
    const now = stepRadioFold(settled(4), input(40)) // decides lap 5
    const next = stepRadioFold(now.state, input(40)) // decides lap 6; lap 5 plays
    const before = JSON.stringify(next)
    const again = radioFoldRestartStep(next, 5)
    expect(JSON.stringify(next)).toBe(before) // pure
    expect(again.state.rows.map((r) => r.originLap)).toEqual([5])
    expect(again.state.draws).toBe(next.state.draws)
    expect(again.state.serial).toBe(next.state.serial)
    expect(again.cycles).toEqual(next.cycles) // the same cycle ids: the engine keeps its cycles
    // a cycle that begins on or after the lap is left as it is
    expect(radioFoldRestartAt(again.state, 5)).toBe(again.state)
    expect(radioFoldRestartAt(again.state, 3)).toBe(again.state)
  })

  it('the dots and the status count from the restart, not from the fold', () => {
    const now = stepRadioFold(settled(4), input(40))
    const next = stepRadioFold(now.state, input(40))
    expect(radioFoldStatus(next.state, now, 4, 40, null)!.realignsInLaps).toBe(2)
    const st = radioFoldStatus(
      radioFoldRestartAt(next.state, 5),
      radioFoldRestartStep(now, 5),
      4,
      40,
      null
    )!
    expect(st.rows[0].lapsIn).toBe(0)
    // 7 against 16 realigns seven laps after its new origin, lap 5's top
    expect(st.realignsInLaps).toBe(7)
  })

  it('a decided top marked as a realignment is not one after a restart', () => {
    const now = stepRadioFold(settled(5), input(40)) // decides lap 6
    const next = stepRadioFold(now.state, input(40)) // decides lap 7: marked
    expect(next.marked).toBe(true)
    const again = radioFoldRestartStep(next, 6)
    expect(again.marked).toBe(false)
    expect(again.state.marked).toBe(false)
    expect(
      radioFoldStatus(again.state, radioFoldRestartStep(now, 6), 4, 40, null)!.realignsInLaps
    ).toBe(7)
  })

  it('the machine marks the tops the engine will play after a restart, and replays the same', () => {
    const marks = (restart: boolean): number[] => {
      const now = stepRadioFold(settled(4), input(40))
      let s = stepRadioFold(now.state, input(40)).state // lap 5 plays
      if (restart) s = radioFoldRestartAt(s, 5)
      const out: number[] = []
      for (let i = 0; i < 9; i++) {
        const st = stepRadioFold(s, input(40))
        if (st.marked) out.push(st.lap)
        s = st.state
      }
      return out
    }
    expect(marks(false)).toEqual([7, 14])
    expect(marks(true)).toEqual([12])
    expect(marks(true)).toEqual(marks(true))
  })
})

describe('radioFoldTransportMove', () => {
  const at = (pos: number, playing = true): { pos: number; playing: boolean } => ({ pos, playing })
  it('stopped is nothing, and playing again is a restart', () => {
    expect(radioFoldTransportMove(at(1), 2, false, 4)).toBe('none')
    expect(radioFoldTransportMove(at(1, false), 1, true, 4)).toBe('restart')
  })
  it('playback is nothing; a jump forward is a restart', () => {
    expect(radioFoldTransportMove(at(1), 1.03, true, 4)).toBe('none')
    expect(radioFoldTransportMove(at(1), 1, true, 4)).toBe('none')
    expect(radioFoldTransportMove(at(0.5), 3, true, 4)).toBe('restart')
  })
  it('a top played through is a wrap; a seek back, or a snap from past the end, a restart', () => {
    expect(radioFoldTransportMove(at(3.97), 0.02, true, 4)).toBe('wrap')
    expect(radioFoldTransportMove(at(3), 1, true, 4)).toBe('restart')
    expect(radioFoldTransportMove(at(7.9), 0.01, true, 4)).toBe('restart')
  })
})
