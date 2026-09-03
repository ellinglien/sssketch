import type { ArrangeMoveType } from './autoArrangeEngine'

export const ARRANGE_STEP_BARS = 8
export const ARRANGE_FILL_BARS = 2

// activeRangesForStem's fill branch computes fillStart as
// stepStartBar + ARRANGE_STEP_BARS - ARRANGE_FILL_BARS, which is only a
// well-formed (non-negative, before fillEnd) range while this holds. Retuning
// either constant without preserving it would silently produce a malformed
// ADD_MUTE_REGION (startBar >= endBar) dispatched straight into real app
// state -- the reducer does no validation of its own.
if (ARRANGE_FILL_BARS >= ARRANGE_STEP_BARS) {
  throw new Error('ARRANGE_FILL_BARS must be smaller than ARRANGE_STEP_BARS')
}

export interface ArrangeMoveRecord {
  stepIndex: number
  stemKey: string
  moveType: ArrangeMoveType
}

export type ArrangeAction =
  | { type: 'SET_PLAYED_BARS'; key: string; bars: number }
  | { type: 'ADD_MUTE_REGION'; stemKeys: string[]; startBar: number; endBar: number }

// stemKey() (types.ts) joins with ':' and groupId is always a crypto.randomUUID()
// (no colons of its own -- see buildRifff.ts/selectors.ts/importResolvedRiff.ts),
// so splitting on the LAST ':' recovers the owning groupId. No shared parse
// helper exists elsewhere in the codebase (every other call site only ever
// builds a stemKey forward from a known groupId, e.g. selectors.ts/
// buildEngineProject.ts) -- this is deliberately kept local rather than
// promoted to types.ts until a second caller needs it.
function groupIdFromStemKey(key: string): string {
  return key.slice(0, key.lastIndexOf(':'))
}

interface BarRange {
  startBar: number
  endBar: number
}

// Active windows for one stem, built by walking its moves in step order.
// Enter/exit set the PERSISTENT state from that step's start bar onward;
// fill is a one-off blip confined to the last ARRANGE_FILL_BARS bars of its
// own step, independent of the surrounding persistent state.
function activeRangesForStem(moves: ArrangeMoveRecord[], totalBars: number): BarRange[] {
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

// The complement of a stem's active ranges within [0, totalBars) -- these
// become its ADD_MUTE_REGION spans, since a stem is muted everywhere except
// when explicitly active.
function inactiveRangesFrom(activeRanges: BarRange[], totalBars: number): BarRange[] {
  const inactive: BarRange[] = []
  let cursor = 0
  for (const r of activeRanges) {
    if (r.startBar > cursor) inactive.push({ startBar: cursor, endBar: r.startBar })
    cursor = Math.max(cursor, r.endBar)
  }
  if (cursor < totalBars) inactive.push({ startBar: cursor, endBar: totalBars })
  return inactive
}

export function buildArrangeActions(
  moves: ArrangeMoveRecord[],
  totalSteps: number
): ArrangeAction[] {
  const actions: ArrangeAction[] = []
  const totalBars = totalSteps * ARRANGE_STEP_BARS

  // SET_PLAYED_BARS is keyed by groupId, not per-stem. Auto-arrange now pools
  // stems from every rifff placed on the timeline, so moves can span several
  // groupIds -- all of them share the same totalBars extent (the whole
  // arrangement plays out over one common span), so dispatch once per
  // distinct groupId rather than once overall.
  const groupIds = [...new Set(moves.map((m) => groupIdFromStemKey(m.stemKey)))]
  for (const groupId of groupIds) {
    actions.push({ type: 'SET_PLAYED_BARS', key: groupId, bars: totalBars })
  }

  const stemKeys = [...new Set(moves.map((m) => m.stemKey))]
  for (const stemKey of stemKeys) {
    const stemMoves = moves.filter((m) => m.stemKey === stemKey)
    const activeRanges = activeRangesForStem(stemMoves, totalBars)
    const inactiveRanges = inactiveRangesFrom(activeRanges, totalBars)
    for (const range of inactiveRanges) {
      actions.push({
        type: 'ADD_MUTE_REGION',
        stemKeys: [stemKey],
        startBar: range.startBar,
        endBar: range.endBar
      })
    }
  }

  return actions
}
