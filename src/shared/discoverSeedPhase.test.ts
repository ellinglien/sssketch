import { describe, expect, it } from 'vitest'
import { activeSeedPhase, candidatePhaseBars, discoverSeedPhase } from './discoverSeedPhase'

// A seed's stems, as App seeds Discover from a project riff: re-oned copies with their lineage.
const copy = (
  stemCID: string,
  phaseBars: number,
  jam = 'lib'
): {
  path: string
  phaseSourcePath: string
  phaseBars: number
  barLength: number
} => ({
  path: `/lib/.bakes/${stemCID}-${phaseBars}.baked.wav`,
  phaseSourcePath: `/${jam}/stems/x/${stemCID}`,
  phaseBars,
  barLength: 4
})

describe('discoverSeedPhase', () => {
  it("is the seed's rotation, per jam its stems come from, and per stem", () => {
    const phase = discoverSeedPhase([copy('s1', 1.5), copy('s2', 1.5)], {
      '/lib/stems/x/s1': 'jamA',
      '/lib/stems/x/s2': 'jamA'
    })
    expect(phase).toEqual({ byJam: { jamA: 1.5 }, byStem: { s1: 1.5, s2: 1.5 }, jamNames: {} })
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
    const raw = [
      { path: '/lib/stems/x/s1', barLength: 4 },
      { path: '/lib/stems/x/s2', barLength: 4 }
    ]
    expect(
      discoverSeedPhase(raw, { '/lib/stems/x/s1': 'jamA', '/lib/stems/x/s2': 'jamA' })
    ).toBeNull()
  })

  it('still knows the seed stems themselves when no library knows their jam', () => {
    expect(discoverSeedPhase([copy('s1', 1.5)], {})).toEqual({
      byJam: {},
      byStem: { s1: 1.5 },
      jamNames: {}
    })
  })

  // The discovered room holds kept groups: stems of many jams, some already baked to another
  // seed's rotation (a kept aligned candidate is a new StemCID with rotated audio). The Shared
  // Feed's jams hold riffs posted from many jams. Neither shares a clock, so rotating their
  // other stems by this seed's rotation would only rotate them a second time, or at random.
  it('never keeps a rotation for the discovered room or a Shared Feed jam', () => {
    const phase = discoverSeedPhase([copy('s1', 1.5), copy('s2', 1.5), copy('s3', 0.5)], {
      '/lib/stems/x/s1': 'discovered',
      '/lib/stems/x/s2': 'shared:wren',
      '/lib/stems/x/s3': 'jamA'
    })
    expect(phase?.byJam).toEqual({ jamA: 0.5 })
    expect(candidatePhaseBars(phase, { stemCID: 'other', jamCID: 'discovered' })).toBeNull()
    expect(candidatePhaseBars(phase, { stemCID: 'other', jamCID: 'shared:wren' })).toBeNull()
    // The seed's own stems still carry their own rotation, wherever they sit.
    expect(candidatePhaseBars(phase, { stemCID: 's1', jamCID: 'discovered' })).toBe(1.5)
  })

  // A riff re-oned by 1 bar, with 1-bar stems that came in as they are (Discover candidates or
  // late stems the rotation wraps to nothing for): the jam still carries the 1-bar rotation, so a
  // 4-bar candidate from it is baked and a 1-bar one needs no copy.
  it('a 1-bar re-one with raw 1-bar stems keeps its rotation for 4-bar candidates', () => {
    const oneBar = (stemCID: string): { path: string; barLength: number } => ({
      path: `/lib/stems/x/${stemCID}`,
      barLength: 1
    })
    const phase = discoverSeedPhase([copy('s1', 1), oneBar('h1'), oneBar('h2'), oneBar('h3')], {
      '/lib/stems/x/s1': 'jamA',
      '/lib/stems/x/h1': 'jamA',
      '/lib/stems/x/h2': 'jamA',
      '/lib/stems/x/h3': 'jamA'
    })
    expect(phase?.byJam).toEqual({ jamA: 1 })
    expect(candidatePhaseBars(phase, { stemCID: 'four', jamCID: 'jamA' })).toBe(1)
  })

  it("names the seed's jams, for a notice about a stem that couldn't be lined up", () => {
    const phase = discoverSeedPhase(
      [copy('s1', 1.5)],
      { '/lib/stems/x/s1': 'jamA' },
      { jamA: 'night bus', jamZ: 'unrelated' }
    )
    expect(phase?.jamNames).toEqual({ jamA: 'night bus' })
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

describe('activeSeedPhase', () => {
  const phase = discoverSeedPhase([copy('s1', 1.5)], { '/lib/stems/x/s1': 'jamA' })
  const seedRow = { seedStem: { path: '/lib/.bakes/s1.baked.wav' } }
  const rolledRow = { candidate: { stemCID: 'c1' } }

  it('holds while a seed row is there', () => {
    expect(activeSeedPhase(phase, [rolledRow, seedRow])).toBe(phase)
  })

  it('lapses once the seed rows are gone (removed or rerolled), and returns with them on undo', () => {
    expect(activeSeedPhase(phase, [rolledRow])).toBeNull()
    expect(activeSeedPhase(phase, [])).toBeNull()
    expect(activeSeedPhase(phase, [seedRow])).toBe(phase)
  })

  it('is null without a phase', () => {
    expect(activeSeedPhase(null, [seedRow])).toBeNull()
  })
})
