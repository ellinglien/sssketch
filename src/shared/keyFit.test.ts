import { describe, expect, it } from 'vitest'
import { keyFit, KEY_NEUTRAL, type RiffKey } from './keyFit'

const k = (root: number | null, scale: number | null): RiffKey => ({ root, scale })
const MAJOR = 0,
  MINOR = 5,
  MINOR_PENT = 7,
  CHROMATIC = 17

describe('keyFit', () => {
  it('same key fits fully', () => expect(keyFit(k(4, MINOR), k(4, MINOR))).toBe(1))
  it('relative major and minor fit fully', () => expect(keyFit(k(0, MAJOR), k(9, MINOR))).toBe(1))
  it('a pentatonic inside its parent fits fully', () =>
    expect(keyFit(k(9, MINOR_PENT), k(9, MINOR))).toBe(1))
  it('a fifth apart fits well', () =>
    expect(keyFit(k(0, MAJOR), k(7, MAJOR))).toBeCloseTo(5 / 7, 5))
  it('a semitone apart clashes', () => expect(keyFit(k(0, MAJOR), k(1, MAJOR))).toBe(0))
  it('a tritone apart clashes', () => expect(keyFit(k(0, MAJOR), k(6, MAJOR))).toBe(0))
  it('is symmetric', () => expect(keyFit(k(2, 1), k(7, 4))).toBe(keyFit(k(7, 4), k(2, 1))))
  it('unknown or chromatic is neutral', () => {
    for (const other of [k(null, null), k(0, null), k(0, CHROMATIC), k(0, 99), k(12, MAJOR)]) {
      expect(keyFit(other, k(0, MAJOR))).toBe(KEY_NEUTRAL)
      expect(keyFit(k(0, MAJOR), other)).toBe(KEY_NEUTRAL)
    }
  })
})
