import { describe, expect, it } from 'vitest'
import {
  THROW_EVERY_BARS,
  THROW_PREFER_SHARE,
  THROW_RAMP_SEC,
  initialThrowState,
  stepThrows,
  throwCurveFor,
  throwDelaySec,
  throwTailSec,
  turnaroundSilencedRowIds,
  type ThrowPlan,
  type ThrowTick
} from './radioThrows'

// moved from ell.ing/radio src/radio/throws.test.ts (2026-10-01). Its seeded random came from the
// radio's audio/noise.ts; this is the same mulberry32, so the same seeds give the same throws.
function seededRandom(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const BPM = 120 // 2 s a bar, 0.5 s a beat
const rows = [
  { slot: 'r0', kinds: ['drums' as const], audible: true },
  { slot: 'r1', kinds: ['bass' as const], audible: true },
  { slot: 'r2', kinds: ['lead' as const], audible: true },
  { slot: 'r3', kinds: ['warm' as const], audible: true }
]

/** Run the scheduler at 30 Hz for `bars` bars; returns its throws. */
function run(
  bars: number,
  over: Partial<ThrowTick> = {},
  seed = 5,
  everyBars?: readonly [number, number]
): ThrowPlan[] {
  const rnd = seededRandom(seed)
  let s = initialThrowState()
  const plans: ThrowPlan[] = []
  for (let t = 0; t < bars * 2; t += 1 / 30) {
    const nextBeat = Math.ceil((t + 0.05) / 0.5) * 0.5
    const tick = { now: t, bpm: BPM, nextBeat, held: false, leadingArmed: false, rows, ...over }
    const r = stepThrows(s, tick, rnd, everyBars)
    s = r.state
    if (r.plan) plans.push(r.plan)
  }
  return plans
}

const gapsOf = (plans: ThrowPlan[]): number[] =>
  plans.slice(1).map((p, i) => (p.at - plans[i].at) / 2)

describe('the echo', () => {
  it('a dotted eighth is 3/4 of a beat, a quarter a beat, at the tempo', () => {
    expect(throwDelaySec(120, 'dotted-eighth')).toBeCloseTo(0.375, 12)
    expect(throwDelaySec(120, 'quarter')).toBeCloseTo(0.5, 12)
    expect(throwDelaySec(90, 'quarter')).toBeCloseTo(2 / 3, 12)
  })
  it('its tail is the repeats it takes to fall 60 dB', () => {
    // 0.5 feedback: 6.02 dB a repeat, ~10 repeats
    expect(throwTailSec(0.5, 0.5)).toBeCloseTo(0.5 * (Math.log(1000) / Math.log(2)), 9)
  })
})

describe('stepThrows', () => {
  const plans = run(2000)

  it('throws every 16-32 bars (when nothing stops it), about one in 24', () => {
    const gaps = gapsOf(plans)
    for (const g of gaps) {
      expect(g).toBeGreaterThanOrEqual(THROW_EVERY_BARS[0] - 0.5)
      expect(g).toBeLessThanOrEqual(THROW_EVERY_BARS[1] + 0.5)
    }
    const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length
    expect(mean).toBeGreaterThan(21)
    expect(mean).toBeLessThan(27)
  })

  it('on a beat, on a row that is neither drums nor bass, for a beat or two, at a set feedback', () => {
    for (const p of plans) {
      expect(p.at / 0.5).toBeCloseTo(Math.round(p.at / 0.5), 9)
      expect(['r2', 'r3']).toContain(p.slot)
      expect([1, 2]).toContain(p.beats)
      expect(['dotted-eighth', 'quarter']).toContain(p.timing)
      expect(p.feedback).toBeGreaterThanOrEqual(0.45)
      expect(p.feedback).toBeLessThanOrEqual(0.6)
    }
    expect(new Set(plans.map((p) => p.slot)).size).toBe(2)
  })

  it('never stacks: a throw waits for the last one to ring out', () => {
    for (let i = 1; i < plans.length; i++) {
      const p = plans[i - 1]
      const end = p.at + p.beats * 0.5 + throwTailSec(throwDelaySec(BPM, p.timing), p.feedback)
      expect(plans[i].at).toBeGreaterThanOrEqual(end)
    }
  })

  it('nothing while held, over an armed lead-in, or with only drums and bass audible', () => {
    expect(run(200, { held: true })).toEqual([])
    expect(run(200, { leadingArmed: true })).toEqual([])
    const floorOnly = rows.map((r) => ({ ...r, audible: r.slot === 'r0' || r.slot === 'r1' }))
    expect(run(200, { rows: floorOnly })).toEqual([])
  })

  it('is the same throws for the same seed', () => {
    expect(run(400, {}, 9)).toEqual(run(400, {}, 9))
    expect(run(400, {}, 9)).not.toEqual(run(400, {}, 10))
  })

  it('takes another spacing (the sound settings rate), THROW_EVERY_BARS when none is given', () => {
    expect(run(400, {}, 9, THROW_EVERY_BARS)).toEqual(run(400, {}, 9))
    const often = gapsOf(run(2000, {}, 5, [8, 16]))
    expect(often.length).toBeGreaterThan(gapsOf(plans).length)
    // the floor holds (8 bars); the ceiling can stretch while the last throw still rings
    for (const g of often) expect(g).toBeGreaterThanOrEqual(8 - 0.5)
    const mean = often.reduce((a, b) => a + b, 0) / often.length
    expect(mean).toBeGreaterThan(10)
    expect(mean).toBeLessThan(15)
  })
})

describe('throwCurveFor (native radio sound plan, Task 11)', () => {
  const SPB = 2 // 120 bpm: 2 s a bar, so 5 ms is 0.0025 bar

  it("opens over 5 ms at the start and closes over the last 5 ms, at full level (the web's throwDelay)", () => {
    const curve = throwCurveFor({ atBar: 1.5, beats: 2 }, 4, SPB)
    expect(curve).not.toBeNull()
    const c = curve!
    expect(c.map((p) => p.value)).toEqual([0, 1, 1, 0])
    expect(c[0].bar).toBe(1.5)
    expect(c[1].bar).toBeCloseTo(1.5 + THROW_RAMP_SEC / SPB, 12)
    expect(c[2].bar).toBeCloseTo(2 - THROW_RAMP_SEC / SPB, 12)
    expect(c[3].bar).toBe(2) // two beats = half a bar
    // in seconds, the ramps are 5 ms at any tempo
    const at90 = throwCurveFor({ atBar: 0, beats: 1 }, 4, (4 * 60) / 90)!
    expect((at90[1].bar - at90[0].bar) * ((4 * 60) / 90)).toBeCloseTo(0.005, 12)
    expect(at90[3].bar).toBe(0.25)
  })

  it('a throw that ends exactly on the loop top fits', () => {
    expect(throwCurveFor({ atBar: 3.5, beats: 2 }, 4, SPB)?.[3].bar).toBe(4)
    expect(throwCurveFor({ atBar: 0, beats: 2 }, 0.5, SPB)).not.toBeNull()
  })

  it('refuses a throw across the loop top rather than splitting it (the head would sit behind the playhead)', () => {
    expect(throwCurveFor({ atBar: 3.75, beats: 2 }, 4, SPB)).toBeNull()
    expect(throwCurveFor({ atBar: 4, beats: 1 }, 4, SPB)).toBeNull()
  })

  it('refuses nonsense', () => {
    expect(throwCurveFor({ atBar: -0.25, beats: 1 }, 4, SPB)).toBeNull()
    expect(throwCurveFor({ atBar: 0, beats: 0 }, 4, SPB)).toBeNull()
    expect(throwCurveFor({ atBar: 0, beats: 1 }, 0, SPB)).toBeNull()
    expect(throwCurveFor({ atBar: 0, beats: 1 }, 4, 0)).toBeNull()
    expect(throwCurveFor({ atBar: Number.NaN, beats: 1 }, 4, SPB)).toBeNull()
  })
})

// THROWS AIMED AT A TRANSITION (Elling, 2026-10-03: "the note repeat delay is happening too early,
// it should happen right before a transition but seems to fall four beats behind where it
// should be"). A throw near a transition armed within reach ENDS on its downbeat, and the throw
// clock bends (up to THROW_PREFER_SHARE of the shortest spacing either way) to find one.
describe('stepThrows aimed at a transition (changeAt)', () => {
  const W = THROW_EVERY_BARS[0] * THROW_PREFER_SHARE

  interface Sim {
    plans: ThrowPlan[]
    /** The change each plan saw at its tick (null: none in reach). */
    aimedAt: (number | null)[]
    changes: number[]
  }
  /** 30 Hz ticks for `bars` bars of a `loopBars` loop at `bpm`. A change lands on the loop top
   * every `everyLaps` laps; it is in reach (changeAt) from one lap before it. `leadIn`: the lap
   * before each change has a hole/riser armed (leadingArmed). */
  function sim(
    loopBars: number,
    bpm: number,
    o: {
      bars?: number
      everyLaps?: number
      leadIn?: boolean
      silenced?: readonly string[]
      seed?: number
      changes?: boolean
    } = {}
  ): Sim {
    const bars = o.bars ?? 2000
    const barSec = (4 * 60) / bpm
    const beat = 60 / bpm
    const lap = loopBars * barSec
    const everyLaps = o.everyLaps ?? Math.max(1, Math.round(8 / loopBars))
    const rnd = seededRandom(o.seed ?? 5)
    let s = initialThrowState()
    const plans: ThrowPlan[] = []
    const aimedAt: (number | null)[] = []
    const changes: number[] = []
    for (let t = 0; t < bars * barSec; t += 1 / 30) {
      const nextBeat = Math.ceil((t + 0.05) / beat - 1e-9) * beat
      const lapIdx = Math.floor(t / lap + 1e-9)
      // the change at the top after lap k where (k + 1) % everyLaps === 0
      const changeLap = Math.ceil((lapIdx + 1) / everyLaps) * everyLaps
      const change = changeLap * lap
      if (changes[changes.length - 1] !== change) changes.push(change)
      const inReach = o.changes !== false && change - t <= lap + 1e-9
      const tick: ThrowTick = {
        now: t,
        bpm,
        nextBeat,
        held: false,
        leadingArmed: !!o.leadIn && inReach,
        changeAt: inReach ? change : null,
        silenced: o.silenced,
        rows
      }
      const r = stepThrows(s, tick, rnd)
      s = r.state
      if (r.plan) {
        expect(r.plan.at).toBeGreaterThanOrEqual(nextBeat - 1e-9)
        plans.push(r.plan)
        aimedAt.push(tick.changeAt ?? null)
      }
    }
    return { plans, aimedAt, changes }
  }

  for (const loopBars of [1, 2, 4])
    for (const bpm of [90, 120, 140])
      it(`a ${loopBars}-bar loop at ${bpm}: every throw ends exactly on the change's downbeat`, () => {
        const beat = 60 / bpm
        const r = sim(loopBars, bpm, { bars: 800 })
        expect(r.plans.length).toBeGreaterThan(20)
        r.plans.forEach((p, i) => {
          const c = r.aimedAt[i]
          expect(c).not.toBeNull()
          expect(p.at + p.beats * beat).toBeCloseTo(c!, 9)
          // on the beat grid
          expect(p.at / beat).toBeCloseTo(Math.round(p.at / beat), 6)
        })
      })

  it('also over an armed lead-in (a hole, a riser, a turnaround): aimed, not skipped', () => {
    const r = sim(1, 120, { leadIn: true })
    const free = sim(1, 120)
    expect(r.plans.length).toBe(free.plans.length)
    r.plans.forEach((p, i) => expect(p.at + p.beats * 0.5).toBeCloseTo(r.aimedAt[i]!, 9))
  })

  it('keeps the rate: about one in 24 bars with transitions in reach, as without', () => {
    for (const loopBars of [1, 2, 4]) {
      const aimed = sim(loopBars, 120, { bars: 4000 })
      const plain = sim(loopBars, 120, { bars: 4000, changes: false })
      const meanGap = (ps: ThrowPlan[]): number => {
        const g = gapsOf(ps)
        return g.reduce((a, b) => a + b, 0) / g.length
      }
      expect(meanGap(aimed.plans)).toBeGreaterThan(21)
      expect(meanGap(aimed.plans)).toBeLessThan(27)
      expect(Math.abs(aimed.plans.length - plain.plans.length)).toBeLessThanOrEqual(
        Math.ceil(plain.plans.length * 0.1)
      )
    }
  })

  it(`never two within ${W} bars (the shortest spacing's half): a pull forward waits that long`, () => {
    for (const loopBars of [1, 2, 4]) {
      const g = gapsOf(sim(loopBars, 120, { bars: 4000 }).plans)
      for (const x of g) expect(x).toBeGreaterThanOrEqual(W - 0.01)
    }
  })

  it('never throws on a row the build-up silences: another row, or none', () => {
    const r = sim(1, 120, { silenced: ['r2'] })
    expect(r.plans.length).toBeGreaterThan(0)
    for (const p of r.plans) expect(p.slot).toBe('r3')
    expect(sim(1, 120, { silenced: ['r2', 'r3'] }).plans).toEqual([])
  })

  // one tick from a hand-made state, at 120 bpm (0.5 s a beat, 2 s a bar)
  const one = (
    barsUntil: number,
    over: Partial<ThrowTick>,
    barsSince: number | null = null
  ): ThrowPlan | null =>
    stepThrows(
      { barsUntil, lastNow: null, busyUntil: Number.NEGATIVE_INFINITY, barsSince },
      { now: 10, bpm: BPM, nextBeat: 10.5, held: false, leadingArmed: false, rows, ...over },
      seededRandom(3)
    ).plan

  it('waits for a change still out of reach, then aims at it', () => {
    expect(one(0, { changeAt: 10.5 + 3 * 2 })).toBeNull()
    const p = one(0, { changeAt: 10.5 + 2 })
    expect(p).not.toBeNull()
    expect(p!.at + p!.beats * 0.5).toBeCloseTo(12.5, 9)
  })

  it('a change a beat ahead takes a one-beat throw, on the next beat', () => {
    const p = one(0, { changeAt: 11 })
    expect(p).toMatchObject({ at: 10.5, beats: 1 })
  })

  it('a change too close to aim at: as before -- skipped over a lead-in, else on the next beat once due', () => {
    // at the next beat itself: nothing fits before it
    expect(one(0, { changeAt: 10.5 })).toBeNull() // waits a while for a transition
    expect(one(-W - 0.01, { changeAt: 10.5, leadingArmed: true })).toBeNull()
    expect(one(-W - 0.01, { changeAt: 10.5 })?.at).toBe(10.5)
  })

  it(`pulls forward only after ${W} bars without a throw`, () => {
    expect(one(W - 0.01, { changeAt: 12.5 }, W - 0.5)).toBeNull()
    expect(one(W - 0.01, { changeAt: 12.5 }, W)).not.toBeNull()
    expect(one(W + 0.01, { changeAt: 12.5 }, 100)).toBeNull()
  })

  it('with no change at all, a due throw waits that long for one, then goes on the next beat (gaps still 16-32)', () => {
    expect(one(0, {})).toBeNull()
    expect(one(-W + 0.01, {})).toBeNull()
    expect(one(-W - 0.01, {})?.at).toBe(10.5)
  })
})

describe('turnaroundSilencedRowIds', () => {
  it('the rows a drop takes to silence, not the ones it only filters or sends', () => {
    const plan = {
      rows: [
        {
          rowId: 'drums',
          volume: [
            { beats: 4, value: 1 },
            { beats: 3.9, value: 0 },
            { beats: 0, value: 1 }
          ]
        },
        { rowId: 'lead', filter: {} },
        {
          rowId: 'pad',
          volume: [
            { beats: 2, value: 0.5 },
            { beats: 0, value: 1 }
          ]
        }
      ]
    }
    expect(turnaroundSilencedRowIds(plan)).toEqual(['drums'])
    expect(turnaroundSilencedRowIds(null)).toEqual([])
  })
})
