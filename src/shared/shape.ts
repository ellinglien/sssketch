import {
  stemKey,
  type Rifff,
  type ShapeBakedClipSource,
  type ShapeClipTransformV1,
  type ShapeClipProcessV1,
  type ShapeFragmentRecipe,
  type ShapeSourceStem,
  type Stem
} from './types'

export interface ShapeLane {
  id: string
  source: ShapeSourceStem
  gain: number
  rotationBars?: number
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
  /** Duration-preserving pitch shift applied before lane assembly. */
  pitchSemitones?: number
  /** Independent spectral-envelope shift. */
  formantSemitones?: number
  /** Tape/tracker playback-rate multiple. Changes duration and pitch together. */
  rate?: number
  /** Raw keeps nearest-neighbour resampling artifacts in the prepared source. */
  character?: 'raw'
  process?: ShapeClipProcessV1
  bakedBase?: ShapeBakedClipSource
}

export interface ShapeBakeProcessItem {
  fragmentId: string
  source: ShapeBakedClipSource
  process: ShapeClipProcessV1
}

export interface ShapeBakeProcessRequest {
  jobId: string
  items: ShapeBakeProcessItem[]
}

export interface ShapeBakeProcessResult {
  jobId: string
  bases: Array<{ fragmentId: string; source: ShapeBakedClipSource }>
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

function fingerprintLanes(draft: ShapeDraft, includeGain: boolean): string {
  return JSON.stringify({
    targetBpm: draft.targetBpm,
    loopBars: draft.loopBars,
    lanes: draft.lanes.map((lane) => ({
      source: lane.source,
      ...(includeGain ? { gain: lane.gain } : {}),
      fragments: lane.fragments
        .map((fragment) => ({
          sourceStartBars: fragment.sourceStartBars,
          sourceEndBars: fragment.sourceEndBars,
          destStartBars: fragment.destStartBars,
          disabled: fragment.disabled,
          reversed: Boolean(fragment.reversed),
          transform: shapeClipTransform(fragment)
        }))
        .sort((a, b) => a.destStartBars - b.destStartBars)
    }))
  })
}

/** Musical/edit content only: excludes session ids and undo bookkeeping. */
export function shapeContentFingerprint(draft: ShapeDraft): string {
  return fingerprintLanes(draft, true)
}

/** Audio-file content only: lane gain is applied at playback, not baked. */
export function shapeRenderFingerprint(draft: ShapeDraft): string {
  return fingerprintLanes(draft, false)
}

export function shapeWaveformLayout(
  sourceStartBars: number,
  sourceBarLength: number,
  fragmentLengthBars: number,
  rate = 1
): { tileWidthPct: number; maskOffsetPct: number } {
  const phaseBars = ((sourceStartBars % sourceBarLength) + sourceBarLength) % sourceBarLength
  const safeRate = Number.isFinite(rate) && rate > 0 ? rate : 1
  return {
    tileWidthPct: (sourceBarLength / safeRate / fragmentLengthBars) * 100,
    maskOffsetPct: -(phaseBars / safeRate / fragmentLengthBars) * 100
  }
}

const EPS = 1e-9

function id(): string {
  return crypto.randomUUID()
}

function cloneFragment(fragment: ShapeFragmentRecipe): ShapeFragmentRecipe {
  return {
    ...fragment,
    ...(fragment.transform
      ? {
          transform: {
            ...fragment.transform,
            ...(fragment.transform.process ? { process: { ...fragment.transform.process } } : {}),
            ...(fragment.transform.bakedBase
              ? { bakedBase: { ...fragment.transform.bakedBase } }
              : {})
          }
        }
      : {})
  }
}

export const DEFAULT_SHAPE_CLIP_TRANSFORM: ShapeClipTransformV1 = {
  pitchSemitones: 0,
  detuneCents: 0,
  formantSemitones: 0,
  rate: 1,
  character: 'smooth'
}

export const SHAPE_PITCH_SEMITONE_LIMIT = 512

export function normalizeShapeClipProcess(
  process: ShapeClipProcessV1 | undefined
): ShapeClipProcessV1 | undefined {
  if (!process) return undefined
  const mix = Number.isFinite(process.mix) ? Math.max(0, Math.min(1, process.mix)) : 1
  switch (process.type) {
    case 'wavefold':
      return {
        type: process.type,
        drive: Number.isFinite(process.drive) ? Math.max(1, Math.min(16, process.drive)) : 2,
        bias: Number.isFinite(process.bias) ? Math.max(-1, Math.min(1, process.bias)) : 0,
        mix
      }
    case 'saturation':
      return {
        type: process.type,
        drive: Number.isFinite(process.drive) ? Math.max(1, Math.min(16, process.drive)) : 9,
        bias: Number.isFinite(process.bias) ? Math.max(-1, Math.min(1, process.bias)) : 0,
        outputDb: Number.isFinite(process.outputDb)
          ? Math.max(-24, Math.min(24, process.outputDb))
          : 0,
        mix
      }
    case 'hard-clip':
      return {
        type: process.type,
        threshold: Number.isFinite(process.threshold)
          ? Math.max(0.05, Math.min(1, process.threshold))
          : 0.5,
        symmetry: Number.isFinite(process.symmetry)
          ? Math.max(-1, Math.min(1, process.symmetry))
          : 0,
        mix
      }
    case 'rectify':
      return {
        type: process.type,
        mode: process.mode === 'half' ? 'half' : 'full',
        drive: Number.isFinite(process.drive) ? Math.max(1, Math.min(8, process.drive)) : 1,
        mix
      }
    case 'bit-crush':
      return {
        type: process.type,
        bits: Number.isFinite(process.bits)
          ? Math.max(2, Math.min(16, Math.round(process.bits)))
          : 8,
        dither: Number.isFinite(process.dither) ? Math.max(0, Math.min(1, process.dither)) : 0,
        mix
      }
    case 'rate-crush':
      return {
        type: process.type,
        factor: Number.isFinite(process.factor)
          ? Math.max(1, Math.min(64, Math.round(process.factor)))
          : 8,
        jitter: Number.isFinite(process.jitter) ? Math.max(0, Math.min(1, process.jitter)) : 0,
        mix
      }
    case 'ring-mod':
      return {
        type: process.type,
        frequencyHz: Number.isFinite(process.frequencyHz)
          ? Math.max(1, Math.min(2000, process.frequencyHz))
          : 100,
        shape: Number.isFinite(process.shape) ? Math.max(0, Math.min(1, process.shape)) : 0,
        mix
      }
    case 'comb':
      return {
        type: process.type,
        delayMs: Number.isFinite(process.delayMs) ? Math.max(1, Math.min(50, process.delayMs)) : 12,
        feedback: Number.isFinite(process.feedback)
          ? Math.max(-0.95, Math.min(0.95, process.feedback))
          : 0.5,
        damping: Number.isFinite(process.damping) ? Math.max(0, Math.min(1, process.damping)) : 0.5,
        mix
      }
    case 'smear':
      return {
        type: process.type,
        timeMs: Number.isFinite(process.timeMs) ? Math.max(5, Math.min(250, process.timeMs)) : 80,
        scatter: Number.isFinite(process.scatter) ? Math.max(0, Math.min(1, process.scatter)) : 0.5,
        mix
      }
    case 'compand':
      return {
        type: process.type,
        drive: Number.isFinite(process.drive) ? Math.max(1, Math.min(64, process.drive)) : 12,
        compand: Number.isFinite(process.compand)
          ? Math.max(0, Math.min(1, process.compand))
          : 0.75,
        symmetry: Number.isFinite(process.symmetry)
          ? Math.max(-1, Math.min(1, process.symmetry))
          : 0,
        outputDb: Number.isFinite(process.outputDb)
          ? Math.max(-36, Math.min(24, process.outputDb))
          : -6,
        mix
      }
    case 'codec-damage':
      return {
        type: process.type,
        quality: Number.isFinite(process.quality)
          ? Math.max(1, Math.min(100, process.quality))
          : 35,
        loss: Number.isFinite(process.loss) ? Math.max(0, Math.min(1, process.loss)) : 0.15,
        packetMs: Number.isFinite(process.packetMs)
          ? Math.max(1, Math.min(250, process.packetMs))
          : 24,
        bandwidthHz: Number.isFinite(process.bandwidthHz)
          ? Math.max(200, Math.min(24000, process.bandwidthHz))
          : 8000,
        mix
      }
    case 'short-room':
      return {
        type: process.type,
        sizeMs: Number.isFinite(process.sizeMs) ? Math.max(1, Math.min(250, process.sizeMs)) : 28,
        decay: Number.isFinite(process.decay)
          ? Math.max(-0.98, Math.min(0.98, process.decay))
          : 0.55,
        damping: Number.isFinite(process.damping)
          ? Math.max(0, Math.min(1, process.damping))
          : 0.45,
        width: Number.isFinite(process.width) ? Math.max(0, Math.min(2, process.width)) : 1,
        mix
      }
    case 'frequency-shift':
      return {
        type: process.type,
        shiftHz: Number.isFinite(process.shiftHz)
          ? Math.max(-12000, Math.min(12000, process.shiftHz))
          : 35,
        feedback: Number.isFinite(process.feedback)
          ? Math.max(-0.95, Math.min(0.95, process.feedback))
          : 0,
        stereo: Number.isFinite(process.stereo) ? Math.max(0, Math.min(2, process.stereo)) : 0,
        mix
      }
    case 'chorus':
      return {
        type: process.type,
        rateHz: Number.isFinite(process.rateHz)
          ? Math.max(0.05, Math.min(20, process.rateHz))
          : 0.8,
        depthMs: Number.isFinite(process.depthMs) ? Math.max(0, Math.min(50, process.depthMs)) : 4,
        delayMs: Number.isFinite(process.delayMs)
          ? Math.max(0.1, Math.min(50, process.delayMs))
          : 7,
        feedback: Number.isFinite(process.feedback)
          ? Math.max(-0.95, Math.min(0.95, process.feedback))
          : 0.15,
        stereo: Number.isFinite(process.stereo) ? Math.max(0, Math.min(2, process.stereo)) : 1,
        mix
      }
    case 'dj-eq':
      return {
        type: process.type,
        lowDb: Number.isFinite(process.lowDb) ? Math.max(-72, Math.min(24, process.lowDb)) : 0,
        midDb: Number.isFinite(process.midDb) ? Math.max(-72, Math.min(24, process.midDb)) : 0,
        highDb: Number.isFinite(process.highDb) ? Math.max(-72, Math.min(24, process.highDb)) : 0,
        mix
      }
    case 'tone':
      return {
        type: process.type,
        cutoffHz: Number.isFinite(process.cutoffHz)
          ? Math.max(20, Math.min(20000, process.cutoffHz))
          : 12000,
        resonance: Number.isFinite(process.resonance)
          ? Math.max(0, Math.min(0.99, process.resonance))
          : 0.15,
        drive: Number.isFinite(process.drive) ? Math.max(1, Math.min(32, process.drive)) : 1,
        mix
      }
  }
}

export function shapeClipTransform(fragment: ShapeFragmentRecipe): ShapeClipTransformV1 {
  const transform = fragment.transform
  const normalizedProcess = normalizeShapeClipProcess(transform?.process)
  return transform
    ? {
        pitchSemitones: Number.isFinite(transform.pitchSemitones)
          ? Math.max(
              -SHAPE_PITCH_SEMITONE_LIMIT,
              Math.min(SHAPE_PITCH_SEMITONE_LIMIT, transform.pitchSemitones)
            )
          : 0,
        detuneCents: Number.isFinite(transform.detuneCents)
          ? Math.max(-50, Math.min(50, transform.detuneCents))
          : 0,
        formantSemitones: Number.isFinite(transform.formantSemitones)
          ? Math.max(-12, Math.min(12, transform.formantSemitones))
          : 0,
        rate: Number.isFinite(transform.rate) ? Math.max(0.25, Math.min(4, transform.rate)) : 1,
        ...(Number.isFinite(transform.rateSourceStartBars) &&
        Number.isFinite(transform.rateSourceEndBars)
          ? {
              rateSourceStartBars: transform.rateSourceStartBars,
              rateSourceEndBars: transform.rateSourceEndBars
            }
          : {}),
        character: transform.character === 'raw' ? 'raw' : 'smooth',
        ...(normalizedProcess ? { process: normalizedProcess } : {}),
        ...(transform.bakedBase?.path &&
        Number.isFinite(transform.bakedBase.durationSec) &&
        transform.bakedBase.durationSec > 0 &&
        Number.isFinite(transform.bakedBase.barLength) &&
        transform.bakedBase.barLength > 0
          ? { bakedBase: { ...transform.bakedBase } }
          : {})
      }
    : { ...DEFAULT_SHAPE_CLIP_TRANSFORM }
}

export function shapeFragmentRate(fragment: ShapeFragmentRecipe): number {
  return shapeClipTransform(fragment).rate
}

export function shapeFragmentLengthBars(fragment: ShapeFragmentRecipe): number {
  return (fragment.sourceEndBars - fragment.sourceStartBars) / shapeFragmentRate(fragment)
}

export function shapeFragmentEndBars(fragment: ShapeFragmentRecipe): number {
  return fragment.destStartBars + shapeFragmentLengthBars(fragment)
}

export function shapeClipPitchSemitones(fragment: ShapeFragmentRecipe): number {
  const transform = shapeClipTransform(fragment)
  return transform.pitchSemitones + transform.detuneCents / 100
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
    disabled: false,
    transform: {
      ...DEFAULT_SHAPE_CLIP_TRANSFORM,
      character: 'raw'
    }
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
    throw new Error("EEEDIT can't edit one-shot or trimmed stems yet.")
  }
  const groupGain = vol[rifff.groupId] ?? 1
  const lanes = rifff.stems.map((stem): ShapeLane => {
    // A shaped stem can later be placed into a longer Cross riff, where its
    // already-rendered audio repeats normally. Its old edit recipe was
    // authored in a different destination coordinate space, though; using
    // it unchanged would render silence after the old endpoint. Treat that
    // audio as a fresh immutable baseline instead.
    const provenance =
      (stem.shape?.version === 1 || stem.shape?.version === 2) &&
      Math.abs(stem.shape.loopBars - rifff.barLength) <= EPS
        ? stem.shape
        : undefined
    const savedGain = vol[stemKey(rifff.groupId, stem.slot)]
    // Older Shape riffs could disable a whole lane. Shape now has one
    // durable-disable concept only -- clips -- so migrate that legacy bit
    // onto every clip as the draft opens. Its remembered gain still wins
    // over the ordinary playback zero written by the older format.
    const gain =
      provenance?.version === 1 && provenance.laneDisabled
        ? provenance.gain
        : (savedGain ?? provenance?.gain ?? groupGain)
    return {
      id: id(),
      source: provenance ? cloneSource(provenance.source) : sourceFromStem(stem),
      gain: Math.max(0, Math.min(1, gain)),
      rotationBars:
        provenance?.version === 2 && Number.isFinite(provenance.rotationBars)
          ? provenance.rotationBars
          : 0,
      fragments: provenance
        ? provenance.fragments.map((fragment) => ({
            ...cloneFragment(fragment),
            disabled: provenance.version === 1 && provenance.laneDisabled ? true : fragment.disabled
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

/** Returns the portion of a clip audible in one retained destination range.
 * Reversed clips map destination time from the opposite source edge, so all
 * split/crop operations must go through this helper instead of applying the
 * ordinary forward offset formula independently. */
function sliceShapeFragment(
  fragment: ShapeFragmentRecipe,
  destStartBars: number,
  destEndBars: number,
  fragmentId = fragment.id
): ShapeFragmentRecipe {
  const rate = shapeFragmentRate(fragment)
  const offsetStart = (destStartBars - fragment.destStartBars) * rate
  const offsetEnd = (destEndBars - fragment.destStartBars) * rate
  const sliced = fragment.reversed
    ? {
        ...fragment,
        id: fragmentId,
        sourceStartBars: fragment.sourceEndBars - offsetEnd,
        sourceEndBars: fragment.sourceEndBars - offsetStart,
        destStartBars
      }
    : {
        ...fragment,
        id: fragmentId,
        sourceStartBars: fragment.sourceStartBars + offsetStart,
        sourceEndBars: fragment.sourceStartBars + offsetEnd,
        destStartBars
      }
  if (sliced.transform?.rateSourceStartBars !== undefined) {
    const transform = { ...sliced.transform }
    delete transform.rateSourceStartBars
    delete transform.rateSourceEndBars
    sliced.transform = transform
  }
  return sliced
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
    const destEnd = shapeFragmentEndBars(fragment)
    if (atBars <= fragment.destStartBars + EPS || atBars >= destEnd - EPS) return lane
    const fragments = [...lane.fragments]
    fragments.splice(
      index,
      1,
      sliceShapeFragment(fragment, fragment.destStartBars, atBars, resultIds[0]),
      sliceShapeFragment(fragment, atBars, destEnd, resultIds[1])
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
  const clipEnd = shapeFragmentEndBars(fragment)
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
    const clipEnd = shapeFragmentEndBars(fragment)
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

/** Applies absolute transform values to the selected clips as one recipe
 * edit. Neutral values are omitted so v1-style clips stay compact. */
export function setShapeFragmentTransform(
  draft: ShapeDraft,
  fragmentIds: ReadonlySet<string>,
  values: Pick<ShapeClipTransformV1, 'pitchSemitones' | 'detuneCents'>
): ShapeDraft {
  if (fragmentIds.size === 0) return draft
  return commit(
    draft,
    draft.lanes.map((lane) => ({
      ...cloneLane(lane),
      fragments: lane.fragments.map((fragment) => {
        if (!fragmentIds.has(fragment.id)) return fragment
        const current = shapeClipTransform(fragment)
        const transform: ShapeClipTransformV1 = {
          pitchSemitones: Math.max(
            -SHAPE_PITCH_SEMITONE_LIMIT,
            Math.min(SHAPE_PITCH_SEMITONE_LIMIT, Math.round(values.pitchSemitones))
          ),
          detuneCents: Math.max(-50, Math.min(50, Math.round(values.detuneCents))),
          formantSemitones: current.formantSemitones,
          rate: current.rate,
          ...(current.rateSourceStartBars !== undefined
            ? {
                rateSourceStartBars: current.rateSourceStartBars,
                rateSourceEndBars: current.rateSourceEndBars
              }
            : {}),
          character: current.character,
          ...(current.process ? { process: { ...current.process } } : {}),
          ...(current.bakedBase ? { bakedBase: { ...current.bakedBase } } : {})
        }
        const neutral =
          transform.pitchSemitones === 0 &&
          transform.detuneCents === 0 &&
          transform.formantSemitones === 0 &&
          transform.rate === 1 &&
          transform.character === 'smooth' &&
          !transform.process &&
          !transform.bakedBase
        return { ...fragment, transform: neutral ? undefined : transform }
      })
    }))
  )
}

/** Changes tape/tracker rate in place. Slower clips grow to the right and
 * overwrite anything beneath their new extent. At the riff boundary the
 * source range is cropped, while the underlying source file stays untouched. */
export function setShapeFragmentRate(
  draft: ShapeDraft,
  fragmentIds: ReadonlySet<string>,
  value: number
): ShapeDraft {
  if (fragmentIds.size === 0 || !Number.isFinite(value)) return draft
  const rate = Math.max(0.25, Math.min(4, value))
  const lanes = draft.lanes.map((sourceLane) => {
    let fragments = sourceLane.fragments.map(cloneFragment)
    const targets = fragments
      .filter((fragment) => fragmentIds.has(fragment.id))
      .sort((a, b) => a.destStartBars - b.destStartBars)
    for (const original of targets) {
      const current = fragments.find((fragment) => fragment.id === original.id)
      if (!current) continue
      const currentTransform = shapeClipTransform(current)
      const baselineStart = currentTransform.rateSourceStartBars ?? current.sourceStartBars
      const baselineEnd = currentTransform.rateSourceEndBars ?? current.sourceEndBars
      const availableDest = Math.max(0, draft.loopBars - current.destStartBars)
      const desiredSourceLength = baselineEnd - baselineStart
      const retainedSourceLength = Math.min(desiredSourceLength, availableDest * rate)
      if (retainedSourceLength <= EPS) continue
      const transform: ShapeClipTransformV1 = {
        ...currentTransform,
        rate,
        ...(rate === 1
          ? { rateSourceStartBars: undefined, rateSourceEndBars: undefined }
          : { rateSourceStartBars: baselineStart, rateSourceEndBars: baselineEnd }),
        character: currentTransform.character
      }
      const neutral =
        transform.pitchSemitones === 0 &&
        transform.detuneCents === 0 &&
        transform.formantSemitones === 0 &&
        transform.rate === 1 &&
        transform.character === 'smooth' &&
        !transform.process &&
        !transform.bakedBase
      const updated: ShapeFragmentRecipe = {
        ...current,
        sourceStartBars: current.reversed ? baselineEnd - retainedSourceLength : baselineStart,
        sourceEndBars: current.reversed ? baselineEnd : baselineStart + retainedSourceLength,
        transform: neutral ? undefined : transform
      }
      const end = shapeFragmentEndBars(updated)
      fragments = sortFragments([
        ...trimForOverwrite(
          fragments.filter((fragment) => fragment.id !== current.id),
          updated.destStartBars,
          end
        ),
        updated
      ])
    }
    return { ...sourceLane, fragments }
  })
  return commit(draft, lanes)
}

export function setShapeFragmentCharacter(
  draft: ShapeDraft,
  fragmentIds: ReadonlySet<string>,
  character: ShapeClipTransformV1['character']
): ShapeDraft {
  if (fragmentIds.size === 0) return draft
  return commit(
    draft,
    draft.lanes.map((lane) => ({
      ...cloneLane(lane),
      fragments: lane.fragments.map((fragment) => {
        if (!fragmentIds.has(fragment.id)) return fragment
        const transform: ShapeClipTransformV1 = {
          ...shapeClipTransform(fragment),
          character
        }
        const neutral =
          transform.pitchSemitones === 0 &&
          transform.detuneCents === 0 &&
          transform.formantSemitones === 0 &&
          transform.rate === 1 &&
          transform.character === 'smooth' &&
          !transform.process &&
          !transform.bakedBase
        return { ...fragment, transform: neutral ? undefined : transform }
      })
    }))
  )
}

export function setShapeFragmentFormant(
  draft: ShapeDraft,
  fragmentIds: ReadonlySet<string>,
  formantSemitones: number
): ShapeDraft {
  if (fragmentIds.size === 0 || !Number.isFinite(formantSemitones)) return draft
  return commit(
    draft,
    draft.lanes.map((lane) => ({
      ...cloneLane(lane),
      fragments: lane.fragments.map((fragment) => {
        if (!fragmentIds.has(fragment.id)) return fragment
        const transform: ShapeClipTransformV1 = {
          ...shapeClipTransform(fragment),
          formantSemitones: Math.max(-12, Math.min(12, Math.round(formantSemitones)))
        }
        const neutral =
          transform.pitchSemitones === 0 &&
          transform.detuneCents === 0 &&
          transform.formantSemitones === 0 &&
          transform.rate === 1 &&
          transform.character === 'smooth' &&
          !transform.process &&
          !transform.bakedBase
        return { ...fragment, transform: neutral ? undefined : transform }
      })
    }))
  )
}

export function setShapeFragmentProcess(
  draft: ShapeDraft,
  fragmentIds: ReadonlySet<string>,
  process: ShapeClipProcessV1 | undefined
): ShapeDraft {
  if (fragmentIds.size === 0) return draft
  return commit(
    draft,
    draft.lanes.map((lane) => ({
      ...cloneLane(lane),
      fragments: lane.fragments.map((fragment) => {
        if (!fragmentIds.has(fragment.id)) return fragment
        const normalized = normalizeShapeClipProcess(process)
        const transform: ShapeClipTransformV1 = {
          ...shapeClipTransform(fragment),
          ...(normalized ? { process: normalized } : { process: undefined })
        }
        const neutral =
          transform.pitchSemitones === 0 &&
          transform.detuneCents === 0 &&
          transform.formantSemitones === 0 &&
          transform.rate === 1 &&
          transform.character === 'smooth' &&
          !transform.process &&
          !transform.bakedBase
        return { ...fragment, transform: neutral ? undefined : transform }
      })
    }))
  )
}

/** Recovers an intervention audition that outlived its local UI session (for
 * example after closing Shape or a development remount). One-off processes
 * are never durable until Bake, so the exact pre-preview snapshot is restored
 * without adding another undo entry. */
export function discardOrphanedShapeProcessPreview(draft: ShapeDraft): ShapeDraft {
  const hasPreview = draft.lanes.some((lane) =>
    lane.fragments.some((fragment) => shapeClipTransform(fragment).process !== undefined)
  )
  if (!hasPreview) return draft

  const previous = draft.past[draft.past.length - 1]
  const previousHasProcess = previous?.lanes.some((lane) =>
    lane.fragments.some((fragment) => shapeClipTransform(fragment).process !== undefined)
  )
  if (previous && !previousHasProcess) {
    return {
      ...draft,
      lanes: cloneLanes(previous.lanes),
      past: draft.past.slice(0, -1),
      revision: draft.revision + 1
    }
  }

  const affected = new Set(
    draft.lanes.flatMap((lane) =>
      lane.fragments
        .filter((fragment) => shapeClipTransform(fragment).process !== undefined)
        .map((fragment) => fragment.id)
    )
  )
  const cleaned = setShapeFragmentProcess(draft, affected, undefined)
  return { ...cleaned, past: draft.past, future: draft.future }
}

/** Promotes completed one-off treatments to durable per-clip bases. Core
 * pitch/rate/character properties remain editable and the lane source stays
 * available as the immutable reset root. */
export function bakeShapeFragmentProcesses(
  draft: ShapeDraft,
  bakedBases: ReadonlyMap<string, ShapeBakedClipSource>
): ShapeDraft {
  if (bakedBases.size === 0) return draft
  return commit(
    draft,
    draft.lanes.map((lane) => ({
      ...cloneLane(lane),
      fragments: lane.fragments.map((fragment) => {
        const bakedBase = bakedBases.get(fragment.id)
        if (!bakedBase) return fragment
        const transform: ShapeClipTransformV1 = {
          ...shapeClipTransform(fragment),
          process: undefined,
          bakedBase: { ...bakedBase }
        }
        return { ...fragment, transform }
      })
    }))
  )
}

export interface AddedShapeProcessLanes {
  draft: ShapeDraft
  laneIds: string[]
  fragmentIds: string[]
}

/** Adds processed copies to new lanes while leaving the source lanes untouched.
 * Clips retain their musical placement and editable core transforms; only the
 * one-off intervention is promoted to the copied clip's durable baked base. */
export function addBakedShapeProcessLanes(
  before: ShapeDraft,
  processed: ShapeDraft,
  fragmentIds: ReadonlySet<string>,
  bakedBases: ReadonlyMap<string, ShapeBakedClipSource>,
  makeId: () => string = id
): AddedShapeProcessLanes {
  const laneIds: string[] = []
  const addedFragmentIds: string[] = []
  const addedLanes: ShapeLane[] = []

  for (const lane of processed.lanes) {
    const fragments = lane.fragments.flatMap((fragment) => {
      if (!fragmentIds.has(fragment.id)) return []
      const bakedBase = bakedBases.get(fragment.id)
      if (!bakedBase) return []
      const fragmentId = makeId()
      addedFragmentIds.push(fragmentId)
      return [
        {
          ...cloneFragment(fragment),
          id: fragmentId,
          transform: {
            ...shapeClipTransform(fragment),
            process: undefined,
            bakedBase: { ...bakedBase }
          }
        }
      ]
    })
    if (fragments.length === 0) continue
    const laneId = makeId()
    laneIds.push(laneId)
    addedLanes.push({
      id: laneId,
      source: cloneSource(lane.source),
      gain: lane.gain,
      fragments
    })
  }

  if (addedLanes.length === 0) return { draft: before, laneIds, fragmentIds: addedFragmentIds }
  return {
    draft: commit(before, [...cloneLanes(before.lanes), ...addedLanes]),
    laneIds,
    fragmentIds: addedFragmentIds
  }
}

/** Returns selected clips to their immutable lane source while preserving
 * arrangement placement and clip boundaries. */
export function resetShapeFragmentsToOriginal(
  draft: ShapeDraft,
  fragmentIds: ReadonlySet<string>
): ShapeDraft {
  if (fragmentIds.size === 0) return draft
  const rateReset = setShapeFragmentRate(draft, fragmentIds, 1)
  const reset = commit(
    rateReset,
    rateReset.lanes.map((lane) => ({
      ...cloneLane(lane),
      fragments: lane.fragments.map((fragment) =>
        fragmentIds.has(fragment.id)
          ? {
              ...fragment,
              reversed: false,
              transform: {
                ...DEFAULT_SHAPE_CLIP_TRANSFORM,
                character: 'raw'
              }
            }
          : fragment
      )
    }))
  )
  return groupShapeEdits(draft, reset)
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
    const fragmentEnd = shapeFragmentEndBars(fragment)
    if (fragmentEnd <= start + EPS || fragmentStart >= end - EPS) {
      result.push(cloneFragment(fragment))
      continue
    }
    const hasLeft = fragmentStart < start - EPS
    const hasRight = fragmentEnd > end + EPS
    if (hasLeft) {
      result.push(sliceShapeFragment(fragment, fragmentStart, start))
    }
    if (hasRight) {
      result.push(sliceShapeFragment(fragment, end, fragmentEnd, hasLeft ? id() : fragment.id))
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
    const oldEnd = shapeFragmentEndBars(fragment)
    const rate = shapeFragmentRate(fragment)
    let start = oldStart
    let end = oldEnd
    let sourceStart = fragment.sourceStartBars
    let sourceEnd = fragment.sourceEndBars

    if (edge === 'left') {
      const availableBefore = fragment.reversed
        ? (draft.loopBars - fragment.sourceEndBars) / rate
        : fragment.sourceStartBars / rate
      start = Math.max(0, Math.min(oldEnd - EPS, Math.max(oldStart - availableBefore, edgeBars)))
      const delta = start - oldStart
      if (fragment.reversed) sourceEnd -= delta * rate
      else sourceStart += delta * rate
    } else {
      const availableAfter = fragment.reversed
        ? fragment.sourceStartBars / rate
        : (draft.loopBars - fragment.sourceEndBars) / rate
      end = Math.min(
        draft.loopBars,
        Math.max(oldStart + EPS, Math.min(oldEnd + availableAfter, edgeBars))
      )
      const delta = end - oldEnd
      if (fragment.reversed) sourceStart -= delta * rate
      else sourceEnd += delta * rate
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
    if (resized.transform?.rateSourceStartBars !== undefined) {
      const transform = { ...resized.transform }
      delete transform.rateSourceStartBars
      delete transform.rateSourceEndBars
      resized.transform = transform
    }
    const withoutSource = lane.fragments.filter((candidate) => candidate.id !== fragmentId)
    return {
      ...lane,
      fragments: sortFragments([...trimForOverwrite(withoutSource, start, end), resized])
    }
  })
}

function placeShapeFragments(
  draft: ShapeDraft,
  laneId: string,
  fragmentIds: ReadonlySet<string>,
  destStartBars: number,
  copy: boolean,
  copyIds: readonly string[] = []
): ShapeDraft {
  if (!Number.isFinite(destStartBars) || destStartBars < 0 || fragmentIds.size === 0) return draft
  return updateLane(draft, laneId, (lane) => {
    const sources = lane.fragments
      .filter((fragment) => fragmentIds.has(fragment.id))
      .sort((a, b) => a.destStartBars - b.destStartBars || a.id.localeCompare(b.id))
    if (sources.length === 0) return lane
    const groupStart = sources[0].destStartBars
    const groupEnd = Math.max(...sources.map(shapeFragmentEndBars))
    const groupLength = groupEnd - groupStart
    const destEnd = destStartBars + groupLength
    if (!(groupLength > EPS) || destEnd > draft.loopBars + EPS) return lane
    if (!copy && Math.abs(destStartBars - groupStart) <= EPS) return lane

    const inserted = sources.map((source, index): ShapeFragmentRecipe => ({
      ...cloneFragment(source),
      id: copy ? (copyIds[index] ?? id()) : source.id,
      destStartBars: destStartBars + (source.destStartBars - groupStart)
    }))
    let retained = copy
      ? lane.fragments
      : lane.fragments.filter((fragment) => !fragmentIds.has(fragment.id))
    for (const fragment of inserted) {
      retained = trimForOverwrite(retained, fragment.destStartBars, shapeFragmentEndBars(fragment))
    }
    return {
      ...lane,
      fragments: sortFragments([...retained, ...inserted])
    }
  })
}

export function copyShapeFragments(
  draft: ShapeDraft,
  laneId: string,
  fragmentIds: ReadonlySet<string>,
  destStartBars: number,
  copyIds: readonly string[] = []
): ShapeDraft {
  return placeShapeFragments(draft, laneId, fragmentIds, destStartBars, true, copyIds)
}

export function moveShapeFragments(
  draft: ShapeDraft,
  laneId: string,
  fragmentIds: ReadonlySet<string>,
  destStartBars: number
): ShapeDraft {
  return placeShapeFragments(draft, laneId, fragmentIds, destStartBars, false)
}

export function copyShapeFragment(
  draft: ShapeDraft,
  laneId: string,
  fragmentId: string,
  destStartBars: number,
  copyId = id()
): ShapeDraft {
  return copyShapeFragments(draft, laneId, new Set([fragmentId]), destStartBars, [copyId])
}

export function moveShapeFragment(
  draft: ShapeDraft,
  laneId: string,
  fragmentId: string,
  destStartBars: number
): ShapeDraft {
  return moveShapeFragments(draft, laneId, new Set([fragmentId]), destStartBars)
}

export function duplicateShapeFragments(
  draft: ShapeDraft,
  laneId: string,
  fragmentIds: ReadonlySet<string>,
  copyIds: readonly string[] = []
): ShapeDraft {
  const lane = draft.lanes.find((candidate) => candidate.id === laneId)
  const sources = lane?.fragments
    .filter((fragment) => fragmentIds.has(fragment.id))
    .sort((a, b) => a.destStartBars - b.destStartBars || a.id.localeCompare(b.id))
  if (!sources?.length) return draft
  const groupStart = sources[0].destStartBars
  const groupEnd = Math.max(...sources.map(shapeFragmentEndBars))
  const groupLength = groupEnd - groupStart
  if (groupEnd + groupLength > draft.loopBars + EPS) return draft
  return copyShapeFragments(draft, laneId, fragmentIds, groupEnd, copyIds)
}

export interface ShapeClipboardLane {
  laneId: string
  fragments: readonly ShapeFragmentRecipe[]
}

/** Pastes a clipboard snapshot at one arrangement position. Clips retain
 * their spacing across one or more lanes, crop at the fixed riff boundary,
 * overwrite only their individual target footprints, and enter history as
 * one edit. */
export function pasteShapeFragments(
  draft: ShapeDraft,
  clipboardLanes: readonly ShapeClipboardLane[],
  destStartBars: number,
  copyIds: readonly string[] = []
): { draft: ShapeDraft; fragmentIds: string[] } {
  if (!Number.isFinite(destStartBars)) return { draft, fragmentIds: [] }
  const validLanes = clipboardLanes
    .map((clipboardLane) => ({
      lane: draft.lanes.find((lane) => lane.id === clipboardLane.laneId),
      fragments: [...clipboardLane.fragments].sort(
        (a, b) => a.destStartBars - b.destStartBars || a.id.localeCompare(b.id)
      )
    }))
    .filter(
      (item): item is { lane: ShapeLane; fragments: ShapeFragmentRecipe[] } =>
        !!item.lane && item.fragments.length > 0
    )
  const allFragments = validLanes.flatMap((item) => item.fragments)
  if (allFragments.length === 0) return { draft, fragmentIds: [] }

  const sourceStart = Math.min(...allFragments.map((fragment) => fragment.destStartBars))
  const sourceEnd = Math.max(...allFragments.map(shapeFragmentEndBars))
  const groupLength = sourceEnd - sourceStart
  if (!(groupLength > EPS) || groupLength > draft.loopBars + EPS || destStartBars < 0)
    return { draft, fragmentIds: [] }
  const destination = destStartBars
  let idIndex = 0
  const pastedIds: string[] = []
  const byLane = new Map(validLanes.map((item) => [item.lane.id, item.fragments]))
  const lanes = draft.lanes.map((lane) => {
    const fragments = byLane.get(lane.id)
    if (!fragments) return cloneLane(lane)
    const inserted = fragments.flatMap((fragment): ShapeFragmentRecipe[] => {
      const fragmentId = copyIds[idIndex++] ?? id()
      const shifted: ShapeFragmentRecipe = {
        ...cloneFragment(fragment),
        id: fragmentId,
        destStartBars: destination + (fragment.destStartBars - sourceStart)
      }
      if (shifted.destStartBars >= draft.loopBars - EPS) return []
      pastedIds.push(fragmentId)
      return shapeFragmentEndBars(shifted) > draft.loopBars + EPS
        ? [sliceShapeFragment(shifted, shifted.destStartBars, draft.loopBars, fragmentId)]
        : [shifted]
    })
    let retained: readonly ShapeFragmentRecipe[] = lane.fragments
    for (const fragment of inserted) {
      retained = trimForOverwrite(retained, fragment.destStartBars, shapeFragmentEndBars(fragment))
    }
    return { ...cloneLane(lane), fragments: sortFragments([...retained, ...inserted]) }
  })
  const next = commit(draft, lanes)
  return next === draft ? { draft, fragmentIds: [] } : { draft: next, fragmentIds: pastedIds }
}

export function duplicateShapeFragment(
  draft: ShapeDraft,
  laneId: string,
  fragmentId: string,
  copyId = id()
): ShapeDraft {
  return duplicateShapeFragments(draft, laneId, new Set([fragmentId]), [copyId])
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

export function removeShapeLane(draft: ShapeDraft, laneId: string): ShapeDraft {
  if (draft.lanes.length <= 1 || !draft.lanes.some((lane) => lane.id === laneId)) return draft
  return commit(draft, draft.lanes.filter((lane) => lane.id !== laneId).map(cloneLane))
}

export function resetShapeLane(draft: ShapeDraft, laneId: string, fragmentId = id()): ShapeDraft {
  return updateLane(draft, laneId, (lane) => ({
    ...lane,
    rotationBars: 0,
    fragments: [identityFragment(draft.loopBars, fragmentId)]
  }))
}

export function resetShapeRiff(draft: ShapeDraft): ShapeDraft {
  return commit(
    draft,
    draft.lanes.map((lane) => ({
      ...cloneLane(lane),
      rotationBars: 0,
      fragments: [identityFragment(draft.loopBars)]
    }))
  )
}

function positiveModulo(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus
}

function rotateShapeSourceRange(
  fragment: ShapeFragmentRecipe,
  sourceBarLength: number,
  deltaBars: number
): ShapeFragmentRecipe {
  const rate = shapeFragmentRate(fragment)
  const sourceDelta = deltaBars * rate
  const sourceLength = fragment.sourceEndBars - fragment.sourceStartBars
  let sourceStartBars: number
  let sourceEndBars: number

  if (fragment.reversed) {
    const endPhase = positiveModulo(fragment.sourceEndBars + sourceDelta, sourceBarLength)
    sourceEndBars = endPhase
    while (sourceEndBars < sourceLength - EPS) sourceEndBars += sourceBarLength
    sourceStartBars = sourceEndBars - sourceLength
  } else {
    sourceStartBars = positiveModulo(fragment.sourceStartBars - sourceDelta, sourceBarLength)
    sourceEndBars = sourceStartBars + sourceLength
  }

  const transform = fragment.transform ? { ...fragment.transform } : undefined
  if (transform?.rateSourceStartBars !== undefined && transform.rateSourceEndBars !== undefined) {
    const baselineLength = transform.rateSourceEndBars - transform.rateSourceStartBars
    if (fragment.reversed) {
      const endPhase = positiveModulo(transform.rateSourceEndBars + sourceDelta, sourceBarLength)
      let baselineEnd = endPhase
      while (baselineEnd < baselineLength - EPS) baselineEnd += sourceBarLength
      transform.rateSourceStartBars = baselineEnd - baselineLength
      transform.rateSourceEndBars = baselineEnd
    } else {
      const baselineStart = positiveModulo(
        transform.rateSourceStartBars - sourceDelta,
        sourceBarLength
      )
      transform.rateSourceStartBars = baselineStart
      transform.rateSourceEndBars = baselineStart + baselineLength
    }
  }

  return {
    ...fragment,
    sourceStartBars,
    sourceEndBars,
    ...(transform ? { transform } : {})
  }
}

/** Circularly offsets the source material beneath every clip in the chosen
 * stem lanes. Destination clip positions, gaps and treatments stay fixed;
 * only the musical phase of each immutable source changes. Positive values
 * move the heard material to the right (later), negative values to the left.
 * The edit is recipe-only, grouped into one undo checkpoint, and never
 * re-processes an already-rendered audio file. */
export function rotateShapeLanes(
  draft: ShapeDraft,
  laneIds: ReadonlySet<string>,
  deltaBars: number
): ShapeDraft {
  if (laneIds.size === 0 || !Number.isFinite(deltaBars) || Math.abs(deltaBars) <= EPS) return draft
  return commit(
    draft,
    draft.lanes.map((lane) => {
      const cloned = cloneLane(lane)
      if (!laneIds.has(lane.id)) return cloned
      return {
        ...cloned,
        rotationBars: positiveModulo((cloned.rotationBars ?? 0) + deltaBars, draft.loopBars),
        fragments: cloned.fragments.map((fragment) => {
          const bakedBarLength = shapeClipTransform(fragment).bakedBase?.barLength
          const sourceBarLength =
            bakedBarLength && Number.isFinite(bakedBarLength) && bakedBarLength > EPS
              ? bakedBarLength
              : lane.source.barLength
          if (!Number.isFinite(sourceBarLength) || sourceBarLength <= EPS) return fragment
          return rotateShapeSourceRange(fragment, sourceBarLength, deltaBars)
        })
      }
    })
  )
}

/** Returns chosen lanes to their unrotated source phase while preserving
 * every other clip edit and treatment. Each lane can carry a different
 * accumulated amount, so the inverse is applied lane-by-lane in one commit. */
export function resetShapeLaneRotations(
  draft: ShapeDraft,
  laneIds: ReadonlySet<string>
): ShapeDraft {
  if (laneIds.size === 0) return draft
  return commit(
    draft,
    draft.lanes.map((lane) => {
      const cloned = cloneLane(lane)
      const rotationBars = cloned.rotationBars ?? 0
      if (!laneIds.has(lane.id) || Math.abs(rotationBars) <= EPS) return cloned
      return {
        ...cloned,
        rotationBars: 0,
        fragments: cloned.fragments.map((fragment) => {
          const bakedBarLength = shapeClipTransform(fragment).bakedBase?.barLength
          const sourceBarLength =
            bakedBarLength && Number.isFinite(bakedBarLength) && bakedBarLength > EPS
              ? bakedBarLength
              : lane.source.barLength
          if (!Number.isFinite(sourceBarLength) || sourceBarLength <= EPS) return fragment
          return rotateShapeSourceRange(fragment, sourceBarLength, -rotationBars)
        })
      }
    })
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
    const transform = shapeClipTransform(fragment)
    const segment: ShapeRenderSegment = {
      sourceStartBars: fragment.sourceStartBars,
      sourceEndBars: fragment.sourceEndBars,
      destStartBars: fragment.destStartBars,
      ...(fragment.reversed ? { reversed: true } : {}),
      ...(Math.abs(shapeClipPitchSemitones(fragment)) > EPS
        ? { pitchSemitones: shapeClipPitchSemitones(fragment) }
        : {}),
      ...(Math.abs(transform.formantSemitones) > EPS
        ? { formantSemitones: transform.formantSemitones }
        : {}),
      ...(Math.abs(shapeFragmentRate(fragment) - 1) > EPS
        ? { rate: shapeFragmentRate(fragment) }
        : {}),
      ...(transform.character === 'raw' ? { character: 'raw' as const } : {}),
      ...(transform.process ? { process: { ...transform.process } } : {}),
      ...(transform.bakedBase ? { bakedBase: { ...transform.bakedBase } } : {})
    }
    const previous = result[result.length - 1]
    const previousDestEnd = previous
      ? previous.destStartBars +
        (previous.sourceEndBars - previous.sourceStartBars) / (previous.rate ?? 1)
      : Number.NaN
    const continuousForward =
      previous &&
      !previous.reversed &&
      !segment.reversed &&
      (previous.rate ?? 1) === (segment.rate ?? 1) &&
      (previous.character ?? 'smooth') === (segment.character ?? 'smooth') &&
      JSON.stringify(previous.process) === JSON.stringify(segment.process) &&
      JSON.stringify(previous.bakedBase) === JSON.stringify(segment.bakedBase) &&
      (previous.pitchSemitones ?? 0) === (segment.pitchSemitones ?? 0) &&
      (previous.formantSemitones ?? 0) === (segment.formantSemitones ?? 0) &&
      Math.abs(previous.sourceEndBars - segment.sourceStartBars) <= EPS
    const continuousReverse =
      previous?.reversed &&
      segment.reversed &&
      (previous.rate ?? 1) === (segment.rate ?? 1) &&
      (previous.character ?? 'smooth') === (segment.character ?? 'smooth') &&
      JSON.stringify(previous.process) === JSON.stringify(segment.process) &&
      JSON.stringify(previous.bakedBase) === JSON.stringify(segment.bakedBase) &&
      (previous.pitchSemitones ?? 0) === (segment.pitchSemitones ?? 0) &&
      (previous.formantSemitones ?? 0) === (segment.formantSemitones ?? 0) &&
      Math.abs(previous.sourceStartBars - segment.sourceEndBars) <= EPS
    if (
      previous &&
      Math.abs(previousDestEnd - segment.destStartBars) <= EPS &&
      (continuousForward || continuousReverse)
    ) {
      if (continuousReverse) previous.sourceStartBars = segment.sourceStartBars
      else previous.sourceEndBars = segment.sourceEndBars
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
    throw new Error('EEEDIT did not get every stem back from the render.')
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
        version: 2,
        source: cloneSource(lane.source),
        loopBars: draft.loopBars,
        gain: lane.gain,
        ...(Math.abs(lane.rotationBars ?? 0) > EPS ? { rotationBars: lane.rotationBars } : {}),
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

/** What an open EEEDIT does when the advanced features switch changes (@shared/features): nothing
 * while the switch is on or EEEDIT is closed. Turned off while open, it closes the way its own
 * close does: at once for a draft with nothing unpublished, else asking first ('ask'). */
export function eeeditSwitchAction(input: {
  enabled: boolean
  open: boolean
  dirty: boolean
}): 'none' | 'close' | 'ask' {
  if (input.enabled || !input.open) return 'none'
  return input.dirty ? 'ask' : 'close'
}
