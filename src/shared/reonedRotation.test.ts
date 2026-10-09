import { afterEach, describe, expect, it, vi } from 'vitest'
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

  describe('rotations compared within each stem loop', () => {
    afterEach(() => vi.restoreAllMocks())
    const raw = (name: string, barLength: number): Stem =>
      stem({ path: `/src/${name}`, barLength, durationSec: barLength * 2 })

    // A riff re-oned by 1 bar. Its 1-bar stems that joined later (late downloads, or Discover
    // candidates aligned to it) wrap to no rotation at all, so they join as they are, with no
    // copy and no lineage: they agree with the riff's rotation, and must not outvote it.
    it('a 1-bar re-one: raw 1-bar stems agree with it, 4-bar stems carry it', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const fourBar = (name: string): Stem =>
        stem({
          path: `/lib/.bakes/${name}.baked.wav`,
          phaseSourcePath: `/src/${name}`,
          phaseBars: 1,
          barLength: 4,
          durationSec: 8
        })
      const riff = [fourBar('d'), raw('h1', 1), raw('h2', 1), raw('h3', 1)]
      expect(sharedPhaseBars(riff)).toBe(1)
      // ...so a 4-bar stem joining next is baked by 1 bar, and a 1-bar one needs no copy.
      expect(rotationSecForBars(1, raw('late4', 4))).toBe(2)
      expect(rotationSecForBars(1, raw('late1', 1))).toBe(0)
      expect(sharedPhaseBars([...riff, fourBar('late4')])).toBe(1)
      expect(warn).not.toHaveBeenCalled()
    })

    it('1 bar and 5 bars on a 4-bar loop are one phase', () => {
      expect(sharedPhaseBars([copy(5, 'a'), copy(1, 'b'), copy(0.5, 'c')])).toBe(5)
    })

    it('breaks a tie towards a rotation a copy carries, whatever the stem order', () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      const unrotated = raw('u', 4)
      expect(sharedPhaseBars([unrotated, copy(1, 'a')])).toBe(1)
      expect(sharedPhaseBars([copy(1, 'a'), unrotated])).toBe(1)
      // Two rotations each a copy carries: the earlier stem's.
      expect(sharedPhaseBars([copy(0.5, 'a'), copy(1, 'b')])).toBe(0.5)
    })

    it('says so in one console line when the stems disagree', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      sharedPhaseBars([copy(1, 'a'), copy(1, 'b'), copy(0.5, 'c'), copy(0.25, 'd')])
      expect(warn).toHaveBeenCalledTimes(1)
      sharedPhaseBars([copy(1, 'a'), copy(5, 'b')])
      expect(warn).toHaveBeenCalledTimes(1)
    })
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
