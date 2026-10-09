import { describe, expect, it } from 'vitest'
import { alignCandidateStem, type ResolvedCandidateStem } from './discoverCandidateStem'
import type { ReoneBakeJob } from '@shared/reonedRotation'

const raw: ResolvedCandidateStem = {
  author: 'wren',
  name: 'harp',
  type: 'notes',
  path: '/lib/stems/x/s9',
  durationSec: 8,
  barLength: 4
}

describe('alignCandidateStem', () => {
  it("bakes the candidate to the seed's rotation from its original, without touching anything else", async () => {
    const sent: ReoneBakeJob[][] = []
    const aligned = await alignCandidateStem(raw, 1.5, async (jobs) => {
      sent.push(jobs)
      return [{ path: jobs[0].path, bakedPath: '/lib/.bakes/r.baked.wav', durationSec: 8.002 }]
    })
    // Recipe-named in main from the original and the total: the same stem at the same phase is
    // one file, whoever bakes it.
    expect(sent).toEqual([[{ path: '/lib/stems/x/s9', rotationSec: 3 }]])
    expect(aligned).toEqual({
      ...raw,
      path: '/lib/.bakes/r.baked.wav',
      durationSec: 8.002,
      phaseSourcePath: '/lib/stems/x/s9',
      phaseBars: 1.5
    })
  })

  it('needs no copy when the rotation wraps to nothing', async () => {
    const aligned = await alignCandidateStem(raw, 4, async () => {
      throw new Error('should not bake')
    })
    expect(aligned).toBe(raw)
  })

  it('is null when the bake fails or comes back empty, never the raw phase', async () => {
    expect(await alignCandidateStem(raw, 1.5, async () => [])).toBeNull()
    expect(
      await alignCandidateStem(raw, 1.5, async () => {
        throw new Error('ipc down')
      })
    ).toBeNull()
  })
})
