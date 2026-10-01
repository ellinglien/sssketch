import { describe, expect, it } from 'vitest'
import {
  DEFAULT_RADIO_DENSITY,
  DENSITY_LEG_BARS,
  DENSITY_MAX,
  DENSITY_MIN,
  advanceDensityLeg,
  densityArrival,
  newDensityLeg,
  nextArcKind,
  normalizeRadioDensity,
  pickArcRemoval,
  type ArcRow,
  type DensityLeg
} from './radioDensity'

const fixed = (x: number) => () => x

describe('normalizeRadioDensity', () => {
  it('defaults to arc and keeps off', () => {
    expect(DEFAULT_RADIO_DENSITY).toBe('arc')
    expect(normalizeRadioDensity(undefined)).toBe('arc')
    expect(normalizeRadioDensity('junk')).toBe('arc')
    expect(normalizeRadioDensity('off')).toBe('off')
  })
})

describe('newDensityLeg', () => {
  it('grows to a peak of 4 or 5 and thins to a trough of 2 or 3', () => {
    expect(newDensityLeg('growing', 2, fixed(0)).target).toBe(4)
    expect(newDensityLeg('growing', 2, fixed(0.99)).target).toBe(5)
    expect(newDensityLeg('thinning', 5, fixed(0)).target).toBe(2)
    expect(newDensityLeg('thinning', 5, fixed(0.99)).target).toBe(3)
  })

  it('spreads the leg over its steps', () => {
    const leg = newDensityLeg('growing', 2, fixed(0))
    // target 4, leg 96 bars, two steps
    expect(leg.stepBars).toBe(DENSITY_LEG_BARS[0] / 2)
    expect(leg.bars).toBe(0)
  })

  it('never divides by zero when already at the target', () => {
    const leg = newDensityLeg('growing', 4, fixed(0))
    expect(leg.stepBars).toBe(DENSITY_LEG_BARS[0])
  })
})

describe('advanceDensityLeg', () => {
  const leg = (over: Partial<DensityLeg> = {}): DensityLeg => ({
    phase: 'growing',
    target: 4,
    bars: 0,
    stepBars: 8,
    ...over
  })
  const base = { loopBars: 4, busy: false, canAdd: true, canRemove: true, random: fixed(0) }

  it('counts bars and steps once a step is in', () => {
    const a = advanceDensityLeg(leg(), { ...base, count: 2 })
    expect(a.step).toBeNull()
    expect(a.leg.bars).toBe(4)
    const b = advanceDensityLeg(a.leg, { ...base, count: 2 })
    expect(b.step).toBe('add')
    expect(b.leg.bars).toBe(0)
  })

  it('waits while a step is on its way, still counting', () => {
    const a = advanceDensityLeg(leg({ bars: 8 }), { ...base, count: 2, busy: true })
    expect(a.step).toBeNull()
    expect(a.leg.bars).toBe(12)
  })

  it('turns at the peak and at the trough', () => {
    const top = advanceDensityLeg(leg({ bars: 8 }), { ...base, count: 4 })
    expect(top.step).toBeNull()
    expect(top.leg.phase).toBe('thinning')
    const bottom = advanceDensityLeg(leg({ phase: 'thinning', target: 2, bars: 8 }), {
      ...base,
      count: 2
    })
    expect(bottom.leg.phase).toBe('growing')
  })

  it('never removes while growing: rows above the peak just turn it (his rows count)', () => {
    const a = advanceDensityLeg(leg({ bars: 8 }), { ...base, count: 7 })
    expect(a.step).toBeNull()
    expect(a.leg.phase).toBe('thinning')
  })

  it('never adds while thinning', () => {
    const a = advanceDensityLeg(leg({ phase: 'thinning', target: 3, bars: 8 }), {
      ...base,
      count: 1
    })
    expect(a.step).toBeNull()
    expect(a.leg.phase).toBe('growing')
  })

  it('turns when the step it wants cannot be taken', () => {
    const a = advanceDensityLeg(leg({ bars: 8 }), { ...base, count: 2, canAdd: false })
    expect(a.step).toBeNull()
    expect(a.leg.phase).toBe('thinning')
    const b = advanceDensityLeg(leg({ phase: 'thinning', target: 2, bars: 8 }), {
      ...base,
      count: 4,
      canRemove: false
    })
    expect(b.step).toBeNull()
    expect(b.leg.phase).toBe('growing')
  })

  it('removes while thinning above the trough', () => {
    const a = advanceDensityLeg(leg({ phase: 'thinning', target: 2, bars: 8 }), {
      ...base,
      count: 4
    })
    expect(a.step).toBe('remove')
  })
})

describe('nextArcKind', () => {
  it('follows the starter order: drums, bass, lead, warm, a second drums', () => {
    expect(nextArcKind([])).toBe('drums')
    expect(nextArcKind([['drums'], ['bass']])).toBe('lead')
    expect(nextArcKind([['drums'], ['bass'], ['lead']])).toBe('warm')
    expect(nextArcKind([['drums'], ['bass'], ['lead'], ['warm']])).toBe('drums')
  })

  it("fills the first gap, whoever's rows they are", () => {
    expect(nextArcKind([['lead'], ['bass']])).toBe('drums')
    expect(nextArcKind([['drums'], ['lead']])).toBe('bass')
  })

  it('counts a combination row for each of its kinds', () => {
    expect(nextArcKind([['drums', 'bass']])).toBe('lead')
  })

  it('is null once the first DENSITY_MAX of the order are all on the bed', () => {
    expect(DENSITY_MAX).toBe(5)
    expect(nextArcKind([['drums'], ['bass'], ['lead'], ['warm'], ['drums']])).toBeNull()
  })
})

describe('pickArcRemoval', () => {
  const row = (id: string, over: Partial<ArcRow> = {}): ArcRow => ({
    id,
    kinds: ['lead'],
    radioAdded: true,
    locked: false,
    soloed: false,
    held: false,
    busy: false,
    shrinksLoop: false,
    staleness: 0,
    ...over
  })

  it('takes the stalest row radio added', () => {
    expect(pickArcRemoval([row('a', { staleness: 1 }), row('b', { staleness: 5 })])).toBe('b')
  })

  it('never his, padlocked, soloed, held, busy or loop-shrinking rows', () => {
    const rows = [
      row('his', { radioAdded: false, staleness: 9 }),
      row('locked', { locked: true, staleness: 9 }),
      row('solo', { soloed: true, staleness: 9 }),
      row('held', { held: true, staleness: 9 }),
      row('busy', { busy: true, staleness: 9 }),
      row('long', { shrinksLoop: true, staleness: 9 }),
      row('ok', { staleness: 0 })
    ]
    expect(pickArcRemoval(rows)).toBe('ok')
  })

  it('never the last drums or bass, counting his rows too', () => {
    expect(
      pickArcRemoval([row('d', { kinds: ['drums'] }), row('b', { kinds: ['bass'] })])
    ).toBeNull()
    expect(
      pickArcRemoval([
        row('d', { kinds: ['drums'], staleness: 3 }),
        row('his-d', { kinds: ['drums'], radioAdded: false })
      ])
    ).toBe('d')
  })

  it('is null with nothing removable', () => {
    expect(pickArcRemoval([])).toBeNull()
  })
})

describe('densityArrival', () => {
  it('is always filter in or bloom, even with transitions off', () => {
    for (const r of [0, 0.3, 0.6, 0.99]) {
      for (const t of ['off', 'subtle', 'bold'] as const) {
        const a = densityArrival(t, ['lead'], fixed(r))
        expect(['filter in', 'bloom']).toContain(a.kind)
        expect(a.beats).toBe(4)
      }
    }
  })

  it('stays in range', () => {
    expect(DENSITY_MIN).toBe(2)
  })
})

describe('the density setting', () => {
  it('normalizeRadioSettings keeps it and defaults it to arc', async () => {
    const { normalizeRadioSettings, radioDensityOf, DEFAULT_RADIO_SETTINGS } =
      await import('./radioSchedule')
    expect(normalizeRadioSettings({}).density).toBe('arc')
    expect(normalizeRadioSettings({ density: 'off' }).density).toBe('off')
    expect(DEFAULT_RADIO_SETTINGS.density).toBe('arc')
    const { density: _omit, ...withoutDensity } = DEFAULT_RADIO_SETTINGS
    void _omit
    expect(radioDensityOf(withoutDensity)).toBe('arc')
  })
})
