import { describe, expect, it, vi } from 'vitest'
import type { Rifff } from '@shared/types'
import { rifffForSketchCross } from './crossFromSketch'

function riff(): Rifff {
  return {
    groupId: 'parent-a',
    name: 'parent',
    bpm: 120,
    barLength: 4,
    folderPath: '',
    stems: [
      {
        slot: 1,
        author: 'a',
        name: 'drums',
        type: 'drums',
        path: '/one.wav',
        durationSec: 8,
        barLength: 4
      },
      {
        slot: 2,
        author: 'b',
        name: 'bass',
        type: 'bass',
        path: '/two.wav',
        durationSec: 8,
        barLength: 4,
        phaseSourcePath: '/original-two.wav',
        phaseBars: 0.25
      }
    ]
  }
}

describe('rifffForSketchCross', () => {
  it('returns the original riff without rendering when it has no live phase', async () => {
    const bakeOffset = vi.fn()
    const source = riff()
    await expect(rifffForSketchCross(source, {}, 4, bakeOffset)).resolves.toBe(source)
    expect(bakeOffset).not.toHaveBeenCalled()
  })

  it('materializes per-stem phase without mutating the parent riff', async () => {
    const source = riff()
    const prepared = await rifffForSketchCross(
      source,
      { 'parent-a': 1, 'parent-a:2': -2 },
      4,
      async (jobs) =>
        jobs.map((job, index) => ({
          path: job.path,
          bakedPath: `/baked-${index + 1}.wav`,
          durationSec: 8
        }))
    )

    expect(source.stems.map((stem) => stem.path)).toEqual(['/one.wav', '/two.wav'])
    expect(prepared?.stems).toMatchObject([
      { path: '/baked-1.wav', phaseSourcePath: '/one.wav', phaseBars: -0.25 },
      { path: '/baked-2.wav', phaseSourcePath: '/original-two.wav', phaseBars: 0.75 }
    ])
  })

  it('matches bake results to stems by path, whatever order the bake returns them in', async () => {
    // bakeOffset renders WAV stems first and LORE (non-WAV) stems after, so a riff that mixes
    // them comes back in a different order than it went in.
    const source = riff()
    source.stems[0] = { ...source.stems[0], path: '/lore/one.opus' }
    const prepared = await rifffForSketchCross(
      source,
      { 'parent-a': 1, 'parent-a:2': -2 },
      4,
      async (jobs) =>
        [...jobs]
          .sort((a, b) => Number(!a.path.endsWith('.wav')) - Number(!b.path.endsWith('.wav')))
          .map((job) => ({
            path: job.path,
            bakedPath: `/baked${job.path}`,
            durationSec: job.path.endsWith('.wav') ? 8 : 7
          }))
    )

    expect(prepared?.stems).toMatchObject([
      {
        path: '/baked/lore/one.opus',
        durationSec: 7,
        phaseSourcePath: '/lore/one.opus',
        phaseBars: -0.25
      },
      { path: '/baked/two.wav', durationSec: 8, phaseSourcePath: '/original-two.wav' }
    ])
  })

  it('sends each stem a recipe from its original at the total phase, so a repeat audition reuses the copy', async () => {
    const bakeOffset = vi.fn(async (jobs: { path: string }[]) =>
      jobs.map((job, i) => ({ path: job.path, bakedPath: `/baked-${i}.wav`, durationSec: 8 }))
    )
    await rifffForSketchCross(riff(), { 'parent-a': -2 }, 4, bakeOffset)
    expect(bakeOffset.mock.calls[0][0]).toEqual([
      { path: '/one.wav', rotationSec: 1 },
      {
        path: '/two.wav',
        rotationSec: 1,
        recipe: { sourcePath: '/original-two.wav', rotationSec: 1.5 } // 0.25 + 0.5 bars, 2 s per bar
      }
    ])
  })

  it('rejects a bake whose results name a stem it was not asked for', async () => {
    await expect(
      rifffForSketchCross(riff(), { 'parent-a': 1 }, 4, async (jobs) =>
        jobs.map((job) => ({ path: `${job.path}.other`, bakedPath: '/x.wav', durationSec: 8 }))
      )
    ).resolves.toBeNull()
  })

  it('rejects an incomplete bake instead of constructing a partly phased parent', async () => {
    await expect(
      rifffForSketchCross(riff(), { 'parent-a': 1 }, 4, async () => [])
    ).resolves.toBeNull()
  })
})
