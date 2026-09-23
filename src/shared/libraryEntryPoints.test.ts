import { describe, expect, it } from 'vitest'
import {
  LIBRARY_ENTRY_POINTS,
  libraryModeForEntryPoint,
  libraryModeLabel,
  type LibraryEntryPoint,
  type LibraryMode
} from './libraryEntryPoints'

/**
 * The shelf's two library buttons. The components that render them aren't
 * unit-tested here (CLAUDE.md), so what this file holds is the part that can
 * be wrong without anything crashing: a door that opens the wrong half, or a
 * header that names the half after the OTHER button.
 */
describe('library entry points', () => {
  it('opens each door on its own half', () => {
    expect(libraryModeForEntryPoint('import')).toBe('browse')
    expect(libraryModeForEntryPoint('discover')).toBe('discover')
  })

  it('agrees with the table it is described by', () => {
    // The table is what Shelf renders from; the function is what App calls on
    // a click. They must not be able to drift apart.
    for (const entry of LIBRARY_ENTRY_POINTS) {
      expect(libraryModeForEntryPoint(entry.id)).toBe(entry.mode)
    }
  })

  it('names the half after the button that reaches it', () => {
    // The whole point of the eyebrow: a user who pressed `import` and then
    // reads `browse` in the header has no idea they are in the same place.
    for (const entry of LIBRARY_ENTRY_POINTS) {
      expect(libraryModeLabel(entry.mode)).toBe(entry.label)
    }
  })

  it('has a door for every half, and no two doors onto one half', () => {
    const modes = LIBRARY_ENTRY_POINTS.map((e) => e.mode)
    const everyMode: LibraryMode[] = ['browse', 'discover']
    expect(new Set(modes)).toEqual(new Set(everyMode))
    expect(modes.length).toBe(everyMode.length)
  })

  it('gives every door a distinct id', () => {
    const ids = LIBRARY_ENTRY_POINTS.map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('leads with import', () => {
    // Shelf order. The tour's first step points at that button, and a new
    // user has nothing to discover with until something is imported.
    const first: LibraryEntryPoint = 'import'
    expect(LIBRARY_ENTRY_POINTS[0].id).toBe(first)
  })

  it('obeys the copy rules: lowercase, no emoji, no exclamation marks', () => {
    // tokens.css: "UI copy is lowercase; no emoji, no exclamation marks."
    for (const entry of LIBRARY_ENTRY_POINTS) {
      for (const text of [entry.label, entry.tooltip]) {
        expect(text).not.toMatch(/!/)
        expect(text).not.toMatch(/\p{Extended_Pictographic}/u)
        expect(text).toBe(text.toLowerCase())
      }
    }
  })

  it('keeps every tooltip to two or three words', () => {
    // Every tooltip in this app is two or three words; these are no exception.
    for (const entry of LIBRARY_ENTRY_POINTS) {
      const words = entry.tooltip.split(/\s+/).filter((w) => w.length > 0)
      expect(words.length).toBeGreaterThanOrEqual(2)
      expect(words.length).toBeLessThanOrEqual(3)
    }
  })
})
