import { describe, expect, it } from 'vitest'
import {
  buildImportedRifff,
  importedStemVolumes,
  mergeJoiningStems,
  rotateJoiningStems
} from './importResolvedRiff'
import type { ReoneBakeJob } from '@shared/reonedRotation'
import type { Rifff, Stem } from '@shared/types'
import { friendlyRiffName } from '@shared/friendlyRiffName'
import type { RiffLibraryResolvedRiff } from '@shared/riffLibraryTypes'

function resolved(extra: Partial<RiffLibraryResolvedRiff> = {}): RiffLibraryResolvedRiff {
  return {
    riffCID: 'kept_1',
    bpm: 120,
    barLength: 4,
    stems: [
      {
        stemCID: 'a',
        slot: 1,
        path: '/x/a',
        gain: 1,
        creatorUserName: 'elling',
        presetName: 'thud',
        instrumentMask: 0,
        durationSec: 8,
        barLength: 4,
        downloadUrl: null
      }
    ],
    ...extra
  }
}

describe('buildImportedRifff', () => {
  it('names a radio-hearts riff by its ♥ label', () => {
    const result = buildImportedRifff(
      'kept_1',
      resolved({ name: '♥ 3 · misty kestrel' }),
      undefined,
      'library',
      'riff library'
    )
    expect(result?.rifff.name).toBe('♥ 3 · misty kestrel')
  })

  it('names every other riff from its id', () => {
    const result = buildImportedRifff('kept_1', resolved(), undefined, 'library', 'riff library')
    expect(result?.rifff.name).toBe(friendlyRiffName('kept_1', 'library'))
  })
})

describe('importedStemVolumes', () => {
  it('matches library preview by multiplying each source gain by shared headroom', () => {
    const riff = resolved({
      stems: [
        { ...resolved().stems[0], slot: 1, stemCID: 'a', gain: 1 },
        { ...resolved().stems[0], slot: 3, stemCID: 'b', gain: 0.81 },
        { ...resolved().stems[0], slot: 6, stemCID: 'c', gain: 0.5 }
      ]
    })

    const volumes = importedStemVolumes('g', riff, [1, 3, 6])
    expect(volumes['g:1']).toBeCloseTo(1 / Math.sqrt(3), 12)
    expect(volumes['g:3']).toBeCloseTo(0.81 / Math.sqrt(3), 12)
    expect(volumes['g:6']).toBeCloseTo(0.5 / Math.sqrt(3), 12)
  })

  it('sets only newly merged rows and counts only locally cached stems', () => {
    const riff = resolved({
      stems: [
        { ...resolved().stems[0], slot: 1, stemCID: 'old', gain: 0.9 },
        { ...resolved().stems[0], slot: 2, stemCID: 'new', gain: 0.8 },
        { ...resolved().stems[0], slot: 3, stemCID: 'missing', path: null, gain: 0.7 }
      ]
    })

    expect(importedStemVolumes('g', riff, [2])).toEqual({
      'g:2': 0.8 / Math.sqrt(2)
    })
  })
})

describe('rotateJoiningStems', () => {
  const stem = (over: Partial<Stem>): Stem => ({
    slot: 1,
    author: 'a',
    name: 'harp',
    type: 'notes',
    path: '/lib/stems/h',
    durationSec: 8,
    barLength: 4,
    ...over
  })
  const rifff = (stems: Stem[]): Rifff => ({
    groupId: 'g',
    phaseLinkId: 'g',
    name: 'riff',
    bpm: 120,
    barLength: 4,
    folderPath: 'riff library',
    stems
  })
  // A riff re-oned by 1.5 bars: both its stems are copies of their originals at that rotation.
  const reoned = rifff([
    stem({
      slot: 1,
      path: '/lib/.bakes/a.baked.wav',
      phaseSourcePath: '/lib/stems/a',
      phaseBars: 1.5
    }),
    stem({
      slot: 2,
      path: '/lib/.bakes/b.baked.wav',
      phaseSourcePath: '/lib/stems/b',
      phaseBars: 1.5
    })
  ])
  const harp = stem({ slot: 3, path: '/lib/stems/h' })
  const bell = stem({ slot: 4, path: '/lib/stems/e', durationSec: 4, barLength: 2 })

  it('leaves late stems as they are when the riff was never re-oned', async () => {
    const bake = async (): Promise<never> => {
      throw new Error('should not bake')
    }
    const plain = rifff([stem({ slot: 1, path: '/lib/stems/a' })])
    expect(await rotateJoiningStems(plain, [harp], bake)).toEqual([harp])
  })

  it("bakes late stems to the riff's rotation from their originals, as one batch", async () => {
    const sent: ReoneBakeJob[][] = []
    const bake = async (
      jobs: ReoneBakeJob[]
    ): Promise<{ path: string; bakedPath: string; durationSec: number }[]> => {
      sent.push(jobs)
      // Out of job order, as the baker returns WAVs before LORE stems.
      return [...jobs].reverse().map((job) => ({
        path: job.path,
        bakedPath: `/lib/.bakes/${job.path.slice(-1)}-r.baked.wav`,
        durationSec: 8.001
      }))
    }
    const joined = await rotateJoiningStems(reoned, [harp, bell], bake)
    expect(sent).toEqual([
      [
        { path: '/lib/stems/h', rotationSec: 3 }, // 1.5 bars of a 4-bar, 8 s loop
        { path: '/lib/stems/e', rotationSec: 3 } // 1.5 bars of a 2-bar, 4 s loop
      ]
    ])
    expect(joined).toEqual([
      {
        ...harp,
        path: '/lib/.bakes/h-r.baked.wav',
        durationSec: 8.001,
        phaseSourcePath: '/lib/stems/h',
        phaseBars: 1.5
      },
      {
        ...bell,
        path: '/lib/.bakes/e-r.baked.wav',
        durationSec: 8.001,
        phaseSourcePath: '/lib/stems/e',
        phaseBars: 1.5
      }
    ])
  })

  it('a late stem the rotation wraps to nothing (whole loops) needs no copy', async () => {
    const wholeLoops = rifff([
      stem({
        slot: 1,
        path: '/lib/.bakes/a.baked.wav',
        phaseSourcePath: '/lib/stems/a',
        phaseBars: 2
      })
    ])
    const bake = async (): Promise<never> => {
      throw new Error('should not bake')
    }
    // 2 bars of a 2-bar loop is no rotation at all.
    expect(await rotateJoiningStems(wholeLoops, [bell], bake)).toEqual([bell])
  })

  // A riff re-oned by 1 bar takes 1-bar and 4-bar late stems: the 1-bar ones wrap to no
  // rotation and join as they are, the 4-bar one is baked by 1 bar. The riff still reads as
  // re-oned by 1 bar afterwards, however many raw 1-bar stems it now has, so the next late
  // 4-bar stem is baked too.
  it('a 1-bar re-one: 1-bar late stems join as they are, 4-bar ones are baked', async () => {
    const oneBarReone = rifff([
      stem({
        slot: 1,
        path: '/lib/.bakes/a.baked.wav',
        phaseSourcePath: '/lib/stems/a',
        phaseBars: 1
      })
    ])
    const oneBar = stem({ slot: 2, path: '/lib/stems/o', durationSec: 2, barLength: 1 })
    const fourBar = stem({ slot: 3, path: '/lib/stems/f' })
    const sent: ReoneBakeJob[][] = []
    const bake = async (
      jobs: ReoneBakeJob[]
    ): Promise<{ path: string; bakedPath: string; durationSec: number }[]> => {
      sent.push(jobs)
      return jobs.map((job) => ({
        path: job.path,
        bakedPath: `/lib/.bakes/${job.path.slice(-1)}-1.baked.wav`,
        durationSec: 8
      }))
    }
    const joined = (await rotateJoiningStems(oneBarReone, [oneBar, fourBar], bake))!
    expect(sent).toEqual([[{ path: '/lib/stems/f', rotationSec: 2 }]])
    expect(joined[0]).toEqual(oneBar)
    expect(joined[1]).toMatchObject({ path: '/lib/.bakes/f-1.baked.wav', phaseBars: 1 })

    const moreOneBars = [5, 6].map((slot) =>
      stem({ slot, path: `/lib/stems/o${slot}`, durationSec: 2, barLength: 1 })
    )
    expect(await rotateJoiningStems(oneBarReone, moreOneBars, bake)).toEqual(moreOneBars)
    // One 4-bar copy at 1 bar against three raw 1-bar stems, and a baked 4-bar one.
    const merged = rifff([oneBarReone.stems[0], oneBar, ...moreOneBars])
    const later = stem({ slot: 4, path: '/lib/stems/l' })
    expect(await rotateJoiningStems(merged, [later], bake)).toEqual([
      {
        ...later,
        path: '/lib/.bakes/l-1.baked.wav',
        durationSec: 8,
        phaseSourcePath: '/lib/stems/l',
        phaseBars: 1
      }
    ])
  })

  it('is all or nothing: a short batch or a failed bake joins none of them', async () => {
    const short = async (
      jobs: ReoneBakeJob[]
    ): Promise<{ path: string; bakedPath: string; durationSec: number }[]> => [
      { path: jobs[0].path, bakedPath: '/lib/.bakes/one.baked.wav', durationSec: 8 }
    ]
    expect(await rotateJoiningStems(reoned, [harp, bell], short)).toBeNull()
    const failing = async (): Promise<never> => {
      throw new Error('ipc down')
    }
    expect(await rotateJoiningStems(reoned, [harp], failing)).toBeNull()
  })
})

describe('mergeJoiningStems', () => {
  const stem = (over: Partial<Stem>): Stem => ({
    slot: 1,
    author: 'a',
    name: 'harp',
    type: 'notes',
    path: '/lib/stems/h',
    durationSec: 8,
    barLength: 4,
    ...over
  })
  const copyAt = (slot: number, bars: number): Stem =>
    stem({
      slot,
      path: `/lib/.bakes/${slot}-${bars}.baked.wav`,
      phaseSourcePath: `/lib/stems/${slot}`,
      phaseBars: bars
    })
  const rifff = (stems: Stem[], name = 'riff'): Rifff => ({
    groupId: 'g',
    phaseLinkId: 'g',
    name,
    bpm: 120,
    barLength: 4,
    folderPath: 'riff library',
    stems
  })
  const harp = stem({ slot: 3, path: '/lib/stems/h' })
  type Baked = { path: string; bakedPath: string; durationSec: number }
  const bakeTo =
    (onBake?: (jobs: ReoneBakeJob[]) => void) =>
    async (jobs: ReoneBakeJob[]): Promise<Baked[]> => {
      onBake?.(jobs)
      return jobs.map((job) => ({
        path: job.path,
        bakedPath: `/lib/.bakes/h@${job.rotationSec}.baked.wav`,
        durationSec: 8
      }))
    }

  it('merges onto the riff as it is after the bake, keeping what changed meanwhile', async () => {
    let state: Rifff | undefined = rifff([copyAt(1, 1)])
    const merged = await mergeJoiningStems(
      () => state,
      [harp],
      bakeTo(() => {
        state = rifff([copyAt(1, 1)], 'renamed meanwhile')
      })
    )
    expect(merged.kind).toBe('merged')
    if (merged.kind !== 'merged') return
    expect(merged.rifff.name).toBe('renamed meanwhile')
    expect(merged.rifff.stems.map((s) => s.path)).toEqual([
      '/lib/.bakes/1-1.baked.wav',
      '/lib/.bakes/h@2.baked.wav'
    ])
    expect(merged.rotated[0]).toMatchObject({ slot: 3, phaseBars: 1 })
  })

  it("doesn't bring back a riff deleted while its stems baked", async () => {
    let state: Rifff | undefined = rifff([copyAt(1, 1)])
    const merged = await mergeJoiningStems(
      () => state,
      [harp],
      bakeTo(() => {
        state = undefined
      })
    )
    expect(merged).toEqual({ kind: 'gone' })
  })

  it('a riff re-oned while its stems baked: bakes them again, to its new rotation', async () => {
    let state: Rifff | undefined = rifff([copyAt(1, 1)])
    const rotations: number[] = []
    const merged = await mergeJoiningStems(
      () => state,
      [harp],
      bakeTo((jobs) => {
        rotations.push(jobs[0].rotationSec)
        if (rotations.length === 1) state = rifff([copyAt(1, 0.5)])
      })
    )
    expect(rotations).toEqual([2, 1])
    expect(merged.kind).toBe('merged')
    if (merged.kind !== 'merged') return
    expect(merged.rifff.stems[1]).toMatchObject({ phaseBars: 0.5 })
  })

  it('gives up, naming the riff, when its rotation keeps moving or the bake fails', async () => {
    let state: Rifff | undefined = rifff([copyAt(1, 1)])
    let bars = 1
    const moving = await mergeJoiningStems(
      () => state,
      [harp],
      bakeTo(() => {
        bars += 0.25
        state = rifff([copyAt(1, bars)])
      })
    )
    expect(moving).toMatchObject({ kind: 'failed', rifff: { stems: [{ phaseBars: 1.5 }] } })
    const failing = await mergeJoiningStems(
      () => rifff([copyAt(1, 1)]),
      [harp],
      async () => []
    )
    expect(failing.kind).toBe('failed')
  })
})
