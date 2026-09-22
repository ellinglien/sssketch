import { describe, expect, it } from 'vitest'
import { createWorkCounters, formatWorkSummary } from './workCounters'

describe('formatWorkSummary', () => {
  it('lists kinds highest count first, ties alphabetically', () => {
    const counts = new Map([
      ['decode', 42],
      ['ipc:get-stem-feature-cache', 120],
      ['analysis', 42]
    ])
    expect(formatWorkSummary('renderer', counts)).toBe(
      '[work renderer] ipc:get-stem-feature-cache 120 · analysis 42 · decode 42'
    )
  })

  it('returns null when nothing was counted', () => {
    expect(formatWorkSummary('main', new Map())).toBe(null)
    expect(formatWorkSummary('main', new Map([['decode', 0]]))).toBe(null)
  })
})

describe('createWorkCounters', () => {
  it('accumulates counts and resets on drain', () => {
    const c = createWorkCounters()
    c.count('decode')
    c.count('decode')
    c.count('sql:needs', 3)
    expect(c.drain()).toEqual(
      new Map([
        ['decode', 2],
        ['sql:needs', 3]
      ])
    )
    expect(c.drain().size).toBe(0)
  })
})
