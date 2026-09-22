import { describe, expect, it } from 'vitest'
import { parseStoredTempo } from './lastProjectTempo'

describe('parseStoredTempo', () => {
  it('returns a stored tempo inside the app range', () => {
    expect(parseStoredTempo('128', 80)).toBe(128)
    expect(parseStoredTempo('92.5', 80)).toBe(92.5)
  })

  it('falls back when nothing is stored or it is not a number', () => {
    expect(parseStoredTempo(null, 80)).toBe(80)
    expect(parseStoredTempo('', 80)).toBe(80)
    expect(parseStoredTempo('fast', 80)).toBe(80)
  })

  it('falls back when the stored value is outside [40, 200]', () => {
    expect(parseStoredTempo('20', 80)).toBe(80)
    expect(parseStoredTempo('999', 80)).toBe(80)
  })
})
