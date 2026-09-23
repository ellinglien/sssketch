import { describe, expect, it } from 'vitest'
import { KEY_GESTURES } from './keyGestures'

/**
 * A shortcuts screen that lies is worse than no shortcuts screen, and the
 * way this one will go wrong is by drifting: a gesture gets rebound, the
 * handler changes, and the line here keeps saying the old thing. Nothing a
 * unit test can do proves a line matches its handler -- those live in React
 * components this codebase deliberately doesn't mount. What it CAN hold is
 * the shape, the voice, and a tripwire on the count, so that removing a
 * gesture from the app and forgetting to remove it here at least has to be
 * a deliberate edit to this file.
 *
 * Same three copy rules coachScript.test.ts and tourSteps.test.ts run, held
 * a little tighter: these strings are all short labels, so every character
 * is lowercase, not just the first one.
 */
describe('the keys and gestures list', () => {
  const groups = KEY_GESTURES
  const rows = groups.flatMap((group) => group.gestures)

  it('holds every area and nothing empty', () => {
    // A tripwire, not a spec: if you add or remove a gesture, update these
    // two numbers deliberately. A DROP here means a gesture stopped being
    // documented anywhere in the app at all.
    expect(groups).toHaveLength(7)
    expect(rows).toHaveLength(65)
    for (const group of groups) expect(group.gestures.length).toBeGreaterThan(0)
  })

  it('obeys the copy rules: lowercase, no emoji, no exclamation marks', () => {
    // tokens.css: "UI copy is lowercase; no emoji, no exclamation marks."
    for (const row of [...groups.map((g) => g.area), ...rows.flatMap((r) => [r.keys, r.does])]) {
      expect(row).not.toMatch(/!/)
      expect(row).not.toMatch(/\p{Extended_Pictographic}/u)
      expect(row).toBe(row.toLowerCase())
    }
  })

  it('stays terse enough to scan rather than read', () => {
    // Two columns in a 560px modal at 10/11px. Past roughly this much a row
    // wraps, and a wrapped row is a sentence, which is the thing the
    // tooltip pass just finished removing from the app.
    for (const group of groups) expect(group.area.length).toBeLessThanOrEqual(34)
    for (const row of rows) {
      expect(row.keys.trim()).not.toBe('')
      expect(row.does.trim()).not.toBe('')
      expect(row.keys.length).toBeLessThanOrEqual(34)
      expect(row.does.length).toBeLessThanOrEqual(56)
    }
  })

  it('writes every row as a phrase, never a sentence', () => {
    // No trailing period, and no second sentence hiding inside one row --
    // a gesture that needs two sentences needs two rows, or it belongs in
    // the tour instead.
    for (const row of rows) {
      expect(row.does).not.toMatch(/\.$/)
      expect(row.does).not.toMatch(/\. /)
    }
  })

  it('gives every area its own name', () => {
    const areas = groups.map((group) => group.area)
    expect(new Set(areas).size).toBe(areas.length)
  })

  it('never lists the same keys twice inside one area', () => {
    // Across areas is fine and expected -- "drag" means something different
    // on a clip, a shelf tile and a dial, which is exactly why the list is
    // grouped by area at all. Twice in ONE area is a copy-paste mistake.
    for (const group of groups) {
      const keys = group.gestures.map((gesture) => gesture.keys)
      expect(new Set(keys).size).toBe(keys.length)
    }
  })

  it('spells the modifiers the way the app does', () => {
    // One spelling each, lowercase, joined with "+": cmd/ctrl/shift/option,
    // never "command", "meta", "alt", "⌘" or "Ctrl". Mixed spellings across
    // a reference list read as two different keys.
    for (const row of rows) {
      expect(row.keys).not.toMatch(/command|meta\b|\balt\b|⌘|⌥|⇧/)
    }
  })
})
