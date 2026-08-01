import { describe, expect, it } from 'vitest'
import { generateDefaultProjectName } from './projectFile'

describe('generateDefaultProjectName', () => {
  it('formats as YYYY-MM-DD-adjective-noun for a given date', () => {
    const name = generateDefaultProjectName(new Date(2026, 7, 1)) // August 1, 2026
    expect(name).toMatch(/^2026-08-01-[a-z]+-[a-z]+$/)
  })

  it('zero-pads single-digit month and day', () => {
    const name = generateDefaultProjectName(new Date(2026, 0, 5)) // January 5, 2026
    expect(name).toMatch(/^2026-01-05-[a-z]+-[a-z]+$/)
  })

  it('varies the adjective-noun pair across calls (not a fixed pair)', () => {
    const date = new Date(2026, 7, 1)
    const names = new Set(Array.from({ length: 20 }, () => generateDefaultProjectName(date)))
    expect(names.size).toBeGreaterThan(1)
  })
})
