import { describe, expect, it } from 'vitest'
import { guessBpmFromFilename } from './guessBpmFromFilename'

describe('guessBpmFromFilename', () => {
  it('extracts a trailing bare number in a plausible BPM range', () => {
    expect(guessBpmFromFilename('cw_amen08_165.wav')).toBe(165)
  })

  it('extracts a number explicitly followed by "bpm"', () => {
    expect(guessBpmFromFilename('Break_174bpm_02.wav')).toBe(174)
  })

  it('is case-insensitive for the "bpm" suffix', () => {
    expect(guessBpmFromFilename('Break_174BPM_02.wav')).toBe(174)
  })

  it('returns null when no plausible number is present', () => {
    expect(guessBpmFromFilename('Halftime Dnb Drums 1.wav')).toBeNull()
  })

  it('ignores single-digit numbers (below the plausible range)', () => {
    expect(guessBpmFromFilename('Dnb Drums 3.wav')).toBeNull()
  })

  it('ignores a 4-digit run like a year rather than matching a 2-3 digit substring of it', () => {
    expect(guessBpmFromFilename('Amen Break 2023 remaster.wav')).toBeNull()
  })

  it('picks the LAST plausible number when multiple are present and no "bpm" suffix exists', () => {
    expect(guessBpmFromFilename('Take 05 loop 128 v2.wav')).toBe(128)
  })

  it('prefers an explicit "bpm"-suffixed number over a later unrelated number', () => {
    expect(guessBpmFromFilename('Break_174bpm_take_99.wav')).toBe(174)
  })

  it('rejects a number outside the plausible musical tempo range', () => {
    expect(guessBpmFromFilename('sample_999.wav')).toBeNull()
  })

  it('accepts a decimal BPM in the "bpm"-suffixed form', () => {
    expect(guessBpmFromFilename('groove_140.5bpm.wav')).toBe(140.5)
  })

  it('does not match "bpm" preceded by a longer, undelimited digit run (code review, 2026-09-18)', () => {
    // "174bpm" here is really a substring of the longer run "99174", not
    // a clean tempo token -- same digit-run-boundary guard as the
    // bare-number pass, now applied consistently to the bpm-suffix pass.
    expect(guessBpmFromFilename('Track99174bpm.wav')).toBeNull()
  })

  it('still matches a "bpm"-suffixed number cleanly delimited from a preceding digit run', () => {
    expect(guessBpmFromFilename('Track99_174bpm.wav')).toBe(174)
  })
})
