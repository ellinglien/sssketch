import { describe, expect, it } from 'vitest'
import type { Stem } from './types'
import {
  addCrossSource,
  assembleCrossRifff,
  createCrossDraft,
  crossCommitIsCurrent,
  crossParentFromRifff,
  crossPairInVisualOrder,
  crossParentOnSide,
  crossProjectKey,
  finishCrossGainDrag,
  moveCrossRow,
  previewCrossGain,
  redoCross,
  removeCrossRow,
  setCrossGain,
  swapCrossSides,
  toggleCrossAudible,
  toggleCrossSolo,
  undoCross,
  type CrossDraft,
  type CrossParent
} from './cross'

function stem(path: string, barLength = 4): Omit<Stem, 'slot'> {
  return {
    author: 'elling',
    name: path.slice(1),
    type: 'fx',
    path,
    durationSec: barLength * 0.5,
    barLength
  }
}

function parent(id: string, paths: string[], bpm = 120): CrossParent {
  return {
    id,
    riffCID: `riff-${id}`,
    label: `parent ${id}`,
    bpm,
    barLength: 8,
    sources: paths.map((path, index) => ({
      id: `${id}:${index + 1}`,
      parentId: id,
      sourceSlot: index + 1,
      stem: stem(path, index === 0 ? 2 : 8),
      gain: 1 - index * 0.1
    }))
  }
}

function draft(): CrossDraft {
  return createCrossDraft(
    'project-a',
    parent('a', ['/same.wav', '/a2.wav']),
    parent('b', ['/same.wav', '/b2.wav']),
    126,
    'draft-1'
  )
}

describe('crossProjectKey', () => {
  it('uses the project seed as the stable identity when present', () => {
    expect(crossProjectKey({ kind: 'library', name: 'demo' }, 'abc')).toBe('seed:abc')
    expect(crossProjectKey({ kind: 'external', path: '/tmp/demo' })).toBe('external:/tmp/demo')
  })
})

describe('crossParentFromRifff', () => {
  it('keeps stem phase lineage and uses the project mix gains', () => {
    const value = crossParentFromRifff(
      {
        groupId: 'group-a',
        name: 'first parent',
        bpm: 128,
        barLength: 4,
        folderPath: '',
        stems: [
          {
            ...stem('/rotated.wav', 4),
            slot: 3,
            phaseSourcePath: '/source.wav',
            phaseBars: -0.5
          }
        ]
      },
      { 'group-a:3': 0.42 }
    )

    expect(value).toMatchObject({
      id: 'group-a',
      label: 'first parent',
      bpm: 128,
      sources: [
        {
          id: 'group-a:3',
          sourceSlot: 3,
          gain: 0.42,
          stem: {
            path: '/rotated.wav',
            phaseSourcePath: '/source.wav',
            phaseBars: -0.5
          }
        }
      ]
    })
  })
})

describe('crossCommitIsCurrent', () => {
  it('rejects a stale build and a project switch', () => {
    const value = draft()
    expect(crossCommitIsCurrent(value.revision, value.projectKey, value, value.projectKey)).toBe(
      true
    )
    expect(
      crossCommitIsCurrent(value.revision - 1, value.projectKey, value, value.projectKey)
    ).toBe(false)
    expect(crossCommitIsCurrent(value.revision, value.projectKey, value, 'project-b')).toBe(false)
  })
})

describe('crossPairInVisualOrder', () => {
  it('captures exactly two selected riffs in current visual order', () => {
    expect(crossPairInVisualOrder(['r3', 'r1', 'r2'], new Set(['r2', 'r3']))).toEqual(['r3', 'r2'])
  })

  it('returns null for any selection size other than two', () => {
    expect(crossPairInVisualOrder(['a', 'b'], new Set(['a']))).toBeNull()
    expect(crossPairInVisualOrder(['a', 'b', 'c'], new Set(['a', 'b', 'c']))).toBeNull()
  })
})

describe('Cross center editing', () => {
  it('swaps presentation sides without changing source identity', () => {
    let value = addCrossSource(draft(), 'a:1')
    value = swapCrossSides(value)
    expect(crossParentOnSide(value, 'left').id).toBe('b')
    expect(value.center[0].sourceId).toBe('a:1')
  })

  it('ignores an unavailable source instead of creating a broken center row', () => {
    const left = parent('a', ['/a.wav'])
    left.sources[0] = { ...left.sources[0], stem: null }
    const value = createCrossDraft('project-a', left, parent('b', ['/b.wav']), 120, 'unavailable')
    expect(addCrossSource(value, 'a:1')).toBe(value)
  })

  it('treats identical audio in different parents as distinct source occurrences', () => {
    let value = addCrossSource(draft(), 'a:1')
    value = addCrossSource(value, 'b:1')
    expect(value.center.map((row) => row.sourceId)).toEqual(['a:1', 'b:1'])
  })

  it('moves an already-added source instead of duplicating it', () => {
    let value = addCrossSource(draft(), 'a:1')
    value = addCrossSource(value, 'a:2')
    value = addCrossSource(value, 'a:1', 1)
    expect(value.center.map((row) => row.sourceId)).toEqual(['a:2', 'a:1'])
  })

  it('inserts, reorders, removes, and supports undo/redo', () => {
    let value = addCrossSource(draft(), 'a:1')
    value = addCrossSource(value, 'b:2', 0)
    value = moveCrossRow(value, 'a:1', 0)
    value = removeCrossRow(value, 'b:2')
    expect(value.center.map((row) => row.sourceId)).toEqual(['a:1'])
    value = undoCross(value)
    expect(value.center.map((row) => row.sourceId)).toEqual(['a:1', 'b:2'])
    value = redoCross(value)
    expect(value.center.map((row) => row.sourceId)).toEqual(['a:1'])
  })

  it('matches Discover solo semantics: unsolo restores every center row', () => {
    let value = addCrossSource(draft(), 'a:1')
    value = addCrossSource(value, 'a:2')
    value = addCrossSource(value, 'b:1')
    value = toggleCrossAudible(value, 'a:2')
    expect(value.center.map((row) => row.audible)).toEqual([true, false, true])
    value = toggleCrossSolo(value, 'b:1')
    expect(value.center.map((row) => row.audible)).toEqual([false, false, true])
    value = toggleCrossSolo(value, 'b:1')
    expect(value.center.map((row) => row.audible)).toEqual([true, true, true])
  })

  it('caps the center at twenty source occurrences', () => {
    const left = parent(
      'a',
      Array.from({ length: 12 }, (_, index) => `/a${index}.wav`)
    )
    const right = parent(
      'b',
      Array.from({ length: 12 }, (_, index) => `/b${index}.wav`)
    )
    let value = createCrossDraft('project-a', left, right, 120, 'draft-20')
    for (const source of [...left.sources, ...right.sources])
      value = addCrossSource(value, source.id)
    expect(value.center).toHaveLength(20)
  })

  it('groups a live gain drag into one undo frame', () => {
    let value = addCrossSource(draft(), 'a:1')
    const frames = value.past.length
    value = previewCrossGain(value, 'a:1', 0.8)
    value = previewCrossGain(value, 'a:1', 0.6)
    value = previewCrossGain(value, 'a:1', 0.4)
    expect(value.past).toHaveLength(frames)
    value = finishCrossGainDrag(value, 'a:1', 1)
    expect(value.past).toHaveLength(frames + 1)
    expect(undoCross(value).center[0].gain).toBe(1)
  })
})

describe('assembleCrossRifff', () => {
  it('assembles displayed order, max bar length, exact gains, and silent excluded rows', () => {
    let value = addCrossSource(draft(), 'a:1')
    value = addCrossSource(value, 'b:2')
    value = setCrossGain(value, 'a:1', 0.42)
    value = toggleCrossAudible(value, 'b:2')
    const assembly = assembleCrossRifff(value, 'group-cross')
    expect(assembly?.rifff).toMatchObject({
      groupId: 'group-cross',
      phaseLinkId: 'group-cross',
      bpm: 126,
      barLength: 8,
      name: 'cross: parent a × parent b'
    })
    expect(assembly?.rifff.stems.map((item) => [item.slot, item.path])).toEqual([
      [1, '/same.wav'],
      [2, '/b2.wav']
    ])
    expect(assembly?.vol).toEqual({ 'group-cross:1': 0.42, 'group-cross:2': 0 })
  })

  it('returns null when the center is empty', () => {
    expect(assembleCrossRifff(draft(), 'group-cross')).toBeNull()
  })
})
