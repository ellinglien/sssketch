import { describe, expect, it } from 'vitest'
import {
  COACH_DONE_LINES,
  COACH_LOOP_QUESTION_LINES,
  COACH_NO_MOVES_LINES,
  COACH_PHRASE_LINE_TEMPLATES,
  COACH_PREFILLED_LINE_TEMPLATES,
  COACH_SECTION_GOAL_LINES,
  COACH_SHAPE_QUESTION_LINES,
  COACH_STEP_SATISFIED_LINES,
  COACH_STUCK_LINES,
  COACH_TENSION_LINE_TEMPLATES,
  COACH_TENSION_NONE_LINES,
  COACH_V1_EXPORTED_LINES,
  COACH_WALK_END_LINES,
  COACH_WALK_START_LINES
} from './coachLines'
import { COACH_MAP_LOCKED_CELL_HINT, COACH_SCRIPT } from './coachScript'
import { COACH_STEPS } from './coachSteps'

/**
 * The tone sweep, done EXHAUSTIVELY rather than by listing table names.
 *
 * ./coachLines.test.ts checks the same rules against a hand-written list of
 * the named exports, which is the list a consolidation can silently drop a
 * table out of. This file walks COACH_SCRIPT itself, so a table added to the
 * script is held to the copy rules whether or not anyone remembers to
 * mention it anywhere -- and the last describe block below proves the two
 * lists are the same set of arrays.
 */
function collectTables(node: unknown): readonly (readonly string[])[] {
  if (Array.isArray(node)) return [node as readonly string[]]
  if (typeof node === 'object' && node !== null) {
    return Object.values(node).flatMap(collectTables)
  }
  return []
}

const scriptTables = collectTables(COACH_SCRIPT)
const scriptLines = scriptTables.flat()

describe('sssketchy’s script, swept whole', () => {
  it('holds every table in the script and nothing empty', () => {
    // A tripwire, not a spec: if you add or remove a table or a variant,
    // update these two numbers deliberately. A DROP here means a line of
    // his copy stopped being checked by anything.
    expect(scriptTables).toHaveLength(25)
    expect(scriptLines).toHaveLength(100)
    for (const table of scriptTables) expect(table.length).toBeGreaterThan(0)
  })

  it('gives every table three to four variants', () => {
    // "copy is hand-written, 3-4 rotated variants" (spec). Repeating himself
    // word for word is most of what makes a character feel dead.
    for (const table of scriptTables) {
      expect(table.length).toBeGreaterThanOrEqual(3)
      expect(table.length).toBeLessThanOrEqual(4)
    }
  })

  it('obeys the copy rules on every line: lowercase, no emoji, no exclamation marks', () => {
    for (const line of scriptLines) {
      expect(line).not.toMatch(/!/)
      expect(line).not.toMatch(/\p{Extended_Pictographic}/u)
      expect(line[0]).toBe(line[0].toLowerCase())
    }
  })

  it('never asserts a fact about the user’s project', () => {
    for (const line of scriptLines) {
      expect(line).not.toMatch(/it looks like/i)
      expect(line).not.toMatch(/your track needs/i)
    }
  })

  it('never tells the user to do something at a bar number', () => {
    // The spec's own drill-sergeant example is "add a riser at bar 48".
    for (const line of scriptLines) expect(line).not.toMatch(/\bbar \d/)
  })

  it('holds the flat map hint to every rule but the variant count', () => {
    // Not a spoken line -- a tooltip on a control -- so it is deliberately
    // unrotated. The rest of the copy rules still apply to it.
    expect(COACH_MAP_LOCKED_CELL_HINT).not.toMatch(/!/)
    expect(COACH_MAP_LOCKED_CELL_HINT).not.toMatch(/\p{Extended_Pictographic}/u)
    expect(COACH_MAP_LOCKED_CELL_HINT[0]).toBe(COACH_MAP_LOCKED_CELL_HINT[0].toLowerCase())
  })
})

describe('the script reaches every surface that speaks', () => {
  /** Every table the app can actually read a line out of, gathered the way
   * the app gathers it: the named constants ./coachLines.ts exports, plus
   * the step rows' own lines. */
  const reachableFromTheApp: readonly (readonly string[])[] = [
    COACH_LOOP_QUESTION_LINES,
    COACH_SHAPE_QUESTION_LINES,
    COACH_PHRASE_LINE_TEMPLATES,
    COACH_PREFILLED_LINE_TEMPLATES,
    ...COACH_STEPS.map((step) => step.lines),
    COACH_WALK_START_LINES,
    ...Object.values(COACH_SECTION_GOAL_LINES),
    COACH_WALK_END_LINES,
    COACH_TENSION_LINE_TEMPLATES,
    COACH_TENSION_NONE_LINES,
    COACH_V1_EXPORTED_LINES,
    COACH_DONE_LINES,
    COACH_STUCK_LINES,
    COACH_NO_MOVES_LINES,
    COACH_STEP_SATISFIED_LINES
  ]

  it('is the same set of tables the app reads, by identity', () => {
    // The consolidation's one real risk, closed: every table the app can
    // speak from IS a table in the script (not a copy of one), and the
    // script holds no table the app cannot reach.
    for (const table of reachableFromTheApp) expect(scriptTables).toContain(table)
    expect(new Set(reachableFromTheApp).size).toBe(scriptTables.length)
  })

  it('leaves no copy behind in the step table', () => {
    // Each step row must POINT at the script rather than carry its own
    // words -- the whole point of the move.
    for (const step of COACH_STEPS) {
      expect(Object.values(COACH_SCRIPT.steps)).toContain(step.lines)
    }
  })
})
