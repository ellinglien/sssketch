// The intensity arc: build, breakdown, drop (spec 2026-10-05-radio-intensity-arc-design sections
// 3, 4, 6): radioIntensityArc.ts.
import { describe, expect, it } from 'vitest'
import {
  INTENSITY_PHRASES,
  NO_RADIO_INTENSITY_ARC,
  intensityArcShown,
  intensityPressNow,
  newRadioIntensityArc,
  pressRadioIntensity,
  radioBreakdownDepth,
  radioBreakdownRests,
  radioCarryKind,
  radioIntensityArcRole,
  radioIntensityBend,
  radioIntensityButtonLabel,
  radioIntensityDropInBars,
  radioIntensityHookInputs,
  radioIntensityStarted,
  radioIntensityStopped,
  radioIntensityAhead,
  radioIntensityLandingTarget,
  radioIntensityTarget,
  radioIntensityTargetAhead,
  radioIntensityTargets,
  radioIntensityTurnaroundArc,
  releaseRadioIntensityRest,
  stepRadioIntensityArc,
  type RadioIntensityArc,
  type RadioIntensityDecided,
  type RadioIntensityRow,
  type RadioIntensityStepInput,
  type RadioIntensityStepResult
} from './radioIntensityArc'
import { DENSITY_MAX, DENSITY_MIN, nextArcKind } from './radioDensity'
import { turnaroundPhraseLaps } from './radioTurnaround'
import { seededRandom } from './seededRandom'
import type { DiscoverSlotKind } from './discoverSlotKind'

// ---- a small runtime: rows, rests, the clock ----

interface SimRow {
  id: string
  kinds: DiscoverSlotKind[]
  score: number | null
  staleness: number
  resting: boolean
  locked?: boolean
  muted?: boolean
}

interface Trace {
  wrap: number
  lap: number
  applied: RadioIntensityDecided | null
  decided: RadioIntensityDecided | null
  prepare: RadioIntensityStepResult['prepare']
  phase: RadioIntensityArc['phase']
  rows: number
  sounding: number
  low: boolean
  peakRows: number
}

/** Runs the arc for `wraps` loop tops on a `loopBars` loop, doing what it says. */
function simulate(o: {
  loopBars: number
  wraps: number
  energy?: number
  drama?: number
  seed?: string
  rows?: SimRow[]
  held?: (wrap: number) => boolean
  press?: (wrap: number, arc: RadioIntensityArc) => 'build' | 'drop' | null
}): { trace: Trace[]; arc: RadioIntensityArc } {
  const random = seededRandom(o.seed ?? 'arc')
  const P = turnaroundPhraseLaps(16, o.loopBars)
  let n = 0
  const row = (kinds: DiscoverSlotKind[]): SimRow => ({
    id: `r${n++}`,
    kinds,
    score: random(),
    staleness: 0,
    resting: false
  })
  const rows: SimRow[] = o.rows ?? [row(['drums']), row(['bass'])]
  const energy = o.energy ?? 50
  const drama = o.drama ?? 60
  const view = (): RadioIntensityRow[] =>
    rows.map((r) => ({
      id: r.id,
      kinds: r.kinds,
      score: r.score,
      staleness: r.staleness,
      sounding: !r.resting && !r.muted,
      restable: !r.locked && !r.muted && !r.resting
    }))
  let arc = radioIntensityStarted({
    energy,
    drama,
    min: DENSITY_MIN,
    max: DENSITY_MAX,
    count: rows.length,
    random
  })
  const trace: Trace[] = []
  let lap = 0
  let carry = false
  const warm = new Set<string>()
  for (let w = 1; w <= o.wraps; w++) {
    lap = (lap + 1) % P
    for (const r of rows) r.staleness += 1
    const held = o.held?.(w) ?? false
    const step = stepRadioIntensityArc(arc, {
      energy,
      drama,
      loopBars: o.loopBars,
      lap,
      phraseLaps: P,
      held,
      count: rows.length,
      min: DENSITY_MIN,
      max: DENSITY_MAX,
      rows: view(),
      canAdd: rows.length < DENSITY_MAX && nextArcKind(rows.map((r) => r.kinds)) !== null,
      canStrip: rows.length > DENSITY_MIN,
      carryReady: carry,
      renewReady: (id) => warm.has(id),
      random
    })
    arc = step.state
    const a = step.applied
    if (a?.event === 'cycle' && a.strip && rows.length > DENSITY_MIN) {
      // the stalest that is not the last drums or bass
      const ok = rows.filter(
        (r) =>
          !(['drums', 'bass'] as const).some(
            (k) => r.kinds.includes(k) && !rows.some((x) => x !== r && x.kinds.includes(k))
          )
      )
      const victim = ok.sort((x, y) => y.staleness - x.staleness)[0]
      if (victim) rows.splice(rows.indexOf(victim), 1)
    }
    if (a?.event === 'add') {
      const k = nextArcKind(rows.map((r) => r.kinds))
      if (k !== null) rows.push(row([k]))
    }
    if (a?.event === 'breakdown') {
      for (const r of rows) if (a.rest.includes(r.id)) r.resting = true
      if (a.carry) rows.push(row([radioCarryKind(rows)]))
      carry = false
    }
    if (a?.event === 'drop') {
      for (const r of rows) {
        if (a.returning.includes(r.id)) r.resting = false
        if (a.renew.includes(r.id)) {
          r.score = Math.min(1, (r.score ?? 0.5) + 0.2)
          r.staleness = 0
        }
      }
      warm.clear()
    }
    if (step.prepare?.carry) carry = true
    for (const id of step.prepare?.renew ?? []) warm.add(id)
    const pressed = o.press?.(w, arc) ?? null
    if (pressed !== null) {
      const next = pressRadioIntensity(arc, pressed, { lap, phraseLaps: P, late: false })
      if (next !== null) arc = next
    }
    const sounding = rows.filter((r) => !r.resting && !r.muted)
    trace.push({
      wrap: w,
      lap,
      applied: a,
      decided: step.decided,
      prepare: step.prepare,
      phase: arc.phase,
      rows: rows.length,
      sounding: sounding.length,
      low: sounding.some((r) => r.kinds.includes('drums') || r.kinds.includes('bass')),
      peakRows: arc.peakRows
    })
  }
  return { trace, arc }
}

const changes = (t: Trace[]): Trace[] => t.filter((x) => x.applied !== null)

describe('targets', () => {
  it('match the knots (section 3.2)', () => {
    const at = (e: number, d: number, big = false): number[] => {
      const t = radioIntensityTargets(e, d, big)
      return [Math.round(t.lo * 100) / 100, Math.round(t.hi * 100) / 100]
    }
    expect(at(0, 0)).toEqual([0.2, 0.5])
    expect(at(50, 60)).toEqual([0.14, 0.86])
    expect(at(100, 100)).toEqual([0.15, 1])
    expect(at(50, 60, true)).toEqual([0.14, 1])
    expect(at(0, 0, true)).toEqual([0.2, 0.65])
  })

  it('never past hi (nor 1) in any build, big or not', () => {
    for (const e of [0, 33, 50, 67, 100]) {
      for (const d of [0, 25, 60, 100]) {
        for (const big of [false, true]) {
          const { hi } = radioIntensityTargets(e, d, big)
          for (let phrases = 0; phrases <= 12; phrases++) {
            for (let done = 0; done <= 14; done++) {
              const arc: RadioIntensityArc = {
                ...newRadioIntensityArc(),
                begun: true,
                big,
                phrases,
                done
              }
              const t = radioIntensityTarget(arc, e, d)
              expect(t).toBeLessThanOrEqual(hi)
              expect(t).toBeLessThanOrEqual(1)
            }
          }
        }
      }
    }
  })

  it('rise by phrase through the build, lo in the breakdown, hi in the drop', () => {
    const arc: RadioIntensityArc = { ...newRadioIntensityArc(), begun: true, phrases: 4 }
    const { lo, hi } = radioIntensityTargets(50, 60, false)
    const ks = [0, 1, 2, 3].map((done) => radioIntensityTarget({ ...arc, done }, 50, 60))
    ks.forEach((t, k) => expect(t).toBeCloseTo(lo + ((hi - lo) * (k + 1)) / 4, 9))
    expect(radioIntensityTarget({ ...arc, phase: 'breakdown' }, 50, 60)).toBeCloseTo(lo, 9)
    expect(radioIntensityTarget({ ...arc, phase: 'drop' }, 50, 60)).toBeCloseTo(hi, 9)
  })
})

describe('lengths', () => {
  it('draw from the energy menus (big: build and ride +1)', () => {
    expect(INTENSITY_PHRASES).toEqual({
      build: { low: [3, 4], mid: [2, 3, 4], high: [2, 3] },
      breakdown: { low: [2], mid: [1, 2], high: [1] },
      drop: { low: [1], mid: [1, 2], high: [2, 3] }
    })
    for (const [energy, band] of [
      [0, 'low'],
      [33, 'low'],
      [34, 'mid'],
      [66, 'mid'],
      [67, 'high'],
      [100, 'high']
    ] as const) {
      const { trace } = simulate({ loopBars: 4, wraps: 2400, energy, seed: `len${energy}` })
      const seen = { breakdown: new Set<number>(), drop: new Set<number>() }
      for (const c of changes(trace)) {
        const a = c.applied!
        if (a.event === 'breakdown') seen.breakdown.add(a.next!.phrases)
        if (a.event === 'drop' && a.next) seen.drop.add(a.next.phrases)
      }
      expect([...seen.breakdown].sort(), `${energy}`).toEqual([
        ...INTENSITY_PHRASES.breakdown[band]
      ])
      for (const p of seen.drop) {
        const menu = INTENSITY_PHRASES.drop[band]
        expect(menu.includes(p) || menu.includes(p - 1), `${energy} drop ${p}`).toBe(true)
      }
    }
  })

  it('a build is raised to fit its adds: one per phrase start after the first', () => {
    // energy 50 can draw a 2-phrase build; from 2 rows to 5 needs 3 adds, so 4 phrases
    for (const seed of ['a', 'b', 'c', 'd']) {
      const arc = radioIntensityStarted({
        energy: 60,
        drama: 60,
        min: 2,
        max: 5,
        count: 2,
        random: seededRandom(seed)
      })
      expect(arc.peakRows).toBe(5)
      expect(arc.phrases).toBeGreaterThanOrEqual(4)
      expect(arc.first).toBe(true)
      expect(arc.big).toBe(false)
    }
  })

  it('a cycle at the defaults averages about six phrases', () => {
    const { trace } = simulate({ loopBars: 4, wraps: 4 * 2000, seed: 'mean' })
    const starts = changes(trace).filter((c) => c.applied!.event === 'cycle')
    const span = (starts[starts.length - 1].wrap - starts[0].wrap) / (starts.length - 1) / 4
    expect(span).toBeGreaterThan(5)
    expect(span).toBeLessThan(7.5)
  })
})

describe('the clock', () => {
  it('changes phase only on phrase starts, at loops of 1 to 32 bars', () => {
    for (const loopBars of [1, 2, 3, 4, 5, 8, 16, 32]) {
      const { trace } = simulate({ loopBars, wraps: 600, seed: `clock${loopBars}` })
      const phaseChanges = changes(trace).filter((c) => c.applied!.event !== 'add')
      expect(phaseChanges.length, `${loopBars}`).toBeGreaterThan(3)
      for (const c of changes(trace)) expect(c.lap, `${loopBars} wrap ${c.wrap}`).toBe(0)
    }
  })

  it('decides one wrap ahead (binding), and prepares a phrase ahead of the decision', () => {
    const bed = (): SimRow[] =>
      (['drums', 'bass', 'lead', 'warm'] as const).map((k, i) => ({
        id: `b${i}`,
        kinds: [k],
        score: 0.5,
        staleness: 0,
        resting: false
      }))
    const runs = [
      ...[2, 4, 16, 32].map((loopBars) => ({ loopBars, energy: 50, drama: 60, rows: undefined })),
      // a one-phrase breakdown at a one-lap phrase (review, 2026-10-05): the build's own prepare
      // must not stand in for the drop's
      ...[16, 32].map((loopBars) => ({ loopBars, energy: 100, drama: 100, rows: bed() }))
    ]
    for (const { loopBars, energy, drama, rows } of runs) {
      const { trace } = simulate({
        loopBars,
        wraps: 800,
        energy,
        drama,
        rows,
        seed: `ahead${loopBars}`
      })
      for (let i = 1; i < trace.length; i++) {
        if (trace[i].applied !== null) expect(trace[i].applied).toEqual(trace[i - 1].decided)
      }
      const P = turnaroundPhraseLaps(16, loopBars)
      let previousDrop = 0
      let drops = 0
      for (const t of trace) {
        if (t.applied?.event !== 'drop') continue
        drops += 1
        // this drop's own prepare: after the previous drop, not an earlier cycle's
        const prep = trace.filter(
          (x) => x.wrap > previousDrop && x.wrap < t.wrap && (x.prepare?.renew.length ?? 0) > 0
        )
        const last = prep[prep.length - 1]
        const label = `${loopBars} e${energy} d${drama}: the drop at ${t.wrap}`
        expect(last, `${label} was prepared`).toBeDefined()
        // prepared before it was decided (two wraps with a one-lap phrase)
        expect(t.wrap - last.wrap, label).toBeGreaterThanOrEqual(Math.max(P, 2))
        previousDrop = t.wrap
      }
      expect(drops, `${loopBars} e${energy} d${drama}`).toBeGreaterThan(5)
    }
  })

  it('held: the clock stops and nothing is decided; a decided event still lands', () => {
    const arc = radioIntensityStarted({
      energy: 50,
      drama: 60,
      min: 2,
      max: 5,
      count: 2,
      random: () => 0
    })
    let draws = 0
    const input: RadioIntensityStepInput = {
      energy: 50,
      drama: 60,
      loopBars: 4,
      lap: 3,
      phraseLaps: 4,
      held: true,
      count: 2,
      min: 2,
      max: 5,
      rows: [],
      canAdd: true,
      canStrip: false,
      carryReady: false,
      renewReady: () => true,
      random: () => {
        draws += 1
        return 0
      }
    }
    const r = stepRadioIntensityArc(arc, input)
    expect(r.state).toEqual(arc)
    expect(r.decided).toBeNull()
    expect(draws).toBe(0)
    const decided: RadioIntensityArc = { ...arc, decided: { event: 'add' } }
    const landed = stepRadioIntensityArc(decided, { ...input, lap: 0 })
    expect(landed.applied).toEqual({ event: 'add' })
    expect(landed.state.decided).toBeNull()
    expect(landed.state.done).toBe(arc.done)
  })

  it('a machine switched on mid-run begins at the next phrase start, drawing nothing before', () => {
    let draws = 0
    const random = (): number => {
      draws += 1
      return 0.5
    }
    const base = {
      energy: 50,
      drama: 60,
      loopBars: 4,
      phraseLaps: 4,
      held: false,
      count: 4,
      min: 2,
      max: 5,
      rows: [],
      canAdd: true,
      canStrip: true,
      carryReady: false,
      renewReady: () => false,
      random
    }
    let arc = newRadioIntensityArc()
    for (const lap of [2, 3]) arc = stepRadioIntensityArc(arc, { ...base, lap }).state
    expect(arc.begun).toBe(false)
    expect(draws).toBe(0)
    arc = stepRadioIntensityArc(arc, { ...base, lap: 0 }).state
    expect(arc).toMatchObject({ begun: true, phase: 'build', done: 0, first: true })
    expect(draws).toBeGreaterThan(0)
  })
})

describe('the cycle', () => {
  it('runs build, breakdown, drop, build ... and strips back at each later build', () => {
    const { trace } = simulate({ loopBars: 4, wraps: 1200, seed: 'cycle' })
    const order = changes(trace)
      .map((c) => c.applied!.event)
      .filter((e) => e !== 'add')
    for (let i = 0; i < order.length; i++) {
      expect(order[i]).toBe(['breakdown', 'drop', 'cycle'][i % 3])
    }
    for (const c of changes(trace))
      if (c.applied!.event === 'cycle') expect(c.applied).toMatchObject({ strip: true })
  })

  it('at a one-lap phrase, the adds stop at the peak: the add landing this wrap is counted', () => {
    for (const loopBars of [16, 32]) {
      for (const energy of [20, 80, 100]) {
        for (const seed of ['p1', 'p2', 'p3']) {
          const { trace } = simulate({ loopBars, wraps: 1500, energy, seed: `${seed}${energy}` })
          let start = 2
          for (const t of trace) {
            if (t.applied?.event === 'cycle') start = t.rows
            expect(t.rows, `${loopBars} e${energy} ${seed} wrap ${t.wrap}`).toBeLessThanOrEqual(
              DENSITY_MAX
            )
            if (t.phase === 'build') {
              expect(t.rows, `${loopBars} e${energy} ${seed} wrap ${t.wrap}`).toBeLessThanOrEqual(
                Math.max(t.peakRows, start)
              )
            }
          }
        }
      }
    }
  })

  it('grows one row per phrase start to the peak, and the drop keeps the count', () => {
    const { trace } = simulate({ loopBars: 4, wraps: 1200, energy: 80, seed: 'peak' })
    let last = 2
    for (const t of trace) {
      expect(Math.abs(t.rows - last)).toBeLessThanOrEqual(1)
      last = t.rows
      if (t.applied?.event === 'breakdown') expect(t.rows).toBeGreaterThanOrEqual(4)
    }
  })

  it('bigger peaks: never the first cycle, then every 3-4 cycles', () => {
    const { trace } = simulate({ loopBars: 4, wraps: 4 * 600, seed: 'big' })
    const cycles = changes(trace).filter((c) => c.applied!.event === 'cycle')
    const bigs = cycles
      .map((c, i) => ({ i: i + 2, big: (c.applied as { next?: { big?: boolean } }).next?.big }))
      .filter((c) => c.big)
      .map((c) => c.i)
    expect(bigs.length).toBeGreaterThan(5)
    expect(bigs[0]).toBeGreaterThanOrEqual(4)
    for (let i = 1; i < bigs.length; i++) expect([3, 4]).toContain(bigs[i] - bigs[i - 1])
  })

  it('a big cycle heads for DENSITY_MAX and breaks down one level deeper', () => {
    expect(radioBreakdownDepth(10, false)).toBe('swell')
    expect(radioBreakdownDepth(10, true)).toBe('thin')
    expect(radioBreakdownDepth(40, false)).toBe('thin')
    expect(radioBreakdownDepth(40, true)).toBe('full')
    expect(radioBreakdownDepth(60, false)).toBe('full')
    expect(radioBreakdownDepth(100, true)).toBe('full')
    const { trace } = simulate({ loopBars: 4, wraps: 4 * 300, energy: 20, seed: 'bigpeak' })
    for (const c of changes(trace)) {
      const a = c.applied!
      if (a.event === 'cycle' && a.next?.big) expect(a.next.peakRows).toBe(DENSITY_MAX)
    }
  })
})

describe('the breakdown', () => {
  const R = (
    id: string,
    kinds: DiscoverSlotKind[],
    o: Partial<RadioIntensityRow> = {}
  ): RadioIntensityRow => ({
    id,
    kinds,
    score: 0.5,
    staleness: 0,
    sounding: true,
    restable: true,
    ...o
  })

  it('swell rests nothing; thin keeps the sparsest drums; full rests every drums and bass row', () => {
    const bed = [
      R('d1', ['drums'], { score: 0.9 }),
      R('d2', ['drums'], { score: 0.2 }),
      R('b', ['bass']),
      R('l', ['lead']),
      R('w', ['warm'])
    ]
    expect(radioBreakdownRests(bed, 'swell', false).rest).toEqual([])
    expect(radioBreakdownRests(bed, 'thin', false)).toMatchObject({
      depth: 'thin',
      rest: ['d1', 'b'],
      throwRowId: 'd1'
    })
    expect(radioBreakdownRests(bed, 'full', false)).toMatchObject({
      depth: 'full',
      rest: ['d1', 'd2', 'b'],
      throwRowId: 'd1',
      carry: false
    })
  })

  it('counts a combination row as low; bassHeavy and rhythmic are not', () => {
    const bed = [R('db', ['drums', 'bass']), R('h', ['bassHeavy']), R('r', ['rhythmic'])]
    expect(radioBreakdownRests(bed, 'full', false).rest).toEqual(['db'])
  })

  it('unknown scores read 0.5, ties go to the stalest; an unrestable drums row is the kept one', () => {
    const bed = [
      R('a', ['drums'], { score: null, staleness: 1 }),
      R('b', ['drums'], { score: 0.5, staleness: 9 }),
      R('l', ['lead'])
    ]
    expect(radioBreakdownRests(bed, 'thin', false).rest).toEqual(['a'])
    const locked = [R('a', ['drums'], { restable: false }), R('b', ['drums']), R('l', ['lead'])]
    expect(radioBreakdownRests(locked, 'thin', false).rest).toEqual(['b'])
  })

  it('with no carrier: a carry row when one is ready, else full falls to thin', () => {
    const bed = [R('d', ['drums']), R('b', ['bass'])]
    expect(radioBreakdownRests(bed, 'full', true)).toMatchObject({ rest: ['d', 'b'], carry: true })
    expect(radioBreakdownRests(bed, 'full', false)).toMatchObject({ depth: 'thin', rest: ['b'] })
    expect(radioCarryKind([{ kinds: ['drums'] }])).toBe('lead')
    expect(radioCarryKind([{ kinds: ['lead'] }])).toBe('warm')
  })

  it('never silence: something always sounds (10k random beds)', () => {
    const r = seededRandom('never-silence')
    const kinds: DiscoverSlotKind[] = ['drums', 'bass', 'lead', 'warm', 'bright', 'rhythmic']
    for (let i = 0; i < 10000; i++) {
      const n = 1 + Math.floor(r() * 6)
      const bed: RadioIntensityRow[] = Array.from({ length: n }, (_, j) => {
        const ks: DiscoverSlotKind[] = [kinds[Math.floor(r() * kinds.length)]]
        if (r() < 0.15) ks.push(kinds[Math.floor(r() * kinds.length)])
        const sounding = r() < 0.85
        return R(`x${j}`, ks, {
          score: r() < 0.2 ? null : r(),
          staleness: Math.floor(r() * 10),
          sounding,
          restable: sounding && r() < 0.8
        })
      })
      if (!bed.some((x) => x.sounding)) continue
      const depth = (['thin', 'full'] as const)[Math.floor(r() * 2)]
      const carry = r() < 0.5
      const out = radioBreakdownRests(bed, depth, carry)
      const left = bed.filter((x) => x.sounding && !out.rest.includes(x.id))
      expect(left.length > 0 || out.carry, JSON.stringify({ bed, out })).toBe(true)
      for (const id of out.rest) {
        const row = bed.find((x) => x.id === id)!
        expect(row.restable && row.sounding).toBe(true)
        expect(row.kinds.includes('drums') || row.kinds.includes('bass')).toBe(true)
      }
      if (out.throwRowId !== null) {
        expect(out.rest).toContain(out.throwRowId)
        expect(bed.find((x) => x.id === out.throwRowId)!.kinds).toContain('drums')
      }
    }
  })

  it('in a run, the low end is missing only in a breakdown, and nothing is ever silent', () => {
    for (const drama of [0, 40, 100]) {
      const { trace } = simulate({ loopBars: 4, wraps: 2000, drama, seed: `low${drama}` })
      for (const t of trace) {
        expect(t.sounding, `${drama} wrap ${t.wrap}`).toBeGreaterThan(0)
        if (!t.low) expect(t.phase, `${drama} wrap ${t.wrap}`).toBe('breakdown')
      }
      const breakdowns = trace.filter((t) => t.phase === 'breakdown')
      const lowShare = breakdowns.filter((t) => t.low).length / Math.max(1, breakdowns.length)
      if (drama >= 60) expect(lowShare).toBeLessThan(0.5)
      if (drama < 25) expect(lowShare).toBe(1)
    }
  })

  it('ends after phrases + 1 phrase starts in any case (overran)', () => {
    const arc: RadioIntensityArc = {
      ...newRadioIntensityArc(),
      begun: true,
      phase: 'breakdown',
      phrases: 1,
      done: 1,
      rests: ['d']
    }
    const r = stepRadioIntensityArc(arc, {
      energy: 50,
      drama: 60,
      loopBars: 4,
      lap: 0,
      phraseLaps: 4,
      held: false,
      count: 3,
      min: 2,
      max: 5,
      rows: [],
      canAdd: false,
      canStrip: false,
      carryReady: false,
      renewReady: () => false,
      random: () => 0.5
    })
    expect(r.overran).toBe(true)
    expect(r.decided).toMatchObject({ event: 'drop', returning: ['d'] })
  })
})

describe('the drop', () => {
  it('brings every rested row back; renews warm drums and bass at 0.25 + 0.5 drama', () => {
    const counts = { renewed: 0, returning: 0 }
    for (let s = 0; s < 40; s++) {
      const { trace } = simulate({ loopBars: 4, wraps: 600, drama: 60, seed: `renew${s}` })
      for (const c of changes(trace)) {
        const a = c.applied!
        if (a.event !== 'drop') continue
        counts.returning += a.returning.length
        counts.renewed += a.renew.length
        for (const id of a.renew) expect(a.returning).toContain(id)
      }
    }
    expect(counts.returning).toBeGreaterThan(100)
    expect(counts.renewed / counts.returning).toBeGreaterThan(0.45)
    expect(counts.renewed / counts.returning).toBeLessThan(0.65)
  })

  it('a renewal not warm by the decide wrap is the own stem, with no draw', () => {
    const arc: RadioIntensityArc = {
      ...newRadioIntensityArc(),
      begun: true,
      phase: 'breakdown',
      phrases: 1,
      done: 0,
      rests: ['d', 'b']
    }
    const draws: number[] = []
    const r = stepRadioIntensityArc(arc, {
      energy: 50,
      drama: 60,
      loopBars: 4,
      lap: 3,
      phraseLaps: 4,
      held: false,
      count: 3,
      min: 2,
      max: 5,
      rows: [
        { id: 'd', kinds: ['drums'], score: 0.5, staleness: 0, sounding: false, restable: false },
        { id: 'b', kinds: ['bass'], score: 0.5, staleness: 0, sounding: false, restable: false },
        { id: 'l', kinds: ['lead'], score: 0.5, staleness: 0, sounding: true, restable: true }
      ],
      canAdd: false,
      canStrip: false,
      carryReady: false,
      renewReady: (id) => id === 'b',
      random: () => {
        draws.push(0)
        return 0
      }
    })
    expect(r.decided).toMatchObject({ event: 'drop', returning: ['d', 'b'], renew: ['b'] })
    // one renewal draw (b), then the ride's length (energy 50: {1, 2})
    expect(draws).toHaveLength(2)
  })
})

describe('the buttons', () => {
  const at = (
    phase: RadioIntensityArc['phase'],
    o: Partial<RadioIntensityArc> = {}
  ): RadioIntensityArc => ({
    ...newRadioIntensityArc(),
    begun: true,
    phase,
    phrases: 3,
    done: 1,
    ...o
  })
  const where = { lap: 1, phraseLaps: 4, late: false }

  it('build in the ride: a new cycle at the next top', () => {
    expect(pressRadioIntensity(at('drop'), 'build', where)?.decided).toEqual({
      event: 'cycle',
      strip: true,
      forced: true
    })
  })

  it('build in the build: an add at the top, the remaining phrases halved', () => {
    const r = pressRadioIntensity(at('build', { phrases: 5, done: 1 }), 'build', where)!
    expect(r.decided).toEqual({ event: 'add', forced: true })
    expect(r.phrases).toBe(3)
    expect(pressRadioIntensity(at('build', { phrases: 2, done: 1 }), 'build', where)!.phrases).toBe(
      2
    )
  })

  it('build in the breakdown: the drop at the next phrase start whose decide wrap has not passed', () => {
    const b = at('breakdown', { phrases: 2, done: 0 })
    expect(pressRadioIntensity(b, 'build', where)).toMatchObject({ phrases: 1, decided: null })
    expect(pressRadioIntensity(b, 'build', { ...where, lap: 3 })).toMatchObject({ phrases: 2 })
  })

  it('drop in the breakdown: the rested rows back at the top, no renewals', () => {
    expect(pressRadioIntensity(at('breakdown', { rests: ['d'] }), 'drop', where)?.decided).toEqual({
      event: 'drop',
      returning: ['d'],
      renew: [],
      forced: true
    })
  })

  it('drop while building or riding: a quick drop, then a fresh ride', () => {
    for (const p of ['build', 'drop'] as const) {
      expect(pressRadioIntensity(at(p), 'drop', where)?.decided).toEqual({
        event: 'drop',
        returning: [],
        renew: [],
        quick: true,
        forced: true
      })
    }
  })

  it('late, or with the top already spoken for: the top after; labels say it waits', () => {
    const late = pressRadioIntensity(at('drop'), 'build', { ...where, late: true })!
    expect(late).toMatchObject({ forced: 'build', decided: null })
    expect(radioIntensityButtonLabel('build', late)).toBe('building')
    expect(radioIntensityButtonLabel('drop', late)).toBe('drop')
    const taken = pressRadioIntensity(at('build', { decided: { event: 'add' } }), 'drop', where)!
    expect(taken).toMatchObject({ forced: 'drop', decided: { event: 'add' } })
    expect(radioIntensityButtonLabel('drop', taken)).toBe('dropping')
    const now = pressRadioIntensity(at('build'), 'drop', where)!
    expect(radioIntensityButtonLabel('drop', now)).toBe('dropping')
    expect(radioIntensityButtonLabel('build', now)).toBe('build')
    expect(pressRadioIntensity(newRadioIntensityArc(), 'drop', where)).toBeNull()
  })

  it('a press the decided event already answers changes nothing (review, 2026-10-05)', () => {
    const drop: RadioIntensityDecided = { event: 'drop', returning: ['d'], renew: [] }
    const breakdown = at('breakdown', { rests: ['d'], decided: drop })
    for (const late of [false, true]) {
      expect(pressRadioIntensity(breakdown, 'drop', { ...where, late })).toBe(breakdown)
    }
    const once = pressRadioIntensity(at('build'), 'drop', where)!
    expect(pressRadioIntensity(once, 'drop', where)).toBe(once)
    const cycle = at('drop', { phrases: 5, decided: { event: 'cycle', strip: true } })
    expect(pressRadioIntensity(cycle, 'build', where)).toBe(cycle)
    // build in the build with an add decided: the add is answered, the build still hurries (spec
    // 6: the remaining phrases halve), and nothing new is decided or left waiting
    const adding = at('build', { phrases: 7, done: 1, decided: { event: 'add' } })
    expect(pressRadioIntensity(adding, 'build', where)).toEqual({ ...adding, phrases: 4 })
    const twice = pressRadioIntensity(at('build', { phrases: 7, done: 1 }), 'build', where)!
    expect(twice).toMatchObject({ phrases: 4, decided: { event: 'add', forced: true } })
    expect(pressRadioIntensity(twice, 'build', where)).toEqual({ ...twice, phrases: 2 })
    const last = at('build', { phrases: 2, done: 1, decided: { event: 'add' } })
    expect(pressRadioIntensity(last, 'build', where)).toBe(last)
    const waiting = pressRadioIntensity(at('drop'), 'build', { ...where, late: true })!
    expect(pressRadioIntensity(waiting, 'build', { ...where, late: true })).toBe(waiting)
  })

  it('a later press replaces an earlier waiting one', () => {
    const late = { ...where, late: true }
    const waitingDrop = pressRadioIntensity(at('drop'), 'drop', late)!
    expect(waitingDrop.forced).toBe('drop')
    // pressed in time: decided now, the waiting drop gone
    const now = pressRadioIntensity(waitingDrop, 'build', where)!
    expect(now).toMatchObject({ forced: null, decided: { event: 'cycle', forced: true } })
    // pressed late again: the newer one waits
    expect(pressRadioIntensity(waitingDrop, 'build', late)!.forced).toBe('build')
    // answered by the decided event: the waiting one goes too
    const answered = pressRadioIntensity(
      { ...at('breakdown', { decided: { event: 'drop', returning: [], renew: [] } }) },
      'build',
      late
    )!
    const both = { ...answered, forced: 'build' as const }
    expect(pressRadioIntensity(both, 'drop', where)).toMatchObject({ forced: null })
    // build in a breakdown shortens it, and the waiting drop goes
    const b = at('breakdown', { phrases: 2, done: 0, forced: 'drop' })
    expect(pressRadioIntensity(b, 'build', where)).toMatchObject({ phrases: 1, forced: null })
  })

  it('a waiting build that meets a breakdown brings the drop forward', () => {
    // pressed (too late) while the breakdown was decided; it lands, and the build press waits
    const arc = at('breakdown', { phrases: 2, done: 0, forced: 'build' })
    const input: RadioIntensityStepInput = {
      energy: 50,
      drama: 60,
      loopBars: 4,
      lap: 1,
      phraseLaps: 4,
      held: false,
      count: 4,
      min: 2,
      max: 5,
      rows: [],
      canAdd: true,
      canStrip: true,
      carryReady: false,
      renewReady: () => false,
      random: () => 0.5
    }
    const r = stepRadioIntensityArc(arc, input)
    expect(r.state).toMatchObject({ forced: null, phrases: 1, decided: null })
    // at this phrase's decide wrap, the drop is decided
    const d = stepRadioIntensityArc(r.state, { ...input, lap: 3 })
    expect(d.decided).toMatchObject({ event: 'drop' })
  })

  it('pressed against the decided event in a run: one drop, one cycle, no second event', () => {
    const drops = simulate({
      loopBars: 4,
      wraps: 1200,
      seed: 'answered-drop',
      // pressed once the clock's own drop is decided (the breakdown's last lap)
      press: (_, arc) => (arc.decided?.event === 'drop' ? 'drop' : null)
    })
    const ds = changes(drops.trace)
    for (let i = 1; i < ds.length; i++) {
      if (ds[i - 1].applied!.event === 'drop') expect(ds[i].applied!.event).not.toBe('drop')
    }
    expect(ds.filter((c) => c.applied!.event === 'drop').length).toBeGreaterThan(5)
    const builds = simulate({
      loopBars: 4,
      wraps: 1200,
      seed: 'answered-build',
      press: (_, arc) => (arc.decided?.event === 'cycle' ? 'build' : null)
    })
    const bs = changes(builds.trace)
    expect(bs.filter((c) => c.applied!.event === 'cycle').length).toBeGreaterThan(5)
    for (const c of bs) expect(c.applied).not.toMatchObject({ event: 'add', forced: true })
  })

  it('a forced add fits the peak, the most rows and canAdd; a forced cycle strips only when it can', () => {
    const b = at('build', { phrases: 5, done: 1, peakRows: 4 })
    const can = { count: 3, max: 5, canAdd: true, canStrip: true }
    expect(pressRadioIntensity(b, 'build', { ...where, can })?.decided).toEqual({
      event: 'add',
      forced: true
    })
    for (const no of [{ count: 4 }, { canAdd: false }, { count: 3, max: 3 }]) {
      const r = pressRadioIntensity(b, 'build', { ...where, can: { ...can, ...no } })!
      expect(r.decided, JSON.stringify(no)).toBeNull()
      expect(r.forced).toBeNull()
      expect(r.phrases).toBe(3)
    }
    expect(
      pressRadioIntensity(at('drop'), 'build', { ...where, can: { ...can, canStrip: false } })
        ?.decided
    ).toEqual({ event: 'cycle', strip: false, forced: true })
    // a press waiting for its top reads the rows there
    const waiting: RadioIntensityArc = { ...b, forced: 'build' }
    const input: RadioIntensityStepInput = {
      energy: 50,
      drama: 60,
      loopBars: 4,
      lap: 1,
      phraseLaps: 4,
      held: false,
      count: 4,
      min: 2,
      max: 5,
      rows: [],
      canAdd: true,
      canStrip: true,
      carryReady: false,
      renewReady: () => false,
      random: () => 0.5
    }
    const r = stepRadioIntensityArc(waiting, input)
    expect(r.decided).toBeNull()
    expect(r.state.forced).toBeNull()
    expect(stepRadioIntensityArc(waiting, { ...input, count: 3 }).decided).toEqual({
      event: 'add',
      forced: true
    })
    const stripping = stepRadioIntensityArc(
      { ...at('drop'), forced: 'build' },
      { ...input, canStrip: false }
    )
    expect(stripping.decided).toEqual({ event: 'cycle', strip: false, forced: true })
  })

  it('a press that comes to nothing at a decide wrap leaves the decision to the clock', () => {
    const b = at('build', { phrases: 2, done: 1, peakRows: 3, forced: 'build' })
    const r = stepRadioIntensityArc(b, {
      energy: 50,
      drama: 10,
      loopBars: 4,
      lap: 3,
      phraseLaps: 4,
      held: false,
      count: 3,
      min: 2,
      max: 5,
      rows: [],
      canAdd: true,
      canStrip: true,
      carryReady: false,
      renewReady: () => false,
      random: () => 0.5
    })
    expect(r.decided).toMatchObject({ event: 'breakdown' })
    expect(r.state.forced).toBeNull()
  })

  it('every press lands in a run, and the cycle goes on', () => {
    const { trace } = simulate({
      loopBars: 4,
      wraps: 800,
      seed: 'press',
      press: (w) => (w % 37 === 0 ? 'drop' : w % 53 === 0 ? 'build' : null)
    })
    expect(changes(trace).some((c) => (c.applied as { quick?: boolean }).quick === true)).toBe(true)
    for (const t of trace) expect(t.sounding).toBeGreaterThan(0)
  })
})

describe('what the rest of radio reads', () => {
  const arc = (o: Partial<RadioIntensityArc>): RadioIntensityArc => ({
    ...newRadioIntensityArc(),
    begun: true,
    ...o
  })
  const bd: RadioIntensityDecided = {
    event: 'breakdown',
    depth: 'full',
    rest: [],
    throwRowId: null,
    throw: null,
    carry: false
  }
  const drop: RadioIntensityDecided = { event: 'drop', returning: [], renew: [] }

  it('the arcRole and the turnaround arc follow the decided event', () => {
    expect(radioIntensityArcRole(arc({}))).toBe('hold')
    expect(radioIntensityArcRole(arc({ decided: { event: 'add' } }))).toBe('build')
    expect(radioIntensityArcRole(arc({ decided: { event: 'cycle', strip: true } }))).toBe('strip')
    expect(radioIntensityArcRole(arc({ decided: { event: 'cycle', strip: false } }))).toBe('build')
    expect(radioIntensityArcRole(arc({ decided: bd }))).toBe('breakdown')
    expect(radioIntensityArcRole(arc({ decided: drop }))).toBe('drop')
    expect(radioIntensityTurnaroundArc(arc({ phase: 'build' }))).toBe('growing')
    expect(radioIntensityTurnaroundArc(arc({ phase: 'build', decided: bd }))).toBe('thinning')
    expect(radioIntensityTurnaroundArc(arc({ phase: 'breakdown' }))).toBe('thinning')
    expect(radioIntensityTurnaroundArc(arc({ phase: 'breakdown', decided: drop }))).toBe('growing')
    expect(radioIntensityTurnaroundArc(arc({ phase: 'drop' }))).toBe('steady')
  })

  it("the hooks' inputs", () => {
    expect(radioIntensityHookInputs(arc({ phase: 'build' }))).toEqual({
      dropAtNextWrap: false,
      inBreakdown: false
    })
    expect(radioIntensityHookInputs(arc({ phase: 'build', decided: bd }))).toEqual({
      dropAtNextWrap: false,
      inBreakdown: true
    })
    expect(radioIntensityHookInputs(arc({ phase: 'breakdown' }))).toEqual({
      dropAtNextWrap: false,
      inBreakdown: true
    })
    expect(radioIntensityHookInputs(arc({ phase: 'breakdown', decided: drop }))).toEqual({
      dropAtNextWrap: true,
      inBreakdown: false
    })
  })

  it('the bend: about +-15 at the default drama, clamped', () => {
    expect(radioIntensityBend(40, 60, 0.86)).toBeCloseTo(40 + 25 * 0.6 * 0.72, 9)
    expect(radioIntensityBend(40, 60, 0.14)).toBeCloseTo(40 - 25 * 0.6 * 0.72, 9)
    expect(radioIntensityBend(95, 100, 1)).toBe(100)
    expect(radioIntensityBend(5, 100, 0)).toBe(0)
    expect(radioIntensityBend(40, 0, 1)).toBe(40)
  })

  it('bars to the drop in a breakdown', () => {
    const b = arc({ phase: 'breakdown', phrases: 2, done: 0 })
    expect(radioIntensityDropInBars(b, { lap: 1, phraseLaps: 4, loopBars: 4, pos: 2 })).toBe(
      (4 + 3) * 4 - 2
    )
    expect(
      radioIntensityDropInBars(arc({ phase: 'build' }), {
        lap: 1,
        phraseLaps: 4,
        loopBars: 4,
        pos: 2
      })
    ).toBeNull()
    expect(
      radioIntensityDropInBars(arc({ phase: 'breakdown', decided: drop }), {
        lap: 3,
        phraseLaps: 4,
        loopBars: 4,
        pos: 1
      })
    ).toBe(3)
  })

  it('a row given back by hand leaves the rests and the decided lists', () => {
    const resting = arc({
      phase: 'breakdown',
      rests: ['d', 'b'],
      decided: { ...drop, returning: ['d', 'b'], renew: ['b'] }
    })
    const r = releaseRadioIntensityRest(resting, 'b')
    expect(r.rests).toEqual(['d'])
    expect(r.decided).toEqual({ ...drop, returning: ['d'], renew: [] })
    const soon = arc({
      phase: 'build',
      decided: {
        ...bd,
        rest: ['d'],
        throwRowId: 'd',
        throw: { beats: 1, timing: 'quarter', feedback: 0.5 }
      }
    })
    expect(releaseRadioIntensityRest(soon, 'd').decided).toMatchObject({
      rest: [],
      throwRowId: null,
      throw: null
    })
    const plain = arc({ phase: 'drop' })
    expect(releaseRadioIntensityRest(plain, 'x')).toBe(plain)
  })

  it('stopping puts every rested row back (and the ones about to rest)', () => {
    const r = radioIntensityStopped(
      arc({ phase: 'build', rests: ['a'], decided: { ...bd, rest: ['b'] } })
    )
    expect(r.unrest.sort()).toEqual(['a', 'b'])
    expect(r.state).toEqual(newRadioIntensityArc())
    expect(NO_RADIO_INTENSITY_ARC.begun).toBe(false)
  })
})

describe('draws (section 3.5)', () => {
  it('draw only at a cycle, a phase change and the renewals: nothing on a plain wrap', () => {
    let draws = 0
    const random = (): number => {
      draws += 1
      return 0.3
    }
    let arc = radioIntensityStarted({ energy: 50, drama: 60, min: 2, max: 5, count: 4, random })
    expect(draws).toBe(2) // the countdown, the build's length
    draws = 0
    const input = (lap: number): RadioIntensityStepInput => ({
      energy: 50,
      drama: 60,
      loopBars: 4,
      lap,
      phraseLaps: 4,
      held: false,
      count: 4,
      min: 2,
      max: 5,
      rows: [],
      canAdd: false,
      canStrip: true,
      carryReady: false,
      renewReady: () => false,
      random
    })
    // a build's middle laps: no draws
    for (const lap of [1, 2]) arc = stepRadioIntensityArc(arc, input(lap)).state
    expect(draws).toBe(0)
  })

  it('a breakdown with a drums row resting draws the throw (3), then its length', () => {
    const order: string[] = []
    let k = 0
    const random = (): number => {
      order.push(`d${k++}`)
      return 0.4
    }
    const arc: RadioIntensityArc = {
      ...newRadioIntensityArc(),
      begun: true,
      phase: 'build',
      phrases: 2,
      done: 1
    }
    const r = stepRadioIntensityArc(arc, {
      energy: 50,
      drama: 80,
      loopBars: 4,
      lap: 3,
      phraseLaps: 4,
      held: false,
      count: 3,
      min: 2,
      max: 5,
      rows: [
        { id: 'd', kinds: ['drums'], score: 0.5, staleness: 0, sounding: true, restable: true },
        { id: 'b', kinds: ['bass'], score: 0.5, staleness: 0, sounding: true, restable: true },
        { id: 'l', kinds: ['lead'], score: 0.5, staleness: 0, sounding: true, restable: true }
      ],
      canAdd: false,
      canStrip: false,
      carryReady: false,
      renewReady: () => false,
      random
    })
    expect(r.decided).toMatchObject({
      event: 'breakdown',
      depth: 'full',
      rest: ['d', 'b'],
      throwRowId: 'd'
    })
    expect(order).toHaveLength(4)
  })

  it('the same seed replays the same arc', () => {
    const a = simulate({ loopBars: 4, wraps: 500, seed: 'replay' }).trace
    const b = simulate({ loopBars: 4, wraps: 500, seed: 'replay' }).trace
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })
})

describe('radioIntensityTargetAhead: the target where a change lands (option A, 2026-10-06)', () => {
  // a 4-bar loop: a 16-bar phrase is 4 laps; the arc as the machine has it at a phrase start
  const where = {
    energy: 50,
    drama: 60,
    loopBars: 4,
    lap: 0,
    phraseLaps: 4,
    count: 4,
    min: 2,
    max: 5
  }
  const { lo, hi } = radioIntensityTargets(50, 60, false)
  const building = (phrases: number, done: number): RadioIntensityArc => ({
    ...newRadioIntensityArc(),
    begun: true,
    first: false,
    untilBig: 3,
    peakRows: 5,
    phrases,
    done
  })

  it('reads the target now with no wraps ahead', () => {
    const arc = building(3, 1)
    expect(radioIntensityTargetAhead(arc, where, 0)).toBe(radioIntensityTarget(arc, 50, 60))
  })

  it('a change landing at the next phrase start leans to that phrase, not this one', () => {
    const arc = building(3, 0)
    expect(radioIntensityTargetAhead(arc, where, 3)).toBe(radioIntensityTarget(arc, 50, 60))
    expect(radioIntensityTargetAhead(arc, where, 4)).toBeCloseTo(lo + ((hi - lo) * 2) / 3, 9)
    // from the phrase's third lap, the next phrase start is two tops away
    expect(radioIntensityTargetAhead(arc, { ...where, lap: 2 }, 2)).toBeCloseTo(
      lo + ((hi - lo) * 2) / 3,
      9
    )
  })

  it("across the phases: the build's last phrase into the breakdown, the breakdown into the drop", () => {
    expect(radioIntensityTargetAhead(building(3, 2), where, 4)).toBeCloseTo(lo, 9)
    const breakdown: RadioIntensityArc = {
      ...building(1, 0),
      phase: 'breakdown',
      depth: 'full',
      rests: ['r0']
    }
    expect(radioIntensityTarget(breakdown, 50, 60)).toBeCloseTo(lo, 9)
    expect(radioIntensityTargetAhead(breakdown, where, 4)).toBeCloseTo(hi, 9)
    // a two-phrase breakdown is still lo a phrase on
    expect(radioIntensityTargetAhead({ ...breakdown, phrases: 2 }, where, 4)).toBeCloseTo(lo, 9)
  })

  it("the next build: as decided, or before its draw at its menu's middle, a bigger peak from the countdown", () => {
    const ride: RadioIntensityArc = { ...building(1, 0), phase: 'drop' }
    const decided: RadioIntensityArc = {
      ...ride,
      decided: {
        event: 'cycle',
        strip: true,
        next: { phrases: 2, big: false, untilBig: 2, peakRows: 5 }
      }
    }
    expect(radioIntensityTargetAhead(decided, { ...where, lap: 3 }, 1)).toBeCloseTo(
      lo + (hi - lo) / 2,
      9
    )
    // not decided yet (energy 50: the menu 2, 3, 4, its middle 3)
    expect(radioIntensityTargetAhead(ride, where, 4)).toBeCloseTo(lo + (hi - lo) / 3, 9)
    // the countdown says the next cycle is a bigger peak: its top is lifted and its build is longer
    const big = radioIntensityTargets(50, 60, true)
    expect(radioIntensityTargetAhead({ ...ride, untilBig: 1 }, where, 4)).toBeCloseTo(
      big.lo + (big.hi - big.lo) / 4,
      9
    )
  })

  it('a press moves where it lands: a quick drop pressed in the build is the drop at the next top', () => {
    const arc = building(3, 0)
    const pressed = pressRadioIntensity(arc, 'drop', { lap: 1, phraseLaps: 4, late: false })!
    expect(radioIntensityTargetAhead(pressed, { ...where, lap: 1 }, 1)).toBeCloseTo(hi, 9)
    expect(radioIntensityTargetAhead(pressed, { ...where, lap: 1 }, 3)).toBeCloseTo(hi, 9)
    expect(radioIntensityTargetAhead(arc, { ...where, lap: 1 }, 3)).toBeCloseTo(
      lo + ((hi - lo) * 2) / 3,
      9
    )
  })

  it('a one-lap phrase (16-bar loops): every top is a phrase start', () => {
    const one = { ...where, loopBars: 16, phraseLaps: 1 }
    expect(radioIntensityTargetAhead(building(3, 0), one, 1)).toBeCloseTo(
      lo + ((hi - lo) * 2) / 3,
      9
    )
    expect(radioIntensityTargetAhead(building(3, 1), one, 1)).toBeCloseTo(hi, 9)
    // (the build's last phrase start decided its breakdown at that same top)
    const last: RadioIntensityArc = {
      ...building(3, 2),
      decided: {
        event: 'breakdown',
        depth: 'full',
        rest: [],
        throwRowId: null,
        throw: null,
        carry: false,
        next: { phrases: 1 }
      }
    }
    expect(radioIntensityTargetAhead(last, one, 1)).toBeCloseTo(lo, 9)
  })

  it("marks the tops an arc step takes: the next cycle's strip-back, then its adds up to the peak", () => {
    const ride: RadioIntensityArc = { ...building(1, 0), phase: 'drop' }
    const steps = (count: number): number[] =>
      radioIntensityAhead(ride, { ...where, count }, 16)
        .map((t, i) => (t.step ? i : -1))
        .filter((i) => i >= 0)
    // 5 rows: one stripped at the cycle's top (4), one added back at the next phrase start (8)
    expect(steps(5)).toEqual([4, 8])
    // at the fewest rows nothing is stripped, and the build is raised to fit its three adds
    expect(steps(2)).toEqual([8, 12, 16])
  })

  it("radio's change lands past the tops an arc step takes, on its own grid", () => {
    const ride: RadioIntensityArc = { ...building(1, 0), phase: 'drop' }
    // due at the cycle's top (4), which the strip-back takes, then the add's (8): it lands at 12,
    // the build's third phrase (the menu's middle, 3 phrases: the top target)
    const five = { ...where, count: 5 }
    expect(radioIntensityLandingTarget(ride, five, 4, 4)).toBeCloseTo(hi, 9)
    // with no phrase grid it takes the next free top: still the build's first phrase
    expect(radioIntensityLandingTarget(ride, five, 4, 0)).toBeCloseTo(lo + (hi - lo) / 3, 9)
    // (and with nothing stepping there, the build's first phrase too)
    expect(radioIntensityTargetAhead(ride, five, 4)).toBeCloseTo(lo + (hi - lo) / 3, 9)
    // a top no step takes is where it lands (the build at its peak adds nothing)
    expect(radioIntensityLandingTarget(building(3, 0), five, 4, 4)).toBeCloseTo(
      lo + ((hi - lo) * 2) / 3,
      9
    )
    // a build's add takes its phrase start: radio's change lands at the next
    expect(radioIntensityLandingTarget(building(3, 0), where, 4, 4)).toBeCloseTo(hi, 9)
    expect(radioIntensityLandingTarget(building(3, 2), where, 4, 4)).toBeCloseTo(lo, 9)
  })

  it('is pure: the arc is left as it was, and nothing is drawn from Math.random', () => {
    const arc = building(3, 2)
    const before = JSON.stringify(arc)
    const real = Math.random
    let draws = 0
    Math.random = () => {
      draws++
      return real()
    }
    try {
      radioIntensityTargetAhead(arc, where, 16)
      radioIntensityLandingTarget(arc, where, 4, 4)
    } finally {
      Math.random = real
    }
    expect(JSON.stringify(arc)).toBe(before)
    expect(draws).toBe(0)
  })
})

// ---- the buttons as both radios show and press them (intensityArcShown, intensityPressNow;
// moved from sssketch's radioIntensityGlue for the web, review of ell.ing/radio 9d4f800) ----

const arcWith = (o: Partial<RadioIntensityArc>): RadioIntensityArc => ({
  ...newRadioIntensityArc(),
  begun: true,
  phrases: 2,
  ...o
})
const drop = (returning: string[], renew: string[] = []): RadioIntensityDecided => ({
  event: 'drop',
  returning,
  renew
})

describe('intensityArcShown', () => {
  const room = { count: 3, max: 6, canAdd: true, canStrip: true }
  const at = { lap: 0, phraseLaps: 2, room, quickDropCanSound: true }

  it('before the machine has begun, neither button can act', () => {
    const shown = intensityArcShown(newRadioIntensityArc(), at)
    expect(shown).toEqual({
      phase: 'build',
      build: 'build',
      drop: 'drop',
      canBuild: false,
      canDrop: false
    })
  })

  it('in a build: build adds (with room), drop is the quick drop when its low drop can sound', () => {
    const arc = arcWith({ phase: 'build', peakRows: 5 })
    expect(intensityArcShown(arc, at)).toMatchObject({ canBuild: true, canDrop: true })
    expect(intensityArcShown(arc, { ...at, quickDropCanSound: false }).canDrop).toBe(false)
  })

  it('build in a build with no room and nothing left to halve cannot act', () => {
    const arc = arcWith({ phase: 'build', peakRows: 3, phrases: 1, done: 0 })
    expect(intensityArcShown(arc, { ...at, room: { ...room, canAdd: false } }).canBuild).toBe(false)
  })

  it('in a breakdown: drop brings the rests back whatever the low drop says', () => {
    const arc = arcWith({ phase: 'breakdown', rests: ['d'], phrases: 2 })
    expect(intensityArcShown(arc, { ...at, quickDropCanSound: false })).toMatchObject({
      phase: 'breakdown',
      canBuild: true,
      canDrop: true
    })
  })

  it('a press waiting reads building or dropping; a decided drop pressed again does nothing', () => {
    expect(intensityArcShown(arcWith({ forced: 'build' }), at).build).toBe('building')
    const dropping = arcWith({ phase: 'breakdown', decided: drop(['d']) })
    const shown = intensityArcShown(dropping, { ...at, quickDropCanSound: false })
    expect(shown.canDrop).toBe(false)
    expect(intensityArcShown(arcWith({ forced: 'drop' }), at).drop).toBe('dropping')
  })

  it('build in a breakdown already at its shortest cannot act (both radios; review of 9d4f800)', () => {
    // the drop is decided at this phrase's decide wrap already: build changes nothing
    const arc = arcWith({ phase: 'breakdown', rests: ['d'], phrases: 2, done: 1 })
    expect(pressRadioIntensity(arc, 'build', { lap: 0, phraseLaps: 2, late: false })).toBe(arc)
    expect(intensityArcShown(arc, at).canBuild).toBe(false)
    // a phrase longer: build shortens it
    expect(intensityArcShown({ ...arc, phrases: 3 }, at).canBuild).toBe(true)
  })
})

describe('intensityPressNow', () => {
  const room = { count: 3, max: 6, canAdd: true, canStrip: true }
  const at = { lap: 0, phraseLaps: 2, can: room }
  const noRoom = { ...room, canAdd: false }

  it('refuses late what it refuses early: a build with no room and nothing to halve', () => {
    const arc = arcWith({ phase: 'build', peakRows: 3, phrases: 1, done: 0 })
    for (const late of [false, true]) {
      expect(intensityPressNow(arc, 'build', { ...at, late, can: noRoom }), String(late)).toBe(null)
    }
  })

  it('late, a press whose event would do nothing only halves, as it would early (no forced)', () => {
    const arc = arcWith({ phase: 'build', peakRows: 3, phrases: 4, done: 0 })
    const early = intensityPressNow(arc, 'build', { ...at, late: false, can: noRoom })
    const late = intensityPressNow(arc, 'build', { ...at, late: true, can: noRoom })
    expect(late).toEqual(early)
    expect(late).toMatchObject({ phrases: 2, forced: null, decided: null })
  })

  it('late, a press with an event to land still waits for the top after', () => {
    const arc = arcWith({ phase: 'build', peakRows: 5 })
    expect(intensityPressNow(arc, 'build', { ...at, late: true })).toMatchObject({
      forced: 'build',
      decided: null
    })
    expect(intensityPressNow(arc, 'build', { ...at, late: false })?.decided).toMatchObject({
      event: 'add'
    })
    expect(intensityPressNow(arc, 'drop', { ...at, late: true })).toMatchObject({
      forced: 'drop',
      decided: null
    })
  })

  it('a press that changes nothing is null: build in a breakdown at its shortest, drop again', () => {
    const shortest = arcWith({ phase: 'breakdown', rests: ['d'], phrases: 2, done: 1 })
    for (const late of [false, true]) {
      expect(intensityPressNow(shortest, 'build', { ...at, late }), String(late)).toBe(null)
      const dropping = arcWith({ phase: 'breakdown', decided: drop(['d']) })
      expect(intensityPressNow(dropping, 'drop', { ...at, late }), String(late)).toBe(null)
    }
  })

  it("refuses a quick drop when the planner's low drop cannot sound, late or not", () => {
    for (const phase of ['build', 'drop'] as const) {
      const arc = arcWith({ phase, peakRows: 5 })
      for (const late of [false, true]) {
        const w = { ...at, late, quickDropCanSound: false }
        expect(intensityPressNow(arc, 'drop', w), `${phase} ${late}`).toBe(null)
        expect(intensityPressNow(arc, 'drop', { ...w, quickDropCanSound: true })).not.toBe(null)
      }
    }
    // not a quick drop: the breakdown's drop brings the rests back whatever the low drop says
    const bd = arcWith({ phase: 'breakdown', rests: ['d'] })
    expect(
      intensityPressNow(bd, 'drop', { ...at, late: false, quickDropCanSound: false })
    ).not.toBe(null)
  })

  it('agrees with what the buttons show, late or not', () => {
    const arcs = [
      arcWith({ phase: 'build', peakRows: 3, phrases: 1, done: 0 }),
      arcWith({ phase: 'build', peakRows: 5 }),
      arcWith({ phase: 'breakdown', rests: ['d'] }),
      arcWith({ phase: 'drop' }),
      arcWith({ phase: 'breakdown', rests: ['d'], phrases: 2, done: 1 }),
      arcWith({ phase: 'breakdown', decided: drop(['d']) }),
      arcWith({ phase: 'drop', forced: 'build' }),
      newRadioIntensityArc()
    ]
    for (const arc of arcs) {
      for (const can of [room, noRoom]) {
        for (const quickDropCanSound of [true, false]) {
          for (const lap of [0, 1]) {
            const shown = intensityArcShown(arc, {
              lap,
              phraseLaps: 2,
              room: can,
              quickDropCanSound
            })
            for (const late of [false, true]) {
              for (const action of ['build', 'drop'] as const) {
                const next = intensityPressNow(arc, action, {
                  lap,
                  phraseLaps: 2,
                  late,
                  can,
                  quickDropCanSound
                })
                // a press acts (changes the machine) exactly when its button says it can
                const acts = next !== null && next !== arc
                expect(acts).toBe(action === 'build' ? shown.canBuild : shown.canDrop)
              }
            }
          }
        }
      }
    }
  })
})
