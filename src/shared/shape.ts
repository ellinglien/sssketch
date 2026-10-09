import {
  stemKey,
  type Rifff,
  type ShapeFragmentRecipe,
  type ShapeSourceStem,
  type Stem
} from './types'

export interface ShapeLane {
  id: string
  source: ShapeSourceStem
  gain: number
  fragments: ShapeFragmentRecipe[]
}

export interface ShapeSnapshot {
  lanes: ShapeLane[]
}

export interface ShapeDraft {
  id: string
  projectKey: string
  sourceGroupId: string
  sourceName: string
  targetBpm: number
  loopBars: number
  lanes: ShapeLane[]
  past: ShapeSnapshot[]
  future: ShapeSnapshot[]
  revision: number
}

export interface ShapeRenderResult {
  path: string
  durationSec: number
}

export interface ShapeAssembly {
  rifff: Rifff
  vol: Record<string, number>
}

export interface ShapeRenderSegment {
  sourceStartBars: number
  sourceEndBars: number
  destStartBars: number
  reversed?: boolean
}

export interface ShapeMaterializeLane {
  source: ShapeSourceStem
  segments: ShapeRenderSegment[]
}

export interface ShapeMaterializeRequest {
  jobId: string
  mode: 'preview' | 'commit'
  targetBpm: number
  loopBars: number
  lanes: ShapeMaterializeLane[]
}

export interface ShapeMaterializedStem extends ShapeRenderResult {
  sampleRate: number
  frames: number
  channels: number
}

export interface ShapeMaterializeResult {
  jobId: string
  stems: ShapeMaterializedStem[]
}

export function shapeWaveformLayout(
  sourceStartBars: number,
  sourceBarLength: number,
  fragmentLengthBars: number
): { tileWidthPct: number; maskOffsetPct: number } {
  const phaseBars = ((sourceStartBars % sourceBarLength) + sourceBarLength) % sourceBarLength
  return {
    tileWidthPct: (sourceBarLength / fragmentLengthBars) * 100,
    maskOffsetPct: -(phaseBars / fragmentLengthBars) * 100
  }
}

const EPS = 1e-9

function id(): string {
  return crypto.randomUUID()
}

function cloneFragment(fragment: ShapeFragmentRecipe): ShapeFragmentRecipe {
  return { ...fragment }
}

function cloneSource(source: ShapeSourceStem): ShapeSourceStem {
  return { ...source }
}

function cloneLane(lane: ShapeLane): ShapeLane {
  return {
    ...lane,
    source: cloneSource(lane.source),
    fragments: lane.fragments.map(cloneFragment)
  }
}

function cloneLanes(lanes: readonly ShapeLane[]): ShapeLane[] {
  return lanes.map(cloneLane)
}

function snapshot(draft: ShapeDraft): ShapeSnapshot {
  return { lanes: cloneLanes(draft.lanes) }
}

function sameLanes(a: readonly ShapeLane[], b: readonly ShapeLane[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function commit(draft: ShapeDraft, lanes: ShapeLane[]): ShapeDraft {
  if (sameLanes(draft.lanes, lanes)) return draft
  return {
    ...draft,
    lanes,
    past: [...draft.past, snapshot(draft)],
    future: [],
    revision: draft.revision + 1
  }
}

function sourceFromStem(stem: Stem): ShapeSourceStem {
  const source: Partial<Stem> = { ...stem }
  delete source.slot
  delete source.shape
  return source as ShapeSourceStem
}

function identityFragment(loopBars: number, fragmentId = id()): ShapeFragmentRecipe {
  return {
    id: fragmentId,
    sourceStartBars: 0,
    sourceEndBars: loopBars,
    destStartBars: 0,
    disabled: false
  }
}

export function createShapeDraft(
  projectKey: string,
  rifff: Rifff,
  vol: Readonly<Record<string, number>> = {},
  draftId = id(),
  targetBpm = rifff.bpm
): ShapeDraft {
  if (
    rifff.stems.some((stem) => stem.oneShot || stem.trimStartSec || stem.trimEndSec !== undefined)
  ) {
    throw new Error('Shape Riff does not yet support one-shot or trimmed stems.')
  }
  const groupGain = vol[rifff.groupId] ?? 1
  const lanes = rifff.stems.map((stem): ShapeLane => {
    const provenance = stem.shape?.version === 1 ? stem.shape : undefined
    const savedGain = vol[stemKey(rifff.groupId, stem.slot)]
    // Older Shape riffs could disable a whole lane. Shape now has one
    // durable-disable concept only -- clips -- so migrate that legacy bit
    // onto every clip as the draft opens. Its remembered gain still wins
    // over the ordinary playback zero written by the older format.
    const gain = provenance?.laneDisabled
      ? provenance.gain
      : (savedGain ?? provenance?.gain ?? groupGain)
    return {
      id: id(),
      source: provenance ? cloneSource(provenance.source) : sourceFromStem(stem),
      gain: Math.max(0, Math.min(1, gain)),
      fragments: provenance
        ? provenance.fragments.map((fragment) => ({
            ...cloneFragment(fragment),
            disabled: provenance.laneDisabled ? true : fragment.disabled
          }))
        : [identityFragment(rifff.barLength)]
    }
  })
  return {
    id: draftId,
    projectKey,
    sourceGroupId: rifff.groupId,
    sourceName: rifff.name,
    targetBpm,
    loopBars: rifff.barLength,
    lanes,
    past: [],
    future: [],
    revision: 0
  }
}

function updateLane(
  draft: ShapeDraft,
  laneId: string,
  update: (lane: ShapeLane) => ShapeLane
): ShapeDraft {
  const lanes = draft.lanes.map((lane) =>
    lane.id === laneId ? update(cloneLane(lane)) : cloneLane(lane)
  )
  return commit(draft, lanes)
}

function sortFragments(fragments: ShapeFragmentRecipe[]): ShapeFragmentRecipe[] {
  return fragments.sort((a, b) => a.destStartBars - b.destStartBars || a.id.localeCompare(b.id))
}

export function splitShapeFragment(
  draft: ShapeDraft,
  laneId: string,
  fragmentId: string,
  atBars: number,
  resultIds: readonly [string, string] = [id(), id()]
): ShapeDraft {
  return updateLane(draft, laneId, (lane) => {
    const index = lane.fragments.findIndex((fragment) => fragment.id === fragmentId)
    if (index === -1) return lane
    const fragment = lane.fragments[index]
    const destEnd = fragment.destStartBars + fragment.sourceEndBars - fragment.sourceStartBars
    if (atBars <= fragment.destStartBars + EPS || atBars >= destEnd - EPS) return lane
    const sourceCut = fragment.sourceStartBars + (atBars - fragment.destStartBars)
    const fragments = [...lane.fragments]
    fragments.splice(
      index,
      1,
      { ...fragment, id: resultIds[0], sourceEndBars: sourceCut },
      {
        ...fragment,
        id: resultIds[1],
        sourceStartBars: sourceCut,
        destStartBars: atBars
      }
    )
    return { ...lane, fragments: sortFragments(fragments) }
  })
}

/** Cuts a time selection out as its own clip while preserving the exact
 * source/destination mapping. Both boundary cuts are folded into one undo
 * checkpoint, matching a single arrangement gesture. */
export function isolateShapeFragmentRange(
  draft: ShapeDraft,
  laneId: string,
  fragmentId: string,
  rangeStartBars: number,
  rangeEndBars: number,
  resultIds: readonly [string, string, string] = [id(), id(), id()]
): { draft: ShapeDraft; fragmentId: string } {
  const lane = draft.lanes.find((candidate) => candidate.id === laneId)
  const fragment = lane?.fragments.find((candidate) => candidate.id === fragmentId)
  if (!fragment) return { draft, fragmentId }

  const clipStart = fragment.destStartBars
  const clipEnd = clipStart + fragment.sourceEndBars - fragment.sourceStartBars
  const start = Math.max(clipStart, Math.min(rangeStartBars, rangeEndBars))
  const end = Math.min(clipEnd, Math.max(rangeStartBars, rangeEndBars))
  if (end <= start + EPS) return { draft, fragmentId }

  let next = draft
  let isolatedId = fragmentId
  if (start > clipStart + EPS) {
    next = splitShapeFragment(next, laneId, isolatedId, start, [resultIds[0], resultIds[1]])
    isolatedId = resultIds[1]
  }
  if (end < clipEnd - EPS) {
    next = splitShapeFragment(next, laneId, isolatedId, end, [isolatedId, resultIds[2]])
  }
  return { draft: groupShapeEdits(draft, next), fragmentId: isolatedId }
}

/** Removes only the selected time region, leaving the clips on either side
 * in place and treating the entire gesture as one undoable edit. */
export function removeShapeFragmentRange(
  draft: ShapeDraft,
  laneId: string,
  fragmentId: string,
  rangeStartBars: number,
  rangeEndBars: number,
  resultIds: readonly [string, string, string] = [id(), id(), id()]
): ShapeDraft {
  const isolated = isolateShapeFragmentRange(
    draft,
    laneId,
    fragmentId,
    rangeStartBars,
    rangeEndBars,
    resultIds
  )
  if (isolated.draft === draft && isolated.fragmentId === fragmentId) {
    const lane = draft.lanes.find((candidate) => candidate.id === laneId)
    const fragment = lane?.fragments.find((candidate) => candidate.id === fragmentId)
    if (!fragment) return draft
    const clipEnd = fragment.destStartBars + fragment.sourceEndBars - fragment.sourceStartBars
    const start = Math.max(fragment.destStartBars, Math.min(rangeStartBars, rangeEndBars))
    const end = Math.min(clipEnd, Math.max(rangeStartBars, rangeEndBars))
    if (end <= start + EPS) return draft
  }
  return groupShapeEdits(
    draft,
    removeShapeFragments(isolated.draft, new Set([isolated.fragmentId]))
  )
}

export function reverseShapeFragments(
  draft: ShapeDraft,
  fragmentIds: ReadonlySet<string>
): ShapeDraft {
  if (fragmentIds.size === 0) return draft
  return commit(
    draft,
    draft.lanes.map((lane) => ({
      ...cloneLane(lane),
      fragments: lane.fragments.map((fragment) =>
        fragmentIds.has(fragment.id) ? { ...fragment, reversed: !fragment.reversed } : fragment
      )
    }))
  )
}

export function addShapeLane(
  draft: ShapeDraft,
  source: ShapeSourceStem,
  gain = 1,
  laneId = id(),
  fragmentId = id()
): ShapeDraft {
  return commit(draft, [
    ...cloneLanes(draft.lanes),
    {
      id: laneId,
      source: cloneSource(source),
      gain: Math.max(0, Math.min(1, gain)),
      fragments: [identityFragment(draft.loopBars, fragmentId)]
    }
  ])
}

export function replaceShapeLaneSource(
  draft: ShapeDraft,
  laneId: string,
  source: ShapeSourceStem
): ShapeDraft {
  return updateLane(draft, laneId, (lane) => ({ ...lane, source: cloneSource(source) }))
}

/** Live gain movement without one undo frame per pointer movement. */
export function previewShapeLaneGain(draft: ShapeDraft, laneId: string, gain: number): ShapeDraft {
  const clamped = Math.max(0, Math.min(1, gain))
  const lane = draft.lanes.find((candidate) => candidate.id === laneId)
  if (!lane || lane.gain === clamped) return draft
  return {
    ...draft,
    lanes: draft.lanes.map((candidate) =>
      candidate.id === laneId ? { ...cloneLane(candidate), gain: clamped } : cloneLane(candidate)
    ),
    revision: draft.revision + 1
  }
}

/** Adds the one undo checkpoint after a live gain gesture finishes. */
export function finishShapeLaneGain(
  draft: ShapeDraft,
  laneId: string,
  startingGain: number
): ShapeDraft {
  const lane = draft.lanes.find((candidate) => candidate.id === laneId)
  const clampedStart = Math.max(0, Math.min(1, startingGain))
  if (!lane || lane.gain === clampedStart) return draft
  const before = cloneLanes(draft.lanes).map((candidate) =>
    candidate.id === laneId ? { ...candidate, gain: clampedStart } : candidate
  )
  return {
    ...draft,
    past: [...draft.past, { lanes: before }],
    future: [],
    revision: draft.revision + 1
  }
}

function trimForOverwrite(
  fragments: readonly ShapeFragmentRecipe[],
  start: number,
  end: number
): ShapeFragmentRecipe[] {
  const result: ShapeFragmentRecipe[] = []
  for (const fragment of fragments) {
    const fragmentStart = fragment.destStartBars
    const fragmentEnd = fragmentStart + fragment.sourceEndBars - fragment.sourceStartBars
    if (fragmentEnd <= start + EPS || fragmentStart >= end - EPS) {
      result.push(cloneFragment(fragment))
      continue
    }
    const hasLeft = fragmentStart < start - EPS
    const hasRight = fragmentEnd > end + EPS
    if (hasLeft) {
      result.push({
        ...fragment,
        sourceEndBars: fragment.sourceStartBars + (start - fragmentStart)
      })
    }
    if (hasRight) {
      result.push({
        ...fragment,
        id: hasLeft ? id() : fragment.id,
        sourceStartBars: fragment.sourceStartBars + (end - fragmentStart),
        destStartBars: end
      })
    }
  }
  return result
}

/** Trims or reveals one side of a Shape clip without stretching its audio.
 * The opposite arrangement edge stays fixed and the source boundary moves
 * by the same musical distance. Reversed clips mirror which source boundary
 * belongs to each visible edge. Expanding across another clip uses the same
 * overwrite semantics as moving a clip in Ableton's Arrangement. */
export function resizeShapeFragment(
  draft: ShapeDraft,
  laneId: string,
  fragmentId: string,
  edge: 'left' | 'right',
  edgeBars: number
): ShapeDraft {
  if (!Number.isFinite(edgeBars)) return draft
  return updateLane(draft, laneId, (lane) => {
    const fragment = lane.fragments.find((candidate) => candidate.id === fragmentId)
    if (!fragment) return lane

    const oldStart = fragment.destStartBars
    const oldEnd = oldStart + fragment.sourceEndBars - fragment.sourceStartBars
    let start = oldStart
    let end = oldEnd
    let sourceStart = fragment.sourceStartBars
    let sourceEnd = fragment.sourceEndBars

    if (edge === 'left') {
      const availableBefore = fragment.reversed
        ? draft.loopBars - fragment.sourceEndBars
        : fragment.sourceStartBars
      start = Math.max(0, Math.min(oldEnd - EPS, Math.max(oldStart - availableBefore, edgeBars)))
      const delta = start - oldStart
      if (fragment.reversed) sourceEnd -= delta
      else sourceStart += delta
    } else {
      const availableAfter = fragment.reversed
        ? fragment.sourceStartBars
        : draft.loopBars - fragment.sourceEndBars
      end = Math.min(
        draft.loopBars,
        Math.max(oldStart + EPS, Math.min(oldEnd + availableAfter, edgeBars))
      )
      const delta = end - oldEnd
      if (fragment.reversed) sourceStart -= delta
      else sourceEnd += delta
    }

    if (Math.abs(start - oldStart) <= EPS && Math.abs(end - oldEnd) <= EPS) return lane
    if (sourceStart < -EPS || sourceEnd > draft.loopBars + EPS || sourceEnd <= sourceStart + EPS)
      return lane

    const resized: ShapeFragmentRecipe = {
      ...fragment,
      sourceStartBars: Math.max(0, sourceStart),
      sourceEndBars: Math.min(draft.loopBars, sourceEnd),
      destStartBars: start
    }
    const withoutSource = lane.fragments.filter((candidate) => candidate.id !== fragmentId)
    return {
      ...lane,
      fragments: sortFragments([...trimForOverwrite(withoutSource, start, end), resized])
    }
  })
}

function placeShapeFragment(
  draft: ShapeDraft,
  laneId: string,
  fragmentId: string,
  destStartBars: number,
  copy: boolean,
  copyId?: string
): ShapeDraft {
  if (!Number.isFinite(destStartBars) || destStartBars < 0) return draft
  return updateLane(draft, laneId, (lane) => {
    const source = lane.fragments.find((fragment) => fragment.id === fragmentId)
    if (!source) return lane
    const length = source.sourceEndBars - source.sourceStartBars
    const destEnd = destStartBars + length
    if (!(length > EPS) || destEnd > draft.loopBars + EPS) return lane
    const withoutSource = copy
      ? lane.fragments
      : lane.fragments.filter((fragment) => fragment.id !== fragmentId)
    const inserted: ShapeFragmentRecipe = {
      ...source,
      id: copy ? (copyId ?? id()) : source.id,
      destStartBars
    }
    return {
      ...lane,
      fragments: sortFragments([
        ...trimForOverwrite(withoutSource, destStartBars, destEnd),
        inserted
      ])
    }
  })
}

export function copyShapeFragment(
  draft: ShapeDraft,
  laneId: string,
  fragmentId: string,
  destStartBars: number,
  copyId = id()
): ShapeDraft {
  return placeShapeFragment(draft, laneId, fragmentId, destStartBars, true, copyId)
}

export function moveShapeFragment(
  draft: ShapeDraft,
  laneId: string,
  fragmentId: string,
  destStartBars: number
): ShapeDraft {
  return placeShapeFragment(draft, laneId, fragmentId, destStartBars, false)
}

export function duplicateShapeFragment(
  draft: ShapeDraft,
  laneId: string,
  fragmentId: string,
  copyId = id()
): ShapeDraft {
  const lane = draft.lanes.find((candidate) => candidate.id === laneId)
  const fragment = lane?.fragments.find((candidate) => candidate.id === fragmentId)
  if (!fragment) return draft
  const length = fragment.sourceEndBars - fragment.sourceStartBars
  const destination = fragment.destStartBars + length
  if (destination + length > draft.loopBars + EPS) return draft
  return copyShapeFragment(draft, laneId, fragmentId, destination, copyId)
}

export function toggleShapeFragmentsDisabled(
  draft: ShapeDraft,
  fragmentIds: ReadonlySet<string>
): ShapeDraft {
  const lanes = draft.lanes.map((lane) => ({
    ...cloneLane(lane),
    fragments: lane.fragments.map((fragment) =>
      fragmentIds.has(fragment.id) ? { ...fragment, disabled: !fragment.disabled } : { ...fragment }
    )
  }))
  return commit(draft, lanes)
}

export function removeShapeFragments(
  draft: ShapeDraft,
  fragmentIds: ReadonlySet<string>
): ShapeDraft {
  return commit(
    draft,
    draft.lanes.map((lane) => ({
      ...cloneLane(lane),
      fragments: lane.fragments.filter((fragment) => !fragmentIds.has(fragment.id))
    }))
  )
}

export function resetShapeLane(draft: ShapeDraft, laneId: string, fragmentId = id()): ShapeDraft {
  return updateLane(draft, laneId, (lane) => ({
    ...lane,
    fragments: [identityFragment(draft.loopBars, fragmentId)]
  }))
}

export function resetShapeRiff(draft: ShapeDraft): ShapeDraft {
  return commit(
    draft,
    draft.lanes.map((lane) => ({
      ...cloneLane(lane),
      fragments: [identityFragment(draft.loopBars)]
    }))
  )
}

export function undoShape(draft: ShapeDraft): ShapeDraft {
  const previous = draft.past[draft.past.length - 1]
  if (!previous) return draft
  return {
    ...draft,
    lanes: cloneLanes(previous.lanes),
    past: draft.past.slice(0, -1),
    future: [snapshot(draft), ...draft.future],
    revision: draft.revision + 1
  }
}

export function redoShape(draft: ShapeDraft): ShapeDraft {
  const next = draft.future[0]
  if (!next) return draft
  return {
    ...draft,
    lanes: cloneLanes(next.lanes),
    past: [...draft.past, snapshot(draft)],
    future: draft.future.slice(1),
    revision: draft.revision + 1
  }
}

/** Collapses several pure fragment operations from one user gesture into a
 * single undo checkpoint. The intermediate drafts are never exposed. */
export function groupShapeEdits(before: ShapeDraft, after: ShapeDraft): ShapeDraft {
  if (sameLanes(before.lanes, after.lanes)) return before
  return {
    ...after,
    past: [...before.past, snapshot(before)],
    future: [],
    revision: before.revision + 1
  }
}

export function shapeRenderSegments(lane: ShapeLane): ShapeRenderSegment[] {
  const audible = sortFragments(
    lane.fragments.filter((fragment) => !fragment.disabled).map(cloneFragment)
  )
  const result: ShapeRenderSegment[] = []
  for (const fragment of audible) {
    const segment: ShapeRenderSegment = {
      sourceStartBars: fragment.sourceStartBars,
      sourceEndBars: fragment.sourceEndBars,
      destStartBars: fragment.destStartBars,
      ...(fragment.reversed ? { reversed: true } : {})
    }
    const previous = result[result.length - 1]
    const previousDestEnd = previous
      ? previous.destStartBars + previous.sourceEndBars - previous.sourceStartBars
      : Number.NaN
    if (
      previous &&
      !previous.reversed &&
      !segment.reversed &&
      Math.abs(previousDestEnd - segment.destStartBars) <= EPS &&
      Math.abs(previous.sourceEndBars - segment.sourceStartBars) <= EPS
    ) {
      previous.sourceEndBars = segment.sourceEndBars
    } else {
      result.push(segment)
    }
  }
  return result
}

export function assembleShapeRifff(
  draft: ShapeDraft,
  results: readonly ShapeRenderResult[],
  groupId = id()
): ShapeAssembly {
  if (results.length !== draft.lanes.length) {
    throw new Error('Shape materialization did not return every lane.')
  }
  const stems: Stem[] = draft.lanes.map((lane, index) => {
    const result = results[index]
    return {
      ...cloneSource(lane.source),
      slot: index + 1,
      path: result.path,
      durationSec: result.durationSec,
      barLength: draft.loopBars,
      phaseSourcePath: result.path,
      phaseBars: 0,
      oneShot: undefined,
      trimStartSec: undefined,
      trimEndSec: undefined,
      shape: {
        version: 1,
        source: cloneSource(lane.source),
        loopBars: draft.loopBars,
        // Retained in v1 provenance so older builds can still parse the
        // recipe, but new Shape edits express durable silence on clips.
        laneDisabled: false,
        gain: lane.gain,
        fragments: lane.fragments.map(cloneFragment)
      }
    }
  })
  const rifff: Rifff = {
    groupId,
    phaseLinkId: groupId,
    name: `shape: ${draft.sourceName}`,
    bpm: draft.targetBpm,
    barLength: draft.loopBars,
    folderPath: '',
    stems
  }
  const vol: Record<string, number> = {}
  draft.lanes.forEach((lane, index) => {
    vol[stemKey(groupId, index + 1)] = lane.gain
  })
  return { rifff, vol }
}
