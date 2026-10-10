import { describe, expect, it } from 'vitest'
import { crossColumnMark } from './crossColumnMark'

describe('crossColumnMark', () => {
  it('is playhead red only while the column is sounding', () => {
    expect(crossColumnMark(true, true)).toEqual({
      kind: 'playing',
      color: 'var(--ra-playhead)',
      label: 'playing'
    })
  })

  it('marks a selected but silent column in monochrome', () => {
    const mark = crossColumnMark(true, false)
    expect(mark).toEqual({ kind: 'selected', color: 'var(--ra-text-2)', label: 'selected' })
    expect(mark.color).not.toContain('playhead')
  })

  it('shows nothing on a column that is not selected, playing or not', () => {
    for (const playing of [true, false]) {
      expect(crossColumnMark(false, playing)).toEqual({
        kind: 'none',
        color: 'var(--ra-text-4)',
        label: undefined
      })
    }
  })
})
