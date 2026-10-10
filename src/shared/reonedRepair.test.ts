import { describe, expect, it } from 'vitest'
import type { Rifff } from './types'
import { applyReonedRepair, planReonedRepair } from './reonedRepair'

const COPY = '/lib/.bakes/0123456789abcdef0123456789abcdef.baked.wav'

function rifffs(): Record<string, Rifff> {
  return {
    a: {
      groupId: 'a',
      name: 'a',
      bpm: 120,
      barLength: 4,
      folderPath: '',
      stems: [
        {
          slot: 1,
          author: '',
          name: 'd',
          type: 'drums',
          path: COPY,
          durationSec: 8,
          barLength: 4,
          phaseSourcePath: '/src/d.wav',
          phaseBars: 1
        },
        {
          slot: 2,
          author: '',
          name: 'b',
          type: 'bass',
          path: '/src/b.wav',
          durationSec: 8,
          barLength: 4
        }
      ]
    },
    b: {
      groupId: 'b',
      name: 'b (pasted)',
      bpm: 120,
      barLength: 4,
      folderPath: '',
      stems: [
        {
          slot: 1,
          author: '',
          name: 'd',
          type: 'drums',
          path: COPY,
          durationSec: 8,
          barLength: 4,
          phaseSourcePath: '/src/d.wav',
          phaseBars: 1
        }
      ]
    }
  }
}

describe('planReonedRepair', () => {
  it('one batch per riff, only stems on a copy with a lineage, with their rotation candidates', () => {
    expect(planReonedRepair(rifffs())).toEqual([
      {
        groupId: 'a',
        stems: [
          {
            path: COPY,
            sourcePath: '/src/d.wav',
            rotationSecCandidates: [2],
            phaseBars: 1,
            barLength: 4
          }
        ]
      },
      {
        groupId: 'b',
        stems: [
          {
            path: COPY,
            sourcePath: '/src/d.wav',
            rotationSecCandidates: [2],
            phaseBars: 1,
            barLength: 4
          }
        ]
      }
    ])
  })

  it('nothing to do for a project with no copies, or a copy with no lineage to rebuild from', () => {
    const r = rifffs()
    delete r.b
    r.a.stems = [r.a.stems[1]]
    expect(planReonedRepair(r)).toEqual([])
    r.a.stems = [{ ...r.a.stems[0], path: COPY }] // a legacy copy with no phaseSourcePath
    expect(planReonedRepair(r)).toEqual([])
  })
})

describe('planReonedRepair for an export', () => {
  it('placedOnly: only riffs on the timeline, since a shelf riff is never rendered', () => {
    const r = rifffs()
    r.b.startBar = 0
    expect(planReonedRepair(r, { placedOnly: true }).map((b) => b.groupId)).toEqual(['b'])
    expect(planReonedRepair(r).map((b) => b.groupId)).toEqual(['a', 'b'])
  })
})

describe('planReonedRepair, one copy named twice in a riff', () => {
  it('plans it once: the first stem naming it wins', () => {
    const r = rifffs()
    r.a.stems.push({ ...r.a.stems[0], slot: 3, phaseBars: 2 })
    expect(planReonedRepair({ a: r.a })).toEqual([
      {
        groupId: 'a',
        stems: [
          {
            path: COPY,
            sourcePath: '/src/d.wav',
            rotationSecCandidates: [2],
            phaseBars: 1,
            barLength: 4
          }
        ]
      }
    ])
  })
})

describe('applyReonedRepair', () => {
  it('leaves the riffs object untouched when every copy is present or rebuilt in place', () => {
    const r = rifffs()
    const out = applyReonedRepair(r, [
      [{ path: COPY, status: 'rebuilt', bakedPath: COPY, durationSec: 8.000001 }],
      [{ path: COPY, status: 'present' }]
    ])
    expect(out.rifffs).toBe(r) // same object: dirtyCheckJson can't change, the project stays saved
    expect(out.missing).toEqual([])
  })

  it('repoints every stem naming a copy rebuilt under a new name, and reports the missing ones', () => {
    const r = rifffs()
    const NEW = '/lib/.bakes/ffffffffffffffffffffffffffffffff.baked.wav'
    const out = applyReonedRepair(r, [
      [{ path: COPY, status: 'rebuilt', bakedPath: NEW, durationSec: 8.01 }]
    ])
    expect(out.rifffs.a.stems[0]).toMatchObject({
      path: NEW,
      durationSec: 8.01,
      phaseSourcePath: '/src/d.wav',
      phaseBars: 1
    })
    expect(out.rifffs.b.stems[0].path).toBe(NEW)
    expect(out.rifffs.a.stems[1]).toBe(r.a.stems[1])
    expect(r.a.stems[0].path).toBe(COPY) // input not mutated
    expect(out.missing).toEqual([])

    const missing = applyReonedRepair(r, [
      [{ path: COPY, status: 'missing', reason: 'unreachable' }]
    ])
    expect(missing.rifffs).toBe(r)
    expect(missing.missing).toEqual([{ path: COPY, reason: 'unreachable' }])
  })

  it('keeps why a copy is missing; named missing twice, "unreachable" wins, since it can be retried', () => {
    const r = rifffs()
    expect(
      applyReonedRepair(r, [[{ path: COPY, status: 'missing', reason: 'render-failed' }]]).missing
    ).toEqual([{ path: COPY, reason: 'render-failed' }])
    expect(
      applyReonedRepair(r, [
        [{ path: COPY, status: 'missing', reason: 'render-failed' }],
        [{ path: COPY, status: 'missing', reason: 'unreachable' }]
      ]).missing
    ).toEqual([{ path: COPY, reason: 'unreachable' }])
  })

  it('a copy one riff could not rebuild but another riff did is not missing', () => {
    const r = rifffs()
    const out = applyReonedRepair(r, [
      [{ path: COPY, status: 'missing', reason: 'unreachable' }],
      [{ path: COPY, status: 'rebuilt', bakedPath: COPY, durationSec: 8 }]
    ])
    expect(out.missing).toEqual([])
  })
})

describe('EEEDIT provenance naming a re-oned copy', () => {
  const SOURCE_COPY = '/lib/.bakes/fedcba9876543210fedcba9876543210.baked.wav'
  function shaped(): Record<string, Rifff> {
    return {
      e: {
        groupId: 'e',
        name: 'edited',
        bpm: 120,
        barLength: 4,
        folderPath: '',
        stems: [
          {
            slot: 1,
            author: '',
            name: 'd',
            type: 'drums',
            path: '/lib/.shapes/6f1c2a9e-1b2c-4d5e-8f90-123456789abc.shape.wav',
            durationSec: 8,
            barLength: 4,
            shape: {
              version: 2,
              loopBars: 4,
              gain: 1,
              fragments: [],
              source: {
                author: '',
                name: 'd',
                type: 'drums',
                path: SOURCE_COPY,
                durationSec: 8,
                barLength: 4,
                phaseSourcePath: '/src/d.wav',
                phaseBars: 1
              }
            }
          }
        ]
      }
    }
  }

  it("plans a copy named only in a stem's EEEDIT source, so a reset can find it", () => {
    const [batch] = planReonedRepair(shaped())
    expect(batch.stems.map((s) => s.path)).toEqual([SOURCE_COPY])
    expect(batch.stems[0].sourcePath).toBe('/src/d.wav')
  })

  it('not for an export: only what plays is rendered', () => {
    const placed = shaped()
    placed.e = { ...placed.e, startBar: 0 }
    expect(planReonedRepair(placed, { placedOnly: true })).toEqual([])
  })

  it('repoints the EEEDIT source when its copy is rebuilt under a new name', () => {
    const moved = '/lib/.bakes/00000000000000000000000000000001.baked.wav'
    const { rifffs: next } = applyReonedRepair(shaped(), [
      [{ path: SOURCE_COPY, status: 'rebuilt', bakedPath: moved, durationSec: 8 }]
    ])
    const stem = next.e.stems[0]
    expect(stem.shape?.source.path).toBe(moved)
    expect(stem.path).toBe(shaped().e.stems[0].path)
  })

  it('a missing copy only EEEDIT provenance names is not reported missing: nothing plays it', () => {
    const { missing } = applyReonedRepair(shaped(), [
      [{ path: SOURCE_COPY, status: 'missing', reason: 'unreachable' }]
    ])
    expect(missing).toEqual([])
  })
})
