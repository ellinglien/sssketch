// Build-ups sized to the change, and every turnaround paid off (spec
// 2026-10-03-radio-anointed-stems-design section 4): the pure classification (radioBuildSize.ts).
import { describe, expect, it } from 'vitest'
import {
  BUILD_SPACING_BARS,
  NO_CHANGE_FORECAST,
  NO_RADIO_BUILDS,
  advanceRadioBuildClock,
  noteRadioBuild,
  radioApplyBuildBudget,
  radioArcStepWaits,
  radioBuildArc,
  radioBuildSize,
  radioBuildTier,
  radioPayoffMet,
  radioPayoffOf,
  radioPayoffShortfall,
  radioNoteTurnaround,
  radioPhraseEndBuild,
  radioTurnaroundPayoffNeed,
  type RadioChangeForecast
} from './radioBuildSize'

const F = (o: Partial<RadioChangeForecast> = {}): RadioChangeForecast => ({
  ...NO_CHANGE_FORECAST,
  ...o
})
const FREE = { clock: NO_RADIO_BUILDS, aheadBars: 4, phraseBars: 16 }

describe('radioBuildTier', () => {
  it('none, small, medium and large from the forecast', () => {
    expect(radioBuildTier(F())).toBe('none')
    expect(radioBuildTier(F({ rows: 1 }))).toBe('small')
    expect(radioBuildTier(F({ rows: 2 }))).toBe('medium')
    expect(radioBuildTier(F({ rows: 3 }))).toBe('large')
    expect(radioBuildTier(F({ rows: 1, lowEndReturn: true }))).toBe('large')
    expect(radioBuildTier(F({ course: true }))).toBe('large')
    expect(radioBuildTier(F({ arcStep: 'add', rows: 1 }))).toBe('large')
    expect(radioBuildTier(F({ arcStep: 'remove' }))).toBe('large')
  })

  it('a hook back: medium after a short absence, large after a long one, by the pace scale', () => {
    const back = (awayBars: number): RadioChangeForecast => F({ rows: 1, hookReturn: { awayBars } })
    expect(radioBuildTier(back(16))).toBe('medium')
    expect(radioBuildTier(back(24))).toBe('large')
    // ludicrous (scale 0.5): 8 bars is short, 16 long
    expect(radioBuildTier(back(8), 0.5)).toBe('medium')
    expect(radioBuildTier(back(16), 0.5)).toBe('large')
    // slow (scale 1.5): 24 is still short
    expect(radioBuildTier(back(24), 1.5)).toBe('medium')
    expect(radioBuildTier(back(32), 1.5)).toBe('large')
  })
})

describe('the budget', () => {
  it('large falls to medium within a phrase of the last large build', () => {
    const clock = { sinceBuild: 40, sinceLarge: 8 }
    expect(radioApplyBuildBudget('large', { clock, aheadBars: 4, phraseBars: 16 })).toBe('medium')
    expect(radioApplyBuildBudget('large', { clock, aheadBars: 8, phraseBars: 16 })).toBe('large')
  })

  it('medium and large fall to small within BUILD_SPACING_BARS of any build', () => {
    const clock = { sinceBuild: 0, sinceLarge: null }
    expect(radioApplyBuildBudget('medium', { clock, aheadBars: 4, phraseBars: 16 })).toBe('small')
    expect(radioApplyBuildBudget('large', { clock, aheadBars: 4, phraseBars: 16 })).toBe('small')
    expect(
      radioApplyBuildBudget('medium', { clock, aheadBars: BUILD_SPACING_BARS, phraseBars: 16 })
    ).toBe('medium')
    expect(radioApplyBuildBudget('small', { clock, aheadBars: 0, phraseBars: 16 })).toBe('small')
  })

  it('no build yet: no downgrade', () => {
    expect(radioBuildSize(F({ rows: 3 }), FREE)).toBe('large')
  })

  it('the clock counts bars from the build it noted, and nothing before the first', () => {
    expect(advanceRadioBuildClock(NO_RADIO_BUILDS, 4)).toBe(NO_RADIO_BUILDS)
    let c = noteRadioBuild(NO_RADIO_BUILDS, false)
    c = advanceRadioBuildClock(c, 4)
    expect(c).toEqual({ sinceBuild: 4, sinceLarge: null })
    c = advanceRadioBuildClock(noteRadioBuild(c, true), 8)
    expect(c).toEqual({ sinceBuild: 8, sinceLarge: 8 })
  })
})

describe('a large build without a riser', () => {
  it('noteRadioBuild: a riserless large resets only the large count; riserless and small, nothing', () => {
    const c = { sinceBuild: 4, sinceLarge: 40 }
    expect(noteRadioBuild(c, true, false)).toEqual({ sinceBuild: 4, sinceLarge: 0 })
    expect(noteRadioBuild(c, false, false)).toBe(c)
    expect(noteRadioBuild(NO_RADIO_BUILDS, true, false)).toEqual({
      sinceBuild: null,
      sinceLarge: 0
    })
    // the riser is the default: today's two-argument calls
    expect(noteRadioBuild(c, true)).toEqual({ sinceBuild: 0, sinceLarge: 0 })
    expect(noteRadioBuild(c, false)).toEqual({ sinceBuild: 0, sinceLarge: 40 })
  })

  it('radioNoteTurnaround: a played turnaround, by its riser and whether it was rolled large', () => {
    const c = { sinceBuild: 4, sinceLarge: 40 }
    expect(radioNoteTurnaround(c, null, true)).toBe(c)
    expect(radioNoteTurnaround(c, { riserBars: 2 }, false)).toEqual({
      sinceBuild: 0,
      sinceLarge: 40
    })
    expect(radioNoteTurnaround(c, { riserBars: 2 }, true)).toEqual({ sinceBuild: 0, sinceLarge: 0 })
    expect(radioNoteTurnaround(c, {}, true)).toEqual({ sinceBuild: 4, sinceLarge: 0 })
    expect(radioNoteTurnaround(c, {}, false)).toBe(c)
  })
})

describe('radioBuildArc', () => {
  it('growing for a return or a big change, thinning only for a removal alone', () => {
    expect(radioBuildArc(F({ rows: 1, hookReturn: { awayBars: 16 } }), 'thinning')).toBe('growing')
    expect(radioBuildArc(F({ rows: 3 }), 'steady')).toBe('growing')
    expect(radioBuildArc(F({ arcStep: 'add', rows: 1 }), 'steady')).toBe('growing')
    expect(radioBuildArc(F({ arcStep: 'remove' }), 'growing')).toBe('thinning')
    expect(radioBuildArc(F({ arcStep: 'remove', rows: 1 }), 'growing')).toBe('growing')
    expect(radioBuildArc(F({ rows: 2 }), 'steady')).toBe('steady')
  })
})

describe('the payoff', () => {
  it('medium: two rows, a hook back, an arc step, the low end or a course change', () => {
    expect(radioPayoffMet(F({ rows: 1 }), 'medium')).toBe(false)
    expect(radioPayoffMet(F({ rows: 2 }), 'medium')).toBe(true)
    expect(radioPayoffMet(F({ rows: 1, hookReturn: { awayBars: 8 } }), 'medium')).toBe(true)
    expect(radioPayoffMet(F({ arcStep: 'remove' }), 'medium')).toBe(true)
    expect(radioPayoffMet(F({ rows: 1, lowEndReturn: true }), 'medium')).toBe(true)
    expect(radioPayoffMet(F(), 'none')).toBe(true)
  })

  it('large: three rows, a hook back with another row, the low end or a course change', () => {
    expect(radioPayoffMet(F({ rows: 2 }), 'large')).toBe(false)
    expect(radioPayoffMet(F({ rows: 3 }), 'large')).toBe(true)
    expect(radioPayoffMet(F({ rows: 1, hookReturn: { awayBars: 32 } }), 'large')).toBe(false)
    expect(radioPayoffMet(F({ rows: 2, hookReturn: { awayBars: 32 } }), 'large')).toBe(true)
    expect(radioPayoffMet(F({ arcStep: 'add', rows: 1 }), 'large')).toBe(false)
    expect(radioPayoffMet(F({ rows: 1, lowEndReturn: true }), 'large')).toBe(true)
    expect(radioPayoffOf(F({ rows: 2 }))).toBe('medium')
    expect(radioPayoffOf(F({ rows: 1 }))).toBe('none')
  })

  it('a gap needs a large payoff, any other turnaround a medium one', () => {
    expect(radioTurnaroundPayoffNeed({ gapBeats: 2 })).toBe('large')
    expect(radioTurnaroundPayoffNeed({ gapBeats: 0 })).toBe('medium')
    expect(radioTurnaroundPayoffNeed({})).toBe('medium')
  })

  it('the shortfall: rows still to add', () => {
    expect(radioPayoffShortfall(F(), 'medium')).toBe(2)
    expect(radioPayoffShortfall(F({ rows: 1 }), 'medium')).toBe(1)
    expect(radioPayoffShortfall(F({ rows: 1 }), 'large')).toBe(2)
    expect(radioPayoffShortfall(F({ rows: 1, hookReturn: { awayBars: 16 } }), 'large')).toBe(1)
    expect(radioPayoffShortfall(F({ arcStep: 'remove' }), 'medium')).toBe(0)
    for (const need of ['medium', 'large'] as const) {
      for (let rows = 0; rows <= 3; rows++) {
        const f = F({ rows })
        const n = radioPayoffShortfall(f, need)
        expect(radioPayoffMet({ ...f, rows: rows + n }, need)).toBe(true)
      }
    }
  })
})

describe('radioPhraseEndBuild', () => {
  it('skips with no payoff possible, and draws nothing for it', () => {
    expect(radioPhraseEndBuild(F(), 1, FREE)).toEqual({
      skip: true,
      size: 'medium',
      payoff: 'none'
    })
    expect(radioPhraseEndBuild(F({ rows: 1 }), 0, FREE).skip).toBe(true)
  })

  it('a fired phrase end is at least medium; what lands raises it; the spares set the payoff', () => {
    expect(radioPhraseEndBuild(F(), 2, FREE)).toEqual({
      skip: false,
      size: 'medium',
      payoff: 'medium'
    })
    expect(radioPhraseEndBuild(F({ rows: 1 }), 2, FREE)).toEqual({
      skip: false,
      size: 'medium',
      payoff: 'large'
    })
    expect(radioPhraseEndBuild(F({ rows: 1, lowEndReturn: true }), 0, FREE)).toEqual({
      skip: false,
      size: 'large',
      payoff: 'large'
    })
    // an arc removal alone: a large build (a thinning one), but only a medium payoff: no gap
    expect(radioPhraseEndBuild(F({ arcStep: 'remove' }), 0, FREE)).toEqual({
      skip: false,
      size: 'large',
      payoff: 'medium'
    })
  })

  it("a phrase end's large is spared the 8-bar spacing, not the once-a-phrase rule", () => {
    // a cheap riser 4 bars before: a per-change large falls to small, the phrase end's stays large
    const recent = { clock: { sinceBuild: 0, sinceLarge: null }, aheadBars: 4, phraseBars: 16 }
    expect(radioBuildSize(F({ rows: 3 }), recent)).toBe('small')
    expect(radioPhraseEndBuild(F({ rows: 3 }), 0, recent).size).toBe('large')
    expect(radioApplyBuildBudget('large', { ...recent, phraseEnd: true })).toBe('large')
    // a medium phrase end still keeps its spacing
    expect(radioPhraseEndBuild(F({ rows: 2 }), 0, recent).size).toBe('small')
    // a large a phrase ago or less: medium, and then the spacing applies to it
    const both = { clock: { sinceBuild: 0, sinceLarge: 8 }, aheadBars: 4, phraseBars: 16 }
    expect(radioPhraseEndBuild(F({ rows: 3 }), 0, both).size).toBe('small')
    const lateLarge = { clock: { sinceBuild: 20, sinceLarge: 8 }, aheadBars: 4, phraseBars: 16 }
    expect(radioPhraseEndBuild(F({ rows: 3 }), 0, lateLarge).size).toBe('medium')
  })

  it('the budget still applies', () => {
    const clock = { sinceBuild: 0, sinceLarge: 0 }
    expect(
      radioPhraseEndBuild(F({ rows: 3 }), 0, { clock, aheadBars: 4, phraseBars: 16 }).size
    ).toBe('small')
  })
})

describe('radioArcStepWaits', () => {
  it('off: never; on: until a phrase start, at most a phrase past ready', () => {
    const o = { sized: true, decidesForPhraseStart: false, overdueBars: 0, phraseBars: 16 }
    expect(radioArcStepWaits({ ...o, sized: false })).toBe(false)
    expect(radioArcStepWaits(o)).toBe(true)
    expect(radioArcStepWaits({ ...o, decidesForPhraseStart: true })).toBe(false)
    expect(radioArcStepWaits({ ...o, overdueBars: 12 })).toBe(true)
    expect(radioArcStepWaits({ ...o, overdueBars: 16 })).toBe(false)
  })
})
