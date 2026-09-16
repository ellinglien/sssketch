import { describe, expect, it } from 'vitest'
import { assembleDiscoverRifff } from './discoverRifffAssembly'
import { stemKey } from '@shared/types'
import type { Stem } from '@shared/types'

function fixtureStem(overrides: Partial<Omit<Stem, 'slot'>> = {}): Omit<Stem, 'slot'> {
  return {
    author: 'elling',
    name: 'a stem',
    type: 'fx',
    path: '/a.wav',
    durationSec: 4,
    barLength: 4,
    ...overrides
  }
}

describe('assembleDiscoverRifff', () => {
  it('returns null for an empty member list', () => {
    expect(assembleDiscoverRifff('discover preview', [], 120)).toBeNull()
  })

  it('builds one rifff with one stem per member, in order, 1-indexed slots', () => {
    const assembly = assembleDiscoverRifff(
      'discover: drums+bass',
      [
        { stem: fixtureStem({ path: '/a.wav' }), gain: 1 },
        { stem: fixtureStem({ path: '/b.wav' }), gain: 0.5 }
      ],
      120
    )
    expect(assembly).not.toBeNull()
    expect(assembly!.rifff.stems).toHaveLength(2)
    expect(assembly!.rifff.stems[0]).toMatchObject({ slot: 1, path: '/a.wav' })
    expect(assembly!.rifff.stems[1]).toMatchObject({ slot: 2, path: '/b.wav' })
  })

  it("sets the rifff's own barLength to the LONGEST member's barLength, tiling shorter ones", () => {
    const assembly = assembleDiscoverRifff(
      'discover preview',
      [
        { stem: fixtureStem({ barLength: 1 }), gain: 1 },
        { stem: fixtureStem({ barLength: 8 }), gain: 1 },
        { stem: fixtureStem({ barLength: 4 }), gain: 1 }
      ],
      120
    )
    expect(assembly!.rifff.barLength).toBe(8)
    // Each STEM keeps its own real, unstretched barLength -- only the
    // rifff's own barLength is the max, so shorter stems tile to fill it.
    expect(assembly!.rifff.stems.map((s) => s.barLength)).toEqual([1, 8, 4])
  })

  it('caps at 8 stems, keeping only the first 8 in the given order', () => {
    const members = Array.from({ length: 10 }, (_, i) => ({
      stem: fixtureStem({ path: `/${i}.wav` }),
      gain: 1
    }))
    const assembly = assembleDiscoverRifff('discover preview', members, 120)
    expect(assembly!.rifff.stems).toHaveLength(8)
    expect(assembly!.rifff.stems.map((s) => s.path)).toEqual([
      '/0.wav',
      '/1.wav',
      '/2.wav',
      '/3.wav',
      '/4.wav',
      '/5.wav',
      '/6.wav',
      '/7.wav'
    ])
  })

  it('does not cap below 8 when a higher maxMembers is explicitly passed', () => {
    // Real bug, live-reported 2026-09-16: this function is shared by
    // plunkInArranger (a REAL, persisted Rifff, genuinely bound to
    // Riffs.StemCID_1..8's own schema) AND syncPreviewToEngine (a
    // throwaway, never-persisted preview project with no such
    // constraint) -- capping the PREVIEW path at 8 too silently dropped
    // any 9th+ Discover slot from the actual audio mix while still
    // showing it as resolved/toggled-on in the UI. A 9-member preview
    // should keep all 9 when maxMembers is raised past 8.
    const members = Array.from({ length: 9 }, (_, i) => ({
      stem: fixtureStem({ path: `/${i}.wav` }),
      gain: 1
    }))
    const assembly = assembleDiscoverRifff('discover preview', members, 120, 32)
    expect(assembly!.rifff.stems).toHaveLength(9)
    expect(assembly!.rifff.stems[8]).toMatchObject({ slot: 9, path: '/8.wav' })
  })

  it("builds a vol map keyed by stemKey(the rifff's own groupId, slot), each member's own gain scaled by sqrtGain(memberCount)", () => {
    // Real bug, live-reported 2026-09-16: "the discover audio is quite a
    // bit louder than the preview in the library explorer" -- Browse's own
    // preview (LibraryBrowser.tsx's tryStartPreview) already applies
    // sqrtGain(stem count) so combined loudness stays roughly constant as
    // more stems join a mix (same reasoning normal multi-stem import
    // already bakes into state.vol, store.ts). assembleDiscoverRifff had
    // no equivalent, so Discover's own preview mix got audibly louder
    // than everywhere else in the app as slots were added, unbounded.
    const assembly = assembleDiscoverRifff(
      'discover preview',
      [
        { stem: fixtureStem(), gain: 0.7 },
        { stem: fixtureStem(), gain: 0.3 }
      ],
      120
    )
    const groupId = assembly!.rifff.groupId
    const expectedScale = 1 / Math.sqrt(2)
    expect(assembly!.vol[stemKey(groupId, 1)]).toBeCloseTo(0.7 * expectedScale)
    expect(assembly!.vol[stemKey(groupId, 2)]).toBeCloseTo(0.3 * expectedScale)
  })

  it('does not scale down a single member (sqrtGain is a no-op for count 1)', () => {
    const assembly = assembleDiscoverRifff(
      'discover preview',
      [{ stem: fixtureStem(), gain: 0.8 }],
      120
    )
    const groupId = assembly!.rifff.groupId
    expect(assembly!.vol[stemKey(groupId, 1)]).toBe(0.8)
  })

  it('passes name and bpm through verbatim', () => {
    const assembly = assembleDiscoverRifff(
      'discover: lead',
      [{ stem: fixtureStem(), gain: 1 }],
      140
    )
    expect(assembly!.rifff.name).toBe('discover: lead')
    expect(assembly!.rifff.bpm).toBe(140)
  })

  it("preserves every other field of each member's own stem (author/name/type/path/durationSec) unchanged", () => {
    const stem = fixtureStem({ author: 'elling', name: 'kick', type: 'drums', durationSec: 2.5 })
    const assembly = assembleDiscoverRifff('discover preview', [{ stem, gain: 1 }], 120)
    expect(assembly!.rifff.stems[0]).toMatchObject({
      author: 'elling',
      name: 'kick',
      type: 'drums',
      durationSec: 2.5
    })
  })

  it('sets folderPath to an empty string (no real folder backs an ephemeral Discover rifff)', () => {
    const assembly = assembleDiscoverRifff(
      'discover preview',
      [{ stem: fixtureStem(), gain: 1 }],
      120
    )
    expect(assembly!.rifff.folderPath).toBe('')
  })

  it('mints a fresh, non-empty groupId on every call', () => {
    const members = [{ stem: fixtureStem(), gain: 1 }]
    const a = assembleDiscoverRifff('discover preview', members, 120)
    const b = assembleDiscoverRifff('discover preview', members, 120)
    expect(a!.rifff.groupId).not.toBe('')
    expect(a!.rifff.groupId).not.toBe(b!.rifff.groupId)
  })
})
