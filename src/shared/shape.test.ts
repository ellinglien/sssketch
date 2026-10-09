import { describe, expect, it } from 'vitest'
import type { Rifff } from './types'
import {
  addShapeLane,
  assembleShapeRifff,
  copyShapeFragment,
  createShapeDraft,
  duplicateShapeFragment,
  finishShapeLaneGain,
  groupShapeEdits,
  isolateShapeFragmentRange,
  moveShapeFragment,
  previewShapeLaneGain,
  removeShapeFragmentRange,
  removeShapeFragments,
  resizeShapeFragment,
  reverseShapeFragments,
  replaceShapeLaneSource,
  resetShapeLane,
  shapeContentFingerprint,
  shapeRenderFingerprint,
  splitShapeFragment,
  toggleShapeFragmentsDisabled,
  undoShape,
  redoShape,
  shapeRenderSegments,
  shapeWaveformLayout
} from './shape'
import type { ShapeDraft } from './shape'

const source: Rifff = {
  groupId: 'source-riff',
  name: 'source',
  bpm: 120,
  barLength: 8,
  folderPath: '/source',
  stems: [
    {
      slot: 1,
      author: 'a',
      name: 'drums',
      type: 'drums',
      path: '/drums.wav',
      durationSec: 4,
      barLength: 2
    }
  ]
}

function draft(): ShapeDraft {
  return createShapeDraft('project-session', source, { 'source-riff:1': 0.75 }, 'draft-1')
}

describe('Shape draft', () => {
  it('positions a clipped waveform by musical source phase for unequal lengths', () => {
    expect(shapeWaveformLayout(3, 2, 5)).toEqual({
      tileWidthPct: 40,
      maskOffsetPct: -20
    })
  })

  it('starts each lane as one identity fragment across the complete riff', () => {
    const value = draft()
    expect(value.loopBars).toBe(8)
    expect(value.lanes[0].gain).toBe(0.75)
    expect(value.lanes[0].fragments).toEqual([
      {
        id: expect.any(String),
        sourceStartBars: 0,
        sourceEndBars: 8,
        destStartBars: 0,
        disabled: false
      }
    ])
  })

  it('rejects one-shot sources rather than mis-projecting them as tiled audio', () => {
    expect(() =>
      createShapeDraft('project-session', {
        ...source,
        stems: [{ ...source.stems[0], oneShot: true }]
      })
    ).toThrow(/one-shot/i)
  })

  it('adds a discovered stem as one full-length clip in a new lane', () => {
    const before = draft()
    const next = addShapeLane(
      before,
      {
        author: 'b',
        name: 'new bass',
        type: 'bass',
        path: '/bass.wav',
        durationSec: 4,
        barLength: 2
      },
      1,
      'lane-2',
      'clip-2'
    )
    expect(next.lanes[1]).toMatchObject({
      id: 'lane-2',
      source: { path: '/bass.wav' },
      fragments: [
        {
          id: 'clip-2',
          sourceStartBars: 0,
          sourceEndBars: 8,
          destStartBars: 0,
          disabled: false
        }
      ]
    })
  })

  it('replaces a lane source while preserving its arrangement and mix state', () => {
    const before = draft()
    const lane = before.lanes[0]
    const chopped = splitShapeFragment(before, lane.id, lane.fragments[0].id, 3, ['a', 'b'])
    const after = replaceShapeLaneSource(chopped, lane.id, {
      author: 'b',
      name: 'replacement',
      type: 'drums',
      path: '/replacement.wav',
      durationSec: 8,
      barLength: 4
    })

    expect(after.lanes[0].source.path).toBe('/replacement.wav')
    expect(after.lanes[0].fragments).toEqual(chopped.lanes[0].fragments)
    expect(after.lanes[0].gain).toBe(chopped.lanes[0].gain)
  })

  it('previews a gain gesture live and commits one undo checkpoint', () => {
    const before = draft()
    const laneId = before.lanes[0].id
    let value = previewShapeLaneGain(before, laneId, 0.6)
    value = previewShapeLaneGain(value, laneId, 0.4)
    expect(value.past).toHaveLength(0)
    value = finishShapeLaneGain(value, laneId, 0.75)
    expect(value.lanes[0].gain).toBe(0.4)
    expect(value.past).toHaveLength(1)
    expect(undoShape(value).lanes[0].gain).toBe(0.75)
  })

  it('splits source and destination coordinates without changing the render plan', () => {
    const before = draft()
    const lane = before.lanes[0]
    const after = splitShapeFragment(before, lane.id, lane.fragments[0].id, 3, ['left', 'right'])
    expect(after.lanes[0].fragments).toEqual([
      {
        id: 'left',
        sourceStartBars: 0,
        sourceEndBars: 3,
        destStartBars: 0,
        disabled: false
      },
      {
        id: 'right',
        sourceStartBars: 3,
        sourceEndBars: 8,
        destStartBars: 3,
        disabled: false
      }
    ])
    expect(shapeRenderSegments(after.lanes[0])).toEqual([
      { sourceStartBars: 0, sourceEndBars: 8, destStartBars: 0 }
    ])
  })

  it('splits a reversed clip from the opposite source edge without changing playback', () => {
    const before = draft()
    const lane = before.lanes[0]
    const reversed = reverseShapeFragments(before, new Set([lane.fragments[0].id]))
    const after = splitShapeFragment(reversed, lane.id, lane.fragments[0].id, 3, [
      'left-reverse',
      'right-reverse'
    ])
    expect(after.lanes[0].fragments).toEqual([
      expect.objectContaining({
        id: 'left-reverse',
        sourceStartBars: 5,
        sourceEndBars: 8,
        destStartBars: 0,
        reversed: true
      }),
      expect.objectContaining({
        id: 'right-reverse',
        sourceStartBars: 0,
        sourceEndBars: 5,
        destStartBars: 3,
        reversed: true
      })
    ])
    expect(shapeRenderSegments(after.lanes[0])).toEqual([
      { sourceStartBars: 0, sourceEndBars: 8, destStartBars: 0, reversed: true }
    ])
  })

  it('isolates and removes a reversed range with its source mapping intact', () => {
    const before = draft()
    const lane = before.lanes[0]
    const reversed = reverseShapeFragments(before, new Set([lane.fragments[0].id]))
    const isolated = isolateShapeFragmentRange(reversed, lane.id, lane.fragments[0].id, 2, 5, [
      'before-reverse',
      'selection-reverse',
      'after-reverse'
    ])
    expect(isolated.draft.lanes[0].fragments).toEqual([
      expect.objectContaining({
        id: 'before-reverse',
        sourceStartBars: 6,
        sourceEndBars: 8,
        destStartBars: 0,
        reversed: true
      }),
      expect.objectContaining({
        id: 'selection-reverse',
        sourceStartBars: 3,
        sourceEndBars: 6,
        destStartBars: 2,
        reversed: true
      }),
      expect.objectContaining({
        id: 'after-reverse',
        sourceStartBars: 0,
        sourceEndBars: 3,
        destStartBars: 5,
        reversed: true
      })
    ])
    const removed = removeShapeFragmentRange(reversed, lane.id, lane.fragments[0].id, 2, 5, [
      'before-reverse',
      'selection-reverse',
      'after-reverse'
    ])
    expect(removed.lanes[0].fragments).toEqual([
      expect.objectContaining({ sourceStartBars: 6, sourceEndBars: 8, destStartBars: 0 }),
      expect.objectContaining({ sourceStartBars: 0, sourceEndBars: 3, destStartBars: 5 })
    ])
  })

  it('ignores a split at a fragment edge', () => {
    const before = draft()
    const lane = before.lanes[0]
    expect(splitShapeFragment(before, lane.id, lane.fragments[0].id, 0)).toBe(before)
  })

  it('isolates a dragged time selection with two cuts and one undo checkpoint', () => {
    const before = draft()
    const lane = before.lanes[0]
    const result = isolateShapeFragmentRange(before, lane.id, lane.fragments[0].id, 2, 5, [
      'before',
      'selection',
      'after'
    ])

    expect(result.fragmentId).toBe('selection')
    expect(result.draft.lanes[0].fragments).toEqual([
      expect.objectContaining({
        id: 'before',
        sourceStartBars: 0,
        sourceEndBars: 2,
        destStartBars: 0
      }),
      expect.objectContaining({
        id: 'selection',
        sourceStartBars: 2,
        sourceEndBars: 5,
        destStartBars: 2
      }),
      expect.objectContaining({
        id: 'after',
        sourceStartBars: 5,
        sourceEndBars: 8,
        destStartBars: 5
      })
    ])
    expect(result.draft.past).toHaveLength(1)
    expect(undoShape(result.draft).lanes).toEqual(before.lanes)
  })

  it('deletes only a dragged time selection and restores it with one undo', () => {
    const before = draft()
    const lane = before.lanes[0]
    const after = removeShapeFragmentRange(before, lane.id, lane.fragments[0].id, 2, 5, [
      'before',
      'selection',
      'after'
    ])

    expect(after.lanes[0].fragments).toEqual([
      expect.objectContaining({
        id: 'before',
        sourceStartBars: 0,
        sourceEndBars: 2,
        destStartBars: 0
      }),
      expect.objectContaining({
        id: 'after',
        sourceStartBars: 5,
        sourceEndBars: 8,
        destStartBars: 5
      })
    ])
    expect(after.past).toHaveLength(1)
    expect(undoShape(after).lanes).toEqual(before.lanes)
  })

  it('reverses a clip non-destructively and keeps that boundary in the render plan', () => {
    const before = draft()
    const lane = before.lanes[0]
    const split = splitShapeFragment(before, lane.id, lane.fragments[0].id, 3, ['left', 'right'])
    const reversed = reverseShapeFragments(split, new Set(['right']))
    expect(reversed.lanes[0].fragments[1].reversed).toBe(true)
    expect(shapeRenderSegments(reversed.lanes[0])).toEqual([
      { sourceStartBars: 0, sourceEndBars: 3, destStartBars: 0 },
      { sourceStartBars: 3, sourceEndBars: 8, destStartBars: 3, reversed: true }
    ])
    expect(reverseShapeFragments(reversed, new Set(['right'])).lanes[0].fragments[1].reversed).toBe(
      false
    )
  })

  it('copies with overwrite semantics and preserves trimmed source offsets', () => {
    const initial = draft()
    const split = splitShapeFragment(
      initial,
      initial.lanes[0].id,
      initial.lanes[0].fragments[0].id,
      2,
      ['a', 'b']
    )
    const lane = split.lanes[0]
    const copied = copyShapeFragment(split, lane.id, 'a', 3, 'copy')
    expect(copied.lanes[0].fragments).toEqual([
      expect.objectContaining({ id: 'a', sourceStartBars: 0, sourceEndBars: 2, destStartBars: 0 }),
      expect.objectContaining({ id: 'b', sourceStartBars: 2, sourceEndBars: 3, destStartBars: 2 }),
      expect.objectContaining({
        id: 'copy',
        sourceStartBars: 0,
        sourceEndBars: 2,
        destStartBars: 3
      }),
      expect.objectContaining({
        id: expect.any(String),
        sourceStartBars: 5,
        sourceEndBars: 8,
        destStartBars: 5
      })
    ])
  })

  it('gives every overwrite remainder a unique id so later moves cannot delete siblings', () => {
    const initial = draft()
    const split = splitShapeFragment(
      initial,
      initial.lanes[0].id,
      initial.lanes[0].fragments[0].id,
      1,
      ['copy-source', 'base']
    )
    const first = copyShapeFragment(split, split.lanes[0].id, 'copy-source', 3, 'copy-1')
    const second = copyShapeFragment(first, first.lanes[0].id, 'copy-source', 1.5, 'copy-2')
    const remainderIds = second.lanes[0].fragments
      .filter((fragment) => fragment.sourceStartBars >= 2.5)
      .map((fragment) => fragment.id)
    expect(new Set(remainderIds).size).toBe(remainderIds.length)

    const longRemainder = second.lanes[0].fragments.find(
      (fragment) => fragment.sourceStartBars === 4 && fragment.sourceEndBars === 8
    )!
    const moved = moveShapeFragment(second, second.lanes[0].id, longRemainder.id, 4)
    expect(moved.lanes[0].fragments.some((fragment) => fragment.sourceEndBars === 8)).toBe(true)
  })

  it('moves by clearing the old destination before overwriting the new destination', () => {
    const initial = draft()
    const before = splitShapeFragment(
      initial,
      initial.lanes[0].id,
      initial.lanes[0].fragments[0].id,
      2,
      ['a', 'b']
    )
    const moved = moveShapeFragment(before, before.lanes[0].id, 'a', 6)
    expect(moved.lanes[0].fragments.map((fragment) => fragment.id)).toEqual(['b', 'a'])
    expect(moved.lanes[0].fragments[1]).toMatchObject({ destStartBars: 6 })
  })

  it('trims clip edges without stretching and restores the gesture with one undo', () => {
    const before = draft()
    const lane = before.lanes[0]
    const leftTrimmed = resizeShapeFragment(before, lane.id, lane.fragments[0].id, 'left', 2)
    expect(leftTrimmed.lanes[0].fragments[0]).toMatchObject({
      sourceStartBars: 2,
      sourceEndBars: 8,
      destStartBars: 2
    })

    const rightTrimmed = resizeShapeFragment(leftTrimmed, lane.id, lane.fragments[0].id, 'right', 6)
    expect(rightTrimmed.lanes[0].fragments[0]).toMatchObject({
      sourceStartBars: 2,
      sourceEndBars: 6,
      destStartBars: 2
    })
    expect(undoShape(rightTrimmed).lanes).toEqual(leftTrimmed.lanes)
  })

  it('mirrors source-edge trimming for reversed clips', () => {
    const before = draft()
    const lane = before.lanes[0]
    const reversed = reverseShapeFragments(before, new Set([lane.fragments[0].id]))
    const leftTrimmed = resizeShapeFragment(reversed, lane.id, lane.fragments[0].id, 'left', 2)
    expect(leftTrimmed.lanes[0].fragments[0]).toMatchObject({
      sourceStartBars: 0,
      sourceEndBars: 6,
      destStartBars: 2,
      reversed: true
    })
    const rightTrimmed = resizeShapeFragment(reversed, lane.id, lane.fragments[0].id, 'right', 6)
    expect(rightTrimmed.lanes[0].fragments[0]).toMatchObject({
      sourceStartBars: 2,
      sourceEndBars: 8,
      destStartBars: 0,
      reversed: true
    })
  })

  it('preserves reversed neighbors when an expanded edge overwrites their middle', () => {
    const before = draft()
    const lane = before.lanes[0]
    const split = splitShapeFragment(before, lane.id, lane.fragments[0].id, 2, ['left', 'target'])
    const reversed = reverseShapeFragments(split, new Set(['target']))
    const expanded = resizeShapeFragment(reversed, lane.id, 'left', 'right', 5)
    expect(expanded.lanes[0].fragments).toEqual([
      expect.objectContaining({
        id: 'left',
        sourceStartBars: 0,
        sourceEndBars: 5,
        destStartBars: 0
      }),
      expect.objectContaining({
        id: 'target',
        sourceStartBars: 2,
        sourceEndBars: 5,
        destStartBars: 5,
        reversed: true
      })
    ])
  })

  it('uses materialized audio as a fresh baseline when saved provenance has another loop length', () => {
    const shapedSource: Rifff = {
      ...source,
      barLength: 8,
      stems: [
        {
          ...source.stems[0],
          path: '/materialized.shape.wav',
          shape: {
            version: 1,
            source: { ...source.stems[0] },
            loopBars: 2,
            laneDisabled: false,
            gain: 0.5,
            fragments: [
              {
                id: 'old-fragment',
                sourceStartBars: 0,
                sourceEndBars: 2,
                destStartBars: 0,
                disabled: false
              }
            ]
          }
        }
      ]
    }
    const value = createShapeDraft('project-session', shapedSource)
    expect(value.lanes[0].source.path).toBe('/materialized.shape.wav')
    expect(value.lanes[0].fragments).toEqual([
      expect.objectContaining({ sourceStartBars: 0, sourceEndBars: 8, destStartBars: 0 })
    ])
  })

  it('reveals trimmed source material and overwrites clips crossed by the expanded edge', () => {
    const before = draft()
    const lane = before.lanes[0]
    const split = splitShapeFragment(before, lane.id, lane.fragments[0].id, 4, ['left', 'right'])
    const trimmed = resizeShapeFragment(split, lane.id, 'right', 'left', 2)
    expect(trimmed.lanes[0].fragments).toEqual([
      expect.objectContaining({
        id: 'left',
        sourceStartBars: 0,
        sourceEndBars: 2,
        destStartBars: 0
      }),
      expect.objectContaining({
        id: 'right',
        sourceStartBars: 2,
        sourceEndBars: 8,
        destStartBars: 2
      })
    ])
  })

  it('duplicates immediately after the source only when the full fragment fits', () => {
    const initial = draft()
    const before = splitShapeFragment(
      initial,
      initial.lanes[0].id,
      initial.lanes[0].fragments[0].id,
      2,
      ['a', 'b']
    )
    expect(duplicateShapeFragment(before, before.lanes[0].id, 'a', 'copy')).not.toBe(before)
    expect(duplicateShapeFragment(before, before.lanes[0].id, 'b', 'copy')).toBe(before)
  })

  it('toggles durable fragment Disable and can remove a fragment', () => {
    const before = draft()
    const lane = before.lanes[0]
    const id = lane.fragments[0].id
    const disabled = toggleShapeFragmentsDisabled(before, new Set([id]))
    expect(disabled.lanes[0].fragments[0].disabled).toBe(true)
    expect(removeShapeFragments(disabled, new Set([id])).lanes[0].fragments).toEqual([])
  })

  it('disables every selected clip when the complete stem lane is selected', () => {
    const before = draft()
    const lane = before.lanes[0]
    const split = splitShapeFragment(before, lane.id, lane.fragments[0].id, 4, ['a', 'b'])
    const disabled = toggleShapeFragmentsDisabled(split, new Set(['a', 'b']))
    expect(disabled.lanes[0].fragments.every((fragment) => fragment.disabled)).toBe(true)
    expect(shapeRenderSegments(disabled.lanes[0])).toEqual([])
  })

  it('resets one lane and undo/redo treat each edit as one checkpoint', () => {
    const before = draft()
    const lane = before.lanes[0]
    const changed = splitShapeFragment(before, lane.id, lane.fragments[0].id, 4, ['a', 'b'])
    const reset = resetShapeLane(changed, lane.id, 'reset')
    expect(reset.lanes[0].fragments).toHaveLength(1)
    expect(undoShape(reset).lanes[0].fragments).toHaveLength(2)
    expect(redoShape(undoShape(reset)).lanes[0].fragments).toHaveLength(1)
  })

  it('groups a multi-fragment gesture into one undo checkpoint', () => {
    const before = draft()
    const lane = before.lanes[0]
    const split = splitShapeFragment(before, lane.id, lane.fragments[0].id, 2, ['a', 'b'])
    const duplicated = duplicateShapeFragment(split, lane.id, 'a', 'copy')
    const grouped = groupShapeEdits(before, duplicated)
    expect(grouped.past).toHaveLength(1)
    expect(grouped.revision).toBe(before.revision + 1)
    expect(undoShape(grouped).lanes[0].fragments).toEqual(before.lanes[0].fragments)
  })

  it('fingerprints musical content without treating undo history or revision as edits', () => {
    const before = draft()
    const bookkeepingOnly = {
      ...before,
      revision: 99,
      past: [{ lanes: before.lanes }],
      future: [{ lanes: before.lanes }]
    }
    expect(shapeContentFingerprint(bookkeepingOnly)).toBe(shapeContentFingerprint(before))
  })

  it('tracks gain for saving without needlessly re-rendering preview WAVs', () => {
    const before = draft()
    const lane = before.lanes[0]
    const gained = finishShapeLaneGain(
      previewShapeLaneGain(before, lane.id, 0.25),
      lane.id,
      lane.gain
    )
    expect(shapeContentFingerprint(gained)).not.toBe(shapeContentFingerprint(before))
    expect(shapeRenderFingerprint(gained)).toBe(shapeRenderFingerprint(before))
  })
})

describe('Shape assembly', () => {
  it('creates an independent ordinary riff with explicit gain and versioned provenance', () => {
    const value = draft()
    const assembled = assembleShapeRifff(
      value,
      [{ path: '/shape/1.wav', durationSec: 16 }],
      'child-riff'
    )
    expect(assembled.rifff.groupId).toBe('child-riff')
    expect(assembled.rifff.phaseLinkId).toBe('child-riff')
    expect(assembled.rifff.stems[0]).toMatchObject({
      path: '/shape/1.wav',
      durationSec: 16,
      barLength: 8,
      phaseSourcePath: '/shape/1.wav',
      phaseBars: 0,
      shape: {
        version: 1,
        loopBars: 8,
        gain: 0.75,
        laneDisabled: false
      }
    })
    expect(assembled.vol['child-riff:1']).toBe(0.75)
  })

  it('migrates legacy whole-lane Disable into disabled clips and retains its remembered gain', () => {
    const legacy = assembleShapeRifff(
      draft(),
      [{ path: '/shape/1.wav', durationSec: 16 }],
      'child-riff'
    )
    legacy.rifff.stems[0].shape!.laneDisabled = true
    legacy.vol['child-riff:1'] = 0
    const reopened = createShapeDraft('project-session', legacy.rifff, legacy.vol, 'reopened')
    expect(reopened.lanes[0].fragments.every((fragment) => fragment.disabled)).toBe(true)
    expect(reopened.lanes[0].gain).toBe(0.75)
  })
})
