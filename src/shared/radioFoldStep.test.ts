import { describe, expect, it } from 'vitest'
import {
  FOLD_DRIFT_RANGE,
  FOLD_MAX_ROWS,
  createRadioFold,
  radioFoldAllowedCycles,
  radioFoldIntervalBars,
  radioFoldMarkedBarsAhead,
  radioFoldTurnaroundRate,
  stepRadioFold,
  type RadioFoldInput,
  type RadioFoldRow,
  type RadioFoldState,
  type RadioFoldStep
} from './radioFold'

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

/** A band: a 4-bar drums anchor, two short rhythmic rows, a lead and a warm pad. */
const BAND: RadioFoldRow[] = [
  row('drums', { kinds: ['drums'], barLength: 4 }),
  row('hats', { kinds: ['drums'], barLength: 1 }),
  row('perc', { kinds: ['rhythmic'], barLength: 2 }),
  row('lead', { kinds: ['lead'], barLength: 4 }),
  row('pad', { kinds: ['warm'], barLength: 4 })
]

const input = (fold: number, rows: RadioFoldRow[] = BAND): RadioFoldInput => ({
  rows,
  loopBars: 4,
  bpm: 120,
  fold
})

function run(
  seed: string,
  wraps: number,
  at: (wrap: number) => RadioFoldInput,
  start: RadioFoldState = createRadioFold(seed)
): RadioFoldStep[] {
  const out: RadioFoldStep[] = []
  let s = start
  for (let i = 0; i < wraps; i++) {
    const step = stepRadioFold(s, at(i))
    out.push(step)
    s = step.state
  }
  return out
}

describe('stepRadioFold: replay', () => {
  it('the same seed and the same steps give the same decisions, over many wraps', () => {
    const a = run('k3x9pq', 300, () => input(70))
    const b = run('k3x9pq', 300, () => input(70))
    expect(b).toEqual(a)
  })

  it('a different seed gives different decisions', () => {
    const a = run('k3x9pq', 300, () => input(70)).map((s) => s.cycles)
    const b = run('autech', 300, () => input(70)).map((s) => s.cycles)
    expect(b).not.toEqual(a)
  })

  it('is pure: the state it was given is untouched', () => {
    const s = createRadioFold('k3x9pq')
    const copy = structuredClone(s)
    stepRadioFold(s, input(70))
    expect(s).toEqual(copy)
  })

  it('decides one lap ahead: the first step is lap 0', () => {
    expect(stepRadioFold(createRadioFold('k3x9pq'), input(40)).lap).toBe(0)
  })
})

describe('stepRadioFold: which rows fold, and how', () => {
  const steps = run('k3x9pq', 400, () => input(90))

  it('never folds the anchor, a melodic row, a warm pad or a long row; at most two at once', () => {
    for (const s of steps) {
      expect(s.cycles.length).toBeLessThanOrEqual(FOLD_MAX_ROWS)
      for (const c of s.cycles) {
        expect(['hats', 'perc']).toContain(c.rowId)
        expect(c.rowId).not.toBe(s.anchorId)
      }
      expect(s.anchorId).toBe('drums')
    }
  })

  it('folds at all, and reaches two rows at a high fold', () => {
    expect(steps.some((s) => s.cycles.length === 2)).toBe(true)
  })

  it('every target is inside the realignment window and shorter than the row', () => {
    const allowed = radioFoldAllowedCycles(16, 120)
    for (const s of steps) {
      for (const r of s.state.rows) {
        if (r.mode === 'unfolding') continue
        expect(allowed).toContain(r.targetBeats)
        expect(r.targetBeats).toBeLessThan(r.fullBeats)
      }
    }
  })

  it('never folds a hooked row', () => {
    const hooked = BAND.map((r) => (r.id === 'perc' ? { ...r, hooked: true } : r))
    for (const s of run('k3x9pq', 200, () => input(90, hooked))) {
      expect(s.cycles.map((c) => c.rowId)).not.toContain('perc')
    }
  })

  it('a low fold keeps to mild lengths (7 or 9) and no phase offset', () => {
    for (const s of run('k3x9pq', 300, () => input(40))) {
      for (const r of s.state.rows) {
        if (r.mode !== 'unfolding') expect([7, 9]).toContain(r.targetBeats)
        expect(r.phaseBeats).toBe(0)
      }
      expect(s.cycles.length).toBeLessThanOrEqual(1)
    }
  })
})

describe('stepRadioFold: curves land on loop tops', () => {
  it('a fold steps from full length toward its target, one length per top, in 2 to 4 steps', () => {
    let checked = 0
    let fourStep = 0
    // 40 keeps to 8 -> 7; 90 reaches 8 -> 3, which takes four distinct lengths
    for (const fold of [40, 90]) {
      const steps = run('k3x9pq', 400, () => input(fold))
      // follow every run of one row's fold, from its first folded lap
      let i = 0
      while (i < steps.length) {
        // a fold's first lap: folding, and not in the lap before
        const before = i > 0 ? steps[i - 1].state.rows.map((r) => r.rowId) : []
        const first = steps[i].state.rows.find(
          (r) => r.mode === 'folding' && !before.includes(r.rowId)
        )
        if (!first) {
          i++
          continue
        }
        const lengths: number[] = []
        let settled = false
        for (let j = i; j < steps.length; j++) {
          const r = steps[j].state.rows.find((x) => x.rowId === first.rowId)
          // a stretch that ends mid-curve turns it back: that is the unfolding test's to check
          if (!r || r.mode === 'unfolding') break
          if (lengths.length === 0 || lengths[lengths.length - 1] !== r.cycleBeats) {
            // each new length starts its cycle on that lap's own top
            expect(r.originLap).toBe(steps[j].lap)
            lengths.push(r.cycleBeats)
          }
          if (r.mode === 'settled') {
            settled = true
            break
          }
        }
        expect(lengths.length).toBeGreaterThanOrEqual(1)
        expect(lengths.length).toBeLessThanOrEqual(4)
        for (let k = 1; k < lengths.length; k++) expect(lengths[k]).toBeLessThan(lengths[k - 1])
        if (settled) {
          expect(lengths[lengths.length - 1]).toBe(first.targetBeats)
          checked++
          if (lengths.length === 4) fourStep++
        }
        i++
      }
    }
    expect(checked).toBeGreaterThan(0)
    // the longest curves are exercised too, not only the short ones
    expect(fourStep).toBeGreaterThan(0)
  })

  it("unfolding walks back the same way: the fold's own lengths in reverse, then full", () => {
    let checked = 0
    for (const fold of [40, 90]) {
      const steps = run('k3x9pq', 600, () => input(fold))
      // every length each row's fold restarted on, from its first folded lap until it leaves
      const open = new Map<string, { out: number[]; back: number[] }>()
      for (const s of steps) {
        for (const [rowId, ep] of open) {
          if (s.state.rows.some((r) => r.rowId === rowId)) continue
          expect(ep.back).toEqual(ep.out.slice(0, -1).reverse())
          if (ep.out.length > 1) checked++
          open.delete(rowId)
        }
        for (const r of s.state.rows) {
          if (r.originLap !== s.lap) continue
          const ep = open.get(r.rowId) ?? { out: [], back: [] }
          open.set(r.rowId, ep)
          ;(r.mode === 'unfolding' ? ep.back : ep.out).push(r.cycleBeats)
        }
      }
    }
    expect(checked).toBeGreaterThan(0)
  })

  it('a cycle id stays while the cycle runs on, and changes when it restarts', () => {
    const steps = run('k3x9pq', 200, () => input(40))
    for (let i = 1; i < steps.length; i++) {
      for (const c of steps[i].cycles) {
        const before = steps[i - 1].cycles.find((x) => x.rowId === c.rowId)
        const r = steps[i].state.rows.find((x) => x.rowId === c.rowId)!
        if (before && r.originLap < steps[i].lap) expect(c.cycleId).toBe(before.cycleId)
        if (r.originLap === steps[i].lap) expect(c.cycleId).not.toBe(before?.cycleId)
      }
    }
  })
})

describe('stepRadioFold: straight and folded stretches', () => {
  it('fold 0 is always straight, and still drifts', () => {
    const steps = run('k3x9pq', 300, () => input(0))
    for (const s of steps) {
      expect(s.cycles).toEqual([])
      expect(s.stretch).toBe('straight')
    }
    expect(Object.keys(steps[10].drift).sort()).toEqual(['drums', 'hats', 'lead', 'pad', 'perc'])
  })

  it('stretches alternate, and a straight stretch empties the folds', () => {
    const steps = run('k3x9pq', 400, () => input(40))
    const kinds = steps.map((s) => s.stretch)
    const changes = kinds.filter((k, i) => i > 0 && k !== kinds[i - 1]).length
    expect(changes).toBeGreaterThanOrEqual(3)
    // somewhere inside a straight stretch, nothing is folded any more
    expect(steps.some((s, i) => i > 20 && s.stretch === 'straight' && s.cycles.length === 0)).toBe(
      true
    )
  })

  it('every straight stretch is heard straight: its laps are counted once the folds are gone', () => {
    for (const fold of [40, 90]) {
      const steps = run('k3x9pq', 600, () => input(fold))
      let runStart = -1
      for (let i = 0; i <= steps.length; i++) {
        const straight = i < steps.length && steps[i].stretch === 'straight'
        if (straight && runStart < 0) runStart = i
        if (!straight && runStart >= 0) {
          if (i < steps.length) {
            const run = steps.slice(runStart, i)
            expect(run.some((s) => s.cycles.length === 0)).toBe(true)
            // and it ends with nothing folded: the next folded stretch starts from straight
            expect(run[run.length - 1].cycles).toEqual([])
          }
          runStart = -1
        }
      }
    }
  })

  it('starts with a folded stretch when fold is above 0', () => {
    expect(run('k3x9pq', 1, () => input(40))[0].stretch).toBe('folded')
  })

  it('turning fold to 0 ends a folded stretch at once', () => {
    const steps = run('k3x9pq', 30, (w) => input(w < 10 ? 80 : 0))
    expect(steps[10].stretch).toBe('straight')
  })
})

describe('stepRadioFold: rows coming and going', () => {
  it('a folded row whose stem changes plays full length from that top', () => {
    const steps = run('k3x9pq', 60, () => input(40))
    const i = steps.findIndex((s) => s.cycles.length > 0)
    expect(i).toBeGreaterThanOrEqual(0)
    const folded = steps[i].cycles[0].rowId
    const changed = BAND.map((r) => (r.id === folded ? { ...r, stemId: 'another' } : r))
    const next = stepRadioFold(steps[i].state, input(40, changed))
    expect(next.cycles.map((c) => c.rowId)).not.toContain(folded)
  })

  it('a folded row whose own length changes leaves the fold', () => {
    const steps = run('k3x9pq', 60, () => input(40))
    const i = steps.findIndex((s) => s.cycles.length > 0)
    const folded = steps[i].cycles[0].rowId
    const longer = BAND.map((r) => (r.id === folded ? { ...r, barLength: r.barLength / 2 } : r))
    const next = stepRadioFold(steps[i].state, input(40, longer))
    expect(next.state.rows.map((r) => r.rowId)).not.toContain(folded)
    for (const r of next.state.rows) {
      expect(r.cycleBeats).toBeLessThan(r.fullBeats)
      const row = longer.find((x) => x.id === r.rowId)!
      expect(r.fullBeats).toBe(row.barLength * 4)
    }
  })

  it('a folded row that goes silent leaves the fold', () => {
    const steps = run('k3x9pq', 60, () => input(40))
    const i = steps.findIndex((s) => s.cycles.length > 0)
    const folded = steps[i].cycles[0].rowId
    const muted = BAND.map((r) => (r.id === folded ? { ...r, audible: false } : r))
    expect(
      stepRadioFold(steps[i].state, input(40, muted)).cycles.map((c) => c.rowId)
    ).not.toContain(folded)
  })
})

describe('realignment marks', () => {
  /** A state with one settled fold of `cycle` beats from lap 0, decided up to `lap`. */
  const settled = (cycle: number, loopBeats: number, lap: number): RadioFoldState => ({
    ...createRadioFold('k3x9pq'),
    lap,
    loopBeats,
    stretch: 'folded',
    stretchEndsLap: 1000,
    rows: [
      {
        rowId: 'perc',
        stemId: 'perc-stem',
        fullBeats: 8,
        targetBeats: cycle,
        cycleBeats: cycle,
        phaseBeats: 0,
        originLap: 0,
        path: [],
        mode: 'settled',
        unfoldSince: null,
        serial: 1
      }
    ]
  })

  it('7 against 16 realigns every 7 laps; 5 against 8 every 5; 3.5 against 16 every 7', () => {
    // Lap 0 is decided, so lap -1 is playing: lap L's top is (L + 1) loops from its top.
    expect(radioFoldMarkedBarsAhead(settled(7, 16, 0), 4, 14)).toEqual([8 * 4, 15 * 4])
    expect(radioFoldMarkedBarsAhead(settled(5, 8, 0), 2, 10)).toEqual([6 * 2, 11 * 2])
    expect(radioFoldMarkedBarsAhead(settled(3.5, 16, 0), 4, 14)).toEqual([8 * 4, 15 * 4])
  })

  it('a step marks the realignment top it decides', () => {
    const s = settled(7, 16, 6)
    const step = stepRadioFold(s, input(40))
    expect(step.lap).toBe(7)
    expect(step.marked).toBe(true)
    expect(stepRadioFold(settled(7, 16, 5), input(40)).marked).toBe(false)
  })

  it("a change's interval moves to a realignment top within two laps, never earlier", () => {
    const s = settled(7, 16, 0) // marks at 32 and 60 bars
    expect(radioFoldIntervalBars(s, 24, 4)).toBe(32)
    expect(radioFoldIntervalBars(s, 32, 4)).toBe(32)
    expect(radioFoldIntervalBars(s, 16, 4)).toBe(16) // 32 is four laps past 16
    expect(radioFoldIntervalBars(null, 24, 4)).toBe(24)
  })

  it('a phrase end on a realignment top rolls at often; off stays off', () => {
    expect(radioFoldTurnaroundRate('rare', true)).toBe('often')
    expect(radioFoldTurnaroundRate('rare', false)).toBe('rare')
    expect(radioFoldTurnaroundRate('off', true)).toBe('off')
  })
})

describe('drift', () => {
  it('moves slowly inside its ranges, from rest, and never closes the filter', () => {
    const steps = run('k3x9pq', 200, () => input(40))
    expect(steps[0].drift.perc.cutoff[0]).toBe(FOLD_DRIFT_RANGE.cutoff.rest)
    for (const s of steps) {
      for (const d of Object.values(s.drift)) {
        for (const p of ['cutoff', 'send', 'dub'] as const) {
          const [a, b] = d[p]
          expect(Math.min(a, b)).toBeGreaterThanOrEqual(
            Math.min(FOLD_DRIFT_RANGE[p].min, FOLD_DRIFT_RANGE[p].rest) - 1e-12
          )
          expect(Math.max(a, b)).toBeLessThanOrEqual(FOLD_DRIFT_RANGE[p].max + 1e-12)
          // a sweep is 32 bars at the least: on a 4-bar loop, under a ninth of the range a lap
          expect(Math.abs(b - a)).toBeLessThanOrEqual(
            (FOLD_DRIFT_RANGE[p].max - FOLD_DRIFT_RANGE[p].min) / 8 + 1e-12
          )
        }
      }
    }
  })

  it('is continuous from lap to lap', () => {
    const steps = run('k3x9pq', 100, () => input(40))
    for (let i = 1; i < steps.length; i++) {
      for (const p of ['cutoff', 'send', 'dub'] as const) {
        expect(steps[i].drift.perc[p][0]).toBeCloseTo(steps[i - 1].drift.perc[p][1], 12)
      }
    }
  })
})

describe('stepRadioFold: a loop or tempo change re-checks the window', () => {
  /** Every lap from 20 on, change to `after` there; a fold whose target is outside the new
   * window starts walking back on that top, and no kept fold stays outside it. */
  function check(fold: number, after: (base: RadioFoldInput) => RadioFoldInput): number {
    const steps = run('k3x9pq', 200, () => input(fold))
    let stale = 0
    for (let i = 20; i < steps.length; i++) {
      const next = after(input(fold))
      const allowed = radioFoldAllowedCycles(next.loopBars * 4, next.bpm)
      const before = steps[i].state
      const step = stepRadioFold(before, next)
      for (const r of before.rows) {
        if (r.mode !== 'unfolding' && !allowed.includes(r.targetBeats)) stale++
      }
      for (const r of step.state.rows) {
        if (r.mode !== 'unfolding') expect(allowed).toContain(r.targetBeats)
      }
      // and it stays inside on the tops after it
      let s = step.state
      for (let k = 0; k < 20; k++) {
        const later = stepRadioFold(s, next)
        for (const r of later.state.rows) {
          if (r.mode !== 'unfolding') expect(allowed).toContain(r.targetBeats)
        }
        s = later.state
      }
    }
    return stale
  }

  it('a loop change (16 to 32 beats) unfolds a fold that no longer realigns in time', () => {
    // 5.5 against 32 realigns every 176 s at 120 bpm; 9 every 144 s
    expect(check(90, (b) => ({ ...b, loopBars: 8 }))).toBeGreaterThan(0)
  })

  it('a tempo change (120 to 60 bpm) does the same', () => {
    // 5.5 against 16 realigns every 176 s at 60 bpm; 9 every 144 s
    expect(check(90, (b) => ({ ...b, bpm: 60 }))).toBeGreaterThan(0)
  })

  it('a tempo change keeps a fold that is still inside, running on', () => {
    const steps = run('k3x9pq', 200, () => input(40))
    const i = steps.findIndex((s) => s.state.rows.some((r) => r.mode === 'settled'))
    const r = steps[i].state.rows.find((x) => x.mode === 'settled')!
    // 7 or 9 against 16 are both inside the window at 110 bpm
    expect(radioFoldAllowedCycles(16, 110)).toContain(r.targetBeats)
    const next = stepRadioFold(steps[i].state, { ...input(40), bpm: 110 })
    const kept = next.state.rows.find((x) => x.rowId === r.rowId)
    expect(kept?.targetBeats).toBe(r.targetBeats)
    expect(kept?.mode).not.toBe('unfolding')
    expect(next.state.bpm).toBe(110)
  })

  it('a state saved before the tempo was tracked loads, and reads its tempo as unchanged', () => {
    const steps = run('k3x9pq', 200, () => input(40))
    const i = steps.findIndex((s) => s.state.rows.some((r) => r.mode === 'settled'))
    const old = JSON.parse(JSON.stringify(steps[i].state)) as Partial<RadioFoldState>
    delete old.bpm
    // 9 is outside the window at 60 bpm, but with no tempo saved there is no change to see
    const next = stepRadioFold(old as RadioFoldState, { ...input(40), bpm: 60 })
    const fresh = stepRadioFold(steps[i].state, input(40))
    expect(next.state.rows.map((r) => [r.rowId, r.mode])).toEqual(
      fresh.state.rows.map((r) => [r.rowId, r.mode])
    )
    expect(next.state.bpm).toBe(60)
  })

  it('the same seed and the same changes give the same decisions', () => {
    const at = (w: number): RadioFoldInput => ({
      ...input(90),
      loopBars: w < 50 ? 4 : w < 120 ? 8 : 4,
      bpm: w < 80 ? 120 : 90
    })
    expect(run('k3x9pq', 250, at)).toEqual(run('k3x9pq', 250, at))
  })
})
