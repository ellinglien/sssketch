// Build-ups sized to the change (spec 2026-10-03-radio-anointed-stems-design 4.3-4.4): the
// per-change palette (pickTransition, radioGestureBeats) and the phrase end's roll
// (rollTurnaround's `size`, `payoff`, TurnaroundRow.exiting). Absent, every draw is today's.
import { describe, expect, it } from 'vitest'
import type { DiscoverSlotKind } from './discoverSlotKind'
import { advanceDensityLeg } from './radioDensity'
import { radioGestureBeats } from './radioManualChanges'
import { turnaroundSilencedRowIds } from './radioThrows'
import { pickTransition, type RadioTransitions } from './radioTransition'
import {
  rollTurnaround,
  type RadioTurnarounds,
  type TurnaroundArc,
  type TurnaroundForce,
  type TurnaroundInput,
  type TurnaroundMemory,
  type TurnaroundMove,
  type TurnaroundPlan,
  type TurnaroundRow
} from './radioTurnaround'
import { hashText, seededRandom } from './seededRandom'

const KINDS: DiscoverSlotKind[][] = [['drums'], ['bass'], ['lead'], ['warm'], []]

/** 2000 seeded draws per temperament and kind set, with the stream position after each. */
function transitionTrace(sizing?: Parameters<typeof pickTransition>[3]): string {
  const out: string[] = []
  for (const t of ['off', 'subtle', 'bold'] as RadioTransitions[])
    for (const kinds of KINDS) {
      const random = seededRandom(`pt-${t}-${kinds.join('+')}`)
      for (let i = 0; i < 2000; i++) out.push(pickTransition(t, kinds, random, sizing))
      out.push(String(random()))
    }
  return out.join(',')
}

const row = (
  id: string,
  kinds: DiscoverSlotKind[],
  o: Partial<TurnaroundRow> = {}
): TurnaroundRow => ({
  id,
  kinds,
  hooked: false,
  audible: true,
  inFilterIn: false,
  barLength: 4,
  ...o
})
const BED = [row('d', ['drums']), row('b', ['bass']), row('l', ['lead']), row('w', ['warm'])]

/** Seeded rolls over rates, arcs, loops and depths, chained through the memory, with the stream
 * position after each. */
function rollTrace(extra: Partial<TurnaroundInput> = {}, rows: TurnaroundRow[] = BED): string {
  const out: string[] = []
  for (const rate of ['rare', 'often'] as RadioTurnarounds[])
    for (const arc of ['growing', 'thinning', 'steady'] as TurnaroundArc[])
      for (const loopBars of [2, 4, 8])
        for (const depth of ['subtle', 'bold'] as const)
          for (const combine of [false, true]) {
            const random = seededRandom(`roll-${rate}-${arc}-${loopBars}-${depth}-${combine}`)
            let lastPhrase: TurnaroundInput['lastPhrase'] = null
            for (let k = 0; k < 60; k++) {
              const plan = rollTurnaround({
                rate,
                random,
                loopBars,
                lastPhrase,
                rows,
                arc,
                leavingRowId: null,
                depth,
                combine,
                ...extra
              })
              out.push(JSON.stringify(plan))
              lastPhrase =
                plan === null
                  ? null
                  : {
                      move: plan.move,
                      beats: plan.beats,
                      halvings: plan.halvings,
                      ...(plan.parts && plan.parts.length > 1
                        ? { parts: plan.parts.map((p) => ({ move: p.move, beats: p.beats })) }
                        : {})
                    }
              out.push(String(random()))
            }
          }
  return out.join('\n')
}

/** Seeded turns (no memory, rate off) over every chip, the planner's choice and a short turn, by
 * arc, loop, depth and combine, with the stream position after each. */
function turnTrace(extra: Partial<TurnaroundInput> = {}): string {
  const out: string[] = []
  const forces: TurnaroundForce[] = [
    {},
    { maxBeats: 4 },
    ...(['drum drop', 'low drop', 'stop', 'wash', 'lift', 'dip', 'riser'] as TurnaroundMove[]).map(
      (move) => ({ move })
    )
  ]
  for (const force of forces)
    for (const arc of ['growing', 'thinning', 'steady'] as TurnaroundArc[])
      for (const loopBars of [2, 4, 8])
        for (const depth of ['subtle', 'bold'] as const)
          for (const combine of [false, true]) {
            const random = seededRandom(
              `turn-${JSON.stringify(force)}-${arc}-${loopBars}-${depth}-${combine}`
            )
            for (let k = 0; k < 20; k++) {
              const plan = rollTurnaround({
                rate: 'off',
                random,
                loopBars,
                lastPhrase: null,
                rows: BED,
                arc,
                leavingRowId: null,
                depth,
                combine,
                force,
                ...extra
              })
              out.push(JSON.stringify(plan))
              out.push(String(random()))
            }
          }
  return out.join('\n')
}

// Recorded from the UNMODIFIED radioTransition.ts / radioTurnaround.ts (sssketch 78be6e5; the
// turns' from 730e48d, the same code).
const TRANSITIONS_BEFORE = 'd5e51d0c'
const ROLLS_BEFORE = 'b5136502'
const TURNS_BEFORE = 'c9a60f7b'

describe('absent: today, draw for draw', () => {
  it('pickTransition with no sizing', () => {
    expect(hashText(transitionTrace())).toBe(TRANSITIONS_BEFORE)
    expect(hashText(transitionTrace({}))).toBe(TRANSITIONS_BEFORE)
  })

  it('rollTurnaround with no size and no payoff', () => {
    expect(hashText(rollTrace())).toBe(ROLLS_BEFORE)
    expect(hashText(rollTrace({ payoff: 'large' }))).toBe(ROLLS_BEFORE)
  })

  it('turns with no payoff, whatever the size (a turn ignores it)', () => {
    expect(hashText(turnTrace())).toBe(TURNS_BEFORE)
    expect(hashText(turnTrace({ size: 'large' }))).toBe(TURNS_BEFORE)
    expect(hashText(turnTrace({ size: 'small' }))).toBe(TURNS_BEFORE)
  })

  it('radioGestureBeats: a riser is 8 beats without a size and at large', () => {
    expect(radioGestureBeats('riser', () => 2)).toBe(8)
    expect(radioGestureBeats('riser', () => 2, 'large')).toBe(8)
    expect(radioGestureBeats('riser', () => 2, 'medium')).toBe(4)
    expect(radioGestureBeats('hole', () => 2, 'medium')).toBe(2)
    expect(radioGestureBeats('duck', () => 2, 'small')).toBe(4)
  })
})

describe('the per-change palette by size', () => {
  const N = 20000
  function counts(
    sizing: Parameters<typeof pickTransition>[3],
    kinds: DiscoverSlotKind[]
  ): { out: Record<string, number>; draws: number } {
    const random = seededRandom(`counts-${kinds.join('+')}`)
    const out: Record<string, number> = {}
    let draws = 0
    const counted = (): number => {
      draws++
      return random()
    }
    for (let i = 0; i < N; i++) {
      const k = pickTransition('bold', kinds, counted, sizing)
      out[k] = (out[k] ?? 0) + 1
    }
    return { out, draws }
  }

  it('small never gives a riser; medium as today; large about twice; one draw each', () => {
    for (const kinds of KINDS.slice(0, 4)) {
      const today = counts(undefined, kinds)
      const small = counts({ size: 'small' }, kinds)
      const none = counts({ size: 'none' }, kinds)
      const medium = counts({ size: 'medium' }, kinds)
      const large = counts({ size: 'large' }, kinds)
      expect(small.out.riser ?? 0).toBe(0)
      expect(none.out.riser ?? 0).toBe(0)
      // medium is today's table exactly: the same seed, the same draws
      expect(medium.out).toEqual(today.out)
      // bold tables give the riser 0.1 of 1: x2 is 0.2 of 1.1
      expect(large.out.riser / N).toBeCloseTo(0.2 / 1.1, 1)
      for (const c of [small, none, medium, large]) expect(c.draws).toBe(N)
    }
  })

  it('a hook return never draws a filter in or a bloom', () => {
    for (const kinds of KINDS)
      for (const size of ['small', 'medium', 'large'] as const) {
        const { out, draws } = counts({ size, hookReturn: true }, kinds)
        expect(out['filter in'] ?? 0).toBe(0)
        expect(out.bloom ?? 0).toBe(0)
        expect(draws).toBe(N)
      }
  })

  it('subtle has no riser at any size; off is always a cut', () => {
    const random = seededRandom('subtle')
    for (let i = 0; i < 5000; i++) {
      expect(pickTransition('subtle', ['warm'], random, { size: 'large' })).not.toBe('riser')
      expect(pickTransition('off', ['warm'], random, { size: 'large', hookReturn: true })).toBe(
        'cut'
      )
    }
  })
})

describe('the phrase end by size', () => {
  /** Every plan of many seeded fresh rolls at `size` (no memory), combine on, bold, growing. */
  function plans(
    extra: Partial<TurnaroundInput>,
    rate: RadioTurnarounds = 'often',
    n = 4000
  ): (TurnaroundPlan | null)[] {
    const random = seededRandom(`plans-${JSON.stringify(extra)}-${rate}`)
    const out: (TurnaroundPlan | null)[] = []
    for (let i = 0; i < n; i++) {
      out.push(
        rollTurnaround({
          rate,
          random,
          loopBars: 8,
          lastPhrase: null,
          rows: BED,
          arc: 'growing',
          leavingRowId: null,
          depth: 'bold',
          combine: true,
          ...extra
        })
      )
    }
    return out
  }
  const risers = (ps: (TurnaroundPlan | null)[]): (TurnaroundPlan | null)[] =>
    ps.filter((p) => p !== null && (p.parts ?? [{ move: p.move }]).some((x) => x.move === 'riser'))

  it('none and small: the riser rare, at most 4 beats, never gapped, at most two moves', () => {
    const today = risers(plans({})).length
    for (const size of ['none', 'small'] as const) {
      const ps = plans({ size })
      const rs = risers(ps)
      expect(rs.length).toBeLessThan(today * 0.35)
      for (const p of rs) {
        const riser = p!.parts!.find((x) => x.move === 'riser')!
        expect(riser.beats).toBeLessThanOrEqual(4)
      }
      for (const p of ps) {
        if (p === null) continue
        expect(p.gapBeats ?? 0).toBe(0)
        expect(p.parts!.length).toBeLessThanOrEqual(2)
      }
    }
  })

  it('medium: the riser as today, at most 8 beats, never gapped', () => {
    const ps = plans({ size: 'medium' })
    for (const p of ps) {
      if (p === null) continue
      expect(p.gapBeats ?? 0).toBe(0)
      const riser = p.parts!.find((x) => x.move === 'riser')
      if (riser) expect(riser.beats).toBeLessThanOrEqual(8)
    }
    expect(risers(ps).length / ps.length).toBeCloseTo(risers(plans({})).length / ps.length, 1)
  })

  it('large fires at rare and often but not off, and gaps about as often as today', () => {
    for (const rate of ['rare', 'often'] as const) {
      const ps = plans({ size: 'large' }, rate, 1000)
      expect(ps.every((p) => p !== null)).toBe(true)
    }
    expect(plans({ size: 'large' }, 'off', 200).every((p) => p === null)).toBe(true)
    const large = risers(plans({ size: 'large' }))
    const gapped = large.filter((p) => (p!.gapBeats ?? 0) > 0).length
    expect(gapped / large.length).toBeGreaterThan(0.5)
  })

  it('a gap only with a large payoff (a turn too)', () => {
    for (const payoff of ['none', 'medium'] as const) {
      for (const p of plans({ size: 'large', payoff })) expect(p?.gapBeats ?? 0).toBe(0)
      for (const p of plans({ payoff, force: {} }, 'often', 1000)) expect(p?.gapBeats ?? 0).toBe(0)
    }
  })

  it('large rolls fresh after any phrase end: no diminution, no "never two in a row"', () => {
    const memories: TurnaroundMemory[] = [
      { move: 'riser', beats: 8, halvings: 0 },
      { move: 'stop', beats: 4, halvings: 0 },
      { move: 'lift', beats: 8, halvings: 0 },
      {
        move: 'riser',
        beats: 8,
        halvings: 0,
        parts: [
          { move: 'riser', beats: 8 },
          { move: 'low drop', beats: 4 }
        ]
      }
    ]
    for (const lastPhrase of memories) {
      const ps = plans({ size: 'large', lastPhrase }, 'rare', 1000)
      expect(ps.every((p) => p !== null && p.halvings === 0)).toBe(true)
      expect(risers(ps).length).toBeGreaterThan(0)
      expect(ps.some((p) => (p!.gapBeats ?? 0) > 0)).toBe(true)
      // below large the memory still rules: a riser, a stop or a combined riser never repeats
      if (lastPhrase.move !== 'lift') {
        expect(plans({ size: 'medium', lastPhrase }, 'often', 200).every((p) => p === null)).toBe(
          lastPhrase.parts === undefined
        )
      }
    }
  })

  it('a diminution keeps at most two moves at none and small', () => {
    const lastPhrase: TurnaroundMemory = {
      move: 'drum drop',
      beats: 8,
      halvings: 0,
      parts: [
        { move: 'drum drop', beats: 8 },
        { move: 'low drop', beats: 8 },
        { move: 'lift', beats: 8 }
      ]
    }
    const today = plans({ lastPhrase }, 'often', 200).filter((p) => p !== null)
    expect(today.some((p) => p!.parts!.length === 3)).toBe(true)
    for (const size of ['none', 'small', 'medium'] as const) {
      const ps = plans({ size, lastPhrase }, 'often', 200).filter((p) => p !== null)
      expect(ps.length).toBeGreaterThan(0)
      for (const p of ps) {
        expect(p!.halvings).toBe(1)
        expect(p!.parts!.length).toBeLessThanOrEqual(size === 'medium' ? 3 : 2)
      }
    }
  })

  it('an exiting row is never silenced, and takes the wash', () => {
    const rows = [
      row('d', ['drums'], { exiting: true }),
      row('b', ['bass']),
      row('l', ['lead']),
      row('w', ['warm'])
    ]
    const random = seededRandom('exiting')
    let washed = 0
    for (let i = 0; i < 4000; i++) {
      for (const size of [undefined, 'large'] as const) {
        const plan = rollTurnaround({
          rate: 'often',
          random,
          loopBars: 8,
          lastPhrase: null,
          rows,
          arc: i % 2 === 0 ? 'growing' : 'steady',
          leavingRowId: null,
          depth: 'bold',
          combine: true,
          ...(size ? { size } : {})
        })
        if (plan === null) continue
        expect(turnaroundSilencedRowIds(plan)).not.toContain('d')
        const wash = plan.parts?.find((p) => p.move === 'wash')
        if (wash) {
          expect(wash.rowIds).toEqual(['d'])
          washed++
        }
      }
    }
    expect(washed).toBeGreaterThan(0)
  })
})

describe('advanceDensityLeg waits', () => {
  it('a ready step waits, its bars counting on; a turn never waits; absent is today', () => {
    const leg = { phase: 'growing' as const, target: 4, bars: 30, stepBars: 32 }
    const base = { count: 2, loopBars: 4, busy: false, canAdd: true, canRemove: true }
    expect(advanceDensityLeg(leg, base).step).toBe('add')
    expect(advanceDensityLeg(leg, { ...base, waits: false }).step).toBe('add')
    const waited = advanceDensityLeg(leg, { ...base, waits: true })
    expect(waited).toEqual({ leg: { ...leg, bars: 34 }, step: null })
    const turned = advanceDensityLeg(leg, { ...base, count: 4, waits: true, random: () => 0.5 })
    expect(turned.leg.phase).toBe('thinning')
  })
})
