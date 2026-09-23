/**
 * What one click on the map actually does to the timeline.
 *
 * The exact inverse of ./coachMapRead.ts's readRowPasses, and tested against
 * it: read the grid, toggle a cell, apply the plan, read again, and the grid
 * is the one that was asked for (./coachMapEdit.test.ts, "the round trip").
 *
 * TWO RULES, BOTH ABOUT NOT DESTROYING WORK:
 *
 * 1. **A toggle rewrites one RUN, never a row and never a section.** The
 *    plan below finds the single contiguous stretch of passes the toggle
 *    disturbs and touches nothing outside it. A clip the user nudged, faded
 *    or resized three columns away keeps every bit of that, because the plan
 *    never names it. The obvious alternative -- regenerate the row's clips
 *    for the whole section -- is two lines shorter and quietly eats hand
 *    edits, which is exactly the thing the map is not allowed to do.
 *
 * 2. **A clip reaching outside the section is REFUSED, not trimmed.** It
 *    cannot be deleted without silently taking material out of the
 *    neighbouring section, and it cannot be resized without guessing which
 *    end the user meant. So planCellToggle returns it in `blockedGroupIds`
 *    and does nothing, passIsLocked lets the map draw that cell as
 *    untouchable, and the user is sent to the timeline, where both edges are
 *    visible. The map's own layout never straddles a section edge, so this
 *    only ever fires on a clip a person made.
 *
 * Everything here is pure over bar numbers and groupIds. Turning a plan into
 * real actions is ../renderer/src/state/coachMapPlacement.ts's job.
 */

import { coachCellKey, type CoachCellRun, type CoachCells } from './coachCells'
import { readRowPasses, sectionBarWindow } from './coachMapRead'

/** One clip on one map row, as the map needs to see it. `endBar` is
 * exclusive and already accounts for leftCrop -- the renderer resolves both
 * (coachMapRows.ts). */
export interface MapClip {
  groupId: string
  startBar: number
  endBar: number
}

/** What one toggle asks the timeline for. */
export interface CoachMapRowPlan {
  /** Clips that must go -- DELETE_RIFFFS. Only ever clips lying wholly
   * inside this section. */
  removeGroupIds: string[]
  /** Runs that must appear, as pass ranges inside this section. One clip
   * each, which is what a person would draw. */
  addRuns: CoachCellRun[]
  /** Clips the toggle refused to touch because they reach outside this
   * section. Non-empty means the plan is a NO-OP and the caller says why. */
  blockedGroupIds: string[]
}

function clipWindows(clips: readonly MapClip[]): { startBar: number; endBar: number }[] {
  return clips.map((clip) => ({ startBar: clip.startBar, endBar: clip.endBar }))
}

function overlaps(clip: MapClip, startBar: number, endBar: number): boolean {
  return clip.startBar < endBar && clip.endBar > startBar
}

/** Every clip on this row that overlaps the section but is not wholly
 * inside it, in the order it was given. */
export function clipsCrossingSectionEdge(
  clips: readonly MapClip[],
  section: { startBar: number; passes: number },
  phraseBars: number
): string[] {
  const window = sectionBarWindow(section, phraseBars)
  return clips
    .filter(
      (clip) =>
        overlaps(clip, window.startBar, window.endBar) &&
        (clip.startBar < window.startBar || clip.endBar > window.endBar)
    )
    .map((clip) => clip.groupId)
}

/** The maximal contiguous stretch of `flags` containing `passIndex`, or null
 * when that pass is false. */
function runAround(flags: readonly boolean[], passIndex: number): CoachCellRun | null {
  if (flags[passIndex] !== true) return null
  let startPass = passIndex
  while (startPass > 0 && flags[startPass - 1]) startPass -= 1
  let endPass = passIndex
  while (endPass + 1 < flags.length && flags[endPass + 1]) endPass += 1
  return { startPass, passCount: endPass - startPass + 1 }
}

/** Every contiguous stretch of `flags` that is true, restricted to
 * `[from, from + count)`. */
function runsWithin(flags: readonly boolean[], from: number, count: number): CoachCellRun[] {
  const runs: CoachCellRun[] = []
  let open: CoachCellRun | null = null
  for (let passIndex = from; passIndex < from + count; passIndex += 1) {
    if (flags[passIndex]) {
      if (open === null) open = { startPass: passIndex, passCount: 1 }
      else open.passCount += 1
    } else if (open !== null) {
      runs.push(open)
      open = null
    }
  }
  if (open !== null) runs.push(open)
  return runs
}

/** Whether this cell cannot be toggled, because a clip covering it reaches
 * outside the section. The map draws these dashed. */
export function passIsLocked(
  clips: readonly MapClip[],
  section: { startBar: number; passes: number },
  phraseBars: number,
  passIndex: number
): boolean {
  const blocked = new Set(clipsCrossingSectionEdge(clips, section, phraseBars))
  if (blocked.size === 0) return false
  const flags = readRowPasses(clipWindows(clips), section, phraseBars)
  const affected = runAround(flags, passIndex) ?? { startPass: passIndex, passCount: 1 }
  const phrase = Number.isFinite(phraseBars) ? Math.max(1, Math.round(phraseBars)) : 1
  const from = section.startBar + affected.startPass * phrase
  const to = from + affected.passCount * phrase
  return clips.some((clip) => blocked.has(clip.groupId) && overlaps(clip, from, to))
}

export interface PlanCellToggleInput {
  /** Every clip on this map row, anywhere in the project. */
  clips: readonly MapClip[]
  section: { startBar: number; passes: number }
  phraseBars: number
  passIndex: number
  /** The value the user just asked for -- not a flip, an assertion. A
   * caller that passes what the cell already says gets an empty plan, which
   * is what makes a double-dispatch harmless. */
  on: boolean
}

/**
 * One cell's worth of timeline edit.
 *
 * Reads the row as it really is, applies the one change, finds the single
 * contiguous run the change disturbs, and rewrites only that. Everything
 * outside it is untouched by construction.
 */
export function planCellToggle(input: PlanCellToggleInput): CoachMapRowPlan {
  const empty: CoachMapRowPlan = { removeGroupIds: [], addRuns: [], blockedGroupIds: [] }
  const phrase = Number.isFinite(input.phraseBars) ? Math.max(1, Math.round(input.phraseBars)) : 1
  const before = readRowPasses(clipWindows(input.clips), input.section, phrase)
  if (input.passIndex < 0 || input.passIndex >= before.length) return empty
  if (before[input.passIndex] === input.on) return empty

  const after = [...before]
  after[input.passIndex] = input.on

  // The affected stretch is the union of the run the pass was in and the run
  // it is now in -- which covers both directions with one rule: turning off
  // shrinks or splits the old run, turning on merges into a new one.
  const wasIn = runAround(before, input.passIndex)
  const nowIn = runAround(after, input.passIndex)
  const startPass = Math.min(
    wasIn?.startPass ?? input.passIndex,
    nowIn?.startPass ?? input.passIndex
  )
  const endPass = Math.max(
    (wasIn?.startPass ?? input.passIndex) + (wasIn?.passCount ?? 1),
    (nowIn?.startPass ?? input.passIndex) + (nowIn?.passCount ?? 1)
  )
  const fromBar = input.section.startBar + startPass * phrase
  const toBar = input.section.startBar + endPass * phrase

  const blocked = new Set(clipsCrossingSectionEdge(input.clips, input.section, phrase))
  const touched = input.clips.filter((clip) => overlaps(clip, fromBar, toBar))
  const blockedHere = touched.filter((clip) => blocked.has(clip.groupId)).map((c) => c.groupId)
  // A refusal, never a partial edit: nothing is removed and nothing is added.
  if (blockedHere.length > 0) return { ...empty, blockedGroupIds: blockedHere }

  return {
    removeGroupIds: touched.map((clip) => clip.groupId),
    addRuns: runsWithin(after, startPass, endPass - startPass),
    blockedGroupIds: []
  }
}

/**
 * Cell edits, carried across a change of phrase length.
 *
 * "He can change it afterwards; the map re-sizes, it does not rebuild"
 * (spec). A section that was 2 passes of 8 bars becomes 4 passes of 4, so
 * each new pass inherits from the old pass it sits INSIDE -- proportional,
 * floor-rounded, and total in both directions. Halving loses the finer
 * half of a pair, which is unavoidable: there is no 8-bar answer that
 * remembers two different 4-bar ones.
 *
 * Only ever called with cells that were just READ off the timeline
 * (rowPassesToCells), never with the build-time ones -- the timeline is the
 * truth, and a re-size that carried stale build-time cells would throw away
 * every edit made since.
 */
export function remapCellsToPhrase(
  cells: CoachCells,
  paths: readonly string[],
  fromPasses: number,
  toPasses: number
): CoachCells {
  const from = Math.max(1, Math.round(fromPasses))
  const to = Math.max(1, Math.round(toPasses))
  const out: CoachCells = {}
  for (const path of paths) {
    for (let passIndex = 0; passIndex < to; passIndex += 1) {
      const source = Math.min(from - 1, Math.floor((passIndex * from) / to))
      const value = cells[coachCellKey(source, path)]
      if (value !== undefined) out[coachCellKey(passIndex, path)] = value
    }
  }
  return out
}
