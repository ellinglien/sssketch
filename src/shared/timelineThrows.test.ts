import { describe, expect, it, vi } from 'vitest'
import { initialState, type AppState } from '../renderer/src/state/store'
import { buildEngineProject } from './buildEngineProject'
import { normalizeSoundSettings, type SoundSettings, type ThrowRate } from './radioSound'
import { throwTailSec } from './radioThrows'
import {
  clipLane,
  planArrangementThrows,
  dubThrowsForPlan,
  timelineDubThrows,
  timelineThrowPlan,
  type ArrangementThrowPlan
} from './timelineThrows'
import { stemKey, type Rifff, type SoundType, type Stem } from './types'
import { createRiser } from './riser'

const stem = (slot: number, type: SoundType, extra: Partial<Stem> = {}): Stem => ({
  slot,
  author: 'e',
  name: `${type}${slot}`,
  type,
  path: `/${type}${slot}.wav`,
  durationSec: 2 * 64,
  barLength: 64,
  ...extra
})

/** A rifff of drums, bass, notes and fx, `bars` long, at `startBar`. */
const band = (groupId: string, startBar: number, bars = 64): Rifff => ({
  groupId,
  name: groupId,
  bpm: 120,
  barLength: bars,
  folderPath: '/x',
  startBar,
  stems: [
    stem(1, 'drums', { durationSec: 2 * bars, barLength: bars }),
    stem(2, 'bass', { durationSec: 2 * bars, barLength: bars }),
    stem(3, 'notes', { durationSec: 2 * bars, barLength: bars }),
    stem(4, 'fx', { durationSec: 2 * bars, barLength: bars })
  ]
})

const throwsAt = (rate: ThrowRate = 'normal', on = true, level = 1): SoundSettings => {
  const s = normalizeSoundSettings(undefined)
  s.throws = { on, rate, level }
  return s
}

const project = (overrides: Partial<AppState> = {}): AppState => ({
  ...initialState,
  bpm: 120,
  rifffs: { a: band('a', 0, 256) },
  sound: throwsAt(),
  projectSeed: 'seed-1',
  ...overrides
})

const plan = (state: AppState): ArrangementThrowPlan => {
  const p = timelineThrowPlan(state)
  if (!p) throw new Error('no plan')
  return p
}

/** The echo's busy span after a throw, in bars, as stepThrows measures it. */
const tailBars = (p: ArrangementThrowPlan): number =>
  throwTailSec((p.echo.timing === 'quarter' ? 1 : 0.75) / 4, p.echo.feedback)

describe('planArrangementThrows (native radio sound plan, Task 12)', () => {
  it('the same project plans the same throws; another seed plans others', () => {
    const first = plan(project())
    expect(first.throws.length).toBeGreaterThan(3)
    expect(plan(project())).toEqual(first)
    // a copy of the state, not the same object: nothing hangs on identity
    expect(plan(structuredClone(project()))).toEqual(first)
    expect(plan(project({ projectSeed: 'seed-2' })).throws).not.toEqual(first.throws)
    // no seed at all is a seed too: stable
    expect(plan(project({ projectSeed: undefined }))).toEqual(
      plan(project({ projectSeed: undefined }))
    )
  })

  it('a throw is on a beat, never while the last one rings (busyUntil), never on drums or bass', () => {
    for (const seed of ['s1', 's2', 's3', 's4', 's5']) {
      for (const rate of ['rare', 'normal', 'often'] as const) {
        const p = plan(project({ projectSeed: seed, sound: throwsAt(rate) }))
        let busyUntil = -Infinity
        for (const t of p.throws) {
          expect(t.atBar * 4).toBe(Math.round(t.atBar * 4))
          expect(t.atBar).toBeGreaterThanOrEqual(busyUntil)
          busyUntil = t.atBar + t.beats / 4 + tailBars(p)
          expect([1, 2]).toContain(t.beats)
          expect([stemKey('a', 3), stemKey('a', 4)]).toContain(t.stemKey)
        }
      }
    }
  })

  it("a throw waits for the last one's echo, and gives way when the wait reaches the next", () => {
    // With one echo per project no throw ever waits (its tail is shorter than the shortest gap),
    // so the tail is injected. Every row is eligible everywhere here, so with no tail each
    // candidate throws on the beat at or after it: those are the candidates' beats.
    const long = project({ rifffs: { a: band('a', 0, 4096) } })
    const free = planArrangementThrows(long, { rate: 'normal' }, 'wait', { tailBars: 0 }).throws
    expect(free.length).toBeGreaterThan(100)
    for (const tail of [28, 40]) {
      const waited = planArrangementThrows(long, { rate: 'normal' }, 'wait', { tailBars: tail })
      // the rule, simulated over the candidates' beats: wait for the tail (on a beat), give way
      // to the next candidate if the wait reaches it (a beat at or past a candidate is at or past
      // its beat), keep each candidate's own length
      // (and a late throw that would run past the arrangement's end is not thrown)
      const want: { atBar: number; beats: number }[] = []
      let busy = -Infinity
      free.forEach((c, k) => {
        const at = Math.max(c.atBar, Math.ceil(busy * 4 - 1e-9) / 4)
        if (k + 1 < free.length && at >= free[k + 1].atBar) return
        if (at + c.beats / 4 > 4096) return
        want.push({ atBar: at, beats: c.beats })
        busy = at + c.beats / 4 + tail
      })
      expect(waited.throws.map(({ atBar, beats }) => ({ atBar, beats }))).toEqual(want)
      // and both happened: some throws were late, some candidates gave way
      expect(want.some((w) => !free.some((f) => f.atBar === w.atBar))).toBe(true)
      expect(want.length).toBeLessThan(free.length)
    }
  })

  it('never on a muted stem, nor one turned to 0; nothing to throw is no throw', () => {
    const base = project()
    const mutedNotes = plan(project({ mute: { [stemKey('a', 3)]: true } }))
    expect(mutedNotes.throws.length).toBeGreaterThan(0)
    expect(mutedNotes.throws.every((t) => t.stemKey === stemKey('a', 4))).toBe(true)
    const silentFx = plan(project({ vol: { [stemKey('a', 4)]: 0 } }))
    expect(silentFx.throws.every((t) => t.stemKey === stemKey('a', 3))).toBe(true)
    // only drums and bass left: no throws at all
    const floorOnly = plan(project({ mute: { [stemKey('a', 3)]: true, [stemKey('a', 4)]: true } }))
    expect(floorOnly.throws).toEqual([])
    // and the candidates are where they were: muting a row only removes ITS throws
    const both = plan(base).throws
    for (const t of mutedNotes.throws) expect(both.map((b) => b.atBar)).toContain(t.atBar)
  })

  it('honours the rate: a throw every 32-64 / 16-32 / 8-16 bars', () => {
    const long = project({ rifffs: { a: band('a', 0, 4096) } })
    const mean: Record<string, number> = {}
    for (const [rate, [lo, hi]] of [
      ['rare', [32, 64]],
      ['normal', [16, 32]],
      ['often', [8, 16]]
    ] as const) {
      const p = plan({ ...long, sound: throwsAt(rate) })
      const gaps = p.throws.slice(1).map((t, i) => t.atBar - p.throws[i].atBar)
      // a candidate every lo..hi bars, the throw on the beat at or after it; nothing defers it
      // (the echo is shorter than the shortest gap)
      for (const g of gaps) {
        expect(g).toBeGreaterThanOrEqual(lo - 0.25)
        expect(g).toBeLessThanOrEqual(hi + 0.25)
      }
      expect(p.throws[0].atBar).toBeGreaterThanOrEqual(lo)
      expect(p.throws[0].atBar).toBeLessThanOrEqual(hi + 0.25)
      mean[rate] = gaps.reduce((a, b) => a + b, 0) / gaps.length
      expect(mean[rate]).toBeGreaterThan(lo + (hi - lo) * 0.35)
      expect(mean[rate]).toBeLessThan(lo + (hi - lo) * 0.65)
    }
    expect(mean.often).toBeLessThan(mean.normal)
    expect(mean.normal).toBeLessThan(mean.rare)
  })

  it('picks evenly among the eligible rows', () => {
    const long = project({ rifffs: { a: band('a', 0, 8192) }, sound: throwsAt('often') })
    const p = plan(long)
    const notes = p.throws.filter((t) => t.stemKey === stemKey('a', 3)).length
    expect(p.throws.length).toBeGreaterThan(500)
    expect(notes / p.throws.length).toBeGreaterThan(0.42)
    expect(notes / p.throws.length).toBeLessThan(0.58)
    // and the beats: one or two, about evenly
    const ones = p.throws.filter((t) => t.beats === 1).length
    expect(ones / p.throws.length).toBeGreaterThan(0.42)
    expect(ones / p.throws.length).toBeLessThan(0.58)
  })

  it('one echo per project, drawn from the seed alone (not the rate), within the web range', () => {
    const echoes = new Set<string>()
    for (const seed of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) {
      const normal = plan(project({ projectSeed: seed })).echo
      expect(plan(project({ projectSeed: seed, sound: throwsAt('rare') })).echo).toEqual(normal)
      expect(normal.feedback).toBeGreaterThanOrEqual(0.45)
      expect(normal.feedback).toBeLessThanOrEqual(0.6)
      echoes.add(normal.timing)
    }
    expect(echoes).toEqual(new Set(['dotted-eighth', 'quarter']))
  })

  it('an edit elsewhere leaves the other throws where they were', () => {
    // two rifffs, one after the other; muting, moving or growing something in the second leaves
    // every throw in the first exactly as it was
    const two = project({ rifffs: { a: band('a', 0, 128), b: band('b', 128, 128) } })
    const before = plan(two).throws
    const inA = before.filter((t) => t.atBar + t.beats / 4 <= 128)
    expect(inA.length).toBeGreaterThan(2)
    const edits: Partial<AppState>[] = [
      { mute: { [stemKey('b', 3)]: true } },
      { muteRegions: { [stemKey('b', 4)]: [{ startBar: 140, endBar: 180 }] } },
      { playedBars: { b: 64 } },
      { vol: { [stemKey('b', 3)]: 0 } }
    ]
    for (const edit of edits) {
      const after = plan({ ...two, ...edit }).throws
      expect(after.filter((t) => t.atBar + t.beats / 4 <= 128)).toEqual(inA)
    }
    // a third rifff placed beside the first changes only the throws it wins
    const three = plan({ ...two, rifffs: { ...two.rifffs, c: band('c', 0, 128) } }).throws
    const moved = inA.filter(
      (t) => !three.some((u) => u.atBar === t.atBar && u.stemKey === t.stemKey)
    )
    for (const t of moved) {
      const now = three.find((u) => u.atBar === t.atBar)
      expect(now?.stemKey.startsWith('c:')).toBe(true)
    }
    expect(moved.length).toBeLessThan(inA.length)
  })

  it('never over a mute region, over a riser, or where the drawn volume is 0 throughout', () => {
    const base = plan(project())
    const first = base.throws[0]
    const end = first.atBar + first.beats / 4
    // a mute region over the first throw's row: that throw goes to the other row or nowhere
    const region = plan(
      project({
        muteRegions: { [first.stemKey]: [{ startBar: first.atBar + 0.1, endBar: end + 4 }] }
      })
    )
    expect(region.throws.some((t) => t.atBar === first.atBar && t.stemKey === first.stemKey)).toBe(
      false
    )
    // a riser over it: no throw there at all, the rest unchanged
    const riser = createRiser({ id: 'r', channelId: 'a', startBar: first.atBar - 1 })
    const withRiser = plan(project({ risers: { r: { ...riser, lengthBars: 2 } } }))
    expect(withRiser.throws.some((t) => t.atBar === first.atBar)).toBe(false)
    expect(withRiser.throws).toEqual(base.throws.slice(1))
    // the row's drawn volume at 0 over the throw (clip-relative bars; this clip starts at 0)
    const quiet = plan(
      project({
        stemAutomation: {
          [first.stemKey]: {
            volume: [
              { bar: first.atBar - 1, value: 0 },
              { bar: end + 1, value: 0 }
            ]
          }
        }
      })
    )
    expect(quiet.throws.some((t) => t.atBar === first.atBar && t.stemKey === first.stemKey)).toBe(
      false
    )
  })

  it('a throw near a clip end is dropped rather than cut; one that just fits stays', () => {
    // one throwing row only, so the candidate is either that row's or no one's; a longer rifff
    // with nothing to throw keeps the arrangement going past the clip's end
    const solo = (bars: number): AppState =>
      project({
        rifffs: { a: band('a', 0, 256), b: band('b', 0, 512) },
        playedBars: { a: bars },
        mute: {
          [stemKey('a', 4)]: true,
          [stemKey('b', 3)]: true,
          [stemKey('b', 4)]: true
        }
      })
    const first = plan(solo(256)).throws[0]
    const end = first.atBar + first.beats / 4
    expect(plan(solo(end)).throws[0]).toEqual(first)
    const cut = plan(solo(end - 0.125)).throws
    expect(cut.some((t) => t.atBar === first.atBar)).toBe(false)
  })

  it('a one-shot throws only while its sample sounds', () => {
    // a 3 s one-shot (1.5 bars at 120 bpm) at bar 20, with a clip much longer than that
    const shot: Rifff = {
      ...band('s', 20, 64),
      stems: [stem(1, 'fx', { oneShot: true, durationSec: 3, barLength: 64 })]
    }
    for (const seed of ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10']) {
      const p = plan(project({ rifffs: { s: shot }, projectSeed: seed, sound: throwsAt('often') }))
      for (const t of p.throws) {
        expect(t.atBar).toBeGreaterThanOrEqual(20)
        expect(t.atBar + t.beats / 4).toBeLessThanOrEqual(21.5)
      }
    }
  })

  it('is cheap: a 400-stem, 512-bar arrangement plans in well under a frame', () => {
    const rifffs: Record<string, Rifff> = {}
    for (let i = 0; i < 100; i += 1) rifffs[`g${i}`] = band(`g${i}`, (i * 5) % 448, 64)
    const big = project({ rifffs, sound: throwsAt('often') })
    planArrangementThrows(big, { rate: 'often' }, 'warm')
    const t0 = performance.now()
    for (let i = 0; i < 10; i += 1) planArrangementThrows(big, { rate: 'often' }, `x${i}`)
    const each = (performance.now() - t0) / 10
    expect(each).toBeLessThan(16)
  })
})

describe('timelineDubThrows (the plan as buildEngineProject draws it)', () => {
  it('nothing with throws off, at level 0, with no sound settings, or no tempo', () => {
    expect(timelineDubThrows(project({ sound: throwsAt('normal', false) }))).toBeUndefined()
    expect(timelineDubThrows(project({ sound: throwsAt('normal', true, 0) }))).toBeUndefined()
    expect(timelineDubThrows(project({ sound: undefined }))).toBeUndefined()
    expect(timelineDubThrows(project({ bpm: 0 }))).toBeUndefined()
    expect(timelineDubThrows(project())).toBeDefined()
  })

  it('clip-relative curves: a clip that starts mid-arrangement, left-cropped and offset', async () => {
    // placed at bar 8, the first 2 bars cropped, nudged 4 sixteenths later: the lane starts at
    // 8 + 2 + 0.25 = 10.25
    const state = project({
      rifffs: { a: band('a', 8, 256) },
      leftCrop: { a: 2 },
      off: { a: 4 },
      snapIdx: 4
    })
    const lane = clipLane(state, 'a')!
    expect(lane.originBar).toBe(10.25)
    expect(lane.lengthBars).toBe(254)
    const p = plan(state)
    for (const t of p.throws) {
      expect(t.atBar).toBeGreaterThanOrEqual(10.25)
      expect(t.atBar + t.beats / 4).toBeLessThanOrEqual(10.25 + 254)
    }
    const dub = dubThrowsForPlan(state, p)!
    expect(dub.echo).toEqual(p.echo)
    for (const t of p.throws) {
      const curve = dub.sends.get(t.stemKey)!
      // the throw's four points, at clip-relative bars: 0 at the start, 5 ms ramps (at 2 s a bar)
      const at = t.atBar - 10.25
      const end = at + t.beats / 4
      const ramp = 0.005 / 2
      const i = curve.findIndex((pt) => Math.abs(pt.bar - at) < 1e-9)
      expect(i).toBeGreaterThanOrEqual(0)
      expect(curve[i].value).toBe(0)
      expect(curve[i + 1].bar).toBeCloseTo(at + ramp, 12)
      expect(curve[i + 1].value).toBe(1)
      expect(curve[i + 2].bar).toBeCloseTo(end - ramp, 12)
      expect(curve[i + 3]).toEqual({ bar: end, value: 0 })
    }
    // through the builder: on the throwing stems' toolkits, with the lane's origin, and the echo
    const wire = await buildEngineProject(state, vi.fn(), { plugins: [] }, {}, { dubThrows: dub })
    const stems = wire.rifffs[0].stems
    for (const s of stems) {
      const sent = dub.sends.get(s.stemKey)
      if (!sent) {
        expect(s.toolkit?.automation.dubSend).toBeUndefined()
        continue
      }
      expect(s.toolkit?.originBar).toBe(10.25)
      expect(s.toolkit?.automation.dubSend).toEqual(sent)
    }
    expect(wire.sound?.dub).toEqual({
      delayBeats: p.echo.timing === 'quarter' ? 1 : 0.75,
      feedback: p.echo.feedback
    })
  })

  it('a stem that throws twice carries both throws on one curve, in order', () => {
    const state = project({
      rifffs: { a: band('a', 0, 2048) },
      mute: { [stemKey('a', 4)]: true }
    })
    const p = plan(state)
    expect(p.throws.length).toBeGreaterThan(10)
    const curve = dubThrowsForPlan(state, p)!.sends.get(stemKey('a', 3))!
    expect(curve.length).toBe(4 * p.throws.length)
    for (let i = 1; i < curve.length; i += 1) expect(curve[i].bar).toBeGreaterThan(curve[i - 1].bar)
  })
})
