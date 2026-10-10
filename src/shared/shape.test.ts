import { describe, expect, it } from 'vitest'
import type { Rifff, ShapeClipProcessV1 } from './types'
import {
  addBakedShapeProcessLanes,
  addShapeLane,
  assembleShapeRifff,
  bakeShapeFragmentProcesses,
  copyShapeFragment,
  copyShapeFragments,
  createShapeDraft,
  duplicateShapeFragment,
  duplicateShapeFragments,
  discardOrphanedShapeProcessPreview,
  finishShapeLaneGain,
  groupShapeEdits,
  isolateShapeFragmentRange,
  moveShapeFragment,
  moveShapeFragments,
  normalizeShapeClipProcess,
  pasteShapeFragments,
  previewShapeLaneGain,
  removeShapeFragmentRange,
  removeShapeFragments,
  removeShapeLane,
  resetShapeLaneRotations,
  rotateShapeLanes,
  resizeShapeFragment,
  reverseShapeFragments,
  setShapeFragmentCharacter,
  setShapeFragmentFormant,
  setShapeFragmentProcess,
  setShapeFragmentRate,
  setShapeFragmentTransform,
  shapeClipTransform,
  shapeFragmentEndBars,
  shapeFragmentLengthBars,
  replaceShapeLaneSource,
  resetShapeLane,
  resetShapeFragmentsToOriginal,
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

  it('compresses or expands the waveform immediately with playback rate', () => {
    expect(shapeWaveformLayout(3, 2, 5, 2)).toEqual({
      tileWidthPct: 20,
      maskOffsetPct: -10
    })
    expect(shapeWaveformLayout(3, 2, 5, 0.5)).toEqual({
      tileWidthPct: 80,
      maskOffsetPct: -40
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
        disabled: false,
        transform: {
          pitchSemitones: 0,
          detuneCents: 0,
          formantSemitones: 0,
          rate: 1,
          character: 'raw'
        }
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

  it('removes a stem lane as one undoable edit but preserves the final lane', () => {
    const before = addShapeLane(
      draft(),
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
    const removed = removeShapeLane(before, 'lane-2')

    expect(removed.lanes).toHaveLength(1)
    expect(removed.lanes[0].id).toBe(before.lanes[0].id)
    expect(undoShape(removed).lanes).toEqual(before.lanes)
    expect(removeShapeLane(removed, removed.lanes[0].id)).toBe(removed)
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

  it('rotates selected stem lanes circularly in either direction and undoes as one edit', () => {
    const before = draft()
    const laneId = before.lanes[0].id
    const right = rotateShapeLanes(before, new Set([laneId]), 0.25)
    expect(right.lanes[0].fragments[0]).toMatchObject({
      sourceStartBars: 1.75,
      sourceEndBars: 9.75,
      destStartBars: 0
    })
    expect(right.lanes[0].rotationBars).toBe(0.25)
    expect(right.past).toHaveLength(1)
    expect(undoShape(right).lanes).toEqual(before.lanes)

    const left = rotateShapeLanes(before, new Set([laneId]), -0.25)
    expect(left.lanes[0].fragments[0]).toMatchObject({
      sourceStartBars: 0.25,
      sourceEndBars: 8.25,
      destStartBars: 0
    })
  })

  it('resets only accumulated rotation and restores it with undo', () => {
    const before = draft()
    const laneId = before.lanes[0].id
    const rotated = rotateShapeLanes(before, new Set([laneId]), 0.5)
    const reset = resetShapeLaneRotations(rotated, new Set([laneId]))
    expect(reset.lanes[0].rotationBars).toBe(0)
    expect(reset.lanes[0].fragments).toEqual(before.lanes[0].fragments)
    expect(undoShape(reset).lanes).toEqual(rotated.lanes)
  })

  it('rotates every chosen lane once while leaving unselected lanes untouched', () => {
    const before = addShapeLane(
      draft(),
      {
        author: 'b',
        name: 'new bass',
        type: 'bass',
        path: '/bass.wav',
        durationSec: 8,
        barLength: 4
      },
      1,
      'lane-2',
      'clip-2'
    )
    const rotated = rotateShapeLanes(before, new Set(['lane-2']), 1)
    expect(rotated.lanes[0].fragments).toEqual(before.lanes[0].fragments)
    expect(rotated.lanes[1].fragments[0]).toMatchObject({
      sourceStartBars: 3,
      sourceEndBars: 11
    })
  })

  it('keeps playback-rate baselines in phase when a rotated clip later changes rate', () => {
    const before = draft()
    const lane = before.lanes[0]
    const fast = setShapeFragmentRate(before, new Set([lane.fragments[0].id]), 2)
    const rotated = rotateShapeLanes(fast, new Set([lane.id]), 0.25)
    const transform = shapeClipTransform(rotated.lanes[0].fragments[0])
    expect(rotated.lanes[0].fragments[0]).toMatchObject({
      sourceStartBars: 1.5,
      sourceEndBars: 9.5
    })
    expect(transform).toMatchObject({
      rate: 2,
      rateSourceStartBars: 1.5,
      rateSourceEndBars: 9.5
    })
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
        disabled: false,
        transform: {
          pitchSemitones: 0,
          detuneCents: 0,
          formantSemitones: 0,
          rate: 1,
          character: 'raw'
        }
      },
      {
        id: 'right',
        sourceStartBars: 3,
        sourceEndBars: 8,
        destStartBars: 3,
        disabled: false,
        transform: {
          pitchSemitones: 0,
          detuneCents: 0,
          formantSemitones: 0,
          rate: 1,
          character: 'raw'
        }
      }
    ])
    expect(shapeRenderSegments(after.lanes[0])).toEqual([
      { sourceStartBars: 0, sourceEndBars: 8, destStartBars: 0, character: 'raw' }
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
      {
        sourceStartBars: 0,
        sourceEndBars: 8,
        destStartBars: 0,
        reversed: true,
        character: 'raw'
      }
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
      { sourceStartBars: 0, sourceEndBars: 3, destStartBars: 0, character: 'raw' },
      {
        sourceStartBars: 3,
        sourceEndBars: 8,
        destStartBars: 3,
        reversed: true,
        character: 'raw'
      }
    ])
    expect(reverseShapeFragments(reversed, new Set(['right'])).lanes[0].fragments[1].reversed).toBe(
      false
    )
  })

  it('stores pitch transforms in the default Raw recipe and restores them with undo', () => {
    const before = draft()
    const clipId = before.lanes[0].fragments[0].id
    const transformed = setShapeFragmentTransform(before, new Set([clipId]), {
      pitchSemitones: -12,
      detuneCents: 17
    })

    expect(shapeClipTransform(transformed.lanes[0].fragments[0])).toEqual({
      pitchSemitones: -12,
      detuneCents: 17,
      formantSemitones: 0,
      rate: 1,
      character: 'raw'
    })
    expect(shapeRenderSegments(transformed.lanes[0])).toEqual([
      {
        sourceStartBars: 0,
        sourceEndBars: 8,
        destStartBars: 0,
        pitchSemitones: -11.83,
        character: 'raw'
      }
    ])
    expect(undoShape(transformed).lanes).toEqual(before.lanes)
  })

  it('supports extreme transpose values through plus or minus 512 semitones', () => {
    const before = draft()
    const clipId = before.lanes[0].fragments[0].id
    const high = setShapeFragmentTransform(before, new Set([clipId]), {
      pitchSemitones: 512,
      detuneCents: 0
    })
    const low = setShapeFragmentTransform(before, new Set([clipId]), {
      pitchSemitones: -999,
      detuneCents: 0
    })

    expect(shapeClipTransform(high.lanes[0].fragments[0]).pitchSemitones).toBe(512)
    expect(shapeClipTransform(low.lanes[0].fragments[0]).pitchSemitones).toBe(-512)
  })

  it('does not merge adjacent clips that have different pitch processing', () => {
    const before = draft()
    const lane = before.lanes[0]
    const split = splitShapeFragment(before, lane.id, lane.fragments[0].id, 4, ['a', 'b'])
    const transformed = setShapeFragmentTransform(split, new Set(['b']), {
      pitchSemitones: 7,
      detuneCents: 0
    })

    expect(shapeRenderSegments(transformed.lanes[0])).toEqual([
      { sourceStartBars: 0, sourceEndBars: 4, destStartBars: 0, character: 'raw' },
      {
        sourceStartBars: 4,
        sourceEndBars: 8,
        destStartBars: 4,
        pitchSemitones: 7,
        character: 'raw'
      }
    ])
  })

  it('stores independent formant shifts without changing pitch, rate, or clip length', () => {
    const before = draft()
    const clipId = before.lanes[0].fragments[0].id
    const shifted = setShapeFragmentFormant(before, new Set([clipId]), -7)

    expect(shapeClipTransform(shifted.lanes[0].fragments[0])).toMatchObject({
      pitchSemitones: 0,
      detuneCents: 0,
      formantSemitones: -7,
      rate: 1
    })
    expect(shapeFragmentLengthBars(shifted.lanes[0].fragments[0])).toBe(8)
    expect(shapeRenderSegments(shifted.lanes[0])).toEqual([
      {
        sourceStartBars: 0,
        sourceEndBars: 8,
        destStartBars: 0,
        formantSemitones: -7,
        character: 'raw'
      }
    ])
    expect(undoShape(shifted).lanes).toEqual(before.lanes)
  })

  it('does not merge adjacent clips with different formant shifts', () => {
    const before = draft()
    const lane = before.lanes[0]
    const split = splitShapeFragment(before, lane.id, lane.fragments[0].id, 4, ['a', 'b'])
    const shifted = setShapeFragmentFormant(split, new Set(['b']), 5)
    expect(shapeRenderSegments(shifted.lanes[0])).toHaveLength(2)
  })

  it('changes tape rate, clip duration, render metadata, and undo as one edit', () => {
    const before = draft()
    const lane = before.lanes[0]
    const split = splitShapeFragment(before, lane.id, lane.fragments[0].id, 4, ['a', 'b'])
    const slowed = setShapeFragmentRate(split, new Set(['a']), 0.5)

    expect(slowed.lanes[0].fragments).toHaveLength(1)
    expect(shapeClipTransform(slowed.lanes[0].fragments[0])).toMatchObject({ rate: 0.5 })
    expect(shapeFragmentLengthBars(slowed.lanes[0].fragments[0])).toBe(8)
    expect(shapeFragmentEndBars(slowed.lanes[0].fragments[0])).toBe(8)
    expect(shapeRenderSegments(slowed.lanes[0])).toEqual([
      { sourceStartBars: 0, sourceEndBars: 4, destStartBars: 0, rate: 0.5, character: 'raw' }
    ])
    expect(undoShape(slowed).lanes).toEqual(split.lanes)

    const resetRate = setShapeFragmentRate(slowed, new Set(['a']), 1)
    expect(resetRate.lanes[0].fragments[0]).toMatchObject({
      sourceStartBars: 0,
      sourceEndBars: 4,
      destStartBars: 0,
      transform: expect.objectContaining({ rate: 1, character: 'raw' })
    })

    const identity = draft()
    const identityId = identity.lanes[0].fragments[0].id
    const cropped = setShapeFragmentRate(identity, new Set([identityId]), 0.5)
    const restored = setShapeFragmentRate(cropped, new Set([identityId]), 1)
    expect(restored.lanes[0].fragments[0]).toMatchObject({
      sourceStartBars: 0,
      sourceEndBars: 8,
      transform: expect.objectContaining({ rate: 1, character: 'raw' })
    })
  })

  it('maps cuts through playback rate and keeps differently-rated neighbors separate', () => {
    const before = draft()
    const lane = before.lanes[0]
    const fast = setShapeFragmentRate(before, new Set([lane.fragments[0].id]), 2)
    const split = splitShapeFragment(fast, lane.id, lane.fragments[0].id, 2, ['a', 'b'])

    expect(split.lanes[0].fragments).toEqual([
      expect.objectContaining({ id: 'a', sourceStartBars: 0, sourceEndBars: 4, destStartBars: 0 }),
      expect.objectContaining({ id: 'b', sourceStartBars: 4, sourceEndBars: 8, destStartBars: 2 })
    ])
    expect(shapeRenderSegments(split.lanes[0])).toEqual([
      { sourceStartBars: 0, sourceEndBars: 8, destStartBars: 0, rate: 2, character: 'raw' }
    ])

    const resetSecond = setShapeFragmentRate(split, new Set(['b']), 1)
    expect(shapeRenderSegments(resetSecond.lanes[0])).toEqual([
      { sourceStartBars: 0, sourceEndBars: 4, destStartBars: 0, rate: 2, character: 'raw' },
      { sourceStartBars: 4, sourceEndBars: 8, destStartBars: 2, character: 'raw' }
    ])
  })

  it('defaults early v2 transform recipes without rate to normal speed', () => {
    const before = draft()
    const legacy = {
      ...before.lanes[0].fragments[0],
      transform: { pitchSemitones: 3, detuneCents: 0, character: 'smooth' as const }
    }
    expect(shapeClipTransform(legacy as never)).toEqual({
      pitchSemitones: 3,
      detuneCents: 0,
      formantSemitones: 0,
      rate: 1,
      character: 'smooth'
    })
  })

  it('defaults output trim for Saturation interventions saved before output gain existed', () => {
    expect(
      normalizeShapeClipProcess({
        type: 'saturation',
        drive: 9,
        bias: 0,
        mix: 1
      } as ShapeClipProcessV1)
    ).toEqual({
      type: 'saturation',
      drive: 9,
      bias: 0,
      outputDb: 0,
      mix: 1
    })
  })

  it('stores Raw as a non-neutral clip property and keeps it through pitch and rate edits', () => {
    const before = draft()
    const clipId = before.lanes[0].fragments[0].id
    const raw = setShapeFragmentCharacter(before, new Set([clipId]), 'raw')
    expect(shapeClipTransform(raw.lanes[0].fragments[0])).toMatchObject({
      pitchSemitones: 0,
      detuneCents: 0,
      formantSemitones: 0,
      rate: 1,
      character: 'raw'
    })
    expect(shapeRenderSegments(raw.lanes[0])).toEqual([
      { sourceStartBars: 0, sourceEndBars: 8, destStartBars: 0, character: 'raw' }
    ])

    const pitched = setShapeFragmentTransform(raw, new Set([clipId]), {
      pitchSemitones: -7,
      detuneCents: 0
    })
    const rated = setShapeFragmentRate(pitched, new Set([clipId]), 2)
    expect(shapeClipTransform(rated.lanes[0].fragments[0])).toMatchObject({
      pitchSemitones: -7,
      rate: 2,
      character: 'raw'
    })
  })

  it('stores Wavefold as a non-destructive clip process and clears it independently', () => {
    const before = draft()
    const clipId = before.lanes[0].fragments[0].id
    const processed = setShapeFragmentProcess(before, new Set([clipId]), {
      type: 'wavefold',
      drive: 4,
      bias: 0,
      mix: 0.75
    })

    expect(shapeClipTransform(processed.lanes[0].fragments[0]).process).toEqual({
      type: 'wavefold',
      drive: 4,
      bias: 0,
      mix: 0.75
    })
    expect(shapeRenderSegments(processed.lanes[0])).toEqual([
      {
        sourceStartBars: 0,
        sourceEndBars: 8,
        destStartBars: 0,
        character: 'raw',
        process: { type: 'wavefold', drive: 4, bias: 0, mix: 0.75 }
      }
    ])
    expect(undoShape(processed).lanes).toEqual(before.lanes)

    const cleared = setShapeFragmentProcess(processed, new Set([clipId]), undefined)
    expect(shapeClipTransform(cleared.lanes[0].fragments[0]).process).toBeUndefined()
    expect(shapeClipTransform(cleared.lanes[0].fragments[0]).character).toBe('raw')
  })

  it('normalizes and persists every single-slot Shape treatment', () => {
    const processes: ShapeClipProcessV1[] = [
      { type: 'saturation', drive: 4, bias: 0.25, outputDb: -6, mix: 0.75 },
      { type: 'hard-clip', threshold: 0.4, symmetry: -0.3, mix: 0.8 },
      { type: 'rectify', mode: 'half', drive: 3, mix: 0.6 },
      { type: 'bit-crush', bits: 7, dither: 0.4, mix: 1 },
      { type: 'rate-crush', factor: 12, jitter: 0.5, mix: 0.9 },
      { type: 'ring-mod', frequencyHz: 173, shape: 0.6, mix: 0.5 },
      { type: 'comb', delayMs: 17, feedback: -0.4, damping: 0.7, mix: 0.7 },
      { type: 'smear', timeMs: 90, scatter: 0.6, mix: 0.8 },
      { type: 'compand', drive: 16, compand: 0.8, symmetry: -0.2, outputDb: -9, mix: 1 },
      {
        type: 'codec-damage',
        quality: 23,
        loss: 0.4,
        packetMs: 32,
        bandwidthHz: 6000,
        mix: 0.9
      },
      { type: 'short-room', sizeMs: 45, decay: 0.7, damping: 0.2, width: 1.5, mix: 0.4 },
      { type: 'frequency-shift', shiftHz: -340, feedback: -0.3, stereo: 1.2, mix: 0.75 },
      {
        type: 'chorus',
        rateHz: 3.5,
        depthMs: 18,
        delayMs: 9,
        feedback: 0.4,
        stereo: 1.8,
        mix: 0.6
      },
      { type: 'dj-eq', lowDb: 12, midDb: -24, highDb: 6, mix: 1 },
      { type: 'tone', cutoffHz: 900, resonance: 0.8, drive: 12, mix: 0.85 }
    ]
    for (const process of processes) {
      const before = draft()
      const clipId = before.lanes[0].fragments[0].id
      const processed = setShapeFragmentProcess(before, new Set([clipId]), process)
      expect(shapeClipTransform(processed.lanes[0].fragments[0]).process).toEqual(process)
      expect(shapeRenderSegments(processed.lanes[0])[0].process).toEqual(process)
    }
  })

  it('keeps Wavefold through pitch edits and does not merge clips with different processes', () => {
    const before = draft()
    const lane = before.lanes[0]
    const split = splitShapeFragment(before, lane.id, lane.fragments[0].id, 4, ['a', 'b'])
    const processed = setShapeFragmentProcess(split, new Set(['b']), {
      type: 'wavefold',
      drive: 8,
      bias: 0,
      mix: 1
    })
    const pitched = setShapeFragmentTransform(processed, new Set(['b']), {
      pitchSemitones: -5,
      detuneCents: 0
    })

    expect(shapeClipTransform(pitched.lanes[0].fragments[1]).process).toEqual({
      type: 'wavefold',
      drive: 8,
      bias: 0,
      mix: 1
    })
    expect(shapeRenderSegments(pitched.lanes[0])).toHaveLength(2)
  })

  it('bakes the current treatment into a durable base while keeping core transforms editable', () => {
    const before = draft()
    const clipId = before.lanes[0].fragments[0].id
    const pitched = setShapeFragmentTransform(before, new Set([clipId]), {
      pitchSemitones: -7,
      detuneCents: 12
    })
    const formantShifted = setShapeFragmentFormant(pitched, new Set([clipId]), 6)
    const processed = setShapeFragmentProcess(formantShifted, new Set([clipId]), {
      type: 'wavefold',
      drive: 4,
      bias: 0,
      mix: 0.75
    })
    const baked = bakeShapeFragmentProcesses(
      processed,
      new Map([[clipId, { path: '/shape/base.shape-base.wav', durationSec: 4, barLength: 2 }]])
    )

    expect(shapeClipTransform(baked.lanes[0].fragments[0])).toMatchObject({
      pitchSemitones: -7,
      detuneCents: 12,
      formantSemitones: 6,
      bakedBase: { path: '/shape/base.shape-base.wav', durationSec: 4, barLength: 2 }
    })
    expect(shapeClipTransform(baked.lanes[0].fragments[0]).process).toBeUndefined()
    expect(shapeRenderSegments(baked.lanes[0])[0]).toMatchObject({
      pitchSemitones: -6.88,
      bakedBase: { path: '/shape/base.shape-base.wav' }
    })
    expect(undoShape(baked).lanes).toEqual(processed.lanes)
  })

  it('groups adding and baking a treatment into one undo step', () => {
    const before = draft()
    const clipId = before.lanes[0].fragments[0].id
    const processed = setShapeFragmentProcess(before, new Set([clipId]), {
      type: 'smear',
      timeMs: 90,
      scatter: 0.6,
      mix: 0.5
    })
    const baked = bakeShapeFragmentProcesses(
      processed,
      new Map([[clipId, { path: '/shape/smear.shape-base.wav', durationSec: 4, barLength: 2 }]])
    )
    const added = groupShapeEdits(before, baked)

    expect(shapeClipTransform(added.lanes[0].fragments[0])).toMatchObject({
      bakedBase: { path: '/shape/smear.shape-base.wav' }
    })
    expect(shapeClipTransform(added.lanes[0].fragments[0]).process).toBeUndefined()
    expect(added.past).toHaveLength(before.past.length + 1)
    expect(undoShape(added).lanes).toEqual(before.lanes)
  })

  it('restores a stranded unbaked intervention preview without an undo artifact', () => {
    const before = draft()
    const clipId = before.lanes[0].fragments[0].id
    const preview = setShapeFragmentProcess(before, new Set([clipId]), {
      type: 'rate-crush',
      factor: 12,
      jitter: 0.2,
      mix: 1
    })
    const recovered = discardOrphanedShapeProcessPreview(preview)

    expect(recovered.lanes).toEqual(before.lanes)
    expect(recovered.past).toEqual(before.past)
    expect(recovered.future).toEqual(before.future)
    expect(recovered.revision).toBeGreaterThan(preview.revision)
  })

  it('adds a baked treatment on a new lane without changing the source clip', () => {
    const before = draft()
    const sourceClip = before.lanes[0].fragments[0]
    const processed = setShapeFragmentProcess(before, new Set([sourceClip.id]), {
      type: 'saturation',
      drive: 9,
      bias: 0.1,
      outputDb: -3,
      mix: 0.75
    })
    const ids = ['copy-clip', 'copy-lane']
    const added = addBakedShapeProcessLanes(
      before,
      processed,
      new Set([sourceClip.id]),
      new Map([
        [sourceClip.id, { path: '/shape/saturated.shape-base.wav', durationSec: 4, barLength: 2 }]
      ]),
      () => ids.shift()!
    )

    expect(added.laneIds).toEqual(['copy-lane'])
    expect(added.fragmentIds).toEqual(['copy-clip'])
    expect(added.draft.lanes[0]).toEqual(before.lanes[0])
    expect(added.draft.lanes[1]).toMatchObject({
      id: 'copy-lane',
      gain: before.lanes[0].gain,
      source: before.lanes[0].source,
      fragments: [
        {
          id: 'copy-clip',
          sourceStartBars: sourceClip.sourceStartBars,
          sourceEndBars: sourceClip.sourceEndBars,
          destStartBars: sourceClip.destStartBars,
          transform: {
            bakedBase: { path: '/shape/saturated.shape-base.wav' }
          }
        }
      ]
    })
    expect(shapeClipTransform(added.draft.lanes[1].fragments[0]).process).toBeUndefined()
    expect(added.draft.past).toHaveLength(before.past.length + 1)
    expect(undoShape(added.draft).lanes).toEqual(before.lanes)
  })

  it('preserves the baked base through later pitch, rate, and character edits', () => {
    const before = draft()
    const clipId = before.lanes[0].fragments[0].id
    const baked = bakeShapeFragmentProcesses(
      before,
      new Map([[clipId, { path: '/shape/base.shape-base.wav', durationSec: 4, barLength: 2 }]])
    )
    const pitched = setShapeFragmentTransform(baked, new Set([clipId]), {
      pitchSemitones: 3,
      detuneCents: 0
    })
    const rated = setShapeFragmentRate(pitched, new Set([clipId]), 2)
    const smooth = setShapeFragmentCharacter(rated, new Set([clipId]), 'smooth')

    expect(shapeClipTransform(smooth.lanes[0].fragments[0]).bakedBase?.path).toBe(
      '/shape/base.shape-base.wav'
    )
  })

  it('resets a baked clip to its immutable source as one undoable edit', () => {
    const before = draft()
    const clipId = before.lanes[0].fragments[0].id
    const transformed = setShapeFragmentRate(
      setShapeFragmentTransform(before, new Set([clipId]), {
        pitchSemitones: -12,
        detuneCents: 0
      }),
      new Set([clipId]),
      2
    )
    const baked = bakeShapeFragmentProcesses(
      transformed,
      new Map([[clipId, { path: '/shape/base.shape-base.wav', durationSec: 4, barLength: 2 }]])
    )
    const reset = resetShapeFragmentsToOriginal(baked, new Set([clipId]))

    expect(shapeClipTransform(reset.lanes[0].fragments[0])).toEqual({
      pitchSemitones: 0,
      detuneCents: 0,
      formantSemitones: 0,
      rate: 1,
      character: 'raw'
    })
    expect(reset.lanes[0].fragments[0].reversed).toBe(false)
    expect(undoShape(reset).lanes).toEqual(baked.lanes)
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

  it('duplicates adjacent selected clips as one intact group and one undo step', () => {
    const initial = draft()
    const laneId = initial.lanes[0].id
    const first = splitShapeFragment(initial, laneId, initial.lanes[0].fragments[0].id, 1, [
      'a',
      'tail-1'
    ])
    const second = splitShapeFragment(first, laneId, 'tail-1', 2, ['b', 'tail-2'])
    const third = splitShapeFragment(second, laneId, 'tail-2', 3, ['c', 'tail-3'])
    const before = splitShapeFragment(third, laneId, 'tail-3', 4, ['d', 'tail'])
    const duplicated = duplicateShapeFragments(before, laneId, new Set(['a', 'b', 'c', 'd']), [
      'copy-a',
      'copy-b',
      'copy-c',
      'copy-d'
    ])

    expect(
      duplicated.lanes[0].fragments.map(({ id, destStartBars }) => ({ id, destStartBars }))
    ).toEqual([
      { id: 'a', destStartBars: 0 },
      { id: 'b', destStartBars: 1 },
      { id: 'c', destStartBars: 2 },
      { id: 'd', destStartBars: 3 },
      { id: 'copy-a', destStartBars: 4 },
      { id: 'copy-b', destStartBars: 5 },
      { id: 'copy-c', destStartBars: 6 },
      { id: 'copy-d', destStartBars: 7 }
    ])
    expect(duplicated.past).toHaveLength(before.past.length + 1)
    expect(undoShape(duplicated).lanes).toEqual(before.lanes)
  })

  it('moves or option-copies selected clips together while preserving their spacing', () => {
    const initial = draft()
    const laneId = initial.lanes[0].id
    const first = splitShapeFragment(initial, laneId, initial.lanes[0].fragments[0].id, 1, [
      'head',
      'a'
    ])
    const second = splitShapeFragment(first, laneId, 'a', 2, ['a', 'b'])
    const before = splitShapeFragment(second, laneId, 'b', 3, ['b', 'tail'])
    const ids = new Set(['a', 'b'])
    const copied = copyShapeFragments(before, laneId, ids, 5, ['copy-a', 'copy-b'])
    const moved = moveShapeFragments(before, laneId, ids, 5)

    expect(
      copied.lanes[0].fragments
        .filter((fragment) => fragment.id.startsWith('copy-'))
        .map(({ id, destStartBars }) => ({ id, destStartBars }))
    ).toEqual([
      { id: 'copy-a', destStartBars: 5 },
      { id: 'copy-b', destStartBars: 6 }
    ])
    expect(
      moved.lanes[0].fragments
        .filter((fragment) => ids.has(fragment.id))
        .map(({ id, destStartBars }) => ({ id, destStartBars }))
    ).toEqual([
      { id: 'a', destStartBars: 5 },
      { id: 'b', destStartBars: 6 }
    ])
  })

  it('pastes a clip snapshot exactly at the cursor and crops it at the riff boundary', () => {
    const initial = draft()
    const laneId = initial.lanes[0].id
    const first = splitShapeFragment(initial, laneId, initial.lanes[0].fragments[0].id, 1, [
      'head',
      'a'
    ])
    const before = splitShapeFragment(first, laneId, 'a', 3, ['a', 'tail'])
    const clipboard = [
      {
        laneId,
        fragments: before.lanes[0].fragments.filter((fragment) => fragment.id === 'a')
      }
    ]
    const pasted = pasteShapeFragments(before, clipboard, 4, ['pasted'])

    expect(
      pasted.draft.lanes[0].fragments.find((fragment) => fragment.id === 'pasted')?.destStartBars
    ).toBe(4)
    expect(pasted.fragmentIds).toEqual(['pasted'])
    expect(pasted.draft.past).toHaveLength(before.past.length + 1)
    expect(undoShape(pasted.draft).lanes).toEqual(before.lanes)
    const cropped = pasteShapeFragments(before, clipboard, 7.5, ['cropped'])
    expect(cropped.draft.lanes[0].fragments.find((fragment) => fragment.id === 'cropped')).toEqual(
      expect.objectContaining({
        sourceStartBars: 1,
        sourceEndBars: 1.5,
        destStartBars: 7.5
      })
    )
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
        version: 2,
        loopBars: 8,
        gain: 0.75
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
    const saved = legacy.rifff.stems[0].shape!
    legacy.rifff.stems[0].shape = {
      version: 1,
      source: saved.source,
      loopBars: saved.loopBars,
      laneDisabled: true,
      gain: saved.gain,
      fragments: saved.fragments
    }
    legacy.vol['child-riff:1'] = 0
    const reopened = createShapeDraft('project-session', legacy.rifff, legacy.vol, 'reopened')
    expect(reopened.lanes[0].fragments.every((fragment) => fragment.disabled)).toBe(true)
    expect(reopened.lanes[0].gain).toBe(0.75)
  })

  it('round-trips transformed clips through v2 provenance', () => {
    const before = draft()
    const clipId = before.lanes[0].fragments[0].id
    const transformed = setShapeFragmentCharacter(
      setShapeFragmentFormant(
        setShapeFragmentTransform(before, new Set([clipId]), {
          pitchSemitones: 5,
          detuneCents: -23
        }),
        new Set([clipId]),
        7
      ),
      new Set([clipId]),
      'raw'
    )
    const assembled = assembleShapeRifff(
      transformed,
      [{ path: '/shape/transformed.wav', durationSec: 16 }],
      'transformed-riff'
    )
    const reopened = createShapeDraft('project-session', assembled.rifff, assembled.vol, 'reopened')

    expect(assembled.rifff.stems[0].shape?.version).toBe(2)
    expect(shapeClipTransform(reopened.lanes[0].fragments[0])).toEqual({
      pitchSemitones: 5,
      detuneCents: -23,
      formantSemitones: 7,
      rate: 1,
      character: 'raw'
    })
  })

  it('round-trips a Wavefold process through kept Shape provenance', () => {
    const before = draft()
    const clipId = before.lanes[0].fragments[0].id
    const processed = setShapeFragmentProcess(before, new Set([clipId]), {
      type: 'wavefold',
      drive: 3,
      bias: 0,
      mix: 0.5
    })
    const assembled = assembleShapeRifff(
      processed,
      [{ path: '/shape/wavefold.wav', durationSec: 16 }],
      'wavefold-riff'
    )
    const reopened = createShapeDraft('project-session', assembled.rifff, assembled.vol, 'reopened')

    expect(shapeClipTransform(reopened.lanes[0].fragments[0]).process).toEqual({
      type: 'wavefold',
      drive: 3,
      bias: 0,
      mix: 0.5
    })
  })

  it('round-trips the latest durable baked base through Shape provenance', () => {
    const before = draft()
    const clipId = before.lanes[0].fragments[0].id
    const baked = bakeShapeFragmentProcesses(
      before,
      new Map([[clipId, { path: '/shape/base.shape-base.wav', durationSec: 4, barLength: 2 }]])
    )
    const assembled = assembleShapeRifff(
      baked,
      [{ path: '/shape/final.wav', durationSec: 16 }],
      'baked-riff'
    )
    const reopened = createShapeDraft('project-session', assembled.rifff, assembled.vol, 'reopened')

    expect(shapeClipTransform(reopened.lanes[0].fragments[0]).bakedBase).toEqual({
      path: '/shape/base.shape-base.wav',
      durationSec: 4,
      barLength: 2
    })
  })
})
