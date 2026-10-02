import { describe, expect, it } from 'vitest'
import {
  THROW_LEAD_BARS,
  THROW_MAX_BARS,
  THROW_RECALL_BARS,
  discoverThrowSends,
  initialDiscoverThrowState,
  playheadStep,
  stepDiscoverThrows,
  throwOutlivesLanding,
  throwStartAhead,
  throwYieldsToLeadIn,
  type DiscoverThrow,
  type DiscoverThrowState,
  type DiscoverThrowTick
} from './discoverThrows'
import { THROW_EVERY_BARS, throwCurveFor } from './radioThrows'
import { stemKey } from './types'

// the same mulberry32 as radioThrows.test.ts
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

const BPM = 120 // 2 s a bar
const SPB = 2
const rows: DiscoverThrowTick['rows'] = [
  { slot: 'drums', kinds: ['drums'], audible: true },
  { slot: 'bass', kinds: ['bass'], audible: true },
  { slot: 'lead', kinds: ['lead'], audible: true },
  { slot: 'pad', kinds: ['warm'], audible: true }
]

describe('throwStartAhead', () => {
  it('a beat at least a bar ahead, the whole (longest) throw before the loop top', () => {
    expect(throwStartAhead(0, 4)).toEqual({ ahead: 1, atBar: 1 })
    expect(throwStartAhead(0.1, 4)).toEqual({ ahead: 1.15, atBar: 1.25 })
    expect(throwStartAhead(2.5, 4)).toEqual({ ahead: 1, atBar: 3.5 }) // ends on the top
  })

  it('in the next lap when this one has no room, ending before the playhead comes round', () => {
    // 2.6 + 1 = 3.6: the next beat is 3.75, and 3.75 + 0.5 crosses the top
    const r = throwStartAhead(2.6, 4)!
    expect(r.atBar).toBe(0)
    expect(r.ahead).toBeCloseTo(1.4, 12)
    // a 2-bar loop at 1.9: the next lap's 1.0 (2.9 is past its top, and 1.0-1.5 is behind 1.9)
    expect(throwStartAhead(1.9, 2)).toEqual({ ahead: 1.1, atBar: 1 })
    // a 1.5-bar loop at 0.3: 1.5 is the top, and the next lap's 0 would still be under way at 0.3
    expect(throwStartAhead(0.3, 1.5)).toBeNull()
    expect(throwStartAhead(0.4, 2)).toEqual({ ahead: 1.1, atBar: 1.5 })
  })

  it('a loop shorter than the lead plus the longest throw never fits', () => {
    for (let pos = 0; pos < 1; pos += 0.01) expect(throwStartAhead(pos, 1)).toBeNull()
    expect(throwStartAhead(0, 0)).toBeNull()
    expect(throwStartAhead(-1, 4)).toBeNull()
  })

  it('swept: on a beat, far enough ahead, never across the top, and the first pass after the curve lands', () => {
    let found = 0
    for (const loopBars of [1.5, 2, 3, 4, 8, 16]) {
      for (let pos = 0; pos < loopBars; pos += 0.013) {
        const r = throwStartAhead(pos, loopBars)
        if (r === null) continue
        found += 1
        expect(r.ahead).toBeGreaterThanOrEqual(THROW_LEAD_BARS - 1e-9)
        expect((r.atBar * 4) % 1).toBeCloseTo(0, 9) // a beat of the loop
        expect(r.atBar + THROW_MAX_BARS).toBeLessThanOrEqual(loopBars + 1e-9)
        // where it lands is where the playhead will be
        expect((pos + r.ahead) % loopBars).toBeCloseTo(r.atBar % loopBars, 9)
        // the whole throw lies ahead of the playhead and inside one loop length of it
        expect(r.ahead + THROW_MAX_BARS).toBeLessThanOrEqual(loopBars + 1e-9)
      }
    }
    expect(found).toBeGreaterThan(1000)
  })
})

/** Plays the radio for `bars` bars at 30 Hz over a loop of `loopBars`; returns what happened,
 * with the playhead's bars played at each change. */
function play(
  bars: number,
  {
    loopBars = 4,
    seed = 5,
    everyBars = THROW_EVERY_BARS as readonly [number, number],
    over = {} as Partial<DiscoverThrowTick>,
    tickOver = (() => ({})) as (played: number) => Partial<DiscoverThrowTick>
  } = {}
): { armed: { t: DiscoverThrow; at: number }[]; ended: { t: DiscoverThrow; at: number }[] } {
  const rnd = seededRandom(seed)
  let s = initialDiscoverThrowState()
  const armed: { t: DiscoverThrow; at: number }[] = []
  const ended: { t: DiscoverThrow; at: number }[] = []
  const step = 1 / 30 / SPB // bars a tick
  for (let played = 0; played < bars; played += step) {
    const before = s.armed
    const r = stepDiscoverThrows(
      s,
      {
        pos: played % loopBars,
        loopBars,
        bpm: BPM,
        playing: true,
        canArm: true,
        leadingArmed: false,
        rows,
        everyBars,
        ...over,
        ...tickOver(played)
      },
      rnd
    )
    s = r.state
    if (r.change === 'armed') armed.push({ t: s.armed!, at: played })
    if (r.change === 'ended') ended.push({ t: before!, at: played })
  }
  return { armed, ended }
}

describe('stepDiscoverThrows', () => {
  const { armed, ended } = play(3000)

  it("throws every 16-32 bars (the web's rate), on a lead or a pad, never drums or bass", () => {
    expect(armed.length).toBeGreaterThan(80)
    const gaps = armed.slice(1).map((a, i) => a.t.startBars - armed[i].t.startBars)
    for (const g of gaps) {
      expect(g).toBeGreaterThanOrEqual(16 - 1)
      expect(g).toBeLessThanOrEqual(32 + 1.5)
    }
    for (const { t } of armed) {
      expect(['lead', 'pad']).toContain(t.slotId)
      expect([1, 2]).toContain(t.beats)
      expect(t.endBars - t.startBars).toBeCloseTo(t.beats / 4, 12)
    }
  })

  it('the bars played match the playhead: the throw starts where it was armed for', () => {
    for (const { t, at } of armed) {
      expect(t.startBars - at).toBeGreaterThanOrEqual(THROW_LEAD_BARS - 1e-6)
      // the playhead's own clock, wrapped, at the throw's start is the throw's bar
      expect(t.startBars % 4).toBeCloseTo(t.atBar, 6)
      expect(throwCurveFor(t, 4, SPB)).not.toBeNull()
    }
  })

  it('every throw ends once it has closed, long before the lap comes back round to it', () => {
    expect(ended.length).toBe(armed.length)
    ended.forEach(({ t, at }, i) => {
      expect(t).toBe(armed[i].t)
      expect(at).toBeGreaterThanOrEqual(t.endBars - 1e-9)
      // one tick late at most; a load-project lands within 0.22 bar
      expect(at - t.endBars).toBeLessThan(1 / 30 / SPB + 1e-9)
      expect(at + 0.25).toBeLessThan(t.startBars + 4)
    })
  })

  it('the rate setting: often throws more, rare less', () => {
    const often = play(3000, { everyBars: [8, 16] }).armed.length
    const rare = play(3000, { everyBars: [32, 64] }).armed.length
    expect(often).toBeGreaterThan(armed.length * 1.4)
    expect(rare).toBeLessThan(armed.length * 0.75)
  })

  it('nothing while stopped, over a hole or riser, or with only drums and bass heard', () => {
    expect(play(400, { over: { playing: false } }).armed).toEqual([])
    expect(play(400, { over: { leadingArmed: true } }).armed).toEqual([])
    const floor = rows.map((r) => ({ ...r, audible: r.slot === 'drums' || r.slot === 'bass' }))
    expect(play(400, { over: { rows: floor } }).armed).toEqual([])
  })

  it('while it cannot arm (a staged swap in flight) a due throw waits, then goes', () => {
    // blocked for 100 bars: at 16-32 bars apart, a throw comes due in there
    const blocked = play(400, { tickOver: (p) => ({ canArm: p < 50 || p >= 150 }) })
    expect(blocked.armed.some((a) => a.at > 50 && a.at < 150)).toBe(false)
    const after = blocked.armed.find((a) => a.at >= 150)
    expect(after?.at).toBeLessThan(151) // it was due long ago: the first chance takes it
  })

  it('a 1-bar loop never throws (no beat a bar ahead fits before the playhead comes round)', () => {
    expect(play(400, { loopBars: 1 }).armed).toEqual([])
  })

  it('a loop that changes length at a wrap keeps the count: bars played are bars played', () => {
    // 4 bars, then 8 from bar 40 on (a longer layer landed at a wrap)
    const rnd = seededRandom(3)
    let s = initialDiscoverThrowState()
    const step = 1 / 30 / SPB
    let pos = 0
    let loopBars = 4
    let played = 0
    for (let i = 0; i < 30 * SPB * 200; i += 1) {
      pos += step
      played += step
      if (pos >= loopBars) {
        pos -= loopBars
        if (played >= 40) loopBars = 8
      }
      const r = stepDiscoverThrows(
        s,
        {
          pos,
          loopBars,
          bpm: BPM,
          playing: true,
          canArm: true,
          leadingArmed: false,
          rows,
          everyBars: [8, 16]
        },
        rnd
      )
      s = r.state
      expect(s.elapsedBars).toBeCloseTo(played - step, 6) // the first tick starts the clock
    }
  })

  it('a stop takes an armed throw off (the playhead can come back anywhere)', () => {
    const rnd = seededRandom(2)
    let s = initialDiscoverThrowState()
    const tick = (pos: number, playing = true): DiscoverThrowTick => ({
      pos,
      loopBars: 4,
      bpm: BPM,
      playing,
      canArm: true,
      leadingArmed: false,
      rows,
      everyBars: [8, 16]
    })
    let played = 0
    while (s.armed === null) {
      s = stepDiscoverThrows(s, tick(played % 4), rnd).state
      played += 0.01
    }
    const r = stepDiscoverThrows(s, tick(played % 4, false), rnd)
    expect(r.change).toBe('ended')
    expect(r.state.armed).toBeNull()
    expect(r.state.elapsedBars).toBe(s.elapsedBars) // no bars go by while stopped
  })

  describe('the playhead going back: a wrap, jitter or a seek', () => {
    // a throw armed at 2.5-3 of a 4-bar lap, the playhead last seen at `lastPos`
    const armedAt = (lastPos: number, start = 42.5): DiscoverThrowState => ({
      ...initialDiscoverThrowState(),
      elapsedBars: 40 + lastPos,
      lastPos,
      lastLoopBars: 4,
      armed: {
        slotId: 'lead',
        atBar: start - 40,
        beats: 2,
        timing: 'quarter',
        feedback: 0.5,
        startBars: start,
        endBars: start + 0.5
      }
    })
    const tick = (pos: number): DiscoverThrowTick => ({
      pos,
      loopBars: 4,
      bpm: BPM,
      playing: true,
      canArm: true,
      leadingArmed: false,
      rows,
      everyBars: [8, 16]
    })
    const rnd = (): number => 0.5

    it('a wrap (3.98 -> 0.02): the 0.04 bar across the top is played, the throw stays', () => {
      const s = armedAt(3.98, 44.5)
      const r = stepDiscoverThrows(s, tick(0.02), rnd)
      expect(r.change).toBeNull()
      expect(r.state.elapsedBars).toBeCloseTo(44.02, 9)
      expect(r.state.armed).toBe(s.armed)
    })

    it('jitter mid-lap (2.40 -> 2.38): nothing played, the throw stays', () => {
      const s = armedAt(2.4)
      const r = stepDiscoverThrows(s, tick(2.38), rnd)
      expect(r.change).toBeNull()
      expect(r.state.elapsedBars).toBe(s.elapsedBars)
      expect(r.state.armed).toBe(s.armed)
    })

    it('a seek back mid-lap (2.40 -> 0.50): nothing played, the throw ends', () => {
      const s = armedAt(2.4)
      const r = stepDiscoverThrows(s, tick(0.5), rnd)
      expect(r.change).toBe('ended')
      expect(r.state.elapsedBars).toBe(s.elapsedBars)
      expect(r.state.armed).toBeNull()
    })

    it('a seek back from late in the lap to well past the top (3.9 -> 1.0) is a seek, not a wrap', () => {
      const s = armedAt(3.9, 44.5)
      const r = stepDiscoverThrows(s, tick(1), rnd)
      expect(r.change).toBe('ended')
      expect(r.state.elapsedBars).toBe(s.elapsedBars)
    })

    it('playheadStep names each', () => {
      expect(playheadStep(1, 4, 1.5)).toEqual({ kind: 'forward', played: 0.5 })
      expect(playheadStep(3.9, 4, 0.1).kind).toBe('wrap')
      expect(playheadStep(3.9, 4, 0.1).played).toBeCloseTo(0.2, 12)
      // the loop grew at the wrap: the old length is what was skipped
      expect(playheadStep(1.95, 2, 0.05).played).toBeCloseTo(0.1, 12)
      expect(playheadStep(2, 4, 1.97)).toEqual({ kind: 'jitter', played: 0 })
      expect(playheadStep(2, 4, 1)).toEqual({ kind: 'seek', played: 0 })
      expect(playheadStep(0.3, 4, 0.1)).toEqual({ kind: 'seek', played: 0 })
    })
  })
})

describe('throwYieldsToLeadIn (a hole or riser armed after a throw was planned)', () => {
  const s = (elapsedBars: number, startBars: number): DiscoverThrowState => ({
    ...initialDiscoverThrowState(),
    elapsedBars,
    lastPos: 0,
    lastLoopBars: 4,
    armed: {
      slotId: 'lead',
      atBar: 0,
      beats: 1,
      timing: 'quarter',
      feedback: 0.5,
      startBars,
      endBars: startBars + 0.25
    }
  })

  it('a throw still far enough ahead gives way; one under way, or about to be, finishes', () => {
    expect(throwYieldsToLeadIn(s(10, 11))).toBe(true)
    expect(throwYieldsToLeadIn(s(10, 10 + THROW_RECALL_BARS))).toBe(true)
    expect(throwYieldsToLeadIn(s(10, 10.1))).toBe(false)
    expect(throwYieldsToLeadIn(s(10, 9.9))).toBe(false)
    expect(throwYieldsToLeadIn(initialDiscoverThrowState())).toBe(false)
  })
})

describe('throwOutlivesLanding (what a staged project carries)', () => {
  const at = (
    elapsedBars: number,
    lastPos: number,
    armed: Partial<DiscoverThrow>
  ): DiscoverThrowState => ({
    ...initialDiscoverThrowState(),
    elapsedBars,
    lastPos,
    lastLoopBars: 4,
    armed: {
      slotId: 'lead',
      atBar: 0,
      beats: 2,
      timing: 'quarter',
      feedback: 0.5,
      startBars: 0,
      endBars: 0,
      ...armed
    }
  })

  it('a throw in this lap stays with the project playing now: a stage at the loop top leaves it', () => {
    // lap from 40; playhead at 41; throw 42.5-43
    expect(throwOutlivesLanding(at(41, 1, { atBar: 2.5, startBars: 42.5, endBars: 43 }))).toBe(
      false
    )
  })

  it('a throw in the next lap rides a stage at the loop top', () => {
    // lap from 40; playhead at 43; throw at 44.25-44.75 (the next lap's 0.25)
    expect(throwOutlivesLanding(at(43, 3, { atBar: 0.25, startBars: 44.25, endBars: 44.75 }))).toBe(
      true
    )
  })

  it('a mid-lap stage carries what is still open when it lands, not what is over by then', () => {
    const s = at(41, 1, { atBar: 2.5, startBars: 42.5, endBars: 43 })
    expect(throwOutlivesLanding(s, 2)).toBe(true) // lands at 42, before the throw
    expect(throwOutlivesLanding(s, 2.75)).toBe(true) // lands inside it: the rest goes on
    expect(throwOutlivesLanding(s, 3)).toBe(false) // lands after it
  })

  it('nothing armed, nothing carried', () => {
    expect(throwOutlivesLanding({ ...initialDiscoverThrowState(), lastPos: 1 })).toBe(false)
  })
})

describe('discoverThrowSends', () => {
  const t: DiscoverThrow = {
    slotId: 'pad',
    atBar: 1,
    beats: 1,
    timing: 'dotted-eighth',
    feedback: 0.55,
    startBars: 9,
    endBars: 9.25
  }

  it("the curve on the row's preview stem (members numbered from 1), and its echo", () => {
    const out = discoverThrowSends(t, ['drums', 'pad', 'lead'], 'g1', 4, SPB)
    expect(out?.echo).toEqual({ timing: 'dotted-eighth', feedback: 0.55 })
    expect([...(out?.sends.keys() ?? [])]).toEqual([stemKey('g1', 2)])
    expect(out?.sends.get(stemKey('g1', 2))).toEqual(throwCurveFor(t, 4, SPB))
  })

  it('nothing for no throw, a row not in the mix, or a loop it no longer fits', () => {
    expect(discoverThrowSends(null, ['pad'], 'g1', 4, SPB)).toBeUndefined()
    expect(discoverThrowSends(t, ['drums', 'lead'], 'g1', 4, SPB)).toBeUndefined()
    expect(discoverThrowSends(t, ['pad'], 'g1', 1, SPB)).toBeUndefined()
  })
})
