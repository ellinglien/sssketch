import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  alignCandidateStem,
  cancelDiscoverAlignments,
  peekResolvedCandidateStem,
  resolveCandidateStem,
  type ResolvedCandidateStem
} from './discoverCandidateStem'
import type { ReoneBakeJob } from '@shared/reonedRotation'
import type { DiscoverCandidate } from '@shared/discoverCandidate'
import { discoverSeedPhase } from '@shared/discoverSeedPhase'
import { showReoneNotice } from '../state/reoneNotice'

vi.mock('../state/reoneNotice', () => ({ showReoneNotice: vi.fn() }))

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

describe('resolveCandidateStem cache keying', () => {
  // A riff the library resolves with its one stem downloaded; each test uses its own ids, since
  // the cache lives for the module.
  const candidate = (riffCID: string, stemCID: string, jamCID: string): DiscoverCandidate => ({
    stemCID,
    jamCID,
    riffCID,
    presetName: 'harp',
    creatorUserName: 'wren',
    slotKinds: [],
    drumSubRole: null,
    riffBpm: 120,
    traitValues: {},
    traitPercentiles: {},
    kindSources: {},
    riffCreationTime: null
  })
  // The seed: re-oned by 1.5 bars, from jamA.
  const phase = discoverSeedPhase(
    [
      {
        path: '/lib/.bakes/seed.baked.wav',
        phaseSourcePath: '/lib/stems/x/seed',
        phaseBars: 1.5,
        barLength: 4
      }
    ],
    { '/lib/stems/x/seed': 'jamA' }
  )

  function stubLibrary(bake: (jobs: ReoneBakeJob[]) => Promise<unknown[]>): {
    resolves: string[]
    bakes: ReoneBakeJob[][]
  } {
    const resolves: string[] = []
    const bakes: ReoneBakeJob[][] = []
    vi.stubGlobal('window', {
      rifffApi: {
        riffLibraryResolveRiff: async (riffCID: string) => {
          resolves.push(riffCID)
          return {
            riffCID,
            bpm: 120,
            barLength: 4,
            creationTime: 1,
            stems: [
              {
                stemCID: `${riffCID}-stem`,
                path: `/lib/stems/x/${riffCID}-stem`,
                creatorUserName: 'wren',
                presetName: 'harp',
                instrumentMask: 0,
                durationSec: 8,
                barLength: 4
              }
            ]
          }
        },
        bakeOffset: async (jobs: ReoneBakeJob[]) => {
          bakes.push(jobs)
          return bake(jobs)
        }
      }
    })
    return { resolves, bakes }
  }

  afterEach(() => vi.unstubAllGlobals())

  it('keys a candidate by the rotation the seed gives it: raw and aligned are two entries', async () => {
    const { resolves, bakes } = stubLibrary(async (jobs) =>
      jobs.map((job) => ({ path: job.path, bakedPath: '/lib/.bakes/k1.baked.wav', durationSec: 8 }))
    )
    const sameJam = candidate('k1', 'k1-stem', 'jamA')
    const raw = await resolveCandidateStem(sameJam, null)
    const aligned = await resolveCandidateStem(sameJam, phase)
    expect(raw?.path).toBe('/lib/stems/x/k1-stem')
    expect(aligned).toMatchObject({ path: '/lib/.bakes/k1.baked.wav', phaseBars: 1.5 })
    // The aligned entry is built on the raw one: one library resolve, one bake.
    expect(resolves).toEqual(['k1'])
    expect(bakes).toHaveLength(1)
    // Each key is cached, settled, and readable without an await.
    expect(await resolveCandidateStem(sameJam, phase)).toBe(aligned)
    expect(bakes).toHaveLength(1)
    expect(peekResolvedCandidateStem(sameJam, phase)).toBe(aligned)
    expect(peekResolvedCandidateStem(sameJam, null)).toBe(raw)
  })

  it('a candidate the seed gives no rotation shares the raw entry, phase or not', async () => {
    const { resolves, bakes } = stubLibrary(async () => [])
    const otherJam = candidate('k2', 'k2-stem', 'jamB')
    const withPhase = await resolveCandidateStem(otherJam, phase)
    expect(await resolveCandidateStem(otherJam, null)).toBe(withPhase)
    expect(resolves).toEqual(['k2'])
    expect(bakes).toEqual([])
  })

  it('a failed alignment is not cached: the next resolve bakes again', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    let fail = true
    const { bakes } = stubLibrary(async (jobs) =>
      fail
        ? []
        : jobs.map((job) => ({
            path: job.path,
            bakedPath: '/lib/.bakes/k3.baked.wav',
            durationSec: 8
          }))
    )
    const sameJam = candidate('k3', 'k3-stem', 'jamA')
    expect(await resolveCandidateStem(sameJam, phase)).toBeNull()
    expect(peekResolvedCandidateStem(sameJam, phase)).toBeNull()
    fail = false
    expect((await resolveCandidateStem(sameJam, phase))?.path).toBe('/lib/.bakes/k3.baked.wav')
    expect(bakes).toHaveLength(2)
  })

  it('aligns the candidates that resolve together in one bake', async () => {
    const { bakes } = stubLibrary(async (jobs) =>
      jobs.map((job) => ({ path: job.path, bakedPath: `${job.path}.baked.wav`, durationSec: 8 }))
    )
    const rolled = ['k4', 'k5', 'k6'].map((id) => candidate(id, `${id}-stem`, 'jamA'))
    const aligned = await Promise.all(rolled.map((c) => resolveCandidateStem(c, phase)))
    expect(aligned.map((stem) => stem?.path)).toEqual([
      '/lib/stems/x/k4-stem.baked.wav',
      '/lib/stems/x/k5-stem.baked.wav',
      '/lib/stems/x/k6-stem.baked.wav'
    ])
    expect(bakes).toHaveLength(1)
  })

  describe('when Discover closes', () => {
    // Each test names its jam, so the once-a-minute notice throttle of one can't hide another's.
    const namedPhase = (jamName: string): ReturnType<typeof discoverSeedPhase> =>
      discoverSeedPhase(
        [
          {
            path: '/lib/.bakes/seed.baked.wav',
            phaseSourcePath: '/lib/stems/x/seed',
            phaseBars: 1.5,
            barLength: 4
          }
        ],
        { '/lib/stems/x/seed': 'jamA' },
        { jamA: jamName }
      )
    const tick = (ms = 0): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

    afterEach(() => vi.mocked(showReoneNotice).mockClear())

    it('says so when an alignment fails while Discover is open', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      stubLibrary(async () => [])
      expect(
        await resolveCandidateStem(candidate('c1', 'c1-stem', 'jamA'), namedPhase('one'))
      ).toBeNull()
      expect(showReoneNotice).toHaveBeenCalledWith("couldn't line up a stem from one · skipped")
    })

    it('drops an alignment not yet baked, and says nothing', async () => {
      const { bakes } = stubLibrary(async (jobs) =>
        jobs.map((job) => ({ path: job.path, bakedPath: `${job.path}.baked.wav`, durationSec: 8 }))
      )
      const pending = resolveCandidateStem(candidate('c2', 'c2-stem', 'jamA'), namedPhase('two'))
      await tick()
      cancelDiscoverAlignments()
      expect(await pending).toBeNull()
      await tick(50)
      expect(bakes).toEqual([])
      expect(showReoneNotice).not.toHaveBeenCalled()
    })

    it('lets a bake in flight finish, and says nothing if it fails', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      let settle: (results: unknown[]) => void = () => {}
      const { bakes } = stubLibrary(() => new Promise((resolve) => (settle = resolve)))
      const pending = resolveCandidateStem(candidate('c3', 'c3-stem', 'jamA'), namedPhase('three'))
      await tick(50)
      expect(bakes).toHaveLength(1)
      cancelDiscoverAlignments()
      settle([])
      expect(await pending).toBeNull()
      expect(showReoneNotice).not.toHaveBeenCalled()
    })
  })
})
