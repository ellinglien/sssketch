import { describe, expect, it } from 'vitest'
import { emptyLibraryNote } from './emptyLibraryNote'

// Share readiness S6 (2026-10-07): on an empty riff library, Discover and radio say what to do
// instead of rolling nothing and saying nothing.
describe('emptyLibraryNote', () => {
  it('says what is empty, then the three ways in, in lowercase', () => {
    for (const where of ['discover', 'radio'] as const) {
      const lines = emptyLibraryNote(where)
      expect(lines[0]).toContain(where)
      const all = lines.join(' ')
      expect(all).toContain('log into endlesss')
      expect(all).toContain('LORE')
      expect(all).toContain('change riff archive location')
      expect(all).toContain('import')
      // lowercase copy, LORE aside (a name)
      expect(all.replace(/LORE/g, '')).toBe(all.replace(/LORE/g, '').toLowerCase())
      expect(all).not.toMatch(/!/)
    }
  })
})
