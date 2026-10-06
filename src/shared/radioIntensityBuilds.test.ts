// The drop is the moment (spec 2026-10-05-radio-intensity-arc-design 4.4, 5.1): the forecast's
// arcRole in radioBuildSize.ts, and rollTurnaround's `drop` in radioTurnaround.ts.
import { describe, expect, it } from 'vitest'
import type { DiscoverSlotKind } from './discoverSlotKind'
import {
  NO_CHANGE_FORECAST,
  NO_RADIO_BUILDS,
  radioArcRoleTier,
  radioPayoffMet,
  radioPhraseEndBuild,
  type RadioChangeForecast
} from './radioBuildSize'
import {
  TURNAROUND_FAMILIES,
  TURNAROUND_GAP_CHANCE,
  rollTurnaround,
  turnaroundCapBeats,
  turnaroundDropGapChance,
  type TurnaroundInput,
  type TurnaroundRow
} from './radioTurnaround'
import { seededRandom } from './seededRandom'

const F = (o: Partial<RadioChangeForecast> = {}): RadioChangeForecast => ({
  ...NO_CHANGE_FORECAST,
  ...o
})
const FREE = { clock: NO_RADIO_BUILDS, aheadBars: 4, phraseBars: 16 }
/** A large build one bar ago: the budget would hold any other large back. */
const JUST = { clock: { sinceBuild: 0, sinceLarge: 0 }, aheadBars: 1, phraseBars: 16 }

describe('arcRole sizes a phrase end', () => {
  it('build, strip, breakdown and hold are medium at most; an arc add is no longer large', () => {
    for (const arcRole of ['build', 'strip', 'breakdown', 'hold'] as const) {
      expect(radioPhraseEndBuild(F({ arcRole, arcStep: 'add', rows: 1 }), 0, FREE).size).toBe(
        'medium'
      )
      expect(radioPhraseEndBuild(F({ arcRole, rows: 3 }), 3, FREE).size, arcRole).toBe('medium')
    }
    expect(radioPhraseEndBuild(F({ arcStep: 'add', rows: 1 }), 0, FREE).size).toBe('large')
  })

  it('the drop with the low end back is large, exempt from the budget', () => {
    const drop = F({ arcRole: 'drop', lowEndReturn: true, rows: 0 })
    expect(radioPhraseEndBuild(drop, 0, JUST)).toEqual({
      skip: false,
      size: 'large',
      payoff: 'large'
    })
    // without the role, the same forecast falls to the budget
    expect(radioPhraseEndBuild({ ...drop, arcRole: undefined }, 0, JUST).size).not.toBe('large')
  })

  it('a swell drop (nothing rested) is medium at most: no gap', () => {
    expect(radioPhraseEndBuild(F({ arcRole: 'drop', rows: 3 }), 0, FREE).size).toBe('medium')
    expect(radioArcRoleTier(F({ arcRole: 'drop' }), 'large')).toBe('medium')
    expect(radioArcRoleTier(F({ arcRole: 'drop' }), 'small')).toBe('small')
  })

  it('never promotes under an arc role', () => {
    const f = F({ rows: 2 })
    const old = { clock: { sinceBuild: 64, sinceLarge: 64 }, aheadBars: 4, phraseBars: 16 }
    expect(radioPhraseEndBuild(f, 1, old).size).toBe('large') // promoted today
    expect(radioPhraseEndBuild({ ...f, arcRole: 'hold' }, 1, old).size).toBe('medium')
  })

  it('the breakdown pays off a medium build with nothing landing', () => {
    expect(radioPayoffMet(F({ arcRole: 'breakdown' }), 'medium')).toBe(true)
    expect(radioPayoffMet(F({ arcRole: 'breakdown' }), 'large')).toBe(false)
    expect(radioPhraseEndBuild(F({ arcRole: 'breakdown' }), 0, FREE)).toMatchObject({
      skip: false,
      size: 'medium',
      payoff: 'medium'
    })
    expect(radioPhraseEndBuild(F({ arcRole: 'hold' }), 0, FREE).skip).toBe(true)
  })
})

function row(id: string, kinds: DiscoverSlotKind[], o: Partial<TurnaroundRow> = {}): TurnaroundRow {
  return { id, kinds, hooked: false, audible: true, inFilterIn: false, barLength: 4, ...o }
}
// the breakdown's last lap: drums and bass rest (not audible), two rows carry
const CARRIED: TurnaroundRow[] = [
  row('d', ['drums'], { audible: false }),
  row('b', ['bass'], { audible: false }),
  row('l', ['lead']),
  row('w', ['warm'])
]
function input(over: Partial<TurnaroundInput> = {}): TurnaroundInput {
  return {
    rate: 'often',
    random: seededRandom('drop-roll'),
    loopBars: 4,
    lastPhrase: null,
    rows: CARRIED,
    arc: 'growing',
    leavingRowId: null,
    combine: true,
    size: 'large',
    payoff: 'large',
    ...over
  }
}

describe('the drop roll', () => {
  it('leads with the riser at its longest, with no draw for move or length', () => {
    for (const loopBars of [2, 4, 8, 16]) {
      const r = seededRandom(`riser${loopBars}`)
      for (let i = 0; i < 200; i++) {
        const plan = rollTurnaround(input({ loopBars, random: r, drop: { gapChance: 1 } }))!
        expect(plan.move, `${loopBars}`).toBe('riser')
        expect(plan.parts![0].beats, `${loopBars}`).toBe(turnaroundCapBeats(loopBars))
      }
    }
  })

  it('draws the gap with its chance: every drop at drama 50 and up, one row enough', () => {
    expect(turnaroundDropGapChance(50)).toBe(1)
    expect(turnaroundDropGapChance(49)).toBe(TURNAROUND_GAP_CHANCE)
    const r = seededRandom('gaps')
    for (let i = 0; i < 500; i++) {
      const plan = rollTurnaround(input({ random: r, drop: { gapChance: 1 } }))!
      expect(plan.gapBeats).toBeGreaterThan(0)
    }
    const lone = [row('d', ['drums'], { audible: false }), row('l', ['lead'])]
    expect(rollTurnaround(input({ rows: lone, drop: { gapChance: 1 } }))!.gapBeats).toBeGreaterThan(
      0
    )
    expect(rollTurnaround(input({ rows: lone }))!.gapBeats ?? 0).toBe(0) // today: two rows to gap
    let gaps = 0
    for (let i = 0; i < 2000; i++) {
      const plan = rollTurnaround(input({ random: r, drop: { gapChance: TURNAROUND_GAP_CHANCE } }))!
      if ((plan.gapBeats ?? 0) > 0) gaps += 1
    }
    expect(gaps / 2000).toBeGreaterThan(0.6)
    expect(gaps / 2000).toBeLessThan(0.85)
  })

  it('with the riser family off, or at a loop too short for it, rolls as a large phrase end', () => {
    const noRiser = TURNAROUND_FAMILIES.filter((f) => f !== 'riser')
    for (let s = 0; s < 50; s++) {
      const a = rollTurnaround(
        input({ random: seededRandom(`f${s}`), moves: noRiser, drop: { gapChance: 1 } })
      )
      const b = rollTurnaround(input({ random: seededRandom(`f${s}`), moves: noRiser }))
      expect(a).toEqual(b)
      const short = { loopBars: 1, random: seededRandom(`s${s}`) }
      expect(rollTurnaround(input({ ...short, drop: { gapChance: 1 } }))?.move).not.toBe('riser')
    }
  })

  it('below large it is ignored, draw for draw', () => {
    for (let s = 0; s < 200; s++) {
      for (const size of ['medium', 'small', undefined] as const) {
        const a = rollTurnaround(
          input({ size, random: seededRandom(`m${s}`), drop: { gapChance: 0.75 } })
        )
        const b = rollTurnaround(input({ size, random: seededRandom(`m${s}`) }))
        expect(a).toEqual(b)
      }
    }
  })

  it("a turn keeps its own move and length, and takes the drop's gap chance", () => {
    const r = seededRandom('turn-drop')
    let gaps = 0
    for (let i = 0; i < 300; i++) {
      const plan = rollTurnaround(
        input({ random: r, force: { move: 'riser', maxBeats: 8 }, drop: { gapChance: 1 } })
      )!
      expect(plan.move).toBe('riser')
      if ((plan.gapBeats ?? 0) > 0) gaps += 1
    }
    expect(gaps).toBe(300)
  })
})
