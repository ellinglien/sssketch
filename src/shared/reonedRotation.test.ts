import { describe, expect, it } from 'vitest'
import type { Stem } from './types'
import {
  bakeToPhaseJob,
  matchBakeResults,
  nextPhaseBars,
  phaseLineage,
  rebuildRotationCandidates,
  reoneJob,
  rotationSecForBars,
  sharedPhaseBars
} from './reonedRotation'

const stem = (over: Partial<Stem> = {}): Stem => ({
  slot: 1,
  author: 'a',
  name: 'drums',
  type: 'drums',
  path: '/src/one.wav',
  durationSec: 8,
  barLength: 4,
  ...over
})

describe('rotationSecForBars', () => {
  it('wraps unwrapped bars into the stem loop and scales by its seconds per bar', () => {
    expect(rotationSecForBars(1, stem())).toBe(2)
    expect(rotationSecForBars(5.5, stem())).toBe(3) // 5.5 ≡ 1.5 bars
    expect(rotationSecForBars(-0.5, stem())).toBe(7) // -0.5 ≡ 3.5 bars
    expect(rotationSecForBars(0, stem())).toBe(0)
  })
})

describe('nextPhaseBars', () => {
  it('accumulates unwrapped, the way BeatPicker always has: phaseBars - steps / snapDiv', () => {
    expect(nextPhaseBars(stem(), -4, 4)).toBe(1)
    const copy = { path: '/lib/.bakes/x.baked.wav', phaseSourcePath: '/src/one.wav' }
    expect(nextPhaseBars(stem({ ...copy, phaseBars: 1 }), -2, 4)).toBe(1.5)
    expect(nextPhaseBars(stem({ ...copy, phaseBars: 3 }), -10, 4)).toBe(5.5)
  })
})

describe('reoneJob', () => {
  it('a stem never re-oned: the job rotates its own file, no separate recipe', () => {
    expect(reoneJob(stem(), -4, 4)).toEqual({ path: '/src/one.wav', rotationSec: 2 })
  })

  it('a stem already re-oned: keeps the chain job, and adds the recipe from the original at the total', () => {
    const s = stem({
      path: '/lib/.bakes/x.baked.wav',
      phaseSourcePath: '/src/one.wav',
      phaseBars: 1
    })
    expect(reoneJob(s, -2, 4)).toEqual({
      path: '/lib/.bakes/x.baked.wav',
      rotationSec: 1, // 0.5 bar of the current file: today's chain, the fallback
      recipe: { sourcePath: '/src/one.wav', rotationSec: 3 } // 1.5 bars of the original
    })
  })

  it('a stale lineage on a file that is not a re-oned copy (a stretched one-shot) is ignored: the job bakes that file and the lineage restarts there', () => {
    const s = stem({
      path: '/stretch-cache/kick-stretched.wav',
      phaseSourcePath: '/src/kick.wav',
      phaseBars: 1
    })
    expect(reoneJob(s, -4, 4)).toEqual({
      path: '/stretch-cache/kick-stretched.wav',
      rotationSec: 2
    })
    expect(phaseLineage(s)).toEqual({ sourcePath: '/stretch-cache/kick-stretched.wav', bars: 0 })
    expect(nextPhaseBars(s, -4, 4)).toBe(1)
  })

  it('a lineage that names the stem itself is not a separate recipe', () => {
    const s = stem({ phaseSourcePath: '/src/one.wav', phaseBars: 0 })
    expect(reoneJob(s, -4, 4)).toEqual({ path: '/src/one.wav', rotationSec: 2 })
  })
})

describe('rebuildRotationCandidates', () => {
  it('first from durationSec, then from the riff bpm the way a LORE import computed durationSec', () => {
    // A LORE stem first re-oned with metadata durationSec 8 (4 bars at 120), then
    // APPLY_BAKE stored the measured 8.01.
    const s = stem({ durationSec: 8.01, phaseSourcePath: '/lore/CID', phaseBars: 1 })
    const [measured, metadata] = rebuildRotationCandidates(s, 120)
    expect(measured).toBeCloseTo(2.0025, 10)
    expect(metadata).toBe(2)
  })

  it('drops a duplicate or unusable candidate', () => {
    const s = stem({ phaseSourcePath: '/src/one.wav', phaseBars: 1 })
    expect(rebuildRotationCandidates(s, 120)).toEqual([2])
    expect(rebuildRotationCandidates(s, 0)).toEqual([2])
  })
})

describe('sharedPhaseBars', () => {
  const copy = (phaseBars: number, name = 'x'): Stem =>
    stem({ path: `/lib/.bakes/${name}.baked.wav`, phaseSourcePath: `/src/${name}.wav`, phaseBars })

  it('is null for a riff never re-oned', () => {
    expect(sharedPhaseBars([stem(), stem({ path: '/src/two.wav' })])).toBeNull()
    expect(sharedPhaseBars([])).toBeNull()
  })

  it('is the rotation the riff was re-oned by', () => {
    expect(sharedPhaseBars([copy(1.5, 'a'), copy(1.5, 'b')])).toBe(1.5)
  })

  it('takes the rotation most stems carry, and the earlier stem on a tie', () => {
    expect(sharedPhaseBars([copy(1, 'a'), copy(0.5, 'b'), copy(0.5, 'c')])).toBe(0.5)
    expect(sharedPhaseBars([copy(1, 'a'), copy(0.5, 'b')])).toBe(1)
  })

  it('reads the lineage the way a re-one does: a stale lineage on a non-copy counts as unrotated', () => {
    const stale = stem({ path: '/stretch/one.wav', phaseSourcePath: '/src/one.wav', phaseBars: 1 })
    expect(sharedPhaseBars([stale])).toBeNull()
  })

  it('is null when most stems are back at their original phase', () => {
    expect(sharedPhaseBars([copy(0, 'a'), copy(0, 'b'), copy(1, 'c')])).toBeNull()
  })
})

describe('bakeToPhaseJob', () => {
  it('a raw stem: rotates its own file by the total, named by its recipe in main', () => {
    expect(bakeToPhaseJob(stem(), 1.5)).toEqual({ path: '/src/one.wav', rotationSec: 3 })
  })

  it('a re-oned stem: the step from where it is, plus the recipe from the original at the total', () => {
    const s = stem({
      path: '/lib/.bakes/x.baked.wav',
      phaseSourcePath: '/src/one.wav',
      phaseBars: 1
    })
    expect(bakeToPhaseJob(s, 1.5)).toEqual({
      path: '/lib/.bakes/x.baked.wav',
      rotationSec: 1,
      recipe: { sourcePath: '/src/one.wav', rotationSec: 3 }
    })
  })
})

describe('matchBakeResults', () => {
  const result = (path: string, bakedPath: string): { path: string; bakedPath: string } => ({
    path,
    bakedPath
  })

  it('matches each path to its own result, whatever order they came back in', () => {
    expect(
      matchBakeResults(['/a', '/b'], [result('/b', '/b.baked'), result('/a', '/a.baked')])
    ).toEqual([result('/a', '/a.baked'), result('/b', '/b.baked')])
  })

  it('hands a shared path its results in the order the jobs were sent', () => {
    expect(
      matchBakeResults(['/a', '/a'], [result('/a', '/one.baked'), result('/a', '/two.baked')])
    ).toEqual([result('/a', '/one.baked'), result('/a', '/two.baked')])
  })

  it('is null when any path has no result, or results are left over', () => {
    expect(matchBakeResults(['/a', '/b'], [result('/a', '/a.baked')])).toBeNull()
    expect(
      matchBakeResults(['/a'], [result('/a', '/a.baked'), result('/c', '/c.baked')])
    ).toBeNull()
  })
})
