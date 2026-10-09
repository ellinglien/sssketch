import { MAX_RIFFF_STEM_SLOTS } from './riffStemSlots'
import { stemKey, type ProjectRef, type Rifff, type Stem } from './types'

export interface CrossSourceOccurrence {
  /** Stable within a draft. Side is deliberately absent: swapping the two
   * columns is presentation, never a change to source identity. */
  id: string
  parentId: string
  sourceSlot: number
  stem: Omit<Stem, 'slot'> | null
  gain: number
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
  center: CrossCenterRow[]
  past: CrossCenterRow[][]
  future: CrossCenterRow[][]
  revision: number
}

export interface CrossAssembly {
  rifff: Rifff
  vol: Record<string, number>
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

function sourceMap(draft: CrossDraft): Map<string, CrossSourceOccurrence> {
  return new Map(
    draft.parents.flatMap((parent) => parent.sources).map((source) => [source.id, source])
  )
}

function commitCenter(draft: CrossDraft, center: CrossCenterRow[]): CrossDraft {
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
    })
  ) {
    return draft
  }
  return {
    ...draft,
    center,
    past: [...draft.past, cloneCenter(draft.center)],
    future: [],
    revision: draft.revision + 1
  }
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
    center: [],
    past: [],
    future: [],
    revision: 0
  }
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

/** Matches Discover's real toggleSlotSolo behavior: solo leaves one audible;
 * pressing solo on that sole audible row again brings every row back. */
export function toggleCrossSolo(draft: CrossDraft, rowId: string): CrossDraft {
  const alreadySoloed = draft.center.filter((row) => row.audible).map((row) => row.id)
  const restoreAll = alreadySoloed.length === 1 && alreadySoloed[0] === rowId
  return commitCenter(
    draft,
    draft.center.map((row) => ({ ...row, audible: restoreAll || row.id === rowId }))
  )
}

export function undoCross(draft: CrossDraft): CrossDraft {
  const previous = draft.past[draft.past.length - 1]
  if (!previous) return draft
  return {
    ...draft,
    center: cloneCenter(previous),
    past: draft.past.slice(0, -1),
    future: [cloneCenter(draft.center), ...draft.future],
    revision: draft.revision + 1
  }
}

export function redoCross(draft: CrossDraft): CrossDraft {
  const next = draft.future[0]
  if (!next) return draft
  return {
    ...draft,
    center: cloneCenter(next),
    past: [...draft.past, cloneCenter(draft.center)],
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

export function assembleCrossRifff(
  draft: CrossDraft,
  groupId = crypto.randomUUID()
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
  members.forEach(({ row }, index) => {
    vol[stemKey(groupId, index + 1)] = row.audible ? row.gain : 0
  })
  return { rifff, vol }
}
