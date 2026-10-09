import { MAX_RIFFF_STEM_SLOTS } from './riffStemSlots'
import type { DiscoverCandidate } from './discoverCandidate'
import type { DiscoverSlotKind } from './discoverSlotKind'
import { DEFAULT_SOURCE_LEAN } from './discoverSlotModifier'
import { DEFAULT_DISCOVER_CHAOS } from './discoverRanking'
import { stemKey, type ProjectRef, type Rifff, type Stem } from './types'
import { disabledOnAdd, isHeard } from './heard'

export interface CrossSourceOccurrence {
  /** Stable within a draft. Side is deliberately absent: swapping the two
   * columns is presentation, never a change to source identity. */
  id: string
  parentId: string
  sourceSlot: number
  stem: Omit<Stem, 'slot'> | null
  gain: number
  /** Present only for stems added from Cross's Discover-style controls. */
  discover?: { candidate: DiscoverCandidate; kinds: DiscoverSlotKind[] }
}

export interface CrossParent {
  id: string
  riffCID: string
  label: string
  bpm: number
  barLength: number
  sources: CrossSourceOccurrence[]
}

export interface CrossCenterRow {
  /** One center instance per source occurrence in v1, so this is also the
   * row id. Identical audio in the other parent has a different source id. */
  id: string
  sourceId: string
  gain: number
  audible: boolean
}

export interface CrossDraft {
  id: string
  projectKey: string
  parents: [CrossParent, CrossParent]
  /** Parent ids, left then right. Swapping changes only this tuple. */
  sideOrder: [string, string]
  targetBpm: number
  /** Discover-style center-add controls; optional for drafts alive across hot reloads. */
  sourceLean?: number
  matching?: number
  center: CrossCenterRow[]
  /** Locally-resolved stems added from the center column rather than either parent. */
  discoveredSources?: CrossSourceOccurrence[]
  /** The array variant is accepted for drafts kept alive across the v1 hot reload. */
  past: (CrossHistorySnapshot | CrossCenterRow[])[]
  future: (CrossHistorySnapshot | CrossCenterRow[])[]
  revision: number
}

export interface CrossHistorySnapshot {
  center: CrossCenterRow[]
  discoveredSources: CrossSourceOccurrence[]
}

export interface CrossAssembly {
  rifff: Rifff
  vol: Record<string, number>
  /** stemKey -> true for each row that wasn't heard when it was added (muted, or left out by a
   * solo): it arrives Disabled, at its own gain in `vol`. ADD_TO_SHELF / PLACE_LOOP_ON_TIMELINE's
   * own `mute`, as Discover's add. */
  mute: Record<string, boolean>
}

/** A parent stem can legitimately arrive at gain 0 when it was muted in
 * Discover before being saved. Cross keeps that inherited gain for normal
 * whole-riff playback, but Solo is an audition command: if this is the sole
 * audible stem, silence would make the control useless. Use unity only for
 * that temporary audition; the source's stored gain remains unchanged. */
export function crossSourceAuditionGain(gain: number, soleAudible: boolean): number {
  return soleAudible && gain <= 0 ? 1 : gain
}

/** Solo is a temporary listening layer over the persisted mute choice. A
 * soloed item is heard even when its own underlying mute is on; clearing
 * solo reveals that untouched mute state again. The one rule Discover's mix
 * shares (src/shared/heard.ts). */
export function crossItemIsAudible(
  itemId: string,
  muted: boolean,
  soloedId: string | null
): boolean {
  return isHeard(itemId, muted, soloedId)
}

export function toggleCrossSoloedId(current: string | null, itemId: string): string | null {
  return current === itemId ? null : itemId
}

/** Turns a riff that already belongs to the current sketch into one side of
 * Cross. Unlike the library-browser adapter this preserves the complete stem
 * metadata (including phase lineage) and reads the gains the musician is
 * actually hearing in the project. */
export function crossParentFromRifff(
  rifff: Rifff,
  vol: Readonly<Record<string, number>>
): CrossParent {
  const groupGain = vol[rifff.groupId] ?? 1
  return {
    id: rifff.groupId,
    riffCID: rifff.groupId,
    label: rifff.name || 'untitled rifff',
    bpm: rifff.bpm,
    barLength: rifff.barLength,
    sources: rifff.stems.map((member) => {
      const { slot, ...stem } = member
      return {
        id: `${rifff.groupId}:${slot}`,
        parentId: rifff.groupId,
        sourceSlot: slot,
        stem,
        gain: Math.max(0, Math.min(1, vol[stemKey(rifff.groupId, slot)] ?? groupGain))
      }
    })
  }
}

export function crossProjectKey(project: ProjectRef, projectSeed?: string): string {
  if (projectSeed) return `seed:${projectSeed}`
  if (project?.kind === 'library') return `library:${project.name}`
  if (project?.kind === 'external') return `external:${project.path}`
  return 'unsaved'
}

export function crossCommitIsCurrent(
  capturedRevision: number,
  capturedProjectKey: string,
  currentDraft: CrossDraft,
  currentProjectKey: string
): boolean {
  return (
    currentDraft.revision === capturedRevision &&
    currentDraft.projectKey === capturedProjectKey &&
    currentProjectKey === capturedProjectKey
  )
}

function cloneCenter(center: readonly CrossCenterRow[]): CrossCenterRow[] {
  return center.map((row) => ({ ...row }))
}

function cloneSources(sources: readonly CrossSourceOccurrence[]): CrossSourceOccurrence[] {
  return sources.map((source) => ({
    ...source,
    stem: source.stem ? { ...source.stem } : null,
    discover: source.discover
      ? {
          candidate: { ...source.discover.candidate },
          kinds: [...source.discover.kinds]
        }
      : undefined
  }))
}

function discoveredSources(draft: CrossDraft): CrossSourceOccurrence[] {
  return draft.discoveredSources ?? []
}

function snapshotOf(draft: CrossDraft): CrossHistorySnapshot {
  return {
    center: cloneCenter(draft.center),
    discoveredSources: cloneSources(discoveredSources(draft))
  }
}

function restoreSnapshot(
  snapshot: CrossHistorySnapshot | CrossCenterRow[],
  fallbackSources: readonly CrossSourceOccurrence[]
): CrossHistorySnapshot {
  return Array.isArray(snapshot)
    ? { center: cloneCenter(snapshot), discoveredSources: cloneSources(fallbackSources) }
    : snapshot
}

function sourceMap(draft: CrossDraft): Map<string, CrossSourceOccurrence> {
  return new Map(
    [...draft.parents.flatMap((parent) => parent.sources), ...discoveredSources(draft)].map(
      (source) => [source.id, source]
    )
  )
}

function commitCrossState(
  draft: CrossDraft,
  center: CrossCenterRow[],
  nextDiscoveredSources = discoveredSources(draft)
): CrossDraft {
  if (
    center.length === draft.center.length &&
    center.every((row, index) => {
      const before = draft.center[index]
      return (
        before !== undefined &&
        row.id === before.id &&
        row.sourceId === before.sourceId &&
        row.gain === before.gain &&
        row.audible === before.audible
      )
    }) &&
    nextDiscoveredSources === discoveredSources(draft)
  ) {
    return draft
  }
  return {
    ...draft,
    center,
    discoveredSources: cloneSources(nextDiscoveredSources),
    past: [...draft.past, snapshotOf(draft)],
    future: [],
    revision: draft.revision + 1
  }
}

function commitCenter(draft: CrossDraft, center: CrossCenterRow[]): CrossDraft {
  return commitCrossState(draft, center)
}

export function crossPairInVisualOrder(
  visibleRiffCIDs: readonly string[],
  selected: ReadonlySet<string>
): [string, string] | null {
  if (selected.size !== 2) return null
  const ordered = visibleRiffCIDs.filter((riffCID) => selected.has(riffCID))
  return ordered.length === 2 ? [ordered[0], ordered[1]] : null
}

export function createCrossDraft(
  projectKey: string,
  left: CrossParent,
  right: CrossParent,
  targetBpm: number,
  id = crypto.randomUUID()
): CrossDraft {
  return {
    id,
    projectKey,
    parents: [left, right],
    sideOrder: [left.id, right.id],
    targetBpm,
    sourceLean: DEFAULT_SOURCE_LEAN,
    matching: 100 - DEFAULT_DISCOVER_CHAOS,
    center: [],
    discoveredSources: [],
    past: [],
    future: [],
    revision: 0
  }
}

/** Adds a resolved Discover candidate directly to the editable center. */
export function addCrossDiscoveredSource(
  draft: CrossDraft,
  source: CrossSourceOccurrence,
  atIndex?: number
): CrossDraft {
  if (!source.stem || draft.center.length >= MAX_RIFFF_STEM_SLOTS) return draft
  const sources = [...discoveredSources(draft).filter((item) => item.id !== source.id), source]
  const center = cloneCenter(draft.center)
  const index = Math.max(0, Math.min(center.length, atIndex ?? center.length))
  center.splice(index, 0, {
    id: source.id,
    sourceId: source.id,
    gain: source.gain,
    audible: true
  })
  return commitCrossState(draft, center, sources)
}

/** Replaces one center row's audio while preserving its mix state and position. */
export function replaceCrossRowSource(
  draft: CrossDraft,
  rowId: string,
  source: CrossSourceOccurrence
): CrossDraft {
  if (!source.stem || !draft.center.some((row) => row.id === rowId)) return draft
  const sources = [...discoveredSources(draft).filter((item) => item.id !== source.id), source]
  return commitCrossState(
    draft,
    draft.center.map((row) => (row.id === rowId ? { ...row, sourceId: source.id } : row)),
    sources
  )
}

/** Makes an independently mixable center instance of the same source. */
export function duplicateCrossRow(
  draft: CrossDraft,
  rowId: string,
  duplicateId = crypto.randomUUID()
): CrossDraft {
  if (draft.center.length >= MAX_RIFFF_STEM_SLOTS) return draft
  const index = draft.center.findIndex((row) => row.id === rowId)
  if (index === -1) return draft
  const center = cloneCenter(draft.center)
  center.splice(index + 1, 0, { ...center[index], id: duplicateId })
  return commitCenter(draft, center)
}

/** Cross's own preview tempo, clamped to 40..200. It is the draft's, not the
 * project's: it starts at the project tempo and changing it never touches the
 * arrangement. Not a Cross undo step either; the revision bump replays a
 * playing preview at the new tempo. */
export function setCrossTargetBpm(draft: CrossDraft, targetBpm: number): CrossDraft {
  const bpm = Math.max(40, Math.min(200, targetBpm))
  return bpm === draft.targetBpm
    ? draft
    : { ...draft, targetBpm: bpm, revision: draft.revision + 1 }
}

export function crossParentOnSide(draft: CrossDraft, side: 'left' | 'right'): CrossParent {
  const id = draft.sideOrder[side === 'left' ? 0 : 1]
  return draft.parents.find((parent) => parent.id === id) ?? draft.parents[side === 'left' ? 0 : 1]
}

export function swapCrossSides(draft: CrossDraft): CrossDraft {
  return { ...draft, sideOrder: [draft.sideOrder[1], draft.sideOrder[0]] }
}

export function addCrossSource(draft: CrossDraft, sourceId: string, atIndex?: number): CrossDraft {
  const source = sourceMap(draft).get(sourceId)
  if (!source?.stem) return draft
  const existing = draft.center.findIndex((row) => row.sourceId === sourceId)
  if (existing === -1 && draft.center.length >= MAX_RIFFF_STEM_SLOTS) return draft

  const center = cloneCenter(draft.center)
  const row =
    existing === -1
      ? { id: sourceId, sourceId, gain: source.gain, audible: true }
      : center.splice(existing, 1)[0]
  const requested = atIndex ?? center.length
  const index = Math.max(0, Math.min(center.length, requested))
  center.splice(index, 0, row)
  return commitCenter(draft, center)
}

export function moveCrossRow(draft: CrossDraft, rowId: string, atIndex: number): CrossDraft {
  const current = draft.center.findIndex((row) => row.id === rowId)
  if (current === -1) return draft
  const center = cloneCenter(draft.center)
  const [row] = center.splice(current, 1)
  center.splice(Math.max(0, Math.min(center.length, atIndex)), 0, row)
  return commitCenter(draft, center)
}

export function removeCrossRow(draft: CrossDraft, rowId: string): CrossDraft {
  return commitCenter(
    draft,
    draft.center.filter((row) => row.id !== rowId)
  )
}

export function clearCrossCenter(draft: CrossDraft): CrossDraft {
  return commitCenter(draft, [])
}

export function setCrossGain(draft: CrossDraft, rowId: string, gain: number): CrossDraft {
  const clamped = Math.max(0, Math.min(1, gain))
  return commitCenter(
    draft,
    draft.center.map((row) => (row.id === rowId ? { ...row, gain: clamped } : row))
  )
}

/** Live gain-drag update: changes the audible/rendered value without adding
 * one undo frame per pointermove. finishCrossGainDrag commits the one frame. */
export function previewCrossGain(draft: CrossDraft, rowId: string, gain: number): CrossDraft {
  const clamped = Math.max(0, Math.min(1, gain))
  const center = draft.center.map((row) => (row.id === rowId ? { ...row, gain: clamped } : row))
  const changed = center.some((row, index) => row.gain !== draft.center[index]?.gain)
  return changed ? { ...draft, center, revision: draft.revision + 1 } : draft
}

export function finishCrossGainDrag(
  draft: CrossDraft,
  rowId: string,
  startingGain: number
): CrossDraft {
  const current = draft.center.find((row) => row.id === rowId)
  if (!current || current.gain === startingGain) return draft
  const before = cloneCenter(draft.center).map((row) =>
    row.id === rowId ? { ...row, gain: startingGain } : row
  )
  return {
    ...draft,
    past: [...draft.past, before],
    future: [],
    revision: draft.revision + 1
  }
}

export function toggleCrossAudible(draft: CrossDraft, rowId: string): CrossDraft {
  return commitCenter(
    draft,
    draft.center.map((row) => (row.id === rowId ? { ...row, audible: !row.audible } : row))
  )
}

export function undoCross(draft: CrossDraft): CrossDraft {
  const saved = draft.past[draft.past.length - 1]
  if (!saved) return draft
  const previous = restoreSnapshot(saved, discoveredSources(draft))
  return {
    ...draft,
    center: cloneCenter(previous.center),
    discoveredSources: cloneSources(previous.discoveredSources),
    past: draft.past.slice(0, -1),
    future: [snapshotOf(draft), ...draft.future],
    revision: draft.revision + 1
  }
}

export function redoCross(draft: CrossDraft): CrossDraft {
  const saved = draft.future[0]
  if (!saved) return draft
  const next = restoreSnapshot(saved, discoveredSources(draft))
  return {
    ...draft,
    center: cloneCenter(next.center),
    discoveredSources: cloneSources(next.discoveredSources),
    past: [...draft.past, snapshotOf(draft)],
    future: draft.future.slice(1),
    revision: draft.revision + 1
  }
}

export function crossSourceForRow(
  draft: CrossDraft,
  row: CrossCenterRow
): CrossSourceOccurrence | null {
  return sourceMap(draft).get(row.sourceId) ?? null
}

/** The center as a riff. `soloedId`: the center row soloed when it was added. What you hear is
 * what you get: a row that wasn't heard arrives Disabled at its own level (disabledOnAdd). */
export function assembleCrossRifff(
  draft: CrossDraft,
  groupId = crypto.randomUUID(),
  soloedId: string | null = null
): CrossAssembly | null {
  const sources = sourceMap(draft)
  const members = draft.center.flatMap((row) => {
    const source = sources.get(row.sourceId)
    return source?.stem ? [{ row, stem: source.stem }] : []
  })
  if (members.length === 0) return null
  const left = crossParentOnSide(draft, 'left')
  const right = crossParentOnSide(draft, 'right')
  const rifff: Rifff = {
    groupId,
    phaseLinkId: groupId,
    name: `cross: ${left.label} × ${right.label}`,
    bpm: draft.targetBpm,
    barLength: Math.max(...members.map(({ stem }) => stem.barLength)),
    folderPath: '',
    stems: members.map(({ stem }, index) => ({ ...stem, slot: index + 1 }))
  }
  const vol: Record<string, number> = {}
  const mute: Record<string, boolean> = {}
  members.forEach(({ row }, index) => {
    const key = stemKey(groupId, index + 1)
    vol[key] = row.gain
    if (disabledOnAdd(row.id, !row.audible, soloedId)) mute[key] = true
  })
  return { rifff, vol, mute }
}
