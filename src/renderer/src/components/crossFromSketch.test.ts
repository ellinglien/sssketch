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

  it('rejects an incomplete bake instead of constructing a partly phased parent', async () => {
    await expect(
      rifffForSketchCross(riff(), { 'parent-a': 1 }, 4, async () => [])
    ).resolves.toBeNull()
  })
})
