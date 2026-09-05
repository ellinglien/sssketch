import type { ArrangeMoveType } from './autoArrangeEngine'

// Shrunk from 8/2 to 4/1 (same 25% fill-to-step ratio) -- feedback from a
// real manual walkthrough was that the completed arrangement took too many
// bars to reach a satisfying density; halving the per-step span reaches the
// same target density in half the timeline length without changing the
// build engine's own step-count logic (MAX_BUILD_STEPS et al. are a STEP
// count, not a bar count, so they're unaffected).
export const ARRANGE_STEP_BARS = 4
export const ARRANGE_FILL_BARS = 1

// activeRangesForStem's fill branch computes fillStart as
// stepStartBar + ARRANGE_STEP_BARS - ARRANGE_FILL_BARS, which is only a
// well-formed (non-negative, before fillEnd) range while this holds. Retuning
// either constant without preserving it would silently produce a malformed
// range (startBar >= endBar) fed straight into a PASTE_RIFFF's barLength via
// selectors.ts's buildArrangeReplaceActions -- neither that nor the reducer
// validates it.
if (ARRANGE_FILL_BARS >= ARRANGE_STEP_BARS) {
  throw new Error('ARRANGE_FILL_BARS must be smaller than ARRANGE_STEP_BARS')
}

// The auto-arrange gear-menu trigger's own eligibility cap (App.tsx) -- also
// shared by Draw Arrangement (DRAW_ARRANGE_SECTIONS below) so both features
// stay tied to one real limit rather than two independently-tunable numbers
// that could silently drift apart. Raised from an original 32 (2026-09) --
// real use hit that immediately, a plain 32-bar rifff already sat right at
// the old limit.
export const AUTO_ARRANGE_MAX_BARS = 64

export interface ArrangeMoveRecord {
  stepIndex: number
  stemKey: string
  moveType: ArrangeMoveType
}

// stemKey() (types.ts) joins with ':' and groupId is always a crypto.randomUUID()
// (no colons of its own -- see buildRifff.ts/selectors.ts/importResolvedRiff.ts),
// so splitting on the LAST ':' recovers the owning groupId. Exported so
// selectors.ts's buildArrangeReplaceActions (state/selectors.ts) can reuse
// this exact parse rather than duplicating it -- that's now a second caller,
// so this is no longer kept local the way this comment used to say.
export function groupIdFromStemKey(key: string): string {
  return key.slice(0, key.lastIndexOf(':'))
}

export interface BarRange {
  startBar: number
  endBar: number
}

// Active windows for one stem, built by walking its moves in step order.
// Enter/exit set the PERSISTENT state from that step's start bar onward;
// fill is a one-off blip confined to the last ARRANGE_FILL_BARS bars of its
// own step, independent of the surrounding persistent state.
//
// Exported: selectors.ts's buildArrangeReplaceActions reuses this directly
// to compute each moved stem's active windows, which become independent
// PASTE_RIFFF clip copies instead of this module's own ADD_MUTE_REGION
// spans -- see that function's own doc comment.
export function activeRangesForStem(moves: ArrangeMoveRecord[], totalBars: number): BarRange[] {
  const sorted = [...moves].sort((a, b) => a.stepIndex - b.stepIndex)
  const ranges: BarRange[] = []
  let activeFrom: number | null = null

  for (const move of sorted) {
    const stepStartBar = move.stepIndex * ARRANGE_STEP_BARS
    if (move.moveType === 'enter') {
      if (activeFrom === null) activeFrom = stepStartBar
    } else if (move.moveType === 'exit') {
      if (activeFrom !== null) {
        ranges.push({ startBar: activeFrom, endBar: stepStartBar })
        activeFrom = null
      }
    } else {
      // fill
      const fillStart = stepStartBar + ARRANGE_STEP_BARS - ARRANGE_FILL_BARS
      const fillEnd = stepStartBar + ARRANGE_STEP_BARS
      ranges.push({ startBar: fillStart, endBar: fillEnd })
    }
  }

  if (activeFrom !== null) {
    ranges.push({ startBar: activeFrom, endBar: totalBars })
  }

  return mergeOverlapping(ranges)
}

/**
 * Per-step active-stem snapshot, one entry per step from 0 to
 * uptoStepInclusive (empty array if uptoStepInclusive < 0) -- for
 * AutoArrangeBuildStep.tsx's build-progress grid, which needs to show
 * "what's active in each step so far" rather than activeRangesForStem's own
 * collapsed bar ranges. Same enter/exit/fill semantics: enter/exit persist
 * from that step onward, fill is a one-step blip that doesn't affect
 * whether the stem is considered active in any OTHER step. Each entry is
 * sorted for deterministic comparison (tests, and a stable render order).
 */
export function activeStemKeysPerStep(
  moves: ArrangeMoveRecord[],
  uptoStepInclusive: number
): string[][] {
  if (uptoStepInclusive < 0) return []

  const movesByStep = new Map<number, ArrangeMoveRecord[]>()
  for (const move of moves) {
    const list = movesByStep.get(move.stepIndex)
    if (list) list.push(move)
    else movesByStep.set(move.stepIndex, [move])
  }

  const persistent = new Set<string>()
  const result: string[][] = []
  for (let step = 0; step <= uptoStepInclusive; step++) {
    const stepMoves = movesByStep.get(step) ?? []
    for (const move of stepMoves) {
      if (move.moveType === 'enter') persistent.add(move.stemKey)
      else if (move.moveType === 'exit') persistent.delete(move.stemKey)
    }
    const active = new Set(persistent)
    for (const move of stepMoves) {
      if (move.moveType === 'fill') active.add(move.stemKey)
    }
    result.push([...active].sort())
  }
  return result
}

function mergeOverlapping(ranges: BarRange[]): BarRange[] {
  const sorted = [...ranges].sort((a, b) => a.startBar - b.startBar)
  const merged: BarRange[] = []
  for (const r of sorted) {
    const last = merged[merged.length - 1]
    if (last && r.startBar <= last.endBar) {
      last.endBar = Math.max(last.endBar, r.endBar)
    } else {
      merged.push({ ...r })
    }
  }
  return merged
}
