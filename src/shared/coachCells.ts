/**
 * One pass of one stem in one section: the smallest thing the map can
 * toggle.
 *
 * WHY A CELL EXISTS AT ALL (spec, "Cells split per pass"): "A section runs
 * for N passes of the loop, and each pass is its own cell... stems arrive
 * and leave across a section, so four passes of a four-bar loop stop being
 * four identical bars."
 *
 * THE SHAPE, AND WHY IT IS SPARSE. A section stores only the cells the USER
 * CHANGED. Every other cell is answered by a pure template function
 * (./coachMapTemplate.ts), handed in here as `fallback`. Three things fall
 * out of that, all of them load-bearing:
 *
 * 1. **Re-sizing is free.** "He can change it afterwards; the map re-sizes,
 *    it does not rebuild" (spec). Growing a section adds passes that read
 *    the template; shrinking and growing back RESTORES the user's edits,
 *    because nothing was ever deleted. A dense grid has to truncate or
 *    invent on every resize, and a truncating resize loses work silently.
 * 2. **The pre-fill cannot drift.** There is exactly one implementation of
 *    "what the template says", and it is tested in one place. A fresh map
 *    is `{}` on disk.
 * 3. **The round trip has somewhere to land.** Reading the timeline back
 *    gives a resolved boolean per cell; writing those in explicitly is
 *    legal and unambiguous, because cellIsOn always takes a fallback and
 *    always returns a boolean. runsToCells below is that write.
 *
 * The key is scoped INSIDE a section (`passIndex|path`), never global, so
 * reordering or renaming sections costs nothing.
 */

export type CoachCells = Record<string, boolean>

/** One stem's uninterrupted stretch of on-passes within one section. This
 * is what actually becomes a clip: a stem playing passes 1-3 of a 4-pass
 * section is ONE clip three passes long, which is what a person would draw
 * and what keeps the clip count sane. */
export interface CoachCellRun {
  startPass: number
  passCount: number
}

export interface CoachCellRef {
  passIndex: number
  path: string
}

/** The pass index comes FIRST and the separator is the first '|' only, so a
 * path containing a pipe (rare, but files are files) still parses. */
export function coachCellKey(passIndex: number, path: string): string {
  return `${Math.max(0, Math.round(passIndex))}|${path}`
}

export function parseCoachCellKey(key: string): CoachCellRef | null {
  const split = key.indexOf('|')
  if (split <= 0) return null
  const passIndex = Number(key.slice(0, split))
  if (!Number.isInteger(passIndex) || passIndex < 0) return null
  const path = key.slice(split + 1)
  if (path === '') return null
  return { passIndex, path }
}

/** Whether this cell plays. `fallback` is the template's own answer, and is
 * required rather than defaulted: a caller that does not know what the
 * template says has no business asking this question. */
export function cellIsOn(
  cells: CoachCells,
  passIndex: number,
  path: string,
  fallback: boolean
): boolean {
  return cells[coachCellKey(passIndex, path)] ?? fallback
}

/** One cell set explicitly. Always writes -- there is no "same as the
 * template, so drop the entry" tidying, because that would make a later
 * template change silently rewrite a cell the user had already decided. */
export function setCell(
  cells: CoachCells,
  passIndex: number,
  path: string,
  on: boolean
): CoachCells {
  return { ...cells, [coachCellKey(passIndex, path)]: on }
}

/** One stem, every pass of this section -- the whole-row gesture. */
export function setStemAcrossPasses(
  cells: CoachCells,
  passes: number,
  path: string,
  on: boolean
): CoachCells {
  const next = { ...cells }
  for (let passIndex = 0; passIndex < passes; passIndex += 1) {
    next[coachCellKey(passIndex, path)] = on
  }
  return next
}

/** This stem's on-passes, collapsed into contiguous runs, in pass order.
 *
 * `fallback` is a FUNCTION OF THE PASS, not a single boolean, because the
 * template's answer genuinely varies across a section -- a stem that
 * arrives on pass 2 of an intro is off, off, on, on with nothing stored at
 * all (./coachMapTemplate.ts). A boolean here would have flattened exactly
 * the staggering this whole feature exists for. */
export function cellRuns(
  cells: CoachCells,
  passes: number,
  path: string,
  fallback: (passIndex: number) => boolean
): CoachCellRun[] {
  const runs: CoachCellRun[] = []
  let open: CoachCellRun | null = null
  for (let passIndex = 0; passIndex < passes; passIndex += 1) {
    if (cellIsOn(cells, passIndex, path, fallback(passIndex))) {
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

/**
 * Runs back into explicit cells -- the exact inverse of cellRuns, and the
 * half of the map<->arrangement round trip that lives in src/shared/.
 *
 * Writes EVERY pass, on and off, not just the on ones: the point of reading
 * the arrangement back is that the arrangement is now the truth, and a cell
 * left to the template would let the template overrule what is really on the
 * timeline.
 */
export function runsToCells(
  runs: readonly CoachCellRun[],
  passes: number,
  path: string
): CoachCells {
  const on = new Set<number>()
  for (const run of runs) {
    for (let i = 0; i < run.passCount; i += 1) on.add(run.startPass + i)
  }
  const cells: CoachCells = {}
  for (let passIndex = 0; passIndex < passes; passIndex += 1) {
    cells[coachCellKey(passIndex, path)] = on.has(passIndex)
  }
  return cells
}

/** Repair-rather-than-trust, like every other loader in this layer: a
 * `.sssketchproj` is plain JSON people can and do hand-edit, and a load must
 * never throw. A key this module did not write, or a value that is not a
 * boolean, is dropped rather than guessed at -- the cell then falls back to
 * the template, which is the safest thing an unreadable cell can do. */
export function sanitiseCoachCells(value: unknown): CoachCells {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  const cells: CoachCells = {}
  for (const [key, on] of Object.entries(value as Record<string, unknown>)) {
    if (typeof on !== 'boolean') continue
    if (parseCoachCellKey(key) === null) continue
    cells[key] = on
  }
  return cells
}
