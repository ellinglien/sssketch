import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_RADIO_SETTINGS,
  RADIO_PACE_BARS,
  advanceRadioClock,
  createRadioClock,
  normalizeRadioSettings,
  pickRadioSlotId,
  pickRadioSlotIds,
  radioCadenceOf,
  RADIO_BAR_STAGE_LEAD_BARS,
  radioBarLandingAim,
  radioCadenceTransition,
  radioClockForPace,
  radioGridBars,
  radioGridLineAtOrAfter,
  radioPaceGridBars,
  radioPaceLevelOf,
  radioPaceWindowOf,
  radioPhraseNeedsReanchor,
  radioPhraseReanchored,
  type RadioClock,
  type RadioSettings
} from './radioSchedule'
import { FOLD_PACE_BARS, FOLD_PREFER_WAIT_LAPS } from './radioFold'
import { RADIO_PACE_ANCHORS } from './radioPace'

/** mulberry32 -- a small seeded PRNG. */
function seeded(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Run the clock at 30Hz for `laps` laps of a `loopBars` loop at 120bpm (a tick = 1/15 bar),
 * restarting the interval at every due as both radios do. */
function run(
  clock: RadioClock,
  laps: number,
  loopBars: number,
  phraseBars: number,
  turnaroundPhraseBars: number,
  intervalBars = 1
): { dues: number[]; dueLaps: number[]; turnaroundStarts: number[]; clock: RadioClock } {
  const dues: number[] = []
  const dueLaps: number[] = []
  const turnaroundStarts: number[] = []
  const tick = 1 / 15
  let total = 0
  let pos = clock.lastPos
  let c = clock
  for (let i = 0; i < Math.round((laps * loopBars) / tick); i++) {
    total += tick
    pos = (pos + tick) % loopBars
    const step = advanceRadioClock(c, pos, loopBars, loopBars, phraseBars, turnaroundPhraseBars)
    c = step.clock
    if (step.turnaroundLapStarts) turnaroundStarts.push(Math.round(total))
    if (step.due) {
      dues.push(Math.round(total))
      dueLaps.push(c.turnaroundLap ?? 0)
      c = { ...c, barsElapsed: 0, intervalBars }
    }
  }
  return { dues, dueLaps, turnaroundStarts, clock: c }
}

describe('advanceRadioClock: the turnaround phrase, decoupled', () => {
  it('defaults to the change phrase, so every existing caller is unchanged', () => {
    const a = run(createRadioClock(1, 0), 16, 4, 16, 16)
    const b = (() => {
      // the five-argument call, as every caller made it before
      const dues: number[] = []
      let c = createRadioClock(1, 0)
      let pos = 0
      let total = 0
      for (let i = 0; i < 16 * 4 * 15; i++) {
        total += 1 / 15
        pos = (pos + 1 / 15) % 4
        const s = advanceRadioClock(c, pos, 4, 4, 16)
        c = s.clock
        if (s.due) {
          dues.push(Math.round(total))
          c = { ...c, barsElapsed: 0, intervalBars: 1 }
        }
      }
      return dues
    })()
    expect(a.dues).toEqual(b)
  })

  it('a 4-bar change phrase changes every lap while turnarounds keep 16 bars', () => {
    const r = run(createRadioClock(1, 0), 16, 4, 4, 16)
    expect(r.dues).toEqual([4, 8, 12, 16, 20, 24, 28, 32, 36, 40, 44, 48, 52, 56, 60, 64])
    // the last lap of each 16-bar phrase starts at bar 12, 28, ...
    expect(r.turnaroundStarts).toEqual([12, 28, 44, 60])
  })
})

describe('RadioSettings.paceLevel', () => {
  it('defaults to mid, and old settings migrate', () => {
    expect(DEFAULT_RADIO_SETTINGS.paceLevel).toBe(RADIO_PACE_ANCHORS.mid)
    expect(normalizeRadioSettings({}).paceLevel).toBe(RADIO_PACE_ANCHORS.mid)
    expect(normalizeRadioSettings({ pace: 'fast' }).paceLevel).toBe(RADIO_PACE_ANCHORS.fast)
    expect(normalizeRadioSettings({}, 'slow').paceLevel).toBe(RADIO_PACE_ANCHORS.slow)
    expect(normalizeRadioSettings({ pace: 'mid', paceBars: { min: 3, max: 6 } }).paceLevel).toBe(50)
    expect(normalizeRadioSettings({ pace: 'slow', paceLevel: 72 }).paceLevel).toBe(72)
    expect(normalizeRadioSettings({ paceLevel: 400 }).paceLevel).toBe(100)
  })

  it("radioPaceLevelOf reads a RadioSettings built without it (the web's) from its chip", () => {
    const web: RadioSettings = {
      ...DEFAULT_RADIO_SETTINGS,
      pace: 'fast',
      paceBars: { ...RADIO_PACE_BARS.fast },
      paceLevel: undefined
    }
    expect(radioPaceLevelOf(web)).toBe(RADIO_PACE_ANCHORS.fast)
    expect(radioPaceLevelOf({ ...web, paceLevel: 93 })).toBe(93)
  })
})

const at = (paceLevel: number, phraseBars: number, foldMode = false): RadioSettings => ({
  ...DEFAULT_RADIO_SETTINGS,
  paceLevel,
  phraseBars,
  foldMode
})

describe('radioCadenceOf', () => {
  it("reproduces today at the anchors: the chip's window, the runtime's phrase, one row", () => {
    for (const word of ['slow', 'mid', 'fast'] as const) {
      for (const base of [0, 16, 32]) {
        const c = radioCadenceOf(at(RADIO_PACE_ANCHORS[word], base))
        expect(c.window).toEqual(RADIO_PACE_BARS[word])
        expect(c.phraseBars).toBe(base)
        expect(c.turnaroundPhraseBars).toBe(base)
        expect(c.barEvery).toBeNull()
        expect(c.rows).toBe(1)
      }
    }
  })

  it('shortens the change phrase above fast; the turnaround phrase never moves', () => {
    for (let level = 0; level <= 100; level++) {
      const c = radioCadenceOf(at(level, 16))
      expect(c.turnaroundPhraseBars).toBe(16)
      expect(c.phraseBars).toBeLessThanOrEqual(16)
    }
    expect(radioCadenceOf(at(55, 16)).phraseBars).toBe(8)
    expect(radioCadenceOf(at(75, 16)).phraseBars).toBe(0)
  })

  it('no level: exactly the old reading -- the pinned window, the phrase, one row', () => {
    const legacy: RadioSettings = {
      ...DEFAULT_RADIO_SETTINGS,
      paceLevel: undefined,
      paceBars: { min: 4, max: 4 },
      phraseBars: 16
    }
    expect(radioCadenceOf(legacy)).toEqual({
      level: radioPaceLevelOf(legacy),
      window: { min: 4, max: 4 },
      phraseBars: 16,
      turnaroundPhraseBars: 16,
      barEvery: null,
      rows: 1,
      fold: false
    })
  })

  it('no level: `level` is still a plain number -- read, spread or serialised -- fold mode too', () => {
    for (const foldMode of [false, true]) {
      const legacy: RadioSettings = {
        ...DEFAULT_RADIO_SETTINGS,
        paceLevel: undefined,
        foldMode,
        paceBars: { min: 5, max: 9 },
        phraseBars: 16
      }
      const c = radioCadenceOf(legacy)
      const level = radioPaceLevelOf(legacy)
      expect(c.level).toBe(level)
      expect(c.level).toBe(level)
      expect({ ...c }.level).toBe(level)
      expect(JSON.parse(JSON.stringify(c)).level).toBe(level)
      expect(c.fold).toBe(foldMode)
      expect(c.window).toEqual(foldMode ? FOLD_PACE_BARS : { min: 5, max: 9 })
    }
  })

  it('fold mode keeps its own window, tops, one row', () => {
    const c = radioCadenceOf(at(100, 16, true))
    expect(c.window).toEqual(FOLD_PACE_BARS)
    expect(c.phraseBars).toBe(16)
    expect(c.barEvery).toBeNull()
    expect(c.rows).toBe(1)
    expect(c.fold).toBe(true)
  })
})

describe('radioPaceWindowOf', () => {
  it('a saved level wins over a stale chip window; no level is the window as stored', () => {
    const saved: RadioSettings = {
      ...DEFAULT_RADIO_SETTINGS,
      pace: 'slow',
      paceBars: { ...RADIO_PACE_BARS.slow },
      paceLevel: RADIO_PACE_ANCHORS.fast
    }
    expect(radioPaceWindowOf(saved)).toEqual(RADIO_PACE_BARS.fast)
    expect(radioPaceWindowOf(saved)).toEqual(radioCadenceOf(saved).window)
    expect(
      radioPaceWindowOf({ ...saved, paceLevel: undefined, paceBars: { min: 4, max: 4 } })
    ).toEqual({
      min: 4,
      max: 4
    })
    expect(radioPaceWindowOf({ ...saved, foldMode: true })).toEqual(FOLD_PACE_BARS)
  })
})

describe('radioPaceGridBars', () => {
  it('below the bar band it is radioGridBars', () => {
    for (const [loopEnd, loop, out, inc] of [
      [4, 8, 2, 2],
      [4, 8, 8, 2],
      [0, 8, 2, 2],
      [4, 8, null, 2]
    ] as const) {
      expect(radioPaceGridBars(null, loopEnd, loop, out, inc)).toBe(
        radioGridBars(loopEnd, loop, out === null || inc === null ? null : Math.max(out, inc))
      )
    }
  })

  it('in the band any stem no longer than the loop lands on the bar lines, coarsened to divide the loop', () => {
    expect(radioPaceGridBars(4, 0, 8, 8, 8)).toBe(4)
    expect(radioPaceGridBars(2, 0, 8, 8, 8)).toBe(2)
    expect(radioPaceGridBars(1, 4, 8, 8, 8)).toBe(1)
    expect(radioPaceGridBars(4, 0, 6, 6, 6)).toBe(6)
    expect(radioPaceGridBars(4, 0, 2, 2, 2)).toBe(2)
    // a finer own cycle (a 1-bar stem under loop end 4) is kept
    expect(radioPaceGridBars(4, 4, 8, 1, 1)).toBe(1)
    // fractional stems enter at their matching position too
    expect(radioPaceGridBars(2, 0, 8, 8, 1.5)).toBe(2)
  })

  it("a loop the profile's grid does not divide gets the next coarser divisor, never a finer one", () => {
    const grid = (level: number, loop: number): number =>
      radioPaceGridBars(radioCadenceOf(at(level, 16)).barEvery, 0, loop, loop, loop)
    // levels 80 / 90 / 100 are every 4 / 2 / 1 bars
    expect([80, 90, 100].map((l) => radioCadenceOf(at(l, 16)).barEvery)).toEqual([4, 2, 1])
    expect([80, 90, 100].map((l) => grid(l, 5))).toEqual([5, 5, 1])
    expect([80, 90, 100].map((l) => grid(l, 6))).toEqual([6, 2, 1])
    expect([80, 90, 100].map((l) => grid(l, 7))).toEqual([7, 7, 1])
    for (const loop of [5, 6, 7]) {
      for (const level of [80, 90, 100]) {
        const every = radioCadenceOf(at(level, 16)).barEvery as number
        const g = grid(level, loop)
        expect(loop % g).toBe(0)
        expect(g).toBeGreaterThanOrEqual(Math.min(every, loop))
      }
    }
  })

  it('a change that would SHORTEN the loop waits for the top (the engine would snap the playhead to 0)', () => {
    // pace 90 (every 2): an 8-bar pad over a 4-bar bass and 2-bar drums, the pad row drawing a
    // 4-bar pad -- the loop after the change is 4, so a landing at bar 6 would be past its end
    expect(radioPaceGridBars(2, 4, 8, 8, 4, 4)).toBe(radioGridBars(4, 8, 8))
    expect(radioPaceGridBars(2, 4, 8, 8, 4, 4)).toBe(8)
    // another row keeps the loop at 8: the bar lines stand
    expect(radioPaceGridBars(2, 4, 8, 8, 4, 8)).toBe(2)
    // unknown (omitted or null) post-change length: as before
    expect(radioPaceGridBars(2, 4, 8, 8, 4)).toBe(2)
    expect(radioPaceGridBars(2, 4, 8, 8, 4, null)).toBe(2)
    // below the band nothing changes
    expect(radioPaceGridBars(null, 4, 8, 2, 2, 4)).toBe(radioGridBars(4, 8, 2))
  })

  it('an unknown or longer incoming stem, or a fractional loop, still waits for the top', () => {
    expect(radioPaceGridBars(1, 0, 8, 8, null)).toBe(8)
    expect(radioPaceGridBars(1, 0, 4, 4, 8)).toBe(4)
    expect(radioPaceGridBars(1, 0, 2.5, 2.5, 2)).toBe(2.5)
  })
})

describe('radioGridLineAtOrAfter', () => {
  it('the next line in the lap, else the wrap', () => {
    expect(radioGridLineAtOrAfter(0.2, 1, 8)).toBe(1)
    expect(radioGridLineAtOrAfter(2, 2, 8)).toBe(2)
    expect(radioGridLineAtOrAfter(2.0000000001, 2, 8)).toBe(2)
    expect(radioGridLineAtOrAfter(6.5, 2, 8)).toBe(8)
    expect(radioGridLineAtOrAfter(7.9, 4, 8)).toBe(8)
    expect(radioGridLineAtOrAfter(3, 0, 8)).toBe(8)
  })
})

describe('radioBarLandingAim', () => {
  it('keeps the bar radioChangeLandsAtBar named when a stage has time to get there', () => {
    expect(radioBarLandingAim(6, 5.03, 1, 8, RADIO_BAR_STAGE_LEAD_BARS)).toBe(6)
    expect(radioBarLandingAim(4, 1, 2, 8, 0.25)).toBe(4)
    // exactly the lead is still in time
    expect(radioBarLandingAim(6, 5.75, 1, 8, 0.25)).toBe(6)
  })

  it('a bar closer than the lead moves on to the next line of the grid', () => {
    expect(radioBarLandingAim(6, 5.9, 1, 8, 0.25)).toBe(7)
    expect(radioBarLandingAim(4, 3.95, 2, 8, 0.25)).toBe(6)
  })

  it('no line left in the lap, or a bar at or past the loop end: the loop top (undefined)', () => {
    expect(radioBarLandingAim(7, 6.9, 1, 8, 0.25)).toBeUndefined()
    expect(radioBarLandingAim(4, 3.9, 4, 8, 0.25)).toBeUndefined()
    // the loop shrank under a held bar
    expect(radioBarLandingAim(6, 1, 2, 4, 0.25)).toBeUndefined()
    expect(radioBarLandingAim(4, 1, 2, 4, 0)).toBeUndefined()
  })

  it('a zero lead is the bar as named (below the bar band nothing is re-aimed)', () => {
    expect(radioBarLandingAim(6, 5.99, 1, 8, 0)).toBe(6)
  })
})

describe('radioCadenceTransition', () => {
  it('mid-loop in the bar band is a cut; a loop top keeps its transition; below the band nothing changes', () => {
    expect(radioCadenceTransition({ barEvery: 1 }, 'bloom', false)).toBe('cut')
    expect(radioCadenceTransition({ barEvery: 1 }, 'bloom', true)).toBe('bloom')
    expect(radioCadenceTransition({ barEvery: null }, 'bloom', false)).toBe('bloom')
  })
})

describe('radioClockForPace', () => {
  const clock = (over: Partial<RadioClock>): RadioClock => ({
    ...createRadioClock(12, 1.5),
    ...over
  })
  const cadence = (
    min: number,
    max: number,
    phraseBars: number,
    turnaroundPhraseBars = 16
  ): {
    window: { min: number; max: number }
    phraseBars: number
    turnaroundPhraseBars: number
  } => ({
    window: { min, max },
    phraseBars,
    turnaroundPhraseBars
  })

  it('redraws the interval only when it is longer than the new window; elapsed bars kept', () => {
    const random = vi.fn(() => 0)
    const faster = radioClockForPace(
      clock({ intervalBars: 40, barsElapsed: 7 }),
      cadence(1, 2, 0),
      4,
      random
    )
    expect(faster.intervalBars).toBe(1)
    expect(faster.barsElapsed).toBe(7)
    expect(random).toHaveBeenCalledTimes(1)
    const slower = radioClockForPace(clock({ intervalBars: 3 }), cadence(24, 48, 16), 4, random)
    expect(slower.intervalBars).toBe(3)
    expect(random).toHaveBeenCalledTimes(1)
  })

  it("fold mode: a move leaves fold's stretched interval alone (its snap to a realignment top), no draw", () => {
    const random = vi.fn(() => 0)
    const fold = radioCadenceOf({ ...DEFAULT_RADIO_SETTINGS, foldMode: true, paceLevel: 100 })
    expect(72).toBeGreaterThan(fold.window.max)
    const moved = radioClockForPace(clock({ intervalBars: 72, barsElapsed: 9 }), fold, 8, random)
    expect(moved.intervalBars).toBe(72)
    expect(moved.barsElapsed).toBe(9)
    expect(random).not.toHaveBeenCalled()
    // the largest stretch radioFoldIntervalBars can actually give on an 8-bar loop
    const stretched = fold.window.max + FOLD_PREFER_WAIT_LAPS * 8
    expect(
      radioClockForPace(clock({ intervalBars: stretched }), fold, 8, random).intervalBars
    ).toBe(stretched)
    expect(random).not.toHaveBeenCalled()
  })

  it('re-anchors the change phrase on the turnaround phrase when it divides it', () => {
    // a 4-bar loop, lap 2 of the 16-bar turnaround phrase, change phrase counter out of step
    const c = clock({ turnaroundLap: 2, lapsSincePhrase: 0 })
    expect(radioClockForPace(c, cadence(3, 6, 8), 4).lapsSincePhrase).toBe(0) // 2 % 2
    expect(radioClockForPace(c, cadence(3, 6, 16), 4).lapsSincePhrase).toBe(2)
    expect(radioClockForPace({ ...c, turnaroundLap: 3 }, cadence(3, 6, 8), 4).lapsSincePhrase).toBe(
      1
    )
    // no change phrase: left alone (advanceRadioClock zeroes it)
    expect(
      radioClockForPace({ ...c, lapsSincePhrase: 5 }, cadence(1, 2, 0), 4).lapsSincePhrase
    ).toBe(5)
  })

  it('after a mid-stream move, a change phrase top is a turnaround phrase top (or a division of one)', () => {
    const random = seeded(7)
    for (const loop of [1, 2, 4, 8]) {
      for (const laps of [1, 2, 3, 5]) {
        // a 4-bar change phrase for a few laps, then slowed to 16: every change lands on lap 0
        // of the turnaround's phrase, where a phrase end's turnaround leads into it
        let r = run(createRadioClock(1, 0), laps, loop, 4, 16)
        r = run(
          radioClockForPace(r.clock, cadence(3, 6, 16), loop, random),
          64 / loop,
          loop,
          16,
          16
        )
        expect(r.dues.length).toBeGreaterThan(0)
        expect(r.dueLaps.every((l) => l === 0)).toBe(true)
        // and sped up to 8: every change on an even lap of it
        r = run(radioClockForPace(r.clock, cadence(3, 6, 8), loop, random), 64 / loop, loop, 8, 16)
        const per = Math.max(1, Math.round(8 / loop))
        expect(r.dueLaps.every((l) => l % per === 0)).toBe(true)
      }
    }
  })

  it('without the re-anchor, a phrase that grows mid-stream drifts off the turnarounds (why it exists)', () => {
    let r = run(createRadioClock(1, 0), 3, 4, 4, 16)
    r = run(r.clock, 16, 4, 16, 16)
    expect(r.dueLaps.some((l) => l !== 0)).toBe(true)
  })
})

describe('radioPhraseReanchored / radioPhraseNeedsReanchor (a phrase or loop moving under a running clock)', () => {
  it('fold on mid-stream above fast: the change phrase grows 0 -> 16 and stays on the turnarounds', () => {
    // phrase 16, pace 75, a 4-bar loop: no change phrase (every loop top) until fold mode turns on
    // at turnaround lap 3, which brings the base 16 back as the change phrase
    const loose = radioCadenceOf({ ...DEFAULT_RADIO_SETTINGS, phraseBars: 16, paceLevel: 75 })
    const fold = radioCadenceOf({
      ...DEFAULT_RADIO_SETTINGS,
      phraseBars: 16,
      paceLevel: 75,
      foldMode: true
    })
    expect(loose.phraseBars).toBe(0)
    expect(fold.phraseBars).toBe(16)
    const before = run(createRadioClock(1, 0), 3, 4, loose.phraseBars, loose.turnaroundPhraseBars)
    expect(before.clock.turnaroundLap).toBe(3)
    const prev = { phraseBars: loose.phraseBars, turnaroundPhraseBars: 16, loopBars: 4 }
    const next = { phraseBars: fold.phraseBars, turnaroundPhraseBars: 16, loopBars: 4 }
    expect(radioPhraseNeedsReanchor(prev, next)).toBe(true)
    // without it: every later change lands on turnaround lap 2
    const drift = run(before.clock, 16, 4, 16, 16)
    expect(drift.dueLaps.some((l) => l !== 0)).toBe(true)
    const fixed = run(radioPhraseReanchored(before.clock, fold, 4), 16, 4, 16, 16)
    expect(fixed.dues.length).toBeGreaterThan(0)
    expect(fixed.dueLaps.every((l) => l === 0)).toBe(true)
  })

  it('a loop that grows under a shorter change phrase stays on the turnarounds, even past the old phrase', () => {
    // change phrase 8, turnaround 16: on a 2-bar loop 4 and 8 laps; six laps in, the loop grows
    // to 4 bars (2 and 4 laps), so turnaroundLap 6 is past the new phrase and folds to 0 at the
    // next wrap -- which must also be a change phrase top
    const before = run(createRadioClock(1, 0), 6.5, 2, 8, 16)
    expect(before.clock.turnaroundLap).toBe(6)
    const c = { phraseBars: 8, turnaroundPhraseBars: 16 }
    expect(radioPhraseNeedsReanchor({ ...c, loopBars: 2 }, { ...c, loopBars: 4 })).toBe(true)
    const fixed = run(radioPhraseReanchored(before.clock, c, 4), 32, 4, 8, 16)
    expect(fixed.dues.length).toBeGreaterThan(0)
    expect(fixed.dueLaps.every((l) => l % 2 === 0)).toBe(true)
    // a plain modulo (6 % 2 = 0) would put the next phrase top on turnaround lap 1
    const modulo = run({ ...before.clock, lapsSincePhrase: 0 }, 32, 4, 8, 16)
    expect(modulo.dueLaps.some((l) => l % 2 !== 0)).toBe(true)
  })

  it('anchors to turnaroundLap modulo the change phrase inside the phrase; leaves it when it cannot', () => {
    const c = { ...createRadioClock(12, 0), turnaroundLap: 3, lapsSincePhrase: 0 }
    expect(
      radioPhraseReanchored(c, { phraseBars: 8, turnaroundPhraseBars: 16 }, 4).lapsSincePhrase
    ).toBe(1)
    // no change phrase, a phrase that does not divide, no loop: the clock comes back as it was
    expect(radioPhraseReanchored(c, { phraseBars: 0, turnaroundPhraseBars: 16 }, 4)).toBe(c)
    expect(radioPhraseReanchored(c, { phraseBars: 12, turnaroundPhraseBars: 16 }, 4)).toBe(c)
    expect(radioPhraseReanchored(c, { phraseBars: 8, turnaroundPhraseBars: 16 }, 0)).toBe(c)
    // never touches the interval
    const r = radioPhraseReanchored(
      { ...c, intervalBars: 99, barsElapsed: 5 },
      { phraseBars: 8, turnaroundPhraseBars: 16 },
      4
    )
    expect([r.intervalBars, r.barsElapsed]).toEqual([99, 5])
  })

  it('needs a re-anchor only when something moved and the two phrases differ, before or after', () => {
    const a = { phraseBars: 16, turnaroundPhraseBars: 16, loopBars: 4 }
    expect(radioPhraseNeedsReanchor(null, a)).toBe(false)
    expect(radioPhraseNeedsReanchor(a, { ...a })).toBe(false)
    // at or below fast the two are one number: a loop or `phrase` chip change is as before
    expect(radioPhraseNeedsReanchor(a, { ...a, loopBars: 8 })).toBe(false)
    expect(
      radioPhraseNeedsReanchor(a, { phraseBars: 32, turnaroundPhraseBars: 32, loopBars: 4 })
    ).toBe(false)
    // above fast they differ: a loop change, a chip change, fold on or off
    const fast = { phraseBars: 4, turnaroundPhraseBars: 16, loopBars: 4 }
    expect(radioPhraseNeedsReanchor(fast, { ...fast, loopBars: 8 })).toBe(true)
    expect(
      radioPhraseNeedsReanchor(fast, { phraseBars: 8, turnaroundPhraseBars: 32, loopBars: 4 })
    ).toBe(true)
    expect(radioPhraseNeedsReanchor(fast, a)).toBe(true)
    expect(radioPhraseNeedsReanchor(a, fast)).toBe(true)
  })
})

describe('pickRadioSlotIds', () => {
  it("count 1 is pickRadioSlotId's answer with the same random calls", () => {
    for (let seed = 0; seed < 50; seed++) {
      const ids = ['a', 'b', 'c', 'd']
      const opts = { turnover: 'even' as const, changedAt: new Map([['a', 1]]), turn: 4 }
      const r1 = seeded(seed)
      const r2 = seeded(seed)
      expect(pickRadioSlotIds(ids, 'b', 1, { ...opts, random: r1 })).toEqual([
        pickRadioSlotId(ids, 'b', { ...opts, random: r2 })
      ])
      expect(r1()).toBe(r2())
    }
  })

  it('distinct rows, at most the eligible ones, none for none', () => {
    const r = seeded(3)
    const got = pickRadioSlotIds(['a', 'b', 'c'], null, 5, { random: r })
    expect(new Set(got).size).toBe(3)
    expect(pickRadioSlotIds([], null, 3)).toEqual([])
    expect(pickRadioSlotIds(['a', 'b'], 'a', 0)).toEqual([])
  })
})
