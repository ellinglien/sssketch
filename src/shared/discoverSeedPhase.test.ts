import { describe, expect, it } from 'vitest'
import { candidatePhaseBars, discoverSeedPhase } from './discoverSeedPhase'

// A seed's stems, as App seeds Discover from a project riff: re-oned copies with their lineage.
const copy = (
  stemCID: string,
  phaseBars: number,
  jam = 'lib'
): {
  path: string
  phaseSourcePath: string
  phaseBars: number
} => ({
  path: `/lib/.bakes/${stemCID}-${phaseBars}.baked.wav`,
  phaseSourcePath: `/${jam}/stems/x/${stemCID}`,
  phaseBars
})

describe('discoverSeedPhase', () => {
  it("is the seed's rotation, per jam its stems come from, and per stem", () => {
    const phase = discoverSeedPhase([copy('s1', 1.5), copy('s2', 1.5)], {
      '/lib/stems/x/s1': 'jamA',
      '/lib/stems/x/s2': 'jamA'
    })
    expect(phase).toEqual({ byJam: { jamA: 1.5 }, byStem: { s1: 1.5, s2: 1.5 } })
  })

  it('keeps each jam to its own stems, for a seed collaged from several jams', () => {
    const phase = discoverSeedPhase([copy('s1', 1.5), copy('s2', 0.25), copy('s3', 0.25)], {
      '/lib/stems/x/s1': 'jamA',
      '/lib/stems/x/s2': 'jamB',
      '/lib/stems/x/s3': 'jamB'
    })
    expect(phase?.byJam).toEqual({ jamA: 1.5, jamB: 0.25 })
  })

  it('is null for a seed never re-oned: its jam-mates are already at its phase', () => {
    const raw = [{ path: '/lib/stems/x/s1' }, { path: '/lib/stems/x/s2' }]
    expect(
      discoverSeedPhase(raw, { '/lib/stems/x/s1': 'jamA', '/lib/stems/x/s2': 'jamA' })
    ).toBeNull()
  })

  it('still knows the seed stems themselves when no library knows their jam', () => {
    expect(discoverSeedPhase([copy('s1', 1.5)], {})).toEqual({ byJam: {}, byStem: { s1: 1.5 } })
  })
})

describe('candidatePhaseBars', () => {
  const phase = discoverSeedPhase([copy('s1', 1.5), copy('s2', 1.5), copy('s3', 0)], {
    '/lib/stems/x/s1': 'jamA',
    '/lib/stems/x/s2': 'jamA',
    '/lib/stems/x/s3': 'jamA'
  })

  it("rotates a candidate from the seed's jam by the seed's rotation", () => {
    expect(candidatePhaseBars(phase, { stemCID: 'other', jamCID: 'jamA' })).toBe(1.5)
  })

  it('leaves a candidate from any other jam at its own phase', () => {
    expect(candidatePhaseBars(phase, { stemCID: 'other', jamCID: 'jamB' })).toBeNull()
  })

  it("a candidate that is one of the seed's own stems takes that stem's rotation", () => {
    expect(candidatePhaseBars(phase, { stemCID: 's1', jamCID: 'jamZ' })).toBe(1.5)
    // s3 sat at its original phase in the seed, so it comes in unrotated.
    expect(candidatePhaseBars(phase, { stemCID: 's3', jamCID: 'jamA' })).toBeNull()
  })

  it('is null without a seed phase', () => {
    expect(candidatePhaseBars(null, { stemCID: 's1', jamCID: 'jamA' })).toBeNull()
  })
})
